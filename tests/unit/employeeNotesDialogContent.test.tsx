import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import EmployeeNotesDialogContent from '../../src/components/EmployeeNotesDialogContent';

const t = (zh: string, en: string) => (en ? en : zh);

afterEach(cleanup);

describe('EmployeeNotesDialogContent', () => {
  test('lets an admin edit only the admin note', () => {
    const onDraftChange = vi.fn();
    const onSave = vi.fn();

    render(
      <EmployeeNotesDialogContent
        t={t}
        themeMode="dark"
        editor="admin"
        agencyNote="Cannot work Sunday"
        adminNote="Confirm availability"
        agencyNoteUpdatedBy="Prime Agency"
        adminNoteUpdatedBy="Linda Chen"
        draft="Confirm availability"
        canEdit
        dirty
        saving={false}
        error={null}
        onDraftChange={onDraftChange}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    expect(screen.getByTestId('agency-note-readonly')).toHaveTextContent('Cannot work Sunday');
    expect(screen.queryByLabelText('Agency note')).not.toBeInTheDocument();
    expect(screen.getByText('Updated by Prime Agency')).toBeInTheDocument();
    expect(screen.getByText('Updated by Linda Chen')).toBeInTheDocument();
    expect(screen.queryByText('Editable')).not.toBeInTheDocument();
    expect(screen.queryByText('Read only')).not.toBeInTheDocument();

    const adminInput = screen.getByLabelText('Admin note');
    expect(adminInput).toHaveValue('Confirm availability');
    fireEvent.change(adminInput, { target: { value: 'Updated by admin' } });
    expect(onDraftChange).toHaveBeenCalledWith('Updated by admin');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('lets an agency user edit only the agency note', () => {
    render(
      <EmployeeNotesDialogContent
        t={t}
        themeMode="dark"
        editor="agency"
        agencyNote="Agency message"
        adminNote="Admin message"
        agencyNoteUpdatedBy="Prime Agency"
        adminNoteUpdatedBy="Linda Chen"
        draft="Agency message"
        canEdit
        dirty={false}
        saving={false}
        error={null}
        onDraftChange={vi.fn()}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Agency note')).toHaveValue('Agency message');
    expect(screen.getByTestId('admin-note-readonly')).toHaveTextContent('Admin message');
    expect(screen.queryByLabelText('Admin note')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
