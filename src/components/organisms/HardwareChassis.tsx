'use client';

import type { ReactElement, ReactNode } from 'react';
import { ChassisScrew } from '@/components/ui/ChassisScrew';

export interface HardwareChassisProps {
  children: ReactNode;
  /** Branding, power state and master status. */
  header: ReactNode;
  /** Storage / cross-tab banner rail rendered under the header. */
  statusRail?: ReactNode;
  /** Top transport deck; hidden below 768px where the bar variant takes over. */
  consoleBar?: ReactNode;
  /** Mobile tab switcher; hidden from 768px up. */
  mobileNav?: ReactNode;
  /** Fixed mobile transport bar; hidden from 768px up. */
  bottomBar?: ReactNode;
  className?: string;
}

/** Static screw positions on the rack ears, written as literal classes. */
const EAR_SCREW_POSITIONS: readonly string[] = [
  'top-[12%]',
  'top-[38%]',
  'top-[64%]',
  'top-[88%]',
];

/**
 * Rack frame.
 *
 * - Below 768px the ears and corner screws are hidden and the layout is a single
 *   column with a fixed transport bar.
 * - From 768px the top transport console docks with `sticky top-0 z-30`.
 * - From 1024px the beveled rack ears with hex screws appear.
 *
 * The root container always reserves `env(safe-area-inset-bottom) + 5rem` of
 * bottom padding so the fixed bar can never cover a control.
 */
export function HardwareChassis({
  children,
  header,
  statusRail,
  consoleBar,
  mobileNav,
  bottomBar,
  className = '',
}: HardwareChassisProps): ReactElement {
  return (
    <div className={`relative min-h-[100dvh] bg-chassis-bg ${className}`}>
      {/* ------------------------------------------------------------ ears */}
      <div
        aria-hidden="true"
        className="rack-ear pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-9 border-r lg:block xl:w-10"
      >
        {EAR_SCREW_POSITIONS.map((position, index) => (
          <ChassisScrew
            key={`left-${position}`}
            size="lg"
            angle={index * 47}
            className={`absolute left-1/2 -translate-x-1/2 ${position}`}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="rack-ear pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-9 border-l lg:block xl:w-10"
      >
        {EAR_SCREW_POSITIONS.map((position, index) => (
          <ChassisScrew
            key={`right-${position}`}
            size="lg"
            angle={index * 31 + 15}
            className={`absolute left-1/2 -translate-x-1/2 ${position}`}
          />
        ))}
      </div>

      {/* ----------------------------------------------------------- shell */}
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1800px] flex-col px-2 pb-[calc(env(safe-area-inset-bottom)_+_5rem)] sm:px-3 lg:px-14">
        <header className="chassis-panel relative mt-2 rounded p-3 sm:p-4">
          {/* Corner screws are hidden below 768px. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden md:block">
            <ChassisScrew size="md" angle={18} className="absolute left-1.5 top-1.5" />
            <ChassisScrew size="md" angle={-42} className="absolute right-1.5 top-1.5" />
            <ChassisScrew size="md" angle={74} className="absolute bottom-1.5 left-1.5" />
            <ChassisScrew size="md" angle={-6} className="absolute bottom-1.5 right-1.5" />
          </div>
          {header}
        </header>

        {statusRail !== undefined ? <div className="mt-2">{statusRail}</div> : null}

        {consoleBar !== undefined ? <div className="mt-2">{consoleBar}</div> : null}

        <main className="mt-3 flex flex-1 flex-col gap-3">{children}</main>
      </div>

      {mobileNav}

      {bottomBar !== undefined ? (
        <div className="fixed inset-x-0 bottom-0 z-40 md:hidden">{bottomBar}</div>
      ) : null}
    </div>
  );
}
