import { describe, expect, test, vi } from 'vitest';

import {
  executeAgencyTerminationApproval,
  normalizeAgencyTerminationDetails
} from '../../src/admin/agencyTerminationApproval';
import type { TerminationRequestRecord } from '../../src/admin/adminAccessApi';

const request: TerminationRequestRecord = {
  id: 'request-1',
  staff_id: ' US019737 ',
  agency: ' Prime ',
  requested_by_display: 'Agency User',
  reason: ' Attendance issue ',
  status: 'pending',
  review_note: '',
  created_at: '2026-07-27T10:00:00Z',
  reviewed_at: null,
  reviewed_by_user_id: null,
  employee_snapshot: { name: ' Karla Hernandez ', position: ' PACK ' }
};

describe('normalizeAgencyTerminationDetails', () => {
  test('normalizes the five read-only approval fields', () => {
    expect(normalizeAgencyTerminationDetails(request)).toEqual({
      staffId: 'US019737',
      name: 'Karla Hernandez',
      agency: 'Prime',
      position: 'PACK',
      reason: 'Attendance issue'
    });
  });

  test('uses dashes for invalid optional snapshot values', () => {
    expect(
      normalizeAgencyTerminationDetails({
        ...request,
        agency: '',
        reason: '',
        employee_snapshot: { name: null, position: { invalid: true } }
      })
    ).toEqual({
      staffId: 'US019737',
      name: '-',
      agency: '-',
      position: '-',
      reason: '-'
    });
  });
});

describe('executeAgencyTerminationApproval', () => {
  test('reviews before refreshing schedule and requests', async () => {
    const calls: string[] = [];
    await executeAgencyTerminationApproval({
      requestId: 'request-1',
      review: async (id) => {
        calls.push(`review:${id}`);
      },
      refreshSchedule: async () => {
        calls.push('schedule');
      },
      refreshRequests: async () => {
        calls.push('requests');
      }
    });

    expect(calls[0]).toBe('review:request-1');
    expect(calls.slice(1).sort()).toEqual(['requests', 'schedule']);
  });

  test('does not refresh after a failed review', async () => {
    const refreshSchedule = vi.fn();
    const refreshRequests = vi.fn();
    await expect(
      executeAgencyTerminationApproval({
        requestId: 'request-1',
        review: async () => {
          throw new Error('RPC failed');
        },
        refreshSchedule,
        refreshRequests
      })
    ).rejects.toThrow('RPC failed');
    expect(refreshSchedule).not.toHaveBeenCalled();
    expect(refreshRequests).not.toHaveBeenCalled();
  });
});
