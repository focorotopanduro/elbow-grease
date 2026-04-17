/**
 * PhaseBOMPanel — per-phase bill of materials.
 *
 * Computes, per construction phase:
 *   - Pipe count
 *   - Total run length (ft)
 *   - Per-diameter pipe footage breakdown
 *   - Per-system pipe footage (waste/vent/cold_supply/hot_supply/storm)
 *   - Fixture count by subtype
 *   - Rough estimated material cost (linear-foot × diameter factor)
 *   - Rough labor cost (material × PHASE_LABOR_MULT)
 *
 * Output suitable for invoicing/takeoff packages — the plumber can
 * cut and paste numbers into their estimating tool.
 *
 * Collapsible right-side panel below the floor selector rail.
 */

import { useMemo, useState } from 'react';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { usePhaseStore } from '@store/phaseStore';
import { PHASE_META, PHASE_ORDER, PHASE_LABOR_MULT, type ConstructionPhase } from '@core/phases/PhaseTypes';
import { classifyPipe, classifyFixture } from '@core/phases/PhaseClassifier';
import { generateAllFittings } from '@ui/pipe/FittingGenerator';
import { getFittingPrice, FITTING_CATALOG } from '@core/pipe/FittingCatalog';

// Rough per-foot material cost map ($/ft) by diameter.
// These are approximate retail prices and should be overridden by
// real estimating data in the future.
const PIPE_PRICE_PER_FT: Record<number, number> = {
  0.375: 0.45,
  0.5:   0.55,
  0.75:  0.80,
  1:     1.25,
  1.25:  1.70,
  1.5:   2.10,
  2:     3.50,
  2.5:   4.80,
  3:     6.20,
  4:     9.50,
  6:    18.00,
  8:    32.00,
};

const FIXTURE_UNIT_COST: Record<string, number> = {
  water_closet:      180,
  lavatory:          85,
  kitchen_sink:      240,
  bathtub:           520,
  shower:            380,
  floor_drain:       45,
  laundry_standpipe: 35,
  dishwasher:        0, // appliance, supplied by owner
  clothes_washer:    0,
  hose_bibb:         22,
  urinal:            320,
  mop_sink:          290,
  drinking_fountain: 680,
};

interface PhaseTotals {
  pipeCount: number;
  totalFt: number;
  byDiameter: Map<number, number>;
  bySystem: Map<string, number>;
  fixturesBySubtype: Map<string, number>;
  /** Per-fitting-type counts (e.g., "bend_90@3": 5) with running cost. */
  fittingsByKey: Map<string, { count: number; cost: number; type: string; size: number; material: string }>;
  materialCost: number;
  laborCost: number;
}

