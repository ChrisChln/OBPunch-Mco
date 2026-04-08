export type WorkHourComparisonEmployeeLite = {
  staffId: string;
  name: string;
  agency: string;
  position: string;
  shift: '' | 'early' | 'late';
};

export type WorkHourComparisonImportedRow = {
  staff_id: string;
  source_user_code: string;
  iams_hours: number;
  upload_batch_id?: number | null;
  fixed_by?: string | null;
  fixed_at?: string | null;
};

export type WorkHourComparisonRow = {
  staffId: string;
  name: string;
  agency: string;
  position: string;
  shift: '' | 'early' | 'late';
  systemHours: number;
  iamsHours: number;
  diffHours: number;
  fixedBy: string;
  fixedAt: string;
};

const roundToTwo = (value: number) => Math.round(Number(value ?? 0) * 100) / 100;

export const buildComparisonRows = (
  importedRows: WorkHourComparisonImportedRow[],
  systemHoursByStaff: Map<string, number>,
  employeeMap: Record<string, WorkHourComparisonEmployeeLite>,
  epsilon = 0.005
): WorkHourComparisonRow[] => {
  const importedByStaff = new Map<string, WorkHourComparisonImportedRow>();
  for (const row of importedRows) {
    const staffId = String(row.staff_id ?? '').trim();
    if (!staffId) continue;
    importedByStaff.set(staffId, row);
  }

  const allStaffIds = new Set<string>(Array.from(importedByStaff.keys()));
  for (const [staffId, systemHours] of systemHoursByStaff.entries()) {
    if (!staffId || Math.abs(Number(systemHours ?? 0)) < epsilon) continue;
    allStaffIds.add(staffId);
  }

  return Array.from(allStaffIds).map((staffId) => {
    const importedRow = importedByStaff.get(staffId);
    const employee = employeeMap[staffId] ?? {
      staffId,
      name: '',
      agency: '',
      position: '',
      shift: '' as const
    };
    const systemHours = roundToTwo(systemHoursByStaff.get(staffId) ?? 0);
    const iamsHours = roundToTwo(importedRow?.iams_hours ?? 0);
    const diffHours = roundToTwo(systemHours - iamsHours);

    return {
      staffId,
      name: employee.name,
      agency: employee.agency,
      position: employee.position,
      shift: employee.shift,
      systemHours,
      iamsHours,
      diffHours,
      fixedBy: String(importedRow?.fixed_by ?? '').trim(),
      fixedAt: String(importedRow?.fixed_at ?? '').trim()
    };
  });
};
