import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import AppDialog from '../../src/components/AppDialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AppDialog', () => {
  test('can transition from closed to open without changing hook order', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const props = {
      title: '确认离职',
      message: '确认离职 US019737 吗？',
      onConfirm: vi.fn(),
      onCancel: vi.fn()
    };
    const view = render(<AppDialog {...props} open={false} />);

    expect(() => view.rerender(<AppDialog {...props} open />)).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument();
  });
});
