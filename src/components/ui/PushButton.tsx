'use client';

import type { ButtonHTMLAttributes, ReactElement } from 'react';
import type { TrackColor } from '@/types/audio';
import { COLOR_MAP } from '@/lib/constants/colorMap';

export type PushButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type PushButtonSize = 'sm' | 'md' | 'lg';

export interface PushButtonProps {
  label: string;
  onClick: () => void;
  variant?: PushButtonVariant;
  size?: PushButtonSize;
  /** Lit state for latching buttons (solo, edit mode, page select). */
  isActive?: boolean;
  /** Accent applied while `isActive`; falls back to a neutral lit state. */
  color?: TrackColor;
  disabled?: boolean;
  title?: string;
  /** Overrides the accessible name when the visible label is an icon only. */
  ariaLabel?: string;
  fullWidth?: boolean;
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  className?: string;
}

/** Every size keeps a >=44px touch target, per the mobile hardware spec. */
const SIZE_CLASSES: Record<PushButtonSize, string> = {
  sm: 'min-h-[44px] px-2.5 text-[10px]',
  md: 'min-h-[44px] px-3.5 text-xs',
  lg: 'min-h-[52px] px-5 text-sm',
};

const VARIANT_CLASSES: Record<PushButtonVariant, string> = {
  primary:
    'border-chassis-border-strong bg-hardware-metal text-ink shadow-control-raised hover:bg-hardware-metal-hi',
  secondary:
    'border-chassis-border bg-chassis-raised text-ink-muted shadow-control-raised hover:text-ink',
  ghost: 'border-transparent bg-transparent text-ink-muted hover:bg-chassis-raised hover:text-ink',
  danger:
    'border-[#400015] bg-[#2a0010] text-[#ff8098] shadow-control-raised hover:border-[#ff0055]',
};

const ACTIVE_NEUTRAL_CLASSES =
  'border-status-ok/70 bg-status-ok/15 text-status-ok shadow-[inset_0_0_10px_rgba(0,255,102,0.25)]';

/**
 * Tactile push button. The lit state uses static `COLOR_MAP` classes so
 * Tailwind v4 always emits the utilities.
 */
export function PushButton({
  label,
  onClick,
  variant = 'secondary',
  size = 'md',
  isActive = false,
  color,
  disabled = false,
  title,
  ariaLabel,
  fullWidth = false,
  type = 'button',
  className = '',
}: PushButtonProps): ReactElement {
  const activeClasses = color
    ? `${COLOR_MAP[color].borderActive} bg-chassis-raised ${COLOR_MAP[color].textActive} ${COLOR_MAP[color].glowClass}`
    : ACTIVE_NEUTRAL_CLASSES;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={Boolean(disabled)}
      title={title}
      aria-label={ariaLabel ?? label}
      aria-pressed={isActive}
      className={`pad-face inline-flex select-none items-center justify-center gap-1.5 rounded border font-hardware font-bold uppercase tracking-wider transition-all duration-100 ${
        SIZE_CLASSES[size]
      } ${isActive ? activeClasses : VARIANT_CLASSES[variant]} ${
        disabled ? 'cursor-not-allowed opacity-40' : 'active:translate-y-px active:shadow-control-pressed'
      } ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {label}
    </button>
  );
}
