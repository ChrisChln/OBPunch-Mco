import { describe, expect, test } from 'vitest';
import {
  buildConsumableIntervals,
  classifyConsumableAlert,
  computeConsumableProjection,
  computeWeightedUsagePerOrder,
  formatDaysLeft,
  isConsumableSnapshotDay,
  type ConsumableAdjustment,
  type ConsumableSnapshot
} from '../../src/shared/consumables';

describe('consumables', () => {
  const snapshots: ConsumableSnapshot[] = [
    { item_key: 'box_48', snapshot_date: '2026-04-13', remaining_qty: 1000 },
    { item_key: 'box_48', snapshot_date: '2026-04-16', remaining_qty: 760 },
    { item_key: 'box_48', snapshot_date: '2026-04-20', remaining_qty: 500 }
  ];

  test('recognizes Monday and Thursday snapshot days', () => {
    expect(isConsumableSnapshotDay('2026-04-13')).toBe(true);
    expect(isConsumableSnapshotDay('2026-04-16')).toBe(true);
    expect(isConsumableSnapshotDay('2026-04-15')).toBe(false);
  });

  test('builds usage intervals without adjustments', () => {
    const intervals = buildConsumableIntervals({
      itemKey: 'box_48',
      snapshots,
      adjustments: [],
      inboundOrdersByDate: {
        '2026-04-14': 40,
        '2026-04-15': 60,
        '2026-04-16': 50
      }
    });

    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({
      usageQty: 240,
      inboundOrders: 150
    });
  });

  test('includes restock adjustments in derived usage', () => {
    const adjustments: ConsumableAdjustment[] = [{ item_key: 'box_48', effective_at: '2026-04-18T12:00:00Z', delta_qty: 200 }];
    const intervals = buildConsumableIntervals({
      itemKey: 'box_48',
      snapshots,
      adjustments,
      inboundOrdersByDate: {
        '2026-04-17': 20,
        '2026-04-18': 25,
        '2026-04-19': 30,
        '2026-04-20': 25
      }
    });

    expect(intervals[0]).toMatchObject({
      adjustmentQty: 200,
      usageQty: 460,
      inboundOrders: 100
    });
  });

  test('clamps negative interval usage to zero', () => {
    const intervals = buildConsumableIntervals({
      itemKey: 'box_48',
      snapshots: [
        { item_key: 'box_48', snapshot_date: '2026-04-13', remaining_qty: 100 },
        { item_key: 'box_48', snapshot_date: '2026-04-16', remaining_qty: 250 }
      ],
      adjustments: [{ item_key: 'box_48', effective_at: '2026-04-14T12:00:00Z', delta_qty: 10 }],
      inboundOrdersByDate: {
        '2026-04-14': 50,
        '2026-04-15': 50,
        '2026-04-16': 50
      }
    });

    expect(intervals[0]?.usageQty).toBe(0);
  });

  test('computes weighted usage per order and projected days left', () => {
    const intervals = [
      {
        itemKey: 'box_48' as const,
        startDate: '2026-04-13',
        endDate: '2026-04-16',
        remainingStart: 1000,
        remainingEnd: 760,
        adjustmentQty: 0,
        inboundOrders: 150,
        usageQty: 240,
        usagePerOrder: 1.6
      },
      {
        itemKey: 'box_48' as const,
        startDate: '2026-04-16',
        endDate: '2026-04-20',
        remainingStart: 760,
        remainingEnd: 500,
        adjustmentQty: 200,
        inboundOrders: 100,
        usageQty: 460,
        usagePerOrder: 4.6
      }
    ];

    expect(computeWeightedUsagePerOrder(intervals)).toBe(2.8);

    const projection = computeConsumableProjection({
      latestRemainingQty: 500,
      intervals,
      inboundOrdersByDate: {
        '2026-04-20': 100,
        '2026-04-19': 100,
        '2026-04-18': 100,
        '2026-04-17': 100
      }
    });

    expect(projection.usagePerOrder).toBe(2.8);
    expect(projection.avgDailyUsage).toBe(280);
    expect(projection.estimatedDaysLeft).toBeCloseTo(1.79, 2);
    expect(formatDaysLeft(projection.estimatedDaysLeft)).toBe('1.8');
  });

  test('classifies warning and critical alerts', () => {
    expect(classifyConsumableAlert({ latestRemainingQty: 10, estimatedDaysLeft: 6 })).toEqual({
      alertType: 'low_stock_warning',
      severity: 'warning'
    });
    expect(classifyConsumableAlert({ latestRemainingQty: 0, estimatedDaysLeft: 20 })).toEqual({
      alertType: 'low_stock_critical',
      severity: 'critical'
    });
    expect(classifyConsumableAlert({ latestRemainingQty: 20, estimatedDaysLeft: null })).toEqual({
      alertType: null,
      severity: null
    });
  });
});
