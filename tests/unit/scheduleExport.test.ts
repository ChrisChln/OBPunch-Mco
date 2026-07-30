import { describe, expect, test } from 'vitest';
import type { ScheduleBaseState } from '../../src/admin/types';
import { getScheduleExportCellValue } from '../../src/admin/scheduleExport';

describe('getScheduleExportCellValue', () => {
  test.each<ScheduleBaseState>(['new', 'work', 'fixed_work', 'temp_work', 'planned_temp_work'])(
    'exports the resolved shift time for %s',
    (state) => {
      expect(getScheduleExportCellValue(state, '08:00')).toBe('08:00');
    }
  );

  test.each<ScheduleBaseState | null>([
    'rest',
    'leave',
    'planned_leave',
    'temp_rest',
    'planned_temp_rest',
    null
  ])('exports rest for %s', (state) => {
    expect(getScheduleExportCellValue(state, '08:00')).toBe('休息');
  });
});
