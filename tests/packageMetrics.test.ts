import { describe, expect, it } from 'vitest';
import {
  buildAssessmentWindow,
  buildCalendarWindow,
  buildPackageDailyReportText,
  computePackageDailyMetrics,
  computePackageDerivedMetrics,
  computePackageTransferRemainderRows,
  inspectPackageMetricsDateCoverage,
  normalizePackageTimestamp
} from '../src/shared/packageMetrics';

describe('package metrics computation', () => {
  it('builds the expected assessment and calendar windows', () => {
    expect(buildAssessmentWindow('2026-04-18')).toEqual({
      start: '2026-04-17 13:30:00',
      endExclusive: '2026-04-18 13:30:00'
    });

    expect(buildCalendarWindow('2026-04-18')).toEqual({
      start: '2026-04-18 00:00:00',
      endExclusive: '2026-04-19 00:00:00'
    });
  });

  it('computes assessment, inbound, and inventory metrics', () => {
    const metrics = computePackageDailyMetrics(
      [
        { quantity: 1, inboundAt: '2026-04-17 13:30:00', shippingStatus: '', packedAt: null },
        { quantity: 3, inboundAt: '2026-04-18 09:10:00', shippingStatus: '', packedAt: null },
        { quantity: 2, inboundAt: '2026-04-18 12:59:59', shippingStatus: '', packedAt: null },
        { quantity: 4, inboundAt: '2026-04-18 13:30:00', shippingStatus: '', packedAt: null },
        { quantity: 5, inboundAt: '2026-04-18 23:59:59', shippingStatus: '', packedAt: null }
      ],
      {
        metricDate: '2026-04-18',
        sourceFilename: 'package.xlsx',
        computedAt: '2026-04-18T18:00:00.000Z',
        inventoryQty: 4937303
      }
    );

    expect(metrics.assessment_single_order_count).toBe(1);
    expect(metrics.assessment_multi_order_count).toBe(2);
    expect(metrics.assessment_total_order_count).toBe(3);
    expect(metrics.assessment_single_item_qty).toBe(1);
    expect(metrics.assessment_multi_item_qty).toBe(5);
    expect(metrics.assessment_total_item_qty).toBe(6);
    expect(metrics.calendar_inbound_order_count).toBe(4);
    expect(metrics.calendar_inbound_final_hour_present).toBe(true);
    expect(metrics.calendar_inbound_item_qty).toBe(14);
    expect(metrics.assessment_multi_order_ratio).toBeCloseTo(2 / 3, 6);
    expect(metrics.assessment_multi_item_ratio).toBeCloseTo(5 / 6, 6);
    expect(metrics.inventory_qty).toBe(4937303);
    expect(metrics.inventory_conversion_ratio).toBeCloseTo(14 / 4937303, 6);
  });

  it('marks full-day inbound as incomplete when the 23:00 hour is missing', () => {
    const metrics = computePackageDailyMetrics(
      [
        { quantity: 2, inboundAt: '2026-04-18 09:00:00', shippingStatus: '', packedAt: null },
        { quantity: 1, inboundAt: '2026-04-18 22:59:59', shippingStatus: '', packedAt: '2026-04-18 23:10:00' }
      ],
      {
        metricDate: '2026-04-18',
        sourceFilename: 'package.xlsx',
        computedAt: '2026-04-18T23:30:00.000Z'
      }
    );

    expect(metrics.calendar_inbound_order_count).toBe(2);
    expect(metrics.calendar_inbound_final_hour_present).toBe(false);
  });

  it('keeps inventory fields null when no inventory is provided', () => {
    const metrics = computePackageDailyMetrics(
      [{ quantity: 2, inboundAt: '2026-04-18 09:00:00', shippingStatus: '', packedAt: null }],
      {
        metricDate: '2026-04-18',
        sourceFilename: 'package.xlsx',
        computedAt: '2026-04-18T18:00:00.000Z'
      }
    );

    expect(metrics.inventory_qty).toBeNull();
    expect(metrics.inventory_conversion_ratio).toBeNull();
  });

  it('computes piece efficiency, order efficiency, and SLA from metrics', () => {
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

  it('includes saved transfer metrics in the daily report', () => {
    const metrics = computePackageDailyMetrics([], {
      metricDate: '2026-04-18',
      sourceFilename: 'package.xlsx',
      computedAt: '2026-04-18T18:00:00.000Z'
    });

    const report = buildPackageDailyReportText({
      metricDate: '2026-04-18',
      metrics: {
        ...metrics,
        transfer_b2b_inbound_order_count: 7,
        transfer_b2b_inbound_box_count: 10,
        transfer_b2b_inbound_item_qty: 120,
        transfer_b2b_shipped_order_count: 5,
        transfer_b2b_shipped_box_count: 8,
        transfer_b2b_shipped_item_qty: 96,
        transfer_b2b_unshipped_order_count: 2,
        transfer_b2b_unshipped_box_count: 2,
        transfer_b2b_unshipped_item_qty: 24,
        transfer_c2b_inbound_order_count: 9,
        transfer_c2b_inbound_box_count: 11,
        transfer_c2b_inbound_item_qty: 132,
        transfer_c2b_shipped_order_count: 7,
        transfer_c2b_shipped_box_count: 9,
        transfer_c2b_shipped_item_qty: 108,
        transfer_c2b_unshipped_order_count: 2,
        transfer_c2b_unshipped_box_count: 2,
        transfer_c2b_unshipped_item_qty: 24,
        transfer_whole_day_inbound_box_count: 14,
        transfer_whole_day_inbound_item_qty: 168,
        transfer_avg_items_per_box: 12
      },
      labor: {
        scheduledCount: 0,
        presentCount: 0,
        lateCount: 0,
        earlyLeaveCount: 0,
        totalHours: null
      }
    });

    expect(report).toContain('B2B');
    expect(report).toContain('调拨进单量：7单，10箱，120件');
    expect(report).toContain('调拨未发货量：2单，2箱，24件');
    expect(report).toContain('C2B');
  });

  it('rolls transfer unshipped counts across dates and floors at zero', () => {
    const rows = computePackageTransferRemainderRows([
      {
        metric_date: '2026-04-18',
        transfer_b2b_inbound_order_count: 1000,
        transfer_b2b_shipped_order_count: 700,
        transfer_b2b_inbound_box_count: 1000,
        transfer_b2b_shipped_box_count: 700,
        transfer_b2b_inbound_item_qty: 2000,
        transfer_b2b_shipped_item_qty: 1500,
        transfer_c2b_inbound_order_count: 300,
        transfer_c2b_shipped_order_count: 100,
        transfer_c2b_inbound_box_count: 300,
        transfer_c2b_shipped_box_count: 100,
        transfer_c2b_inbound_item_qty: 600,
        transfer_c2b_shipped_item_qty: 300
      },
      {
        metric_date: '2026-04-19',
        transfer_b2b_inbound_order_count: 1000,
        transfer_b2b_shipped_order_count: 1100,
        transfer_b2b_inbound_box_count: 1000,
        transfer_b2b_shipped_box_count: 1100,
        transfer_b2b_inbound_item_qty: 2000,
        transfer_b2b_shipped_item_qty: 2300,
        transfer_c2b_inbound_order_count: 300,
        transfer_c2b_shipped_order_count: 700,
        transfer_c2b_inbound_box_count: 300,
        transfer_c2b_shipped_box_count: 700,
        transfer_c2b_inbound_item_qty: 600,
        transfer_c2b_shipped_item_qty: 1200
      },
      {
        metric_date: '2026-04-20',
        transfer_b2b_inbound_order_count: 1000,
        transfer_b2b_shipped_order_count: 1200,
        transfer_b2b_inbound_box_count: 1000,
        transfer_b2b_shipped_box_count: 1200,
        transfer_b2b_inbound_item_qty: 2000,
        transfer_b2b_shipped_item_qty: 2600,
        transfer_c2b_inbound_order_count: 300,
        transfer_c2b_shipped_order_count: 100,
        transfer_c2b_inbound_box_count: 300,
        transfer_c2b_shipped_box_count: 100,
        transfer_c2b_inbound_item_qty: 600,
        transfer_c2b_shipped_item_qty: 200
      }
    ]);

    expect(rows.map((row) => row.transfer_b2b_unshipped_order_count)).toEqual([300, 200, 0]);
    expect(rows.map((row) => row.transfer_b2b_unshipped_box_count)).toEqual([300, 200, 0]);
    expect(rows.map((row) => row.transfer_b2b_unshipped_item_qty)).toEqual([500, 200, 0]);
    expect(rows.map((row) => row.transfer_c2b_unshipped_order_count)).toEqual([200, 0, 200]);
    expect(rows.map((row) => row.transfer_c2b_unshipped_box_count)).toEqual([200, 0, 200]);
    expect(rows.map((row) => row.transfer_c2b_unshipped_item_qty)).toEqual([300, 0, 400]);
  });

  it('normalizes parseable timestamps', () => {
    expect(normalizePackageTimestamp('2026/04/18 3:4:5')).toBe('2026-04-18 03:04:05');
  });

  it('detects when the selected metric date is outside the inbound date coverage', () => {
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
});
