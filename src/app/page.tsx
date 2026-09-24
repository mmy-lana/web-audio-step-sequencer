'use client';

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import type { TrackColor } from '@/types/audio';
import { TRACK_COLOR_ORDER } from '@/lib/constants/colorMap';
import { MAX_BPM, MIN_BPM, TRACK_TEMPLATES } from '@/lib/constants/defaultPatterns';
import { formatBpm, roundTo } from '@/lib/utils/audioMath';
import { ChassisScrew } from '@/components/ui/ChassisScrew';
import { KnobRotary } from '@/components/ui/KnobRotary';
import { LedIndicator } from '@/components/ui/LedIndicator';
import { LedVuMeter } from '@/components/ui/LedVuMeter';
import { MechanicalSwitch } from '@/components/ui/MechanicalSwitch';
import { PushButton } from '@/components/ui/PushButton';
import { SevenSegmentDisplay } from '@/components/ui/SevenSegmentDisplay';

const TRACK_LABELS = TRACK_TEMPLATES.map((template) => template.name);

/**
 * Phase 2 primitive bench.
 *
 * This screen exists only to prove every atomic hardware control renders and
 * wires up under the App Router build. Phase 5 replaces it with the integrated
 * sequencer shell. The VU ladders intentionally display live control state —
 * real analyser data arrives with the audio engine in Phase 4.
 */
