import { useEffect } from 'react';
import { gsap } from 'gsap';

import '../admin/components/GooeyNav.css';

const BUTTON_SELECTOR = 'button:not([data-gooey-skip])';
const SKIP_CONTAINER_SELECTOR = '.gooey-nav-container';
const CHIP_CLASS_HINTS = ['text-[10px]', 'text-[11px]', 'px-1', 'px-1.5', 'py-0.5'];
const MENU_CONTAINER_SELECTOR = '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';
const PARTICLE_COUNT = 12;
const GLOW_COLOR = '255, 255, 255';
const MAX_RIPPLE_DIAMETER = 72;
const COMPACT_MAX_HEIGHT = 44;
const COMPACT_MAX_WIDTH = 180;

type ButtonAnimationState = {
  isHovered: boolean;
  particles: HTMLSpanElement[];
  particleTemplate: HTMLSpanElement[];
  timeouts: number[];
  magnetismTween: gsap.core.Tween | null;
};

const animationState = new WeakMap<HTMLButtonElement, ButtonAnimationState>();

const getAnimationState = (button: HTMLButtonElement): ButtonAnimationState => {
  const current = animationState.get(button);
  if (current) return current;
  const next: ButtonAnimationState = {
    isHovered: false,
    particles: [],
    particleTemplate: [],
    timeouts: [],
    magnetismTween: null,
  };
  animationState.set(button, next);
  return next;
};

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

const isCompactButton = (button: HTMLButtonElement) => {
  const rect = button.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return rect.height <= COMPACT_MAX_HEIGHT && rect.width <= COMPACT_MAX_WIDTH;

  const className = button.className;
  const classText = typeof className === 'string' ? className : '';
  return ['h-8', 'h-9', 'h-10', 'min-h-10', 'text-xs', 'px-3'].some((hint) => classText.includes(hint));
};

