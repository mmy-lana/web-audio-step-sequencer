import type { SoundboardPad } from '@/types/audio';

/**
 * Factory soundboard bank: 16 pads laid out as a 4x4 grid.
 * Row 1 -> 1 2 3 4 | Row 2 -> Q W E R | Row 3 -> A S D F | Row 4 -> Z X C V
 *
 * Templates are frozen source data. Callers receive deep copies through
 * `createSoundboardPads()` so per-pad flash state never mutates this module.
 */
export const SOUNDBOARD_GRID_COLUMNS = 4;
export const SOUNDBOARD_GRID_ROWS = 4;
export const SOUNDBOARD_PAD_COUNT = SOUNDBOARD_GRID_COLUMNS * SOUNDBOARD_GRID_ROWS;

export const SOUNDBOARD_PRESET_TEMPLATES: readonly SoundboardPad[] = [
  {
    id: 'pad-01-kick-deep',
    label: 'KICK DEEP',
    keyBinding: '1',
    instrument: 'kick',
    color: 'amber',
    params: {
      waveform: 'sine',
      detune: 0,
      baseFrequency: 45,
      pitchDecay: 0.12,
      envelope: { attack: 0.001, decay: 0.55, sustain: 0.0, release: 0.08 },
      filter: { type: 'lowpass', cutoff: 6000, resonance: 0.7 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-02-kick-punch',
    label: 'KICK PUNCH',
    keyBinding: '2',
    instrument: 'kick',
    color: 'amber',
    params: {
      waveform: 'sine',
      detune: 0,
      baseFrequency: 62,
      pitchDecay: 0.045,
      envelope: { attack: 0.001, decay: 0.24, sustain: 0.0, release: 0.05 },
      filter: { type: 'lowpass', cutoff: 9000, resonance: 0.9 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-03-snare-tight',
    label: 'SNARE TIGHT',
    keyBinding: '3',
    instrument: 'snare',
    color: 'crimson',
    params: {
      waveform: 'triangle',
      detune: 0,
      baseFrequency: 200,
      pitchDecay: 0.06,
      envelope: { attack: 0.001, decay: 0.16, sustain: 0.0, release: 0.06 },
      filter: { type: 'highpass', cutoff: 1500, resonance: 0.9 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-04-snare-fat',
    label: 'SNARE FAT',
    keyBinding: '4',
    instrument: 'snare',
    color: 'crimson',
    params: {
      waveform: 'triangle',
      detune: 0,
      baseFrequency: 160,
      pitchDecay: 0.1,
      envelope: { attack: 0.001, decay: 0.36, sustain: 0.0, release: 0.12 },
      filter: { type: 'highpass', cutoff: 900, resonance: 0.8 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-05-hat-closed',
    label: 'HAT CLOSED',
    keyBinding: 'q',
    instrument: 'hihat_closed',
    color: 'cyan',
    params: {
      waveform: 'square',
      detune: 0,
      baseFrequency: 320,
      envelope: { attack: 0.001, decay: 0.04, sustain: 0.0, release: 0.02 },
      filter: { type: 'bandpass', cutoff: 9000, resonance: 1.6 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-06-hat-open',
    label: 'HAT OPEN',
    keyBinding: 'w',
    instrument: 'hihat_open',
    color: 'emerald',
    params: {
      waveform: 'square',
      detune: 0,
      baseFrequency: 300,
      envelope: { attack: 0.001, decay: 0.45, sustain: 0.0, release: 0.14 },
      filter: { type: 'bandpass', cutoff: 7600, resonance: 1.0 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-07-clap-classic',
    label: 'CLAP CLASSIC',
    keyBinding: 'e',
    instrument: 'clap',
    color: 'violet',
    params: {
      waveform: 'triangle',
      detune: 0,
      baseFrequency: 420,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.1 },
      filter: { type: 'bandpass', cutoff: 1200, resonance: 2.5 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-08-clap-snap',
    label: 'CLAP SNAP',
    keyBinding: 'r',
    instrument: 'clap',
    color: 'violet',
    params: {
      waveform: 'triangle',
      detune: 0,
      baseFrequency: 520,
      envelope: { attack: 0.001, decay: 0.14, sustain: 0.0, release: 0.06 },
      filter: { type: 'bandpass', cutoff: 1600, resonance: 3.2 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-09-tom-low',
    label: 'TOM LOW',
    keyBinding: 'a',
    instrument: 'tom_low',
    color: 'orange',
    params: {
      waveform: 'sine',
      detune: 0,
      baseFrequency: 98,
      pitchDecay: 0.1,
      envelope: { attack: 0.001, decay: 0.5, sustain: 0.0, release: 0.1 },
      filter: { type: 'lowpass', cutoff: 3800, resonance: 0.8 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-10-tom-high',
    label: 'TOM HIGH',
    keyBinding: 's',
    instrument: 'tom_high',
    color: 'electric_blue',
    params: {
      waveform: 'sine',
      detune: 0,
      baseFrequency: 180,
      pitchDecay: 0.08,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0.0, release: 0.08 },
      filter: { type: 'lowpass', cutoff: 5200, resonance: 0.8 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-11-zap-lead',
    label: 'ZAP LEAD',
    keyBinding: 'd',
    instrument: 'synth_lead',
    color: 'lime',
    params: {
      waveform: 'sawtooth',
      detune: 8,
      baseFrequency: 220,
      envelope: { attack: 0.004, decay: 0.22, sustain: 0.25, release: 0.18 },
      filter: { type: 'lowpass', cutoff: 1800, resonance: 6.0 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-12-bass-stab',
    label: 'BASS STAB',
    keyBinding: 'f',
    instrument: 'synth_lead',
    color: 'lime',
    params: {
      waveform: 'square',
      detune: -6,
      baseFrequency: 55,
      envelope: { attack: 0.002, decay: 0.3, sustain: 0.2, release: 0.14 },
      filter: { type: 'lowpass', cutoff: 900, resonance: 2.2 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-13-laser',
    label: 'LASER',
    keyBinding: 'z',
    instrument: 'synth_lead',
    color: 'cyan',
    params: {
      waveform: 'square',
      detune: 14,
      baseFrequency: 880,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0.15, release: 0.1 },
      filter: { type: 'bandpass', cutoff: 3200, resonance: 7.5 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-14-chime',
    label: 'CHIME',
    keyBinding: 'x',
    instrument: 'synth_lead',
    color: 'violet',
    params: {
      waveform: 'sine',
      detune: 0,
      baseFrequency: 523.25,
      envelope: { attack: 0.005, decay: 0.9, sustain: 0.1, release: 0.8 },
      filter: { type: 'lowpass', cutoff: 6000, resonance: 1.0 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-15-sub-boom',
    label: 'SUB BOOM',
    keyBinding: 'c',
    instrument: 'kick',
    color: 'amber',
    params: {
      waveform: 'sine',
      detune: 0,
      baseFrequency: 38,
      pitchDecay: 0.22,
      envelope: { attack: 0.001, decay: 0.95, sustain: 0.0, release: 0.2 },
      filter: { type: 'lowpass', cutoff: 2400, resonance: 0.6 },
    },
    lastTriggeredAt: null,
  },
  {
    id: 'pad-16-rim-click',
    label: 'RIM CLICK',
    keyBinding: 'v',
    instrument: 'snare',
    color: 'crimson',
    params: {
      waveform: 'triangle',
      detune: 0,
      baseFrequency: 320,
      pitchDecay: 0.02,
      envelope: { attack: 0.001, decay: 0.07, sustain: 0.0, release: 0.04 },
      filter: { type: 'highpass', cutoff: 2400, resonance: 1.2 },
    },
    lastTriggeredAt: null,
  },
];

/** Deep copy of the factory bank, safe for per-pad mutable flash state. */
export function createSoundboardPads(): SoundboardPad[] {
  return SOUNDBOARD_PRESET_TEMPLATES.map((pad) => ({
    ...pad,
    params: {
      ...pad.params,
      envelope: { ...pad.params.envelope },
      filter: { ...pad.params.filter },
    },
  }));
}

/** Uppercase key bindings in grid order, used for the keyboard listener map. */
export const SOUNDBOARD_KEY_BINDINGS: readonly string[] = SOUNDBOARD_PRESET_TEMPLATES.map((pad) =>
  pad.keyBinding.toUpperCase(),
);

/**
 * Resolves a normalized keyboard event key to its pad.
 * Returns `null` for unbound keys so the global listener can ignore them.
 */
export function getSoundboardPadByKey(key: string): SoundboardPad | null {
  const normalized = key.trim().toUpperCase();
  if (normalized.length === 0) return null;
  return SOUNDBOARD_PRESET_TEMPLATES.find((pad) => pad.keyBinding.toUpperCase() === normalized) ?? null;
}

/** Index-based pad lookup for grid rendering. */
export function getSoundboardPadByIndex(index: number): SoundboardPad | null {
  if (!Number.isInteger(index) || index < 0 || index >= SOUNDBOARD_PRESET_TEMPLATES.length) {
    return null;
  }
  return SOUNDBOARD_PRESET_TEMPLATES[index];
}
