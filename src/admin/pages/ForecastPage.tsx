import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import StyledDateInput from '../components/StyledDateInput';
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
  last_filled_hour?: number | null;
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
type WeekdayValue = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type ForecastDialogView = 'weekly' | 'history';
type AutoForecastSnapshot = {
  date: string;
  cutoffHour: number;
  currentCumVolume: number;
  row: VolumeHistoryUploadRow;
};

type ForecastManualInputRow = {
  input_date: string;
  weekday: WeekdayValue;
  previous_day_backlog: number;
  current_cumulative_volume_12: number;
  inventory_level: number;
  severe_weather: boolean;
  full_day_capacity: number;
  yesterday_inflow_00_14: number;
  updated_at?: string | null;
  updated_by?: string | null;
};

type ForecastManualInputDraftRow = {
  input_date: string;
  previous_day_backlog: string;
  predicted_full_day_volume_12: string;
  inventory_level: string;
  severe_weather: boolean;
  full_day_capacity: string;
  yesterday_inflow_00_14: string;
};
type LineChartSeries = { key: string; label: string; color: string; values: Array<number | null> };

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
const FORECAST_INPUT_TABLE = 'volume_forecast_daily_inputs';
const FIXED_FORECAST_HOUR = 12;
const YESTERDAY_INFLOW_HOUR_KEYS = HOUR_COLUMNS.slice(0, 14);
const WEEKDAY_OPTIONS: { value: WeekdayValue; zh: string; en: string; shortEn: string }[] = [
  { value: 1, zh: '周一', en: 'Monday', shortEn: 'Mon' },
  { value: 2, zh: '周二', en: 'Tuesday', shortEn: 'Tue' },
  { value: 3, zh: '周三', en: 'Wednesday', shortEn: 'Wed' },
  { value: 4, zh: '周四', en: 'Thursday', shortEn: 'Thu' },
  { value: 5, zh: '周五', en: 'Friday', shortEn: 'Fri' },
  { value: 6, zh: '周六', en: 'Saturday', shortEn: 'Sat' },
  { value: 7, zh: '周天', en: 'Sunday', shortEn: 'Sun' }
];

const formatNumber = (value: number | null, digits = 0) => {
  if (value === null || Number.isNaN(value)) return '-';
  if (!Number.isFinite(value)) return 'INF';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
};

