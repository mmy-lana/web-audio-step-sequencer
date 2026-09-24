import type { InstrumentType, Pattern, PlayheadScheduleItem, SoundboardPad, Track, VoiceTriggerOptions } from '@/types/audio';
import { AudioContextManager } from '@/lib/audio/AudioContextManager';
import type { StereoLevels } from '@/lib/audio/AudioContextManager';
import { DrumSynthesizer } from '@/lib/audio/DrumSynths';
import { LookaheadScheduler } from '@/lib/audio/LookaheadScheduler';
import { NoiseBufferPool } from '@/lib/audio/NoiseBufferPool';
import { SynthVoice } from '@/lib/audio/SynthVoice';
import { clearPlayhead } from '@/lib/utils/playheadRegistry';

/** One mixer channel: source input -> stereo panner -> volume gain -> master bus. */
export interface TrackStrip {
  input: GainNode;
  panner: StereoPannerNode;
  gain: GainNode;
}

/** Smoothing constant for mixer changes, in seconds. */
const MIXER_SMOOTHING_SECONDS = 0.01;
/** Upper bound on the pending visual playhead queue. */
const MAX_PLAYHEAD_QUEUE = 64;

/**
 * Mute/solo evaluation, applied at schedule time.
 *
 * Solo wins over mute: while any track is soloed, every track that is not
 * soloed is silenced. Lives in the audio tier so the scheduler can use it
 * without importing the store, which sits above this module in the dependency
 * graph. The store re-exports it for UI consumers.
 */
export function isTrackAudible(tracks: readonly Track[], trackIndex: number): boolean {
  const track = tracks[trackIndex];
  if (track === undefined) return false;
  const anySoloed = tracks.some((candidate) => candidate.soloed);
  if (anySoloed) return track.soloed && !track.muted;
  return !track.muted;
}

/**
 * The audio engine.
 *
 * The constructor is inert — no `AudioContext`, no timers, no browser globals.
 * `init()` must be called from a real user gesture: it constructs the context
 * synchronously and calls `resume()` before its first `await`, which is what iOS
 * Safari requires to unlock playback.
 *
 * Transport state is published through `subscribe()` so React can read it with
 * `useSyncExternalStore`. The engine deliberately does not import the store
 * (the store sits above this tier); `useAudioEngine` mirrors the engine's
 * transport flag into the store instead.
 */
export class AudioEngine {
  public isInitialized = false;

  private readonly manager = new AudioContextManager();
  private strips: TrackStrip[] = [];
  private drums: DrumSynthesizer | null = null;
  private synth: SynthVoice | null = null;
  private scheduler: LookaheadScheduler | null = null;
  private playheadQueue: PlayheadScheduleItem[] = [];
  private getPatternSnapshot: (() => Pattern) | null = null;
  private readonly listeners = new Set<() => void>();
  private isPlaying = false;
  /** In-flight initialisation, so concurrent callers share one graph build. */
  private initPromise: Promise<void> | null = null;

  /** Stable reference for `useSyncExternalStore`. */
  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable snapshot: a primitive, never a new object. */
  public readonly getIsInitialized = (): boolean => this.isInitialized;

  /** Stable snapshot: a primitive, never a new object. */
  public readonly getIsPlaying = (): boolean => this.isPlaying;

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Constructs the audio graph synchronously and resumes the context.
   *
   * Serialised by an in-flight mutex: two rapid gestures (a double-tap on the
   * power switch, or a click racing a hotkey) would otherwise build the eight
   * track strips and the voice bank twice, leaking the first set into the live
   * graph. Concurrent callers share the single in-flight promise.
   */
  public init(): Promise<void> {
    if (this.initPromise !== null) {
      return this.initPromise;
    }
    if (this.isInitialized && this.manager.ctx !== null) {
      return this.manager.resume();
    }

    let ctx: AudioContext;
    try {
      // Everything up to resume() runs synchronously inside the caller's
      // gesture handler, which is what iOS Safari requires to unlock audio.
      ctx = this.manager.createGraph();
      this.buildTrackStrips(ctx);

      this.drums = new DrumSynthesizer(ctx);
      this.synth = new SynthVoice(ctx);
      this.scheduler = new LookaheadScheduler(
        ctx,
        () => {
          const pattern = this.getPatternSnapshot?.();
          return {
            bpm: pattern?.bpm ?? 120,
            swing: pattern?.swing ?? 0,
            stepCount: pattern?.stepCount ?? 16,
          };
        },
        (step, time) => this.handleScheduleStep(step, time),
      );

      this.isInitialized = true;
    } catch (error) {
      this.isInitialized = false;
      this.initPromise = null;
      return Promise.reject(
        error instanceof Error ? error : new Error('Audio initialisation failed'),
      );
    }

    this.emit();
    // resume() is invoked before the first await resolves.
    const pending = this.manager.resume().finally(() => {
      this.initPromise = null;
    });
    this.initPromise = pending;
    return pending;
  }

