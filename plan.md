# Architecture & Implementation Plan: Web Audio Step Sequencer & Soundboard

## 1. Stack & Architecture Standards

### 1.1 Technology Stack Manifest
- **Framework:** Next.js (latest, App Router)
- **Runtime & UI Library:** React (latest, React 19)
- **Language:** TypeScript (latest, strict mode, `noImplicitAny: true`, `strictNullChecks: true`)
- **Styling:** Tailwind CSS (v4, CSS-first architecture)
- **PostCSS:** `@tailwindcss/postcss` (latest)
- **State Management:** Zustand (latest)
- **Validation Engine:** Zod (latest)
- **Script Runner:** `tsx` (latest, for schema verification and validation gates)

### 1.2 Tailwind CSS v4 Configuration
Tailwind v4 eliminates `tailwind.config.js`. Styling configuration lives inside `src/app/globals.css`:
- Declared with `@import "tailwindcss";`.
- Design tokens, hardware palettes, and dark anodized gradients configured via `@theme`.
- Static color mappings implemented via strict CSS utility lookups. Dynamic string interpolation (such as `` `shadow-led-${color}` ``) is forbidden because the v4 scanner will not emit dynamic utilities.

### 1.3 Strict Unidirectional Dependency Flow
Circular dependencies are prevented by enforcing this unidirectional import hierarchy:
```
src/lib/validation
       │
       ▼
src/types
       │
       ▼
src/lib/constants
       │
       ▼
src/lib/utils, src/lib/storage, src/lib/audio
       │
       ▼
src/store (Zustand)
       │
       ▼
src/hooks
       │
       ▼
src/components/ui (Primitives)
       │
       ▼
src/components/molecules
       │
       ▼
src/components/organisms
       │
       ▼
src/app (Screens & Layouts)
```

### 1.4 Client/Server Isolation & Browser Globals
- `src/app/layout.tsx` remains strictly a Server Component without `'use client'` to support root metadata and `viewport` exports.
- All interactive pages, providers, hooks, and hardware components declare `'use client'` at the top.
- Zero browser globals (`window`, `localStorage`, `AudioContext`) are accessed at module evaluation time.
- `SafeStorageAdapter` executes capability detection lazily on first access.
- The audio engine is a module-level singleton accessed via `getAudioEngine()`, initialized synchronously inside an explicit click handler on the "POWER ON" hardware switch.

---

## 2. Canonical File Tree

```
web-audio-step-sequencer/
├── postcss.config.mjs
├── tsconfig.json
├── package.json
├── scripts/
│   └── verify-defaults.ts
└── src/
    ├── app/
    │   ├── globals.css
    │   ├── layout.tsx
    │   └── page.tsx
    ├── components/
    │   ├── ui/
    │   │   ├── ChassisScrew.tsx
    │   │   ├── KnobRotary.tsx
    │   │   ├── LedIndicator.tsx
    │   │   ├── LedVuMeter.tsx
    │   │   ├── MechanicalSwitch.tsx
    │   │   ├── PushButton.tsx
    │   │   └── SevenSegmentDisplay.tsx
    │   ├── molecules/
    │   │   ├── MasterFxPanel.tsx
    │   │   ├── PatternManagerBar.tsx
    │   │   ├── SoundboardTriggerPad.tsx
    │   │   ├── StepCell.tsx
    │   │   ├── StepEditorSheet.tsx
    │   │   ├── TrackHeader.tsx
    │   │   └── TransportControls.tsx
    │   └── organisms/
    │       ├── HardwareChassis.tsx
    │       ├── MobileNavPanel.tsx
    │       ├── PowerOnOverlay.tsx
    │       ├── SequencerMatrix.tsx
    │       └── SoundboardMatrix.tsx
    ├── hooks/
    │   ├── useAudioEngine.ts
    │   ├── useLocalPersistence.ts
    │   ├── usePlayheadTracker.ts
    │   ├── useRotaryDrag.ts
    │   └── useSoundboardKeyboard.ts
    ├── lib/
    │   ├── audio/
    │   │   ├── AudioContextManager.ts
    │   │   ├── AudioEngine.ts
    │   │   ├── DrumSynths.ts
    │   │   ├── EffectsChain.ts
    │   │   ├── LookaheadScheduler.ts
    │   │   ├── NoiseBufferPool.ts
    │   │   └── SynthVoice.ts
    │   ├── constants/
    │   │   ├── colorMap.ts
    │   │   ├── defaultPatterns.ts
    │   │   ├── soundboardPresets.ts
    │   │   └── storageKeys.ts
    │   ├── storage/
    │   │   └── patternStorage.ts
    │   ├── utils/
    │   │   ├── audioMath.ts
    │   │   └── tapTempo.ts
    │   └── validation/
    │       └── pattern.ts
    ├── store/
    │   └── useSequencerStore.ts
    └── types/
        ├── audio.ts
        └── storage.ts
```

---

## 3. Data Schema & Pure TypeScript Interfaces

### 3.1 Zod Schemas & Validation Logic
```typescript
// src/lib/validation/pattern.ts
import { z } from 'zod';

export const WaveformSchema = z.enum(['sine', 'square', 'sawtooth', 'triangle']);

export const InstrumentTypeSchema = z.enum([
  'kick',
  'snare',
  'hihat_closed',
  'hihat_open',
  'clap',
  'tom_low',
  'tom_high',
  'synth_lead',
]);

export const TrackColorSchema = z.enum([
  'amber',
  'crimson',
  'cyan',
  'emerald',
  'violet',
  'orange',
  'electric_blue',
  'lime',
]);

export const EnvelopeSettingsSchema = z.object({
  attack: z.number().min(0.001).max(2.0),
  decay: z.number().min(0.01).max(2.0),
  sustain: z.number().min(0.0).max(1.0),
  release: z.number().min(0.01).max(4.0),
});

export const FilterSettingsSchema = z.object({
  cutoff: z.number().min(20).max(20000),
  resonance: z.number().min(0.1).max(20.0),
  type: z.enum(['lowpass', 'highpass', 'bandpass', 'notch']),
});

export const SynthParamsSchema = z.object({
  waveform: WaveformSchema,
  detune: z.number().min(-1200).max(1200),
  envelope: EnvelopeSettingsSchema,
  filter: FilterSettingsSchema,
  pitchDecay: z.number().min(0.001).max(1.0).optional(),
  baseFrequency: z.number().min(20).max(2000),
});

export const StepSchema = z.object({
  index: z.number().int().min(0).max(31),
  active: z.boolean(),
  velocity: z.number().min(0.0).max(1.0),
  probability: z.number().min(0.0).max(1.0),
  pitchOffset: z.number().int().min(-24).max(24),
});

export const TrackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(30),
  instrument: InstrumentTypeSchema,
  color: TrackColorSchema,
  muted: z.boolean(),
  soloed: z.boolean(),
  volume: z.number().min(0.0).max(1.0),
  pan: z.number().min(-1.0).max(1.0),
  params: SynthParamsSchema,
  steps: z.array(StepSchema).min(16).max(32),
});

export const DelaySettingsSchema = z.object({
  time: z.number().min(0.01).max(1.0),
  feedback: z.number().min(0.0).max(0.95),
  wetDry: z.number().min(0.0).max(1.0),
});

export const DistortionSettingsSchema = z.object({
  drive: z.number().min(0.0).max(100.0),
  wetDry: z.number().min(0.0).max(1.0),
});

export const MasterFxSchema = z.object({
  filter: FilterSettingsSchema,
  delay: DelaySettingsSchema,
  distortion: DistortionSettingsSchema,
  masterVolume: z.number().min(0.0).max(1.2),
});

export const PatternSchema = z.object({
  schemaVersion: z.literal(1),
  slot: z.number().int().min(1).max(8),
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  bpm: z.number().int().min(40).max(280),
  swing: z.number().min(0.0).max(0.5), // Capped at 0.5 (3:1 swing ratio)
  stepCount: z.union([z.literal(16), z.literal(32)]),
  tracks: z.array(TrackSchema).length(8),
  masterFx: MasterFxSchema,
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
}).refine(
  (pat) => pat.tracks.every((track) => track.steps.length === pat.stepCount),
  { message: 'Every track steps array length must exactly match pattern stepCount' }
);

export const MAX_IMPORT_SIZE_BYTES = 500 * 1024; // 500 KB limit

export function validatePatternJson(rawJson: string): z.infer<typeof PatternSchema> {
  if (rawJson.length > MAX_IMPORT_SIZE_BYTES) {
    throw new Error('Pattern file exceeds maximum allowed size (500 KB)');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Malformed JSON payload');
  }
  return PatternSchema.parse(parsed);
}
```

