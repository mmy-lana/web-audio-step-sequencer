'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { SoundboardPad } from '@/types/audio';
import { COLOR_MAP } from '@/lib/constants/colorMap';
import { LedIndicator } from '@/components/ui/LedIndicator';

export interface SoundboardTriggerPadProps {
  pad: SoundboardPad;
  onTrigger: () => void;
  /** Bump to flash the pad from outside (keyboard binding, MIDI-style input). */
  flashToken?: number;
  className?: string;
}

/** How long the pad stays lit after a hit, in milliseconds. */
const FLASH_DURATION_MS = 220;

/**
 * Velocity-free performance pad.
 *
 * Fires on `pointerdown` for the lowest possible latency, suppresses the context
 * menu and text selection, and keeps a >=72px touch target. Flash state is local
 * UI state — it never touches the store or the audio graph.
 */
export function SoundboardTriggerPad({
  pad,
  onTrigger,
  flashToken,
  className = '',
}: SoundboardTriggerPadProps): ReactElement {
  const [flashKey, setFlashKey] = useState(0);
  const [isLit, setIsLit] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const lastTokenRef = useRef(flashToken);
  const definition = COLOR_MAP[pad.color];

  const clearTimer = useCallback((): void => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const flash = useCallback((): void => {
    setFlashKey((previous) => previous + 1);
    setIsLit(true);
    clearTimer();
    timeoutRef.current = window.setTimeout(() => {
      setIsLit(false);
      timeoutRef.current = null;
    }, FLASH_DURATION_MS);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (flashToken === undefined || flashToken === lastTokenRef.current) return;
    lastTokenRef.current = flashToken;
    flash();
  }, [flashToken, flash]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      flash();
      onTrigger();
    },
    [flash, onTrigger],
  );

  // A click with detail 0 is keyboard-generated (Enter/Space on a button).
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>): void => {
      if (event.detail !== 0) return;
      flash();
      onTrigger();
    },
    [flash, onTrigger],
  );

  return (
    <button
      type="button"
      data-pad-id={pad.id}
      aria-label={`Trigger ${pad.label} pad, key ${pad.keyBinding.toUpperCase()}`}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onContextMenu={(event) => event.preventDefault()}
      className={`pad-face relative flex min-h-[72px] select-none flex-col justify-between overflow-hidden rounded-lg border p-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-75 ${
        isLit
          ? `${definition.borderActive} bg-chassis-raised ${definition.glowClass}`
          : 'border-chassis-border bg-chassis-sunken hover:border-chassis-border-strong'
      } active:translate-y-px active:shadow-control-pressed ${className}`}
      style={{ userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation' }}
    >
      {flashKey > 0 ? (
        <span
          key={flashKey}
          aria-hidden="true"
          className={`animate-pad-flash pointer-events-none absolute inset-0 rounded-lg ${definition.ledOn}`}
        />
      ) : null}

      <span className="relative z-10 flex items-start justify-between gap-1">
        <LedIndicator
          color={pad.color}
          isOn={isLit}
          size="sm"
          intensity={isLit ? 'high' : 'low'}
          label={`${pad.label} ${isLit ? 'firing' : 'idle'}`}
        />
        <span className="chassis-sunken rounded px-1 py-0.5 font-hardware text-[9px] font-bold text-ink-muted">
          {pad.keyBinding.toUpperCase()}
        </span>
      </span>

      <span
        className={`relative z-10 font-hardware text-[10px] font-bold uppercase leading-tight tracking-wider ${
          isLit ? definition.textActive : 'text-ink-muted'
        }`}
      >
        {pad.label}
      </span>
    </button>
  );
}
