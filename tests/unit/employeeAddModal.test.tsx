import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EmployeeAddModal from '../../src/admin/pages/EmployeeAddModal';

afterEach(() => cleanup());

const t = (zh: string) => zh;

function EmployeeAddModalHarness() {
  const [agency, setAgency] = useState('');

  return (
    <EmployeeAddModal
      open
      t={t}
      themeMode="dark"
      isLocked={false}
      isSubmitting={false}
      employeeNewStaffId=""
      setEmployeeNewStaffId={vi.fn()}
      employeeNewName="Test Employee"
      setEmployeeNewName={vi.fn()}
      employeeNewAgency={agency}
      setEmployeeNewAgency={setAgency}
      employeeAgencyOptions={['Central', 'JDL']}
      employeeNewPosition="Pick"
      setEmployeeNewPosition={vi.fn()}
      employeeNewEmploymentType="FT"
      setEmployeeNewEmploymentType={vi.fn()}
      employeeNewShift="early"
      setEmployeeNewShift={vi.fn()}
      employeeNewShiftTime="07:00"
      setEmployeeNewShiftTime={vi.fn()}
      employeeNewLabel="OB"
      setEmployeeNewLabel={vi.fn()}
      employeeNewWorkAccount=""
      setEmployeeNewWorkAccount={vi.fn()}
      employeeNewWorkPassword=""
      setEmployeeNewWorkPassword={vi.fn()}
      employeeAddLabelOptions={['OB']}
      allowedPositions={['Pick']}
      closeEmployeeAdd={vi.fn()}
      addEmployeeRow={vi.fn()}
    />
  );
}

describe('EmployeeAddModal', () => {
  it('keeps new agency mode active while entering a new agency', async () => {
    const user = userEvent.setup();
    render(<EmployeeAddModalHarness />);

    const agencySelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(agencySelect, '__new_agency__');

    const newAgencyInput = screen.getByPlaceholderText('输入新中介');
    await user.type(newAgencyInput, 'Prime');

    expect(newAgencyInput).toHaveValue('Prime');
    expect(agencySelect).toHaveValue('__new_agency__');

    await user.selectOptions(agencySelect, 'Central');

    expect(screen.queryByPlaceholderText('输入新中介')).not.toBeInTheDocument();
    expect(agencySelect).toHaveValue('Central');
  });
});
