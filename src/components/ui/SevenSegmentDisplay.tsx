'use client';

import type { ReactElement } from 'react';

export type SevenSegmentSize = 'sm' | 'md' | 'lg';

export interface SevenSegmentDisplayProps {
  /** Text to render inside the window. Non-numeric values are shown verbatim. */
  value: string | number;
  /** Number of character cells; the value is padded and truncated to fit. */
  digits?: number;
  label?: string;
  /** Dims the readout when the transport is idle. */
  isActive?: boolean;
  size?: SevenSegmentSize;
  suffix?: string;
  className?: string;
}

const SIZE_CLASSES: Record<SevenSegmentSize, string> = {
  sm: 'text-sm tracking-[0.14em] px-1.5 py-0.5',
  md: 'text-xl tracking-[0.16em] px-2.5 py-1',
  lg: 'text-4xl tracking-[0.18em] px-4 py-2',
};

const LABEL_SIZE_CLASSES: Record<SevenSegmentSize, string> = {
  sm: 'text-[9px]',
  md: 'text-[10px]',
  lg: 'text-xs',
};

function normalizeReadout(value: string | number, digits: number): string {
  const text = String(value);
  if (text.length === digits) return text;
  if (text.length > digits) return text.slice(text.length - digits);
  return text.padStart(digits, ' ');
}

/**
 * Backlit seven-segment style readout.
 *
 * A ghost layer of fully-lit `8` characters sits behind the live value so the
 * unlit segments stay faintly visible, exactly like a real LED display.
 */
export function SevenSegmentDisplay({
  value,
  digits = 3,
  label,
  isActive = true,
  size = 'md',
  suffix,
  className = '',
}: SevenSegmentDisplayProps): ReactElement {
  const safeDigits = Math.max(1, Math.trunc(digits));
  const readout = normalizeReadout(value, safeDigits);
  const ghost = '8'.repeat(safeDigits);

  return (
    <div className={`inline-flex flex-col items-start gap-1 ${className}`}>
      {label !== undefined ? (
        <span className={`engraved-label font-hardware ${LABEL_SIZE_CLASSES[size]}`}>{label}</span>
      ) : null}
      <div
        className={`seven-seg-window relative inline-flex items-center overflow-hidden rounded ${SIZE_CLASSES[size]}`}
      >
        <span aria-hidden="true" className="seven-seg-ghost font-hardware font-bold tabular-nums">
          {ghost}
        </span>
        <span
          aria-hidden="true"
          className={`absolute inset-0 flex items-center font-hardware font-bold tabular-nums transition-opacity duration-200 ${SIZE_CLASSES[size]} ${
            isActive
              ? 'text-status-ok opacity-100 drop-shadow-[0_0_6px_rgba(0,255,102,0.55)]'
              : 'text-ink-faint opacity-70'
          }`}
        >
          {readout}
        </span>
        {suffix !== undefined ? (
          <span aria-hidden="true" className="ml-1 font-hardware text-[10px] text-ink-dim">
            {suffix}
          </span>
        ) : null}
      </div>
      <span className="sr-only">{`${label ?? 'Readout'}: ${String(value)}${suffix ?? ''}`}</span>
    </div>
  );
}
