import {
  DEFAULT_BPM,
  DEFAULT_STEP_COUNT,
  DEFAULT_SWING,
  MAX_BPM,
  MAX_STEP_COUNT,
  MAX_SWING,
  MIN_BPM,
  MIN_STEP_COUNT,
  MIN_SWING,
} from '@/lib/constants/defaultPatterns';
import type { StepCount } from '@/types/audio';

/**
 * Pure numeric helpers shared by the knob primitives, the transport, the
 * scheduler and the VU meters. No browser globals, no side effects — every
 * function here is safe to call during SSR.
 */

/** Clamps a finite number into an inclusive range. Non-finite input falls back to `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Clamps into the normalized 0..1 control range. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Clamps into the bipolar -1..1 pan range. */
export function clampBipolar(value: number): number {
  return clamp(value, -1, 1);
}

/** Linear interpolation. `t` is not clamped. */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/** Inverse of `lerp`; returns 0 when the range is degenerate. */
export function inverseLerp(start: number, end: number, value: number): number {
  if (end === start) return 0;
  return (value - start) / (end - start);
}

/** Rounds to a fixed number of decimal places without float drift. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const safeDecimals = clamp(Math.trunc(decimals), 0, 10);
  const factor = 10 ** safeDecimals;
  return Math.round(value * factor) / factor;
}

/** Quantizes a value to the nearest multiple of `step`. */
export function snapToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Guards a possibly-NaN knob readout before it reaches the store. */
export function sanitizeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Integer sanitation for the BPM control (§4.2 invariant). */
export function sanitizeBpm(value: number): number {
  return Math.round(clamp(sanitizeNumber(value, DEFAULT_BPM), MIN_BPM, MAX_BPM));
}

/** Integer sanitation for per-step pitch offsets. */
export function sanitizePitchOffset(value: number): number {
  return Math.round(clamp(sanitizeNumber(value, 0), -24, 24));
}

/** Swing sanitation, capped at a 3:1 ratio. */
export function sanitizeSwing(value: number): number {
  return roundTo(clamp(sanitizeNumber(value, DEFAULT_SWING), MIN_SWING, MAX_SWING), 4);
}

/** Mixer gain sanitation. */
export function sanitizeVolume(value: number): number {
  return roundTo(clamp01(sanitizeNumber(value, 0.8)), 4);
}

/** Stereo pan sanitation. */
export function sanitizePan(value: number): number {
  return roundTo(clampBipolar(sanitizeNumber(value, 0)), 4);
}

/** Master volume sanitation (schema ceiling is 1.2 for headroom). */
export function sanitizeMasterVolume(value: number): number {
  return roundTo(clamp(sanitizeNumber(value, 0.85), 0, 1.2), 4);
}

/**
 * Normalizes an arbitrary numeric step count onto a supported grid length.
 * Values at or above the midpoint snap up to a 32-step double bar; anything
 * below snaps down to a 16-step bar.
 */
export function sanitizeStepCount(value: number): StepCount {
  const rounded = Math.round(sanitizeNumber(value, MIN_STEP_COUNT));
  const midpoint = (MIN_STEP_COUNT + MAX_STEP_COUNT) / 2;
  return rounded >= midpoint ? MAX_STEP_COUNT : MIN_STEP_COUNT;
}

