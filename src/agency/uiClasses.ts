export const agencyInputClass =
  'h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-[#9eff00]';

const agencyActionButtonBaseClass =
  'agency-action-button inline-flex h-10 min-w-[84px] items-center justify-center rounded-2xl px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#9eff00]/35 focus:ring-offset-2 focus:ring-offset-[#06090a] disabled:cursor-not-allowed disabled:opacity-55';

export const agencyButtonClass =
  `${agencyActionButtonBaseClass} border border-white/10 bg-white/[0.06] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-white/20 hover:bg-white/[0.1] disabled:hover:border-white/10 disabled:hover:bg-white/[0.06]`;

export const agencyPrimaryButtonClass =
  `${agencyActionButtonBaseClass} obp-primary-button border border-[#9eff00]/70 bg-[#9eff00] text-slate-950 shadow-[0_0_0_1px_rgba(158,255,0,0.16),0_14px_32px_rgba(158,255,0,0.22)] hover:bg-[#b6ff33] hover:shadow-[0_18px_40px_rgba(158,255,0,0.3)] disabled:border-white/[0.14] disabled:bg-white/[0.09] disabled:text-slate-300 disabled:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`;
