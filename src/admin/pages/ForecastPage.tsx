import { useEffect, useMemo, useRef, useState } from 'react';
import type { ForecastModelRow } from '../forecast';
import { FORECAST_HOURS, calculateForecast, getIsoWeekday } from '../forecast';

type TranslateFn = (zh: string, en: string) => string;

type ForecastPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  serverTime: Date;
  supabase: any;
  themeMode: 'light' | 'dark';
};

type VolumeHistoryUploadRow = {
  date: string;
  h00: number;
  h01: number;
  h02: number;
  h03: number;
  h04: number;
  h05: number;
  h06: number;
  h07: number;
  h08: number;
  h09: number;
  h10: number;
  h11: number;
  h12: number;
  h13: number;
  h14: number;
  h15: number;
  h16: number;
  h17: number;
  h18: number;
  h19: number;
  h20: number;
  h21: number;
  h22: number;
  h23: number;
};

type HourColumnKey = Exclude<keyof VolumeHistoryUploadRow, 'date'>;
type LookbackMode = 28 | 42 | 'all';

const HOUR_COLUMNS = Array.from({ length: 24 }, (_, idx) => `h${String(idx).padStart(2, '0')}`) as HourColumnKey[];
const TEMPLATE_HOUR_HEADERS = Array.from({ length: 24 }, (_, idx) => {
  const start = `${String(idx).padStart(2, '0')}:00`;
  const end = `${String(idx).padStart(2, '0')}:59`;
  return `${start}-${end}`;
});
const LOOKBACK_OPTIONS: { value: LookbackMode; label: string }[] = [
  { value: 28, label: '28 days' },
  { value: 42, label: '42 days' },
  { value: 'all', label: 'All history' }
];

const formatNumber = (value: number | null, digits = 0) => {
  if (value === null || Number.isNaN(value)) return '-';
  if (!Number.isFinite(value)) return 'INF';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
};

const formatPercent = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '-';
  return `${(value * 100).toFixed(1)}%`;
};

const normalizeHeaderKey = (value: string) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '');

const isValidDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const excelSerialDateToDateOnly = (value: number) => {
  if (!Number.isFinite(value)) return '';
  const utcDays = Math.floor(value - 25569);
  const utcMs = utcDays * 86400 * 1000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeImportedDate = (raw: unknown) => {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (isValidDateOnly(text)) return text;

  const numeric = Number(text);
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(text)) {
    const fromSerial = excelSerialDateToDateOnly(numeric);
    if (fromSerial) return fromSerial;
  }

  const slashMatch = text.match(/^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const c = Number(slashMatch[3]);
    let year = 0;
    let month = 0;
    let day = 0;
    if (slashMatch[1].length === 4) {
      year = a;
      month = b;
      day = c;
    } else if (slashMatch[3].length === 4) {
      year = c;
      month = a;
      day = b;
    }
    if (year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return '';
};

const buildHourHeaderAliases = () => {
  const aliases = new Map<string, HourColumnKey>();
  HOUR_COLUMNS.forEach((hourKey, idx) => {
    const hh = String(idx).padStart(2, '0');
    const start = `${hh}:00`;
    const end = `${hh}:59`;
    aliases.set(normalizeHeaderKey(hourKey), hourKey);
    aliases.set(normalizeHeaderKey(`h${idx}`), hourKey);
    aliases.set(normalizeHeaderKey(`${start}-${end}`), hourKey);
    aliases.set(normalizeHeaderKey(`${start}-${String((idx + 1) % 24).padStart(2, '0')}:00`), hourKey);
  });
  return aliases;
};

const HOUR_HEADER_ALIASES = buildHourHeaderAliases();

const parseCsvRows = (text: string) => {
  const lines: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let idx = 0; idx < text.length; idx += 1) {
    const ch = text[idx];
    const next = text[idx + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        idx += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') idx += 1;
      row.push(current);
      lines.push(row);
      row = [];
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    lines.push(row);
  }
  return lines;
};

function ForecastRangeChart({
  forecast,
  lowerBound,
  upperBound,
  currentCumVolume,
  themeMode
}: {
  forecast: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  currentCumVolume: number;
  themeMode: 'light' | 'dark';
}) {
  const isLight = themeMode === 'light';
  const width = 720;
  const height = 200;
  const paddingX = 28;
  const topY = 32;
  const axisY = 118;
  const upperLabelY = 78;
  const lowerLabelY = 158;
  const finiteUpperBound = Number.isFinite(upperBound ?? 0) ? (upperBound as number) : null;
  const minValue = 0;
  const maxValue = Math.max(1, currentCumVolume, lowerBound ?? 0, forecast ?? 0, finiteUpperBound ?? 0);
  const scaleX = (value: number) => paddingX + (Math.max(0, value) / maxValue) * (width - paddingX * 2);
  const lowerX = lowerBound !== null ? scaleX(lowerBound) : paddingX;
  const forecastX = forecast !== null ? scaleX(forecast) : paddingX;
  const upperX = finiteUpperBound !== null ? scaleX(finiteUpperBound) : width - paddingX;
  const currentX = scaleX(currentCumVolume);
  const clampTextX = (x: number) => Math.max(paddingX + 18, Math.min(width - paddingX - 18, x));
  const currentLabelX = currentX < 96 ? 96 : clampTextX(currentX);
  const lowerLabelX = lowerBound !== null ? clampTextX(lowerX) : paddingX;
  const upperLabelX = finiteUpperBound !== null ? clampTextX(upperX) : width - paddingX - 8;
  const forecastLabelX = forecast !== null ? clampTextX(forecastX) : paddingX;
  const currentValueY = upperLabelY + 18;
  const lowerValueY = lowerLabelY + 16;
  const forecastValueY = lowerLabelY + 16;
  const upperValueY = lowerLabelY + 38;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[200px] w-full overflow-visible">
      <defs>
        <linearGradient id="forecast-band" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={isLight ? 'rgba(34,197,94,0.16)' : 'rgba(132,204,22,0.16)'} />
          <stop offset="100%" stopColor={isLight ? 'rgba(14,165,233,0.2)' : 'rgba(56,189,248,0.24)'} />
        </linearGradient>
      </defs>
      <line
        x1={paddingX}
        y1={axisY}
        x2={width - paddingX}
        y2={axisY}
        stroke={isLight ? 'rgba(100,116,139,0.28)' : 'rgba(148,163,184,0.4)'}
        strokeWidth="2"
      />
      {forecast !== null && lowerBound !== null && (
        <rect
          x={Math.min(lowerX, upperX)}
          y={axisY - 18}
          width={Math.max(10, Math.abs(upperX - lowerX))}
          height="36"
          rx="18"
          fill="url(#forecast-band)"
          stroke={isLight ? 'rgba(16,185,129,0.38)' : 'rgba(132,204,22,0.45)'}
        />
      )}
      <line
        x1={currentX}
        y1={axisY - 28}
        x2={currentX}
        y2={axisY + 28}
        stroke="rgba(248,113,113,0.85)"
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      <circle cx={currentX} cy={axisY} r="7" fill="rgba(248,113,113,1)" />
      {forecast !== null && (
        <>
          <circle cx={forecastX} cy={axisY} r="8" fill="rgba(132,204,22,1)" />
          <line x1={forecastX} y1={axisY - 26} x2={forecastX} y2={axisY + 26} stroke="rgba(132,204,22,0.95)" strokeWidth="3" />
        </>
      )}
      {lowerBound !== null && <circle cx={lowerX} cy={axisY} r="6" fill="rgba(45,212,191,1)" />}
      {finiteUpperBound !== null ? (
        <circle cx={upperX} cy={axisY} r="6" fill="rgba(56,189,248,1)" />
      ) : (
        <text x={width - paddingX - 6} y={axisY + 6} textAnchor="end" fill="rgba(56,189,248,1)" fontSize="16" fontWeight="700">
          INF
        </text>
      )}
      {lowerBound !== null && (
        <>
          <text x={lowerLabelX} y={lowerLabelY} textAnchor="middle" fill="rgba(45,212,191,0.95)" fontSize="12" fontWeight="700">
            LOW
          </text>
          <text x={lowerLabelX} y={lowerValueY} textAnchor="middle" fill={isLight ? 'rgba(15,23,42,0.86)' : 'rgba(226,232,240,0.9)'} fontSize="12">
            {formatNumber(lowerBound)}
          </text>
        </>
      )}
      {forecast !== null && (
        <>
          <text x={forecastLabelX} y={lowerLabelY} textAnchor="middle" fill="rgba(132,204,22,1)" fontSize="12" fontWeight="700">
            FORECAST
          </text>
          <text x={forecastLabelX} y={forecastValueY} textAnchor="middle" fill={isLight ? 'rgba(15,23,42,0.86)' : 'rgba(226,232,240,0.9)'} fontSize="12">
            {formatNumber(forecast)}
          </text>
        </>
      )}
      <text x={currentLabelX} y={upperLabelY} textAnchor="middle" fill="rgba(248,113,113,0.95)" fontSize="12" fontWeight="700">
        CURRENT
      </text>
      <text x={currentLabelX} y={currentValueY} textAnchor="middle" fill={isLight ? 'rgba(15,23,42,0.86)' : 'rgba(226,232,240,0.9)'} fontSize="12">
        {formatNumber(currentCumVolume)}
      </text>
      <text
        x={upperLabelX}
        y={lowerLabelY}
        textAnchor={finiteUpperBound !== null ? 'middle' : 'end'}
        fill="rgba(56,189,248,1)"
        fontSize="12"
        fontWeight="700"
      >
        HIGH
      </text>
      <text
        x={upperLabelX}
        y={upperValueY}
        textAnchor={finiteUpperBound !== null ? 'middle' : 'end'}
        fill={isLight ? 'rgba(15,23,42,0.86)' : 'rgba(226,232,240,0.9)'}
        fontSize="12"
      >
        {finiteUpperBound !== null ? formatNumber(finiteUpperBound) : 'INF'}
      </text>
      <text x={paddingX} y={topY} fill={isLight ? 'rgba(100,116,139,0.85)' : 'rgba(148,163,184,0.76)'} fontSize="11">
        MIN {formatNumber(minValue)}
      </text>
      <text
        x={width - paddingX}
        y={topY}
        textAnchor="end"
        fill={isLight ? 'rgba(100,116,139,0.85)' : 'rgba(148,163,184,0.76)'}
        fontSize="11"
      >
        MAX {formatNumber(maxValue)}
      </text>
    </svg>
  );
}

export default function ForecastPage({ t, isLocked, serverTime, supabase, themeMode }: ForecastPageProps) {
  const isLight = themeMode === 'light';
  const todayWeekday = getIsoWeekday(serverTime);
  const initialHour = Math.min(12, Math.max(8, serverTime.getHours()));
  const initialSelectedHour = FORECAST_HOURS.includes(initialHour as (typeof FORECAST_HOURS)[number]) ? initialHour : 8;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedHour, setSelectedHour] = useState<number>(initialSelectedHour);
  const [lookbackMode, setLookbackMode] = useState<LookbackMode>(28);
  const [currentCumVolumeInput, setCurrentCumVolumeInput] = useState('');
  const [modelRows, setModelRows] = useState<ForecastModelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const panelClass = isLight ? 'border border-slate-200 bg-white' : 'border border-white/10 bg-black/20';
  const subPanelClass = isLight ? 'border border-slate-200 bg-slate-50' : 'border border-white/10 bg-slate-950/50';
  const inputClass = isLight
    ? 'mt-2 h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.14)] disabled:cursor-not-allowed disabled:opacity-60'
    : 'mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60';
  const secondaryButtonClass = isLight
    ? 'rounded-2xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60'
    : 'rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60';
  const labelClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const valueClass = isLight ? 'text-slate-900' : 'text-slate-100';
  const helperClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const chartWrapClass = isLight ? 'border border-slate-200 bg-white' : 'border border-white/10 bg-slate-950/50';
  const tableWrapClass = isLight ? 'border border-slate-200 bg-white' : 'border border-white/10';
  const tableHeadClass = isLight ? 'bg-slate-50 text-slate-500' : 'bg-slate-950/95 text-slate-400';
  const tableRowClass = isLight ? 'border-t border-slate-100 text-slate-700' : 'border-t border-white/5 text-slate-200';

  const loadModel = async (mode: LookbackMode = lookbackMode) => {
    if (!supabase) {
      setError(t('Missing Supabase configuration.', 'Missing Supabase configuration.'));
      setModelRows([]);
      return;
    }

    setLoading(true);
    setError(null);
    const res = await supabase.rpc('get_forecasting_model', {
      p_lookback_days: mode === 'all' ? null : mode
    });

    if (res.error) {
      setError(
        /forecasting_model|get_forecasting_model|volume_history/i.test(String(res.error.message ?? ''))
          ? t('Forecast model is unavailable. Run the SQL setup first.', 'Forecast model is unavailable. Run the SQL setup first.')
          : String(res.error.message ?? '')
      );
      setModelRows([]);
      setLoading(false);
      return;
    }

    setModelRows(
      (((res.data as ForecastModelRow[] | null) ?? [])
        .filter((row) => FORECAST_HOURS.includes(Number(row.hour_of_day ?? 0) as any))
        .map((row) => ({
        ...row,
        weekday: Number(row.weekday ?? 0),
        hour_of_day: Number(row.hour_of_day ?? 0),
        avg_share: Number(row.avg_share ?? 0),
        stddev_share: Number(row.stddev_share ?? 0),
        sample_size: Number(row.sample_size ?? 0),
        lookback_days: Number(row.lookback_days ?? 0) || null
      })) as ForecastModelRow[])
    );
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      await loadModel(lookbackMode);
    };
    void run();
    return () => {
      active = false;
      void active;
    };
  }, [lookbackMode, supabase]);

  const selectedCoefficient = useMemo(
    () => modelRows.find((row) => row.weekday === todayWeekday && row.hour_of_day === selectedHour) ?? null,
    [modelRows, selectedHour, todayWeekday]
  );

  const currentCumVolume = Math.max(0, Number(currentCumVolumeInput) || 0);
  const result = useMemo(
    () => calculateForecast(currentCumVolume, selectedHour, todayWeekday, selectedCoefficient),
    [currentCumVolume, selectedCoefficient, selectedHour, todayWeekday]
  );

  const todayRows = useMemo(
    () => modelRows.filter((row) => row.weekday === todayWeekday).sort((a, b) => a.hour_of_day - b.hour_of_day),
    [modelRows, todayWeekday]
  );

  const downloadTemplate = async () => {
    const headers = ['date', ...TEMPLATE_HOUR_HEADERS];
    const sampleRow = ['2026-03-10', ...Array.from({ length: 24 }, (_, idx) => (idx < 8 ? 0 : idx * 10))];
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'volume_history');
      XLSX.writeFile(wb, 'volume_history_template.xlsx');
    } catch {
      const csv = `${headers.join(',')}\n${sampleRow.join(',')}\n`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'volume_history_template.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  };

  const readTabularFile = async (file: File) => {
    const lower = String(file.name ?? '').trim().toLowerCase();
    if (lower.endsWith('.csv') || file.type === 'text/csv') {
      const text = await file.text();
      return parseCsvRows(text);
    }
    const XLSX = await import('xlsx');
    const ab = await file.arrayBuffer();
    const workbook = XLSX.read(ab, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    return ((XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]) ?? []);
  };

  const parseVolumeHistoryRows = (tableRows: any[][]) => {
    if (tableRows.length === 0) {
      throw new Error(t('The file is empty.', 'The file is empty.'));
    }

    const headerRow = (tableRows[0] ?? []).map((cell) => String(cell ?? '').trim());
    const normalizedHeaders = headerRow.map(normalizeHeaderKey);
    const dateColumnFound = normalizedHeaders.includes('date');
    const missing = HOUR_COLUMNS.filter((header) => {
      return !normalizedHeaders.some((normalized) => HOUR_HEADER_ALIASES.get(normalized) === header);
    });
    if (!dateColumnFound || missing.length > 0) {
      throw new Error(
        t(
          `Missing required columns: ${[!dateColumnFound ? 'date' : '', ...missing].filter(Boolean).join(', ')}`,
          `Missing required columns: ${[!dateColumnFound ? 'date' : '', ...missing].filter(Boolean).join(', ')}`
        )
      );
    }

    const indexByHeader = new Map<string, number>();
    normalizedHeaders.forEach((header, idx) => {
      if (!indexByHeader.has(header)) indexByHeader.set(header, idx);
    });

    const rowsByDate = new Map<string, VolumeHistoryUploadRow>();
    for (let rowIndex = 1; rowIndex < tableRows.length; rowIndex += 1) {
      const raw = tableRows[rowIndex] ?? [];
      const dateValue = normalizeImportedDate(raw[indexByHeader.get('date') ?? -1] ?? '');
      if (!dateValue) continue;
      if (!isValidDateOnly(dateValue)) {
        throw new Error(t(`Row ${rowIndex + 1} has an invalid date.`, `Row ${rowIndex + 1} has an invalid date.`));
      }
      const nextRow = { date: dateValue } as VolumeHistoryUploadRow;
      for (const hourKey of HOUR_COLUMNS) {
        const idx = normalizedHeaders.findIndex((normalized) => HOUR_HEADER_ALIASES.get(normalized) === hourKey);
        const rawValue = String(idx == null ? '' : raw[idx] ?? '').trim();
        const num = rawValue === '' ? 0 : Number(rawValue);
        if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
          throw new Error(t(`Row ${rowIndex + 1} has invalid ${hourKey}.`, `Row ${rowIndex + 1} has invalid ${hourKey}.`));
        }
        nextRow[hourKey] = num;
      }
      rowsByDate.set(dateValue, nextRow);
    }

    const parsed = Array.from(rowsByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    if (parsed.length === 0) {
      throw new Error(t('No importable data rows were found.', 'No importable data rows were found.'));
    }
    return parsed;
  };

  const onForecastFileSelected = async (file: File | null) => {
    setUploadError(null);
    setUploadMessage(null);
    if (!file) return;
    if (!supabase) {
      setUploadError(t('Missing Supabase configuration.', 'Missing Supabase configuration.'));
      return;
    }

    const lower = String(file.name ?? '').trim().toLowerCase();
    const validFile =
      lower.endsWith('.csv') ||
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      file.type === 'text/csv' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
    if (!validFile) {
      setUploadError(t('Unsupported file type. Please upload CSV or Excel.', 'Unsupported file type. Please upload CSV or Excel.'));
      return;
    }

    setUploading(true);
    try {
      const tableRows = await readTabularFile(file);
      const parsedRows = parseVolumeHistoryRows(tableRows);
      const upsertRes = await supabase.from('volume_history').upsert(parsedRows as any[], { onConflict: 'date' });
      if (upsertRes.error) {
        throw new Error(String(upsertRes.error.message ?? 'Upload failed.'));
      }
      setUploadMessage(t(`Upload successful: ${parsedRows.length} day rows.`, `Upload successful: ${parsedRows.length} day rows.`));
      await loadModel(lookbackMode);
    } catch (err) {
      setUploadError(String((err as any)?.message ?? err ?? 'Upload failed.'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-[0.08em]">{t('Forecast', 'Forecast')}</h2>
          <p className={['mt-2 text-sm', helperClass].join(' ')}>
            {t('Full-day forecast based on same-weekday cumulative shares.', 'Full-day forecast based on same-weekday cumulative shares.')}
          </p>
        </div>
        <div
          className={[
            'rounded-2xl px-4 py-3 text-right shadow-sm',
            isLight ? 'border border-slate-200 bg-white' : 'border border-white/10 bg-black/20'
          ].join(' ')}
        >
          <div className={['text-[10px] uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('Weekday', 'Weekday')}</div>
          <div className={['mt-1 text-sm font-semibold', valueClass].join(' ')}>{todayWeekday}</div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className={['rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
          <div className="grid gap-4">
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-[10px] uppercase tracking-[0.18em]', labelClass].join(' ')}>{t('History upload', 'History upload')}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(e) => void onForecastFileSelected(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  disabled={isLocked || uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className={[
                    'rounded-2xl bg-neon px-4 py-2 text-sm font-semibold shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-60',
                    isLight ? 'text-slate-950' : 'text-white'
                  ].join(' ')}
                >
                  {uploading ? t('Uploading...', 'Uploading...') : t('Upload CSV/Excel', 'Upload CSV/Excel')}
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => void downloadTemplate()}
                  className={secondaryButtonClass}
                >
                  {t('Download template', 'Download template')}
                </button>
              </div>
              {uploadError && <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{uploadError}</div>}
              {uploadMessage && <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{uploadMessage}</div>}
            </div>

            <div>
              <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('Lookback window', 'Lookback window')}</label>
              <select
                value={String(lookbackMode)}
                disabled={isLocked || loading}
                onChange={(e) => setLookbackMode(e.target.value === 'all' ? 'all' : (Number(e.target.value) as LookbackMode))}
                className={inputClass}
              >
                {LOOKBACK_OPTIONS.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('Cutoff hour', 'Cutoff hour')}</label>
              <select
                value={selectedHour}
                disabled={isLocked}
                onChange={(e) => setSelectedHour(Number(e.target.value) || 8)}
                className={inputClass}
              >
                {FORECAST_HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}:00
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={['text-xs uppercase tracking-[0.2em]', labelClass].join(' ')}>{t('Current cumulative volume', 'Current cumulative volume')}</label>
              <input
                type="number"
                min="0"
                step="1"
                value={currentCumVolumeInput}
                disabled={isLocked}
                onChange={(e) => setCurrentCumVolumeInput(e.target.value)}
                placeholder={t('Enter current cumulative volume', 'Enter current cumulative volume')}
                className={inputClass}
              />
            </div>

            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-[10px] uppercase tracking-[0.18em]', labelClass].join(' ')}>{t('Model coefficients', 'Model coefficients')}</div>
              <div className={['mt-3 grid gap-3 text-sm', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                <div className="flex items-center justify-between gap-3">
                  <span className={labelClass}>{t('Avg share', 'Avg share')}</span>
                  <span className="font-semibold">{formatPercent(result.avgShare)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className={labelClass}>{t('Share SD', 'Share SD')}</span>
                  <span className="font-semibold">{formatPercent(result.stddevShare)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className={labelClass}>{t('Sample size', 'Sample size')}</span>
                  <span className="font-semibold">{result.sampleSize || '-'}</span>
                </div>
              </div>
            </div>

            {error && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
          </div>
        </div>

        <div className="grid gap-4">
          <div className={['rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className={['rounded-2xl border p-4', isLight ? 'border-emerald-200 bg-emerald-50' : 'border-emerald-400/20 bg-emerald-500/10'].join(' ')}>
                <div className={['text-[10px] uppercase tracking-[0.18em]', isLight ? 'text-emerald-700/80' : 'text-emerald-200/70'].join(' ')}>{t('棰勬祴鍏ㄥぉ鍗曢噺', 'Forecast')}</div>
                <div className={['mt-3 font-display text-4xl tracking-[0.06em]', isLight ? 'text-emerald-900' : 'text-emerald-200'].join(' ')}>
                  {formatNumber(result.forecast)}
                </div>
              </div>
              <div className={['rounded-2xl border p-4', isLight ? 'border-teal-200 bg-teal-50' : 'border-teal-400/20 bg-teal-500/10'].join(' ')}>
                <div className={['text-[10px] uppercase tracking-[0.18em]', isLight ? 'text-teal-700/80' : 'text-teal-200/70'].join(' ')}>{t('鍖洪棿涓嬮檺', 'Lower')}</div>
                <div className={['mt-3 font-display text-4xl tracking-[0.06em]', isLight ? 'text-teal-900' : 'text-teal-200'].join(' ')}>
                  {formatNumber(result.lowerBound)}
                </div>
              </div>
              <div className={['rounded-2xl border p-4', isLight ? 'border-sky-200 bg-sky-50' : 'border-sky-400/20 bg-sky-500/10'].join(' ')}>
                <div className={['text-[10px] uppercase tracking-[0.18em]', isLight ? 'text-sky-700/80' : 'text-sky-200/70'].join(' ')}>{t('鍖洪棿涓婇檺', 'Upper')}</div>
                <div className={['mt-3 font-display text-4xl tracking-[0.06em]', isLight ? 'text-sky-900' : 'text-sky-200'].join(' ')}>
                  {formatNumber(result.upperBound)}
                </div>
              </div>
            </div>

            <div className={['mt-5 rounded-2xl p-4', chartWrapClass].join(' ')}>
              <ForecastRangeChart
                forecast={result.forecast}
                lowerBound={result.lowerBound}
                upperBound={result.upperBound}
                currentCumVolume={currentCumVolume}
                themeMode={themeMode}
              />
            </div>
          </div>

          <div className={['rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className={['text-sm font-semibold', valueClass].join(' ')}>{t('Today model snapshot', 'Today model snapshot')}</div>
              <div className={['text-xs', helperClass].join(' ')}>
                {selectedCoefficient?.lookback_start && selectedCoefficient?.lookback_end
                  ? `${selectedCoefficient.lookback_start} - ${selectedCoefficient.lookback_end}`
                  : t('Last 28 days', 'Last 28 days')}
              </div>
            </div>
            <div className={['overflow-auto rounded-2xl', tableWrapClass].join(' ')}>
              <table className="min-w-full table-fixed text-left text-xs">
                <thead className={['text-[10px] uppercase tracking-[0.16em]', tableHeadClass].join(' ')}>
                  <tr>
                    <th className="px-3 py-2">{t('Hour', 'Hour')}</th>
                    <th className="px-3 py-2">{t('Avg share', 'Avg share')}</th>
                    <th className="px-3 py-2">{t('SD', 'SD')}</th>
                    <th className="px-3 py-2">{t('Sample', 'Sample')}</th>
                  </tr>
                </thead>
                <tbody>
                  {todayRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className={['px-3 py-6 text-center', helperClass].join(' ')}>
                        {loading ? t('Loading...', 'Loading...') : t('No model data', 'No model data')}
                      </td>
                    </tr>
                  ) : (
                    todayRows.map((row) => (
                      <tr key={`${row.weekday}-${row.hour_of_day}`} className={tableRowClass}>
                        <td className="px-3 py-2">{row.hour_of_day}:00</td>
                        <td className="px-3 py-2">{formatPercent(row.avg_share)}</td>
                        <td className="px-3 py-2">{formatPercent(row.stddev_share)}</td>
                        <td className="px-3 py-2">{row.sample_size ?? '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
