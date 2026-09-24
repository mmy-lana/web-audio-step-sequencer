'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReactElement } from 'react';
import type { Step, TrackColor } from '@/types/audio';
import { COLOR_MAP } from '@/lib/constants/colorMap';
import { formatPercent, formatSignedSemitones } from '@/lib/utils/audioMath';
import { KnobRotary } from '@/components/ui/KnobRotary';
import { LedIndicator } from '@/components/ui/LedIndicator';
import { PushButton } from '@/components/ui/PushButton';

export interface StepEditorSheetProps {
  step: Step | null;
  trackName: string;
  isOpen: boolean;
  onClose: () => void;
  onChangeVelocity: (velocity: number) => void;
  onChangeProbability: (prob: number) => void;
  onChangePitch: (semitones: number) => void;
  /** Latches the step on/off from inside the sheet. */
  onToggleActive?: () => void;
  trackColor?: TrackColor;
  /** Position caption, e.g. `STEP 05`. */
  stepLabel?: string;
}

/**
 * Bottom-sheet (mobile) / centred dialog (desktop) editor for a single step.
 *
 * Owns focus, Escape handling and body scroll locking so the sequencer grid
 * behind it cannot be scrolled while the sheet is open.
 */
export function StepEditorSheet({
  step,
  trackName,
  isOpen,
  onClose,
  onChangeVelocity,
  onChangeProbability,
  onChangePitch,
  onToggleActive,
  trackColor = 'cyan',
  stepLabel,
}: StepEditorSheetProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const isVisible = isOpen && step !== null;

  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isVisible, onClose]);

  if (!isVisible || step === null) return null;

  const definition = COLOR_MAP[trackColor];
  const caption = stepLabel ?? `STEP ${String(step.index + 1).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="chassis-panel animate-sheet-in relative z-10 max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] outline-none sm:max-w-md sm:rounded-2xl sm:p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-chassis-border pb-3">
          <div className="flex items-center gap-2">
            <LedIndicator color={trackColor} isOn={step.active} size="md" label={`${trackName} step active`} />
            <div>
              <h2 id={titleId} className="font-hardware text-sm font-bold tracking-wider text-ink">
                {trackName}
              </h2>
              <p className={`font-hardware text-[10px] tracking-[0.14em] ${definition.textActive}`}>
                {caption}
              </p>
            </div>
          </div>
          <PushButton label="Close" onClick={onClose} variant="ghost" size="sm" ariaLabel="Close step editor" />
        </div>

        <div className="mb-4 flex items-center justify-between gap-2">
          <span className="engraved-label font-hardware text-[10px]">Step state</span>
          <PushButton
            label={step.active ? 'Active' : 'Muted'}
            onClick={() => onToggleActive?.()}
            isActive={step.active}
            color={trackColor}
            variant="secondary"
            size="sm"
            disabled={onToggleActive === undefined}
            ariaLabel={step.active ? 'Deactivate step' : 'Activate step'}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <KnobRotary
            label="Velocity"
            value={step.velocity}
            min={0}
            max={1}
            step={0.01}
            size="md"
            onChange={onChangeVelocity}
            accentColor={trackColor}
            displayValue={formatPercent(step.velocity)}
          />
          <KnobRotary
            label="Probability"
            value={step.probability}
            min={0}
            max={1}
            step={0.01}
            size="md"
            onChange={onChangeProbability}
            accentColor={trackColor}
            displayValue={formatPercent(step.probability)}
          />
          <KnobRotary
            label="Pitch"
            value={step.pitchOffset}
            min={-24}
            max={24}
            step={1}
            defaultValue={0}
            size="md"
            onChange={onChangePitch}
            accentColor={trackColor}
            displayValue={`${formatSignedSemitones(step.pitchOffset)} st`}
          />
        </div>

        <p className="mt-4 border-t border-chassis-border pt-3 font-hardware text-[10px] leading-relaxed text-ink-dim">
          Velocity scales the trigger amplitude · probability is the chance the step fires on each
          pass · pitch shifts the voice in semitones.
        </p>
      </div>
    </div>
  );
}
