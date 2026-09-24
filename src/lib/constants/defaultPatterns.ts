import type {
  InstrumentType,
  MasterFxSettings,
  Pattern,
  Step,
  StepCount,
  SynthParams,
  Track,
  TrackColor,
} from '@/types/audio';
import { TRACK_COLOR_ORDER } from '@/lib/constants/colorMap';
import { clampPatternSlot } from '@/lib/constants/storageKeys';

/**
 * Deterministic timestamps keep default patterns byte-identical across runs,
 * which makes the verification gate and slot round-trips reproducible.
 */
export const DETERMINISTIC_TIMESTAMP = 1700000000000;

/** Transport bounds, mirrored by the Zod schema invariants. */
export const MIN_BPM = 40;
export const MAX_BPM = 280;
export const DEFAULT_BPM = 120;
export const MIN_SWING = 0.0;
export const MAX_SWING = 0.5;
export const DEFAULT_SWING = 0.0;

/** Grid bounds. */
export const MIN_STEP_COUNT: StepCount = 16;
export const MAX_STEP_COUNT: StepCount = 32;
export const DEFAULT_STEP_COUNT: StepCount = 16;

/** Mixer defaults. */
export const DEFAULT_TRACK_VOLUME = 0.8;
export const DEFAULT_TRACK_PAN = 0.0;
export const DEFAULT_MASTER_VOLUME = 0.85;

/** One programmable step slot inside a default groove. */
export interface StepActivation {
  index: number;
  velocity?: number;
  probability?: number;
  pitchOffset?: number;
}

/** Static identity + voicing of the eight factory tracks. */
export interface TrackTemplate {
  instrument: InstrumentType;
  name: string;
  color: TrackColor;
  params: SynthParams;
}

export const TRACK_TEMPLATES: readonly TrackTemplate[] = [
  {
    instrument: 'kick',
    name: 'KICK',
    color: TRACK_COLOR_ORDER[0],
    params: {
      waveform: 'sine',
      detune: 0,
      baseFrequency: 55,
      pitchDecay: 0.08,
      envelope: { attack: 0.001, decay: 0.36, sustain: 0.0, release: 0.06 },
      filter: { type: 'lowpass', cutoff: 9000, resonance: 0.7 },
    },
  },
  {
    instrument: 'snare',
    name: 'SNARE',
    color: TRACK_COLOR_ORDER[1],
    params: {
      waveform: 'triangle',
      detune: 0,
      baseFrequency: 180,
      pitchDecay: 0.08,
      envelope: { attack: 0.001, decay: 0.22, sustain: 0.0, release: 0.08 },
      filter: { type: 'highpass', cutoff: 1200, resonance: 0.9 },
    },
  },
  {
    instrument: 'hihat_closed',
    name: 'HAT CLOSED',
    color: TRACK_COLOR_ORDER[2],
    params: {
      waveform: 'square',
      detune: 0,
      baseFrequency: 320,
      envelope: { attack: 0.001, decay: 0.05, sustain: 0.0, release: 0.02 },
      filter: { type: 'bandpass', cutoff: 8200, resonance: 1.4 },
    },
  },
  {
    instrument: 'hihat_open',
    name: 'HAT OPEN',
    color: TRACK_COLOR_ORDER[3],
    params: {
      waveform: 'square',
      detune: 0,
      baseFrequency: 300,
      envelope: { attack: 0.001, decay: 0.34, sustain: 0.0, release: 0.12 },
      filter: { type: 'bandpass', cutoff: 7200, resonance: 1.1 },
    },
  },
  {
    instrument: 'clap',
    name: 'CLAP',
    color: TRACK_COLOR_ORDER[4],
    params: {
      waveform: 'triangle',
      detune: 0,
      baseFrequency: 420,
      envelope: { attack: 0.001, decay: 0.28, sustain: 0.0, release: 0.1 },
      filter: { type: 'bandpass', cutoff: 1200, resonance: 2.5 },
    },
  },
  {
    instrument: 'tom_low',
    name: 'TOM LOW',
    color: TRACK_COLOR_ORDER[5],
    params: {
      waveform: 'sine',
      detune: 0,
      baseFrequency: 110,
      pitchDecay: 0.09,
      envelope: { attack: 0.001, decay: 0.42, sustain: 0.0, release: 0.08 },
      filter: { type: 'lowpass', cutoff: 4200, resonance: 0.8 },
    },
  },
  {
    instrument: 'tom_high',
    name: 'TOM HIGH',
    color: TRACK_COLOR_ORDER[6],
    params: {
      waveform: 'sine',
      detune: 0,
      baseFrequency: 165,
      pitchDecay: 0.08,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.07 },
      filter: { type: 'lowpass', cutoff: 5200, resonance: 0.8 },
    },
  },
  {
    instrument: 'synth_lead',
    name: 'LEAD SYNTH',
    color: TRACK_COLOR_ORDER[7],
    params: {
      waveform: 'sawtooth',
      detune: 6,
      baseFrequency: 261.63,
      envelope: { attack: 0.012, decay: 0.18, sustain: 0.35, release: 0.26 },
      filter: { type: 'lowpass', cutoff: 2400, resonance: 4.5 },
    },
  },
];