### 3.2 Pure TypeScript Domain Types
```typescript
// src/types/audio.ts
import { z } from 'zod';
import {
  WaveformSchema,
  InstrumentTypeSchema,
  TrackColorSchema,
  EnvelopeSettingsSchema,
  FilterSettingsSchema,
  SynthParamsSchema,
  StepSchema,
  TrackSchema,
  DelaySettingsSchema,
  DistortionSettingsSchema,
  MasterFxSchema,
  PatternSchema,
} from '@/lib/validation/pattern';

export type WaveformType = z.infer<typeof WaveformSchema>;
export type InstrumentType = z.infer<typeof InstrumentTypeSchema>;
export type TrackColor = z.infer<typeof TrackColorSchema>;
export type EnvelopeSettings = z.infer<typeof EnvelopeSettingsSchema>;
export type FilterSettings = z.infer<typeof FilterSettingsSchema>;
export type SynthParams = z.infer<typeof SynthParamsSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type DelaySettings = z.infer<typeof DelaySettingsSchema>;
export type DistortionSettings = z.infer<typeof DistortionSettingsSchema>;
export type MasterFxSettings = z.infer<typeof MasterFxSchema>;
export type Pattern = z.infer<typeof PatternSchema>;

export interface SoundboardPad {
  id: string;
  label: string;
  keyBinding: string;
  instrument: InstrumentType;
  color: TrackColor;
  params: SynthParams;
  lastTriggeredAt: number | null;
}

export interface VoiceTriggerOptions {
  isOpen?: boolean;
  isHigh?: boolean;
}

export interface PlayheadScheduleItem {
  step: number;
  time: number;
}
```

```typescript
// src/types/storage.ts
export interface StorageSlotMetadata {
  slot: number;
  name: string;
  updatedAt: number;
  isEmpty: boolean;
  isCorrupt: boolean;
}

export interface StorageResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  isMemoryFallback?: boolean;
  isQuotaExceeded?: boolean;
}
```

```typescript
// src/lib/constants/storageKeys.ts
export const STORAGE_KEYS = {
  PATTERN_SLOT_PREFIX: 'wa_step_seq_slot_',
  WORKING_COPY: 'wa_step_seq_working_copy',
} as const;
```

```typescript
// src/lib/constants/colorMap.ts
import { TrackColor } from '@/types/audio';

export interface ColorDefinition {
  ledOn: string;
  ledOff: string;
  borderActive: string;
  borderInactive: string;
  textActive: string;
  textInactive: string;
  glowClass: string;
}

export const COLOR_MAP: Record<TrackColor, ColorDefinition> = {
  amber: {
    ledOn: 'bg-[#ffb703]',
    ledOff: 'bg-[#402d00]',
    borderActive: 'border-[#ffb703]',
    borderInactive: 'border-[#402d00]',
    textActive: 'text-[#ffb703]',
    textInactive: 'text-[#805b00]',
    glowClass: 'shadow-[0_0_8px_#ffb703,0_0_14px_rgba(255,183,3,0.5)]',
  },
  crimson: {
    ledOn: 'bg-[#ff0055]',
    ledOff: 'bg-[#400015]',
    borderActive: 'border-[#ff0055]',
    borderInactive: 'border-[#400015]',
    textActive: 'text-[#ff0055]',
    textInactive: 'text-[#80002b]',
    glowClass: 'shadow-[0_0_8px_#ff0055,0_0_14px_rgba(255,0,85,0.5)]',
  },
  cyan: {
    ledOn: 'bg-[#00f0ff]',
    ledOff: 'bg-[#003c40]',
    borderActive: 'border-[#00f0ff]',
    borderInactive: 'border-[#003c40]',
    textActive: 'text-[#00f0ff]',
    textInactive: 'text-[#007880]',
    glowClass: 'shadow-[0_0_8px_#00f0ff,0_0_14px_rgba(0,240,255,0.5)]',
  },
  emerald: {
    ledOn: 'bg-[#00ff66]',
    ledOff: 'bg-[#00401a]',
    borderActive: 'border-[#00ff66]',
    borderInactive: 'border-[#00401a]',
    textActive: 'text-[#00ff66]',
    textInactive: 'text-[#008033]',
    glowClass: 'shadow-[0_0_8px_#00ff66,0_0_14px_rgba(0,255,102,0.5)]',
  },
  violet: {
    ledOn: 'bg-[#b5179e]',
    ledOff: 'bg-[#370030]',
    borderActive: 'border-[#b5179e]',
    borderInactive: 'border-[#370030]',
    textActive: 'text-[#b5179e]',
    textInactive: 'text-[#6d0e5f]',
    glowClass: 'shadow-[0_0_8px_#b5179e,0_0_14px_rgba(181,23,158,0.5)]',
  },
  orange: {
    ledOn: 'bg-[#f77f00]',
    ledOff: 'bg-[#472400]',
    borderActive: 'border-[#f77f00]',
    borderInactive: 'border-[#472400]',
    textActive: 'text-[#f77f00]',
    textInactive: 'text-[#8f4900]',
    glowClass: 'shadow-[0_0_8px_#f77f00,0_0_14px_rgba(247,127,0,0.5)]',
  },
  electric_blue: {
    ledOn: 'bg-[#4361ee]',
    ledOff: 'bg-[#0e163b]',
    borderActive: 'border-[#4361ee]',
    borderInactive: 'border-[#0e163b]',
    textActive: 'text-[#4361ee]',
    textInactive: 'text-[#203496]',
    glowClass: 'shadow-[0_0_8px_#4361ee,0_0_14px_rgba(67,97,238,0.5)]',
  },
  lime: {
    ledOn: 'bg-[#ccff00]',
    ledOff: 'bg-[#334000]',
    borderActive: 'border-[#ccff00]',
    borderInactive: 'border-[#334000]',
    textActive: 'text-[#ccff00]',
    textInactive: 'text-[#668000]',
    glowClass: 'shadow-[0_0_8px_#ccff00,0_0_14px_rgba(204,255,0,0.5)]',
  },
};
```

