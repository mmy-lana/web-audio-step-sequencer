import type { Pattern } from '@/types/audio';
import type {
  StorageChangeEventPayload,
  StorageDiagnostics,
  StorageResult,
  StorageSlotMetadata,
} from '@/types/storage';
import {
  MAX_IMPORT_SIZE_BYTES,
  PatternSchema,
  formatValidationIssues,
  measureUtf8ByteLength,
  validatePatternJson,
} from '@/lib/validation/pattern';
import {
  PATTERN_SLOT_COUNT,
  STORAGE_KEYS,
  clampPatternSlot,
  getSlotStorageKey,
  isValidPatternSlot,
} from '@/lib/constants/storageKeys';

const STORAGE_PROBE_KEY = '__wa_step_seq_probe__';

/** Browser storage error names that indicate quota exhaustion. */
const QUOTA_ERROR_NAMES = new Set([
  'QuotaExceededError',
  'NS_ERROR_DOM_QUOTA_REACHED',
]);

function isQuotaError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return QUOTA_ERROR_NAMES.has(error.name) || error.code === 22 || error.code === 1014;
  }
  if (error instanceof Error) {
    return QUOTA_ERROR_NAMES.has(error.name);
  }
  return false;
}

/**
 * `localStorage` wrapper that defers capability probing until first access, so
 * module evaluation is safe during SSR and static prerender. When the backend is
 * unavailable or full, every operation transparently falls back to an in-memory
 * `Map` and the failure is reported through `getDiagnostics()`.
 */
