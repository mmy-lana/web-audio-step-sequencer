/**
 * Phase 3 quality gate — Zustand store behaviour.
 *
 *   npx tsx scripts/verify-store.ts
 *
 * Drives the real store (no mocks) through hydration, mutation sanitation,
 * dirty-flag transitions and every slot action. Runs under Node, where the lazy
 * storage adapter transparently uses its in-memory fallback.
 */
import {
  BPM_LIMITS,
  SWING_LIMITS,
  getStep,
  getStepRange,
  isTrackAudible,
  selectAnySoloed,
  useSequencerStore,
} from '../src/store/useSequencerStore';
import type { SequencerStoreState } from '../src/store/useSequencerStore';
import { createDefaultPattern, TRACK_COUNT } from '../src/lib/constants/defaultPatterns';
import { STORAGE_KEYS } from '../src/lib/constants/storageKeys';
import {
  clearWorkingCopy,
  exportPatternToJson,
  getSlotMetadataList,
  safeStorage,
} from '../src/lib/storage/patternStorage';
import {
  clearPlayhead,
  getActiveStep,
  getRegisteredElementCount,
  registerStepElement,
  setActiveStep,
} from '../src/lib/utils/playheadRegistry';

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

const store = useSequencerStore;

function state(): SequencerStoreState {
  return store.getState();
}

/** Wipes every storage slot and the working copy between scenarios. */
function resetStorage(): void {
  for (let slot = 1; slot <= 8; slot++) {
    safeStorage.removeItem(`${STORAGE_KEYS.PATTERN_SLOT_PREFIX}${slot}`);
  }
  clearWorkingCopy();
}

function resetStore(): void {
  store.setState({
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
  });
}

/* ------------------------------------------------------------ 1. hydration */

section('Hydration');
resetStorage();
resetStore();
equal('store starts unhydrated', state().hasHydrated, false);
equal('store starts clean', state().isDirty, false);
equal('initial pattern is the 16-step factory default', state().pattern.stepCount, 16);

state().hydrateFromStorage();
check('hydration completes', state().hasHydrated);
equal('hydration selects the pattern slot', state().activeSlot, 1);
equal('hydration clears the dirty flag', state().isDirty, false);
equal('hydration clears the remote-change flag', state().remoteChangeAvailable, false);
equal('hydration populates slot metadata', state().slotMetadata.length, 8);
check(
  'hydration reports every slot empty',
  state().slotMetadata.every((entry) => entry.isEmpty && !entry.isCorrupt),
);

// A persisted working copy must win over the factory default.
const persisted = { ...createDefaultPattern(4), bpm: 143, name: 'RESTORED GROOVE' };
safeStorage.setItem(STORAGE_KEYS.WORKING_COPY, JSON.stringify(persisted));
resetStore();
state().hydrateFromStorage();
equal('hydration restores the persisted tempo', state().pattern.bpm, 143);
equal('hydration restores the persisted name', state().pattern.name, 'RESTORED GROOVE');
equal('hydration restores the persisted slot', state().activeSlot, 4);

// A corrupt working copy must fall back to the factory default.
safeStorage.setItem(STORAGE_KEYS.WORKING_COPY, '{"broken":');
resetStore();
state().hydrateFromStorage();
equal('corrupt working copy falls back to the default', state().pattern.bpm, 120);
check('corrupt fallback still hydrates', state().hasHydrated);
clearWorkingCopy();

/* ----------------------------------------------------- 2. integer sanitation */

section('Mutation sanitation');
resetStore();
state().hydrateFromStorage();

state().setBpm(127.6);
equal('setBpm rounds to an integer', state().pattern.bpm, 128);
state().setBpm(5000);
equal('setBpm clamps to the ceiling', state().pattern.bpm, BPM_LIMITS.max);
state().setBpm(-40);
equal('setBpm clamps to the floor', state().pattern.bpm, BPM_LIMITS.min);
state().setBpm(Number.NaN);
equal('setBpm survives a NaN knob readout', state().pattern.bpm, 120);
state().setBpm(128);
check('a real change marks the pattern dirty', state().isDirty);