const formatPercent = (value: number, digits = 1) => {
  if (!Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(digits)}%`;
};

const parseNumericCell = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const normalized = text.replace(/,/g, '');
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) return null;
  return number;
};

const parseNonNegativeInt = (value: string) => {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) return null;
  return number;
};

const getWeekdayFromDateOnly = (value: string): WeekdayValue | null => {
  if (!isValidDateOnly(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return getIsoWeekday(date) as WeekdayValue;
};

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

const getWeekDates = (baseDate: Date, weekOffset = 0) => {
  const anchor = new Date(baseDate);
  anchor.setHours(0, 0, 0, 0);
  const currentWeekday = getIsoWeekday(anchor);
  const monday = addDays(anchor, -(currentWeekday - 1) - weekOffset * 7);
  return Array.from({ length: 7 }, (_, index) => toDateOnly(addDays(monday, index)));
};
const getWeekStartDateOnly = (dateOnly: string) => {
  if (!isValidDateOnly(dateOnly)) return '';
  const date = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const weekday = getIsoWeekday(date);
  return toDateOnly(addDays(date, -(weekday - 1)));
};
const getMonthKeyFromDateOnly = (dateOnly: string) => {
  if (!isValidDateOnly(dateOnly)) return '';
  return String(dateOnly).slice(0, 7);
};
const getDateRangeDays = (startDate: string, endDate: string) => {
  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) return [] as string[];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [] as string[];
  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(toDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};
const normalizeHeaderKey = (value: string) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '');

const isValidDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseTabSeparatedRows = (text: string) =>
  String(text ?? '')
    .split(/\r?\n/)
    .map((line) => {
      const raw = String(line ?? '').trim();
      if (!raw) return [];
      if (raw.includes('\t')) return raw.split('\t').map((cell) => String(cell ?? '').trim());
      return raw.split(/\s+/).map((cell) => String(cell ?? '').trim());
    })
    .filter((row) => row.some((cell) => cell.length > 0));

const calculateCumulativeVolume = (row: Pick<VolumeHistoryUploadRow, HourColumnKey>, cutoffHour: number) => {
  const clampedHour = Math.max(0, Math.min(24, Math.floor(cutoffHour)));
  return HOUR_COLUMNS.slice(0, clampedHour).reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0);
};

const isMissingColumnError = (error: unknown, column: string, table?: string) => {
  const text = String((error as any)?.message ?? error ?? '').toLowerCase();
  const targetColumn = String(column ?? '').trim().toLowerCase();
  const targetTable = String(table ?? '').trim().toLowerCase();
  const mentionsColumn =
    text.includes(`'${targetColumn}'`) ||
    text.includes(`"${targetColumn}"`) ||
    text.includes(targetColumn);
  const mentionsTable = !targetTable || text.includes(targetTable);
  return mentionsColumn && mentionsTable && (text.includes('schema cache') || text.includes('column') || text.includes('could not find'));
};

const inferLastFilledHour = (row: Partial<Record<HourColumnKey, number | null | undefined>>) => {
  for (let index = HOUR_COLUMNS.length - 1; index >= 0; index -= 1) {
    const hourKey = HOUR_COLUMNS[index];
    const value = Number(row[hourKey] ?? 0);
    if (value > 0) return index;
  }
  return null;
};

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
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(text) && numeric >= 20000 && numeric <= 80000) {
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

  if (/[\/.-]/.test(text) || /[a-zA-Z]/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
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
  type Annotation = {
    key: 'lower' | 'forecast' | 'upper';
    markerX: number;
    baseLabelX: number;
    label: string;
    value: string;
    color: string;
    textAnchor?: 'start' | 'middle' | 'end';
  };
  const width = 720;
  const height = 200;
  const paddingX = 28;
  const topY = 32;
  const axisY = 118;
  const upperLabelY = 86;
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
  const currentValueY = upperLabelY - 20;
  const annotationSpacing = 86;
  const annotationLaneYs = [lowerLabelY - 6, lowerLabelY + 22, lowerLabelY + 50];
  const annotations: Annotation[] = [];

  if (lowerBound !== null) {
    annotations.push({
      key: 'lower',
      markerX: lowerX,
      baseLabelX: lowerLabelX,
      label: 'LOW',
      value: formatNumber(lowerBound),
      color: 'rgba(45,212,191,0.95)'
    });
  }
  if (forecast !== null) {
    annotations.push({
      key: 'forecast',
      markerX: forecastX,
      baseLabelX: forecastLabelX,
      label: 'FORECAST',
      value: formatNumber(forecast),
      color: 'rgba(132,204,22,1)'
    });
  }
  annotations.push({
    key: 'upper',
    markerX: upperX,
    baseLabelX: upperLabelX,
    label: 'HIGH',
    value: finiteUpperBound !== null ? formatNumber(finiteUpperBound) : 'INF',
    color: 'rgba(56,189,248,1)',
    textAnchor: finiteUpperBound !== null ? 'middle' : 'end'
  });

  const sortedAnnotations = annotations.slice().sort((a, b) => a.baseLabelX - b.baseLabelX);
  sortedAnnotations.forEach((annotation, index) => {
    const minX = paddingX + 24;
    const maxX = width - paddingX - 24;
    const prevX = index > 0 ? sortedAnnotations[index - 1] : null;
    const prevPlacedX = index > 0 ? (sortedAnnotations[index - 1] as Annotation & { placedX?: number }).placedX ?? minX : minX;
    let nextX = Math.max(minX, Math.min(maxX, annotation.baseLabelX));
    if (prevX && nextX - prevPlacedX < annotationSpacing) {
      nextX = Math.min(maxX, prevPlacedX + annotationSpacing);
    }
    (annotation as Annotation & { placedX?: number }).placedX = nextX;
  });
  for (let index = sortedAnnotations.length - 2; index >= 0; index -= 1) {
    const current = sortedAnnotations[index] as Annotation & { placedX?: number };
    const next = sortedAnnotations[index + 1] as Annotation & { placedX?: number };
    if ((next.placedX ?? width) - (current.placedX ?? 0) < annotationSpacing) {
      current.placedX = Math.max(paddingX + 24, (next.placedX ?? width) - annotationSpacing);
    }
  }
  const positionedAnnotations = sortedAnnotations.map((annotation, index) => {
    const laneIndex = sortedAnnotations.length > 1 ? index % annotationLaneYs.length : 0;
    const placedX = (annotation as Annotation & { placedX?: number }).placedX ?? annotation.baseLabelX;
    return {
      ...annotation,
      x: placedX,
      laneIndex,
      labelY: annotationLaneYs[laneIndex],
      valueY: annotationLaneYs[laneIndex] + 16
    };
  });

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
      {positionedAnnotations.map((annotation) => (
        <g key={annotation.key}>
          <path
            d={`M ${annotation.markerX} ${axisY + 10} C ${annotation.markerX} ${axisY + 24}, ${annotation.x} ${annotation.labelY - 18}, ${annotation.x} ${annotation.labelY - 4}`}
            fill="none"
            stroke={annotation.color}
            strokeOpacity="0.45"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <text
            x={annotation.x}
            y={annotation.labelY}
            textAnchor={annotation.textAnchor ?? 'middle'}
            fill={annotation.color}
            fontSize="12"
            fontWeight="700"
          >
            {annotation.label}
          </text>
          <text
            x={annotation.x}
            y={annotation.valueY}
            textAnchor={annotation.textAnchor ?? 'middle'}
            fill={isLight ? 'rgba(15,23,42,0.86)' : 'rgba(226,232,240,0.9)'}
            fontSize="12"
          >
            {annotation.value}
          </text>
        </g>
      ))}
      <text x={currentLabelX} y={upperLabelY} textAnchor="middle" fill="rgba(248,113,113,0.95)" fontSize="12" fontWeight="700">
        CURRENT
      </text>
      <text x={currentLabelX} y={currentValueY} textAnchor="middle" fill={isLight ? 'rgba(15,23,42,0.86)' : 'rgba(226,232,240,0.9)'} fontSize="12">
        {formatNumber(currentCumVolume)}
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

function WeekVolumeLineChart({
  themeMode,
  labels,
  series,
  valueFormatter = (value: number) => formatNumber(value),
  yAxisFormatter = (value: number) => formatNumber(value),
  labelStride,
  maxValueOverride
}: {
  themeMode: 'light' | 'dark';
  labels: string[];
  series: LineChartSeries[];
  valueFormatter?: (value: number) => string;
  yAxisFormatter?: (value: number) => string;
  labelStride?: number;
  maxValueOverride?: number;
}) {
  const isLight = themeMode === 'light';
  const [hoveredPoint, setHoveredPoint] = useState<{
    seriesKey: string;
    seriesLabel: string;
    color: string;
    value: number;
    x: number;
    y: number;
  } | null>(null);
  const width = 760;
  const height = 240;
  const paddingLeft = 48;
  const paddingRight = 16;
  const paddingTop = 22;
  const paddingBottom = 34;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;
  const allValues = series.flatMap((item) => item.values).filter((value): value is number => value !== null && Number.isFinite(value));
  const rawMaxValue = Math.max(1, ...allValues);
  const getNiceAxisMax = (value: number) => {
    const paddedValue = value * 1.18;
    if (paddedValue <= 10) return 10;
    const magnitude = 10 ** Math.floor(Math.log10(paddedValue));
    const normalized = paddedValue / magnitude;
    const niceSteps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    const niceNormalized = niceSteps.find((step) => normalized <= step) ?? 10;
    return niceNormalized * magnitude;
  };
  const maxValue = maxValueOverride && maxValueOverride > 0 ? maxValueOverride : getNiceAxisMax(rawMaxValue);
  const stepX = labels.length > 1 ? innerWidth / (labels.length - 1) : innerWidth;
  const scaleX = (index: number) => paddingLeft + stepX * index;
  const scaleY = (value: number) => paddingTop + innerHeight - (Math.max(0, value) / maxValue) * innerHeight;
  const gridValues = Array.from({ length: 5 }, (_, index) => (maxValue / 4) * index);
  const effectiveLabelStride = labelStride ?? (labels.length > 14 ? Math.ceil(labels.length / 10) : 1);
  const pointOffsets: Record<string, { x: number; y: number }> = {
    forecast: { x: 0, y: -4 },
    current_week: { x: -4, y: 4 },
    last_week: { x: 4, y: 0 }
  };
  const legendStrokeStyles: Record<string, string | undefined> = {
    forecast: '6 4'
  };
  const getOffsetPoint = (key: string, index: number, value: number) => {
    const offset = pointOffsets[key] ?? { x: 0, y: 0 };
    return {
      x: scaleX(index) + offset.x,
      y: scaleY(value) + offset.y
    };
  };

  const buildSeriesPath = (key: string, values: Array<number | null>) =>
    values
      .map((value, index) => {
        if (value === null) return null;
        const point = getOffsetPoint(key, index, value);
        return `${index === 0 || values[index - 1] === null ? 'M' : 'L'} ${point.x} ${point.y}`;
      })
      .filter(Boolean)
      .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[240px] w-full overflow-visible">
      {gridValues.map((gridValue) => (
        <g key={gridValue}>
          <line
            x1={paddingLeft}
            y1={scaleY(gridValue)}
            x2={width - paddingRight}
            y2={scaleY(gridValue)}
            stroke={isLight ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.18)'}
            strokeWidth="1"
          />
          <text
            x={paddingLeft - 8}
            y={scaleY(gridValue) + 4}
            textAnchor="end"
            fill={isLight ? 'rgba(100,116,139,0.88)' : 'rgba(148,163,184,0.76)'}
            fontSize="11"
          >
            {yAxisFormatter(gridValue)}
          </text>
        </g>
      ))}

      {labels.map((label, index) => (
        <text
          key={label}
          x={scaleX(index)}
          y={height - 10}
          textAnchor="middle"
          fill={isLight ? 'rgba(51,65,85,0.9)' : 'rgba(203,213,225,0.85)'}
          fontSize="11"
          opacity={index % effectiveLabelStride === 0 || index === labels.length - 1 ? 1 : 0}
        >
          {label}
        </text>
      ))}

      {series.map((item) => {
        const path = buildSeriesPath(item.key, item.values);
        return (
          <g key={item.key}>
            {path && (
              <path
                d={path}
                fill="none"
                stroke={item.color}
                strokeWidth={item.key === 'forecast' ? '3.5' : '3'}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeOpacity={item.key === 'forecast' ? '0.95' : '0.68'}
                strokeDasharray={item.key === 'forecast' ? '6 4' : undefined}
              />
            )}
            {item.values.map((value, index) =>
              value === null ? null : (
                <g key={`${item.key}-${labels[index]}`}>
                  <circle
                    cx={getOffsetPoint(item.key, index, value).x}
                    cy={getOffsetPoint(item.key, index, value).y}
                    r="4"
                    fill={item.color}
                    fillOpacity={item.key === 'forecast' ? '1' : '0.88'}
                  />
                  <circle
                    cx={getOffsetPoint(item.key, index, value).x}
                    cy={getOffsetPoint(item.key, index, value).y}
                    r="12"
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() =>
                      setHoveredPoint({
                        seriesKey: item.key,
                        seriesLabel: item.label,
                        color: item.color,
                        value,
                        x: getOffsetPoint(item.key, index, value).x,
                        y: getOffsetPoint(item.key, index, value).y
                      })
                    }
                    onMouseLeave={() => setHoveredPoint((current) => (current?.seriesKey === item.key ? null : current))}
                  />
                </g>
              )
            )}
          </g>
        );
      })}

      {hoveredPoint ? (
        <g pointerEvents="none">
          <rect
            x={Math.max(8, Math.min(width - 120, hoveredPoint.x - 54))}
            y={Math.max(8, hoveredPoint.y - 38)}
            width="120"
            height="28"
            rx="10"
            fill={isLight ? 'rgba(255,255,255,0.96)' : 'rgba(15,23,42,0.96)'}
            stroke={hoveredPoint.color}
            strokeWidth="1"
          />
          <text
            x={Math.max(20, Math.min(width - 60, hoveredPoint.x + 6))}
            y={Math.max(26, hoveredPoint.y - 20)}
            textAnchor="middle"
            fill={isLight ? 'rgba(15,23,42,0.96)' : 'rgba(241,245,249,0.96)'}
            fontSize="11"
            fontWeight="700"
          >
            {`${hoveredPoint.seriesLabel} ${valueFormatter(hoveredPoint.value)}`}
          </text>
        </g>
      ) : null}

      <g transform={`translate(${width - paddingRight + 40}, ${paddingTop + 18})`}>
        {series.map((item, index) => (
          <g key={item.key} transform={`translate(0, ${index * 22})`}>
            <line
              x1="0"
              y1="0"
              x2="18"
              y2="0"
              stroke={item.color}
              strokeWidth={item.key === 'forecast' ? '3.5' : '3'}
              strokeLinecap="round"
              strokeOpacity={item.key === 'forecast' ? '0.95' : '0.68'}
              strokeDasharray={legendStrokeStyles[item.key]}
            />
            <text x="24" y="4" fill={isLight ? 'rgba(15,23,42,0.9)' : 'rgba(226,232,240,0.9)'} fontSize="12">
              {item.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export default function ForecastPage({ t, isLocked, serverTime, supabase, themeMode }: ForecastPageProps) {
  const isLight = themeMode === 'light';
  const initialWeekday = getIsoWeekday(serverTime) as WeekdayValue;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedWeekday, setSelectedWeekday] = useState<WeekdayValue>(initialWeekday);
  const [lookbackMode, setLookbackMode] = useState<LookbackMode>('all');
  const [modelRows, setModelRows] = useState<ForecastModelRow[]>([]);
  const [manualInputRows, setManualInputRows] = useState<ForecastManualInputRow[]>([]);
  const [manualInputsLoading, setManualInputsLoading] = useState(false);
  const [manualInputsError, setManualInputsError] = useState<string | null>(null);
  const [manualInputDialogOpen, setManualInputDialogOpen] = useState(false);
  const [manualInputDraftRows, setManualInputDraftRows] = useState<ForecastManualInputDraftRow[]>([]);
  const [manualInputWeekOffset, setManualInputWeekOffset] = useState(0);
  const [forecastDialogView, setForecastDialogView] = useState<ForecastDialogView>('weekly');
  const [historyWindowRows, setHistoryWindowRows] = useState<VolumeHistoryUploadRow[]>([]);
  const [rangeHistoryRows, setRangeHistoryRows] = useState<VolumeHistoryUploadRow[]>([]);
  const [historyWindowLoading, setHistoryWindowLoading] = useState(false);
  const [historyWindowError, setHistoryWindowError] = useState<string | null>(null);
  const [historyPasteValue, setHistoryPasteValue] = useState('');
  const [historyPasteDate, setHistoryPasteDate] = useState('');
  const [historyPasteSaving, setHistoryPasteSaving] = useState(false);
  const [autoForecastSnapshot, setAutoForecastSnapshot] = useState<AutoForecastSnapshot | null>(null);
  const [selectedForecastHour, setSelectedForecastHour] = useState<number>(FIXED_FORECAST_HOUR);
  const [manualInputSaving, setManualInputSaving] = useState(false);
  const [manualInputSaveError, setManualInputSaveError] = useState<string | null>(null);
  const [manualInputSaveMessage, setManualInputSaveMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allHistoryModelRows, setAllHistoryModelRows] = useState<ForecastModelRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [volumeTrendRangeStart, setVolumeTrendRangeStart] = useState(() => toDateOnly(addDays(serverTime, -6)));
  const [volumeTrendRangeEnd, setVolumeTrendRangeEnd] = useState(() => toDateOnly(serverTime));
  const [inventoryTrendRangeStart, setInventoryTrendRangeStart] = useState(() => toDateOnly(addDays(serverTime, -29)));
  const [inventoryTrendRangeEnd, setInventoryTrendRangeEnd] = useState(() => toDateOnly(serverTime));
  const [historyTableRangeStart, setHistoryTableRangeStart] = useState(() => getWeekDates(serverTime, 0)[0] ?? toDateOnly(serverTime));
  const [historyTableRangeEnd, setHistoryTableRangeEnd] = useState(() => getWeekDates(serverTime, 0)[6] ?? toDateOnly(serverTime));
  const [weeklyTableRangeStart, setWeeklyTableRangeStart] = useState(() => toDateOnly(addDays(serverTime, -55)));
  const [weeklyTableRangeEnd, setWeeklyTableRangeEnd] = useState(() => toDateOnly(serverTime));
  const [monthlyTableRangeStart, setMonthlyTableRangeStart] = useState(() => toDateOnly(addDays(serverTime, -185)));
  const [monthlyTableRangeEnd, setMonthlyTableRangeEnd] = useState(() => toDateOnly(serverTime));
  const panelClass = isLight ? 'border border-slate-200 bg-white' : 'border border-white/10 bg-black/20';
  const subPanelClass = isLight ? 'border border-slate-200 bg-slate-50' : 'border border-white/10 bg-slate-950/50';
  const inputClass = isLight
    ? 'mt-2 h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.14)] disabled:cursor-not-allowed disabled:opacity-60'
    : 'mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60';
  const secondaryButtonClass = isLight
    ? 'rounded-2xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60'
    : 'rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60';
  const labelClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const valueClass = isLight ? 'text-slate-950' : 'text-slate-100';
  const helperClass = isLight ? 'text-slate-700' : 'text-slate-400';
  const chartWrapClass = isLight ? 'border border-slate-200 bg-white' : 'border border-white/10 bg-slate-950/50';
  const tableWrapClass = isLight ? 'border border-slate-200 bg-white' : 'border border-white/10';
  const tableHeadClass = isLight ? 'bg-slate-50 text-slate-700' : 'bg-slate-950/95 text-slate-400';
  const tableRowClass = isLight ? 'border-t border-slate-100 text-slate-800' : 'border-t border-white/5 text-slate-200';
  const weekdayButtonClass = (weekday: WeekdayValue) =>
    [
      'rounded-2xl px-4 py-2 text-sm font-semibold transition',
      selectedWeekday === weekday
        ? isLight
          ? 'border border-emerald-400 bg-emerald-50 text-emerald-900 shadow-sm'
          : 'border border-neon/70 bg-neon/15 text-neon'
        : isLight
          ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
          : 'border border-white/10 bg-black/20 text-slate-300 hover:bg-white/10'
    ].join(' ');
  const primaryActionButtonClass = [
    'rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
    isLight
      ? 'border border-slate-900 bg-slate-900 text-white shadow-sm hover:bg-slate-700'
      : 'border border-cyan-400/30 bg-cyan-400/12 text-cyan-200 hover:border-cyan-300/50 hover:bg-cyan-400/18'
  ].join(' ');
  const secondaryActionButtonClass = [
    'rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
    isLight
      ? 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
      : 'border border-amber-400/30 bg-amber-400/10 text-amber-200 hover:border-amber-300/50 hover:bg-amber-400/16'
  ].join(' ');
  const selectedWeekdayOption = WEEKDAY_OPTIONS.find((option) => option.value === selectedWeekday) ?? WEEKDAY_OPTIONS[0];

  const loadAutoForecastSnapshot = async (weekday: WeekdayValue) => {
    if (!supabase) {
      setAutoForecastSnapshot(null);
      return;
    }

    const selectWithMarker =
      'date,last_filled_hour,h00,h01,h02,h03,h04,h05,h06,h07,h08,h09,h10,h11,h12,h13,h14,h15,h16,h17,h18,h19,h20,h21,h22,h23';
    const selectWithoutMarker =
      'date,h00,h01,h02,h03,h04,h05,h06,h07,h08,h09,h10,h11,h12,h13,h14,h15,h16,h17,h18,h19,h20,h21,h22,h23';

    let res = await supabase
      .from('volume_history')
      .select(selectWithMarker)
      .eq('weekday', weekday)
      .order('date', { ascending: false })
      .limit(1);

    let row = ((res.data as VolumeHistoryUploadRow[] | null) ?? [])[0];
    const toSelectableCutoffHour = (lastFilledHour: number | null) => {
      if (lastFilledHour === null || lastFilledHour < 0) return null;
      if (lastFilledHour >= 23) return 23;
      return lastFilledHour + 1;
    };
    let cutoffHour =
      row?.last_filled_hour === null || row?.last_filled_hour === undefined ? null : toSelectableCutoffHour(Number(row.last_filled_hour));

    if (res.error && isMissingColumnError(res.error, 'last_filled_hour', 'volume_history')) {
      res = await supabase
        .from('volume_history')
        .select(selectWithoutMarker)
        .eq('weekday', weekday)
        .order('date', { ascending: false })
        .limit(1);
      row = ((res.data as VolumeHistoryUploadRow[] | null) ?? [])[0];
      const inferredLastFilledHour = row ? inferLastFilledHour(row as Partial<Record<HourColumnKey, number>>) : null;
      cutoffHour = toSelectableCutoffHour(inferredLastFilledHour);
    }

    if (res.error || !row || !cutoffHour || cutoffHour <= 0) {
      setAutoForecastSnapshot(null);
      return;
    }

    setAutoForecastSnapshot({
      date: String(row.date ?? ''),
      cutoffHour,
      currentCumVolume: calculateCumulativeVolume(row as Pick<VolumeHistoryUploadRow, HourColumnKey>, cutoffHour),
      row: row as VolumeHistoryUploadRow
    });
  };

  const loadManualInputs = async () => {
    if (!supabase) {
      setManualInputsError(t('Missing Supabase configuration.', 'Missing Supabase configuration.'));
      setManualInputRows([]);
      return;
    }

    setManualInputsLoading(true);
    setManualInputsError(null);
    const res = await supabase.from(FORECAST_INPUT_TABLE).select('*').order('weekday', { ascending: true });
    if (res.error) {
      setManualInputsError(
        /volume_forecast/i.test(String(res.error.message ?? ''))
          ? t('Manual input table is unavailable. Run the SQL setup first.', 'Manual input table is unavailable. Run the SQL setup first.')
          : String(res.error.message ?? '')
      );
      setManualInputRows([]);
      setManualInputsLoading(false);
      return;
    }

    setManualInputRows(
      (((res.data as ForecastManualInputRow[] | null) ?? []).map((row) => ({
        input_date: String((row as any).input_date ?? ''),
        weekday: Number(row.weekday ?? 0) as WeekdayValue,
        previous_day_backlog: Number(row.previous_day_backlog ?? 0),
        current_cumulative_volume_12: Number((row as any).current_cumulative_volume_12 ?? 0),
        inventory_level: Number((row as any).inventory_level ?? 0),
        severe_weather: Boolean((row as any).severe_weather ?? false),
        full_day_capacity: Number(row.full_day_capacity ?? 0),
        yesterday_inflow_00_14: Number(row.yesterday_inflow_00_14 ?? 0),
        updated_at: row.updated_at ?? null,
        updated_by: row.updated_by ?? null
      })) as ForecastManualInputRow[])
    );
    setManualInputsLoading(false);
  };

  const getVolumeTrendComparisonStart = () => {
    const currentRangeDays = getDateRangeDays(volumeTrendRangeStart, volumeTrendRangeEnd).length;
    if (currentRangeDays <= 0) return volumeTrendRangeStart;
    return toDateOnly(addDays(new Date(`${volumeTrendRangeStart}T00:00:00`), -currentRangeDays));
  };

  const loadRangeHistory = async () => {
    if (!supabase) {
      setRangeHistoryRows([]);
      return;
    }
    const allStarts = [
      historyTableRangeStart,
      inventoryTrendRangeStart,
      weeklyTableRangeStart,
      monthlyTableRangeStart,
      getVolumeTrendComparisonStart()
    ].filter((value) => isValidDateOnly(value));
    const allEnds = [
      historyTableRangeEnd,
      inventoryTrendRangeEnd,
      weeklyTableRangeEnd,
      monthlyTableRangeEnd,
      volumeTrendRangeEnd
    ].filter((value) => isValidDateOnly(value));
    if (allStarts.length === 0 || allEnds.length === 0) {
      setRangeHistoryRows([]);
      return;
    }
    const startDate = [...allStarts].sort()[0];
    const sortedEnds = [...allEnds].sort();
    const endDate = sortedEnds.length > 0 ? sortedEnds[sortedEnds.length - 1] : '';
    if (!startDate || !endDate) {
      setRangeHistoryRows([]);
      return;
    }
    const res = await supabase
      .from('volume_history')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });
    if (res.error) {
      setRangeHistoryRows([]);
      return;
    }
    setRangeHistoryRows(((res.data as VolumeHistoryUploadRow[] | null) ?? []).map((row) => ({ ...row } as VolumeHistoryUploadRow)));
  };

  const loadAllHistoryModel = async () => {
    if (!supabase) {
      setAllHistoryModelRows([]);
      return;
    }

    const res = await supabase.rpc('get_forecasting_model', {
      p_lookback_days: null
    });
    if (res.error) {
      setAllHistoryModelRows([]);
      return;
    }

    setAllHistoryModelRows(
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
  };

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
    const run = async () => {
      await Promise.all([loadModel(lookbackMode), loadManualInputs(), loadAllHistoryModel(), loadRangeHistory()]);
    };
    void run();
  }, [
    lookbackMode,
    serverTime,
    supabase,
    historyTableRangeStart,
    historyTableRangeEnd,
    inventoryTrendRangeStart,
    inventoryTrendRangeEnd,
    weeklyTableRangeStart,
    weeklyTableRangeEnd,
    monthlyTableRangeStart,
    monthlyTableRangeEnd,
    volumeTrendRangeStart,
    volumeTrendRangeEnd
  ]);

  useEffect(() => {
    void loadAutoForecastSnapshot(selectedWeekday);
  }, [selectedWeekday, supabase]);

  useEffect(() => {
    setSelectedForecastHour((current) => {
      if (autoForecastSnapshot?.cutoffHour) {
        return current >= 1 && current <= autoForecastSnapshot.cutoffHour ? current : autoForecastSnapshot.cutoffHour;
      }
      return FIXED_FORECAST_HOUR;
    });
  }, [autoForecastSnapshot?.cutoffHour]);

  useEffect(() => {
    if (!manualInputDialogOpen) return;
    setManualInputDraftRows(buildManualInputDraftRows(manualInputWeekOffset));
  }, [allHistoryModelRows, historyWindowRows, manualInputDialogOpen, manualInputRows, manualInputWeekOffset]);

  const selectedWeekdayManualRows = useMemo(
    () =>
      manualInputRows
        .filter((row) => row.weekday === selectedWeekday)
        .sort((a, b) => b.input_date.localeCompare(a.input_date)),
    [manualInputRows, selectedWeekday]
  );
  const selectedManualInput = selectedWeekdayManualRows[0] ?? null;
  const manualInputByDate = useMemo(() => new Map(manualInputRows.map((row) => [row.input_date, row])), [manualInputRows]);
  const getDefaultHistoryPasteDate = (weekDates: string[]) => {
    const today = toDateOnly(serverTime);
    if (weekDates.includes(today)) return today;
    return weekDates[selectedWeekday - 1] ?? weekDates[0] ?? '';
  };
  const noonAllHistoryCoefficientByWeekday = useMemo(
    () =>
      new Map(
        WEEKDAY_OPTIONS.map((option) => [
          option.value,
          allHistoryModelRows.find((row) => row.weekday === option.value && row.hour_of_day === FIXED_FORECAST_HOUR) ?? null
        ])
      ),
    [allHistoryModelRows]
  );
  const hasReachedNoonForecastCutoff = (historyRow?: VolumeHistoryUploadRow | null) => {
    if (!historyRow) return false;
    const rawLastFilledHour = historyRow.last_filled_hour === null || historyRow.last_filled_hour === undefined
      ? inferLastFilledHour(historyRow)
      : Number(historyRow.last_filled_hour);
    if (rawLastFilledHour === null || rawLastFilledHour === undefined) return false;
    return Number.isFinite(rawLastFilledHour) && rawLastFilledHour >= FIXED_FORECAST_HOUR - 1;
  };
  const isCompleteHistoryDay = (historyRow?: VolumeHistoryUploadRow | null) => {
    if (!historyRow) return false;
    const rawLastFilledHour = historyRow.last_filled_hour === null || historyRow.last_filled_hour === undefined
      ? inferLastFilledHour(historyRow)
      : Number(historyRow.last_filled_hour);
    if (rawLastFilledHour === null || rawLastFilledHour === undefined) return false;
    return Number.isFinite(rawLastFilledHour) && rawLastFilledHour >= 23;
  };
  const calculateNoonPredictedFullDayVolume = (date: string, historyRow?: VolumeHistoryUploadRow | null) => {
    if (!historyRow) return null;
    if (!hasReachedNoonForecastCutoff(historyRow)) return null;
    const weekday = getWeekdayFromDateOnly(date);
    if (!weekday) return null;
    const coefficient = noonAllHistoryCoefficientByWeekday.get(weekday) ?? null;
    if (!coefficient) return null;
    const noonCumVolume = calculateCumulativeVolume(historyRow as Pick<VolumeHistoryUploadRow, HourColumnKey>, FIXED_FORECAST_HOUR);
    const forecast = calculateForecast(noonCumVolume, FIXED_FORECAST_HOUR, weekday, coefficient).forecast;
    return forecast === null ? null : Math.round(forecast);
  };
  const latestSelectedWeekdayCardRow = useMemo(() => {
    const latestManualRow = selectedWeekdayManualRows[0] ?? null;
    if (!latestManualRow) return null;
    const historyRow = historyWindowRows.find((row) => row.date === latestManualRow.input_date) ?? null;
    const predictedFullDayVolume12 = calculateNoonPredictedFullDayVolume(latestManualRow.input_date, historyRow);
    return {
      ...latestManualRow,
      predicted_full_day_volume_12: predictedFullDayVolume12
    };
  }, [calculateNoonPredictedFullDayVolume, historyWindowRows, selectedWeekdayManualRows]);
  const rangeHistoryByDate = useMemo(() => new Map(rangeHistoryRows.map((row) => [row.date, row])), [rangeHistoryRows]);
  const volumeTrendDates = useMemo(() => getDateRangeDays(volumeTrendRangeStart, volumeTrendRangeEnd), [volumeTrendRangeEnd, volumeTrendRangeStart]);
  const volumeTrendPreviousDates = useMemo(() => {
    const days = volumeTrendDates.length;
    if (days <= 0) return [] as string[];
    const start = toDateOnly(addDays(new Date(`${volumeTrendRangeStart}T00:00:00`), -days));
    const end = toDateOnly(addDays(new Date(`${volumeTrendRangeStart}T00:00:00`), -1));
    return getDateRangeDays(start, end);
  }, [volumeTrendDates.length, volumeTrendRangeStart]);
  const inventoryTrendDates = useMemo(() => getDateRangeDays(inventoryTrendRangeStart, inventoryTrendRangeEnd), [inventoryTrendRangeEnd, inventoryTrendRangeStart]);
  const historyTableDates = useMemo(() => getDateRangeDays(historyTableRangeStart, historyTableRangeEnd), [historyTableRangeEnd, historyTableRangeStart]);
  const weeklyHistoryRowsFiltered = useMemo(
    () => rangeHistoryRows.filter((row) => row.date >= weeklyTableRangeStart && row.date <= weeklyTableRangeEnd),
    [rangeHistoryRows, weeklyTableRangeEnd, weeklyTableRangeStart]
  );
  const monthlyHistoryRowsFiltered = useMemo(
    () => rangeHistoryRows.filter((row) => row.date >= monthlyTableRangeStart && row.date <= monthlyTableRangeEnd),
    [monthlyTableRangeEnd, monthlyTableRangeStart, rangeHistoryRows]
  );
  const weekVolumeTrendSeries = useMemo(() => {
    const labels = volumeTrendDates.map((date) => date.slice(5));
    const forecastValues = volumeTrendDates.map((date) => {
      const historyRow = rangeHistoryByDate.get(date) ?? null;
      return calculateNoonPredictedFullDayVolume(date, historyRow);
    });
    const thisWeekValues = volumeTrendDates.map((date) => {
      const row = rangeHistoryByDate.get(date);
      if (!row || !isCompleteHistoryDay(row)) return null;
      return HOUR_COLUMNS.reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0);
    });
    const lastWeekValues = volumeTrendPreviousDates.map((date) => {
      const row = rangeHistoryByDate.get(date);
      return row ? HOUR_COLUMNS.reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0) : null;
    });
    return {
      labels,
      series: [
        { key: 'forecast', label: t('预测', 'Forecast'), color: 'rgba(132,204,22,1)', values: forecastValues },
        { key: 'this-week', label: t('当前范围', 'Current range'), color: 'rgba(14,165,233,1)', values: thisWeekValues },
        { key: 'last-week', label: t('上一周期', 'Previous period'), color: 'rgba(225,29,72,1)', values: lastWeekValues }
      ]
    };
  }, [calculateNoonPredictedFullDayVolume, rangeHistoryByDate, t, volumeTrendDates, volumeTrendPreviousDates]);
  const inventoryConversionTrendSeries = useMemo(() => {
    return {
      dateRange: inventoryTrendDates.length > 0 ? `${inventoryTrendDates[0]} - ${inventoryTrendDates[inventoryTrendDates.length - 1]}` : '',
      labels: inventoryTrendDates.map((date) => date.slice(5)),
      series: [
        {
          key: 'itr-30d',
          label: t('库存转换率', 'ITR'),
          color: 'rgba(245,158,11,1)',
          values: inventoryTrendDates.map((date) => {
            const row = rangeHistoryByDate.get(date);
            const inventoryLevel = Number(manualInputByDate.get(date)?.inventory_level ?? 0);
            if (!row || !isCompleteHistoryDay(row) || inventoryLevel <= 0) return null;
            const dailyTotal = HOUR_COLUMNS.reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0);
            return dailyTotal / inventoryLevel;
          })
        }
      ] as LineChartSeries[]
    };
  }, [inventoryTrendDates, manualInputByDate, rangeHistoryByDate, t]);
  const weeklyInflowTableRows = useMemo(() => {
    const historyByDate = new Map(weeklyHistoryRowsFiltered.map((row) => [row.date, row]));
    const weekStarts = Array.from(
      new Set(
        weeklyHistoryRowsFiltered
          .map((row) => getWeekStartDateOnly(row.date))
          .filter((value) => Boolean(value))
      )
    ).sort((a, b) => b.localeCompare(a));
    return weekStarts.map((weekStart) => {
      const days = getWeekDates(new Date(`${weekStart}T00:00:00`), 0);
      const dayValues = days.map((date) => {
        const row = historyByDate.get(date);
        if (!row || !isCompleteHistoryDay(row)) return null;
        return HOUR_COLUMNS.reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0);
      });
      const completeDays = dayValues.filter((value) => value !== null).length;
      const total = dayValues.reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
      return {
        weekStart,
        weekEnd: days[days.length - 1] ?? weekStart,
        dayValues,
        total,
        averagePerCompleteDay: completeDays > 0 ? total / completeDays : null
      };
    });
  }, [weeklyHistoryRowsFiltered]);
  const monthlyInflowTableRows = useMemo(() => {
    const monthKeys = Array.from(
      new Set(
        monthlyHistoryRowsFiltered
          .map((row) => getMonthKeyFromDateOnly(row.date))
          .filter((value) => Boolean(value))
      )
    ).sort((a, b) => b.localeCompare(a));
    return monthKeys.map((monthKey) => {
      const rows = monthlyHistoryRowsFiltered.filter((row) => getMonthKeyFromDateOnly(row.date) === monthKey);
      const dayValues = rows.map((row) => {
        if (!isCompleteHistoryDay(row)) return null;
        return HOUR_COLUMNS.reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0);
      });
      const completeDays = dayValues.filter((value) => value !== null).length;
      const total = dayValues.reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
      return {
        monthKey,
        total,
        completeDays,
        averagePerCompleteDay: completeDays > 0 ? total / completeDays : null
      };
    });
  }, [monthlyHistoryRowsFiltered]);
  const buildManualInputDraftRows = (weekOffset: number, historyRowsOverride?: VolumeHistoryUploadRow[]) => {
    const existingByDate = new Map(manualInputRows.map((row) => [row.input_date, row]));
    const historyRows = historyRowsOverride ?? historyWindowRows;
    const historyByDate = new Map(historyRows.map((row) => [row.date, row]));
    const displayDraftNumber = (value: number | null | undefined) => {
      const numeric = Number(value ?? 0);
      return numeric > 0 ? String(numeric) : '';
    };
    return getWeekDates(serverTime, weekOffset).map((inputDate) => {
        const existing = existingByDate.get(inputDate);
        const previousDate = toDateOnly(addDays(new Date(`${inputDate}T00:00:00`), -1));
        const previousHistoryRow = historyByDate.get(previousDate);
        const autoYesterdayInflow =
          previousHistoryRow
            ? YESTERDAY_INFLOW_HOUR_KEYS.reduce((sum, hourKey) => sum + Number(previousHistoryRow[hourKey] ?? 0), 0)
            : null;
        const currentHistoryRow = historyByDate.get(inputDate);
        const predictedFullDayVolume12 = calculateNoonPredictedFullDayVolume(inputDate, currentHistoryRow);
        return {
          input_date: inputDate,
          previous_day_backlog: displayDraftNumber(existing?.previous_day_backlog),
          predicted_full_day_volume_12: predictedFullDayVolume12 === null ? '' : String(predictedFullDayVolume12),
          inventory_level: displayDraftNumber(existing?.inventory_level),
          severe_weather: existing ? Boolean(existing.severe_weather) : false,
          full_day_capacity: displayDraftNumber(existing?.full_day_capacity),
          yesterday_inflow_00_14:
            autoYesterdayInflow !== null
              ? displayDraftNumber(autoYesterdayInflow)
              : displayDraftNumber(existing?.yesterday_inflow_00_14)
        };
      });
  };
  const currentWeekDates = useMemo(() => getWeekDates(serverTime, manualInputWeekOffset), [serverTime, manualInputWeekOffset]);
  const forecastAtNoonByWeekday = useMemo(
    () =>
      new Map(
        WEEKDAY_OPTIONS.map((option) => [
          option.value,
          modelRows.find((row) => row.weekday === option.value && row.hour_of_day === FIXED_FORECAST_HOUR) ?? null
        ])
      ),
    [modelRows]
  );
  const loadHistoryWindow = async (weekDates: string[]) => {
    if (!supabase || weekDates.length === 0) {
      setHistoryWindowRows([]);
      return [] as VolumeHistoryUploadRow[];
    }

    setHistoryWindowLoading(true);
    setHistoryWindowError(null);
    const previousDate = toDateOnly(addDays(new Date(`${weekDates[0]}T00:00:00`), -1));
    const res = await supabase
      .from('volume_history')
      .select('*')
      .gte('date', previousDate)
      .lte('date', weekDates[weekDates.length - 1])
      .order('date', { ascending: true });
    if (res.error) {
      setHistoryWindowError(
        /volume_history/i.test(String(res.error.message ?? ''))
          ? t('History inflow table is unavailable. Run the SQL setup first.', 'History inflow table is unavailable. Run the SQL setup first.')
          : String(res.error.message ?? '')
      );
      setHistoryWindowRows([]);
      setHistoryWindowLoading(false);
      return [] as VolumeHistoryUploadRow[];
    }

    const nextRows = ((res.data as VolumeHistoryUploadRow[] | null) ?? []).map((row) => ({ ...row } as VolumeHistoryUploadRow));
    setHistoryWindowRows(nextRows);
    setHistoryWindowLoading(false);
    return nextRows;
  };
  const openManualInputDialog = async () => {
    setManualInputWeekOffset(0);
    setForecastDialogView('weekly');
    const weekDates = getWeekDates(serverTime, 0);
    const historyRows = await loadHistoryWindow(weekDates);
    setManualInputDraftRows(buildManualInputDraftRows(0, historyRows));
    setHistoryPasteDate(getDefaultHistoryPasteDate(weekDates));
    setManualInputSaveError(null);
    setManualInputSaveMessage(null);
    setManualInputDialogOpen(true);
  };
  const openHistoryInflowDialog = async () => {
    setManualInputWeekOffset(0);
    setForecastDialogView('history');
    const weekDates = getWeekDates(serverTime, 0);
    const historyRows = await loadHistoryWindow(weekDates);
    setManualInputDraftRows(buildManualInputDraftRows(0, historyRows));
    setHistoryPasteDate(getDefaultHistoryPasteDate(weekDates));
    setManualInputSaveError(null);
    setManualInputSaveMessage(null);
    setManualInputDialogOpen(true);
  };
  const shiftManualInputWeek = async (delta: number) => {
    const nextOffset = manualInputWeekOffset + delta;
    const nextWeekDates = getWeekDates(serverTime, nextOffset);
    setManualInputWeekOffset(nextOffset);
    const historyRows = await loadHistoryWindow(nextWeekDates);
    setManualInputDraftRows(buildManualInputDraftRows(nextOffset, historyRows));
    setHistoryPasteDate((current) => (nextWeekDates.includes(current) ? current : getDefaultHistoryPasteDate(nextWeekDates)));
    setManualInputSaveError(null);
  };
  const closeManualInputDialog = () => {
    if (manualInputSaving) return;
    setManualInputDialogOpen(false);
    setManualInputSaveError(null);
  };
  const parsePastedVolumeHistoryRows = (text: string, selectedDate?: string) => {
    const rows = parseTabSeparatedRows(text);
    if (rows.length === 0) {
      throw new Error(t('没有检测到可粘贴的数据。', 'No paste data detected.'));
    }

    const allCells = rows.flat().filter((cell) => String(cell ?? '').trim().length > 0);
    const hasExplicitDate = rows.some((row) => row.some((cell) => isValidDateOnly(normalizeImportedDate(cell))));
    if (!hasExplicitDate && selectedDate && isValidDateOnly(selectedDate)) {
      const numericValues = allCells.map(parseNumericCell);
      if (numericValues.every((value) => value !== null) && numericValues.length > 0) {
        let hourStart = 0;
        if (numericValues.length >= 26) {
          const maybeWeekday = numericValues[0] ?? null;
          const maybeTotal = numericValues[1] ?? null;
          const hours = numericValues.slice(2, 26) as number[];
          const totalHours = hours.reduce((sum, value) => sum + value, 0);
          if (maybeWeekday && maybeWeekday >= 1 && maybeWeekday <= 7 && maybeTotal !== null && Math.abs(totalHours - maybeTotal) <= 3) {
            hourStart = 2;
          }
        }
        if (hourStart === 0 && numericValues.length >= 25) {
          const maybeTotal = numericValues[0] ?? null;
          const hours = numericValues.slice(1, 25) as number[];
          const totalHours = hours.reduce((sum, value) => sum + value, 0);
          if (maybeTotal !== null && Math.abs(totalHours - maybeTotal) <= 3) {
            hourStart = 1;
          }
        }
        const hours = numericValues.slice(hourStart, hourStart + 24) as number[];
        const nextRow = { date: selectedDate } as VolumeHistoryUploadRow;
        nextRow.last_filled_hour = hours.length > 0 ? Math.max(0, Math.min(23, hourStart + hours.length - 1)) : null;
        HOUR_COLUMNS.forEach((hourKey, index) => {
          nextRow[hourKey] = Number(hours[index] ?? 0);
        });
        return [nextRow];
      }
    }

    const parsedRows = new Map<string, VolumeHistoryUploadRow>();
    for (const [rowIndex, row] of rows.entries()) {
      const dateIndex = row.findIndex((cell) => isValidDateOnly(normalizeImportedDate(cell)));
      if (dateIndex < 0) continue;
      const dateValue = normalizeImportedDate(row[dateIndex]);
      if (!isValidDateOnly(dateValue)) continue;

      const trailingCells = row.slice(dateIndex + 1);
      const numericCells = trailingCells.map(parseNumericCell);
      if (numericCells.some((value) => value === null)) {
        throw new Error(t(`第 ${rowIndex + 1} 行包含无效数字。`, `Row ${rowIndex + 1} contains invalid numbers.`));
      }

      let hourStart = 0;
      if (numericCells.length >= 26) {
        const maybeWeekday = numericCells[0] ?? null;
        const maybeTotal = numericCells[1] ?? null;
        const hours = numericCells.slice(2, 26) as number[];
        const totalHours = hours.reduce((sum, value) => sum + value, 0);
        if (maybeWeekday && maybeWeekday >= 1 && maybeWeekday <= 7 && maybeTotal !== null && Math.abs(totalHours - maybeTotal) <= 3) {
          hourStart = 2;
        }
      }
      if (hourStart === 0 && numericCells.length >= 25) {
        const maybeTotal = numericCells[0] ?? null;
        const hours = numericCells.slice(1, 25) as number[];
        const totalHours = hours.reduce((sum, value) => sum + value, 0);
        if (maybeTotal !== null && Math.abs(totalHours - maybeTotal) <= 3) {
          hourStart = 1;
        }
      }

      const hours = numericCells.slice(hourStart, hourStart + 24);
      if (hours.length === 0) continue;
      const nextRow = { date: dateValue } as VolumeHistoryUploadRow;
      nextRow.last_filled_hour = Math.max(0, Math.min(23, hourStart + hours.length - 1));
      HOUR_COLUMNS.forEach((hourKey, index) => {
        nextRow[hourKey] = Number(hours[index] ?? 0);
      });
      parsedRows.set(dateValue, nextRow);
    }

    const output = Array.from(parsedRows.values()).sort((a, b) => a.date.localeCompare(b.date));
    if (output.length === 0 && selectedDate && isValidDateOnly(selectedDate)) {
      const numericValues = allCells.map(parseNumericCell);
      if (numericValues.every((value) => value !== null) && numericValues.length > 0) {
        let hourStart = 0;
        if (numericValues.length >= 26) {
          const maybeWeekday = numericValues[0] ?? null;
          const maybeTotal = numericValues[1] ?? null;
          const hours = numericValues.slice(2, 26) as number[];
          const totalHours = hours.reduce((sum, value) => sum + value, 0);
          if (maybeWeekday && maybeWeekday >= 1 && maybeWeekday <= 7 && maybeTotal !== null && Math.abs(totalHours - maybeTotal) <= 3) {
            hourStart = 2;
          }
        }
        if (hourStart === 0 && numericValues.length >= 25) {
          const maybeTotal = numericValues[0] ?? null;
          const hours = numericValues.slice(1, 25) as number[];
          const totalHours = hours.reduce((sum, value) => sum + value, 0);
          if (maybeTotal !== null && Math.abs(totalHours - maybeTotal) <= 3) {
            hourStart = 1;
          }
        }
        const hours = numericValues.slice(hourStart, hourStart + 24) as number[];
        if (hours.length > 0) {
          const nextRow = { date: selectedDate } as VolumeHistoryUploadRow;
          nextRow.last_filled_hour = Math.max(0, Math.min(23, hourStart + hours.length - 1));
          HOUR_COLUMNS.forEach((hourKey, index) => {
            nextRow[hourKey] = Number(hours[index] ?? 0);
          });
          output.push(nextRow);
        }
      }
    }
    if (output.length === 0) {
      throw new Error(
        t('未能从粘贴内容中识别日期和小时数据。可先选择日期后仅粘贴前几个小时数字。', 'Could not detect date and hourly values. You can select a date first and paste only the first few hourly values.')
      );
    }
    return output;
  };
  const applyPastedHistoryData = async () => {
    if (!supabase) {
      setUploadError(t('Missing Supabase configuration.', 'Missing Supabase configuration.'));
      return;
    }
    if (!isValidDateOnly(historyPasteDate) || !currentWeekDates.includes(historyPasteDate)) {
      setUploadError(t('请选择当前周范围内的日期。', 'Please select a date within the current week window.'));
      return;
    }

    setUploadError(null);
    setUploadMessage(null);
    setHistoryWindowError(null);
    setHistoryPasteSaving(true);
    try {
      const parsedRows = parsePastedVolumeHistoryRows(historyPasteValue, historyPasteDate);
      const upsertRes = await upsertVolumeHistoryRows(parsedRows);
      if (upsertRes.error) {
        throw new Error(String(upsertRes.error.message ?? 'Paste apply failed.'));
      }
      await verifyVolumeHistoryRowsPersisted(parsedRows);
      mergeHistoryRows(parsedRows);
      setUploadMessage(formatHistoryPasteSuccess(parsedRows));
      setHistoryPasteValue('');
      await Promise.all([loadModel(lookbackMode), loadHistoryWindow(currentWeekDates), loadAutoForecastSnapshot(selectedWeekday)]);
    } catch (err) {
      setUploadError(String((err as any)?.message ?? err ?? 'Paste apply failed.'));
    } finally {
      setHistoryPasteSaving(false);
    }
  };
  const upsertVolumeHistoryRows = async (rows: VolumeHistoryUploadRow[]) => {
    let upsertRes = await supabase.from('volume_history').upsert(rows as any[], { onConflict: 'date' });
    if (upsertRes.error && isMissingColumnError(upsertRes.error, 'last_filled_hour', 'volume_history')) {
      const fallbackRows = rows.map(({ last_filled_hour: _omit, ...rest }) => rest);
      upsertRes = await supabase.from('volume_history').upsert(fallbackRows as any[], { onConflict: 'date' });
    }
    return upsertRes;
  };
  const verifyVolumeHistoryRowsPersisted = async (rows: VolumeHistoryUploadRow[]) => {
    if (!supabase || rows.length === 0) return;

    const expectedByDate = new Map(rows.map((row) => [row.date, row]));
    const expectedDates = Array.from(expectedByDate.keys());
    const res = await supabase.from('volume_history').select('*').in('date', expectedDates);
    if (res.error) {
      throw new Error(String(res.error.message ?? 'Failed to verify pasted rows.'));
    }

    const actualByDate = new Map((((res.data as VolumeHistoryUploadRow[] | null) ?? [])).map((row) => [row.date, row]));
    const missingDates = expectedDates.filter((date) => !actualByDate.has(date));
    if (missingDates.length > 0) {
      throw new Error(
        t(
          `数据库没有保存这些日期的数据：${missingDates.join(', ')}。请检查 volume_history 表是否已应用 SQL 迁移，并确认该表允许当前登录用户 insert/update。`,
          `The database did not persist these dates: ${missingDates.join(', ')}. Check that volume_history has the required SQL migrations and that the current user can insert/update this table.`
        )
      );
    }

    const mismatchedDates = expectedDates.filter((date) => {
      const expected = expectedByDate.get(date);
      const actual = actualByDate.get(date);
      if (!expected || !actual) return false;
      return HOUR_COLUMNS.some((hourKey) => Number(expected[hourKey] ?? 0) !== Number(actual[hourKey] ?? 0));
    });
    if (mismatchedDates.length > 0) {
      throw new Error(
        t(
          `数据库已返回这些日期，但小时数据不一致：${mismatchedDates.join(', ')}。这通常是表触发器、约束或写入权限导致的。`,
          `The database returned these dates, but the hourly values do not match: ${mismatchedDates.join(', ')}. This usually means a trigger, constraint, or write-permission issue.`
        )
      );
    }
  };
  const mergeHistoryRows = (rows: VolumeHistoryUploadRow[]) => {
    if (rows.length === 0) return;
    setHistoryWindowRows((prev) => {
      const merged = new Map(prev.map((row) => [row.date, row]));
      for (const row of rows) {
        merged.set(row.date, { ...merged.get(row.date), ...row });
      }
      return Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));
    });
  };
  const formatHistoryPasteSuccess = (rows: VolumeHistoryUploadRow[]) => {
    if (rows.length !== 1) {
      return t(`粘贴成功：${rows.length} 行。`, `Paste applied: ${rows.length} row(s).`);
    }
    const row = rows[0];
    const filledHours = row.last_filled_hour === null || row.last_filled_hour === undefined ? inferLastFilledHour(row) : Number(row.last_filled_hour);
    const hourCount = filledHours === null ? 0 : filledHours + 1;
    const total = HOUR_COLUMNS.reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0);
    return t(`已写入 ${row.date}，${hourCount} 小时，合计 ${formatNumber(total)}。`, `Saved ${row.date}, ${hourCount} hours, total ${formatNumber(total)}.`);
  };
  const saveManualInput = async () => {
    if (!supabase) {
      setManualInputSaveError(t('Missing Supabase configuration.', 'Missing Supabase configuration.'));
      return;
    }

    const payloadRows: Array<{
      input_date: string;
      previous_day_backlog: number;
      current_cumulative_volume_12: number;
      inventory_level: number;
      severe_weather: boolean;
      full_day_capacity: number;
      yesterday_inflow_00_14: number;
    }> = [];
    for (const draftRow of manualInputDraftRows) {
      const inputDate = String(draftRow.input_date ?? '').trim();
      if (!isValidDateOnly(inputDate)) {
        setManualInputSaveError(t('Please enter valid dates in YYYY-MM-DD format.', 'Please enter valid dates in YYYY-MM-DD format.'));
        return;
      }

      const previousDayBacklog = parseNonNegativeInt(draftRow.previous_day_backlog);
      const inventoryLevel = parseNonNegativeInt(draftRow.inventory_level);
      const existingManualRow = manualInputRows.find((row) => row.input_date === inputDate);
      const fullDayCapacity = parseNonNegativeInt(draftRow.full_day_capacity);
      const yesterdayInflow0014 = parseNonNegativeInt(draftRow.yesterday_inflow_00_14);
      if (
        previousDayBacklog === null ||
        inventoryLevel === null ||
        fullDayCapacity === null ||
        yesterdayInflow0014 === null
      ) {
        setManualInputSaveError(t('Please enter non-negative integers for all filled fields.', 'Please enter non-negative integers for all filled fields.'));
        return;
      }

      const hasAnyValue = [
        draftRow.previous_day_backlog,
        draftRow.inventory_level,
        draftRow.full_day_capacity,
        draftRow.yesterday_inflow_00_14
      ].some((value) => String(value ?? '').trim() !== '') || draftRow.severe_weather;
      if (!hasAnyValue) continue;

      payloadRows.push({
        input_date: inputDate,
        previous_day_backlog: previousDayBacklog ?? 0,
        current_cumulative_volume_12: Number(existingManualRow?.current_cumulative_volume_12 ?? 0),
        inventory_level: inventoryLevel ?? 0,
        severe_weather: Boolean(draftRow.severe_weather),
        full_day_capacity: fullDayCapacity ?? 0,
        yesterday_inflow_00_14: yesterdayInflow0014 ?? 0
      });
    }

    setManualInputSaving(true);
    setManualInputSaveError(null);
    if (payloadRows.length === 0) {
      setManualInputSaving(false);
      setManualInputSaveError(t('Please fill at least one row before saving.', 'Please fill at least one row before saving.'));
      return;
    }
    const res = await supabase.from(FORECAST_INPUT_TABLE).upsert(payloadRows, { onConflict: 'input_date' });
    if (res.error) {
      setManualInputSaveError(
        /volume_forecast/i.test(String(res.error.message ?? ''))
          ? t('Manual input table is unavailable. Run the SQL setup first.', 'Manual input table is unavailable. Run the SQL setup first.')
          : String(res.error.message ?? '')
      );
      setManualInputSaving(false);
      return;
    }

    await loadManualInputs();
    setManualInputSaving(false);
    setManualInputDialogOpen(false);
    setManualInputSaveMessage(t(`已保存 ${payloadRows.length} 行。`, `Saved ${payloadRows.length} row(s).`));
  };

  const maxSelectableForecastHour = autoForecastSnapshot?.cutoffHour ?? FIXED_FORECAST_HOUR;
  const forecastHourOptions = useMemo(
    () =>
      autoForecastSnapshot?.cutoffHour
        ? Array.from({ length: autoForecastSnapshot.cutoffHour }, (_, index) => index + 1)
        : [FIXED_FORECAST_HOUR],
    [autoForecastSnapshot?.cutoffHour]
  );
  const effectiveForecastHour = Math.max(1, Math.min(maxSelectableForecastHour, selectedForecastHour));
  const selectedCoefficient = useMemo(
    () => modelRows.find((row) => row.weekday === selectedWeekday && row.hour_of_day === effectiveForecastHour) ?? null,
    [effectiveForecastHour, modelRows, selectedWeekday]
  );

  const hasManualInput = Boolean(selectedManualInput);
  const hasAutoForecastSnapshot = Boolean(autoForecastSnapshot);
  const currentCumVolume = hasAutoForecastSnapshot
    ? Math.max(
        0,
        Number(
          autoForecastSnapshot?.row
            ? calculateCumulativeVolume(autoForecastSnapshot.row as Pick<VolumeHistoryUploadRow, HourColumnKey>, effectiveForecastHour)
            : autoForecastSnapshot?.currentCumVolume ?? 0
        ) || 0
      )
    : hasManualInput
      ? Math.max(0, Number(selectedManualInput?.current_cumulative_volume_12 ?? 0) || 0)
      : 0;
  const result = useMemo(
    () =>
      hasAutoForecastSnapshot || hasManualInput
        ? calculateForecast(currentCumVolume, effectiveForecastHour, selectedWeekday, selectedCoefficient)
        : {
            forecast: null,
            lowerBound: null,
            upperBound: null,
            upperUnbounded: false,
            avgShare: Number(selectedCoefficient?.avg_share ?? 0),
            stddevShare: Number(selectedCoefficient?.stddev_share ?? 0),
            sampleSize: Math.max(0, Number(selectedCoefficient?.sample_size ?? 0))
          },
    [currentCumVolume, effectiveForecastHour, hasAutoForecastSnapshot, hasManualInput, selectedCoefficient, selectedWeekday]
  );
  const dayShiftForecast = useMemo(() => {
    const currentInputDate = latestSelectedWeekdayCardRow?.input_date ?? null;
    if (!currentInputDate) return null;
    const previousDate = toDateOnly(addDays(new Date(`${currentInputDate}T00:00:00`), -1));
    const previousDayRow = manualInputByDate.get(previousDate);
    if (!previousDayRow) return null;

    const previousDayBacklog = Number(previousDayRow.previous_day_backlog ?? 0);
    const todayForecast = Number(result.forecast ?? 0);
    const previousDayCapacity = Number(previousDayRow.full_day_capacity ?? 0);
    const previousDayInflow0014 = Number(previousDayRow.yesterday_inflow_00_14 ?? 0);

    return Math.round(previousDayBacklog + todayForecast - previousDayCapacity + previousDayInflow0014 - 2000);
  }, [latestSelectedWeekdayCardRow, manualInputByDate, result.forecast]);

  const weekdayRows = useMemo(
    () => modelRows.filter((row) => row.weekday === selectedWeekday).sort((a, b) => a.hour_of_day - b.hour_of_day),
    [modelRows, selectedWeekday]
  );
  const weekdayRowsWithHourShare = useMemo(
    () =>
      weekdayRows.map((row, index) => {
        const previousAvgShare = index > 0 ? Number(weekdayRows[index - 1]?.avg_share ?? 0) : 0;
        return {
          ...row,
          hour_share: Math.max(0, Number(row.avg_share ?? 0) - previousAvgShare)
        };
      }),
    [weekdayRows]
  );
  const manualInputRangeLabel =
    manualInputDraftRows.length > 0
      ? `${manualInputDraftRows[0].input_date} - ${manualInputDraftRows[manualInputDraftRows.length - 1].input_date}`
      : '';

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
      let lastFilledHour = -1;
      for (const hourKey of HOUR_COLUMNS) {
        const idx = normalizedHeaders.findIndex((normalized) => HOUR_HEADER_ALIASES.get(normalized) === hourKey);
        const rawValue = String(idx == null ? '' : raw[idx] ?? '').trim();
        const num = rawValue === '' ? 0 : Number(rawValue);
        if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
          throw new Error(t(`Row ${rowIndex + 1} has invalid ${hourKey}.`, `Row ${rowIndex + 1} has invalid ${hourKey}.`));
        }
        if (rawValue !== '') lastFilledHour = Number(hourKey.slice(1));
        nextRow[hourKey] = num;
      }
      nextRow.last_filled_hour = lastFilledHour >= 0 ? lastFilledHour : null;
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
      const upsertRes = await upsertVolumeHistoryRows(parsedRows);
      if (upsertRes.error) {
        throw new Error(String(upsertRes.error.message ?? 'Upload failed.'));
      }
      await verifyVolumeHistoryRowsPersisted(parsedRows);
      mergeHistoryRows(parsedRows);
      setUploadMessage(t(`Upload successful: ${parsedRows.length} day rows.`, `Upload successful: ${parsedRows.length} day rows.`));
      await Promise.all([loadModel(lookbackMode), loadHistoryWindow(currentWeekDates), loadAutoForecastSnapshot(selectedWeekday)]);
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
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {WEEKDAY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={isLocked}
              onClick={() => setSelectedWeekday(option.value)}
              className={weekdayButtonClass(option.value)}
            >
              {t(option.zh, option.shortEn)}
            </button>
          ))}
          <button
            type="button"
            disabled={isLocked || manualInputsLoading}
            onClick={openManualInputDialog}
            className={primaryActionButtonClass}
          >
            {t('填数据', 'Fill data')}
          </button>
          <button
            type="button"
            disabled={isLocked || manualInputsLoading}
            onClick={openHistoryInflowDialog}
            className={secondaryActionButtonClass}
          >
            {t('历史流入', 'History inflow')}
          </button>
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
              {uploadError && (
                <div
                  className={[
                    'mt-3 rounded-2xl border px-3 py-2 text-sm',
                    isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                  ].join(' ')}
                >
                  {uploadError}
                </div>
              )}
              {uploadMessage && (
                <div
                  className={[
                    'mt-3 rounded-2xl border px-3 py-2 text-sm',
                    isLight ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  ].join(' ')}
                >
                  {uploadMessage}
                </div>
              )}
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

            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em]', labelClass].join(' ')}>
                <span>{t('日期列表', 'Date list')}</span>
                <span>{t(selectedWeekdayOption.zh, selectedWeekdayOption.en)}</span>
              </div>
              <div className={['mt-3 max-h-[300px] space-y-2 overflow-auto rounded-2xl p-2', tableWrapClass].join(' ')}>
                {!latestSelectedWeekdayCardRow ? (
                  <div className={['px-3 py-6 text-center text-xs', helperClass].join(' ')}>
                    {manualInputsLoading ? t('Loading...', 'Loading...') : t('No saved rows', 'No saved rows')}
                  </div>
                ) : (
                  [latestSelectedWeekdayCardRow].map((row, index) => (
                    <div
                      key={row.input_date}
                      className={[
                        'rounded-2xl border p-3',
                        isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-black/20',
                        index === 0 && isLight ? 'border-emerald-200 bg-emerald-50/60' : '',
                        index === 0 && !isLight ? 'border-emerald-500/30 bg-emerald-500/5' : ''
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className={['text-sm font-semibold', index === 0 ? (isLight ? 'text-emerald-800' : 'text-emerald-300') : valueClass].join(' ')}>
                          {row.input_date}
                        </div>
                        <div className={['text-[10px] uppercase tracking-[0.18em]', labelClass].join(' ')}>
                          {index === 0 ? t('最新', 'Latest') : t(selectedWeekdayOption.zh, selectedWeekdayOption.shortEn)}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <div>
                          <div className={labelClass}>{t('积压', 'Backlog')}</div>
                          <div className={valueClass}>{formatNumber(row.previous_day_backlog)}</div>
                        </div>
                        <div>
                          <div className={labelClass}>{t('今日预测(12点)', 'Predicted today (12:00)')}</div>
                          <div className={valueClass}>{formatNumber(row.predicted_full_day_volume_12)}</div>
                        </div>
                        <div>
                          <div className={labelClass}>{t('库存量', 'Inventory')}</div>
                          <div className={valueClass}>{formatNumber(row.inventory_level)}</div>
                        </div>
                        <div>
                          <div className={labelClass}>{t('恶劣天气', 'Severe weather')}</div>
                          <div className={valueClass}>{row.severe_weather ? t('是', 'Yes') : t('否', 'No')}</div>
                        </div>
                        <div>
                          <div className={labelClass}>{t('全天产能', 'Capacity')}</div>
                          <div className={valueClass}>{formatNumber(row.full_day_capacity)}</div>
                        </div>
                        <div>
                          <div className={labelClass}>{t('昨日0-14流入', 'Yday 0-14 inflow')}</div>
                          <div className={valueClass}>{formatNumber(row.yesterday_inflow_00_14)}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className={['mt-3 flex items-center justify-between gap-2 text-sm', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                <span className={labelClass}>{t('预测截止至', 'Forecast cutoff')}</span>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  {hasAutoForecastSnapshot && <span className={['text-sm font-medium', helperClass].join(' ')}>{autoForecastSnapshot?.date}</span>}
                  <select
                    value={String(effectiveForecastHour)}
                    disabled={isLocked || loading || forecastHourOptions.length <= 1}
                    onChange={(e) => setSelectedForecastHour(Number(e.target.value))}
                    className={[
                      'h-10 min-w-[84px] rounded-xl px-3 text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                      isLight ? 'border border-slate-300 bg-white text-slate-900' : 'border border-white/10 bg-black/30 text-white'
                    ].join(' ')}
                  >
                    {forecastHourOptions.map((hour) => (
                      <option key={hour} value={hour}>
                        {`${String(hour).padStart(2, '0')}:00`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {manualInputsError && (
                <div
                  className={[
                    'mt-3 rounded-2xl border px-3 py-2 text-sm',
                    isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                  ].join(' ')}
                >
                  {manualInputsError}
                </div>
              )}
              {manualInputSaveMessage && (
                <div
                  className={[
                    'mt-3 rounded-2xl border px-3 py-2 text-sm',
                    isLight ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  ].join(' ')}
                >
                  {manualInputSaveMessage}
                </div>
              )}
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

            {error && (
              <div
                className={[
                  'rounded-2xl border px-4 py-3 text-sm',
                  isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                ].join(' ')}
              >
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="grid min-w-0 gap-4">
          <div className={['min-w-0 rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <div className={['rounded-2xl border p-4', isLight ? 'border-teal-200 bg-teal-50' : 'border-teal-400/20 bg-teal-500/10'].join(' ')}>
                <div className={['text-[10px] uppercase tracking-[0.18em]', isLight ? 'text-teal-700/80' : 'text-teal-200/70'].join(' ')}>{t('预测范围下限', 'Lower')}</div>
                <div className={['mt-3 font-display text-4xl tracking-[0.06em]', isLight ? 'text-teal-900' : 'text-teal-200'].join(' ')}>
                  {formatNumber(result.lowerBound)}
                </div>
              </div>
              <div className={['rounded-2xl border p-4', isLight ? 'border-emerald-200 bg-emerald-50' : 'border-emerald-400/20 bg-emerald-500/10'].join(' ')}>
                <div className={['text-[10px] uppercase tracking-[0.18em]', isLight ? 'text-emerald-700/80' : 'text-emerald-200/70'].join(' ')}>{t('预测全天件量', 'Forecast')}</div>
                <div className={['mt-3 font-display text-4xl tracking-[0.06em]', isLight ? 'text-emerald-900' : 'text-emerald-200'].join(' ')}>
                  {formatNumber(result.forecast)}
                </div>
              </div>
              <div className={['rounded-2xl border p-4', isLight ? 'border-sky-200 bg-sky-50' : 'border-sky-400/20 bg-sky-500/10'].join(' ')}>
                <div className={['text-[10px] uppercase tracking-[0.18em]', isLight ? 'text-sky-700/80' : 'text-sky-200/70'].join(' ')}>{t('预测范围上限', 'Upper')}</div>
                <div className={['mt-3 font-display text-4xl tracking-[0.06em]', isLight ? 'text-sky-900' : 'text-sky-200'].join(' ')}>
                  {formatNumber(result.upperBound)}
                </div>
              </div>
              <div className={['rounded-2xl border p-4', isLight ? 'border-amber-200 bg-amber-50' : 'border-amber-400/20 bg-amber-500/10'].join(' ')}>
                <div className={['text-[10px] uppercase tracking-[0.18em]', isLight ? 'text-amber-700/80' : 'text-amber-200/70'].join(' ')}>{t('明日白班预测', 'Next day shift forecast')}</div>
                <div className={['mt-3 font-display text-4xl tracking-[0.06em]', isLight ? 'text-amber-900' : 'text-amber-200'].join(' ')}>
                  {formatNumber(dayShiftForecast)}
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

          <div className={['min-w-0 rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className={['text-sm font-semibold', valueClass].join(' ')}>{t('单量趋势', 'Volume trend')}</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StyledDateInput value={volumeTrendRangeStart} onChange={setVolumeTrendRangeStart} themeMode={themeMode} max={volumeTrendRangeEnd} />
                <span className={helperClass}>to</span>
                <StyledDateInput value={volumeTrendRangeEnd} onChange={setVolumeTrendRangeEnd} themeMode={themeMode} min={volumeTrendRangeStart} />
              </div>
            </div>
            <div className={['mb-3 text-xs', helperClass].join(' ')}>{t('预测 / 当前范围 / 上一周期', 'Forecast / Current range / Previous period')}</div>
            <div className={['rounded-2xl p-4', chartWrapClass].join(' ')}>
              <WeekVolumeLineChart themeMode={themeMode} labels={weekVolumeTrendSeries.labels} series={weekVolumeTrendSeries.series} />
            </div>
          </div>

          <div className={['min-w-0 rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className={['text-sm font-semibold', valueClass].join(' ')}>
                {t('库存转换率', 'Inventory turnover rate')}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StyledDateInput
                  value={inventoryTrendRangeStart}
                  onChange={setInventoryTrendRangeStart}
                  themeMode={themeMode}
                  max={inventoryTrendRangeEnd}
                />
                <span className={helperClass}>to</span>
                <StyledDateInput
                  value={inventoryTrendRangeEnd}
                  onChange={setInventoryTrendRangeEnd}
                  themeMode={themeMode}
                  min={inventoryTrendRangeStart}
                />
              </div>
            </div>
            <div className={['rounded-2xl p-4', chartWrapClass].join(' ')}>
              <WeekVolumeLineChart
                themeMode={themeMode}
                labels={inventoryConversionTrendSeries.labels}
                series={inventoryConversionTrendSeries.series}
                valueFormatter={(value) => formatPercent(value, 2)}
                yAxisFormatter={(value) => formatPercent(value, 2)}
                labelStride={3}
                maxValueOverride={0.01}
              />
            </div>
          </div>

          <div className={['min-w-0 rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className={['text-sm font-semibold', valueClass].join(' ')}>{t('历史流入', 'Historical inflow')}</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StyledDateInput value={historyTableRangeStart} onChange={setHistoryTableRangeStart} themeMode={themeMode} max={historyTableRangeEnd} />
                <span className={helperClass}>to</span>
                <StyledDateInput value={historyTableRangeEnd} onChange={setHistoryTableRangeEnd} themeMode={themeMode} min={historyTableRangeStart} />
              </div>
            </div>
            <div className="min-w-0 overflow-x-auto overflow-y-hidden">
              <div className={['min-w-0 rounded-2xl', tableWrapClass].join(' ')}>
              <table className="min-w-[2100px] table-fixed text-left text-xs">
                <thead className={['text-[10px] uppercase tracking-[0.16em]', tableHeadClass].join(' ')}>
                  <tr>
                    <th className="px-3 py-2">{t('日期', 'Date')}</th>
                    <th className="px-3 py-2">{t('星期', 'Weekday')}</th>
                    <th className="px-3 py-2">{t('截止12点预测', '12:00 forecast')}</th>
                    <th className="px-3 py-2">{t('实际差异', 'Actual variance')}</th>
                    <th className="px-3 py-2">{t('当日总流入', 'Daily total')}</th>
                    <th className="px-3 py-2">{t('库存转换率', 'ITR')}</th>
                    <th className="px-3 py-2">{t('恶劣天气', 'Severe weather')}</th>
                    {HOUR_COLUMNS.map((hourKey, index) => (
                      <th key={`page-${hourKey}`} className="px-3 py-2">{`${String(index).padStart(2, '0')}:00`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyTableDates.map((date) => {
                    const row = rangeHistoryByDate.get(date);
                    const weekday = getWeekdayFromDateOnly(date) ?? 1;
                    const noonCoefficient = forecastAtNoonByWeekday.get(weekday) ?? null;
                    const lastFilledHour = row ? Number(row.last_filled_hour ?? inferLastFilledHour(row)) : null;
                    const hasReachedNoonCutoff = lastFilledHour !== null && lastFilledHour >= FIXED_FORECAST_HOUR - 1;
                    const noonCumulative =
                      row && hasReachedNoonCutoff ? calculateCumulativeVolume(row as Pick<VolumeHistoryUploadRow, HourColumnKey>, FIXED_FORECAST_HOUR) : null;
                    const noonForecastResult =
                      row && noonCumulative !== null ? calculateForecast(noonCumulative, FIXED_FORECAST_HOUR, weekday, noonCoefficient) : null;
                    const noonForecast = noonForecastResult?.forecast ?? null;
                    const dailyTotal = row ? HOUR_COLUMNS.reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0) : null;
                    const manualInputRow = manualInputByDate.get(date);
                    const inventoryLevel = Number(manualInputRow?.inventory_level ?? 0);
                    const severeWeather = Boolean(manualInputRow?.severe_weather ?? false);
                    const isCompleteDay = lastFilledHour !== null && lastFilledHour >= 23;
                    const actualVariance =
                      isCompleteDay && dailyTotal !== null && noonForecast !== null && noonForecast > 0
                        ? (dailyTotal - noonForecast) / noonForecast
                        : null;
                    const itr = dailyTotal !== null && inventoryLevel > 0 ? dailyTotal / inventoryLevel : null;
                    return (
                      <tr key={`page-history-${date}`} className={tableRowClass}>
                        <td className="px-3 py-2 font-semibold">{date}</td>
                        <td className="px-3 py-2">
                          {t(WEEKDAY_OPTIONS[weekday - 1]?.zh ?? '周一', WEEKDAY_OPTIONS[weekday - 1]?.shortEn ?? 'Mon')}
                        </td>
                        <td className="px-3 py-2">{formatNumber(noonForecast)}</td>
                        <td className="px-3 py-2">{actualVariance === null ? '-' : formatPercent(actualVariance, 2)}</td>
                        <td className="px-3 py-2">{formatNumber(dailyTotal)}</td>
                        <td className="px-3 py-2">{itr === null ? '-' : formatPercent(itr, 2)}</td>
                        <td className="px-3 py-2">{severeWeather ? t('是', 'Yes') : t('否', 'No')}</td>
                        {HOUR_COLUMNS.map((hourKey) => (
                          <td key={`page-${date}-${hourKey}`} className="px-3 py-2">
                            {row ? formatNumber(Number(row[hourKey] ?? 0)) : '-'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {loading && historyTableDates.length === 0 && (
                    <tr>
                      <td colSpan={HOUR_COLUMNS.length + 7} className={['px-3 py-6 text-center', helperClass].join(' ')}>
                        {t('Loading...', 'Loading...')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </div>

          <div className={['min-w-0 rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className={['text-sm font-semibold', valueClass].join(' ')}>
                {t('周维度流入', 'Weekly inflow')}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StyledDateInput value={weeklyTableRangeStart} onChange={setWeeklyTableRangeStart} themeMode={themeMode} max={weeklyTableRangeEnd} />
                <span className={helperClass}>to</span>
                <StyledDateInput value={weeklyTableRangeEnd} onChange={setWeeklyTableRangeEnd} themeMode={themeMode} min={weeklyTableRangeStart} />
              </div>
            </div>
            <div className="min-w-0 overflow-x-auto overflow-y-hidden">
              <div className={['min-w-0 rounded-2xl', tableWrapClass].join(' ')}>
                <table className="w-full min-w-[960px] table-fixed text-left text-xs">
                  <thead className={['text-[10px] uppercase tracking-[0.16em]', tableHeadClass].join(' ')}>
                    <tr>
                      <th className="w-[220px] px-3 py-2">{t('Week', 'Week')}</th>
                      {WEEKDAY_OPTIONS.map((option) => (
                        <th key={`weekly-${option.value}`} className="px-3 py-2 text-right">
                          {t(option.zh, option.shortEn)}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right">{t('Total', 'Total')}</th>
                      <th className="w-[120px] px-3 py-2 text-right">{t('日均流入', 'Avg/Day')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyInflowTableRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className={['px-3 py-6 text-center', helperClass].join(' ')}>
                          {loading ? t('Loading...', 'Loading...') : t('No weekly inflow data', 'No weekly inflow data')}
                        </td>
                      </tr>
                    ) : (
                      weeklyInflowTableRows.map((row) => (
                        <tr key={row.weekStart} className={tableRowClass}>
                          <td className="px-3 py-2 font-semibold">
                            <div className="flex items-center justify-between gap-3">
                              <span>{row.weekStart}</span>
                              <span className={helperClass}>to</span>
                              <span>{row.weekEnd}</span>
                            </div>
                          </td>
                          {row.dayValues.map((value, index) => (
                            <td key={`${row.weekStart}-${index}`} className="px-3 py-2 text-right">
                              {value === null ? '-' : formatNumber(value)}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-semibold">{formatNumber(row.total)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatNumber(row.averagePerCompleteDay)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className={['min-w-0 rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className={['text-sm font-semibold', valueClass].join(' ')}>
                {t('月维度流入', 'Monthly inflow')}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StyledDateInput value={monthlyTableRangeStart} onChange={setMonthlyTableRangeStart} themeMode={themeMode} max={monthlyTableRangeEnd} disabled={isLocked} />
                <span className={helperClass}>to</span>
                <StyledDateInput value={monthlyTableRangeEnd} onChange={setMonthlyTableRangeEnd} themeMode={themeMode} min={monthlyTableRangeStart} disabled={isLocked} />
              </div>
            </div>
            <div className="min-w-0 overflow-x-auto overflow-y-hidden">
              <div className={['min-w-0 rounded-2xl', tableWrapClass].join(' ')}>
                <table className="w-full min-w-[640px] table-fixed text-left text-xs">
                  <thead className={['text-[10px] uppercase tracking-[0.16em]', tableHeadClass].join(' ')}>
                    <tr>
                      <th className="w-[180px] px-3 py-2">{t('Month', 'Month')}</th>
                      <th className="w-[120px] px-3 py-2 text-right">{t('天数', 'Days')}</th>
                      <th className="px-3 py-2 text-right">{t('Total', 'Total')}</th>
                      <th className="w-[140px] px-3 py-2 text-right">{t('日均流入', 'Avg/Day')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyInflowTableRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className={['px-3 py-6 text-center', helperClass].join(' ')}>
                          {loading ? t('Loading...', 'Loading...') : t('No monthly inflow data', 'No monthly inflow data')}
                        </td>
                      </tr>
                    ) : (
                      monthlyInflowTableRows.map((row) => (
                        <tr key={row.monthKey} className={tableRowClass}>
                          <td className="px-3 py-2 font-semibold">{row.monthKey}</td>
                          <td className="px-3 py-2 text-right">{row.completeDays}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatNumber(row.total)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatNumber(row.averagePerCompleteDay)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className={['min-w-0 rounded-2xl p-4 shadow-sm', panelClass].join(' ')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className={['text-sm font-semibold', valueClass].join(' ')}>
                {t(`${selectedWeekdayOption.zh}模型快照`, `${selectedWeekdayOption.en} model snapshot`)}
              </div>
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
                    <th className="px-3 py-2">{t('Hours Percentage', 'Hours Percentage')}</th>
                    <th className="px-3 py-2">{t('SD', 'SD')}</th>
                    <th className="px-3 py-2">{t('Sample', 'Sample')}</th>
                  </tr>
                </thead>
                <tbody>
                  {weekdayRowsWithHourShare.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={['px-3 py-6 text-center', helperClass].join(' ')}>
                        {loading ? t('Loading...', 'Loading...') : t('No model data', 'No model data')}
                      </td>
                    </tr>
                  ) : (
                    weekdayRowsWithHourShare.map((row) => (
                      <tr key={`${row.weekday}-${row.hour_of_day}`} className={tableRowClass}>
                        <td className="px-3 py-2">{row.hour_of_day}:00</td>
                        <td className="px-3 py-2">{formatPercent(row.avg_share)}</td>
                        <td className="px-3 py-2">{formatPercent(row.hour_share)}</td>
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

      {manualInputDialogOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={['fixed inset-0 z-[120] flex items-center justify-center px-4 py-6', isLight ? 'bg-slate-900/35' : 'bg-black/65'].join(' ')}
          >
            <div
              className={[
                'w-full max-w-[1360px] min-h-[78vh] rounded-3xl border p-5 shadow-2xl max-h-[92vh] overflow-y-auto',
                isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/95 backdrop-blur'
              ].join(' ')}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={['text-xl font-semibold', valueClass].join(' ')}>
                    {forecastDialogView === 'weekly' ? t('本周数据', 'Weekly data') : t('历史流入数据', 'Historical inflow data')}
                  </div>
                  {manualInputRangeLabel && <div className={['mt-2 text-xs', helperClass].join(' ')}>{manualInputRangeLabel}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={manualInputSaving}
                    onClick={() => setForecastDialogView((current) => (current === 'weekly' ? 'history' : 'weekly'))}
                    className={secondaryButtonClass}
                  >
                    {forecastDialogView === 'weekly' ? t('历史流入', 'History inflow') : t('本周数据', 'Weekly data')}
                  </button>
                  <button
                    type="button"
                    disabled={manualInputSaving}
                    onClick={() => shiftManualInputWeek(1)}
                    className={secondaryButtonClass}
                  >
                    {t('上一周', 'Prev week')}
                  </button>
                  <button
                    type="button"
                    disabled={manualInputSaving || manualInputWeekOffset === 0}
                    onClick={() => shiftManualInputWeek(-1)}
                    className={secondaryButtonClass}
                  >
                    {t('下一周', 'Next week')}
                  </button>
                  <button
                    type="button"
                    disabled={manualInputSaving || manualInputWeekOffset === 0}
                    onClick={async () => {
                      const weekDates = getWeekDates(serverTime, 0);
                      const historyRows = await loadHistoryWindow(weekDates);
                      setManualInputWeekOffset(0);
                      setManualInputDraftRows(buildManualInputDraftRows(0, historyRows));
                      setHistoryPasteDate(getDefaultHistoryPasteDate(weekDates));
                      setManualInputSaveError(null);
                    }}
                    className={secondaryButtonClass}
                  >
                    {t('本周', 'This week')}
                  </button>
                  <button type="button" disabled={manualInputSaving} onClick={closeManualInputDialog} className={secondaryButtonClass}>
                    {t('关闭', 'Close')}
                  </button>
                </div>
              </div>

              <div className="mt-5">
                {forecastDialogView === 'weekly' ? (
                  <div className={['overflow-auto rounded-2xl', tableWrapClass].join(' ')}>
                    <table className="min-w-full table-fixed text-left text-xs">
                      <colgroup>
                        <col className="w-[150px]" />
                        <col className="w-[56px]" />
                        <col className="w-[170px]" />
                        <col className="w-[150px]" />
                        <col className="w-[130px]" />
                        <col className="w-[100px]" />
                        <col className="w-[140px]" />
                        <col className="w-[160px]" />
                      </colgroup>
                      <thead className={['text-[10px] uppercase tracking-[0.16em]', tableHeadClass].join(' ')}>
                        <tr>
                          <th className="px-2 py-2">{t('日期', 'Date')}</th>
                          <th className="px-2 py-2">{t('星期', 'Weekday')}</th>
                          <th className="px-2 py-2">{t('前一日积压（全天待拣货）', 'Previous day backlog (full-day pending picks)')}</th>
                          <th className="px-2 py-2">{t('今日预测单量', 'Predicted volume at 12:00')}</th>
                          <th className="px-2 py-2">{t('库存量', 'Inventory')}</th>
                          <th className="px-2 py-2">{t('恶劣天气', 'Severe weather')}</th>
                          <th className="px-2 py-2">{t('全天产能', 'Full-day capacity')}</th>
                          <th className="px-2 py-2">{t('昨日00:00-14:00流入量', 'Yesterday 00:00-14:00 inflow')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manualInputDraftRows.map((draftRow, index) => (
                          <tr key={draftRow.input_date} className={tableRowClass}>
                            <td className="px-2 py-3 align-top">
                              <input
                                type="date"
                                value={draftRow.input_date}
                                disabled
                                className={[
                                  'h-10 w-full rounded-xl px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-100',
                                  isLight ? 'border border-slate-300 bg-slate-50 text-slate-900' : 'border border-white/10 bg-black/20 text-white'
                                ].join(' ')}
                              />
                            </td>
                            <td className="px-2 py-3 align-middle">
                              <div className={['text-sm font-semibold', valueClass].join(' ')}>
                                {t(
                                  WEEKDAY_OPTIONS[(getWeekdayFromDateOnly(draftRow.input_date) ?? 1) - 1]?.zh ?? '周一',
                                  WEEKDAY_OPTIONS[(getWeekdayFromDateOnly(draftRow.input_date) ?? 1) - 1]?.shortEn ?? 'Mon'
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-3 align-top">
                              <input
                                value={draftRow.previous_day_backlog}
                                onChange={(e) =>
                                  setManualInputDraftRows((prev) =>
                                    prev.map((row, rowIndex) => (rowIndex === index ? { ...row, previous_day_backlog: e.target.value } : row))
                                  )
                                }
                                disabled={manualInputSaving}
                                inputMode="numeric"
                                className={[
                                  'h-10 w-full rounded-xl px-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                                  isLight
                                    ? 'border border-slate-300 bg-white text-slate-900 focus:border-neon/60'
                                    : 'border border-white/10 bg-black/30 text-white focus:border-neon'
                                ].join(' ')}
                              />
                            </td>
                            <td className="px-2 py-3 align-top">
                              <input
                                value={draftRow.predicted_full_day_volume_12}
                                readOnly
                                disabled
                                inputMode="numeric"
                                className={[
                                  'h-10 w-full rounded-xl px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-100',
                                  isLight
                                    ? 'border border-slate-300 bg-slate-50 text-slate-900'
                                    : 'border border-white/10 bg-black/20 text-white'
                                ].join(' ')}
                              />
                            </td>
                            <td className="px-2 py-3 align-top">
                              <input
                                value={draftRow.inventory_level}
                                onChange={(e) =>
                                  setManualInputDraftRows((prev) =>
                                    prev.map((row, rowIndex) => (rowIndex === index ? { ...row, inventory_level: e.target.value } : row))
                                  )
                                }
                                disabled={manualInputSaving}
                                inputMode="numeric"
                                className={[
                                  'h-10 w-full rounded-xl px-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                                  isLight
                                    ? 'border border-slate-300 bg-white text-slate-900 focus:border-neon/60'
                                    : 'border border-white/10 bg-black/30 text-white focus:border-neon'
                                ].join(' ')}
                              />
                            </td>
                            <td className="px-2 py-3 align-middle">
                              <label className={['flex items-center gap-1.5 text-sm font-medium', valueClass].join(' ')}>
                                <input
                                  type="checkbox"
                                  checked={draftRow.severe_weather}
                                  onChange={(e) =>
                                    setManualInputDraftRows((prev) =>
                                      prev.map((row, rowIndex) => (rowIndex === index ? { ...row, severe_weather: e.target.checked } : row))
                                    )
                                  }
                                  disabled={manualInputSaving}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                <span>{t('恶劣', 'Severe')}</span>
                              </label>
                            </td>
                            <td className="px-2 py-3 align-top">
                              <input
                                value={draftRow.full_day_capacity}
                                onChange={(e) =>
                                  setManualInputDraftRows((prev) =>
                                    prev.map((row, rowIndex) => (rowIndex === index ? { ...row, full_day_capacity: e.target.value } : row))
                                  )
                                }
                                disabled={manualInputSaving}
                                inputMode="numeric"
                                className={[
                                  'h-10 w-full rounded-xl px-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                                  isLight
                                    ? 'border border-slate-300 bg-white text-slate-900 focus:border-neon/60'
                                    : 'border border-white/10 bg-black/30 text-white focus:border-neon'
                                ].join(' ')}
                              />
                            </td>
                            <td className="px-2 py-3 align-top">
                              <input
                                value={draftRow.yesterday_inflow_00_14}
                                readOnly
                                disabled
                                inputMode="numeric"
                                className={[
                                  'h-10 w-full rounded-xl px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-100',
                                  isLight
                                    ? 'border border-slate-300 bg-slate-50 text-slate-900'
                                    : 'border border-white/10 bg-black/20 text-white'
                                ].join(' ')}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4">
                      <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
                        <div className="flex items-center justify-between gap-3">
                          <input
                            type="date"
                            value={historyPasteDate}
                            onChange={(e) => setHistoryPasteDate(e.target.value)}
                            disabled={isLocked || uploading || historyPasteSaving}
                            className={[
                              'h-10 w-full max-w-[220px] rounded-xl px-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                              isLight
                                ? 'border border-slate-300 bg-white text-slate-900 focus:border-neon/60'
                                : 'border border-white/10 bg-black/30 text-white focus:border-neon'
                            ].join(' ')}
                          />
                          <button
                            type="button"
                            disabled={isLocked || uploading || historyPasteSaving || !historyPasteValue.trim()}
                            onClick={() => void applyPastedHistoryData()}
                            className={[
                              'rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                              isLight ? 'bg-slate-900 text-white hover:bg-slate-700' : 'bg-neon text-slate-950 hover:shadow-glow'
                            ].join(' ')}
                          >
                            {historyPasteSaving ? t('处理中...', 'Applying...') : t('应用粘贴数据', 'Apply paste')}
                          </button>
                        </div>
                        <textarea
                          value={historyPasteValue}
                          onChange={(e) => setHistoryPasteValue(e.target.value)}
                          placeholder=""
                          rows={4}
                          disabled={isLocked || uploading || historyPasteSaving}
                          className={[
                            'mt-3 w-full rounded-2xl px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                            isLight
                              ? 'border border-slate-300 bg-white text-slate-900 focus:border-neon/60'
                              : 'border border-white/10 bg-black/30 text-white focus:border-neon'
                          ].join(' ')}
                        />
                      </div>
                    </div>
                    {uploadError && (
                      <div
                        className={[
                          'mb-3 rounded-2xl border px-4 py-3 text-sm',
                          isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                        ].join(' ')}
                      >
                        {uploadError}
                      </div>
                    )}
                    {uploadMessage && (
                      <div
                        className={[
                          'mb-3 rounded-2xl border px-4 py-3 text-sm',
                          isLight ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        ].join(' ')}
                      >
                        {uploadMessage}
                      </div>
                    )}
                    {historyWindowError && (
                      <div
                        className={[
                          'mb-3 rounded-2xl border px-4 py-3 text-sm',
                          isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                        ].join(' ')}
                      >
                        {historyWindowError}
                      </div>
                    )}
                    <div className={['overflow-auto rounded-2xl', tableWrapClass].join(' ')}>
                      <table className="min-w-[2100px] table-fixed text-left text-xs">
                        <thead className={['text-[10px] uppercase tracking-[0.16em]', tableHeadClass].join(' ')}>
                          <tr>
                            <th className="px-3 py-2">{t('日期', 'Date')}</th>
                            <th className="px-3 py-2">{t('星期', 'Weekday')}</th>
                            <th className="px-3 py-2">{t('截止12点预测', '12:00 forecast')}</th>
                            <th className="px-3 py-2">{t('实际差异', 'Actual variance')}</th>
                            <th className="px-3 py-2">{t('当日总流入', 'Daily total')}</th>
                            <th className="px-3 py-2">{t('库存转换率', 'ITR')}</th>
                            <th className="px-3 py-2">{t('恶劣天气', 'Severe weather')}</th>
                            {HOUR_COLUMNS.map((hourKey, index) => (
                              <th key={hourKey} className="px-3 py-2">{`${String(index).padStart(2, '0')}:00`}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentWeekDates.map((date) => {
                            const row = historyWindowRows.find((item) => item.date === date);
                            const weekday = getWeekdayFromDateOnly(date) ?? 1;
                            const noonCoefficient = forecastAtNoonByWeekday.get(weekday) ?? null;
                            const lastFilledHour = row ? Number(row.last_filled_hour ?? inferLastFilledHour(row)) : null;
                            const hasReachedNoonCutoff = lastFilledHour !== null && lastFilledHour >= FIXED_FORECAST_HOUR - 1;
                            const noonCumulative =
                              row && hasReachedNoonCutoff ? calculateCumulativeVolume(row as Pick<VolumeHistoryUploadRow, HourColumnKey>, FIXED_FORECAST_HOUR) : null;
                            const noonForecastResult =
                              row && noonCumulative !== null ? calculateForecast(noonCumulative, FIXED_FORECAST_HOUR, weekday, noonCoefficient) : null;
                            const noonForecast = noonForecastResult?.forecast ?? null;
                            const dailyTotal = row
                              ? HOUR_COLUMNS.reduce((sum, hourKey) => sum + Number(row[hourKey] ?? 0), 0)
                              : null;
                            const manualInputRow = manualInputByDate.get(date);
                            const inventoryLevel = Number(manualInputRow?.inventory_level ?? 0);
                            const severeWeather = Boolean(manualInputRow?.severe_weather ?? false);
                            const isCompleteHistoryDay = lastFilledHour !== null && lastFilledHour >= 23;
                            const actualVariance =
                              isCompleteHistoryDay && dailyTotal !== null && noonForecast !== null && noonForecast > 0
                                ? (dailyTotal - noonForecast) / noonForecast
                                : null;
                            const itr = dailyTotal !== null && inventoryLevel > 0 ? dailyTotal / inventoryLevel : null;
                            return (
                              <tr key={date} className={tableRowClass}>
                                <td className="px-3 py-2 font-semibold">{date}</td>
                                <td className="px-3 py-2">
                                  {t(WEEKDAY_OPTIONS[weekday - 1]?.zh ?? '周一', WEEKDAY_OPTIONS[weekday - 1]?.shortEn ?? 'Mon')}
                                </td>
                                <td className="px-3 py-2">{formatNumber(noonForecast)}</td>
                                <td className="px-3 py-2">{actualVariance === null ? '-' : formatPercent(actualVariance, 2)}</td>
                                <td className="px-3 py-2">{formatNumber(dailyTotal)}</td>
                                <td className="px-3 py-2">{itr === null ? '-' : formatPercent(itr, 2)}</td>
                                <td className="px-3 py-2">{severeWeather ? t('是', 'Yes') : t('否', 'No')}</td>
                                {HOUR_COLUMNS.map((hourKey) => (
                                  <td key={`${date}-${hourKey}`} className="px-3 py-2">
                                    {row ? formatNumber(Number(row[hourKey] ?? 0)) : '-'}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                          {historyWindowLoading && (
                            <tr>
                              <td colSpan={HOUR_COLUMNS.length + 7} className={['px-3 py-6 text-center', helperClass].join(' ')}>
                                {t('Loading...', 'Loading...')}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {manualInputSaveError && (
                <div
                  className={[
                    'mt-4 rounded-2xl border px-4 py-3 text-sm',
                    isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                  ].join(' ')}
                >
                  {manualInputSaveError}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={manualInputSaving} onClick={closeManualInputDialog} className={secondaryButtonClass}>
                  {forecastDialogView === 'weekly' ? t('取消', 'Cancel') : t('关闭', 'Close')}
                </button>
                {forecastDialogView === 'weekly' && (
                  <button
                    type="button"
                    disabled={manualInputSaving}
                    onClick={() => void saveManualInput()}
                    className={[
                      'rounded-2xl px-5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                      isLight ? 'bg-slate-900 text-white hover:bg-slate-700' : 'bg-neon text-slate-950 hover:shadow-glow'
                    ].join(' ')}
                  >
                    {manualInputSaving ? t('保存中...', 'Saving...') : t('保存', 'Save')}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
