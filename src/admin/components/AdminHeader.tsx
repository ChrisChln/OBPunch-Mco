import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Dispatch, SetStateAction } from 'react';

type TranslateFn = (zh: string, en: string) => string;

type AdminHeaderProps = {
  t: TranslateFn;
  isLocked: boolean;
  themeMode: 'light' | 'dark';
  setThemeMode: Dispatch<SetStateAction<'light' | 'dark'>>;
  lang: 'zh' | 'en';
  setLang: Dispatch<SetStateAction<'zh' | 'en'>>;
  user: User | null;
  userDisplayName: string;
  attendanceError: string | null;
  onBack: () => void;
  onLogout: () => void | Promise<void>;
};

const Icon = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);

const ArrowLeftIcon = ({ className = '' }: { className?: string }) => (
  <Icon className={className}>
    <path d="m10 19-7-7 7-7" />
    <path d="M3 12h18" />
  </Icon>
);

const TOP_MENU_LOGO_SRC = '/img/monacoin.png';

export default function AdminHeader({
  t,
  isLocked,
  themeMode,
  setThemeMode,
  lang,
  setLang,
  user,
  userDisplayName,
  attendanceError,
  onBack,
  onLogout
}: AdminHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isLight = themeMode === 'light';
  const shellClass = isLight
    ? 'border-b border-slate-200/80 bg-white/90 text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.04)] backdrop-blur-xl'
    : 'border-b border-slate-800/80 bg-slate-950/90 text-slate-100 shadow-[0_8px_24px_rgba(2,6,23,0.28)] backdrop-blur-xl';
  const initials = useMemo(() => {
    const source = (userDisplayName.trim() || user?.email || 'A').trim();
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((segment) => segment[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2) || 'A';
  }, [userDisplayName, user?.email]);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const menuPanelClass = isLight
    ? 'border-slate-200 bg-white text-slate-800 shadow-[0_16px_36px_rgba(15,23,42,0.14)]'
    : 'border-slate-800 bg-slate-950 text-slate-200 shadow-[0_18px_40px_rgba(2,6,23,0.45)]';
  const menuItemClass = isLight
    ? 'hover:bg-slate-100 text-slate-700'
    : 'hover:bg-slate-900 text-slate-200';

  return (
    <header className={['relative z-40 h-16 shrink-0', shellClass].join(' ')}>
      <div className="flex h-16 items-center gap-4 px-5 lg:px-6">
        <div className="flex items-center">
          <img src={TOP_MENU_LOGO_SRC} alt="Top menu logo" className="h-10 w-10 shrink-0 object-contain" />
        </div>

        <div ref={menuRef} className="relative ml-auto">
          <button
            type="button"
            disabled={isLocked}
            onClick={() => setMenuOpen((prev) => !prev)}
            className={[
              'group flex h-10 w-10 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60',
              isLight ? 'border-slate-200 bg-white hover:border-indigo-200' : 'border-slate-700 bg-slate-900 hover:border-indigo-500/40'
            ].join(' ')}
            title={t('个人菜单', 'Profile menu')}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
              {initials}
            </span>
          </button>

          {menuOpen && (
            <div className={['fixed right-4 top-16 z-[90] w-72 overflow-hidden rounded-2xl border', menuPanelClass].join(' ')} role="menu" aria-label={t('个人菜单', 'Profile menu')}>
              <div className={['border-b px-4 py-3', isLight ? 'border-slate-200' : 'border-slate-800'].join(' ')}>
                <div className="truncate text-sm font-semibold">
                  {user ? (userDisplayName.trim() || user.email || '-') : t('未登录', 'Signed out')}
                </div>
                <div className={['truncate text-xs', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                  {user?.email || t('管理员', 'Admin')}
                </div>
              </div>

              <div className="grid gap-1 p-2">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => {
                    setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
                    setMenuOpen(false);
                  }}
                  className={['flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60', menuItemClass].join(' ')}
                >
                  <span>{t('主题模式', 'Theme mode')}</span>
                  <span className="text-xs uppercase opacity-70">{themeMode === 'dark' ? 'Dark' : 'Light'}</span>
                </button>

                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => {
                    onBack();
                    setMenuOpen(false);
                  }}
                  className={['flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60', menuItemClass].join(' ')}
                >
                  <span>{t('返回上一页', 'Back')}</span>
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>

                <div className={['flex items-center justify-between rounded-xl px-3 py-2 text-sm', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                  <span>{t('语言', 'Language')}</span>
                  <div className={['flex items-center rounded-lg border p-1', isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-700 bg-slate-900'].join(' ')}>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setLang('zh')}
                      className={[
                        'rounded-md px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                        lang === 'zh'
                          ? 'bg-indigo-600 text-white'
                          : isLight
                            ? 'text-slate-600 hover:bg-slate-100'
                            : 'text-slate-300 hover:bg-slate-800'
                      ].join(' ')}
                    >
                      中文
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setLang('en')}
                      className={[
                        'rounded-md px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                        lang === 'en'
                          ? 'bg-indigo-600 text-white'
                          : isLight
                            ? 'text-slate-600 hover:bg-slate-100'
                            : 'text-slate-300 hover:bg-slate-800'
                      ].join(' ')}
                    >
                      EN
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => {
                    void onLogout();
                    setMenuOpen(false);
                  }}
                  className={[
                    'mt-1 flex w-full items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                    isLight
                      ? 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-200 hover:bg-white'
                      : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-indigo-500/40'
                  ].join(' ')}
                >
                  {t('退出登录', 'Logout')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {attendanceError && (
        <div className="pointer-events-none fixed right-4 top-20 z-50 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 shadow-lg">
          {t('考勤加载失败：', 'Attendance failed: ')}{attendanceError}
        </div>
      )}
    </header>
  );
}
