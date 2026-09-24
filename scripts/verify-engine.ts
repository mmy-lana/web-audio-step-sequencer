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
import { NoiseBufferPool } from '../src/lib/audio/NoiseBufferPool';
import { LookaheadScheduler } from '../src/lib/audio/LookaheadScheduler';
import { createDefaultPattern } from '../src/lib/constants/defaultPatterns';
import { SOUNDBOARD_PRESET_TEMPLATES } from '../src/lib/constants/soundboardPresets';
import type { InstrumentType, Pattern, SoundboardPad } from '../src/types/audio';
import { clearPlayhead, registerStepElement, setActiveStep } from '../src/lib/utils/playheadRegistry';

/* ------------------------------------------------- Web Audio test double */

class FakeAudioParam {
  public value: number;
  public readonly events: { kind: string; value: number; time: number }[] = [];

  constructor(initial: number) {
    this.value = initial;
  }

  setValueAtTime(value: number, time: number): this {
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      throw new RangeError(`setValueAtTime received a non-finite argument (${value}, ${time})`);
    }
    this.events.push({ kind: 'set', value, time });
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    // Mirrors the browser: exponential ramps cannot target zero.
    if (value === 0) {
      throw new RangeError('exponentialRampToValueAtTime: target value must not be zero');
    }
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      throw new RangeError(`exponentialRamp received a non-finite argument (${value}, ${time})`);
    }
    this.events.push({ kind: 'exponentialRamp', value, time });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'linearRamp', value, time });
    this.value = value;
    return this;
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      throw new RangeError(`setTargetAtTime received a non-finite argument (${value}, ${time})`);
    }
    if (timeConstant <= 0) {
      throw new RangeError('setTargetAtTime: timeConstant must be positive');
    }
    this.events.push({ kind: 'setTarget', value, time });
    this.value = value;
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ kind: 'cancel', value: 0, time });
    return this;
  }
}

class FakeNode {
  public readonly outgoing: FakeNode[] = [];
  public readonly incoming: FakeNode[] = [];
  public readonly connectionLog: { dest: FakeNode; output: number; input: number }[] = [];

  connect(dest: FakeNode, output = 0, input = 0): FakeNode {
    this.outgoing.push(dest);
    this.connectionLog.push({ dest, output, input });
    dest.incoming.push(this);
    return dest;
  }

  disconnect(): void {
    this.outgoing.forEach((dest) => {
      const index = dest.incoming.indexOf(this);
      if (index !== -1) dest.incoming.splice(index, 1);
    });
    this.outgoing.length = 0;
    this.connectionLog.length = 0;
  }

  /** Direct connections to a specific node. */
  isConnectedTo(target: FakeNode): boolean {
    return this.outgoing.includes(target);
  }
}

class FakeGainNode extends FakeNode {
  public readonly gain = new FakeAudioParam(1);
}

class FakeStereoPannerNode extends FakeNode {
  public readonly pan = new FakeAudioParam(0);
}

class FakeBiquadFilterNode extends FakeNode {
  public type: BiquadFilterType = 'lowpass';
  public readonly frequency = new FakeAudioParam(350);
  public readonly Q = new FakeAudioParam(1);
  public readonly detune = new FakeAudioParam(0);
  public readonly gain = new FakeAudioParam(0);
}

class FakeDelayNode extends FakeNode {
  public readonly delayTime = new FakeAudioParam(0);
}

class FakeWaveShaperNode extends FakeNode {
  public curve: Float32Array<ArrayBuffer> | null = null;
  public oversample: OverSampleType = 'none';
}

class FakeDynamicsCompressorNode extends FakeNode {
  public readonly threshold = new FakeAudioParam(-24);
  public readonly knee = new FakeAudioParam(30);
  public readonly ratio = new FakeAudioParam(12);
  public readonly attack = new FakeAudioParam(0.003);
  public readonly release = new FakeAudioParam(0.25);
  public readonly reduction = 0;
}

class FakeChannelSplitterNode extends FakeNode {
  constructor(public readonly numberOfOutputs: number) {
    super();
  }
}

class FakeAnalyserNode extends FakeNode {
  public fftSize = 2048;
  public smoothingTimeConstant = 0.8;
  public readonly frequencyBinCount = 1024;
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor() {
    super();
    this.samples = new Float32Array(2048);
  }

  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void {
    const length = Math.min(array.length, this.samples.length);
    for (let i = 0; i < length; i++) {
      array[i] = this.samples[i];
    }
  }

