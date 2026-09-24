'use client';

import { useCallback, useEffect, useRef } from 'react';
import { STORAGE_KEYS } from '@/lib/constants/storageKeys';
import { saveWorkingCopy, subscribeToStorageChanges } from '@/lib/storage/patternStorage';
import { useSequencerStore } from '@/store/useSequencerStore';

/** Autosave debounce window, in milliseconds. */
export const AUTOSAVE_DEBOUNCE_MS = 300;

export interface UseLocalPersistenceResult {
  isUsingMemoryFallback: boolean;
  isQuotaExceeded: boolean;
  /** Writes the working copy immediately, bypassing the debounce. */
  flushNow: () => void;
}

/**
 * Working-copy autosave.
 *
 * Pattern edits are debounced by 300 ms and flushed immediately when the
 * document is hidden or unloaded, so a tab close never loses the last change.
 * A `storage` event from another tab only raises a prompt flag — applying the
 * remote payload automatically would fight the local knobs and could loop.
 */
export function useLocalPersistence(): UseLocalPersistenceResult {
  const isUsingMemoryFallback = useSequencerStore((state) => state.isUsingMemoryFallback);
  const isQuotaExceeded = useSequencerStore((state) => state.isQuotaExceeded);
  const flushRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const write = (): void => {
      const state = useSequencerStore.getState();
      if (!state.hasHydrated) return;
      const result = saveWorkingCopy(state.pattern);
      if (!result.ok) {
        state.reportStorageError(result.error ?? 'Working copy could not be saved');
      }
    };

    const cancelTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const flush = (): void => {
      cancelTimer();
      write();
    };

    flushRef.current = flush;

    const unsubscribe = useSequencerStore.subscribe((state, previous) => {
      // Never persist before hydration, or the factory default would overwrite
      // the user's stored working copy.
      if (!state.hasHydrated) return;
      if (state.pattern === previous.pattern) return;
      cancelTimer();
      timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    });

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flush);

    const unsubscribeStorage = subscribeToStorageChanges(STORAGE_KEYS.WORKING_COPY, () => {
      useSequencerStore.getState().setRemoteChangeAvailable(true);
    });

    return () => {
      cancelTimer();
      unsubscribe();
      unsubscribeStorage();
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flush);
      flushRef.current = () => undefined;
    };
  }, []);

  const flushNow = useCallback((): void => {
    flushRef.current();
  }, []);

  return { isUsingMemoryFallback, isQuotaExceeded, flushNow };
}
