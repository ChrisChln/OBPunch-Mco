import { createPortal } from 'react-dom';
import type { AllowedPosition } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type DailyListNewHireModalProps = {
  open: boolean;
  t: TranslateFn;
  isLocked: boolean;
  allowedPositions: readonly AllowedPosition[];
  dailyListNewHirePosition: AllowedPosition | '';
  setDailyListNewHirePosition: (value: AllowedPosition | '') => void;
  dailyListNewHireShift: 'early' | 'late' | '';
  setDailyListNewHireShift: (value: 'early' | 'late' | '') => void;
  dailyListNewHireCount: number;
  setDailyListNewHireCount: (value: number) => void;
  dailyListNewHireAgency: string;
  setDailyListNewHireAgency: (value: string) => void;
  dailyListNewHireNote: string;
  setDailyListNewHireNote: (value: string) => void;
  clamp: (value: number, min: number, max: number) => number;
  onClose: () => void;
  addDailyListNewHireDemand: () => void | Promise<void>;
};

export default function DailyListNewHireModal({
  open,
  t,
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
  dailyListNewHireNote,
  setDailyListNewHireNote,
  clamp,
  onClose,
  addDailyListNewHireDemand
}: DailyListNewHireModalProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-[0.08em] text-white">{t('新人需求', 'New Hire Demand')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
          >
            {t('关闭', 'Close')}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">{t('岗位', 'Position')}</label>
            <select
              value={dailyListNewHirePosition}
              onChange={(e) => setDailyListNewHirePosition((e.target.value as AllowedPosition | '') ?? '')}
              disabled={isLocked}
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon"
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
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">{t('班次', 'Shift')}</label>
            <select
              value={dailyListNewHireShift}
              onChange={(e) => setDailyListNewHireShift((e.target.value as 'early' | 'late' | '') ?? '')}
              disabled={isLocked}
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon"
            >
              <option value="">{t('选择班次', 'Select shift')}</option>
              <option value="early">{t('早班', 'Morning')}</option>
              <option value="late">{t('晚班', 'Night')}</option>
            </select>
          </div>

          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">{t('需求人数', 'Headcount')}</label>
            <input
              type="number"
              min={1}
              max={200}
              value={dailyListNewHireCount}
              onChange={(e) => setDailyListNewHireCount(clamp(Number(e.target.value) || 1, 1, 200))}
              disabled={isLocked}
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Agency</label>
            <input
              value={dailyListNewHireAgency}
              onChange={(e) => setDailyListNewHireAgency(e.target.value)}
              disabled={isLocked}
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon"
              placeholder="Agency"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">{t('备注', 'Note')}</label>
            <input
              value={dailyListNewHireNote}
              onChange={(e) => setDailyListNewHireNote(e.target.value)}
              disabled={isLocked}
              className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon"
              placeholder={t('新人要求', 'Request for new hire')}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15"
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void addDailyListNewHireDemand()}
            className="rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('确定', 'Confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
