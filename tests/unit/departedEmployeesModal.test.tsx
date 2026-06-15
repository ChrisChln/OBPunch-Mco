import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import DepartedEmployeesModal from '../../src/admin/pages/DepartedEmployeesModal';
import type { EmployeeRow, TerminationType } from '../../src/admin/types';

const t = (zh: string) => zh;

const rows: EmployeeRow[] = [
  {
    staff_id: 'US010001',
    name: 'Jennifer Bravo',
    agency: 'Prime',
    position: 'Pick',
    terminated_at: '2026-06-14T10:00:00.000Z',
    termination_type: 'normal'
  },
  {
    staff_id: 'US010002',
    name: 'Zion Green',
    agency: 'Lyneer',
    position: 'Pack',
    terminated_at: '2026-06-13T10:00:00.000Z',
    termination_type: 'blacklist'
  }
];

afterEach(() => {
  cleanup();
});

const renderModal = (overrides: Partial<React.ComponentProps<typeof DepartedEmployeesModal>> = {}) => {
  const props: React.ComponentProps<typeof DepartedEmployeesModal> = {
    open: true,
    t,
    themeMode: 'dark',
    rows,
    loading: false,
    error: null,
    canManageDeparted: true,
    canHardDelete: false,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onToggleTerminationType: vi.fn(),
    onRehire: vi.fn(),
    onHardDelete: vi.fn(),
    displayStaffId: (value) => value,
    ...overrides
  };
  render(<DepartedEmployeesModal {...props} />);
  return props;
};

describe('DepartedEmployeesModal', () => {
  test('filters by termination type', async () => {
    renderModal();

    await userEvent.selectOptions(screen.getAllByRole('combobox')[2], 'blacklist');

    expect(screen.queryByText('Jennifer Bravo')).not.toBeInTheDocument();
    expect(screen.getByText('Zion Green')).toBeInTheDocument();
  });

  test('toggles type and rehires from row actions', async () => {
    const onToggleTerminationType = vi.fn<(staffId: string, nextType: TerminationType) => void>();
    const onRehire = vi.fn<(staffId: string) => void>();
    renderModal({ onToggleTerminationType, onRehire });

    await userEvent.click(screen.getByRole('button', { name: '正常离职' }));
    await userEvent.click(screen.getAllByRole('button', { name: '返聘' })[0]);

    expect(onToggleTerminationType).toHaveBeenCalledWith('US010001', 'blacklist');
    expect(onRehire).toHaveBeenCalledWith('US010001');
  });
});
