import { describe, expect, test } from 'vitest';
import {
  formatLeaveDateTime,
  getApproveWindow,
  getCurrentOperationalDate,
  getEffectiveLeaveStatus,
  getTemplateDateByActualDate
} from '../../src/admin/leaveApprovalShared';

describe('leaveApprovalShared', () => {
  test('formats leave timestamps in New York time', () => {
    expect(formatLeaveDateTime('2026-07-27T12:30:00.000Z')).toContain('08:30');
    expect(formatLeaveDateTime('2026-01-27T12:30:00.000Z')).toContain('07:30');
  });

  test('uses a dash for missing or invalid leave timestamps', () => {
    expect(formatLeaveDateTime(null)).toBe('-');
    expect(formatLeaveDateTime('not-a-date')).toBe('-');
  });

  test('operational day rolls back before cutoff hour', () => {
    expect(getCurrentOperationalDate(new Date('2026-04-07T04:59:59'))).toBe('2026-04-06');
    expect(getCurrentOperationalDate(new Date('2026-04-07T05:00:00'))).toBe('2026-04-07');
  });

  test('approve window covers current week and next week from operational day', () => {
    expect(getApproveWindow(new Date('2026-04-07T14:00:00'))).toEqual({
      operationalDate: '2026-04-07',
      editableStart: '2026-04-06',
      editableEnd: '2026-04-19'
    });
  });

  test('template mapping covers current and next week only', () => {
    expect(getTemplateDateByActualDate('2026-04-06', '2026-04-06')).toBe('2000-01-03');
    expect(getTemplateDateByActualDate('2026-04-13', '2026-04-06')).toBe('2000-01-10');
    expect(getTemplateDateByActualDate('2026-04-20', '2026-04-06')).toBe('');
  });

  test('pending leave becomes expired only when it is older than editable start', () => {
    const serverTime = new Date('2026-04-07T14:00:00');
    expect(getEffectiveLeaveStatus('pending', '2026-04-05', serverTime)).toBe('expired');
    expect(getEffectiveLeaveStatus('pending', '2026-04-06', serverTime)).toBe('pending');
    expect(getEffectiveLeaveStatus('approved', '2026-04-05', serverTime)).toBe('approved');
  });
});
