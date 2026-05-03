import {
  FASTENERS,
  SHINGLE_CLASSES,
  NAIL_PATTERNS,
  PENETRATION_IN,
} from '../../physics/constants';
import type { InstallProfile } from '../../physics/resistance';
import './MaterialLegend.css';

interface Props {
  profile: InstallProfile;
}

/**
 * CAD-style material legend, inspired by Elbow Grease's pipe-material
 * spec strip. Each row shows a color-coded swatch + technical name + spec.
 *
 * Reads directly from the physics catalog so the source-of-truth lives in
 * one place — adding a new fastener / shingle class flows through.
 */
export default function MaterialLegend({ profile }: Props) {
  const fastener = FASTENERS[profile.fastenerId];
  const shingle = SHINGLE_CLASSES[profile.shingleClassId];
  const pattern = NAIL_PATTERNS[profile.patternId];
  const penetration = PENETRATION_IN[profile.fastenerId as keyof typeof PENETRATION_IN];

  const swbMaterial = profile.hasSWB
    ? {
        label: 'SWB · Self-adhered',
        spec: 'Peel-and-stick over deck',
        cite: 'FBC 1518',
        color: '#7A4F2A',
        pattern: 'crosshatch',
      }
    : {
        label: 'Underlayment · #15 Felt',
        spec: 'Standard asphalt-saturated',
        cite: 'Pre-FBC',
        color: '#5B4231',
        pattern: 'plain',
      };

  const items: Array<{
    layer: string;
    label: string;
    spec: string;
    cite: string;
    color: string;
    pattern: 'shingles' | 'crosshatch' | 'plain' | 'osb' | 'fastener';
  }> = [
    {
      layer: 'L1',
      label: shingle.label,
      spec: `Net cap ${shingle.netUpliftCapPsf} psf`,
      cite: 'ASTM D7158',
      color: '#3a3128',
      pattern: 'shingles',
    },
    {
      layer: 'L2',
      label: swbMaterial.label,
      spec: swbMaterial.spec,
      cite: swbMaterial.cite,
      color: swbMaterial.color,
      pattern: swbMaterial.pattern as 'crosshatch' | 'plain',
    },
    {
      layer: 'L3',
      label: '7/16" OSB Sheathing',
      spec: 'Min APA C-D Ext glue',
      cite: 'FBC 2304',
      color: '#5b4a36',
      pattern: 'osb',
    },
    {
      layer: 'L4',
      label: fastener.name,
      spec: `${fastener.withdrawalLbPerIn} lb/in × ${penetration}" pen · ${pattern.label}`,
      cite: 'NDS Tbl 12.2C',
      color: fastener.ringShank ? '#c45a1a' : '#6e5a40',
      pattern: 'fastener',
    },
  ];

  return (
    <section className="ml" aria-label="Material legend for the active install profile">
      <header className="ml__head">
        <p className="eyebrow">Active install — material legend</p>
        <p className="ml__profile">
          <strong>{profile.label}</strong>
          <span className="ml__era">· {profile.era}</span>
        </p>
      </header>

      <ul className="ml__list">
        {items.map((it) => (
          <li key={it.layer} className="ml__item">
            <span className="ml__layer">{it.layer}</span>
            <span
              className={`ml__swatch ml__swatch--${it.pattern}`}
              style={{ background: it.color }}
              aria-hidden="true"
            />
            <span className="ml__body">
              <span className="ml__label">{it.label}</span>
              <span className="ml__spec">{it.spec}</span>
            </span>
            <span className="ml__cite">{it.cite}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
