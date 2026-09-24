/**
 * Phase 3 quality gate — component render smoke test.
 *
 *   npx tsx scripts/verify-render.tsx
 *
 * Server-renders every primitive and molecule with representative props and
 * asserts the emitted markup. React warnings are captured and treated as
 * failures, so missing keys, invalid attributes and bad ARIA wiring all fail the
 * gate rather than scrolling past in the console.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { COLOR_MAP } from '../src/lib/constants/colorMap';
import {
  TRACK_COUNT,
  createDefaultMasterFx,
  createDefaultPattern,
  createDefaultTrack,
} from '../src/lib/constants/defaultPatterns';
import { SOUNDBOARD_PRESET_TEMPLATES } from '../src/lib/constants/soundboardPresets';
import type { Step } from '../src/types/audio';
import type { StorageSlotMetadata } from '../src/types/storage';

import { ChassisScrew } from '../src/components/ui/ChassisScrew';
import { KnobRotary } from '../src/components/ui/KnobRotary';
import { LedIndicator } from '../src/components/ui/LedIndicator';
import { LedVuMeter } from '../src/components/ui/LedVuMeter';
import { MechanicalSwitch } from '../src/components/ui/MechanicalSwitch';
import { PushButton } from '../src/components/ui/PushButton';
import { SevenSegmentDisplay } from '../src/components/ui/SevenSegmentDisplay';

import { MasterFxPanel } from '../src/components/molecules/MasterFxPanel';
import { PatternManagerBar } from '../src/components/molecules/PatternManagerBar';
import { SoundboardTriggerPad } from '../src/components/molecules/SoundboardTriggerPad';
import { StepCell } from '../src/components/molecules/StepCell';
import { StepEditorSheet } from '../src/components/molecules/StepEditorSheet';
import { TrackHeader } from '../src/components/molecules/TrackHeader';
import { TransportControls } from '../src/components/molecules/TransportControls';

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

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Renders to static markup, failing the gate on any React warning. */
function render(label: string, element: ReactElement | null): string {
  if (element === null) return '';
  const captured: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    captured.push(args.map((value) => String(value)).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    captured.push(args.map((value) => String(value)).join(' '));
  };
  let html = '';
  let threw: string | null = null;
  try {
    html = renderToStaticMarkup(element);
  } catch (error) {
    threw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  check(`${label} renders without throwing`, threw === null, threw ?? undefined);
  check(
    `${label} emits no React warnings`,
    captured.length === 0,
    captured.slice(0, 2).join(' | '),
  );
  return html;
}

/* ------------------------------------------------------------------ fixtures */

const pattern = createDefaultPattern(1);
const track = createDefaultTrack(0, 16);
const pad = SOUNDBOARD_PRESET_TEMPLATES[0];
const masterFx = createDefaultMasterFx();
const inactiveStep: Step = { index: 0, active: false, velocity: 0.8, probability: 1, pitchOffset: 0 };
const activeStep: Step = { index: 5, active: true, velocity: 0.6, probability: 0.5, pitchOffset: -3 };

const slotMetadata: StorageSlotMetadata[] = Array.from({ length: 8 }, (_unused, index) => {
  const slot = index + 1;
  if (slot === 3) {
    return { slot, name: 'CORRUPT', updatedAt: 0, isEmpty: false, isCorrupt: true };
  }
  if (slot <= 2) {
    return { slot, name: `PATTERN ${slot}`, updatedAt: 1_700_000_000_000, isEmpty: false, isCorrupt: false };
  }
  return { slot, name: `Slot ${slot}`, updatedAt: 0, isEmpty: true, isCorrupt: false };
});

/* ------------------------------------------------------------- 1. primitives */

section('UI primitives');
const screwHtml = render('ChassisScrew', createElement(ChassisScrew, { size: 'lg', angle: 30 }));
check('screw is decorative', screwHtml.includes('aria-hidden="true"'));
check('screw uses the hex-screw surface', screwHtml.includes('hex-screw'));

const litLedHtml = render(
  'LedIndicator (lit)',
  createElement(LedIndicator, { color: 'emerald', isOn: true, label: 'Powered' }),
);
check('lit LED carries the mapped lit class', litLedHtml.includes(COLOR_MAP.emerald.ledOn));
check('lit LED carries the mapped glow class', litLedHtml.includes(COLOR_MAP.emerald.glowClass));
check('lit LED is labelled', litLedHtml.includes('aria-label="Powered"'));

const unlitLedHtml = render(
  'LedIndicator (unlit)',
  createElement(LedIndicator, { color: 'crimson', isOn: false }),
);
check('unlit LED carries the mapped dark class', unlitLedHtml.includes(COLOR_MAP.crimson.ledOff));
check('unlit LED is hidden from AT', unlitLedHtml.includes('aria-hidden="true"'));

const knobHtml = render(
  'KnobRotary',
  createElement(KnobRotary, {
    label: 'Tempo',
    value: 120,
    min: 40,
    max: 280,
    step: 1,
    onChange: () => undefined,
  }),
);
check('knob exposes the slider role', knobHtml.includes('role="slider"'));
check('knob reports its value', knobHtml.includes('aria-valuenow="120"'));
check('knob reports its range', knobHtml.includes('aria-valuemin="40"') && knobHtml.includes('aria-valuemax="280"'));
check('knob disables native touch gestures', knobHtml.includes('touch-action:none'));
check('knob is keyboard focusable', knobHtml.includes('tabindex="0"'));

const disabledKnobHtml = render(
  'KnobRotary (disabled)',
  createElement(KnobRotary, {
    label: 'Cutoff',
    value: 500,
    min: 20,
    max: 20000,
    scale: 'log',
    onChange: () => undefined,
    disabled: true,
    unit: 'Hz',
  }),
);
check('disabled knob leaves the tab order', disabledKnobHtml.includes('tabindex="-1"'));
check('disabled knob reports aria-disabled', disabledKnobHtml.includes('aria-disabled="true"'));

const segHtml = render(
  'SevenSegmentDisplay',
  createElement(SevenSegmentDisplay, { value: '120', digits: 3, label: 'Tempo', suffix: 'BPM' }),
);
check('seven-segment renders the ghost layer', segHtml.includes('888'));
check('seven-segment renders the value', segHtml.includes('120'));
check('seven-segment announces its value', segHtml.includes('Tempo: 120BPM'));

const switchHtml = render(
  'MechanicalSwitch (rocker)',
  createElement(MechanicalSwitch, { isOn: true, onToggle: () => undefined, label: 'Mute', variant: 'rocker' }),
);
check('switch exposes the switch role', switchHtml.includes('role="switch"'));
check('switch reports checked state', switchHtml.includes('aria-checked="true"'));
check('rocker variant renders both captions', switchHtml.includes('OFF') && switchHtml.includes('ON'));

const powerHtml = render(
  'MechanicalSwitch (power)',
  createElement(MechanicalSwitch, { isOn: false, onToggle: () => undefined, label: 'Power', variant: 'power' }),
);
check('power variant renders an icon', powerHtml.includes('<svg'));
check('power variant reports unchecked state', powerHtml.includes('aria-checked="false"'));

const buttonHtml = render(
  'PushButton (active)',
  createElement(PushButton, {
    label: 'Solo',
    onClick: () => undefined,
    isActive: true,
    color: 'amber',
    ariaLabel: 'Solo track',
  }),
);
check('button exposes pressed state', buttonHtml.includes('aria-pressed="true"'));
check('button honours the aria override', buttonHtml.includes('aria-label="Solo track"'));
check('button carries the accent glow', buttonHtml.includes(COLOR_MAP.amber.glowClass));

const meterHtml = render(
  'LedVuMeter',
  createElement(LedVuMeter, { level: 0.5, segments: 12, label: 'L', showScale: true }),
);
check('meter renders every rung', countOccurrences(meterHtml, 'rounded-[1px]') === 12);
check('meter announces its level', meterHtml.includes('L: 50 percent'));

const mutedMeterHtml = render(
  'LedVuMeter (silent)',
  createElement(LedVuMeter, { level: 0, segments: 8 }),
);
check('silent meter lights nothing', !mutedMeterHtml.includes('bg-[#00ff66]'));

/* ------------------------------------------------------------ 2. step editor */

section('StepCell');
const inactiveCellHtml = render(
  'StepCell (inactive)',
  createElement(StepCell, {
    step: inactiveStep,
    trackColor: 'amber',
    onToggle: () => undefined,
    onOpenEditor: () => undefined,
  }),
);
check('cell exposes its index', inactiveCellHtml.includes('data-step-index="0"'));
check('cell reports inactive state', inactiveCellHtml.includes('aria-pressed="false"'));
check('cell suppresses the context menu hook', inactiveCellHtml.includes('data-active="false"'));
check('cell styles the playhead attribute', inactiveCellHtml.includes('data-[playhead=active]:ring-2'));

const activeCellHtml = render(
  'StepCell (active)',
  createElement(StepCell, {
    step: activeStep,
    trackColor: 'crimson',
    onToggle: () => undefined,
    onOpenEditor: () => undefined,
    isEditMode: true,
    isBeatStart: true,
  }),
);
check('active cell reports pressed state', activeCellHtml.includes('aria-pressed="true"'));
check('active cell shows the pitch offset', activeCellHtml.includes('-3'));
check('active cell shows reduced probability', activeCellHtml.includes('width:50%'));
check('active cell labels its velocity', activeCellHtml.includes('velocity 60 percent'));

section('StepEditorSheet');
const closedSheetHtml = render(
  'StepEditorSheet (closed)',
  createElement(StepEditorSheet, {
    step: activeStep,
    trackName: 'KICK',
    isOpen: false,
    onClose: () => undefined,
    onChangeVelocity: () => undefined,
    onChangeProbability: () => undefined,
    onChangePitch: () => undefined,
  }),
);
check('closed sheet renders nothing', closedSheetHtml === '');

const nullStepSheetHtml = render(
  'StepEditorSheet (no step)',
  createElement(StepEditorSheet, {
    step: null,
    trackName: 'KICK',
    isOpen: true,
    onClose: () => undefined,
    onChangeVelocity: () => undefined,
    onChangeProbability: () => undefined,
    onChangePitch: () => undefined,
  }),
);
check('sheet with no step renders nothing', nullStepSheetHtml === '');

const openSheetHtml = render(
  'StepEditorSheet (open)',
  createElement(StepEditorSheet, {
    step: activeStep,
    trackName: 'KICK',
    isOpen: true,
    onClose: () => undefined,
    onChangeVelocity: () => undefined,
    onChangeProbability: () => undefined,
    onChangePitch: () => undefined,
    onToggleActive: () => undefined,
    trackColor: 'amber',
    stepLabel: 'STEP 06',
  }),
);
check('sheet exposes a modal dialog', openSheetHtml.includes('role="dialog"') && openSheetHtml.includes('aria-modal="true"'));
check('sheet names the track', openSheetHtml.includes('KICK'));
check('sheet shows the step caption', openSheetHtml.includes('STEP 06'));
check('sheet renders three knobs', countOccurrences(openSheetHtml, 'role="slider"') === 3);

/* --------------------------------------------------------------- 3. molecules */

section('TrackHeader');
const trackHeaderHtml = render(
  'TrackHeader',
  createElement(TrackHeader, {
    track,
    onToggleMute: () => undefined,
    onToggleSolo: () => undefined,
    onChangeVolume: () => undefined,
    onChangePan: () => undefined,
    isSelected: true,
    onSelectTrack: () => undefined,
  }),
);
check('header shows the track name', trackHeaderHtml.includes('KICK'));
check('header wires the mute control', trackHeaderHtml.includes('aria-label="Mute KICK"'));
check('header wires the solo control', trackHeaderHtml.includes('aria-label="Solo KICK"'));
check('header renders volume and pan knobs', countOccurrences(trackHeaderHtml, 'role="slider"') === 2);
check('header centres a zeroed pan', trackHeaderHtml.includes('>C<'));

section('SoundboardTriggerPad');
const padHtml = render(
  'SoundboardTriggerPad',
  createElement(SoundboardTriggerPad, { pad, onTrigger: () => undefined }),
);
check('pad labels its key binding', padHtml.includes('aria-label="Trigger KICK DEEP pad, key 1"'));
check('pad meets the 72px touch target', padHtml.includes('min-h-[72px]'));
check('pad blocks text selection', padHtml.includes('user-select:none'));
check('pad shows its label', padHtml.includes('KICK DEEP'));

section('MasterFxPanel');
const fxHtml = render(
  'MasterFxPanel',
  createElement(MasterFxPanel, {
    fx: masterFx,
    onChangeFx: () => undefined,
    stereoLevels: { left: 0.4, right: 0.2 },
  }),
);
check('fx panel titles the bay', fxHtml.includes('MASTER FX'));
check('fx panel renders the four filter types', countOccurrences(fxHtml, 'Filter type ') === 4);
// Filter 2 + Delay 3 + Overdrive 2 + Master 1
check('fx panel renders all eight knobs', countOccurrences(fxHtml, 'role="slider"') === 8);
check('fx panel renders stereo meters', fxHtml.includes('L: 40 percent') && fxHtml.includes('R: 20 percent'));
check('fx panel marks the active filter type', fxHtml.includes('aria-pressed="true"'));

const fxNoMetersHtml = render(
  'MasterFxPanel (no analyser)',
  createElement(MasterFxPanel, { fx: masterFx, onChangeFx: () => undefined }),
);
check('meters are omitted without analyser levels', countOccurrences(fxNoMetersHtml, 'rounded-[1px]') === 0);

section('TransportControls');
const barHtml = render(
  'TransportControls (bar)',
  createElement(TransportControls, {
    variant: 'bar',
    isPlaying: false,
    bpm: 120,
    onTogglePlay: () => undefined,
    onStop: () => undefined,
    onChangeBpm: () => undefined,
    onTapTempo: () => undefined,
    tapCount: 3,
  }),
);
check('bar renders play and stop', barHtml.includes('aria-label="Start transport"') && barHtml.includes('aria-label="Stop transport"'));
check('bar renders the tempo readout', barHtml.includes('120') && barHtml.includes('BPM'));
check('bar renders the nudge buttons', barHtml.includes('aria-label="Increase tempo by one BPM"') && barHtml.includes('aria-label="Decrease tempo by one BPM"'));
check('bar reports tap progress', barHtml.includes('3 taps'));
check('bar omits swing and master', !barHtml.includes('Swing') && !barHtml.includes('>Steps<'));

const consoleHtml = render(
  'TransportControls (console)',
  createElement(TransportControls, {
    variant: 'console',
    isPlaying: true,
    bpm: 140,
    swing: 0.25,
    masterVolume: 0.9,
    stepCount: 32,
    stepPage: 1,
    isEditMode: true,
    isPowered: true,
    onTogglePlay: () => undefined,
    onStop: () => undefined,
    onChangeBpm: () => undefined,
    onChangeSwing: () => undefined,
    onChangeMasterVolume: () => undefined,
    onTapTempo: () => undefined,
    onChangeStepCount: () => undefined,
    onChangeStepPage: () => undefined,
    onToggleEditMode: () => undefined,
  }),
);
check('console docks itself', consoleHtml.includes('sticky top-0 z-30'));
check('console renders swing', consoleHtml.includes('Swing'));
check('console renders master volume', consoleHtml.includes('Master'));
check('console renders the step count switch', consoleHtml.includes('aria-label="Use 16 steps"') && consoleHtml.includes('aria-label="Use 32 steps"'));
check('console renders page selectors only at 32 steps', consoleHtml.includes('aria-label="Show steps 17 to 32"'));
check('console renders the edit toggle', consoleHtml.includes('aria-label="Toggle step edit mode"'));
check('console reports the running state', consoleHtml.includes('running'));
check('console marks the active page', consoleHtml.includes('aria-pressed="true"'));

const consoleNoPagingHtml = render(
  'TransportControls (console, 16 steps)',
  createElement(TransportControls, {
    variant: 'console',
    isPlaying: false,
    bpm: 100,
    stepCount: 16,
    onTogglePlay: () => undefined,
    onStop: () => undefined,
    onChangeBpm: () => undefined,
    onTapTempo: () => undefined,
    onChangeStepCount: () => undefined,
    onChangeStepPage: () => undefined,
  }),
);
check('page selectors are hidden at 16 steps', !consoleNoPagingHtml.includes('Show steps 17 to 32'));
check('swing and master knobs are optional', !consoleNoPagingHtml.includes('Swing'));

section('PatternManagerBar');
const managerHtml = render(
  'PatternManagerBar',
  createElement(PatternManagerBar, {
    activeSlot: 2,
    isDirty: true,
    onSelectSlot: () => undefined,
    onSaveToSlot: () => undefined,
    onClearSlot: () => undefined,
    onDuplicateSlot: () => undefined,
    onExport: () => undefined,
    onImport: () => undefined,
    slotMetadata,
    patternName: 'PATTERN 2',
  }),
);
check('manager renders eight slots', countOccurrences(managerHtml, 'aria-label="Load slot') === 8);
check('manager flags the corrupt slot', managerHtml.includes('CORRUPT'));
check('manager marks the active slot', managerHtml.includes('aria-pressed="true"'));
check('manager shows the unsaved indicator', managerHtml.includes('unsaved changes'));
check('manager offers save, clear, duplicate, export and import', ['Save', 'Clear', 'Duplicate', 'Export', 'Import'].every((label) => managerHtml.includes(label)));
check('manager accepts JSON imports only', managerHtml.includes('accept="application/json,.json"'));
check('manager names the target slot on save', managerHtml.includes('aria-label="Save pattern to slot 2"'));

const managerErrorHtml = render(
  'PatternManagerBar (error)',
  createElement(PatternManagerBar, {
    activeSlot: 1,
    isDirty: false,
    onSelectSlot: () => undefined,
    onSaveToSlot: () => undefined,
    onClearSlot: () => undefined,
    onDuplicateSlot: () => undefined,
    onExport: () => undefined,
    onImport: () => undefined,
    slotMetadata,
    storageError: 'Slot 4 is corrupt',
    onDismissError: () => undefined,
    isQuotaExceeded: true,
  }),
);
check('manager surfaces storage errors', managerErrorHtml.includes('Slot 4 is corrupt'));
check('manager offers to dismiss the error', managerErrorHtml.includes('Dismiss'));
check('quota exhaustion outranks the fallback notice', managerErrorHtml.includes('Browser storage is full'));

const managerFallbackHtml = render(
  'PatternManagerBar (memory fallback)',
  createElement(PatternManagerBar, {
    activeSlot: 1,
    isDirty: false,
    onSelectSlot: () => undefined,
    onSaveToSlot: () => undefined,
    onClearSlot: () => undefined,
    onDuplicateSlot: () => undefined,
    onExport: () => undefined,
    onImport: () => undefined,
    slotMetadata,
    isUsingMemoryFallback: true,
  }),
);
check('manager warns about the memory fallback', managerFallbackHtml.includes('Persistent storage is unavailable'));

/* --------------------------------------------------------- 4. grid integrity */

section('Pattern integrity for rendering');
check('pattern exposes eight tracks', pattern.tracks.length === TRACK_COUNT);
check(
  'every track renders its own header without warnings',
  pattern.tracks.every((candidate) => {
    const html = render(
      `TrackHeader ${candidate.name}`,
      createElement(TrackHeader, {
        track: candidate,
        onToggleMute: () => undefined,
        onToggleSolo: () => undefined,
        onChangeVolume: () => undefined,
        onChangePan: () => undefined,
      }),
    );
    return html.includes(candidate.name);
  }),
);

/* ----------------------------------------------------------------- summary */

const total = passed + failures.length;
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`PHASE 3 RENDER GATE PASSED \u2014 ${passed}/${total} checks green.`);
  process.exit(0);
}
console.log(`PHASE 3 RENDER GATE FAILED \u2014 ${failures.length}/${total} checks failed:`);
for (const failure of failures) {
  console.log(`  \u2717 ${failure}`);
}
process.exit(1);
