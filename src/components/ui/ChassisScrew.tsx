'use client';

import type { ReactElement } from 'react';

export type ChassisScrewSize = 'sm' | 'md' | 'lg';

export interface ChassisScrewProps {
  size?: ChassisScrewSize;
  /** Rotation of the screw slot in degrees, for a hand-assembled look. */
  angle?: number;
  className?: string;
}

const SIZE_CLASSES: Record<ChassisScrewSize, string> = {
  sm: 'h-2.5 w-2.5',
  md: 'h-3.5 w-3.5',
  lg: 'h-5 w-5',
};

const SLOT_CLASSES: Record<ChassisScrewSize, string> = {
  sm: 'h-px w-1.5',
  md: 'h-[1.5px] w-2',
  lg: 'h-0.5 w-3',
};

/**
 * Decorative chassis mounting screw. Carries no information, so it is hidden
 * from assistive technology.
 */
export function ChassisScrew({
  size = 'md',
  angle = 0,
  className = '',
}: ChassisScrewProps): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`hex-screw relative inline-block shrink-0 rounded-full ${SIZE_CLASSES[size]} ${className}`}
    >
      <span
        className={`hex-screw-slot absolute left-1/2 top-1/2 rounded-full ${SLOT_CLASSES[size]}`}
        style={{ transform: `translate(-50%, -50%) rotate(${angle}deg)` }}
      />
    </span>
  );
}
