import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import StyledDateInput from '../components/StyledDateInput';
import {
  getDateOnlyInTimeZone,
  normalizePackageTimestamp,
  PACKAGE_METRICS_REQUIRED_HEADERS,
  parsePackageQuantity,
  type PackageDailyMetrics,
  type PackageMetricsParsedRow
} from '../../shared/packageMetrics';

type TranslateFn = (zh: string, en: string) => string;

type PackageMetricsPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  isReadOnly?: boolean;
  supabase: any;
  themeMode: 'light' | 'dark';
  serverTime: Date;
};

type LoadState = {
  tone: 'idle' | 'success' | 'error';
  message: string;
};

const METRIC_LABELS: Array<[keyof PackageDailyMetrics, string, string]> = [
  ['assessment_single_order_count', '考核单品单量', 'Assessment Single Orders'],
  ['assessment_multi_order_count', '考核多品单量', 'Assessment Multi Orders'],
  ['assessment_multi_order_ratio', '考核多品单比例', 'Assessment Multi Order Ratio'],
  ['assessment_total_order_count', '考核订单总量', 'Assessment Total Orders'],
  ['assessment_unfinished_order_count', '未完成考核订单', 'Assessment Unfinished Orders'],
  ['calendar_inbound_order_count', '全天进单量', 'Full-day Inbound Orders'],
  ['assessment_single_item_qty', '考核单品件数', 'Assessment Single Items'],
  ['assessment_multi_item_qty', '考核多品件数', 'Assessment Multi Items'],
  ['assessment_multi_item_ratio', '考核多品件数比例', 'Assessment Multi Item Ratio'],
  ['assessment_total_item_qty', '考核总件数', 'Assessment Total Items'],
  ['calendar_inbound_item_qty', '全天进件量', 'Full-day Inbound Items'],
  ['inventory_qty', '库存量', 'Inventory Qty'],
  ['inventory_conversion_ratio', '库存转换率', 'Inventory Conversion Ratio'],
  ['assessment_unfinished_item_qty', '未完成考核件数', 'Assessment Unfinished Items'],
  ['assessment_completed_order_count', '考核单完成量', 'Assessment Completed Orders'],
  ['assessment_completed_item_qty', '考核单完成件数', 'Assessment Completed Items'],
  ['calendar_completed_order_count', '全天完成单量', 'Full-day Completed Orders'],
  ['calendar_completed_item_qty', '全天完成件数', 'Full-day Completed Items'],
  ['calendar_backlog_order_count', '全天剩余积压', 'Full-day Backlog Orders'],
  ['calendar_backlog_item_qty', '全天剩余积压件数', 'Full-day Backlog Items']
];

const formatMetricValue = (key: keyof PackageDailyMetrics, value: unknown) => {
  if (value == null || value === '') return '-';
  if (key.includes('ratio')) {
    const num = Number(value);
    return Number.isFinite(num) ? `${(num * 100).toFixed(2)}%` : '-';
  }

  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString('en-US') : String(value);
};

const normalizeHeaderKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[()锛堬級]/g, '');

const readRowsFromWorkbook = async (file: File): Promise<PackageMetricsParsedRow[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    raw: false,
    cellDates: false,
    dense: true,
    ...(file.name.toLowerCase().endsWith('.csv') ? { codepage: 65001 } : {})
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('The uploaded file does not contain any worksheet.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
  if (rawRows.length < 2) {
    throw new Error('The uploaded file does not contain any data rows.');
  }

  const [headers, ...dataRows] = rawRows;
  const headerMap = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeaderKey(header);
    if (normalized) headerMap.set(normalized, index);
  });

  const missingHeaders = PACKAGE_METRICS_REQUIRED_HEADERS.filter((header) => !headerMap.has(normalizeHeaderKey(header)));
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
  }

  const quantityIndex = headerMap.get(normalizeHeaderKey(PACKAGE_METRICS_REQUIRED_HEADERS[0]));
  const inboundAtIndex = headerMap.get(normalizeHeaderKey(PACKAGE_METRICS_REQUIRED_HEADERS[1]));
  const shippingStatusIndex = headerMap.get(normalizeHeaderKey(PACKAGE_METRICS_REQUIRED_HEADERS[2]));
  const packedAtIndex = headerMap.get(normalizeHeaderKey(PACKAGE_METRICS_REQUIRED_HEADERS[3]));

  if (quantityIndex == null || inboundAtIndex == null || shippingStatusIndex == null || packedAtIndex == null) {
    throw new Error('Failed to resolve required worksheet columns.');
  }

  return dataRows.map((row, index) => {
    const rowNumber = index + 2;
    const quantity = parsePackageQuantity(row[quantityIndex]);
    if (quantity == null) {
      throw new Error(`Row ${rowNumber}: 商品数量 is required and must be numeric.`);
    }

    const inboundAt = normalizePackageTimestamp(row[inboundAtIndex]);
    if (!inboundAt) {
      throw new Error(`Row ${rowNumber}: 订单流入时间 is required and must be a valid datetime.`);
    }

    const shippingStatus = String(row[shippingStatusIndex] ?? '').trim();
    if (!shippingStatus) {
      throw new Error(`Row ${rowNumber}: 发货状态 is required.`);
    }

    const packedRaw = row[packedAtIndex];
    const packedText = String(packedRaw ?? '').trim();
    const packedAt = packedText ? normalizePackageTimestamp(packedRaw) : null;
    if (packedText && !packedAt) {
      throw new Error(`Row ${rowNumber}: 打包完成时间 must be a valid datetime when provided.`);
    }

    return {
      quantity,
      inboundAt,
      shippingStatus,
      packedAt
    };
  });
};

const parseJsonResponse = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
};

