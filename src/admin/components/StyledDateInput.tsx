import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getIsoWeekday } from '../forecast';

type StyledDateInputProps = {
  value: string;
  onChange: (value: string) => void;
  themeMode?: 'light' | 'dark';
  size?: 'default' | 'compact';
  min?: string;
  max?: string;
  disabled?: boolean;
  title?: string;
};

const isValidDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const toDateOnly = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const getStartOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const formatDateOnlyForDisplay = (value: string) => (isValidDateOnly(value) ? value.replace(/-/g, '/') : 'YYYY/MM/DD');
const getMonthLabel = (date: Date) => `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
const CALENDAR_WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
const buildCalendarDays = (monthDate: Date) => {
  const monthStart = getStartOfMonth(monthDate);
  const gridStart = addDays(monthStart, -(getIsoWeekday(monthStart) - 1));
  return Array.from({ length: 42 }, (_, index) => {
    const day = addDays(gridStart, index);
    return {
      dateOnly: toDateOnly(day),
      dayNumber: day.getDate(),
      isCurrentMonth: day.getMonth() === monthDate.getMonth()
    };
  });
};

export default function StyledDateInput({
  value,
  onChange,
  themeMode = 'dark',
  size = 'default',
  min,
  max,
  disabled = false,
  title
}: StyledDateInputProps) {
  const isLight = themeMode === 'light';
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    if (isValidDateOnly(value)) return getStartOfMonth(new Date(`${value}T00:00:00`));
    return getStartOfMonth(new Date());
  });
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const selectedDateOnly = isValidDateOnly(value) ? value : null;
  const today = toDateOnly(new Date());

  useEffect(() => {
    if (!open || !selectedDateOnly) return;
    // Keep the month synced to the selected value only when the value itself changes
    // or the picker is reopened. Parent re-renders should not snap the calendar back.
    setViewMonth(getStartOfMonth(new Date(`${selectedDateOnly}T00:00:00`)));
  }, [open, selectedDateOnly]);

  useEffect(() => {
    if (!open || disabled) return;

    const updatePanelPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = 264;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const nextLeft = Math.min(Math.max(12, rect.right - panelWidth), viewportWidth - panelWidth - 12);
      const preferredTop = rect.bottom + 8;
      const nextTop = preferredTop + 340 > viewportHeight ? Math.max(12, rect.top - 312) : preferredTop;
      setPanelPosition({ top: nextTop, left: nextLeft });
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    updatePanelPosition();
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, disabled]);

  const monthDays = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);
  const isDateDisabled = (dateOnly: string) => Boolean((min && dateOnly < min) || (max && dateOnly > max));
  const triggerBaseClass =
    size === 'compact'
      ? 'flex h-8 min-w-[130px] items-center justify-between rounded-lg px-2.5 text-[12px] font-medium'
      : 'flex h-10 min-w-[156px] items-center justify-between rounded-2xl px-4 text-sm font-medium';
  const triggerClass = isLight
    ? [
        triggerBaseClass,
        'border border-slate-300 bg-white text-slate-900 shadow-sm transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-lime-300/40 disabled:cursor-not-allowed disabled:opacity-60'
      ].join(' ')
    : [
        triggerBaseClass,
        'border border-white/10 bg-slate-950/75 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-neon/30 disabled:cursor-not-allowed disabled:opacity-60'
      ].join(' ');
  const panelClass = isLight
    ? 'w-[264px] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_20px_40px_rgba(15,23,42,0.18)]'
    : 'w-[264px] rounded-2xl border border-white/10 bg-[#101317]/95 p-3 shadow-[0_24px_48px_rgba(0,0,0,0.5)] backdrop-blur';
  const navButtonClass = isLight
    ? 'flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900'
    : 'flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-white';
  const weekdayClass = isLight ? 'text-slate-400' : 'text-slate-500';
  const mutedDayClass = isLight ? 'text-slate-300' : 'text-slate-600';
  const normalDayClass = isLight ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-100 hover:bg-white/10';
  const selectedDayClass = isLight
    ? 'bg-sky-100 text-sky-900 ring-1 ring-sky-300'
    : 'bg-sky-500/20 text-sky-100 ring-1 ring-sky-400/60';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        onClick={() => setOpen((current) => !current)}
        className={triggerClass}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{formatDateOnlyForDisplay(value)}</span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 opacity-80" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3.5" y="4.5" width="13" height="12" rx="2" />
          <path d="M6.5 2.8v3.4M13.5 2.8v3.4M3.5 7.5h13" />
        </svg>
      </button>
      {open &&
        !disabled &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            className={panelClass}
            style={{ position: 'fixed', top: `${panelPosition.top}px`, left: `${panelPosition.left}px`, zIndex: 140 }}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className={['text-sm font-semibold', isLight ? 'text-slate-900' : 'text-white'].join(' ')}>{getMonthLabel(viewMonth)}</div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setViewMonth((current) => addMonths(current, -1))} className={navButtonClass} aria-label="Previous month">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="m12.5 4.5-5 5 5 5" />
                  </svg>
                </button>
                <button type="button" onClick={() => setViewMonth((current) => addMonths(current, 1))} className={navButtonClass} aria-label="Next month">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="m7.5 4.5 5 5-5 5" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {CALENDAR_WEEKDAY_HEADERS.map((label) => (
                <div key={label} className={['pb-1 text-center text-[11px] font-semibold', weekdayClass].join(' ')}>
                  {label}
                </div>
              ))}
              {monthDays.map((day) => {
                const dayDisabled = isDateDisabled(day.dateOnly);
                const isSelected = day.dateOnly === value;
                return (
                  <button
                    key={day.dateOnly}
                    type="button"
                    disabled={dayDisabled}
                    onClick={() => {
                      onChange(day.dateOnly);
                      setOpen(false);
                    }}
                    className={[
                      'h-8 rounded-xl text-sm transition',
                      dayDisabled ? 'cursor-not-allowed opacity-30' : '',
                      !day.isCurrentMonth ? mutedDayClass : normalDayClass,
                      isSelected ? selectedDayClass : ''
                    ].join(' ')}
                  >
                    {day.dayNumber}
                  </button>
                );
              })}
            </div>
            <div className={['mt-3 flex items-center justify-between border-t pt-3 text-xs', isLight ? 'border-slate-200' : 'border-white/10'].join(' ')}>
              <button
                type="button"
                onClick={() => {
                  if (isDateDisabled(today)) return;
                  setViewMonth(getStartOfMonth(new Date(`${today}T00:00:00`)));
                  onChange(today);
                  setOpen(false);
                }}
                className={isLight ? 'font-medium text-sky-700 hover:text-sky-900' : 'font-medium text-sky-300 hover:text-sky-100'}
              >
                今天
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={isLight ? 'text-slate-500 hover:text-slate-900' : 'text-slate-400 hover:text-white'}
              >
                关闭
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
