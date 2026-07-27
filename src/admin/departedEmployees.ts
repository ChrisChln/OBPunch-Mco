import type { AuditRow, EmployeeRow, TerminationType } from './types';

type TranslateFn = (zh: string, en: string) => string;

export type DepartedEmployeeFilters = {
  search: string;
  agency: string;
  position: string;
  type: 'all' | TerminationType;
  startDate: string;
  endDate: string;
};

const normalizeText = (value: unknown) => String(value ?? '').trim();
const DEPARTURE_AUDIT_ACTIONS = new Set(['employee_delete', 'employee_termination_approve']);

export const normalizeTerminationReason = (value: unknown) => normalizeText(value);

export const normalizeTerminationType = (value: unknown): TerminationType =>
  normalizeText(value).toLowerCase() === 'blacklist' ? 'blacklist' : 'normal';

export const formatTerminationDate = (value: unknown) => {
  const text = normalizeText(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return date.toISOString().slice(0, 10);
};

export const attachDepartureOperators = (
  rows: EmployeeRow[],
  audits: AuditRow[],
  resolveActor: (audit: AuditRow) => string
): EmployeeRow[] => {
  const auditsByStaffId = new Map<string, Array<{ audit: AuditRow; createdAtMs: number }>>();
  for (const audit of audits) {
    if (!DEPARTURE_AUDIT_ACTIONS.has(normalizeText(audit.action))) continue;
    const staffId = normalizeText(audit.staff_id).toUpperCase();
    const createdAtMs = new Date(normalizeText(audit.created_at)).getTime();
    if (!staffId || !Number.isFinite(createdAtMs)) continue;
    const staffAudits = auditsByStaffId.get(staffId) ?? [];
    staffAudits.push({ audit, createdAtMs });
    auditsByStaffId.set(staffId, staffAudits);
  }
  for (const staffAudits of auditsByStaffId.values()) {
    staffAudits.sort((left, right) => right.createdAtMs - left.createdAtMs);
  }

  return rows.map((row) => {
    const staffId = normalizeText(row.staff_id).toUpperCase();
    const terminatedAtMs = new Date(normalizeText(row.terminated_at)).getTime();
    if (!staffId || !Number.isFinite(terminatedAtMs)) {
      return { ...row, termination_operator: null };
    }
    const matchingAudit = (auditsByStaffId.get(staffId) ?? []).find(
      ({ createdAtMs }) => createdAtMs <= terminatedAtMs
    );
    const terminationOperator = matchingAudit ? normalizeText(resolveActor(matchingAudit.audit)) : '';
    return { ...row, termination_operator: terminationOperator || null };
  });
};

export const filterDepartedEmployees = (rows: EmployeeRow[], filters: DepartedEmployeeFilters) => {
  const needle = normalizeText(filters.search).toLowerCase();
  return rows.filter((row) => {
    const rowAgency = normalizeText(row.agency);
    const rowPosition = normalizeText(row.position);
    const rowType = normalizeTerminationType(row.termination_type);
    const terminatedDate = formatTerminationDate(row.terminated_at);
    if (filters.agency && rowAgency !== filters.agency) return false;
    if (filters.position && rowPosition !== filters.position) return false;
    if (filters.type !== 'all' && rowType !== filters.type) return false;
    if (filters.startDate && (!terminatedDate || terminatedDate < filters.startDate)) return false;
    if (filters.endDate && (!terminatedDate || terminatedDate > filters.endDate)) return false;
    if (!needle) return true;
    const haystack = [
      row.staff_id,
      row.name,
      rowAgency,
      rowPosition,
      normalizeTerminationReason(row.termination_reason),
      row.termination_operator,
      rowType === 'blacklist' ? 'blacklist 黑名单' : 'normal 正常离职',
      row.terminated_at
    ]
      .map((item) => normalizeText(item).toLowerCase())
      .join(' ');
    return haystack.includes(needle);
  });
};

const escapeCsvCell = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildDepartedEmployeesCsv = (
  rows: EmployeeRow[],
  t: TranslateFn,
  displayStaffId: (value: string) => string
) => {
  const header = [
    t('离职日期', 'Departure date'),
    t('名字', 'Name'),
    'USID',
    'Agency',
    'Position',
    t('类型', 'Type'),
    t('离职原因', 'Departure reason'),
    t('操作人', 'Operator')
  ];
  const dataRows = rows.map((row) => {
    const staffId = normalizeText(row.staff_id);
    const type = normalizeTerminationType(row.termination_type);
    return [
      formatTerminationDate(row.terminated_at),
      normalizeText(row.name),
      staffId ? displayStaffId(staffId) : '',
      normalizeText(row.agency),
      normalizeText(row.position),
      type === 'blacklist' ? t('黑名单', 'Blacklist') : t('正常离职', 'Normal'),
      normalizeTerminationReason(row.termination_reason),
      normalizeText(row.termination_operator)
    ];
  });
  return `\uFEFF${[header, ...dataRows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}`;
};
