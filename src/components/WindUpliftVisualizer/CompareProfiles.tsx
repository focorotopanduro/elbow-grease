import { buildFailureCascade } from '../../physics/cascade';
import { INSTALL_PROFILES } from '../../physics/resistance';
import type { HouseConfig } from '../../physics/pressure';
import { DAMAGE_BY_STAGE, INSURANCE_PREMIUM, fmtRange } from '../../data/damage';
import './CompareProfiles.css';

interface Props {
  windSpeed: number;
  config: HouseConfig;
}

const ORDER = ['code_min', 'fbc_wbdr'] as const;

/**
 * Side-by-side ROI comparison panel — the conversion lever.
 *
 * Renders both install profiles at the same wind speed so the user can
 * see exactly what they'd save (or lose) by upgrading. Damage estimates
 * surface real Orlando-contractor repair ranges per cascade stage that
 * has triggered.
 */
export default function CompareProfiles({ windSpeed, config }: Props) {
  const results = ORDER.map((id) => {
    const profile = INSTALL_PROFILES[id];
    const cascade = buildFailureCascade(windSpeed, profile, config);
    const triggered = cascade.stages.filter((s) => s.triggered);
    const top = triggered[triggered.length - 1];
    const worstStageDamage = top ? DAMAGE_BY_STAGE[top.id] : null;
    return { id, profile, cascade, triggered, top, worstStageDamage };
  });

  const [oldR, newR] = results;

  // Repair "savings" = the difference between worst damage at code_min and worst at fbc_wbdr
  const oldRepair = oldR.worstStageDamage;
  const newRepair = newR.worstStageDamage;

  let damageDelta: { low: number; high: number } | null = null;
  if (oldRepair) {
    const newLow = newRepair?.repairLow ?? 0;
    const newHigh = newRepair?.repairHigh ?? 0;
    damageDelta = {
      low: Math.max(0, oldRepair.repairLow - newLow),
      high: Math.max(0, oldRepair.repairHigh - newHigh),
    };
  }

  // Annual insurance premium delta (rough, but real-data anchored)
  const annualSavings = {
    low: INSURANCE_PREMIUM.pre2002_unmitigated.low - INSURANCE_PREMIUM.fbc_fully_mitigated.high,
    high: INSURANCE_PREMIUM.pre2002_unmitigated.high - INSURANCE_PREMIUM.fbc_fully_mitigated.low,
  };

  return (
    <section className="cp" aria-label="Side-by-side install profile comparison">
      <header className="cp__head">
        <p className="eyebrow">ROI comparison</p>
        <h3 className="cp__title">
          Both profiles, <em>same wind</em>
        </h3>
        <p className="cp__sub">
          What you'd see at <strong>{windSpeed} mph</strong> if your roof were
          built either way. The damage estimates use Orlando-contractor 2024
          repair ranges for a typical one-story ranch.
        </p>
      </header>

      <div className="cp__grid" role="table">
        <div className="cp__col cp__col--header" role="columnheader" />
        {results.map((r) => (
          <div
            key={r.id}
            className={`cp__col cp__col--header cp__col--${r.id}`}
            role="columnheader"
          >
            <p className="cp__col-era">{r.profile.era}</p>
            <p className="cp__col-name">{r.profile.label}</p>
          </div>
        ))}

        {/* Row: highest stage reached */}
        <div className="cp__rh" role="rowheader">Worst failure</div>
        {results.map((r) => (
          <div key={r.id} className="cp__cell" role="cell">
            {r.top ? (
              <>
                <span className="cp__pill cp__pill--fail">Stage {r.cascade.stages.indexOf(r.top) + 1}</span>
                <span className="cp__cell-text">{r.top.label}</span>
              </>
            ) : (
              <>
                <span className="cp__pill cp__pill--ok">Holds</span>
                <span className="cp__cell-text">All four layers within capacity</span>
              </>
            )}
          </div>
        ))}

        {/* Row: triggered stage count */}
        <div className="cp__rh" role="rowheader">Layers compromised</div>
        {results.map((r) => (
          <div key={r.id} className="cp__cell" role="cell">
            <span className="cp__big">{r.triggered.length}</span>
            <span className="cp__small">of 4</span>
          </div>
        ))}

        {/* Row: estimated repair cost */}
        <div className="cp__rh" role="rowheader">Likely repair cost</div>
        {results.map((r) => (
          <div key={r.id} className="cp__cell" role="cell">
            {r.worstStageDamage ? (
              <>
                <span className="cp__money">
                  {fmtRange(r.worstStageDamage.repairLow, r.worstStageDamage.repairHigh)}
                </span>
                <span className="cp__cell-sub">{r.worstStageDamage.label}</span>
              </>
            ) : (
              <span className="cp__money cp__money--ok">$0</span>
            )}
          </div>
        ))}
      </div>

      {/* Punchline panel */}
      {damageDelta && (damageDelta.low > 0 || damageDelta.high > 0) && (
        <aside className="cp__delta">
          <div className="cp__delta-block">
            <p className="cp__delta-eyebrow">Storm-event savings if upgraded</p>
            <p className="cp__delta-money">
              {fmtRange(damageDelta.low, damageDelta.high)}
            </p>
            <p className="cp__delta-sub">at this exact wind speed</p>
          </div>
          <div className="cp__delta-block">
            <p className="cp__delta-eyebrow">Annual insurance savings (typical)</p>
            <p className="cp__delta-money">
              {fmtRange(annualSavings.low, annualSavings.high)} <span className="cp__delta-suffix">/ yr</span>
            </p>
            <p className="cp__delta-sub">FL OIR My Safe Florida Home 2024 baselines</p>
          </div>
        </aside>
      )}

      <p className="cp__legal">
        Educational reference. Real repair quotes require a free 30-minute
        on-site inspection. Insurance premium ranges depend on coverage
        amount and carrier — your actual mileage may vary.
      </p>
    </section>
  );
}
