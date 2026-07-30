type EmployeeEditWriteInput = {
  staffId: string;
  name: string;
  agency: string;
  position: string | null;
  employmentType: 'FT' | 'PT';
  shift: '' | 'early' | 'late';
  shiftTime: string;
  label: string;
  workAccount: string;
  workPassword: string;
};

export const buildEmployeeEditWritePayload = ({
  staffId,
  name,
  agency,
  position,
  employmentType,
  shift,
  shiftTime,
  label,
  workAccount,
  workPassword
}: EmployeeEditWriteInput): Record<string, unknown> => ({
  staff_id: staffId,
  name,
  agency: agency || null,
  position,
  employment_type: employmentType,
  shift: shift || null,
  shift_time: shiftTime || null,
  label: label || null,
  work_account: workAccount || null,
  work_password: workPassword || null,
  active: true,
  terminated_at: null
});
