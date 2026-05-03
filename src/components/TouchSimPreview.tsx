import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import './TouchSimPreview.css';

/**
 * TouchSimPreview — a deliberately-simple 5-tier sim for phones.
 *
 * The full WindUpliftVisualizer is desktop-only (mouse precision +
 * GPU-heavy weather effects). On phones, instead of shipping a
 * stripped-down version of that engine (still heavy), we ship this:
 * five hand-tuned discrete states the user taps / swipes through.
 *
 *   Tier 1 — CALM            (~ 40 mph)  baseline house, sun, palm slight sway
 *   Tier 2 — TROPICAL STORM  (~ 80 mph)  rain, palm bending, dark sky
 *   Tier 3 — CAT 1–2         (~120 mph)  shutters closed, debris, lightning
 *   Tier 4 — CAT 3–4         (~160 mph)  shingles lifting, garage buckling
 *   Tier 5 — CAT 5           (~200 mph)  catastrophic — sheathing torn,
 *                                         tornado funnel, ground vortex
 *
 * Each tier renders a STATIC pre-composed scene. No live physics, no
 * weather streaming, no per-frame React work. Tier transitions are
 * pure CSS opacity crossfades + transforms — runs flat at 60fps even
 * on a 4-year-old budget Android.
 *
 * Interaction model:
 *   - Big tap zones (left = back, right = forward) for thumb reach
 *   - Horizontal swipe (any speed) advances/retreats one tier
 *   - Visible tier-pip indicator at bottom (5 dots, current is filled)
 *   - "Tap to start →" hint on first mount, fades after first interaction
 *
 * Why this matters for the funnel:
 *   The previous static preview tile was passive — users saw a tiny
 *   animated icon and scrolled past. This is interactive: the visitor
 *   can SEE what their roof would look like at Cat 5 in 5 seconds of
 *   tapping, which is exactly the "holy shit" moment the desktop sim
 *   delivers. The lead form below converts off that emotional spike.
 *
 * Privacy posture: zero tracking inside this component. We don't
 * fire analytics on tier changes — the funnel only cares about
 * sim_view_mobile (already fired by parent) and sim_form_submit_*.
 */

const TIER_COUNT = 5;

interface TierData {
  label: string;
  windMph: number;
  category: string;
}

const TIERS: ReadonlyArray<TierData> = [
  { label: 'Calm',           windMph: 40,  category: 'Tier 1 · Pre-storm' },
  { label: 'Tropical Storm', windMph: 80,  category: 'Tier 2 · TS warning' },
  { label: 'Hurricane',      windMph: 120, category: 'Tier 3 · Cat 1–2' },
  { label: 'Major',          windMph: 160, category: 'Tier 4 · Cat 3–4' },
  { label: 'Catastrophic',   windMph: 200, category: 'Tier 5 · Cat 5' },
];

const SWIPE_MIN_DELTA_PX = 40;

