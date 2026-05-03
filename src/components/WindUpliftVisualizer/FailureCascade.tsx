import type { CascadeResult, FailureStage } from '../../physics/cascade';

interface Props {
  cascade: CascadeResult;
}

const SEVERITY_ORDER: Record<string, number> = {
  minor: 0,
  moderate: 1,
  major: 2,
  catastrophic: 3,
};

/**
 * Compliance status ribbon (Elbow Grease pattern):
 *   ok    = layer holds with comfortable margin
 *   warn  = layer holds but margin is small
 *   fail  = layer exceeds capacity
 */
function complianceFor(s: FailureStage, marginPct: number): { id: 'ok' | 'warn' | 'fail'; label: string } {
  if (s.triggered) return { id: 'fail', label: 'Exceeded' };
  if (marginPct < 0.2) return { id: 'warn', label: 'Marginal' };
  return { id: 'ok', label: 'Holding' };
}

export default function FailureCascade({ cascade }: Props) {
  // Margin pct used by drip_edge + shingles relative to corner cap
  const cornerMargin = cascade.marginPsf.corner;
  const cornerCap = cascade.resistance.corner || 1;
  const cornerMarginPct = Math.max(0, cornerMargin / cornerCap);

  const sheathingMargin = Math.min(
    cascade.resistance.sheathing.field - cascade.uplift.field,
    cascade.resistance.sheathing.edge - cascade.uplift.edge,
    cascade.resistance.sheathing.corner - cascade.uplift.corner,
  );
  const sheathingMarginPct = Math.max(0, sheathingMargin / cascade.resistance.sheathing.corner);

  return (
    <div className="fc">
      <header className="fc__head">
        <p className="fc__eyebrow">Failure cascade · live compliance</p>
        <h3 className="fc__title">Per-layer status</h3>
        <p className="fc__sub">
          Each layer reads its own pass / marginal / fail signal in real time
          as you change wind speed, install profile, or house config.
        </p>
      </header>

      <ol className="fc__list">
        {cascade.stages.map((s, i) => {
          const sevRank = SEVERITY_ORDER[s.severity] ?? 0;
          const marginPct =
            s.id === 'sheathing' ? sheathingMarginPct : cornerMarginPct;
          const compliance = complianceFor(s, marginPct);

          return (
            <li
              key={s.id}
              className={`fc__stage ${s.triggered ? 'is-triggered' : ''} fc__stage--sev-${sevRank}`}
              aria-current={s.triggered ? 'step' : undefined}
            >
              <span className="fc__stage-n" aria-hidden="true">
                0{i + 1}
              </span>
              <div className="fc__stage-body">
                <div className="fc__stage-row">
                  <p className="fc__stage-label">{s.label}</p>
                  <span
                    className={`fc__pill fc__pill--${compliance.id}`}
                    title={`${compliance.label} (margin ${(marginPct * 100).toFixed(0)}%)`}
                  >
                    <span className="fc__pill-dot" aria-hidden="true" />
                    {compliance.label}
                  </span>
                </div>
                <p className="fc__stage-impact">{s.homeownerImpact}</p>
                {s.triggered && (
                  <p className="fc__stage-flag">
                    <span className="fc__pulse" aria-hidden="true" />
                    Active at {cascade.windSpeed} mph
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