const applyButtonClass = (root: ParentNode = document) => {
  root.querySelectorAll<HTMLButtonElement>(BUTTON_SELECTOR).forEach((button) => {
    if (shouldStyleButton(button)) {
      button.classList.add('gooey-button-auto');
      button.style.setProperty('--magic-glow-rgb', GLOW_COLOR);
      button.classList.toggle('magic-button-compact', isCompactButton(button));
    } else {
      button.classList.remove('gooey-button-auto', 'gooey-button-animating', 'magic-button-compact');
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
  button.style.setProperty('--glow-x', `${x}%`);
  button.style.setProperty('--glow-y', `${y}%`);
  button.style.setProperty('--glow-intensity', '1');
  button.style.setProperty('--glow-radius', '120px');
};

const clearButtonParticles = (button: HTMLButtonElement) => {
  const state = getAnimationState(button);
  state.timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
  state.timeouts = [];
  state.magnetismTween?.kill();

  state.particles.forEach((particle) => {
    gsap.to(particle, {
      scale: 0,
      opacity: 0,
      duration: 0.3,
      ease: 'back.in(1.7)',
      onComplete: () => particle.remove(),
    });
  });
  state.particles = [];
};

const createParticleElement = (x: number, y: number) => {
  const particle = document.createElement('span');
  particle.className = 'gooey-button-particle';
  particle.style.left = `${x}px`;
  particle.style.top = `${y}px`;
  return particle;
};

const initializeParticles = (button: HTMLButtonElement) => {
  const state = getAnimationState(button);
  if (state.particleTemplate.length > 0) return;
  const { width, height } = button.getBoundingClientRect();
  state.particleTemplate = Array.from({ length: PARTICLE_COUNT }, () => createParticleElement(Math.random() * width, Math.random() * height));
};

const animateButtonParticles = (button: HTMLButtonElement) => {
  const state = getAnimationState(button);
  if (!state.isHovered) return;

  initializeParticles(button);
  state.particleTemplate.forEach((particleTemplate, index) => {
    const timeoutId = window.setTimeout(() => {
      if (!state.isHovered || !button.isConnected) return;

      const particle = particleTemplate.cloneNode(true) as HTMLSpanElement;
      button.appendChild(particle);
      state.particles.push(particle);

      gsap.fromTo(particle, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.7)' });
      gsap.to(particle, {
        x: (Math.random() - 0.5) * 100,
        y: (Math.random() - 0.5) * 100,
        rotation: Math.random() * 360,
        duration: 2 + Math.random() * 2,
        ease: 'none',
        repeat: -1,
        yoyo: true,
      });
      gsap.to(particle, {
        opacity: 0.3,
        duration: 1.5,
        ease: 'power2.inOut',
        repeat: -1,
        yoyo: true,
      });
    }, index * 100);
    state.timeouts.push(timeoutId);
  });
};

const handleButtonEnter = (button: HTMLButtonElement) => {
  if (!shouldStyleButton(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
  const state = getAnimationState(button);
  state.isHovered = true;
  button.classList.add('gooey-button-animating');
  if (button.classList.contains('magic-button-compact')) return;
  animateButtonParticles(button);
};

const handleButtonLeave = (button: HTMLButtonElement) => {
  const state = getAnimationState(button);
  state.isHovered = false;
  button.classList.remove('gooey-button-animating');
  button.style.setProperty('--glow-intensity', '0');
  clearButtonParticles(button);
  gsap.to(button, { x: 0, y: 0, duration: 0.3, ease: 'power2.out' });
};

const handleButtonMove = (button: HTMLButtonElement, event: PointerEvent) => {
  if (!shouldStyleButton(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
  updatePointerGlow(button, event.clientX, event.clientY);
  const rect = button.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  if (button.classList.contains('magic-button-compact')) return;
  const state = getAnimationState(button);
  state.magnetismTween = gsap.to(button, {
    x: (x - centerX) * 0.05,
    y: (y - centerY) * 0.05,
    duration: 0.3,
    ease: 'power2.out',
  });
};

const playButtonAnimation = (button: HTMLButtonElement, event: PointerEvent) => {
  if (!shouldStyleButton(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return;

  updatePointerGlow(button, event.clientX, event.clientY);

  const rect = button.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const maxDistance = Math.max(
    Math.hypot(x, y),
    Math.hypot(x - rect.width, y),
    Math.hypot(x, y - rect.height),
    Math.hypot(x - rect.width, y - rect.height)
  );
  const rippleDiameter = Math.min(maxDistance * 2, Math.max(rect.width, rect.height, MAX_RIPPLE_DIAMETER));
  const rippleRadius = rippleDiameter / 2;
  const ripple = document.createElement('span');
  ripple.className = 'gooey-button-ripple';
  ripple.style.width = `${rippleDiameter}px`;
  ripple.style.height = `${rippleDiameter}px`;
  ripple.style.left = `${x - rippleRadius}px`;
  ripple.style.top = `${y - rippleRadius}px`;
  button.appendChild(ripple);

  gsap.fromTo(
    ripple,
    { scale: 0, opacity: 1 },
    { scale: 1, opacity: 0, duration: 0.8, ease: 'power2.out', onComplete: () => ripple.remove() }
  );
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
      if (button) handleButtonMove(button, event);
    };

    const onPointerEnter = (event: PointerEvent) => {
      const button = event.target instanceof HTMLButtonElement ? event.target : null;
      if (button?.matches(BUTTON_SELECTOR)) handleButtonEnter(button);
    };

    const onPointerLeave = (event: PointerEvent) => {
      const button = event.target instanceof HTMLButtonElement ? event.target : null;
      if (button?.matches(BUTTON_SELECTOR)) handleButtonLeave(button);
    };

    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerenter', onPointerEnter, true);
    document.addEventListener('pointerleave', onPointerLeave, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerenter', onPointerEnter, true);
      document.removeEventListener('pointerleave', onPointerLeave, true);
    };
  }, []);

  return null;
}
