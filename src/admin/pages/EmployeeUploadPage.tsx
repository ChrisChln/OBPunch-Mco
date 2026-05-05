import type { RefObject } from 'react';

type TranslateFn = (zh: string, en: string) => string;

type EmployeeUploadPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  uploadFillDuplicates: boolean;
  setUploadFillDuplicates: (value: boolean) => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelected: (file: File | null) => void | Promise<void>;
  uploadEmployees: () => void | Promise<void>;
  onDownloadTemplate: () => void | Promise<void>;
  uploadError: string | null;
};

export default function EmployeeUploadPage({
  t,
  isLocked,
  uploadFillDuplicates,
  setUploadFillDuplicates,
  fileInputRef,
  onFileSelected,
  uploadEmployees,
  onDownloadTemplate,
  uploadError
}: EmployeeUploadPageProps) {
  return (
    <section className="px-6 py-8">
      <h2 className="font-display text-2xl tracking-[0.08em]">{t('员工信息上传', 'Employee Upload')}</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={uploadFillDuplicates}
            onChange={(e) => setUploadFillDuplicates(e.target.checked)}
            disabled={isLocked}
            className="h-4 w-4 accent-neon disabled:cursor-not-allowed disabled:opacity-60"
          />
          {t('重复时补全信息', 'Fill missing fields on duplicates')}
        </label>
      </div>

      <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          disabled={isLocked}
          onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
          className="block w-full cursor-pointer rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="flex gap-3">
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void uploadEmployees()}
            className="h-12 min-w-[88px] whitespace-nowrap rounded-2xl bg-neon px-6 text-base font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('上传', 'Upload')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void onDownloadTemplate()}
            className="h-12 min-w-[120px] whitespace-nowrap rounded-2xl bg-white/10 px-6 text-base font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('下载模版', 'Download template')}
          </button>
        </div>
      </div>
      {uploadError && <p className="mt-3 text-sm text-ember">{uploadError}</p>}
    </section>
  );
}
