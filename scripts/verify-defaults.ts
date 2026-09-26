/**
 * Phase 1 quality gate.
 *
 *   npx tsx scripts/verify-defaults.ts
 *
 * Validates the factory pattern against `PatternSchema`, exercises every slot
 * persistence round-trip (including corruption and quota paths) and asserts the
 * pure math helpers. Exits non-zero on the first failed section.
 */
import {
  MAX_IMPORT_SIZE_BYTES,
  MAX_JSON_DEPTH,
  PatternSchema,
  SynthParamsSchema,
  formatValidationIssues,
  measureJsonDepth,
  measureUtf8ByteLength,
  validatePatternJson,
} from '../src/lib/validation/pattern';
import {
  DETERMINISTIC_TIMESTAMP,
  MAX_BPM,
  MAX_SWING,
  MIN_BPM,
  MIN_SWING,
  SLOT_PRESETS,
  TRACK_COUNT,
  createDefaultMasterFx,
  createDefaultPattern,
  createStepGrid,
  createDefaultTrack,
  resizeStepGrid,
} from '../src/lib/constants/defaultPatterns';
import {
  PATTERN_SLOT_COUNT,
  STORAGE_KEYS,
  clampPatternSlot,
  getSlotStorageKey,
  isValidPatternSlot,
} from '../src/lib/constants/storageKeys';
import { COLOR_MAP, TRACK_COLOR_ORDER, getColorByIndex, getColorDefinition } from '../src/lib/constants/colorMap';
import {
  SOUNDBOARD_PAD_COUNT,
  SOUNDBOARD_PRESET_TEMPLATES,
  createSoundboardPads,
  getSoundboardPadByKey,
  getSoundboardPadByIndex,
} from '../src/lib/constants/soundboardPresets';
import {
  LazySafeStorageAdapter,
  clearPatternSlot,
  clearWorkingCopy,
  duplicateSlot,
  exportPatternToJson,
  findFirstEmptySlot,
  getSlotMetadataList,
  getStorageDiagnostics,
  importPatternFromJson,
  loadPatternFromSlot,
  loadWorkingCopy,
  safeStorage,
  savePatternToSlot,
  saveWorkingCopy,
  subscribeToStorageChanges,
} from '../src/lib/storage/patternStorage';
import {
  applyPitchOffset,
  clamp,
  computePeakLevel,
  computeRmsLevel,
  computeSwingIntervalSeconds,
  decibelsToGain,
  denormalizeLinear,
  denormalizeLog,
  formatBpm,
  formatHertz,
  formatMilliseconds,
  formatPercent,
  formatSignedSemitones,
  frequencyToMidi,
  gainToDecibels,
  midiToFrequency,
  normalizeLevelToMeter,
  normalizeLinear,
  normalizeLog,
  patternDurationSeconds,
  roundTo,
  sanitizeBpm,
  sanitizeMasterVolume,
  sanitizePan,
  sanitizePitchOffset,
  sanitizeStepCount,
  sanitizeSwing,
  sanitizeVolume,
  secondsPerStep,
  semitonesToRatio,
  snapToStep,
} from '../src/lib/utils/audioMath';
import {
  TAP_TEMPO_RESET_TIMEOUT_MS,
  TapTempoTracker,
  computeBpmFromIntervals,
  getBpmFromTapTimestamps,
} from '../src/lib/utils/tapTempo';

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
  const message = detail ? `${currentSection} :: ${label} -> ${detail}` : `${currentSection} :: ${label}`;
  failures.push(message);
  console.log(`  \u2717 ${label}${detail ? ` -> ${detail}` : ''}`);
}

