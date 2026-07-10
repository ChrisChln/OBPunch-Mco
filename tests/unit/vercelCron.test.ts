import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

type VercelConfig = {
  crons?: Array<{ path?: string; schedule?: string }>;
};

describe('vercel cron configuration', () => {
  test('only schedules expected dashboard attendance snapshots', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as VercelConfig;
    const dashboardSnapshotCrons = (config.crons ?? []).filter((cron) =>
      String(cron.path ?? '').includes('dashboard-attendance-snapshot')
    );

    expect(dashboardSnapshotCrons).toEqual([
      {
        path: '/api/dashboard-attendance-snapshot-expected',
        schedule: '55 8 * * *'
      }
    ]);
  });
});
