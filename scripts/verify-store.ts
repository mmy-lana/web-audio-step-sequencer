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
import { createDefaultPattern, DEFAULT_STEP_COUNT, TRACK_COUNT } from '../src/lib/constants/defaultPatterns';
import { STORAGE_KEYS, getSlotStorageKey } from '../src/lib/constants/storageKeys';
import {
  clearWorkingCopy,
  exportPatternToJson,
  loadPatternFromSlot,
  safeStorage,
} from '../src/lib/storage/patternStorage';
import { PatternSchema } from '../src/lib/validation/pattern';
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

section('Master FX deep immutability');
resetStore();
state().hydrateFromStorage();

const fxBefore = state().pattern.masterFx;
const filterBefore = fxBefore.filter;
const delayBefore = fxBefore.delay;
const distortionBefore = fxBefore.distortion;

state().updateMasterFx({ delay: { feedback: 0.5 } });
const fxAfter = state().pattern.masterFx;

check('a patch produces a new masterFx object', fxAfter !== fxBefore);
check('the nested filter object is rebuilt, not shared', fxAfter.filter !== filterBefore);
check('the nested delay object is rebuilt, not shared', fxAfter.delay !== delayBefore);
check(
  'untouched nested objects are still rebuilt',
  fxAfter.distortion !== distortionBefore,
);
equal('the patched field is applied', fxAfter.delay.feedback, 0.5);
equal('sibling delay fields survive the patch', fxAfter.delay.time, delayBefore.time);
equal('sibling filter fields survive the patch', fxAfter.filter.cutoff, filterBefore.cutoff);
equal('the filter type survives a delay-only patch', fxAfter.filter.type, filterBefore.type);

// Mutating the previous snapshot must not reach the new state.
filterBefore.cutoff = 1;
delayBefore.feedback = 0.9;
equal('the new state is not aliased to the old filter object', state().pattern.masterFx.filter.cutoff, 18000);
equal('the new state is not aliased to the old delay object', state().pattern.masterFx.delay.feedback, 0.5);

// An explicitly undefined patch value must not blank a stored setting.
state().updateMasterFx({ filter: { type: undefined } });
equal(
  'an explicit undefined cannot blank a stored setting',
  state().pattern.masterFx.filter.type,
  'lowpass',
);
state().updateMasterFx({ distortion: { drive: undefined } });
equal(
  'an explicit undefined cannot blank a numeric setting',
  state().pattern.masterFx.distortion.drive,
  12,
);
state().updateMasterFx({ filter: { type: 'bandpass' }, delay: { time: 0.4 }, distortion: { drive: 40 } });
equal('a multi-section patch applies every section', state().pattern.masterFx.filter.type, 'bandpass');
equal('a multi-section patch applies the delay', state().pattern.masterFx.delay.time, 0.4);
equal('a multi-section patch applies the drive', state().pattern.masterFx.distortion.drive, 40);
equal(
  'unpatched sections keep their values',
  state().pattern.masterFx.delay.feedback,
  0.5,
);

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
state().clearStorageError();
equal('storage error can be dismissed', state().storageError, null);
equal('an out-of-range slot save errors', state().saveSlotAction(99), 'error');
equal('an out-of-range slot load errors', state().loadSlotAction(99), 'error');
check('the invalid slot surfaces an error', state().storageError !== null);
equal('a fractional slot load errors', state().loadSlotAction(2.5), 'error');
equal('a negative slot load errors', state().loadSlotAction(-1), 'error');
state().clearStorageError();

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

/* ------------------------------------------------- 6a. empty slot handling */

section('Empty slot initialization');
resetStorage();
resetStore();
state().hydrateFromStorage();

check(
  'a clean storage reset leaves all eight slots empty',
  state().slotMetadata.length === 8 &&
    state().slotMetadata.every((entry) => entry.isEmpty && !entry.isCorrupt),
);
equal('slot 2 is saved for comparison', state().saveSlotAction(2), 'saved');
equal('the working copy is clean', state().isDirty, false);
const savedSlotTwoName = state().slotMetadata.find((entry) => entry.slot === 2)?.name;

equal('selecting an empty slot creates a working copy', state().loadSlotAction(7), 'created');
equal('an empty slot raises no storage error', state().storageError, null);
equal('the created pattern adopts the requested slot', state().pattern.slot, 7);
equal('the created pattern id is slot-specific', state().pattern.id, createDefaultPattern(7).id);
equal('the active slot follows the created pattern', state().activeSlot, 7);
check('the created pattern satisfies the schema', PatternSchema.safeParse(state().pattern).success);
equal('the created pattern keeps the default step count', state().pattern.stepCount, DEFAULT_STEP_COUNT);
equal('the created pattern carries every track', state().pattern.tracks.length, TRACK_COUNT);
check(
  'every created track holds a contiguous full step grid',
  state().pattern.tracks.every(
    (track) =>
      track.steps.length === DEFAULT_STEP_COUNT &&
      track.steps.every((step, index) => step.index === index),
  ),
);
check('the created pattern is a new unsaved working copy', state().isDirty);
state().setBpm(111);
equal('editing the new pattern is allowed', state().pattern.bpm, 111);
check(
  'the slot stays empty until it is saved',
  state().slotMetadata.find((entry) => entry.slot === 7)?.isEmpty === true,
);
equal(
  'no other slot was overwritten',
  state().slotMetadata.find((entry) => entry.slot === 2)?.name,
  savedSlotTwoName,
);
equal('a saved slot still loads after the empty selection', state().loadSlotAction(2, true), 'loaded');
equal('the loaded slot keeps its tempo', state().pattern.bpm, 120);

