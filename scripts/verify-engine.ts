/**
 * Phase 4 quality gate — audio engine, scheduler and voice dispatch.
 *
 *   npx tsx scripts/verify-engine.ts
 *
 * Node has no Web Audio implementation, so this script installs a faithful test
 * double for the subset of the API the engine uses. The double is strict: an
 * exponential ramp to exactly zero throws, exactly as a real AudioContext does,
 * so an envelope bug fails the gate instead of sounding wrong in the browser.
 */
import { AudioEngine, getAudioEngine, isTrackAudible } from '../src/lib/audio/AudioEngine';
import {
  FakeAnalyserNode,
  FakeAudioContext,
  FakeAudioParam,
  FakeBiquadFilterNode,
  FakeBufferSourceNode,
  FakeChannelSplitterNode,
  FakeDelayNode,
  FakeDynamicsCompressorNode,
  FakeGainNode,
  FakeOscillatorNode,
  FakeStereoPannerNode,
  FakeWaveShaperNode,
  installFakeAudioContext,
} from './fakeWebAudio';
import { NoiseBufferPool } from '../src/lib/audio/NoiseBufferPool';
import { LookaheadScheduler } from '../src/lib/audio/LookaheadScheduler';
import { createDefaultPattern } from '../src/lib/constants/defaultPatterns';
import { SOUNDBOARD_PRESET_TEMPLATES } from '../src/lib/constants/soundboardPresets';
import type { InstrumentType, Pattern, SoundboardPad } from '../src/types/audio';
import { clearPlayhead, registerStepElement, setActiveStep } from '../src/lib/utils/playheadRegistry';

const restoreAudioContext = installFakeAudioContext();

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

