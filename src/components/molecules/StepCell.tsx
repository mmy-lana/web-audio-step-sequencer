'use client';

import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { Step, TrackColor } from '@/types/audio';
import { COLOR_MAP } from '@/lib/constants/colorMap';
import { registerStepElement } from '@/lib/utils/playheadRegistry';

export type StepCellSize = 'auto' | 'compact' | 'touch';

export interface StepCellProps {
  step: Step;
  trackColor: TrackColor;
  onToggle: () => void;
  onOpenEditor: () => void;
  /** In edit mode a tap opens the editor instead of toggling the step. */
  isEditMode?: boolean;
  size?: StepCellSize;
  /** Draws the heavier divider at the head of each beat group. */
  isBeatStart?: boolean;
  isSelected?: boolean;
  /** Dims the cell when its track is muted or soloed out. */
  isDimmed?: boolean;
}

/** Mobile keeps a >=44px target; desktop compresses the 8x16 grid. */
const SIZE_CLASSES: Record<StepCellSize, string> = {
  auto: 'h-11 w-11 md:h-8 md:w-8 xl:h-9 xl:w-9',
  compact: 'h-7 w-7',
  touch: 'h-12 w-12',
};

/** Pointer travel beyond this many pixels counts as a scroll, not a tap. */
const TAP_DISPLACEMENT_LIMIT_PX = 8;

/**
 * A single programmable step.
 *
 * Registers itself in the playhead registry so the RAF tracker can light the
 * cursor without re-rendering the grid, and only toggles on `pointerup` when the
 * pointer barely moved — which preserves drag-to-scroll on touch devices.
 */
export function StepCell({
  step,
  trackColor,
  onToggle,
  onOpenEditor,
  isEditMode = false,
  size = 'auto',
  isBeatStart = false,
  isSelected = false,
  isDimmed = false,
}: StepCellProps): ReactElement {
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);
  const definition = COLOR_MAP[trackColor];

  const registerRef = useCallback(
    (element: HTMLButtonElement | null): void => {
      if (element === null) {
        unregisterRef.current?.();
        unregisterRef.current = null;
        return;
      }
      unregisterRef.current = registerStepElement(step.index, element);
    },
    [step.index],
  );

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      if (start === null || start.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      // Anything beyond the limit was a scroll gesture.
      if (distance > TAP_DISPLACEMENT_LIMIT_PX) return;
      if (isEditMode) {
        onOpenEditor();
      } else {
        onToggle();
      }
    },
    [isEditMode, onOpenEditor, onToggle],
  );

  const handlePointerCancel = useCallback((): void => {
    pointerStartRef.current = null;
  }, []);

  const litClasses = `${definition.ledOn} ${definition.glowClass}`;
  const unlitClasses = `${definition.ledOff}`;
  const velocityOpacity = 0.45 + step.velocity * 0.55;
  const hasReducedProbability = step.probability < 1;
  const hasPitchOffset = step.pitchOffset !== 0;

  return (
    <button
      ref={registerRef}
      type="button"
      data-step-index={step.index}
      data-active={step.active ? 'true' : 'false'}
      aria-pressed={step.active}
      aria-label={`Step ${step.index + 1}, ${step.active ? 'active' : 'inactive'}, velocity ${Math.round(
        step.velocity * 100,
      )} percent${hasPitchOffset ? `, pitch ${step.pitchOffset} semitones` : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(event) => event.preventDefault()}
      className={`pad-face relative flex select-none flex-col items-center justify-center overflow-hidden rounded border transition-[background-color,border-color,box-shadow,transform] duration-75 ${SIZE_CLASSES[size]} ${
        step.active ? definition.borderActive : definition.borderInactive
      } ${isDimmed ? 'opacity-40' : ''} ${
        isSelected ? 'ring-2 ring-white/70' : ''
      } ${isBeatStart ? 'ml-1.5' : ''} data-[playhead=active]:brightness-150 data-[playhead=active]:ring-2 data-[playhead=active]:ring-white/85`}
      style={{ touchAction: 'manipulation' }}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-[3px] rounded-sm ${step.active ? litClasses : unlitClasses}`}
        style={step.active ? { opacity: velocityOpacity } : undefined}
      />

      {hasPitchOffset ? (
        <span
          aria-hidden="true"
          className="relative z-10 font-hardware text-[8px] font-bold leading-none text-black/80"
        >
          {step.pitchOffset > 0 ? `+${step.pitchOffset}` : step.pitchOffset}
        </span>
      ) : null}

      {hasReducedProbability ? (
        <span
          aria-hidden="true"
          className="absolute bottom-[3px] left-[3px] right-[3px] z-10 h-[2px] overflow-hidden rounded-full bg-black/45"
        >
          <span
            className="block h-full rounded-full bg-white/75"
            style={{ width: `${Math.round(step.probability * 100)}%` }}
          />
        </span>
      ) : null}
    </button>
  );
}
