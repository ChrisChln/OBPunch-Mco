import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import './GooeyNav.css';

export type GooeyNavItem = {
  label: string;
  href?: string;
  disabled?: boolean;
  icon?: ReactNode;
  rightSlot?: ReactNode;
  onClick?: () => void | Promise<void>;
};

type Particle = {
  start: [number, number];
  end: [number, number];
  time: number;
  scale: number;
  color: number;
  rotate: number;
};

type GooeyNavProps = {
  items: GooeyNavItem[];
  animationTime?: number;
  particleCount?: number;
  particleDistances?: [number, number];
  particleR?: number;
  timeVariance?: number;
  colors?: number[];
  initialActiveIndex?: number;
  activeIndex?: number;
  className?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  ariaLabel?: string;
};

export default function GooeyNav({
  items,
  animationTime = 600,
  particleCount = 15,
  particleDistances = [90, 10],
  particleR = 100,
  timeVariance = 300,
  colors = [1, 2, 3, 1, 2, 3, 1, 4],
  initialActiveIndex = 0,
  activeIndex: controlledActiveIndex,
  className = '',
  itemClassName = '',
  activeItemClassName = '',
  ariaLabel,
}: GooeyNavProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLUListElement | null>(null);
  const filterRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const previousActiveIndexRef = useRef(initialActiveIndex);
  const suppressNextControlledAnimationRef = useRef(false);
  const [internalActiveIndex, setInternalActiveIndex] = useState(initialActiveIndex);
  const activeIndex = controlledActiveIndex ?? internalActiveIndex;

  const noise = (n = 1) => n / 2 - Math.random() * n;

  const getXY = (distance: number, pointIndex: number, totalPoints: number): [number, number] => {
    const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
    return [distance * Math.cos(angle), distance * Math.sin(angle)];
  };

  const createParticle = (i: number, t: number, d: [number, number], r: number): Particle => {
    const rotate = noise(r / 10);
    return {
      start: getXY(d[0], particleCount - i, particleCount),
      end: getXY(d[1] + noise(7), particleCount - i, particleCount),
      time: t,
      scale: 1 + noise(0.2),
      color: colors[Math.floor(Math.random() * colors.length)] ?? 1,
      rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10,
    };
  };

  const makeParticles = (element: HTMLSpanElement) => {
    const bubbleTime = animationTime * 2 + timeVariance;
    element.style.setProperty('--time', `${bubbleTime}ms`);

    for (let i = 0; i < particleCount; i += 1) {
      const t = animationTime * 2 + noise(timeVariance * 2);
      const p = createParticle(i, t, particleDistances, particleR);
      element.classList.remove('active');

      window.setTimeout(() => {
        const particle = document.createElement('span');
        const point = document.createElement('span');
        particle.classList.add('particle');
        particle.style.setProperty('--start-x', `${p.start[0]}px`);
        particle.style.setProperty('--start-y', `${p.start[1]}px`);
        particle.style.setProperty('--end-x', `${p.end[0]}px`);
        particle.style.setProperty('--end-y', `${p.end[1]}px`);
        particle.style.setProperty('--time', `${p.time}ms`);
        particle.style.setProperty('--scale', `${p.scale}`);
        particle.style.setProperty('--color', `var(--color-${p.color}, white)`);
        particle.style.setProperty('--rotate', `${p.rotate}deg`);

        point.classList.add('point');
        particle.appendChild(point);
        element.appendChild(particle);
        requestAnimationFrame(() => {
          element.classList.add('active');
        });
        window.setTimeout(() => {
          particle.remove();
        }, t);
      }, 30);
    }
  };

  const updateEffectPosition = (element: HTMLElement) => {
    if (!containerRef.current || !filterRef.current || !textRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const pos = element.getBoundingClientRect();
    const styles = {
      left: `${pos.x - containerRect.x}px`,
      top: `${pos.y - containerRect.y}px`,
      width: `${pos.width}px`,
      height: `${pos.height}px`,
    };
    Object.assign(filterRef.current.style, styles);
    Object.assign(textRef.current.style, styles);
    textRef.current.textContent = element.innerText;
  };

  const playAnimation = (element: HTMLElement) => {
    updateEffectPosition(element);

    if (filterRef.current) {
      filterRef.current.querySelectorAll('.particle').forEach((particle) => particle.remove());
    }

    if (textRef.current) {
      textRef.current.classList.remove('active');
      void textRef.current.offsetWidth;
      textRef.current.classList.add('active');
    }

    if (filterRef.current) {
      makeParticles(filterRef.current);
    }
  };

  const handleClick = (event: MouseEvent<HTMLElement>, index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    const liEl = event.currentTarget.closest('li');
    if (!liEl) return;

    if (!item.href) {
      event.preventDefault();
    }

    setInternalActiveIndex(index);
    if (controlledActiveIndex === undefined) {
      playAnimation(liEl);
    } else {
      suppressNextControlledAnimationRef.current = true;
      playAnimation(liEl);
    }
    void item.onClick?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const item = items[index];
    const liEl = event.currentTarget.closest('li');
    if (!item || item.disabled || !liEl) return;
    setInternalActiveIndex(index);
    if (controlledActiveIndex === undefined) {
      playAnimation(liEl);
    } else {
      suppressNextControlledAnimationRef.current = true;
      playAnimation(liEl);
    }
    void item.onClick?.();
  };

  useEffect(() => {
    if (!navRef.current || !containerRef.current) return undefined;
    const activeLi = navRef.current.querySelectorAll('li')[activeIndex];
    if (activeLi instanceof HTMLElement) {
      const activeIndexChanged = previousActiveIndexRef.current !== activeIndex;
      if (controlledActiveIndex !== undefined && activeIndexChanged) {
        if (suppressNextControlledAnimationRef.current) {
          updateEffectPosition(activeLi);
          suppressNextControlledAnimationRef.current = false;
        } else {
          playAnimation(activeLi);
        }
      } else {
        updateEffectPosition(activeLi);
        textRef.current?.classList.add('active');
      }
      previousActiveIndexRef.current = activeIndex;
    }

    const resizeObserver = new ResizeObserver(() => {
      const currentActiveLi = navRef.current?.querySelectorAll('li')[activeIndex];
      if (currentActiveLi instanceof HTMLElement) {
        updateEffectPosition(currentActiveLi);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [activeIndex]);

  return (
    <div className={['gooey-nav-container', className].filter(Boolean).join(' ')} ref={containerRef}>
      <nav aria-label={ariaLabel}>
        <ul ref={navRef}>
          {items.map((item, index) => {
            const active = activeIndex === index;
            const liClassName = [active ? 'active' : '', itemClassName, active ? activeItemClassName : ''].filter(Boolean).join(' ');
            const content = (
              <>
                {item.icon ? <span className="gooey-nav-icon">{item.icon}</span> : null}
                <span className="gooey-nav-label">{item.label}</span>
                {item.rightSlot ? <span className="gooey-nav-right-slot">{item.rightSlot}</span> : null}
              </>
            );

            return (
              <li key={`${item.label}-${index}`} className={liClassName} aria-disabled={item.disabled || undefined}>
                {item.href ? (
                  <a href={item.href} onClick={(event) => handleClick(event, index)} onKeyDown={(event) => handleKeyDown(event, index)}>
                    {content}
                  </a>
                ) : (
                  <button type="button" disabled={item.disabled} onClick={(event) => handleClick(event, index)} onKeyDown={(event) => handleKeyDown(event, index)}>
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <span className="effect filter" ref={filterRef} />
      <span className="effect text" ref={textRef} />
    </div>
  );
}
