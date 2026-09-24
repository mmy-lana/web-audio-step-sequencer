'use client';

import type { ReactElement } from 'react';
import type { StepCount } from '@/types/audio';
import { formatBpm, formatPercent } from '@/lib/utils/audioMath';
import { KnobRotary } from '@/components/ui/KnobRotary';
import { LedIndicator } from '@/components/ui/LedIndicator';
import { PushButton } from '@/components/ui/PushButton';
import { SevenSegmentDisplay } from '@/components/ui/SevenSegmentDisplay';

export interface TransportControlsProps {
  variant: 'bar' | 'console';
  isPlaying: boolean;
  bpm: number;
  swing?: number;
  masterVolume?: number;
  onTogglePlay: () => void;
  onStop: () => void;
  onChangeBpm: (bpm: number) => void;
  onChangeSwing?: (swing: number) => void;
  onChangeMasterVolume?: (vol: number) => void;
  onTapTempo: () => void;
  /** Optional shell wiring; each control renders only when its handler exists. */
  stepCount?: StepCount;
  onChangeStepCount?: (count: StepCount) => void;
  stepPage?: 0 | 1;
  onChangeStepPage?: (page: 0 | 1) => void;
  isEditMode?: boolean;
  onToggleEditMode?: () => void;
  isPowered?: boolean;
  /** Number of taps collected by the tap-tempo tracker, for UI feedback. */
  tapCount?: number;
  className?: string;
}

const BPM_NUDGE_STEP = 1;

/**
 * Transport surface in two hardware flavours.
 *
 * `bar` is the compact mobile footer (play, stop, BPM with nudge buttons, tap).
 * `console` is the full top-mounted deck, which docks itself with
 * `sticky top-0 z-30` on tablet and desktop shells.
 */
