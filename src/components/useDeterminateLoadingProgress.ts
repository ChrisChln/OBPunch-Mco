import { useEffect, useState } from 'react';

type DeterminateLoadingProgressOptions = {
  progress?: number | null;
  hideDelayMs?: number;
};

export const clampProgress = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export const useDeterminateLoadingProgress = (
  visible: boolean,
  { progress = null, hideDelayMs = 180 }: DeterminateLoadingProgressOptions = {}
) => {
  const [renderVisible, setRenderVisible] = useState(visible);
  const [autoProgress, setAutoProgress] = useState(0);
  const hasProgress = typeof progress === 'number' && Number.isFinite(progress);

  useEffect(() => {
    if (visible) {
      setRenderVisible(true);
      setAutoProgress(0);
      return undefined;
    }

    setAutoProgress(100);
    const timer = window.setTimeout(() => {
      setRenderVisible(false);
    }, hideDelayMs);
    return () => window.clearTimeout(timer);
  }, [hideDelayMs, visible]);

  useEffect(() => {
    if (!visible || hasProgress) return undefined;

    const timer = window.setInterval(() => {
      setAutoProgress((current) => {
        if (current >= 95) return current;
        const step = current < 35 ? 8 : current < 70 ? 5 : 2;
        return Math.min(95, current + step);
      });
    }, 220);

    return () => window.clearInterval(timer);
  }, [hasProgress, visible]);

  return {
    renderVisible,
    progressValue: !visible ? 100 : hasProgress ? clampProgress(progress) : autoProgress
  };
};
