import {
  OutboundReportError,
  type OutboundReportResult,
  type ReportProgress
} from './forecastInflowReport';

export type InflowWorkerResponse =
  | { type: 'progress'; progress: ReportProgress }
  | { type: 'success'; result: OutboundReportResult }
  | { type: 'error'; message: string; rowNumber?: number; field?: '创建时间' | '货品数量' };

type WorkerLike = {
  onmessage: ((event: MessageEvent<InflowWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
};

type WorkerFactory = () => WorkerLike;

const createDefaultWorker: WorkerFactory = () =>
  new Worker(new URL('./forecastInflowReport.worker.ts', import.meta.url), { type: 'module' });

export function runInflowImportWorker(
  buffer: ArrayBuffer,
  onProgress: (progress: ReportProgress) => void,
  createWorker: WorkerFactory = createDefaultWorker
): Promise<OutboundReportResult> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      callback();
    };

    worker.onmessage = (event) => {
      const response = event.data;
      if (response.type === 'progress') {
        onProgress(response.progress);
        return;
      }
      if (response.type === 'success') {
        finish(() => resolve(response.result));
        return;
      }
      finish(() => reject(new OutboundReportError(response.message, response.rowNumber, response.field)));
    };

    worker.onerror = () => {
      finish(() => reject(new Error('报表解析失败。')));
    };

    worker.postMessage({ type: 'parse', buffer }, [buffer]);
  });
}
