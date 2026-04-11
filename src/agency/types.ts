import type { AdminAccessContext } from '../shared/adminAccess';

export type AgencySummaryCard = {
  key: string;
  label: string;
  value: number;
};

export type AgencyAttendanceCard = AgencySummaryCard;

export type AgencyEmployeeRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: 'early' | 'late' | '';
  start_time: string;
  label: string;
  state: string;
  fixed_work_count: number;
  has_absent: boolean;
  has_late: boolean;
  termination_status: string | null;
};

export type AgencyScheduleState =
  | 'new'
  | 'work'
  | 'fixed_work'
  | 'temp_work'
  | 'planned_temp_work'
  | 'leave_pending'
  | 'leave'
  | 'planned_leave'
  | 'temp_rest'
  | 'planned_temp_rest'
  | 'rest';

export type AgencyWeekScheduleCell = {
  work_date: string;
  template_date: string;
  state: AgencyScheduleState;
  base_state: AgencyScheduleState;
  substitute_open_count: number;
};

export type AgencyWeekNewHireRequest = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: 'early' | 'late' | '';
  start_time: string;
  label: string;
  work_date: string;
};

export type AgencyWeekScheduleRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: 'early' | 'late' | '';
  start_time: string;
  label: string;
  fixed_work_count: number;
  termination_status: string | null;
  days: AgencyWeekScheduleCell[];
};

export type AgencyWeekSchedule = {
  week_dates: string[];
  employees: AgencyWeekScheduleRow[];
  new_hire_requests: AgencyWeekNewHireRequest[];
};

export type AgencyNewHireRequestRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: 'early' | 'late' | '';
  start_time: string;
  label: string;
  state: string;
};

export type AgencyLogRow = {
  id: string | number;
  created_at: string;
  actor: string;
  action: string;
  staff_id: string | null;
  payload: Record<string, unknown>;
};

export type AgencyBoard = {
  work_date: string;
  template_date: string;
  role: string;
  managed_agencies: string[];
  summary_cards: AgencySummaryCard[];
  attendance_cards: AgencyAttendanceCard[];
  employees: AgencyEmployeeRow[];
  new_hire_requests: AgencyNewHireRequestRow[];
  logs: AgencyLogRow[];
};

export type AgencyUpsertNewHireInput = {
  staffId?: string | null;
  workDate: string;
  position: string;
  shift: 'early' | 'late';
  agency: string;
  label: string;
  entryTime: string;
  note: string;
  count: number;
  employeeName: string;
  lockedAgency?: boolean;
  lockedPosition?: boolean;
  lockedShift?: boolean;
  lockedWorkDate?: boolean;
};

export type AgencySessionState = {
  access: AdminAccessContext | null;
  displayName: string;
};
