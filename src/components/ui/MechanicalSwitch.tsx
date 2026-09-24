'use client';

import { useId } from 'react';
import type { ReactElement } from 'react';
import type { TrackColor } from '@/types/audio';
import { COLOR_MAP } from '@/lib/constants/colorMap';
import { LedIndicator } from '@/components/ui/LedIndicator';

export type MechanicalSwitchVariant = 'toggle' | 'rocker' | 'power';
export type MechanicalSwitchSize = 'sm' | 'md';

export interface MechanicalSwitchProps {
  isOn: boolean;
  onToggle: () => void;
  label: string;
  variant?: MechanicalSwitchVariant;
  size?: MechanicalSwitchSize;
  disabled?: boolean;
  /** LED accent; defaults to emerald. */
  color?: TrackColor;
  /** Hides the visible caption while keeping it available to screen readers. */
  hideLabel?: boolean;
  className?: string;
}

const TRACK_CLASSES: Record<MechanicalSwitchSize, string> = {
  sm: 'h-5 w-10',
  md: 'h-6 w-12',
};

const KNOB_CLASSES: Record<MechanicalSwitchSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
};

const LABEL_CLASSES: Record<MechanicalSwitchSize, string> = {
  sm: 'text-[9px]',
  md: 'text-[10px]',
};

const ROCKER_CLASSES: Record<MechanicalSwitchSize, string> = {
  sm: 'h-6 w-12 text-[8px]',
  md: 'h-8 w-16 text-[9px]',
};

const POWER_CLASSES: Record<MechanicalSwitchSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-11 w-11',
};

function PowerGlyph({ className }: { className: string }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" strokeWidth="2">
      <path d="M12 3v9" stroke="currentColor" strokeLinecap="round" />
      <path
        d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Two-position mechanical switch in three hardware flavours:
 * a sliding toggle, a labelled rocker, and a round POWER key.
 */
export function MechanicalSwitch({
  isOn,
  onToggle,
  label,
  variant = 'toggle',
  size = 'md',
  disabled = false,
  color = 'emerald',
  hideLabel = false,
  className = '',
}: MechanicalSwitchProps): ReactElement {
  const accent = COLOR_MAP[color];
  // `useId` guarantees a unique id, so two switches that share a label never
  // collide on the DOM id their `aria-describedby` points at.
  const stateDescriptionId = useId();

  const body = ((): ReactElement => {
    if (variant === 'rocker') {
      return (
        <span
          className={`chassis-sunken relative flex items-center overflow-hidden rounded ${ROCKER_CLASSES[size]}`}
        >
          <span
            className={`absolute inset-y-0 w-1/2 transition-all duration-150 ${
              isOn
                ? 'left-1/2 bg-hardware-metal-hi shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                : 'left-0 bg-hardware-metal-lo shadow-[inset_0_-1px_0_rgba(0,0,0,0.6)]'
            }`}
          />
          <span
            className={`relative z-10 w-1/2 text-center font-hardware font-bold tracking-wider ${
              isOn ? 'text-ink-faint' : 'text-status-ok'
            }`}
          >
            OFF
          </span>
          <span
            className={`relative z-10 w-1/2 text-center font-hardware font-bold tracking-wider ${
              isOn ? 'text-status-ok' : 'text-ink-faint'
            }`}
          >
            ON
          </span>
        </span>
      );
    }

    if (variant === 'power') {
      return (
        <span
          className={`relative flex items-center justify-center rounded-full border transition-colors duration-150 ${POWER_CLASSES[size]} ${
            isOn
              ? 'border-status-ok/60 bg-status-ok/10'
              : 'border-chassis-border-strong bg-chassis-raised'
          }`}
        >
          <PowerGlyph className={`h-1/2 w-1/2 ${isOn ? accent.textActive : 'text-ink-dim'}`} />
        </span>
      );
    }

    return (
      <span
        className={`chassis-sunken relative flex items-center rounded-full px-0.5 ${TRACK_CLASSES[size]}`}
      >
        <span
          className={`pad-face absolute rounded-full border border-black/50 transition-transform duration-150 ${KNOB_CLASSES[size]} ${
            isOn ? 'translate-x-[calc(100%_+_0.25rem)]' : 'translate-x-0'
          }`}
        />
      </span>
    );
  })();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      aria-describedby={stateDescriptionId}
      disabled={disabled}
      onClick={onToggle}
      className={`inline-flex min-h-[44px] min-w-[44px] select-none flex-col items-center justify-center gap-1 rounded px-1 py-1 transition-opacity ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer active:opacity-80'
      } ${className}`}
    >
      <span className="flex items-center gap-1.5">
        {body}
        {variant !== 'power' ? (
          <LedIndicator
            color={color}
            isOn={isOn}
            size={size === 'sm' ? 'xs' : 'sm'}
            intensity={isOn ? 'high' : 'low'}
          />
        ) : null}
      </span>
      <span id={stateDescriptionId} className="sr-only">
        {isOn ? 'on' : 'off'}
      </span>
      {!hideLabel ? (
        <span className={`engraved-label font-hardware ${LABEL_CLASSES[size]}`}>{label}</span>
      ) : null}
    </button>
  );
}
