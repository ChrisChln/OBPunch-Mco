import type { AgencyEmployeeRow, AgencyNewHireRequestRow, AgencyScheduleState, AgencySummaryCard } from './types';

export const AGENCY_WORKLIKE_STATES: AgencyScheduleState[] = ['new', 'work', 'fixed_work', 'temp_work', 'planned_temp_work'];

export const isAgencyWorklikeState = (state: AgencyScheduleState) => AGENCY_WORKLIKE_STATES.includes(state);

export const computeAgencyGapCount = (
  employees: AgencyEmployeeRow[],
  openSlotsByStaffDate: Map<string, number>,
  selectedDate: string
) => {
  const groupSlots = new Map<string, number>();
  for (const employee of employees) {
    const groupKey = [employee.agency, employee.position, employee.shift].join('__');
    const openSlots = openSlotsByStaffDate.get(`${employee.staff_id}__${selectedDate}`) ?? 0;
    groupSlots.set(groupKey, Math.max(groupSlots.get(groupKey) ?? 0, openSlots));
  }
  return Array.from(groupSlots.values()).reduce((total, value) => total + value, 0);
};

export const computeAgencySummaryCards = ({
  employees,
  newHireRequests,
  openSlotsByStaffDate,
  selectedDate
}: {
  employees: AgencyEmployeeRow[];
  newHireRequests: AgencyNewHireRequestRow[];
  openSlotsByStaffDate: Map<string, number>;
  selectedDate: string;
}): AgencySummaryCard[] => {
  const gapCount = computeAgencyGapCount(employees, openSlotsByStaffDate, selectedDate);
  const newRequestCount = newHireRequests.length;
  const activeCount = employees.length;
  const baseScheduledCount = employees.filter((row) => isAgencyWorklikeState(row.state as AgencyScheduleState)).length;
  const dayOffCount = employees.filter((row) =>
    ['rest', 'temp_rest', 'planned_temp_rest'].includes(String(row.state ?? '').trim())
  ).length;
  const excuseCount = employees.filter((row) =>
    ['leave_pending', 'leave', 'planned_leave'].includes(String(row.state ?? '').trim())
  ).length;
  const scheduledNewHireCount = newHireRequests.filter((row) => String(row.name ?? '').trim()).length;
  const scheduledCount = baseScheduledCount + scheduledNewHireCount;
  const requiredCount = baseScheduledCount + newRequestCount + gapCount;

  return [
    { key: 'active', label: 'Active', value: activeCount },
    { key: 'required', label: 'Required', value: requiredCount },
    { key: 'scheduled', label: 'Scheduled', value: scheduledCount },
    { key: 'new_requests', label: 'New Requests', value: newRequestCount },
    { key: 'gap', label: 'Gap', value: gapCount },
    { key: 'day_off', label: 'Day Off', value: dayOffCount },
    { key: 'excuse', label: 'Excuse#', value: excuseCount }
  ];
};