export const TRACK_COUNT = TRACK_TEMPLATES.length;

/** Factory master FX bus settings. */
export function createDefaultMasterFx(): MasterFxSettings {
  return {
    filter: { type: 'lowpass', cutoff: 18000, resonance: 0.7 },
    delay: { time: 0.25, feedback: 0.32, wetDry: 0.18 },
    distortion: { drive: 12, wetDry: 0.15 },
    masterVolume: DEFAULT_MASTER_VOLUME,
  };
}

/**
 * Builds a contiguous, zero-based step grid. Throws on duplicate or
 * out-of-range activations so authoring mistakes fail loudly at construction.
 */
export function createStepGrid(
  stepCount: StepCount,
  activations: readonly StepActivation[] = [],
): Step[] {
  const grid: Step[] = Array.from({ length: stepCount }, (_unused, index) => ({
    index,
    active: false,
    velocity: 0.8,
    probability: 1.0,
    pitchOffset: 0,
  }));

  const claimed = new Set<number>();
  for (const activation of activations) {
    const { index } = activation;
    if (!Number.isInteger(index) || index < 0 || index >= stepCount) {
      throw new RangeError(
        `Step activation index ${index} is outside the 0..${stepCount - 1} grid range`,
      );
    }
    if (claimed.has(index)) {
      throw new RangeError(`Step activation index ${index} declared more than once`);
    }
    claimed.add(index);

    const target = grid[index];
    target.active = true;
    if (activation.velocity !== undefined) {
      target.velocity = Math.min(1, Math.max(0, activation.velocity));
    }
    if (activation.probability !== undefined) {
      target.probability = Math.min(1, Math.max(0, activation.probability));
    }
    if (activation.pitchOffset !== undefined) {
      target.pitchOffset = Math.min(24, Math.max(-24, Math.round(activation.pitchOffset)));
    }
  }

  return grid;
}

/**
 * Resizes an existing grid, preserving per-step programming for overlapping
 * indices and always re-emitting contiguous zero-based indices.
 */
export function resizeStepGrid(steps: readonly Step[], stepCount: StepCount): Step[] {
  return Array.from({ length: stepCount }, (_unused, index) => {
    const existing = steps[index];
    if (!existing) {
      return { index, active: false, velocity: 0.8, probability: 1.0, pitchOffset: 0 };
    }
    return { ...existing, index };
  });
}

const BAR_16_GROOVE: Readonly<Record<InstrumentType, readonly StepActivation[]>> = {
  kick: [
    { index: 0, velocity: 1.0 },
    { index: 4, velocity: 0.9 },
    { index: 8, velocity: 1.0 },
    { index: 12, velocity: 0.9 },
  ],
  snare: [
    { index: 4, velocity: 0.85 },
    { index: 12, velocity: 0.85 },
  ],
  hihat_closed: [
    { index: 0, velocity: 0.55 },
    { index: 2, velocity: 0.45 },
    { index: 4, velocity: 0.55 },
    { index: 6, velocity: 0.45 },
    { index: 8, velocity: 0.55 },
    { index: 10, velocity: 0.45 },
    { index: 12, velocity: 0.55 },
    { index: 14, velocity: 0.45 },
  ],
  hihat_open: [
    { index: 6, velocity: 0.5 },
    { index: 14, velocity: 0.6 },
  ],
  clap: [
    { index: 4, velocity: 0.6 },
    { index: 12, velocity: 0.6 },
  ],
  tom_low: [
    { index: 7, velocity: 0.7 },
    { index: 15, velocity: 0.75 },
  ],
  tom_high: [
    { index: 3, velocity: 0.65 },
    { index: 11, velocity: 0.7 },
  ],
  synth_lead: [
    { index: 0, velocity: 0.8, pitchOffset: 0 },
    { index: 3, velocity: 0.7, pitchOffset: 7 },
    { index: 6, velocity: 0.75, pitchOffset: 12 },
    { index: 10, velocity: 0.7, pitchOffset: 3 },
    { index: 13, velocity: 0.65, pitchOffset: -5, probability: 0.85 },
  ],
};

