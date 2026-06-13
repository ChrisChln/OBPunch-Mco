import { LoaderCircle, LogIn } from 'lucide-react';

type TranslateFn = (zh: string, en: string) => string;

type AdminLoginPanelProps = {
  isLocked: boolean;
  email: string;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  doLogin: () => void | Promise<void>;
  themeMode: 'light' | 'dark';
  t: TranslateFn;
};

export default function AdminLoginPanel({
  isLocked,
  email,
  password,
  setEmail,
  setPassword,
  doLogin,
  themeMode,
}: AdminLoginPanelProps) {
  const isLight = themeMode === 'light';
  const shellClass = isLight
    ? 'relative mx-auto w-full max-w-[1120px] overflow-hidden rounded-[36px] border border-slate-300/80 bg-[linear-gradient(135deg,rgba(248,244,237,0.98),rgba(239,234,225,0.96))] shadow-[0_40px_120px_rgba(70,58,40,0.16)]'
    : 'relative mx-auto w-full max-w-[1120px] overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(135deg,rgba(5,7,10,0.92),rgba(11,13,16,0.84))] shadow-[0_40px_120px_rgba(0,0,0,0.45)]';
  const leftPanelClass = isLight
    ? 'flex min-h-[240px] flex-col justify-between rounded-[28px] border border-slate-300/70 bg-[rgba(255,255,255,0.34)] p-6 md:p-8'
    : 'flex min-h-[240px] flex-col justify-between rounded-[28px] border border-white/8 bg-white/[0.03] p-6 md:p-8';
  const rightPanelClass = isLight
    ? 'w-full rounded-[30px] border border-slate-300/80 bg-[rgba(255,255,255,0.56)] p-6 shadow-[0_28px_60px_rgba(70,58,40,0.12)] backdrop-blur-xl md:p-8'
    : 'w-full rounded-[30px] border border-white/10 bg-black/35 p-6 shadow-[0_28px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl md:p-8';
  const eyebrowClass = isLight ? 'text-[11px] uppercase tracking-[0.3em] text-slate-600' : 'text-[11px] uppercase tracking-[0.3em] text-slate-400';
  const leftEyebrowClass = isLight ? 'text-[11px] uppercase tracking-[0.32em] text-slate-600/90' : 'text-[11px] uppercase tracking-[0.32em] text-sky-200/80';
  const titleClass = isLight
    ? 'mt-4 font-display text-4xl tracking-[0.03em] text-slate-950 md:text-5xl'
    : 'mt-4 font-display text-4xl tracking-[0.03em] text-white md:text-5xl';
  const coverTitleClass = isLight
    ? 'mt-6 max-w-[10ch] font-display text-5xl leading-[0.92] tracking-[0.03em] text-slate-950 md:text-6xl xl:text-7xl'
    : 'mt-6 max-w-[10ch] font-display text-5xl leading-[0.92] tracking-[0.03em] text-white md:text-6xl xl:text-7xl';
  const labelClass = isLight ? 'text-[11px] font-medium uppercase tracking-[0.22em] text-slate-600' : 'text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500';
  const inputClass = isLight
    ? 'h-14 w-full rounded-[20px] border border-slate-300/80 bg-white/80 px-5 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:shadow-[0_0_0_2px_rgba(120,130,141,0.12)] disabled:cursor-not-allowed disabled:opacity-60'
    : 'h-14 w-full rounded-[20px] border border-white/12 bg-black/30 px-5 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60';
  const buttonClass = isLight
    ? 'mt-2 inline-flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-slate-950 px-5 text-base font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.16)] transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:bg-slate-950'
    : 'mt-2 inline-flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-neon px-5 text-base font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-glow';
  const loginDisabled = isLocked || email.trim() === '' || password === '';
  const buttonIcon = isLocked ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <LogIn className="h-4 w-4" strokeWidth={2.2} />;
  const buttonLabel = isLocked ? 'Signing In' : 'Admin Login';
  return (
    <section className={shellClass}>
      <div className="pointer-events-none absolute inset-0">
        <div className={isLight ? 'absolute -left-20 top-[-72px] h-64 w-64 rounded-full bg-amber-300/16 blur-3xl' : 'absolute -left-20 top-[-72px] h-64 w-64 rounded-full bg-[#9eff00]/10 blur-3xl'} />
        <div className={isLight ? 'absolute bottom-[-96px] right-[-56px] h-72 w-72 rounded-full bg-sky-500/12 blur-3xl' : 'absolute bottom-[-96px] right-[-56px] h-72 w-72 rounded-full bg-sky-400/10 blur-3xl'} />
        <div className={isLight ? 'absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.42),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.12),transparent_32%)]' : 'absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_32%)]'} />
      </div>

      <div className="relative grid min-h-[520px] gap-8 px-6 py-6 md:grid-cols-[minmax(0,1.3fr)_minmax(380px,0.9fr)] md:px-8 md:py-8 xl:px-10 xl:py-10">
        <div className={leftPanelClass}>
          <div>
            <div className={leftEyebrowClass}>OBPUNCH SECURITY</div>
            <h1 className={coverTitleClass}>
              Punch Screen
              <br />
              Unlock
            </h1>
          </div>
          <div />
        </div>

        <div className="flex items-center">
          <form
            className={rightPanelClass}
            onSubmit={(event) => {
              event.preventDefault();
              void doLogin();
            }}
          >
            <div className={eyebrowClass}>SIGN IN</div>
            <div className={titleClass}>Admin Login</div>

            <div className="mt-8 grid gap-5">
              <label className="grid gap-2">
                <span className={labelClass}>Email</span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isLocked}
                  placeholder="Admin email"
                  type="email"
                  autoComplete="email"
                  className={inputClass}
                />
              </label>

              <label className="grid gap-2">
                <span className={labelClass}>Password</span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={isLocked}
                  placeholder="Password"
                  type="password"
                  autoComplete="current-password"
                  className={inputClass}
                />
              </label>

              <button type="submit" disabled={loginDisabled} className={buttonClass}>
                {buttonIcon}
                <span>{buttonLabel}</span>
              </button>
            </div>

          </form>
        </div>
      </div>
    </section>
  );
}
