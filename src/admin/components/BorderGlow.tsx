import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import './BorderGlow.css';

type BorderGlowProps = {
  children?: ReactNode;
  className?: string;
  edgeSensitivity?: number;
  glowColor?: string;
  backgroundColor?: string;
  borderRadius?: number;
  glowRadius?: number;
  glowIntensity?: number;
  coneSpread?: number;
  animated?: boolean;
  autoRotate?: boolean;
  rotateDuration?: number;
  colors?: string[];
  fillOpacity?: number;
  staticGlow?: boolean;
  interactive?: boolean;
  cssAutoRotate?: boolean;
};

const parseHsl = (hslStr: string): { h: number; s: number; l: number } => {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  if (!match) return { h: 40, s: 80, l: 80 };
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
};

const buildGlowVars = (glowColor: string, intensity: number): Record<string, string> => {
  const { h, s, l } = parseHsl(glowColor);
  const base = `${h}deg ${s}% ${l}%`;
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
  const vars: Record<string, string> = {};

  for (let index = 0; index < opacities.length; index += 1) {
    vars[`--glow-color${keys[index]}`] = `hsl(${base} / ${Math.min(opacities[index] * intensity, 100)}%)`;
  }

  return vars;
};

const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
const GRADIENT_KEYS = ['--gradient-one', '--gradient-two', '--gradient-three', '--gradient-four', '--gradient-five', '--gradient-six', '--gradient-seven'];
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];
const DEFAULT_COLORS = ['#c084fc', '#f472b6', '#38bdf8'];
const AUTO_ROTATE_FRAME_INTERVAL = 1000 / 24;

const buildGradientVars = (colors: string[]): Record<string, string> => {
  const safeColors = colors.length ? colors : ['#c084fc', '#f472b6', '#38bdf8'];
  const vars: Record<string, string> = {};

  for (let index = 0; index < 7; index += 1) {
    const color = safeColors[Math.min(COLOR_MAP[index], safeColors.length - 1)];
    vars[GRADIENT_KEYS[index]] = `radial-gradient(at ${GRADIENT_POSITIONS[index]}, ${color} 0px, transparent 50%)`;
  }

  vars['--gradient-base'] = `linear-gradient(${safeColors[0]} 0 100%)`;
  return vars;
};

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInCubic = (x: number) => x * x * x;

type AutoRotateEntry = {
  el: HTMLDivElement;
  duration: number;
  offset: number;
  active: boolean;
  lastAngle: string;
};

const autoRotateEntries = new Set<AutoRotateEntry>();
const autoRotateEntryByElement = new WeakMap<Element, AutoRotateEntry>();
let autoRotateFrame = 0;
let autoRotateLastUpdate = 0;
let autoRotateObserver: IntersectionObserver | null = null;
let cssAutoRotateObserver: IntersectionObserver | null = null;

const setCssAutoRotateActive = (el: Element, active: boolean) => {
  el.classList.toggle('sweep-active', active);
  el.classList.toggle('border-glow-css-rotate', active);
};

const ensureCssAutoRotateObserver = () => {
  if (cssAutoRotateObserver || typeof IntersectionObserver === 'undefined') return cssAutoRotateObserver;
  cssAutoRotateObserver = new IntersectionObserver(
    (entries) => {
      for (const item of entries) {
        setCssAutoRotateActive(item.target, item.isIntersecting);
      }
    },
    { root: null, rootMargin: '48px', threshold: 0 }
  );
  return cssAutoRotateObserver;
};

const ensureAutoRotateObserver = () => {
  if (autoRotateObserver || typeof IntersectionObserver === 'undefined') return autoRotateObserver;
  autoRotateObserver = new IntersectionObserver(
    (entries) => {
      let hasActiveEntry = false;
      for (const item of entries) {
        const entry = autoRotateEntryByElement.get(item.target);
        if (!entry) continue;
        entry.active = item.isIntersecting;
        if (entry.active) hasActiveEntry = true;
      }
      if (hasActiveEntry) startAutoRotateLoop();
    },
    { root: null, rootMargin: '96px', threshold: 0 }
  );
  return autoRotateObserver;
};

