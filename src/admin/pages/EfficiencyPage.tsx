import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPortal } from 'react-dom';
import type { ForecastModelRow } from '../forecast';
import { calculateForecast, getIsoWeekday } from '../forecast';

type TranslateFn = (zh: string, en: string) => string;
type ThemeMode = 'light' | 'dark';

type EfficiencyPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  supabase: SupabaseClient | null;
  themeMode: ThemeMode;
  serverTime: Date;
};

type InboundKey =
  | 'oi_pieces'
  | 'oi_packages'
  | 'single_ratio_pcs'
  | 'multi_ratio_pcs'
  | 'single_ratio_pkgs'
  | 'multi_ratio_pkgs'
  | 'multi_pcs_per_pkg'
  | 'single_pkgs'
  | 'single_piece'
  | 'multi_pkgs'
  | 'multi_piece';
type ProcKey = 'pick' | 'consolidation' | 'rebin' | 'waterspider' | 'multi_pack' | 'single_pack' | 'pre_ship';
type LaborKey = 'picking_group' | 'rebin_group' | 'con_group' | 'packing_group' | 'waterspider_group' | 'preship';

type InboundMetric = { key: InboundKey; labelZh: string; labelEn: string; value: string };
type ProcRow = { key: ProcKey; labelZh: string; labelEn: string; uph: string; goal: string; ewh: string; people: string; lead: string };
type LaborRow = { key: LaborKey; labelZh: string; labelEn: string; ds: string; ns: string };
type Payload = {
  orderInboundDs: InboundMetric[];
  orderInboundNs: InboundMetric[];
  areaEfficiencyDs: ProcRow[];
  areaEfficiencyNs: ProcRow[];
  laborRows: LaborRow[];
};
type TemplateRecord = { id: string; name: string; payload: Payload; created_at?: string | null; updated_at?: string | null };
type WeekdayValue = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type HourColumnKey =
  | 'h00' | 'h01' | 'h02' | 'h03' | 'h04' | 'h05' | 'h06' | 'h07' | 'h08' | 'h09' | 'h10' | 'h11'
  | 'h12' | 'h13' | 'h14' | 'h15' | 'h16' | 'h17' | 'h18' | 'h19' | 'h20' | 'h21' | 'h22' | 'h23';
type VolumeHistoryUploadRow = {
  date: string;
  weekday?: number | null;
  last_filled_hour?: number | null;
} & Record<HourColumnKey, number>;
type ForecastManualInputRow = {
  input_date: string;
  weekday: WeekdayValue;
  previous_day_backlog: number;
  full_day_capacity: number;
  yesterday_inflow_00_14: number;
  actual_day_shift_plan?: number | null;
  actual_night_shift_plan?: number | null;
};
type ForecastBridge = {
  inputDate: string;
  cutoffHour: number;
  fullDayForecast: number | null;
  nextDayShiftForecast: number | null;
  dsOiPieces: number | null;
  nsOiPieces: number | null;
};
type ArrangementInput = { ds: string; ns: string };

const TABLE = 'efficiency_templates';
const FORECAST_INPUT_TABLE = 'volume_forecast_daily_inputs';
const HOUR_COLUMNS: HourColumnKey[] = [
  'h00', 'h01', 'h02', 'h03', 'h04', 'h05', 'h06', 'h07', 'h08', 'h09', 'h10', 'h11',
  'h12', 'h13', 'h14', 'h15', 'h16', 'h17', 'h18', 'h19', 'h20', 'h21', 'h22', 'h23'
];

const INBOUND_META: Array<[InboundKey, string, string]> = [
  ['oi_pieces', 'OI Pieces', 'OI Pieces'],
  ['oi_packages', 'OI Packages', 'OI Packages'],
  ['single_ratio_pcs', 'Single Ratio/Pcs', 'Single Ratio/Pcs'],
  ['multi_ratio_pcs', 'Multi Ratio/Pcs', 'Multi Ratio/Pcs'],
  ['single_ratio_pkgs', 'Single Ratio/Pkgs', 'Single Ratio/Pkgs'],
  ['multi_ratio_pkgs', 'Multi Ratio/Pkgs', 'Multi Ratio/Pkgs'],
  ['multi_pcs_per_pkg', 'Multi Pcs/Pkg', 'Multi Pcs/Pkg'],
  ['single_pkgs', 'Single Pkgs', 'Single Pkgs'],
  ['single_piece', 'Single Piece', 'Single Piece'],
  ['multi_pkgs', 'Multi Pkgs', 'Multi Pkgs'],
  ['multi_piece', 'Multi Piece', 'Multi Piece']
];

const PROC_META: Array<[ProcKey, string, string]> = [
  ['pick', 'Pick', 'Pick'],
  ['consolidation', 'Consolidation', 'Consolidation'],
  ['rebin', 'Rebin', 'Rebin'],
  ['waterspider', 'Waterspider', 'Waterspider'],
  ['multi_pack', 'Multi Pack', 'Multi Pack'],
  ['single_pack', 'Single Pack', 'Single Pack'],
  ['pre_ship', 'Pre-ship', 'Pre-ship']
];

const LABOR_META: Array<[LaborKey, string, string]> = [
  ['picking_group', 'Pick', 'Pick'],
  ['rebin_group', 'Rebin', 'Rebin'],
  ['con_group', 'Con', 'Con'],
  ['packing_group', 'Pack', 'Pack'],
  ['waterspider_group', 'Waterspider', 'Waterspider'],
  ['preship', 'Preship', 'Preship']
];

const buildInbound = (values: Partial<Record<InboundKey, string>> = {}): InboundMetric[] =>
  INBOUND_META.map(([key, labelZh, labelEn]) => ({ key, labelZh, labelEn, value: values[key] ?? '' }));

const buildProc = (values: Partial<Record<ProcKey, Partial<Omit<ProcRow, 'key' | 'labelZh' | 'labelEn'>>>> = {}): ProcRow[] =>
  PROC_META.map(([key, labelZh, labelEn]) => ({
    key,
    labelZh,
    labelEn,
    uph: values[key]?.uph ?? '',
    goal: values[key]?.goal ?? '',
    ewh: values[key]?.ewh ?? '',
    people: values[key]?.people ?? '',
    lead: values[key]?.lead ?? ''
  }));

const buildLabor = (values: Partial<Record<LaborKey, Pick<LaborRow, 'ds' | 'ns'>>> = {}): LaborRow[] =>
  LABOR_META.map(([key, labelZh, labelEn]) => ({ key, labelZh, labelEn, ds: values[key]?.ds ?? '', ns: values[key]?.ns ?? '' }));

