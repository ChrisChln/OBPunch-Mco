import type { TerminationRequestRecord } from './adminAccessApi';

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
  staffId: readText(request.staff_id),
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

export const executeAgencyTerminationApproval = async ({
  requestId,
  review,
  refreshSchedule,
  refreshRequests
}: ApprovalDependencies): Promise<void> => {
  await review(requestId);
  await Promise.all([refreshSchedule(), refreshRequests()]);
};
