import { EffectsChain } from '@/lib/audio/EffectsChain';
import { clamp, computeRmsLevel, normalizeLevelToMeter } from '@/lib/utils/audioMath';

/** Limiter settings: a transparent brick wall just below full scale. */
const LIMITER_THRESHOLD_DB = -1;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_SECONDS = 0.003;
const LIMITER_RELEASE_SECONDS = 0.1;
const LIMITER_KNEE = 0;

/** Analyser window used by the stereo VU ladders. */
const ANALYSER_FFT_SIZE = 256;
/** Meter floor: signals quieter than this read as silence. */
const METER_FLOOR_DB = -60;

/** Smoothing constant for master volume changes, in seconds. */
const VOLUME_SMOOTHING_SECONDS = 0.01;

export interface StereoLevels {
  left: number;
  right: number;
}

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

interface AudioScope {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

/**
 * Analyser sample frame. TypeScript's generic typed arrays require the buffer
 * parameter to be spelled out, because `getFloatTimeDomainData` rejects a
 * `SharedArrayBuffer`-backed view.
 */
type SampleFrame = Float32Array<ArrayBuffer>;

/**
 * Owns the `AudioContext` and the master routing graph.
 *
 * Graph (per the routing contract):
 *
 *   padBus ─┐
 *   strips ─┴─> masterBus ─> EffectsChain ─> masterGain ─> limiter ─┬─> destination
 *                                                                   └─> splitter(2)
 *                                                                        ├─> analyser L
 *                                                                        └─> analyser R
 *
 * The constructor is inert: no context is created and no timer is started until
 * `createGraph()` runs inside an explicit user gesture.
 */
export class AudioContextManager {
  public ctx: AudioContext | null = null;
  public masterBus: GainNode | null = null;
  public padBus: GainNode | null = null;
  public masterGain: GainNode | null = null;
  public limiter: DynamicsCompressorNode | null = null;
  public splitter: ChannelSplitterNode | null = null;
  public leftAnalyser: AnalyserNode | null = null;
  public rightAnalyser: AnalyserNode | null = null;
  public effectsChain: EffectsChain | null = null;
  public isInitialized = false;

  private leftFrame: SampleFrame | null = null;
  private rightFrame: SampleFrame | null = null;

  /**
   * Synchronously constructs the `AudioContext` and wires the master graph.
   * Must be called directly from a user-gesture handler so iOS Safari unlocks
   * playback; nothing here awaits.
   */
  public createGraph(): AudioContext {
    if (this.ctx !== null && this.isInitialized) {
      return this.ctx;
    }
    // A previous attempt may have created the context and then failed while
    // wiring the graph. Tear that partial state down instead of leaking it.
    if (this.ctx !== null) {
      this.dispose();
    }

    const scope = globalThis as unknown as AudioScope;
    const ContextConstructor = scope.AudioContext ?? scope.webkitAudioContext;
    if (ContextConstructor === undefined) {
      throw new Error('Web Audio API is not supported in this browser');
    }

    const ctx = new ContextConstructor({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // Summing buses.
    this.masterBus = ctx.createGain();
    this.padBus = ctx.createGain();
    this.masterBus.gain.value = 1;
    this.padBus.gain.value = 1;
    this.padBus.connect(this.masterBus);

    // Post-mix effects.
    this.effectsChain = new EffectsChain(ctx);
    this.masterBus.connect(this.effectsChain.inputNode);

    // Master volume and brick-wall limiting.
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.85;
    this.effectsChain.outputNode.connect(this.masterGain);

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = LIMITER_THRESHOLD_DB;
    this.limiter.ratio.value = LIMITER_RATIO;
    this.limiter.attack.value = LIMITER_ATTACK_SECONDS;
    this.limiter.release.value = LIMITER_RELEASE_SECONDS;
    this.limiter.knee.value = LIMITER_KNEE;
    this.masterGain.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    // Stereo analysis tap after the limiter.
    this.splitter = ctx.createChannelSplitter(2);
    this.leftAnalyser = ctx.createAnalyser();
    this.rightAnalyser = ctx.createAnalyser();
    this.leftAnalyser.fftSize = ANALYSER_FFT_SIZE;
    this.rightAnalyser.fftSize = ANALYSER_FFT_SIZE;
    this.limiter.connect(this.splitter);
    this.splitter.connect(this.leftAnalyser, 0);
    this.splitter.connect(this.rightAnalyser, 1);

    this.leftFrame = new Float32Array(this.leftAnalyser.fftSize);
    this.rightFrame = new Float32Array(this.rightAnalyser.fftSize);

    this.isInitialized = true;
    return ctx;
  }

  /** Creates the graph if needed, then resumes the context. */
  public async init(): Promise<AudioContext> {
    const ctx = this.createGraph();
    await this.resume();
    return ctx;
  }

  public async resume(): Promise<void> {
    if (this.ctx === null) return;
    if (this.ctx.state === 'running') return;
    try {
      await this.ctx.resume();
    } catch {
      // Browsers reject resume() when no gesture has unlocked audio yet; the
      // next explicit POWER ON click retries.
    }
  }

  public async suspend(): Promise<void> {
    if (this.ctx === null || this.ctx.state !== 'running') return;
    try {
      await this.ctx.suspend();
    } catch {
      // Suspending is best-effort.
    }
  }

  /** Applies the master volume with smoothing to avoid zipper noise. */
  public applyMasterVolume(volume: number): void {
    if (this.masterGain === null || this.ctx === null) return;
    this.masterGain.gain.setTargetAtTime(
      clamp(volume, 0, 1.2),
      this.ctx.currentTime,
      VOLUME_SMOOTHING_SECONDS,
    );
  }

  /**
   * RMS level of each channel mapped onto a 0..1 meter position.
   * Returns silence before the graph exists.
   */
  public getStereoLevels(): StereoLevels {
    if (
      this.leftAnalyser === null ||
      this.rightAnalyser === null ||
      this.leftFrame === null ||
      this.rightFrame === null
    ) {
      return { left: 0, right: 0 };
    }
    this.leftAnalyser.getFloatTimeDomainData(this.leftFrame);
    this.rightAnalyser.getFloatTimeDomainData(this.rightFrame);
    return {
      left: normalizeLevelToMeter(computeRmsLevel(this.leftFrame), METER_FLOOR_DB),
      right: normalizeLevelToMeter(computeRmsLevel(this.rightFrame), METER_FLOOR_DB),
    };
  }

  /** Current context time, or `null` before initialisation. */
  public getCurrentTime(): number | null {
    return this.ctx === null ? null : this.ctx.currentTime;
  }

  /** Tears the graph down. Used when the context has to be rebuilt. */
  public dispose(): void {
    this.effectsChain?.dispose();
    this.padBus?.disconnect();
    this.masterBus?.disconnect();
    this.masterGain?.disconnect();
    this.limiter?.disconnect();
    this.splitter?.disconnect();
    this.leftAnalyser?.disconnect();
    this.rightAnalyser?.disconnect();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.masterBus = null;
    this.padBus = null;
    this.masterGain = null;
    this.limiter = null;
    this.splitter = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.effectsChain = null;
    this.leftFrame = null;
    this.rightFrame = null;
    this.isInitialized = false;
  }
}