export class LazySafeStorageAdapter {
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
      window.localStorage.setItem(STORAGE_PROBE_KEY, '1');
      window.localStorage.removeItem(STORAGE_PROBE_KEY);
      this.isAvailable = true;
      return true;
    } catch {
      this.isAvailable = false;
      this.isUsingMemoryFallback = true;
      return false;
    }
  }

  public getItem(key: string): string | null {
    const backendAvailable = this.ensureAvailable();
    // A value written while the backend was quota-blocked or unavailable exists
    // only in the memory mirror, so the mirror wins until a backend write succeeds.
    if (this.isUsingMemoryFallback) {
      const mirrored = this.memoryStore.get(key);
      if (mirrored !== undefined) return mirrored;
    }
    if (backendAvailable) {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored !== null) return stored;
      } catch {
        // Fall through to the memory mirror.
      }
    }
    return this.memoryStore.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    if (this.ensureAvailable()) {
      try {
        window.localStorage.setItem(key, value);
        this.isQuotaExceeded = false;
        // The backend is authoritative again; drop any stale mirrored copy.
        this.memoryStore.delete(key);
        return;
      } catch (err) {
        if (isQuotaError(err)) {
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

  public getDiagnostics(): StorageDiagnostics {
    this.ensureAvailable();
    return {
      isAvailable: this.isAvailable,
      isUsingMemoryFallback: this.isUsingMemoryFallback,
      isQuotaExceeded: this.isQuotaExceeded,
    };
  }
}

export const safeStorage = new LazySafeStorageAdapter();

/** Backend health snapshot for status rails and warning banners. */
export function getStorageDiagnostics(): StorageDiagnostics {
  return safeStorage.getDiagnostics();
}

/** Convenience predicate used by the persistence hook to surface a warning. */
export function isStorageUsingMemoryFallback(): boolean {
  return safeStorage.getDiagnostics().isUsingMemoryFallback;
}

/** Attaches the current backend diagnostics to a void result. */
function withDiagnostics(error?: string): StorageResult<void> {
  const diagnostics = getStorageDiagnostics();
  const backend = {
    isMemoryFallback: diagnostics.isUsingMemoryFallback,
    isQuotaExceeded: diagnostics.isQuotaExceeded,
  };
  return error === undefined ? { ok: true, ...backend } : { ok: false, error, ...backend };
}

export function saveWorkingCopy(pattern: Pattern): StorageResult<void> {
  const result = PatternSchema.safeParse(pattern);
  if (!result.success) {
    return { ok: false, error: formatValidationIssues(result.error) };
  }
  safeStorage.setItem(STORAGE_KEYS.WORKING_COPY, JSON.stringify(result.data));
  return withDiagnostics();
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

export function clearWorkingCopy(): void {
  safeStorage.removeItem(STORAGE_KEYS.WORKING_COPY);
}

export function savePatternToSlot(slot: number, pattern: Pattern): StorageResult<void> {
  if (!isValidPatternSlot(slot)) {
    return {
      ok: false,
      code: 'invalid_slot',
      error: `Slot index ${slot} is outside the valid 1..${PATTERN_SLOT_COUNT} range`,
    };
  }
  const targetPattern: Pattern = {
    ...pattern,
    slot,
    updatedAt: Date.now(),
  };
  const result = PatternSchema.safeParse(targetPattern);
  if (!result.success) {
    return { ok: false, code: 'validation', error: formatValidationIssues(result.error) };
  }
  safeStorage.setItem(getSlotStorageKey(slot), JSON.stringify(result.data));
  return withDiagnostics();
}

/**
 * Reads one memory slot.
 *
 * An untouched slot reports `code: 'empty'`, which is a normal state of a
 * pattern-memory bank rather than a failure. Corrupt JSON, schema violations and
 * slot mismatches report `code: 'corrupt'`, and out-of-range requests report
 * `code: 'invalid_slot'`.
 */
export function loadPatternFromSlot(slot: number): StorageResult<Pattern> {
  if (!isValidPatternSlot(slot)) {
    return {
      ok: false,
      code: 'invalid_slot',
      error: `Slot index ${slot} is outside the valid 1..${PATTERN_SLOT_COUNT} range`,
    };
  }
  const raw = safeStorage.getItem(getSlotStorageKey(slot));
  if (!raw) return { ok: false, code: 'empty', error: `Slot ${slot} is empty` };
  try {
    const pattern = validatePatternJson(raw);
    if (pattern.slot !== slot) {
      return {
        ok: false,
        code: 'corrupt',
        error: `Data corruption: Slot mismatch (expected ${slot}, found ${pattern.slot})`,
      };
    }
    return { ok: true, data: pattern };
  } catch (err) {
    return {
      ok: false,
      code: 'corrupt',
      error: err instanceof Error ? err.message : `Failed to parse slot ${slot}`,
    };
  }
}

export function duplicateSlot(fromSlot: number, toSlot: number): StorageResult<void> {
  if (!isValidPatternSlot(fromSlot) || !isValidPatternSlot(toSlot)) {
    return { ok: false, error: `Slot indices must be within 1..${PATTERN_SLOT_COUNT}` };
  }
  if (fromSlot === toSlot) {
    return { ok: false, error: 'Source and destination slots are identical' };
  }
  const source = loadPatternFromSlot(fromSlot);
  if (!source.ok || !source.data) {
    return { ok: false, error: `Source slot ${fromSlot} is invalid or empty` };
  }
  return savePatternToSlot(toSlot, source.data);
}

export function clearPatternSlot(slot: number): void {
  if (!isValidPatternSlot(slot)) return;
  safeStorage.removeItem(getSlotStorageKey(slot));
}

export function getSlotMetadataList(): StorageSlotMetadata[] {
  const list: StorageSlotMetadata[] = [];
  for (let slot = 1; slot <= PATTERN_SLOT_COUNT; slot++) {
    const raw = safeStorage.getItem(getSlotStorageKey(slot));
    if (!raw) {
      list.push({ slot, name: `Slot ${slot}`, updatedAt: 0, isEmpty: true, isCorrupt: false });
      continue;
    }
    try {
      const parsed = validatePatternJson(raw);
      list.push({ slot, name: parsed.name, updatedAt: parsed.updatedAt, isEmpty: false, isCorrupt: false });
    } catch {
      list.push({ slot, name: `Slot ${slot} [Corrupt]`, updatedAt: 0, isEmpty: false, isCorrupt: true });
    }
  }
  return list;
}

export function exportPatternToJson(pattern: Pattern): StorageResult<string> {
  try {
    const parsed = PatternSchema.parse(pattern);
    return { ok: true, data: JSON.stringify(parsed, null, 2) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Pattern export serialization failed',
    };
  }
}

export function importPatternFromJson(rawJson: string, fileSize?: number): StorageResult<Pattern> {
  if (fileSize !== undefined && fileSize > MAX_IMPORT_SIZE_BYTES) {
    return { ok: false, error: 'Pattern file exceeds maximum allowed size (500 KB)' };
  }
  if (measureUtf8ByteLength(rawJson) > MAX_IMPORT_SIZE_BYTES) {
    return { ok: false, error: 'Pattern file exceeds maximum allowed size (500 KB)' };
  }
  try {
    const pattern = validatePatternJson(rawJson);
    return { ok: true, data: pattern };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid pattern import file' };
  }
}

/** Suggests a free slot for imports, falling back to slot 1 when all are taken. */
export function findFirstEmptySlot(): number {
  const metadata = getSlotMetadataList();
  const empty = metadata.find((entry) => entry.isEmpty);
  return empty ? empty.slot : clampPatternSlot(1);
}

/**
 * Subscribes to cross-tab `storage` events for a specific key. Returns an
 * unsubscribe function; safe to call during SSR (returns a no-op).
 */
export function subscribeToStorageChanges(
  key: string,
  handler: (payload: StorageChangeEventPayload) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  const listener = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== key) return;
    handler({ key, newValue: event.newValue, oldValue: event.oldValue });
  };
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener('storage', listener);
  };
}
