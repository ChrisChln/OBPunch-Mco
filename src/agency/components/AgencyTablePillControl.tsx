import {
  type ButtonHTMLAttributes,
  type ChangeEventHandler,
  type ReactNode
} from 'react';
import { ChevronDown } from 'lucide-react';

import GlowLabelChip from '../../components/GlowLabelChip';
import type { LabelToneKey } from '../../lib/labelTone';

type AgencyTablePillSelectProps = {
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  displayLabel: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  title?: string;
  tone: LabelToneKey;
  value: string;
};

export function AgencyTablePillSelect({
  ariaLabel,
  children,
  disabled = false,
  displayLabel,
  onChange,
  title,
  tone,
  value
}: AgencyTablePillSelectProps) {
  return (
    <GlowLabelChip tone={tone} className="!px-0 !py-0" glowSeed={`agency-group:${tone}:${displayLabel}`}>
      <span className="relative inline-grid min-w-0">
        <span
          data-testid="agency-pill-select-sizer"
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 whitespace-pre px-2.5 py-[5px] pr-6 text-[10px] font-semibold leading-none"
        >
          {displayLabel}
        </span>
        <select
          aria-label={ariaLabel}
          value={value}
          disabled={disabled}
          onChange={onChange}
          title={title}
          className="col-start-1 row-start-1 h-full w-full appearance-none rounded-full bg-transparent px-2.5 py-[5px] pr-6 text-[10px] font-semibold leading-none text-slate-100 outline-none transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-300"
        />
      </span>
    </GlowLabelChip>
  );
}

type AgencyTablePillButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  tone: LabelToneKey;
};

export function AgencyTablePillButton({
  children,
  className = '',
  tone,
  type = 'button',
  ...buttonProps
}: AgencyTablePillButtonProps) {
  return (
    <GlowLabelChip tone={tone} className="!px-0 !py-0" glowSeed={`agency-button:${tone}:${String(children)}`}>
      <button
        {...buttonProps}
        type={type}
        className={[
          'inline-flex items-center justify-center rounded-full px-2.5 py-[5px] text-[10px] font-semibold leading-none text-slate-100 outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-50',
          className
        ].join(' ')}
      >
        {children}
      </button>
    </GlowLabelChip>
  );
}
