import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import type { EmployeeRow, TerminationType } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type DepartedEmployeesModalProps = {
  open: boolean;
  t: TranslateFn;
  themeMode: 'dark' | 'light';
  rows: EmployeeRow[];
  loading: boolean;
  error: string | null;
  canManageDeparted: boolean;
  canHardDelete: boolean;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  onToggleTerminationType: (staffId: string, nextType: TerminationType) => void | Promise<void>;
  onRehire: (staffId: string) => void | Promise<void>;
  onHardDelete: (staffId: string) => void | Promise<void>;
  displayStaffId: (value: string) => string;
};

const normalizeText = (value: unknown) => String(value ?? '').trim();

const normalizeTerminationType = (value: unknown): TerminationType => {
  const text = normalizeText(value).toLowerCase();
  return text === 'blacklist' ? 'blacklist' : 'normal';
};

const formatDate = (value: unknown) => {
  const text = normalizeText(value);
  if (!text) return '-';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10) || '-';
  return date.toISOString().slice(0, 10);
};

const ROW_HEIGHT = 50;
const OVERSCAN = 10;

export default function DepartedEmployeesModal({
  open,
  t,
  themeMode,
  rows,
  loading,
  error,
  canManageDeparted,
  canHardDelete,
  onClose,
  onRefresh,
  onToggleTerminationType,
  onRehire,
  onHardDelete,
  displayStaffId
}: DepartedEmployeesModalProps) {
  const [search, setSearch] = useState('');
  const [agency, setAgency] = useState('');
  const [position, setPosition] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TerminationType>('all');
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const visibleStartRef = useRef(0);
  const pendingScrollTopRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const [visibleStart, setVisibleStart] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);
  const isLight = themeMode === 'light';

  const agencyOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => normalizeText(row.agency ?? row.Agency)).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [rows]
  );
  const positionOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => normalizeText(row.position ?? row.Position)).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      const rowAgency = normalizeText(row.agency ?? row.Agency);
      const rowPosition = normalizeText(row.position ?? row.Position);
      const rowType = normalizeTerminationType(row.termination_type);
      if (agency && rowAgency !== agency) return false;
      if (position && rowPosition !== position) return false;
      if (typeFilter !== 'all' && rowType !== typeFilter) return false;
      if (!needle) return true;
      const haystack = [
        row.staff_id,
        row.name,
        rowAgency,
        rowPosition,
        rowType === 'blacklist' ? 'blacklist 黑名单' : 'normal 正常离职',
        row.terminated_at
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(' ');
      return haystack.includes(needle);
    });
  }, [agency, position, rows, search, typeFilter]);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const syncHeight = () => setViewportHeight(el.clientHeight || 560);
    syncHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncHeight);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', syncHeight);
    return () => window.removeEventListener('resize', syncHeight);
  }, [open]);

  useEffect(() => {
    visibleStartRef.current = 0;
    setVisibleStart(0);
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  }, [agency, position, search, typeFilter, rows]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const nextStart = Math.max(0, Math.floor(pendingScrollTopRef.current / ROW_HEIGHT) - OVERSCAN);
      if (nextStart === visibleStartRef.current) return;
      visibleStartRef.current = nextStart;
      setVisibleStart(nextStart);
    });
  }, []);

  const visibleMeta = useMemo(() => {
    const total = filteredRows.length;
    const visibleCount = Math.ceil(Math.max(1, viewportHeight) / ROW_HEIGHT) + OVERSCAN * 2;
    const start = Math.min(visibleStart, total);
    const end = Math.min(total, start + visibleCount);
    return {
      start,
      end,
      topSpacerHeight: start * ROW_HEIGHT,
      bottomSpacerHeight: Math.max(0, (total - end) * ROW_HEIGHT)
    };
  }, [filteredRows.length, viewportHeight, visibleStart]);

  const visibleRows = useMemo(
    () => filteredRows.slice(visibleMeta.start, visibleMeta.end),
    [filteredRows, visibleMeta.end, visibleMeta.start]
  );

  if (!open) return null;

  const panelClass = isLight
    ? 'border-slate-200 bg-white text-slate-900 shadow-[0_24px_80px_rgba(15,23,42,0.22)]'
    : 'border-white/10 bg-slate-950 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)]';
  const inputClass = [
    'h-11 rounded-xl border px-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
    isLight
      ? 'border-slate-200 bg-white text-slate-900 focus:border-slate-400'
      : 'border-white/10 bg-black/30 text-white focus:border-neon'
  ].join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
      <div className={['flex max-h-[88vh] w-full max-w-6xl flex-col rounded-2xl border', panelClass].join(' ')}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <h3 className="font-display text-xl tracking-[0.08em]">{t('离职员工', 'Departed')}</h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void onRefresh()} disabled={loading} className="admin-btn admin-btn-toolbar admin-btn-secondary px-4 disabled:opacity-60">
              {t('刷新', 'Refresh')}
            </button>
            <button type="button" onClick={onClose} className="admin-btn admin-btn-toolbar admin-btn-secondary px-4">
              {t('关闭', 'Close')}
            </button>
          </div>
        </div>

        <div className="grid gap-3 px-5 py-4 md:grid-cols-5">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('搜索名字 / USID', 'Search name / USID')}
            className={[inputClass, 'md:col-span-2'].join(' ')}
          />
          <select value={agency} onChange={(event) => setAgency(event.target.value)} className={inputClass}>
            <option value="">{t('全部 Agency', 'All agencies')}</option>
            {agencyOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select value={position} onChange={(event) => setPosition(event.target.value)} className={inputClass}>
            <option value="">{t('全部岗位', 'All positions')}</option>
            {positionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | TerminationType)} className={inputClass}>
            <option value="all">{t('全部类型', 'All types')}</option>
            <option value="normal">{t('正常离职', 'Normal')}</option>
            <option value="blacklist">{t('黑名单', 'Blacklist')}</option>
          </select>
        </div>

        {error ? <div className="px-5 pb-3 text-sm text-ember">{error}</div> : null}

        <div
          ref={tableScrollRef}
          className="min-h-0 flex-1 overflow-auto px-5 pb-5"
          style={{ contain: 'layout paint style' }}
          onScroll={handleScroll}
        >
          <table className="w-full min-w-[900px] table-fixed text-left text-sm">
            <thead className={['sticky top-0 z-10 border-b text-xs uppercase tracking-[0.18em]', isLight ? 'border-slate-200 bg-white text-slate-500' : 'border-white/10 bg-slate-950 text-slate-400'].join(' ')}>
              <tr>
                <th className="w-[130px] px-3 py-3">{t('离职日期', 'Date')}</th>
                <th className="w-[180px] px-3 py-3">{t('名字', 'Name')}</th>
                <th className="w-[150px] px-3 py-3">USID</th>
                <th className="w-[130px] px-3 py-3">Agency</th>
                <th className="w-[130px] px-3 py-3">Position</th>
                <th className="w-[130px] px-3 py-3">{t('类型', 'Type')}</th>
                {canManageDeparted || canHardDelete ? <th className="w-[190px] px-3 py-3 text-right">{t('操作', 'Action')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {visibleMeta.topSpacerHeight > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={canManageDeparted || canHardDelete ? 7 : 6}
                    style={{ height: visibleMeta.topSpacerHeight, padding: 0, border: 0 }}
                  />
                </tr>
              ) : null}
              {visibleRows.map((row) => {
                const staffId = normalizeText(row.staff_id);
                const type = normalizeTerminationType(row.termination_type);
                return (
                  <tr key={`${staffId}:${row.terminated_at}`} className="h-[50px] border-b border-white/5 last:border-0">
                    <td className="px-3 py-3 font-mono">{formatDate(row.terminated_at)}</td>
                    <td className="px-3 py-3">
                      <span className="block truncate" title={normalizeText(row.name) || '-'}>
                        {normalizeText(row.name) || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono">{staffId ? displayStaffId(staffId) : '-'}</td>
                    <td className="px-3 py-3">{normalizeText(row.agency ?? row.Agency) || '-'}</td>
                    <td className="px-3 py-3">{normalizeText(row.position ?? row.Position) || '-'}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        disabled={loading || !staffId || !canManageDeparted}
                        onClick={() => void onToggleTerminationType(staffId, type === 'blacklist' ? 'normal' : 'blacklist')}
                        title={t('点击切换类型', 'Click to switch type')}
                        className={[
                          'inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                          type === 'blacklist'
                            ? 'border-rose-300/35 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20'
                            : 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20'
                        ].join(' ')}
                      >
                        {type === 'blacklist' ? t('黑名单', 'Blacklist') : t('正常离职', 'Normal')}
                      </button>
                    </td>
                    {canManageDeparted || canHardDelete ? (
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          {canManageDeparted ? (
                            <button
                              type="button"
                              disabled={loading || !staffId}
                              onClick={() => void onRehire(staffId)}
                              className="rounded-xl border border-sky-300/25 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t('返聘', 'Rehire')}
                            </button>
                          ) : null}
                          {canHardDelete ? (
                            <button
                              type="button"
                              disabled={loading || !staffId}
                              onClick={() => void onHardDelete(staffId)}
                              className="rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t('彻底删除', 'Delete')}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {visibleMeta.bottomSpacerHeight > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={canManageDeparted || canHardDelete ? 7 : 6}
                    style={{ height: visibleMeta.bottomSpacerHeight, padding: 0, border: 0 }}
                  />
                </tr>
              ) : null}
            </tbody>
          </table>
          {!loading && filteredRows.length === 0 ? (
            <div className="py-8 text-sm text-slate-400">{t('暂无数据', 'No records')}</div>
          ) : null}
          {loading ? <div className="py-8 text-sm text-slate-400">{t('加载中...', 'Loading...')}</div> : null}
        </div>
      </div>
    </div>
  );
}
