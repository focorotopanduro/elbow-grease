/**
 * SolvePipelineHUD — live 5-pass simulation pipeline indicator.
 *
 * Shows which passes of the headless solver have fired recently,
 * with per-pass timing. Gives the user a visible pulse of the
 * engine's heartbeat and proves the simulation is actually running.
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ ENGINE   [DFU][SIZE][PRESS][COMP][BOM]  27.3 ms  │
 *   └──────────────────────────────────────────────────┘
 *
 * Each block flashes green as its event arrives, then fades over 2s.
 * The cumulative solve time (from SIMULATION_COMPLETE) is shown on
 * the right. If any pass exceeds its budget (30ms total or 10ms/pass),
 * the block pulses red as a performance warning.
 *
 * Subscribes to the simBus — the headless engine message channel —
 * not the main EventBus. This is the UI's window into the Web Worker.
 */

import { useEffect, useState } from 'react';
import { simBus, SIM_MSG, type SolveTimingPayload, type CompliancePayload, type BOMPayload } from '../../engine/graph/MessageBus';

// ── Pass descriptors ────────────────────────────────────────────

type PassId = 'dfu' | 'sizing' | 'pressure' | 'compliance' | 'bom';

const PASSES: { id: PassId; label: string; short: string; color: string; budget: number }[] = [
  { id: 'dfu',        label: 'DFU Accumulation',   short: 'DFU',   color: '#00e5ff', budget: 3 },
  { id: 'sizing',     label: 'Pipe Auto-Sizing',   short: 'SIZE',  color: '#7c4dff', budget: 3 },
  { id: 'pressure',   label: 'Darcy-Weisbach',     short: 'PRESS', color: '#ffa726', budget: 8 },
  { id: 'compliance', label: 'ACC Compliance',     short: 'COMP',  color: '#66bb6a', budget: 10 },
  { id: 'bom',        label: 'BOM Aggregation',    short: 'BOM',   color: '#ef5350', budget: 6 },
];

interface PassPulse {
  timestamp: number;
  durationMs: number;
  overBudget: boolean;
}

// ── Component ───────────────────────────────────────────────────

