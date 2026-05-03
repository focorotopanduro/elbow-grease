import { pts, ISO_DIMS } from './projection';

/**
 * RoofAssemblyIso — gable roof projected to isometric.
 *
 * Ridge runs LEFT-RIGHT (parallel to street, matching the front view's
 * gable orientation). Visible faces from upper-right-front camera:
 *
 *   ┌─ FRONT slope     (facing +Y == 0, sloping from eave up to ridge)
 *   ├─ RIGHT gable end (triangle on the +X face)
 *   ├─ GARAGE roof front + right gable
 *   └─ Ridge cap line
 *
 * The BACK slope and LEFT gable end are hidden behind the building.
 *
 * Cascade-driven states (same triggers as the front view):
 *   - shinglesLifting     → shingles shown at 0.6 opacity (visibly weakened)
 *   - underlaymentExposed → SWB/sheathing layer fades in beneath
 *   - sheathingGone       → roof entirely removed, deck shown bare with a
 *                            torn-edge polygon highlighted in orange
 */
interface Props {
  hasSWB: boolean;
  shinglesLifting: boolean;
  underlaymentExposed: boolean;
  sheathingGone: boolean;
}

const D = ISO_DIMS;

export default function RoofAssemblyIso({
  hasSWB,
  shinglesLifting,
  underlaymentExposed,
  sheathingGone,
}: Props) {
  // Roof corners (world-space)
  const ridgeY = D.mainD / 2;
  const ridgeZ = D.mainH + D.roofR;
  const eaveZ = D.mainH;

  // Eave overhang — the roof projects 4 units past the wall on each side
  const oh = 4;

  // Main roof
  const frontEaveLeft:  [number, number, number] = [-oh, -oh, eaveZ];
  const frontEaveRight: [number, number, number] = [D.mainW + oh, -oh, eaveZ];
  const ridgeLeft:      [number, number, number] = [-oh, ridgeY, ridgeZ];
  const ridgeRight:     [number, number, number] = [D.mainW + oh, ridgeY, ridgeZ];
  const backEaveRight:  [number, number, number] = [D.mainW + oh, D.mainD + oh, eaveZ];

  // Garage roof (lower, attached on left)
  const garageRidgeY = D.garageD / 2;
  const garageRidgeZ = D.garageH + D.garageR;
  const gFrontEaveLeft:  [number, number, number] = [-D.garageW - oh, -oh, D.garageH];
  const gFrontEaveRight: [number, number, number] = [oh, -oh, D.garageH];
  const gRidgeLeft:      [number, number, number] = [-D.garageW - oh, garageRidgeY, garageRidgeZ];
  const gRidgeRight:     [number, number, number] = [oh, garageRidgeY, garageRidgeZ];
  const gBackEaveRight:  [number, number, number] = [oh, D.garageD + oh, D.garageH];

  return (
    <>
      {/* ═══════════ GARAGE ROOF (drawn first, lower) ═══════════ */}
      {/* Garage front slope */}
      <polygon
        points={pts(gFrontEaveLeft, gFrontEaveRight, gRidgeRight, gRidgeLeft)}
        fill="url(#rh-shingles)"
        stroke="#0a0908"
        strokeWidth="0.8"
      />
      {/* Garage right gable end (small triangle) */}
      <polygon
        points={pts(gFrontEaveRight, gBackEaveRight, gRidgeRight)}
        fill="#3a3128"
        stroke="#0a0908"
        strokeWidth="0.6"
      />
      {/* Garage ridge cap */}
      {(() => {
        const a = pts(gRidgeLeft);
        const b = pts(gRidgeRight);
        return (
          <line
            x1={a.split(',')[0]} y1={a.split(',')[1]}
            x2={b.split(',')[0]} y2={b.split(',')[1]}
            stroke="#1a1612" strokeWidth="2"
          />
        );
      })()}

      {/* ═══════════ MAIN ROOF — sheathing layer (always present) ═══════════ */}
      {/* Front slope sheathing — visible when shingles fail */}
      <polygon
        points={pts(frontEaveLeft, frontEaveRight, ridgeRight, ridgeLeft)}
        fill="url(#rh-sheathing-pat)"
        stroke="#3a2e22"
        strokeWidth="1"
      />

      {/* SWB layer (only visible mid-cascade) */}
      {!sheathingGone && (
        <polygon
          points={pts(frontEaveLeft, frontEaveRight, ridgeRight, ridgeLeft)}
          fill={hasSWB ? 'url(#rh-swb-pat)' : '#3a2e22'}
          opacity={underlaymentExposed ? 0.92 : 0}
          style={{ transition: 'opacity 0.6s cubic-bezier(0.33, 1, 0.68, 1)' }}
        />
      )}

      {/* Shingles + heatmap — disappear when sheathing tears off */}
      {!sheathingGone && (
        <>
          {/* Front slope shingles */}
          <polygon
            points={pts(frontEaveLeft, frontEaveRight, ridgeRight, ridgeLeft)}
            fill="url(#rh-shingles)"
            stroke="#0a0908"
            strokeWidth="1"
            opacity={shinglesLifting ? 0.6 : 1}
            style={{ transition: 'opacity 0.6s' }}
          />
          {/* Heatmap overlay (uplift pressure visualisation) */}
          <polygon
            points={pts(frontEaveLeft, frontEaveRight, ridgeRight, ridgeLeft)}
            fill="url(#rh-heat)"
            opacity="0.78"
            style={{ mixBlendMode: 'overlay', transition: 'opacity 0.4s' }}
          />
          {/* Right gable end (vertical triangle, x = mainW) */}
          <polygon
            points={pts(frontEaveRight, backEaveRight, ridgeRight)}
            fill="#3a3128"
            stroke="#0a0908"
            strokeWidth="0.8"
          />
          {/* Visible shingle courses on front slope — five lines parallel to
              the ridge, evenly spaced from eave to peak */}
          {[0.18, 0.36, 0.54, 0.72, 0.88].map((p) => {
            // Interpolate between eave line and ridge line
            const eaveZP = eaveZ + (ridgeZ - eaveZ) * p;
            const yP = -oh + (ridgeY + oh) * p;
            const a = pts([-oh, yP, eaveZP] as [number, number, number]);
            const b = pts([D.mainW + oh, yP, eaveZP] as [number, number, number]);
            const [x1, y1] = a.split(',').map(Number);
            const [x2, y2] = b.split(',').map(Number);
            return (
              <line
                key={`iso-course-${p}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="rgba(0,0,0,0.42)"
                strokeWidth="0.6"
              />
            );
          })}
          {/* Ridge cap (line from ridgeLeft → ridgeRight) */}
          {(() => {
            const a = pts(ridgeLeft);
            const b = pts(ridgeRight);
            const [x1, y1] = a.split(',').map(Number);
            const [x2, y2] = b.split(',').map(Number);
            return (
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1a1612" strokeWidth="3" />
            );
          })()}
        </>
      )}

      {/* ═══════════ CATASTROPHIC TEAR-OFF ═══════════ */}
      {sheathingGone && (
        <g className="rh-sheathing-fail">
          {/* Glowing tear marker on the bare deck */}
          <polygon
            points={pts(
              [D.mainW * 0.5, D.mainD * 0.3, eaveZ + (ridgeZ - eaveZ) * 0.5],
              [D.mainW * 0.85, D.mainD * 0.15, eaveZ + (ridgeZ - eaveZ) * 0.25],
              [D.mainW * 0.95, D.mainD * 0.4, eaveZ + (ridgeZ - eaveZ) * 0.4],
              [D.mainW * 0.65, D.mainD * 0.55, eaveZ + (ridgeZ - eaveZ) * 0.65],
            )}
            fill="#0a0908"
            stroke="#eb6924"
            strokeWidth="2"
            filter="url(#rh-glow)"
            className="rh-tear-glow"
          />
        </g>
      )}
    </>
  );
}
