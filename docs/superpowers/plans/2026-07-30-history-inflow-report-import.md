# History Inflow Report Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive Forecast history-inflow importer that converts up to 100,000 outbound-package rows into hourly `volume_history` records using `创建时间` and `货品数量`.

**Architecture:** Keep workbook parsing and aggregation outside `ForecastPage`. A pure report module validates headers, timestamps, quantities, and produces complete daily rows; a dedicated Web Worker reads Excel and reports progress; a small client adapter manages Worker lifecycle. `ForecastPage` only owns UI state, invokes the adapter, then reuses the existing Supabase upsert, persistence verification, and refresh paths.

**Tech Stack:** React 18, TypeScript, Vite Web Workers, SheetJS `xlsx`, Supabase JS v2, Vitest, Testing Library.

---

## File map

- Create `src/admin/forecastInflowReport.ts`: domain types, date parsing, row validation, hourly aggregation, workbook-to-result conversion.
- Create `src/admin/forecastInflowReport.worker.ts`: Worker entry that reads an `ArrayBuffer`, publishes progress, and returns a typed result/error.
- Create `src/admin/forecastInflowWorkerClient.ts`: browser-side Worker lifecycle and Promise adapter with dependency injection for tests.
- Modify `src/admin/pages/ForecastPage.tsx`: dedicated file input, progress state, button, status copy, batched save, refresh.
- Create `tests/unit/forecastInflowReport.test.ts`: pure parsing, validation, real workbook, reference totals, and 100,000-row coverage.
- Create `tests/unit/forecastInflowWorkerClient.test.ts`: Worker protocol, progress, success, error, and termination coverage.
- Create `tests/admin/ForecastPage.reportImport.test.tsx`: user-visible button, disabled state, successful save summary, and no-write-on-parse-error coverage.

### Task 1: Pure hourly aggregation contract

**Files:**
- Create: `src/admin/forecastInflowReport.ts`
- Test: `tests/unit/forecastInflowReport.test.ts`

- [ ] **Step 1: Write failing aggregation tests**

Create tests that express the public API before production code exists:

```ts
import { describe, expect, test } from 'vitest';
import { aggregateOutboundRows } from '../../src/admin/forecastInflowReport';

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
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/forecastInflowReport.test.ts`

Expected: FAIL because `src/admin/forecastInflowReport.ts` does not exist.

- [ ] **Step 3: Implement the smallest typed aggregator**

Create these exported contracts and implementation. Keep `HourKey` local to this focused module and build all 24 hour keys explicitly through a typed helper:

```ts
export const INFLOW_HOUR_KEYS = Array.from(
  { length: 24 },
  (_, hour) => `h${String(hour).padStart(2, '0')}`
) as Array<`h${string}`>;

export type InflowHourKey = (typeof INFLOW_HOUR_KEYS)[number];

export type ImportedVolumeHistoryRow = {
  date: string;
  last_filled_hour: number;
} & Record<InflowHourKey, number>;

export type OutboundReportStats = {
  sourceRows: number;
  importedRows: number;
  dayCount: number;
  totalQuantity: number;
  earliestDate: string;
  latestDate: string;
};

export type OutboundReportResult = {
  rows: ImportedVolumeHistoryRow[];
  stats: OutboundReportStats;
};

export class OutboundReportError extends Error {
  constructor(message: string, readonly rowNumber?: number, readonly field?: '创建时间' | '货品数量') {
    super(message);
    this.name = 'OutboundReportError';
  }
}

export function aggregateOutboundRows(
  rows: ReadonlyArray<readonly [unknown, unknown]>,
  firstExcelRowNumber = 1
): OutboundReportResult {
  // Use firstExcelRowNumber + row index in validation errors, parse local timestamps,
  // aggregate into a Map keyed by YYYY-MM-DD, materialize h00-h23 with zero defaults,
  // sort by date, and calculate stats from validated rows.
}
```