export function TransportControls({
  variant,
  isPlaying,
  bpm,
  swing,
  masterVolume,
  onTogglePlay,
  onStop,
  onChangeBpm,
  onChangeSwing,
  onChangeMasterVolume,
  onTapTempo,
  stepCount,
  onChangeStepCount,
  stepPage = 0,
  onChangeStepPage,
  isEditMode = false,
  onToggleEditMode,
  isPowered = true,
  tapCount = 0,
  className = '',
}: TransportControlsProps): ReactElement {
  const isBar = variant === 'bar';

  const playStopGroup = (
    <div className="flex items-center gap-1">
      <PushButton
        label={isPlaying ? 'Pause' : 'Play'}
        onClick={onTogglePlay}
        isActive={isPlaying}
        color="emerald"
        variant="primary"
        size={isBar ? 'md' : 'md'}
        disabled={!isPowered}
        ariaLabel={isPlaying ? 'Pause transport' : 'Start transport'}
      />
      <PushButton
        label="Stop"
        onClick={onStop}
        variant="secondary"
        size={isBar ? 'md' : 'md'}
        disabled={!isPowered}
        ariaLabel="Stop transport"
      />
    </div>
  );

  const bpmGroup = (
    <div className="flex items-end gap-1">
      <SevenSegmentDisplay
        label="Tempo"
        value={formatBpm(bpm)}
        digits={3}
        size={isBar ? 'md' : 'lg'}
        isActive={isPlaying}
        suffix="BPM"
      />
      <div className="flex flex-col gap-1">
        <PushButton
          label="+"
          ariaLabel="Increase tempo by one BPM"
          onClick={() => onChangeBpm(bpm + BPM_NUDGE_STEP)}
          variant="secondary"
          size="sm"
          className="min-h-[22px]! px-2!"
        />
        <PushButton
          label="−"
          ariaLabel="Decrease tempo by one BPM"
          onClick={() => onChangeBpm(bpm - BPM_NUDGE_STEP)}
          variant="secondary"
          size="sm"
          className="min-h-[22px]! px-2!"
        />
      </div>
      <KnobRotary
        label="Tempo"
        value={bpm}
        min={40}
        max={280}
        step={1}
        defaultValue={120}
        size={isBar ? 'sm' : 'md'}
        onChange={onChangeBpm}
        accentColor="amber"
      />
    </div>
  );

  const tapButton = (
    <div className="flex flex-col items-center gap-1">
      <PushButton
        label="Tap"
        onClick={onTapTempo}
        variant="primary"
        size={isBar ? 'md' : 'md'}
        disabled={!isPowered}
        ariaLabel="Tap tempo"
        title="Tap four times in time with the beat"
      />
      <span className="font-hardware text-[8px] text-ink-faint">
        {tapCount > 0 ? `${tapCount} tap${tapCount === 1 ? '' : 's'}` : 'tap tempo'}
      </span>
    </div>
  );

  if (isBar) {
    return (
      <div
        className={`chassis-panel flex flex-wrap items-center justify-between gap-2 rounded-none border-x-0 border-b-0 p-2 ${className}`}
      >
        {playStopGroup}
        {bpmGroup}
        {tapButton}
      </div>
    );
  }

  return (
    <div
      className={`chassis-panel sticky top-0 z-30 flex flex-wrap items-end justify-between gap-3 rounded-none border-x-0 border-t-0 p-3 backdrop-blur-sm ${className}`}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <LedIndicator
            color={isPlaying ? 'emerald' : 'amber'}
            isOn={isPowered}
            size="md"
            intensity={isPlaying ? 'high' : 'normal'}
            label={isPlaying ? 'Transport running' : 'Transport idle'}
          />
          <span className="engraved-label font-hardware text-[9px]">
            {isPowered ? (isPlaying ? 'running' : 'ready') : 'power off'}
          </span>
        </div>
        {playStopGroup}
        {bpmGroup}
        {tapButton}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {onChangeSwing !== undefined && swing !== undefined ? (
          <KnobRotary
            label="Swing"
            value={swing}
            min={0}
            max={0.5}
            step={0.01}
            defaultValue={0}
            size="md"
            onChange={onChangeSwing}
            accentColor="orange"
            displayValue={formatPercent(swing)}
          />
        ) : null}

        {onChangeMasterVolume !== undefined && masterVolume !== undefined ? (
          <KnobRotary
            label="Master"
            value={masterVolume}
            min={0}
            max={1.2}
            step={0.01}
            defaultValue={0.85}
            size="md"
            onChange={onChangeMasterVolume}
            accentColor="lime"
            displayValue={formatPercent(masterVolume / 1.2)}
          />
        ) : null}

        {onChangeStepCount !== undefined && stepCount !== undefined ? (
          <div className="flex flex-col items-center gap-1">
            <span className="engraved-label font-hardware text-[9px]">Steps</span>
            <div className="flex items-center gap-1">
              {([16, 32] as const).map((count) => (
                <PushButton
                  key={count}
                  label={String(count)}
                  ariaLabel={`Use ${count} steps`}
                  onClick={() => onChangeStepCount(count)}
                  isActive={stepCount === count}
                  color="electric_blue"
                  variant="secondary"
                  size="sm"
                  className="min-h-[36px]! px-2.5!"
                />
              ))}
            </div>
          </div>
        ) : null}

        {onChangeStepPage !== undefined && stepCount === 32 ? (
          <div className="flex flex-col items-center gap-1">
            <span className="engraved-label font-hardware text-[9px]">Page</span>
            <div className="flex items-center gap-1">
              {([0, 1] as const).map((page) => (
                <PushButton
                  key={page}
                  label={`P${page + 1}`}
                  ariaLabel={`Show steps ${page === 0 ? '1 to 16' : '17 to 32'}`}
                  onClick={() => onChangeStepPage(page)}
                  isActive={stepPage === page}
                  color="cyan"
                  variant="secondary"
                  size="sm"
                  className="min-h-[36px]! px-2.5!"
                />
              ))}
            </div>
          </div>
        ) : null}

        {onToggleEditMode !== undefined ? (
          <div className="flex flex-col items-center gap-1">
            <span className="engraved-label font-hardware text-[9px]">Edit</span>
            <PushButton
              label="Step edit"
              ariaLabel="Toggle step edit mode"
              onClick={onToggleEditMode}
              isActive={isEditMode}
              color="violet"
              variant="secondary"
              size="sm"
              className="min-h-[36px]!"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