export default function PrimitiveBenchPage(): ReactElement {
  const [isPowered, setIsPowered] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [masterVolume, setMasterVolume] = useState(0.85);
  const [cutoff, setCutoff] = useState(2400);
  const [delayTime, setDelayTime] = useState(0.25);
  const [isEditMode, setIsEditMode] = useState(false);
  const [muteStates, setMuteStates] = useState<boolean[]>(() =>
    TRACK_LABELS.map(() => false),
  );
  const [soloIndex, setSoloIndex] = useState<number | null>(null);

  const toggleMute = useCallback((index: number): void => {
    setMuteStates((previous) =>
      previous.map((muted, position) => (position === index ? !muted : muted)),
    );
  }, []);

  const toggleSolo = useCallback((index: number): void => {
    setSoloIndex((previous) => (previous === index ? null : index));
  }, []);

  const activeTrackCount = muteStates.filter((muted) => !muted).length;
  const meterLevel = isPowered ? roundTo(masterVolume / 1.2, 3) : 0;

  return (
    <main className="h-viewport flex flex-col items-center bg-chassis-bg px-3 py-6 pb-[calc(env(safe-area-inset-bottom)_+_5rem)] text-ink">
      <div className="w-full max-w-5xl">
        {/* ---------------------------------------------------------- chassis */}
        <section className="chassis-panel relative p-4 sm:p-6">
          <ChassisScrew size="md" angle={18} className="absolute left-2 top-2" />
          <ChassisScrew size="md" angle={-40} className="absolute right-2 top-2" />
          <ChassisScrew size="md" angle={72} className="absolute bottom-2 left-2" />
          <ChassisScrew size="md" angle={-8} className="absolute bottom-2 right-2" />

          <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-chassis-border pb-4">
            <div>
              <h1 className="font-hardware text-lg font-bold tracking-[0.2em] text-ink">
                W-AUDIO // MODEL-16
              </h1>
              <p className="engraved-label font-hardware text-[10px]">
                Phase 2 · primitive bench
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <LedIndicator
                  color={isPowered ? 'emerald' : 'amber'}
                  isOn={isPowered}
                  size="md"
                  label={isPowered ? 'Power on' : 'Standby'}
                />
                <span className="engraved-label font-hardware text-[10px]">
                  {isPowered ? 'online' : 'standby'}
                </span>
              </div>
              <MechanicalSwitch
                isOn={isPowered}
                onToggle={() => setIsPowered((previous) => !previous)}
                label="Power"
                variant="power"
                size="md"
                color="emerald"
              />
            </div>
          </header>

          {/* ------------------------------------------------------- readouts */}
          <div className="mb-6 flex flex-wrap items-end gap-6">
            <SevenSegmentDisplay label="Tempo" value={formatBpm(bpm)} digits={3} isActive={isPowered} size="lg" suffix="BPM" />
            <SevenSegmentDisplay
              label="Cutoff"
              value={Math.round(cutoff)}
              digits={5}
              isActive={isPowered}
              size="md"
              suffix="Hz"
            />
            <SevenSegmentDisplay
              label="Tracks live"
              value={`${activeTrackCount}/8`}
              digits={3}
              isActive={isPowered}
              size="md"
            />
          </div>

          {/* ---------------------------------------------------------- knobs */}
          <div className={`flex flex-wrap items-start justify-center gap-6 ${isPowered ? '' : 'opacity-60'}`}>
            <KnobRotary
              label="Tempo"
              value={bpm}
              min={MIN_BPM}
              max={MAX_BPM}
              step={1}
              defaultValue={120}
              size="lg"
              onChange={setBpm}
              accentColor="amber"
              disabled={!isPowered}
            />
            <KnobRotary
              label="Master"
              value={masterVolume}
              min={0}
              max={1.2}
              step={0.01}
              defaultValue={0.85}
              size="lg"
              onChange={setMasterVolume}
              accentColor="lime"
              disabled={!isPowered}
            />
            <KnobRotary
              label="Cutoff"
              value={cutoff}
              min={20}
              max={20000}
              scale="log"
              defaultValue={18000}
              size="lg"
              onChange={setCutoff}
              unit="Hz"
              accentColor="cyan"
              disabled={!isPowered}
            />
            <KnobRotary
              label="Delay"
              value={delayTime}
              min={0.01}
              max={1}
              scale="log"
              step={0.001}
              defaultValue={0.25}
              size="md"
              onChange={setDelayTime}
              unit="s"
              accentColor="violet"
              disabled={!isPowered}
            />
          </div>

          {/* ----------------------------------------------------------- vu */}
          <div className="mt-6 flex items-end justify-center gap-8">
            <LedVuMeter level={meterLevel} segments={12} orientation="vertical" label="L" peakLevel={meterLevel} />
            <LedVuMeter level={meterLevel} segments={12} orientation="vertical" label="R" peakLevel={meterLevel} />
            <LedVuMeter
              level={meterLevel}
              segments={16}
              orientation="horizontal"
              label="Master bus"
              showScale
            />
          </div>
        </section>

        {/* ---------------------------------------------------- button + LED row */}
        <section className="chassis-panel mt-4 p-4 sm:p-6">
          <h2 className="engraved-label mb-3 font-hardware text-[10px]">Latching controls</h2>
          <div className="flex flex-wrap items-center gap-2">
            <PushButton
              label="Edit mode"
              onClick={() => setIsEditMode((previous) => !previous)}
              isActive={isEditMode}
              variant="primary"
              size="md"
            />
            <PushButton label="Play" onClick={() => setIsPowered(true)} variant="primary" size="md" color="emerald" />
            <PushButton label="Stop" onClick={() => setIsPowered(false)} variant="secondary" size="md" />
            <PushButton label="Panic" onClick={() => setSoloIndex(null)} variant="danger" size="md" />
            <PushButton label="Ghost" onClick={() => undefined} variant="ghost" size="md" />
            <PushButton label="Disabled" onClick={() => undefined} disabled size="sm" />
          </div>

          <h2 className="engraved-label mb-3 mt-6 font-hardware text-[10px]">
            Palette · every TrackColor through COLOR_MAP
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            {TRACK_COLOR_ORDER.map((color: TrackColor) => (
              <span key={color} className="flex items-center gap-1.5">
                <LedIndicator color={color} isOn size="sm" label={`${color} lit`} />
                <LedIndicator color={color} isOn={false} size="sm" label={`${color} unlit`} />
                <span className="font-hardware text-[9px] text-ink-faint">{color}</span>
              </span>
            ))}
          </div>

          <h2 className="engraved-label mb-3 mt-6 font-hardware text-[10px]">
            Track mute / solo latching
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TRACK_LABELS.map((name, index) => (
              <div key={name} className="chassis-sunken flex items-center gap-2 p-2">
                <LedIndicator
                  color={TRACK_TEMPLATES[index].color}
                  isOn={!muteStates[index]}
                  size="xs"
                  label={`${name} active`}
                />
                <span className="flex-1 truncate font-hardware text-[10px] text-ink-muted">{name}</span>
                <PushButton
                  label="M"
                  ariaLabel={`Mute ${name}`}
                  onClick={() => toggleMute(index)}
                  isActive={muteStates[index]}
                  color="crimson"
                  variant="ghost"
                  size="sm"
                  className="min-h-[32px]! px-2!"
                />
                <PushButton
                  label="S"
                  ariaLabel={`Solo ${name}`}
                  onClick={() => toggleSolo(index)}
                  isActive={soloIndex === index}
                  color="amber"
                  variant="ghost"
                  size="sm"
                  className="min-h-[32px]! px-2!"
                />
              </div>
            ))}
          </div>

          <p className="mt-6 border-t border-chassis-border pt-3 font-hardware text-[10px] leading-relaxed text-ink-dim">
            Drag a knob vertically to change it · hold SHIFT for fine control · double-click to
            restore the factory value · arrow keys, PageUp/PageDown, Home and End are supported.
            Phase 4 replaces the bench meters with real analyser data.
          </p>
        </section>
      </div>
    </main>
  );
}
