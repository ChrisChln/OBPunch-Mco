import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { AllowedPosition, DeviceType } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type DevicesPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  isReadOnly?: boolean;
  deviceRowsFiltered: any[];
  isAllFilteredDevicesSelected: boolean;
  setDeviceSelectedLabelSns: Dispatch<SetStateAction<string[]>>;
  normalizeDeviceSn: (value: string) => string;
  refreshDevicePanel: () => void | Promise<void>;
  deviceSelectedLabelRows: any[];
  deviceLabelBatchPrinting: boolean;
  printDeviceLabelBatch: (rows: any[]) => void | Promise<void>;
  deviceFileInputRef: RefObject<HTMLInputElement>;
  onDeviceFileSelected: (file: File | null) => void | Promise<void>;
  uploadDevices: () => void | Promise<void>;
  onDownloadDeviceTemplate: () => void | Promise<void>;
  deviceUploadError: string | null;
  deviceSearch: string;
  setDeviceSearch: (value: string) => void;
  deviceFilterType: DeviceType | '';
  setDeviceFilterType: (value: DeviceType | '') => void;
  deviceFilterPosition: AllowedPosition | '';
  setDeviceFilterPosition: (value: AllowedPosition | '') => void;
  deviceBorrowedOnly: boolean;
  setDeviceBorrowedOnly: (value: boolean) => void;
  devicesError: string | null;
  DEVICE_TYPES: readonly string[]; // 现在是动态生成的可用类型列表
  ALLOWED_POSITIONS: readonly AllowedPosition[];
  normalizeDeviceType: (value: string) => DeviceType;
  deviceCurrentBorrowBySn: Map<string, any>;
  selectedDeviceLabelSnSet: Set<string>;
  deviceLastUserBySn: Map<string, string>;
  serverTime: Date;
  parseDeviceCountedAtFromNote: (note: unknown) => string;
  deviceLastLoanAtBySn: Map<string, string>;
  DEVICE_COUNTING_STALE_MS: number;
  deviceLabelPrintingSn: string | null;
  printDeviceLabel: (payload: { sn: string; name: string; position: string; type: string }) => void | Promise<void>;
  toggleDeviceActive: (row: any) => void | Promise<void>;
};

