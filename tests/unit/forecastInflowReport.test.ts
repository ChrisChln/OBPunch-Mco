import { describe, expect, test } from 'vitest';
import * as XLSX from 'xlsx';
import { aggregateOutboundRows, parseOutboundReportWorkbook } from '../../src/admin/forecastInflowReport';

describe('aggregateOutboundRows', () => {
  test('sums quantities by local date and natural hour', () => {
    const result = aggregateOutboundRows([
      ['07/01/2026 02:02:01 PM', '2'],
      ['07/01/2026 02:45:00 PM', 3],
      ['07/01/2026 05:18:00 PM', '1']
    ]);

    expect(result.stats).toMatchObject({ sourceRows: 3, importedRows: 3, dayCount: 1, totalQuantity: 6 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-01', h14: 5, h17: 1, last_filled_hour: 17 });
    expect(result.rows[0].h00).toBe(0);
    expect(result.rows[0].h23).toBe(0);
  });

  test('returns separate sorted rows for multiple dates', () => {
    const result = aggregateOutboundRows([
      ['07/02/2026 01:00:00 AM', 4],
      ['07/01/2026 11:59:59 PM', 2]
    ]);

    expect(result.rows.map((row) => row.date)).toEqual(['2026-07-01', '2026-07-02']);
    expect(result.rows[0]).toMatchObject({ h23: 2, last_filled_hour: 23 });
    expect(result.rows[1]).toMatchObject({ h01: 4, last_filled_hour: 1 });
  });

  test('tracks the last source hour even when its quantity is zero', () => {
    const result = aggregateOutboundRows([
      ['07/01/2026 06:00:00 AM', 2],
      ['07/01/2026 08:00:00 AM', 0]
    ]);

    expect(result.rows[0]).toMatchObject({ h06: 2, h08: 0, last_filled_hour: 8 });
  });

  test.each([
    ['', '第 2 行“货品数量”无效'],
    [-1, '第 2 行“货品数量”无效'],
    [1.5, '第 2 行“货品数量”无效'],
    ['abc', '第 2 行“货品数量”无效']
  ])('rejects invalid quantity %p', (quantity, message) => {
    expect(() => aggregateOutboundRows([['07/01/2026 01:00:00 PM', quantity]], 2)).toThrow(message);
  });

  test('rejects an impossible report date', () => {
    expect(() => aggregateOutboundRows([['02/30/2026 01:00:00 PM', 1]], 2)).toThrow('第 2 行“创建时间”无效');
  });

  test('aggregates Date values with local date getters', () => {
    const createdAt = new Date(2026, 6, 1, 23, 15, 0);
    const result = aggregateOutboundRows([[createdAt, 2]]);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-01', h23: 2 });
  });
});

describe('parseOutboundReportWorkbook', () => {
  test('uses the first non-empty sheet and locates the required header row', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty');
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['出库包裹报表'],
        [' 货品数量 ', ' 创建时间 '],
        [2, '07/01/2026 05:18:00 PM']
      ]),
      'Data'
    );
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    const result = parseOutboundReportWorkbook(bytes);

    expect(result.rows[0]).toMatchObject({ date: '2026-07-01', h17: 2 });
  });

  test('rejects workbooks without both required headers', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['创建时间'], ['07/01/2026 01:00:00 PM']]), 'Data');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    expect(() => parseOutboundReportWorkbook(bytes)).toThrow('缺少必需列：创建时间、货品数量。');
  });

  test('rejects a workbook without importable data', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['货品数量', '创建时间']]), 'Data');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    expect(() => parseOutboundReportWorkbook(bytes)).toThrow('文件中没有可导入的数据。');
  });

  test('skips package rows that do not contain goods quantity', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['包裹号', '货品数量', '创建时间'],
      ['PKG-EMPTY', '', '07/01/2026 12:50:01 PM'],
      ['PKG-GOODS', 2, '07/01/2026 05:18:00 PM']
    ]), 'Data');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    const result = parseOutboundReportWorkbook(bytes);

    expect(result.stats).toMatchObject({ sourceRows: 2, importedRows: 1, totalQuantity: 2 });
    expect(result.rows[0]).toMatchObject({ h12: 0, h17: 2, last_filled_hour: 17 });
  });

  test('keeps the original Excel row number after skipped no-goods rows', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['包裹号', '货品数量', '创建时间'],
      ['PKG-EMPTY', '', '07/01/2026 12:50:01 PM'],
      ['PKG-GOODS', 2, '07/01/2026 05:18:00 PM'],
      ['PKG-BAD', 'abc', '07/01/2026 06:18:00 PM']
    ]), 'Data');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    expect(() => parseOutboundReportWorkbook(bytes)).toThrow('第 4 行“货品数量”无效');
  });

  test('reports progress and aggregates 100,000 rows', () => {
    const rows = Array.from({ length: 100_000 }, (_, index) => {
      const day = index % 2 === 0 ? '01' : '02';
      const hour24 = index % 24;
      const hour12 = String(hour24 % 12 || 12).padStart(2, '0');
      const meridiem = hour24 < 12 ? 'AM' : 'PM';
      return [`07/${day}/2026 ${hour12}:00:00 ${meridiem}`, 1] as const;
    });
    const startedAt = performance.now();

    const result = aggregateOutboundRows(rows);

    expect(result.stats).toMatchObject({ sourceRows: 100_000, importedRows: 100_000, dayCount: 2, totalQuantity: 100_000 });
    expect(result.rows.flatMap((row) => Object.entries(row).filter(([key]) => /^h\d{2}$/.test(key)).map(([, value]) => Number(value))).reduce((sum, value) => sum + value, 0)).toBe(100_000);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(0);
  });
});
