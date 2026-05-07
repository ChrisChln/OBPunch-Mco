import { describe, expect, test } from 'vitest';

import { computeCurrentConsumableRows } from '../../scripts/reset-consumable-inventory.mjs';

const baseItems = [
  { item_key: 'box_48', item_label: 'Box 48', sort_order: 10, is_active: true, deleted_at: null },
  { item_key: 'wrap', item_label: 'Wrap', sort_order: 20, is_active: true, deleted_at: null }
];

describe('reset consumable inventory script', () => {
  test('uses latest snapshot plus positive post-snapshot adjustments', () => {
    const rows = computeCurrentConsumableRows({
      items: baseItems,
      snapshots: [
        {
          id: 'old',
          item_key: 'box_48',
          snapshot_date: '2026-05-01',
          remaining_qty: 100,
          created_at: '2026-05-01T12:00:00.000Z'
        },
        {
          id: 'latest',
          item_key: 'box_48',
          snapshot_date: '2026-05-05',
          remaining_qty: 80,
          created_at: '2026-05-05T12:00:00.000Z'
        }
      ],
      adjustments: [
        { item_key: 'box_48', effective_at: '2026-05-05T11:00:00.000Z', delta_qty: 50 },
        { item_key: 'box_48', effective_at: '2026-05-05T13:00:00.000Z', delta_qty: 25 }
      ]
    });

    expect(rows.find((row) => row.item_key === 'box_48')?.remaining_qty).toBe(105);
  });

  test('falls back to positive total adjustments when no snapshot exists', () => {
    const rows = computeCurrentConsumableRows({
      items: baseItems,
      snapshots: [],
      adjustments: [
        { item_key: 'wrap', effective_at: '2026-05-05T13:00:00.000Z', delta_qty: 24 },
        { item_key: 'wrap', effective_at: '2026-05-05T14:00:00.000Z', delta_qty: -4 }
      ]
    });

    expect(rows.find((row) => row.item_key === 'wrap')?.remaining_qty).toBe(20);
  });

  test('ignores inactive and deleted items', () => {
    const rows = computeCurrentConsumableRows({
      items: [
        ...baseItems,
        { item_key: 'inactive', item_label: 'Inactive', sort_order: 30, is_active: false, deleted_at: null },
        { item_key: 'deleted', item_label: 'Deleted', sort_order: 40, is_active: true, deleted_at: '2026-05-01T00:00:00.000Z' }
      ],
      snapshots: [],
      adjustments: []
    });

    expect(rows.map((row) => row.item_key)).toEqual(['box_48', 'wrap']);
  });
});
