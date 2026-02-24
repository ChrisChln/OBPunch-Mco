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
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('首页看板', 'Home Dashboard')}</h2>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_560px]">
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
                className={['rounded-2xl border px-4 py-4', getHomeCardToneClass(position, schedulePositionToneByPosition)].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3
                    className={[
                      'inline-flex items-center rounded-full border px-2.5 py-1 font-display text-base tracking-[0.06em]',
                      getSchedulePositionBadgeClass(position)
                    ].join(' ')}
                  >
                    {position}
                  </h3>
                  <span className={['rounded-full px-3 py-1 text-xs', getHomeChipToneClass(position, schedulePositionToneByPosition)].join(' ')}>
                    On Clock {stats.active}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className={['rounded-xl px-3 py-2', getHomePanelToneClass(position, schedulePositionToneByPosition)].join(' ')}>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Morning</div>
                    <div className="mt-1 text-sm text-slate-200">Expected {plan.early} · Present {stats.early}</div>
                  </div>
                  <div className={['rounded-xl px-3 py-2', getHomePanelToneClass(position, schedulePositionToneByPosition)].join(' ')}>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Night</div>
                    <div className="mt-1 text-sm text-slate-200">Expected {plan.late} · Present {stats.late}</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <aside className="rounded-2xl border border-white/15 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg tracking-[0.06em]">
              {homeRosterSide === 'absent'
                ? t('缺勤名单', 'Absent List')
                : homeRosterSide === 'restWorked'
                  ? t('排休出勤名单', 'Off Worked List')
                  : t('打卡中名单', 'On Clock List')}
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHomeRosterSide('absent')}
                className={[
                  'rounded-xl px-3 py-1 text-xs font-semibold transition',
                  homeRosterSide === 'absent' ? 'bg-neon text-white' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                ].join(' ')}
              >
                {t('缺勤', 'Absent')}
              </button>
              <button
                type="button"
                onClick={() => setHomeRosterSide('restWorked')}
                className={[
                  'rounded-xl px-3 py-1 text-xs font-semibold transition',
                  homeRosterSide === 'restWorked' ? 'bg-neon text-white' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                ].join(' ')}
              >
                {t('排休出勤', 'Off Worked')}
              </button>
              <button
                type="button"
                onClick={() => setHomeRosterSide('onClock')}
                className={[
                  'rounded-xl px-3 py-1 text-xs font-semibold transition',
                  homeRosterSide === 'onClock' ? 'bg-neon text-white' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                ].join(' ')}
              >
                {t('打卡中', 'On Clock')}
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-6 gap-2">
            {(['ALL', ...allowedPositions] as Array<'ALL' | AllowedPosition>).map((position) => {
              const checked = homeRosterPositionFilter === position;
              return (
                <button
                  key={`home-roster-filter-${position}`}
                  type="button"
                  onClick={() => setHomeRosterPositionFilter(position)}
                  className={[
                    'rounded-xl px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition',
                    checked ? 'bg-neon text-white' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  ].join(' ')}
                >
                  {position}
                </button>
              );
            })}
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-2">
            <div className="grid grid-cols-[56px_1fr_1fr_1fr_74px] gap-2 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-400">
              <span>ID</span>
              <span>{t('姓名', 'Name')}</span>
              <span>Agency</span>
              <span>{t('岗位', 'Position')}</span>
              <span>{t('班次', 'Shift')}</span>
            </div>
            <div className="mt-1 max-h-[560px] space-y-1 overflow-auto pr-1">
              {homeRosterRowsCurrent.map((row) => (
                <div
                  key={`${homeRosterSide}-${row.staff_id}`}
                  className="grid grid-cols-[56px_1fr_1fr_1fr_74px] gap-2 rounded-lg bg-white/5 px-2 py-2 text-sm text-slate-200"
                >
                  <span className="font-mono text-xs">{row.staff_id}</span>
                  <span className="truncate">{row.name || '-'}</span>
                  <span className="truncate">{row.agency || '-'}</span>
                  <span className="truncate">{row.position || '-'}</span>
                  <span className="text-xs text-slate-300">{row.shift}</span>
                </div>
              ))}
              {homeRosterRowsCurrent.length === 0 && <div className="px-2 py-4 text-sm text-slate-400">{t('当前无记录', 'No rows')}</div>}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
