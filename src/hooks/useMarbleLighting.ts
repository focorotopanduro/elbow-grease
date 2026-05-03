import { useEffect } from 'react';

type SceneId =
  | 'hero'
  | 'pathways'
  | 'trust'
  | 'services'
  | 'solutions'
  | 'proof'
  | 'contact';

type SceneConfig = {
  id: SceneId;
  selector: string;
  rgb: string;
  alpha: number;
  glow: number;
  depth: number;
  pointer: number;
  priority: number;
};

const SCENES: SceneConfig[] = [
  {
    id: 'hero',
    selector: '#home',
    rgb: '238, 214, 141',
    alpha: 0.052,
    glow: 0.11,
    depth: 0,
    pointer: 0.115,
    priority: 0,
  },
  {
    id: 'pathways',
    selector: '#smart-path',
    rgb: '238, 214, 141',
    alpha: 0.064,
    glow: 0.13,
    depth: 10,
    pointer: 0.13,
    priority: 2,
  },
  {
    id: 'trust',
    selector: '.trust-ledger',
    rgb: '113, 134, 91',
    alpha: 0.058,
    glow: 0.1,
    depth: 16,
    pointer: 0.1,
    priority: 2,
  },
  {
    id: 'services',
    selector: '#services',
    rgb: '38, 61, 82',
    alpha: 0.052,
    glow: 0.09,
    depth: 20,
    pointer: 0.095,
    priority: 1,
  },
  {
    id: 'solutions',
    selector: '.sg',
    rgb: '155, 63, 50',
    alpha: 0.05,
    glow: 0.09,
    depth: 18,
    pointer: 0.095,
    priority: 3,
  },
  {
    id: 'proof',
    selector: '.about, .stats, .creds, .testimonials, .faq',
    rgb: '196, 160, 68',
    alpha: 0.056,
    glow: 0.1,
    depth: 14,
    pointer: 0.105,
    priority: 1,
  },
  {
    id: 'contact',
    selector: '#contact',
    rgb: '113, 134, 91',
    alpha: 0.062,
    glow: 0.12,
    depth: 8,
    pointer: 0.11,
    priority: 4,
  },
];

const DEFAULT_SCENE = SCENES[0];

export function useMarbleLighting(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean; effectiveType?: string };
    };
    const saveData = nav.connection?.saveData === true;
    const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2;
    const lowCores = typeof navigator.hardwareConcurrency === 'number' &&
      navigator.hardwareConcurrency <= 2;
    const slowConnection = /(^2g$|^slow-2g$)/i.test(nav.connection?.effectiveType ?? '');
    const materialMode = reduceMotion || saveData || lowMemory || lowCores || slowConnection
      ? 'lite'
      : 'full';
    const canUsePointerGlow = materialMode === 'full' &&
      window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)').matches;

    root.dataset.materialMode = materialMode;

    const applyScene = (scene: SceneConfig, pointerAlpha = scene.pointer) => {
      root.dataset.scene = scene.id;
      root.style.setProperty('--scene-rgb', scene.rgb);
      root.style.setProperty('--scene-alpha', String(scene.alpha));
      root.style.setProperty('--scene-glow-alpha', String(scene.glow));
      root.style.setProperty('--scene-depth-shift', `${scene.depth}px`);
      root.style.setProperty(
        '--pointer-gold-alpha',
        canUsePointerGlow ? String(pointerAlpha) : '0',
      );
    };

    if (materialMode === 'lite') {
      root.style.setProperty('--marble-light-shift', '0px');
      root.style.setProperty('--marble-light-counter', '0px');
      root.style.setProperty('--marble-light-focus', '48%');
      root.style.setProperty('--glass-shine-shift', '0px');
      root.style.setProperty('--pointer-gold-alpha', '0');
      root.style.setProperty('--scene-alpha', '0.035');
      root.style.setProperty('--scene-glow-alpha', '0.04');
      root.style.setProperty('--scene-depth-shift', '0px');
      root.style.setProperty('--scene-rgb', DEFAULT_SCENE.rgb);
      root.dataset.scene = 'hero';
      return () => {
        delete root.dataset.materialMode;
        delete root.dataset.scene;
        root.style.removeProperty('--marble-light-shift');
        root.style.removeProperty('--marble-light-counter');
        root.style.removeProperty('--marble-light-focus');
        root.style.removeProperty('--glass-shine-shift');
        root.style.removeProperty('--pointer-gold-alpha');
        root.style.removeProperty('--scene-alpha');
        root.style.removeProperty('--scene-glow-alpha');
        root.style.removeProperty('--scene-depth-shift');
        root.style.removeProperty('--scene-rgb');
      };
    }

    const findActiveScene = () => {
      const viewportFocus = window.innerHeight * 0.46;
      let best = DEFAULT_SCENE;
      let bestScore = Number.POSITIVE_INFINITY;

      for (const scene of SCENES) {
        const elements = Array.from(document.querySelectorAll<HTMLElement>(scene.selector));
        for (const element of elements) {
          const rect = element.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
          const midpoint = rect.top + rect.height / 2;
          const visibleTop = Math.max(0, rect.top);
          const visibleBottom = Math.min(window.innerHeight, rect.bottom);
          const visibleHeight = Math.max(0, visibleBottom - visibleTop);
          const score = Math.abs(midpoint - viewportFocus) -
            Math.min(rect.height, window.innerHeight) * 0.08 -
            visibleHeight * 0.04 -
            scene.priority * 72;
          if (score < bestScore) {
            bestScore = score;
            best = scene;
          }
        }
      }

      return best;
    };

    let frame = 0;
    const update = () => {
      frame = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, window.scrollY / max));
      const scene = findActiveScene();
      applyScene(scene);
      root.style.setProperty('--marble-light-shift', `${Math.round(ratio * -48)}px`);
      root.style.setProperty('--marble-light-counter', `${Math.round(ratio * 24)}px`);
      root.style.setProperty('--marble-light-focus', `${Math.round(40 + ratio * 26)}%`);
      root.style.setProperty('--glass-shine-shift', `${Math.round(-18 + ratio * 42)}px`);
    };
    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();

    let pointerFrame = 0;
    let pointerX = Math.round(window.innerWidth * 0.62);
    let pointerY = Math.round(window.innerHeight * 0.32);
    const updatePointer = () => {
      pointerFrame = 0;
      root.style.setProperty('--pointer-x', `${pointerX}px`);
      root.style.setProperty('--pointer-y', `${pointerY}px`);
    };
    const requestPointerUpdate = (event: PointerEvent) => {
      if (!canUsePointerGlow || event.pointerType !== 'mouse') return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (pointerFrame) return;
      pointerFrame = window.requestAnimationFrame(updatePointer);
    };
    updatePointer();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    window.addEventListener('pointermove', requestPointerUpdate, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
      window.removeEventListener('pointermove', requestPointerUpdate);
      root.style.removeProperty('--marble-light-shift');
      root.style.removeProperty('--marble-light-counter');
      root.style.removeProperty('--marble-light-focus');
      root.style.removeProperty('--glass-shine-shift');
      root.style.removeProperty('--pointer-x');
      root.style.removeProperty('--pointer-y');
      root.style.removeProperty('--pointer-gold-alpha');
      root.style.removeProperty('--scene-alpha');
      root.style.removeProperty('--scene-glow-alpha');
      root.style.removeProperty('--scene-depth-shift');
      root.style.removeProperty('--scene-rgb');
      delete root.dataset.materialMode;
      delete root.dataset.scene;
    };
  }, []);
}
