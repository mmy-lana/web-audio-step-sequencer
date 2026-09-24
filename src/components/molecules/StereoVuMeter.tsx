'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { getAudioEngine } from '@/lib/audio/AudioEngine';
import { LedVuMeter } from '@/components/ui/LedVuMeter';

export interface StereoVuMeterProps {
  /** Polls the master analysers only while the audio graph exists. */
  isInitialized: boolean;
  /** Sampling period in milliseconds. */
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
 * Isolated in its own component so the ~16 fps analyser reads re-render only
 * these two ladders instead of the whole instrument shell.
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
    const timer = setInterval(() => {
      const next = engine.getStereoLevels();
      setLevels((previous) =>
        previous.left === next.left && previous.right === next.right ? previous : next,
      );
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isInitialized, intervalMs]);

  return (
    <div className={`flex items-end justify-center gap-2 ${className}`}>
      <LedVuMeter level={levels.left} segments={segments} orientation="vertical" label="L" />
      <LedVuMeter level={levels.right} segments={segments} orientation="vertical" label="R" />
      <span className="sr-only">{`${label} level, left ${Math.round(levels.left * 100)} percent, right ${Math.round(levels.right * 100)} percent`}</span>
    </div>
  );
}
