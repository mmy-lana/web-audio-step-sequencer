import type { StepCount } from '@/types/audio';
import { computeSwingIntervalSeconds, secondsPerStep } from '@/lib/utils/audioMath';

/** How often the scheduler wakes up, in milliseconds. */
const LOOKAHEAD_INTERVAL_MS = 25;
/** How far ahead of the audio clock steps are queued, in seconds. */
const SCHEDULE_AHEAD_SECONDS = 0.1;
/** Initial offset from the current context time, in seconds. */
const START_OFFSET_SECONDS = 0.05;
/** If the queue falls this far behind, the clock is resynced instead of catching up. */
const RESYNC_THRESHOLD_SECONDS = 0.2;

/** Transport state read at each step boundary. */
export interface SchedulerTransportState {
  bpm: number;
  swing: number;
  stepCount: StepCount;
}

/**
 * Web Audio lookahead scheduler.
 *
 * A coarse `setInterval` clock walks ahead of `AudioContext.currentTime` and
 * hands exact `(step, time)` pairs to the engine, which is what makes the
 * timing sample-accurate rather than main-thread-jitter-accurate.
 *
 * Two safety mechanisms:
 * - **Run tokens** — `start()` awaits `resume()`, so a `stop()` landing during
 *   that await must not launch a timer. The session id is checked after every
 *   await and invalidated by `stop()`.
 * - **Resync guard** — a backgrounded tab can stall the main thread for seconds;
 *   when the queue head is far behind the audio clock, the clock is resynced
 *   rather than firing a burst of late steps.
 */
export class LookaheadScheduler {
  private readonly ctx: AudioContext;
  private readonly getState: () => SchedulerTransportState;
  private readonly onScheduleStep: (stepIndex: number, audioTime: number) => void;

  private timerId: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private currentStep = 0;
  private runSessionId = 0;

  constructor(
    ctx: AudioContext,
    getState: () => SchedulerTransportState,
    onScheduleStep: (stepIndex: number, audioTime: number) => void,
  ) {
    this.ctx = ctx;
    this.getState = getState;
    this.onScheduleStep = onScheduleStep;
  }

  public isRunning(): boolean {
    return this.timerId !== null;
  }

  /** Step index that will be scheduled next. */
  public getCurrentStep(): number {
    return this.currentStep;
  }

  public async start(): Promise<void> {
    const session = ++this.runSessionId;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // The unlock gesture may not have landed yet; the interval is still
        // safe to arm because it only schedules relative to currentTime.
      }
    }
    // A stop() during the await invalidates this session.
    if (this.runSessionId !== session) return;
    if (this.timerId !== null) return;

    this.currentStep = 0;
    this.nextStepTime = this.ctx.currentTime + START_OFFSET_SECONDS;
    this.timerId = setInterval(() => this.scheduleLoop(), LOOKAHEAD_INTERVAL_MS);
    // Prime the window immediately so the first beat is not delayed by 25ms.
    this.scheduleLoop();
  }

  public stop(): void {
    this.runSessionId += 1;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.currentStep = 0;
    this.nextStepTime = 0;
  }

  private scheduleLoop(): void {
    // Background stalls leave the queue in the past; resync instead of bursting.
    if (this.nextStepTime < this.ctx.currentTime - RESYNC_THRESHOLD_SECONDS) {
      this.nextStepTime = this.ctx.currentTime;
    }
    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_SECONDS) {
      this.onScheduleStep(this.currentStep, this.nextStepTime);
      this.advanceStep();
    }
  }

  private advanceStep(): void {
    const { bpm, swing, stepCount } = this.getState();
    const baseStepTime = secondsPerStep(bpm);
    // Constant-pair swing: the even interval plus the following odd interval
    // always equals 2 * baseStepTime, so the pair never drifts.
    this.nextStepTime += computeSwingIntervalSeconds(baseStepTime, this.currentStep, swing);
    this.currentStep = (this.currentStep + 1) % stepCount;
  }
}
