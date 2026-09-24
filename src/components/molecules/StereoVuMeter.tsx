'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { getAudioEngine } from '@/lib/audio/AudioEngine';
import { normalizeVuSegments, quantizeVuLevel } from '@/lib/utils/audioMath';
import { LedVuMeter } from '@/components/ui/LedVuMeter';

export interface StereoVuMeterProps {
  /** Polls the master analysers only while the audio graph exists. */
  isInitialized: boolean;
  /** Minimum sampling period in milliseconds; frames are otherwise skipped. */
  intervalMs?: number;
  segments?: number;
  label?: string;
  className?: string;
}

/** Default sampling period: ~16 fps, fast enough for a believable meter. */
const DEFAULT_INTERVAL_MS = 60;

/**
 * Self-polling stereo VU meter.
 *
 * Driven by `requestAnimationFrame` rather than `setInterval`: the browser
 * suspends animation frames in a hidden tab, so the meter costs nothing in the
 * background, and frames are additionally throttled to `intervalMs` and dropped
 * when both channels are unchanged. Isolated in its own component so analyser
 * reads re-render only these two ladders, never the instrument shell.
 *
 * Readings are quantized to the ladder resolution first: the analyser returns
 * slightly different floats on every frame, but a rung only lights once, so
 * comparing raw values would re-render the ladders far more often than anything
 * on screen actually changes.
 */
export function StereoVuMeter({
  isInitialized,
  intervalMs = DEFAULT_INTERVAL_MS,
  segments = 12,
  label = 'Master',
  className = '',
}: StereoVuMeterProps): ReactElement {
  const [levels, setLevels] = useState<{ left: number; right: number }>({ left: 0, right: 0 });

  useEffect(() => {
    if (!isInitialized) {
      setLevels({ left: 0, right: 0 });
      return;
    }

    const engine = getAudioEngine();
    const sampleIntervalMs = Math.max(16, intervalMs);
    const rungs = normalizeVuSegments(segments);
    let frameId = 0;
    let lastSampleAt = 0;

    const tick = (timestamp: number): void => {
      const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (isVisible && timestamp - lastSampleAt >= sampleIntervalMs) {
        lastSampleAt = timestamp;
        const next = engine.getStereoLevels();
        // Each channel is quantized independently against the ladder resolution.
        const left = quantizeVuLevel(next.left, rungs);
        const right = quantizeVuLevel(next.right, rungs);
        // Dirty check: skip the render when the ladders would not change.
        setLevels((previous) =>
          previous.left === left && previous.right === right ? previous : { left, right },
        );
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isInitialized, intervalMs, segments]);

  return (
    <div className={`flex items-end justify-center gap-2 ${className}`}>
      <LedVuMeter level={levels.left} segments={segments} orientation="vertical" label="L" />
      <LedVuMeter level={levels.right} segments={segments} orientation="vertical" label="R" />
      <span className="sr-only">{`${label} level, left ${Math.round(levels.left * 100)} percent, right ${Math.round(levels.right * 100)} percent`}</span>
    </div>
  );
}
