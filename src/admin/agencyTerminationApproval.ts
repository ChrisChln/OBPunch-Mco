import type { TerminationRequestRecord } from './adminAccessApi';
import { normalizeStaffId } from '../lib/staffId';

export type AgencyTerminationDetails = {
  staffId: string;
  name: string;
  agency: string;
  position: string;
  reason: string;
};

const readText = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim() : '-';

export const normalizeAgencyTerminationDetails = (
  request: TerminationRequestRecord
): AgencyTerminationDetails => ({
  staffId: normalizeStaffId(request.staff_id) || '-',
  name: readText(request.employee_snapshot?.name),
  agency: readText(request.agency),
  position: readText(request.employee_snapshot?.position),
  reason: readText(request.reason)
});

type ApprovalDependencies = {
  requestId: string;
  review: (requestId: string) => Promise<unknown>;
  refreshSchedule: () => Promise<unknown>;
  refreshRequests: () => Promise<unknown>;
};

export type AgencyTerminationApprovalResult = {
  refreshError: string | null;
};

const readErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message.trim() : String(error || 'Refresh failed.');

export const executeAgencyTerminationApproval = async ({
  requestId,
  review,
  refreshSchedule,
  refreshRequests
}: ApprovalDependencies): Promise<AgencyTerminationApprovalResult> => {
  await review(requestId);
  const refreshResults = await Promise.allSettled([refreshSchedule(), refreshRequests()]);
  const refreshErrors = refreshResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => readErrorMessage(result.reason));
  return { refreshError: refreshErrors.length ? refreshErrors.join('; ') : null };
};

export type AgencyTerminationSubmissionLock = {
  tryAcquire: () => boolean;
  release: () => void;
};

export const createAgencyTerminationSubmissionLock = (): AgencyTerminationSubmissionLock => {
  let active = false;
  return {
    tryAcquire: () => {
      if (active) return false;
      active = true;
      return true;
    },
    release: () => {
      active = false;
    }
  };
};
