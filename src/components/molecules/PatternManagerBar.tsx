'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import type { StorageSlotMetadata } from '@/types/storage';
import { PATTERN_SLOT_COUNT } from '@/lib/constants/storageKeys';
import { PushButton } from '@/components/ui/PushButton';
import { LedIndicator } from '@/components/ui/LedIndicator';

export interface PatternManagerBarProps {
  activeSlot: number;
  isDirty: boolean;
  onSelectSlot: (slot: number) => void;
  /**
   * Persists the working copy. The bar performs its own occupancy check against
   * `slotMetadata` and asks for confirmation inline, so this handler is always
   * invoked as a confirmed write.
   */
  onSaveToSlot: (slot: number) => void;
  onClearSlot: (slot: number) => void;
  onDuplicateSlot: (targetSlot: number) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  slotMetadata?: readonly StorageSlotMetadata[];
  storageError?: string | null;
  onDismissError?: () => void;
  isUsingMemoryFallback?: boolean;
  isQuotaExceeded?: boolean;
  patternName?: string;
  className?: string;
  /**
   * Slot awaiting a dirty-conflict decision. The owner reports the conflict and
   * parks the target here instead of opening a blocking native dialog.
   */
  pendingLoadSlot?: number | null;
  /** Confirms the parked slot load, discarding the unsaved working copy. */
  onConfirmLoad?: () => void;
  /** Dismisses the parked slot load and keeps the working copy untouched. */
  onCancelLoad?: () => void;
}

const SLOT_NUMBERS: readonly number[] = Array.from(
  { length: PATTERN_SLOT_COUNT },
  (_unused, index) => index + 1,
);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Formats a slot timestamp. Rendered only for hydrated metadata, so the server
 * and client never disagree about the local timezone.
 */
