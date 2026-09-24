import type { MasterFxSettings } from '@/types/audio';
import { clamp } from '@/lib/utils/audioMath';

/** Number of samples in the cached overdrive transfer curve. */
const CURVE_POINTS = 2048;
/** Smoothing constant for every continuous parameter change, in seconds. */
const PARAM_SMOOTHING_SECONDS = 0.01;

/**
 * Waveshaper transfer curve. TypeScript's generic typed arrays require the
 * buffer parameter to be spelled out, because `WaveShaperNode.curve` rejects a
 * `SharedArrayBuffer`-backed view.
 */
type DriveCurve = Float32Array<ArrayBuffer>;

/**
 * Master post-mix chain:
 *
 *   inputNode -> overdrive (dry + waveshaped wet) -> delay (dry + wet + feedback)
 *             -> resonant filter -> outputNode
 *
 * The overdrive transfer curve is regenerated only when `drive` changes, so
 * knob moves on the delay or filter never allocate.
 */
export class EffectsChain {
  public readonly inputNode: GainNode;
  public readonly outputNode: GainNode;

  private readonly ctx: AudioContext;
  private readonly distortionDry: GainNode;
  private readonly distortionWet: GainNode;
  private readonly waveshaper: WaveShaperNode;
  private readonly delayStage: GainNode;
  private readonly delayNode: DelayNode;
  private readonly delayFeedback: GainNode;
  private readonly delayDry: GainNode;
  private readonly delayWet: GainNode;
  private readonly masterFilter: BiquadFilterNode;

  private cachedCurve: DriveCurve | null = null;
  private cachedDrive = -1;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();

    // ----------------------------------------------------------- overdrive
    this.waveshaper = ctx.createWaveShaper();
    this.waveshaper.oversample = '2x';
    this.distortionDry = ctx.createGain();
    this.distortionWet = ctx.createGain();
    this.delayStage = ctx.createGain();

    this.inputNode.connect(this.distortionDry);
    this.distortionDry.connect(this.delayStage);
    this.inputNode.connect(this.waveshaper);
    this.waveshaper.connect(this.distortionWet);
    this.distortionWet.connect(this.delayStage);

    // --------------------------------------------------------------- delay
    this.delayNode = ctx.createDelay(1.0);
    this.delayFeedback = ctx.createGain();
    this.delayDry = ctx.createGain();
    this.delayWet = ctx.createGain();
    this.masterFilter = ctx.createBiquadFilter();

    this.delayStage.connect(this.delayDry);
    this.delayDry.connect(this.masterFilter);
    this.delayStage.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.masterFilter);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);

    // -------------------------------------------------------------- output
    this.masterFilter.connect(this.outputNode);

    // Safe defaults so an unconfigured chain stays transparent.
    this.distortionDry.gain.value = 1;
    this.distortionWet.gain.value = 0;
    this.delayDry.gain.value = 1;
    this.delayWet.gain.value = 0;
    this.delayFeedback.gain.value = 0;
    this.delayNode.delayTime.value = 0.25;
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 20000;
    this.masterFilter.Q.value = 0.7;
    this.applyDriveCurve(0);
  }

  /**
   * Builds a normalized tanh transfer curve. Normalizing by `tanh(k)` keeps the
   * curve unity at full scale, so raising drive adds harmonics instead of level.
   */
  private buildDriveCurve(drive: number): DriveCurve {
    const curve = new Float32Array(CURVE_POINTS);
    const amount = clamp(drive, 0, 100) / 100;
    const k = Math.max(0.001, amount * 40);
    const normalizer = Math.tanh(k);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const x = (i / (CURVE_POINTS - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / normalizer;
    }
    return curve;
  }

  private applyDriveCurve(drive: number): void {
    if (drive === this.cachedDrive && this.cachedCurve !== null) return;
    this.cachedCurve = this.buildDriveCurve(drive);
    this.waveshaper.curve = this.cachedCurve;
    this.cachedDrive = drive;
  }

  /** Applies master FX settings with smoothing to avoid zipper noise. */
  public updateParams(settings: MasterFxSettings): void {
    const now = this.ctx.currentTime;

    // Overdrive: rebuild the curve only when the drive amount moved.
    this.applyDriveCurve(settings.distortion.drive);
    const distortionWet = clamp(settings.distortion.wetDry, 0, 1);
    this.distortionWet.gain.setTargetAtTime(distortionWet, now, PARAM_SMOOTHING_SECONDS);
    this.distortionDry.gain.setTargetAtTime(1 - distortionWet, now, PARAM_SMOOTHING_SECONDS);

    // Delay: absolute seconds, per the routing contract.
    this.delayNode.delayTime.setTargetAtTime(
      clamp(settings.delay.time, 0.01, 1),
      now,
      PARAM_SMOOTHING_SECONDS,
    );
    this.delayFeedback.gain.setTargetAtTime(
      clamp(settings.delay.feedback, 0, 0.95),
      now,
      PARAM_SMOOTHING_SECONDS,
    );
    const delayWet = clamp(settings.delay.wetDry, 0, 1);
    this.delayWet.gain.setTargetAtTime(delayWet, now, PARAM_SMOOTHING_SECONDS);
    this.delayDry.gain.setTargetAtTime(1 - delayWet, now, PARAM_SMOOTHING_SECONDS);

    // Master resonant filter.
    if (this.masterFilter.type !== settings.filter.type) {
      this.masterFilter.type = settings.filter.type;
    }
    this.masterFilter.frequency.setTargetAtTime(
      clamp(settings.filter.cutoff, 20, 20000),
      now,
      PARAM_SMOOTHING_SECONDS,
    );
    this.masterFilter.Q.setTargetAtTime(
      clamp(settings.filter.resonance, 0.1, 20),
      now,
      PARAM_SMOOTHING_SECONDS,
    );
  }

  /** Diagnostics for the verification gate. */
  public getCachedDrive(): number {
    return this.cachedDrive;
  }

  /** Diagnostics: the curve is only reallocated when drive changes. */
  public hasCachedCurve(): boolean {
    return this.cachedCurve !== null;
  }

  /** Detaches the chain from the graph. */
  public dispose(): void {
    this.inputNode.disconnect();
    this.outputNode.disconnect();
    this.waveshaper.disconnect();
    this.distortionDry.disconnect();
    this.distortionWet.disconnect();
    this.delayStage.disconnect();
    this.delayNode.disconnect();
    this.delayFeedback.disconnect();
    this.delayDry.disconnect();
    this.delayWet.disconnect();
    this.masterFilter.disconnect();
    this.cachedCurve = null;
    this.cachedDrive = -1;
  }
}
