/**
 * Namespaced persistence keys. Kept free of imports so both the constants and
 * storage tiers can depend on it without creating a cycle.
 */
export const STORAGE_KEYS = {
  PATTERN_SLOT_PREFIX: 'wa_step_seq_slot_',
  WORKING_COPY: 'wa_step_seq_working_copy',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Number of hardware pattern memory slots (1-indexed). */
export const PATTERN_SLOT_COUNT = 8;

/** Validated slot range used by every slot-facing guard. */
export const MIN_PATTERN_SLOT = 1;
export const MAX_PATTERN_SLOT = PATTERN_SLOT_COUNT;

/** Builds the localStorage key for a numbered pattern slot. */
export function getSlotStorageKey(slot: number): string {
  return `${STORAGE_KEYS.PATTERN_SLOT_PREFIX}${slot}`;
}

/** Narrows an unknown value to a valid 1..8 slot index. */
export function isValidPatternSlot(slot: unknown): slot is number {
  return (
    typeof slot === 'number' &&
    Number.isInteger(slot) &&
    slot >= MIN_PATTERN_SLOT &&
    slot <= MAX_PATTERN_SLOT
  );
}

/** Clamps an arbitrary numeric input into the 1..8 slot range. */
export function clampPatternSlot(slot: number): number {
  if (!Number.isFinite(slot)) return MIN_PATTERN_SLOT;
  return Math.min(MAX_PATTERN_SLOT, Math.max(MIN_PATTERN_SLOT, Math.round(slot)));
}
