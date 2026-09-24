/**
 * Pre-allocated white-noise pool.
 *
 * Generating `Math.random()` samples inside a trigger would put a multi-
 * millisecond allocation on the audio scheduling path and cause dropouts. The
 * shared buffer is created once, on the first trigger after the audio context is
 * unlocked, and every noise voice reads from it with a random start offset.
 */
export class NoiseBufferPool {
  private static buffer: AudioBuffer | null = null;

  /** Length of the generated noise bed, in seconds. */
  public static readonly BUFFER_SECONDS = 2;

  /**
   * Returns a looping noise buffer matching the context sample rate, rebuilding
   * it if the context runs at a different rate than the cached copy.
   */
  public static getSharedBuffer(ctx: AudioContext): AudioBuffer {
    if (
      this.buffer !== null &&
      this.buffer.sampleRate === ctx.sampleRate &&
      this.buffer.numberOfChannels > 0
    ) {
      return this.buffer;
    }

    const length = Math.max(1, Math.floor(ctx.sampleRate * this.BUFFER_SECONDS));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.buffer = buffer;
    return buffer;
  }

  /**
   * A random read offset inside the shared bed. Distinct offsets per voice
   * prevent correlation artefacts when several noise voices fire together.
   */
  public static getRandomOffset(buffer: AudioBuffer): number {
    const usable = Math.max(0, buffer.duration - 0.05);
    if (usable <= 0) return 0;
    return Math.random() * usable;
  }

  /** Drops the cached buffer, e.g. when the audio context is torn down. */
  public static dispose(): void {
    this.buffer = null;
  }

  /** Diagnostics for the verification gate. */
  public static hasBuffer(): boolean {
    return this.buffer !== null;
  }
}
