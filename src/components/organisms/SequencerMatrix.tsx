'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { StepCount } from '@/types/audio';
import { COLOR_MAP } from '@/lib/constants/colorMap';
import { formatBpm } from '@/lib/utils/audioMath';
import { getStepRange, isTrackAudible, useSequencerStore } from '@/store/useSequencerStore';
import { LedIndicator } from '@/components/ui/LedIndicator';
import { PushButton } from '@/components/ui/PushButton';
import { SevenSegmentDisplay } from '@/components/ui/SevenSegmentDisplay';
import { StepCell } from '@/components/molecules/StepCell';
import { StepEditorSheet } from '@/components/molecules/StepEditorSheet';
import { TrackHeader } from '@/components/molecules/TrackHeader';

export type SequencerMatrixVariant = 'mobile' | 'rack';

export interface SequencerMatrixProps {
  /**
   * `mobile` renders the selected track as a 4x4 pad grid (>=44px targets).
   * `rack` renders all eight tracks as rows, one step per column.
   */
  variant: SequencerMatrixVariant;
  className?: string;
}

/** Steps per page: 16 in every view. */
const STEPS_PER_PAGE = 16;
/** Above this width the full 32-step grid fits without paging. */
const FULL_GRID_MIN_WIDTH_PX = 1440;
/** Steps per beat group, used for the heavier divider. */
const BEAT_GROUP = 4;

/**
 * Reactive `min-width` media query. Returns `false` during SSR and the first
 * client render so hydration stays deterministic, then upgrades on mount.
 */
