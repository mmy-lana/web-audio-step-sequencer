'use client';

import { create } from 'zustand';
import type {
  DelaySettings,
  DistortionSettings,
  FilterSettings,
  MasterFxSettings,
  Pattern,
  Step,
  StepCount,
  Track,
} from '@/types/audio';
import type { StorageSlotMetadata } from '@/types/storage';
import {
  DEFAULT_STEP_COUNT,
  MAX_BPM,
  MAX_STEP_COUNT,
  MAX_SWING,
  MIN_BPM,
  MIN_STEP_COUNT,
  MIN_SWING,
  TRACK_COUNT,
  createDefaultPattern,
  resizeStepGrid,
} from '@/lib/constants/defaultPatterns';
import { PATTERN_SLOT_COUNT, isValidPatternSlot } from '@/lib/constants/storageKeys';
import {
  clearPatternSlot,
  duplicateSlot,
  getSlotMetadataList,
  getStorageDiagnostics,
  importPatternFromJson,
  loadPatternFromSlot,
  loadWorkingCopy,
  savePatternToSlot,
} from '@/lib/storage/patternStorage';
import {
  clamp,
  roundTo,
  sanitizeBpm,
  sanitizeMasterVolume,
  sanitizePan,
  sanitizePitchOffset,
  sanitizeStepCount,
  sanitizeSwing,
  sanitizeVolume,
} from '@/lib/utils/audioMath';

export type MobileTab = 'sequencer' | 'soundboard' | 'fx';
export type StepPage = 0 | 1;

export interface EditingStepRef {
  trackIndex: number;
  stepIndex: number;
}

export interface MasterFxPatch {
  filter?: Partial<FilterSettings>;
  delay?: Partial<DelaySettings>;
  distortion?: Partial<DistortionSettings>;
  masterVolume?: number;
}

export interface SequencerStoreState {
  pattern: Pattern;
  activeSlot: number;
  hasHydrated: boolean;
  isDirty: boolean;
  isPlaying: boolean;
  isEditMode: boolean;
  slotMetadata: StorageSlotMetadata[];
  selectedTrackIndex: number;
  storageError: string | null;
  remoteChangeAvailable: boolean;
  isUsingMemoryFallback: boolean;
  isQuotaExceeded: boolean;
  activeMobileTab: MobileTab;
  /** 0: steps 0-15, 1: steps 16-31. */
  stepPage: StepPage;
  editingStep: EditingStepRef | null;

  hydrateFromStorage: () => void;
  setIsPlaying: (playing: boolean) => void;
  setIsEditMode: (active: boolean) => void;
  setBpm: (bpm: number) => void;
  setSwing: (swing: number) => void;
  setStepCount: (count: StepCount) => void;
  toggleStep: (trackIndex: number, stepIndex: number) => void;
  updateStepParams: (
    trackIndex: number,
    stepIndex: number,
    params: Partial<Omit<Step, 'index'>>,
  ) => void;
  toggleMute: (trackIndex: number) => void;
  toggleSolo: (trackIndex: number) => void;
  setTrackVolume: (trackIndex: number, volume: number) => void;
  setTrackPan: (trackIndex: number, pan: number) => void;
  updateMasterFx: (fx: MasterFxPatch) => void;
  setSelectedTrackIndex: (index: number) => void;
  setActiveMobileTab: (tab: MobileTab) => void;
  setStepPage: (page: StepPage) => void;
  setEditingStep: (step: EditingStepRef | null) => void;
  refreshSlotMetadata: () => void;
  loadSlotAction: (slot: number, force?: boolean) => 'loaded' | 'dirty_conflict' | 'error';
  saveSlotAction: (slot: number, confirmOverwrite?: boolean) => 'saved' | 'needs_confirm' | 'error';
  clearSlotAction: (slot: number) => void;
  duplicateSlotAction: (toSlot: number) => boolean;
  importPatternAction: (rawJson: string, fileSize?: number) => boolean;
  setRemoteChangeAvailable: (available: boolean) => void;
  reportStorageError: (message: string) => void;
  clearStorageError: () => void;
}

/** Clamps a track index into the eight-track grid. */
function clampTrackIndex(index: number): number {
  return Math.round(clamp(Number.isFinite(index) ? index : 0, 0, TRACK_COUNT - 1));
}

function clampStepIndex(index: number, stepCount: StepCount): number {
  return Math.round(clamp(Number.isFinite(index) ? index : 0, 0, stepCount - 1));
}

/**
 * Immutably replaces one track and stamps `updatedAt`.
 * Returns the original pattern when the index is out of range.
 */