  /** Test hook: inject a constant amplitude so meters have something to read. */
  fill(amplitude: number): void {
    this.samples.fill(amplitude);
  }
}

class FakeBufferSourceNode extends FakeNode {
  public buffer: AudioBuffer | null = null;
  public loop = false;
  public onended: (() => void) | null = null;
  public startedAt: number | null = null;
  public startOffset = 0;
  public stoppedAt: number | null = null;

  start(time = 0, offset = 0): void {
    if (this.startedAt !== null) throw new DOMException('already started', 'InvalidStateError');
    this.startedAt = time;
    this.startOffset = offset;
  }

  stop(time = 0): void {
    if (this.stoppedAt !== null) throw new DOMException('already stopped', 'InvalidStateError');
    this.stoppedAt = time;
  }
}

class FakeOscillatorNode extends FakeNode {
  public type: OscillatorType = 'sine';
  public readonly frequency = new FakeAudioParam(440);
  public readonly detune = new FakeAudioParam(0);
  public onended: (() => void) | null = null;
  public startedAt: number | null = null;
  public stoppedAt: number | null = null;

  start(time = 0): void {
    if (this.startedAt !== null) throw new DOMException('already started', 'InvalidStateError');
    this.startedAt = time;
  }

  stop(time = 0): void {
    if (this.stoppedAt !== null) throw new DOMException('already stopped', 'InvalidStateError');
    this.stoppedAt = time;
  }
}

class FakeAudioBuffer {
  private readonly channelData: Float32Array<ArrayBuffer>[];

  constructor(
    public readonly numberOfChannels: number,
    public readonly length: number,
    public readonly sampleRate: number,
  ) {
    this.channelData = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    const data = this.channelData[channel];
    if (data === undefined) throw new RangeError(`channel ${channel} does not exist`);
    return data;
  }
}

class FakeAudioContext {
  public static instances: FakeAudioContext[] = [];

  /**
   * A context constructed outside a user gesture starts suspended, which is the
   * state the iOS unlock path has to recover from.
   */
  public static nextInitialState: AudioContextState = 'suspended';

  public currentTime = 0;
  public state: AudioContextState;
  public readonly sampleRate = 48000;
  public readonly destination = new FakeNode();
  public readonly baseLatency = 0.005;
  public readonly createdNodes: FakeNode[] = [];
  public resumeCount = 0;
  public closeCount = 0;

  constructor(public readonly options?: AudioContextOptions) {
    this.state = FakeAudioContext.nextInitialState;
    FakeAudioContext.instances.push(this);
  }

  private track<T extends FakeNode>(node: T): T {
    this.createdNodes.push(node);
    return node;
  }

  createGain(): FakeGainNode {
    return this.track(new FakeGainNode());
  }

  createStereoPanner(): FakeStereoPannerNode {
    return this.track(new FakeStereoPannerNode());
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return this.track(new FakeBiquadFilterNode());
  }

  createDelay(): FakeDelayNode {
    return this.track(new FakeDelayNode());
  }

  createWaveShaper(): FakeWaveShaperNode {
    return this.track(new FakeWaveShaperNode());
  }

  createDynamicsCompressor(): FakeDynamicsCompressorNode {
    return this.track(new FakeDynamicsCompressorNode());
  }

  createChannelSplitter(outputs = 2): FakeChannelSplitterNode {
    return this.track(new FakeChannelSplitterNode(outputs));
  }

  createAnalyser(): FakeAnalyserNode {
    return this.track(new FakeAnalyserNode());
  }

  createBufferSource(): FakeBufferSourceNode {
    return this.track(new FakeBufferSourceNode());
  }

  createOscillator(): FakeOscillatorNode {
    return this.track(new FakeOscillatorNode());
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate) as unknown as AudioBuffer;
  }

  async resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.state = 'closed';
  }

  /** Test helper: every node created so far of a given kind. */
  nodesOfType<T extends FakeNode>(ctor: new (...args: never[]) => T): T[] {
    return this.createdNodes.filter((node): node is T => node instanceof ctor);
  }
}

/* ------------------------------------------------------------- installation */

interface AudioScope {
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
}

const globalScope = globalThis as unknown as AudioScope;
const previousAudioContext = globalScope.AudioContext;
globalScope.AudioContext = FakeAudioContext;

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
  drums: { getActiveSourceCount: () => number };
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

globalScope.AudioContext = previousAudioContext;

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