function useMinWidth(minWidthPx: number): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(min-width: ${minWidthPx}px)`);
    const update = (): void => setMatches(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [minWidthPx]);

  return matches;
}

/**
 * The step grid.
 *
 * Mobile shows one track at a time as a 4x4 pad matrix; tablet and desktop show
 * every track as a row inside a horizontally scrollable rack, with the track
 * headers pinned with `sticky left-0 z-20`. A 32-step pattern is paged into
 * 16-step views unless the viewport is at least 1440px wide.
 */
export function SequencerMatrix({ variant, className = '' }: SequencerMatrixProps): ReactElement {
  const pattern = useSequencerStore((state) => state.pattern);
  const stepPage = useSequencerStore((state) => state.stepPage);
  const selectedTrackIndex = useSequencerStore((state) => state.selectedTrackIndex);
  const isEditMode = useSequencerStore((state) => state.isEditMode);
  const editingStep = useSequencerStore((state) => state.editingStep);
  const isPlaying = useSequencerStore((state) => state.isPlaying);

  const toggleStep = useSequencerStore((state) => state.toggleStep);
  const updateStepParams = useSequencerStore((state) => state.updateStepParams);
  const setEditingStep = useSequencerStore((state) => state.setEditingStep);
  const setSelectedTrackIndex = useSequencerStore((state) => state.setSelectedTrackIndex);
  const setStepPage = useSequencerStore((state) => state.setStepPage);
  const toggleMute = useSequencerStore((state) => state.toggleMute);
  const toggleSolo = useSequencerStore((state) => state.toggleSolo);
  const setTrackVolume = useSequencerStore((state) => state.setTrackVolume);
  const setTrackPan = useSequencerStore((state) => state.setTrackPan);

  const isWideViewport = useMinWidth(FULL_GRID_MIN_WIDTH_PX);

  const stepCount: StepCount = pattern.stepCount;
  const isPaged = stepCount > STEPS_PER_PAGE && !isWideViewport;
  const [rangeStart, rangeEnd] = getStepRange(stepCount, stepPage);
  const visibleStart = isPaged ? rangeStart : 0;
  const visibleEnd = isPaged ? rangeEnd : stepCount - 1;
  const visibleIndices = Array.from(
    { length: visibleEnd - visibleStart + 1 },
    (_unused, index) => visibleStart + index,
  );

  const selectedTrack = pattern.tracks[selectedTrackIndex];
  const editingTrack = editingStep === null ? null : pattern.tracks[editingStep.trackIndex];
  const editingStepData =
    editingStep === null ? null : (pattern.tracks[editingStep.trackIndex]?.steps[editingStep.stepIndex] ?? null);

  const handleOpenEditor = useCallback(
    (trackIndex: number, stepIndex: number): void => {
      setEditingStep({ trackIndex, stepIndex });
    },
    [setEditingStep],
  );

  const handleCloseEditor = useCallback((): void => {
    setEditingStep(null);
  }, [setEditingStep]);

  const pageSelector =
    stepCount > STEPS_PER_PAGE ? (
      <div className="flex items-center gap-1">
        <span className="engraved-label font-hardware text-[9px]">
          {isPaged ? 'Page' : 'Steps'}
        </span>
        {isPaged ? (
          ([0, 1] as const).map((page) => (
            <PushButton
              key={page}
              label={page === 0 ? 'P1: 1-16' : 'P2: 17-32'}
              ariaLabel={`Show steps ${page === 0 ? '1 to 16' : '17 to 32'}`}
              onClick={() => setStepPage(page)}
              isActive={stepPage === page}
              color="cyan"
              variant="secondary"
              size="sm"
              className="min-h-[44px]! px-2.5! text-[9px]! md:min-h-[36px]!"
            />
          ))
        ) : (
          <span className="font-hardware text-[10px] text-ink-muted">1-32</span>
        )}
      </div>
    ) : null;

  const header = (
    <header className="chassis-panel flex flex-wrap items-center justify-between gap-2 p-2">
      <div className="flex items-center gap-2">
        <LedIndicator
          color={isPlaying ? 'emerald' : 'electric_blue'}
          isOn
          size="sm"
          intensity={isPlaying ? 'high' : 'low'}
          label={isPlaying ? 'Sequencer running' : 'Sequencer idle'}
        />
        <h2 className="font-hardware text-[11px] font-bold tracking-[0.18em] text-ink">
          SEQUENCER
        </h2>
        <span className="engraved-label font-hardware text-[9px]">
          {stepCount} steps · {isEditMode ? 'edit mode' : 'trigger mode'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <SevenSegmentDisplay
          label="Tempo"
          value={formatBpm(pattern.bpm)}
          digits={3}
          size="sm"
          isActive={isPlaying}
        />
        {pageSelector}
      </div>
    </header>
  );

  /* ------------------------------------------------------------- mobile view */
  if (variant === 'mobile') {
    return (
      <section className={`flex flex-col gap-2 ${className}`}>
        {header}

        {/* Track selector: mobile edits one track at a time. */}
        <div
          role="tablist"
          aria-label="Select track"
          className="industrial-scrollbar flex gap-1 overflow-x-auto pb-1"
        >
          {pattern.tracks.map((track, index) => {
            const isSelected = index === selectedTrackIndex;
            const isAudible = isTrackAudible(pattern.tracks, index);
            return (
              <button
                key={track.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedTrackIndex(index)}
                className={`pad-face flex min-h-[44px] shrink-0 items-center gap-1.5 rounded border px-2 font-hardware text-[10px] font-bold uppercase tracking-wider ${
                  isSelected
                    ? `${COLOR_MAP[track.color].borderActive} ${COLOR_MAP[track.color].textActive}`
                    : 'border-chassis-border text-ink-muted'
                } ${isAudible ? '' : 'opacity-50'}`}
              >
                <LedIndicator
                  color={track.color}
                  isOn={isAudible}
                  size="xs"
                  intensity={isSelected ? 'high' : 'low'}
                  label={`${track.name} ${isAudible ? 'audible' : 'silent'}`}
                />
                {track.name}
              </button>
            );
          })}
        </div>

        {selectedTrack !== undefined ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              {visibleIndices.map((stepIndex) => {
                const step = selectedTrack.steps[stepIndex];
                if (step === undefined) return null;
                return (
                  <StepCell
                    key={step.index}
                    step={step}
                    trackColor={selectedTrack.color}
                    size="touch"
                    isEditMode={isEditMode}
                    isDimmed={!isTrackAudible(pattern.tracks, selectedTrackIndex)}
                    onToggle={() => toggleStep(selectedTrackIndex, stepIndex)}
                    onOpenEditor={() => handleOpenEditor(selectedTrackIndex, stepIndex)}
                  />
                );
              })}
            </div>

            <TrackHeader
              track={selectedTrack}
              isSelected
              isAudible={isTrackAudible(pattern.tracks, selectedTrackIndex)}
              onToggleMute={() => toggleMute(selectedTrackIndex)}
              onToggleSolo={() => toggleSolo(selectedTrackIndex)}
              onChangeVolume={(volume) => setTrackVolume(selectedTrackIndex, volume)}
              onChangePan={(pan) => setTrackPan(selectedTrackIndex, pan)}
            />
          </>
        ) : (
          <p className="chassis-sunken p-3 font-hardware text-[10px] text-ink-dim">
            No track selected.
          </p>
        )}

        <StepEditorSheet
          step={editingStepData}
          trackName={editingTrack?.name ?? 'TRACK'}
          trackColor={editingTrack?.color ?? 'cyan'}
          stepLabel={
            editingStepData === null
              ? undefined
              : `STEP ${String(editingStepData.index + 1).padStart(2, '0')}`
          }
          isOpen={editingStep !== null && editingStepData !== null}
          onClose={handleCloseEditor}
          onChangeVelocity={(velocity) => {
            if (editingStep === null) return;
            updateStepParams(editingStep.trackIndex, editingStep.stepIndex, { velocity });
          }}
          onChangeProbability={(probability) => {
            if (editingStep === null) return;
            updateStepParams(editingStep.trackIndex, editingStep.stepIndex, { probability });
          }}
          onChangePitch={(pitchOffset) => {
            if (editingStep === null) return;
            updateStepParams(editingStep.trackIndex, editingStep.stepIndex, { pitchOffset });
          }}
          onToggleActive={() => {
            if (editingStep === null) return;
            toggleStep(editingStep.trackIndex, editingStep.stepIndex);
          }}
        />
      </section>
    );
  }

  /* --------------------------------------------------------------- rack view */
  return (
    <section className={`flex flex-col gap-2 ${className}`}>
      {header}

      <div className="industrial-scrollbar overflow-x-auto">
        <div className="flex min-w-max flex-col gap-1.5 pb-1">
          {/* Step ruler, aligned with the column track. */}
          <div className="flex items-center gap-1.5">
            <div className="sticky left-0 z-20 w-[188px] shrink-0 bg-chassis-bg" aria-hidden="true" />
            <div className="flex items-center gap-1">
              {visibleIndices.map((stepIndex) => (
                <span
                  key={`ruler-${stepIndex}`}
                  className={`w-8 text-center font-hardware text-[8px] text-ink-faint xl:w-9 ${
                    stepIndex % BEAT_GROUP === 0 ? 'ml-1.5' : ''
                  }`}
                >
                  {stepIndex + 1}
                </span>
              ))}
            </div>
          </div>

          {pattern.tracks.map((track, trackIndex) => {
            const isAudible = isTrackAudible(pattern.tracks, trackIndex);
            return (
              <div key={track.id} className="flex items-center gap-1.5">
                <div className="sticky left-0 z-20 w-[188px] shrink-0 bg-chassis-bg">
                  <TrackHeader
                    track={track}
                    compact
                    isSelected={trackIndex === selectedTrackIndex}
                    isAudible={isAudible}
                    onSelectTrack={() => setSelectedTrackIndex(trackIndex)}
                    onToggleMute={() => toggleMute(trackIndex)}
                    onToggleSolo={() => toggleSolo(trackIndex)}
                    onChangeVolume={(volume) => setTrackVolume(trackIndex, volume)}
                    onChangePan={(pan) => setTrackPan(trackIndex, pan)}
                  />
                </div>

                <div className="flex items-center gap-1">
                  {visibleIndices.map((stepIndex) => {
                    const step = track.steps[stepIndex];
                    if (step === undefined) return null;
                    return (
                      <StepCell
                        key={step.index}
                        step={step}
                        trackColor={track.color}
                        isDimmed={!isAudible}
                        isEditMode={isEditMode}
                        isBeatStart={stepIndex % BEAT_GROUP === 0 && stepIndex !== visibleStart}
                        onToggle={() => toggleStep(trackIndex, stepIndex)}
                        onOpenEditor={() => handleOpenEditor(trackIndex, stepIndex)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <StepEditorSheet
        step={editingStepData}
        trackName={editingTrack?.name ?? 'TRACK'}
        trackColor={editingTrack?.color ?? 'cyan'}
        stepLabel={
          editingStepData === null
            ? undefined
            : `STEP ${String(editingStepData.index + 1).padStart(2, '0')}`
        }
        isOpen={editingStep !== null && editingStepData !== null}
        onClose={handleCloseEditor}
        onChangeVelocity={(velocity) => {
          if (editingStep === null) return;
          updateStepParams(editingStep.trackIndex, editingStep.stepIndex, { velocity });
        }}
        onChangeProbability={(probability) => {
          if (editingStep === null) return;
          updateStepParams(editingStep.trackIndex, editingStep.stepIndex, { probability });
        }}
        onChangePitch={(pitchOffset) => {
          if (editingStep === null) return;
          updateStepParams(editingStep.trackIndex, editingStep.stepIndex, { pitchOffset });
        }}
        onToggleActive={() => {
          if (editingStep === null) return;
          toggleStep(editingStep.trackIndex, editingStep.stepIndex);
        }}
      />
    </section>
  );
}