export function SolvePipelineHUD() {
  const [pulses, setPulses] = useState<Record<PassId, PassPulse | null>>({
    dfu: null, sizing: null, pressure: null, compliance: null, bom: null,
  });
  const [solveCount, setSolveCount] = useState(0);
  const [lastTiming, setLastTiming] = useState<SolveTimingPayload | null>(null);
  const [complianceCount, setComplianceCount] = useState<{ errors: number; warnings: number }>({ errors: 0, warnings: 0 });
  const [bomTotal, setBomTotal] = useState<number>(0);
  const [_, forceTick] = useState(0);

  // Animate pulse fade
  useEffect(() => {
    const interval = setInterval(() => forceTick((x) => x + 1), 100);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to sim bus events
  useEffect(() => {
    const offs: Array<() => void> = [];

    const pulse = (id: PassId, dur: number, overBudget: boolean) => {
      setPulses((p) => ({ ...p, [id]: { timestamp: performance.now(), durationMs: dur, overBudget } }));
    };

    offs.push(simBus.on(SIM_MSG.DFU_PROPAGATED, () => pulse('dfu', 0, false)));
    offs.push(simBus.on(SIM_MSG.PIPES_SIZED, () => pulse('sizing', 0, false)));
    offs.push(simBus.on(SIM_MSG.PRESSURE_SOLVED, () => pulse('pressure', 0, false)));

    offs.push(simBus.on(SIM_MSG.COMPLIANCE_CHECKED, (msg) => {
      pulse('compliance', 0, false);
      const payload = msg.payload as CompliancePayload;
      if (payload?.violations) {
        let errors = 0, warnings = 0;
        for (const v of payload.violations) {
          if (v.severity === 'error') errors++;
          else warnings++;
        }
        setComplianceCount({ errors, warnings });
      }
    }));

    offs.push(simBus.on(SIM_MSG.BOM_GENERATED, (msg) => {
      pulse('bom', 0, false);
      const payload = msg.payload as BOMPayload;
      if (payload?.grandTotal) setBomTotal(payload.grandTotal);
    }));

    offs.push(simBus.on(SIM_MSG.SIMULATION_COMPLETE, (msg) => {
      const payload = msg.payload as { timing: SolveTimingPayload };
      if (payload?.timing) {
        setLastTiming(payload.timing);
        setSolveCount((c) => c + 1);
        // Backfill individual pass timings with over-budget flags
        const t = payload.timing;
        const passTimings: Record<PassId, number> = {
          dfu: t.dfuMs, sizing: t.sizingMs, pressure: t.pressureMs,
          compliance: t.complianceMs, bom: t.bomMs,
        };
        setPulses((prev) => {
          const out = { ...prev };
          for (const pass of PASSES) {
            if (out[pass.id]) {
              out[pass.id] = {
                ...out[pass.id]!,
                durationMs: passTimings[pass.id],
                overBudget: passTimings[pass.id] > pass.budget,
              };
            }
          }
          return out;
        });
      }
    }));

    return () => { for (const f of offs) f(); };
  }, []);

  // Helper: pass pulse intensity (1 = just fired, 0 = faded)
  const pulseIntensity = (id: PassId): number => {
    const p = pulses[id];
    if (!p) return 0;
    const age = (performance.now() - p.timestamp) / 1000;
    return Math.max(0, 1 - age / 2); // 2s fade
  };

  const totalMs = lastTiming ? lastTiming.totalMs : 0;
  const totalOverBudget = totalMs > 30;
  const totalColor = totalOverBudget ? '#ff1744' : totalMs > 15 ? '#ffc107' : '#00e676';

  // Hide if nothing has ever solved
  if (solveCount === 0) return null;

  return (
    <div style={styles.bar}>
      <span style={styles.engineLabel}>ENGINE</span>

      {PASSES.map((pass) => {
        const intensity = pulseIntensity(pass.id);
        const p = pulses[pass.id];
        const dur = p?.durationMs ?? 0;
        const over = p?.overBudget ?? false;

        return (
          <div
            key={pass.id}
            title={`${pass.label} — ${dur.toFixed(2)} ms${over ? ' (over budget)' : ''}`}
            style={{
              ...styles.passBlock,
              borderColor: intensity > 0 ? (over ? '#ff1744' : pass.color) : '#333',
              background: `rgba(${hexToRgb(pass.color)}, ${intensity * 0.25})`,
              color: intensity > 0.3 ? pass.color : '#555',
              boxShadow: intensity > 0.5
                ? `0 0 ${12 * intensity}px ${pass.color}80`
                : 'none',
            }}
          >
            {pass.short}
          </div>
        );
      })}

      <span style={styles.divider}>|</span>

      <span style={{ ...styles.timing, color: totalColor }}>
        {totalMs.toFixed(1)} ms
      </span>

      <span style={styles.count}>#{solveCount}</span>

      {(complianceCount.errors > 0 || complianceCount.warnings > 0) && (
        <>
          <span style={styles.divider}>|</span>
          {complianceCount.errors > 0 && (
            <span style={styles.errorBadge}>⨯ {complianceCount.errors}</span>
          )}
          {complianceCount.warnings > 0 && (
            <span style={styles.warnBadge}>⚠ {complianceCount.warnings}</span>
          )}
        </>
      )}

      {bomTotal > 0 && (
        <>
          <span style={styles.divider}>|</span>
          <span style={styles.bomBadge}>${bomTotal.toFixed(0)}</span>
        </>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: 'absolute',
    // Top-center is now PhaseSelectorBar (top 12) + MeasureToolbar
    // (top 68). Push engine HUD to 120 so it sits just below them.
    top: 120,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 10px',
    borderRadius: 8,
    border: '1px solid #222',
    background: 'rgba(10,10,15,0.88)',
    fontFamily: "'Segoe UI', system-ui, monospace",
    pointerEvents: 'auto',
    zIndex: 20,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },
  engineLabel: {
    fontSize: 9,
    fontWeight: 800,
    color: '#555',
    letterSpacing: 2,
    marginRight: 4,
  },
  passBlock: {
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid',
    letterSpacing: 1,
    transition: 'all 0.2s',
    minWidth: 42,
    textAlign: 'center',
  },
  divider: {
    color: '#333',
    margin: '0 4px',
  },
  timing: {
    fontSize: 11,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  count: {
    fontSize: 9,
    color: '#555',
    fontVariantNumeric: 'tabular-nums',
  },
  errorBadge: {
    fontSize: 10,
    color: '#ff1744',
    fontWeight: 700,
  },
  warnBadge: {
    fontSize: 10,
    color: '#ffc107',
    fontWeight: 700,
  },
  bomBadge: {
    fontSize: 10,
    color: '#00e676',
    fontWeight: 700,
  },
};
