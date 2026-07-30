import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import DepartureConfirmDialog from '../../src/admin/pages/DepartureConfirmDialog';

afterEach(cleanup);

describe('DepartureConfirmDialog', () => {
  test('requires a departure reason before confirmation', async () => {
    const onReasonChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DepartureConfirmDialog
        t={(zh) => zh}
        displayName="Jennifer Bravo (US010001)"
        type="normal"
        reason=""
        adminNote=""
        agencyNote=""
        isLocked={false}
        onTypeChange={vi.fn()}
        onReasonChange={onReasonChange}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled();
    expect(screen.getByLabelText('离职原因')).toBeRequired();
    await userEvent.type(screen.getByLabelText('离职原因'), 'Moved');
    expect(onReasonChange).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('allows confirmation when the reason is not blank', async () => {
    const onConfirm = vi.fn();
    render(
      <DepartureConfirmDialog
        t={(zh) => zh}
        displayName="Jennifer Bravo (US010001)"
        type="blacklist"
        reason="Attendance issue"
        adminNote=""
        agencyNote=""
        isLocked={false}
        onTypeChange={vi.fn()}
        onReasonChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  test('shows populated notes in admin then agency order', () => {
    render(
      <DepartureConfirmDialog
        t={(zh) => zh}
        displayName="Jennifer Bravo (US010001)"
        type="normal"
        reason=""
        adminNote="Admin message"
        agencyNote="Agency message"
        isLocked={false}
        onTypeChange={vi.fn()}
        onReasonChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const adminLabel = screen.getByText('Admin Note');
    const agencyLabel = screen.getByText('Agency Note');
    expect(adminLabel).toBeInTheDocument();
    expect(agencyLabel).toBeInTheDocument();
    expect(adminLabel.compareDocumentPosition(agencyLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Admin message')).toBeInTheDocument();
    expect(screen.getByText('Agency message')).toBeInTheDocument();
  });

  test('hides note sections whose trimmed content is empty', () => {
    render(
      <DepartureConfirmDialog
        t={(zh) => zh}
        displayName="Jennifer Bravo (US010001)"
        type="normal"
        reason=""
        adminNote="  "
        agencyNote="Agency message"
        isLocked={false}
        onTypeChange={vi.fn()}
        onReasonChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.queryByText('Admin Note')).not.toBeInTheDocument();
    expect(screen.getByText('Agency Note')).toBeInTheDocument();
    expect(screen.getByText('Agency message')).toBeInTheDocument();
  });
});