function mapTrack(pattern: Pattern, trackIndex: number, updater: (track: Track) => Track): Pattern {
  if (trackIndex < 0 || trackIndex >= pattern.tracks.length) return pattern;
  return {
    ...pattern,
    tracks: pattern.tracks.map((track, index) => (index === trackIndex ? updater(track) : track)),
    updatedAt: Date.now(),
  };
}

function mapStep(
  pattern: Pattern,
  trackIndex: number,
  stepIndex: number,
  updater: (step: Step) => Step,
): Pattern {
  return mapTrack(pattern, trackIndex, (track) => ({
    ...track,
    steps: track.steps.map((step, index) => (index === stepIndex ? updater(step) : step)),
  }));
}

function sanitizeFilter(next: FilterSettings): FilterSettings {
  return {
    type: next.type,
    cutoff: roundTo(clamp(next.cutoff, 20, 20000), 2),
    resonance: roundTo(clamp(next.resonance, 0.1, 20), 3),
  };
}

function sanitizeDelay(next: DelaySettings): DelaySettings {
  return {
    time: roundTo(clamp(next.time, 0.01, 1), 4),
    feedback: roundTo(clamp(next.feedback, 0, 0.95), 4),
    wetDry: roundTo(clamp(next.wetDry, 0, 1), 4),
  };
}

function sanitizeDistortion(next: DistortionSettings): DistortionSettings {
  return {
    drive: roundTo(clamp(next.drive, 0, 100), 2),
    wetDry: roundTo(clamp(next.wetDry, 0, 1), 4),
  };
}

/** Backend health mirrored into store state for the status rail. */
function storageFlags(): Pick<SequencerStoreState, 'isUsingMemoryFallback' | 'isQuotaExceeded'> {
  const diagnostics = getStorageDiagnostics();
  return {
    isUsingMemoryFallback: diagnostics.isUsingMemoryFallback,
    isQuotaExceeded: diagnostics.isQuotaExceeded,
  };
}

/**
 * Single source of truth for the sequencer.
 *
 * Zustand v5 curried form. No browser global is touched during module
 * evaluation: the initial pattern comes from pure factory code and every storage
 * read happens inside `hydrateFromStorage()`.
 */
