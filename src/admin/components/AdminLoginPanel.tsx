type TranslateFn = (zh: string, en: string) => string;

type AdminLoginPanelProps = {
  isLocked: boolean;
  email: string;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  doLogin: () => void | Promise<void>;
  t: TranslateFn;
};

export default function AdminLoginPanel({
  isLocked,
  email,
  password,
  setEmail,
  setPassword,
  doLogin
}: AdminLoginPanelProps) {
  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <h2 className="font-display text-2xl tracking-[0.08em]">管理员登录</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLocked}
          placeholder="Email"
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLocked}
          placeholder="Password"
          type="password"
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
      <button
        type="button"
        disabled={isLocked || email.trim() === '' || password === ''}
        onClick={() => void doLogin()}
        className="mt-5 h-12 w-full rounded-2xl bg-neon text-base font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
      >
        登录
      </button>
    </section>
  );
}