state().setSwing(0.9);
equal('setSwing caps at the 3:1 ratio', state().pattern.swing, SWING_LIMITS.max);
state().setSwing(0.2);
equal('setSwing accepts an in-range value', state().pattern.swing, 0.2);

state().setTrackVolume(0, 5);
equal('setTrackVolume clamps to 1', state().pattern.tracks[0].volume, 1);
state().setTrackVolume(0, -2);
equal('setTrackVolume clamps to 0', state().pattern.tracks[0].volume, 0);
state().setTrackPan(0, -9);
equal('setTrackPan clamps to -1', state().pattern.tracks[0].pan, -1);
state().setTrackPan(0, 0.25);
equal('setTrackPan accepts an in-range value', state().pattern.tracks[0].pan, 0.25);

state().updateMasterFx({ filter: { cutoff: 999999, resonance: 99 } });
equal('master filter cutoff clamps', state().pattern.masterFx.filter.cutoff, 20000);
equal('master filter resonance clamps', state().pattern.masterFx.filter.resonance, 20);
state().updateMasterFx({ delay: { time: 5, feedback: 0.99 } });
equal('delay time clamps', state().pattern.masterFx.delay.time, 1);
equal('delay feedback clamps below runaway', state().pattern.masterFx.delay.feedback, 0.95);
state().updateMasterFx({ distortion: { drive: 500 }, masterVolume: 9 });
equal('distortion drive clamps', state().pattern.masterFx.distortion.drive, 100);
equal('master volume allows 1.2 headroom only', state().pattern.masterFx.masterVolume, 1.2);
state().updateMasterFx({ filter: { type: 'highpass' } });
equal('filter type switches', state().pattern.masterFx.filter.type, 'highpass');
equal('partial FX patches preserve siblings', state().pattern.masterFx.delay.feedback, 0.95);

state().setSelectedTrackIndex(99);
equal('selected track clamps into range', state().selectedTrackIndex, TRACK_COUNT - 1);
state().setSelectedTrackIndex(-5);
equal('selected track clamps at zero', state().selectedTrackIndex, 0);

/* ------------------------------------------------------- 3. step programming */

section('Step programming');
resetStore();
state().hydrateFromStorage();

const beforeToggle = state().pattern.tracks[0].steps[0].active;
state().toggleStep(0, 0);
check('toggleStep flips the flag', state().pattern.tracks[0].steps[0].active !== beforeToggle);
state().toggleStep(0, 0);
equal('toggleStep is reversible', state().pattern.tracks[0].steps[0].active, beforeToggle);

state().updateStepParams(0, 2, { active: true, velocity: 4, probability: 9, pitchOffset: 99.4 });
const edited = getStep(state().pattern, 0, 2);
equal('step activated by params', edited?.active, true);
equal('step velocity clamps', edited?.velocity, 1);
equal('step probability clamps', edited?.probability, 1);
equal('step pitch offset rounds and clamps', edited?.pitchOffset, 24);
state().updateStepParams(0, 2, { pitchOffset: -3.6 });
equal('negative pitch offset rounds', getStep(state().pattern, 0, 2)?.pitchOffset, -4);
equal('unset params stay untouched', getStep(state().pattern, 0, 2)?.velocity, 1);

state().toggleStep(99, 0);
check('out-of-range track index is ignored', state().pattern.tracks.length === TRACK_COUNT);
state().toggleStep(0, 99);
check('out-of-range step index is ignored', state().pattern.tracks[0].steps.length === 16);

/* ---------------------------------------------------------- 4. step resizing */

section('Step resizing and paging');
resetStore();
state().hydrateFromStorage();
state().toggleStep(0, 3);
state().setStepCount(32);
equal('step count grows to 32', state().pattern.stepCount, 32);
check(
  'every track is resized',
  state().pattern.tracks.every((track) => track.steps.length === 32),
);
check(
  'resized tracks keep contiguous indices',
  state().pattern.tracks.every((track) => track.steps.every((step, i) => step.index === i)),
);
equal('programmed step survives the resize', state().pattern.tracks[0].steps[3].active, true);
equal('page resets on resize', state().stepPage, 0);

