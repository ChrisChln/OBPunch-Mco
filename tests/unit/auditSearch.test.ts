import { describe, expect, test } from 'vitest';
import { buildAuditSearchText, matchesAuditSearch } from '../../src/admin/auditSearch';
import type { AuditRow } from '../../src/admin/types';

describe('auditSearch', () => {
  test('matches employee display names that are not stored on the audit row', () => {
    const row: AuditRow = {
      action: 'employee_update',
      staff_id: 'US019418',
      target: 'ob_employees',
      payload: { after: { position: 'Pick' } }
    };

    expect(matchesAuditSearch(row, 'Jennifer Bravo', { employeeName: 'Jennifer Bravo' })).toBe(true);
    expect(matchesAuditSearch(row, 'jenniferbravo', { employeeName: 'Jennifer Bravo' })).toBe(true);
  });

  test('matches payload values shown in audit details', () => {
    const row: AuditRow = {
      action: 'employee_update',
      staff_id: 'US019374',
      target: 'ob_employees',
      payload: {
        before: { work_password: '' },
        after: { work_password: 'Mco123456' }
      }
    };

    expect(matchesAuditSearch(row, 'Mco123456')).toBe(true);
    expect(matchesAuditSearch(row, 'work password')).toBe(true);
  });

  test('matches action labels and formatted detail text', () => {
    const row: AuditRow = {
      action: 'schedule_leave',
      staff_id: 'US018948',
      target: 'ob_schedules',
      payload: { date: '2026-06-18' }
    };

    expect(
      matchesAuditSearch(row, '计划请假', {
        actionLabel: '计划请假',
        detailValues: ['日期 2026-06-18']
      })
    ).toBe(true);
  });

  test('includes actor, raw actor, action, target, and staff id in search text', () => {
    const row: AuditRow & { actor_raw?: string } = {
      actor: 'Linnan',
      actor_raw: 'US000001',
      action: 'leave_request_approve',
      staff_id: 'us018948',
      target: 'ob_leave_requests',
      payload: null
    };

    const text = buildAuditSearchText(row);

    expect(text).toContain('US018948');
    expect(matchesAuditSearch(row, 'US000001')).toBe(true);
    expect(matchesAuditSearch(row, 'leave request approve')).toBe(true);
    expect(matchesAuditSearch(row, 'ob leave requests')).toBe(true);
  });
});
