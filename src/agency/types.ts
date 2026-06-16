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
  agencyStatus: 'ready' | 'wait_confirm';
  fixed_work_count: number;
  has_absent: boolean;
  has_late: boolean;
  termination_status: string | null;
  driver_group_code: string;
  driver_group_role: 'driver' | 'member' | '';
  driver_group_label: string;
  agency_note: string;
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
  can_delete: boolean;
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
  driver_group_code: string;
  driver_group_role: 'driver' | 'member' | '';
  driver_group_label: string;
  agency_note: string;
  days: AgencyWeekScheduleCell[];
};

export type AgencyWeekSchedule = {
  week_dates: string[];
  employees: AgencyWeekScheduleRow[];
  new_hire_requests: AgencyWeekNewHireRequest[];
  driver_groups: AgencyDriverGroupSummary[];
  next_driver_group_code: string;
};

export type AgencyDriverGroupRole = 'driver' | 'member';

export type AgencyDriverGroupAssignment = {
  code: string;
  role: AgencyDriverGroupRole;
  label: string;
};

export type AgencyDriverGroupSummary = {
  code: string;
  activeMemberCount: number;
  memberCount: number;
  driverCount: number;
  labels: string[];
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
  can_delete: boolean;
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