export function PhaseBOMPanel() {
  const pipes = usePipeStore((s) => s.pipes);
  const fixtures = useFixtureStore((s) => s.fixtures);
  const activePhase = usePhaseStore((s) => s.activePhase);
  const pipeOverrides = usePhaseStore((s) => s.pipeOverrides);
  const fixtureOverrides = usePhaseStore((s) => s.fixtureOverrides);
  const [collapsed, setCollapsed] = useState(false);

  const totals = useMemo(() => computeTotals(pipes, fixtures, pipeOverrides, fixtureOverrides), [pipes, fixtures, pipeOverrides, fixtureOverrides]);
  const active = totals[activePhase];
  const grandTotal = PHASE_ORDER.reduce((sum, p) => sum + totals[p].materialCost + totals[p].laborCost, 0);

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        width: 290,
        zIndex: 42,
        background: 'linear-gradient(180deg, rgba(6,12,20,0.96) 0%, rgba(14,22,34,0.92) 100%)',
        border: `1px solid ${PHASE_META[activePhase].color}66`,
        borderRadius: 10,
        backdropFilter: 'blur(6px)',
        boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 10px ${PHASE_META[activePhase].color}22`,
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        color: '#e0ecf3',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          gap: 8,
          cursor: 'pointer',
          background: `linear-gradient(90deg, ${PHASE_META[activePhase].color}22 0%, transparent 100%)`,
          borderBottom: collapsed ? 'none' : `1px solid ${PHASE_META[activePhase].color}33`,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 14 }}>{PHASE_META[activePhase].icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: PHASE_META[activePhase].color, flex: 1 }}>
          {PHASE_META[activePhase].label} · BOM
        </span>
        <span style={{ fontSize: 10, color: '#7fb8d0', fontFamily: 'Consolas, monospace' }}>
          ${(active.materialCost + active.laborCost).toFixed(0)}
        </span>
        <span style={{ fontSize: 10, color: '#8aa0b1' }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: '8px 12px', maxHeight: '55vh', overflowY: 'auto' }}>
          {/* Summary row */}
          <div style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(120,180,220,0.15)' }}>
            <StatCell label="Pipes" value={`${active.pipeCount}`} />
            <StatCell label="Total ft" value={active.totalFt.toFixed(1)} />
            <StatCell label="Fixtures" value={String(sumMap(active.fixturesBySubtype))} />
          </div>

          {/* Per-diameter */}
          {active.byDiameter.size > 0 && (
            <Section title="Pipe by Diameter">
              {[...active.byDiameter.entries()].sort((a, b) => a[0] - b[0]).map(([d, ft]) => (
                <BomRow
                  key={d}
                  left={`${formatDiameter(d)}"`}
                  right={`${ft.toFixed(1)} ft · $${((PIPE_PRICE_PER_FT[d] ?? 1) * ft).toFixed(2)}`}
                />
              ))}
            </Section>
          )}

          {/* Per-system */}
          {active.bySystem.size > 0 && (
            <Section title="Pipe by System">
              {[...active.bySystem.entries()].map(([sys, ft]) => (
                <BomRow
                  key={sys}
                  left={sys.replace('_', ' ')}
                  right={`${ft.toFixed(1)} ft`}
                  dotColor={SYSTEM_COLORS[sys] ?? '#888'}
                />
              ))}
            </Section>
          )}

          {/* Fittings */}
          {active.fittingsByKey.size > 0 && (
            <Section title="Fittings">
              {[...active.fittingsByKey.values()]
                .sort((a, b) => b.count - a.count)
                .map((f) => {
                  const def = FITTING_CATALOG[f.type as keyof typeof FITTING_CATALOG];
                  const label = def ? def.shortLabel : f.type;
                  return (
                    <BomRow
                      key={`${f.type}-${f.size}-${f.material}`}
                      left={`${label} ${formatDiameter(f.size)}" ${f.material.replace('_', ' ')}`}
                      right={`×${f.count} · $${f.cost.toFixed(2)}`}
                    />
                  );
                })}
            </Section>
          )}

          {/* Fixtures */}
          {active.fixturesBySubtype.size > 0 && (
            <Section title="Fixtures">
              {[...active.fixturesBySubtype.entries()].map(([subtype, count]) => (
                <BomRow
                  key={subtype}
                  left={subtype.replace('_', ' ')}
                  right={`${count} × $${FIXTURE_UNIT_COST[subtype] ?? 0}`}
                />
              ))}
            </Section>
          )}

          {/* Totals */}
          <div style={{ marginTop: 8, padding: '8px 0', borderTop: '1px solid rgba(120,180,220,0.2)' }}>
            <BomRow left="Material" right={`$${active.materialCost.toFixed(2)}`} color="#7fb8d0" />
            <BomRow
              left={`Labor (×${PHASE_LABOR_MULT[activePhase]})`}
              right={`$${active.laborCost.toFixed(2)}`}
              color="#7fb8d0"
            />
            <BomRow
              left="Phase Total"
              right={`$${(active.materialCost + active.laborCost).toFixed(2)}`}
              color={PHASE_META[activePhase].color}
              bold
            />
          </div>

          {/* All phases summary */}
          <div style={{ marginTop: 10, padding: '8px 0', borderTop: '1px dashed rgba(120,180,220,0.25)' }}>
            <div style={sectionTitleStyle}>All Phases</div>
            {PHASE_ORDER.map((p) => (
              <BomRow
                key={p}
                left={`${PHASE_META[p].icon} ${PHASE_META[p].shortLabel}`}
                right={`$${(totals[p].materialCost + totals[p].laborCost).toFixed(2)}`}
                color={PHASE_META[p].color}
              />
            ))}
            <BomRow left="JOB TOTAL" right={`$${grandTotal.toFixed(2)}`} color="#ffd54f" bold />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function computeTotals(
  pipes: Record<string, any>,
  fixtures: Record<string, any>,
  pipeOverrides: Record<string, ConstructionPhase>,
  fixtureOverrides: Record<string, ConstructionPhase>,
): Record<ConstructionPhase, PhaseTotals> {
  const out: Record<ConstructionPhase, PhaseTotals> = {
    underground: blankTotals(),
    rough_in:    blankTotals(),
    trim:        blankTotals(),
  };

  for (const p of Object.values(pipes)) {
    const phase = pipeOverrides[p.id] ?? classifyPipe(p);
    const t = out[phase];
    t.pipeCount++;

    let len = 0;
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1], b = p.points[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      len += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    t.totalFt += len;
    t.byDiameter.set(p.diameter, (t.byDiameter.get(p.diameter) ?? 0) + len);
    t.bySystem.set(p.system, (t.bySystem.get(p.system) ?? 0) + len);
    t.materialCost += len * (PIPE_PRICE_PER_FT[p.diameter] ?? 1.0);
  }

  for (const f of Object.values(fixtures)) {
    const phase = fixtureOverrides[f.id] ?? classifyFixture(f);
    const t = out[phase];
    t.fixturesBySubtype.set(f.subtype, (t.fixturesBySubtype.get(f.subtype) ?? 0) + 1);
    t.materialCost += FIXTURE_UNIT_COST[f.subtype] ?? 0;
  }

  // Tally fittings from the auto-generator. Each fitting is assigned
  // to the phase of its owning pipe so the BOM breakdown matches the
  // phase the plumber will actually be installing it in.
  const pipeList = Object.values(pipes);
  const allFittings = generateAllFittings(pipeList);
  const pipePhaseCache = new Map<string, ConstructionPhase>();
  for (const p of pipeList) {
    pipePhaseCache.set(p.id, pipeOverrides[p.id] ?? classifyPipe(p));
  }

  for (const fit of allFittings) {
    const phase = pipePhaseCache.get(fit.pipeId) ?? 'rough_in';
    const t = out[phase];
    const key = `${fit.type}@${fit.diameter}@${fit.material}`;
    const existing = t.fittingsByKey.get(key);
    const price = getFittingPrice(fit.material as any, fit.type, fit.diameter);
    if (existing) {
      existing.count++;
      existing.cost += price;
    } else {
      t.fittingsByKey.set(key, {
        count: 1,
        cost: price,
        type: fit.type,
        size: fit.diameter,
        material: fit.material,
      });
    }
    t.materialCost += price;
  }

  for (const p of PHASE_ORDER) {
    out[p].laborCost = out[p].materialCost * (PHASE_LABOR_MULT[p] - 1);
  }

  return out;
}

