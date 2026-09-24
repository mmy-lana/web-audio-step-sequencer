'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { SoundboardPad } from '@/types/audio';
import type { StereoLevels } from '@/lib/audio/AudioContextManager';
import { getAudioEngine } from '@/lib/audio/AudioEngine';
import { useSequencerStore } from '@/store/useSequencerStore';

export interface UseAudioEngineResult {
  isInitialized: boolean;
  isPlaying: boolean;
  play: () => Promise<void>;
  stop: () => void;
  initializeAudio: () => Promise<void>;
  triggerSoundboardPad: (pad: SoundboardPad) => void;
  getStereoLevels: () => StereoLevels;
}

/** Stable server snapshot: the transport is always idle during SSR. */
const getServerSnapshot = (): boolean => false;

interface NavigatorWithAudioSession extends Navigator {
  audioSession?: { type: string };
}

/**
 * Thin React bridge to the audio singleton.
 *
 * Responsibilities kept out of the engine so the dependency graph stays
 * one-directional (store -> hooks -> components):
 * - mirrors the engine transport flag into the store;
 * - pushes mixer/FX changes into the live graph while initialised;
 * - silences the transport when the document is hidden.
 */
export function useAudioEngine(): UseAudioEngineResult {
  const engine = getAudioEngine();

  // Snapshots are stable primitives, so these never re-render in a loop.
  const isInitialized = useSyncExternalStore(
    engine.subscribe,
    engine.getIsInitialized,
    getServerSnapshot,
  );
  const isPlaying = useSyncExternalStore(engine.subscribe, engine.getIsPlaying, getServerSnapshot);

  const setStoreIsPlaying = useSequencerStore((state) => state.setIsPlaying);

  // Engine -> store transport mirror.
  useEffect(() => {
    const unsubscribe = engine.subscribe(() => {
      const playing = engine.getIsPlaying();
      if (useSequencerStore.getState().isPlaying !== playing) {
        useSequencerStore.getState().setIsPlaying(playing);
      }
    });
    return unsubscribe;
  }, [engine]);

  // Backgrounding the document must not leave the sequencer running.
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== 'hidden') return;
      engine.stop();
      setStoreIsPlaying(false);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [engine, setStoreIsPlaying]);

  // Push mixer and FX changes into the graph. Reference comparison on the
  // tracks array and the masterFx object keeps this cheap.
  useEffect(() => {
    if (!isInitialized) return;
    engine.syncMixer(useSequencerStore.getState().pattern);
    const unsubscribe = useSequencerStore.subscribe((state, previous) => {
      if (state.pattern === previous.pattern) return;
      const tracksChanged = state.pattern.tracks !== previous.pattern.tracks;
      const masterFxChanged = state.pattern.masterFx !== previous.pattern.masterFx;
      if (tracksChanged || masterFxChanged) {
        engine.syncMixer(state.pattern);
      }
    });
    return unsubscribe;
  }, [engine, isInitialized]);

  const initializeAudio = useCallback(async (): Promise<void> => {
    // iOS Safari honours an explicit playback session for Web Audio output.
    if (typeof navigator !== 'undefined') {
      const navigatorWithSession = navigator as NavigatorWithAudioSession;
      if (navigatorWithSession.audioSession !== undefined) {
        navigatorWithSession.audioSession.type = 'playback';
      }
    }
    await engine.init();
  }, [engine]);

  const play = useCallback(async (): Promise<void> => {
    await engine.play(() => useSequencerStore.getState().pattern);
  }, [engine]);

  const stop = useCallback((): void => {
    engine.stop();
    useSequencerStore.getState().setIsPlaying(false);
  }, [engine]);

  const triggerSoundboardPad = useCallback(
    (pad: SoundboardPad): void => {
      engine.triggerPad(pad);
    },
    [engine],
  );

  const getStereoLevels = useCallback((): StereoLevels => engine.getStereoLevels(), [engine]);

  return {
    isInitialized,
    isPlaying,
    play,
    stop,
    initializeAudio,
    triggerSoundboardPad,
    getStereoLevels,
  };
}
