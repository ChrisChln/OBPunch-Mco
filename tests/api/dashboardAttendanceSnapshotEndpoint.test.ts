import { beforeEach, describe, expect, test, vi } from 'vitest';

const ensureCronMock = vi.fn();
const createServiceSupabaseMock = vi.fn();
const runDashboardAttendanceSnapshotMock = vi.fn();
const runAttendanceAutoCheckoutMock = vi.fn();

vi.mock('../../api/_forecastShared.js', () => ({
  ensureCron: ensureCronMock,
  createServiceSupabase: createServiceSupabaseMock
}));

vi.mock('../../api/_dashboardAttendanceSnapshotCore.js', () => ({
  runDashboardAttendanceSnapshot: runDashboardAttendanceSnapshotMock
}));

vi.mock('../../api/_attendanceAutoCheckoutCore.js', () => ({
  runAttendanceAutoCheckout: runAttendanceAutoCheckoutMock
}));

const createResponse = () => {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    })
  };
  return res;
};

describe('dashboard attendance snapshot endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServiceSupabaseMock.mockReturnValue({ from: vi.fn() });
    runDashboardAttendanceSnapshotMock.mockResolvedValue({
      mode: 'expected',
      work_date: '2026-07-06',
      range_start: '2026-07-06T09:00:00.000Z',
      range_end: '2026-07-07T09:00:00.000Z',
      rows_scanned: { schedules: 1, employees: 1, punches: 0 },
      rows_ready: 1,
      rows_upserted: 0,
      snapshot_status: 'expected',
      dry_run: true
    });
  });

  test('stops when cron authorization fails', async () => {
    ensureCronMock.mockReturnValue(false);
    const { default: handler } = await import('../../api/attendance-auto-checkout');
    const res = createResponse();

    await handler({ method: 'GET', query: { job: 'dashboard-attendance-snapshot' } }, res);

    expect(createServiceSupabaseMock).not.toHaveBeenCalled();
    expect(runDashboardAttendanceSnapshotMock).not.toHaveBeenCalled();
  });

  test('routes dashboard snapshot jobs through the shared cron endpoint', async () => {
    ensureCronMock.mockReturnValue(true);
    const { default: handler } = await import('../../api/attendance-auto-checkout');
    const res = createResponse();

    await handler(
      {
        method: 'GET',
        query: {
          job: 'dashboard-attendance-snapshot',
          mode: 'actual',
          work_date: '2026-07-06',
          dry_run: 'true'
        }
      },
      res
    );

    expect(runDashboardAttendanceSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: 'actual',
        workDate: '2026-07-06',
        dryRun: true
      })
    );
    expect(runAttendanceAutoCheckoutMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual(expect.objectContaining({ status: 'ok', dry_run: true }));
  });
});
