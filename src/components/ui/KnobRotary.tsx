'use client';

import { useCallback } from 'react';
import type { ReactElement } from 'react';
import type { TrackColor } from '@/types/audio';
import { COLOR_MAP } from '@/lib/constants/colorMap';
import { clamp01, normalizeLinear, normalizeLog, roundTo } from '@/lib/utils/audioMath';
import { useRotaryDrag } from '@/hooks/useRotaryDrag';
import type { RotaryScale } from '@/hooks/useRotaryDrag';

export type KnobSize = 'sm' | 'md' | 'lg';

export interface KnobRotaryProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Invoked once when a drag or key interaction completes. */
  onCommit?: (value: number) => void;
  /** Restored on double-click / double-tap. */
  defaultValue?: number;
  size?: KnobSize;
  /** `log` gives musical sweeps for frequency and delay controls. */
  scale?: RotaryScale;
  step?: number;
  /** Overrides the auto-formatted readout under the knob. */
  displayValue?: string;
  unit?: string;
  accentColor?: TrackColor;
  disabled?: boolean;
  className?: string;
}

/** Outer box that owns the ring; never smaller than the 44px touch target. */
const BOX_PX: Record<KnobSize, number> = { sm: 44, md: 52, lg: 68 };
/** Diameter of the knurled cap sitting inside the ring. */
const CAP_PX: Record<KnobSize, number> = { sm: 30, md: 36, lg: 48 };
const LABEL_CLASSES: Record<KnobSize, string> = {
  sm: 'text-[8px]',
  md: 'text-[9px]',
  lg: 'text-[10px]',
};
const VALUE_CLASSES: Record<KnobSize, string> = {
  sm: 'text-[10px]',
  md: 'text-[11px]',
  lg: 'text-xs',
};

/** Ring geometry inside a 48x48 viewBox. */
const RING_RADIUS = 21;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** A real pot sweeps 270 degrees, leaving a gap at the bottom. */
const RING_ARC = RING_CIRCUMFERENCE * 0.75;
const RING_ROTATION = 135;

function formatValue(
  value: number,
  max: number,
  unit: string | undefined,
  displayValue: string | undefined,
): string {
  if (displayValue !== undefined) return displayValue;
  if (unit !== undefined) {
    return `${roundTo(value, Math.abs(value) < 10 ? 2 : 0)}${unit}`;
  }
  if (max <= 1.001) return `${Math.round(clamp01(value) * 100)}%`;
  return String(roundTo(value, 2));
}

/**
 * Pointer-capture rotary knob with a 270-degree LED ring.
 *
 * Drag vertically to change the value, hold Shift for fine control, use the
 * arrow keys for accessibility, and double-click to restore the default.
 */
export function KnobRotary({
  label,
  value,
  min,
  max,
  onChange,
  onCommit,
  defaultValue,
  size = 'md',
  scale = 'linear',
  step,
  displayValue,
  unit,
  accentColor,
  disabled = false,
  className = '',
}: KnobRotaryProps): ReactElement {
  const { isDragging, handlers } = useRotaryDrag({
    value,
    min,
    max,
    onChange,
    scale,
    step,
    disabled,
    onDragEnd: onCommit ? () => onCommit(value) : undefined,
  });

  const normalized =
    scale === 'log' ? normalizeLog(value, min, max) : normalizeLinear(value, min, max);
  const indicatorAngle = -135 + normalized * 270;
  const ringDash = `${RING_ARC * normalized} ${RING_CIRCUMFERENCE}`;
  const accent = accentColor ? COLOR_MAP[accentColor] : null;

  const handleDoubleClick = useCallback((): void => {
    if (disabled || defaultValue === undefined) return;
    if (defaultValue !== value) onChange(defaultValue);
    onCommit?.(defaultValue);
  }, [disabled, defaultValue, value, onChange, onCommit]);

  const readout = formatValue(value, max, unit, displayValue);

  return (
    <div className={`inline-flex select-none flex-col items-center gap-1 ${className}`}>
      <span className={`engraved-label font-hardware ${LABEL_CLASSES[size]}`}>{label}</span>

      <div
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={readout}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        {...handlers}
        onDoubleClick={handleDoubleClick}
        className={`relative flex touch-none items-center justify-center rounded-full outline-offset-4 ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-ns-resize'
        }`}
        style={{ width: BOX_PX[size], height: BOX_PX[size], touchAction: 'none' }}
      >
        <svg
          viewBox="0 0 48 48"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <circle
            cx="24"
            cy="24"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            className="text-chassis-border-strong"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${RING_ARC} ${RING_CIRCUMFERENCE}`}
            transform={`rotate(${RING_ROTATION} 24 24)`}
          />
          <circle
            cx="24"
            cy="24"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            className={accent ? accent.textActive : 'text-status-ok'}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={ringDash}
            transform={`rotate(${RING_ROTATION} 24 24)`}
            style={{ transition: isDragging ? 'none' : 'stroke-dasharray 120ms ease-out' }}
          />
        </svg>

        <div
          className={`knob-cap relative rounded-full transition-transform duration-100 ${
            isDragging ? 'scale-[0.98]' : 'scale-100'
          }`}
          style={{ width: CAP_PX[size], height: CAP_PX[size] }}
        >
          <div
            className="absolute bottom-1/2 left-1/2 h-[40%] w-[2px] origin-bottom -translate-x-1/2"
            style={{ transform: `translateX(-50%) rotate(${indicatorAngle}deg)` }}
          >
            <div className="knob-indicator h-full w-full rounded-full" />
          </div>
          <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/10 to-transparent" />
        </div>
      </div>

      <span
        className={`font-hardware tabular-nums ${VALUE_CLASSES[size]} ${
          disabled ? 'text-ink-faint' : 'text-ink-muted'
        }`}
      >
        {readout}
      </span>
    </div>
  );
}
