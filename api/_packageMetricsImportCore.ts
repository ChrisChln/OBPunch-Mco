import * as XLSX from 'xlsx';
import {
  computePackageDailyMetrics,
  normalizePackageTimestamp,
  parsePackageQuantity,
  type PackageDailyMetrics,
  type PackageMetricsParsedRow
} from '../src/shared/packageMetrics';

type PackageImportPersistence = {
  insertRun: (payload: {
    metric_date: string;
    source_filename: string;
    source_row_count: number;
    status: 'running' | 'success' | 'failed';
    error_message?: string | null;
    started_at?: string;
    finished_at?: string | null;
  }) => Promise<{ id: string }>;
  updateRun: (
    id: string,
    payload: {
      source_row_count?: number;
      status?: 'running' | 'success' | 'failed';
      error_message?: string | null;
      finished_at?: string | null;
    }
  ) => Promise<void>;
  upsertMetrics: (payload: PackageDailyMetrics) => Promise<void>;
};

export type PackageImportProcessResult = {
  metric_date: string;
  source_row_count: number;
  computed_at: string;
  metrics: PackageDailyMetrics;
  run_id: string;
};

export type PackageMetricsImportPersistence = PackageImportPersistence;

const normalizeHeaderKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '');

const buildHeaderMap = (headers: unknown[]) => {
  const headerMap = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeaderKey(header);
    if (normalized) headerMap.set(normalized, index);
  });
  return headerMap;
};

const decodeBase64 = (value: string) => Buffer.from(value, 'base64');

const loadWorkbookRows = (buffer: Buffer, filename: string) => {
  const lowerName = filename.toLowerCase();
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    raw: false,
    cellDates: false,
    dense: true,
    ...(lowerName.endsWith('.csv') ? { codepage: 65001 } : {})
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('The uploaded file does not contain any worksheet.');
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
  if (rows.length < 2) {
    throw new Error('The uploaded file does not contain any data rows.');
  }
  return rows;
};

export const parsePackageMetricsRows = (buffer: Buffer, filename: string): PackageMetricsParsedRow[] => {
  const rows = loadWorkbookRows(buffer, filename);
  const [headers, ...dataRows] = rows;
  const headerMap = buildHeaderMap(headers);

  const quantityIndex = headerMap.get(normalizeHeaderKey('商品数量'));
  const inboundAtIndex = headerMap.get(normalizeHeaderKey('订单流入时间'));
  const shippingStatusIndex = headerMap.get(normalizeHeaderKey('发货状态'));
  const packedAtIndex = headerMap.get(normalizeHeaderKey('打包完成时间'));

  const missingHeaders = [
    quantityIndex == null ? '商品数量' : '',
    inboundAtIndex == null ? '订单流入时间' : '',
    shippingStatusIndex == null ? '发货状态' : '',
    packedAtIndex == null ? '打包完成时间' : ''
  ].filter(Boolean);
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
  }

  const parsedRows: PackageMetricsParsedRow[] = [];
  dataRows.forEach((row, index) => {
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
    const packedAtText = String(packedRaw ?? '').trim();
    const packedAt = packedAtText ? normalizePackageTimestamp(packedRaw) : null;
    if (packedAtText && !packedAt) {
      throw new Error(`Row ${rowNumber}: 打包完成时间 must be a valid datetime when provided.`);
    }
    parsedRows.push({
      quantity,
      inboundAt,
      shippingStatus,
      packedAt
    });
  });
  return parsedRows;
};

export const processPackageMetricsRowsImport = async (
  input: {
    metricDate: string;
    filename: string;
    rows: PackageMetricsParsedRow[];
    computedAt?: string;
  },
  persistence: PackageImportPersistence
): Promise<PackageImportProcessResult> => {
  const startedAt = new Date().toISOString();
  const run = await persistence.insertRun({
    metric_date: input.metricDate,
    source_filename: input.filename,
    source_row_count: 0,
    status: 'running',
    error_message: null,
    started_at: startedAt,
    finished_at: null
  });

  try {
    const metrics = computePackageDailyMetrics(input.rows, {
      metricDate: input.metricDate,
      sourceFilename: input.filename,
      computedAt: input.computedAt ?? new Date().toISOString()
    });
    await persistence.upsertMetrics(metrics);
    await persistence.updateRun(run.id, {
      source_row_count: input.rows.length,
      status: 'success',
      error_message: null,
      finished_at: new Date().toISOString()
    });
    return {
      metric_date: metrics.metric_date,
      source_row_count: metrics.source_row_count,
      computed_at: metrics.computed_at,
      metrics,
      run_id: run.id
    };
  } catch (error: any) {
    await persistence.updateRun(run.id, {
      status: 'failed',
      error_message: String(error?.message ?? error ?? 'Unknown import failure'),
      finished_at: new Date().toISOString()
    });
    throw error;
  }
};

export const processPackageMetricsImport = async (
  input: {
    metricDate: string;
    filename: string;
    fileBase64: string;
    computedAt?: string;
  },
  persistence: PackageImportPersistence
): Promise<PackageImportProcessResult> => {
  const parsedRows = parsePackageMetricsRows(decodeBase64(input.fileBase64), input.filename);
  return processPackageMetricsRowsImport(
    {
      metricDate: input.metricDate,
      filename: input.filename,
      rows: parsedRows,
      computedAt: input.computedAt
    },
    persistence
  );
};
