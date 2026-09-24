'use client';

import type { ReactElement } from 'react';
import type { MobileTab } from '@/store/useSequencerStore';
import { MechanicalSwitch } from '@/components/ui/MechanicalSwitch';

export interface MobileNavPanelProps {
  activeTab: MobileTab;
  onChangeTab: (tab: MobileTab) => void;
  isEditMode: boolean;
  onToggleEditMode: () => void;
  className?: string;
}

const TABS: readonly { id: MobileTab; label: string; short: string }[] = [
  { id: 'sequencer', label: 'Track edit', short: 'TRACK' },
  { id: 'soundboard', label: 'Performance pads', short: 'PADS' },
  { id: 'fx', label: 'FX & master', short: 'FX' },
];

/**
 * Sub-768px view switcher.
 *
 * Sticks to the top of the viewport so the three views are always one tap away,
 * and carries the step-edit latch, which exists at every breakpoint.
 */
export function MobileNavPanel({
  activeTab,
  onChangeTab,
  isEditMode,
  onToggleEditMode,
  className = '',
}: MobileNavPanelProps): ReactElement {
  return (
    <nav
      aria-label="Mobile view switcher"
      className={`chassis-panel sticky top-0 z-30 rounded-none border-x-0 border-t-0 p-2 backdrop-blur-sm md:hidden ${className}`}
    >
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Instrument views" className="flex flex-1 items-center gap-1">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                id={`tab-${tab.id}`}
                onClick={() => onChangeTab(tab.id)}
                className={`pad-face flex min-h-[44px] flex-1 flex-col items-center justify-center rounded border px-1 font-hardware font-bold uppercase tracking-wider transition-colors ${
                  isActive
                    ? 'border-status-ok/70 bg-status-ok/15 text-status-ok'
                    : 'border-chassis-border bg-chassis-raised text-ink-muted'
                }`}
              >
                <span className="text-[10px]">{tab.short}</span>
                <span className="text-[8px] font-normal text-ink-faint">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 flex-col items-center">
          <MechanicalSwitch
            isOn={isEditMode}
            onToggle={onToggleEditMode}
            label="Edit"
            variant="toggle"
            size="sm"
            color="violet"
          />
        </div>
      </div>

      <p className="engraved-label mt-2 font-hardware text-[8px] leading-relaxed">
        {isEditMode
          ? 'tap a step to edit velocity / probability / pitch'
          : 'tap a step to toggle it'}
      </p>
    </nav>
  );
}
