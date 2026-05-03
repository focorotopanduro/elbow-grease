import { useEffect, useRef, useState } from 'react';
import './Stats.css';

const STATS = [
  { value: 2, suffix: '', label: 'Active DBPR Licenses' },
  { value: 3, suffix: '', label: 'Core Counties Served' },
  { value: 4, suffix: '', label: 'Service Paths' },
  { value: 2026, suffix: '', label: 'License Expiration Year' },
];

function useCountUp(target: number, duration = 1800) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setValue(Math.round(target * eased));
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      });
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, duration]);

  return [value, ref] as const;
}

function Stat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const [v, ref] = useCountUp(value);
  return (
    <li className="stat">
      <span ref={ref} className="stat__num">
        {v}
        <span className="stat__suffix">{suffix}</span>
      </span>
      <span className="stat__label">{label}</span>
    </li>
  );
}

export default function Stats() {
  return (
    <section className="stats section--tight" aria-label="Company at a glance">
      <div className="container">
        <ul className="stats__list">
          {STATS.map((s) => (
            <Stat key={s.label} {...s} />
          ))}
        </ul>
      </div>
    </section>
  );
}
