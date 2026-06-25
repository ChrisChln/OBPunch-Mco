import type { AgencyEmployeeRow, AgencyNewHireRequestRow } from './types';

export type AgencyExistingEmployeeNameRecord = {
  staffId: string;
  name: string;
  terminatedAt: string | null;
};

export type AgencyNewHireNameConflict =
  | {
      type: 'scheduled_employee';
      staffId: string;
      name: string;
    }
  | {
      type: 'new_hire_request';
      staffId: string;
      name: string;
    }
  | {
      type: 'active_employee_record';
      staffId: string;
      name: string;
    }
  | {
      type: 'departed_employee_record';
      staffId: string;
      name: string;
    };

export const normalizeAgencyEmployeeName = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

type FindAgencyNewHireNameConflictOptions = {
  scheduledEmployees: AgencyEmployeeRow[];
  newHireRequests: AgencyNewHireRequestRow[];
  existingEmployeeRecords: AgencyExistingEmployeeNameRecord[];
  ignoreNewHireStaffId?: string | null;
};

export const findAgencyNewHireNameConflict = (
  employeeName: string,
  options: FindAgencyNewHireNameConflictOptions
): AgencyNewHireNameConflict | null => {
  const normalizedName = normalizeAgencyEmployeeName(employeeName);
  if (!normalizedName) return null;

  const scheduledEmployee = options.scheduledEmployees.find(
    (employee) => normalizeAgencyEmployeeName(employee.name) === normalizedName
  );
  if (scheduledEmployee) {
    return {
      type: 'scheduled_employee',
      staffId: String(scheduledEmployee.staff_id ?? '').trim(),
      name: String(scheduledEmployee.name ?? '').trim()
    };
  }

  const ignoredNewHireStaffId = String(options.ignoreNewHireStaffId ?? '').trim();
  const newHireRequest = options.newHireRequests.find((request) => {
    if (ignoredNewHireStaffId && String(request.staff_id ?? '').trim() === ignoredNewHireStaffId) return false;
    return normalizeAgencyEmployeeName(request.name) === normalizedName;
  });
  if (newHireRequest) {
    return {
      type: 'new_hire_request',
      staffId: String(newHireRequest.staff_id ?? '').trim(),
      name: String(newHireRequest.name ?? '').trim()
    };
  }

  const existingEmployeeRecord = options.existingEmployeeRecords.find(
    (record) => normalizeAgencyEmployeeName(record.name) === normalizedName
  );
  if (!existingEmployeeRecord) return null;

  return {
    type: existingEmployeeRecord.terminatedAt ? 'departed_employee_record' : 'active_employee_record',
    staffId: String(existingEmployeeRecord.staffId ?? '').trim(),
    name: String(existingEmployeeRecord.name ?? '').trim()
  };
};