equal('re-selecting the new slot is offered again', state().loadSlotAction(7, true), 'created');
equal('re-selecting restores the fresh default tempo', state().pattern.bpm, 120);
state().setBpm(111);
equal('saving the new pattern into the empty slot succeeds', state().saveSlotAction(7), 'saved');
equal('saving clears the dirty flag', state().isDirty, false);
check(
  'the slot is now occupied',
  state().slotMetadata.find((entry) => entry.slot === 7)?.isEmpty === false,
);
equal('the populated slot reports its stored name', state().slotMetadata.find((entry) => entry.slot === 7)?.name, 'FACTORY PATTERN 7');
equal('the saved slot reloads with the edit', state().loadSlotAction(7, true), 'loaded');
equal('the reloaded slot keeps the edited tempo', state().pattern.bpm, 111);
equal('re-saving the populated slot asks first', state().saveSlotAction(7), 'needs_confirm');

section('Corrupt and invalid slots still fail');
const workingSlotBeforeCorruption = state().pattern.slot;
// A slot holding unparseable data is corruption, not an empty slot.
safeStorage.setItem(getSlotStorageKey(6), '{"broken":');
equal('a corrupt slot reports an error', state().loadSlotAction(6, true), 'error');
check('corruption surfaces a storage error', (state().storageError ?? '').length > 0);
state().refreshSlotMetadata();
check(
  'corruption is flagged, never reported as empty',
  state().slotMetadata.find((entry) => entry.slot === 6)?.isCorrupt === true &&
    state().slotMetadata.find((entry) => entry.slot === 6)?.isEmpty === false,
);
state().clearStorageError();

// Valid JSON that fails the schema is corruption too.
safeStorage.setItem(getSlotStorageKey(5), JSON.stringify({ bpm: 1 }));
equal('a schema-invalid slot reports an error', state().loadSlotAction(5, true), 'error');
check('schema corruption surfaces an error', state().storageError !== null);
state().clearStorageError();

// Valid pattern data stored under the wrong key is a slot mismatch.
safeStorage.setItem(getSlotStorageKey(4), JSON.stringify(createDefaultPattern(3)));
equal('a slot mismatch reports an error', state().loadSlotAction(4, true), 'error');
check(
  'the mismatch error names the corruption',
  (state().storageError ?? '').includes('mismatch'),
  state().storageError ?? '',
);
state().clearStorageError();

// A corrupt slot must never be silently initialized the way an empty one is.
equal('a corrupt load never becomes the active slot', state().activeSlot, workingSlotBeforeCorruption);
check(
  'a corrupt load never creates a working pattern for that slot',
  state().pattern.slot === workingSlotBeforeCorruption,
);
resetStorage();

/* ------------------------------------------- 6b. dirty slot load (no dialog) */

section('Dirty slot load guard');
resetStorage();
resetStore();
state().hydrateFromStorage();

// Two populated slots, with the second one left active and then edited.
equal('slot 4 saves the factory copy', state().saveSlotAction(4), 'saved');
equal('slot 2 saves the factory copy', state().saveSlotAction(2, true), 'saved');
equal('the working copy is active on slot 2', state().activeSlot, 2);
state().setBpm(148);
check('the working copy is dirty', state().isDirty);

const spuriousConflict = state().loadSlotAction(4);
equal('a dirty slot load reports a conflict instead of loading', spuriousConflict, 'dirty_conflict');
equal('the conflict keeps the working tempo', state().pattern.bpm, 148);
equal('the conflict keeps the working slot field', state().pattern.slot, 2);
equal('the conflict keeps the active slot', state().activeSlot, 2);
check('the conflict stays dirty', state().isDirty);
equal('the conflict raises no storage error', state().storageError, null);
equal('the conflict leaves the stored slot untouched', loadPatternFromSlot(4).data?.bpm, 120);

// Cancelling is a no-op by construction: the conflict path never mutated state.
equal('cancelling preserves the working tempo', state().pattern.bpm, 148);
equal('cancelling preserves the active slot', state().activeSlot, 2);

equal('a confirmed load discards the working copy', state().loadSlotAction(4, true), 'loaded');
equal('a confirmed load adopts the target slot', state().activeSlot, 4);
equal('a confirmed load restores the stored tempo', state().pattern.bpm, 120);
equal('a confirmed load clears the dirty flag', state().isDirty, false);

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
