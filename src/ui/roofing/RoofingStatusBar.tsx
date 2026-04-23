/**
 * RoofingStatusBar — peer to the plumbing `StatusBar`, mounted
 * while `appMode === 'roofing'`.
 *
 * Phase 9.1 mode-gated the plumbing StatusBar so the bottom strip
 * was completely blank in roofing mode. This fills the slot with
 * roofing-relevant information:
 *   • Active draw mode (IDLE / DRAW RECT / DRAW POLY / PLACE
 *     PENETRATION) with its kind when placing.
 *   • Section + penetration counts for at-a-glance project scale.
 *   • Selected section's label + area when one's active.
 *   • Mode-specific hint text — what the next click will do.
 *
 * The bar carries the workspace's orange accent as a persistent
 * 2px top border so the user gets an instant "this is roofing"
 * signal from the peripheral vision, matching the cyan accent on
 * the plumbing StatusBar. Interaction-mode-specific colors
 * (per draw sub-mode) still colour the mode-label badge for
 * finer-grained status.
 */

import { useRoofStore } from '@store/roofStore';
import { useRoofingDrawStore } from '@store/roofingDrawStore';
import { APP_MODE_ACCENTS } from '@store/appModeStore';
import { areaActual, PENETRATION_LABELS } from '@engine/roofing/RoofGraph';
import type { RoofingDrawMode } from '@store/roofingDrawStore';
import type { PenetrationKind, RoofSection } from '@engine/roofing/RoofGraph';

const ACCENT = APP_MODE_ACCENTS.roofing;

const DRAW_MODE_LABELS: Record<RoofingDrawMode, { text: string; color: string; hint: string }> = {
  'idle': {
    text: 'IDLE',
    color: '#888',
    hint: 'Pick a tool in the toolbar — rectangle, polygon, or penetration marker',
  },
  'draw-rect': {
    text: 'DRAW RECT',
    color: '#ff9800',
    hint: 'Click two corners on the ground · ESC cancels',
  },
  'draw-polygon': {
    text: 'DRAW POLY',
    color: '#ffb74d',
    hint: 'Click each vertex (≥3) · Enter / click vertex 1 to close · Backspace undoes · ESC cancels',
  },
  'place-penetration': {
    text: 'PLACE',
    color: '#ff5722',
    hint: 'Click on the roof to drop the marker · ESC cancels',
  },
};

const PENETRATION_COLORS: Record<PenetrationKind, string> = {
  chimney:       '#8d6e63',
  skylight:      '#4fc3f7',
  plumbing_vent: '#b87333',
};

export function RoofingStatusBar() {
  const drawMode = useRoofingDrawStore((s) => s.mode);
  const penetrationKind = useRoofingDrawStore((s) => s.penetrationKind);
  // Subscribe to the vertex array's length + raw array only when a
  // polygon draw is active. `polygonVertices` itself IS a new array
  // per set() call, but Zustand's default equality catches that at
  // the array-reference level — acceptable because the array only
  // changes on click (low frequency) and no other subscriber here
  // depends on its identity.
  const polygonVertices = useRoofingDrawStore((s) => s.polygonVertices);
  // Subscribe to COUNTS, not the full arrays. The selectX selectors
  // construct a fresh array on every call; feeding them straight to
  // `useRoofStore(selector)` triggers infinite re-renders because
  // Zustand's reference-equality sees a new array every time.
  const sectionCount = useRoofStore((s) => s.sectionOrder.length);
  const penetrationCount = useRoofStore((s) => s.penetrationOrder.length);
  // Selected section: `s.sections[id]` returns a stable object
  // reference between edits (mutations create a new section object
  // only for the section that changed), so this is safe.
  const selectedSection = useRoofStore<RoofSection | null>((s) => {
    const id = s.selectedSectionId;
    if (!id) return null;
    return s.sections[id] ?? null;
  });

  const modeInfo = DRAW_MODE_LABELS[drawMode];

  // Mid-polygon vertex count inlines into the hint so the user
  // sees progress without having to count on the 3D preview.
  let hint = modeInfo.hint;
  if (drawMode === 'draw-polygon' && polygonVertices.length > 0) {
    const closeReady = polygonVertices.length >= 3;
    hint = `${polygonVertices.length} vertex${polygonVertices.length !== 1 ? 'es' : ''} placed${
      closeReady ? ' · Enter or click vertex 1 to close' : ' · need ≥ 3 to close'
    } · Backspace undoes · ESC cancels`;
  }

  return (
    <div style={styles.bar}>
      {/* Draw mode badge */}
      <div style={{ ...styles.badge, borderColor: modeInfo.color, color: modeInfo.color }}>
        {modeInfo.text}
      </div>

      {/* Armed penetration kind badge, shown only during place mode */}
      {drawMode === 'place-penetration' && (
        <div style={{
          ...styles.badge,
          borderColor: PENETRATION_COLORS[penetrationKind],
          color: PENETRATION_COLORS[penetrationKind],
        }}>
          {PENETRATION_LABELS[penetrationKind].toUpperCase()}
        </div>
      )}

      {/* Selected section summary */}
      {selectedSection && (
        <div style={styles.selBadge}>
          <span style={styles.selLabel}>
            {selectedSection.label || selectedSection.sectionId}
          </span>
          <span style={styles.selMeta}>
            {areaActual(selectedSection).toFixed(0)} sqft · slope {selectedSection.slope}:12
          </span>
        </div>
      )}

      {/* Hint text fills the middle */}
      <span style={styles.hint}>{hint}</span>

      {/* Counts */}
      <span style={styles.meta}>
        {sectionCount > 0 ? `${sectionCount} section${sectionCount !== 1 ? 's' : ''}` : ''}
        {sectionCount > 0 && penetrationCount > 0 ? ' · ' : ''}
        {penetrationCount > 0
          ? `${penetrationCount} penetration${penetrationCount !== 1 ? 's' : ''}`
          : ''}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 16px 0 260px', // clears the RoofingToolbar (wider than plumbing)
    background: 'rgba(10,10,15,0.95)',
    // Workspace-accent: 2px orange strip along the top so the
    // user knows "roofing" at a glance even without reading text.
    borderTop: `2px solid ${ACCENT}`,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'none',
    zIndex: 25,
  },
  badge: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1,
    padding: '2px 8px',
    borderRadius: 4,
    border: '1px solid',
  },
  selBadge: {
    display: 'flex',
    gap: 6,
    alignItems: 'baseline',
    padding: '2px 8px',
    border: `1px solid ${ACCENT}44`,
    borderRadius: 4,
    background: `${ACCENT}11`,
  },
  selLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: ACCENT,
  },
  selMeta: {
    fontSize: 9,
    color: '#888',
  },
  hint: {
    fontSize: 11,
    color: '#666',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: 10,
    // Mirrors plumbing StatusBar's meta colour so the two status
    // bars read the same weight when comparing side-by-side.
    color: '#444',
  },
};
