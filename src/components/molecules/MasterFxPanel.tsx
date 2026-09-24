'use client';

import type { ReactElement } from 'react';
import type {
  DelaySettings,
  DistortionSettings,
  FilterSettings,
  MasterFxSettings,
} from '@/types/audio';
import { formatHertz, formatMilliseconds, formatPercent } from '@/lib/utils/audioMath';
import { KnobRotary } from '@/components/ui/KnobRotary';
import { LedVuMeter } from '@/components/ui/LedVuMeter';
import { PushButton } from '@/components/ui/PushButton';

export interface MasterFxPanelProps {
  fx: MasterFxSettings;
  onChangeFx: (updated: {
    filter?: Partial<FilterSettings>;
    delay?: Partial<DelaySettings>;
    distortion?: Partial<DistortionSettings>;
    masterVolume?: number;
  }) => void;
  /** Live stereo analyser levels for the onboard VU ladders. */
  stereoLevels?: { left: number; right: number };
  className?: string;
}

const FILTER_TYPES: readonly FilterSettings['type'][] = [
  'lowpass',
  'highpass',
  'bandpass',
  'notch',
];

const FILTER_TYPE_LABELS: Record<FilterSettings['type'], string> = {
  lowpass: 'LP',
  highpass: 'HP',
  bandpass: 'BP',
  notch: 'NOTCH',
};

function SectionHeading({ children }: { children: string }): ReactElement {
  return (
    <h3 className="engraved-label mb-2 font-hardware text-[9px] text-ink-muted">{children}</h3>
  );
}

/**
 * Master FX bay: resonant filter, feedback delay, overdrive and the master
 * volume, plus the onboard stereo VU ladders when analyser levels are supplied.
 */
export function MasterFxPanel({
  fx,
  onChangeFx,
  stereoLevels,
  className = '',
}: MasterFxPanelProps): ReactElement {
  return (
    <section className={`chassis-panel p-3 sm:p-4 ${className}`}>
      <header className="mb-3 flex items-center justify-between border-b border-chassis-border pb-2">
        <h2 className="font-hardware text-[11px] font-bold tracking-[0.18em] text-ink">
          MASTER FX
        </h2>
        <span className="engraved-label font-hardware text-[9px]">post-mix bus</span>
      </header>

      <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
        {/* --------------------------------------------------------- filter */}
        <div className="col-span-2 sm:col-span-1">
          <SectionHeading>Filter</SectionHeading>
          <div className="mb-2 grid grid-cols-4 gap-1">
            {FILTER_TYPES.map((type) => (
              <PushButton
                key={type}
                label={FILTER_TYPE_LABELS[type]}
                ariaLabel={`Filter type ${type}`}
                onClick={() => onChangeFx({ filter: { type } })}
                isActive={fx.filter.type === type}
                color="cyan"
                variant="secondary"
                size="sm"
                className="min-h-[36px]! px-1! text-[9px]!"
              />
            ))}
          </div>
          <div className="flex items-start justify-center gap-1">
            <KnobRotary
              label="Cutoff"
              value={fx.filter.cutoff}
              min={20}
              max={20000}
              scale="log"
              defaultValue={18000}
              size="md"
              onChange={(cutoff) => onChangeFx({ filter: { cutoff } })}
              accentColor="cyan"
              displayValue={formatHertz(fx.filter.cutoff)}
            />
            <KnobRotary
              label="Reso"
              value={fx.filter.resonance}
              min={0.1}
              max={20}
              step={0.1}
              defaultValue={0.7}
              size="md"
              onChange={(resonance) => onChangeFx({ filter: { resonance } })}
              accentColor="cyan"
              displayValue={fx.filter.resonance.toFixed(1)}
            />
          </div>
        </div>

        {/* ---------------------------------------------------------- delay */}
        <div className="col-span-2 sm:col-span-1">
          <SectionHeading>Delay</SectionHeading>
          <div className="flex flex-wrap items-start justify-center gap-1">
            <KnobRotary
              label="Time"
              value={fx.delay.time}
              min={0.01}
              max={1}
              scale="log"
              step={0.001}
              defaultValue={0.25}
              size="md"
              onChange={(time) => onChangeFx({ delay: { time } })}
              accentColor="violet"
              displayValue={formatMilliseconds(fx.delay.time)}
            />
            <KnobRotary
              label="Fdbk"
              value={fx.delay.feedback}
              min={0}
              max={0.95}
              step={0.01}
              defaultValue={0.32}
              size="md"
              onChange={(feedback) => onChangeFx({ delay: { feedback } })}
              accentColor="violet"
              displayValue={formatPercent(fx.delay.feedback)}
            />
            <KnobRotary
              label="Mix"
              value={fx.delay.wetDry}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.18}
              size="md"
              onChange={(wetDry) => onChangeFx({ delay: { wetDry } })}
              accentColor="violet"
              displayValue={formatPercent(fx.delay.wetDry)}
            />
          </div>
        </div>

        {/* ------------------------------------------------------ overdrive */}
        <div className="col-span-2 sm:col-span-1">
          <SectionHeading>Overdrive</SectionHeading>
          <div className="flex flex-wrap items-start justify-center gap-1">
            <KnobRotary
              label="Drive"
              value={fx.distortion.drive}
              min={0}
              max={100}
              step={0.5}
              defaultValue={12}
              size="md"
              onChange={(drive) => onChangeFx({ distortion: { drive } })}
              accentColor="orange"
              displayValue={`${Math.round(fx.distortion.drive)}`}
            />
            <KnobRotary
              label="Mix"
              value={fx.distortion.wetDry}
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.15}
              size="md"
              onChange={(wetDry) => onChangeFx({ distortion: { wetDry } })}
              accentColor="orange"
              displayValue={formatPercent(fx.distortion.wetDry)}
            />
          </div>
        </div>

        {/* --------------------------------------------------------- master */}
        <div className="col-span-2 sm:col-span-1">
          <SectionHeading>Master</SectionHeading>
          <div className="flex items-start justify-center gap-2">
            <KnobRotary
              label="Volume"
              value={fx.masterVolume}
              min={0}
              max={1.2}
              step={0.01}
              defaultValue={0.85}
              size="lg"
              onChange={(masterVolume) => onChangeFx({ masterVolume })}
              accentColor="lime"
              displayValue={formatPercent(fx.masterVolume / 1.2)}
            />
            {stereoLevels ? (
              <div className="flex items-end gap-1">
                <LedVuMeter
                  level={stereoLevels.left}
                  segments={10}
                  orientation="vertical"
                  label="L"
                />
                <LedVuMeter
                  level={stereoLevels.right}
                  segments={10}
                  orientation="vertical"
                  label="R"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
