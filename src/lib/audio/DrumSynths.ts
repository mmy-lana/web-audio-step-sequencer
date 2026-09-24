import type { SynthParams, VoiceTriggerOptions } from '@/types/audio';
import { NoiseBufferPool } from '@/lib/audio/NoiseBufferPool';
import { applyPitchOffset } from '@/lib/utils/audioMath';

/** Shortest tail kept alive after a voice's amplitude envelope ends. */
const SOURCE_TAIL_SECONDS = 0.02;

/**
 * Percussion voice bank.
 *
 * Every voice shares one normalized signature —
 * `trigger(dest, time, vel, params, pitchOffset, options)` — so the engine can
 * dispatch from a single table. The constructor is inert; nodes are only created
 * inside a trigger, which always runs on the scheduler's lookahead window.
 */
export class DrumSynthesizer {
  private readonly ctx: AudioContext;
  private readonly activeSources = new Set<AudioScheduledSourceNode>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /** Stops and detaches every voice currently sounding. */
  public stopAll(): void {
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // The source already ended.
      }
      try {
        source.disconnect();
      } catch {
        // Already detached.
      }
    });
    this.activeSources.clear();
  }

  /** Number of live sources, for the verification gate. */
  public getActiveSourceCount(): number {
    return this.activeSources.size;
  }

  private registerSource(source: AudioScheduledSourceNode, stopTime: number): void {
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try {
        source.disconnect();
      } catch {
        // Already detached.
      }
    };
    try {
      source.stop(stopTime);
    } catch {
      // A source that already reached its stop time throws; nothing to do.
      this.activeSources.delete(source);
    }
  }

  /** Noise voice helper: one looping buffer source with a random read offset. */
  private createNoiseSource(): AudioBufferSourceNode {
    const noise = this.ctx.createBufferSource();
    const buffer = NoiseBufferPool.getSharedBuffer(this.ctx);
    noise.buffer = buffer;
    noise.loop = true;
    return noise;
  }

  public triggerKick(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    pitchOffset: number,
    _options?: VoiceTriggerOptions,
  ): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const baseFrequency = applyPitchOffset(params.baseFrequency, pitchOffset);
    const safeVel = Math.max(0.001, vel);
    const decay = params.envelope.decay;

    osc.type = params.waveform;
    osc.frequency.setValueAtTime(Math.max(20, baseFrequency * 3.5), time);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, baseFrequency),
      time + (params.pitchDecay ?? 0.08),
    );

    gain.gain.setValueAtTime(safeVel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(time);
    this.registerSource(osc, time + decay + SOURCE_TAIL_SECONDS);
  }

  public triggerSnare(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    pitchOffset: number,
    _options?: VoiceTriggerOptions,
  ): void {
    const decay = params.envelope.decay;
    const safeVel = Math.max(0.001, vel);

    // Noise body.
    const noise = this.createNoiseSource();
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime(Math.max(20, params.filter.cutoff), time);
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(safeVel * 0.8, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(dest);

    // Tuned transient.
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    const baseFrequency = applyPitchOffset(params.baseFrequency, pitchOffset);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(Math.max(20, baseFrequency * 1.8), time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, baseFrequency), time + 0.08);

    oscGain.gain.setValueAtTime(safeVel * 0.6, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    osc.connect(oscGain);
    oscGain.connect(dest);

    const buffer = noise.buffer;
    noise.start(time, buffer === null ? 0 : NoiseBufferPool.getRandomOffset(buffer));
    osc.start(time);
    this.registerSource(noise, time + decay + SOURCE_TAIL_SECONDS);
    this.registerSource(osc, time + 0.13);
  }

  public triggerHiHat(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    _pitchOffset: number,
    options?: VoiceTriggerOptions,
  ): void {
    const isOpen = options?.isOpen ?? false;
    const decay = isOpen ? Math.max(0.12, params.envelope.decay) : 0.05;
    const safeVel = Math.max(0.001, vel);

    const noise = this.createNoiseSource();
    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(Math.max(20, params.filter.cutoff), time);
    bandpass.Q.setValueAtTime(Math.max(0.1, params.filter.resonance), time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(safeVel * 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(dest);

    const buffer = noise.buffer;
    noise.start(time, buffer === null ? 0 : NoiseBufferPool.getRandomOffset(buffer));
    this.registerSource(noise, time + decay + SOURCE_TAIL_SECONDS);
  }

  public triggerClap(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    _pitchOffset: number,
    _options?: VoiceTriggerOptions,
  ): void {
    const bursts = [0, 0.011, 0.024];
    const decay = params.envelope.decay;
    const safeVel = Math.max(0.001, vel);

    bursts.forEach((offset, index) => {
      const isFinal = index === bursts.length - 1;
      const burstLength = isFinal ? decay : 0.012;

      const noise = this.createNoiseSource();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, time + offset);
      filter.Q.setValueAtTime(2.5, time + offset);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(safeVel * (isFinal ? 0.9 : 0.5), time + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, time + offset + burstLength);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);

      // A distinct offset per burst prevents correlation artefacts.
      const buffer = noise.buffer;
      noise.start(time + offset, buffer === null ? 0 : NoiseBufferPool.getRandomOffset(buffer));
      this.registerSource(noise, time + offset + burstLength + SOURCE_TAIL_SECONDS);
    });
  }

  public triggerTom(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    pitchOffset: number,
    options?: VoiceTriggerOptions,
  ): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const multiplier = options?.isHigh === true ? 1.5 : 1.0;
    const baseFrequency = applyPitchOffset(params.baseFrequency * multiplier, pitchOffset);
    const safeVel = Math.max(0.001, vel);
    const decay = params.envelope.decay;

    osc.type = params.waveform;
    osc.frequency.setValueAtTime(Math.max(20, baseFrequency * 2.2), time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, baseFrequency), time + 0.08);

    gain.gain.setValueAtTime(safeVel * 0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(time);
    this.registerSource(osc, time + decay + SOURCE_TAIL_SECONDS);
  }
}
