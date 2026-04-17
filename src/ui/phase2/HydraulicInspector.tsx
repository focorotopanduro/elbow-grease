/**
 * HydraulicInspector — extended pipe inspector showing solver output.
 *
 * When a pipe is selected, this panel (bottom-right, below the main
 * PipeInspector) reveals the hydraulic state computed by the engine:
 *
 *   Velocity         — ft/s, color-coded (green ≤ 8 ft/s IPC 604.5)
 *   Reynolds number  — laminar <2300, transitional, turbulent >4000
 *   Friction factor  — Darcy f (from Colebrook-White / Swamee-Jain)
 *   Pressure drop    — psi across the selected edge
 *   Flow rate        — GPM, from upstream accumulated demand
 *   Friction method  — which solver produced the factor (adaptive)
 *
 * Data flows from SIM_MSG.EDGE_COMPUTED events emitted by the Web
 * Worker after each solve cycle. Each pipe's last-known hydraulic
 * state is cached in a Map so the UI reads synchronously on select.
 */

import { useEffect, useRef, useState } from 'react';
import { usePipeStore } from '@store/pipeStore';
import { simBus, SIM_MSG, type EdgeComputedPayload } from '../../engine/graph/MessageBus';

// ── Edge state cache ────────────────────────────────────────────

interface EdgeState extends EdgeComputedPayload {
  pipeId: string;
  segmentIndex: number;
}

// ── Helper: map edge ID → pipe ID + segment ─────────────────────

function parseEdgeId(edgeId: string): { pipeId: string; segmentIndex: number } | null {
  const parts = edgeId.split('-');
  if (parts.length < 3) return null;
  const segIdx = Number(parts[parts.length - 1]);
  if (isNaN(segIdx)) return null;
  const pipeId = parts.slice(1, -1).join('-');
  return { pipeId, segmentIndex: segIdx };
}

// ── Flow regime classification ──────────────────────────────────

function flowRegime(re: number): { name: string; color: string } {
  if (re < 2300) return { name: 'Laminar', color: '#66bb6a' };
  if (re < 4000) return { name: 'Transitional', color: '#ffc107' };
  return { name: 'Turbulent', color: '#ff7043' };
}

// ── Component ───────────────────────────────────────────────────