Implement timestamp parsing without `Date.parse` for the AM/PM report string. Match `MM/DD/YYYY hh:mm:ss AM|PM`, validate calendar parts by round-tripping through `new Date(year, month - 1, day, hour, minute, second)`, and format from local getters. Accept `Date` objects using local getters. Reject empty or invalid timestamps with `OutboundReportError('第 N 行“创建时间”无效', N, '创建时间')`. Accept numeric strings for quantities only when they produce a finite, non-negative integer; otherwise throw the matching quantity error.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/unit/forecastInflowReport.test.ts`

Expected: all aggregation tests PASS.

- [ ] **Step 5: Commit the pure aggregation slice**

```bash
git add src/admin/forecastInflowReport.ts tests/unit/forecastInflowReport.test.ts
git commit -m "Add outbound report hourly aggregation"
```

### Task 2: Validation and workbook parsing

**Files:**
- Modify: `src/admin/forecastInflowReport.ts`
- Modify: `tests/unit/forecastInflowReport.test.ts`

- [ ] **Step 1: Add failing validation tests**

Add table-driven tests for blank, negative, fractional, and nonnumeric quantities; invalid calendar dates; empty datasets; missing headers; and header whitespace. Assert the error row number uses Excel's one-based row including the header:

```ts
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
```

Add a real in-memory SheetJS workbook test for a header not in row zero and a first empty sheet:

```ts
import * as XLSX from 'xlsx';
import { parseOutboundReportWorkbook } from '../../src/admin/forecastInflowReport';

test('uses the first non-empty sheet and locates the required header row', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['出库包裹报表'],
    [' 货品数量 ', ' 创建时间 '],
    [2, '07/01/2026 05:18:00 PM']
  ]), 'Data');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const result = parseOutboundReportWorkbook(bytes);
  expect(result.rows[0]).toMatchObject({ date: '2026-07-01', h17: 2 });
});
```

- [ ] **Step 2: Run validation tests and verify RED**

Run: `npm test -- tests/unit/forecastInflowReport.test.ts`

Expected: FAIL because the row offset and workbook parser are not implemented.

- [ ] **Step 3: Implement workbook parsing and strict errors**

Add `import * as XLSX from 'xlsx'`. Export:

```ts
export type ReportProgress = { processedRows: number; totalRows: number; percent: number };

export function parseOutboundReportWorkbook(
  data: ArrayBuffer | Uint8Array,
  onProgress?: (progress: ReportProgress) => void
): OutboundReportResult;
```

Use `XLSX.read(data, { type: 'array', cellDates: true })`. Inspect sheets in workbook order and select the first with a non-empty `!ref`. Convert only the used range to arrays with `raw: true` and `defval: null`. Search rows from top to bottom for one row containing both trimmed target headers. Capture their indices, then pass only the two target cells plus `headerRowIndex + 2` as the first Excel data-row number to the aggregator. Ignore rows only when every cell in the used row is blank; every other row must validate. Emit progress after each 5,000 validated/visited data rows and once at 100%.

Use these exact file-level errors:

```ts
throw new OutboundReportError('文件为空或没有可读取的工作表。');
throw new OutboundReportError('缺少必需列：创建时间、货品数量。');
throw new OutboundReportError('文件中没有可导入的数据。');
```

- [ ] **Step 4: Verify validation and workbook tests GREEN**

Run: `npm test -- tests/unit/forecastInflowReport.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Add the 100,000-row regression test**

Construct 100,000 two-cell source rows without writing an XLSX file, distribute them over two dates and 24 hours, call `aggregateOutboundRows`, and assert `sourceRows === 100000`, two output rows, correct total, and correct per-hour sums. Use `performance.now()` only for diagnostic logging, not a brittle timing assertion.

- [ ] **Step 6: Run the 100,000-row test**

Run: `npm test -- tests/unit/forecastInflowReport.test.ts`

Expected: PASS without timeout or heap errors.

- [ ] **Step 7: Commit validation and workbook support**

```bash
git add src/admin/forecastInflowReport.ts tests/unit/forecastInflowReport.test.ts
git commit -m "Parse and validate outbound inflow workbooks"
```

### Task 3: Web Worker protocol and lifecycle

