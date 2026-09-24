/**
 * Hydration and client-runtime gate.
 *
 *   npx tsx scripts/verify-hydration.tsx
 *
 * Server-renders the real root screen, hydrates it into a jsdom document with
 * `react-dom/client`, and fails on ANY React warning or hydration mismatch.
 * This is the only gate that exercises the client-side effects: storage
 * hydration, the autosave subscription, the playhead tracker, the analyser meter
 * loop, and the full audio-unlock click path.
 */
import { act, createElement, Profiler } from 'react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import HomePage from '../src/app/page';
import { useSequencerStore } from '../src/store/useSequencerStore';
import { createDefaultPattern } from '../src/lib/constants/defaultPatterns';
import { SOUNDBOARD_PRESET_TEMPLATES } from '../src/lib/constants/soundboardPresets';
import { getAudioEngine } from '../src/lib/audio/AudioEngine';
import { isInteractiveTarget, useSoundboardKeyboard } from '../src/hooks/useSoundboardKeyboard';
import { StereoVuMeter } from '../src/components/molecules/StereoVuMeter';
import { FakeAudioContext, installFakeAudioContext } from './fakeWebAudio';

/* ------------------------------------------------------------------ harness */

let passed = 0;
const failures: string[] = [];
let currentSection = '(root)';

