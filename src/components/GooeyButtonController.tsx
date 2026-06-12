import { useEffect } from 'react';

import '../admin/components/GooeyNav.css';

const BUTTON_SELECTOR = 'button:not([data-gooey-skip])';
const SKIP_CONTAINER_SELECTOR = '.gooey-nav-container';
const CHIP_CLASS_HINTS = ['text-[10px]', 'text-[11px]', 'px-1', 'px-1.5', 'py-0.5'];
const MENU_CONTAINER_SELECTOR = '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';
const PARTICLE_COUNT = 10;
const RIPPLE_TIME = 560;

type ParticleConfig = {
  x: number;
  y: number;
  moveX: number;
  moveY: number;
  scale: number;
};

const createParticle = (x: number, y: number): ParticleConfig => {
  const angle = Math.random() * Math.PI * 2;
  const distance = 18 + Math.random() * 36;
  return {
    x,
    y,
    moveX: Math.cos(angle) * distance,
    moveY: Math.sin(angle) * distance,
    scale: 1 + noise(0.2),
  };
};

const noise = (n = 1) => n / 2 - Math.random() * n;

const shouldStyleButton = (button: HTMLButtonElement) => {
  if (button.closest(SKIP_CONTAINER_SELECTOR)) return false;
  if (button.closest(MENU_CONTAINER_SELECTOR)) return false;
  if (button.closest('[data-gooey-skip="true"], [data-magic-button-skip="true"]')) return false;
  if (button.dataset.gooeySkip === 'true') return false;
  const className = button.className;
  const classText = typeof className === 'string' ? className : '';
  const isSmallChip = CHIP_CLASS_HINTS.some((hint) => classText.includes(hint));
  if (button.closest('table') && isSmallChip) return false;
  if (button.closest('.absolute') && (classText.includes('w-full') || classText.includes('text-left'))) return false;
  return true;
};

const applyButtonClass = (root: ParentNode = document) => {
  root.querySelectorAll<HTMLButtonElement>(BUTTON_SELECTOR).forEach((button) => {
    if (shouldStyleButton(button)) {
      button.classList.add('gooey-button-auto');
    } else {
      button.classList.remove('gooey-button-auto', 'gooey-button-animating');
      button.querySelectorAll(':scope > .gooey-button-particle, :scope > .gooey-button-ripple').forEach((effect) => effect.remove());
    }
  });
};

const updatePointerGlow = (button: HTMLButtonElement, clientX: number, clientY: number) => {
  const rect = button.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  button.style.setProperty('--magic-x', `${x}%`);
  button.style.setProperty('--magic-y', `${y}%`);
};

const playButtonAnimation = (button: HTMLButtonElement, event: PointerEvent) => {
  if (!shouldStyleButton(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return;

  button.classList.remove('gooey-button-animating');
  button.querySelectorAll(':scope > .gooey-button-particle, :scope > .gooey-button-ripple').forEach((effect) => effect.remove());
  void button.offsetWidth;
  button.classList.add('gooey-button-animating');
  updatePointerGlow(button, event.clientX, event.clientY);

  const rect = button.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;
  const ripple = document.createElement('span');
  ripple.classList.add('gooey-button-ripple');
  ripple.style.setProperty('--ripple-x', `${clickX}px`);
  ripple.style.setProperty('--ripple-y', `${clickY}px`);
  button.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), RIPPLE_TIME);

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const particleConfig = createParticle(clickX, clickY);

    window.setTimeout(() => {
      const particle = document.createElement('span');
      particle.classList.add('gooey-button-particle');
      particle.style.setProperty('--particle-x', `${particleConfig.x}px`);
      particle.style.setProperty('--particle-y', `${particleConfig.y}px`);
      particle.style.setProperty('--move-x', `${particleConfig.moveX}px`);
      particle.style.setProperty('--move-y', `${particleConfig.moveY}px`);
      particle.style.setProperty('--scale', `${particleConfig.scale}`);
      button.appendChild(particle);
      window.setTimeout(() => particle.remove(), 760);
    }, index * 24);
  }

  window.setTimeout(() => {
    button.classList.remove('gooey-button-animating');
  }, RIPPLE_TIME);
};

export default function GooeyButtonController() {
  useEffect(() => {
    applyButtonClass();

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node instanceof HTMLButtonElement && shouldStyleButton(node)) {
            node.classList.add('gooey-button-auto');
          }
          applyButtonClass(node);
        });
      });
    });

    const onPointerDown = (event: PointerEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(BUTTON_SELECTOR) : null;
      if (button) playButtonAnimation(button, event);
    };

    const onPointerMove = (event: PointerEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(BUTTON_SELECTOR) : null;
      if (button && shouldStyleButton(button)) updatePointerGlow(button, event.clientX, event.clientY);
    };

    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
    };
  }, []);

  return null;
}
