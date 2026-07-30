import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import AgencyTerminationApprovalDialog from '../../src/admin/pages/AgencyTerminationApprovalDialog';

afterEach(cleanup);

const details = {
  staffId: 'US019737',
  name: 'Karla Hernandez',
  agency: 'Prime',
  position: 'PACK',
  reason: 'Attendance issue'
};

describe('AgencyTerminationApprovalDialog', () => {
  test('shows the five read-only request details', () => {
    render(
      <AgencyTerminationApprovalDialog
        t={(zh) => zh}
        details={details}
        themeMode="dark"
        isSubmitting={false}
        error=""
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: '确认离职' })).toBeInTheDocument();
    expect(screen.getByText('US019737')).toBeInTheDocument();
    expect(screen.getByText('Karla Hernandez')).toBeInTheDocument();
    expect(screen.getByText('Prime')).toBeInTheDocument();
    expect(screen.getByText('PACK')).toBeInTheDocument();
    expect(screen.getByText('Attendance issue')).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('confirms once and disables actions while submitting', async () => {
    const onConfirm = vi.fn();
    const view = render(
      <AgencyTerminationApprovalDialog
        t={(zh) => zh}
        details={details}
        themeMode="dark"
        isSubmitting={false}
        error=""
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    view.rerender(
      <AgencyTerminationApprovalDialog
        t={(zh) => zh}
        details={details}
        themeMode="dark"
        isSubmitting
        error="RPC failed"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByRole('button', { name: '处理中' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('RPC failed');
  });

  test('manages keyboard focus and restores the trigger on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const view = render(
      <AgencyTerminationApprovalDialog
        t={(zh) => zh}
        details={details}
        themeMode="dark"
        isSubmitting={false}
        error=""
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );

    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确定' });
    await waitFor(() => expect(confirm).toHaveFocus());

    fireEvent.keyDown(window, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
