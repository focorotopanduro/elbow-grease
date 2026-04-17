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
import type { Vec3 } from '@core/events';

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

      {/* Cost estimate */}
      <div style={styles.costRow}>
        <span style={styles.costLabel}>Est. Material</span>
        <span style={styles.costValue}>
          ${(length * (pipe.diameter * 2 + 3)).toFixed(0)}
        </span>
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
};
