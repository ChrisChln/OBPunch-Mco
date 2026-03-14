import type { User } from '@supabase/supabase-js';
import type { Dispatch, SetStateAction } from 'react';
import type { Status, StatusTone } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type AdminHeaderProps = {
  t: TranslateFn;
  isLocked: boolean;
  themeMode: 'light' | 'dark';
  setThemeMode: Dispatch<SetStateAction<'light' | 'dark'>>;
  lang: 'zh' | 'en';
  setLang: Dispatch<SetStateAction<'zh' | 'en'>>;
  status: Status;
  toneColor: Record<StatusTone, string>;
  serverTimeText: string;
  user: User | null;
  userDisplayName: string;
  attendanceError: string | null;
  onBack: () => void;
  onLogout: () => void | Promise<void>;
};

export default function AdminHeader({
  t,
  isLocked,
  themeMode,
  setThemeMode,
  lang,
  setLang,
  status,
  toneColor,
  serverTimeText,
  user,
  userDisplayName,
  attendanceError,
  onBack,
  onLogout
}: AdminHeaderProps) {
  const utilityButtonClass =
    'inline-flex h-10 min-w-[72px] items-center justify-center rounded-full border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
  const actionButtonClass =
    'inline-flex h-10 min-w-[96px] items-center justify-center rounded-full border px-5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <header className="glass reveal rounded-[36px] border border-white/10 px-6 py-6 shadow-[0_30px_90px_rgba(0,0,0,0.28)] md:px-8 md:py-7">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-[220px]">
          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-300">
            ObPunch Admin
          </div>
          <h1 className="mt-4 font-display text-4xl tracking-[0.03em] text-stone-50 md:text-5xl">
            {t('后台系统', 'Admin Console')}
          </h1>
        </div>

        <div className="min-w-[280px] text-right">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isLocked}
              onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              className={[
                utilityButtonClass,
                themeMode === 'light'
                  ? 'border-stone-200/90 bg-stone-100 text-stone-900'
                  : 'border-white/10 bg-white/[0.04] text-stone-200 hover:border-white/15 hover:bg-white/[0.07]'
              ].join(' ')}
              title={themeMode === 'dark' ? t('切换到白色主题', 'Switch to light mode') : t('切换到夜间主题', 'Switch to dark mode')}
            >
              {themeMode === 'dark' ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              disabled={isLocked}
              onClick={() => setLang('zh')}
              className={[
                utilityButtonClass,
                lang === 'zh'
                  ? 'border-stone-200/90 bg-stone-100 text-stone-900'
                  : 'border-white/10 bg-white/[0.04] text-stone-200 hover:border-white/15 hover:bg-white/[0.07]'
              ].join(' ')}
              title="中文"
            >
              中文
            </button>
            <button
              type="button"
              disabled={isLocked}
              onClick={() => setLang('en')}
              className={[
                utilityButtonClass,
                lang === 'en'
                  ? 'border-stone-200/90 bg-stone-100 text-stone-900'
                  : 'border-white/10 bg-white/[0.04] text-stone-200 hover:border-white/15 hover:bg-white/[0.07]'
              ].join(' ')}
              title="English"
            >
              EN
            </button>
          </div>

          <div className="mt-6 text-[11px] uppercase tracking-[0.24em] text-stone-400">{t('服务器时间', 'Server Time')}</div>
          <div className="mt-2 font-display text-3xl tracking-[0.04em] text-stone-50">{serverTimeText}</div>
          <div className="mt-3 text-sm text-stone-400">
            {user ? (userDisplayName.trim() || user.email || '-') : t('未登录', 'Signed out')}
          </div>
          {attendanceError && (
            <div className="mt-2 text-xs text-rose-200">
              {t('考勤卡片加载失败：', 'Attendance cards failed: ')}
              {attendanceError}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/8 pt-5">
        <div className={['text-sm', toneColor[status.tone]].join(' ')}>{status.message}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isLocked}
            onClick={onBack}
            className={[actionButtonClass, 'border-white/10 bg-white/[0.04] text-stone-200 hover:border-white/15 hover:bg-white/[0.07]'].join(' ')}
          >
            {t('返回', 'Back')}
          </button>
          {user && (
            <button
              type="button"
              disabled={isLocked}
              onClick={() => void onLogout()}
              className={[actionButtonClass, 'border-white/10 bg-white/[0.04] text-stone-200 hover:border-white/15 hover:bg-white/[0.07]'].join(' ')}
            >
              {t('退出登录', 'Logout')}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
