/**
 * SectionsPanel — Phase 14.R.4.
 *
 * List of all drawn roof sections inside the RoofingInspector.
 * Each row shows:
 *   • Color swatch (palette-indexed per section.colorIdx)
 *   • Label + section type
 *   • Dimensions (L × W, slope)
 *   • Plan area (sq ft)
 *   • Delete button (×)
 *
 * Click a row → selects the section. Selection highlights the 3D
 * mesh in the scene AND (via the parent inspector) syncs the flat
 * `roofingProjectStore` inputs to the section's dims so the live
 * estimator reflects "this section's quote".
 *
 * When no sections exist yet, shows a friendly onboarding hint.
 */

import { useRoofStore, selectSectionsArray } from '@store/roofStore';
import {
  type RoofSection,
  areaPlan,
  areaActual,
} from '@engine/roofing/RoofGraph';
// Phase 14.R.7 — show the ASCE 7-22 mean-roof-height the aggregator
// will feed into the wind profile for each section.
import { sectionMeanHeightFt } from '@engine/roofing/fl/aggregate';
import { SECTION_PALETTE } from './RoofSection3D';
// Phase 14.R.20 — ridge-axis / slope-direction override for the
// currently-selected polygon + gable/shed section.
import { RoofAxisOverrideControl } from './RoofAxisOverrideControl';

/** Fallback wall height (ft) for sections drawn at z=0. Kept in
 *  sync with the constant in RoofingInspector.tsx. */
const DEFAULT_WALL_HEIGHT_FT = 10;

function fmtSqFt(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} sq ft`;
}

/** Phase 14.R.7 — per-row height readout. Split into its own tiny
 *  subcomponent so the main map doesn't balloon. */
function SectionHeightRow({ section }: { section: RoofSection }) {
  const meanH = sectionMeanHeightFt(section, DEFAULT_WALL_HEIGHT_FT);
  const elevated = section.z > 0;
  return (
    <div style={{
      fontSize: 10,
      color: elevated ? '#ffb74d' : '#666',
      marginTop: 1,
      fontStyle: elevated ? 'normal' : 'italic',
    }}
    title={elevated
      ? `Elevation ${section.z.toFixed(1)}′ + roof offset · ASCE 7-22 mean roof height`
      : 'Ground-floor section (z=0) → default 10 ft walls + roof offset'}
    >
      {elevated
        ? `⇑ z=${section.z.toFixed(1)}′ · wind h=${meanH.toFixed(1)}′`
        : `wind h=${meanH.toFixed(1)}′`}
    </div>
  );
}

const TYPE_LABELS: Record<RoofSection['roofType'], string> = {
  hip: 'Hip',
  gable: 'Gable',
  shed: 'Shed',
  flat: 'Flat',
};

export function SectionsPanel() {
  const sections = useRoofStore(selectSectionsArray);
  const selectedId = useRoofStore((s) => s.selectedSectionId);
  const selectSection = useRoofStore((s) => s.selectSection);
  const removeSection = useRoofStore((s) => s.removeSection);

  const totalPlan = sections.reduce((s, sec) => s + areaPlan(sec), 0);
  const totalActual = sections.reduce((s, sec) => s + areaActual(sec), 0);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#ff9800',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Drawn Sections ({sections.length})
        </div>
        {sections.length > 0 && (
          <div style={{ fontSize: 10, color: '#888' }}>
            {fmtSqFt(totalActual)} actual · {fmtSqFt(totalPlan)} plan
          </div>
        )}
      </div>

      {sections.length === 0 ? (
        <div style={{
          padding: '10px 12px',
          background: '#0e0e16',
          border: '1px dashed #2a2a36',
          borderRadius: 6,
          fontSize: 11,
          color: '#777',
          lineHeight: 1.5,
        }}>
          No sections drawn yet. Use the <strong style={{ color: '#ff9800' }}>Draw Rect</strong>
          {' '}tool in the top-left toolbar to click two corners on the
          ground and commit a roof section.
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          maxHeight: 240,
          overflowY: 'auto',
        }}>
          {sections.map((sec) => {
            const selected = sec.sectionId === selectedId;
            const color = SECTION_PALETTE[sec.colorIdx % SECTION_PALETTE.length]!;
            return (
              <div
                key={sec.sectionId}
                onClick={() => selectSection(sec.sectionId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  background: selected ? `${color}22` : '#0e0e16',
                  border: `1px solid ${selected ? color : '#222'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'background 120ms, border-color 120ms',
                }}
                title="Click to select and populate the inspector with this section's dimensions"
              >
                {/* Color swatch */}
                <div style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: color,
                  flexShrink: 0,
                }} />

                {/* Label + info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12,
                    color: selected ? color : '#ddd',
                    fontWeight: selected ? 600 : 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {sec.label}
                    <span style={{
                      marginLeft: 6,
                      fontSize: 10,
                      color: '#666',
                      fontWeight: 400,
                    }}>
                      · {TYPE_LABELS[sec.roofType]} · {sec.slope}:12
                    </span>
                  </div>
                  <div style={{
                    fontSize: 10,
                    color: '#777',
                    marginTop: 1,
                  }}>
                    {sec.length.toFixed(1)}′ × {sec.run.toFixed(1)}′ · {fmtSqFt(areaActual(sec))}
                  </div>
                  {/* Phase 14.R.7 — effective ASCE 7-22 mean-roof-height.
                      Shown on every row for transparency: "wind h = X ft".
                      Sections with explicit elevation (z > 0) get a
                      subtle highlight to cue the user that THIS section's
                      wind pressure differs from the ground-floor default. */}
                  <SectionHeightRow section={sec} />
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSection(sec.sectionId);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#555',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: '2px 6px',
                    borderRadius: 3,
                  }}
                  title={`Delete ${sec.label}`}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ef5350';
                    e.currentTarget.style.background = '#441818';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#555';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      {/* Phase 14.R.20 — ridge / slope-direction control for the
          selected polygon + gable/shed section. Self-gates on the
          section type so it's invisible when not relevant. */}
      <RoofAxisOverrideControl />
    </div>
  );
}
