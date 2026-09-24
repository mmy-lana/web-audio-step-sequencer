'use client';

import type { ReactElement } from 'react';
import type { TrackColor } from '@/types/audio';
import { COLOR_MAP } from '@/lib/constants/colorMap';

export type LedSize = 'xs' | 'sm' | 'md' | 'lg';
export type LedIntensity = 'low' | 'normal' | 'high';

export interface LedIndicatorProps {
  color: TrackColor;
  isOn: boolean;
  size?: LedSize;
  /** When provided the LED becomes a labelled image for screen readers. */
  label?: string;
  intensity?: LedIntensity;
  className?: string;
}

const SIZE_CLASSES: Record<LedSize, string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2.5 w-2.5',
  md: 'h-3.5 w-3.5',
  lg: 'h-5 w-5',
};

/** Opacity applied to the lit lens, producing the glow strength. */
const INTENSITY_CLASSES: Record<LedIntensity, string> = {
  low: 'opacity-70',
  normal: 'opacity-100',
  high: 'opacity-100',
};

/**
 * Static LED lens. Lit and unlit classes come from `COLOR_MAP`, so Tailwind v4
 * always sees literal utility strings — never an interpolated class name.
 */
export function LedIndicator({
  color,
  isOn,
  size = 'sm',
  label,
  intensity = 'normal',
  className = '',
}: LedIndicatorProps): ReactElement {
  const definition = COLOR_MAP[color];

  const stateClasses = isOn
    ? `${definition.ledOn} ${definition.glowClass} ${INTENSITY_CLASSES[intensity]}`
    : `${definition.ledOff} opacity-90`;

  return (
    <span
      className={`led-lens inline-block shrink-0 rounded-full border border-black/60 transition-[background-color,box-shadow,opacity] duration-150 ${SIZE_CLASSES[size]} ${stateClasses} ${className}`}
      {...(label !== undefined
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true as const })}
    />
  );
}
