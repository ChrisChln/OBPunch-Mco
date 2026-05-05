import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import DashboardPage from '../../src/DashboardPage';

describe('DashboardPage header', () => {
  test('does not render top summary metric cards', () => {
    render(React.createElement(DashboardPage));

    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
    expect(screen.queryByText('Active right now')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Worked on rest day')).not.toBeInTheDocument();
  });
});
