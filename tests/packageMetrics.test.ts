import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildPackageDailyReportText,
  buildAssessmentWindow,
  buildCalendarWindow,
  computePackageDailyMetrics,
  computePackageDerivedMetrics,
  inspectPackageMetricsDateCoverage,
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
  it('computes assessment, calendar, backlog and inventory metrics', () => {
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
        computedAt: '2026-04-18T18:00:00.000Z',
        inventoryQty: 4937303
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
    expect(metrics.inventory_qty).toBe(4937303);
    expect(metrics.inventory_conversion_ratio).toBeCloseTo(14 / 4937303, 6);
  });

  it('treats in-transit shipments as completed for assessment SLA', () => {
    const metrics = computePackageDailyMetrics(
      [
        { quantity: 2, inboundAt: '2026-04-20 14:00:00', shippingStatus: '发货中', packedAt: '2026-04-21 09:30:00' }
      ],
      {
        metricDate: '2026-04-21',
        sourceFilename: 'package.xlsx',
        computedAt: '2026-04-21T18:00:00.000Z'
      }
    );

    expect(metrics.assessment_total_order_count).toBe(1);
    expect(metrics.assessment_completed_order_count).toBe(1);
    expect(metrics.assessment_completed_item_qty).toBe(2);
    expect(metrics.assessment_unfinished_order_count).toBe(0);
  });

  it('computes piece efficiency, order efficiency and SLA from existing metrics', () => {
    const derived = computePackageDerivedMetrics(
      {
        calendar_completed_item_qty: 17905,
        calendar_completed_order_count: 14799,
        assessment_completed_order_count: 14799,
        assessment_total_order_count: 14800
      },
      320
    );

    expect(derived.pieceEfficiency).toBeCloseTo(55.95, 2);
    expect(derived.orderEfficiency).toBeCloseTo(46.25, 2);
    expect(derived.slaRatio).toBeCloseTo(14799 / 14800, 6);
  });

  it('keeps inventory fields null when no inventory is provided', () => {
    const metrics = computePackageDailyMetrics(
      [{ quantity: 2, inboundAt: '2026-04-18 09:00:00', shippingStatus: '待发货', packedAt: null }],
      {
        metricDate: '2026-04-18',
        sourceFilename: 'package.xlsx',
        computedAt: '2026-04-18T18:00:00.000Z'
      }
    );

    expect(metrics.inventory_qty).toBeNull();
    expect(metrics.inventory_conversion_ratio).toBeNull();
  });

  it('returns null derived metrics when total hours are unavailable', () => {
    const derived = computePackageDerivedMetrics(
      {
        calendar_completed_item_qty: 100,
        calendar_completed_order_count: 50,
        assessment_completed_order_count: 49,
        assessment_total_order_count: 50
      },
      null
    );

    expect(derived.pieceEfficiency).toBeNull();
    expect(derived.orderEfficiency).toBeNull();
    expect(derived.slaRatio).toBeCloseTo(0.98, 6);
  });

  it('normalizes parseable timestamps', () => {
    expect(normalizePackageTimestamp('2026/04/18 3:4:5')).toBe('2026-04-18 03:04:05');
  });

  it('detects when the selected metric date is outside the file inbound date coverage', () => {
    const coverage = inspectPackageMetricsDateCoverage(
      [
        { inboundAt: '2026-04-20 00:00:00' },
        { inboundAt: '2026-04-20 12:30:00' },
        { inboundAt: '2026-04-21 00:00:05' }
      ],
      '2026-04-19'
    );

    expect(coverage).toEqual({
      inboundDateStart: '2026-04-20',
      inboundDateEnd: '2026-04-21',
      assessmentInboundRowCount: 0,
      calendarInboundRowCount: 0
    });
  });

  it('builds package daily report text', () => {
    const report = buildPackageDailyReportText({
      metricDate: '2026-04-21',
      metrics: {
        metric_date: '2026-04-21',
        assessment_single_order_count: 1,
        assessment_multi_order_count: 2,
        assessment_multi_order_ratio: 2 / 3,
        assessment_total_order_count: 3,
        assessment_unfinished_order_count: 1,
        calendar_inbound_order_count: 5,
        assessment_single_item_qty: 1,
        assessment_multi_item_qty: 5,
        assessment_multi_item_ratio: 5 / 6,
        assessment_total_item_qty: 6,
        calendar_inbound_item_qty: 9,
        inventory_qty: null,
        inventory_conversion_ratio: null,
        assessment_unfinished_item_qty: 3,
        assessment_completed_order_count: 2,
        assessment_completed_item_qty: 3,
        calendar_completed_order_count: 2,
        calendar_completed_item_qty: 3,
        calendar_backlog_order_count: 3,
        calendar_backlog_item_qty: 6,
        source_filename: 'package.xlsx',
        source_row_count: 3,
        computed_at: '2026-04-21T18:00:00.000Z'
      },
      unfinishedReason: '尾波未清完',
      labor: {
        scheduledCount: 8,
        presentCount: 7,
        lateCount: 1,
        earlyLeaveCount: 0,
        totalHours: 72.5
      }
    });

    expect(report).toContain('JDL NYC4 2026/04/21 出库日报：');
    expect(report).toContain('考核进单量：3单，6件');
    expect(report).toContain('未完成原因：尾波未清完');
    expect(report).toContain('编制：8人');
    expect(report).toContain('出勤率：87.5%');
    expect(report).toContain('总工时: 72.5 小时');
    expect(report).toContain('人效（件效）：0.04');
    expect(report).toContain('人效（单效）：0.03');
    expect(report).toContain('SLA：66.67%');
  });
});
