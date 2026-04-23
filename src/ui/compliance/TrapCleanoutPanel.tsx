/**
 * TrapCleanoutPanel — Phase 14.D
 * Extended in Phase 14.H to also show hanger/support compliance.
 *
 * Compliance preview for auto-planned p-traps, cleanouts, and hangers.
 *
 * Shows the live plan (recomputed from the current scene whenever
 * the panel is open) grouped by requirement type, with each entry
 * tagged with its IPC code reference. Gives the contractor a
 * "did you remember these?" review surface before export.
 *
 * Triggered by Ctrl+Shift+L ("pLumbing code"). Non-destructive —
 * this panel is read-only: the plan is already folded into the BOM
 * automatically at export time (see ExportPanel / printProposal).
 *
 * Style follows the 14.A/B/C modal pattern for visual consistency.
 */

import { useEffect, useMemo, useState } from 'react';
import { useFocusTrap } from '@core/a11y/useFocusTrap';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import {
  planPTrapsAndCleanouts,
  type CleanoutReason,
} from '@core/compliance/pTrapCleanoutPlanner';
// Phase 14.H — hanger/support planner.
import {
  planHangers,
  type HangerReason,
  type HangerRequirement,
} from '@core/compliance/hangerPlanner';

const CLEANOUT_REASON_LABELS: Record<CleanoutReason, string> = {
  end_of_run: 'End of drain run',
  direction_change_gt_45: 'Horizontal direction change > 45°',
  long_run_exceeds_100ft: 'Max spacing (100 ft) on long run',
  stack_base: 'Base of vertical stack',
};

const CLEANOUT_REASON_CODES: Record<CleanoutReason, string> = {
  end_of_run: 'IPC 708.1.4',
  direction_change_gt_45: 'IPC 708.1.1',
  long_run_exceeds_100ft: 'IPC 708.1.5',
  stack_base: 'IPC 708.1.2',
};

// Phase 14.H — hanger reason labels.
const HANGER_REASON_LABELS: Record<HangerReason, string> = {
  horizontal_spacing: 'Horizontal spacing (per material)',
  end_of_horizontal: 'End-of-run support',
  direction_change: 'Horizontal direction change',
  riser_floor: 'Vertical riser (story interval)',
};

const HANGER_REASON_CODES: Record<HangerReason, string> = {
  horizontal_spacing: 'IPC 308.5',
  end_of_horizontal: 'IPC 308.5',
  direction_change: 'IPC 308.9',
  riser_floor: 'IPC 308.7',
};