state().setStepPage(1);
equal('page 2 is reachable at 32 steps', state().stepPage, 1);
equal('page range covers the second bar', getStepRange(32, 1).join('-'), '16-31');

state().setStepCount(16);
equal('step count shrinks to 16', state().pattern.stepCount, 16);
equal('page resets when shrinking', state().stepPage, 0);
state().setStepPage(1);
equal('page 2 is rejected at 16 steps', state().stepPage, 0);
check('shrunk tracks hold 16 steps', state().pattern.tracks.every((track) => track.steps.length === 16));

/* -------------------------------------------------------- 5. mute/solo rules */

section('Mute and solo evaluation');
resetStore();
state().hydrateFromStorage();
check('all tracks audible by default', state().pattern.tracks.every((_t, i) => isTrackAudible(state().pattern.tracks, i)));
check('no solo by default', !selectAnySoloed(state()));

state().toggleMute(1);
check('muted track is silent', !isTrackAudible(state().pattern.tracks, 1));
check('other tracks stay audible', isTrackAudible(state().pattern.tracks, 0));

state().toggleSolo(2);
check('solo is registered', selectAnySoloed(state()));
check('soloed track is audible', isTrackAudible(state().pattern.tracks, 2));
check('non-soloed track is silenced by solo', !isTrackAudible(state().pattern.tracks, 0));
state().toggleMute(2);
check('a muted soloed track stays silent', !isTrackAudible(state().pattern.tracks, 2));

state().toggleSolo(2);
check('clearing solo restores audibility', isTrackAudible(state().pattern.tracks, 0));
check('mute survives solo changes', !isTrackAudible(state().pattern.tracks, 1));

/* ------------------------------------------------------------- 6. slot actions */

section('Slot actions');
resetStorage();
resetStore();
state().hydrateFromStorage();

equal('save into an empty slot succeeds', state().saveSlotAction(2), 'saved');
equal('saving clears the dirty flag', state().isDirty, false);
equal('saving moves the active slot', state().activeSlot, 2);
equal('pattern slot field follows the save', state().pattern.slot, 2);
const savedMeta = state().slotMetadata.find((entry) => entry.slot === 2);
check('slot metadata marks the slot occupied', savedMeta !== undefined && !savedMeta.isEmpty);
equal('slot metadata stores the pattern name', savedMeta?.name, state().pattern.name);
check('slot metadata carries a timestamp', (savedMeta?.updatedAt ?? 0) > 0);

equal('re-saving an occupied slot asks first', state().saveSlotAction(2), 'needs_confirm');
equal('confirmed overwrite succeeds', state().saveSlotAction(2, true), 'saved');

state().setBpm(101);
check('editing marks the pattern dirty again', state().isDirty);
equal('loading while dirty reports a conflict', state().loadSlotAction(2), 'dirty_conflict');
equal('a conflicting load keeps the working copy', state().pattern.bpm, 101);
equal('forced load discards local edits', state().loadSlotAction(2, true), 'loaded');
equal('forced load restores the saved tempo', state().pattern.bpm, 120);
equal('forced load clears the dirty flag', state().isDirty, false);
equal('loading an empty slot errors', state().loadSlotAction(7), 'error');
check('the load error surfaces in state', state().storageError !== null);
state().clearStorageError();
equal('storage error can be dismissed', state().storageError, null);
equal('an out-of-range slot errors', state().saveSlotAction(99), 'error');

check('duplicate copies the active slot', state().duplicateSlotAction(5));
const duplicated = state().slotMetadata.find((entry) => entry.slot === 5);
check('duplicate fills the target slot', duplicated !== undefined && !duplicated.isEmpty);
check('duplicate onto the active slot fails', !state().duplicateSlotAction(state().activeSlot));

state().clearSlotAction(5);
const cleared = state().slotMetadata.find((entry) => entry.slot === 5);
check('clear empties the slot', cleared !== undefined && cleared.isEmpty);
state().setBpm(90);
state().clearSlotAction(state().activeSlot);
check('clearing the active slot marks the pattern dirty', state().isDirty);

/* ---------------------------------------------------------------- 7. import */