/**
 * Off-grid second-bar fills, applied only in 32-step mode. Every index here is
 * deliberately disjoint from the shifted base bar so `createStepGrid` never
 * rejects a duplicate activation.
 */
const BAR_16_VARIATION: Readonly<Record<InstrumentType, readonly StepActivation[]>> = {
  kick: [
    { index: 22, velocity: 0.6, probability: 0.7 },
    { index: 26, velocity: 0.7 },
  ],
  snare: [
    { index: 22, velocity: 0.55, probability: 0.6 },
    { index: 26, velocity: 0.6, probability: 0.5 },
  ],
  hihat_closed: [
    { index: 21, velocity: 0.4 },
    { index: 25, velocity: 0.4 },
    { index: 29, velocity: 0.45 },
  ],
  hihat_open: [{ index: 31, velocity: 0.5 }],
  clap: [{ index: 21, velocity: 0.5, probability: 0.65 }],
  tom_low: [{ index: 25, velocity: 0.65 }],
  tom_high: [{ index: 21, velocity: 0.6 }],
  synth_lead: [
    { index: 18, velocity: 0.7, pitchOffset: 5 },
    { index: 24, velocity: 0.8, pitchOffset: 0 },
    { index: 31, velocity: 0.6, pitchOffset: 10, probability: 0.75 },
  ],
};

/** Merges the base bar (and its variation) into a full-length groove. */
function buildGroove(
  stepCount: StepCount,
): Readonly<Record<InstrumentType, readonly StepActivation[]>> {
  const instruments = Object.keys(BAR_16_GROOVE) as InstrumentType[];
  const groove = {} as Record<InstrumentType, readonly StepActivation[]>;

  for (const instrument of instruments) {
    const base = BAR_16_GROOVE[instrument];
    if (stepCount === 16) {
      groove[instrument] = base;
      continue;
    }
    const secondBar = base.map((activation) => ({
      ...activation,
      index: activation.index + 16,
    }));
    groove[instrument] = [...base, ...secondBar, ...BAR_16_VARIATION[instrument]];
  }

  return groove;
}

/** Builds one fully programmed factory track. */
export function createDefaultTrack(trackIndex: number, stepCount: StepCount): Track {
  const template = TRACK_TEMPLATES[trackIndex];
  if (!template) {
    throw new RangeError(`No factory track template registered for index ${trackIndex}`);
  }
  const groove = buildGroove(stepCount)[template.instrument];

  return {
    id: `track-${trackIndex + 1}-${template.instrument}`,
    name: template.name,
    instrument: template.instrument,
    color: template.color,
    muted: false,
    soloed: false,
    volume: DEFAULT_TRACK_VOLUME,
    pan: DEFAULT_TRACK_PAN,
    params: {
      ...template.params,
      envelope: { ...template.params.envelope },
      filter: { ...template.params.filter },
    },
    steps: createStepGrid(stepCount, groove),
  };
}

/**
 * Deterministic factory pattern. `slot` is clamped into 1..8 and `stepCount`
 * defaults to a 16-step bar.
 */
export function createDefaultPattern(slot: number = 1, stepCount: StepCount = DEFAULT_STEP_COUNT): Pattern {
  const resolvedSlot = clampPatternSlot(slot);
  const resolvedStepCount: StepCount = stepCount === 32 ? 32 : 16;

  return {
    schemaVersion: 1,
    slot: resolvedSlot,
    id: `pat-slot-${resolvedSlot}-${DETERMINISTIC_TIMESTAMP}`,
    name: `FACTORY PATTERN ${resolvedSlot}`,
    bpm: DEFAULT_BPM,
    swing: DEFAULT_SWING,
    stepCount: resolvedStepCount,
    tracks: Array.from({ length: TRACK_COUNT }, (_unused, index) =>
      createDefaultTrack(index, resolvedStepCount),
    ),
    masterFx: createDefaultMasterFx(),
    createdAt: DETERMINISTIC_TIMESTAMP,
    updatedAt: DETERMINISTIC_TIMESTAMP,
  };
}