export function HydraulicInspector() {
  const selectedId = usePipeStore((s) => s.selectedId);
  const selectedPipe = usePipeStore((s) => (s.selectedId ? s.pipes[s.selectedId] : null));

  // Cache of last-known edge states keyed by edgeId
  const edgeCache = useRef<Map<string, EdgeState>>(new Map());
  const [, forceUpdate] = useState(0);

  // Subscribe to edge-computed messages
  useEffect(() => {
    return simBus.on(SIM_MSG.EDGE_COMPUTED, (msg) => {
      const payload = msg.payload as EdgeComputedPayload;
      if (!payload?.edgeId) return;
      const parsed = parseEdgeId(payload.edgeId);
      if (!parsed) return;
      edgeCache.current.set(payload.edgeId, {
        ...payload,
        pipeId: parsed.pipeId,
        segmentIndex: parsed.segmentIndex,
      });
    });
  }, []);

  // Refresh UI periodically after new solves
  useEffect(() => {
    const interval = setInterval(() => forceUpdate((x) => x + 1), 500);
    return () => clearInterval(interval);
  }, []);

  if (!selectedPipe) return null;

  // Aggregate edge states for this pipe
  const edges: EdgeState[] = [];
  for (const [, state] of edgeCache.current) {
    if (state.pipeId === selectedPipe.id) edges.push(state);
  }
  edges.sort((a, b) => a.segmentIndex - b.segmentIndex);

  if (edges.length === 0) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>HYDRAULICS</div>
        <div style={styles.empty}>Waiting for solver...</div>
      </div>
    );
  }

  // Compute aggregated stats
  const totalPressureDrop = edges.reduce((s, e) => s + (e.pressureDrop ?? 0), 0);
  const avgVelocity = edges.reduce((s, e) => s + (e.velocity ?? 0), 0) / edges.length;
  const maxVelocity = Math.max(...edges.map((e) => e.velocity ?? 0));
  const avgRe = edges.reduce((s, e) => s + (e.reynolds ?? 0), 0) / edges.length;
  const avgF = edges.reduce((s, e) => s + (e.frictionFactor ?? 0), 0) / edges.length;
  const totalLength = edges.reduce((s, e) => s + (e.equivalentLength ?? 0), 0);
  const totalCost = edges.reduce((s, e) => s + (e.materialCost ?? 0), 0);

  const regime = flowRegime(avgRe);
  const velocityColor = maxVelocity > 8 ? '#ff1744' : maxVelocity > 6 ? '#ffc107' : '#66bb6a';
  const sized = edges.every((e) => e.properlySized !== false);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span>HYDRAULICS</span>
        <span style={styles.solveCount}>{edges.length} seg</span>
      </div>

      <Row label="Velocity (avg)" value={`${avgVelocity.toFixed(2)} ft/s`} color="#aaa" />
      <Row label="Velocity (max)" value={`${maxVelocity.toFixed(2)} ft/s`} color={velocityColor} warn={maxVelocity > 8} />
      <Row label="Reynolds" value={avgRe.toFixed(0)} color="#aaa" />
      <Row label="Flow Regime" value={regime.name} color={regime.color} />
      <Row label="Friction f" value={avgF.toFixed(4)} color="#aaa" />
      <Row label="ΔP total" value={`${totalPressureDrop.toFixed(2)} psi`} color={totalPressureDrop > 5 ? '#ffc107' : '#aaa'} />
      <Row label="Eq. length" value={`${totalLength.toFixed(1)} ft`} color="#aaa" />

      <div style={styles.divider} />
      <Row label="Properly sized" value={sized ? 'Yes' : 'No'} color={sized ? '#66bb6a' : '#ff1744'} />
      <Row label="Material cost" value={`$${totalCost.toFixed(2)}`} color="#00e676" />

      {/* Velocity bar */}
      <div style={styles.barContainer}>
        <div style={styles.barLabel}>Velocity / 8 ft/s limit</div>
        <div style={styles.barTrack}>
          <div style={{
            ...styles.barFill,
            width: `${Math.min(100, (maxVelocity / 8) * 100)}%`,
            backgroundColor: velocityColor,
          }} />
          <div style={styles.barLimit} />
        </div>
      </div>
    </div>
  );
}

// ── Row component ───────────────────────────────────────────────

function Row({ label, value, color, warn }: {
  label: string; value: string; color: string; warn?: boolean;
}) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={{ ...styles.rowValue, color }}>
        {value}{warn ? ' ⚠' : ''}
      </span>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    // Bottom-right stack now: PhaseBOMPanel (right 12, w 290) →
    // DRAWING wheel icon (right 320) → PipeInspector (right 400, w 240).
    // Park this panel left of PipeInspector.
    bottom: 42,
    right: 660,
    width: 230,
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
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 10,
    fontWeight: 800,
    color: '#00e5ff',
    letterSpacing: 2,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottom: '1px solid #222',
  },
  solveCount: {
    fontSize: 9,
    color: '#666',
    fontWeight: 500,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '2px 0',
  },
  rowLabel: {
    fontSize: 11,
    color: '#888',
  },
  rowValue: {
    fontSize: 11,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  divider: {
    height: 1,
    background: '#222',
    margin: '6px 0',
  },
  empty: {
    fontSize: 11,
    color: '#555',
    fontStyle: 'italic',
    padding: '8px 0',
    textAlign: 'center',
  },
  barContainer: {
    marginTop: 8,
  },
  barLabel: {
    fontSize: 9,
    color: '#666',
    marginBottom: 3,
  },
  barTrack: {
    position: 'relative',
    height: 6,
    borderRadius: 3,
    background: '#1a1a1f',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.3s',
  },
  barLimit: {
    position: 'absolute',
    top: -2,
    right: 0,
    width: 2,
    height: 10,
    background: '#ff1744',
    opacity: 0.7,
  },
};