const defaultPayload = (): Payload => ({
  orderInboundDs: buildInbound(),
  orderInboundNs: buildInbound(),
  areaEfficiencyDs: buildProc({
    pick: { uph: '120', goal: '120', ewh: '7.5', people: '34', lead: '4' },
    consolidation: { uph: '1000', goal: 'N/A', ewh: '7.5', people: '1', lead: '0' },
    rebin: { uph: '400', goal: '400', ewh: '6.5', people: '5', lead: '1' },
    waterspider: { uph: '700', goal: 'N/A', ewh: '7.5', people: '4', lead: '0' },
    multi_pack: { uph: '200', goal: '170', ewh: '6.5', people: '8', lead: '1' },
    single_pack: { uph: '140', goal: '115', ewh: '7.5', people: '18', lead: '2' },
    pre_ship: { uph: '400', goal: '500', ewh: '8', people: '7', lead: '1' }
  }),
  areaEfficiencyNs: buildProc({
    pick: { uph: '120', goal: '113', ewh: '7.5', people: '12', lead: '2' },
    consolidation: { uph: '1000', goal: '938', ewh: '7.5', people: '1', lead: '1' },
    rebin: { uph: '450', goal: '366', ewh: '6.5', people: '2', lead: '1' },
    waterspider: { uph: '700', goal: '656', ewh: '7.5', people: '1', lead: '0' },
    multi_pack: { uph: '200', goal: '163', ewh: '6.5', people: '3', lead: '1' },
    single_pack: { uph: '130', goal: '122', ewh: '7.5', people: '7', lead: '1' },
    pre_ship: { uph: '400', goal: '400', ewh: '8', people: '2', lead: '1' }
  }),
  laborRows: buildLabor({
    picking_group: { ds: '38', ns: '14' },
    rebin_group: { ds: '6', ns: '3' },
    con_group: { ds: '1', ns: '2' },
    packing_group: { ds: '29', ns: '12' },
    waterspider_group: { ds: '4', ns: '1' },
    preship: { ds: '8', ns: '3' }
  })
});

const normalizePayload = (payload: any): Payload => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const inboundMap = (rows: any[]) =>
    Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [String(row?.key ?? ''), String(row?.value ?? '')])) as Partial<Record<InboundKey, string>>;
  const procMap = (rows: any[]) =>
    Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [String(row?.key ?? ''), { uph: String(row?.uph ?? ''), goal: String(row?.goal ?? ''), ewh: String(row?.ewh ?? ''), people: String(row?.people ?? ''), lead: String(row?.lead ?? '') }])) as Partial<Record<ProcKey, Partial<Omit<ProcRow, 'key' | 'labelZh' | 'labelEn'>>>>;
  const laborMap = (rows: any[]) =>
    Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [String(row?.key ?? ''), { ds: String(row?.ds ?? ''), ns: String(row?.ns ?? '') }])) as Partial<Record<LaborKey, Pick<LaborRow, 'ds' | 'ns'>>>;
  return {
    orderInboundDs: buildInbound(inboundMap(source.orderInboundDs)),
    orderInboundNs: buildInbound(inboundMap(source.orderInboundNs)),
    areaEfficiencyDs: buildProc(procMap(source.areaEfficiencyDs)),
    areaEfficiencyNs: buildProc(procMap(source.areaEfficiencyNs)),
    laborRows: buildLabor(laborMap(source.laborRows))
  };
};

const clone = (payload: Payload): Payload => JSON.parse(JSON.stringify(payload));
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
const toNum = (value: string) => {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const toOptionalNum = (value: string) => {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};
const toPercent = (value: string) => {
  const text = String(value ?? '').trim().replace('%', '');
  const n = Number(text);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
};
const calculateCapacity = (uph: string, ewh: string, people: number, lead: string) => {
  const uphValue = toNum(uph);
  const ewhValue = toNum(ewh);
  const leadCount = toNum(lead);
  const operators = Math.max(0, people - leadCount);
  return Math.max(0, Math.round(uphValue * ewhValue * operators));
};
const roundRule = (value: number, mode: 'ceil' | 'floor' | 'round') => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (mode === 'ceil') return Math.ceil(value);
  if (mode === 'floor') return Math.floor(value);
  return Math.round(value);
};

const getInboundValue = (rows: InboundMetric[], key: InboundKey) => rows.find((item) => item.key === key)?.value ?? '';
const getProcRow = (rows: ProcRow[], key: ProcKey) => rows.find((item) => item.key === key);
const calculateCumulativeVolume = (row: Pick<VolumeHistoryUploadRow, HourColumnKey>, cutoffHour: number) =>
  HOUR_COLUMNS.slice(0, Math.max(0, Math.min(24, Math.floor(cutoffHour)))).reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0);
const inferLastFilledHour = (row: Partial<Record<HourColumnKey, number | null | undefined>>) => {
  for (let index = HOUR_COLUMNS.length - 1; index >= 0; index -= 1) {
    const hourKey = HOUR_COLUMNS[index];
    if (Number(row[hourKey] ?? 0) > 0) return index;
  }
  return null;
};
const withInboundPieces = (rows: InboundMetric[], nextPieces: number | null) => {
  if (!Number.isFinite(nextPieces ?? NaN) || nextPieces === null) return rows;
  const totalPieces = Math.max(0, Math.round(nextPieces));
  const basePieces = toNum(getInboundValue(rows, 'oi_pieces'));
  const basePackages = toNum(getInboundValue(rows, 'oi_packages'));
  const singleRatioPcs = toPercent(getInboundValue(rows, 'single_ratio_pcs'));
  const multiRatioPcs = toPercent(getInboundValue(rows, 'multi_ratio_pcs'));
  const singleRatioPkgs = toPercent(getInboundValue(rows, 'single_ratio_pkgs'));
  const multiRatioPkgs = toPercent(getInboundValue(rows, 'multi_ratio_pkgs'));
  const multiPcsPerPkg = toNum(getInboundValue(rows, 'multi_pcs_per_pkg'));
  const packagePerPiece = basePieces > 0 && basePackages > 0 ? basePackages / basePieces : 0;
  const totalPackages = packagePerPiece > 0 ? Math.max(0, Math.round(totalPieces * packagePerPiece)) : basePackages;
  const singlePiece = Math.max(0, Math.round(totalPieces * singleRatioPcs));
  const multiPiece = Math.max(0, Math.round(totalPieces * (multiRatioPcs > 0 ? multiRatioPcs : 1 - singleRatioPcs)));
  const singlePkgs = singleRatioPkgs > 0 ? Math.max(0, Math.round(totalPackages * singleRatioPkgs)) : toNum(getInboundValue(rows, 'single_pkgs'));
  const multiPkgs = multiPcsPerPkg > 0
    ? Math.max(0, Math.round(multiPiece / multiPcsPerPkg))
    : multiRatioPkgs > 0
      ? Math.max(0, Math.round(totalPackages * multiRatioPkgs))
      : toNum(getInboundValue(rows, 'multi_pkgs'));

  const overrideValues: Partial<Record<InboundKey, string>> = {
    oi_pieces: String(totalPieces),
    oi_packages: totalPackages > 0 ? String(totalPackages) : '',
    single_piece: singlePiece > 0 ? String(singlePiece) : '',
    multi_piece: multiPiece > 0 ? String(multiPiece) : '',
    single_pkgs: singlePkgs > 0 ? String(singlePkgs) : '',
    multi_pkgs: multiPkgs > 0 ? String(multiPkgs) : ''
  };

  return rows.map((row) => (overrideValues[row.key] !== undefined ? { ...row, value: overrideValues[row.key] ?? '' } : row));
};