function formatTimestamp(timestamp: number): string {
  if (timestamp <= 0) return 'empty';
  const date = new Date(timestamp);
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/**
 * Pattern memory bay: eight save slots plus save / clear / duplicate / export /
 * import. Destructive actions require an inline two-step confirmation, including
 * the discard-and-load decision for a dirty working copy, which is rendered here
 * rather than through a blocking native dialog.
 */
export function PatternManagerBar({
  activeSlot,
  isDirty,
  onSelectSlot,
  onSaveToSlot,
  onClearSlot,
  onDuplicateSlot,
  onExport,
  onImport,
  slotMetadata = [],
  storageError = null,
  onDismissError,
  isUsingMemoryFallback = false,
  isQuotaExceeded = false,
  patternName,
  className = '',
  pendingLoadSlot = null,
  onConfirmLoad,
  onCancelLoad,
}: PatternManagerBarProps): ReactElement {
  const [pendingSaveSlot, setPendingSaveSlot] = useState<number | null>(null);
  const [pendingClearSlot, setPendingClearSlot] = useState<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const metadataBySlot = useMemo(() => {
    const map = new Map<number, StorageSlotMetadata>();
    slotMetadata.forEach((entry) => map.set(entry.slot, entry));
    return map;
  }, [slotMetadata]);

  const firstEmptySlot = useMemo(() => {
    const empty = slotMetadata.find((entry) => entry.isEmpty);
    return empty ? empty.slot : null;
  }, [slotMetadata]);

  const activeMetadata = metadataBySlot.get(activeSlot);
  const isActiveOccupied = activeMetadata !== undefined && !activeMetadata.isEmpty;

  const requestSave = useCallback(
    (slot: number): void => {
      const entry = metadataBySlot.get(slot);
      if (entry && !entry.isEmpty) {
        setPendingClearSlot(null);
        setPendingSaveSlot(slot);
        return;
      }
      onSaveToSlot(slot);
    },
    [metadataBySlot, onSaveToSlot],
  );

  const confirmSave = useCallback((): void => {
    if (pendingSaveSlot === null) return;
    onSaveToSlot(pendingSaveSlot);
    setPendingSaveSlot(null);
  }, [pendingSaveSlot, onSaveToSlot]);

  const confirmClear = useCallback((): void => {
    if (pendingClearSlot === null) return;
    onClearSlot(pendingClearSlot);
    setPendingClearSlot(null);
  }, [pendingClearSlot, onClearSlot]);

  const handleImportChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      // Reset first so re-selecting the same file fires `change` again.
      event.target.value = '';
      if (file) onImport(file);
    },
    [onImport],
  );

  return (
    <section className={`chassis-panel p-3 sm:p-4 ${className}`}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-chassis-border pb-2">
        <div className="flex items-center gap-2">
          <h2 className="font-hardware text-[11px] font-bold tracking-[0.18em] text-ink">
            PATTERN MEMORY
          </h2>
          <LedIndicator
            color={isDirty ? 'amber' : 'emerald'}
            isOn
            size="sm"
            intensity={isDirty ? 'high' : 'normal'}
            label={isDirty ? 'Unsaved changes' : 'Saved'}
          />
          <span className="font-hardware text-[9px] text-ink-dim">
            {isDirty ? 'unsaved changes' : 'saved'}
          </span>
        </div>
        <span className="truncate font-hardware text-[10px] text-ink-muted">
          {patternName ?? `SLOT ${activeSlot}`}
        </span>
      </header>

      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {SLOT_NUMBERS.map((slot) => {
          const entry = metadataBySlot.get(slot);
          const isEmpty = entry === undefined ? true : entry.isEmpty;
          const isCorrupt = entry?.isCorrupt ?? false;
          const isActive = slot === activeSlot;
          return (
            <button
              key={slot}
              type="button"
              onClick={() => onSelectSlot(slot)}
              aria-label={`Load slot ${slot}${isEmpty ? ', empty' : `, ${entry?.name ?? ''}`}`}
              aria-pressed={isActive}
              className={`chassis-sunken flex min-h-[56px] select-none flex-col justify-between rounded p-1.5 text-left transition-colors duration-100 ${
                isActive ? 'ring-1 ring-status-ok/70' : 'hover:border-chassis-border-strong'
              }`}
            >
              <span className="flex items-center justify-between gap-1">
                <span
                  className={`font-hardware text-[10px] font-bold ${
                    isActive ? 'text-status-ok' : 'text-ink-muted'
                  }`}
                >
                  {pad(slot)}
                </span>
                <LedIndicator
                  color={isCorrupt ? 'crimson' : isEmpty ? 'electric_blue' : 'emerald'}
                  isOn={!isEmpty}
                  size="xs"
                  intensity={isCorrupt ? 'high' : 'normal'}
                  label={isCorrupt ? `Slot ${slot} corrupt` : isEmpty ? `Slot ${slot} empty` : `Slot ${slot} used`}
                />
              </span>
              <span className="flex flex-col">
                <span className="truncate font-hardware text-[8px] leading-tight text-ink-faint">
                  {isCorrupt ? 'CORRUPT' : isEmpty ? '—' : (entry?.name ?? '')}
                </span>
                <span className="truncate font-hardware text-[8px] leading-tight text-ink-faint">
                  {formatTimestamp(entry?.updatedAt ?? 0)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/*
        Dirty-conflict decision for a slot load. Rendered inline so nothing
        blocks the audio thread, and deliberately without auto-focus or a focus
        trap: the row sits in normal tab order after the slot grid, so keyboard
        users reach Confirm / Cancel with Tab and can leave the row at any time.
      */}
      {pendingLoadSlot !== null ? (
        <div
          data-slot-load-confirm="true"
          className="mt-3 flex flex-wrap items-center gap-2 rounded border border-status-warn/50 bg-status-warn/10 p-2"
        >
          <span className="font-hardware text-[10px] text-status-warn">
            Discard unsaved changes and load slot {pad(pendingLoadSlot)}?
          </span>
          <PushButton
            label="Confirm"
            ariaLabel={`Discard unsaved changes and load slot ${pad(pendingLoadSlot)}`}
            onClick={onConfirmLoad ?? (() => undefined)}
            variant="danger"
            size="sm"
            className="min-h-[44px]! md:min-h-[32px]!"
          />
          <PushButton
            label="Cancel"
            ariaLabel="Keep the current pattern"
            onClick={onCancelLoad ?? (() => undefined)}
            variant="ghost"
            size="sm"
            className="min-h-[44px]! md:min-h-[32px]!"
          />
        </div>
      ) : null}

      {pendingSaveSlot !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-status-warn/50 bg-status-warn/10 p-2">
          <span className="font-hardware text-[10px] text-status-warn">
            Overwrite slot {pad(pendingSaveSlot)}?
          </span>
          <PushButton label="Confirm" onClick={confirmSave} variant="danger" size="sm" className="min-h-[44px]! md:min-h-[32px]!" />
          <PushButton
            label="Cancel"
            onClick={() => setPendingSaveSlot(null)}
            variant="ghost"
            size="sm"
            className="min-h-[44px]! md:min-h-[32px]!"
          />
        </div>
      ) : null}

      {pendingClearSlot !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-status-error/50 bg-status-error/10 p-2">
          <span className="font-hardware text-[10px] text-status-error">
            Erase slot {pad(pendingClearSlot)} permanently?
          </span>
          <PushButton label="Erase" onClick={confirmClear} variant="danger" size="sm" className="min-h-[44px]! md:min-h-[32px]!" />
          <PushButton
            label="Cancel"
            onClick={() => setPendingClearSlot(null)}
            variant="ghost"
            size="sm"
            className="min-h-[44px]! md:min-h-[32px]!"
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <PushButton
          label={isActiveOccupied ? 'Overwrite' : 'Save'}
          ariaLabel={`Save pattern to slot ${activeSlot}`}
          onClick={() => requestSave(activeSlot)}
          variant="primary"
          size="sm"
        />
        <PushButton
          label="Clear"
          ariaLabel={`Clear slot ${activeSlot}`}
          onClick={() => {
            setPendingSaveSlot(null);
            setPendingClearSlot(activeSlot);
          }}
          variant="danger"
          size="sm"
          disabled={activeMetadata === undefined || activeMetadata.isEmpty}
        />
        <PushButton
          label="Duplicate"
          ariaLabel={
            firstEmptySlot === null
              ? 'No empty slot available to duplicate into'
              : `Duplicate into slot ${firstEmptySlot}`
          }
          onClick={() => {
            if (firstEmptySlot !== null) onDuplicateSlot(firstEmptySlot);
          }}
          variant="secondary"
          size="sm"
          disabled={firstEmptySlot === null}
        />
        <PushButton label="Export" onClick={onExport} variant="secondary" size="sm" />
        <PushButton
          label="Import"
          onClick={() => importInputRef.current?.click()}
          variant="secondary"
          size="sm"
        />
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportChange}
          className="hidden"
          aria-label="Import pattern JSON file"
        />
      </div>

      {isQuotaExceeded ? (
        <p className="mt-3 rounded border border-status-error/50 bg-status-error/10 p-2 font-hardware text-[10px] text-status-error">
          Browser storage is full. Changes are held in memory only — export the pattern to keep it.
        </p>
      ) : isUsingMemoryFallback ? (
        <p className="mt-3 rounded border border-status-warn/50 bg-status-warn/10 p-2 font-hardware text-[10px] text-status-warn">
          Persistent storage is unavailable. Patterns live in memory for this session only.
        </p>
      ) : null}

      {storageError !== null ? (
        <div className="mt-3 flex items-start justify-between gap-2 rounded border border-status-error/50 bg-status-error/10 p-2">
          <span className="font-hardware text-[10px] leading-relaxed text-status-error">
            {storageError}
          </span>
          {onDismissError !== undefined ? (
            <PushButton
              label="Dismiss"
              onClick={onDismissError}
              variant="ghost"
              size="sm"
              className="min-h-[44px]! md:min-h-[28px]!"
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
