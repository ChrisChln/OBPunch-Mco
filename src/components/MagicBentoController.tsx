import { useEffect } from 'react';
import { gsap } from 'gsap';

import './MagicBento.css';

const CARD_SELECTOR = '.magic-bento-card.particle-container';
const PARTICLE_COUNT = 12;
const DEFAULT_GLOW_COLOR = '132, 0, 255';
const MOBILE_BREAKPOINT = 768;

type BentoState = {
  isHovered: boolean;
  particles: HTMLDivElement[];
  templates: HTMLDivElement[];
  timeouts: number[];
  magnetismTween: gsap.core.Tween | null;
  cleanup?: () => void;
};

const stateByCard = new WeakMap<HTMLElement, BentoState>();

const getState = (card: HTMLElement) => {
  const current = stateByCard.get(card);
  if (current) return current;
  const next: BentoState = {
    isHovered: false,
    particles: [],
    templates: [],
    timeouts: [],
    magnetismTween: null,
  };
  stateByCard.set(card, next);
  return next;
};

const getGlowColor = (card: HTMLElement) => {
  const cssValue = getComputedStyle(card).getPropertyValue('--glow-color').trim();
  return cssValue || DEFAULT_GLOW_COLOR;
};

const createParticle = (x: number, y: number, glowColor: string) => {
  const particle = document.createElement('div');
  particle.className = 'magic-bento-particle';
  particle.style.left = `${x}px`;
  particle.style.top = `${y}px`;
  particle.style.setProperty('--glow-color', glowColor);
  return particle;
};

const updateCardGlowProperties = (card: HTMLElement, mouseX: number, mouseY: number, glow: number, radius: number) => {
  const rect = card.getBoundingClientRect();
  const relativeX = ((mouseX - rect.left) / rect.width) * 100;
  const relativeY = ((mouseY - rect.top) / rect.height) * 100;

  card.style.setProperty('--glow-x', `${relativeX}%`);
  card.style.setProperty('--glow-y', `${relativeY}%`);
  card.style.setProperty('--glow-intensity', glow.toString());
  card.style.setProperty('--glow-radius', `${radius}px`);
};

const initializeParticles = (card: HTMLElement) => {
  const state = getState(card);
  if (state.templates.length > 0) return;

  const { width, height } = card.getBoundingClientRect();
  const glowColor = getGlowColor(card);
  state.templates = Array.from({ length: PARTICLE_COUNT }, () => createParticle(Math.random() * width, Math.random() * height, glowColor));
};

const clearParticles = (card: HTMLElement) => {
  const state = getState(card);
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

const animateParticles = (card: HTMLElement) => {
  const state = getState(card);
  if (!state.isHovered) return;

  initializeParticles(card);
  state.templates.forEach((template, index) => {
    const timeoutId = window.setTimeout(() => {
      if (!state.isHovered || !card.isConnected) return;

      const particle = template.cloneNode(true) as HTMLDivElement;
      card.appendChild(particle);
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

const bindCard = (card: HTMLElement) => {
  const state = getState(card);
  if (state.cleanup) return;

  const disableAnimations = window.innerWidth <= MOBILE_BREAKPOINT;
  const glowRadius = card.classList.contains('magic-bento-card--compact') ? 180 : 300;

  const handleMouseEnter = () => {
    if (disableAnimations) return;
    state.isHovered = true;
    animateParticles(card);
    gsap.to(card, {
      rotateX: 5,
      rotateY: 5,
      duration: 0.3,
      ease: 'power2.out',
      transformPerspective: 1000,
    });
  };

  const handleMouseLeave = () => {
    state.isHovered = false;
    card.style.setProperty('--glow-intensity', '0');
    clearParticles(card);
    gsap.to(card, {
      x: 0,
      y: 0,
      rotateX: 0,
      rotateY: 0,
      duration: 0.3,
      ease: 'power2.out',
    });
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (disableAnimations) return;
    updateCardGlowProperties(card, event.clientX, event.clientY, 1, glowRadius);

    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -10;
    const rotateY = ((x - centerX) / centerX) * 10;
    const magnetX = (x - centerX) * 0.05;
    const magnetY = (y - centerY) * 0.05;

    gsap.to(card, {
      rotateX,
      rotateY,
      duration: 0.1,
      ease: 'power2.out',
      transformPerspective: 1000,
    });
    state.magnetismTween = gsap.to(card, {
      x: magnetX,
      y: magnetY,
      duration: 0.3,
      ease: 'power2.out',
    });
  };

  const handleClick = (event: MouseEvent) => {
    if (disableAnimations) return;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const maxDistance = Math.max(
      Math.hypot(x, y),
      Math.hypot(x - rect.width, y),
      Math.hypot(x, y - rect.height),
      Math.hypot(x - rect.width, y - rect.height)
    );
    const ripple = document.createElement('div');
    const glowColor = getGlowColor(card);
    ripple.style.cssText = `
      position: absolute;
      width: ${maxDistance * 2}px;
      height: ${maxDistance * 2}px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(${glowColor}, 0.4) 0%, rgba(${glowColor}, 0.2) 30%, transparent 70%);
      left: ${x - maxDistance}px;
      top: ${y - maxDistance}px;
      pointer-events: none;
      z-index: 1000;
    `;

    card.appendChild(ripple);
    gsap.fromTo(
      ripple,
      { scale: 0, opacity: 1 },
      { scale: 1, opacity: 0, duration: 0.8, ease: 'power2.out', onComplete: () => ripple.remove() }
    );
  };

  card.addEventListener('mouseenter', handleMouseEnter);
  card.addEventListener('mouseleave', handleMouseLeave);
  card.addEventListener('mousemove', handleMouseMove);
  card.addEventListener('click', handleClick);

  state.cleanup = () => {
    state.isHovered = false;
    card.removeEventListener('mouseenter', handleMouseEnter);
    card.removeEventListener('mouseleave', handleMouseLeave);
    card.removeEventListener('mousemove', handleMouseMove);
    card.removeEventListener('click', handleClick);
    clearParticles(card);
  };
};

const bindCards = (root: ParentNode = document) => {
  root.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach(bindCard);
};

export default function MagicBentoController() {
  useEffect(() => {
    bindCards();

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node instanceof HTMLElement && node.matches(CARD_SELECTOR)) bindCard(node);
          bindCards(node);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((card) => {
        getState(card).cleanup?.();
      });
    };
  }, []);

  return null;
}
