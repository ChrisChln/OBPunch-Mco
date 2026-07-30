import { useEffect, useRef, useState } from 'react';

import { normalizeScheduleShiftTime } from '../scheduleShiftTime';

type ScheduleShiftTimeCellProps = {
  value: unknown;
  canEdit: boolean;
  saving: boolean;
  editing: boolean;
  t: (zh: string, en: string) => string;
  onStartEditing: () => void;
  onStopEditing: () => void;
  onSave: (draft: string) => Promise<boolean>;
};

export default function ScheduleShiftTimeCell({
  value,
  canEdit,
  saving,
  editing,
  t,
  onStartEditing,
  onStopEditing,
  onSave
}: ScheduleShiftTimeCellProps) {
  const normalizedValue = normalizeScheduleShiftTime(value);
  const [draft, setDraft] = useState(normalizedValue);
  const [committing, setCommitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const commitPendingRef = useRef(false);
  const isSaving = saving || committing;

  useEffect(() => {
    if (!editing) setDraft(normalizedValue);
  }, [editing, normalizedValue]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing || canEdit || isSaving) return;
    cancelledRef.current = true;
    setDraft(normalizedValue);
    onStopEditing();
  }, [canEdit, editing, isSaving, normalizedValue, onStopEditing]);

  const commit = async () => {
    if (cancelledRef.current || commitPendingRef.current || saving) return;
    commitPendingRef.current = true;
    setCommitting(true);
    try {
      const saved = await onSave(draft).catch(() => false);
      if (saved) onStopEditing();
    } finally {
      commitPendingRef.current = false;
      setCommitting(false);
    }
  };

  if (!editing) {
    if (!canEdit) {
      return <span className="font-mono tabular-nums">{normalizedValue || '-'}</span>;
    }
    return (
      <button
        type="button"
        aria-label={t('编辑班次时间', 'Edit shift time')}
        onClick={() => {
          cancelledRef.current = false;
          setDraft(normalizedValue);
          onStartEditing();
        }}
        className="inline-flex h-[22px] items-center justify-center rounded-md px-1.5 font-mono tabular-nums transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/60"
      >
        {normalizedValue || '-'}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="time"
      step={60}
      data-magic-field-skip="true"
      value={draft}
      disabled={isSaving}
      aria-label={isSaving ? t('正在保存班次时间', 'Saving shift time') : t('班次时间', 'Shift time')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelledRef.current = true;
          setDraft(normalizedValue);
          onStopEditing();
        }
      }}
      className="h-[22px] w-[72px] rounded-md border border-white/15 bg-slate-950 px-1 font-mono text-[11px] text-slate-100 outline-none focus:border-neon/60 disabled:cursor-wait disabled:opacity-60"
    />
  );
}
