import { describe, expect, test, vi } from 'vitest';
import type { OutboundReportResult } from '../../src/admin/forecastInflowReport';
import { runInflowImportWorker } from '../../src/admin/forecastInflowWorkerClient';

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitBrowserError() {
    this.onerror?.({ message: 'worker crashed' } as ErrorEvent);
  }
}

const expectedResult: OutboundReportResult = {
  rows: [],
  stats: {
    sourceRows: 0,
    importedRows: 0,
    dayCount: 0,
    totalQuantity: 0,
    earliestDate: '',
    latestDate: ''
  }
};

describe('runInflowImportWorker', () => {
  test('forwards progress, resolves the result, and terminates', async () => {
    const fake = new FakeWorker();
    const progress: number[] = [];
    const buffer = new ArrayBuffer(8);
    const promise = runInflowImportWorker(buffer, (value) => progress.push(value.percent), () => fake);

    fake.emit({ type: 'progress', progress: { processedRows: 5_000, totalRows: 10_000, percent: 50 } });
    fake.emit({ type: 'success', result: expectedResult });

    await expect(promise).resolves.toEqual(expectedResult);
    expect(progress).toEqual([50]);
    expect(fake.postMessage).toHaveBeenCalledWith({ type: 'parse', buffer }, [buffer]);
    expect(fake.terminate).toHaveBeenCalledOnce();
  });

  test('rejects a structured parser error and terminates', async () => {
    const fake = new FakeWorker();
    const promise = runInflowImportWorker(new ArrayBuffer(8), vi.fn(), () => fake);

    fake.emit({ type: 'error', message: '第 218 行“创建时间”无效', rowNumber: 218, field: '创建时间' });

    await expect(promise).rejects.toMatchObject({
      message: '第 218 行“创建时间”无效',
      rowNumber: 218,
      field: '创建时间'
    });
    expect(fake.terminate).toHaveBeenCalledOnce();
  });

  test('rejects a browser worker error and terminates once', async () => {
    const fake = new FakeWorker();
    const promise = runInflowImportWorker(new ArrayBuffer(8), vi.fn(), () => fake);

    fake.emitBrowserError();
    fake.emitBrowserError();

    await expect(promise).rejects.toThrow('报表解析失败。');
    expect(fake.terminate).toHaveBeenCalledOnce();
  });
});