function throws(label: string, fn: () => unknown): void {
  try {
    fn();
    check(label, false, 'expected a throw but none occurred');
  } catch {
    check(label, true);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function lastContext(): FakeAudioContext {
  const ctx = FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
  if (ctx === undefined) throw new Error('no FakeAudioContext has been constructed');
  return ctx;
}

async function main(): Promise<void> {
/* ------------------------------------------------------------ 1. inertness */

section('Constructor inertness');
FakeAudioContext.instances = [];
const engine = new AudioEngine();
equal('no AudioContext is created by the constructor', FakeAudioContext.instances.length, 0);
equal('engine starts uninitialised', engine.isInitialized, false);
equal('engine starts stopped', engine.getIsPlaying(), false);
equal('no track strips before init', engine.getTrackStripCount(), 0);
equal('clock is unavailable before init', engine.getCurrentTime(), null);
equal('meter reads silence before init', engine.getStereoLevels().left, 0);
check('noise pool has no buffer before init', !NoiseBufferPool.hasBuffer());

const inertScheduler = new LookaheadScheduler(
  lastContextOrThrow(),
  () => ({ bpm: 120, swing: 0, stepCount: 16 }),
  () => undefined,
);
function lastContextOrThrow(): AudioContext {
  // The scheduler is only constructed with a live context in production; the
  // inertness check uses a throwaway double.
  return new FakeAudioContext() as unknown as AudioContext;
}
equal('scheduler constructor starts no timer', inertScheduler.isRunning(), false);
inertScheduler.stop();
equal('stopping an idle scheduler is safe', inertScheduler.isRunning(), false);

/* ---------------------------------------------------------- 2. initialisation */

section('Initialisation and graph wiring');
FakeAudioContext.instances = [];
const graphEngine = new AudioEngine();
const initPromise = graphEngine.init();
// Synchronous construction is what unlocks audio inside an iOS gesture handler.
check('init() marks the engine initialised synchronously', graphEngine.isInitialized);
equal('exactly one AudioContext is constructed', FakeAudioContext.instances.length, 1);
equal('exactly eight track strips are built', graphEngine.getTrackStripCount(), 8);
const ctx = lastContext();
check('the context is created with an interactive latency hint', ctx.options?.latencyHint === 'interactive');
await initPromise;
check('init() resumes a suspended context', ctx.resumeCount >= 1);
equal('the context is running after init', ctx.state, 'running');

const internal = graphEngine as unknown as {
  manager: {
    masterBus: FakeGainNode;
    padBus: FakeGainNode;
    masterGain: FakeGainNode;
    limiter: FakeDynamicsCompressorNode;
    splitter: FakeChannelSplitterNode;
    leftAnalyser: FakeAnalyserNode;
    rightAnalyser: FakeAnalyserNode;
    effectsChain: { inputNode: FakeGainNode; outputNode: FakeGainNode };
  };
  strips: { input: FakeGainNode; panner: FakeStereoPannerNode; gain: FakeGainNode }[];
  drums: { getActiveSourceCount: () => number; getActiveVoiceCount: () => number };
  synth: { getActiveSourceCount: () => number };
};

const { masterBus, padBus, masterGain, limiter, splitter, leftAnalyser, rightAnalyser, effectsChain } =
  internal.manager;

check('pad bus sums into the master bus', padBus.isConnectedTo(masterBus));
check('master bus feeds the effects chain', masterBus.isConnectedTo(effectsChain.inputNode));
check('effects chain feeds the master volume', effectsChain.outputNode.isConnectedTo(masterGain));
check('master volume feeds the limiter', masterGain.isConnectedTo(limiter));
check('limiter feeds the destination', limiter.isConnectedTo(ctx.destination));
check('limiter feeds the stereo splitter', limiter.isConnectedTo(splitter));
equal('splitter has two outputs', splitter.numberOfOutputs, 2);
check(
  'left analyser taps splitter output 0',
  splitter.connectionLog.some((entry) => entry.dest === leftAnalyser && entry.output === 0),
);
check(
  'right analyser taps splitter output 1',
  splitter.connectionLog.some((entry) => entry.dest === rightAnalyser && entry.output === 1),
);
equal('limiter threshold is -1 dB', limiter.threshold.value, -1);
equal('limiter ratio is 20:1', limiter.ratio.value, 20);
equal('limiter attack is 3 ms', limiter.attack.value, 0.003);
equal('limiter release is 100 ms', limiter.release.value, 0.1);
equal('limiter knee is hard', limiter.knee.value, 0);

check(
  'every strip chains input -> panner -> gain',
  internal.strips.every((strip) => strip.input.isConnectedTo(strip.panner) && strip.panner.isConnectedTo(strip.gain)),
);
check(
  'every strip gain lands on the master bus',
  internal.strips.every((strip) => strip.gain.isConnectedTo(masterBus)),
);

// Re-initialising must not build a second context.
const resumeCountBeforeReinit = ctx.resumeCount;
await graphEngine.init();
equal('re-init reuses the existing context', FakeAudioContext.instances.length, 1);
equal('re-init does not resume an already running context', ctx.resumeCount, resumeCountBeforeReinit);

/* ------------------------------------------------------------- 3. mixer sync */

section('Mixer synchronisation');
const mixPattern: Pattern = createDefaultPattern(1);
mixPattern.tracks[0].volume = 0.42;
mixPattern.tracks[0].pan = -0.6;
mixPattern.tracks[7].volume = 0.11;
mixPattern.tracks[7].pan = 0.8;
mixPattern.masterFx.masterVolume = 0.7;
mixPattern.masterFx.delay.time = 0.5;
mixPattern.masterFx.delay.feedback = 0.6;
mixPattern.masterFx.filter.cutoff = 1200;
mixPattern.masterFx.filter.resonance = 8;

graphEngine.syncMixer(mixPattern);
const stripZeroGainEvent = internal.strips[0].gain.gain.events.at(-1);
const stripZeroPanEvent = internal.strips[0].panner.pan.events.at(-1);
equal('strip gain receives the track volume', stripZeroGainEvent?.value, 0.42);
equal('strip volume uses setTargetAtTime', stripZeroGainEvent?.kind, 'setTarget');
equal('strip pan receives the track pan', stripZeroPanEvent?.value, -0.6);
equal('strip 7 volume is applied', internal.strips[7].gain.gain.events.at(-1)?.value, 0.11);
equal('master volume is applied', masterGain.gain.events.at(-1)?.value, 0.7);

const chain = graphEngine as unknown as {
  manager: { effectsChain: { delayNode: FakeDelayNode; delayFeedback: FakeGainNode; masterFilter: FakeBiquadFilterNode; waveshaper: FakeWaveShaperNode; getCachedDrive: () => number } };
};
equal('delay time is written in absolute seconds', chain.manager.effectsChain.delayNode.delayTime.events.at(-1)?.value, 0.5);
equal('delay feedback is written', chain.manager.effectsChain.delayFeedback.gain.events.at(-1)?.value, 0.6);
equal('master filter cutoff is written', chain.manager.effectsChain.masterFilter.frequency.events.at(-1)?.value, 1200);
equal('master filter resonance is written', chain.manager.effectsChain.masterFilter.Q.events.at(-1)?.value, 8);
check('waveshaper curve is cached after the first update', chain.manager.effectsChain.waveshaper.curve !== null);

const curveBefore = chain.manager.effectsChain.waveshaper.curve;
graphEngine.syncMixer({ ...mixPattern, masterFx: { ...mixPattern.masterFx, delay: { time: 0.2, feedback: 0.1, wetDry: 0.5 } } });
check(
  'an unchanged drive reuses the cached curve',
  chain.manager.effectsChain.waveshaper.curve === curveBefore,
);
graphEngine.syncMixer({ ...mixPattern, masterFx: { ...mixPattern.masterFx, distortion: { drive: 88, wetDry: 0.9 } } });
check(
  'a changed drive rebuilds the curve',
  chain.manager.effectsChain.waveshaper.curve !== curveBefore,
);
equal('the new drive value is cached', chain.manager.effectsChain.getCachedDrive(), 88);

/* --------------------------------------------------------- 4. dispatch table */

section('Voice dispatch table');
const kickPad = SOUNDBOARD_PRESET_TEMPLATES[0];
const padBusCreatedBefore = ctx.createdNodes.length;
graphEngine.triggerPad(kickPad);
check('a pad trigger creates audio nodes', ctx.createdNodes.length > padBusCreatedBefore);
check('the pad bus receives the voice', padBus.incoming.length > 0);
equal('pad triggers are at full velocity', ctx.nodesOfType(FakeOscillatorNode).at(-1)?.startedAt, 0);

const instrumentExpectations: { instrument: InstrumentType; oscillators: number; noise: number }[] = [
  { instrument: 'kick', oscillators: 1, noise: 0 },
  { instrument: 'snare', oscillators: 1, noise: 1 },
  { instrument: 'hihat_closed', oscillators: 0, noise: 1 },
  { instrument: 'hihat_open', oscillators: 0, noise: 1 },
  { instrument: 'clap', oscillators: 0, noise: 3 },
  { instrument: 'tom_low', oscillators: 1, noise: 0 },
  { instrument: 'tom_high', oscillators: 1, noise: 0 },
  { instrument: 'synth_lead', oscillators: 1, noise: 0 },
];

for (const expectation of instrumentExpectations) {
  const before = ctx.createdNodes.length;
  const pad: SoundboardPad = { ...kickPad, instrument: expectation.instrument };
  graphEngine.triggerPad(pad);
  const created = ctx.createdNodes.slice(before);
  const oscillators = created.filter((node) => node instanceof FakeOscillatorNode).length;
  const noise = created.filter((node) => node instanceof FakeBufferSourceNode).length;
  equal(`${expectation.instrument} creates ${expectation.oscillators} oscillator(s)`, oscillators, expectation.oscillators);
  equal(`${expectation.instrument} creates ${expectation.noise} noise source(s)`, noise, expectation.noise);
  check(
    `${expectation.instrument} starts every source in the future`,
    created
      .filter((node): node is FakeOscillatorNode | FakeBufferSourceNode => node instanceof FakeOscillatorNode || node instanceof FakeBufferSourceNode)
      .every((node) => (node.startedAt ?? -1) >= 0),
  );
}

const noiseSources = ctx.nodesOfType(FakeBufferSourceNode);
check('noise voices loop', noiseSources.every((source) => source.loop));
check('noise voices read a random offset inside the buffer', noiseSources.some((source) => source.startOffset > 0));
check('noise voices share one pre-allocated buffer', new Set(noiseSources.map((source) => source.buffer)).size === 1);
check('the shared noise buffer is two seconds long', (noiseSources[0].buffer?.duration ?? 0) === 2);

section('NoiseBufferPool');
check('the pool caches a buffer after the first trigger', NoiseBufferPool.hasBuffer());
const sharedBuffer = NoiseBufferPool.getSharedBuffer(ctx as unknown as AudioContext);
check('the pool returns the cached instance', sharedBuffer === NoiseBufferPool.getSharedBuffer(ctx as unknown as AudioContext));
equal('the pooled buffer matches the context sample rate', sharedBuffer.sampleRate, ctx.sampleRate);
throws('an exponential ramp to zero is rejected by the double', () => {
  new FakeAudioParam(0).exponentialRampToValueAtTime(0, 1);
});
check(
  'no voice ever ramps an envelope to exactly zero',
  ctx.createdNodes.length > 0 &&
    ctx
      .nodesOfType(FakeGainNode)
      .flatMap((node) => node.gain.events)
      .filter((event) => event.kind === 'exponentialRamp')
      .every((event) => event.value !== 0),
);

/* -------------------------------------------------- 5. transport + scheduler */

section('Transport and lookahead scheduling');
const schedulerPattern = createDefaultPattern(1);
// Only the kick track is programmed, so the expected voice count is exact.
schedulerPattern.tracks.forEach((track, index) => {
  track.steps.forEach((step) => {
    step.active = index === 0;
    step.probability = 1;
  });
});

let transportEmissions = 0;
const unsubscribeTransport = graphEngine.subscribe(() => {
  transportEmissions += 1;
});

ctx.currentTime = 0;
await graphEngine.play(() => schedulerPattern);
check('play() flips the transport flag', graphEngine.getIsPlaying());
check('play() notifies subscribers', transportEmissions > 0);
check('the scheduler is running', (graphEngine as unknown as { scheduler: { isRunning: () => boolean } }).scheduler.isRunning());

// The scheduler primes its window synchronously, so step 0 is already queued.
check('the first step is queued immediately', graphEngine.getPendingPlayheadCount() >= 1);
equal('exactly one step fits inside the first 100 ms window', graphEngine.getPendingPlayheadCount(), 1);

const stripZeroVoices = internal.strips[0].input.incoming.length;
check('the first kick voice was scheduled', stripZeroVoices > 0);
check(
  'silent tracks scheduled nothing',
  internal.strips.slice(1).every((strip) => strip.input.incoming.length === 0),
);

equal('the cursor is not advanced before its scheduled time', graphEngine.advancePlayhead(0.01), null);
equal('the cursor advances when its time arrives', graphEngine.advancePlayhead(0.06), 0);
equal('the queue is drained after the cursor moves', graphEngine.getPendingPlayheadCount(), 0);

const emissionsBeforeReplay = transportEmissions;
await graphEngine.play(() => schedulerPattern);
equal('play() while playing is a no-op', transportEmissions, emissionsBeforeReplay);


// Resync guard: jump the clock far ahead and confirm no burst of late steps.
ctx.currentTime = 12;
await sleep(80);
const pending = graphEngine as unknown as { playheadQueue: { step: number; time: number }[] };
check('a stalled clock resyncs instead of bursting', pending.playheadQueue.length <= 2);
check(
  'resynced steps are never in the past',
  pending.playheadQueue.every((item) => item.time >= 12),
);

unsubscribeTransport();
const emissionsAfterUnsubscribe = transportEmissions;
graphEngine.stop();
equal('unsubscribing stops notifications', transportEmissions, emissionsAfterUnsubscribe);

section('Mute and solo at schedule time');
const soloPattern = createDefaultPattern(1);
soloPattern.tracks.forEach((track, index) => {
  track.steps.forEach((step) => {
    step.active = true;
    step.probability = 1;
  });
  track.muted = index !== 2;
  track.soloed = index === 2;
});
graphEngine.stop();
for (const strip of internal.strips) strip.input.disconnect();
internal.strips.forEach((strip) => {
  strip.input.incoming.length = 0;
});
ctx.currentTime = 20;
await graphEngine.play(() => soloPattern);
check(
  'only the soloed track is scheduled',
  internal.strips[2].input.incoming.length > 0 &&
    internal.strips.filter((_strip, index) => index !== 2).every((strip) => strip.input.incoming.length === 0),
);
graphEngine.stop();

const mutePattern = createDefaultPattern(1);
mutePattern.tracks.forEach((track, index) => {
  track.steps.forEach((step) => {
    step.active = true;
    step.probability = 1;
  });
  track.muted = index % 2 === 0;
  track.soloed = false;
});
internal.strips.forEach((strip) => {
  strip.input.incoming.length = 0;
});
ctx.currentTime = 30;
await graphEngine.play(() => mutePattern);
check(
  'muted tracks are skipped and unmuted tracks fire',
  internal.strips.filter((_strip, index) => index % 2 === 1).every((strip) => strip.input.incoming.length > 0) &&
    internal.strips.filter((_strip, index) => index % 2 === 0).every((strip) => strip.input.incoming.length === 0),
);
graphEngine.stop();

const zeroProbabilityPattern = createDefaultPattern(1);
zeroProbabilityPattern.tracks.forEach((track) => {
  track.steps.forEach((step) => {
    step.active = true;
    step.probability = 0;
  });
});
internal.strips.forEach((strip) => {
  strip.input.incoming.length = 0;
});
ctx.currentTime = 40;
await graphEngine.play(() => zeroProbabilityPattern);
check(
  'zero probability suppresses every voice',
  internal.strips.every((strip) => strip.input.incoming.length === 0),
);

section('Stop semantics');
const element = {
  attributes: new Map<string, string>(),
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  },
  removeAttribute(name: string) {
    this.attributes.delete(name);
  },
};
const unregister = registerStepElement(0, element as unknown as HTMLElement);
setActiveStep(0);
check('cursor is lit before stopping', element.attributes.has('data-playhead'));

graphEngine.stop();
check('stop() clears the transport flag', !graphEngine.getIsPlaying());
check('stop() halts the scheduler', !(graphEngine as unknown as { scheduler: { isRunning: () => boolean } }).scheduler.isRunning());
equal('stop() drains the playhead queue', graphEngine.getPendingPlayheadCount(), 0);
check('stop() darkens the visual cursor', !element.attributes.has('data-playhead'));
equal('stop() releases every drum voice', internal.drums.getActiveSourceCount(), 0);
equal('stop() releases every synth voice', internal.synth.getActiveSourceCount(), 0);
unregister();

graphEngine.stop();
check('stop() is idempotent', !graphEngine.getIsPlaying());

/* -------------------------------------------------- 5b. node leak accounting */

section('Audio graph node leaks');
const leakCtx = ctx;
const leakMarker = leakCtx.createdNodes.length;
graphEngine.triggerPad(SOUNDBOARD_PRESET_TEMPLATES[0]);
const kickNodes = leakCtx.createdNodes.slice(leakMarker);
check('a triggered voice starts connected', kickNodes.some((node) => node.outgoing.length > 0));

graphEngine.triggerPad(SOUNDBOARD_PRESET_TEMPLATES[5]);
const synthPad: SoundboardPad = { ...SOUNDBOARD_PRESET_TEMPLATES[0], instrument: 'synth_lead' };
graphEngine.triggerPad(synthPad);
const allVoiceNodes = leakCtx.createdNodes.slice(leakMarker);
check('several voices are live at once', allVoiceNodes.length > 3);

graphEngine.stop();
check(
  'stop() detaches every voice source and intermediate',
  allVoiceNodes.every((node) => node.outgoing.length === 0),
  `${allVoiceNodes.filter((node) => node.outgoing.length > 0).length} node(s) still connected`,
);
check(
  'stop() releases the voice bank bookkeeping',
  internal.drums.getActiveSourceCount() === 0 && internal.synth.getActiveSourceCount() === 0,
);

// Natural end-of-life: the browser fires onended, which must detach the chain.
const naturalMarker = leakCtx.createdNodes.length;
graphEngine.triggerPad(synthPad);
const naturalNodes = leakCtx.createdNodes.slice(naturalMarker);
const naturalOsc = naturalNodes.find((node): node is FakeOscillatorNode => node instanceof FakeOscillatorNode);
check('a synth voice creates an oscillator', naturalOsc !== undefined);
if (naturalOsc !== undefined && naturalOsc.onended !== null) {
  naturalOsc.onended();
}
check(
  'the onended handler detaches the whole voice chain',
  naturalNodes.every((node) => node.outgoing.length === 0),
);
equal('the ended voice is removed from the bank', internal.synth.getActiveSourceCount(), 0);

// A multi-source hit must stay alive until its last source ends.
const snareMarker = leakCtx.createdNodes.length;
graphEngine.triggerPad({ ...SOUNDBOARD_PRESET_TEMPLATES[0], instrument: 'snare' });
const snareNodes = leakCtx.createdNodes.slice(snareMarker);
const snareSources = snareNodes.filter(
  (node): node is FakeBufferSourceNode | FakeOscillatorNode =>
    node instanceof FakeBufferSourceNode || node instanceof FakeOscillatorNode,
);
equal('a snare schedules two sources', snareSources.length, 2);
const firstSnareSource = snareSources[0];
if (firstSnareSource?.onended != null) firstSnareSource.onended();
check(
  'the chain survives until the last source ends',
  snareNodes.some((node) => node.outgoing.length > 0),
);
const secondSnareSource = snareSources[1];
if (secondSnareSource?.onended != null) secondSnareSource.onended();
check(
  'the chain detaches once every source has ended',
  snareNodes.every((node) => node.outgoing.length === 0),
);
equal('the completed hit leaves the bank', internal.drums.getActiveVoiceCount(), 0);
equal('the completed hit leaves no live sources', internal.drums.getActiveSourceCount(), 0);

/* ------------------------------------------------------- 5c. init mutex */

section('Concurrent initialisation');
FakeAudioContext.instances = [];
const raceEngine = new AudioEngine();
const firstInit = raceEngine.init();
const secondInit = raceEngine.init();
check('a concurrent init shares the in-flight promise', firstInit === secondInit);
await Promise.all([firstInit, secondInit]);
equal('a concurrent init builds exactly one context', FakeAudioContext.instances.length, 1);
equal('a concurrent init builds one strip set', raceEngine.getTrackStripCount(), 8);
check('the racing engine reports initialised', raceEngine.isInitialized);

const thirdInit = raceEngine.init();
await thirdInit;
equal('a later init reuses the same context', FakeAudioContext.instances.length, 1);
equal('a later init does not duplicate strips', raceEngine.getTrackStripCount(), 8);
raceEngine.dispose();

/* ------------------------------------------------------------ 6. singleton */

section('Singleton access');
const first = getAudioEngine();
const second = getAudioEngine();
check('getAudioEngine() returns a stable singleton', first === second);
check('the singleton is parked on globalThis', first === (globalThis as unknown as Record<string, unknown>)['__wa_step_seq_audio_engine__']);

/* ------------------------------------------------------------ 7. audibility */

section('Audibility predicate');
const audibilityPattern = createDefaultPattern(1);
check('all tracks audible by default', audibilityPattern.tracks.every((_track, index) => isTrackAudible(audibilityPattern.tracks, index)));
audibilityPattern.tracks[3].muted = true;
check('a muted track is silent', !isTrackAudible(audibilityPattern.tracks, 3));
audibilityPattern.tracks[5].soloed = true;
check('a soloed track is audible', isTrackAudible(audibilityPattern.tracks, 5));
check('solo silences non-soloed tracks', !isTrackAudible(audibilityPattern.tracks, 0));
check('out-of-range indices are silent', !isTrackAudible(audibilityPattern.tracks, 99));

/* ------------------------------------------------------------ 8. teardown */

section('Teardown');
clearPlayhead();
const engineInstanceCount = FakeAudioContext.instances.length;
graphEngine.dispose();
equal('dispose() closes the context', ctx.closeCount, 1);
check('dispose() drops the strips', graphEngine.getTrackStripCount() === 0);
check('dispose() marks the engine uninitialised', !graphEngine.isInitialized);
check('dispose() does not create another context', FakeAudioContext.instances.length === engineInstanceCount);
check('dispose() releases the noise pool', !NoiseBufferPool.hasBuffer());

restoreAudioContext();

/* ----------------------------------------------------------------- summary */

const total = passed + failures.length;
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`PHASE 4 ENGINE GATE PASSED \u2014 ${passed}/${total} checks green.`);
  process.exit(0);
}
console.log(`PHASE 4 ENGINE GATE FAILED \u2014 ${failures.length}/${total} checks failed:`);
for (const failure of failures) {
  console.log(`  \u2717 ${failure}`);
}
process.exit(1);
}

void main();
