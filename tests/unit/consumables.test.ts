import { describe, expect, test } from 'vitest';
import {
  buildConsumableIntervals,
  classifyConsumableAlert,
  computeConsumableCurrentRemaining,
  computeConsumableProjection,
  computeWeightedUsagePerOrder,
  formatDaysLeft,
  groupConsumableRows,
  isConsumableSnapshotDay,
  normalizeConsumableGroupKey,
  type ConsumableAdjustment,
  type ConsumableDashboardItem,
  type ConsumableIntervalUsage,
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

    const interval = intervals.find((row) => row.endDate === '2026-04-16');

    expect(interval).toMatchObject({
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

    const interval = intervals.find((row) => row.endDate === '2026-04-20');

    expect(interval).toMatchObject({
      adjustmentQty: 200,
      usageQty: 460,
      inboundOrders: 100
    });
  });

  test('excludes undone restock pairs from derived usage', () => {
    const adjustments: ConsumableAdjustment[] = [
      { id: 'restock-1', item_key: 'box_48', effective_at: '2026-04-18T12:00:00Z', delta_qty: 200, reason: 'restock' },
      {
        id: 'undo-1',
        item_key: 'box_48',
        effective_at: '2026-04-19T12:00:00Z',
        delta_qty: -200,
        reason: 'restock',
        note: 'undo_consumable_adjustment:restock-1'
      }
    ];

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

    const interval = intervals.find((row) => row.endDate === '2026-04-20');

    expect(interval).toMatchObject({
      adjustmentQty: 0,
      usageQty: 260,
      inboundOrders: 100
    });
  });

  test('excludes undone restock pairs across snapshot intervals', () => {
    const intervalSnapshots: ConsumableSnapshot[] = [
      { item_key: 'box_48', snapshot_date: '2026-04-16', remaining_qty: 760 },
      { item_key: 'box_48', snapshot_date: '2026-04-20', remaining_qty: 500 },
      { item_key: 'box_48', snapshot_date: '2026-04-24', remaining_qty: 300 }
    ];
    const adjustments: ConsumableAdjustment[] = [
      { id: 'restock-1', item_key: 'box_48', effective_at: '2026-04-18T12:00:00Z', delta_qty: 200, reason: 'restock' },
      {
        id: 'undo-1',
        item_key: 'box_48',
        effective_at: '2026-04-22T12:00:00Z',
        delta_qty: -200,
        reason: 'restock',
        note: 'undo_consumable_adjustment:restock-1'
      }
    ];

    const intervals = buildConsumableIntervals({
      itemKey: 'box_48',
      snapshots: intervalSnapshots,
      adjustments,
      inboundOrdersByDate: {
        '2026-04-17': 20,
        '2026-04-18': 25,
        '2026-04-19': 30,
        '2026-04-20': 25,
        '2026-04-21': 25,
        '2026-04-22': 25,
        '2026-04-23': 25,
        '2026-04-24': 25
      }
    });

    expect(intervals.find((row) => row.endDate === '2026-04-20')).toMatchObject({
      adjustmentQty: 0,
      usageQty: 260
    });
    expect(intervals.find((row) => row.endDate === '2026-04-24')).toMatchObject({
      adjustmentQty: 0,
      usageQty: 200
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

  test('projects days left from direct snapshot daily consumption', () => {
    const intervals = buildConsumableIntervals({
      itemKey: 'box_48',
      snapshots: [
        { item_key: 'box_48', snapshot_date: '2026-04-01', remaining_qty: 100 },
        { item_key: 'box_48', snapshot_date: '2026-04-05', remaining_qty: 10 }
      ],
      adjustments: [],
      inboundOrdersByDate: {}
    });

    const projection = computeConsumableProjection({
      latestRemainingQty: 10,
      intervals,
      inboundOrdersByDate: {}
    });

    expect(intervals[0]).toMatchObject({
      usageQty: 90,
      dailyUsage: 18
    });
    expect(projection.avgDailyUsage).toBe(18);
    expect(projection.estimatedDaysLeft).toBeCloseTo(10 / 18, 2);
  });

  test('uses restock adjustments as current stock before the first snapshot', () => {
    expect(
      computeConsumableCurrentRemaining({
        latestSnapshotQty: null,
        totalAdjustmentQty: 196,
        postSnapshotAdjustmentQty: 0
      })
    ).toBe(196);
  });

  test('includes restock in snapshot daily consumption projection', () => {
    const intervals = buildConsumableIntervals({
      itemKey: 'box_48',
      snapshots: [
        { item_key: 'box_48', snapshot_date: '2026-04-01', remaining_qty: 100 },
        { item_key: 'box_48', snapshot_date: '2026-04-05', remaining_qty: 30 }
      ],
      adjustments: [{ item_key: 'box_48', effective_at: '2026-04-03T12:00:00Z', delta_qty: 20 }],
      inboundOrdersByDate: {}
    });

    const projection = computeConsumableProjection({
      latestRemainingQty: 30,
      intervals,
      inboundOrdersByDate: {}
    });

    expect(intervals[0]).toMatchObject({
      adjustmentQty: 20,
      usageQty: 90,
      dailyUsage: 18
    });
    expect(projection.avgDailyUsage).toBe(18);
    expect(projection.estimatedDaysLeft).toBeCloseTo(30 / 18, 2);
  });

  test('ignores zero-consumption correction intervals in projections', () => {
    const intervals: ConsumableIntervalUsage[] = [
      {
        itemKey: 'box_48',
        startDate: '2026-04-01',
        endDate: '2026-04-02',
        daysCovered: 2,
        remainingStart: 100,
        remainingEnd: 120,
        adjustmentQty: 0,
        inboundOrders: 100,
        usageQty: 0,
        dailyUsage: 0,
        usagePerOrder: 0
      },
      {
        itemKey: 'box_48',
        startDate: '2026-04-02',
        endDate: '2026-04-04',
        daysCovered: 3,
        remainingStart: 120,
        remainingEnd: 90,
        adjustmentQty: 0,
        inboundOrders: 100,
        usageQty: 30,
        dailyUsage: 10,
        usagePerOrder: 0.3
      }
    ];

    const projection = computeConsumableProjection({
      latestRemainingQty: 90,
      intervals,
      inboundOrdersByDate: {}
    });

    expect(projection.avgDailyUsage).toBe(10);
    expect(projection.estimatedDaysLeft).toBe(9);
  });

  test('filters extreme usage-per-order outliers when enough intervals exist', () => {
    const intervals: ConsumableIntervalUsage[] = [
      {
        itemKey: 'box_48',
        startDate: '2026-04-01',
        endDate: '2026-04-02',
        daysCovered: 2,
        remainingStart: 200,
        remainingEnd: 180,
        adjustmentQty: 0,
        inboundOrders: 100,
        usageQty: 20,
        dailyUsage: 10,
        usagePerOrder: 0.2
      },
      {
        itemKey: 'box_48',
        startDate: '2026-04-02',
        endDate: '2026-04-03',
        daysCovered: 2,
        remainingStart: 180,
        remainingEnd: 158,
        adjustmentQty: 0,
        inboundOrders: 100,
        usageQty: 22,
        dailyUsage: 11,
        usagePerOrder: 0.22
      },
      {
        itemKey: 'box_48',
        startDate: '2026-04-03',
        endDate: '2026-04-04',
        daysCovered: 2,
        remainingStart: 158,
        remainingEnd: 0,
        adjustmentQty: 0,
        inboundOrders: 10,
        usageQty: 158,
        dailyUsage: 79,
        usagePerOrder: 15.8
      }
    ];

    const projection = computeConsumableProjection({
      latestRemainingQty: 158,
      intervals,
      inboundOrdersByDate: {}
    });

    expect(projection.usagePerOrder).toBe(0.21);
    expect(projection.avgDailyUsage).toBe(10.5);
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

  test('supports dynamic item keys in interval calculations', () => {
    const dynamicSnapshots: ConsumableSnapshot[] = [
      { item_key: 'custom_pack_bag', snapshot_date: '2026-04-13', remaining_qty: 120 },
      { item_key: 'custom_pack_bag', snapshot_date: '2026-04-16', remaining_qty: 90 }
    ];

    const intervals = buildConsumableIntervals({
      itemKey: 'custom_pack_bag',
      snapshots: dynamicSnapshots,
      adjustments: [],
      inboundOrdersByDate: {
        '2026-04-14': 10,
        '2026-04-15': 10,
        '2026-04-16': 10
      }
    });

    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({
      itemKey: 'custom_pack_bag',
      usageQty: 30,
      inboundOrders: 30
    });
  });

  test('normalizes consumable group keys and falls back to uncategorized', () => {
    expect(normalizeConsumableGroupKey('packing')).toBe('packing');
    expect(normalizeConsumableGroupKey('last_mile')).toBe('last_mile');
    expect(normalizeConsumableGroupKey('transfer')).toBe('transfer');
    expect(normalizeConsumableGroupKey('standard')).toBe('uncategorized');
    expect(normalizeConsumableGroupKey(null)).toBe('uncategorized');
  });

  test('groups active consumable rows by configured zone', () => {
    const rows: ConsumableDashboardItem[] = [
      { item_key: 'box_48', item_label: 'Box 48', group_key: null, warning_days: 7, critical_days: 3, sort_order: 10, is_active: true },
      { item_key: 'mailer', item_label: 'Mailer', group_key: 'packing', warning_days: 7, critical_days: 3, sort_order: 20, is_active: true },
      { item_key: 'inactive', item_label: 'Inactive', group_key: 'transfer', warning_days: 7, critical_days: 3, sort_order: 30, is_active: false }
    ];

    const groups = groupConsumableRows(rows);

    expect(groups.find((group) => group.key === 'packing')?.items.map((item) => item.item_key)).toEqual(['mailer']);
    expect(groups.find((group) => group.key === 'uncategorized')?.items.map((item) => item.item_key)).toEqual(['box_48']);
    expect(groups.flatMap((group) => group.items.map((item) => item.item_key))).not.toContain('inactive');
  });
});
