/**
 * PipeInspector — 2D HUD panel showing properties of the selected pipe.
 *
 * Appears bottom-right when a pipe is clicked. Shows engineering data:
 *   - Length, diameter, material
 *   - Slope (drainage pipes)
 *   - Flow velocity, pressure drop
 *   - Compliance status with code references
 *   - Material cost (BOM line item)
 *
 * Hides when the pipe is deselected (click empty canvas).
 */

import { useMemo } from 'react';
import { usePipeStore } from '@store/pipeStore';
import { useCappedEndpointStore } from '@store/cappedEndpointStore';
import { eventBus } from '@core/EventBus';
import { EV, type Vec3, type PipeCompletePayload } from '@core/events';
import type { PipeMaterial } from '../engine/graph/GraphEdge';
import type { SystemType } from '../engine/graph/GraphNode';

// ── Edit action constants ────────────────────────────────────────

const DIAMETERS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8];

const MATERIALS: Array<{ key: PipeMaterial; label: string }> = [
  { key: 'pvc_sch40',        label: 'PVC Sch40' },
  { key: 'pvc_sch80',        label: 'PVC Sch80' },
  { key: 'abs',              label: 'ABS' },
  { key: 'cpvc',             label: 'CPVC' },
  { key: 'pex',              label: 'PEX' },
  { key: 'copper_type_l',    label: 'Copper L' },
  { key: 'copper_type_m',    label: 'Copper M' },
  { key: 'cast_iron',        label: 'Cast Iron' },
  { key: 'ductile_iron',     label: 'Ductile Iron' },
  { key: 'galvanized_steel', label: 'Galvanized' },
];

const SYSTEMS: Array<{ key: SystemType; label: string; color: string }> = [
  { key: 'cold_supply', label: 'Cold Supply', color: '#29b6f6' },
  { key: 'hot_supply',  label: 'Hot Supply',  color: '#ff7043' },
  { key: 'waste',       label: 'Waste / DWV', color: '#ef5350' },
  { key: 'vent',        label: 'Vent',        color: '#66bb6a' },
  { key: 'storm',       label: 'Storm',       color: '#78909c' },
  { key: 'condensate',  label: 'Condensate',  color: '#9575cd' },
];

// ── Helpers ─────────────────────────────────────────────────────

function pipeLength(points: Vec3[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]![0] - points[i - 1]![0];
    const dy = points[i]![1] - points[i - 1]![1];
    const dz = points[i]![2] - points[i - 1]![2];
    len += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return len;
}

function pipeSlope(points: Vec3[]): number {
  if (points.length < 2) return 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dy = Math.abs(last[1] - first[1]);
  const dx = Math.sqrt(
    (last[0] - first[0]) ** 2 + (last[2] - first[2]) ** 2,
  );
  return dx > 0 ? (dy / dx) * 12 : 0; // in/ft
}

