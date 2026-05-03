import type { CascadeResult } from '../../physics/cascade';
import type { InstallProfile } from '../../physics/resistance';
import { DAMAGE_BY_STAGE, fmtRange } from '../../data/damage';
import './OutcomeCard.css';

interface Props {
  cascade: CascadeResult;
  profile: InstallProfile;
}

type StatusKey = 'safe' | 'shedding' | 'failing' | 'lost';

const STATUS: Record<StatusKey, { emoji: string; label: string; sub: string; color: string }> = {
  safe: {
    emoji: '✓',
    label: 'Holding',
    sub: 'Your roof is within capacity. No layer compromised.',
    color: '#2e7d32',
  },
  shedding: {
    emoji: '⚠',
    label: 'Losing shingles',
    sub: 'Tabs lifting at corners. Ground granule loss visible.',
    color: '#c45a1a',
  },
  failing: {
    emoji: '⚠',
    label: 'Water intrusion',
    sub: 'Layer 2 exposed. Wind-driven rain reaching the attic.',
    color: '#c62828',
  },
  lost: {
    emoji: '✕',
    label: 'Roof lost',
    sub: 'Sheathing panels blown off. Interior open to sky.',
    color: '#a8421a',
  },
};

export default function OutcomeCard({ cascade, profile }: Props) {
  const top = cascade.highestStageReached;
  const status: StatusKey =
    top === 'sheathing' ? 'lost' :
    top === 'underlayment' ? 'failing' :
    top === 'field_shingles' ? 'shedding' :
    'safe';

  const meta = STATUS[status];
  const damage = top ? DAMAGE_BY_STAGE[top] : null;

  return (
    <aside
      className={`oc oc--${status}`}
      role="status"
      aria-live="polite"
      style={{ ['--oc-color' as never]: meta.color }}
    >
      <div className="oc__head">
        <span className="oc__emoji" aria-hidden="true">{meta.emoji}</span>
        <div className="oc__head-text">
          <p className="oc__eyebrow">Your roof right now</p>
          <h3 className="oc__label">{meta.label}</h3>
        </div>
      </div>
      <p className="oc__sub">{meta.sub}</p>

      <div className="oc__stats">
        <div>
          <span className="oc__stat-value">{cascade.windSpeed}</span>
          <span className="oc__stat-unit">mph</span>
          <span className="oc__stat-label">Wind right now</span>
        </div>
        <div>
          <span className="oc__stat-value">{cascade.stages.filter((s) => s.triggered).length}</span>
          <span className="oc__stat-unit">/ 4</span>
          <span className="oc__stat-label">Layers compromised</span>
        </div>
        {damage ? (
          <div>
            <span className="oc__stat-money">{fmtRange(damage.repairLow, damage.repairHigh)}</span>
            <span className="oc__stat-label">Repair likely</span>
          </div>
        ) : (
          <div>
            <span className="oc__stat-money oc__stat-money--ok">$0</span>
            <span className="oc__stat-label">No damage</span>
          </div>
        )}
      </div>

      <p className="oc__profile">
        Roof: <strong>{profile.label}</strong>
      </p>
    </aside>
  );
}
