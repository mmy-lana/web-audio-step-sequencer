import { z } from 'zod';

/**
 * Validation layer — the lowest tier of the unidirectional dependency graph.
 * This module must never import from `@/types`, `@/lib/constants`, `@/lib/storage`,
 * `@/lib/audio`, `@/store`, `@/hooks` or `@/components`.
 */

/** Oscillator waveforms exposed by the synth engine. */
export const WaveformSchema = z.enum(['sine', 'square', 'sawtooth', 'triangle']);

/** Every voice the drum/synth dispatch table understands. */
export const InstrumentTypeSchema = z.enum([
  'kick',
  'snare',
  'hihat_closed',
  'hihat_open',
  'clap',
  'tom_low',
  'tom_high',
  'synth_lead',
]);

/** Hardware LED palette identifiers. Must stay in sync with `COLOR_MAP`. */
export const TrackColorSchema = z.enum([
  'amber',
  'crimson',
  'cyan',
  'emerald',
  'violet',
  'orange',
  'electric_blue',
  'lime',
]);

export const EnvelopeSettingsSchema = z.object({
  attack: z.number().min(0.001).max(2.0),
  decay: z.number().min(0.01).max(2.0),
  sustain: z.number().min(0.0).max(1.0),
  release: z.number().min(0.01).max(4.0),
});

export const FilterSettingsSchema = z.object({
  cutoff: z.number().min(20).max(20000),
  resonance: z.number().min(0.1).max(20.0),
  type: z.enum(['lowpass', 'highpass', 'bandpass', 'notch']),
});

export const SynthParamsSchema = z.object({
  waveform: WaveformSchema,
  detune: z.number().min(-1200).max(1200),
  envelope: EnvelopeSettingsSchema,
  filter: FilterSettingsSchema,
  pitchDecay: z.number().min(0.001).max(1.0).optional(),
  baseFrequency: z.number().min(20).max(2000),
});

export const StepSchema = z.object({
  index: z.number().int().min(0).max(31),
  active: z.boolean(),
  velocity: z.number().min(0.0).max(1.0),
  probability: z.number().min(0.0).max(1.0),
  pitchOffset: z.number().int().min(-24).max(24),
});

/** Step counts supported by the transport grid. */
export const StepCountSchema = z.union([z.literal(16), z.literal(32)]);

export const TrackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(30),
  instrument: InstrumentTypeSchema,
  color: TrackColorSchema,
  muted: z.boolean(),
  soloed: z.boolean(),
  volume: z.number().min(0.0).max(1.0),
  pan: z.number().min(-1.0).max(1.0),
  params: SynthParamsSchema,
  steps: z.array(StepSchema).min(16).max(32),
});

export const DelaySettingsSchema = z.object({
  time: z.number().min(0.01).max(1.0),
  feedback: z.number().min(0.0).max(0.95),
  wetDry: z.number().min(0.0).max(1.0),
});

export const DistortionSettingsSchema = z.object({
  drive: z.number().min(0.0).max(100.0),
  wetDry: z.number().min(0.0).max(1.0),
});

export const MasterFxSchema = z.object({
  filter: FilterSettingsSchema,
  delay: DelaySettingsSchema,
  distortion: DistortionSettingsSchema,
  masterVolume: z.number().min(0.0).max(1.2),
});

export const PatternSchema = z
  .object({
    schemaVersion: z.literal(1),
    slot: z.number().int().min(1).max(8),
    id: z.string().min(1),
    name: z.string().min(1).max(40),
    bpm: z.number().int().min(40).max(280),
    // Capped at 0.5 (3:1 swing ratio)
    swing: z.number().min(0.0).max(0.5),
    stepCount: StepCountSchema,
    tracks: z.array(TrackSchema).length(8),
    masterFx: MasterFxSchema,
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
  })
  .refine(
    (pat) => pat.tracks.every((track) => track.steps.length === pat.stepCount),
    { message: 'Every track steps array length must exactly match pattern stepCount' },
  )
  .refine(
    (pat) => pat.tracks.every((track) => track.steps.every((step, i) => step.index === i)),
    { message: 'Step indices must be contiguous and zero-based within each track' },
  )
  .refine((pat) => pat.updatedAt >= pat.createdAt, {
    message: 'updatedAt must not precede createdAt',
  });

export const MAX_IMPORT_SIZE_BYTES = 500 * 1024; // 500 KB limit

/**
 * UTF-8 aware byte measurement used by every size gate.
 * Falls back to a conservative UTF-16 estimate when `TextEncoder` is unavailable.
 */
export function measureUtf8ByteLength(input: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input).length;
  }
  let bytes = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) bytes += 4;
    else bytes += 3;
  }
  return bytes;
}

/** Human readable, single-line rendering of a Zod failure for UI banners. */
export function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function validatePatternJson(rawJson: string): z.infer<typeof PatternSchema> {
  if (rawJson.length > MAX_IMPORT_SIZE_BYTES) {
    throw new Error('Pattern file exceeds maximum allowed size (500 KB)');
  }
  if (measureUtf8ByteLength(rawJson) > MAX_IMPORT_SIZE_BYTES) {
    throw new Error('Pattern file exceeds maximum allowed size (500 KB)');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Malformed JSON payload');
  }
  const result = PatternSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Pattern schema violation -> ${formatValidationIssues(result.error)}`);
  }
  return result.data;
}
