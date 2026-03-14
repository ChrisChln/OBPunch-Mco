import type { LabelToneKey } from '../../lib/labelTone';
import type { AllowedPosition } from '../types';

type TranslateFn = (zh: string, en: string) => string;
type HomeRosterSide = 'absent' | 'restWorked' | 'onClock';

type HomeRosterRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: string;
};

type HomeDashboardPageProps = {
  t: TranslateFn;
  allowedPositions: readonly AllowedPosition[];
  homeCardStats: Record<string, { early: number; late: number; active: number }>;
  homeExpectedPositionSummaryCards: Array<{ position: string; early: number; late: number; total: number }>;
  getHomeCardToneClass: (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) => string;
  getHomeChipToneClass: (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) => string;
  getHomePanelToneClass: (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) => string;
  getSchedulePositionBadgeClass: (position: string) => string;
  schedulePositionToneByPosition: Partial<Record<AllowedPosition, LabelToneKey>>;
  homeRosterSide: HomeRosterSide;
  setHomeRosterSide: (value: HomeRosterSide) => void;
  homeRosterPositionFilter: 'ALL' | AllowedPosition;
  setHomeRosterPositionFilter: (value: 'ALL' | AllowedPosition) => void;
  homeRosterRowsCurrent: HomeRosterRow[];
};

export default function HomeDashboardPage({
  t,
  allowedPositions,
  homeCardStats,
  homeExpectedPositionSummaryCards,
  getHomeCardToneClass,
  getHomeChipToneClass,
  getHomePanelToneClass,
  getSchedulePositionBadgeClass,
  schedulePositionToneByPosition,
  homeRosterSide,
  setHomeRosterSide,
  homeRosterPositionFilter,
  setHomeRosterPositionFilter,
  homeRosterRowsCurrent
}: HomeDashboardPageProps) {
  return (
    <section className="glass reveal rounded-[34px] border border-white/10 px-6 py-7 md:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-3xl tracking-[0.04em] text-stone-50">
          {t('首页看板', 'Home Dashboard')}
        </h2>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(420px,0.88fr)]">
        <div className="space-y-4">
          {allowedPositions.map((position) => {
            const stats = homeCardStats[position] ?? { early: 0, late: 0, active: 0 };
            const plan = homeExpectedPositionSummaryCards.find((item) => item.position === position) ?? {
              position,
              early: 0,
              late: 0,
              total: 0
            };

            return (
              <article
                key={position}
                className={[
                  'rounded-[28px] border px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
                  getHomeCardToneClass(position, schedulePositionToneByPosition)
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3
                    className={[
                      'inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-semibold tracking-[0.08em]',
                      getSchedulePositionBadgeClass(position)
                    ].join(' ')}
                  >
                    {position}
                  </h3>
                  <span
                    className={[
                      'rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]',
                      getHomeChipToneClass(position, schedulePositionToneByPosition)
                    ].join(' ')}
                  >
                    On Clock {stats.active}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div
                    className={[
                      'rounded-[20px] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
                      getHomePanelToneClass(position, schedulePositionToneByPosition)
                    ].join(' ')}
                  >
                    <div className="text-[11px] uppercase tracking-[0.22em] text-stone-400">Morning</div>
                    <div className="mt-2 text-base text-stone-100">Expected {plan.early} · Present {stats.early}</div>
                  </div>

                  <div
                    className={[
                      'rounded-[20px] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
                      getHomePanelToneClass(position, schedulePositionToneByPosition)
                    ].join(' ')}
                  >
                    <div className="text-[11px] uppercase tracking-[0.22em] text-stone-400">Night</div>
                    <div className="mt-2 text-base text-stone-100">Expected {plan.late} · Present {stats.late}</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-2xl tracking-[0.04em] text-stone-50">
              {homeRosterSide === 'absent'
                ? t('缺勤名单', 'Absent List')
                : homeRosterSide === 'restWorked'
                  ? t('排休出勤名单', 'Off Worked List')
                  : t('打卡中名单', 'On Clock List')}
            </h3>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setHomeRosterSide('absent')}
                className={[
                  'rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition',
                  homeRosterSide === 'absent'
                    ? 'border-stone-200/90 bg-stone-100 text-stone-900'
                    : 'border-white/10 bg-white/[0.04] text-stone-200 hover:border-white/15 hover:bg-white/[0.07]'
                ].join(' ')}
              >
                {t('缺勤', 'Absent')}
              </button>
              <button
                type="button"
                onClick={() => setHomeRosterSide('restWorked')}
                className={[
                  'rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition',
                  homeRosterSide === 'restWorked'
                    ? 'border-stone-200/90 bg-stone-100 text-stone-900'
                    : 'border-white/10 bg-white/[0.04] text-stone-200 hover:border-white/15 hover:bg-white/[0.07]'
                ].join(' ')}
              >
                {t('排休出勤', 'Off Worked')}
              </button>
              <button
                type="button"
                onClick={() => setHomeRosterSide('onClock')}
                className={[
                  'rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition',
                  homeRosterSide === 'onClock'
                    ? 'border-stone-200/90 bg-stone-100 text-stone-900'
                    : 'border-white/10 bg-white/[0.04] text-stone-200 hover:border-white/15 hover:bg-white/[0.07]'
                ].join(' ')}
              >
                {t('打卡中', 'On Clock')}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(['ALL', ...allowedPositions] as Array<'ALL' | AllowedPosition>).map((position) => {
              const checked = homeRosterPositionFilter === position;
              return (
                <button
                  key={`home-roster-filter-${position}`}
                  type="button"
                  onClick={() => setHomeRosterPositionFilter(position)}
                  className={[
                    'rounded-full border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition',
                    checked
                      ? 'border-stone-200/90 bg-stone-100 text-stone-900'
                      : 'border-white/10 bg-white/[0.04] text-stone-200 hover:border-white/15 hover:bg-white/[0.07]'
                  ].join(' ')}
                >
                  {position}
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-[22px] border border-white/8 bg-black/18 p-2.5">
            <div className="grid grid-cols-[72px_1.2fr_0.9fr_0.9fr_74px] gap-2 px-2.5 py-2 text-[11px] uppercase tracking-[0.18em] text-stone-400">
              <span>ID</span>
              <span>{t('姓名', 'Name')}</span>
              <span>Agency</span>
              <span>{t('岗位', 'Position')}</span>
              <span>{t('班次', 'Shift')}</span>
            </div>

            <div className="mt-1.5 max-h-[640px] space-y-1.5 overflow-auto pr-1">
              {homeRosterRowsCurrent.map((row) => (
                <div
                  key={`${homeRosterSide}-${row.staff_id}`}
                  className="grid grid-cols-[72px_1.2fr_0.9fr_0.9fr_74px] gap-2 rounded-[16px] bg-white/[0.05] px-2.5 py-2.5 text-sm text-stone-200"
                >
                  <span className="font-mono text-xs">{row.staff_id}</span>
                  <span className="truncate">{row.name || '-'}</span>
                  <span className="truncate">{row.agency || '-'}</span>
                  <span className="truncate">{row.position || '-'}</span>
                  <span className="text-xs text-stone-300">{row.shift}</span>
                </div>
              ))}

              {homeRosterRowsCurrent.length === 0 && (
                <div className="px-2 py-4 text-sm text-stone-400">{t('当前无记录', 'No rows')}</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