export const useSequencerStore = create<SequencerStoreState>()((set, get) => ({
  pattern: createDefaultPattern(1),
  activeSlot: 1,
  hasHydrated: false,
  isDirty: false,
  isPlaying: false,
  isEditMode: false,
  slotMetadata: [],
  selectedTrackIndex: 0,
  storageError: null,
  remoteChangeAvailable: false,
  isUsingMemoryFallback: false,
  isQuotaExceeded: false,
  activeMobileTab: 'sequencer',
  stepPage: 0,
  editingStep: null,

  hydrateFromStorage: (): void => {
    const restored = loadWorkingCopy();
    const pattern = restored.ok && restored.data ? restored.data : createDefaultPattern(1);
    set({
      pattern,
      activeSlot: pattern.slot,
      isDirty: false,
      hasHydrated: true,
      remoteChangeAvailable: false,
      isPlaying: false,
      editingStep: null,
      stepPage: 0,
      storageError: null,
      ...storageFlags(),
    });
    get().refreshSlotMetadata();
  },

  setIsPlaying: (playing: boolean): void => {
    set({ isPlaying: playing });
  },

  setIsEditMode: (active: boolean): void => {
    set({ isEditMode: active, editingStep: active ? get().editingStep : null });
  },

  setBpm: (bpm: number): void => {
    const next = sanitizeBpm(bpm);
    if (next === get().pattern.bpm) return;
    set((state) => ({
      pattern: { ...state.pattern, bpm: next, updatedAt: Date.now() },
      isDirty: true,
    }));
  },

  setSwing: (swing: number): void => {
    const next = sanitizeSwing(swing);
    if (next === get().pattern.swing) return;
    set((state) => ({
      pattern: { ...state.pattern, swing: next, updatedAt: Date.now() },
      isDirty: true,
    }));
  },

  setStepCount: (count: StepCount): void => {
    const next = sanitizeStepCount(count);
    const { pattern } = get();
    if (next === pattern.stepCount) {
      // A same-length request still normalizes the page selector.
      set({ stepPage: 0 });
      return;
    }
    set({
      pattern: {
        ...pattern,
        stepCount: next,
        tracks: pattern.tracks.map((track) => ({
          ...track,
          steps: resizeStepGrid(track.steps, next),
        })),
        updatedAt: Date.now(),
      },
      // §9.1: shrinking back to 16 always returns to the first page.
      stepPage: 0,
      isDirty: true,
    });
  },

  toggleStep: (trackIndex: number, stepIndex: number): void => {
    const { pattern } = get();
    const track = clampTrackIndex(trackIndex);
    const step = clampStepIndex(stepIndex, pattern.stepCount);
    set({
      pattern: mapStep(pattern, track, step, (current) => ({ ...current, active: !current.active })),
      isDirty: true,
    });
  },

  updateStepParams: (trackIndex, stepIndex, params): void => {
    const { pattern } = get();
    const track = clampTrackIndex(trackIndex);
    const step = clampStepIndex(stepIndex, pattern.stepCount);
    set({
      pattern: mapStep(pattern, track, step, (current) => ({
        ...current,
        active: params.active ?? current.active,
        velocity: params.velocity === undefined ? current.velocity : sanitizeVolume(params.velocity),
        probability:
          params.probability === undefined
            ? current.probability
            : roundTo(clamp(params.probability, 0, 1), 4),
        pitchOffset:
          params.pitchOffset === undefined
            ? current.pitchOffset
            : sanitizePitchOffset(params.pitchOffset),
      })),
      isDirty: true,
    });
  },

  toggleMute: (trackIndex: number): void => {
    const track = clampTrackIndex(trackIndex);
    set((state) => ({
      pattern: mapTrack(state.pattern, track, (current) => ({ ...current, muted: !current.muted })),
      isDirty: true,
    }));
  },

  toggleSolo: (trackIndex: number): void => {
    const track = clampTrackIndex(trackIndex);
    set((state) => ({
      pattern: mapTrack(state.pattern, track, (current) => ({
        ...current,
        soloed: !current.soloed,
      })),
      isDirty: true,
    }));
  },

  setTrackVolume: (trackIndex: number, volume: number): void => {
    const track = clampTrackIndex(trackIndex);
    const next = sanitizeVolume(volume);
    set((state) => {
      if (state.pattern.tracks[track]?.volume === next) return {};
      return {
        pattern: mapTrack(state.pattern, track, (current) => ({ ...current, volume: next })),
        isDirty: true,
      };
    });
  },

  setTrackPan: (trackIndex: number, pan: number): void => {
    const track = clampTrackIndex(trackIndex);
    const next = sanitizePan(pan);
    set((state) => {
      if (state.pattern.tracks[track]?.pan === next) return {};
      return {
        pattern: mapTrack(state.pattern, track, (current) => ({ ...current, pan: next })),
        isDirty: true,
      };
    });
  },

  updateMasterFx: (fx: MasterFxPatch): void => {
    set((state) => {
      const current = state.pattern.masterFx;
      const next: MasterFxSettings = {
        filter: sanitizeFilter({ ...current.filter, ...(fx.filter ?? {}) }),
        delay: sanitizeDelay({ ...current.delay, ...(fx.delay ?? {}) }),
        distortion: sanitizeDistortion({ ...current.distortion, ...(fx.distortion ?? {}) }),
        masterVolume:
          fx.masterVolume === undefined
            ? current.masterVolume
            : sanitizeMasterVolume(fx.masterVolume),
      };
      return {
        pattern: { ...state.pattern, masterFx: next, updatedAt: Date.now() },
        isDirty: true,
      };
    });
  },

  setSelectedTrackIndex: (index: number): void => {
    set({ selectedTrackIndex: clampTrackIndex(index) });
  },

  setActiveMobileTab: (tab: MobileTab): void => {
    set({ activeMobileTab: tab });
  },

  setStepPage: (page: StepPage): void => {
    const { pattern } = get();
    // §9.1: page 2 only exists for 32-step patterns.
    if (page === 1 && pattern.stepCount !== MAX_STEP_COUNT) return;
    set({ stepPage: page });
  },

  setEditingStep: (step: EditingStepRef | null): void => {
    if (step === null) {
      set({ editingStep: null });
      return;
    }
    const { pattern } = get();
    set({
      editingStep: {
        trackIndex: clampTrackIndex(step.trackIndex),
        stepIndex: clampStepIndex(step.stepIndex, pattern.stepCount),
      },
    });
  },

  refreshSlotMetadata: (): void => {
    set({ slotMetadata: getSlotMetadataList(), ...storageFlags() });
  },

  loadSlotAction: (slot: number, force = false): 'loaded' | 'dirty_conflict' | 'error' => {
    if (!isValidPatternSlot(slot)) {
      set({ storageError: `Slot ${slot} is outside the 1..${PATTERN_SLOT_COUNT} range` });
      return 'error';
    }
    if (get().isDirty && !force) {
      return 'dirty_conflict';
    }
    const result = loadPatternFromSlot(slot);
    if (!result.ok || !result.data) {
      set({ storageError: result.error ?? `Slot ${slot} could not be loaded` });
      return 'error';
    }
    set({
      pattern: result.data,
      activeSlot: slot,
      isDirty: false,
      stepPage: 0,
      editingStep: null,
      storageError: null,
      ...storageFlags(),
    });
    get().refreshSlotMetadata();
    return 'loaded';
  },

  saveSlotAction: (slot: number, confirmOverwrite = false): 'saved' | 'needs_confirm' | 'error' => {
    if (!isValidPatternSlot(slot)) {
      set({ storageError: `Slot ${slot} is outside the 1..${PATTERN_SLOT_COUNT} range` });
      return 'error';
    }
    const existing = get().slotMetadata.find((entry) => entry.slot === slot);
    if (existing && !existing.isEmpty && !confirmOverwrite) {
      return 'needs_confirm';
    }
    const result = savePatternToSlot(slot, get().pattern);
    if (!result.ok) {
      set({ storageError: result.error ?? `Slot ${slot} could not be saved`, ...storageFlags() });
      return 'error';
    }
    set((state) => ({
      pattern: { ...state.pattern, slot, updatedAt: Date.now() },
      activeSlot: slot,
      isDirty: false,
      storageError: null,
      ...storageFlags(),
    }));
    get().refreshSlotMetadata();
    return 'saved';
  },

  clearSlotAction: (slot: number): void => {
    if (!isValidPatternSlot(slot)) return;
    clearPatternSlot(slot);
    set((state) => ({
      // Clearing the active slot leaves the working copy unsaved.
      isDirty: state.activeSlot === slot ? true : state.isDirty,
      ...storageFlags(),
    }));
    get().refreshSlotMetadata();
  },

  duplicateSlotAction: (toSlot: number): boolean => {
    const result = duplicateSlot(get().activeSlot, toSlot);
    if (!result.ok) {
      set({
        storageError: result.error ?? `Slot ${toSlot} could not be duplicated`,
        ...storageFlags(),
      });
      return false;
    }
    set({ storageError: null, ...storageFlags() });
    get().refreshSlotMetadata();
    return true;
  },

  importPatternAction: (rawJson: string, fileSize?: number): boolean => {
    const result = importPatternFromJson(rawJson, fileSize);
    if (!result.ok || !result.data) {
      set({ storageError: result.error ?? 'Pattern import failed', ...storageFlags() });
      return false;
    }
    const imported = result.data;
    set({
      pattern: imported,
      activeSlot: imported.slot,
      // The imported pattern is only persisted once the user saves it.
      isDirty: true,
      stepPage: 0,
      editingStep: null,
      storageError: null,
      ...storageFlags(),
    });
    get().refreshSlotMetadata();
    return true;
  },

  setRemoteChangeAvailable: (available: boolean): void => {
    set({ remoteChangeAvailable: available });
  },

  reportStorageError: (message: string): void => {
    set({ storageError: message, ...storageFlags() });
  },

  clearStorageError: (): void => {
    set({ storageError: null });
  },
}));

