import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { processPackageMetricsImport } from '../api/_packageMetricsImportCore';

const buildWorkbookBase64 = (rows: unknown[][]) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'sheet1');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return buffer.toString('base64');
};

describe('processPackageMetricsImport', () => {
  it('writes a running run, upserts metrics, then marks run success', async () => {
    const insertRun = vi.fn(async () => ({ id: 'run-1' }));
    const updateRun = vi.fn(async () => undefined);
    const upsertMetrics = vi.fn(async () => undefined);

    const result = await processPackageMetricsImport(
      {
        metricDate: '2026-04-18',
        filename: 'package.xlsx',
        fileBase64: buildWorkbookBase64([
          ['商品数量', '订单流入时间', '发货状态', '打包完成时间'],
          ['1', '2026-04-17 13:30:00', '已发货', '2026-04-18 08:15:00']
        ]),
        computedAt: '2026-04-18T18:00:00.000Z'
      },
      { insertRun, updateRun, upsertMetrics }
    );

    expect(insertRun).toHaveBeenCalledOnce();
    expect(upsertMetrics).toHaveBeenCalledOnce();
    expect(updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        source_row_count: 1,
        status: 'success'
      })
    );
    expect(result.metric_date).toBe('2026-04-18');
    expect(result.metrics.source_row_count).toBe(1);
  });

  it('marks run failed when parsing fails', async () => {
    const insertRun = vi.fn(async () => ({ id: 'run-2' }));
    const updateRun = vi.fn(async () => undefined);
    const upsertMetrics = vi.fn(async () => undefined);

    await expect(
      processPackageMetricsImport(
        {
          metricDate: '2026-04-18',
          filename: 'broken.xlsx',
          fileBase64: buildWorkbookBase64([['商品数量', '发货状态'], ['1', '已发货']])
        },
        { insertRun, updateRun, upsertMetrics }
      )
    ).rejects.toThrow(/Missing required headers/);

    expect(upsertMetrics).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(
      'run-2',
      expect.objectContaining({
        status: 'failed'
      })
    );
  });
});
