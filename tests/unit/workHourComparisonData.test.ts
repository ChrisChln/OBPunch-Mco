import { describe, expect, test } from 'vitest';
import { buildComparisonRows } from '../../src/admin/workHourComparisonData';

describe('workHourComparisonData', () => {
  test('includes system-only staff when iams import is missing', () => {
    const rows = buildComparisonRows(
      [
        {
          staff_id: 'US000001',
          source_user_code: 'US000001',
          iams_hours: 6.5,
          fixed_by: '',
          fixed_at: ''
        }
      ],
      new Map([
        ['US000001', 6.25],
        ['US017447', 5.67]
      ]),
      {
        US000001: {
          staffId: 'US000001',
          name: 'Imported Person',
          agency: 'OSI',
          position: 'Pick',
          shift: 'early'
        },
        US017447: {
          staffId: 'US017447',
          name: 'Alexandra Lainer',
          agency: 'OSI',
          position: 'Preship',
          shift: 'early'
        }
      }
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.staffId === 'US017447')).toMatchObject({
      staffId: 'US017447',
      name: 'Alexandra Lainer',
      agency: 'OSI',
      position: 'Preship',
      systemHours: 5.67,
      iamsHours: 0,
      diffHours: 5.67
    });
  });

  test('does not add zero-hour system rows without iams data', () => {
    const rows = buildComparisonRows(
      [],
      new Map([
        ['US000000', 0]
      ]),
      {
        US000000: {
          staffId: 'US000000',
          name: 'Zero Hour',
          agency: 'OSI',
          position: 'Pick',
          shift: 'early'
        }
      }
    );

    expect(rows).toEqual([]);
  });
});
