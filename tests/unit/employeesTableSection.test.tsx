import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import EmployeesTableSection from '../../src/admin/pages/EmployeesTableSection';
import type { LabelToneKey } from '../../src/lib/labelTone';

vi.mock('../../src/components/GlowLabelChip', () => ({
  default: ({ children, tone }: { children: ReactNode; tone?: LabelToneKey }) => (
    <span data-testid="glow-chip" data-tone={tone}>
      {children}
    </span>
  ),
  getGlowToneForShift: () => 'slate'
}));

const t = (_zh: string, en: string) => en;

const baseProps = {
  t,
  isLocked: false,
  themeMode: 'dark' as const,
  employeesError: null,
  employeesFiltered: [
    {
      id: 'row-1',
      staff_id: 'US001',
      name: 'Alex',
      agency: 'Prime',
      position: 'JDL',
      employment_type: 'FT'
    }
  ],
  employeeSortByPosition: false,
  employeeSortByLastPunchDesc: false,
  employeePunchMetaLoading: false,
  employeeSortByHireDateDesc: false,
  onTogglePositionSort: vi.fn(),
  onToggleSort: vi.fn(),
  onToggleHireDateSort: vi.fn(),
  displayStaffId: (value: string) => value,
  getEmployeeDisplayName: (employee: Record<string, unknown>) => String(employee.name ?? ''),
  getSchedulePositionBadgeClass: () => 'position-class',
  getScheduleLabelTone: () => 'slate' as LabelToneKey,
  getScheduleLabelToneClass: () => 'label-class',
  getShiftBadgeClass: () => 'shift-class',
  employeeShiftByStaffId: {},
  scheduleRowsByStaffDayIndex: new Map<string, unknown>(),
  normalizeStaffId: (value: string) => value.trim().toUpperCase(),
  normalizeShiftValue: () => '' as const,
  homeOperationalDayIndex: 0,
  employeeLastPunchAtByStaffId: {},
  employeeLastPunchNowMs: Date.now(),
  shiftAnalysisDays: 14,
  toDateOnly: (date: Date) => date.toISOString().slice(0, 10),
  employeeBadgePrintingStaffId: null,
  employeeBadgeBatchSelectedStaffIds: [],
  toggleEmployeeBadgeBatchSelectedStaffId: vi.fn(),
  openEmployeeAuditLog: vi.fn(),
  printEmployeeTempBadge: vi.fn(),
  canOperateEmployeePosition: () => true,
  openEmployeeEdit: vi.fn(),
  deleteEmployeeRow: vi.fn()
};

afterEach(() => {
  cleanup();
});

describe('EmployeesTableSection', () => {
  test('uses configured position tone for dark position chips', () => {
    render(
      <EmployeesTableSection
        {...baseProps}
        getSchedulePositionTone={(position) => (position === 'JDL' ? 'rose' : 'slate')}
      />
    );

    const positionChip = screen.getByText('JDL').closest('[data-testid="glow-chip"]');

    expect(positionChip).toHaveAttribute('data-tone', 'rose');
  });
});