/** Converts a MIDI note number to frequency in Hz (A4 = 440 Hz). */
export function midiToFrequency(midiNote: number): number {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

/** Converts a frequency in Hz to the nearest MIDI note number. */
export function frequencyToMidi(frequency: number): number {
  if (!Number.isFinite(frequency) || frequency <= 0) return 0;
  return 69 + 12 * Math.log2(frequency / 440);
}

/** Frequency ratio for a semitone offset. */
export function semitonesToRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

/** Applies a semitone offset to a base frequency, floored at 20 Hz. */
export function applyPitchOffset(baseFrequency: number, semitones: number): number {
  return Math.max(20, baseFrequency * semitonesToRatio(semitones));
}

/** Decibels to linear amplitude. */
export function decibelsToGain(decibels: number): number {
  return 10 ** (decibels / 20);
}

/** Linear amplitude to decibels, floored at -120 dB for silence. */
export function gainToDecibels(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return -120;
  return 20 * Math.log10(gain);
}

/** Maps a linear value in `[min, max]` onto 0..1. */
export function normalizeLinear(value: number, min: number, max: number): number {
  return clamp01(inverseLerp(min, max, value));
}

/** Maps 0..1 back onto a linear `[min, max]` range. */
export function denormalizeLinear(normalized: number, min: number, max: number): number {
  return lerp(min, max, clamp01(normalized));
}

/**
 * Maps a value onto 0..1 using a logarithmic scale. Used by the filter cutoff
 * knob so 20 Hz..20 kHz sweeps musically.
 */
export function normalizeLog(value: number, min: number, max: number): number {
  if (min <= 0 || max <= 0 || max <= min) return 0;
  const safeValue = clamp(value, min, max);
  return clamp01(Math.log(safeValue / min) / Math.log(max / min));
}

/** Inverse of `normalizeLog`. */
export function denormalizeLog(normalized: number, min: number, max: number): number {
  if (min <= 0 || max <= 0 || max <= min) return min;
  return min * (max / min) ** clamp01(normalized);
}

/** Duration of one 16th note in seconds at the given tempo. */
export function secondsPerStep(bpm: number, stepsPerBeat: number = 4): number {
  const safeBpm = clamp(sanitizeNumber(bpm, DEFAULT_BPM), MIN_BPM, MAX_BPM);
  const safeStepsPerBeat = stepsPerBeat > 0 ? stepsPerBeat : 4;
  return 60 / safeBpm / safeStepsPerBeat;
}

/** Duration in seconds of a full pattern cycle. */
export function patternDurationSeconds(
  bpm: number,
  stepCount: StepCount = DEFAULT_STEP_COUNT,
): number {
  return secondsPerStep(bpm) * stepCount;
}

/**
 * Constant-pair swing interval for the step *leaving* `stepIndex`.
 * The even interval plus the following odd interval always equals
 * `2 * baseStepSeconds`, so the pair duration never drifts.
 */
export function computeSwingIntervalSeconds(
  baseStepSeconds: number,
  stepIndex: number,
  swing: number,
): number {
  const safeSwing = clamp(sanitizeNumber(swing, 0), MIN_SWING, MAX_SWING);
  const isEven = Math.abs(stepIndex) % 2 === 0;
  return isEven ? baseStepSeconds * (1 + safeSwing) : baseStepSeconds * (1 - safeSwing);
}

/**
 * Root-mean-square level of a time-domain analyser frame, in 0..1.
 * Returns 0 for empty or silent buffers.
 */
export function computeRmsLevel(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i];
    sum += sample * sample;
  }
  return Math.sqrt(sum / frame.length);
}

/**
 * Maps an RMS amplitude onto a 0..1 meter position using a decibel floor,
 * so quiet signals still register movement on the LED ladder.
 */
export function normalizeLevelToMeter(rms: number, floorDecibels: number = -60): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const decibels = gainToDecibels(rms);
  return clamp01(inverseLerp(floorDecibels, 0, decibels));
}

/** Peak absolute sample of a time-domain frame. */
export function computePeakLevel(frame: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < frame.length; i++) {
    const magnitude = Math.abs(frame[i]);
    if (magnitude > peak) peak = magnitude;
  }
  return clamp01(peak);
}

/** Formats a BPM value for a seven-segment readout. */
export function formatBpm(bpm: number): string {
  return String(sanitizeBpm(bpm)).padStart(3, '0');
}

/** Formats a semitone offset with an explicit sign, e.g. `+7` / `-12` / `0`. */
export function formatSignedSemitones(semitones: number): string {
  const value = sanitizePitchOffset(semitones);
  if (value > 0) return `+${value}`;
  return String(value);
}

/** Formats a 0..1 value as a whole-number percentage. */
export function formatPercent(value: number, decimals: number = 0): string {
  return `${roundTo(clamp01(value) * 100, decimals)}%`;
}

/** Compact frequency readout for the filter cutoff display. */
export function formatHertz(hertz: number): string {
  const value = clamp(sanitizeNumber(hertz, 20), 20, 20000);
  if (value >= 1000) return `${roundTo(value / 1000, 1)}k`;
  return `${Math.round(value)}`;
}

/** Compact delay-time readout in milliseconds. */
export function formatMilliseconds(seconds: number): string {
  const value = clamp(sanitizeNumber(seconds, 0.01), 0.001, 10);
  return `${Math.round(value * 1000)}ms`;
}

/** Renders a delay time as a note division label relative to the tempo. */
export function formatDelayDivision(seconds: number, bpm: number): string {
  const ratio = clamp(sanitizeNumber(seconds, 0.25) / secondsPerStep(bpm), 0.01, 64);
  return `1/${Math.max(1, Math.round(ratio * 4))}`;
}
