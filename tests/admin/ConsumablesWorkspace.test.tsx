import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ConsumablesWorkspace from '../../src/admin/components/ConsumablesWorkspace';

const t = (zh: string) => zh;

const dashboardPayload = {
  items: [
    {
      item_key: 'mailer',
      item_label: 'Mailer',
      group_key: 'packing',
      warning_days: 7,
      critical_days: 3,
      sort_order: 10,
      is_active: true,
      is_custom: true
    },
    {
      item_key: 'route_label',
      item_label: 'Route Label',
      group_key: 'last_mile',
      warning_days: 7,
      critical_days: 3,
      sort_order: 20,
      is_active: true,
      is_custom: true
    },
    {
      item_key: 'transfer_wrap',
      item_label: 'Transfer Wrap',
      group_key: 'transfer',
      warning_days: 7,
      critical_days: 3,
      sort_order: 30,
      is_active: true,
      is_custom: true
    }
  ],
  snapshots: [
    { item_key: 'mailer', snapshot_date: '2026-05-02', remaining_qty: 100, created_by_display: 'Sofia' },
    { item_key: 'route_label', snapshot_date: '2026-05-02', remaining_qty: 40, created_by_display: 'Sofia' },
    { item_key: 'mailer', snapshot_date: '2026-05-05', remaining_qty: 120, created_by_display: 'Sofia' },
    { item_key: 'route_label', snapshot_date: '2026-05-05', remaining_qty: 35, created_by_display: 'Sofia' }
  ],
  adjustments: [],
  alerts: [],
  inbound_orders_by_date: {
    '2026-05-03': 10,
    '2026-05-04': 10,
    '2026-05-05': 10
  }
};

const renderWorkspace = (options: { canManageItems?: boolean } = {}) => {
  const supabase = {
    rpc: vi.fn().mockResolvedValue({ data: dashboardPayload, error: null })
  };

  render(
    <ConsumablesWorkspace
      t={t}
      themeMode="dark"
      isLocked={false}
      canView
      canOperate
      canManageItems={options.canManageItems ?? false}
      supabase={supabase}
      serverTime={new Date('2026-05-05T12:00:00-04:00')}
    />
  );

  return { supabase };
};

describe('ConsumablesWorkspace', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('renders consumable cards and snapshot entry by zone', async () => {
    renderWorkspace();

    expect((await screen.findAllByText('打包耗材')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('尾程耗材').length).toBeGreaterThan(0);
    expect(screen.getAllByText('调拨耗材').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mailer').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Route Label').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Transfer Wrap').length).toBeGreaterThan(1);
  });

  test('hides item manager for non-level1 users', async () => {
    renderWorkspace({ canManageItems: false });

    await screen.findAllByText('打包耗材');
    expect(screen.queryByRole('button', { name: '耗材管理' })).not.toBeInTheDocument();
  });

  test('opens snapshot change details from entered count', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findAllByText('盘点历史');
    await user.click(screen.getAllByRole('button', { name: '2' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2026-05-05')).toBeInTheDocument();
    const mailerRow = within(dialog).getByText('Mailer').closest('tr');
    const routeLabelRow = within(dialog).getByText('Route Label').closest('tr');

    expect(mailerRow).not.toBeNull();
    expect(routeLabelRow).not.toBeNull();
    await waitFor(() => {
      expect(within(mailerRow as HTMLElement).getByText('+20')).toHaveClass('text-emerald-400');
      expect(within(routeLabelRow as HTMLElement).getByText('-5')).toHaveClass('text-rose-400');
    });
  });
});
