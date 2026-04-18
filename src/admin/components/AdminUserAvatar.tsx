import { useState } from 'react';

type AdminUserAvatarProps = {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  fallbackInitial?: string;
  className?: string;
};

const sizeClassMap: Record<number, string> = {
  16: 'h-4 w-4 text-[9px]',
  18: 'h-[18px] w-[18px] text-[9px]',
  20: 'h-5 w-5 text-[10px]',
  24: 'h-6 w-6 text-[11px]',
  28: 'h-7 w-7 text-xs',
  32: 'h-8 w-8 text-xs',
  36: 'h-9 w-9 text-sm',
  40: 'h-10 w-10 text-sm'
};

const getSizeClassName = (size: number) => sizeClassMap[size] ?? '';

export default function AdminUserAvatar({
  name,
  avatarUrl,
  size = 24,
  fallbackInitial = '?',
  className = ''
}: AdminUserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedAvatarUrl = String(avatarUrl ?? '').trim();
  const shouldShowImage = Boolean(normalizedAvatarUrl) && !imageFailed;

  return (
    <span
      className={[
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-slate-800/90 font-semibold uppercase text-slate-100',
        getSizeClassName(size),
        className
      ].join(' ')}
      title={name || '?'}
      aria-label={name || 'Unknown user'}
    >
      {shouldShowImage ? (
        <img
          src={normalizedAvatarUrl}
          alt={name || 'User avatar'}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span>{fallbackInitial || '?'}</span>
      )}
    </span>
  );
}
