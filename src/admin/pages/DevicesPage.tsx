import { useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Download, Pencil, Power, Printer } from 'lucide-react';
import type { DeviceLabelPrintPayload, DeviceRow, DeviceType } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type DeviceEditDraft = {
  device_name: string;
  device_sn: string;
  device_type: string;
  position: string;
  note: string;
  active: boolean;
};

type DevicesPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  isReadOnly?: boolean;
  deviceRowsFiltered: DeviceRow[];
  isAllFilteredDevicesSelected: boolean;
  setDeviceSelectedLabelSns: Dispatch<SetStateAction<string[]>>;
  normalizeDeviceSn: (value: string) => string;
  refreshDevicePanel: () => void | Promise<void>;
  deviceSelectedLabelRows: DeviceLabelPrintPayload[];
  deviceLabelBatchPrinting: boolean;
  printDeviceLabelBatch: (rows: DeviceLabelPrintPayload[]) => void | Promise<void>;
  deviceFileInputRef: RefObject<HTMLInputElement>;
  onDeviceFileSelected: (file: File | null) => void | Promise<void>;
  uploadDevices: () => void | Promise<void>;
  onDownloadDeviceTemplate: () => void | Promise<void>;
  onExportDevices: () => void | Promise<void>;
  deviceUploadError: string | null;
  deviceSearch: string;
  setDeviceSearch: (value: string) => void;
  deviceFilterType: DeviceType | '';
  setDeviceFilterType: (value: DeviceType | '') => void;
  deviceFilterDepartment: string[];
  setDeviceFilterDepartment: (value: string[]) => void;
  deviceFilterPosition: string;
  setDeviceFilterPosition: (value: string) => void;
  deviceDepartmentOptions: Array<{ value: string; label: string }>;
  deviceBorrowedOnly: boolean;
  setDeviceBorrowedOnly: (value: boolean) => void;
  devicesError: string | null;
  DEVICE_TYPES: readonly string[]; // 现在是动态生成的可用类型列表
  ALLOWED_POSITIONS: readonly string[];
  normalizeDeviceType: (value: string) => DeviceType;
  deviceCurrentBorrowBySn: Map<string, { staff_id?: string | null; staff_name?: string | null; created_at?: string | null }>;
  selectedDeviceLabelSnSet: Set<string>;
  deviceLastUserBySn: Map<string, string>;
  serverTime: Date;
  parseDeviceCountedAtFromNote: (note: unknown) => string;
  deviceLastLoanAtBySn: Map<string, string>;
  DEVICE_COUNTING_STALE_MS: number;
  deviceLabelPrintingSn: string | null;
  printDeviceLabel: (payload: { sn: string; name: string; position: string; type: string }) => void | Promise<void>;
  toggleDeviceActive: (row: DeviceRow) => void | Promise<void>;
  updateDevice: (original: DeviceRow, draft: DeviceEditDraft) => void | Promise<void>;
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
  onExportDevices,
  deviceUploadError,
  deviceSearch,
  setDeviceSearch,
  deviceFilterType,
  setDeviceFilterType,
  deviceFilterDepartment,
  setDeviceFilterDepartment,
  deviceFilterPosition,
  setDeviceFilterPosition,
  deviceDepartmentOptions,
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
  toggleDeviceActive,
  updateDevice
}: DevicesPageProps) {
  const writeLocked = isLocked || isReadOnly;
  const [editingRow, setEditingRow] = useState<DeviceRow | null>(null);
  const [editDraft, setEditDraft] = useState<DeviceEditDraft>({
    device_name: '',
    device_sn: '',
    device_type: 'PDA',
    position: '',
    note: '',
    active: true
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const openDeviceEdit = (row: DeviceRow) => {
    setEditingRow(row);
    setEditDraft({
      device_name: String(row.device_name ?? row.name ?? '').trim(),
      device_sn: normalizeDeviceSn(String(row.device_sn ?? row.sn ?? '')),
      device_type: normalizeDeviceType(String(row.device_type ?? row.type ?? 'PDA')),
      position: String(row.position ?? '').trim(),
      note: String(row.note ?? ''),
      active: row.active !== false
    });
    setEditError(null);
  };
  const closeDeviceEdit = () => {
    if (editSaving) return;
    setEditingRow(null);
    setEditError(null);
  };
  const saveDeviceEdit = async () => {
    if (!editingRow || editSaving) return;
    const nextDraft = {
      ...editDraft,
      device_name: editDraft.device_name.trim(),
      device_sn: normalizeDeviceSn(editDraft.device_sn),
      device_type: editDraft.device_type.trim(),
      position: editDraft.position.trim(),
      note: editDraft.note.trim()
    };
    if (!nextDraft.device_sn) {
      setEditError(t('SN 必填。', 'SN is required.'));
      return;
    }
    if (!nextDraft.device_type) {
      setEditError(t('类型必填。', 'Type is required.'));
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await updateDevice(editingRow, nextDraft);
      setEditingRow(null);
    } catch (error) {
      setEditError(String((error as Error)?.message ?? error ?? t('保存失败。', 'Save failed.')));
    } finally {
      setEditSaving(false);
    }
  };

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
              <button
                type="button"
                disabled={isLocked || deviceRowsFiltered.length === 0}
                onClick={() => void onExportDevices()}
                className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white/10 px-5 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {t('导出', 'Export')}
              </button>
            </div>
            {deviceUploadError && <p className="mt-3 text-sm text-ember">{deviceUploadError}</p>}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="grid gap-3 md:grid-cols-5">
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
                value={deviceFilterDepartment[0] ?? ''}
                onChange={(e) => setDeviceFilterDepartment(e.target.value ? [e.target.value] : [])}
                disabled={isLocked}
                className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">{t('全部部门', 'All dept')}</option>
                {deviceDepartmentOptions.map((department) => (
                  <option key={department.value} value={department.value}>
                    {department.label}
                  </option>
                ))}
              </select>
              <select
                value={deviceFilterPosition}
                onChange={(e) => setDeviceFilterPosition(e.target.value ?? '')}
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
              <div className="mt-4 grid max-h-[70vh] grid-cols-1 gap-3 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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
                      className={['min-h-[216px] rounded-xl border px-3 py-3 transition-colors', cardToneClass, selected ? 'ring-2 ring-neon/80' : ''].join(' ')}
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
                        <div className="mt-3 grid grid-cols-3 gap-2">
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
                            aria-label={t('打印标签', 'Print label')}
                            title={t('打印标签', 'Print label')}
                            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/10 text-slate-100 transition hover:border-emerald-300/40 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-emerald-300/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Printer className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={writeLocked}
                            onClick={() => openDeviceEdit(row)}
                            aria-label={t('更改', 'Edit')}
                            title={t('更改', 'Edit')}
                            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/10 text-slate-100 transition hover:border-sky-300/40 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-sky-300/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={writeLocked}
                            onClick={() => void toggleDeviceActive(row)}
                            aria-label={active ? t('停用', 'Disable') : t('启用', 'Enable')}
                            title={active ? t('停用', 'Disable') : t('启用', 'Enable')}
                            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/10 text-slate-100 transition hover:border-amber-300/40 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-amber-300/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Power className="h-4 w-4" aria-hidden="true" />
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
      {editingRow && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-6" onClick={closeDeviceEdit}>
          <div
            className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950 p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
              <h3 className="font-display text-xl tracking-[0.08em] text-white">{t('更改设备', 'Edit Device')}</h3>
              <button
                type="button"
                disabled={editSaving}
                onClick={closeDeviceEdit}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('关闭', 'Close')}
              </button>
            </div>
            <div className="grid gap-4 py-5 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-slate-300">
                <span>{t('设备名', 'Name')}</span>
                <input
                  value={editDraft.device_name}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, device_name: event.target.value }))}
                  disabled={editSaving}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-300">
                <span>SN</span>
                <input
                  value={editDraft.device_sn}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, device_sn: event.target.value }))}
                  disabled={editSaving}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm uppercase text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-300">
                <span>{t('类型', 'Type')}</span>
                <input
                  value={editDraft.device_type}
                  list="device-edit-type-options"
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, device_type: event.target.value }))}
                  disabled={editSaving}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
                />
                <datalist id="device-edit-type-options">
                  {DEVICE_TYPES.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-300">
                <span>{t('岗位', 'Position')}</span>
                <input
                  value={editDraft.position}
                  list="device-edit-position-options"
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, position: event.target.value }))}
                  disabled={editSaving}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
                />
                <datalist id="device-edit-position-options">
                  {ALLOWED_POSITIONS.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-300 md:col-span-2">
                <span>{t('备注', 'Note')}</span>
                <textarea
                  value={editDraft.note}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, note: event.target.value }))}
                  disabled={editSaving}
                  rows={4}
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 text-sm font-medium text-slate-200">
                <input
                  type="checkbox"
                  checked={editDraft.active}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, active: event.target.checked }))}
                  disabled={editSaving}
                  className="h-4 w-4 accent-lime-400 disabled:cursor-not-allowed"
                />
                {t('启用', 'Active')}
              </label>
            </div>
            {editError && <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{editError}</div>}
            <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-4">
              <button
                type="button"
                disabled={editSaving}
                onClick={closeDeviceEdit}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={editSaving}
                onClick={() => void saveDeviceEdit()}
                className="rounded-xl bg-neon px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {editSaving ? t('保存中...', 'Saving...') : t('保存', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