---

## 4. Storage Engine & Reactive State

### 4.1 Lazy Safe Storage Adapter
`SafeStorageAdapter` defers `localStorage` probing to first invocation, avoiding SSR and build evaluation errors. It reports quota exhaustion or memory fallbacks directly.

```typescript
// src/lib/storage/patternStorage.ts
import type { Pattern } from '@/types/audio';
import type { StorageResult, StorageSlotMetadata } from '@/types/storage';
import { PatternSchema, validatePatternJson, MAX_IMPORT_SIZE_BYTES } from '@/lib/validation/pattern';
import { STORAGE_KEYS } from '@/lib/constants/storageKeys';

class LazySafeStorageAdapter {
  private memoryStore = new Map<string, string>();
  private availabilityChecked = false;
  private isAvailable = false;
  public isQuotaExceeded = false;
  public isUsingMemoryFallback = false;

  private ensureAvailable(): boolean {
    if (this.availabilityChecked) return this.isAvailable;
    this.availabilityChecked = true;
    if (typeof window === 'undefined') {
      this.isAvailable = false;
      this.isUsingMemoryFallback = true;
      return false;
    }
    try {
      const probe = '__storage_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      this.isAvailable = true;
      return true;
    } catch {
      this.isAvailable = false;
      this.isUsingMemoryFallback = true;
      return false;
    }
  }

  public getItem(key: string): string | null {
    if (this.ensureAvailable()) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return this.memoryStore.get(key) ?? null;
      }
    }
    return this.memoryStore.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    if (this.ensureAvailable()) {
      try {
        window.localStorage.setItem(key, value);
        this.isQuotaExceeded = false;
        return;
      } catch (err) {
        if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
          this.isQuotaExceeded = true;
        }
        this.isUsingMemoryFallback = true;
        this.memoryStore.set(key, value);
        return;
      }
    }
    this.memoryStore.set(key, value);
  }

  public removeItem(key: string): void {
    if (this.ensureAvailable()) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        this.memoryStore.delete(key);
      }
    }
    this.memoryStore.delete(key);
  }
}

export const safeStorage = new LazySafeStorageAdapter();

export function saveWorkingCopy(pattern: Pattern): StorageResult<void> {
  const result = PatternSchema.safeParse(pattern);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  safeStorage.setItem(STORAGE_KEYS.WORKING_COPY, JSON.stringify(result.data));
  return {
    ok: true,
    isMemoryFallback: safeStorage.isUsingMemoryFallback,
    isQuotaExceeded: safeStorage.isQuotaExceeded,
  };
}

export function loadWorkingCopy(): StorageResult<Pattern> {
  const raw = safeStorage.getItem(STORAGE_KEYS.WORKING_COPY);
  if (!raw) return { ok: false, error: 'No working copy present' };
  try {
    const pattern = validatePatternJson(raw);
    return { ok: true, data: pattern };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid working copy JSON' };
  }
}

export function savePatternToSlot(slot: number, pattern: Pattern): StorageResult<void> {
  const targetPattern: Pattern = {
    ...pattern,
    slot,
    updatedAt: Date.now(),
  };
  const result = PatternSchema.safeParse(targetPattern);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  safeStorage.setItem(`${STORAGE_KEYS.PATTERN_SLOT_PREFIX}${slot}`, JSON.stringify(result.data));
  return {
    ok: true,
    isMemoryFallback: safeStorage.isUsingMemoryFallback,
    isQuotaExceeded: safeStorage.isQuotaExceeded,
  };
}

export function loadPatternFromSlot(slot: number): StorageResult<Pattern> {
  const raw = safeStorage.getItem(`${STORAGE_KEYS.PATTERN_SLOT_PREFIX}${slot}`);
  if (!raw) return { ok: false, error: `Slot ${slot} is empty` };
  try {
    const pattern = validatePatternJson(raw);
    if (pattern.slot !== slot) {
      return { ok: false, error: `Data corruption: Slot mismatch (expected ${slot}, found ${pattern.slot})` };
    }
    return { ok: true, data: pattern };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : `Failed to parse slot ${slot}` };
  }
}

export function duplicateSlot(fromSlot: number, toSlot: number): StorageResult<void> {
  const source = loadPatternFromSlot(fromSlot);
  if (!source.ok || !source.data) {
    return { ok: false, error: `Source slot ${fromSlot} is invalid or empty` };
  }
  return savePatternToSlot(toSlot, source.data);
}

export function clearPatternSlot(slot: number): void {
  safeStorage.removeItem(`${STORAGE_KEYS.PATTERN_SLOT_PREFIX}${slot}`);
}

export function getSlotMetadataList(): StorageSlotMetadata[] {
  const list: StorageSlotMetadata[] = [];
  for (let s = 1; s <= 8; s++) {
    const raw = safeStorage.getItem(`${STORAGE_KEYS.PATTERN_SLOT_PREFIX}${s}`);
    if (!raw) {
      list.push({ slot: s, name: `Slot ${s}`, updatedAt: 0, isEmpty: true, isCorrupt: false });
      continue;
    }
    try {
      const parsed = validatePatternJson(raw);
      list.push({ slot: s, name: parsed.name, updatedAt: parsed.updatedAt, isEmpty: false, isCorrupt: false });
    } catch {
      list.push({ slot: s, name: `Slot ${s} [Corrupt]`, updatedAt: 0, isEmpty: false, isCorrupt: true });
    }
  }
  return list;
}

export function exportPatternToJson(pattern: Pattern): StorageResult<string> {
  try {
    const parsed = PatternSchema.parse(pattern);
    return { ok: true, data: JSON.stringify(parsed, null, 2) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Pattern export serialization failed' };
  }
}

export function importPatternFromJson(rawJson: string, fileSize?: number): StorageResult<Pattern> {
  if (fileSize !== undefined && fileSize > MAX_IMPORT_SIZE_BYTES) {
    return { ok: false, error: 'Pattern file exceeds maximum allowed size (500 KB)' };
  }
  try {
    const pattern = validatePatternJson(rawJson);
    return { ok: true, data: pattern };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid pattern import file' };
  }
}
```

