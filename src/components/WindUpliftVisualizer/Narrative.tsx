import type { CascadeResult } from '../../physics/cascade';
import type { InstallProfile } from '../../physics/resistance';
import { HURRICANE_CATEGORIES, NAMED_STORMS } from '../../data/orlando';

interface Props {
  cascade: CascadeResult;
  profile: InstallProfile;
}

/**
 * Plain-English narrative of the current state. The single most important
 * thing on the page for a non-technical homeowner — translates the physics
 * into "what would happen at my house."
 */
export default function Narrative({ cascade, profile }: Props) {
  const V = cascade.windSpeed;
  const cat = HURRICANE_CATEGORIES.find((c) => V >= c.minMph && V <= c.maxMph);
  const matchingStorm = NAMED_STORMS.find((s) => s.peakMph === V);

  const triggered = cascade.stages.filter((s) => s.triggered);
  const top = triggered[triggered.length - 1];

  let outcome: string;
  if (!top) {
    outcome = 'all four roof layers hold. The shingles, underlayment, and ' +
      'sheathing are well within capacity.';
  } else if (top.id === 'drip_edge') {
    outcome = 'only the perimeter drip edge starts to flap. The shingle field ' +
      'still holds.';
  } else if (top.id === 'field_shingles') {
    outcome = 'corner shingles begin to lift first, with the seal-strip bond ' +
      'breaking outward to the edges. Granules visible on the ground.';
  } else if (top.id === 'underlayment') {
    outcome = profile.hasSWB
      ? 'shingles are gone in patches, but the self-adhered secondary water ' +
        'barrier is still doing its job — interior stays dry.'
      : 'the field shingles are gone in patches and the standard #15 felt ' +
        'tears within minutes. Wind-driven rain enters the attic.';
  } else {
    outcome = 'whole sheathing panels tear free of the rafters. The roof ' +
      'opens to sky and the ceiling fails within hours.';
  }

  return (
    <div className="narr" role="status" aria-live="polite">
      <div className="narr__chips">
        <span className="narr__chip narr__chip--primary">
          {V} mph
        </span>
        {cat && <span className="narr__chip">{cat.label}</span>}
        {matchingStorm && (
          <span className="narr__chip narr__chip--storm">
            {matchingStorm.name} {matchingStorm.year}
          </span>
        )}
        <span className="narr__chip narr__chip--quiet">
          {profile.label}
        </span>
      </div>

      <p className="narr__sentence">
        At <strong>{V} mph</strong>
        {matchingStorm && (
          <> (the peak that <strong>{matchingStorm.name}</strong> reached at {matchingStorm.landfall} in {matchingStorm.year})</>
        )}
        {' '}on a <strong>{cascade.config.stories}-story {cascade.config.shape}</strong>
        {' '}with <strong>{profile.label.toLowerCase()}</strong> construction
        {cascade.config.enclosed === 'fully' ? ' and impact-rated openings, ' : ', '}
        {outcome}
      </p>
    </div>
  );
}
