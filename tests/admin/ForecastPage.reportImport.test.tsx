import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ForecastPage from '../../src/admin/pages/ForecastPage';

const t = (zh: string) => zh;
const runWorkerMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/admin/forecastInflowWorkerClient', () => ({
  runInflowImportWorker: runWorkerMock
}));

const makeSupabase = () => {
  let persistedRows: unknown[] = [];
  const upsert = vi.fn(async (rows: unknown[]) => {
    persistedRows = rows;
    return { data: null, error: null };
  });
  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> & PromiseLike<{ data: unknown[]; error: null }> = {
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve)
    };
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) {
      query[method] = vi.fn(() => query);
    }
    query.in = vi.fn(async () => ({ data: table === 'volume_history' ? persistedRows : [], error: null }));
    query.upsert = upsert;
    return query;
  });
  return { from, rpc: vi.fn(async () => ({ data: [], error: null })), upsert };
};

const pageElement = (supabase: unknown = null, themeMode: 'light' | 'dark' = 'light') =>
    <ForecastPage
      t={t}
      isLocked={false}
      serverTime={new Date(2026, 6, 30, 12, 0, 0)}
      supabase={supabase}
      themeMode={themeMode}
    />;

const renderPage = (supabase: unknown = null) => render(pageElement(supabase));

describe('ForecastPage outbound report import', () => {
  beforeEach(() => {
    runWorkerMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test('shows report import beside the historical inflow title', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '历史流入' }));

    expect(await screen.findByText('历史流入数据')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '导入报表' })).toBeInTheDocument();
  }, 10_000);

  test('uses a high-contrast report import button in dark mode', async () => {
    render(pageElement(null, 'dark'));
    fireEvent.click(screen.getByRole('button', { name: '历史流入' }));

    expect(await screen.findByRole('button', { name: '导入报表' })).toHaveClass('bg-lime-400', 'text-slate-950');
  }, 10_000);

  test('selecting a date shows its week and highlights that day', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '填数据' }));

    const dateNavigator = await screen.findByLabelText('选择日期');
    fireEvent.change(dateNavigator, { target: { value: '2026-05-14' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('2026-05-11')).toBeInTheDocument();
      expect(screen.getByDisplayValue('2026-05-17')).toBeInTheDocument();
    });
    expect(document.querySelector('tr[data-selected="true"] input[value="2026-05-14"]')).not.toBeNull();
  }, 10_000);

  test('saves aggregated rows and shows a concise import summary', async () => {
    const supabase = makeSupabase();
    runWorkerMock.mockResolvedValue({
      rows: [{
        date: '2026-07-01',
        last_filled_hour: 17,
        ...Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [`h${String(hour).padStart(2, '0')}`, hour === 17 ? 14_040 : 0]))
      }],
      stats: { sourceRows: 13_219, importedRows: 13_219, dayCount: 1, totalQuantity: 14_040, earliestDate: '2026-07-01', latestDate: '2026-07-01' }
    });
    const { rerender } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '历史流入' }));
    await screen.findByRole('button', { name: '导入报表' });
    rerender(pageElement(supabase));
    const input = document.querySelector<HTMLInputElement>('input[accept^=".xlsx"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { files: [new File(['report'], 'report.xlsx')] } });

    expect((await screen.findAllByText('已导入 1 天 · 13219 行 · 14,040 件')).length).toBeGreaterThan(0);
    expect(supabase.upsert).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ date: '2026-07-01', h17: 14_040 })]), { onConflict: 'date' });
  }, 10_000);

  test('does not write when Worker validation fails', async () => {
    const supabase = makeSupabase();
    runWorkerMock.mockRejectedValue(new Error('第 218 行“创建时间”无效'));
    const { rerender } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '历史流入' }));
    await screen.findByRole('button', { name: '导入报表' });
    rerender(pageElement(supabase));
    const input = document.querySelector<HTMLInputElement>('input[accept^=".xlsx"]');

    fireEvent.change(input!, { target: { files: [new File(['report'], 'report.xlsx')] } });

    expect((await screen.findAllByText('第 218 行“创建时间”无效')).length).toBeGreaterThan(0);
    await waitFor(() => expect(supabase.upsert).not.toHaveBeenCalled());
  }, 10_000);
});