### 4.2 Zustand Store Architecture & Invariants
- **Autosave vs. Slots:** Active pattern changes write immediately to `workingCopy` (in-memory state) and debounce-persist to `STORAGE_KEYS.WORKING_COPY` at 300ms. A boolean `isDirty` flag tracks divergence from the saved slot. Flushes occur on `visibilitychange` and `pagehide`.
- **Slot Metadata Caching:** `slotMetadata` is retained in store state and refreshed on mount and after explicit mutations, avoiding 8 Zod schema parses on every render.
- **Save & Load Confirmation:** `saveSlotAction` returns `'saved' | 'needs_confirm' | 'error'`. `loadSlotAction` returns `'loaded' | 'created' | 'dirty_conflict' | 'error'`. An `isDirty === true` working copy returns `'dirty_conflict'`, which the UI answers with a **non-blocking inline banner** (never a synchronous `window.confirm`, which would stall the audio thread). An untouched slot is not a storage fault: it seeds a fresh working copy, returns `'created'`, and leaves the slot itself empty until the user saves.
- **Cross-Tab Notification:** Cross-tab `storage` events trigger a UI toast prompt ("Pattern modified in another tab. Reload?") instead of automatically applying changes, avoiding live knob fighting and sync loops.
- **Integer Sanitation:** Continuous knob controllers for `bpm` and `pitchOffset` pass through `Math.round()` prior to setting state, preventing fractional numbers from rejecting against Zod schema invariants.

---

## 5. Web Audio Engine & Architecture

### 5.1 Calibrated Routing Graph
```
Track Voices (Kick, Snare, HiHats, Clap, Toms, Synth)
    │
    ▼
Track Channel Strip (StereoPannerNode -> Track GainNode)
    │
    ▼
Master Bus Summing GainNode <── Pad Bus (Pad GainNode) <── Soundboard Pads
    │
    ▼
Overdrive / WaveShaperNode (Non-linear saturation curve + Dry/Wet)
    │
    ▼
Feedback DelayNode (Delay time in absolute seconds: 0.01s - 1.0s + Feedback + Dry/Wet)
    │
    ▼
Master Resonant BiquadFilter (Cutoff: 20Hz - 20kHz, Q: 0.1 - 20.0)
    │
    ▼
Master Volume GainNode
    │
    ▼
DynamicsCompressorNode (Limiter: Thresh -1dB, Ratio 20:1, Attack 3ms, Release 100ms)
    │
    ├──────────────────────────────────────────┐
    ▼                                          ▼
AudioContext.destination               ChannelSplitterNode(2)
                                               │
                                      ┌────────┴────────┐
                                      ▼                 ▼
                              AnalyserNode (L)   AnalyserNode (R)
```

### 5.2 Pre-Allocated Noise Buffer Pool
To eliminate `Math.random()` sample generation during playback triggers, `NoiseBufferPool` caches a 2-second looping white-noise buffer upon initial audio unlock:
```typescript
// src/lib/audio/NoiseBufferPool.ts
export class NoiseBufferPool {
  private static buffer: AudioBuffer | null = null;

  public static getSharedBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.buffer || this.buffer.sampleRate !== ctx.sampleRate) {
      const length = ctx.sampleRate * 2;
      this.buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return this.buffer;
  }
}
```

### 5.3 Lookahead Scheduler with Constant-Pair Swing & Run-Token Guards
```typescript
// src/lib/audio/LookaheadScheduler.ts
export class LookaheadScheduler {
  private ctx: AudioContext;
  private timerId: number | null = null;
  private nextStepTime = 0;
  private currentStep = 0;
  private readonly lookaheadMs = 25.0;
  private readonly scheduleAheadSec = 0.1;
  private runSessionId = 0;
  private getState: () => { bpm: number; swing: number; stepCount: 16 | 32 };
  private onScheduleStep: (stepIndex: number, audioTime: number) => void;

  constructor(
    ctx: AudioContext,
    getState: () => { bpm: number; swing: number; stepCount: 16 | 32 },
    onScheduleStep: (stepIndex: number, audioTime: number) => void
  ) {
    this.ctx = ctx;
    this.getState = getState;
    this.onScheduleStep = onScheduleStep;
  }

  public async start(): Promise<void> {
    const currentSession = ++this.runSessionId;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    // Verify run token: if stopped during await, cancel timer launch
    if (this.runSessionId !== currentSession) return;
    if (this.timerId !== null) return;

    this.currentStep = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.timerId = window.setInterval(() => this.scheduleLoop(), this.lookaheadMs);
  }

  public stop(): void {
    this.runSessionId++;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.currentStep = 0;
  }

  private scheduleLoop(): void {
    // Resync guard against background main-thread stall
    if (this.nextStepTime < this.ctx.currentTime - 0.2) {
      this.nextStepTime = this.ctx.currentTime;
    }
    while (this.nextStepTime < this.ctx.currentTime + this.scheduleAheadSec) {
      this.onScheduleStep(this.currentStep, this.nextStepTime);
      this.advanceStep();
    }
  }

  private advanceStep(): void {
    const { bpm, swing, stepCount } = this.getState();
    const secondsPerBeat = 60.0 / bpm;
    const baseStepTime = 0.25 * secondsPerBeat; // 16th note
    const isEven = this.currentStep % 2 === 0;

    // Swing math preserves constant pair duration:
    // even interval + odd interval = 2 * baseStepTime
    const interval = isEven
      ? baseStepTime * (1 + swing)
      : baseStepTime * (1 - swing);

    this.nextStepTime += interval;
    this.currentStep = (this.currentStep + 1) % stepCount;
  }
}
```

### 5.4 Unified Voice Signatures & Synthesizer Generators
All drum and synth voices use a single normalized call signature:
`trigger(dest, time, vel, params, pitchOffset, options)`

