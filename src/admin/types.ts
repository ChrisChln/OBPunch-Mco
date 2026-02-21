export type AdminPage = 'home' | 'employee_upload' | 'punches' | 'employees' | 'timecard' | 'audit' | 'schedule' | 'devices';

export type StatusTone = 'idle' | 'pending' | 'success' | 'error';

export type Status = {
  tone: StatusTone;
  message: string;
};

export type AllowedPosition = 'Pick' | 'Pack' | 'Rebin' | 'Preship' | 'Transfer';

export type DeviceType = 'PDA' | 'CART';

export type ScheduleBaseState = 'work' | 'temp_work' | 'leave' | 'temp_rest' | 'rest';
export type ScheduleDisplayState = 'empty' | ScheduleBaseState | 'rest_worked';

export type EmployeeRow = {
  id?: number | string;
  staff_id?: string | null;
  name?: string | null;
  agency?: string | null;
  position?: string | null;
  shift?: '' | 'early' | 'late' | null;
  label?: string | null;
  work_account?: string | null;
  work_password?: string | null;
  Agency?: string | null;
  Position?: string | null;
  Label?: string | null;
  WorkAccount?: string | null;
  WorkPassword?: string | null;
  created_at?: string | null;
};

export type SchedulePickerState = {
  open: boolean;
  cellKey: string;
  employee: EmployeeRow | null;
  dayIndex: number;
  workDate: string;
  targetShift: 'early' | 'late';
  currentState: ScheduleDisplayState;
  anchorLeft: number;
  anchorTop: number;
};

export type TimecardRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  hoursByDay: number[]; // 0..6 (Mon..Sun)
  punchCountByDay: number[]; // 0..6 (Mon..Sun)
  punchCountMismatchByDay: boolean[]; // 0..6 (Mon..Sun)
  scheduledByDay: boolean[]; // 0..6 (Mon..Sun)
  absentByDay: boolean[]; // 0..6 (Mon..Sun)
  leaveByDay: boolean[]; // 0..6 (Mon..Sun)
  tempRestByDay: boolean[]; // 0..6 (Mon..Sun)
  restByDay: boolean[]; // 0..6 (Mon..Sun)
  inProgressByDay: boolean[]; // 0..6 (Mon..Sun)
  inProgressWeek: boolean;
  manualByDay: boolean[]; // 0..6 (Mon..Sun)
  manualWeek: boolean;
  totalHours: number;
  shift: '' | 'early' | 'late';
};

export type PunchRow = {
  id: number | string;
  staff_id: string;
  action: 'IN' | 'OUT';
  created_at: string | null;
};

export type AuditRow = {
  id?: number | string;
  created_at?: string | null;
  actor?: string | null;
  action?: string | null;
  staff_id?: string | null;
  target?: string | null;
  payload?: any;
};

export type ScheduleRow = {
  id?: number | string;
  staff_id?: string | null;
  date?: string | null; // YYYY-MM-DD
  shift?: 'early' | 'late' | null;
  position?: string | null;
  note?: string | null;
  operator?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type DailyListRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: 'early' | 'late';
};

export type DeviceRow = {
  id?: number | string;
  device_name?: string | null;
  name?: string | null;
  device_sn?: string | null;
  sn?: string | null;
  device_type?: string | null;
  type?: string | null;
  position?: string | null;
  active?: boolean | null;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DeviceLoanRow = {
  id?: number | string;
  created_at?: string | null;
  operator?: string | null;
  staff_id?: string | null;
  device_sn?: string | null;
  action?: 'borrow' | 'return' | string | null;
  note?: string | null;
};

export type DeviceLabelPrintPayload = {
  sn: string;
  name: string;
  position: string;
  type: string;
};

export type DeviceLabelPrintPreview = DeviceLabelPrintPayload & {
  qrDataUrl: string;
};

export type AppSettingRow = {
  id?: number | string;
  key?: string | null;
  value?: any;
  updated_at?: string | null;
};
