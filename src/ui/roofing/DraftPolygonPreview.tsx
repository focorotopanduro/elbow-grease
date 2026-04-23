/**
 * DraftPolygonPreview — Phase 14.R.9.
 *
 * In-progress polygon ghost rendered while the user is clicking
 * through the vertex sequence. Shows:
 *
 *   • Committed edges (solid polyline between the placed vertices)
 *   • Rubber-band to the live cursor (dashed line from the last
 *     vertex to the current pointer)
 *   • Closing hint when the polygon has ≥ 3 vertices AND the cursor
 *     is within the close-threshold of vertex 0 — that edge glows
 *     gold to telegraph "click here to close the loop"
 *   • Numbered spheres at each committed vertex
 *   • Live area + perimeter readout at the cursor
 *
 * Mounts only in `draw-polygon` mode AND when at least one vertex
 * has been placed. Subscribes narrowly to `polygonVertices` +
 * `draftEnd` so unrelated store changes don't cause re-renders.
 */

import { useMemo } from 'react';
import { Line, Text } from '@react-three/drei';
import {
  useRoofingDrawStore,
  type GroundPoint,
} from '@store/roofingDrawStore';
import {
  polygonArea,
  polygonPerimeter,
} from '@engine/roofing/RoofGraph';

const ACCENT = '#ff9800';
const CLOSE_COLOR = '#ffd54f';
const VERTEX_RADIUS = 0.22;
const CLOSE_RADIUS_FT = 0.75;

function distance(a: GroundPoint, b: GroundPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function DraftPolygonPreview() {
  const mode = useRoofingDrawStore((s) => s.mode);
  const verts = useRoofingDrawStore((s) => s.polygonVertices);
  const cursor = useRoofingDrawStore((s) => s.draftEnd);

  const readout = useMemo(() => {
    if (verts.length < 2) return null;
    // Include the live cursor as a phantom vertex so the area/perimeter
    // readout tracks the pointer in real time.
    const closing: GroundPoint[] = cursor ? [...verts, cursor] : [...verts];
    return {
      area: polygonArea(closing),
      per: polygonPerimeter(closing),
    };
  }, [verts, cursor]);

  if (mode !== 'draw-polygon') return null;
  if (verts.length === 0 && !cursor) return null;

  const y = 0.01;
  const toThree = (p: GroundPoint): [number, number, number] => [p[0], y, p[1]];

  // Decide whether the cursor is close enough to v0 to trigger the
  // "closing hint" visual.
  const closing =
    verts.length >= 3
    && cursor !== null
    && distance(cursor, verts[0]!) <= CLOSE_RADIUS_FT;

  // Edges already committed (solid orange).
  const committedEdges: [number, number, number][] = verts.map(toThree);

  return (
    <group>
      {/* Numbered vertex markers */}
      {verts.map((v, i) => (
        <group key={i} position={toThree(v)}>
          <mesh>
            <sphereGeometry args={[VERTEX_RADIUS, 12, 12]} />
            <meshBasicMaterial color={i === 0 ? CLOSE_COLOR : ACCENT} toneMapped={false} />
          </mesh>
          <Text
            position={[0, 0.3, 0]}
            fontSize={0.35}
            color="#fff"
            anchorX="center"
            anchorY="middle"
            rotation={[-Math.PI / 2, 0, 0]}
          >
            {String(i + 1)}
          </Text>
        </group>
      ))}

      {/* Solid polyline between committed vertices */}
      {committedEdges.length >= 2 && (
        <Line
          points={committedEdges}
          color={ACCENT}
          lineWidth={2}
          transparent
          opacity={0.9}
        />
      )}

      {/* Rubber band from last committed vertex to the live cursor */}
      {verts.length > 0 && cursor && (
        <Line
          points={[toThree(verts[verts.length - 1]!), toThree(cursor)]}
          color={ACCENT}
          lineWidth={1.5}
          dashed
          dashSize={0.35}
          gapSize={0.22}
          transparent
          opacity={0.85}
        />
      )}

      {/* Rubber band from cursor back to v0 (showing the closing edge) */}
      {verts.length >= 2 && cursor && (
        <Line
          points={[toThree(cursor), toThree(verts[0]!)]}
          color={closing ? CLOSE_COLOR : ACCENT}
          lineWidth={closing ? 3 : 1.2}
          dashed
          dashSize={closing ? 0.25 : 0.4}
          gapSize={closing ? 0.15 : 0.3}
          transparent
          opacity={closing ? 1 : 0.55}
        />
      )}

      {/* Live area + perimeter readout floating near the cursor */}
      {readout && cursor && (
        <Text
          position={[cursor[0] + 0.8, y + 0.2, cursor[1] - 0.8]}
          fontSize={0.42}
          color={closing ? CLOSE_COLOR : ACCENT}
          anchorX="left"
          anchorY="middle"
          rotation={[-Math.PI / 2, 0, 0]}
        >
          {`${Math.round(readout.area)} sq ft · ${readout.per.toFixed(1)}′ perim`}
        </Text>
      )}

      {/* Closing hint label */}
      {closing && (
        <Text
          position={[verts[0]![0], y + 0.25, verts[0]![1] - 1.4]}
          fontSize={0.32}
          color={CLOSE_COLOR}
          anchorX="center"
          anchorY="middle"
          rotation={[-Math.PI / 2, 0, 0]}
        >
          ⟲ Click to close
        </Text>
      )}
    </group>
  );
}