function equal<T>(label: string, actual: T, expected: T): void {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, received ${String(actual)}`);
}

function throws(label: string, fn: () => unknown): void {
  try {
    fn();
    check(label, false, 'expected a throw but none occurred');
  } catch (err) {
    check(label, true);
    void err;
  }
}

function cloneRaw(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function trackListOf(raw: Record<string, unknown>): Record<string, unknown>[] {
  return raw.tracks as Record<string, unknown>[];
}

function stepListOf(track: Record<string, unknown>): Record<string, unknown>[] {
  return track.steps as Record<string, unknown>[];
}

/* ----------------------------------------------------- simulated localStorage */

interface FakeStorage {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
  readonly map: Map<string, string>;
  failNextWrite: boolean;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  readonly listenerCount: number;
}

function createFakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  const listeners = new Set<(event: unknown) => void>();
  return {
    map,
    failNextWrite: false,
    get listenerCount() {
      return listeners.size;
    },
    setItem(key, value) {
      if (this.failNextWrite) {
        this.failNextWrite = false;
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      map.set(key, String(value));
    },
    getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    removeItem(key) {
      map.delete(key);
    },
    addEventListener(type, listener) {
      if (type === 'storage') listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
}

const fakeStorage = createFakeStorage();
const fakeWindow = {
  localStorage: fakeStorage,
  addEventListener: fakeStorage.addEventListener.bind(fakeStorage),
  removeEventListener: fakeStorage.removeEventListener.bind(fakeStorage),
};
/** Unchecked global accessor: the harness swaps `window` in and out on purpose. */
const globalRef = globalThis as unknown as Record<string, unknown>;
// Install before the first storage call so the lazy probe takes the real branch.
globalRef.window = fakeWindow;

/* ------------------------------------------------------------ 1. schema core */

section('Schema invariants');
const base = createDefaultPattern(1);
const baseParse = PatternSchema.safeParse(base);
check('createDefaultPattern() satisfies PatternSchema', baseParse.success, baseParse.success ? undefined : formatValidationIssues(baseParse.error));
equal('schemaVersion is 1', base.schemaVersion, 1);
equal('slot defaults to 1', base.slot, 1);
equal('stepCount defaults to 16', base.stepCount, 16);
equal('track count is 8', base.tracks.length, TRACK_COUNT);
equal('bpm defaults to 120', base.bpm, 120);
equal('swing defaults to 0', base.swing, 0);
equal('createdAt is the deterministic constant', base.createdAt, DETERMINISTIC_TIMESTAMP);
equal('updatedAt is the deterministic constant', base.updatedAt, DETERMINISTIC_TIMESTAMP);
check(
  'every track has stepCount steps with contiguous indices',
  base.tracks.every(
    (track) =>
      track.steps.length === base.stepCount && track.steps.every((step, i) => step.index === i),
  ),
);
check(
  'every track declares a distinct instrument',
  new Set(base.tracks.map((track) => track.instrument)).size === TRACK_COUNT,
);
check(
  'every track color is registered in COLOR_MAP',
  base.tracks.every((track) => COLOR_MAP[track.color] !== undefined),
);
check(
  'default pattern is byte-deterministic across calls',
  JSON.stringify(createDefaultPattern(1)) === JSON.stringify(base),
);
equal('default master fx volume', base.masterFx.masterVolume, 0.85);
check('createDefaultMasterFx() parses standalone', PatternSchema.safeParse({ ...base, masterFx: createDefaultMasterFx() }).success);

section('Schema rejections');
const badBpm = cloneRaw(base);
badBpm.bpm = 500;
check('bpm above 280 is rejected', !PatternSchema.safeParse(badBpm).success);

const fractionalBpm = cloneRaw(base);
fractionalBpm.bpm = 128.5;
check('fractional bpm is rejected', !PatternSchema.safeParse(fractionalBpm).success);

const badSwing = cloneRaw(base);
badSwing.swing = 0.6;
check('swing above 0.5 is rejected', !PatternSchema.safeParse(badSwing).success);

const badTrackCount = cloneRaw(base);
trackListOf(badTrackCount).pop();
check('seven tracks is rejected', !PatternSchema.safeParse(badTrackCount).success);

const badStepLength = cloneRaw(base);
stepListOf(trackListOf(badStepLength)[0]).pop();
check('step array shorter than stepCount is rejected', !PatternSchema.safeParse(badStepLength).success);

const badStepIndex = cloneRaw(base);
stepListOf(trackListOf(badStepIndex)[0])[3].index = 9;
check('non-contiguous step indices are rejected', !PatternSchema.safeParse(badStepIndex).success);

const badColor = cloneRaw(base);
trackListOf(badColor)[0].color = 'chartreuse';
check('unknown track color is rejected', !PatternSchema.safeParse(badColor).success);

const badSlot = cloneRaw(base);
badSlot.slot = 9;
check('slot above 8 is rejected', !PatternSchema.safeParse(badSlot).success);

const badVersion = cloneRaw(base);
badVersion.schemaVersion = 2;
check('unknown schemaVersion is rejected', !PatternSchema.safeParse(badVersion).success);

const badPitch = cloneRaw(base);
stepListOf(trackListOf(badPitch)[0])[0].pitchOffset = 30;
check('pitch offset above 24 is rejected', !PatternSchema.safeParse(badPitch).success);

const backwardsTime = cloneRaw(base);
backwardsTime.updatedAt = DETERMINISTIC_TIMESTAMP - 1;
check('updatedAt before createdAt is rejected', !PatternSchema.safeParse(backwardsTime).success);

section('validatePatternJson');
const serialized = JSON.stringify(base);
check('valid JSON payload parses', validatePatternJson(serialized).slot === 1);
throws('malformed JSON throws', () => validatePatternJson('{ not json'));
throws('schema violation throws', () => validatePatternJson(JSON.stringify({ ...base, bpm: 10 })));
throws('oversized payload throws', () =>
  validatePatternJson(JSON.stringify({ ...base, name: 'x'.repeat(MAX_IMPORT_SIZE_BYTES + 10) })),
);
check('utf8 byte measurement is exact', measureUtf8ByteLength('a\u00e9\u20ac') === 6, String(measureUtf8ByteLength('a\u00e9\u20ac')));

/* ------------------------------------------------------- 1b. hostile payloads */

section('Prototype-pollution hardening');
const validJson = JSON.stringify(base);
const hostileJson = `{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},${validJson.slice(1)}`;

const naiveParse = JSON.parse(hostileJson) as Record<string, unknown>;
check(
  'unrevived JSON.parse keeps an own __proto__ key',
  Object.prototype.hasOwnProperty.call(naiveParse, '__proto__'),
);

const hardened = validatePatternJson(hostileJson);
check(
  'the reviver strips the own __proto__ key',
  !Object.prototype.hasOwnProperty.call(hardened, '__proto__'),
);
check(
  'the reviver strips the own constructor key',
  !Object.prototype.hasOwnProperty.call(hardened, 'constructor'),
);
check(
  'Object.prototype is not polluted by __proto__',
  ({} as Record<string, unknown>)['polluted'] === undefined,
);
check(
  'Object.prototype is not polluted by constructor.prototype',
  ({} as Record<string, unknown>)['polluted'] === undefined,
);
equal('a hardened payload still validates', hardened.bpm, base.bpm);
equal('the hardened payload keeps every track', hardened.tracks.length, 8);
check(
  'the hardened payload keeps nested step data',
  hardened.tracks[0].steps.length === base.stepCount,
);

const pollutedImport = importPatternFromJson(hostileJson);
check('a hostile payload can still be imported safely', pollutedImport.ok);
check(
  'the imported pattern carries no prototype keys',
  pollutedImport.data !== undefined &&
    !Object.prototype.hasOwnProperty.call(pollutedImport.data, '__proto__'),
);
check(
  'importing a hostile payload does not pollute Object.prototype',
  ({} as Record<string, unknown>)['polluted'] === undefined,
);

section('Nesting depth limits');
equal('a flat object measures one level', measureJsonDepth({ a: 1 }), 1);
equal('nested arrays and objects are counted', measureJsonDepth({ a: [{ b: 1 }] }), 3);
equal('a primitive measures zero levels', measureJsonDepth(7), 0);
equal('null measures zero levels', measureJsonDepth(null), 0);
check(
  'a real pattern stays well inside the limit',
  measureJsonDepth(JSON.parse(validJson)) < MAX_JSON_DEPTH,
  String(measureJsonDepth(JSON.parse(validJson))),
);

const deepPayload = `${'{"a":'.repeat(MAX_JSON_DEPTH + 8)}1${'}'.repeat(MAX_JSON_DEPTH + 8)}`;
throws('an over-deep payload is rejected', () => validatePatternJson(deepPayload));
check(
  'the depth rejection is reported clearly',
  (() => {
    try {
      validatePatternJson(deepPayload);
      return false;
    } catch (error) {
      return error instanceof Error && error.message.includes('nested deeper');
    }
  })(),
);
check(
  'an over-deep payload is rejected by the import path too',
  !importPatternFromJson(deepPayload).ok,
);
check(
  'a payload exactly at the limit is still parsed',
  (() => {
    try {
      validatePatternJson(`${'{"a":'.repeat(MAX_JSON_DEPTH)}1${'}'.repeat(MAX_JSON_DEPTH)}`);
      return false;
    } catch (error) {
      // Schema rejection is expected; the depth guard must not be what fired.
      return error instanceof Error && !error.message.includes('nested deeper');
    }
  })(),
);

/* --------------------------------------------------------- 2. grid factories */

section('Grid factories');
const grid16 = createStepGrid(16, [{ index: 0, velocity: 0.5 }, { index: 15, pitchOffset: -3 }]);
equal('16-step grid length', grid16.length, 16);
equal('activated step velocity', grid16[0].velocity, 0.5);
equal('activated step pitch offset', grid16[15].pitchOffset, -3);
equal('inactive step defaults to probability 1', grid16[1].probability, 1);
check('grid parses inside a track', SynthParamsSchema.safeParse(createDefaultTrack(0, 16).params).success);
throws('out-of-range activation throws', () => createStepGrid(16, [{ index: 16 }]));
throws('duplicate activation throws', () => createStepGrid(16, [{ index: 2 }, { index: 2 }]));

const resized = resizeStepGrid(grid16, 32);
equal('resize preserves the first bar', resized[0].velocity, 0.5);
equal('resize grows to 32 steps', resized.length, 32);
check('resize keeps indices contiguous', resized.every((step, i) => step.index === i));
const shrunk = resizeStepGrid(resized, 16);
equal('resize shrinks back to 16 steps', shrunk.length, 16);

const pattern32 = createDefaultPattern(3, 32);
const parse32 = PatternSchema.safeParse(pattern32);
check('32-step pattern satisfies PatternSchema', parse32.success, parse32.success ? undefined : formatValidationIssues(parse32.error));
check('32-step tracks all hold 32 steps', pattern32.tracks.every((track) => track.steps.length === 32));
check(
  '32-step groove has no duplicate activations',
  pattern32.tracks.every((track) => {
    const active = track.steps.filter((step) => step.active).map((step) => step.index);
    return new Set(active).size === active.length;
  }),
);
check(
  '16-step groove has no duplicate activations',
  base.tracks.every((track) => {
    const active = track.steps.filter((step) => step.active).map((step) => step.index);
    return new Set(active).size === active.length;
  }),
);
check('every factory track programs at least one step', base.tracks.every((track) => track.steps.some((step) => step.active)));

section('Slot clamping');
equal('slot 0 clamps to 1', createDefaultPattern(0).slot, 1);
equal('slot 99 clamps to 8', createDefaultPattern(99).slot, PATTERN_SLOT_COUNT);
equal('clampPatternSlot(NaN) falls back to 1', clampPatternSlot(Number.NaN), 1);
check('isValidPatternSlot accepts 8', isValidPatternSlot(8));
check('isValidPatternSlot rejects 9', !isValidPatternSlot(9));
check('isValidPatternSlot rejects 1.5', !isValidPatternSlot(1.5));
equal('slot storage key composition', getSlotStorageKey(4), `${STORAGE_KEYS.PATTERN_SLOT_PREFIX}4`);

section('Slot genre seeding');
const seededSlots = Array.from({ length: PATTERN_SLOT_COUNT }, (_unused, index) => index + 1);
const seededPatterns = seededSlots.map((slot) => createDefaultPattern(slot));
check(
  'every slot seeds a named genre',
  seededPatterns.every((pattern) => pattern.name.length > 0 && !pattern.name.startsWith('FACTORY PATTERN')),
);
check(
  'the eight slot names are all distinct',
  new Set(seededPatterns.map((pattern) => pattern.name)).size === PATTERN_SLOT_COUNT,
);
check(
  'every seeded tempo stays inside the transport bounds',
  seededPatterns.every((pattern) => pattern.bpm >= MIN_BPM && pattern.bpm <= MAX_BPM),
);
check(
  'every seeded swing stays inside the swing bounds',
  seededPatterns.every((pattern) => pattern.swing >= MIN_SWING && pattern.swing <= MAX_SWING),
);
check(
  'every seeded pattern satisfies the schema',
  seededPatterns.every((pattern) => PatternSchema.safeParse(pattern).success),
);
check(
  'seeding is deterministic across calls',
  seededSlots.every((slot) => createDefaultPattern(slot).name === createDefaultPattern(slot).name),
);
check(
  'a clamped slot takes the preset of the slot it clamps to',
  createDefaultPattern(0).name === SLOT_PRESETS[1].name && createDefaultPattern(99).name === SLOT_PRESETS[8].name,
);

/* --------------------------------------------------------------- 3. palette */

section('Color map');
equal('palette order matches map keys', TRACK_COLOR_ORDER.length, Object.keys(COLOR_MAP).length);
check(
  'every color definition is fully populated',
  TRACK_COLOR_ORDER.every((color) => {
    const definition = getColorDefinition(color);
    return Object.values(definition).every((value) => typeof value === 'string' && value.length > 0);
  }),
);
equal('getColorByIndex wraps modulo the palette', getColorByIndex(9), TRACK_COLOR_ORDER[1]);
equal('getColorByIndex handles negatives', getColorByIndex(-1), TRACK_COLOR_ORDER[TRACK_COLOR_ORDER.length - 1]);

/* ------------------------------------------------------------ 4. soundboard */

section('Soundboard presets');
equal('pad bank holds 16 pads', SOUNDBOARD_PRESET_TEMPLATES.length, SOUNDBOARD_PAD_COUNT);
check('pad ids are unique', new Set(SOUNDBOARD_PRESET_TEMPLATES.map((pad) => pad.id)).size === SOUNDBOARD_PAD_COUNT);
check(
  'pad key bindings are unique',
  new Set(SOUNDBOARD_PRESET_TEMPLATES.map((pad) => pad.keyBinding)).size === SOUNDBOARD_PAD_COUNT,
);
check(
  'every pad voice satisfies SynthParamsSchema',
  SOUNDBOARD_PRESET_TEMPLATES.every((pad) => SynthParamsSchema.safeParse(pad.params).success),
);
check('every pad starts untriggered', SOUNDBOARD_PRESET_TEMPLATES.every((pad) => pad.lastTriggeredAt === null));
equal('pad lookup is case-insensitive', getSoundboardPadByKey('Q')?.id, 'pad-05-hat-closed');
equal('unknown key returns null', getSoundboardPadByKey('~'), null);
equal('out-of-range pad index returns null', getSoundboardPadByIndex(16), null);
const padCopies = createSoundboardPads();
padCopies[0].params.envelope.decay = 1.9;
check('createSoundboardPads() returns isolated copies', SOUNDBOARD_PRESET_TEMPLATES[0].params.envelope.decay !== 1.9);

/* ------------------------------------------------------------- 5. audioMath */

section('audioMath');
equal('clamp floors non-finite input', clamp(Number.NaN, 4, 8), 4);
equal('clamp respects the ceiling', clamp(12, 4, 8), 8);
equal('roundTo removes float drift', roundTo(0.1 + 0.2, 2), 0.3);
equal('snapToStep quantizes', snapToStep(7.4, 0.5), 7.5);
equal('sanitizeBpm rounds to an integer', sanitizeBpm(127.6), 128);
equal('sanitizeBpm clamps low', sanitizeBpm(10), MIN_BPM);
equal('sanitizeBpm clamps high', sanitizeBpm(900), MAX_BPM);
equal('sanitizePitchOffset rounds', sanitizePitchOffset(-4.6), -5);
equal('sanitizePitchOffset clamps', sanitizePitchOffset(99), 24);
equal('sanitizeSwing caps at 0.5', sanitizeSwing(0.9), 0.5);
equal('sanitizeVolume caps at 1', sanitizeVolume(1.8), 1);
equal('sanitizePan clamps bipolar', sanitizePan(-3), -1);
equal('sanitizeMasterVolume allows headroom to 1.2', sanitizeMasterVolume(1.2), 1.2);
equal('sanitizeStepCount snaps up past the midpoint', sanitizeStepCount(31), 32);
equal('sanitizeStepCount snaps down below the midpoint', sanitizeStepCount(17), 16);
equal('sanitizeStepCount accepts the exact 32', sanitizeStepCount(32), 32);
equal('sanitizeStepCount floors non-finite input', sanitizeStepCount(Number.NaN), 16);
equal('midiToFrequency(69) is concert A', roundTo(midiToFrequency(69), 4), 440);
equal('frequencyToMidi inverts midiToFrequency', roundTo(frequencyToMidi(440), 6), 69);
equal('semitonesToRatio(12) is an octave', roundTo(semitonesToRatio(12), 6), 2);
equal('applyPitchOffset floors at 20 Hz', applyPitchOffset(10, -24), 20);
equal('decibelsToGain(0) is unity', decibelsToGain(0), 1);
equal('gainToDecibels(1) is 0 dB', gainToDecibels(1), 0);
equal('gainToDecibels(0) floors at -120', gainToDecibels(0), -120);
equal('normalizeLinear midpoint', normalizeLinear(5, 0, 10), 0.5);
equal('denormalizeLinear midpoint', denormalizeLinear(0.5, 0, 10), 5);
equal('normalizeLog midpoint is geometric', roundTo(normalizeLog(Math.sqrt(20 * 20000), 20, 20000), 6), 0.5);
equal('denormalizeLog inverts normalizeLog', roundTo(denormalizeLog(0.5, 20, 20000), 4), roundTo(Math.sqrt(20 * 20000), 4));
equal('secondsPerStep at 120 BPM is 0.125s', secondsPerStep(120), 0.125);
equal('patternDurationSeconds for 16 steps at 120 BPM is 2s', patternDurationSeconds(120, 16), 2);
const swingEven = computeSwingIntervalSeconds(0.125, 0, 0.4);
const swingOdd = computeSwingIntervalSeconds(0.125, 1, 0.4);
equal('swing even interval lengthens', roundTo(swingEven, 6), 0.175);
equal('swing pair duration is preserved', roundTo(swingEven + swingOdd, 6), 0.25);
equal('computeRmsLevel of silence', computeRmsLevel(new Float32Array(64)), 0);
equal('computeRmsLevel of full-scale DC', roundTo(computeRmsLevel(Float32Array.from({ length: 64 }, () => 1)), 6), 1);
equal('computePeakLevel of empty frame', computePeakLevel(new Float32Array(0)), 0);
check('normalizeLevelToMeter is monotonic', normalizeLevelToMeter(0.5) > normalizeLevelToMeter(0.05));
equal('normalizeLevelToMeter floors silence', normalizeLevelToMeter(0), 0);
equal('formatBpm pads to three digits', formatBpm(90), '090');
equal('formatSignedSemitones marks positives', formatSignedSemitones(7), '+7');
equal('formatSignedSemitones leaves zero unsigned', formatSignedSemitones(0), '0');
equal('formatPercent renders whole percents', formatPercent(0.42), '42%');
equal('formatHertz compacts kilohertz', formatHertz(1500), '1.5k');
equal('formatMilliseconds renders ms', formatMilliseconds(0.25), '250ms');

/* ------------------------------------------------------------- 6. tap tempo */

section('Tap tempo');
const steadyTaps = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500];
equal('500ms intervals resolve to 120 BPM', getBpmFromTapTimestamps(steadyTaps), 120);
equal('single tap cannot resolve', getBpmFromTapTimestamps([0]), null);
equal('out-of-range intervals resolve to null', computeBpmFromIntervals([5000, 6000]).bpm, null);
check('median filter rejects a double tap', computeBpmFromIntervals([500, 500, 60, 500]).didRejectOutlier);

const tracker = new TapTempoTracker({}, () => 0);
equal('first tap reports no tempo', tracker.registerTap(0).bpm, null);
equal('second tap reports the tempo', tracker.registerTap(500).bpm, 120);
equal('tap count tracks the window', tracker.getTapCount(), 2);
tracker.reset();
equal('reset clears the window', tracker.getTapCount(), 0);

const resetTracker = new TapTempoTracker({}, () => 0);
resetTracker.registerTap(0);
const staleResult = resetTracker.registerTap(TAP_TEMPO_RESET_TIMEOUT_MS + 1);
check('stale tap restarts the measurement', staleResult.didReset);
equal('stale restart reports no tempo', staleResult.bpm, null);
equal('stale restart leaves one tap', staleResult.tapCount, 1);

const windowTracker = new TapTempoTracker({ maxTaps: 4 }, () => 0);
for (const stamp of [0, 400, 800, 1200, 1600, 2000]) windowTracker.registerTap(stamp);
equal('rolling window honours maxTaps', windowTracker.getTapCount(), 4);
equal('rolling window resolves 150 BPM', windowTracker.getLastBpm(), 150);

/* --------------------------------------------------------------- 7. storage */

section('Storage adapter (localStorage path)');
const diagnostics = getStorageDiagnostics();
check('localStorage probe succeeded', diagnostics.isAvailable);
check('localStorage path is not a memory fallback', !diagnostics.isUsingMemoryFallback);

clearWorkingCopy();
check('cleared working copy is absent', !loadWorkingCopy().ok);

const saveWorking = saveWorkingCopy(base);
check('saveWorkingCopy succeeds', saveWorking.ok, saveWorking.error);
const loadedWorking = loadWorkingCopy();
check('loadWorkingCopy returns the pattern', loadedWorking.ok && loadedWorking.data !== undefined, loadedWorking.error);
equal('working copy round-trips the id', loadedWorking.data?.id, base.id);

safeStorage.setItem(STORAGE_KEYS.WORKING_COPY, '{ corrupted');
check('corrupt working copy is rejected', !loadWorkingCopy().ok);

const saveSlot = savePatternToSlot(2, base);
check('savePatternToSlot succeeds', saveSlot.ok, saveSlot.error);
const loadedSlot = loadPatternFromSlot(2);
check('loadPatternFromSlot returns the pattern', loadedSlot.ok && loadedSlot.data !== undefined, loadedSlot.error);
equal('slot save rewrites the slot field', loadedSlot.data?.slot, 2);
check('slot save refreshes updatedAt', (loadedSlot.data?.updatedAt ?? 0) >= DETERMINISTIC_TIMESTAMP);
check('invalid slot index is rejected on save', !savePatternToSlot(12, base).ok);
equal('an invalid save reports its reason', savePatternToSlot(12, base).code, 'invalid_slot');
check('invalid slot index is rejected on load', !loadPatternFromSlot(0).ok);
equal('an invalid load reports its reason', loadPatternFromSlot(0).code, 'invalid_slot');
check('empty slot reports an error', !loadPatternFromSlot(7).ok);
// An untouched slot is a distinguishable state, not corruption.
equal('an empty slot reports the empty reason', loadPatternFromSlot(7).code, 'empty');
equal('an empty slot reports the empty message', loadPatternFromSlot(7).error, 'Slot 7 is empty');

const slot5Payload = JSON.stringify({ ...base, slot: 5 });
safeStorage.setItem(getSlotStorageKey(4), slot5Payload);
check('slot mismatch is detected', !loadPatternFromSlot(4).ok);
equal('a slot mismatch reports corruption', loadPatternFromSlot(4).code, 'corrupt');
safeStorage.setItem(getSlotStorageKey(6), 'not-json');
check('unparseable slot data is rejected', !loadPatternFromSlot(6).ok);
equal('unparseable slot data reports corruption', loadPatternFromSlot(6).code, 'corrupt');
safeStorage.setItem(getSlotStorageKey(8), JSON.stringify({ ...base, slot: 8, bpm: 1 }));
equal('schema-invalid slot data reports corruption', loadPatternFromSlot(8).code, 'corrupt');
clearPatternSlot(8);
const metadata = getSlotMetadataList();
equal('metadata covers every slot', metadata.length, PATTERN_SLOT_COUNT);
check('metadata flags the corrupt slot', metadata[5].isCorrupt);
check('metadata flags empty slots', metadata[0].isEmpty);
equal('metadata reports the saved slot name', metadata[1].name, base.name);
check('metadata exposes a timestamp for the saved slot', metadata[1].updatedAt > 0);
equal('findFirstEmptySlot returns the first free slot', findFirstEmptySlot(), 1);

check('duplicateSlot copies data', duplicateSlot(2, 3).ok);
equal('duplicated slot keeps the pattern name', loadPatternFromSlot(3).data?.name, base.name);
check('duplicateSlot rejects identical slots', !duplicateSlot(3, 3).ok);
check('duplicateSlot rejects empty sources', !duplicateSlot(8, 1).ok);

clearPatternSlot(3);
check('clearPatternSlot empties the slot', !loadPatternFromSlot(3).ok);
clearPatternSlot(4);
clearPatternSlot(6);

section('Export / import');
const exported = exportPatternToJson(base);
check('exportPatternToJson succeeds', exported.ok && typeof exported.data === 'string', exported.error);
const imported = importPatternFromJson(exported.data ?? '');
check('importPatternFromJson round-trips', imported.ok && imported.data?.id === base.id, imported.error);
check('import rejects an oversized file', !importPatternFromJson('{}', MAX_IMPORT_SIZE_BYTES + 1).ok);
check('import rejects malformed JSON', !importPatternFromJson('{ nope').ok);
check('import rejects schema violations', !importPatternFromJson(JSON.stringify({ ...base, bpm: 1 })).ok);

section('Cross-tab subscription');
const unsubscribe = subscribeToStorageChanges(STORAGE_KEYS.WORKING_COPY, () => undefined);
check('listener registered on window', fakeStorage.listenerCount === 1, String(fakeStorage.listenerCount));
unsubscribe();
check('listener removed on unsubscribe', fakeStorage.listenerCount === 0, String(fakeStorage.listenerCount));

section('Memory fallback + quota handling');
const detached = new LazySafeStorageAdapter();
const savedWindow = globalRef.window;
delete globalRef.window;
detached.setItem('probe', 'value');
equal('memory fallback stores values', detached.getItem('probe'), 'value');
check('memory fallback reports itself', detached.getDiagnostics().isUsingMemoryFallback);
detached.removeItem('probe');
equal('memory fallback removes values', detached.getItem('probe'), null);

globalRef.window = savedWindow;
const quotaAdapter = new LazySafeStorageAdapter();
// Warm the capability probe first so the injected failure hits a data write.
quotaAdapter.getItem('warmup');
fakeStorage.failNextWrite = true;
quotaAdapter.setItem('quota-key', 'payload');
check('quota exhaustion is reported', quotaAdapter.getDiagnostics().isQuotaExceeded);
equal('quota failure still stores in memory', quotaAdapter.getItem('quota-key'), 'payload');
quotaAdapter.setItem('quota-key-2', 'payload');
check('successful write clears the quota flag', !quotaAdapter.getDiagnostics().isQuotaExceeded);
quotaAdapter.setItem('quota-key', 'fresh');
equal('backend becomes authoritative after a successful rewrite', quotaAdapter.getItem('quota-key'), 'fresh');
equal('backend holds the recovered payload', fakeStorage.getItem('quota-key'), 'fresh');

/* ----------------------------------------------------------------- summary */

const total = passed + failures.length;
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`PHASE 1 GATE PASSED \u2014 ${passed}/${total} checks green.`);
  process.exit(0);
}
console.log(`PHASE 1 GATE FAILED \u2014 ${failures.length}/${total} checks failed:`);
for (const failure of failures) {
  console.log(`  \u2717 ${failure}`);
}
process.exit(1);
