import { useEffect, useState } from 'react';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';

export type AmbientPeriod = 'morning' | 'afternoon' | 'evening';

const timeOfDaySources: Record<AmbientPeriod, string> = {
  morning: '/animations/morning.json',
  afternoon: '/animations/afternoon.json',
  evening: '/animations/evening.json'
};

const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return prefersReducedMotion;
};

type TimeOfDayLottieProps = {
  period: AmbientPeriod;
};

export function TimeOfDayLottie({ period }: TimeOfDayLottieProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div className={['time-of-day-lottie', `time-of-day-lottie-${period}`].join(' ')} aria-hidden="true" data-period={period}>
      {!prefersReducedMotion ? (
        <DotLottieReact
          src={timeOfDaySources[period]}
          loop
          autoplay
          className="time-of-day-lottie-player"
        />
      ) : (
        <div className="time-of-day-lottie-static" />
      )}
    </div>
  );
}