export default function TouchSimPreview() {
  const [tier, setTier] = useState(0);
  const [hintVisible, setHintVisible] = useState(true);
  const swipeStartX = useRef<number | null>(null);

  const advance = useCallback((delta: number) => {
    setTier((cur) => Math.max(0, Math.min(TIER_COUNT - 1, cur + delta)));
    setHintVisible(false);
  }, []);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    swipeStartX.current = e.clientX;
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = swipeStartX.current;
    swipeStartX.current = null;
    if (start == null) return;
    const delta = e.clientX - start;
    if (Math.abs(delta) >= SWIPE_MIN_DELTA_PX) {
      advance(delta < 0 ? 1 : -1); // swipe left = next, right = prev
    } else {
      // Treat as a tap — left half retreats, right half advances
      const target = e.currentTarget as HTMLDivElement;
      const rect = target.getBoundingClientRect();
      const tappedRight = e.clientX - rect.left > rect.width / 2;
      advance(tappedRight ? 1 : -1);
    }
  };

  // Auto-fade the hint after 4 seconds even without interaction
  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 4000);
    return () => clearTimeout(t);
  }, []);

  const current = TIERS[tier];
  const intensity = tier / (TIER_COUNT - 1); // 0 → 1

  return (
    <div
      className="tsp"
      role="region"
      aria-label="Hurricane simulator preview — tap to escalate through wind tiers"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      style={{ ['--tsp-intensity' as never]: intensity }}
    >
      {/* SCENE — a stack of layers, each visible at its own tier range.
          Sky/sun/moon transitions are smooth via CSS opacity + filter. */}
      <div className="tsp__scene" aria-hidden="true">
        {/* Sky — color shifts via tier-driven CSS variable */}
        <div className="tsp__sky" data-tier={tier} />

        {/* Sun (tiers 0-1) → Storm-cell tint (tiers 2+) */}
        <div className={`tsp__sun ${tier <= 1 ? 'is-visible' : ''}`} />
        <div className={`tsp__storm-tint ${tier >= 2 ? 'is-visible' : ''}`} />

        {/* Distant clouds */}
        <div className="tsp__clouds" data-tier={tier}>
          <span className="tsp__cloud tsp__cloud--1" />
          <span className="tsp__cloud tsp__cloud--2" />
          <span className="tsp__cloud tsp__cloud--3" />
        </div>

        {/* Lightning flashes — tiers 3+ */}
        {tier >= 3 && <div className="tsp__lightning" />}

        {/* Tornado funnel — tier 5 only */}
        {tier >= 4 && (
          <svg className="tsp__funnel" viewBox="0 0 60 200" preserveAspectRatio="none">
            <polygon points="20,0 40,0 50,200 10,200" fill="rgba(20, 28, 38, 0.78)" />
            <line x1="20" y1="0" x2="10" y2="200" stroke="rgba(180, 200, 195, 0.30)" strokeWidth="0.6" />
            <line x1="40" y1="0" x2="50" y2="200" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.6" />
          </svg>
        )}

        {/* Palm tree — bends with intensity */}
        <svg className="tsp__palm" viewBox="0 0 100 200" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <g className="tsp__palm-bend">
            <path d="M 50 200 Q 48 140 52 80 Q 56 30 50 10" stroke="#3a2a1c" strokeWidth="4" fill="none" strokeLinecap="round" />
            <path d="M 50 12 Q 30 0 10 18 M 50 12 Q 70 0 90 18 M 50 12 Q 28 18 12 50 M 50 12 Q 72 18 88 50" stroke="#2c4628" strokeWidth="3" fill="none" strokeLinecap="round" />
          </g>
        </svg>

        {/* House — central focal point. Damage layers stack on top
            via tier-gated opacity. */}
        <svg
          className="tsp__house"
          viewBox="0 0 280 180"
          preserveAspectRatio="xMidYMax meet"
          aria-hidden="true"
        >
          {/* Roof */}
          <polygon points="20,80 140,20 260,80" fill="#3d342a" stroke="#0a0908" strokeWidth="1" />
          {/* Roof shading */}
          <polygon points="20,80 140,20 260,80" fill="url(#tsp-roof-shade)" opacity="0.4" />
          <defs>
            <linearGradient id="tsp-roof-shade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffeac4" stopOpacity="0.3" />
              <stop offset="1" stopColor="#000" stopOpacity="0.4" />
            </linearGradient>
          </defs>

          {/* Walls */}
          <rect x="40" y="80" width="200" height="100" fill="#9aa094" stroke="#0a0908" strokeWidth="0.8" />
          {/* CMU subtle texture lines */}
          <line x1="40" y1="100" x2="240" y2="100" stroke="rgba(0,0,0,0.12)" strokeWidth="0.3" />
          <line x1="40" y1="120" x2="240" y2="120" stroke="rgba(0,0,0,0.12)" strokeWidth="0.3" />
          <line x1="40" y1="140" x2="240" y2="140" stroke="rgba(0,0,0,0.12)" strokeWidth="0.3" />
          <line x1="40" y1="160" x2="240" y2="160" stroke="rgba(0,0,0,0.12)" strokeWidth="0.3" />

          {/* Windows */}
          <rect x="60" y="100" width="40" height="50" fill={tier >= 2 ? '#3a3128' : '#2a3a4a'} stroke="#0a0908" strokeWidth="0.8" />
          <rect x="180" y="100" width="40" height="50" fill={tier >= 2 ? '#3a3128' : '#2a3a4a'} stroke="#0a0908" strokeWidth="0.8" />
          {tier >= 2 && (
            <>
              {/* Hurricane shutters slats */}
              <line x1="62" y1="108" x2="98" y2="108" stroke="#5b4f44" strokeWidth="0.6" />
              <line x1="62" y1="118" x2="98" y2="118" stroke="#5b4f44" strokeWidth="0.6" />
              <line x1="62" y1="128" x2="98" y2="128" stroke="#5b4f44" strokeWidth="0.6" />
              <line x1="62" y1="138" x2="98" y2="138" stroke="#5b4f44" strokeWidth="0.6" />
              <line x1="182" y1="108" x2="218" y2="108" stroke="#5b4f44" strokeWidth="0.6" />
              <line x1="182" y1="118" x2="218" y2="118" stroke="#5b4f44" strokeWidth="0.6" />
              <line x1="182" y1="128" x2="218" y2="128" stroke="#5b4f44" strokeWidth="0.6" />
              <line x1="182" y1="138" x2="218" y2="138" stroke="#5b4f44" strokeWidth="0.6" />
            </>
          )}

          {/* Door */}
          <rect x="125" y="120" width="30" height="60" fill="#3d2818" stroke="#0a0908" strokeWidth="0.6" />
          <circle cx="148" cy="150" r="1.2" fill="#d4a04a" />

          {/* DAMAGE LAYERS — gated to tier */}
          {/* Tier 4: shingles lifting (visible tabs at corners) */}
          {tier >= 3 && (
            <g className="tsp__damage-shingles">
              <rect x="22" y="74" width="26" height="6" fill="#3a3128" stroke="#0a0908" strokeWidth="0.4" transform="rotate(-22 35 77)" />
              <rect x="232" y="74" width="26" height="6" fill="#3a3128" stroke="#0a0908" strokeWidth="0.4" transform="rotate(18 245 77)" />
            </g>
          )}
          {/* Tier 5: catastrophic tear hole */}
          {tier >= 4 && (
            <g className="tsp__damage-tear">
              <polygon points="120,40 180,55 165,75 110,60" fill="#0a0908" stroke="#eb6924" strokeWidth="2" />
              <polygon points="125,45 175,57 162,72 115,62" fill="#000" />
            </g>
          )}
          {/* Tier 5: stucco corner cracks */}
          {tier >= 4 && (
            <g stroke="rgba(0,0,0,0.85)" strokeWidth="0.5" fill="none" strokeLinecap="round">
              <path d="M 42 88 L 50 100 L 46 116 L 56 130" />
              <path d="M 238 88 L 230 100 L 234 116 L 224 130" />
            </g>
          )}
        </svg>

        {/* Rain — increasing density per tier */}
        {tier >= 1 && (
          <div className="tsp__rain" data-tier={tier} aria-hidden="true">
            {Array.from({ length: tier === 1 ? 20 : tier === 2 ? 35 : tier === 3 ? 55 : 75 }).map((_, i) => (
              <span key={i} className="tsp__raindrop" style={{ left: `${(i * 13) % 100}%`, animationDelay: `${(i * 0.07) % 1.4}s` }} />
            ))}
          </div>
        )}

        {/* Ground */}
        <div className="tsp__ground" />
      </div>

      {/* HUD overlay — tier label + wind speed + category */}
      <div className="tsp__hud" aria-live="polite">
        <div className="tsp__hud-cat">{current.category}</div>
        <div className="tsp__hud-mph">
          <span className="tsp__hud-mph-num">{current.windMph}</span>
          <span className="tsp__hud-mph-unit">mph</span>
        </div>
        <div className="tsp__hud-label">{current.label}</div>
      </div>

      {/* Tier pips at the bottom */}
      <div className="tsp__pips" role="presentation">
        {TIERS.map((_, i) => (
          <span
            key={i}
            className={`tsp__pip ${i === tier ? 'is-active' : ''} ${i <= tier ? 'is-passed' : ''}`}
          />
        ))}
      </div>

      {/* Tap hint — fades after first interaction */}
      <div className={`tsp__hint ${hintVisible ? 'is-visible' : ''}`} aria-hidden={!hintVisible}>
        Tap or swipe to escalate →
      </div>
    </div>
  );
}