**Files:**
- Create: `src/admin/forecastInflowReport.worker.ts`
- Create: `src/admin/forecastInflowWorkerClient.ts`
- Test: `tests/unit/forecastInflowWorkerClient.test.ts`

- [ ] **Step 1: Write failing Worker client tests**

Define a minimal fake Worker with `postMessage`, `terminate`, `onmessage`, and `onerror`. Test that progress is forwarded, success resolves, structured failure rejects, browser errors reject, and every terminal path calls `terminate()` exactly once:

```ts
test('forwards progress, resolves the result, and terminates', async () => {
  const fake = new FakeWorker();
  const progress: number[] = [];
  const promise = runInflowImportWorker(new ArrayBuffer(8), (value) => progress.push(value.percent), () => fake);
  fake.emit({ type: 'progress', progress: { processedRows: 5000, totalRows: 10000, percent: 50 } });
  fake.emit({ type: 'success', result: expectedResult });
  await expect(promise).resolves.toEqual(expectedResult);
  expect(progress).toEqual([50]);
  expect(fake.terminate).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run Worker client tests and verify RED**

Run: `npm test -- tests/unit/forecastInflowWorkerClient.test.ts`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement typed messages and client adapter**

In `forecastInflowWorkerClient.ts`, export the discriminated union and adapter:

```ts
export type InflowWorkerResponse =
  | { type: 'progress'; progress: ReportProgress }
  | { type: 'success'; result: OutboundReportResult }
  | { type: 'error'; message: string; rowNumber?: number; field?: string };

type WorkerFactory = () => Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

export function runInflowImportWorker(
  buffer: ArrayBuffer,
  onProgress: (progress: ReportProgress) => void,
  createWorker: WorkerFactory = () => new Worker(new URL('./forecastInflowReport.worker.ts', import.meta.url), { type: 'module' })
): Promise<OutboundReportResult>;
```

Post `{ type: 'parse', buffer }` with `[buffer]` as the transfer list. Guard settlement so success/error cannot terminate twice. Convert Worker `error` messages into `OutboundReportError` and generic `onerror` events into `Error('报表解析失败。')`.

In the Worker entry, listen for `{ type: 'parse'; buffer: ArrayBuffer }`, call `parseOutboundReportWorkbook`, forward progress, return success, and serialize `OutboundReportError` fields. Wrap unknown exceptions as `报表解析失败。`.

- [ ] **Step 4: Run Worker tests and verify GREEN**

Run: `npm test -- tests/unit/forecastInflowWorkerClient.test.ts`

Expected: all Worker client tests PASS.

- [ ] **Step 5: Verify Vite compiles the Worker entry**

Run: `npm run build`

Expected: TypeScript and Vite build exit 0 and emit a Worker asset without dynamic-import or Worker URL errors.

- [ ] **Step 6: Commit Worker support**

```bash
git add src/admin/forecastInflowReport.worker.ts src/admin/forecastInflowWorkerClient.ts tests/unit/forecastInflowWorkerClient.test.ts
git commit -m "Run inflow report parsing in a Web Worker"
```

### Task 4: Forecast history UI integration

**Files:**
- Modify: `src/admin/pages/ForecastPage.tsx:1-15`
- Modify: `src/admin/pages/ForecastPage.tsx:772-805`
- Modify: `src/admin/pages/ForecastPage.tsx:1534-1608`
- Modify: `src/admin/pages/ForecastPage.tsx:1925-1959`
- Modify: `src/admin/pages/ForecastPage.tsx:2708-2765`
- Test: `tests/admin/ForecastPage.reportImport.test.tsx`

- [ ] **Step 1: Write failing page behavior tests**

Render `ForecastPage` with a controlled Supabase fake and mock `runInflowImportWorker`. Cover these user behaviors:

```ts
test('imports an outbound report from the history view and shows the summary', async () => {
  // Open 历史流入, click 导入报表, upload an xlsx File, resolve the worker result.
  // Assert upsert receives one complete date row with onConflict: 'date'.
  // Assert the screen shows 已导入 1 天 · 13219 行 · 14040 件.
});

