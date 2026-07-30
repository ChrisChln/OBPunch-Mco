import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  AgencyTablePillButton,
  AgencyTablePillSelect
} from '../../src/agency/components/AgencyTablePillControl';

afterEach(cleanup);

describe('AgencyTablePillControl', () => {
  test('sizes a select from its current display label', () => {
    const onChange = vi.fn();

    render(
      <AgencyTablePillSelect
        ariaLabel="Driver group"
        displayLabel="Individual"
        value="individual"
        tone="emerald"
        onChange={onChange}
      >
        <option value="individual">Individual</option>
        <option value="new">New group A12</option>
      </AgencyTablePillSelect>
    );

    const select = screen.getByRole('combobox', { name: 'Driver group' });
    expect(screen.getByTestId('agency-pill-select-sizer')).toHaveTextContent('Individual');
    expect(screen.getByTestId('agency-pill-select-sizer')).not.toHaveTextContent('New group A12');
    expect(select).not.toHaveClass('w-[68px]');

    fireEvent.change(select, { target: { value: 'new' } });
    expect(onChange).toHaveBeenCalled();
  });

  test('renders a natural-width pill button', () => {
    const onClick = vi.fn();

    render(
      <AgencyTablePillButton tone="slate" onClick={onClick}>
        Add
      </AgencyTablePillButton>
    );

    const button = screen.getByRole('button', { name: 'Add' });
    expect(button).not.toHaveClass('h-8', 'w-[68px]');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