```typescript
// src/lib/audio/DrumSynths.ts
import { SynthParams, VoiceTriggerOptions } from '@/types/audio';
import { NoiseBufferPool } from '@/lib/audio/NoiseBufferPool';

export class DrumSynthesizer {
  private ctx: AudioContext;
  private activeSources = new Set<AudioScheduledSourceNode>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  public stopAll(): void {
    this.activeSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Source already terminated
      }
    });
    this.activeSources.clear();
  }

  private registerSource(source: AudioScheduledSourceNode, stopTime: number): void {
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try {
        source.disconnect();
      } catch {
        // Disconnected
      }
    };
    source.stop(stopTime);
  }

  public triggerKick(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    pitchOffset: number,
    _options?: VoiceTriggerOptions
  ): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const baseFreq = params.baseFrequency * Math.pow(2, pitchOffset / 12);
    const safeVel = Math.max(0.001, vel);

    osc.type = params.waveform;
    osc.frequency.setValueAtTime(Math.max(20, baseFreq * 3.5), time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, baseFreq), time + (params.pitchDecay ?? 0.08));

    gain.gain.setValueAtTime(safeVel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + params.envelope.decay);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(time);
    this.registerSource(osc, time + params.envelope.decay + 0.02);
  }

  public triggerSnare(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    pitchOffset: number,
    _options?: VoiceTriggerOptions
  ): void {
    const duration = params.envelope.decay;
    const safeVel = Math.max(0.001, vel);

    const noise = this.ctx.createBufferSource();
    noise.buffer = NoiseBufferPool.getSharedBuffer(this.ctx);
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(Math.max(20, params.filter.cutoff), time);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(safeVel * 0.8, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(dest);

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    const baseFreq = params.baseFrequency * Math.pow(2, pitchOffset / 12);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(Math.max(20, baseFreq * 1.8), time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, baseFreq), time + 0.08);

    oscGain.gain.setValueAtTime(safeVel * 0.6, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    osc.connect(oscGain);
    oscGain.connect(dest);

    noise.start(time, Math.random() * 1.5);
    osc.start(time);
    this.registerSource(noise, time + duration + 0.01);
    this.registerSource(osc, time + 0.13);
  }

  public triggerHiHat(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    _pitchOffset: number,
    options?: VoiceTriggerOptions
  ): void {
    const isOpen = options?.isOpen ?? false;
    const duration = isOpen ? Math.max(0.12, params.envelope.decay) : 0.05;
    const safeVel = Math.max(0.001, vel);

    const noise = this.ctx.createBufferSource();
    noise.buffer = NoiseBufferPool.getSharedBuffer(this.ctx);
    noise.loop = true;

    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(Math.max(20, params.filter.cutoff), time);
    bandpass.Q.setValueAtTime(params.filter.resonance, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(safeVel * 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    noise.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(dest);

    noise.start(time, Math.random() * 1.5);
    this.registerSource(noise, time + duration + 0.01);
  }

  public triggerClap(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    _pitchOffset: number,
    _options?: VoiceTriggerOptions
  ): void {
    const bursts = [0, 0.011, 0.024];
    const duration = params.envelope.decay;
    const safeVel = Math.max(0.001, vel);

    bursts.forEach((offset, idx) => {
      const isFinal = idx === bursts.length - 1;
      const burstLen = isFinal ? duration : 0.012;

      const noise = this.ctx.createBufferSource();
      noise.buffer = NoiseBufferPool.getSharedBuffer(this.ctx);
      noise.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, time + offset);
      filter.Q.setValueAtTime(2.5, time + offset);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(safeVel * (isFinal ? 0.9 : 0.5), time + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, time + offset + burstLen);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);

      // Distinct offset per burst prevents correlation artifacts
      const randomOffset = Math.random() * 1.5;
      noise.start(time + offset, randomOffset);
      this.registerSource(noise, time + offset + burstLen + 0.01);
    });
  }

  public triggerTom(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    pitchOffset: number,
    options?: VoiceTriggerOptions
  ): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const multiplier = options?.isHigh ? 1.5 : 1.0;
    const baseFreq = params.baseFrequency * multiplier * Math.pow(2, pitchOffset / 12);
    const safeVel = Math.max(0.001, vel);

    osc.type = params.waveform;
    osc.frequency.setValueAtTime(Math.max(20, baseFreq * 2.2), time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, baseFreq), time + 0.08);

    gain.gain.setValueAtTime(safeVel * 0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + params.envelope.decay);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(time);
    this.registerSource(osc, time + params.envelope.decay + 0.02);
  }
}
```

```typescript
// src/lib/audio/SynthVoice.ts
import { SynthParams, VoiceTriggerOptions } from '@/types/audio';

export class SynthVoice {
  private ctx: AudioContext;
  private activeSources = new Set<AudioScheduledSourceNode>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  public stopAll(): void {
    this.activeSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Disposed
      }
    });
    this.activeSources.clear();
  }

  public trigger(
    dest: AudioNode,
    time: number,
    vel: number,
    params: SynthParams,
    pitchOffset: number,
    _options?: VoiceTriggerOptions
  ): void {
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    const noteFreq = params.baseFrequency * Math.pow(2, pitchOffset / 12);
    osc.type = params.waveform;
    osc.frequency.setValueAtTime(Math.max(20, noteFreq), time);
    osc.detune.setValueAtTime(params.detune, time);

    filter.type = params.filter.type;
    filter.frequency.setValueAtTime(Math.max(20, params.filter.cutoff), time);
    filter.Q.setValueAtTime(params.filter.resonance, time);

    const safeVel = Math.max(0.001, vel);
    const { attack, decay, sustain, release } = params.envelope;

    const attackEnd = time + attack;
    const decayEnd = attackEnd + decay;
    const nominalGate = 0.25;
    // Envelope guarantee: gateEnd never truncates decay phase
    const gateEnd = Math.max(time + nominalGate, decayEnd);
    const releaseEnd = gateEnd + release;

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(safeVel, Math.max(time + 0.001, attackEnd));
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, safeVel * sustain), Math.max(attackEnd + 0.001, decayEnd));
    gain.gain.setValueAtTime(Math.max(0.001, safeVel * sustain), gateEnd);
    gain.gain.exponentialRampToValueAtTime(0.001, releaseEnd);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    osc.start(time);
    this.activeSources.add(osc);
    osc.onended = () => {
      this.activeSources.delete(osc);
      try {
        osc.disconnect();
      } catch {
        // Disposed
      }
    };
    osc.stop(releaseEnd + 0.05);
  }
}
```

### 5.5 High-Precision Decoupled Visual Playhead
The scheduler operates up to 100ms in advance. To prevent premature LED cursor jumps and avoid re-rendering the entire 128-button grid on every 16th note:
1. `onScheduleStep` appends `{ step, time }` entries into a playhead queue ref (`playheadQueueRef.current`).
2. Step elements register and unregister via ref callbacks into an element registry map:
   `stepElementRegistry = new Map<number, Set<HTMLElement>>()`.
3. An active `requestAnimationFrame` loop in `usePlayheadTracker.ts` compares the queue head against `audioCtx.currentTime`.
4. When `currentTime >= queue[0].time`, the queue item pops. The tracker removes `data-playhead="active"` from elements in `previousStep`, and sets it on all elements currently registered under `activeStep`.
5. On sequencer stop or pause, all registered elements clear the `data-playhead` attribute and the playhead queue is emptied.

---

## 6. UI, Interaction, & Mobile Responsive Architecture

### 6.1 Viewport Configuration & Root Setup
```typescript
// src/app/layout.tsx
// Server component: export viewport without client directives
import type { Viewport } from 'next';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
```
Root attributes enforce `overscroll-behavior: none` and `touch-action: manipulation` to block rubber-banding and double-tap zoom gestures.