test('does not write to Supabase when report parsing fails', async () => {
  // Reject with OutboundReportError('第 218 行“创建时间”无效').
  // Assert the message is visible and volume_history.upsert was not called.
});

test('disables report import while an import is active', async () => {
  // Leave the mocked worker Promise pending and assert 导入报表 is disabled.
});
```

The Supabase fake must return empty successful results for initial reads, capture `.from('volume_history').upsert(...)`, and return the same rows from the subsequent `.select('*').in(...)` persistence verification.

- [ ] **Step 2: Run page tests and verify RED**

Run: `npm test -- tests/admin/ForecastPage.reportImport.test.tsx`

Expected: FAIL because the dedicated report input and handler do not exist.

- [ ] **Step 3: Add dedicated state and file input**

Import `runInflowImportWorker`, `ReportProgress`, and `OutboundReportResult`. Add:

```ts
const reportFileInputRef = useRef<HTMLInputElement | null>(null);
const [reportImporting, setReportImporting] = useState(false);
const [reportProgress, setReportProgress] = useState<ReportProgress | null>(null);
const [reportImportStage, setReportImportStage] = useState<'reading' | 'parsing' | 'saving' | 'verifying' | 'refreshing' | null>(null);
```

Render a hidden input inside the history dialog with `accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"`. Keep it separate from the existing template import input so each handler has one format contract.

- [ ] **Step 4: Add all-or-nothing pre-write handling and batched save**

Add a 100 MB constant and handler:

```ts
const MAX_OUTBOUND_REPORT_BYTES = 100 * 1024 * 1024;
const VOLUME_HISTORY_WRITE_BATCH_SIZE = 100;

const onOutboundReportSelected = async (file: File | null) => {
  if (!file || !supabase || reportImporting) return;
  if (file.size > MAX_OUTBOUND_REPORT_BYTES) {
    setUploadError(t('文件超过 100 MB。', 'The file exceeds 100 MB.'));
    return;
  }
  setReportImporting(true);
  setReportImportStage('reading');
  setUploadError(null);
  setUploadMessage(null);
  try {
    const buffer = await file.arrayBuffer();
    setReportImportStage('parsing');
    const result = await runInflowImportWorker(buffer, setReportProgress);
    setReportImportStage('saving');
    for (let index = 0; index < result.rows.length; index += VOLUME_HISTORY_WRITE_BATCH_SIZE) {
      const batch = result.rows.slice(index, index + VOLUME_HISTORY_WRITE_BATCH_SIZE);
      const response = await upsertVolumeHistoryRows(batch);
      if (response.error) throw new Error(String(response.error.message ?? 'Upload failed.'));
    }
    setReportImportStage('verifying');
    await verifyVolumeHistoryRowsPersisted(result.rows);
    mergeHistoryRows(result.rows);
    setReportImportStage('refreshing');
    await Promise.all([loadModel(lookbackMode), loadHistoryWindow(currentWeekDates), loadAutoForecastSnapshot(selectedWeekday)]);
    setUploadMessage(t(
      `已导入 ${result.stats.dayCount} 天 · ${result.stats.importedRows} 行 · ${formatNumber(result.stats.totalQuantity)} 件`,
      `Imported ${result.stats.dayCount} days · ${result.stats.importedRows} rows · ${formatNumber(result.stats.totalQuantity)} items`
    ));
  } catch (error) {
    setUploadError(String((error as Error)?.message ?? error));
    await loadHistoryWindow(currentWeekDates);
  } finally {
    setReportImporting(false);
    setReportProgress(null);
    setReportImportStage(null);
    if (reportFileInputRef.current) reportFileInputRef.current.value = '';
  }
};
```

Before using the snippet, ensure `upsertVolumeHistoryRows` accepts the shared imported row type structurally, without `any` in the new module. The existing Supabase boundary may retain its current cast because generated database types are not available in this component.

- [ ] **Step 5: Add concise progress UI and conflict disabling**

Place “导入报表” next to the paste action. Disable it when `isLocked`, `uploading`, `historyPasteSaving`, or `reportImporting`. Update `busyOverlay` so report stages show:

