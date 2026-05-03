import { iso, pts, ISO_DIMS } from './projection';

/**
 * HouseStructureIso — the same building seen from upper-right-front.
 *
 * Three visible faces per box (front, right, top — but top is the roof,
 * handled separately in RoofAssemblyIso). Hidden faces (back, left,
 * bottom) are skipped — every poly we draw faces the camera.
 *
 * The blueprint look: flat fills + dark stroke outlines, no AO/face-light
 * gradients. This is a CAD drawing, not a photoreal scene. Color comes
 * from the wall/door theme so the customizer still works.
 */
interface Props {
  /** Wall fill color (theme-driven) */
  wallFill: string;
  /** Wall trim color (frames, sills) */
  trimColor: string;
  /** Front door fill */
  doorFill: string;
  /** Front door panel-stroke (recessed mortise color) */
  doorPanelStroke: string;
}

const D = ISO_DIMS;

export default function HouseStructureIso({
  wallFill,
  trimColor,
  doorFill,
  doorPanelStroke,
}: Props) {
  return (
    <>
      {/* ─────────── FOUNDATION (subtle shadow strip below z=0) ─────────── */}
      {/* Front foundation face */}
      <polygon
        points={pts([0, 0, 0], [D.mainW, 0, 0], [D.mainW, 0, -D.foundH], [0, 0, -D.foundH])}
        fill="#2a2420"
        stroke="#0a0908"
        strokeWidth="0.6"
      />
      {/* Right foundation face */}
      <polygon
        points={pts([D.mainW, 0, 0], [D.mainW, D.mainD, 0], [D.mainW, D.mainD, -D.foundH], [D.mainW, 0, -D.foundH])}
        fill="#1c1814"
        stroke="#0a0908"
        strokeWidth="0.6"
      />

      {/* ─────────── GARAGE (attached on the LEFT, x ∈ [−garageW, 0]) ─────────── */}
      {/* Front face */}
      <polygon
        points={pts(
          [-D.garageW, 0, 0],
          [0, 0, 0],
          [0, 0, D.garageH],
          [-D.garageW, 0, D.garageH],
        )}
        fill={wallFill}
        stroke="#0a0908"
        strokeWidth="0.8"
      />
      {/* Right face — visible because of perspective */}
      <polygon
        points={pts(
          [0, 0, 0],
          [0, D.garageD, 0],
          [0, D.garageD, D.garageH],
          [0, 0, D.garageH],
        )}
        fill="#5a4f44"
        stroke="#0a0908"
        strokeWidth="0.6"
        opacity="0.85"
      />

      {/* Garage door — paneled white, on the front face */}
      <polygon
        points={pts(
          [-D.garageW + 12, 0, 6],
          [-12, 0, 6],
          [-12, 0, D.garageH - 6],
          [-D.garageW + 12, 0, D.garageH - 6],
        )}
        fill="#e8e3da"
        stroke="#0a0908"
        strokeWidth="0.6"
      />
      {/* Garage door panel divisions (4 horizontal courses) */}
      {[0.2, 0.4, 0.6, 0.8].map((p) => {
        const z = 6 + (D.garageH - 12) * p;
        const [x1, y1] = iso(-D.garageW + 12, 0, z);
        const [x2, y2] = iso(-12, 0, z);
        return (
          <line key={`gh-${p}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#a89e8e" strokeWidth="0.5" />
        );
      })}

      {/* ─────────── MAIN HOUSE BODY ─────────── */}
      {/* Front face */}
      <polygon
        points={pts(
          [0, 0, 0],
          [D.mainW, 0, 0],
          [D.mainW, 0, D.mainH],
          [0, 0, D.mainH],
        )}
        fill={wallFill}
        stroke="#0a0908"
        strokeWidth="1"
      />
      {/* Right face — receding into depth, slightly darker for depth cue */}
      <polygon
        points={pts(
          [D.mainW, 0, 0],
          [D.mainW, D.mainD, 0],
          [D.mainW, D.mainD, D.mainH],
          [D.mainW, 0, D.mainH],
        )}
        fill="#5a4f44"
        stroke="#0a0908"
        strokeWidth="0.8"
        opacity="0.88"
      />

      {/* ─────────── WINDOWS on front face ─────────── */}
      {/* Left window */}
      <polygon
        points={pts(
          [D.winLX0, 0, D.winY0],
          [D.winLX1, 0, D.winY0],
          [D.winLX1, 0, D.winY1],
          [D.winLX0, 0, D.winY1],
        )}
        fill={trimColor}
        stroke="#0a0908"
        strokeWidth="0.5"
      />
      <polygon
        points={pts(
          [D.winLX0 + 3, 0, D.winY0 + 3],
          [D.winLX1 - 3, 0, D.winY0 + 3],
          [D.winLX1 - 3, 0, D.winY1 - 3],
          [D.winLX0 + 3, 0, D.winY1 - 3],
        )}
        fill="url(#rh-glass)"
      />
      {/* Mullion cross */}
      {(() => {
        const midX = (D.winLX0 + D.winLX1) / 2;
        const midZ = (D.winY0 + D.winY1) / 2;
        const [x1, y1] = iso(midX, 0, D.winY0 + 3);
        const [x2, y2] = iso(midX, 0, D.winY1 - 3);
        const [x3, y3] = iso(D.winLX0 + 3, 0, midZ);
        const [x4, y4] = iso(D.winLX1 - 3, 0, midZ);
        return (
          <>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={trimColor} strokeWidth="1.2" />
            <line x1={x3} y1={y3} x2={x4} y2={y4} stroke={trimColor} strokeWidth="1.2" />
          </>
        );
      })()}

      {/* Right window */}
      <polygon
        points={pts(
          [D.winRX0, 0, D.winY0],
          [D.winRX1, 0, D.winY0],
          [D.winRX1, 0, D.winY1],
          [D.winRX0, 0, D.winY1],
        )}
        fill={trimColor}
        stroke="#0a0908"
        strokeWidth="0.5"
      />
      <polygon
        points={pts(
          [D.winRX0 + 3, 0, D.winY0 + 3],
          [D.winRX1 - 3, 0, D.winY0 + 3],
          [D.winRX1 - 3, 0, D.winY1 - 3],
          [D.winRX0 + 3, 0, D.winY1 - 3],
        )}
        fill="url(#rh-glass)"
      />
      {(() => {
        const midX = (D.winRX0 + D.winRX1) / 2;
        const midZ = (D.winY0 + D.winY1) / 2;
        const [x1, y1] = iso(midX, 0, D.winY0 + 3);
        const [x2, y2] = iso(midX, 0, D.winY1 - 3);
        const [x3, y3] = iso(D.winRX0 + 3, 0, midZ);
        const [x4, y4] = iso(D.winRX1 - 3, 0, midZ);
        return (
          <>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={trimColor} strokeWidth="1.2" />
            <line x1={x3} y1={y3} x2={x4} y2={y4} stroke={trimColor} strokeWidth="1.2" />
          </>
        );
      })()}

      {/* ─────────── FRONT DOOR ─────────── */}
      <polygon
        points={pts(
          [D.doorX0, 0, 0],
          [D.doorX1, 0, 0],
          [D.doorX1, 0, D.doorH],
          [D.doorX0, 0, D.doorH],
        )}
        fill={doorFill}
        stroke="#0a0908"
        strokeWidth="0.6"
      />
      {/* Door panels */}
      <polygon
        points={pts(
          [D.doorX0 + 3, 0, 8],
          [D.doorX1 - 3, 0, 8],
          [D.doorX1 - 3, 0, 32],
          [D.doorX0 + 3, 0, 32],
        )}
        fill="none"
        stroke={doorPanelStroke}
        strokeWidth="0.5"
      />
      <polygon
        points={pts(
          [D.doorX0 + 3, 0, 38],
          [D.doorX1 - 3, 0, 38],
          [D.doorX1 - 3, 0, D.doorH - 6],
          [D.doorX0 + 3, 0, D.doorH - 6],
        )}
        fill="none"
        stroke={doorPanelStroke}
        strokeWidth="0.5"
      />
      {/* Door handle */}
      {(() => {
        const [hx, hy] = iso(D.doorX1 - 6, 0, 36);
        return <circle cx={hx} cy={hy} r="1.6" fill="#d4a04a" />;
      })()}

      {/* ─────────── CHIMNEY (rises from main roof) ─────────── */}
      {/* Front face of chimney */}
      <polygon
        points={pts(
          [D.chimX, D.chimDepthY, D.mainH + 12],
          [D.chimX + D.chimW, D.chimDepthY, D.mainH + 12],
          [D.chimX + D.chimW, D.chimDepthY, D.mainH + 12 + D.chimH],
          [D.chimX, D.chimDepthY, D.mainH + 12 + D.chimH],
        )}
        fill="#5a4f44"
        stroke="#0a0908"
        strokeWidth="0.6"
      />
      {/* Right face of chimney (deeper into Y) */}
      <polygon
        points={pts(
          [D.chimX + D.chimW, D.chimDepthY, D.mainH + 12],
          [D.chimX + D.chimW, D.chimDepthY + D.chimD, D.mainH + 12],
          [D.chimX + D.chimW, D.chimDepthY + D.chimD, D.mainH + 12 + D.chimH],
          [D.chimX + D.chimW, D.chimDepthY, D.mainH + 12 + D.chimH],
        )}
        fill="#3a3128"
        stroke="#0a0908"
        strokeWidth="0.6"
      />
      {/* Top of chimney */}
      <polygon
        points={pts(
          [D.chimX, D.chimDepthY, D.mainH + 12 + D.chimH],
          [D.chimX + D.chimW, D.chimDepthY, D.mainH + 12 + D.chimH],
          [D.chimX + D.chimW, D.chimDepthY + D.chimD, D.mainH + 12 + D.chimH],
          [D.chimX, D.chimDepthY + D.chimD, D.mainH + 12 + D.chimH],
        )}
        fill="#1a1612"
        stroke="#0a0908"
        strokeWidth="0.6"
      />
    </>
  );
}
