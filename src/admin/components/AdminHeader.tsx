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
  return (
    <header className="glass reveal rounded-3xl px-6 py-6 shadow-glow">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[220px]">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">ObPunch</p>
          <h1 className="font-display text-4xl tracking-[0.08em]">{t('后台系统', 'Admin Console')}</h1>
        </div>

        <div className="min-w-[260px] text-right">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isLocked}
              onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              className={[
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                themeMode === 'light' ? 'bg-neon text-white shadow-glow' : 'bg-white/10 text-slate-200 hover:bg-white/15'
              ].join(' ')}
              title={themeMode === 'dark' ? t('切换到白色主题', 'Switch to light mode') : t('切换到夜间主题', 'Switch to dark mode')}
            >
              {themeMode === 'dark' ? '☀' : '☾'}
            </button>
            <button
              type="button"
              disabled={isLocked}
              onClick={() => setLang('zh')}
              className={[
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                lang === 'zh' ? 'bg-neon text-white shadow-glow' : 'bg-white/10 text-slate-200 hover:bg-white/15'
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
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                lang === 'en' ? 'bg-neon text-white shadow-glow' : 'bg-white/10 text-slate-200 hover:bg-white/15'
              ].join(' ')}
              title="English"
            >
              EN
            </button>
          </div>

          <div className="mt-3 text-xs uppercase tracking-[0.25em] text-slate-400">{t('服务器时间', 'Server Time')}</div>
          <div className="mt-2 font-display text-2xl tracking-[0.08em] text-neon">{serverTimeText}</div>
          <div className="mt-2 text-xs text-slate-400">
            {user ? (userDisplayName.trim() || user.email || '-') : t('未登录', 'Signed out')}
          </div>
          {attendanceError && <div className="mt-2 text-xs text-ember">{t('考勤卡片加载失败：', 'Attendance cards failed: ')}{attendanceError}</div>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className={['text-sm', toneColor[status.tone]].join(' ')}>{status.message}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isLocked}
            onClick={onBack}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('返回', 'Back')}
          </button>
          {user && (
            <button
              type="button"
              disabled={isLocked}
              onClick={() => void onLogout()}
              className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('退出登录', 'Logout')}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
