export type EmployeePositionColumnMode = 'lower' | 'cased' | 'both';

type EmployeeColumnMode = 'lower' | 'cased';

type EmployeePositionWritePayload = {
  position?: string | null;
  Position?: string | null;
};

type EmployeeEditWriteInput = {
  employeeColumnMode: EmployeeColumnMode;
  positionColumnMode: EmployeePositionColumnMode;
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

export const probeEmployeePositionColumnMode = async (
  probe: (column: 'position' | 'Position') => Promise<boolean>
): Promise<EmployeePositionColumnMode> => {
  const lowerAvailable = await probe('position');
  const casedAvailable = await probe('Position');

  if (lowerAvailable && casedAvailable) return 'both';
  if (lowerAvailable) return 'lower';
  return 'cased';
};

export const buildEmployeePositionWritePayload = (
  mode: EmployeePositionColumnMode,
  position: string | null
): EmployeePositionWritePayload => {
  if (mode === 'both') return { position, Position: position };
  if (mode === 'lower') return { position };
  return { Position: position };
};

export const buildEmployeeEditWritePayload = ({
  employeeColumnMode,
  positionColumnMode,
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
  ...(employeeColumnMode === 'cased' ? { Agency: agency || null } : { agency: agency || null }),
  ...buildEmployeePositionWritePayload(positionColumnMode, position),
  employment_type: employmentType,
  shift: shift || null,
  shift_time: shiftTime || null,
  label: label || null,
  work_account: workAccount || null,
  work_password: workPassword || null,
  active: true,
  terminated_at: null
});
