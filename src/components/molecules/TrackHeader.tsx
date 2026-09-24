'use client';

import type { ReactElement } from 'react';
import type { Track } from '@/types/audio';
import { COLOR_MAP } from '@/lib/constants/colorMap';
import { roundTo } from '@/lib/utils/audioMath';
import { KnobRotary } from '@/components/ui/KnobRotary';
import { LedIndicator } from '@/components/ui/LedIndicator';
import { PushButton } from '@/components/ui/PushButton';

export interface TrackHeaderProps {
  track: Track;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onChangeVolume: (volume: number) => void;
  onChangePan: (pan: number) => void;
  isSelected?: boolean;
  onSelectTrack?: () => void;
  /** False when mute/solo evaluation has silenced this track. */
  isAudible?: boolean;
  /** Dense row header for the desktop/tablet matrix. */
  compact?: boolean;
}

const INSTRUMENT_LABELS: Record<Track['instrument'], string> = {
  kick: 'KICK',
  snare: 'SNARE',
  hihat_closed: 'HAT CL',
  hihat_open: 'HAT OP',
  clap: 'CLAP',
  tom_low: 'TOM LO',
  tom_high: 'TOM HI',
  synth_lead: 'LEAD',
};

/** Renders a stereo position as hardware would: `L50`, `C`, `R50`. */
export function formatPan(pan: number): string {
  const rounded = Math.round(roundTo(pan, 2) * 100);
  if (rounded === 0) return 'C';
  return rounded < 0 ? `L${Math.abs(rounded)}` : `R${rounded}`;
}

/**
 * Channel strip header: identity LED, name, mute/solo latch and the two mixer
 * knobs. Selecting the header focuses the track in the mobile single-track view.
 */
export function TrackHeader({
  track,
  onToggleMute,
  onToggleSolo,
  onChangeVolume,
  onChangePan,
  isSelected = false,
  onSelectTrack,
  isAudible = true,
  compact = false,
}: TrackHeaderProps): ReactElement {
  const definition = COLOR_MAP[track.color];

  return (
    <div
      className={`chassis-panel flex items-center gap-2 rounded p-2 ${
        isSelected ? 'ring-1 ring-white/25' : ''
      } ${isAudible ? '' : 'opacity-60'}`}
    >
      <button
        type="button"
        onClick={onSelectTrack}
        disabled={onSelectTrack === undefined}
        aria-label={`Select track ${track.name}`}
        aria-pressed={isSelected}
        className={`flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded px-1 text-left ${
          onSelectTrack === undefined ? 'cursor-default' : 'cursor-pointer hover:bg-white/5'
        }`}
      >
        <LedIndicator
          color={track.color}
          isOn={isAudible}
          size="sm"
          intensity={isAudible ? 'high' : 'low'}
          label={`${track.name} ${isAudible ? 'audible' : 'silent'}`}
        />
        <span className="flex min-w-0 flex-col">
          <span
            className={`truncate font-hardware text-[11px] font-bold tracking-wider ${
              isAudible ? definition.textActive : definition.textInactive
            }`}
          >
            {track.name}
          </span>
          <span className="engraved-label truncate font-hardware text-[8px]">
            {INSTRUMENT_LABELS[track.instrument]}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-1">
        <PushButton
          label="M"
          ariaLabel={`Mute ${track.name}`}
          onClick={onToggleMute}
          isActive={track.muted}
          color="crimson"
          variant="ghost"
          size="sm"
          className="min-h-[36px]! px-2!"
        />
        <PushButton
          label="S"
          ariaLabel={`Solo ${track.name}`}
          onClick={onToggleSolo}
          isActive={track.soloed}
          color="amber"
          variant="ghost"
          size="sm"
          className="min-h-[36px]! px-2!"
        />
      </div>

      <div className={`flex items-center ${compact ? 'gap-0' : 'gap-1'}`}>
        <KnobRotary
          label="Vol"
          value={track.volume}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0.8}
          size="sm"
          onChange={onChangeVolume}
          accentColor={track.color}
          displayValue={`${Math.round(track.volume * 100)}`}
        />
        <KnobRotary
          label="Pan"
          value={track.pan}
          min={-1}
          max={1}
          step={0.05}
          defaultValue={0}
          size="sm"
          onChange={onChangePan}
          accentColor={track.color}
          displayValue={formatPan(track.pan)}
        />
      </div>
    </div>
  );
}
