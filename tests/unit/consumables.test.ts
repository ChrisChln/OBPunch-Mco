import { describe, expect, test } from 'vitest';
import {
  buildConsumableIntervals,
  classifyConsumableAlert,
  computeConsumableProjection,
  computeWeightedUsagePerOrder,
  formatDaysLeft,
  groupConsumableRows,
  isConsumableSnapshotDay,
  normalizeConsumableGroupKey,
  type ConsumableAdjustment,
  type ConsumableDashboardItem,
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
