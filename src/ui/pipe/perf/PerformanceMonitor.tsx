/**
 * Performance Monitor — FPS counter + pipe count HUD overlay.
 *
 * Pure HTML overlay (no R3F hooks) — safe to render outside Canvas.
 */

import { useRef, useState, useEffect } from 'react';
import { usePipeStore } from '@store/pipeStore';

export function PerformanceMonitor() {
  const pipeCount = usePipeStore((s) => Object.keys(s.pipes).length);
  const [fps, setFps] = useState(60);
  const frames = useRef(0);
  const lastTime = useRef(performance.now());

  useEffect(() => {
    let raf: number;
    const tick = () => {
      frames.current++;
      const now = performance.now();
      if (now - lastTime.current >= 1000) {
        setFps(frames.current);
        frames.current = 0;
        lastTime.current = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (pipeCount === 0) return null;

  const fpsColor = fps >= 55 ? '#00e676' : fps >= 30 ? '#ffc107' : '#ff1744';

  return (
    <div style={{
      position: 'absolute',
      top: 50,
      left: 16,
      display: 'flex',
      alignItems: 'baseline',
      gap: 4,
      padding: '4px 10px',
      borderRadius: 6,
      background: 'rgba(10,10,15,0.8)',
      border: '1px solid #222',
      fontFamily: "'Segoe UI', system-ui, monospace",
      fontSize: 11,
      pointerEvents: 'none',
      zIndex: 15,
    }}>
      <span style={{ fontWeight: 700, fontSize: 13, color: fpsColor }}>{fps}</span>
      <span style={{ color: '#666', fontSize: 9 }}>FPS</span>
      <span style={{ color: '#333', margin: '0 2px' }}>|</span>
      <span style={{ color: '#ccc', fontWeight: 500 }}>{pipeCount}</span>
      <span style={{ color: '#666', fontSize: 9 }}>pipes</span>
    </div>
  );
}
