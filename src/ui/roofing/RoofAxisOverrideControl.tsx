/**
 * RoofAxisOverrideControl — Phase 14.R.20.
 *
 * Small inline control that surfaces the selected section's
 * `roofAxisOverrideDeg` field when the section is a polygon +
 * gable/shed. Lets a contractor nudge the gable ridge (or shed
 * slope direction) off the bbox-derived auto-pick — e.g., orient
 * the ridge parallel to the lot line instead of the bbox long axis.
 *
 * Hidden when no section is selected OR the selected section isn't
 * a polygon OR its roof type isn't gable/shed.
 *
 * Behavior:
 *   • Defaults to the current auto-pick value (0° or 90°) if no
 *     override has been set yet.
 *   • "Reset" clears the override so the section reverts to the
 *     auto-pick behavior.
 *   • Writes go through `updateSection(sid, { roofAxisOverrideDeg })`
 *     → one undo entry per edit.
 */

import { useRoofStore } from '@store/roofStore';
import {
  polygonBoundingBox,
  type RoofSection,
} from '@engine/roofing/RoofGraph';

function isAxisRoofType(roofType: RoofSection['roofType']): boolean {
  return roofType === 'gable' || roofType === 'shed';
}

function autoPickAxisDeg(
  polygon: ReadonlyArray<readonly [number, number]>,
  roofType: RoofSection['roofType'],
): number | null {
  const bbox = polygonBoundingBox(polygon);
  if (!bbox) return null;
  const bboxW = bbox.maxX - bbox.minX;
  const bboxH = bbox.maxY - bbox.minY;
  if (bboxW <= 0 || bboxH <= 0) return null;
  // Gable: ridge along bbox long axis. Shed: perpendicular to that.
  if (roofType === 'gable') return bboxW >= bboxH ? 0 : 90;
  if (roofType === 'shed')  return bboxH <= bboxW ? 90 : 0;
  return null;
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: '#ffb74d', // roofing accent muted
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 600,
  marginBottom: 4,
};

const ROW: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

const INPUT: React.CSSProperties = {
  flex: 1,
  background: '#0e0e16',
  border: '1px solid #2a2a36',
  borderRadius: 5,
  color: '#e5e5e5',
  padding: '4px 6px',
  fontSize: 12,
  fontFamily: 'system-ui, sans-serif',
};

const BTN: React.CSSProperties = {
  background: '#181823',
  border: '1px solid #333',
  color: '#ccc',
  padding: '4px 10px',
  borderRadius: 5,
  fontSize: 11,
  cursor: 'pointer',
};

export function RoofAxisOverrideControl() {
  const section = useRoofStore((s) =>
    s.selectedSectionId ? (s.sections[s.selectedSectionId] ?? null) : null,
  );
  const updateSection = useRoofStore((s) => s.updateSection);

  if (!section) return null;
  if (!section.polygon || section.polygon.length < 3) return null;
  if (!isAxisRoofType(section.roofType)) return null;

  const auto = autoPickAxisDeg(section.polygon, section.roofType);
  const hasOverride = section.roofAxisOverrideDeg !== undefined
    && section.roofAxisOverrideDeg !== null;
  const effective = hasOverride ? section.roofAxisOverrideDeg! : (auto ?? 0);

  const label = section.roofType === 'gable'
    ? 'Ridge axis (°)'
    : 'Slope direction (°)';

  return (
    <div style={{
      marginTop: 10,
      padding: 10,
      background: '#0a0a0f',
      border: '1px solid #222',
      borderRadius: 6,
    }}>
      <div style={LABEL_STYLE}>{label}</div>
      <div style={ROW}>
        <input
          type="number"
          step={1}
          value={effective}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            updateSection(section.sectionId, { roofAxisOverrideDeg: v });
          }}
          style={INPUT}
        />
        <button
          style={BTN}
          onClick={() =>
            updateSection(section.sectionId, { roofAxisOverrideDeg: undefined })
          }
          disabled={!hasOverride}
          title={hasOverride
            ? `Revert to auto-pick (${auto ?? 0}°)`
            : 'Currently matches auto-pick'}
        >
          ↻ Auto
        </button>
      </div>
      {hasOverride && auto !== null && (
        <div style={{ color: '#777', fontSize: 10, marginTop: 4 }}>
          Overriding auto-pick of {auto}°.
        </div>
      )}
    </div>
  );
}