function formatMaterial(mat: string): string {
  return mat
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Component ───────────────────────────────────────────────────

export function PipeInspector() {
  const selectedId = usePipeStore((s) => s.selectedId);
  const pipe = usePipeStore((s) => s.selectedId ? s.pipes[s.selectedId] : null);
  const removePipe = usePipeStore((s) => s.removePipe);
  const updateDiameter = usePipeStore((s) => s.updateDiameter);
  const setMaterial = usePipeStore((s) => s.setMaterial);
  const setSystem = usePipeStore((s) => s.setSystem);
  const selectPipe = usePipeStore((s) => s.selectPipe);
  // Phase 7.D.iii — subscribe so the UI reacts when caps appear/disappear.
  const caps = useCappedEndpointStore((s) => s.caps);
  const removeCapAt = useCappedEndpointStore((s) => s.removeCapAt);

  // Per-endpoint cap lookup for the selected pipe.
  const endpointCaps = useMemo(() => {
    if (!pipe) return { first: null, last: null };
    const pts = pipe.points;
    if (pts.length < 2) return { first: null, last: null };
    const firstPos = pts[0]!;
    const lastPos = pts[pts.length - 1]!;
    // Scan caps map for ones within JOIN_EPSILON of either endpoint.
    const eps = 0.05;
    let first = null, last = null;
    for (const c of Object.values(caps)) {
      const d1 = Math.hypot(c.position[0]-firstPos[0], c.position[1]-firstPos[1], c.position[2]-firstPos[2]);
      const d2 = Math.hypot(c.position[0]-lastPos[0],  c.position[1]-lastPos[1],  c.position[2]-lastPos[2]);
      if (d1 <= eps) first = c;
      if (d2 <= eps) last = c;
    }
    return { first, last };
  }, [pipe, caps]);

  if (!pipe) return null;

  const length = pipeLength(pipe.points);
  const slope = pipeSlope(pipe.points);
  const segments = pipe.points.length - 1;
  const bends = pipe.points.length - 2;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ ...styles.colorDot, backgroundColor: pipe.color }} />
        <span style={styles.title}>PIPE INSPECTOR</span>
        <span style={styles.idBadge}>{pipe.id}</span>
      </div>

      {/* Properties grid */}
      <div style={styles.grid}>
        <Row label="Length" value={`${length.toFixed(1)} ft`} />
        <Row label="Diameter" value={`${pipe.diameter}"`} />
        <Row label="Material" value={formatMaterial(pipe.material)} />
        <Row label="System" value={pipe.system.replace(/_/g, ' ')} />
        <Row label="Segments" value={String(segments)} />
        {bends > 0 && <Row label="Bends" value={String(bends)} />}
        {slope > 0 && (
          <Row
            label="Slope"
            value={`${slope.toFixed(2)}"/ft`}
            warn={slope < 0.25 && pipe.system === 'waste'}
          />
        )}
      </div>

      {/* Phase 7.D.iii — caps on this pipe's endpoints. One button per
          capped endpoint: "Uncap" removes the plug, turning the endpoint
          back into an open connection. */}
      {(endpointCaps.first || endpointCaps.last) && (
        <div style={styles.capsSection}>
          <div style={styles.capsHeader}>Capped endpoints</div>
          {endpointCaps.first && (
            <button
              style={styles.uncapBtn}
              onClick={() => {
                if (!pipe) return;
                removeCapAt(pipe.points[0]!);
              }}
            >
              ⨯ Uncap start
            </button>
          )}
          {endpointCaps.last && (
            <button
              style={styles.uncapBtn}
              onClick={() => {
                if (!pipe) return;
                removeCapAt(pipe.points[pipe.points.length - 1]!);
              }}
            >
              ⨯ Uncap end
            </button>
          )}
        </div>
      )}

      {/* Cost estimate */}
      <div style={styles.costRow}>
        <span style={styles.costLabel}>Est. Material</span>
        <span style={styles.costValue}>
          ${(length * (pipe.diameter * 2 + 3)).toFixed(0)}
        </span>
      </div>

      {/* Phase 14.AD.31 — edit controls. Diameter stepper,
          material/system dropdowns, duplicate + delete. The
          Delete button is visibly distinct (red) so it's the
          obvious primary action; the existing Delete/Backspace
          keyboard shortcut remains as an alt path. */}
      <div style={styles.editSection}>
        {/* Diameter stepper */}
        <div style={styles.editRow}>
          <span style={styles.editLabel}>Ø</span>
          <button
            style={styles.stepBtn}
            onClick={() => {
              const idx = DIAMETERS.findIndex((d) => d >= pipe.diameter);
              const prev = DIAMETERS[Math.max(0, idx - 1)] ?? pipe.diameter;
              if (prev !== pipe.diameter) updateDiameter(pipe.id, prev);
            }}
            title="Smaller diameter"
          >−</button>
          <span style={styles.stepValue}>{pipe.diameter}&quot;</span>
          <button
            style={styles.stepBtn}
            onClick={() => {
              const idx = DIAMETERS.findIndex((d) => d > pipe.diameter);
              const next = idx >= 0 ? DIAMETERS[idx] : DIAMETERS[DIAMETERS.length - 1];
              if (next !== pipe.diameter) updateDiameter(pipe.id, next!);
            }}
            title="Larger diameter"
          >+</button>
        </div>

        {/* Material dropdown */}
        <div style={styles.editRow}>
          <span style={styles.editLabel}>Mat</span>
          <select
            style={styles.select}
            value={pipe.material}
            onChange={(e) => setMaterial(pipe.id, e.target.value)}
          >
            {MATERIALS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* System dropdown */}
        <div style={styles.editRow}>
          <span style={styles.editLabel}>Sys</span>
          <select
            style={{
              ...styles.select,
              color: SYSTEMS.find((s) => s.key === pipe.system)?.color ?? '#ccc',
            }}
            value={pipe.system}
            onChange={(e) => setSystem(pipe.id, e.target.value as SystemType)}
          >
            {SYSTEMS.map((s) => (
              <option key={s.key} value={s.key} style={{ color: s.color }}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Action buttons row */}
        <div style={styles.actionsRow}>
          <button
            style={styles.duplicateBtn}
            onClick={() => {
              // Duplicate — offset the copy by 1 ft in +X (visible
              // enough to see both pipes). User can drag the new
              // copy wherever they need.
              const id = `pipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
              const offset: Vec3[] = pipe.points.map((p) => [p[0] + 1, p[1], p[2]]);
              const payload: PipeCompletePayload = {
                id,
                points: offset,
                diameter: pipe.diameter,
                material: pipe.material,
              };
              eventBus.emit(EV.PIPE_COMPLETE, payload);
              // Select the NEW pipe so the inspector follows the
              // user's focus to the copy they just made.
              selectPipe(id);
            }}
            title="Duplicate pipe (offset 1 ft)"
          >
            📋 Duplicate
          </button>
          <button
            style={styles.deleteBtn}
            onClick={() => {
              if (!selectedId) return;
              removePipe(selectedId);
            }}
            title="Delete pipe (Del)"
          >
            🗑 Delete
          </button>
        </div>

        {/* Deselect footer hint */}
        <div style={styles.hintRow}>
          <span style={styles.hintText}>
            Click empty space or Esc to deselect
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Row component ───────────────────────────────────────────────

function Row({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <span style={{ ...styles.value, color: warn ? '#ff1744' : '#ccc' }}>
        {value}
        {warn && ' ⚠'}
      </span>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    // Bottom-right of the viewport is now occupied by (right→left):
    //   PhaseBOMPanel (right:12, w:290) → DRAWING wheel icon (right:320, w:58).
    // Park the inspector left of those two, leaving a small gap.
    bottom: 16,
    right: 400,
    width: 240,
    padding: 12,
    borderRadius: 10,
    border: '1px solid #333',
    background: 'rgba(10,10,15,0.92)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'auto',
    zIndex: 25,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: '1px solid #222',
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  title: {
    fontSize: 10,
    fontWeight: 700,
    color: '#eee',
    letterSpacing: 1.5,
    flex: 1,
  },
  idBadge: {
    fontSize: 8,
    color: '#666',
    border: '1px solid #333',
    borderRadius: 4,
    padding: '1px 5px',
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 11,
    color: '#888',
  },
  value: {
    fontSize: 11,
    color: '#ccc',
    fontWeight: 500,
  },
  costRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid #222',
  },
  costLabel: {
    fontSize: 11,
    color: '#888',
  },
  costValue: {
    fontSize: 14,
    color: '#00e676',
    fontWeight: 700,
  },
  // Phase 7.D.iii — cap section
  capsSection: {
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid #222',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  capsHeader: {
    fontSize: 10,
    color: '#ffa726',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: 700,
  },
  uncapBtn: {
    padding: '4px 8px',
    background: 'rgba(255,167,38,0.08)',
    border: '1px solid rgba(255,167,38,0.4)',
    color: '#ffa726',
    fontSize: 11,
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  // Phase 14.AD.31 — edit controls
  editSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid #222',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  editRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  editLabel: {
    fontSize: 10,
    color: '#666',
    fontWeight: 700,
    letterSpacing: 1,
    width: 22,
  },
  stepBtn: {
    width: 22,
    height: 22,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid #333',
    color: '#ccc',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: '18px',
    padding: 0,
    fontFamily: 'inherit',
  },
  stepValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: '#ccc',
    fontWeight: 500,
  },
  select: {
    flex: 1,
    padding: '3px 6px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid #333',
    color: '#ccc',
    borderRadius: 3,
    fontSize: 11,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  actionsRow: {
    display: 'flex',
    gap: 6,
    marginTop: 4,
  },
  duplicateBtn: {
    flex: 1,
    padding: '6px 8px',
    background: 'rgba(100,181,246,0.08)',
    border: '1px solid rgba(100,181,246,0.4)',
    color: '#64b5f6',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  deleteBtn: {
    flex: 1,
    padding: '6px 8px',
    background: 'rgba(239,83,80,0.1)',
    border: '1px solid rgba(239,83,80,0.5)',
    color: '#ef5350',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  hintRow: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: 2,
  },
  hintText: {
    fontSize: 9,
    color: '#555',
    fontStyle: 'italic',
  },
};