  private buildTrackStrips(ctx: AudioContext): void {
    const masterBus = this.manager.masterBus;
    if (masterBus === null) return;

    this.strips = Array.from({ length: 8 }, () => {
      const input = ctx.createGain();
      const panner = ctx.createStereoPanner();
      const gain = ctx.createGain();
      input.connect(panner);
      panner.connect(gain);
      gain.connect(masterBus);
      return { input, panner, gain };
    });
  }

  /**
   * Schedules one grid step.
   *
   * Mute/solo is evaluated here, at schedule time, so toggling a mute takes
   * effect on the next step rather than retroactively. The strip gain holds
   * track volume only.
   */
  private handleScheduleStep(step: number, time: number): void {
    const pattern = this.getPatternSnapshot?.();
    if (pattern === undefined || pattern === null) return;

    // 1-2. Queue the visual cursor; the RAF tracker lights it in real time.
    this.playheadQueue.push({ step, time });
    if (this.playheadQueue.length > MAX_PLAYHEAD_QUEUE) {
      this.playheadQueue.splice(0, this.playheadQueue.length - MAX_PLAYHEAD_QUEUE);
    }

    // 3-4. Dispatch every audible track that has a step programmed.
    for (let trackIndex = 0; trackIndex < pattern.tracks.length; trackIndex++) {
      if (!isTrackAudible(pattern.tracks, trackIndex)) continue;
      const track = pattern.tracks[trackIndex];
      const strip = this.strips[trackIndex];
      const scheduledStep = track.steps[step];
      if (strip === undefined || scheduledStep === undefined) continue;
      if (!scheduledStep.active) continue;
      if (Math.random() > scheduledStep.probability) continue;

      this.dispatchVoice(
        track.instrument,
        strip.input,
        time,
        scheduledStep.velocity,
        track.params,
        scheduledStep.pitchOffset,
        undefined,
      );
    }
  }

  /** Single dispatch table shared by the sequencer and the soundboard. */
  private dispatchVoice(
    instrument: InstrumentType,
    dest: AudioNode,
    time: number,
    velocity: number,
    params: Track['params'],
    pitchOffset: number,
    options: VoiceTriggerOptions | undefined,
  ): void {
    const drums = this.drums;
    const synth = this.synth;
    if (drums === null || synth === null) return;

    switch (instrument) {
      case 'kick':
        drums.triggerKick(dest, time, velocity, params, pitchOffset, options);
        break;
      case 'snare':
        drums.triggerSnare(dest, time, velocity, params, pitchOffset, options);
        break;
      case 'hihat_closed':
        drums.triggerHiHat(dest, time, velocity, params, pitchOffset, { isOpen: false });
        break;
      case 'hihat_open':
        drums.triggerHiHat(dest, time, velocity, params, pitchOffset, { isOpen: true });
        break;
      case 'clap':
        drums.triggerClap(dest, time, velocity, params, pitchOffset, options);
        break;
      case 'tom_low':
        drums.triggerTom(dest, time, velocity, params, pitchOffset, { isHigh: false });
        break;
      case 'tom_high':
        drums.triggerTom(dest, time, velocity, params, pitchOffset, { isHigh: true });
        break;
      case 'synth_lead':
        synth.trigger(dest, time, velocity, params, pitchOffset, options);
        break;
    }
  }

  /**
   * Starts the transport. The pattern snapshot is injected so the engine never
   * reaches into the store. Calling this while already playing is a no-op.
   */
  public async play(getPatternSnapshot: () => Pattern): Promise<void> {
    if (this.isPlaying) return;
    if (!this.isInitialized) {
      await this.init();
    }
    this.getPatternSnapshot = getPatternSnapshot;
    if (this.scheduler === null) return;

    this.playheadQueue = [];
    this.isPlaying = true;
    this.emit();
    await this.scheduler.start();
  }