### 6.2 Responsive Screen Breakpoints & View Modes
- **Root Screen Padding:** `pb-[calc(env(safe-area-inset-bottom)+5rem)]` enforced on the root container so fixed bars never obscure controls.
- **`< 768px` (Mobile Shell):**
  - Chassis rack ears and corner screws hidden.
  - 3-tab navigation switcher: `[TRACK EDIT]`, `[PERFORMANCE PADS]`, `[FX & MASTER]`.
  - Sequencer View displays 1 selected track at a time. 16-step mode renders a 4x4 grid of buttons with minimum `44px x 44px` touch targets.
  - 32-step mode uses `stepPage` switching: `[P1: 1-16]` and `[P2: 17-32]`. If steps are resized from 32 to 16, `stepPage` automatically resets to 0.
  - Step buttons toggle on `pointerup` only if pointer displacement is under 8px, preserving drag-to-scroll.
  - Header features an `editMode` toggle switch. When active, tapping a step opens `StepEditorSheet.tsx` for Velocity, Probability, and Pitch Offset.
  - Soundboard Matrix renders a fluid `grid-cols-4` with guaranteed `min-h-[72px]` touch targets.
  - Fixed bottom bar uses `TransportControls` in `'bar'` variant (Play, Stop, BPM display with ± adjust buttons, and Tap Tempo). Swing and Master Volume are housed in `[FX & MASTER]`.
- **`768px` - `1023px` (Tablet Shell):**
  - Transport controls dock into a top chassis console styled as `sticky top-0 z-30` in `'console'` variant.
  - All 8 tracks visible. Employs P1/P2 paging for 32-step patterns, combined with horizontal scroll when viewport width is below 900px while track headers remain `sticky left-0 z-20`.
  - Master FX and Soundboard stacked beneath the sequencer grid.
- **`>= 1024px` (Desktop / Full Hardware Rack):**
  - Top-mounted master transport console (`sticky top-0 z-30`).
  - Full beveled metal ears with visible chassis hex screws.
  - All 8 tracks x 16/32 steps visible, with P1/P2 paging enabled below 1440px to prevent horizontal grid stretching.
  - Soundboard, Sequencer, and Master FX visible simultaneously.

### 6.3 Tactile Controls & iOS Audio Unlock
- **POWER ON Overlay:** iOS Safari blocks audio unlocked exclusively via `pointerdown`. The app displays a full-screen vintage power toggle modal, rendered only if `getAudioEngine().isInitialized` is false. A native `click` event synchronously constructs `AudioContext` and invokes `ctx.resume()` before any asynchronous operations:
  ```ts
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) {
    nav.audioSession.type = 'playback';
  }
	```
	Dismisses overlay upon initialization. Attaches a visibilitychange listener that calls audioEngine.stop() and dispatches setIsPlaying(false) to the store when the document becomes hidden.
- **Rotary Knobs:** Bound using `onPointerDown` with `e.currentTarget.setPointerCapture(e.pointerId)`. Pointer coordinate changes update values vertically with `touch-action: none`. Mini-knobs in track headers use an expanded hit-box of `44px x 44px`. Audio parameter updates use `AudioParam.setTargetAtTime(target, time, 0.01)` to eliminate audible zipper artifacts.
- **Soundboard Pads:** Use `onPointerDown` with `user-select: none` and suppress context menus via `onContextMenu={(e) => e.preventDefault()}`.
- **Keyboard Shortcuts:** Global hotkey listener discards events when `e.repeat === true` or when the active focused element is `input`, `textarea`, or `select`. Spacebar toggles Transport Play/Stop.

---

## 7. Five-Phase Sequential Implementation Queue

```
[Phase 1: Types & Persistence] ──(Gate: tsc)──> [Phase 2: Primitives & Build Shell] ──(Gate: next build)
                                                                                                │
[Phase 4: Audio Engine & Sync] <──(Gate: next build)─── [Phase 3: Molecules & Store] <──────────┘
         │
  (Gate: next build)
         ▼
[Phase 5: Responsive Shell & Integration] ──(Final Gate: tsc & next build)──> Production Release
```

### Phase 1: Types, Storage Configuration, and Base Utilities
- Implement `src/lib/validation/pattern.ts` (Zod schemas, size limits, JSON validators).
- Implement `src/types/audio.ts` and `src/types/storage.ts` (pure types derived from Zod).
- Implement `src/lib/constants/storageKeys.ts`, `colorMap.ts`, `defaultPatterns.ts` (deterministic timestamp constants: 1700000000000), and `soundboardPresets.ts`.
- Implement `src/lib/storage/patternStorage.ts` (safe lazy storage adapter, slot CRUD, JSON import/export).
- Implement `src/lib/utils/audioMath.ts` and `src/lib/utils/tapTempo.ts`.
- Create `scripts/verify-defaults.ts` validating `createDefaultPattern()` through `PatternSchema.parse()` and slot persistence round-trips.
- **Quality Gate:** Run `npx tsc --noEmit` and `npx tsx scripts/verify-defaults.ts` to confirm zero schema or persistence errors.

### Phase 2: Design Foundation, Primitives, and Build Verification
- Implement `src/app/globals.css` with Tailwind v4 `@import "tailwindcss";`, `@theme` tokens, and hardware utilities.
- Implement atomic primitives:
  - `src/components/ui/ChassisScrew.tsx`
  - `src/components/ui/LedIndicator.tsx` (using `COLOR_MAP` static classes)
  - `src/components/ui/KnobRotary.tsx` (pointer capture, 44px touch region)
  - `src/components/ui/SevenSegmentDisplay.tsx`
  - `src/components/ui/MechanicalSwitch.tsx`
  - `src/components/ui/PushButton.tsx`
  - `src/components/ui/LedVuMeter.tsx`
- Setup minimal `src/app/page.tsx` rendering hardware primitives to test build pipelines.
- **Quality Gate:** Run `npx tsc --noEmit` and `npm run build` to guarantee SSR/prerender compatibility.

### Phase 3: Molecules, Zustand Store, and Step Editing
- Implement `src/store/useSequencerStore.ts` (complete state management, dirty flags, working copy, integer sanitization).
- Implement compound molecules:
  - `src/components/molecules/StepCell.tsx`
  - `src/components/molecules/StepEditorSheet.tsx` (mobile step velocity/probability/pitch modal)
  - `src/components/molecules/TrackHeader.tsx` (mute, solo, pan, volume)
  - `src/components/molecules/SoundboardTriggerPad.tsx`
  - `src/components/molecules/MasterFxPanel.tsx`
  - `src/components/molecules/TransportControls.tsx`
  - `src/components/molecules/PatternManagerBar.tsx`
- **Quality Gate:** Run `npx tsc --noEmit` and `npm run build`.