const deriveInboundVolume = (rows: InboundMetric[]) => {
  const totalPieces = toNum(getInboundValue(rows, 'oi_pieces'));
  const totalPackages = toNum(getInboundValue(rows, 'oi_packages'));
  const singleRatioPcs = toPercent(getInboundValue(rows, 'single_ratio_pcs'));
  const multiRatioPcs = toPercent(getInboundValue(rows, 'multi_ratio_pcs'));
  const singleRatioPkgs = toPercent(getInboundValue(rows, 'single_ratio_pkgs'));
  const multiRatioPkgs = toPercent(getInboundValue(rows, 'multi_ratio_pkgs'));
  const multiPcsPerPkg = toNum(getInboundValue(rows, 'multi_pcs_per_pkg'));

  const singlePiece = toNum(getInboundValue(rows, 'single_piece')) || Math.round(totalPieces * singleRatioPcs);
  const multiPiece = toNum(getInboundValue(rows, 'multi_piece')) || Math.round(totalPieces * multiRatioPcs);
  const singlePkgs = toNum(getInboundValue(rows, 'single_pkgs')) || Math.round(totalPackages * singleRatioPkgs);
  const multiPkgs =
    toNum(getInboundValue(rows, 'multi_pkgs')) ||
    Math.round(totalPackages * multiRatioPkgs) ||
    (multiPcsPerPkg > 0 ? Math.round(multiPiece / multiPcsPerPkg) : 0);

  return { totalPieces, totalPackages, singlePiece, multiPiece, singlePkgs, multiPkgs };
};

const calculateRequirement = (
  workload: number,
  uphText: string,
  ewhText: string,
  leadText: string,
  mode: 'ceil' | 'floor' | 'round'
) => {
  const uph = toNum(uphText);
  const ewh = toNum(ewhText);
  const lead = toNum(leadText);
  if (!uph || !ewh || workload <= 0) return lead;
  return roundRule(workload / (uph * ewh), mode) + lead;
};

