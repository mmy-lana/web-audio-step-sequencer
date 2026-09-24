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

/** Tags that swallow global hotkeys while the user is typing. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TEXT_ENTRY_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

/**
 * Global soundboard hotkeys.
 *
 * Held keys are ignored (`repeat`), modifier chords are left to the browser, and
 * any focused text field disables the listener so typing never fires a pad.
 * Spacebar toggles the transport.
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
    if (isTextEntryTarget(event.target)) return;

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
