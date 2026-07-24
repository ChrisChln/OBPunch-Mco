import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  getSchedulePositionTone: () => 'slate' as LabelToneKey,
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
  employeeNotesByStaffId: {},
  toggleEmployeeBadgeBatchSelectedStaffId: vi.fn(),
  openEmployeeNotes: vi.fn(),
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

  test('opens employee notes from the name without selecting the badge row', () => {
    const openEmployeeNotes = vi.fn();
    const toggleEmployeeBadgeBatchSelectedStaffId = vi.fn();

    render(
      <EmployeesTableSection
        {...baseProps}
        employeeNotesByStaffId={{
          US001: {
            agencyNote: 'Cannot work Sunday',
            adminNote: 'Confirm availability',
            agencyNoteUpdatedBy: 'Prime Agency',
            adminNoteUpdatedBy: 'Linda Chen'
          }
        }}
        openEmployeeNotes={openEmployeeNotes}
        toggleEmployeeBadgeBatchSelectedStaffId={toggleEmployeeBadgeBatchSelectedStaffId}
      />
    );

    const noteDot = screen.getByTestId('employee-note-dot-US001');
    const noteButton = screen.getByRole('button', { name: 'Open notes for Alex' });
    expect(noteDot).toHaveClass('h-1.5', 'w-1.5', 'rounded-full', 'bg-rose-500');
    expect(noteDot).not.toHaveClass('border');
    expect(noteDot.className).not.toContain('/');
    expect(noteButton).not.toContainElement(noteDot);
    expect(screen.getByText('Agency note')).toBeInTheDocument();
    expect(screen.getByText('Cannot work Sunday')).toBeInTheDocument();
    expect(screen.getByText('Admin note')).toBeInTheDocument();
    expect(screen.getByText('Confirm availability')).toBeInTheDocument();

    fireEvent.click(noteButton);

    expect(openEmployeeNotes).toHaveBeenCalledWith({
      staff: 'US001',
      name: 'Alex',
      position: 'JDL'
    });
    expect(toggleEmployeeBadgeBatchSelectedStaffId).not.toHaveBeenCalled();
  });
});
