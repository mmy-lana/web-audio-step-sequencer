'use client';

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { ChassisScrew } from '@/components/ui/ChassisScrew';
import { LedIndicator } from '@/components/ui/LedIndicator';
import { MechanicalSwitch } from '@/components/ui/MechanicalSwitch';
import { SevenSegmentDisplay } from '@/components/ui/SevenSegmentDisplay';

export interface PowerOnOverlayProps {
  /** Read from `useAudioEngine()`, never from the raw singleton during render. */
  isInitialized: boolean;
  /** Must construct the AudioContext synchronously inside the click handler. */
  onPowerOn: () => Promise<void>;
  patternName?: string;
  bpm?: number;
}

/**
 * Vintage POWER ON gate.
 *
 * Browsers — iOS Safari in particular — only unlock audio from a real user
 * gesture. This overlay covers the instrument until the audio graph exists, and
 * its click handler calls `onPowerOn()` synchronously, which constructs the
 * `AudioContext` and invokes `resume()` before the first `await`.
 */
export function PowerOnOverlay({
  isInitialized,
  onPowerOn,
  patternName,
  bpm,
}: PowerOnOverlayProps): ReactElement | null {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback((): void => {
    if (isStarting) return;
    setIsStarting(true);
    setError(null);
    // The engine's init() body runs synchronously up to its first await, so the
    // AudioContext is created inside this gesture.
    void onPowerOn()
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Audio could not be started. Check the browser audio permissions.',
        );
      })
      .finally(() => {
        setIsStarting(false);
      });
  }, [isStarting, onPowerOn]);

  if (isInitialized) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Power on the instrument"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-chassis-bg/97 p-4 backdrop-blur-md"
    >
      <div className="chassis-panel relative w-full max-w-md p-6 text-center sm:p-8">
        <ChassisScrew size="lg" angle={22} className="absolute left-3 top-3" />
        <ChassisScrew size="lg" angle={-36} className="absolute right-3 top-3" />
        <ChassisScrew size="lg" angle={68} className="absolute bottom-3 left-3" />
        <ChassisScrew size="lg" angle={-12} className="absolute bottom-3 right-3" />

        <p className="engraved-label font-hardware text-[10px]">w-audio</p>
        <h1 className="mt-1 font-hardware text-2xl font-bold tracking-[0.28em] text-ink">
          MODEL-16
        </h1>
        <p className="engraved-label mt-2 font-hardware text-[10px]">
          step sequencer &amp; soundboard
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <SevenSegmentDisplay
            label="Pattern"
            value={bpm ?? 120}
            digits={3}
            isActive={false}
            size="md"
            suffix="BPM"
          />
        </div>

        <p className="mt-4 font-hardware text-[11px] leading-relaxed text-ink-muted">
          {patternName ?? 'FACTORY PATTERN 1'}
        </p>

        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <LedIndicator
              color={isStarting ? 'amber' : 'crimson'}
              isOn
              size="lg"
              intensity="high"
              label={isStarting ? 'Starting audio' : 'Audio suspended'}
            />
            <MechanicalSwitch
              isOn={isStarting}
              onToggle={handleClick}
              label={isStarting ? 'Starting' : 'Power on'}
              variant="power"
              size="md"
              color={isStarting ? 'amber' : 'emerald'}
              disabled={isStarting}
            />
          </div>

          <button
            type="button"
            onClick={handleClick}
            disabled={isStarting}
            className="pad-face min-h-[44px] w-full rounded border border-status-ok/60 bg-status-ok/10 px-4 font-hardware text-xs font-bold uppercase tracking-[0.18em] text-status-ok transition-opacity disabled:opacity-60"
          >
            {isStarting ? 'Initialising audio…' : 'Tap to power on'}
          </button>
        </div>

        <p className="mt-4 font-hardware text-[10px] leading-relaxed text-ink-dim">
          Audio is created inside this tap because mobile browsers block playback
          until a real gesture unlocks the output.
        </p>

        {error !== null ? (
          <p
            role="alert"
            className="mt-4 rounded border border-status-error/50 bg-status-error/10 p-2 font-hardware text-[10px] text-status-error"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
