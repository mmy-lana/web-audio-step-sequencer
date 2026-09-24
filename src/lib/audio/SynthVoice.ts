import type { SynthParams, VoiceTriggerOptions } from '@/types/audio';
import { applyPitchOffset, clamp } from '@/lib/utils/audioMath';

/** Nominal gate length of a single sequenced note, in seconds. */
const NOMINAL_GATE_SECONDS = 0.25;
/** Tail kept after the release ramp finishes, in seconds. */
const RELEASE_TAIL_SECONDS = 0.05;
/** Lowest amplitude usable by exponential ramps (they cannot reach zero). */
const MIN_GAIN = 0.001;

/**
 * Every node owned by one sounding voice.
 *
 * Tracking the intermediates matters: disconnecting a stopped oscillator leaves
 * the filter and gain chain still attached to the destination, which keeps the
 * whole chain alive in the audio graph. `stopAll()` and the `onended` handler
 * both detach the complete chain.
 */
interface SynthActiveVoice {
  osc: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

/**
 * Subtractive lead voice: oscillator -> resonant filter -> ADSR gain.
 *
 * The envelope guarantees that the gate never truncates the decay phase, so a
 * long decay with a short note still completes before the release ramp starts.
 */
export class SynthVoice {
  private readonly ctx: AudioContext;
  private readonly activeVoices = new Set<SynthActiveVoice>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /** Detaches every node of a voice. Safe to call more than once. */
  private detachVoice(voice: SynthActiveVoice): void {
    try {
      voice.osc.disconnect();
    } catch {
      // Already detached.
    }
    try {
      voice.filter.disconnect();
    } catch {
      // Already detached.
    }
    try {
      voice.gain.disconnect();
    } catch {
      // Already detached.
    }
  }

  /** Stops and detaches every voice currently sounding. */
  public stopAll(): void {
    this.activeVoices.forEach((voice) => {
      try {
        voice.osc.stop();
      } catch {
        // The source already ended.
      }
      this.detachVoice(voice);
    });
    this.activeVoices.clear();
  }

  /** Number of live voices, for the verification gate. */
  public getActiveSourceCount(): number {
    return this.activeVoices.size;
  }

  public trigger(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    pitchOffset: number,
    _options?: VoiceTriggerOptions,
  ): void {
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    const noteFrequency = applyPitchOffset(params.baseFrequency, pitchOffset);
    osc.type = params.waveform;
    osc.frequency.setValueAtTime(noteFrequency, time);
    osc.detune.setValueAtTime(clamp(params.detune, -1200, 1200), time);

    filter.type = params.filter.type;
    filter.frequency.setValueAtTime(clamp(params.filter.cutoff, 20, 20000), time);
    filter.Q.setValueAtTime(clamp(params.filter.resonance, 0.1, 20), time);

    const safeVel = Math.max(MIN_GAIN, vel);
    const { attack, decay, sustain, release } = params.envelope;

    const attackEnd = time + Math.max(MIN_GAIN, attack);
    const decayEnd = attackEnd + decay;
    // Envelope guarantee: the gate never truncates the decay phase.
    const gateEnd = Math.max(time + NOMINAL_GATE_SECONDS, decayEnd);
    const releaseEnd = gateEnd + release;
    const sustainLevel = Math.max(MIN_GAIN, safeVel * sustain);

    gain.gain.setValueAtTime(MIN_GAIN, time);
    gain.gain.exponentialRampToValueAtTime(safeVel, attackEnd);
    gain.gain.exponentialRampToValueAtTime(sustainLevel, Math.max(attackEnd + MIN_GAIN, decayEnd));
    gain.gain.setValueAtTime(sustainLevel, gateEnd);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, releaseEnd);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    osc.start(time);
    const voice: SynthActiveVoice = { osc, filter, gain };
    this.activeVoices.add(voice);

    osc.onended = () => {
      this.activeVoices.delete(voice);
      this.detachVoice(voice);
    };
    try {
      osc.stop(releaseEnd + RELEASE_TAIL_SECONDS);
    } catch {
      // A source that already reached its stop time throws; drop the voice.
      this.activeVoices.delete(voice);
      this.detachVoice(voice);
    }
  }
}