```ts
const reportStageCopy = {
  reading: t('正在读取文件', 'Reading file'),
  parsing: t(`正在解析 ${reportProgress?.percent ?? 0}%`, `Parsing ${reportProgress?.percent ?? 0}%`),
  saving: t('正在保存', 'Saving'),
  verifying: t('正在校验', 'Verifying'),
  refreshing: t('正在刷新', 'Refreshing')
};
```

Do not add explanatory subtitles to the dialog. Reuse existing button classes and BusyOverlay visual language.

- [ ] **Step 6: Run page tests and verify GREEN**

Run: `npm test -- tests/admin/ForecastPage.reportImport.test.tsx`

Expected: all report-import page tests PASS.

- [ ] **Step 7: Run the focused regression suite**

Run: `npm test -- tests/unit/forecastInflowReport.test.ts tests/unit/forecastInflowWorkerClient.test.ts tests/admin/ForecastPage.reportImport.test.tsx tests/unit/forecast.test.ts`

Expected: all listed tests PASS.

- [ ] **Step 8: Build after the substantial source edit**

Run: `npm run build`

Expected: TypeScript and Vite production build exit 0.

- [ ] **Step 9: Commit UI integration**

```bash
git add src/admin/pages/ForecastPage.tsx tests/admin/ForecastPage.reportImport.test.tsx
git commit -m "Add history inflow report import UI"
```

### Task 5: Reference workbook and browser acceptance

**Files:**
- Modify only if a defect is discovered: `src/admin/forecastInflowReport.ts`, `src/admin/forecastInflowReport.worker.ts`, `src/admin/forecastInflowWorkerClient.ts`, `src/admin/pages/ForecastPage.tsx`
- Modify only with a failing regression first: the matching test file under `tests/unit/` or `tests/admin/`

- [ ] **Step 1: Verify the reference workbook through the production parser**

Run a temporary Node command importing the built parser or a Vitest case that reads `C:/Users/cln87/Downloads/出库包裹报表_260730_003.xlsx`. Assert exactly:

```text
sourceRows: 13219
dayCount: 1
earliestDate: 2026-07-01
latestDate: 2026-07-01
totalQuantity: 14040
sum(h00...h23): 14040
```

Expected: every value matches.

- [ ] **Step 2: Start the local app and check the user flow**

Run: `npm run dev -- --port 4173 --strictPort`

Open `http://127.0.0.1:4173/admin.html`, navigate to Forecast, open “历史流入”, and verify:

```text
导入报表 is visible in the history view.
Selecting the reference xlsx immediately shows a loading state.
The page remains responsive while parsing.
Success copy reports 1 day, 13219 rows, and 14040 items.
The 2026-07-01 hourly row totals 14040.
Re-importing leaves the total at 14040 rather than 28080.
Light and dark themes have no overflow at desktop and mobile widths.
```

If the connected Supabase environment is unavailable, complete the UI interaction with the page test fake and report database acceptance as not executed; do not claim live persistence.

- [ ] **Step 3: Fix any discovered defect with TDD**

For each defect, first add one failing test that reproduces it, run that test to see the expected failure, apply the smallest production patch, then rerun the focused test to green. Do not make speculative refactors.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm test -- tests/unit/forecastInflowReport.test.ts tests/unit/forecastInflowWorkerClient.test.ts tests/admin/ForecastPage.reportImport.test.tsx tests/unit/forecast.test.ts
npm run build
git diff --check
git status --short
```

Expected: tests have zero failures, build exits 0, `git diff --check` produces no output, and status contains only intentional changes.

- [ ] **Step 5: Commit acceptance fixes if files changed**

If and only if Step 3 changed tracked files:

```bash
git add src/admin/forecastInflowReport.ts src/admin/forecastInflowReport.worker.ts src/admin/forecastInflowWorkerClient.ts src/admin/pages/ForecastPage.tsx tests/unit/forecastInflowReport.test.ts tests/unit/forecastInflowWorkerClient.test.ts tests/admin/ForecastPage.reportImport.test.tsx
git commit -m "Harden large inflow report imports"
```

If Step 3 changed nothing, do not create an empty commit.
