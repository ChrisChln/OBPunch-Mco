import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildAssessmentWindow,
  buildCalendarWindow,
  computePackageDailyMetrics,
  normalizePackageTimestamp
} from '../src/shared/packageMetrics';
import { parsePackageMetricsRows } from '../api/_packageMetricsImportCore';

const buildWorkbookBuffer = (rows: unknown[][]) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

describe('package metrics parsing', () => {
  it('reads workbook rows and validates required headers', () => {
    const buffer = buildWorkbookBuffer([
      ['商品数量', '订单流入时间', '发货状态', '打包完成时间'],
      ['1', '2026-04-17 13:30:00', '已发货', '2026-04-18 10:00:00'],
      ['2', '2026-04-18 09:00:00', '待发货', '']
    ]);

    const rows = parsePackageMetricsRows(buffer, 'package.xlsx');
    expect(rows).toEqual([
      {
        quantity: 1,
        inboundAt: '2026-04-17 13:30:00',
        shippingStatus: '已发货',
        packedAt: '2026-04-18 10:00:00'
      },
      {
        quantity: 2,
        inboundAt: '2026-04-18 09:00:00',
        shippingStatus: '待发货',
        packedAt: null
      }
    ]);
  });

  it('rejects files missing required headers', () => {
    const buffer = buildWorkbookBuffer([['商品数量', '发货状态'], ['1', '已发货']]);
    expect(() => parsePackageMetricsRows(buffer, 'broken.xlsx')).toThrow(/Missing required headers/);
  });

  it('rejects malformed quantity or timestamps', () => {
    const quantityBuffer = buildWorkbookBuffer([
      ['商品数量', '订单流入时间', '发货状态', '打包完成时间'],
      ['', '2026-04-17 13:30:00', '已发货', '2026-04-18 10:00:00']
    ]);
    expect(() => parsePackageMetricsRows(quantityBuffer, 'bad-qty.xlsx')).toThrow(/商品数量/);

    const timeBuffer = buildWorkbookBuffer([
      ['商品数量', '订单流入时间', '发货状态', '打包完成时间'],
      ['1', 'not-a-time', '已发货', '2026-04-18 10:00:00']
    ]);
    expect(() => parsePackageMetricsRows(timeBuffer, 'bad-time.xlsx')).toThrow(/订单流入时间/);
  });
});

describe('package metrics computation', () => {
  it('computes assessment, calendar and backlog metrics', () => {
    const metrics = computePackageDailyMetrics(
      [
        { quantity: 1, inboundAt: '2026-04-17 13:30:00', shippingStatus: '已发货', packedAt: '2026-04-18 08:15:00' },
        { quantity: 3, inboundAt: '2026-04-18 09:10:00', shippingStatus: '待发货', packedAt: null },
        { quantity: 2, inboundAt: '2026-04-18 12:59:59', shippingStatus: '已发货', packedAt: '2026-04-18 13:00:00' },
        { quantity: 4, inboundAt: '2026-04-18 13:30:00', shippingStatus: '待发货', packedAt: null },
        { quantity: 5, inboundAt: '2026-04-18 23:59:59', shippingStatus: '待发货', packedAt: '2026-04-19 08:00:00' }
      ],
      {
        metricDate: '2026-04-18',
        sourceFilename: 'package.xlsx',
        computedAt: '2026-04-18T18:00:00.000Z'
      }
    );

    expect(buildAssessmentWindow('2026-04-18')).toEqual({
      start: '2026-04-17 13:30:00',
      endExclusive: '2026-04-18 13:30:00'
    });
    expect(buildCalendarWindow('2026-04-18')).toEqual({
      start: '2026-04-18 00:00:00',
      endExclusive: '2026-04-19 00:00:00'
    });

    expect(metrics.assessment_single_order_count).toBe(1);
    expect(metrics.assessment_multi_order_count).toBe(2);
    expect(metrics.assessment_total_order_count).toBe(3);
    expect(metrics.assessment_unfinished_order_count).toBe(1);
    expect(metrics.assessment_single_item_qty).toBe(1);
    expect(metrics.assessment_multi_item_qty).toBe(5);
    expect(metrics.assessment_total_item_qty).toBe(6);
    expect(metrics.assessment_unfinished_item_qty).toBe(3);
    expect(metrics.assessment_completed_order_count).toBe(2);
    expect(metrics.assessment_completed_item_qty).toBe(3);
    expect(metrics.calendar_inbound_order_count).toBe(4);
    expect(metrics.calendar_inbound_item_qty).toBe(14);
    expect(metrics.calendar_completed_order_count).toBe(2);
    expect(metrics.calendar_completed_item_qty).toBe(3);
    expect(metrics.calendar_backlog_order_count).toBe(3);
    expect(metrics.calendar_backlog_item_qty).toBe(12);
    expect(metrics.assessment_multi_order_ratio).toBeCloseTo(2 / 3, 6);
    expect(metrics.assessment_multi_item_ratio).toBeCloseTo(5 / 6, 6);
    expect(metrics.inventory_qty).toBeNull();
    expect(metrics.inventory_conversion_ratio).toBeNull();
  });

  it('normalizes parseable timestamps', () => {
    expect(normalizePackageTimestamp('2026/04/18 3:4:5')).toBe('2026-04-18 03:04:05');
  });
});
