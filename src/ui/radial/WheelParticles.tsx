/**
 * WheelParticles — canvas-based particle emitter for radial menus.
 *
 * When a sector is highlighted, particles stream outward from the
 * sector's position in a curved spiral pattern, giving the wheel a
 * "channeling energy" feel. Particles fade with age and distance.
 *
 * Implementation detail: uses a fixed-size ring buffer of particles
 * to avoid GC pressure during long hover sessions. Each particle
 * has position, velocity, age, and hue. Updated per frame via
 * requestAnimationFrame with canvas2D drawing.
 *
 * Design inspiration: Destiny inventory wheel energy tendrils,
 * Mass Effect dialogue choice highlight, Apex Legends ping emanation.
 */

import { useEffect, useRef } from 'react';

// ── Particle state ──────────────────────────────────────────────

interface Particle {
  /** Screen-space X position. */
  x: number;
  /** Screen-space Y position. */
  y: number;
  /** Velocity X (px/sec). */
  vx: number;
  /** Velocity Y (px/sec). */
  vy: number;
  /** Age in seconds since spawn. */
  age: number;
  /** Lifespan in seconds. */
  lifespan: number;
  /** Alive flag (ring buffer reuses dead slots). */
  alive: boolean;
  /** Hex color string. */
  color: string;
  /** Starting size (px). */
  size: number;
}

const MAX_PARTICLES = 240;

// ── Hot state (avoid re-subscribing on every change) ────────────

interface EmitterState {
  centerX: number;
  centerY: number;
  /** Current hover sector angle (radians, 0 = east, CCW). */
  hoverAngleRad: number;
  /** Radius at which to spawn particles (px). */
  spawnRadius: number;
  /** Sector color for particles. */
  color: string;
  /** How many particles per second. */
  emitRate: number;
  /** Whether emission is active. */
  active: boolean;
}

// ── Public API: exported so RadialMenu can drive emitter ────────

export interface WheelParticlesHandle {
  setEmitter: (state: Partial<EmitterState>) => void;
  burst: (count: number) => void;
}

interface Props {
  onReady?: (handle: WheelParticlesHandle) => void;
}

// ── Component ───────────────────────────────────────────────────

export function WheelParticles({ onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const stateRef = useRef<EmitterState>({
    centerX: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    centerY: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
    hoverAngleRad: 0,
    spawnRadius: 180,
    color: '#00e5ff',
    emitRate: 60,
    active: false,
  });
  const emitAccumulator = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Initialize particle pool
  useEffect(() => {
    const pool: Particle[] = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      pool.push({
        x: 0, y: 0, vx: 0, vy: 0,
        age: 0, lifespan: 1, alive: false,
        color: '#00e5ff', size: 2,
      });
    }
    particlesRef.current = pool;

    // Expose handle to parent
    if (onReady) {
      onReady({
        setEmitter: (s) => {
          Object.assign(stateRef.current, s);
        },
        burst: (count) => {
          for (let i = 0; i < count; i++) spawnParticle(true);
        },
      });
    }
  }, [onReady]);

  // Spawn a single particle at the current emitter position + direction
  function spawnParticle(isBurst: boolean = false): void {
    const pool = particlesRef.current;
    // Find a dead slot
    let slot = pool.find((p) => !p.alive);
    if (!slot) return; // pool full

    const st = stateRef.current;
    const angle = st.hoverAngleRad + (Math.random() - 0.5) * 0.6; // slight jitter
    const radialSpeed = 80 + Math.random() * 140;
    const tangentialSpeed = (Math.random() - 0.5) * 60;

    // Base radial direction
    const rx = Math.cos(angle);
    const ry = -Math.sin(angle); // screen Y inverted
    // Tangential direction (perpendicular)
    const tx = -ry;
    const ty = rx;

    slot.x = st.centerX + rx * st.spawnRadius;
    slot.y = st.centerY + ry * st.spawnRadius;
    slot.vx = rx * radialSpeed + tx * tangentialSpeed;
    slot.vy = ry * radialSpeed + ty * tangentialSpeed;
    slot.age = 0;
    slot.lifespan = 0.6 + Math.random() * 0.8;
    slot.alive = true;
    slot.color = st.color;
    slot.size = isBurst ? 2 + Math.random() * 3 : 1.5 + Math.random() * 2;
  }

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let lastTs = performance.now();

    const tick = (ts: number) => {
      const dt = Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;

      // Emit new particles
      const st = stateRef.current;
      if (st.active) {
        emitAccumulator.current += dt * st.emitRate;
        while (emitAccumulator.current > 1) {
          spawnParticle();
          emitAccumulator.current -= 1;
        }
      } else {
        emitAccumulator.current = 0;
      }

      // Clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Update + draw
      const pool = particlesRef.current;
      for (const p of pool) {
        if (!p.alive) continue;
        p.age += dt;
        if (p.age >= p.lifespan) {
          p.alive = false;
          continue;
        }
        // Integrate with slight drag
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.985;
        p.vy *= 0.985;

        const t = p.age / p.lifespan;
        const alpha = (1 - t) * 0.85;
        const size = p.size * (1 - t * 0.3);

        // Glow
        ctx.globalCompositeOperation = 'lighter';
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 3);
        grad.addColorStop(0, hexToRgba(p.color, alpha));
        grad.addColorStop(0.4, hexToRgba(p.color, alpha * 0.4));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2);
        ctx.fill();

        // Hard core
        ctx.fillStyle = hexToRgba(p.color, alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas ref={canvasRef} style={{
      position: 'fixed', inset: 0, zIndex: 997,
      pointerEvents: 'none',
    }} />
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