### Phase 4: Audio Engine, Lookahead Scheduling, and Voice Synthesizers
- Implement `src/lib/audio/NoiseBufferPool.ts` (pre-allocated 2-second shared noise buffer).
- Implement `src/lib/audio/AudioContextManager.ts` (master volume gain, limiter, stereo split analysers).
- Implement `src/lib/audio/EffectsChain.ts` (WaveShaper overdrive, delay in absolute seconds, master resonant filter).
- Implement `src/lib/audio/DrumSynths.ts` and `src/lib/audio/SynthVoice.ts`.
- Implement `src/lib/audio/LookaheadScheduler.ts` (constant-pair swing, session token cancellation, resync guard).
- Implement `src/lib/audio/AudioEngine.ts` (module-level singleton stored on `globalThis`, accepting pattern snapshots via dependency injection).
- Implement custom hooks:
  - `src/hooks/useAudioEngine.ts` (thin wrapper connecting store with `getAudioEngine()`)
  - `src/hooks/usePlayheadTracker.ts` (RAF loop consuming scheduler queue and driving registry elements)
  - `src/hooks/useLocalPersistence.ts` (debounced working-copy autosave gated by `hasHydrated`, cross-tab reload prompt)
  - `src/hooks/useSoundboardKeyboard.ts`
- **Quality Gate:** Run `npx tsc --noEmit` and `npm run build`.

### Phase 5: Complete Page Integration & Responsive Shell
- Implement `src/components/organisms/PowerOnOverlay.tsx` (iOS unlock and audio activation modal).
- Implement `src/components/organisms/SequencerMatrix.tsx` (responsive 8-track grid desktop / 4x4 paged view mobile).
- Implement `src/components/organisms/SoundboardMatrix.tsx` (4x4 pad grid with fluid touch targets).
- Implement `src/components/organisms/MobileNavPanel.tsx` (sub-768px view switcher).
- Implement `src/components/organisms/HardwareChassis.tsx` (frame layout, beveled ears, screw styling).
- Wire root screen in `src/app/page.tsx` and configure layout in `src/app/layout.tsx`.
- Complete verification testing at 360px, 390px, 430px, 768px, and 1024px+.
- **Final Quality Gate:** Run `npx tsc --noEmit` and `npm run build` confirming zero warnings and zero runtime errors.

---

## 8. Appendix: Component Props & Module Contracts

### 8.1 Molecule Component Prop Interfaces
```typescript
import type {
  Step,
  Track,
  TrackColor,
  SoundboardPad,
  MasterFxSettings,
  FilterSettings,
  DelaySettings,
  DistortionSettings,
} from '@/types/audio';

export interface StepCellProps {
  step: Step;
  trackColor: TrackColor;
  onToggle: () => void;
  onOpenEditor: () => void;
}

export interface StepEditorSheetProps {
  step: Step | null;
  trackName: string;
  isOpen: boolean;
  onClose: () => void;
  onChangeVelocity: (velocity: number) => void;
  onChangeProbability: (prob: number) => void;
  onChangePitch: (semitones: number) => void;
}

export interface TrackHeaderProps {
  track: Track;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onChangeVolume: (volume: number) => void;
  onChangePan: (pan: number) => void;
  isSelected?: boolean;
  onSelectTrack?: () => void;
}

export interface SoundboardTriggerPadProps {
  pad: SoundboardPad;
  onTrigger: () => void;
}

export interface MasterFxPanelProps {
  fx: MasterFxSettings;
  onChangeFx: (updated: {
    filter?: Partial<FilterSettings>;
    delay?: Partial<DelaySettings>;
    distortion?: Partial<DistortionSettings>;
    masterVolume?: number;
  }) => void;
}

export interface TransportControlsProps {
  variant: 'bar' | 'console';
  isPlaying: boolean;
  bpm: number;
  swing?: number;
  masterVolume?: number;
  onTogglePlay: () => void;
  onStop: () => void;
  onChangeBpm: (bpm: number) => void;
  onChangeSwing?: (swing: number) => void;
  onChangeMasterVolume?: (vol: number) => void;
  onTapTempo: () => void;
}

export interface PatternManagerBarProps {
  activeSlot: number;
  isDirty: boolean;
  onSelectSlot: (slot: number) => void;
  onSaveToSlot: (slot: number) => void;
  onClearSlot: (slot: number) => void;
  onDuplicateSlot: (targetSlot: number) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}
```

### 8.2 Zustand Store Contract
```typescript
// src/store/useSequencerStore.ts
import type {
  Pattern,
  Step,
  FilterSettings,
  DelaySettings,
  DistortionSettings,
} from '@/types/audio';
import type { StorageSlotMetadata } from '@/types/storage';

export interface SequencerStoreState {
  pattern: Pattern;
  activeSlot: number;
  hasHydrated: boolean;
  isDirty: boolean;
  isPlaying: boolean;
  isEditMode: boolean;
  slotMetadata: StorageSlotMetadata[];
  selectedTrackIndex: number;
  storageError: string | null;
  remoteChangeAvailable: boolean;
  isUsingMemoryFallback: boolean;
  isQuotaExceeded: boolean;
  activeMobileTab: 'sequencer' | 'soundboard' | 'fx';
  stepPage: 0 | 1; // 0: steps 0-15, 1: steps 16-31
  editingStep: { trackIndex: number; stepIndex: number } | null;

  // Actions
  hydrateFromStorage: () => void;
  setIsPlaying: (playing: boolean) => void;
  setIsEditMode: (active: boolean) => void;
  setBpm: (bpm: number) => void;
  setSwing: (swing: number) => void;
  setStepCount: (count: 16 | 32) => void;
  toggleStep: (trackIndex: number, stepIndex: number) => void;
  updateStepParams: (trackIndex: number, stepIndex: number, params: Partial<Omit<Step, 'index'>>) => void;
  toggleMute: (trackIndex: number) => void;
  toggleSolo: (trackIndex: number) => void;
  setTrackVolume: (trackIndex: number, volume: number) => void;
  setTrackPan: (trackIndex: number, pan: number) => void;
  updateMasterFx: (fx: {
    filter?: Partial<FilterSettings>;
    delay?: Partial<DelaySettings>;
    distortion?: Partial<DistortionSettings>;
    masterVolume?: number;
  }) => void;
  setSelectedTrackIndex: (index: number) => void;
  setActiveMobileTab: (tab: 'sequencer' | 'soundboard' | 'fx') => void;
  setStepPage: (page: 0 | 1) => void;
  setEditingStep: (step: { trackIndex: number; stepIndex: number } | null) => void;
  refreshSlotMetadata: () => void;
  loadSlotAction: (slot: number, force?: boolean) => 'loaded' | 'created' | 'dirty_conflict' | 'error';
  saveSlotAction: (slot: number, confirmOverwrite?: boolean) => 'saved' | 'needs_confirm' | 'error';
  clearSlotAction: (slot: number) => void;
  duplicateSlotAction: (toSlot: number) => boolean;
  importPatternAction: (rawJson: string, fileSize?: number) => boolean;
  setRemoteChangeAvailable: (available: boolean) => void;
  clearStorageError: () => void;
}
```

