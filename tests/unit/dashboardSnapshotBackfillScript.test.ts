import { describe, expect, test } from 'vitest';

import {
  buildExpectedSnapshotRows,
  buildSnapshotBackfillDates,
  buildSnapshotBackfillRequest,
  resolveSnapshotBackfillConfig
} from '../../scripts/dashboard-attendance-snapshot-backfill.mjs';

describe('dashboard attendance snapshot backfill script', () => {
  test('builds inclusive dates from July 1 through today', () => {
    expect(buildSnapshotBackfillDates('2026-07-01', '2026-07-05')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05'
    ]);
  });

  test('uses expected snapshot endpoint with dry run and work date', () => {
    const request = buildSnapshotBackfillRequest({
      baseUrl: 'https://example.test/',
      token: 'secret-token',
      workDate: '2026-07-04',
      dryRun: true
    });

    expect(request.url).toBe('https://example.test/api/dashboard-attendance-snapshot-expected?work_date=2026-07-04&dry_run=true');
    expect(request.options).toEqual({
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret-token'
      }
    });
  });

  test('resolves default July backfill config', () => {
    const config = resolveSnapshotBackfillConfig(
      new Map([
        ['APP_BASE_URL', 'https://example.test'],
        ['ADMIN_TOKEN', 'admin-token']
      ]),
      {
        now: new Date('2026-07-05T16:00:00.000Z'),
        timezone: 'America/New_York'
      }
    );

    expect(config).toEqual(expect.objectContaining({
      baseUrl: 'https://example.test',
      token: 'admin-token',
      startDate: '2026-07-01',
      endDate: '2026-07-05',
      dryRun: false,
      mode: 'direct'
    }));
  });

  test('builds expected-only rows from working schedules', () => {
    const rows = buildExpectedSnapshotRows({
      workDate: '2026-07-01',
      schedules: [
        { staff_id: 'US001', position: 'Pick', note: null, created_at: '2026-07-01T01:00:00Z' },
        { staff_id: 'US002', position: 'Pick', note: '__rest__', created_at: '2026-07-01T01:00:00Z' },
        { staff_id: 'US003', position: 'Pack', note: null, created_at: '2026-07-01T01:00:00Z' },
        { staff_id: 'US004', position: 'Hidden Desk', note: null, created_at: '2026-07-01T01:00:00Z' }
      ],
      employees: [
        { staff_id: 'US001', agency: 'Prime', position: 'Pick', shift: 'early', active: true },
        { staff_id: 'US002', agency: 'Prime', position: 'Pick', shift: 'early', active: true },
        { staff_id: 'US003', agency: 'JDL', position: 'Pack', shift: 'late', active: true },
        { staff_id: 'US004', agency: 'Prime', position: 'Hidden Desk', shift: 'early', active: true }
      ],
      positions: [
        { name: 'Pick', department: 'OB', is_active: true, display_order: 1 },
        { name: 'Pack', department: 'OB', is_active: true, display_order: 2 },
        { name: 'Hidden Desk', department: 'hidden', is_active: true, display_order: 3 }
      ],
      capturedAt: '2026-07-05T13:00:00.000Z'
    });

    expect(rows).toEqual([
      expect.objectContaining({
        work_date: '2026-07-01',
        shift: 'early',
        position: 'Pick',
        department: 'OB',
        expected: 1,
        snapshot_status: 'expected'
      })
    ]);
  });
});
