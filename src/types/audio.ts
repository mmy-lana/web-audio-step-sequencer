import { z } from 'zod';
import {
  WaveformSchema,
  InstrumentTypeSchema,
  TrackColorSchema,
  EnvelopeSettingsSchema,
  FilterSettingsSchema,
  SynthParamsSchema,
  StepSchema,
  StepCountSchema,
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
export type StepCount = z.infer<typeof StepCountSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type DelaySettings = z.infer<typeof DelaySettingsSchema>;
export type DistortionSettings = z.infer<typeof DistortionSettingsSchema>;
export type MasterFxSettings = z.infer<typeof MasterFxSchema>;
export type Pattern = z.infer<typeof PatternSchema>;

/** Soundboard pad definition. `lastTriggeredAt` is UI-only flash bookkeeping. */
export interface SoundboardPad {
  id: string;
  label: string;
  keyBinding: string;
  instrument: InstrumentType;
  color: TrackColor;
  params: SynthParams;
  lastTriggeredAt: number | null;
}

/** Per-voice dispatch switches (open/closed hat, low/high tom). */
export interface VoiceTriggerOptions {
  isOpen?: boolean;
  isHigh?: boolean;
}

/** One entry of the decoupled scheduler → RAF playhead queue. */
export interface PlayheadScheduleItem {
  step: number;
  time: number;
}
