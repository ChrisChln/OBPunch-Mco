import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import ScheduleShiftTimeCell from '../../src/admin/components/ScheduleShiftTimeCell';

afterEach(cleanup);

const t = (_zh: string, en: string) => en;

type CellHarnessProps = {
  value: string;
  canEdit?: boolean;
  saving?: boolean;
  onSave: (draft: string) => Promise<boolean>;
};

const CellHarness = ({ value, canEdit = true, saving = false, onSave }: CellHarnessProps) => {
  const [editing, setEditing] = useState(false);
  return (
    <ScheduleShiftTimeCell
      value={value}
      canEdit={canEdit}
      saving={saving}
      editing={editing}
      t={t}
      onStartEditing={() => setEditing(true)}
      onStopEditing={() => setEditing(false)}
      onSave={onSave}
    />
  );
};

describe('ScheduleShiftTimeCell', () => {
  test('keeps the control height unchanged while editing', async () => {
    const user = userEvent.setup();
    render(<CellHarness value="07:00" onSave={vi.fn()} />);

    const displayButton = screen.getByRole('button', { name: 'Edit shift time' });
    expect(displayButton).toHaveClass('h-[22px]');

    await user.click(displayButton);

    const editor = screen.getByLabelText('Shift time');
    expect(editor).toHaveClass('h-[22px]');
    expect(editor).toHaveAttribute('data-magic-field-skip', 'true');
  });

  test('shows the normalized value and enters edit mode on click', async () => {
    const user = userEvent.setup();
    render(<CellHarness value="8:00" onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));

    expect(screen.getByLabelText('Shift time')).toHaveValue('08:00');
    expect(screen.getByLabelText('Shift time')).toHaveFocus();
  });

  test('shows a dash and no button when editing is not allowed', () => {
    render(<CellHarness value="" canEdit={false} onSave={vi.fn()} />);

    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit shift time' })).not.toBeInTheDocument();
  });

  test('saves on Enter through blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<CellHarness value="07:00" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '08:30' } });
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith('08:30');
  });

  test('saves on blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<CellHarness value="07:00" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    fireEvent.blur(screen.getByLabelText('Shift time'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('09:00'));
  });

  test('cancels with Escape without saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CellHarness value="07:00" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    await user.keyboard('{Escape}');

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit shift time' })).toHaveTextContent('07:00');
  });

  test('keeps the draft after a failed save and disables the input while saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(false);
    const { rerender } = render(
      <CellHarness value="07:00" saving={false} onSave={onSave} />
    );

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    fireEvent.blur(screen.getByLabelText('Shift time'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(screen.getByLabelText('Shift time')).toHaveValue('09:00');
    rerender(<CellHarness value="07:00" saving onSave={onSave} />);
    expect(screen.getByLabelText('Saving shift time')).toBeDisabled();
  });

  test('does not submit the same draft twice while a save is pending', async () => {
    const user = userEvent.setup();
    let resolveSave: ((saved: boolean) => void) | undefined;
    const onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        })
    );
    render(<CellHarness value="07:00" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    const input = screen.getByLabelText('Shift time');
    fireEvent.change(input, { target: { value: '09:00' } });
    fireEvent.blur(input);
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledOnce();
    resolveSave?.(true);
  });

  test('keeps only one row in edit mode when another row is selected after a failed save', async () => {
    const user = userEvent.setup();
    const firstSave = vi.fn().mockResolvedValue(false);
    const secondSave = vi.fn().mockResolvedValue(true);

    const TwoRows = () => {
      const [activeStaff, setActiveStaff] = useState<string | null>(null);
      return (
        <>
          <ScheduleShiftTimeCell
            value="07:00"
            canEdit
            saving={false}
            editing={activeStaff === 'A'}
            t={t}
            onStartEditing={() => setActiveStaff('A')}
            onStopEditing={() => setActiveStaff((current) => (current === 'A' ? null : current))}
            onSave={firstSave}
          />
          <ScheduleShiftTimeCell
            value="08:00"
            canEdit
            saving={false}
            editing={activeStaff === 'B'}
            t={t}
            onStartEditing={() => setActiveStaff('B')}
            onStopEditing={() => setActiveStaff((current) => (current === 'B' ? null : current))}
            onSave={secondSave}
          />
        </>
      );
    };

    render(<TwoRows />);
    const editButtons = screen.getAllByRole('button', { name: 'Edit shift time' });
    await user.click(editButtons[0]);
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    fireEvent.blur(screen.getByLabelText('Shift time'));
    await waitFor(() => expect(firstSave).toHaveBeenCalled());
    await user.click(screen.getAllByRole('button', { name: 'Edit shift time' })[0]);

    expect(screen.getAllByLabelText('Shift time')).toHaveLength(1);
    expect(screen.getByLabelText('Shift time')).toHaveValue('08:00');
  });

  test('contains a rejected save callback and keeps the draft editable', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('network failure'));
    render(<CellHarness value="07:00" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    fireEvent.blur(screen.getByLabelText('Shift time'));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(screen.getByLabelText('Shift time')).toHaveValue('09:00');
  });

  test('closes an active editor when permission becomes read-only', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { rerender } = render(<CellHarness value="07:00" canEdit onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    rerender(<CellHarness value="07:00" canEdit={false} onSave={onSave} />);

    await waitFor(() => expect(screen.queryByLabelText('Shift time')).not.toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
  });

  test('keeps the draft visible and disabled when the global lock starts during its save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { rerender } = render(
      <CellHarness value="07:00" canEdit saving={false} onSave={onSave} />
    );

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    rerender(<CellHarness value="07:00" canEdit={false} saving onSave={onSave} />);

    expect(screen.getByLabelText('Saving shift time')).toBeDisabled();
    expect(screen.getByLabelText('Saving shift time')).toHaveValue('09:00');
  });
});
