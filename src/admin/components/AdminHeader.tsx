import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  userAvatarUrl: string;
  profileDraftName: string;
  setProfileDraftName: Dispatch<SetStateAction<string>>;
  profileSaving: boolean;
  onProfileSave: () => void | Promise<void>;
  onProfileAvatarPick: (file: File | null) => void | Promise<void>;
  attendanceError: string | null;
  onBack: () => void;
  onLogout: () => void | Promise<void>;
};

const TOP_MENU_LOGO_SRC = '/img/monacoin.png';

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

function AdminHeader({
  t,
  isLocked,
  themeMode,
  setThemeMode,
  lang,
  setLang,
  user,
  userDisplayName,
  userAvatarUrl,
  profileDraftName,
  setProfileDraftName,
  profileSaving,
  onProfileSave,
  onProfileAvatarPick,
  attendanceError,
  onBack,
  onLogout
}: AdminHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const isLight = themeMode === 'light';

  const shellClass = isLight
    ? 'border-b border-slate-200/80 bg-white/90 text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.04)] backdrop-blur-xl'
    : 'border-b border-slate-800/80 bg-slate-950/90 text-slate-100 shadow-[0_8px_24px_rgba(2,6,23,0.28)] backdrop-blur-xl';
  const menuPanelClass = isLight
    ? 'border-slate-200 bg-white text-slate-800 shadow-[0_16px_36px_rgba(15,23,42,0.14)]'
    : 'border-slate-800 bg-slate-950 text-slate-200 shadow-[0_18px_40px_rgba(2,6,23,0.45)]';
  const menuItemClass = isLight
    ? 'text-slate-700 hover:bg-slate-100'
    : 'text-slate-200 hover:bg-slate-900';
  const modalOverlayClass = isLight
    ? 'bg-slate-950/46'
    : 'bg-slate-950/72';
  const modalPanelClass = isLight
    ? 'border-slate-200 bg-slate-50 text-slate-900 shadow-[0_28px_80px_rgba(15,23,42,0.22)]'
    : 'border-slate-700 bg-slate-950 text-slate-100 shadow-[0_30px_90px_rgba(2,6,23,0.62)]';
  const modalCardClass = isLight
    ? 'border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_12px_32px_rgba(15,23,42,0.08)]'
    : 'border-slate-700 bg-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_32px_rgba(2,6,23,0.34)]';

  const initials = useMemo(() => {
    const source = (userDisplayName.trim() || user?.email || 'A').trim();
    return (
      source
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((segment) => segment[0]?.toUpperCase() ?? '')
        .join('')
        .slice(0, 2) || 'A'
    );
  }, [userDisplayName, user?.email]);

  useEffect(() => {
    if (!menuOpen) return;
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

  useEffect(() => {
    if (!profileModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [profileModalOpen]);

  const triggerAvatar = userAvatarUrl ? (
    <img src={userAvatarUrl} alt={t('头像', 'Avatar')} className="h-8 w-8 rounded-full object-cover" />
  ) : (
    <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
      {initials}
    </span>
  );

  const profileAvatar = userAvatarUrl ? (
    <img src={userAvatarUrl} alt={t('头像', 'Avatar')} className="h-20 w-20 rounded-[22px] object-cover ring-1 ring-white/10" />
  ) : (
    <div className="grid h-20 w-20 place-items-center rounded-[22px] bg-gradient-to-br from-indigo-500 to-violet-600 text-2xl font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_18px_30px_rgba(79,70,229,0.28)]">
      {initials}
    </div>
  );

  return (
    <header className={['relative z-40 h-16 shrink-0', shellClass].join(' ')}>
      <div className="flex h-16 items-center gap-4 px-5 lg:px-6">
        <div className="flex items-center">
          <img src={TOP_MENU_LOGO_SRC} alt="Top menu logo" className="h-10 w-10 shrink-0 object-contain" />
          <span className={['ml-3 font-display text-lg font-bold tracking-[0.06em]', isLight ? 'text-slate-900' : 'text-slate-100'].join(' ')}>
            ObPunch Admin
          </span>
        </div>

        <div ref={menuRef} className="relative ml-auto">
          <button
            type="button"
            disabled={isLocked}
            onClick={() => setMenuOpen((prev) => !prev)}
            className={[
              'group flex h-10 w-10 items-center justify-center rounded-full border border-transparent bg-transparent p-0 shadow-none transition disabled:cursor-not-allowed disabled:opacity-60',
              'hover:border-transparent hover:bg-transparent'
            ].join(' ')}
            title={t('个人菜单', 'Profile menu')}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            {triggerAvatar}
          </button>

          {menuOpen && (
            <div className={['fixed right-4 top-16 z-[90] w-72 overflow-hidden rounded-2xl border', menuPanelClass].join(' ')} role="menu" aria-label={t('个人菜单', 'Profile menu')}>
              <div className={['border-b px-4 py-3', isLight ? 'border-slate-200' : 'border-slate-800'].join(' ')}>
                <div className="flex items-center gap-3">
                  {userAvatarUrl ? (
                    <img src={userAvatarUrl} alt={t('头像', 'Avatar')} className="h-11 w-11 rounded-full object-cover ring-1 ring-white/10" />
                  ) : (
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white">
                      {initials}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {user ? (userDisplayName.trim() || user.email || '-') : t('未登录', 'Signed out')}
                    </div>
                    <div className={['truncate text-xs', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                      {user?.email || t('管理员', 'Admin')}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-1 p-2">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => {
                    setProfileModalOpen(true);
                    setMenuOpen(false);
                  }}
                  className={['flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60', menuItemClass].join(' ')}
                >
                  <span>{t('个人资料', 'Profile')}</span>
                </button>

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

      {profileModalOpen &&
        createPortal(
          <div className={['fixed inset-0 z-[120] flex items-center justify-center p-4', modalOverlayClass].join(' ')} onClick={() => setProfileModalOpen(false)}>
            <div
              className={['max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[28px] border p-4 sm:p-5', modalPanelClass].join(' ')}
              role="dialog"
              aria-modal="true"
              aria-label={t('个人资料', 'Profile')}
              onClick={(event) => event.stopPropagation()}
            >
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void onProfileAvatarPick(file);
                  event.currentTarget.value = '';
                }}
              />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className={['text-[11px] font-semibold uppercase tracking-[0.22em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                    {t('个人资料', 'Profile')}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight">{t('编辑资料', 'Edit profile')}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setProfileModalOpen(false)}
                  className={['rounded-full border px-3 py-1.5 text-xs font-semibold transition', isLight ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'].join(' ')}
                >
                  {t('关闭', 'Close')}
                </button>
              </div>

              <div className={['mt-5 rounded-[24px] border p-4 sm:p-5', modalCardClass].join(' ')}>
                <div className="flex items-center gap-4">
                  {profileAvatar}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">{userDisplayName.trim() || user?.email || '-'}</div>
                    <div className={['mt-1 truncate text-sm', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                      {user?.email || t('管理员', 'Admin')}
                    </div>
                    <button
                      type="button"
                      disabled={isLocked || profileSaving}
                      onClick={() => avatarInputRef.current?.click()}
                      className={[
                        'mt-3 inline-flex items-center rounded-xl border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                        isLight
                        ? 'border-slate-200 bg-white text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_20px_rgba(15,23,42,0.06)] hover:border-indigo-200'
                        : 'border-slate-700 bg-slate-950 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_22px_rgba(2,6,23,0.28)] hover:border-indigo-500/40'
                      ].join(' ')}
                    >
                      {t('更换头像', 'Change avatar')}
                    </button>
                  </div>
                </div>

                <label className="mt-5 block">
                  <span className={['mb-2 block text-xs font-semibold uppercase tracking-[0.18em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                    {t('名字', 'Name')}
                  </span>
                  <input
                    value={profileDraftName}
                    onChange={(event) => setProfileDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void onProfileSave();
                      }
                    }}
                    placeholder={t('输入显示名称', 'Enter display name')}
                    className={[
                      'h-12 w-full rounded-2xl border px-4 text-sm outline-none transition',
                      isLight
                        ? 'border-slate-200 bg-white text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_24px_rgba(15,23,42,0.05)] focus:border-indigo-300'
                      : 'border-slate-700 bg-slate-950 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_12px_26px_rgba(2,6,23,0.26)] focus:border-indigo-500/40'
                    ].join(' ')}
                  />
                </label>

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setProfileModalOpen(false)}
                    className={[
                      'rounded-2xl border px-4 py-2.5 text-sm font-semibold transition',
                      isLight
                        ? 'border-slate-200 bg-white text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(15,23,42,0.06)] hover:border-slate-300'
                        : 'border-slate-700 bg-slate-950 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_20px_rgba(2,6,23,0.28)] hover:border-slate-600'
                    ].join(' ')}
                  >
                    {t('取消', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={isLocked || profileSaving || !profileDraftName.trim()}
                    onClick={() => void onProfileSave()}
                    className={[
                      'rounded-2xl border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                      isLight
                        ? 'border-indigo-200 bg-indigo-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_16px_26px_rgba(79,70,229,0.26)] hover:bg-indigo-500'
                        : 'border-indigo-400/30 bg-[linear-gradient(180deg,rgba(99,102,241,0.34),rgba(79,70,229,0.24))] text-indigo-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_30px_rgba(79,70,229,0.22)] hover:border-indigo-300/40'
                    ].join(' ')}
                  >
                    {profileSaving ? t('保存中...', 'Saving...') : t('保存资料', 'Save profile')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {attendanceError && (
        <div className="pointer-events-none fixed right-4 top-20 z-50 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 shadow-lg">
          {t('考勤加载失败：', 'Attendance failed: ')}
          {attendanceError}
        </div>
      )}
    </header>
  );
}

export default memo(AdminHeader);