function blankTotals(): PhaseTotals {
  return {
    pipeCount: 0,
    totalFt: 0,
    byDiameter: new Map(),
    bySystem: new Map(),
    fixturesBySubtype: new Map(),
    fittingsByKey: new Map(),
    materialCost: 0,
    laborCost: 0,
  };
}

function sumMap(m: Map<string, number>): number {
  let s = 0; for (const v of m.values()) s += v; return s;
}

function formatDiameter(d: number): string {
  if (d === 0.375) return '3/8';
  if (d === 0.5)   return '1/2';
  if (d === 0.75)  return '3/4';
  if (d === 1.25)  return '1-1/4';
  if (d === 1.5)   return '1-1/2';
  if (d === 2.5)   return '2-1/2';
  return String(d);
}

const SYSTEM_COLORS: Record<string, string> = {
  waste:       '#8d6e63',
  vent:        '#9ccc65',
  cold_supply: '#4fc3f7',
  hot_supply:  '#ff7043',
  storm:       '#7986cb',
};

// ── Sub-components ─────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: '#7fb8d0', letterSpacing: 1, fontFamily: 'Consolas, monospace' }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 13, color: '#e0ecf3', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

function BomRow({
  left, right, color, bold, dotColor,
}: {
  left: string;
  right: string;
  color?: string;
  bold?: boolean;
  dotColor?: string;
}) {
  return (
    <div style={{ display: 'flex', padding: '2px 0', fontSize: 10, fontFamily: 'Consolas, monospace' }}>
      <span style={{ flex: 1, color: color ?? '#b8cbd7', fontWeight: bold ? 600 : 400, display: 'flex', alignItems: 'center', gap: 5 }}>
        {dotColor && <span style={{ width: 7, height: 7, borderRadius: 4, background: dotColor, display: 'inline-block' }} />}
        {left}
      </span>
      <span style={{ color: color ?? '#e0ecf3', fontWeight: bold ? 600 : 400 }}>{right}</span>
    </div>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 2,
  color: '#7fb8d0',
  textTransform: 'uppercase',
  padding: '4px 0 2px',
  fontFamily: 'Consolas, monospace',
};