  /**
   * Stops the transport and silences every voice.
   *
   * Also clears the visual playhead. The store's `isPlaying` flag is mirrored
   * from here by `useAudioEngine`'s subscription, keeping the dependency graph
   * one-directional.
   */
  public stop(): void {
    this.scheduler?.stop();
    this.drums?.stopAll();
    this.synth?.stopAll();
    this.playheadQueue = [];
    clearPlayhead();
    if (this.isPlaying) {
      this.isPlaying = false;
    }
    this.emit();
  }

  /** Fires a soundboard pad through the same dispatch table, at full velocity. */
  public triggerPad(pad: SoundboardPad): void {
    const ctx = this.manager.ctx;
    const padBus = this.manager.padBus;
    if (ctx === null || padBus === null || !this.isInitialized) return;
    this.dispatchVoice(pad.instrument, padBus, ctx.currentTime, 1, pad.params, 0, undefined);
  }

  /**
   * Pushes track volume/pan and the master FX settings into the live graph.
   * Every continuous parameter is written with `setTargetAtTime`, which removes
   * zipper artefacts when a knob is dragged.
   */
  public syncMixer(pattern: Pattern): void {
    const ctx = this.manager.ctx;
    if (ctx === null || !this.isInitialized) return;
    const now = ctx.currentTime;

    for (let index = 0; index < this.strips.length; index++) {
      const strip = this.strips[index];
      const track = pattern.tracks[index];
      if (strip === undefined || track === undefined) continue;
      strip.gain.gain.setTargetAtTime(track.volume, now, MIXER_SMOOTHING_SECONDS);
      strip.panner.pan.setTargetAtTime(track.pan, now, MIXER_SMOOTHING_SECONDS);
    }

    this.manager.effectsChain?.updateParams(pattern.masterFx);
    this.manager.applyMasterVolume(pattern.masterFx.masterVolume);
  }

  public getStereoLevels(): StereoLevels {
    return this.manager.getStereoLevels();
  }

  /** Current audio clock, or `null` before initialisation. */
  public getCurrentTime(): number | null {
    return this.manager.getCurrentTime();
  }

  /**
   * Pops every queued step whose scheduled time has arrived and returns the
   * newest one, which the RAF tracker turns into the lit cursor column.
   */
  public advancePlayhead(currentTime: number): number | null {
    let latest: number | null = null;
    while (this.playheadQueue.length > 0) {
      const head = this.playheadQueue[0];
      if (head === undefined || head.time > currentTime) break;
      this.playheadQueue.shift();
      latest = head.step;
    }
    return latest;
  }

  /** Pending cursor entries, for diagnostics and the verification gate. */
  public getPendingPlayheadCount(): number {
    return this.playheadQueue.length;
  }

  public clearPlayheadQueue(): void {
    this.playheadQueue = [];
  }

  /** Diagnostics for the verification gate. */
  public getTrackStripCount(): number {
    return this.strips.length;
  }

  /** The live audio context, or `null`. Exposed for analyser-driven UI. */
  public getAudioContext(): AudioContext | null {
    return this.manager.ctx;
  }

  /** Tears the engine down completely; used by tests and hot reload. */
  public dispose(): void {
    this.stop();
    NoiseBufferPool.dispose();
    this.manager.dispose();
    this.strips = [];
    this.drums = null;
    this.synth = null;
    this.scheduler = null;
    this.getPatternSnapshot = null;
    this.initPromise = null;
    this.isInitialized = false;
    this.emit();
  }
}

const ENGINE_GLOBAL_KEY = '__wa_step_seq_audio_engine__';

interface EngineScope {
  [ENGINE_GLOBAL_KEY]?: AudioEngine;
}

/**
 * Module-level singleton, parked on `globalThis` so it survives hot reload and
 * React strict-mode double mounts without ever creating a second AudioContext.
 */
export function getAudioEngine(): AudioEngine {
  const scope = globalThis as unknown as EngineScope;
  const existing = scope[ENGINE_GLOBAL_KEY];
  if (existing instanceof AudioEngine) return existing;
  const engine = new AudioEngine();
  scope[ENGINE_GLOBAL_KEY] = engine;
  return engine;
}
