'use client';

import { useEffect } from 'react';
import { getAudioEngine } from '@/lib/audio/AudioEngine';
import { clearPlayhead, setActiveStep } from '@/lib/utils/playheadRegistry';

export interface UsePlayheadTrackerOptions {
  /** Drives the RAF loop; it is idle whenever the transport is stopped. */
  isPlaying: boolean;
  isInitialized: boolean;
}

/**
 * High-precision visual playhead.
 *
 * The scheduler queues steps up to 100 ms before they sound. This hook compares
 * the queue head against `AudioContext.currentTime` once per animation frame and
 * moves a single `data-playhead` attribute in the DOM — the grid itself never
 * re-renders, so a 32-step 8-track matrix stays at 60 fps.
 *
 * The cursor is always cleared when the transport stops or the hook unmounts.
 */
export function usePlayheadTracker({
  isPlaying,
  isInitialized,
}: UsePlayheadTrackerOptions): void {
  useEffect(() => {
    if (!isPlaying || !isInitialized) {
      clearPlayhead();
      return;
    }

    const engine = getAudioEngine();
    let frameId = 0;

    const tick = (): void => {
      const currentTime = engine.getCurrentTime();
      if (currentTime !== null) {
        const step = engine.advancePlayhead(currentTime);
        if (step !== null) {
          setActiveStep(step);
        }
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      clearPlayhead();
    };
  }, [isPlaying, isInitialized]);
}
