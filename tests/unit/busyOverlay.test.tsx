import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import BusyOverlay from '../../src/admin/components/BusyOverlay';

const t = (_zh: string, en: string) => en;

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('BusyOverlay', () => {
  test('uses provided progress as a determinate 0-100 value', () => {
    render(<BusyOverlay visible themeMode="dark" t={t} progress={42.4} />);

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  test('auto-progresses from 0 and completes at 100 before hiding', () => {
    vi.useFakeTimers();
    const { rerender } = render(<BusyOverlay visible themeMode="dark" t={t} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '8');
    expect(screen.getByText('8%')).toBeInTheDocument();

    rerender(<BusyOverlay visible={false} themeMode="dark" t={t} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100%')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(180);
    });

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
