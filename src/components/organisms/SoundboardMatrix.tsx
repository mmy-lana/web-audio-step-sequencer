'use client';

import type { ReactElement } from 'react';
import type { SoundboardPad } from '@/types/audio';
import { SOUNDBOARD_GRID_COLUMNS, SOUNDBOARD_PRESET_TEMPLATES } from '@/lib/constants/soundboardPresets';
import { LedIndicator } from '@/components/ui/LedIndicator';
import { SoundboardTriggerPad } from '@/components/molecules/SoundboardTriggerPad';

export interface SoundboardMatrixProps {
  pads?: readonly SoundboardPad[];
  onTriggerPad: (pad: SoundboardPad) => void;
  /** Pad id most recently fired from the keyboard, used for the flash. */
  flashPadId?: string | null;
  /** Monotonic token; a new value re-runs the flash animation. */
  flashToken?: number;
  className?: string;
}

/**
 * Performance pad grid.
 *
 * Four fluid columns at every breakpoint with a guaranteed 72px touch target, so
 * the pads stay playable one-handed on a phone and fill the desktop panel
 * without stretching.
 */
export function SoundboardMatrix({
  pads = SOUNDBOARD_PRESET_TEMPLATES,
  onTriggerPad,
  flashPadId = null,
  flashToken = 0,
  className = '',
}: SoundboardMatrixProps): ReactElement {
  return (
    <section className={`chassis-panel flex flex-col gap-2 p-3 sm:p-4 ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-chassis-border pb-2">
        <div className="flex items-center gap-2">
          <LedIndicator
            color="violet"
            isOn
            size="sm"
            intensity="low"
            label="Soundboard armed"
          />
          <h2 className="font-hardware text-[11px] font-bold tracking-[0.18em] text-ink">
            SOUNDBOARD
          </h2>
        </div>
        <span className="engraved-label font-hardware text-[9px]">
          keys 1234 · qwer · asdf · zxcv
        </span>
      </header>

      <div className="grid grid-cols-4 gap-2">
        {pads.map((pad) => (
          <SoundboardTriggerPad
            key={pad.id}
            pad={pad}
            onTrigger={() => onTriggerPad(pad)}
            flashToken={flashPadId === pad.id ? flashToken : undefined}
          />
        ))}
      </div>

      <p className="font-hardware text-[10px] leading-relaxed text-ink-dim">
        {pads.length} pads across {SOUNDBOARD_GRID_COLUMNS} columns. Pads fire on
        pointer-down for the lowest latency, and the number keys play them from the
        keyboard.
      </p>
    </section>
  );
}
