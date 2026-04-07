import { describe, expect, test } from 'vitest';
import { chunkArray, prepareWorkHourUploadRows, type ParsedUploadRow } from '../../src/admin/workHourImport';

describe('workHourImport', () => {
  test('flags duplicate rows for the same staff and work date', () => {
    const rows: ParsedUploadRow[] = [
      { workDate: '2026-04-06', sourceUserCode: 'US012345', staffId: 'US012345', iamsHours: 8, rowNumber: 3 },
      { workDate: '2026-04-06', sourceUserCode: 'US012345', staffId: 'US012345', iamsHours: 7.5, rowNumber: 8 },
      { workDate: '2026-04-07', sourceUserCode: 'US012346', staffId: 'US012346', iamsHours: 8, rowNumber: 9 }
    ];

    const result = prepareWorkHourUploadRows(rows, {
      US012345: { staffId: 'US012345' },
      US012346: { staffId: 'US012346' }
    });

    expect(result.matchedRows).toEqual([
      { workDate: '2026-04-07', sourceUserCode: 'US012346', staffId: 'US012346', iamsHours: 8, rowNumber: 9 }
    ]);
    expect(result.duplicateReasons).toEqual([
      'Duplicate rows for 2026-04-06 / US012345: rows 3, 8.'
    ]);
  });

  test('keeps skip reasons for invalid or unmatched staff ids', () => {
    const rows: ParsedUploadRow[] = [
      { workDate: '2026-04-06', sourceUserCode: 'BADCODE', staffId: '', iamsHours: 8, rowNumber: 4 },
      { workDate: '2026-04-06', sourceUserCode: 'US099999', staffId: 'US099999', iamsHours: 8, rowNumber: 5 },
      { workDate: '2026-04-06', sourceUserCode: 'US012345', staffId: 'US012345', iamsHours: 8, rowNumber: 6 }
    ];

    const result = prepareWorkHourUploadRows(rows, {
      US012345: { staffId: 'US012345' }
    });

    expect(result.matchedRows).toEqual([
      { workDate: '2026-04-06', sourceUserCode: 'US012345', staffId: 'US012345', iamsHours: 8, rowNumber: 6 }
    ]);
    expect(result.skipReasons).toEqual([
      'Row 4: user code BADCODE is invalid.',
      'Row 5: US099999 not found in OBPUNCH employees.'
    ]);
    expect(result.duplicateReasons).toEqual([]);
  });

  test('chunks payloads for batch upserts', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });
});
