'use client';

import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  clamp01,
  denormalizeLinear,
  denormalizeLog,
  normalizeLinear,
  normalizeLog,
  roundTo,
} from '@/lib/utils/audioMath';

/** Control law applied between pointer travel and value change. */
export type RotaryScale = 'linear' | 'log';

export interface UseRotaryDragOptions {
  /** Current value; read at pointer-down to anchor the drag. */
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  scale?: RotaryScale;
  /** Vertical travel in pixels required to sweep the full range. */
  travelPx?: number;
  /** Quantization applied to every emitted value. */
  step?: number;
  disabled?: boolean;
  /** Multiplier applied while Shift is held, for fine adjustment. */
  fineFactor?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export interface UseRotaryDragResult {
  isDragging: boolean;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  };
}

const DEFAULT_TRAVEL_PX = 180;
const DEFAULT_FINE_FACTOR = 0.2;

function decimalsForStep(step: number): number {
  if (step >= 1) return 0;
  const fraction = String(step).split('.')[1];
  return Math.min(6, fraction?.length ?? 0);
}

/**
 * Pointer-capture rotary drag engine.
 *
 * Values are tracked in normalized 0..1 space so logarithmic controls (filter
 * cutoff, delay time) sweep musically. The host element must declare
 * `touch-action: none` so vertical drags are not stolen by page scroll.
 */
export function useRotaryDrag({
  value,
  min,
  max,
  onChange,
  scale = 'linear',
  travelPx = DEFAULT_TRAVEL_PX,
  step,
  disabled = false,
  fineFactor = DEFAULT_FINE_FACTOR,
  onDragStart,
  onDragEnd,
}: UseRotaryDragOptions): UseRotaryDragResult {
  const [isDragging, setIsDragging] = useState(false);
  const activePointerIdRef = useRef<number | null>(null);
  const startClientYRef = useRef(0);
  const startNormalizedRef = useRef(0);

  const toNormalized = useCallback(
    (raw: number): number =>
      scale === 'log' ? normalizeLog(raw, min, max) : normalizeLinear(raw, min, max),
    [scale, min, max],
  );

  const fromNormalized = useCallback(
    (normalized: number): number => {
      const clamped = clamp01(normalized);
      const raw =
        scale === 'log' ? denormalizeLog(clamped, min, max) : denormalizeLinear(clamped, min, max);
      if (step !== undefined && step > 0) {
        const snapped = Math.round(raw / step) * step;
        return roundTo(Math.min(max, Math.max(min, snapped)), decimalsForStep(step));
      }
      return raw;
    },
    [scale, min, max, step],
  );

  const emit = useCallback(
    (normalized: number): void => {
      const next = fromNormalized(normalized);
      if (next !== value) onChange(next);
    },
    [fromNormalized, onChange, value],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (disabled) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      activePointerIdRef.current = event.pointerId;
      startClientYRef.current = event.clientY;
      startNormalizedRef.current = toNormalized(value);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; the drag still tracks while hovering.
      }
      setIsDragging(true);
      onDragStart?.();
    },
    [disabled, toNormalized, value, onDragStart],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (activePointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      const deltaPx = startClientYRef.current - event.clientY;
      const modifier = event.shiftKey ? fineFactor : 1;
      emit(startNormalizedRef.current + (deltaPx / travelPx) * modifier);
    },
    [emit, travelPx, fineFactor],
  );

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (activePointerIdRef.current !== event.pointerId) return;
      activePointerIdRef.current = null;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // The browser already released capture.
      }
      setIsDragging(false);
      onDragEnd?.();
    },
    [onDragEnd],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>): void => {
      if (disabled) return;
      const keyboardStep = step !== undefined && step > 0 ? step : (max - min) / 100;
      const pageStep = keyboardStep * 10;
      let candidate: number;

      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          candidate = value + keyboardStep;
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          candidate = value - keyboardStep;
          break;
        case 'PageUp':
          candidate = value + pageStep;
          break;
        case 'PageDown':
          candidate = value - pageStep;
          break;
        case 'Home':
          candidate = min;
          break;
        case 'End':
          candidate = max;
          break;
        default:
          return;
      }

      event.preventDefault();
      const clamped = Math.min(max, Math.max(min, candidate));
      const quantized =
        step !== undefined && step > 0
          ? roundTo(Math.round(clamped / step) * step, decimalsForStep(step))
          : clamped;
      const bounded = Math.min(max, Math.max(min, quantized));
      if (bounded !== value) onChange(bounded);
    },
    [disabled, step, max, min, value, onChange],
  );

  return {
    isDragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onKeyDown,
    },
  };
}