export function TrapCleanoutPanel() {
  const pipes = usePipeStore((s) => s.pipes);
  const pipeOrder = usePipeStore((s) => s.pipeOrder);
  const fixtures = useFixtureStore((s) => s.fixtures);

  const [open, setOpen] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (open && e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Recompute plan whenever the scene changes AND the panel is open.
  // When closed, the plans stay stale — cheap, since they never render.
  const plan = useMemo(() => {
    if (!open) return null;
    const pipeList = pipeOrder.map((id) => pipes[id]!).filter(Boolean);
    const fixtureList = Object.values(fixtures);
    return planPTrapsAndCleanouts(pipeList, fixtureList);
  }, [open, pipes, pipeOrder, fixtures]);

  // Phase 14.H — hanger plan computed off the same scene snapshot.
  const hangerPlan = useMemo(() => {
    if (!open) return null;
    const pipeList = pipeOrder.map((id) => pipes[id]!).filter(Boolean);
    return planHangers(pipeList);
  }, [open, pipes, pipeOrder]);

  if (!open) return null;

  const totalCount = (plan?.summary.pTrapCount ?? 0)
                   + (plan?.summary.cleanoutCount ?? 0)
                   + (hangerPlan?.summary.hangerCount ?? 0);
  const hasNothing = totalCount === 0;

  // Group cleanouts by reason for an easier-to-scan layout.
  const byReason: Record<CleanoutReason, typeof plan extends null ? never : NonNullable<typeof plan>['cleanouts']> = {
    end_of_run: [],
    direction_change_gt_45: [],
    long_run_exceeds_100ft: [],
    stack_base: [],
  };
  if (plan) for (const c of plan.cleanouts) byReason[c.reason].push(c);

  return (
    <div style={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compliance-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="compliance-title" style={styles.title}>
            Plumbing Code Compliance — Traps, Cleanouts &amp; Hangers
          </span>
          <button
            type="button"
            aria-label="Close compliance panel"
            style={styles.closeBtn}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        <div style={styles.body}>
          <div style={styles.hint}>
            Auto-detected from your scene against IPC 308 (hangers), 708
            (cleanouts), and 1002 (fixture traps). These items are already
            folded into your BOM at export time — this panel is a review
            surface so you know what the material list includes.
          </div>

          {hasNothing && (
            <div style={styles.emptyState}>
              No compliance items required in the current scene.
              <br />
              {Object.keys(fixtures).length === 0 && pipeOrder.length === 0
                ? 'Draw some pipes and drop some fixtures to see the plan.'
                : 'Every fixture has an integral trap or is supply-only, drains don\'t need cleanouts at their current lengths/geometry, and pipes are too short to need hangers.'}
            </div>
          )}

          {plan && plan.pTraps.length > 0 && (
            <section>
              <h3 style={styles.sectionTitle}>
                P-Traps · {plan.pTraps.length}
              </h3>
              <div style={styles.sectionMeta}>IPC 1002.1</div>
              <ul style={styles.list}>
                {plan.pTraps.map((t) => (
                  <li key={t.fixtureId} style={styles.listItem}>
                    <div style={styles.itemHead}>
                      {humanSubtype(t.fixtureSubtype)}
                      <span style={styles.itemSize}>
                        {t.trapDiameterInches}″ · {humanMaterial(t.material)}
                      </span>
                    </div>
                    <div style={styles.itemReason}>{t.reason}</div>
                    <div style={styles.itemPos}>
                      at {formatPos(t.position)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {plan && plan.cleanouts.length > 0 && (
            <section>
              <h3 style={styles.sectionTitle}>
                Cleanouts · {plan.cleanouts.length}
              </h3>
              {(Object.keys(byReason) as CleanoutReason[])
                .filter((k) => byReason[k].length > 0)
                .map((reason) => (
                  <div key={reason} style={styles.reasonGroup}>
                    <div style={styles.reasonHeader}>
                      <span style={styles.reasonLabel}>
                        {CLEANOUT_REASON_LABELS[reason]}
                      </span>
                      <span style={styles.reasonCode}>
                        {CLEANOUT_REASON_CODES[reason]} · {byReason[reason].length}
                      </span>
                    </div>
                    <ul style={styles.list}>
                      {byReason[reason].map((c, i) => (
                        <li key={`${reason}-${i}`} style={styles.listItem}>
                          <div style={styles.itemHead}>
                            Cleanout {c.diameterInches}″
                            <span style={styles.itemSize}>
                              {humanMaterial(c.material)}
                            </span>
                          </div>
                          <div style={styles.itemReason}>{c.description}</div>
                          <div style={styles.itemPos}>
                            at {formatPos(c.position)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </section>
          )}

          {/* Phase 14.H — Hangers section */}
          {hangerPlan && hangerPlan.hangers.length > 0 && (
            <HangersSection hangers={hangerPlan.hangers} />
          )}
        </div>

        <footer style={styles.footer}>
          {plan && (
            <span style={styles.footerHint}>
              {plan.summary.pTrapCount} p-trap{plan.summary.pTrapCount === 1 ? '' : 's'}
              {' + '}
              {plan.summary.cleanoutCount} cleanout{plan.summary.cleanoutCount === 1 ? '' : 's'}
              {hangerPlan && ` + ${hangerPlan.summary.hangerCount} hanger${hangerPlan.summary.hangerCount === 1 ? '' : 's'}`}
              {' '}already in your BOM.
            </span>
          )}
          {!plan && <span style={{ flex: 1 }} />}
          <button type="button" style={styles.doneBtn} onClick={() => setOpen(false)}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── Hangers sub-component (Phase 14.H) ───────────────────────

function HangersSection({ hangers }: { hangers: readonly HangerRequirement[] }) {
  // Group by reason first; within each reason, group by material+diameter
  // for a tight summary ("PVC 2″: 12 hangers at 4 ft spacing").
  const byReason: Record<HangerReason, HangerRequirement[]> = {
    horizontal_spacing: [],
    end_of_horizontal: [],
    direction_change: [],
    riser_floor: [],
  };
  for (const h of hangers) byReason[h.reason].push(h);

  const rollup = (list: HangerRequirement[]): Array<{ key: string; label: string; count: number }> => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const h of list) {
      const key = `${h.material}|${h.diameterInches}`;
      const existing = m.get(key);
      if (existing) existing.count++;
      else m.set(key, {
        key,
        label: `${humanMaterial(h.material)} ${h.diameterInches}″`,
        count: 1,
      });
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  };

  return (
    <section>
      <h3 style={styles.sectionTitle}>
        Hangers &amp; supports · {hangers.length}
      </h3>
      {(Object.keys(byReason) as HangerReason[])
        .filter((k) => byReason[k].length > 0)
        .map((reason) => {
          const group = byReason[reason];
          const rolled = rollup(group);
          return (
            <div key={reason} style={styles.reasonGroup}>
              <div style={styles.reasonHeader}>
                <span style={styles.reasonLabel}>
                  {HANGER_REASON_LABELS[reason]}
                </span>
                <span style={styles.reasonCode}>
                  {HANGER_REASON_CODES[reason]} · {group.length}
                </span>
              </div>
              <ul style={styles.list}>
                {rolled.map((r) => (
                  <li key={r.key} style={styles.listItem}>
                    <div style={styles.itemHead}>
                      {r.label}
                      <span style={styles.itemSize}>
                        ×{r.count}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </section>
  );
}

// ── Formatting helpers ───────────────────────────────────────

function humanSubtype(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanMaterial(m: string): string {
  const map: Record<string, string> = {
    pvc_sch40: 'PVC Sch 40',
    pvc_sch80: 'PVC Sch 80',
    abs: 'ABS',
    cast_iron: 'Cast Iron',
    copper_type_l: 'Copper Type L',
    copper_type_m: 'Copper Type M',
    cpvc: 'CPVC',
    pex: 'PEX',
    galvanized_steel: 'Galvanized Steel',
    ductile_iron: 'Ductile Iron',
  };
  return map[m] ?? m;
}

function formatPos(p: [number, number, number]): string {
  const fmt = (n: number) => (Math.abs(n) < 0.01 ? '0' : n.toFixed(1));
  return `(${fmt(p[0])}, ${fmt(p[1])}, ${fmt(p[2])})`;
}

// ── Styles ────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0, 0, 0, 0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  panel: {
    width: 'min(680px, 94vw)',
    maxHeight: '88vh',
    background: 'rgba(10, 14, 22, 0.98)',
    border: '1px solid #2a3a54',
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 229, 255, 0.06)',
    color: '#e0e6ef',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 18px',
    borderBottom: '1px solid #1a2334',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#00e5ff', letterSpacing: 1, flex: 1 },
  closeBtn: {
    background: 'none', border: 'none', color: '#7a8592',
    fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '0 8px',
  },
  body: {
    padding: '14px 18px',
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 14,
    minHeight: 120,
  },
  hint: {
    fontSize: 11, color: '#7a8592',
    padding: '8px 10px',
    background: 'rgba(0, 229, 255, 0.04)',
    border: '1px solid rgba(0, 229, 255, 0.15)',
    borderRadius: 4,
    lineHeight: 1.45,
  },
  emptyState: {
    padding: '32px 16px',
    textAlign: 'center',
    color: '#7a8592',
    fontSize: 12,
    lineHeight: 1.6,
    border: '1px dashed #2a3a54',
    borderRadius: 6,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 700,
    color: '#e0e6ef',
    letterSpacing: 0.5,
  },
  sectionMeta: {
    marginTop: 2, marginBottom: 8,
    fontSize: 10, color: '#7a8592', letterSpacing: 1,
  },
  reasonGroup: { marginTop: 12 },
  reasonHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: '4px 0 6px',
    borderBottom: '1px solid #1a2334',
    marginBottom: 6,
  },
  reasonLabel: { fontSize: 12, fontWeight: 600, color: '#cfd8e3' },
  reasonCode: { fontSize: 10, color: '#7a8592', letterSpacing: 1 },
  list: {
    listStyle: 'none', padding: 0, margin: 0,
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  listItem: {
    padding: '6px 10px',
    background: 'rgba(0, 0, 0, 0.25)',
    border: '1px solid #1f2a3e',
    borderRadius: 4,
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  itemHead: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 12, fontWeight: 600, color: '#e0e6ef',
  },
  itemSize: { fontSize: 11, color: '#00e5ff', fontWeight: 500 },
  itemReason: { fontSize: 11, color: '#aebbc9', lineHeight: 1.35 },
  itemPos: { fontSize: 10, color: '#7a8592', fontFamily: 'ui-monospace, Consolas, monospace' },
  footer: {
    display: 'flex', gap: 8, alignItems: 'center',
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  footerHint: { flex: 1, fontSize: 11, color: '#7a8592' },
  doneBtn: {
    padding: '6px 16px',
    background: 'linear-gradient(180deg, #00e5ff 0%, #00b8d4 100%)',
    border: 'none', borderRadius: 4, color: '#0a0e18',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', letterSpacing: 0.5,
  },
};