export default function PackageMetricsPage({
  t,
  isLocked,
  isReadOnly = false,
  supabase,
  themeMode,
  serverTime
}: PackageMetricsPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [metricDate, setMetricDate] = useState(() => getDateOnlyInTimeZone(serverTime));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<LoadState>({ tone: 'idle', message: '' });
  const [metricsRow, setMetricsRow] = useState<PackageDailyMetrics | null>(null);

  const shellClass =
    themeMode === 'light'
      ? 'border border-slate-200 bg-white/90 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.08)]'
      : 'border border-slate-800/80 bg-slate-950/85 text-slate-100 shadow-[0_24px_60px_rgba(2,6,23,0.42)]';
  const mutedClass = themeMode === 'light' ? 'text-slate-500' : 'text-slate-400';
  const cardClass =
    themeMode === 'light'
      ? 'rounded-2xl border border-slate-200 bg-slate-50/80 p-4'
      : 'rounded-2xl border border-slate-800 bg-slate-900/70 p-4';
  const buttonClass =
    themeMode === 'light'
      ? 'rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300'
      : 'rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 disabled:bg-slate-700 disabled:text-slate-400';

  const statusClass = useMemo(() => {
    if (status.tone === 'success') return themeMode === 'light' ? 'text-emerald-700' : 'text-emerald-300';
    if (status.tone === 'error') return themeMode === 'light' ? 'text-rose-700' : 'text-rose-300';
    return mutedClass;
  }, [mutedClass, status.tone, themeMode]);

  useEffect(() => {
    let cancelled = false;

    const loadMetrics = async () => {
      if (!supabase) return;
      const res = await supabase.from('ob_package_daily_metrics').select('*').eq('metric_date', metricDate).maybeSingle();
      if (cancelled) return;

      if (res.error) {
        setMetricsRow(null);
        setStatus({
          tone: 'error',
          message: t('读取日报失败，请先执行 SQL 并确认表权限。', 'Failed to load saved metrics. Run the SQL and confirm table access.')
        });
        return;
      }

      setMetricsRow((res.data as PackageDailyMetrics | null) ?? null);
      if (!res.data) {
        setStatus({ tone: 'idle', message: t('当前日期还没有日报记录。', 'No saved metrics for the selected date.') });
      }
    };

    void loadMetrics();
    return () => {
      cancelled = true;
    };
  }, [metricDate, supabase, t]);

  const handleUpload = async () => {
    if (!supabase || !selectedFile || isLocked || isReadOnly) return;

    setLoading(true);
    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = String(sessionRes.data?.session?.access_token ?? '');
      if (!accessToken) {
        throw new Error(t('当前会话已失效，请重新登录。', 'Your session has expired. Sign in again.'));
      }

      const rows = await readRowsFromWorkbook(selectedFile);
      const response = await fetch('/api/package-metrics-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          metric_date: metricDate,
          filename: selectedFile.name,
          rows
        })
      });

      const responseText = await response.text();
      const result = parseJsonResponse(responseText);
      if (!response.ok) {
        throw new Error(String(result && typeof result === 'object' ? (result as any).error ?? responseText : responseText || 'Upload failed'));
      }
      if (!result || typeof result !== 'object') {
        throw new Error('The server returned an empty response.');
      }

      setMetricsRow((result as any).metrics as PackageDailyMetrics);
      setStatus({
        tone: 'success',
        message: t(
          `已完成导入：${(result as any).source_row_count} 行，更新时间 ${new Date((result as any).computed_at).toLocaleString('en-CA', { hour12: false })}`,
          `Imported ${(result as any).source_row_count} rows. Updated at ${new Date((result as any).computed_at).toLocaleString('en-CA', { hour12: false })}`
        )
      });
    } catch (error: any) {
      setStatus({
        tone: 'error',
        message: String(error?.message ?? error ?? t('导入失败。', 'Import failed.'))
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="px-6 py-8">
      <div className={[shellClass, 'rounded-[28px] p-6'].join(' ')}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-2xl tracking-[0.08em]">{t('包裹日报', 'Package Metrics')}</h2>
            <p className={['text-sm', mutedClass].join(' ')}>{t('上传 Excel 或 CSV，后端只保存日报汇总。', 'Upload Excel or CSV. The server stores aggregate daily metrics only.')}</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
            <div>
              <label className={['mb-2 block text-sm font-medium', mutedClass].join(' ')}>{t('统计日期', 'Metric Date')}</label>
              <StyledDateInput value={metricDate} onChange={setMetricDate} themeMode={themeMode} />
            </div>
            <div>
              <label className={['mb-2 block text-sm font-medium', mutedClass].join(' ')}>{t('数据文件', 'Source File')}</label>
              <input
                ref={fileInputRef}
                type="file"
                disabled={isLocked || isReadOnly || loading}
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className={[
                  'block w-full rounded-2xl border px-4 py-3 text-sm',
                  themeMode === 'light'
                    ? 'border-slate-200 bg-slate-50 text-slate-900'
                    : 'border-slate-800 bg-slate-950 text-slate-100'
                ].join(' ')}
              />
            </div>
            <div className="flex items-end">
              <button type="button" disabled={isLocked || isReadOnly || loading || !selectedFile} onClick={handleUpload} className={buttonClass}>
                {loading ? t('导入中...', 'Importing...') : t('上传并计算', 'Upload & Compute')}
              </button>
            </div>
          </div>

          <div className={['text-sm', statusClass].join(' ')}>{status.message || '\u00A0'}</div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {METRIC_LABELS.map(([key, zh, en]) => (
              <div key={key} className={cardClass}>
                <div className={['text-xs font-medium tracking-[0.14em]', mutedClass].join(' ')}>{t(zh, en)}</div>
                <div className="mt-3 text-2xl font-semibold">{formatMetricValue(key, metricsRow?.[key])}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
