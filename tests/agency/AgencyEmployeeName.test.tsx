import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import AgencyEmployeeName from '../../src/agency/components/AgencyEmployeeName';

afterEach(cleanup);

describe('AgencyEmployeeName', () => {
  test('shows a red dot only when an admin note exists', () => {
    const { rerender } = render(
      <AgencyEmployeeName staffId="US001" name="Alex" agencyNote="Agency only" adminNote="" />
    );

    expect(screen.queryByTestId('agency-admin-note-dot-US001')).not.toBeInTheDocument();

    rerender(
      <AgencyEmployeeName staffId="US001" name="Alex" agencyNote="" adminNote="Admin message" />
    );

    const dot = screen.getByTestId('agency-admin-note-dot-US001');
    expect(dot).toHaveClass('bg-rose-500');
    expect(dot.className).not.toContain('/');
  });

  test('shows the same note hover content as Admin when an admin note exists', () => {
    render(
      <AgencyEmployeeName
        staffId="US001"
        name="Alex"
        agencyNote="Agency message"
        adminNote="Admin message"
      />
    );

    expect(screen.getByText('Agency note')).toBeInTheDocument();
    expect(screen.getByText('Agency message')).toBeInTheDocument();
    expect(screen.getByText('Admin note')).toBeInTheDocument();
    expect(screen.getByText('Admin message')).toBeInTheDocument();
  });
});