const stopAutoRotateLoop = () => {
  if (!autoRotateFrame) return;
  cancelAnimationFrame(autoRotateFrame);
  autoRotateFrame = 0;
};

const runAutoRotateLoop = (time: number) => {
  if (document.visibilityState === 'hidden' || autoRotateEntries.size === 0) {
    stopAutoRotateLoop();
    return;
  }

  if (time - autoRotateLastUpdate < AUTO_ROTATE_FRAME_INTERVAL) {
    autoRotateFrame = requestAnimationFrame(runAutoRotateLoop);
    return;
  }
  autoRotateLastUpdate = time;

  let hasUpdated = false;
  for (const entry of autoRotateEntries) {
    if (!entry.active || !entry.el.isConnected) continue;
    hasUpdated = true;
    const progress = ((time + entry.offset) % entry.duration) / entry.duration;
    const nextAngle = `${(progress * 360).toFixed(2)}deg`;
    if (nextAngle === entry.lastAngle) continue;
    entry.lastAngle = nextAngle;
    entry.el.style.setProperty('--edge-proximity', '100');
    entry.el.style.setProperty('--cursor-angle', nextAngle);
  }

  autoRotateFrame = hasUpdated ? requestAnimationFrame(runAutoRotateLoop) : 0;
};

const startAutoRotateLoop = () => {
  if (autoRotateFrame || autoRotateEntries.size === 0 || document.visibilityState === 'hidden') return;
  autoRotateFrame = requestAnimationFrame(runAutoRotateLoop);
};

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopAutoRotateLoop();
    else startAutoRotateLoop();
  });
}

type AnimateOptions = {
  start?: number;
  end?: number;
  duration?: number;
  delay?: number;
  ease?: (t: number) => number;
  onUpdate: (value: number) => void;
  onEnd?: () => void;
};

const animateValue = ({
  start = 0,
  end = 100,
  duration = 1000,
  delay = 0,
  ease = easeOutCubic,
  onUpdate,
  onEnd
}: AnimateOptions) => {
  const startTime = performance.now() + delay;

  const tick = () => {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    onUpdate(start + (end - start) * ease(progress));
    if (progress < 1) requestAnimationFrame(tick);
    else onEnd?.();
  };

  window.setTimeout(() => requestAnimationFrame(tick), delay);
};

