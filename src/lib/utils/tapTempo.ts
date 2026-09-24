import { MAX_BPM, MIN_BPM } from '@/lib/constants/defaultPatterns';
import { clamp } from '@/lib/utils/audioMath';

/**
 * Tap-tempo analysis. Pure interval math plus a small stateful tracker so the
 * transport can average a rolling window of taps without touching the store.
 */

/** Taps spaced further apart than this start a new measurement. */
export const TAP_TEMPO_RESET_TIMEOUT_MS = 2000;
/** Taps required before a tempo can be reported. */
export const TAP_TEMPO_MIN_TAPS = 2;
/** Rolling window size; older taps are discarded. */
export const TAP_TEMPO_MAX_TAPS = 8;
/** Relative deviation from the median interval above which a tap is discarded. */
export const TAP_TEMPO_OUTLIER_TOLERANCE = 0.35;

export interface TapTempoOptions {
  resetTimeoutMs?: number;
  minBpm?: number;
  maxBpm?: number;
  maxTaps?: number;
  minTaps?: number;
  outlierTolerance?: number;
}

export interface TapTempoResult {
  /** Averaged tempo, or `null` while fewer than `minTaps` valid taps exist. */
  bpm: number | null;
  /** Number of taps currently inside the rolling window. */
  tapCount: number;
  /** Raw inter-tap intervals, oldest first. */
  intervalsMs: readonly number[];
  /** True when the reset timeout elapsed and the window restarted. */
  didReset: boolean;
  /** True when at least one interval was discarded as an outlier. */
  didRejectOutlier: boolean;
}

interface ResolvedOptions {
  resetTimeoutMs: number;
  minBpm: number;
  maxBpm: number;
  maxTaps: number;
  minTaps: number;
  outlierTolerance: number;
}

function resolveOptions(options: TapTempoOptions): ResolvedOptions {
  const minBpm = clamp(options.minBpm ?? MIN_BPM, 1, 1000);
  const maxBpm = clamp(options.maxBpm ?? MAX_BPM, minBpm + 1, 2000);
  return {
    resetTimeoutMs: Math.max(100, options.resetTimeoutMs ?? TAP_TEMPO_RESET_TIMEOUT_MS),
    minBpm,
    maxBpm,
    maxTaps: Math.max(2, Math.trunc(options.maxTaps ?? TAP_TEMPO_MAX_TAPS)),
    minTaps: Math.max(2, Math.trunc(options.minTaps ?? TAP_TEMPO_MIN_TAPS)),
    outlierTolerance: clamp(options.outlierTolerance ?? TAP_TEMPO_OUTLIER_TOLERANCE, 0.01, 1),
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Averages inter-tap intervals into a tempo.
 * Intervals outside the plausible BPM window are dropped, then a median filter
 * removes double-taps and dropped beats before the mean is taken.
 */
export function computeBpmFromIntervals(
  intervalsMs: readonly number[],
  minBpm: number = MIN_BPM,
  maxBpm: number = MAX_BPM,
  outlierTolerance: number = TAP_TEMPO_OUTLIER_TOLERANCE,
): { bpm: number | null; didRejectOutlier: boolean } {
  const fastestInterval = 60000 / maxBpm;
  const slowestInterval = 60000 / minBpm;

  const inRange = intervalsMs.filter(
    (interval) => Number.isFinite(interval) && interval >= fastestInterval && interval <= slowestInterval,
  );
  if (inRange.length === 0) return { bpm: null, didRejectOutlier: intervalsMs.length > 0 };

  const center = median(inRange);
  const kept = inRange.filter(
    (interval) => Math.abs(interval - center) / center <= outlierTolerance,
  );
  const didRejectOutlier = kept.length !== intervalsMs.length;

  if (kept.length === 0) return { bpm: null, didRejectOutlier };

  const mean = kept.reduce((total, interval) => total + interval, 0) / kept.length;
  if (!Number.isFinite(mean) || mean <= 0) return { bpm: null, didRejectOutlier };

  return { bpm: clamp(Math.round(60000 / mean), minBpm, maxBpm), didRejectOutlier };
}

/** Derives a tempo from raw tap timestamps (milliseconds). */
export function getBpmFromTapTimestamps(
  timestamps: readonly number[],
  options: TapTempoOptions = {},
): number | null {
  if (timestamps.length < 2) return null;
  const resolved = resolveOptions(options);
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  return computeBpmFromIntervals(
    intervals,
    resolved.minBpm,
    resolved.maxBpm,
    resolved.outlierTolerance,
  ).bpm;
}

/**
 * Stateful rolling tap window. Inject `now` for deterministic tests; the default
 * reads `Date.now()` at call time (never at module evaluation).
 */
export class TapTempoTracker {
  private readonly options: ResolvedOptions;
  private readonly now: () => number;
  private timestamps: number[] = [];
  private lastBpm: number | null = null;

  constructor(options: TapTempoOptions = {}, now: () => number = () => Date.now()) {
    this.options = resolveOptions(options);
    this.now = now;
  }

  /**
   * Registers a tap and returns the recomputed tempo window.
   * Pass `timestamp` (ms) to drive the tracker from an event time.
   */
  public registerTap(timestamp?: number): TapTempoResult {
    const tappedAt = timestamp ?? this.now();
    let didReset = false;

    if (!Number.isFinite(tappedAt)) {
      return this.snapshot(false, false);
    }

    const previous = this.timestamps[this.timestamps.length - 1];
    if (previous !== undefined) {
      const gap = tappedAt - previous;
      if (gap <= 0 || gap > this.options.resetTimeoutMs) {
        this.timestamps = [];
        didReset = true;
      }
    }

    this.timestamps.push(tappedAt);
    if (this.timestamps.length > this.options.maxTaps) {
      this.timestamps = this.timestamps.slice(this.timestamps.length - this.options.maxTaps);
    }

    if (this.timestamps.length < this.options.minTaps) {
      this.lastBpm = null;
      return this.snapshot(didReset, false);
    }

    const intervals: number[] = [];
    for (let i = 1; i < this.timestamps.length; i++) {
      intervals.push(this.timestamps[i] - this.timestamps[i - 1]);
    }

    const { bpm, didRejectOutlier } = computeBpmFromIntervals(
      intervals,
      this.options.minBpm,
      this.options.maxBpm,
      this.options.outlierTolerance,
    );
    this.lastBpm = bpm;
    return this.snapshot(didReset, didRejectOutlier);
  }

  /** Clears the window without reporting a reset. */
  public reset(): void {
    this.timestamps = [];
    this.lastBpm = null;
  }

  public getTapCount(): number {
    return this.timestamps.length;
  }

  /** Last resolved tempo, or `null` before enough taps have accumulated. */
  public getLastBpm(): number | null {
    return this.lastBpm;
  }

  /** Raw intervals of the current window, oldest first. */
  public getIntervalsMs(): readonly number[] {
    const intervals: number[] = [];
    for (let i = 1; i < this.timestamps.length; i++) {
      intervals.push(this.timestamps[i] - this.timestamps[i - 1]);
    }
    return intervals;
  }

  private snapshot(didReset: boolean, didRejectOutlier: boolean): TapTempoResult {
    return {
      bpm: this.lastBpm,
      tapCount: this.timestamps.length,
      intervalsMs: this.getIntervalsMs(),
      didReset,
      didRejectOutlier,
    };
  }
}
