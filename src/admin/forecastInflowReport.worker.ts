import { OutboundReportError, parseOutboundReportWorkbook } from './forecastInflowReport';
import type { InflowWorkerResponse } from './forecastInflowWorkerClient';

type InflowWorkerRequest = { type: 'parse'; buffer: ArrayBuffer };

type WorkerScope = {
  onmessage: ((event: MessageEvent<InflowWorkerRequest>) => void) | null;
  postMessage(message: InflowWorkerResponse): void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  if (event.data.type !== 'parse') return;
  try {
    const result = parseOutboundReportWorkbook(event.data.buffer, (progress) => {
      workerScope.postMessage({ type: 'progress', progress });
    });
    workerScope.postMessage({ type: 'success', result });
  } catch (error) {
    if (error instanceof OutboundReportError) {
      workerScope.postMessage({
        type: 'error',
        message: error.message,
        rowNumber: error.rowNumber,
        field: error.field
      });
      return;
    }
    workerScope.postMessage({ type: 'error', message: '报表解析失败。' });
  }
};