function section(title: string): void {
  currentSection = title;
  console.log(`\n\u25b6 ${title}`);
}

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${label}`);
    return;
  }
  const message = detail
    ? `${currentSection} :: ${label} -> ${detail}`
    : `${currentSection} :: ${label}`;
  failures.push(message);
  console.log(`  \u2717 ${label}${detail ? ` -> ${detail}` : ''}`);
}

function equal<T>(label: string, actual: T, expected: T): void {
  check(
    label,
    Object.is(actual, expected),
    `expected ${String(expected)}, received ${String(actual)}`,
  );
}

/* ------------------------------------------------------ environment plumbing */

interface MutableGlobal {
  [key: string]: unknown;
}

function installGlobal(key: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    (globalThis as MutableGlobal)[key] = value;
  }
}

/** Copies the jsdom window surface onto globalThis so React sees a browser. */
function installDom(dom: JSDOM): void {
  const { window } = dom;
  const forwarded = [
    'window',
    'document',
    'navigator',
    'location',
    'history',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLButtonElement',
    'Element',
    'Node',
    'Text',
    'DocumentFragment',
    'SVGElement',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'KeyboardEvent',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'localStorage',
    'sessionStorage',
    'DOMException',
    'Blob',
    'URL',
    'matchMedia',
  ];
  forwarded.forEach((key) => {
    const value = (window as unknown as MutableGlobal)[key];
    if (value !== undefined) installGlobal(key, value);
  });
}

/**
 * The meter loop and the debounced autosave run on real timers, so they update
 * state outside `act()`. React reports that as an environment warning; it is
 * harness noise, not application output, so it is dropped at the console level
 * and never reaches the gate output or the assertions.
 */
const ACT_NOISE_MARKERS = ['not wrapped in act', 'not configured to support act'];

function isActNoise(args: readonly unknown[]): boolean {
  const text = args.map((value) => String(value)).join(' ');
  return ACT_NOISE_MARKERS.some((marker) => text.includes(marker));
}

const realConsoleError = console.error.bind(console);
const realConsoleWarn = console.warn.bind(console);
let captureSink: string[] | null = null;

function routeConsole(
  args: readonly unknown[],
  fallback: (...forwarded: unknown[]) => void,
): void {
  if (isActNoise(args)) return;
  const text = args.map((value) => String(value)).join(' ');
  if (captureSink !== null) {
    captureSink.push(text);
    return;
  }
  fallback(text);
}

console.error = (...args: unknown[]) => routeConsole(args, realConsoleError);
console.warn = (...args: unknown[]) => routeConsole(args, realConsoleWarn);

/** Captures the filtered console stream so React warnings can fail the gate. */
function captureConsole(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const previous = captureSink;
  captureSink = messages;
  return {
    messages,
    restore: () => {
      captureSink = previous;
    },
  };
}

/** Minimal PointerEvent surface needed to tap a step cell inside jsdom. */
interface PointerEventInitLike {
  bubbles?: boolean;
  cancelable?: boolean;
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  isPrimary?: boolean;
}

type PointerEventConstructor = new (type: string, init?: PointerEventInitLike) => Event;

/**
 * Taps an element with a matching pointerdown / pointerup pair. Step cells act
 * on pointer release rather than on `click`, so a synthetic click would be
 * ignored by a correct implementation.
 */
function tapElement(element: Element, window: JSDOM['window']): void {
  const PointerEventCtor = (window as unknown as { PointerEvent: PointerEventConstructor })
    .PointerEvent;
  const init: PointerEventInitLike = {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX: 8,
    clientY: 8,
    isPrimary: true,
  };
  element.dispatchEvent(new PointerEventCtor('pointerdown', init));
  element.dispatchEvent(new PointerEventCtor('pointerup', init));
}

const HYDRATION_MARKERS = [
  'Hydration failed',
  'did not match',
  'Text content does not match',
  'server rendered HTML',
  'Expected server HTML',
  'hydration',
];

function findHydrationErrors(messages: readonly string[]): string[] {
  return messages.filter((message) =>
    HYDRATION_MARKERS.some((marker) => message.toLowerCase().includes(marker.toLowerCase())),
  );
}



/* -------------------------------------------------------------------- main */

async function main(): Promise<void> {
  // Must be set before react-dom/client is imported.
  installGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  section('Server render');
  const serverHtml = renderToString(createElement(HomePage));
  check('the root screen server-renders', serverHtml.length > 1000);
  check('the server output contains the instrument', serverHtml.includes('W-AUDIO // MODEL-16'));

  section('Client hydration');
  const dom = new JSDOM(`<!doctype html><html><body><div id="root">${serverHtml}</div></body></html>`, {
    pretendToBeVisual: true,
    url: 'http://localhost:3000/',
  });
  installDom(dom);

  // jsdom reports `prerender` unless visual emulation forces a visible document.
  Object.defineProperty(dom.window.document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });

  // Count animation frames from the start: the meter must request none until
  // the instrument is powered on.
  let rafRequests = 0;
  const originalRaf = dom.window.requestAnimationFrame;
  installGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    rafRequests += 1;
    return originalRaf.call(dom.window, callback);
  });

  const container = dom.window.document.getElementById('root');
  check('the hydration container exists', container !== null);
  if (container === null) {
    process.exit(1);
  }

  const restoreAudio = installFakeAudioContext();

  const capture = captureConsole();
  const { hydrateRoot } = await import('react-dom/client');
  let hydrationThrew: string | null = null;

  try {
    await act(async () => {
      hydrateRoot(container, createElement(HomePage));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  } catch (error) {
    hydrationThrew = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  const hydrationMessages = findHydrationErrors(capture.messages);
  capture.restore();

  check('hydration does not throw', hydrationThrew === null, hydrationThrew ?? undefined);
  check(
    'React reports no hydration mismatch',
    hydrationMessages.length === 0,
    hydrationMessages.slice(0, 2).join(' | '),
  );
  check(
    'React emits no warnings at all during hydration',
    capture.messages.length === 0,
    capture.messages.slice(0, 2).join(' | '),
  );

  section('Post-hydration DOM');
  equal(
    'every step cell survives hydration',
    dom.window.document.querySelectorAll('[data-step-index]').length,
    144,
  );
  equal(
    'every pad survives hydration',
    dom.window.document.querySelectorAll('[data-pad-id]').length,
    32,
  );
  check(
    'the power overlay is mounted before audio exists',
    dom.window.document.querySelector('[aria-label="Power on the instrument"]') !== null,
  );

  const ids = Array.from(dom.window.document.querySelectorAll('[id]')).map(
    (element) => element.id,
  );
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  check(
    'no duplicate DOM ids exist',
    duplicateIds.length === 0,
    `duplicates: ${Array.from(new Set(duplicateIds)).join(', ')}`,
  );

  const described = Array.from(
    dom.window.document.querySelectorAll('[aria-describedby]'),
  ).map((element) => element.getAttribute('aria-describedby') ?? '');
  check(
    'every aria-describedby target resolves',
    described.every((id) => dom.window.document.getElementById(id) !== null),
    described.filter((id) => dom.window.document.getElementById(id) === null).join(', '),
  );

  section('Client effects ran');
  const state = useSequencerStore.getState();
  check('hydration from storage completed', state.hasHydrated);
  equal('slot metadata was read from storage', state.slotMetadata.length, 8);
  check(
    'the footer reports memory as ready',
    dom.window.document.body.textContent?.includes('memory ready') === true,
  );
  check(
    'the 44px touch floor is applied to sub-44px controls',
    dom.window.document.body.innerHTML.includes('min-h-[44px]!'),
  );

  equal('the meter stays inert while unpowered', rafRequests, 0);

  section('Audio unlock inside a user gesture');
  const powerSwitch = dom.window.document.querySelector('[role="switch"][aria-label="Power on"]');
  check('the power switch is present', powerSwitch !== null);

  FakeAudioContext.instances = [];
  const captureClick = captureConsole();
  try {
    await act(async () => {
      (powerSwitch as unknown as { click: () => void } | null)?.click();
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    });
  } catch (error) {
    check('clicking power does not throw', false, String(error));
  }
  const clickMessages = captureClick.messages;
  captureClick.restore();

  equal('exactly one AudioContext is created by the gesture', FakeAudioContext.instances.length, 1);
  check('the engine reports initialised', getAudioEngine().isInitialized);
  check(
    'the overlay is dismissed once audio exists',
    dom.window.document.querySelector('[aria-label="Power on the instrument"]') === null,
  );
  check('the header reports the running state', dom.window.document.body.textContent?.includes('ready') === true);
  check(
    'the unlock gesture emits no warnings',
    clickMessages.length === 0,
    clickMessages.slice(0, 2).join(' | '),
  );

  // The analyser meter only starts its RAF loop once audio is unlocked.
  section('Analyser meter loop');
  const framesBeforeWait = rafRequests;
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
  });
  check(
    'the powered meter schedules animation frames',
    rafRequests > framesBeforeWait,
    `${framesBeforeWait} -> ${rafRequests}`,
  );

  section('Autosave safety');
  const storageErrorBefore = useSequencerStore.getState().storageError;
  const quotaFailure = new dom.window.DOMException('quota', 'QuotaExceededError');
  const storageProto = dom.window.Storage.prototype;
  const originalSetItem = storageProto.setItem;
  storageProto.setItem = function throwingSetItem(): void {
    throw quotaFailure;
  };

  let autosaveThrew: string | null = null;
  const captureSave = captureConsole();
  try {
    await act(async () => {
      // A pattern change schedules the debounced write.
      useSequencerStore.getState().setBpm(133);
      await new Promise((resolve) => {
        setTimeout(resolve, 400);
      });
    });
  } catch (error) {
    autosaveThrew = String(error);
  }
  const saveMessages = captureSave.messages;
  captureSave.restore();
  storageProto.setItem = originalSetItem;

  check('a quota failure during autosave never throws', autosaveThrew === null, autosaveThrew ?? undefined);
  check(
    'a quota failure is surfaced to the store',
    useSequencerStore.getState().isQuotaExceeded,
  );
  check(
    'the quota banner is rendered',
    dom.window.document.body.textContent?.includes('Browser storage is full') === true,
  );
  check(
    'the failed write emits no console noise',
    saveMessages.length === 0,
    saveMessages.slice(0, 2).join(' | '),
  );
  void storageErrorBefore;

  section('Transport interaction');
  const playButton = Array.from(dom.window.document.querySelectorAll('button')).find(
    (button) => button.getAttribute('aria-label') === 'Start transport',
  );
  check('a transport play button is rendered', playButton !== undefined);

  const captureTransport = captureConsole();
  try {
    await act(async () => {
      playButton?.click();
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    });
  } catch (error) {
    check('starting the transport does not throw', false, String(error));
  }
  const transportMessages = captureTransport.messages;
  captureTransport.restore();

  check('the transport reports playing', getAudioEngine().getIsPlaying());
  check(
    'the store mirrors the transport state',
    useSequencerStore.getState().isPlaying,
  );
  check(
    'the transport emits no warnings',
    transportMessages.length === 0,
    transportMessages.slice(0, 2).join(' | '),
  );

  const stopButton = Array.from(dom.window.document.querySelectorAll('button')).find(
    (button) => button.getAttribute('aria-label') === 'Stop transport',
  );
  await act(async () => {
    stopButton?.click();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  check('stopping clears the transport flag', !getAudioEngine().getIsPlaying());
  check('the store follows the stop', !useSequencerStore.getState().isPlaying);

  getAudioEngine().dispose();
  restoreAudio();

  /* ------------------------------------------- non-blocking slot loading */
  // The whole flow is driven through the real screen: a dirty working copy, a
  // populated target slot, and an instrumented native-dialog surface.
  section('Non-blocking slot load confirmation');
  let storedTempo = 0;
  await act(async () => {
    equal('slot 3 accepts the working copy', useSequencerStore.getState().saveSlotAction(3, true), 'saved');
    equal(
      'slot 2 accepts the working copy',
      useSequencerStore.getState().saveSlotAction(2, true),
      'saved',
    );
    storedTempo = useSequencerStore.getState().pattern.bpm;
    useSequencerStore.getState().setBpm(148);
  });
  check('the working copy is dirty before the switch', useSequencerStore.getState().isDirty);
  check(
    'the target slot is populated',
    useSequencerStore.getState().slotMetadata.find((entry) => entry.slot === 3)?.isEmpty === false,
  );

  let nativeDialogCalls = 0;
  const stubDialog = (): boolean => {
    nativeDialogCalls += 1;
    return false;
  };
  (dom.window as unknown as { confirm: () => boolean }).confirm = stubDialog;
  installGlobal('confirm', stubDialog);
  check('the native dialog surface is instrumented', dom.window.confirm === stubDialog);

  const findButtons = (labelPrefix: string): HTMLButtonElement[] =>
    Array.from(dom.window.document.querySelectorAll('button')).filter((button) =>
      (button.getAttribute('aria-label') ?? '').startsWith(labelPrefix),
    );

  const slotThreeButtons = findButtons('Load slot 3');
  check('the slot 3 button is rendered', slotThreeButtons.length > 0);

  const captureSlotClick = captureConsole();
  await act(async () => {
    slotThreeButtons[0]?.click();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
  const slotClickMessages = captureSlotClick.messages;
  captureSlotClick.restore();

  equal('no native dialog is opened while the copy is dirty', nativeDialogCalls, 0);
  equal(
    'the dirty switch does not load the slot synchronously',
    useSequencerStore.getState().activeSlot,
    2,
  );
  equal(
    'the dirty switch leaves the working tempo alone',
    useSequencerStore.getState().pattern.bpm,
    148,
  );
  check(
    'the confirmation row is rendered',
    dom.window.document.querySelectorAll('[data-slot-load-confirm]').length > 0,
  );
  check(
    'the confirmation names the target slot',
    dom.window.document.body.textContent?.includes('load slot 03') === true,
  );
  check(
    'the click emits no React warnings',
    slotClickMessages.length === 0,
    slotClickMessages.slice(0, 2).join(' | '),
  );

  const cancelButton = findButtons('Keep the current pattern')[0];
  check('the cancel action is rendered', cancelButton !== undefined);
  await act(async () => {
    cancelButton?.click();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  equal(
    'cancelling dismisses the confirmation',
    dom.window.document.querySelectorAll('[data-slot-load-confirm]').length,
    0,
  );
  equal(
    'cancelling preserves the working tempo',
    useSequencerStore.getState().pattern.bpm,
    148,
  );
  equal('cancelling preserves the active slot', useSequencerStore.getState().activeSlot, 2);
  check('cancelling stays dirty', useSequencerStore.getState().isDirty);
  equal('cancelling opens no native dialog', nativeDialogCalls, 0);

  const captureConfirmClick = captureConsole();
  await act(async () => {
    findButtons('Load slot 3')[0]?.click();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  const reopenMessages = captureConfirmClick.messages;
  captureConfirmClick.restore();
  check(
    'selecting the slot again re-opens the confirmation',
    dom.window.document.querySelectorAll('[data-slot-load-confirm]').length > 0,
  );
  check(
    're-opening the confirmation emits no warnings',
    reopenMessages.length === 0,
    reopenMessages.slice(0, 2).join(' | '),
  );

  const confirmLoadButton = findButtons('Discard unsaved changes and load slot 03')[0];
  check('the confirm action is rendered', confirmLoadButton !== undefined);
  await act(async () => {
    confirmLoadButton?.click();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
  equal('confirming loads the target slot', useSequencerStore.getState().activeSlot, 3);
  equal('confirming restores the stored tempo', useSequencerStore.getState().pattern.bpm, storedTempo);
  check('confirming clears the dirty flag', !useSequencerStore.getState().isDirty);
  equal(
    'confirming dismisses the confirmation',
    dom.window.document.querySelectorAll('[data-slot-load-confirm]').length,
    0,
  );
  equal('confirming opens no native dialog', nativeDialogCalls, 0);

  /* ------------------------------------------------- graceful empty slots */
  section('Empty slot selection in the UI');
  await act(async () => {
    // Land on a clean working copy so the empty slot loads without a conflict.
    useSequencerStore.getState().loadSlotAction(2, true);
  });
  check(
    'slot 7 starts empty',
    useSequencerStore.getState().slotMetadata.find((entry) => entry.slot === 7)?.isEmpty === true,
  );

  const emptySlotButtons = findButtons('Load slot 7');
  check('the empty slot button is rendered', emptySlotButtons.length > 0);
  check('the empty slot button is announced as empty', (emptySlotButtons[0]?.getAttribute('aria-label') ?? '').includes('empty'));

  const captureEmptyClick = captureConsole();
  await act(async () => {
    emptySlotButtons[0]?.click();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
  const emptyClickMessages = captureEmptyClick.messages;
  captureEmptyClick.restore();

  const emptyState = useSequencerStore.getState();
  equal('selecting an empty slot raises no storage error', emptyState.storageError, null);
  equal('selecting an empty slot adopts the slot', emptyState.pattern.slot, 7);
  equal('selecting an empty slot moves the active slot', emptyState.activeSlot, 7);
  check('the new working copy is unsaved', emptyState.isDirty);
  check(
    'selecting an empty slot emits no React warnings',
    emptyClickMessages.length === 0,
    emptyClickMessages.slice(0, 2).join(' | '),
  );
  check(
    'no red storage banner is rendered',
    dom.window.document.body.textContent?.includes('Slot 7 is empty') !== true,
  );
  check(
    'the empty slot is still offered as empty',
    (findButtons('Load slot 7')[0]?.getAttribute('aria-label') ?? '').includes('empty'),
  );
  check(
    'the save action is offered for the empty slot',
    findButtons('Save pattern to slot 7').length > 0,
  );

  // The new pattern must be editable straight away.
  const firstStepCell = dom.window.document.querySelector('[data-step-index="0"]');
  check('the step grid is still rendered', firstStepCell !== null);
  const stepActiveBefore = useSequencerStore.getState().pattern.tracks[0].steps[0].active;
  await act(async () => {
    // Step cells respond to a pointer tap, mirroring the hardware feel.
    if (firstStepCell !== null) tapElement(firstStepCell, dom.window);
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });
  equal(
    'the new pattern is editable from the grid',
    useSequencerStore.getState().pattern.tracks[0].steps[0].active,
    !stepActiveBefore,
  );

  const captureEmptySave = captureConsole();
  await act(async () => {
    findButtons('Save pattern to slot 7')[0]?.click();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
  const emptySaveMessages = captureEmptySave.messages;
  captureEmptySave.restore();

  const savedState = useSequencerStore.getState();
  equal('saving into the empty slot succeeds', savedState.storageError, null);
  check('saving clears the dirty flag', !savedState.isDirty);
  check(
    'the slot is occupied after the save',
    savedState.slotMetadata.find((entry) => entry.slot === 7)?.isEmpty === false,
  );
  check('the empty-slot flow emits no console noise', emptySaveMessages.length === 0, emptySaveMessages.slice(0, 2).join(' | '));

  /* ------------------------------------------------ global keyboard routing */
  section('Global shortcut target handling');
  // A dedicated document, so only this harness listens to the keys dispatched
  // here. The root screen keeps its own listener on the root document.
  const keyboardDom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost:3000/',
  });
  installDom(keyboardDom);

  const triggeredPads: string[] = [];
  let transportToggles = 0;
  function KeyboardHarness(): ReactElement {
    useSoundboardKeyboard({
      onTriggerPad: (pad) => {
        triggeredPads.push(pad.id);
      },
      onToggleTransport: () => {
        transportToggles += 1;
      },
      enabled: true,
    });
    return createElement('span', { 'data-keyboard-harness': 'true' }, 'KEYBOARD HARNESS');
  }

  const keyboardContainer = keyboardDom.window.document.createElement('div');
  keyboardDom.window.document.body.appendChild(keyboardContainer);
  const { createRoot: createKeyboardRoot } = await import('react-dom/client');
  const keyboardRoot = createKeyboardRoot(keyboardContainer);
  await act(async () => {
    keyboardRoot.render(createElement(KeyboardHarness));
  });
  check(
    'the keyboard harness is mounted',
    keyboardDom.window.document.querySelector('[data-keyboard-harness]') !== null,
  );

  const keyboardDocument = keyboardDom.window.document;
  const padKey = SOUNDBOARD_PRESET_TEMPLATES[0].keyBinding;

  /** Dispatches a keydown and reports whether the page default was prevented. */
  const pressKey = async (
    key: string,
    target: Element,
    init: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean } = {},
  ): Promise<boolean> => {
    const event = new keyboardDom.window.KeyboardEvent('keydown', {
      key,
      code: key === ' ' ? 'Space' : `Key${key.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };

  const createElementInDom = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: Record<string, string> = {},
  ): HTMLElementTagNameMap[K] => {
    const element = keyboardDocument.createElement(tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    keyboardDocument.body.appendChild(element);
    element.focus();
    return element;
  };

  // Space outside any control keeps driving the transport.
  let togglesBefore = transportToggles;
  const bodyPrevented = await pressKey(' ', keyboardDocument.body);
  equal('space on the document body toggles the transport', transportToggles - togglesBefore, 1);
  check('the global space shortcut is still prevented', bodyPrevented);

  // Space inside interactive controls must stay with the control.
  const plainButton = createElementInDom('button');
  const nestedButtonSpan = keyboardDocument.createElement('span');
  nestedButtonSpan.textContent = 'PLAY';
  plainButton.appendChild(nestedButtonSpan);
  const roleButton = createElementInDom('div', { role: 'button', tabindex: '0' });
  const roleSlider = createElementInDom('div', { role: 'slider', tabindex: '0' });
  const roleSwitch = createElementInDom('div', { role: 'switch', tabindex: '0' });
  const roleTab = createElementInDom('div', { role: 'tab', tabindex: '0' });
  const textInput = createElementInDom('input');
  const textArea = createElementInDom('textarea');
  const selectBox = createElementInDom('select');
  const editableBox = createElementInDom('div', { contenteditable: 'true' });
  const nestedEditableSpan = keyboardDocument.createElement('span');
  editableBox.appendChild(nestedEditableSpan);

  const interactiveTargets: ReadonlyArray<readonly [string, Element]> = [
    ['a button', plainButton],
    ['a span nested inside a button', nestedButtonSpan],
    ['a role=button control', roleButton],
    ['a role=slider control', roleSlider],
    ['a role=switch control', roleSwitch],
    ['a role=tab control', roleTab],
    ['an input', textInput],
    ['a textarea', textArea],
    ['a select', selectBox],
    ['a contenteditable region', editableBox],
    ['a span nested inside a contenteditable region', nestedEditableSpan],
  ];

  for (const [description, target] of interactiveTargets) {
    const before = transportToggles;
    const prevented = await pressKey(' ', target);
    equal(`space on ${description} does not toggle the transport`, transportToggles - before, 0);
    check(`space on ${description} is left to the control`, !prevented);
    check(
      `${description} is classified as interactive`,
      isInteractiveTarget(target),
    );
  }

  // Pad hotkeys keep working outside controls and stay out of focused ones.
  let padsBefore = triggeredPads.length;
  const padKeyPrevented = await pressKey(padKey, keyboardDocument.body);
  equal('a pad hotkey fires on the document body', triggeredPads.length - padsBefore, 1);
  check('the pad hotkey is prevented globally', padKeyPrevented);
  padsBefore = triggeredPads.length;
  await pressKey(padKey, plainButton);
  equal('a pad hotkey does not fire while a button is focused', triggeredPads.length - padsBefore, 0);
  padsBefore = triggeredPads.length;
  await pressKey(padKey, textInput);
  equal('a pad hotkey does not fire while an input is focused', triggeredPads.length - padsBefore, 0);

  // Modifier chords and held keys stay with the browser.
  togglesBefore = transportToggles;
  await pressKey(' ', keyboardDocument.body, { ctrlKey: true });
  await pressKey(' ', keyboardDocument.body, { metaKey: true });
  await pressKey(' ', keyboardDocument.body, { altKey: true });
  await pressKey(' ', keyboardDocument.body, { repeat: true });
  equal('modifier chords and held keys never toggle the transport', transportToggles - togglesBefore, 0);

  padsBefore = triggeredPads.length;
  await pressKey(padKey, keyboardDocument.body, { repeat: true });
  equal('a held pad key fires once', triggeredPads.length - padsBefore, 0);

  check(
    'non-interactive targets stay global',
    isInteractiveTarget(keyboardDocument.body) === false && isInteractiveTarget(null) === false,
  );

  await act(async () => {
    keyboardRoot.unmount();
  });

  /* ------------------------------------------------ meter update suppression */
  section('Meter update suppression');
  // An isolated document with a hand-driven animation-frame queue, so the number
  // of analyser reads and the number of commits are both exact.
  const meterDom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost:3000/',
  });
  installDom(meterDom);
  Object.defineProperty(meterDom.window.document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });

  const frameQueue: FrameRequestCallback[] = [];
  let frameToken = 0;
  installGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frameToken += 1;
    frameQueue.push(callback);
    return frameToken;
  });
  installGlobal('cancelAnimationFrame', (): void => undefined);

  const meterEngine = getAudioEngine();
  // Readings inside a single 12-segment rung, apart from the deliberate crossing.
  let noisyReadings: readonly number[] = [0.42, 0.4301, 0.4377, 0.4402, 0.4288];
  let readingIndex = 0;
  let analyserReads = 0;
  meterEngine.getStereoLevels = () => {
    const left = noisyReadings[readingIndex % noisyReadings.length];
    const right = noisyReadings[(readingIndex + 2) % noisyReadings.length];
    readingIndex += 1;
    analyserReads += 1;
    return { left, right };
  };
  const restoreStereoLevels = (): void => {
    delete (meterEngine as unknown as { getStereoLevels?: unknown }).getStereoLevels;
  };

  let commits = 0;
  const meterContainer = meterDom.window.document.createElement('div');
  meterDom.window.document.body.appendChild(meterContainer);
  const { createRoot } = await import('react-dom/client');
  const meterRoot = createRoot(meterContainer);
  await act(async () => {
    meterRoot.render(
      createElement(
        Profiler,
        {
          id: 'stereo-meter',
          onRender: () => {
            commits += 1;
          },
        },
        createElement(StereoVuMeter, { isInitialized: true, intervalMs: 16 }),
      ),
    );
  });
  check('the isolated meter commits its first frame', commits > 0, `${commits} commits`);

  // A single monotonic clock, so every pumped frame is past `intervalMs`.
  let frameTime = 1000;
  const pumpFrames = async (frames: number): Promise<void> => {
    for (let frame = 0; frame < frames; frame += 1) {
      const pending = frameQueue.splice(0, frameQueue.length);
      if (pending.length === 0) return;
      frameTime += 40;
      await act(async () => {
        pending.forEach((callback) => {
          callback(frameTime);
        });
      });
    }
  };

  const readsBeforeNoise = analyserReads;
  const commitsBeforeNoise = commits;
  await pumpFrames(10);
  const noiseReads = analyserReads - readsBeforeNoise;
  const noiseCommits = commits - commitsBeforeNoise;

  check(
    'the running meter samples the analyser',
    noiseReads >= 8,
    `${noiseReads} reads`,
  );
  // React may commit one extra render after a state change before its eager
  // bailout takes over. The regression signal is that commits stop tracking the
  // frame count: without quantization every frame would commit.
  check(
    'identical visible rungs stop the meter from re-rendering every frame',
    noiseCommits <= 2,
    `${noiseReads} reads -> ${noiseCommits} commits`,
  );
  check(
    'the visible level holds one rung for the whole noise burst',
    meterContainer.textContent?.includes('left 42 percent') === true &&
      meterContainer.textContent?.includes('right 42 percent') === true,
    meterContainer.textContent ?? '',
  );

  // Positive control: crossing a rung must commit, which also proves the commit
  // counter is live rather than silently disabled.
  noisyReadings = [0.92, 0.95];
  const commitsBeforeCrossing = commits;
  await pumpFrames(3);
  check(
    'crossing a rung re-renders the meter',
    commits > commitsBeforeCrossing,
    `${commits} commits`,
  );
  check(
    'the crossed reading lights the louder rungs',
    meterContainer.textContent?.includes('left 92 percent') === true &&
      meterContainer.textContent?.includes('right 92 percent') === true,
    meterContainer.textContent ?? '',
  );

  restoreStereoLevels();
  installGlobal('requestAnimationFrame', meterDom.window.requestAnimationFrame);
  installGlobal('cancelAnimationFrame', meterDom.window.cancelAnimationFrame);
  await act(async () => {
    meterRoot.unmount();
  });

  section('Shared element descriptor probe');
  // Settles whether reusing one element object at two tree positions is itself
  // a hydration hazard, independent of the app code.
  function SharedElementProbe(): ReactElement {
    const shared = createElement('span', { 'data-probe': 'shared' }, 'SHARED');
    return createElement(
      'div',
      null,
      createElement('div', null, shared),
      createElement('div', null, shared),
    );
  }

  const probeHtml = renderToString(createElement(SharedElementProbe));
  const probeDom = new JSDOM(
    `<!doctype html><html><body><div id="probe">${probeHtml}</div></body></html>`,
    { pretendToBeVisual: true, url: 'http://localhost:3000/' },
  );
  installDom(probeDom);
  const probeContainer = probeDom.window.document.getElementById('probe');
  const probeCapture = captureConsole();
  let probeThrew: string | null = null;
  try {
    await act(async () => {
      if (probeContainer !== null) {
        hydrateRoot(probeContainer, createElement(SharedElementProbe));
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  } catch (error) {
    probeThrew = String(error);
  }
  const probeMessages = probeCapture.messages;
  probeCapture.restore();

  equal('the probe renders two copies', probeDom.window.document.querySelectorAll('[data-probe]').length, 2);
  check('reusing one element descriptor does not throw', probeThrew === null, probeThrew ?? undefined);
  check(
    'reusing one element descriptor is not a hydration error',
    findHydrationErrors(probeMessages).length === 0,
    probeMessages.slice(0, 2).join(' | '),
  );
  console.log(
    probeMessages.length === 0
      ? '    note: React 19 accepted the shared element descriptor with no warning'
      : `    note: React 19 warned: ${probeMessages[0]}`,
  );

  section('Store reset sanity');
  useSequencerStore.setState({
    pattern: createDefaultPattern(1),
    isDirty: false,
    isPlaying: false,
    storageError: null,
    isQuotaExceeded: false,
    isUsingMemoryFallback: false,
  });
  equal('the store resets cleanly', useSequencerStore.getState().isDirty, false);

  /* --------------------------------------------------------------- summary */

  const total = passed + failures.length;
  console.log(`\n${'='.repeat(60)}`);
  if (failures.length === 0) {
    console.log(`HYDRATION GATE PASSED \u2014 ${passed}/${total} checks green.`);
    process.exit(0);
  }
  console.log(`HYDRATION GATE FAILED \u2014 ${failures.length}/${total} checks failed:`);
  for (const failure of failures) {
    console.log(`  \u2717 ${failure}`);
  }
  process.exit(1);
}

void main();
