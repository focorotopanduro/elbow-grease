import { useEffect, useRef, useState } from 'react';
import GoldenNuggets from '../components/GoldenNuggets';
import AuroraBackdrop from '../components/AuroraBackdrop';
import './HurricaneToolPromo.css';

/**
 * Homepage promo section for the hurricane visualizer.
 *
 * Sits between Hero and Services — the highest-leverage placement on the
 * page. The animated mini-illustration teases the tool; the CTAs route into
 * the full visualizer at /hurricane-uplift.html with UTM tracking.
 */

const FACTS = [
  { label: 'ASCE 7-22 verified', icon: '✓' },
  { label: '30-second answer', icon: '⚡' },
  { label: 'Free · no signup', icon: '◯' },
  { label: 'Built by engineers', icon: '⚙' },
];

const SHOWCASE_SPEEDS = [80, 110, 130, 150, 175];

export default function HurricaneToolPromo() {
  const [speedIdx, setSpeedIdx] = useState(0);
  const elRef = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  // Cycle through demo wind speeds when in view
  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => {
      setSpeedIdx((i) => (i + 1) % SHOWCASE_SPEEDS.length);
    }, 2400);
    return () => clearInterval(id);
  }, [inView]);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => setInView(e.intersectionRatio > 0.3)),
      { threshold: [0, 0.3, 0.6] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const V = SHOWCASE_SPEEDS[speedIdx];
  const storm = Math.max(0, Math.min(1, (V - 60) / 140));
  const failing = V >= 130;

  return (
    <section ref={elRef} className="htp" aria-labelledby="htp-title">
      {/* Background gradient + ambient glows */}
      <AuroraBackdrop />
      <div className="htp__halo htp__halo--orange" aria-hidden="true" />
      <div className="htp__halo htp__halo--ember" aria-hidden="true" />
      <GoldenNuggets count={32} intensity={1.1} />

      <div className="container htp__inner">
        <div className="htp__copy reveal">
          <p className="eyebrow">Free interactive tool</p>
          <h2 id="htp-title" className="htp__title">
            How long would <em>your roof</em> last
            <br />in a Florida hurricane?
          </h2>
          <p className="htp__lead">
            We built an interactive simulator that shows you exactly how a
            Florida ranch responds to hurricane wind &mdash; from the first
            shingle lifting to the deck blowing off. Move the wind speed,
            replay the day Charley crossed Orlando, watch your virtual roof
            respond. Then book a real inspection.
          </p>

          <ul className="htp__facts">
            {FACTS.map((f) => (
              <li key={f.label}>
                <span aria-hidden="true">{f.icon}</span>
                {f.label}
              </li>
            ))}
          </ul>

          <div className="htp__cta">
            <a
              href="/hurricane-uplift.html?utm_source=homepage&utm_medium=promo&utm_campaign=wind_uplift"
              className="btn btn--primary"
            >
              Try the simulator <span aria-hidden="true">→</span>
            </a>
            <a href="#contact" className="btn btn--ghost btn--ghost-on-dark">
              Or skip ahead — book inspection
            </a>
          </div>
        </div>

        {/* MINI HOUSE ILLUSTRATION — teaser, animated by SHOWCASE_SPEEDS cycle */}
        <a
          href="/hurricane-uplift.html?utm_source=homepage&utm_medium=preview&utm_campaign=wind_uplift"
          className="htp__preview reveal reveal--from-right"
          aria-label="Open the full hurricane simulator"
          style={{ ['--htp-storm' as never]: storm }}
        >
          <svg
            className="htp__svg"
            viewBox="0 0 400 280"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <linearGradient id="htp-sky" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={`rgb(${Math.round(54 - 38 * storm)}, ${Math.round(64 - 50 * storm)}, ${Math.round(88 - 68 * storm)})`}
                />
                <stop
                  offset="100%"
                  stopColor={`rgb(${Math.round(140 - 92 * storm)}, ${Math.round(108 - 68 * storm)}, ${Math.round(88 - 48 * storm)})`}
                />
              </linearGradient>
              <radialGradient id="htp-sun" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={`rgba(255,230,180,${0.8 * (1 - storm)})`} />
                <stop offset="100%" stopColor="rgba(255,200,130,0)" />
              </radialGradient>
              <pattern id="htp-shingles" width="20" height="6" patternUnits="userSpaceOnUse">
                <rect width="20" height="6" fill="#3d342a" />
                <line x1="0" y1="3" x2="20" y2="3" stroke="#0a0908" strokeWidth="0.4" />
              </pattern>
            </defs>

            <rect x="0" y="0" width="400" height="280" fill="url(#htp-sky)" />
            <circle cx="320" cy="50" r="60" fill="url(#htp-sun)" />

            {/* Cloud */}
            <g style={{ opacity: 0.4 + storm * 0.5, transition: 'opacity 0.8s' }}>
              <ellipse cx="100" cy="50" rx="70" ry="18" fill={storm > 0.5 ? '#1a1814' : '#c4bfbc'} />
              <ellipse cx="200" cy="40" rx="60" ry="16" fill={storm > 0.5 ? '#1a1814' : '#c4bfbc'} />
            </g>

            {/* Wind streamlines */}
            {Array.from({ length: Math.round(2 + storm * 8) }).map((_, i) => (
              <line
                key={i}
                x1="-20"
                y1={40 + i * 22}
                x2="420"
                y2={45 + i * 22}
                stroke="#eb6924"
                strokeWidth={0.4 + storm * 0.8}
                strokeOpacity={0.2 + storm * 0.45}
                strokeDasharray={`${4 + storm * 6} ${8}`}
                className="htp-stream"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}

            {/* Palm */}
            <g
              style={{
                color: '#1c2418',
                transformOrigin: '50px 280px',
                transform: `rotate(${(storm * 8).toFixed(2)}deg)`,
                transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <path d="M 50 280 Q 48 230, 52 180 Q 55 140, 50 110" stroke="currentColor" strokeWidth="3" fill="none" />
              <g transform="translate(50 110)" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round">
                <path d="M 0 0 Q -22 -4, -36 8" />
                <path d="M 0 0 Q -14 -18, -22 -32" />
                <path d="M 0 0 Q 4 -22, 0 -38" />
                <path d="M 0 0 Q 22 -18, 32 -32" />
                <path d="M 0 0 Q 24 -4, 38 8" />
              </g>
            </g>

            {/* House body */}
            <rect x="120" y="180" width="220" height="100" fill="#cbb594" stroke="#0a0908" strokeWidth="0.8" />
            <rect x="120" y="180" width="220" height="3" fill="rgba(0,0,0,0.4)" />

            {/* Roof */}
            <polygon points="120,180 230,118 340,180" fill="url(#htp-shingles)" stroke="#0a0908" strokeWidth="0.8" />
            {/* shingle courses */}
            {[0.25, 0.5, 0.75].map((p, i) => {
              const y = 118 + (180 - 118) * p;
              const xWidth = (p * 220) / 2;
              return (
                <line
                  key={i}
                  x1={230 - xWidth}
                  y1={y}
                  x2={230 + xWidth}
                  y2={y}
                  stroke="rgba(0,0,0,0.3)"
                  strokeWidth="0.5"
                />
              );
            })}

            {/* Lifted shingle when failing */}
            {failing && (
              <g transform="translate(135 168) rotate(-22)" style={{ animation: 'htp-tab-lift 1.6s ease-in-out infinite' }}>
                <rect width="32" height="6" fill="#3a3128" stroke="#0a0908" strokeWidth="0.4" />
              </g>
            )}

            {/* Door */}
            <rect x="208" y="216" width="44" height="64" fill="#3d2818" stroke="#0a0908" strokeWidth="0.6" />
            <circle cx="244" cy="248" r="1.5" fill="#d4a04a" />

            {/* Windows */}
            <rect x="146" y="208" width="48" height="50" fill="#1a1715" stroke="#5b4f44" strokeWidth="0.6" />
            <line x1="170" y1="208" x2="170" y2="258" stroke="#5b4f44" strokeWidth="0.6" />
            <line x1="146" y1="233" x2="194" y2="233" stroke="#5b4f44" strokeWidth="0.6" />

            <rect x="266" y="208" width="48" height="50" fill="#1a1715" stroke="#5b4f44" strokeWidth="0.6" />
            <line x1="290" y1="208" x2="290" y2="258" stroke="#5b4f44" strokeWidth="0.6" />
            <line x1="266" y1="233" x2="314" y2="233" stroke="#5b4f44" strokeWidth="0.6" />

            {/* Lawn */}
            <rect x="0" y="278" width="400" height="6" fill="#34421c" />
          </svg>

          {/* Floating wind-speed readout overlay */}
          <div className="htp__readout">
            <span className="htp__readout-value">{V}</span>
            <span className="htp__readout-unit">mph</span>
            <span className={`htp__readout-status htp__readout-status--${failing ? 'fail' : 'ok'}`}>
              {failing ? '⚠ Roof failing' : '✓ Holding'}
            </span>
          </div>

          {/* Play overlay */}
          <div className="htp__play" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M 8 5 L 19 12 L 8 19 Z" fill="currentColor" /></svg>
            <span>Try it</span>
          </div>
        </a>
      </div>
    </section>
  );
}