section('Pattern import');
resetStore();
state().hydrateFromStorage();
const exported = exportPatternToJson({ ...createDefaultPattern(3), bpm: 155, name: 'IMPORTED' });
check('export succeeds', exported.ok && typeof exported.data === 'string', exported.error);

check('valid import is accepted', state().importPatternAction(exported.data ?? ''));
equal('import replaces the working copy', state().pattern.bpm, 155);
equal('import adopts the file slot', state().activeSlot, 3);
check('import marks the pattern dirty', state().isDirty);
equal('import clears any previous error', state().storageError, null);

check('malformed import is rejected', !state().importPatternAction('{ nope'));
check('rejected import surfaces an error', state().storageError !== null);
check('oversized import is rejected', !state().importPatternAction('{}', 600 * 1024));
check('schema-violating import is rejected', !state().importPatternAction(JSON.stringify({ bpm: 1 })));

/* ---------------------------------------------------------- 8. UI-only state */

section('UI state');
resetStore();
state().hydrateFromStorage();

state().setIsPlaying(true);
check('transport flag set', state().isPlaying);
state().setActiveMobileTab('fx');
equal('mobile tab switches', state().activeMobileTab, 'fx');
state().setIsEditMode(true);
check('edit mode set', state().isEditMode);
state().setEditingStep({ trackIndex: 2, stepIndex: 5 });
equal('editing step recorded', state().editingStep?.trackIndex, 2);
equal('editing step index recorded', state().editingStep?.stepIndex, 5);
state().setEditingStep({ trackIndex: 99, stepIndex: 99 });
equal('editing track index clamps', state().editingStep?.trackIndex, TRACK_COUNT - 1);
equal('editing step index clamps to the grid', state().editingStep?.stepIndex, 15);
state().setIsEditMode(false);
equal('leaving edit mode closes the sheet', state().editingStep, null);
state().setRemoteChangeAvailable(true);
check('remote change flag set', state().remoteChangeAvailable);
state().hydrateFromStorage();
check('re-hydration clears the remote flag', !state().remoteChangeAvailable);

/* ----------------------------------------------------- 9. playhead registry */

section('Playhead registry');
interface FakeElement {
  attributes: Map<string, string>;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  hasAttribute: (name: string) => boolean;
}

function createFakeElement(): FakeElement {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
  };
}

const elementA = createFakeElement();
const elementB = createFakeElement();
const elementC = createFakeElement();
const unregisterA = registerStepElement(0, elementA as unknown as HTMLElement);
const unregisterB = registerStepElement(0, elementB as unknown as HTMLElement);
const unregisterC = registerStepElement(4, elementC as unknown as HTMLElement);

equal('all elements registered', getRegisteredElementCount(), 3);
equal('cursor starts idle', getActiveStep(), null);

setActiveStep(0);
check('active column is lit', elementA.hasAttribute('data-playhead') && elementB.hasAttribute('data-playhead'));
check('other columns stay dark', !elementC.hasAttribute('data-playhead'));

setActiveStep(4);
check('cursor clears the previous column', !elementA.hasAttribute('data-playhead'));
check('cursor lights the new column', elementC.hasAttribute('data-playhead'));

const late = createFakeElement();
const unregisterLate = registerStepElement(4, late as unknown as HTMLElement);
check('a late element inherits the cursor', late.hasAttribute('data-playhead'));

clearPlayhead();
check('clearPlayhead darkens everything', !elementC.hasAttribute('data-playhead') && !late.hasAttribute('data-playhead'));
equal('cursor resets to idle', getActiveStep(), null);

unregisterA();
unregisterB();
unregisterC();
unregisterLate();
equal('unregistering removes every element', getRegisteredElementCount(), 0);

/* ----------------------------------------------------------------- summary */

const total = passed + failures.length;
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`PHASE 3 STORE GATE PASSED \u2014 ${passed}/${total} checks green.`);
  process.exit(0);
}
console.log(`PHASE 3 STORE GATE FAILED \u2014 ${failures.length}/${total} checks failed:`);
for (const failure of failures) {
  console.log(`  \u2717 ${failure}`);
}
process.exit(1);
