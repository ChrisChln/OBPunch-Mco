import type { ReactNode } from 'react';

import type { LabelToneKey } from '../lib/labelTone';
import BorderGlow from '../admin/components/BorderGlow';

type GlowLabelChipProps = {
  children: ReactNode;
  tone?: LabelToneKey;
  className?: string;
  title?: string;
  static?: boolean;
};

const GLOW_THEME: Record<LabelToneKey, { glowColor: string; colors: [string, string, string] }> = {
  sky: { glowColor: '199 95 74', colors: ['#38bdf8', '#7dd3fc', '#0ea5e9'] },
  cyan: { glowColor: '188 90 70', colors: ['#22d3ee', '#67e8f9', '#0891b2'] },
  teal: { glowColor: '174 80 64', colors: ['#2dd4bf', '#5eead4', '#0f766e'] },
  emerald: { glowColor: '151 78 62', colors: ['#34d399', '#86efac', '#059669'] },
  lime: { glowColor: '84 86 66', colors: ['#a3e635', '#bef264', '#65a30d'] },
  amber: { glowColor: '43 96 66', colors: ['#fbbf24', '#fde68a', '#d97706'] },
  orange: { glowColor: '28 96 65', colors: ['#fb923c', '#fdba74', '#ea580c'] },
  rose: { glowColor: '347 92 70', colors: ['#fb7185', '#fda4af', '#e11d48'] },
  fuchsia: { glowColor: '292 86 72', colors: ['#e879f9', '#f0abfc', '#c026d3'] },
  violet: { glowColor: '258 90 74', colors: ['#a78bfa', '#c4b5fd', '#7c3aed'] },
  indigo: { glowColor: '239 86 74', colors: ['#818cf8', '#a5b4fc', '#4f46e5'] },
  slate: { glowColor: '215 28 74', colors: ['#94a3b8', '#cbd5e1', '#64748b'] }
};

const GLOW_BACKGROUND: Record<LabelToneKey, string> = {
  sky: '#071421',
  cyan: '#06161d',
  teal: '#061917',
  emerald: '#06180f',
  lime: '#111707',
  amber: '#1b1305',
  orange: '#1b1007',
  rose: '#1b0a12',
  fuchsia: '#190b1b',
  violet: '#120d1f',
  indigo: '#0d1022',
  slate: '#111827'
};

const TEXT_CLASS: Record<LabelToneKey, string> = {
  sky: 'text-slate-100',
  cyan: 'text-slate-100',
  teal: 'text-slate-100',
  emerald: 'text-slate-100',
  lime: 'text-slate-100',
  amber: 'text-slate-100',
  orange: 'text-slate-100',
  rose: 'text-slate-100',
  fuchsia: 'text-slate-100',
  violet: 'text-slate-100',
  indigo: 'text-slate-100',
  slate: 'text-slate-100'
};

export const getGlowToneForPosition = (value: string): LabelToneKey => {
  const key = String(value ?? '').trim().toLowerCase();
  if (key === 'pick') return 'sky';
  if (key === 'pack') return 'rose';
  if (key === 'rebin' || key === 'receive') return 'emerald';
  if (key === 'inventory') return 'indigo';
  if (key === 'preship' || key === 'putaway' || key === 'shipping') return 'amber';
  if (key === 'transfer' || key === 'load') return 'violet';
  return 'slate';
};

export const getGlowToneForShift = (value: string): LabelToneKey => {
  const key = String(value ?? '').trim().toLowerCase();
  if (key === 'early' || key === 'morning') return 'amber';
  if (key === 'late' || key === 'night') return 'indigo';
  return 'slate';
};

export const getGlowToneForPunch = (value: string): LabelToneKey => {
  const key = String(value ?? '').trim().toUpperCase();
  if (key === 'IN') return 'teal';
  if (key === 'OUT') return 'sky';
  return 'slate';
};

export default function GlowLabelChip({ children, tone = 'slate', className = '', title, static: useStatic = false }: GlowLabelChipProps) {
  const glowTheme = GLOW_THEME[tone] ?? GLOW_THEME.slate;
  if (useStatic) {
    return (
      <span
        className={[
          'inline-flex items-center justify-center rounded-full border px-2.5 py-[5px] text-[10px] font-semibold leading-none',
          TEXT_CLASS[tone] ?? TEXT_CLASS.slate,
          className
        ].join(' ')}
        style={{
          backgroundColor: GLOW_BACKGROUND[tone] ?? GLOW_BACKGROUND.slate,
          borderColor: glowTheme.colors[0],
          boxShadow: `inset 0 0 0 1px rgb(255 255 255 / 4%), 0 0 8px ${glowTheme.colors[0]}55`
        }}
        title={title}
      >
        {children}
      </span>
    );
  }

  return (
    <BorderGlow
      className="admin-position-badge-glow admin-schedule-badge-glow"
      edgeSensitivity={30}
      glowColor={glowTheme.glowColor}
      backgroundColor={GLOW_BACKGROUND[tone] ?? GLOW_BACKGROUND.slate}
      borderRadius={999}
      glowRadius={18}
      glowIntensity={1}
      coneSpread={25}
      interactive={false}
      rotateDuration={4200}
      colors={glowTheme.colors}
      fillOpacity={0.5}
    >
      <span
        className={[
          'inline-flex items-center justify-center rounded-full px-2.5 py-[5px] text-[10px] font-semibold leading-none',
          TEXT_CLASS[tone] ?? TEXT_CLASS.slate,
          className
        ].join(' ')}
        title={title}
      >
        {children}
      </span>
    </BorderGlow>
  );
}
