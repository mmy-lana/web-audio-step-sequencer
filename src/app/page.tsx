'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { SoundboardPad } from '@/types/audio';
import { formatPercent } from '@/lib/utils/audioMath';
import { TapTempoTracker } from '@/lib/utils/tapTempo';
import { useSequencerStore } from '@/store/useSequencerStore';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { useLocalPersistence } from '@/hooks/useLocalPersistence';
import { usePlayheadTracker } from '@/hooks/usePlayheadTracker';
import { useSoundboardKeyboard } from '@/hooks/useSoundboardKeyboard';
import { ChassisScrew } from '@/components/ui/ChassisScrew';
import { LedIndicator } from '@/components/ui/LedIndicator';
import { PushButton } from '@/components/ui/PushButton';
import { SevenSegmentDisplay } from '@/components/ui/SevenSegmentDisplay';
import { MasterFxPanel } from '@/components/molecules/MasterFxPanel';
import { PatternManagerBar } from '@/components/molecules/PatternManagerBar';
import { StereoVuMeter } from '@/components/molecules/StereoVuMeter';
import { TransportControls } from '@/components/molecules/TransportControls';
import { HardwareChassis } from '@/components/organisms/HardwareChassis';
import { MobileNavPanel } from '@/components/organisms/MobileNavPanel';
import { PowerOnOverlay } from '@/components/organisms/PowerOnOverlay';
import { SequencerMatrix } from '@/components/organisms/SequencerMatrix';
import { SoundboardMatrix } from '@/components/organisms/SoundboardMatrix';

/**
 * Root screen.
 *
 * Owns everything that must exist exactly once: storage hydration, the autosave
 * hook, the engine bridge, the playhead tracker and the global hotkeys. The
 * responsive layout itself is delegated to the chassis and the view organisms.
 */
