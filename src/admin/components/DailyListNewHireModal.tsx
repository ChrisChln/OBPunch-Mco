import { createPortal } from 'react-dom';
type TranslateFn = (zh: string, en: string) => string;

type DailyListNewHireModalProps = {
  open: boolean;
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  isLocked: boolean;
  allowedPositions: readonly string[];
  dailyListNewHirePosition: string;
  setDailyListNewHirePosition: (value: string) => void;
  dailyListNewHireShift: 'early' | 'late' | '';
  setDailyListNewHireShift: (value: 'early' | 'late' | '') => void;
  dailyListNewHireCount: number;
  setDailyListNewHireCount: (value: number) => void;
  dailyListNewHireAgency: string;
  setDailyListNewHireAgency: (value: string) => void;
  dailyListAgencyOptions: string[];
  dailyListNewHireLabel: string;
  setDailyListNewHireLabel: (value: string) => void;
  dailyListLabelOptions: string[];
  dailyListNewHireEntryTime: string;
  setDailyListNewHireEntryTime: (value: string) => void;
  dailyListNewHireNote: string;
  setDailyListNewHireNote: (value: string) => void;
  clamp: (value: number, min: number, max: number) => number;
  onClose: () => void;
  addDailyListNewHireDemand: () => void | Promise<void>;
};

export default function DailyListNewHireModal({
  open,
  t,
  themeMode,
  isLocked,
  allowedPositions,
  dailyListNewHirePosition,
  setDailyListNewHirePosition,
  dailyListNewHireShift,
  setDailyListNewHireShift,
  dailyListNewHireCount,
  setDailyListNewHireCount,
  dailyListNewHireAgency,
  setDailyListNewHireAgency,
  dailyListAgencyOptions,
  dailyListNewHireLabel,
  setDailyListNewHireLabel,
  dailyListLabelOptions,
  dailyListNewHireEntryTime,
  setDailyListNewHireEntryTime,
  dailyListNewHireNote,
  setDailyListNewHireNote,
  clamp,
  onClose,
  addDailyListNewHireDemand
}: DailyListNewHireModalProps) {
  if (!open || typeof document === 'undefined') return null;
  const isLight = themeMode === 'light';
  const overlayClass = isLight ? 'bg-slate-900/35' : 'bg-black/70';
  const panelClass = isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/95 backdrop-blur';
  const titleClass = isLight ? 'text-slate-900' : 'text-white';
  const labelClass = isLight ? 'text-slate-600' : 'text-slate-400';
  const fieldClass = isLight
    ? 'mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
    : 'mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon';
  const closeBtnClass = isLight
    ? 'rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200'
    : 'rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15';
  const cancelBtnClass = isLight
    ? 'rounded-2xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200'
    : 'rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15';
  const confirmBtnClass = isLight
    ? 'rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-slate-900 shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50'
    : 'rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50';
  const isConfirmDisabled =
    isLocked || !dailyListNewHirePosition || !dailyListNewHireShift || !dailyListNewHireEntryTime.trim();

  return createPortal(
    <div className={['fixed inset-0 z-[70] flex items-center justify-center p-4', overlayClass].join(' ')} role="dialog" aria-modal="true">
      <div className={['w-full max-w-xl rounded-3xl border p-6 shadow-2xl', panelClass].join(' ')}>
        <div className="flex items-center justify-between">
          <h3 className={['font-display text-xl tracking-[0.08em]', titleClass].join(' ')}>{t('新人需求', 'New Request')}</h3>
          <button
            type="button"
            onClick={onClose}
            className={closeBtnClass}
          >
            {t('关闭', 'Close')}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('岗位', 'Position')}</label>
            <select
              value={dailyListNewHirePosition}
              onChange={(e) => setDailyListNewHirePosition(e.target.value ?? '')}
              disabled={isLocked}
              className={fieldClass}
            >
              <option value="">{t('选择岗位', 'Select position')}</option>
              {allowedPositions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('班次', 'Shift')}</label>
            <select
              value={dailyListNewHireShift}
              onChange={(e) => setDailyListNewHireShift((e.target.value as 'early' | 'late' | '') ?? '')}
              disabled={isLocked}
              className={fieldClass}
            >
              <option value="">{t('选择班次', 'Select shift')}</option>
              <option value="early">{t('早班', 'Morning')}</option>
              <option value="late">{t('晚班', 'Night')}</option>
            </select>
          </div>

          <div>
            <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('需求人数', 'Headcount')}</label>
            <input
              type="number"
              min={1}
              max={200}
              value={dailyListNewHireCount}
              onChange={(e) => setDailyListNewHireCount(clamp(Number(e.target.value) || 1, 1, 200))}
              disabled={isLocked}
              className={fieldClass}
            />
          </div>

          <div>
            <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>Agency</label>
            <select
              value={dailyListNewHireAgency}
              onChange={(e) => setDailyListNewHireAgency(e.target.value)}
              disabled={isLocked}
              className={fieldClass}
            >
              <option value="">{t('选择中介(可选)', 'Select agency (optional)')}</option>
              {dailyListAgencyOptions.map((agency) => (
                <option key={agency} value={agency}>
                  {agency}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('标签', 'Label')}</label>
            <select
              value={dailyListNewHireLabel}
              onChange={(e) => setDailyListNewHireLabel(e.target.value)}
              disabled={isLocked}
              className={fieldClass}
            >
              <option value="">{t('选择标签', 'Select label')}</option>
              {dailyListLabelOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('入场时间', 'Entry time')}</label>
            <input
              type="time"
              value={dailyListNewHireEntryTime}
              onChange={(e) => setDailyListNewHireEntryTime(e.target.value)}
              disabled={isLocked}
              className={fieldClass}
              placeholder={t('START TIME', 'START TIME')}
            />
          </div>

          <div className="md:col-span-2">
            <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('备注', 'Note')}</label>
            <input
              value={dailyListNewHireNote}
              onChange={(e) => setDailyListNewHireNote(e.target.value)}
              disabled={isLocked}
              className={fieldClass}
              placeholder={t('新人要求', 'Request for new hire')}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={cancelBtnClass}
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={isConfirmDisabled}
            onClick={() => void addDailyListNewHireDemand()}
            className={confirmBtnClass}
          >
            {t('确定', 'Confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
