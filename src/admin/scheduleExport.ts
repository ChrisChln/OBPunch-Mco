import type { ScheduleBaseState } from './types';

const WORKING_SCHEDULE_STATES: ReadonlySet<ScheduleBaseState> = new Set([
  'new',
  'work',
  'fixed_work',
  'temp_work',
  'planned_temp_work'
]);

export const getScheduleExportCellValue = (
  state: ScheduleBaseState | null,
  resolvedShiftStartTime: string
) => {
  if (!state || !WORKING_SCHEDULE_STATES.has(state)) return '休息';
  return resolvedShiftStartTime;
};
