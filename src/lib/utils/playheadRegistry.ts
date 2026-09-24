/**
 * Element registry for the decoupled visual playhead (§5.5 / §9.1).
 *
 * The audio scheduler runs up to 100 ms ahead of real time, so it never touches
 * the DOM. Instead `usePlayheadTracker` compares the scheduler queue against
 * `AudioContext.currentTime` and calls `setActiveStep`, which flips a single
 * `data-playhead` attribute on the already-registered step elements. No React
 * re-render is involved, so an 8x32 grid never re-renders per 16th note.
 *
 * Module scope holds only a `Map` and a number — no browser globals are read at
 * evaluation time, so this module is safe to import during SSR.
 */

const PLAYHEAD_ATTRIBUTE = 'data-playhead';
const PLAYHEAD_ACTIVE_VALUE = 'active';

const stepElementRegistry = new Map<number, Set<HTMLElement>>();
let activeStep: number | null = null;

function applyAttribute(elements: Set<HTMLElement> | undefined, isActive: boolean): void {
  if (!elements) return;
  elements.forEach((element) => {
    if (isActive) {
      element.setAttribute(PLAYHEAD_ATTRIBUTE, PLAYHEAD_ACTIVE_VALUE);
    } else {
      element.removeAttribute(PLAYHEAD_ATTRIBUTE);
    }
  });
}

/**
 * Registers a step element under its grid index and returns the unregister
 * function, so it can be used directly as a React ref-callback cleanup.
 */
export function registerStepElement(stepIndex: number, element: HTMLElement): () => void {
  const existing = stepElementRegistry.get(stepIndex);
  const bucket = existing ?? new Set<HTMLElement>();
  if (!existing) {
    stepElementRegistry.set(stepIndex, bucket);
  }
  bucket.add(element);

  // A late-mounting element inherits the current cursor position.
  if (activeStep === stepIndex) {
    element.setAttribute(PLAYHEAD_ATTRIBUTE, PLAYHEAD_ACTIVE_VALUE);
  }

  return () => {
    bucket.delete(element);
    if (bucket.size === 0) {
      stepElementRegistry.delete(stepIndex);
    }
    element.removeAttribute(PLAYHEAD_ATTRIBUTE);
  };
}

/**
 * Moves the visual cursor. The previous step is cleared before the next one is
 * lit, so exactly one grid column carries the attribute at any time.
 */
export function setActiveStep(step: number | null): void {
  if (step === activeStep) return;
  applyAttribute(activeStep === null ? undefined : stepElementRegistry.get(activeStep), false);
  activeStep = step;
  applyAttribute(step === null ? undefined : stepElementRegistry.get(step), true);
}

/** Removes the cursor from every registered element, e.g. on stop or pause. */
export function clearPlayhead(): void {
  if (activeStep === null) {
    stepElementRegistry.forEach((bucket) => applyAttribute(bucket, false));
    return;
  }
  applyAttribute(stepElementRegistry.get(activeStep), false);
  activeStep = null;
}

/** Current cursor position, or `null` when the transport is idle. */
export function getActiveStep(): number | null {
  return activeStep;
}

/** Diagnostics for the verification gate: how many elements are registered. */
export function getRegisteredElementCount(): number {
  let total = 0;
  stepElementRegistry.forEach((bucket) => {
    total += bucket.size;
  });
  return total;
}
