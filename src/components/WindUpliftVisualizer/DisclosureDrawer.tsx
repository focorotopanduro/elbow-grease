import { useState } from 'react';
import type { CascadeResult } from '../../physics/cascade';
import type { InstallProfile } from '../../physics/resistance';
import {
  ASCE_VELOCITY_CONSTANT,
  ORLANDO_RANCH_VELOCITY_K,
  GCp,
  GCpi_PARTIALLY_ENCLOSED,
  FASTENERS,
  PENETRATION_IN,
  NAIL_PATTERNS,
  SHINGLE_CLASSES,
} from '../../physics/constants';
import { FBC_REFERENCES } from '../../data/orlando';

interface Props {
  cascade: CascadeResult;
  profile: InstallProfile;
}

export default function DisclosureDrawer({ cascade, profile }: Props) {
  const [open, setOpen] = useState(false);
  const fastener = FASTENERS[profile.fastenerId];
  const pattern = NAIL_PATTERNS[profile.patternId];
  const penetration = PENETRATION_IN[profile.fastenerId as keyof typeof PENETRATION_IN];
  const shingle = SHINGLE_CLASSES[profile.shingleClassId];

  return (
    <section className={`dd ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="dd__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="dd-content"
      >
        <span className="dd__toggle-label">Physics behind these numbers</span>
        <span className="dd__toggle-icon" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      <div id="dd-content" className="dd__content" hidden={!open}>
        <div className="dd__cols">
          <article className="dd__block">
            <h4>Velocity pressure</h4>
            <p className="dd__src">ASCE 7-22 §26.10, eq. 26.10-1</p>
            <pre className="dd__eq">
{`q = ${ASCE_VELOCITY_CONSTANT} · Kz · Kzt · Kd · Ke · V²

For this Orlando ranch (Exposure B,
Risk Cat II, h = 12 ft):
   Kz   = 0.70   (Tbl 26.10-1)
   Kzt  = 1.00   (flat terrain)
   Kd   = 0.85   (buildings)
   Ke   = 1.00   (sea-level FL)

→  q ≈ ${ORLANDO_RANCH_VELOCITY_K} · V²

At V = ${cascade.windSpeed} mph:
   q = ${cascade.uplift.q.toFixed(2)} psf`}
            </pre>
          </article>

          <article className="dd__block">
            <h4>External &amp; internal pressure</h4>
            <p className="dd__src">ASCE 7-22 Fig 30.3-2A &amp; Tbl 26.13-1</p>
            <pre className="dd__eq">
{`Net uplift  p = q · (GCp − GCpi)

GCp (gable, slope ≤ 7°, A ≤ 10 sf)
   field   = ${GCp.field}
   edge    = ${GCp.edge}
   corner  = ${GCp.corner}

GCpi (partially-enclosed)
   = ±${GCpi_PARTIALLY_ENCLOSED}

Worst-case combo (suction):
   field   → q · ${(Math.abs(GCp.field - GCpi_PARTIALLY_ENCLOSED)).toFixed(2)}
   edge    → q · ${(Math.abs(GCp.edge - GCpi_PARTIALLY_ENCLOSED)).toFixed(2)}
   corner  → q · ${(Math.abs(GCp.corner - GCpi_PARTIALLY_ENCLOSED)).toFixed(2)}`}
            </pre>
          </article>

          <article className="dd__block">
            <h4>Sheathing capacity</h4>
            <p className="dd__src">{fastener.source}</p>
            <pre className="dd__eq">
{`Per-nail withdrawal:
   P_nail = W · L_pen
          = ${fastener.withdrawalLbPerIn} · ${penetration}
          = ${(fastener.withdrawalLbPerIn * penetration).toFixed(1)} lb

Tributary area per nail:
   field   = ${pattern.field} sf  (${pattern.label})
   edge    = ${pattern.edge} sf

→  field cap = ${cascade.resistance.sheathing.field.toFixed(1)} psf
→  edge  cap = ${cascade.resistance.sheathing.edge.toFixed(1)} psf
→ corner cap = ${cascade.resistance.sheathing.corner.toFixed(1)} psf`}
            </pre>
          </article>

          <article className="dd__block">
            <h4>Shingle capacity</h4>
            <p className="dd__src">{shingle.source}</p>
            <pre className="dd__eq">
{`Class ${shingle.id} certified to ${shingle.designGust} mph
3-sec gust per ASTM D7158.

Equivalent net-uplift cap:
   ≈ ${shingle.netUpliftCapPsf} psf

Once exceeded, individual tabs unzip
starting at corners (worst suction).`}
            </pre>
          </article>
        </div>

        <aside className="dd__refs">
          <h4>FBC sections cited</h4>
          <ul>
            {profile.fbcReferences.map((id) => {
              const ref =
                FBC_REFERENCES[id.replace('FBC ', '') as keyof typeof FBC_REFERENCES];
              if (!ref) return (
                <li key={id}><strong>{id}</strong></li>
              );
              return (
                <li key={id}>
                  <strong>{ref.section}</strong>
                  <span>{ref.text}</span>
                  <em>{ref.summary}</em>
                </li>
              );
            })}
          </ul>
        </aside>

        <aside className="dd__assumption">
          <h4>Why our numbers feel conservative</h4>
          <p>
            We use <strong>GCpi = ±0.55 (partially-enclosed)</strong> as the
            default. That assumes the home's envelope can be breached during
            the storm — i.e. a window or door fails and the wind pressurizes
            the inside, adding to the suction trying to lift the roof from
            the outside. This is the appropriate WBDR assumption when there
            are no impact-rated openings. If your home has impact windows
            and intact shutters that hold all the way through the storm,
            GCpi drops to ±0.18 (fully-enclosed) and every uplift number on
            this page drops by roughly <strong>30%</strong>.
          </p>
        </aside>

        <p className="dd__legal">
          Educational reference only. Real wind-load analysis on a specific
          structure requires evaluation by a Florida-licensed Professional
          Engineer. This tool does not predict damage to any individual home.
        </p>
      </div>
    </section>
  );
}
