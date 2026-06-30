import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import BorderGlow from '../admin/components/BorderGlow';

export type MagicSelectOption<Value extends string = string> = {
  value: Value;
  label: string;
  badgeClass?: string;
};

type MagicSelectTone = 'dark' | 'light';

const glowColors = ['#c084fc', '#38bdf8', '#84cc16'];

const ChevronDownIcon = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon = ({ className = 'h-3.5 w-3.5' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className={className} aria-hidden="true">
    <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const buildMultiLabel = (allLabel: string, selected: readonly string[], options: readonly MagicSelectOption[]) => {
  if (selected.length === 0) return allLabel;
  if (selected.length === 1) return options.find((option) => option.value === selected[0])?.label ?? selected[0];
  return `${selected.length} selected`;
};

const useDismissableMenu = () => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [floatingStyle, setFloatingStyle] = useState<CSSProperties | null>(null);

  const updateFloatingStyle = useCallback((minWidth: number) => {
    const trigger = rootRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const menuGap = 8;
    const width = Math.max(rect.width, minWidth);
    const left = Math.min(Math.max(rect.left, viewportPadding), Math.max(viewportPadding, window.innerWidth - width - viewportPadding));
    const menuHeight = menuRef.current?.offsetHeight ?? 260;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - menuGap;
    const spaceAbove = rect.top - viewportPadding - menuGap;
    const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.floor(openAbove ? spaceAbove : spaceBelow));
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - menuGap - Math.min(menuHeight, maxHeight))
      : Math.min(rect.bottom + menuGap, window.innerHeight - viewportPadding - Math.min(menuHeight, maxHeight));

    setFloatingStyle({
      position: 'fixed',
      left,
      top,
      width,
      maxHeight,
      zIndex: 1000
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setFloatingStyle(null);
  }, [open]);

  return { rootRef, menuRef, open, setOpen, floatingStyle, updateFloatingStyle };
};

const getTriggerClass = (tone: MagicSelectTone, disabled?: boolean) =>
  [
    'magic-field-auto flex h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm',
    tone === 'light' ? 'text-slate-900' : 'text-stone-100',
    disabled ? 'pointer-events-none cursor-not-allowed opacity-60' : ''
  ].join(' ');

const getOptionClass = (active: boolean, tone: MagicSelectTone) =>
  [
    'flex min-h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-2.5 py-1.5 text-left text-sm transition',
    active
      ? tone === 'light'
        ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-900'
        : 'border-lime-400/55 bg-lime-400/[0.09] text-lime-200 shadow-[0_0_18px_rgba(132,204,22,0.12)]'
      : tone === 'light'
        ? 'border-slate-200 bg-white/80 text-slate-800 hover:border-slate-300 hover:bg-slate-50'
        : 'border-white/10 bg-white/[0.035] text-slate-200 hover:border-white/18 hover:bg-white/[0.07]'
  ].join(' ');

const MenuSurface = ({ children, tone, className = '' }: { children: ReactNode; tone: MagicSelectTone; className?: string }) => (
  <BorderGlow
    className={['magic-select-menu-glow', className].join(' ')}
    backgroundColor={tone === 'light' ? '#ffffff' : '#120F17'}
    borderRadius={18}
    glowRadius={26}
    glowIntensity={0.72}
    edgeSensitivity={18}
    coneSpread={22}
    colors={glowColors}
    fillOpacity={0.28}
  >
    {children}
  </BorderGlow>
);

const renderMenuPortal = (children: ReactNode) => (typeof document === 'undefined' ? null : createPortal(children, document.body));

const getPortalMenuStyle = (style: CSSProperties | null): CSSProperties =>
  style ?? {
    position: 'fixed',
    left: 0,
    top: 0,
    visibility: 'hidden',
    zIndex: 1000
  };

const getMaxHeightValue = (style: CSSProperties | null, fallback: number) => {
  const value = Number(style?.maxHeight);
  return Number.isFinite(value) ? value : fallback;
};

export function MagicSingleSelect<Value extends string>({
  value,
  options,
  onChange,
  allLabel,
  disabled = false,
  tone = 'dark',
  className = ''
}: {
  value: Value | '';
  options: readonly MagicSelectOption<Value>[];
  onChange: (value: Value | '') => void;
  allLabel: string;
  disabled?: boolean;
  tone?: MagicSelectTone;
  className?: string;
}) {
  const { rootRef, menuRef, open, setOpen, floatingStyle, updateFloatingStyle } = useDismissableMenu();
  const selectedLabel = useMemo(() => options.find((option) => option.value === value)?.label ?? allLabel, [allLabel, options, value]);

  useEffect(() => {
    if (!open) return;
    updateFloatingStyle(180);
    const onReposition = () => updateFloatingStyle(180);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, updateFloatingStyle]);

  return (
    <div ref={rootRef} className={['relative', className].join(' ')}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={getTriggerClass(tone, disabled)}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open
        ? renderMenuPortal(
            <div ref={menuRef} style={getPortalMenuStyle(floatingStyle)} className="min-w-[180px]">
              <MenuSurface tone={tone}>
                <div role="listbox" className="magic-select-menu space-y-1 overflow-auto p-2" style={{ maxHeight: getMaxHeightValue(floatingStyle, 256) }}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={!value}
                    className={getOptionClass(!value, tone)}
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{allLabel}</span>
                    {!value ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                  {options.map((option) => {
                    const active = option.value === value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={getOptionClass(active, tone)}
                        onClick={() => {
                          onChange(option.value);
                          setOpen(false);
                        }}
                      >
                        <span className="truncate">{option.label}</span>
                        {active ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              </MenuSurface>
            </div>
          )
        : null}
    </div>
  );
}

export function MagicMultiSelect<Value extends string>({
  selected,
  options,
  onChange,
  allLabel,
  disabled = false,
  tone = 'dark',
  className = ''
}: {
  selected: Value[];
  options: readonly MagicSelectOption<Value>[];
  onChange: (value: Value[]) => void;
  allLabel: string;
  disabled?: boolean;
  tone?: MagicSelectTone;
  className?: string;
}) {
  const { rootRef, menuRef, open, setOpen, floatingStyle, updateFloatingStyle } = useDismissableMenu();
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!open) return;
    updateFloatingStyle(212);
    const onReposition = () => updateFloatingStyle(212);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, updateFloatingStyle]);

  const toggleValue = (value: Value) => {
    onChange(selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <div ref={rootRef} className={['relative', className].join(' ')}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={getTriggerClass(tone, disabled)}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">{buildMultiLabel(allLabel, selected, options)}</span>
        <span className="ml-auto shrink-0 text-xs text-slate-400">{selected.length}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open
        ? renderMenuPortal(
            <div ref={menuRef} style={getPortalMenuStyle(floatingStyle)} className="min-w-[212px]">
              <MenuSurface tone={tone}>
                <div className="p-2.5">
                  <div className="mb-2 flex items-center justify-between px-0.5 text-[11px] text-slate-400">
                    <span>Multi-select</span>
                    <button
                      type="button"
                      disabled={disabled || selected.length === 0}
                      onClick={() => onChange([])}
                      className="magic-select-clear rounded-full border border-white/10 px-2 py-1 text-[12px] font-semibold leading-none text-slate-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Clear
                    </button>
                  </div>
                  <div
                    role="listbox"
                    aria-multiselectable="true"
                    className="magic-select-menu space-y-1 overflow-auto pr-1"
                    style={{ maxHeight: Math.min(Math.max(112, getMaxHeightValue(floatingStyle, 272) - 48), 224) }}
                  >
                    <button type="button" role="option" aria-selected={selected.length === 0} className={getOptionClass(selected.length === 0, tone)} onClick={() => onChange([])}>
                      <span className="inline-flex max-w-[80%] items-center truncate rounded-full border border-lime-400/45 px-2 py-0.5 text-xs font-semibold text-lime-200">{allLabel}</span>
                      {selected.length === 0 ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                    {options.map((option) => {
                      const active = selectedSet.has(option.value);
                      return (
                        <button key={option.value} type="button" role="option" aria-selected={active} className={getOptionClass(active, tone)} onClick={() => toggleValue(option.value)}>
                          <span className={['inline-flex max-w-[80%] items-center truncate rounded-full border px-2 py-0.5 text-xs font-semibold', option.badgeClass ?? 'border-white/20'].join(' ')}>
                            {option.label}
                          </span>
                          {active ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </MenuSurface>
            </div>
          )
        : null}
    </div>
  );
}