export default function BorderGlow({
  children,
  className = '',
  edgeSensitivity = 30,
  glowColor = '40 80 80',
  backgroundColor = '#120F17',
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1,
  coneSpread = 25,
  animated = false,
  autoRotate = false,
  rotateDuration = 4200,
  colors = DEFAULT_COLORS,
  fillOpacity = 0.5,
  staticGlow = false,
  interactive = true,
  cssAutoRotate = true
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const rotateDelayRef = useRef(-Math.random() * Math.max(rotateDuration, 1000));
  const staticAngleRef = useRef(`${Math.round(Math.random() * 360)}deg`);
  const staticArcRef = useRef(`${48 + Math.round(Math.random() * 22)}deg`);
  const staticSparkRef = useRef((0.88 + Math.random() * 0.28).toFixed(2));
  const styleVars = useMemo(
    () =>
      ({
        '--card-bg': backgroundColor,
        '--edge-sensitivity': edgeSensitivity,
        '--border-radius': `${borderRadius}px`,
        '--glow-padding': `${glowRadius}px`,
        '--cone-spread': coneSpread,
        '--fill-opacity': fillOpacity,
        '--border-glow-rotate-duration': `${Math.max(rotateDuration, 1000)}ms`,
        '--border-glow-rotate-delay': `${rotateDelayRef.current}ms`,
        '--border-glow-static-angle': staticAngleRef.current,
        '--border-glow-static-arc': staticArcRef.current,
        '--border-glow-static-spark': staticSparkRef.current,
        ...buildGlowVars(glowColor, glowIntensity),
        ...buildGradientVars(colors)
      }) as CSSProperties,
    [backgroundColor, borderRadius, colors, coneSpread, edgeSensitivity, fillOpacity, glowColor, glowIntensity, glowRadius, rotateDuration]
  );

  const getCenterOfElement = useCallback((el: HTMLElement) => {
    const { width, height } = el.getBoundingClientRect();
    return [width / 2, height / 2] as const;
  }, []);

  const getEdgeProximity = useCallback(
    (el: HTMLElement, x: number, y: number) => {
      const [centerX, centerY] = getCenterOfElement(el);
      const dx = x - centerX;
      const dy = y - centerY;
      const kx = dx === 0 ? Infinity : centerX / Math.abs(dx);
      const ky = dy === 0 ? Infinity : centerY / Math.abs(dy);
      return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    },
    [getCenterOfElement]
  );

  const getCursorAngle = useCallback(
    (el: HTMLElement, x: number, y: number) => {
      const [centerX, centerY] = getCenterOfElement(el);
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx === 0 && dy === 0) return 0;
      const degrees = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      return degrees < 0 ? degrees + 360 : degrees;
    },
    [getCenterOfElement]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const card = cardRef.current;
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const edge = getEdgeProximity(card, x, y);
      const angle = getCursorAngle(card, x, y);

      card.style.setProperty('--edge-proximity', `${(edge * 100).toFixed(3)}`);
      card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
    },
    [getCursorAngle, getEdgeProximity]
  );

  useEffect(() => {
    if (staticGlow || !animated || !cardRef.current) return;
    const card = cardRef.current;
    const angleStart = 110;
    const angleEnd = 465;
    card.classList.add('sweep-active');
    card.style.setProperty('--cursor-angle', `${angleStart}deg`);

    animateValue({ duration: 500, onUpdate: (value) => card.style.setProperty('--edge-proximity', `${value}`) });
    animateValue({
      ease: easeInCubic,
      duration: 1500,
      end: 50,
      onUpdate: (value) => {
        card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (value / 100) + angleStart}deg`);
      }
    });
    animateValue({
      ease: easeOutCubic,
      delay: 1500,
      duration: 2250,
      start: 50,
      end: 100,
      onUpdate: (value) => {
        card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (value / 100) + angleStart}deg`);
      }
    });
    animateValue({
      ease: easeInCubic,
      delay: 2500,
      duration: 1500,
      start: 100,
      end: 0,
      onUpdate: (value) => card.style.setProperty('--edge-proximity', `${value}`),
      onEnd: () => card.classList.remove('sweep-active')
    });
  }, [animated, staticGlow]);

  useEffect(() => {
    if (staticGlow || !autoRotate || !cardRef.current) return;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (prefersReducedMotion) return;
    if (cssAutoRotate) {
      const card = cardRef.current;
      const observer = ensureCssAutoRotateObserver();
      if (observer) {
        observer.observe(card);
      } else {
        setCssAutoRotateActive(card, true);
      }
      return () => {
        observer?.unobserve(card);
        setCssAutoRotateActive(card, false);
      };
    }

    const card = cardRef.current;
    const duration = Math.max(rotateDuration, 1000);
    const entry: AutoRotateEntry = {
      el: card,
      duration,
      offset: Math.random() * duration,
      active: true,
      lastAngle: ''
    };
    const observer = ensureAutoRotateObserver();

    autoRotateEntries.add(entry);
    autoRotateEntryByElement.set(card, entry);
    card.classList.add('sweep-active');
    card.style.setProperty('--edge-proximity', '100');
    observer?.observe(card);
    startAutoRotateLoop();

    return () => {
      observer?.unobserve(card);
      autoRotateEntries.delete(entry);
      autoRotateEntryByElement.delete(card);
      card.classList.remove('sweep-active');
      card.style.setProperty('--edge-proximity', '0');
      if (autoRotateEntries.size === 0) stopAutoRotateLoop();
    };
  }, [autoRotate, cssAutoRotate, rotateDuration, staticGlow]);

  return (
    <div
      ref={cardRef}
      onPointerMove={staticGlow || !interactive ? undefined : handlePointerMove}
      className={`border-glow-card${staticGlow ? ' border-glow-static' : ''} ${className}`}
      style={styleVars}
    >
      {staticGlow ? null : <span className="edge-light" />}
      <div className="border-glow-inner">{children}</div>
    </div>
  );
}