/** True when any track is soloed, which silences every non-soloed track. */
export function selectAnySoloed(state: SequencerStoreState): boolean {
  return state.pattern.tracks.some((track) => track.soloed);
}

/**
 * Audibility rule shared by the UI and the scheduler. Defined in the audio tier
 * (it is evaluated at schedule time) and re-exported here so UI consumers have a
 * single import site.
 */
export { isTrackAudible } from '@/lib/audio/AudioEngine';

/** Bounds-checked step read used by molecules and the step editor. */
export function getStep(pattern: Pattern, trackIndex: number, stepIndex: number): Step | null {
  return pattern.tracks[trackIndex]?.steps[stepIndex] ?? null;
}

/** Inclusive step index range for the current mobile page. */
export function getStepRange(
  stepCount: StepCount,
  stepPage: StepPage,
): readonly [number, number] {
  if (stepCount === MIN_STEP_COUNT || stepPage === 0) return [0, MIN_STEP_COUNT - 1];
  return [MIN_STEP_COUNT, MAX_STEP_COUNT - 1];
}

export const BPM_LIMITS = { min: MIN_BPM, max: MAX_BPM } as const;
export const SWING_LIMITS = { min: MIN_SWING, max: MAX_SWING } as const;
export { DEFAULT_STEP_COUNT };
