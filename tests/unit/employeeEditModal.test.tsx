import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import EmployeeEditModal from '../../src/admin/pages/EmployeeEditModal';

afterEach(cleanup);

const renderModal = (position: string) =>
  render(
    <EmployeeEditModal
      open
      t={(_zh, en) => en}
      themeMode="dark"
      isLocked={false}
      displayStaffId={(value) => value}
      employeeEditOriginalStaffId="YANGSONG"
      employeeEditStaffId="YANGSONG"
      setEmployeeEditStaffId={vi.fn()}
      employeeEditName="yang.song"
      setEmployeeEditName={vi.fn()}
      employeeEditAgency="JDL"
      setEmployeeEditAgency={vi.fn()}
      employeeEditAgencyLocked
      employeeAgencyOptions={['JDL']}
      employeeEditPosition={position}
      setEmployeeEditPosition={vi.fn()}
      employeeEditEmploymentType="FT"
      setEmployeeEditEmploymentType={vi.fn()}
      employeeEditShift="early"
      setEmployeeEditShift={vi.fn()}
      employeeEditShiftTime="08:00"
      setEmployeeEditShiftTime={vi.fn()}
      employeeEditLabel=""
      setEmployeeEditLabel={vi.fn()}
      employeeEditWorkAccount=""
      setEmployeeEditWorkAccount={vi.fn()}
      employeeEditWorkPassword=""
      setEmployeeEditWorkPassword={vi.fn()}
      employeeEditLabelOptions={[]}
      allowedPositions={['JDL', 'Pick']}
      closeEmployeeEdit={vi.fn()}
      saveEmployeeEdit={vi.fn()}
    />
  );

describe('EmployeeEditModal required position', () => {
  test('disables Save while position is blank', () => {
    renderModal('');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('enables Save when position is selected', () => {
    renderModal('JDL');

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
