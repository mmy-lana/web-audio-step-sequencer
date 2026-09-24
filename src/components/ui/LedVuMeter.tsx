'use client';

import type { ReactElement } from 'react';
import { clamp01, normalizeVuSegments } from '@/lib/utils/audioMath';

export type VuMeterOrientation = 'vertical' | 'horizontal';

export interface LedVuMeterProps {
  /** Current level in the normalized 0..1 range. */
  level: number;
  /** Number of LED rungs in the ladder. */
  segments?: number;
  orientation?: VuMeterOrientation;
  label?: string;
  /** Optional peak-hold marker, also 0..1. */
  peakLevel?: number;
  /** Renders L/R scale captions next to the ladder. */
  showScale?: boolean;
  className?: string;
}

/** Rung tones, resolved by normalized position so the ladder reads like hardware. */
const TONE_CLASSES = {
  low: 'bg-[#00ff66] shadow-[0_0_6px_rgba(0,255,102,0.55)]',
  mid: 'bg-[#ffb703] shadow-[0_0_6px_rgba(255,183,3,0.55)]',
  high: 'bg-[#ff0055] shadow-[0_0_6px_rgba(255,0,85,0.55)]',
} as const;

const TONE_OFF_CLASS = 'bg-[#1b1f27]';

/** Position thresholds: the top of the ladder turns amber then red. */
const MID_THRESHOLD = 0.62;
const HIGH_THRESHOLD = 0.85;

type Tone = keyof typeof TONE_CLASSES;

function toneForPosition(position: number): Tone {
  if (position >= HIGH_THRESHOLD) return 'high';
  if (position >= MID_THRESHOLD) return 'mid';
  return 'low';
}

const RUNG_SIZE_CLASSES: Record<VuMeterOrientation, string> = {
  vertical: 'h-1.5 w-full',
  horizontal: 'h-full w-1.5',
};

const LADDER_SIZE_CLASSES: Record<VuMeterOrientation, string> = {
  vertical: 'flex-col-reverse gap-0.5 p-1',
  horizontal: 'flex-row gap-0.5 p-1',
};

/**
 * Segmented LED VU ladder. Rung 0 is always the quietest step, so the ladder
 * fills bottom-up when vertical and left-to-right when horizontal.
 */
export function LedVuMeter({
  level,
  segments = 12,
  orientation = 'vertical',
  label,
  peakLevel,
  showScale = false,
  className = '',
}: LedVuMeterProps): ReactElement {
  const safeSegments = normalizeVuSegments(segments);
  const clampedLevel = clamp01(level);
  const litCount = Math.round(clampedLevel * safeSegments);
  const peakIndex =
    peakLevel === undefined ? -1 : Math.min(safeSegments - 1, Math.round(clamp01(peakLevel) * safeSegments) - 1);

  const rungs = Array.from({ length: safeSegments }, (_unused, index) => {
    const position = (index + 0.5) / safeSegments;
    const tone = toneForPosition(position);
    const isLit = index < litCount;
    const isPeak = index === peakIndex;
    return (
      <span
        key={index}
        className={`block rounded-[1px] transition-colors duration-75 ${RUNG_SIZE_CLASSES[orientation]} ${
          isLit ? TONE_CLASSES[tone] : TONE_OFF_CLASS
        } ${isPeak ? 'ring-1 ring-white/70' : ''}`}
      />
    );
  });

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
      {label !== undefined ? (
        <span className="engraved-label font-hardware text-[8px]">{label}</span>
      ) : null}
      <div className="flex items-stretch gap-1">
        <div
          aria-hidden="true"
          className={`chassis-sunken flex ${LADDER_SIZE_CLASSES[orientation]} ${
            orientation === 'vertical' ? 'h-full min-h-[64px] w-3' : 'h-3 min-w-[64px]'
          }`}
        >
          {rungs}
        </div>
        {showScale ? (
          <div
            aria-hidden="true"
            className={`flex justify-between font-hardware text-[8px] text-ink-faint ${
              orientation === 'vertical' ? 'flex-col' : 'flex-row items-center'
            }`}
          >
            <span>0</span>
            <span>-12</span>
            <span>0dB</span>
          </div>
        ) : null}
      </div>
      <span className="sr-only">{`${label ?? 'Level'}: ${Math.round(clampedLevel * 100)} percent`}</span>
    </div>
  );
}
