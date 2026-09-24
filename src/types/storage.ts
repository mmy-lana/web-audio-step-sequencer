/**
 * Storage layer contracts. Pure interfaces only — no runtime imports, so this
 * module can be consumed by every tier above `src/lib/validation`.
 */

/** One of the eight hardware pattern memory slots. */
export interface StorageSlotMetadata {
  slot: number;
  name: string;
  updatedAt: number;
  isEmpty: boolean;
  isCorrupt: boolean;
}

/**
 * Machine-readable failure reason. Callers branch on this instead of parsing
 * message text, so `empty` (a normal, untouched slot) stays clearly distinct
 * from `corrupt` (unreadable or schema-invalid stored data).
 */
export type StorageFailureCode = 'invalid_slot' | 'empty' | 'corrupt' | 'validation';

/** Result wrapper used by every storage operation. */
export interface StorageResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: StorageFailureCode;
  isMemoryFallback?: boolean;
  isQuotaExceeded?: boolean;
}

/** Snapshot of the persistence backend health, surfaced in the UI status rail. */
export interface StorageDiagnostics {
  isAvailable: boolean;
  isUsingMemoryFallback: boolean;
  isQuotaExceeded: boolean;
}

/** Cross-tab notification payload derived from a `storage` event. */
export interface StorageChangeEventPayload {
  key: string;
  newValue: string | null;
  oldValue: string | null;
}
