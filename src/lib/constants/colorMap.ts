import type { TrackColor } from '@/types/audio';

/**
 * Static Tailwind v4 utility lookups. Every class string is written literally so
 * the v4 source scanner emits it — dynamic interpolation such as
 * `shadow-led-${color}` is forbidden.
 */
export interface ColorDefinition {
  ledOn: string;
  ledOff: string;
  borderActive: string;
  borderInactive: string;
  textActive: string;
  textInactive: string;
  glowClass: string;
}

export const COLOR_MAP: Record<TrackColor, ColorDefinition> = {
  amber: {
    ledOn: 'bg-[#ffb703]',
    ledOff: 'bg-[#402d00]',
    borderActive: 'border-[#ffb703]',
    borderInactive: 'border-[#402d00]',
    textActive: 'text-[#ffb703]',
    textInactive: 'text-[#805b00]',
    glowClass: 'shadow-[0_0_8px_#ffb703,0_0_14px_rgba(255,183,3,0.5)]',
  },
  crimson: {
    ledOn: 'bg-[#ff0055]',
    ledOff: 'bg-[#400015]',
    borderActive: 'border-[#ff0055]',
    borderInactive: 'border-[#400015]',
    textActive: 'text-[#ff0055]',
    textInactive: 'text-[#80002b]',
    glowClass: 'shadow-[0_0_8px_#ff0055,0_0_14px_rgba(255,0,85,0.5)]',
  },
  cyan: {
    ledOn: 'bg-[#00f0ff]',
    ledOff: 'bg-[#003c40]',
    borderActive: 'border-[#00f0ff]',
    borderInactive: 'border-[#003c40]',
    textActive: 'text-[#00f0ff]',
    textInactive: 'text-[#007880]',
    glowClass: 'shadow-[0_0_8px_#00f0ff,0_0_14px_rgba(0,240,255,0.5)]',
  },
  emerald: {
    ledOn: 'bg-[#00ff66]',
    ledOff: 'bg-[#00401a]',
    borderActive: 'border-[#00ff66]',
    borderInactive: 'border-[#00401a]',
    textActive: 'text-[#00ff66]',
    textInactive: 'text-[#008033]',
    glowClass: 'shadow-[0_0_8px_#00ff66,0_0_14px_rgba(0,255,102,0.5)]',
  },
  violet: {
    ledOn: 'bg-[#b5179e]',
    ledOff: 'bg-[#370030]',
    borderActive: 'border-[#b5179e]',
    borderInactive: 'border-[#370030]',
    textActive: 'text-[#b5179e]',
    textInactive: 'text-[#6d0e5f]',
    glowClass: 'shadow-[0_0_8px_#b5179e,0_0_14px_rgba(181,23,158,0.5)]',
  },
  orange: {
    ledOn: 'bg-[#f77f00]',
    ledOff: 'bg-[#472400]',
    borderActive: 'border-[#f77f00]',
    borderInactive: 'border-[#472400]',
    textActive: 'text-[#f77f00]',
    textInactive: 'text-[#8f4900]',
    glowClass: 'shadow-[0_0_8px_#f77f00,0_0_14px_rgba(247,127,0,0.5)]',
  },
  electric_blue: {
    ledOn: 'bg-[#4361ee]',
    ledOff: 'bg-[#0e163b]',
    borderActive: 'border-[#4361ee]',
    borderInactive: 'border-[#0e163b]',
    textActive: 'text-[#4361ee]',
    textInactive: 'text-[#203496]',
    glowClass: 'shadow-[0_0_8px_#4361ee,0_0_14px_rgba(67,97,238,0.5)]',
  },
  lime: {
    ledOn: 'bg-[#ccff00]',
    ledOff: 'bg-[#334000]',
    borderActive: 'border-[#ccff00]',
    borderInactive: 'border-[#334000]',
    textActive: 'text-[#ccff00]',
    textInactive: 'text-[#668000]',
    glowClass: 'shadow-[0_0_8px_#ccff00,0_0_14px_rgba(204,255,0,0.5)]',
  },
};

/** Canonical palette order, used for deterministic default track/pad assignment. */
export const TRACK_COLOR_ORDER: readonly TrackColor[] = [
  'amber',
  'crimson',
  'cyan',
  'emerald',
  'violet',
  'orange',
  'electric_blue',
  'lime',
];

/** Total number of distinct hardware LED colors. */
export const TRACK_COLOR_COUNT = TRACK_COLOR_ORDER.length;

/** Safe lookup that never returns `undefined` for a well-typed color key. */
export function getColorDefinition(color: TrackColor): ColorDefinition {
  return COLOR_MAP[color];
}

/** Wraps the palette for index-driven assignment (track headers, pad grids). */
export function getColorByIndex(index: number): TrackColor {
  const normalized = ((Math.trunc(index) % TRACK_COLOR_COUNT) + TRACK_COLOR_COUNT) % TRACK_COLOR_COUNT;
  return TRACK_COLOR_ORDER[normalized];
}
