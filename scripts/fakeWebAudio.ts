/**
 * Strict Web Audio test double.
 *
 * Node has no Web Audio implementation, so the audio gates install this double
 * for the subset of the API the engine uses. It is deliberately strict: an
 * exponential ramp to exactly zero throws, exactly as a real AudioContext does,
 * so an envelope bug fails a gate instead of sounding wrong in the browser.
 *
 * Every node records both directions of every connection, which is what lets the
 * gates assert graph wiring and detect leaked intermediate nodes.
 */

/** Handle returned by `installFakeAudioContext`, restoring the real global. */
export type RestoreAudioContext = () => void;

interface AudioScope {
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
}

/**
 * Installs the double as `globalThis.AudioContext`. Returns a restore function;
 * call it before the process exits so other gates see the real environment.
 */
export function installFakeAudioContext(): RestoreAudioContext {
  const scope = globalThis as unknown as AudioScope;
  const previous = scope.AudioContext;
  scope.AudioContext = FakeAudioContext;
  return () => {
    scope.AudioContext = previous;
  };
}


export class FakeAudioParam {
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

export class FakeNode {
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

export class FakeGainNode extends FakeNode {
  public readonly gain = new FakeAudioParam(1);
}

export class FakeStereoPannerNode extends FakeNode {
  public readonly pan = new FakeAudioParam(0);
}

export class FakeBiquadFilterNode extends FakeNode {
  public type: BiquadFilterType = 'lowpass';
  public readonly frequency = new FakeAudioParam(350);
  public readonly Q = new FakeAudioParam(1);
  public readonly detune = new FakeAudioParam(0);
  public readonly gain = new FakeAudioParam(0);
}

export class FakeDelayNode extends FakeNode {
  public readonly delayTime = new FakeAudioParam(0);
}

export class FakeWaveShaperNode extends FakeNode {
  public curve: Float32Array<ArrayBuffer> | null = null;
  public oversample: OverSampleType = 'none';
}

export class FakeDynamicsCompressorNode extends FakeNode {
  public readonly threshold = new FakeAudioParam(-24);
  public readonly knee = new FakeAudioParam(30);
  public readonly ratio = new FakeAudioParam(12);
  public readonly attack = new FakeAudioParam(0.003);
  public readonly release = new FakeAudioParam(0.25);
  public readonly reduction = 0;
}

export class FakeChannelSplitterNode extends FakeNode {
  constructor(public readonly numberOfOutputs: number) {
    super();
  }
}

export class FakeAnalyserNode extends FakeNode {
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

export class FakeBufferSourceNode extends FakeNode {
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

export class FakeOscillatorNode extends FakeNode {
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

export class FakeAudioBuffer {
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

export class FakeAudioContext {
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