export default function DevicesPage({
  t,
  isLocked,
  isReadOnly = false,
  deviceRowsFiltered,
  isAllFilteredDevicesSelected,
  setDeviceSelectedLabelSns,
  normalizeDeviceSn,
  refreshDevicePanel,
  deviceSelectedLabelRows,
  deviceLabelBatchPrinting,
  printDeviceLabelBatch,
  deviceFileInputRef,
  onDeviceFileSelected,
  uploadDevices,
  onDownloadDeviceTemplate,
  deviceUploadError,
  deviceSearch,
  setDeviceSearch,
  deviceFilterType,
  setDeviceFilterType,
  deviceFilterPosition,
  setDeviceFilterPosition,
  deviceBorrowedOnly,
  setDeviceBorrowedOnly,
  devicesError,
  DEVICE_TYPES,
  ALLOWED_POSITIONS,
  normalizeDeviceType,
  deviceCurrentBorrowBySn,
  selectedDeviceLabelSnSet,
  deviceLastUserBySn,
  serverTime,
  parseDeviceCountedAtFromNote,
  deviceLastLoanAtBySn,
  DEVICE_COUNTING_STALE_MS,
  deviceLabelPrintingSn,
  printDeviceLabel,
  toggleDeviceActive
}: DevicesPageProps) {
  const writeLocked = isLocked || isReadOnly;
  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('设备管理', 'Devices')}</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={isLocked || deviceRowsFiltered.length === 0}
            onClick={() =>
              setDeviceSelectedLabelSns((prev) => {
                const next = new Set(prev);
                if (isAllFilteredDevicesSelected) {
                  for (const row of deviceRowsFiltered) {
                    const sn = normalizeDeviceSn(String(row.device_sn ?? row.sn ?? ''));
                    if (sn) next.delete(sn);
                  }
                } else {
                  for (const row of deviceRowsFiltered) {
                    const sn = normalizeDeviceSn(String(row.device_sn ?? row.sn ?? ''));
                    if (sn) next.add(sn);
                  }
                }
                return [...next];
              })
            }
            className="rounded-2xl bg-white/10 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAllFilteredDevicesSelected ? t('取消全选', 'Unselect all') : t('全选当前', 'Select filtered')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void refreshDevicePanel()}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('刷新', 'Refresh')}
          </button>
          <button
            type="button"
            disabled={isLocked || deviceSelectedLabelRows.length === 0 || deviceLabelBatchPrinting}
            onClick={() => void printDeviceLabelBatch(deviceSelectedLabelRows)}
            className="rounded-2xl bg-neon px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deviceLabelBatchPrinting ? t('批量生成中...', 'Generating...') : t('批量打印标签', 'Batch print labels')}
            <span className="ml-1">({deviceSelectedLabelRows.length})</span>
          </button>
        </div>
      </div>
      <div className="mt-5">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-2 text-xs text-slate-400">{t('仅支持通过 Excel/CSV 导入设备。', 'Only Excel/CSV import is supported for adding devices.')}</div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex h-11 cursor-pointer items-center rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-slate-200 transition hover:border-white/20">
                <input
                  ref={deviceFileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  disabled={writeLocked}
                  onChange={(e) => void onDeviceFileSelected(e.target.files?.[0] ?? null)}
                />
                {t('选择设备文件', 'Choose file')}
              </label>
              <button
                type="button"
                disabled={writeLocked}
                onClick={() => void uploadDevices()}
                className="h-11 rounded-2xl bg-neon px-5 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('导入设备', 'Import devices')}
              </button>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => void onDownloadDeviceTemplate()}
                className="h-11 rounded-2xl bg-white/10 px-5 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('下载模版', 'Download template')}
              </button>
            </div>
            {deviceUploadError && <p className="mt-3 text-sm text-ember">{deviceUploadError}</p>}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <input
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
                disabled={isLocked}
                placeholder={t('搜索设备名/SN/类型/岗位', 'Search name / SN / type / position')}
                className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
              />
              <select
                value={deviceFilterType}
                onChange={(e) => setDeviceFilterType((e.target.value as DeviceType | '') ?? '')}
                disabled={isLocked}
                className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">{t('全部类型', 'All types')}</option>
                {DEVICE_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                value={deviceFilterPosition}
                onChange={(e) => setDeviceFilterPosition((e.target.value as AllowedPosition | '') ?? '')}
                disabled={isLocked}
                className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">{t('全部岗位', 'All positions')}</option>
                {ALLOWED_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={deviceBorrowedOnly}
                  onChange={(e) => setDeviceBorrowedOnly(e.target.checked)}
                  disabled={isLocked}
                  className="h-4 w-4 accent-lime-400 disabled:cursor-not-allowed"
                />
                {t('仅看借用中', 'Borrowed only')}
              </label>
            </div>

            {devicesError && <p className="mt-3 text-sm text-ember">{devicesError}</p>}
            {!devicesError && (
              <div className="mt-3 grid max-h-[70vh] grid-cols-4 gap-2 overflow-auto pr-1 md:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">
                {deviceRowsFiltered.map((row) => {
                  const sn = normalizeDeviceSn(String(row.device_sn ?? row.sn ?? ''));
                  const type = normalizeDeviceType(String(row.device_type ?? row.type ?? 'PDA'));
                  const borrowed = deviceCurrentBorrowBySn.get(sn);
                  const active = row.active !== false;
                  const selected = selectedDeviceLabelSnSet.has(sn);
                  const canSelect = Boolean(sn);
                  const deviceName = String(row.device_name ?? '').trim();
                  const lastUserName = deviceLastUserBySn.get(sn) ?? '-';
                  const borrowedAtMs = borrowed ? Date.parse(String(borrowed.created_at ?? '')) : 0;
                  const borrowAgeMs = borrowedAtMs > 0 ? Math.max(0, serverTime.getTime() - borrowedAtMs) : 0;
                  const isOverdue = Boolean(borrowed) && borrowAgeMs >= 24 * 60 * 60 * 1000;
                  const countedAtMs = Date.parse(parseDeviceCountedAtFromNote(row.note)) || 0;
                  const lastLoanAtMs = Date.parse(String(deviceLastLoanAtBySn.get(sn) ?? '')) || 0;
                  const createdAtMs = Date.parse(String(row.created_at ?? '')) || 0;
                  const needCounting = !borrowed
                    ? (() => {
                        if (lastLoanAtMs <= 0 && countedAtMs <= 0) return true;
                        const baselineMs = Math.max(lastLoanAtMs, createdAtMs, countedAtMs);
                        if (!Number.isFinite(baselineMs) || baselineMs <= 0) return false;
                        return serverTime.getTime() - baselineMs >= DEVICE_COUNTING_STALE_MS;
                      })()
                    : false;
                  const pad = (n: number) => String(n).padStart(2, '0');
                  const durationText = borrowed
                    ? `${pad(Math.floor(borrowAgeMs / 3600000))}:${pad(Math.floor((borrowAgeMs % 3600000) / 60000))}:${pad(
                        Math.floor((borrowAgeMs % 60000) / 1000)
                      )}`
                    : '';
                  const cardToneClass = !active
                    ? 'border-rose-400/55 bg-rose-500/10'
                    : needCounting
                      ? 'border-sky-400/55 bg-sky-500/12'
                      : !borrowed
                        ? 'border-emerald-400/45 bg-emerald-500/10'
                        : isOverdue
                          ? 'border-rose-400/55 bg-rose-500/10'
                          : 'border-amber-400/55 bg-amber-500/10';
                  const statusClass = !active
                    ? 'text-rose-300'
                    : needCounting
                      ? 'text-sky-300'
                      : !borrowed
                        ? 'text-emerald-300'
                        : isOverdue
                          ? 'text-rose-300'
                          : 'text-amber-300';
                  return (
                    <div
                      key={String(row.id ?? sn)}
                      className={['aspect-square rounded-xl border px-3 py-2 transition-colors', cardToneClass, selected ? 'ring-2 ring-neon/80' : ''].join(' ')}
                    >
                      <div className="flex h-full flex-col justify-between">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="truncate text-sm font-semibold text-slate-100">{deviceName || '-'}</div>
                            <label className="inline-flex h-4 w-4 flex-none cursor-pointer items-center justify-center">
                              <input
                                type="checkbox"
                                checked={selected}
                                disabled={isLocked || !canSelect}
                                onChange={() =>
                                  canSelect &&
                                  setDeviceSelectedLabelSns((prev) => (prev.includes(sn) ? prev.filter((item) => item !== sn) : [...prev, sn]))
                                }
                                className="h-4 w-4 cursor-pointer rounded border-white/30 bg-black/30 accent-emerald-400 disabled:cursor-not-allowed"
                              />
                            </label>
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {type}
                            {row.position ? ` · ${row.position}` : ` · ${t('无岗位', 'No position')}`}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">SN: {sn || '-'}</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {t('最后使用者', 'Last user')}: {lastUserName}
                          </div>
                        </div>
                        <div className="pt-2 text-right">
                          <div className={['text-xs font-semibold', statusClass].join(' ')}>
                            {!active
                              ? t('停用', 'Disabled')
                              : needCounting
                                ? t('需盘点', 'Need Counting')
                                : !borrowed
                                  ? t('空闲', 'Available')
                                  : isOverdue
                                    ? t('借用超24小时', 'Borrowed >24h')
                                    : t('借用中', 'Borrowed')}
                          </div>
                          {borrowed && <div className="text-xs text-slate-200">{borrowed.staff_name || borrowed.staff_id}</div>}
                          {borrowed && (
                            <div className="text-[11px] text-slate-400">
                              {t('时长', 'Duration')}: {durationText}
                            </div>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            disabled={isLocked || deviceLabelPrintingSn === sn || deviceLabelBatchPrinting}
                            onClick={() =>
                              void printDeviceLabel({
                                sn,
                                name: deviceName || sn,
                                position: String(row.position ?? ''),
                                type
                              })
                            }
                            className="rounded-xl bg-white/10 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deviceLabelPrintingSn === sn ? t('生成中...', 'Generating...') : t('打印标签', 'Print')}
                          </button>
                          <button
                            type="button"
                            disabled={writeLocked}
                            onClick={() => void toggleDeviceActive(row)}
                            className="rounded-xl bg-white/10 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {active ? t('停用', 'Disable') : t('启用', 'Enable')}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {deviceRowsFiltered.length === 0 && (
                  <div className="col-span-full px-2 py-4 text-sm text-slate-400">{t('暂无设备。', 'No devices.')}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