function SectionCard({
  title,
  subtitle,
  children,
  themeMode,
  className = ''
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  themeMode: ThemeMode;
  className?: string;
}) {
  return (
    <section className={['rounded-[28px] border p-5 shadow-[0_18px_40px_rgba(0,0,0,0.12)]', themeMode === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-[linear-gradient(180deg,rgba(10,18,36,0.95),rgba(4,9,20,0.92))]', className].join(' ')}>
      <div className="mb-4">
        <div className={['text-lg font-semibold tracking-[0.04em]', themeMode === 'light' ? 'text-slate-900' : 'text-white'].join(' ')}>{title}</div>
        {subtitle ? <div className={['mt-1 text-xs leading-5', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{subtitle}</div> : null}
      </div>
      {children}
    </section>
  );
}

function SectionBlock({
  title,
  subtitle,
  children,
  themeMode
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  themeMode: ThemeMode;
}) {
  return (
    <div>
      <div className="mb-4">
        <div className={['text-lg font-semibold tracking-[0.04em]', themeMode === 'light' ? 'text-slate-900' : 'text-white'].join(' ')}>
          {title}
        </div>
        {subtitle ? (
          <div className={['mt-1 text-xs leading-5', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export default function EfficiencyPage({ t, isLocked, supabase, themeMode, serverTime }: EfficiencyPageProps) {
  const isLight = themeMode === 'light';
  const shellClass = isLight ? 'border border-slate-200 bg-white' : 'border border-white/10 bg-black/20';
  const inputClass = isLight
    ? 'h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:shadow-[0_0_0_3px_rgba(6,182,212,0.12)]'
    : 'h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.12)]';
  const primaryBtn = isLight
    ? 'rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60'
    : 'rounded-xl border border-cyan-400/40 bg-cyan-400/15 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-400/22 disabled:cursor-not-allowed disabled:opacity-60';
  const secondaryBtn = isLight
    ? 'rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60'
    : 'rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60';
  const labelClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const headClass = isLight ? 'bg-slate-100/80 text-slate-600' : 'bg-slate-950/95 text-slate-400';
  const rowClass = isLight ? 'border-t border-slate-100 text-slate-800' : 'border-t border-white/5 text-slate-200';

  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftPayload, setDraftPayload] = useState<Payload>(defaultPayload());
  const [newTemplateName, setNewTemplateName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [parameterDialogOpen, setParameterDialogOpen] = useState(false);
  const [forecastBridge, setForecastBridge] = useState<ForecastBridge | null>(null);
  const [selectedPlanningDate, setSelectedPlanningDate] = useState(() => toDateOnly(addDays(serverTime, 1)));
  const [arrangementInput, setArrangementInput] = useState<ArrangementInput>({ ds: '', ns: '' });

  const loadTemplates = async () => {
    if (!supabase) {
      setError('Missing Supabase configuration.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await supabase.from(TABLE).select('*').order('updated_at', { ascending: false });
    if (res.error) {
      setLoading(false);
      setTemplates([]);
      setSelectedTemplateId('');
      setDraftName(t('默认模板', 'Default template'));
      setDraftPayload(defaultPayload());
      setError(/efficiency_templates/i.test(String(res.error.message ?? ''))
        ? t('人效模板表不可用，请先运行 SQL。', 'Efficiency template table is unavailable. Run the SQL first.')
        : String(res.error.message ?? 'Load failed.'));
      return;
    }
    const rows = (((res.data as any[] | null) ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      payload: normalizePayload(row.payload),
      created_at: row.created_at ? String(row.created_at) : null,
      updated_at: row.updated_at ? String(row.updated_at) : null
    })) as TemplateRecord[]);
    if (rows.length === 0) {
      setTemplates([]);
      setSelectedTemplateId('');
      setDraftName(t('默认模板', 'Default template'));
      setDraftPayload(defaultPayload());
      setLoading(false);
      return;
    }
    const selected = rows.find((item) => item.id === selectedTemplateId) ?? rows[0];
    setTemplates(rows);
    setSelectedTemplateId(selected.id);
    setDraftName(selected.name);
    setDraftPayload(clone(selected.payload));
    setLoading(false);
  };

  useEffect(() => {
    void loadTemplates();
  }, [supabase]);

  useEffect(() => {
    const loadForecastBridge = async () => {
      if (!supabase) {
        setForecastBridge(null);
        return;
      }

      const planningDate = selectedPlanningDate;
      const forecastSourceDate = toDateOnly(addDays(new Date(`${planningDate}T00:00:00`), -1));
      const previousDate = toDateOnly(addDays(new Date(`${forecastSourceDate}T00:00:00`), -1));
      const weekday = getIsoWeekday(new Date(`${forecastSourceDate}T00:00:00`)) as WeekdayValue;
      const selectColumns = ['date', 'last_filled_hour', ...HOUR_COLUMNS].join(',');
      let historyRes = await supabase
        .from('volume_history')
        .select(selectColumns)
        .eq('date', forecastSourceDate)
        .limit(1);

      let latestHistoryRow = (((historyRes.data as VolumeHistoryUploadRow[] | null) ?? [])[0] ?? null) as VolumeHistoryUploadRow | null;
      if (historyRes.error) {
        const fallbackColumns = ['date', ...HOUR_COLUMNS].join(',');
        historyRes = await supabase
          .from('volume_history')
          .select(fallbackColumns)
          .eq('date', forecastSourceDate)
          .limit(1);
        latestHistoryRow = (((historyRes.data as VolumeHistoryUploadRow[] | null) ?? [])[0] ?? null) as VolumeHistoryUploadRow | null;
      }

      if (historyRes.error || !latestHistoryRow?.date) {
        setForecastBridge(null);
        return;
      }

      const rawLastFilledHour =
        latestHistoryRow.last_filled_hour === null || latestHistoryRow.last_filled_hour === undefined
          ? inferLastFilledHour(latestHistoryRow)
          : Number(latestHistoryRow.last_filled_hour);
      const cutoffHour = rawLastFilledHour !== null && rawLastFilledHour >= 11 ? 12 : null;
      if (!cutoffHour) {
        setForecastBridge(null);
        return;
      }

      const modelRes = await supabase.rpc('get_forecasting_model', { p_lookback_days: null });
      if (modelRes.error) {
        setForecastBridge(null);
        return;
      }

      const modelRows = (((modelRes.data as ForecastModelRow[] | null) ?? []) as ForecastModelRow[]).map((row) => ({
        ...row,
        weekday: Number(row.weekday ?? 0),
        hour_of_day: Number(row.hour_of_day ?? 0),
        avg_share: Number(row.avg_share ?? 0),
        stddev_share: Number(row.stddev_share ?? 0),
        sample_size: Number(row.sample_size ?? 0)
      }));
      const coefficient = modelRows.find((row) => row.weekday === weekday && row.hour_of_day === cutoffHour) ?? null;
      const currentCumVolume = calculateCumulativeVolume(latestHistoryRow as Pick<VolumeHistoryUploadRow, HourColumnKey>, cutoffHour);
      const fullDayForecastRaw = calculateForecast(currentCumVolume, cutoffHour, weekday, coefficient).forecast;
      const fullDayForecast = fullDayForecastRaw === null ? null : Math.round(fullDayForecastRaw);

      const inputRes = await supabase
        .from(FORECAST_INPUT_TABLE)
        .select('input_date,weekday,previous_day_backlog,full_day_capacity,yesterday_inflow_00_14,actual_day_shift_plan,actual_night_shift_plan')
        .in('input_date', [planningDate, forecastSourceDate, previousDate]);
      if (inputRes.error) {
        setForecastBridge({
          inputDate: planningDate,
          cutoffHour,
          fullDayForecast,
          nextDayShiftForecast: null,
          dsOiPieces: null,
          nsOiPieces: null
        });
        setArrangementInput({ ds: '', ns: '' });
        return;
      }

      const inputRows = (((inputRes.data as ForecastManualInputRow[] | null) ?? []) as ForecastManualInputRow[]).map((row) => ({
        input_date: String((row as any).input_date ?? ''),
        weekday: Number((row as any).weekday ?? 0) as WeekdayValue,
        previous_day_backlog: Number((row as any).previous_day_backlog ?? 0),
        full_day_capacity: Number((row as any).full_day_capacity ?? 0),
        yesterday_inflow_00_14: Number((row as any).yesterday_inflow_00_14 ?? 0),
        actual_day_shift_plan: (row as any).actual_day_shift_plan == null ? null : Number((row as any).actual_day_shift_plan),
        actual_night_shift_plan: (row as any).actual_night_shift_plan == null ? null : Number((row as any).actual_night_shift_plan)
      }));
      const previousDayRow = inputRows.find((row) => row.input_date === previousDate) ?? null;
      const planningRow = inputRows.find((row) => row.input_date === planningDate) ?? null;
      const nextDayShiftForecast =
        previousDayRow && fullDayForecast !== null
          ? Math.round(
              Number(previousDayRow.previous_day_backlog ?? 0) +
              Number(fullDayForecast ?? 0) -
              Number(previousDayRow.full_day_capacity ?? 0) +
              Number(previousDayRow.yesterday_inflow_00_14 ?? 0) -
              2000
            )
          : null;
      const dsOiPieces = nextDayShiftForecast;
      const nsOiPieces = fullDayForecast !== null && nextDayShiftForecast !== null ? Math.max(0, fullDayForecast - nextDayShiftForecast) : null;

      setForecastBridge({
        inputDate: planningDate,
        cutoffHour,
        fullDayForecast,
        nextDayShiftForecast,
        dsOiPieces,
        nsOiPieces
      });
      setArrangementInput({
        ds:
          planningRow?.actual_day_shift_plan != null
            ? String(planningRow.actual_day_shift_plan)
            : dsOiPieces != null
              ? String(dsOiPieces)
              : '',
        ns:
          planningRow?.actual_night_shift_plan != null
            ? String(planningRow.actual_night_shift_plan)
            : nsOiPieces != null
              ? String(nsOiPieces)
              : ''
      });
    };

    void loadForecastBridge();
  }, [selectedPlanningDate, supabase]);

  const effectiveOrderInboundDs = useMemo(
    () => withInboundPieces(draftPayload.orderInboundDs, forecastBridge?.dsOiPieces ?? null),
    [draftPayload.orderInboundDs, forecastBridge?.dsOiPieces]
  );
  const effectiveOrderInboundNs = useMemo(
    () => withInboundPieces(draftPayload.orderInboundNs, forecastBridge?.nsOiPieces ?? null),
    [draftPayload.orderInboundNs, forecastBridge?.nsOiPieces]
  );
  const arrangedOrderInboundDs = useMemo(
    () => withInboundPieces(draftPayload.orderInboundDs, toOptionalNum(arrangementInput.ds)),
    [draftPayload.orderInboundDs, arrangementInput.ds]
  );
  const arrangedOrderInboundNs = useMemo(
    () => withInboundPieces(draftPayload.orderInboundNs, toOptionalNum(arrangementInput.ns)),
    [draftPayload.orderInboundNs, arrangementInput.ns]
  );

  const recommendedLabor = useMemo(() => {
    const buildSide = (inboundRows: InboundMetric[], procRows: ProcRow[]) => {
      const inbound = deriveInboundVolume(inboundRows);
      const pick = getProcRow(procRows, 'pick');
      const consolidation = getProcRow(procRows, 'consolidation');
      const rebin = getProcRow(procRows, 'rebin');
      const waterspider = getProcRow(procRows, 'waterspider');
      const multiPack = getProcRow(procRows, 'multi_pack');
      const singlePack = getProcRow(procRows, 'single_pack');
      const preship = getProcRow(procRows, 'pre_ship');

      const pickCount = pick ? calculateRequirement(inbound.totalPieces, pick.uph, pick.ewh, pick.lead, 'ceil') : 0;
      const rebinCount = rebin ? calculateRequirement(inbound.multiPiece, rebin.uph, rebin.ewh, rebin.lead, 'ceil') : 0;
      const consolidationCount = consolidation ? Math.max(1, calculateRequirement(inbound.multiPkgs, consolidation.uph, consolidation.ewh, consolidation.lead, 'ceil')) : 0;
      const singlePackCount = singlePack ? calculateRequirement(inbound.singlePiece, singlePack.uph, singlePack.ewh, singlePack.lead, 'round') : 0;
      const multiPackCount = multiPack ? calculateRequirement(inbound.multiPiece, multiPack.uph, multiPack.ewh, multiPack.lead, 'round') : 0;
      const waterspiderCount = waterspider ? calculateRequirement(inbound.totalPackages, waterspider.uph, waterspider.ewh, waterspider.lead, 'floor') : 0;
      const preshipCount = preship ? calculateRequirement(inbound.totalPackages, preship.uph, preship.ewh, preship.lead, 'round') : 0;

      const values: Record<LaborKey, number> = {
        picking_group: pickCount,
        rebin_group: rebinCount,
        con_group: consolidationCount,
        packing_group: singlePackCount + multiPackCount,
        waterspider_group: waterspiderCount,
        preship: preshipCount
      };

      const capacity: Record<LaborKey, number> = {
        picking_group: pick ? calculateCapacity(pick.uph, pick.ewh, pickCount, pick.lead) : 0,
        rebin_group: rebin ? calculateCapacity(rebin.uph, rebin.ewh, rebinCount, rebin.lead) : 0,
        con_group: consolidation ? calculateCapacity(consolidation.uph, consolidation.ewh, consolidationCount, consolidation.lead) : 0,
        packing_group:
          (singlePack ? calculateCapacity(singlePack.uph, singlePack.ewh, singlePackCount, singlePack.lead) : 0) +
          (multiPack ? calculateCapacity(multiPack.uph, multiPack.ewh, multiPackCount, multiPack.lead) : 0),
        waterspider_group: waterspider ? calculateCapacity(waterspider.uph, waterspider.ewh, waterspiderCount, waterspider.lead) : 0,
        preship: preship ? calculateCapacity(preship.uph, preship.ewh, preshipCount, preship.lead) : 0
      };

      return { inbound, values, capacity };
    };

    const ds = buildSide(effectiveOrderInboundDs, draftPayload.areaEfficiencyDs);
    const ns = buildSide(effectiveOrderInboundNs, draftPayload.areaEfficiencyNs);
    const rows = LABOR_META.map(([key, labelZh, labelEn]) => ({
      key,
      labelZh,
      labelEn,
      ds: ds.values[key],
      ns: ns.values[key],
      dsCapacity: ds.capacity[key],
      nsCapacity: ns.capacity[key],
      total: ds.values[key] + ns.values[key]
    }));

    return {
      rows,
      totalDs: rows.reduce((sum, row) => sum + row.ds, 0),
      totalNs: rows.reduce((sum, row) => sum + row.ns, 0),
      totalDsCapacity: rows.reduce((sum, row) => sum + row.dsCapacity, 0),
      totalNsCapacity: rows.reduce((sum, row) => sum + row.nsCapacity, 0)
    };
  }, [draftPayload, effectiveOrderInboundDs, effectiveOrderInboundNs]);

  const finalLabor = useMemo(() => {
    const buildSide = (inboundRows: InboundMetric[], procRows: ProcRow[]) => {
      const inbound = deriveInboundVolume(inboundRows);
      const pick = getProcRow(procRows, 'pick');
      const consolidation = getProcRow(procRows, 'consolidation');
      const rebin = getProcRow(procRows, 'rebin');
      const waterspider = getProcRow(procRows, 'waterspider');
      const multiPack = getProcRow(procRows, 'multi_pack');
      const singlePack = getProcRow(procRows, 'single_pack');
      const preship = getProcRow(procRows, 'pre_ship');

      const pickCount = pick ? calculateRequirement(inbound.totalPieces, pick.uph, pick.ewh, pick.lead, 'ceil') : 0;
      const rebinCount = rebin ? calculateRequirement(inbound.multiPiece, rebin.uph, rebin.ewh, rebin.lead, 'ceil') : 0;
      const consolidationCount = consolidation ? Math.max(1, calculateRequirement(inbound.multiPkgs, consolidation.uph, consolidation.ewh, consolidation.lead, 'ceil')) : 0;
      const singlePackCount = singlePack ? calculateRequirement(inbound.singlePiece, singlePack.uph, singlePack.ewh, singlePack.lead, 'round') : 0;
      const multiPackCount = multiPack ? calculateRequirement(inbound.multiPiece, multiPack.uph, multiPack.ewh, multiPack.lead, 'round') : 0;
      const waterspiderCount = waterspider ? calculateRequirement(inbound.totalPackages, waterspider.uph, waterspider.ewh, waterspider.lead, 'floor') : 0;
      const preshipCount = preship ? calculateRequirement(inbound.totalPackages, preship.uph, preship.ewh, preship.lead, 'round') : 0;

      const values: Record<LaborKey, number> = {
        picking_group: pickCount,
        rebin_group: rebinCount,
        con_group: consolidationCount,
        packing_group: singlePackCount + multiPackCount,
        waterspider_group: waterspiderCount,
        preship: preshipCount
      };

      const capacity: Record<LaborKey, number> = {
        picking_group: pick ? calculateCapacity(pick.uph, pick.ewh, pickCount, pick.lead) : 0,
        rebin_group: rebin ? calculateCapacity(rebin.uph, rebin.ewh, rebinCount, rebin.lead) : 0,
        con_group: consolidation ? calculateCapacity(consolidation.uph, consolidation.ewh, consolidationCount, consolidation.lead) : 0,
        packing_group:
          (singlePack ? calculateCapacity(singlePack.uph, singlePack.ewh, singlePackCount, singlePack.lead) : 0) +
          (multiPack ? calculateCapacity(multiPack.uph, multiPack.ewh, multiPackCount, multiPack.lead) : 0),
        waterspider_group: waterspider ? calculateCapacity(waterspider.uph, waterspider.ewh, waterspiderCount, waterspider.lead) : 0,
        preship: preship ? calculateCapacity(preship.uph, preship.ewh, preshipCount, preship.lead) : 0
      };

      return { values, capacity };
    };

    const ds = buildSide(arrangedOrderInboundDs, draftPayload.areaEfficiencyDs);
    const ns = buildSide(arrangedOrderInboundNs, draftPayload.areaEfficiencyNs);
    const rows = LABOR_META.map(([key, labelZh, labelEn]) => ({
      key,
      labelZh,
      labelEn,
      ds: ds.values[key],
      ns: ns.values[key],
      dsCapacity: ds.capacity[key],
      nsCapacity: ns.capacity[key],
      total: ds.values[key] + ns.values[key]
    }));

    return {
      rows,
      totalDs: rows.reduce((sum, row) => sum + row.ds, 0),
      totalNs: rows.reduce((sum, row) => sum + row.ns, 0),
      totalDsCapacity: rows.reduce((sum, row) => sum + row.dsCapacity, 0),
      totalNsCapacity: rows.reduce((sum, row) => sum + row.nsCapacity, 0)
    };
  }, [draftPayload, arrangedOrderInboundDs, arrangedOrderInboundNs]);

  const summary = useMemo(() => {
    const getVal = (rows: InboundMetric[], key: InboundKey) => rows.find((item) => item.key === key)?.value ?? '';
    return {
      dsPieces: getVal(effectiveOrderInboundDs, 'oi_pieces') || '-',
      nsPieces: getVal(effectiveOrderInboundNs, 'oi_pieces') || '-',
      arrangedDsPieces: arrangementInput.ds || '-',
      arrangedNsPieces: arrangementInput.ns || '-'
    };
  }, [effectiveOrderInboundDs, effectiveOrderInboundNs, arrangementInput.ds, arrangementInput.ns]);

  const inboundSections: Array<{
    title: string;
    subtitle: string;
    rows: InboundMetric[];
    section: 'orderInboundDs' | 'orderInboundNs';
  }> = [
    { title: 'ToC Order Inbound DS', subtitle: '日班入库拆分参数', rows: draftPayload.orderInboundDs, section: 'orderInboundDs' },
    { title: 'ToC Order Inbound NS', subtitle: '夜班入库拆分参数', rows: draftPayload.orderInboundNs, section: 'orderInboundNs' }
  ];

  const efficiencySections: Array<{
    title: string;
    subtitle: string;
    rows: ProcRow[];
    section: 'areaEfficiencyDs' | 'areaEfficiencyNs';
  }> = [
    { title: 'ToC Area Efficiency DS', subtitle: '日班工序效率与编制', rows: draftPayload.areaEfficiencyDs, section: 'areaEfficiencyDs' },
    { title: 'ToC Area Efficiency NS', subtitle: '夜班工序效率与编制', rows: draftPayload.areaEfficiencyNs, section: 'areaEfficiencyNs' }
  ];

  void inboundSections;
  void efficiencySections;

  const selectTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const hit = templates.find((item) => item.id === id);
    if (!hit) return;
    setDraftName(hit.name);
    setDraftPayload(clone(hit.payload));
    setError(null);
    setMessage(null);
  };

  const updateInbound = (section: 'orderInboundDs' | 'orderInboundNs', key: InboundKey, value: string) =>
    setDraftPayload((prev) => ({ ...prev, [section]: prev[section].map((item) => (item.key === key ? { ...item, value } : item)) }));

  const updateProc = (
    section: 'areaEfficiencyDs' | 'areaEfficiencyNs',
    key: ProcKey,
    field: keyof Pick<ProcRow, 'uph' | 'goal' | 'ewh' | 'people' | 'lead'>,
    value: string
  ) =>
    setDraftPayload((prev) => ({ ...prev, [section]: prev[section].map((item) => (item.key === key ? { ...item, [field]: value } : item)) }));

  const persistArrangementInput = async (nextValue: ArrangementInput) => {
    if (!supabase || isLocked) return;
    const ds = toOptionalNum(nextValue.ds);
    const ns = toOptionalNum(nextValue.ns);
    const res = await supabase.from(FORECAST_INPUT_TABLE).upsert(
      {
        input_date: selectedPlanningDate,
        actual_day_shift_plan: ds,
        actual_night_shift_plan: ns
      },
      { onConflict: 'input_date' }
    );
    if (res.error) {
      setError(String(res.error.message ?? 'Save failed.'));
      return;
    }
    setMessage(t('实际产能安排已保存。', 'Actual staffing plan saved.'));
  };

  const saveTemplate = async (mode: 'update' | 'create') => {
    if (!supabase) {
      setError('Missing Supabase configuration.');
      return;
    }
    const name = (mode === 'create' ? newTemplateName : draftName).trim();
    if (!name) {
      setError(t('请输入模板名称。', 'Please enter a template name.'));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    const payload = { name, payload: draftPayload };
    const res = mode === 'create' || !selectedTemplateId
      ? await supabase.from(TABLE).insert(payload).select('*').single()
      : await supabase.from(TABLE).update(payload).eq('id', selectedTemplateId).select('*').single();
    if (res.error) {
      setSaving(false);
      setError(String(res.error.message ?? 'Save failed.'));
      return;
    }
    const saved: TemplateRecord = {
      id: String((res.data as any).id),
      name: String((res.data as any).name ?? ''),
      payload: normalizePayload((res.data as any).payload),
      created_at: (res.data as any).created_at ? String((res.data as any).created_at) : null,
      updated_at: (res.data as any).updated_at ? String((res.data as any).updated_at) : null
    };
    setTemplates((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
    setSelectedTemplateId(saved.id);
    setDraftName(saved.name);
    setDraftPayload(clone(saved.payload));
    setNewTemplateName('');
    setSaving(false);
    setMessage(mode === 'create' || !selectedTemplateId ? t('模板已创建。', 'Template created.') : t('模板已保存。', 'Template saved.'));
  };

  return (
    <section className="glass reveal rounded-3xl px-6 py-6">
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="grid h-full gap-4">
          <h2 className={['font-display text-3xl tracking-[0.06em]', isLight ? 'text-slate-900' : 'text-white'].join(' ')}>
            {t('人效', 'Efficiency')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { title: t('白班预测', 'Day shift forecast'), value: summary.dsPieces, tone: isLight ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200' },
              { title: t('夜班预测', 'Night shift forecast'), value: summary.nsPieces, tone: isLight ? 'border-cyan-200 bg-cyan-50 text-cyan-900' : 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200' }
            ].map((card) => (
              <div key={card.title} className={['rounded-[26px] border px-5 py-4 shadow-[0_12px_30px_rgba(0,0,0,0.12)]', card.tone].join(' ')}>
                <div className="text-[11px] uppercase tracking-[0.24em] opacity-80">{card.title}</div>
                <div className="mt-3 text-3xl font-semibold tracking-[0.04em]">{card.value}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                key: 'ds',
                title: t('实际白班安排', 'Actual day shift plan'),
                value: arrangementInput.ds,
                tone: isLight ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-amber-400/20 bg-amber-500/10 text-amber-200'
              },
              {
                key: 'ns',
                title: t('实际夜班安排', 'Actual night shift plan'),
                value: arrangementInput.ns,
                tone: isLight ? 'border-violet-200 bg-violet-50 text-violet-900' : 'border-violet-400/20 bg-violet-500/10 text-violet-200'
              }
            ].map((card) => (
              <div key={card.key} className={['rounded-[26px] border px-5 py-4 shadow-[0_12px_30px_rgba(0,0,0,0.12)]', card.tone].join(' ')}>
                <div className="text-[11px] uppercase tracking-[0.24em] opacity-80">{card.title}</div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={card.value}
                  onChange={(e) =>
                    setArrangementInput((prev) => ({
                      ...prev,
                      [card.key]: e.target.value.replace(/[^\d]/g, '')
                    }))
                  }
                  onBlur={() => void persistArrangementInput(arrangementInput)}
                  disabled={isLocked}
                  style={{
                    backgroundColor: 'transparent',
                    boxShadow: 'none',
                    WebkitAppearance: 'none',
                    appearance: 'none'
                  }}
                  className={[
                    'arrangement-input-plain mt-3 h-12 w-full appearance-none rounded-none border-0 !bg-transparent px-0 text-2xl font-semibold tracking-[0.04em] !shadow-none outline-none transition',
                    isLight
                      ? 'text-slate-900 focus:ring-0'
                      : 'text-white focus:ring-0'
                  ].join(' ')}
                />
              </div>
            ))}
          </div>
        </div>

        <div className={['flex h-full flex-col rounded-[28px] border p-5 shadow-[0_18px_40px_rgba(0,0,0,0.12)]', isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-[linear-gradient(180deg,rgba(10,18,36,0.95),rgba(4,9,20,0.92))]'].join(' ')}>
          <div className="flex h-full flex-col justify-between gap-6">
            <div className="flex-1 min-w-[280px]">
              <div className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('当前模板', 'Current template')}</div>
              <div className={['mt-2 text-xl font-semibold', isLight ? 'text-slate-900' : 'text-white'].join(' ')}>
                {draftName || t('默认模板', 'Default template')}
              </div>
              <div className={['mt-2 text-sm', labelClass].join(' ')}>
                {templates.length > 0 ? t(`已保存 ${templates.length} 个模板`, `${templates.length} templates saved`) : t('当前还是未保存草稿', 'Currently an unsaved draft')}
              </div>
              <div className="mt-6 flex flex-wrap items-end gap-3">
                <div className="min-w-[220px]">
                  <div className={['mb-2 text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>
                    {t('计划日期', 'Planning date')}
                  </div>
                  <input
                    type="date"
                    value={selectedPlanningDate}
                    onChange={(e) => setSelectedPlanningDate(e.target.value)}
                    disabled={isLocked || loading}
                    className={inputClass}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPlanningDate(toDateOnly(addDays(new Date(`${selectedPlanningDate}T00:00:00`), -1)))}
                  disabled={isLocked || loading}
                  className={secondaryBtn}
                >
                  {t('前一天', 'Previous day')}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPlanningDate(toDateOnly(addDays(new Date(`${selectedPlanningDate}T00:00:00`), 1)))}
                  disabled={isLocked || loading}
                  className={secondaryBtn}
                >
                  {t('后一天', 'Next day')}
                </button>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={isLocked || loading}
                onClick={() => setParameterDialogOpen(true)}
                className={[primaryBtn, 'min-w-[168px]'].join(' ')}
              >
                {t('调整参数', 'Adjust parameters')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error ? <div className={['mt-5 rounded-2xl border px-4 py-3 text-sm', isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'].join(' ')}>{error}</div> : null}
      {message ? <div className={['mt-5 rounded-2xl border px-4 py-3 text-sm', isLight ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'].join(' ')}>{message}</div> : null}

      <div className="mt-6 grid gap-4 xl:gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <SectionCard title={t('参数概览', 'Parameter snapshot')} themeMode={themeMode}>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { title: 'ToC Order Inbound DS', lines: arrangedOrderInboundDs.slice(0, 4) },
                { title: 'ToC Order Inbound NS', lines: arrangedOrderInboundNs.slice(0, 4) },
                { title: 'ToC Area Efficiency DS', lines: draftPayload.areaEfficiencyDs.slice(0, 4).map((row) => ({ labelZh: row.labelZh, labelEn: row.labelEn, value: `${row.uph}/${row.people}` })) },
                { title: 'ToC Area Efficiency NS', lines: draftPayload.areaEfficiencyNs.slice(0, 4).map((row) => ({ labelZh: row.labelZh, labelEn: row.labelEn, value: `${row.uph}/${row.people}` })) }
              ].map((group) => (
                <div key={group.title} className={['rounded-2xl border p-3', isLight ? 'border-slate-200 bg-slate-50/80' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
                  <div className={['text-sm font-semibold', isLight ? 'text-slate-900' : 'text-white'].join(' ')}>{group.title}</div>
                  <div className="mt-2.5 space-y-1.5">
                    {group.lines.map((item: any) => (
                      <div key={item.labelEn} className="flex items-center gap-2 text-[13px]">
                        <span className={labelClass}>{t(item.labelZh, item.labelEn)}</span>
                        <span className={['tabular-nums', isLight ? 'text-slate-900' : 'text-slate-100'].join(' ')}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-3 xl:grid-cols-[max-content_max-content] xl:justify-start xl:self-start">
          <div className="grid gap-4">
            <SectionCard title={t('推荐 ToC Labor', 'Recommended ToC Labor')} themeMode={themeMode} className="w-fit max-w-full p-4">
              <div className="overflow-x-auto rounded-2xl border border-white/5 px-2">
                <table className={['w-max text-left text-xs', shellClass].join(' ')}>
                  <thead className={headClass}>
                    <tr>
                      <th className="whitespace-nowrap px-1.5 py-2.5">{t('Area', 'Area')}</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">{t('Total', 'Total')}</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">DS</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">NS</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">{t('白班预计产能', 'DS Capacity')}</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">{t('夜班预计产能', 'NS Capacity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendedLabor.rows.map((row) => (
                      <tr key={`recommended-${row.key}`} className={rowClass}>
                        <td className="whitespace-nowrap px-1.5 py-2.5 font-medium" title={t(row.labelZh, row.labelEn)}>{t(row.labelZh, row.labelEn)}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.total}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.ds}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.ns}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.dsCapacity}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.nsCapacity}</td>
                      </tr>
                    ))}
                    <tr className={rowClass}>
                      <td className="whitespace-nowrap px-1.5 py-2.5 font-semibold">{t('Total', 'Total')}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{recommendedLabor.totalDs + recommendedLabor.totalNs}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{recommendedLabor.totalDs}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{recommendedLabor.totalNs}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{recommendedLabor.totalDsCapacity}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{recommendedLabor.totalNsCapacity}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4">
            <SectionCard title={t('ToC Labor', 'ToC Labor')} themeMode={themeMode} className="w-fit max-w-full p-4">
              <div className="overflow-x-auto rounded-2xl border border-white/5 px-2">
                <table className={['w-max text-left text-xs', shellClass].join(' ')}>
                  <thead className={headClass}>
                    <tr>
                      <th className="whitespace-nowrap px-1.5 py-2.5">{t('Area', 'Area')}</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">{t('Total', 'Total')}</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">DS</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">NS</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">{t('白班预计产能', 'DS Capacity')}</th>
                      <th className="whitespace-nowrap px-1.5 py-2.5 text-right">{t('夜班预计产能', 'NS Capacity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalLabor.rows.map((row) => (
                      <tr key={row.key} className={rowClass}>
                        <td className="whitespace-nowrap px-1.5 py-2.5 font-medium" title={t(row.labelZh, row.labelEn)}>{t(row.labelZh, row.labelEn)}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.total}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.ds}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.ns}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.dsCapacity}</td>
                        <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{row.nsCapacity}</td>
                      </tr>
                    ))}
                    <tr className={rowClass}>
                      <td className="whitespace-nowrap px-1.5 py-2.5 font-semibold">{t('Total', 'Total')}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{finalLabor.totalDs + finalLabor.totalNs}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{finalLabor.totalDs}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{finalLabor.totalNs}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{finalLabor.totalDsCapacity}</td>
                      <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-semibold">{finalLabor.totalNsCapacity}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      {parameterDialogOpen && typeof document !== 'undefined'
        ? createPortal(
        <div className={['fixed inset-0 z-[80] flex items-center justify-center p-4', isLight ? 'bg-slate-900/35' : 'bg-black/75'].join(' ')} onClick={() => setParameterDialogOpen(false)}>
          <div
            className={['max-h-[94vh] w-full max-w-[1780px] overflow-hidden rounded-[28px] border shadow-[0_30px_80px_rgba(0,0,0,0.35)]', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-slate-950'].join(' ')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={['flex items-start justify-between gap-4 border-b px-6 py-4', isLight ? 'border-slate-200' : 'border-white/10'].join(' ')}>
              <div>
                <div className={['text-xs uppercase tracking-[0.24em]', labelClass].join(' ')}>{t('模板与参数编辑', 'Template and parameter editor')}</div>
                <div className={['mt-1 text-xl font-semibold', isLight ? 'text-slate-900' : 'text-white'].join(' ')}>
                  {draftName || t('默认模板', 'Default template')}
                </div>
              </div>
              <button type="button" onClick={() => setParameterDialogOpen(false)} className={secondaryBtn}>
                {t('关闭', 'Close')}
              </button>
            </div>

            <div className="max-h-[calc(94vh-74px)] overflow-y-auto px-5 py-5">
              <div className={['mb-4 rounded-[22px] border p-4', shellClass].join(' ')}>
                <div className="grid gap-3 xl:grid-cols-[minmax(0,220px)_minmax(0,220px)_auto_minmax(0,220px)_auto]">
                  <div>
                    <div className={['mb-2 text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('当前模板', 'Current template')}</div>
                    <select value={selectedTemplateId} disabled={isLocked || loading || templates.length === 0} onChange={(e) => selectTemplate(e.target.value)} className={inputClass}>
                      {templates.length === 0 ? <option value="">{t('默认模板（未保存）', 'Default template (unsaved)')}</option> : null}
                      {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className={['mb-2 text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('模板名称', 'Template name')}</div>
                    <input value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={isLocked || saving} className={inputClass} />
                  </div>
                  <div className="flex items-end">
                    <button type="button" disabled={isLocked || saving} onClick={() => void saveTemplate('update')} className={primaryBtn}>
                      {saving ? t('保存中...', 'Saving...') : t('保存模板', 'Save template')}
                    </button>
                  </div>
                  <div>
                    <div className={['mb-2 text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('新模板名称', 'New template name')}</div>
                    <input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} disabled={isLocked || saving} placeholder={t('例如：旺季版本', 'Example: Peak season')} className={inputClass} />
                  </div>
                  <div className="flex items-end">
                    <button type="button" disabled={isLocked || saving} onClick={() => void saveTemplate('create')} className={secondaryBtn}>
                      {t('另存为模板', 'Save as template')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="grid gap-4">
                  <SectionBlock title={t('ToC Order Inbound DS', 'ToC Order Inbound DS')} subtitle={t('日班入库拆分参数', 'Day shift inbound split metrics')} themeMode={themeMode}>
                    <div className={['overflow-hidden rounded-2xl border', isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-black/15'].join(' ')}>
                      {effectiveOrderInboundDs.filter((row) => row.key !== 'oi_pieces').map((row, index) => (
                        <label
                          key={`orderInboundDs-${row.key}`}
                          className={[
                            'grid items-center gap-3 px-3 py-2.5 md:grid-cols-[minmax(0,118px)_minmax(0,1fr)]',
                            index === 0 ? '' : isLight ? 'border-t border-slate-100' : 'border-t border-white/5'
                          ].join(' ')}
                        >
                          <div className={['text-[13px] font-medium leading-5', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                            {t(row.labelZh, row.labelEn)}
                          </div>
                          <input
                            value={row.value}
                            onChange={(e) => updateInbound('orderInboundDs', row.key, e.target.value)}
                            disabled={isLocked || saving || row.key === 'oi_pieces'}
                            className={inputClass}
                          />
                        </label>
                      ))}
                    </div>
                  </SectionBlock>

                  <SectionBlock title={t('ToC Area Efficiency DS', 'ToC Area Efficiency DS')} subtitle={t('日班工序效率与编制', 'Day shift process efficiency and staffing')} themeMode={themeMode}>
                    <div className="overflow-x-auto rounded-2xl border border-white/5">
                      <table className={['min-w-full text-left text-sm', shellClass].join(' ')}>
                        <thead className={headClass}>
                          <tr>
                            <th className="px-3 py-2.5">{t('Process', 'Process')}</th>
                            <th className="px-3 py-2.5">UPH</th>
                            <th className="px-3 py-2.5">{t('Goal', 'Goal')}</th>
                            <th className="px-3 py-2.5">EWH</th>
                            <th className="px-3 py-2.5">{t('# of People', '# of People')}</th>
                            <th className="px-3 py-2.5">{t('Lead', 'Lead')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {draftPayload.areaEfficiencyDs.map((row) => (
                            <tr key={`areaEfficiencyDs-${row.key}`} className={rowClass}>
                              <td className="px-3 py-2.5 font-medium whitespace-nowrap">{t(row.labelZh, row.labelEn)}</td>
                              {(['uph', 'goal', 'ewh', 'people', 'lead'] as const).map((field) => (
                                <td key={field} className="px-3 py-2.5">
                                  <input value={row[field]} onChange={(e) => updateProc('areaEfficiencyDs', row.key, field, e.target.value)} disabled={isLocked || saving} className={inputClass} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionBlock>
                </div>

                <div className="grid gap-4">
                  <SectionBlock title={t('ToC Order Inbound NS', 'ToC Order Inbound NS')} subtitle={t('夜班入库拆分参数', 'Night shift inbound split metrics')} themeMode={themeMode}>
                    <div className={['overflow-hidden rounded-2xl border', isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-black/15'].join(' ')}>
                      {effectiveOrderInboundNs.filter((row) => row.key !== 'oi_pieces').map((row, index) => (
                        <label
                          key={`orderInboundNs-${row.key}`}
                          className={[
                            'grid items-center gap-3 px-3 py-2.5 md:grid-cols-[minmax(0,118px)_minmax(0,1fr)]',
                            index === 0 ? '' : isLight ? 'border-t border-slate-100' : 'border-t border-white/5'
                          ].join(' ')}
                        >
                          <div className={['text-[13px] font-medium leading-5', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                            {t(row.labelZh, row.labelEn)}
                          </div>
                          <input
                            value={row.value}
                            onChange={(e) => updateInbound('orderInboundNs', row.key, e.target.value)}
                            disabled={isLocked || saving || row.key === 'oi_pieces'}
                            className={inputClass}
                          />
                        </label>
                      ))}
                    </div>
                  </SectionBlock>

                  <SectionBlock title={t('ToC Area Efficiency NS', 'ToC Area Efficiency NS')} subtitle={t('夜班工序效率与编制', 'Night shift process efficiency and staffing')} themeMode={themeMode}>
                    <div className="overflow-x-auto rounded-2xl border border-white/5">
                      <table className={['min-w-full text-left text-sm', shellClass].join(' ')}>
                        <thead className={headClass}>
                          <tr>
                            <th className="px-3 py-2.5">{t('Process', 'Process')}</th>
                            <th className="px-3 py-2.5">UPH</th>
                            <th className="px-3 py-2.5">{t('Goal', 'Goal')}</th>
                            <th className="px-3 py-2.5">EWH</th>
                            <th className="px-3 py-2.5">{t('# of People', '# of People')}</th>
                            <th className="px-3 py-2.5">{t('Lead', 'Lead')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {draftPayload.areaEfficiencyNs.map((row) => (
                            <tr key={`areaEfficiencyNs-${row.key}`} className={rowClass}>
                              <td className="px-3 py-2.5 font-medium whitespace-nowrap">{t(row.labelZh, row.labelEn)}</td>
                              {(['uph', 'goal', 'ewh', 'people', 'lead'] as const).map((field) => (
                                <td key={field} className="px-3 py-2.5">
                                  <input value={row[field]} onChange={(e) => updateProc('areaEfficiencyNs', row.key, field, e.target.value)} disabled={isLocked || saving} className={inputClass} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionBlock>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </section>
  );
}
