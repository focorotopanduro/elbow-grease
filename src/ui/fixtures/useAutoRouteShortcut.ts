/**
 * useAutoRouteShortcut — Phase 14.Y.3
 *
 * Keyboard shortcut + imperative entry point for `autoRouteFixture`.
 *
 *   Ctrl+R (or Cmd+R) while a fixture is selected:
 *     Run the pathfinder, commit every proposed pipe through
 *     pipeStore.addPipe, and log a summary.
 *
 * Safety rails:
 *   - Skipped when focus is in an INPUT / TEXTAREA / contenteditable
 *     (prevents hijacking typing in the diameter/rotation inputs).
 *   - No-op when no fixture is selected — the user could have
 *     intended Ctrl+R for the webview's hard-reload, so we don't
 *     preventDefault unless we actually have work to do.
 *
 * Design goal: keep this hook tiny. The pathfinder is pure + lives
 * in `autoRouteFixture.ts`; this file is purely the "plumbing"
 * between the keyboard, the selected-fixture state, and the pipe
 * store commit.
 */

import { useEffect } from 'react';
import { useFixtureStore } from '@store/fixtureStore';
import { usePipeStore } from '@store/pipeStore';
import { useFloorStore } from '@store/floorStore';
import { autoRouteFixture } from '@core/fixtures/autoRouteFixture';
import { logger } from '@core/logger/Logger';

const log = logger('AutoRoute');

// ── ID generation ─────────────────────────────────────────────

let seq = 0;
function autoRouteId(role: string): string {
  seq = (seq + 1) & 0xffff;
  return `ar_${role}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

// ── Public action ─────────────────────────────────────────────

/**
 * Run auto-route on the currently-selected fixture. Imperative
 * entry point — exposed so command palette / right-click menus
 * can call without going through the keyboard.
 *
 * Returns the number of pipes committed; 0 if no fixture selected.
 */
export function autoRouteSelectedFixture(): number {
  const fixtureState = useFixtureStore.getState();
  const selectedId = fixtureState.selectedFixtureId;
  if (!selectedId) return 0;
  const fixture = fixtureState.fixtures[selectedId];
  if (!fixture) return 0;

  // Floor / ceiling for the fixture's floor. Fall back to 0/9 if
  // the floor lookup fails — default residential 9-ft stud height.
  const floors = useFloorStore.getState().floors;
  const activeFloor = Object.values(floors).find(
    (f) => fixture.position[1] >= f.elevationBase
        && fixture.position[1] < f.elevationTop,
  );
  const floorY = activeFloor?.elevationBase ?? 0;
  const ceilingY = activeFloor?.elevationTop ?? (floorY + 9);

  const otherFixtures = Object.values(fixtureState.fixtures)
    .filter((f) => f.id !== selectedId);
  const pipes = Object.values(usePipeStore.getState().pipes);

  const result = autoRouteFixture({
    fixture,
    otherFixtures,
    pipes,
    floorY,
    ceilingY,
  });

  if (result.proposed.length === 0) {
    log.info('auto-route: no pipes proposed', { fixtureId: selectedId });
    return 0;
  }

  // Commit each proposed pipe. We set the full CommittedPipe shape
  // directly (rather than using `addPipe` which re-infers system
  // from material) because the pathfinder has already decided the
  // correct system (cold_supply vs hot_supply vs waste vs vent).
  const pipeStore = usePipeStore.getState();
  const nextPipes = { ...pipeStore.pipes };
  const nextOrder = [...pipeStore.pipeOrder];
  for (const p of result.proposed) {
    const id = autoRouteId(p.role);
    nextPipes[id] = {
      id,
      points: p.points,
      diameter: p.diameter,
      material: p.material,
      system: p.system,
      color: '#00e5ff',
      visible: true,
      selected: false,
    };
    nextOrder.push(id);
  }
  usePipeStore.setState({ pipes: nextPipes, pipeOrder: nextOrder });

  log.info('auto-route committed', {
    fixtureId: selectedId,
    proposed: result.proposed.length,
    warnings: result.warnings,
  });
  return result.proposed.length;
}

// ── Hook ──────────────────────────────────────────────────────

export function useAutoRouteShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.shiftKey || e.altKey) return; // leave Ctrl+Shift+R / Ctrl+Alt+R alone
      if (e.key.toLowerCase() !== 'r') return;

      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }

      const selectedId = useFixtureStore.getState().selectedFixtureId;
      if (!selectedId) return; // Let the browser handle Ctrl+R if no fixture selected

      e.preventDefault();
      autoRouteSelectedFixture();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Null mount-point component — same pattern as every other phase. */
export function AutoRouteShortcutBinder(): null {
  useAutoRouteShortcut();
  return null;
}
