'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SoundboardPad } from '@/types/audio';
import { SOUNDBOARD_PRESET_TEMPLATES } from '@/lib/constants/soundboardPresets';

export interface UseSoundboardKeyboardOptions {
  /** Pads that participate in keyboard triggering. */
  pads?: readonly SoundboardPad[];
  onTriggerPad: (pad: SoundboardPad, flashToken: number) => void;
  /** Bound to Spacebar, per the transport shortcut contract. */
  onToggleTransport?: () => void;
  enabled?: boolean;
}

export interface SoundboardKeyboardState {
  /** Most recently triggered pad id, or `null` before the first hit. */
  lastTriggeredPadId: string | null;
  /** Monotonic counter; pass it to `SoundboardTriggerPad` to flash the pad. */
  flashToken: number;
}

/**
 * Controls that own the keyboard while they hold focus.
 *
 * `closest` is used from the event target upwards, so a key pressed on a
 * `<span>` inside a `<button>` still counts as the button's key.
 */
const INTERACTIVE_SELECTOR = [
  // Native interactive elements.
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  // Every value that makes a region editable, including plain-text mode.
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  // ARIA widgets that own Space, Enter or the arrow keys while focused. The
  // instrument itself renders tabs, switches and sliders, so these matter here.
  '[role="button"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="spinbutton"]',
  '[role="menuitem"]',
].join(',');

/**
 * True when a key event belongs to a focused interactive control.
 *
 * Space is the global transport shortcut, but it is also the activation key of
 * every native button and ARIA widget, so a focused control has to win: without
 * this guard one keystroke would press the control and toggle the transport.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(INTERACTIVE_SELECTOR) !== null) return true;
  // Covers editable state that carries no attribute of its own, such as an
  // inherited edit host or `document.designMode`. The property is missing
  // outside a browser document, hence the explicit comparison.
  return target instanceof HTMLElement && target.isContentEditable === true;
}

/**
 * Global soundboard hotkeys.
 *
 * Held keys are ignored (`repeat`), modifier chords are left to the browser, and
 * any focused interactive control takes precedence over the global shortcuts so
 * typing and Space-activatable controls behave normally. Spacebar toggles the
 * transport everywhere else.
 */
export function useSoundboardKeyboard({
  pads = SOUNDBOARD_PRESET_TEMPLATES,
  onTriggerPad,
  onToggleTransport,
  enabled = true,
}: UseSoundboardKeyboardOptions): SoundboardKeyboardState {
  const [state, setState] = useState<{ padId: string | null; token: number }>({
    padId: null,
    token: 0,
  });
  const tokenRef = useRef(0);
  const latestRef = useRef({ pads, onTriggerPad, onToggleTransport, enabled });

  // Keep the listener stable while always reading the newest props.
  latestRef.current = { pads, onTriggerPad, onToggleTransport, enabled };

  const padsByKey = useMemo(() => {
    const map = new Map<string, SoundboardPad>();
    pads.forEach((pad) => map.set(pad.keyBinding.toUpperCase(), pad));
    return map;
  }, [pads]);

  const padsByKeyRef = useRef(padsByKey);
  padsByKeyRef.current = padsByKey;

  const handleKeyDown = useCallback((event: KeyboardEvent): void => {
    const current = latestRef.current;
    if (!current.enabled) return;
    if (event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isInteractiveTarget(event.target)) return;

    if (event.code === 'Space' || event.key === ' ') {
      if (current.onToggleTransport === undefined) return;
      event.preventDefault();
      current.onToggleTransport();
      return;
    }

    const pad = padsByKeyRef.current.get(event.key.toUpperCase());
    if (pad === undefined) return;

    event.preventDefault();
    tokenRef.current += 1;
    const token = tokenRef.current;
    setState({ padId: pad.id, token });
    current.onTriggerPad(pad, token);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { lastTriggeredPadId: state.padId, flashToken: state.token };
}