export default function HomePage(): ReactElement {
  /* --------------------------------------------------------------- store */
  const hasHydrated = useSequencerStore((state) => state.hasHydrated);
  const hydrateFromStorage = useSequencerStore((state) => state.hydrateFromStorage);
  const patternName = useSequencerStore((state) => state.pattern.name);
  const bpm = useSequencerStore((state) => state.pattern.bpm);
  const swing = useSequencerStore((state) => state.pattern.swing);
  const stepCount = useSequencerStore((state) => state.pattern.stepCount);
  const masterFx = useSequencerStore((state) => state.pattern.masterFx);
  const activeSlot = useSequencerStore((state) => state.activeSlot);
  const isDirty = useSequencerStore((state) => state.isDirty);
  const isEditMode = useSequencerStore((state) => state.isEditMode);
  const activeMobileTab = useSequencerStore((state) => state.activeMobileTab);
  const stepPage = useSequencerStore((state) => state.stepPage);
  const slotMetadata = useSequencerStore((state) => state.slotMetadata);
  const storageError = useSequencerStore((state) => state.storageError);
  const remoteChangeAvailable = useSequencerStore((state) => state.remoteChangeAvailable);

  const setIsEditMode = useSequencerStore((state) => state.setIsEditMode);
  const setBpm = useSequencerStore((state) => state.setBpm);
  const setSwing = useSequencerStore((state) => state.setSwing);
  const setStepCount = useSequencerStore((state) => state.setStepCount);
  const setStepPage = useSequencerStore((state) => state.setStepPage);
  const updateMasterFx = useSequencerStore((state) => state.updateMasterFx);
  const setActiveMobileTab = useSequencerStore((state) => state.setActiveMobileTab);
  const setRemoteChangeAvailable = useSequencerStore((state) => state.setRemoteChangeAvailable);
  const clearStorageError = useSequencerStore((state) => state.clearStorageError);
  const reportStorageError = useSequencerStore((state) => state.reportStorageError);
  const loadSlotAction = useSequencerStore((state) => state.loadSlotAction);
  const saveSlotAction = useSequencerStore((state) => state.saveSlotAction);
  const clearSlotAction = useSequencerStore((state) => state.clearSlotAction);
  const duplicateSlotAction = useSequencerStore((state) => state.duplicateSlotAction);
  const importPatternAction = useSequencerStore((state) => state.importPatternAction);

  /* --------------------------------------------------------------- hooks */
  const { isInitialized, isPlaying, play, stop, initializeAudio, triggerSoundboardPad } =
    useAudioEngine();
  const persistence = useLocalPersistence();

  usePlayheadTracker({ isPlaying, isInitialized });

  const handleTriggerPad = useCallback(
    (pad: SoundboardPad): void => {
      triggerSoundboardPad(pad);
    },
    [triggerSoundboardPad],
  );

  const handleToggleTransport = useCallback((): void => {
    if (isPlaying) {
      stop();
    } else {
      void play();
    }
  }, [isPlaying, stop, play]);

  const keyboard = useSoundboardKeyboard({
    onTriggerPad: handleTriggerPad,
    onToggleTransport: handleToggleTransport,
    // Hotkeys stay inert until the instrument has been powered on.
    enabled: isInitialized,
  });

  /* ----------------------------------------------------------- hydration */
  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  /* ----------------------------------------------------------- tap tempo */
  const tapTrackerRef = useRef<TapTempoTracker | null>(null);
  const [tapCount, setTapCount] = useState(0);

  const handleTapTempo = useCallback((): void => {
    const tracker = tapTrackerRef.current ?? new TapTempoTracker();
    tapTrackerRef.current = tracker;
    const result = tracker.registerTap();
    setTapCount(result.tapCount);
    if (result.bpm !== null) setBpm(result.bpm);
  }, [setBpm]);

  /* -------------------------------------------------------------- export */
  const handleExport = useCallback((): void => {
    const state = useSequencerStore.getState();
    const json = JSON.stringify(state.pattern, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const slug = state.pattern.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    anchor.href = url;
    anchor.download = `${slug}-slot-${state.activeSlot}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(
    (file: File): void => {
      void file
        .text()
        .then((raw) => {
          importPatternAction(raw, file.size);
        })
        .catch(() => {
          reportStorageError(`"${file.name}" could not be read`);
        });
    },
    [importPatternAction, reportStorageError],
  );

  const handleSelectSlot = useCallback(
    (slot: number): void => {
      const outcome = loadSlotAction(slot);
      if (outcome !== 'dirty_conflict') return;
      const confirmed = window.confirm(
        'The working copy has unsaved changes. Discard them and load the slot?',
      );
      if (confirmed) loadSlotAction(slot, true);
    },
    [loadSlotAction],
  );

  /* -------------------------------------------------------------- header */
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-hardware text-base font-bold tracking-[0.22em] text-ink sm:text-lg">
          W-AUDIO // MODEL-16
        </h1>
        <p className="engraved-label font-hardware text-[9px]">
          analog-style hardware sequencer &amp; soundboard
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SevenSegmentDisplay
          label="Pattern"
          value={bpm}
          digits={3}
          size="sm"
          isActive={isPlaying}
          suffix="BPM"
        />
        <div className="flex items-center gap-2">
          <LedIndicator
            color={isInitialized ? (isPlaying ? 'emerald' : 'cyan') : 'crimson'}
            isOn
            size="md"
            intensity={isPlaying ? 'high' : 'normal'}
            label={isInitialized ? (isPlaying ? 'Running' : 'Ready') : 'Audio suspended'}
          />
          <span className="engraved-label font-hardware text-[9px]">
            {isInitialized ? (isPlaying ? 'running' : 'ready') : 'power off'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LedIndicator
            color={isDirty ? 'amber' : 'emerald'}
            isOn
            size="sm"
            label={isDirty ? 'Unsaved changes' : 'Saved'}
          />
          <span className="font-hardware text-[9px] text-ink-dim">slot {activeSlot}</span>
        </div>
      </div>
    </div>
  );

  /* --------------------------------------------------------- status rail */
  const statusRail = (
    <div className="flex flex-col gap-2">
      {remoteChangeAvailable ? (
        <div
          role="status"
          className="chassis-panel flex flex-wrap items-center justify-between gap-2 border-status-warn/50 bg-status-warn/10 p-2"
        >
          <span className="font-hardware text-[10px] text-status-warn">
            Pattern modified in another tab. Reload to pick up the newer copy.
          </span>
          <div className="flex items-center gap-1">
            <PushButton
              label="Reload"
              onClick={() => hydrateFromStorage()}
              variant="primary"
              size="sm"
              className="min-h-[44px]! md:min-h-[32px]!"
            />
            <PushButton
              label="Dismiss"
              onClick={() => setRemoteChangeAvailable(false)}
              variant="ghost"
              size="sm"
              className="min-h-[44px]! md:min-h-[32px]!"
            />
          </div>
        </div>
      ) : null}

      {persistence.isQuotaExceeded ? (
        <p
          role="alert"
          className="chassis-panel border-status-error/50 bg-status-error/10 p-2 font-hardware text-[10px] text-status-error"
        >
          Browser storage is full. Edits are kept in memory only — export the pattern to keep your
          work.
        </p>
      ) : null}

      {!isInitialized ? (
        <p className="chassis-panel p-2 font-hardware text-[10px] text-ink-dim">
          Audio is suspended. Use the POWER ON switch to enable sound output.
        </p>
      ) : null}
    </div>
  );

  /* ------------------------------------------------------------ transport */
  const handleChangeMasterVolume = useCallback(
    (volume: number): void => {
      updateMasterFx({ masterVolume: volume });
    },
    [updateMasterFx],
  );

  const handleToggleEditMode = useCallback((): void => {
    setIsEditMode(!isEditMode);
  }, [setIsEditMode, isEditMode]);

  // Render functions rather than shared element constants: each call site gets
  // its own element, so the console deck mounted in the top bar and in the
  // mobile FX tab are two independent instances rather than one reused element
  // descriptor sitting at two positions in the tree.
  const renderConsoleTransport = useCallback(
    (): ReactElement => (
      <TransportControls
        variant="console"
        isPlaying={isPlaying}
        bpm={bpm}
        swing={swing}
        masterVolume={masterFx.masterVolume}
        onTogglePlay={handleToggleTransport}
        onStop={stop}
        onChangeBpm={setBpm}
        onChangeSwing={setSwing}
        onChangeMasterVolume={handleChangeMasterVolume}
        onTapTempo={handleTapTempo}
        stepCount={stepCount}
        onChangeStepCount={setStepCount}
        stepPage={stepPage}
        onChangeStepPage={setStepPage}
        isEditMode={isEditMode}
        onToggleEditMode={handleToggleEditMode}
        isPowered={Boolean(isInitialized)}
        tapCount={tapCount}
      />
    ),
    [
      isPlaying,
      bpm,
      swing,
      masterFx.masterVolume,
      handleToggleTransport,
      stop,
      setBpm,
      setSwing,
      handleChangeMasterVolume,
      handleTapTempo,
      stepCount,
      setStepCount,
      stepPage,
      setStepPage,
      isEditMode,
      handleToggleEditMode,
      isInitialized,
      tapCount,
    ],
  );

  const renderBarTransport = useCallback(
    (): ReactElement => (
      <TransportControls
        variant="bar"
        isPlaying={isPlaying}
        bpm={bpm}
        onTogglePlay={handleToggleTransport}
        onStop={stop}
        onChangeBpm={setBpm}
        onTapTempo={handleTapTempo}
        isPowered={Boolean(isInitialized)}
        tapCount={tapCount}
      />
    ),
    [isPlaying, bpm, handleToggleTransport, stop, setBpm, handleTapTempo, isInitialized, tapCount],
  );

  const patternManager = (
    <PatternManagerBar
      activeSlot={activeSlot}
      isDirty={isDirty}
      patternName={patternName}
      slotMetadata={slotMetadata}
      storageError={storageError}
      onDismissError={clearStorageError}
      isUsingMemoryFallback={persistence.isUsingMemoryFallback}
      isQuotaExceeded={persistence.isQuotaExceeded}
      onSelectSlot={handleSelectSlot}
      onSaveToSlot={(slot) => {
        // The bar already confirmed any overwrite against slot metadata.
        saveSlotAction(slot, true);
      }}
      onClearSlot={clearSlotAction}
      onDuplicateSlot={(slot) => {
        duplicateSlotAction(slot);
      }}
      onExport={handleExport}
      onImport={handleImport}
    />
  );

  const masterSection = (
    <div className="flex flex-col gap-3">
      <MasterFxPanel fx={masterFx} onChangeFx={updateMasterFx} />
      <div className="chassis-panel flex items-center justify-center gap-4 p-3">
        <StereoVuMeter isInitialized={isInitialized} segments={12} />
      </div>
    </div>
  );

  return (
    <>
      <HardwareChassis
        header={header}
        statusRail={statusRail}
        consoleBar={<div className="hidden md:block">{renderConsoleTransport()}</div>}
        mobileNav={
          <MobileNavPanel
            activeTab={activeMobileTab}
            onChangeTab={setActiveMobileTab}
            isEditMode={isEditMode}
            onToggleEditMode={handleToggleEditMode}
          />
        }
        bottomBar={renderBarTransport()}
      >
        {/* --------------------------------------------------- mobile views */}
        <div className="flex flex-col gap-3 md:hidden">
          <div
            id="panel-sequencer"
            role="tabpanel"
            aria-labelledby="tab-sequencer"
            hidden={activeMobileTab !== 'sequencer'}
          >
            <SequencerMatrix variant="mobile" />
          </div>

          <div
            id="panel-soundboard"
            role="tabpanel"
            aria-labelledby="tab-soundboard"
            hidden={activeMobileTab !== 'soundboard'}
          >
            <SoundboardMatrix
              onTriggerPad={handleTriggerPad}
              flashPadId={keyboard.lastTriggeredPadId}
              flashToken={keyboard.flashToken}
            />
          </div>

          <div
            id="panel-fx"
            role="tabpanel"
            aria-labelledby="tab-fx"
            hidden={activeMobileTab !== 'fx'}
            className="flex flex-col gap-3"
          >
            {renderConsoleTransport()}
            {masterSection}
            {patternManager}
          </div>
        </div>

        {/* -------------------------------------- tablet + desktop rack view */}
        <div className="hidden flex-col gap-3 md:flex">
          <SequencerMatrix variant="rack" />

          <div className="grid gap-3 lg:grid-cols-2">
            <SoundboardMatrix
              onTriggerPad={handleTriggerPad}
              flashPadId={keyboard.lastTriggeredPadId}
              flashToken={keyboard.flashToken}
            />
            {masterSection}
          </div>

          {patternManager}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 pb-2 font-hardware text-[9px] text-ink-faint">
          <span>
            {stepCount} steps · swing {formatPercent(swing)} · master{' '}
            {formatPercent(masterFx.masterVolume / 1.2)}
          </span>
          <span className="flex items-center gap-1">
            <ChassisScrew size="sm" angle={20} />
            <ChassisScrew size="sm" angle={-30} />
            {hasHydrated ? 'memory ready' : 'loading memory…'}
          </span>
        </footer>
      </HardwareChassis>

      <PowerOnOverlay
        isInitialized={isInitialized}
        onPowerOn={initializeAudio}
        patternName={patternName}
        bpm={bpm}
      />
    </>
  );
}
