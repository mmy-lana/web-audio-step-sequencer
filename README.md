# Web Audio Step Sequencer & Soundboard (MODEL-16)

A hardware-inspired 8-track step sequencer and 16-pad performance soundboard running entirely client-side in the browser via the Web Audio API, Next.js (App Router), and Tailwind CSS v4.

**Live Demo:** [web-audio-step-sequencer.vercel.app](https://web-audio-step-sequencer.vercel.app)

---

## Highlights

* **Pure Algorithmic Synthesis:** Zero external sample files or network audio requests. Drums (808/909-style kicks, snares, hats, claps, toms) and subtractive lead voices are synthesized mathematically in real time using native `AudioNode` primitives.
* **Jitter-Free Lookahead Clock:** Implements Chris Wilson's Web Audio scheduling architecture with a 25ms interval lookahead window, guaranteeing microsecond precision regardless of main-thread UI operations.
* **Hardware Synthesizer UI:** Tactile rotary potentiometers with vertical pointer-capture physics, domed LED diodes with static glow palettes, seven-segment tempo displays, and mechanical toggle switches.
* **Tactile Performance Pads:** 4x4 silicone pad matrix designed for sub-10ms trigger response on `pointerdown`, complete with zero-latency hardware keyboard hotkeys (`1234`, `QWER`, `ASDF`, `ZXCV`).
* **Non-Blocking Preset Management:** 8 genre-seeded pattern banks (Electro, Deep House, Techno, Boom Bap, Synthwave, Drum & Bass, Dub Chord, Trap) with debounced LocalStorage persistence and sanitized JSON import/export.

---

## Technical Stack

* **Framework:** Next.js (App Router)
* **UI & Core:** React 19, TypeScript (Strict Mode)
* **Styling:** Tailwind CSS v4 (CSS-first `@theme` configuration, zero runtime class interpolation)
* **Audio Engine:** Pure Web Audio API (`AudioContext`, `BiquadFilterNode`, `WaveShaperNode`, `DelayNode`, `DynamicsCompressorNode`, `StereoPannerNode`)
* **State Management:** Zustand (Curried selectors with `useShallow`)
* **Data Validation:** Zod (Runtime JSON import validation, depth limiters, prototype-pollution revivers)
* **Package Manager:** pnpm

---

## Audio Graph Topology

```text
Track Voices (Kick, Snare, Hats, Clap, Toms, Lead)
   │
   ▼
Track Channel Strip (StereoPannerNode -> GainNode)
   │
   ▼
Master Bus Summing GainNode <── Pad Bus (GainNode) <── Soundboard Matrix
   │
   ▼
Master Overdrive (WaveShaperNode 2048-pt curve + Dry/Wet)
   │
   ▼
Master Feedback Delay (Tempo-synced interval + Feedback Gain + Dry/Wet)
   │
   ▼
Master Resonant Filter (Lowpass / Highpass / Bandpass / Notch)
   │
   ▼
Master Volume GainNode
   │
   ▼
DynamicsCompressorNode (Hard limiter: -1dB threshold, 20:1 ratio)
   │
   ├───────────────────────────────┐
   ▼                               ▼
AudioContext.destination    ChannelSplitterNode(2)
                                   │
                           ┌───────┴───────┐
                           ▼               ▼
                     Analyser L       Analyser R
                           │               │
                           └───────┬───────┘
                                   ▼
                         Stereo LED VU Meter
```

---

## Feature Matrix

| Module | Features |
| :--- | :--- |
| **Sequencer** | 8 tracks, 16/32 steps, per-step velocity, trigger probability (0-100%), semitone pitch offsets (-24 to +24), constant-pair swing timing. |
| **Soundboard** | 16 velocity-buffered performance pads, visual flash feedback, instant touch response (`touch-action: manipulation`), keyboard shortcuts. |
| **Master FX** | Waveshaper overdrive saturation, tempo delay (0.01s - 1.0s), resonant filter (20Hz - 20kHz, Q 0.1 - 20), output limiter. |
| **Mixer** | Individual channel strips with Volume (0-100), Pan (L100 - C - R100), Mute, and Solo latches. |
| **Storage** | 8 instant pattern memory slots, auto-save with in-memory quota fallback, non-blocking discard checks, export/import JSON. |
| **Responsiveness**| Desktop rack chassis (1024px+), tablet horizontal matrix scroller (768px-1023px), mobile tabbed single-track view (360px-430px). |

---

## Keyboard Controls

* **Spacebar:** Start / Stop Transport (automatically bypassed when focusing buttons, sliders, or inputs)
* **Keys 1, 2, 3, 4:** Row 1 Pads (Kick Deep, Kick Punch, Snare Tight, Snare Fat)
* **Keys Q, W, E, R:** Row 2 Pads (Closed Hat, Open Hat, Clap Classic, Clap Snap)
* **Keys A, S, D, F:** Row 3 Pads (Tom Low, Tom High, Zap Lead, Bass Stab)
* **Keys Z, X, C, V:** Row 4 Pads (Laser, Chime, Sub Boom, Rim Click)

---

## Getting Started

### Prerequisites

* Node.js 20+
* pnpm (`corepack enable pnpm` or `npm install -g pnpm`)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/web-audio-step-sequencer.git
cd web-audio-step-sequencer

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Quality Gates & Verification

The project includes an automated test harness validating audio graph integrity, memory leak prevention, hydration compatibility, and state mutations:

```bash
# Run all quality gates (types, defaults, store, render, engine, hydration)
pnpm run verify

# Run production build and quality gates
pnpm run gate
```

---

## Architecture Guarantees

* **Zero Hydration Mismatches:** All client/server state boundaries are synchronized using `useSyncExternalStore` and deterministic default parameters.
* **Deterministic Audio Disposal:** All scheduled oscillators, noise buffers, and intermediate gain stages register cleanup callbacks, ensuring zero orphaned nodes after transport stops.
* **Safe JSON Ingestion:** Pattern files pass through custom JSON revivers blocking `__proto__` and `constructor` access before parsing against strict Zod schema depth boundaries.

---

## License

MIT License. Free for personal and commercial use.