### 8.3 Audio Engine & Manager Signatures
```typescript
// src/lib/audio/AudioContextManager.ts
export class AudioContextManager {
  public ctx: AudioContext | null;
  public masterGain: GainNode | null;
  public padBus: GainNode | null;
  public masterBus: GainNode | null;
  public limiter: DynamicsCompressorNode | null;
  public leftAnalyser: AnalyserNode | null;
  public rightAnalyser: AnalyserNode | null;
  public isInitialized: boolean;

  public init(): Promise<AudioContext>;
  public resume(): Promise<void>;
  public suspend(): Promise<void>;
  public getStereoLevels(): { left: number; right: number };
}

// src/lib/audio/EffectsChain.ts
export class EffectsChain {
  constructor(ctx: AudioContext);
  public inputNode: GainNode;
  public outputNode: GainNode;
  public updateParams(settings: MasterFxSettings): void;
}

// src/lib/constants/defaultPatterns.ts
export function createDefaultPattern(slot?: number): Pattern;
// SLOT_PRESETS seeds each of the eight slots with its own genre identity
// (name + tempo + swing): Electro, Deep House, Acid Techno, Boom Bap,
// Synthwave, Drum & Bass, Dub Chord and Trap. The groove is shared, so the
// eight slots stay cheap to build and byte-reproducible.

// src/lib/audio/AudioEngine.ts
export class AudioEngine {
  public isInitialized: boolean;
  public init(): Promise<void>;
  public play(getPatternSnapshot: () => Pattern): Promise<void>;
  public stop(): void;
  public triggerPad(pad: SoundboardPad): void;
  public getStereoLevels(): { left: number; right: number };
  public subscribe(listener: () => void): () => void;
}

export function getAudioEngine(): AudioEngine;

// src/hooks/useAudioEngine.ts
export function useAudioEngine(): {
  isInitialized: boolean;
  isPlaying: boolean;
  play: () => Promise<void>;
  stop: () => void;
  initializeAudio: () => Promise<void>;
  triggerSoundboardPad: (pad: SoundboardPad) => void;
  getStereoLevels: () => { left: number; right: number };
};
```

---

## 9. Integration Contracts (AUTHORITATIVE — if any earlier section conflicts, this section wins)

### 9.1 Store, hydration, and UI rules
- Zustand v5, curried form: `create<SequencerStoreState>()((set, get) => ({ ... }))`. Components select primitives with single-field selectors (`useSequencerStore(s => s.pattern.bpm)`). Any selector returning a new object or array MUST use `useShallow` from `zustand/react/shallow`. Never write `s => ({ ... })` without it.
- `hydrateFromStorage()`: load `WORKING_COPY`; if missing or invalid, use `createDefaultPattern(1)`. Then set `activeSlot = pattern.slot`, `isDirty = false`, `hasHydrated = true`, `remoteChangeAvailable = false`, and call `refreshSlotMetadata()`. Call it once from a mount effect in `page.tsx`, and from the "Reload" toast action.
- `useLocalPersistence`: subscribe to the store; autosave only when `hasHydrated`; debounce 300 ms; flush on `visibilitychange` (hidden) and `pagehide`. A `storage` event on the `WORKING_COPY` key calls `setRemoteChangeAvailable(true)`.
- `setStepCount` resizes per §4.2 and sets `stepPage = 0`. `setStepPage(1)` is ignored unless `stepCount === 32`.
- `isEditMode` toggle exists at ALL breakpoints. In edit mode, tapping or clicking a step calls `onOpenEditor` instead of `onToggle`.
- Add `src/lib/utils/playheadRegistry.ts` to the file tree. It exports `registerStepElement(stepIndex: number, el: HTMLElement): () => void` (returns an unregister function), `setActiveStep(step: number | null): void`, and `clearPlayhead(): void`. `StepCell` registers via a ref callback using `step.index`. `usePlayheadTracker` drives `setActiveStep`.

### 9.2 Audio engine behavior
- Constructors are inert (no `AudioContext`, no timers). `AudioEngine.init()` constructs the `AudioContext` synchronously and calls `resume()` before its first `await`, then builds the graph.
- Graph ownership:
  - `AudioContextManager` builds: `masterBus → EffectsChain → masterGain → limiter → destination + splitter/analysers`, plus `padBus → masterBus`.
  - `AudioEngine.init()` creates 8 `TrackStrip` objects `{ input: GainNode, panner: StereoPannerNode, gain: GainNode }`, chained `input → panner → gain → masterBus`.
  - Mute and solo are evaluated at schedule time (§5.2); strip gain holds track volume only. This overrides the §5.1 "Solo/Mute evaluation" label.
- Instrument dispatch: kick→`triggerKick`; snare→`triggerSnare`; hihat_closed→`triggerHiHat` with `{isOpen:false}`; hihat_open→`triggerHiHat` with `{isOpen:true}`; clap→`triggerClap`; tom_low→`triggerTom` with `{isHigh:false}`; tom_high→`triggerTom` with `{isHigh:true}`; synth_lead→`SynthVoice.trigger`.
- `onScheduleStep(step, time)`:
  1. `p = getPatternSnapshot()`.
  2. Push `{step, time}` to the playhead queue.
  3. For each track `i`: skip if not audible. Let `s = track.steps[step]`; skip if `!s` or `!s.active`, or if `Math.random() > s.probability`.
  4. Dispatch to `strips[i].input` with `(time, s.velocity, track.params, s.pitchOffset, options)`.
- New public method `AudioEngine.syncMixer(pattern: Pattern)`: for each strip, `gain.gain.setTargetAtTime(track.volume, ctx.currentTime, 0.01)` and the same for `panner.pan`. Then call `EffectsChain.updateParams(pattern.masterFx)` and set `masterGain` from `masterVolume`. `useAudioEngine` calls it from a `useSequencerStore.subscribe` listener whenever `pattern.tracks` volume/pan or `pattern.masterFx` changes (reference comparison), and only when `isInitialized`.
- `EffectsChain.updateParams`: set delay time and feedback with `setTargetAtTime`. Regenerate the waveshaper curve (a cached 2048-point `Float32Array`) only when `drive` changes. Dry/wet uses two GainNodes.
- `stop()`: `scheduler.stop()`, `drums.stopAll()`, `synth.stopAll()`, clear the playhead queue, `clearPlayhead()`, `store.setIsPlaying(false)`. `play()` while already playing is a no-op.
- `subscribe` and `useSyncExternalStore`: the hook's snapshot returns stable primitives (`isInitialized`, `isPlaying`), never a new object per call.
- The `visibilitychange` listener lives in `useAudioEngine` (mounted once at page level), not in `PowerOnOverlay`. On hidden it calls `stop()`. `PowerOnOverlay` reads `useAudioEngine().isInitialized`, not a raw singleton call during render.
- `triggerPad(pad)` dispatches through the same table into `padBus` at `ctx.currentTime`, velocity 1, pitchOffset 0. The pad's flash state is local UI state.
- Noise voices (snare, hats, clap) all use `loop = true` plus a random start offset.
```