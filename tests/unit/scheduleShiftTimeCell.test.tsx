import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import ScheduleShiftTimeCell from '../../src/admin/components/ScheduleShiftTimeCell';

afterEach(cleanup);

const t = (_zh: string, en: string) => en;

describe('ScheduleShiftTimeCell', () => {
  test('shows the normalized value and enters edit mode on click', async () => {
    const user = userEvent.setup();
    render(<ScheduleShiftTimeCell value="8:00" canEdit saving={false} t={t} onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));

    expect(screen.getByLabelText('Shift time')).toHaveValue('08:00');
    expect(screen.getByLabelText('Shift time')).toHaveFocus();
  });

  test('shows a dash and no button when editing is not allowed', () => {
    render(<ScheduleShiftTimeCell value="" canEdit={false} saving={false} t={t} onSave={vi.fn()} />);

    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit shift time' })).not.toBeInTheDocument();
  });

  test('saves on Enter through blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<ScheduleShiftTimeCell value="07:00" canEdit saving={false} t={t} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '08:30' } });
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith('08:30');
  });

  test('saves on blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<ScheduleShiftTimeCell value="07:00" canEdit saving={false} t={t} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    fireEvent.blur(screen.getByLabelText('Shift time'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('09:00'));
  });

  test('cancels with Escape without saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ScheduleShiftTimeCell value="07:00" canEdit saving={false} t={t} onSave={onSave} />);

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
      <ScheduleShiftTimeCell value="07:00" canEdit saving={false} t={t} onSave={onSave} />
    );

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    fireEvent.blur(screen.getByLabelText('Shift time'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(screen.getByLabelText('Shift time')).toHaveValue('09:00');
    rerender(<ScheduleShiftTimeCell value="07:00" canEdit saving t={t} onSave={onSave} />);
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
    render(<ScheduleShiftTimeCell value="07:00" canEdit saving={false} t={t} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    const input = screen.getByLabelText('Shift time');
    fireEvent.change(input, { target: { value: '09:00' } });
    fireEvent.blur(input);
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledOnce();
    resolveSave?.(true);
  });
});
