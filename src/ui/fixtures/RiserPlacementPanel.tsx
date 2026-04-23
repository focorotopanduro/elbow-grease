/**
 * RiserPlacementPanel — Phase 14.Z
 *
 * Compact HUD panel for picking + placing pre-built riser
 * templates. Opens on Alt+Shift+R, closes on Esc or pick-and-place.
 *
 * Picker UX is deliberately minimal — a 4-row list (one per template)
 * with its description. User clicks a row → the panel closes, the
 * selected template is armed, and the next scene click places the
 * riser at the cursor hit point.
 *
 * Implementation detail: rather than thread a "pending riser" state
 * through DrawInteraction, we place immediately at ORIGIN (0, floorY, 0)
 * on first press — the user can then Ctrl+Drag the whole riser into
 * position (14.O group translate handles this — all pipes are
 * committed and selectable as a group via multi-select).
 *
 * If a fixture is currently selected, the riser anchors at that
 * fixture's floor position. Otherwise it anchors at origin.
 */

import { useEffect, useState } from 'react';
import { useFixtureStore } from '@store/fixtureStore';
import { usePipeStore } from '@store/pipeStore';
import { useFloorStore } from '@store/floorStore';
import {
  placeRiser,
  listRiserTemplates,
  type RiserId,
  type RiserTemplate,
} from '@core/fixtures/riserTemplates';
import { logger } from '@core/logger/Logger';
import type { Vec3 } from '@core/events';

const log = logger('RiserPlacement');

// ── Commit helper ─────────────────────────────────────────────

function commitRiser(templateId: RiserId, anchor: Vec3): number {
  const result = placeRiser(templateId, anchor);

  // Commit pipes directly via setState so the pre-chosen system
  // classification (waste / vent / cold_supply / hot_supply) is
  // preserved — the public addPipe action re-infers system from
  // material which would overwrite our careful choices.
  const pipeStore = usePipeStore.getState();
  const nextPipes = { ...pipeStore.pipes };
  const nextOrder = [...pipeStore.pipeOrder];
  for (const p of result.pipes) {
    nextPipes[p.id] = {
      id: p.id,
      points: p.points,
      diameter: p.diameter,
      material: p.material,
      system: p.system,
      color: '#00e5ff',
      visible: true,
      selected: false,
    };
    nextOrder.push(p.id);
  }
  usePipeStore.setState({ pipes: nextPipes, pipeOrder: nextOrder });

  // Commit fixtures directly (ditto — subtype + params + id are
  // all pre-picked by the template; addFixture would mint a new id).
  if (result.fixtures.length > 0) {
    const fixtureStore = useFixtureStore.getState();
    const nextFixtures = { ...fixtureStore.fixtures };
    for (const f of result.fixtures) {
      nextFixtures[f.id] = {
        id: f.id,
        subtype: f.subtype,
        position: f.position,
        params: f.params,
        createdTs: Date.now(),
        connectedPipeIds: [],
      };
    }
    useFixtureStore.setState({ fixtures: nextFixtures });
  }

  log.info('riser placed', {
    template: templateId,
    anchor,
    pipes: result.pipes.length,
    fixtures: result.fixtures.length,
    warnings: result.warnings,
  });

  return result.pipes.length + result.fixtures.length;
}

// ── Compute anchor ────────────────────────────────────────────

function computeAnchor(): Vec3 {
  // Prefer the selected fixture's base (useful for "place a riser
  // right where this fixture stands"). Otherwise use the active
  // floor's slab Y with X=Z=0.
  const fxState = useFixtureStore.getState();
  const selected = fxState.selectedFixtureId;
  if (selected && fxState.fixtures[selected]) {
    return fxState.fixtures[selected]!.position;
  }
  const floors = useFloorStore.getState().floors;
  const active = Object.values(floors).find((f) => f.id === 'floor_1')
    ?? Object.values(floors)[0];
  const y = active?.elevationBase ?? 0;
  return [0, y, 0];
}

// ── Panel component ───────────────────────────────────────────

export function RiserPlacementPanel() {
  const [open, setOpen] = useState(false);

  // Alt+Shift+R → open; Esc → close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (open && e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const templates: RiserTemplate[] = listRiserTemplates();

  const handlePick = (id: RiserId) => {
    const anchor = computeAnchor();
    commitRiser(id, anchor);
    setOpen(false);
  };

  return (
    <div style={styles.backdrop} onClick={() => setOpen(false)}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>PLACE RISER</span>
          <span style={styles.hint}>Esc to close</span>
        </div>
        <div style={styles.subhint}>
          Anchors at the selected fixture, or at 1st-floor origin if none
          is selected. Use Ctrl+drag afterwards to reposition.
        </div>
        <div style={styles.list}>
          {templates.map((t) => (
            <button
              key={t.id}
              style={styles.row}
              onClick={() => handlePick(t.id)}
            >
              <div style={styles.rowHead}>
                <span style={styles.rowLabel}>{t.label}</span>
                <span style={styles.rowMeta}>{t.floorCount} floors · {t.height}ft</span>
              </div>
              <div style={styles.rowDesc}>{t.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(5, 8, 13, 0.65)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  panel: {
    width: 520,
    maxWidth: '90vw',
    background: 'rgba(14, 20, 28, 0.98)',
    border: '1px solid #445',
    borderRadius: 10,
    padding: 18,
    color: '#eee',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  title: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 2,
    color: '#00e5ff',
  },
  hint: {
    fontSize: 9,
    color: '#7fb8d0',
    fontFamily: 'Consolas, monospace',
  },
  subhint: {
    fontSize: 10,
    color: '#8aa0b1',
    marginBottom: 12,
    lineHeight: 1.4,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: {
    textAlign: 'left',
    background: 'rgba(30, 40, 52, 0.7)',
    border: '1px solid #334',
    borderRadius: 6,
    padding: '10px 12px',
    cursor: 'pointer',
    color: '#eee',
    transition: 'background 120ms, border-color 120ms',
  },
  rowHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 3,
  },
  rowLabel: {
    fontWeight: 600,
    fontSize: 13,
    color: '#fff',
  },
  rowMeta: {
    fontSize: 10,
    color: '#7fb8d0',
    fontFamily: 'Consolas, monospace',
  },
  rowDesc: {
    fontSize: 11,
    color: '#b8cbd7',
    lineHeight: 1.4,
  },
};
