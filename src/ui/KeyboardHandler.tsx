/**
 * KeyboardHandler — window-level keyboard dispatcher for the shared
 * app shell.
 *
 * Extracted from `App.tsx` in Phase 2a of the hybrid-architecture
 * refactor so the mode-gated plumbing branches can be exercised in
 * isolation by `KeyboardHandler.spec.tsx` without booting the full
 * React tree.
 *
 * Dispatch tiers (top-to-bottom):
 *
 *   1. **Global shortcuts** — fire in every workspace:
 *      Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z  — universal undo / redo
 *      Shift+W                         — wall render-mode cycle
 *      Shift+M                         — toggle workspace (plumbing ↔ roofing)
 *
 *   2. **Modifier guard** — any other Ctrl/Meta/Alt combo is
 *      ignored so modifier shortcuts elsewhere (browser, radial
 *      wheels, etc.) don't collide with the bare-key switch below.
 *
 *   3. **Plumbing mode guard (ARCHITECTURE.md §4.1)** — the
 *      switch-over-bare-keys (N / D / S / Q / H / V / 1–6 /
 *      Enter / Escape / Delete / [M,m] / A) targets
 *      `plumbingDrawStore` and friends. It short-circuits when
 *      the active workspace is `roofing` so keystrokes in the
 *      roofing viewport can't flip plumbing state.
 *
 * Global-by-policy — kept in the shared shell because the global
 * shortcuts (undo/save/mode-toggle) apply to every workspace. The
 * roofing workspace has its own scoped listener
 * (`RoofingRotationKeyHandler`, `RoofingDrawInteraction`) for its
 * bare-key shortcuts.
 */

import { useEffect } from 'react';
import { eventBus } from '@core/EventBus';
import { EV } from '@core/events';
import {
  undo as undoLastCommand,
  redo as redoLastCommand,
} from '@core/commands/UndoManager';
import { usePlumbingDrawStore } from '@store/plumbingDrawStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { useMultiSelectStore } from '@store/multiSelectStore';
import { useCustomerStore } from '@store/customerStore';
import { useRadialMenuStore } from '@store/radialMenuStore';
import { useRenderModeStore } from '@store/renderModeStore';
import { useAppModeStore } from '@store/appModeStore';
import {
  beginManifoldPlacement,
  isManifoldPlacementActive,
} from '@ui/manifold/ManifoldPlacement';

/**
 * Pure KeyboardEvent dispatcher. Exported for tests so they can
 * exercise the mode-guard logic without wiring up a real window
 * listener. Reads every store via `getState()` — it owns no state
 * of its own.
 */
export function handleKeyboardEvent(e: KeyboardEvent): void {
  // ── Tier 1: global shortcuts ──────────────────────────────

  // Phase 8.B — universal undo/redo via the CommandBus log.
  // Replaces the old pipeStore-only undo/redo: now any command
  // whose handler defines snapshot+undo is reversible (pipes,
  // fixtures, manifolds, connectivity side-effects).
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault(); undoLastCommand(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault(); redoLastCommand(); return;
  }

  // Phase 12.A — Sims-style wall render-mode cycle. Shift+W stands
  // alone (no Ctrl) so it doesn't collide with the existing 'w'
  // layer-waste toggle (which is bare w).
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'W' || e.key === 'w')) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    useRenderModeStore.getState().cycle();
    return;
  }

  // Phase 14.R.3 — Shift+M toggles between Plumbing and Roofing
  // workspaces. Handled BEFORE the modifier guard below so the
  // combo never falls through to the bare-M manifold-placement
  // handler further down the switch.
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'M' || e.key === 'm')) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    useAppModeStore.getState().toggle();
    return;
  }

  // ── Tier 2: modifier guard ────────────────────────────────
  // Everything below is a bare-key or plain-shift combo; bail on
  // any other modifier so Ctrl+F / Alt+… shortcuts owned by other
  // subsystems aren't intercepted.
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // ── Tier 3: plumbing-scoped shortcuts ─────────────────────
  // ARCHITECTURE.md §4.1 — short-circuit when the active workspace
  // isn't plumbing so bare-key presses in roofing mode don't
  // mutate plumbing state (e.g. pressing `d` while tracing a
  // roof section must NOT flip plumbingDrawStore into 'draw').
  if (useAppModeStore.getState().mode !== 'plumbing') return;

  const st = usePlumbingDrawStore.getState();
  switch (e.key) {
    case 'n': st.setMode('navigate'); break;
    case 'd': if (st.mode !== 'draw') st.setMode('draw'); break;
    case 's':
      // Phase 14.M: toggle Select mode (lasso) from any non-draw
      // mode. Pressing S while in select returns to navigate so
      // the same key enters + exits the lasso.
      if (st.mode === 'draw') break;
      st.setMode(st.mode === 'select' ? 'navigate' : 'select');
      break;
    case 'q': st.togglePipeQuality(); break;
    case 'v': if (st.mode === 'draw') st.setDrawPlane('vertical'); break;
    case 'h': if (st.mode === 'draw') st.setDrawPlane('horizontal'); break;
    case 'O': if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Phase 14.AD.23 — Shift+O toggles the ortho click-drag draw mode.
      st.toggleOrthoClickDragMode();
      e.preventDefault();
    } break;
    case 'Escape': {
      // Universal cancel chain — ONE key users can hit reflexively
      // when something feels wrong, with a predictable order:
      //
      //   1. Radial wheel open?       → close it
      //   2. Pending fixture placement? → cancel it
      //   3. Mid-draw with points?    → clear points, STAY in Draw
      //      (so the user can immediately re-draw without hitting D)
      //   4. A pipe or fixture selected? → deselect (dismiss inspector)
      //   5. Otherwise                 → drop back to Navigate mode
      //
      // Each branch short-circuits so one Escape never performs more
      // than one step. Hit Escape again to continue up the chain.
      const wheelOpen = useRadialMenuStore.getState().activeWheelId !== null;
      if (wheelOpen) {
        useRadialMenuStore.getState().closeWheel();
        break;
      }
      const pending = useCustomerStore.getState().pendingFixture;
      if (pending) {
        useCustomerStore.getState().setPendingFixture(null);
        break;
      }
      if (st.mode === 'draw' && st.isDrawing) {
        usePlumbingDrawStore.setState({ drawPoints: [], isDrawing: false });
        break;
      }
      // Phase 14.I — multi-select clears first (before single-select),
      // because it represents the user's most-recent building-up
      // action. Two Escape presses: first clears the group, second
      // deselects any remaining single-select.
      if (!useMultiSelectStore.getState().isEmpty()) {
        useMultiSelectStore.getState().clear();
        break;
      }
      if (usePipeStore.getState().selectedId) {
        usePipeStore.getState().selectPipe(null);
        break;
      }
      if (useFixtureStore.getState().selectedFixtureId) {
        useFixtureStore.getState().selectFixture(null);
        break;
      }
      st.setMode('navigate');
      break;
    }
    case 'Enter':
      if (st.mode === 'draw') {
        const pts = st.finishDraw();
        if (pts && pts.length >= 2) {
          eventBus.emit(EV.PIPE_COMPLETE, {
            id: `pipe-${Date.now()}`, points: pts,
            diameter: st.drawDiameter, material: st.drawMaterial,
          });
        }
      }
      break;
    case 'Delete': case 'Backspace': {
      // Phase 14.I — multi-select takes priority. Mass-delete all
      // selected pipes + fixtures if any are in the set. This is
      // keyed off the store rather than piping through the single-
      // select store so the user can shift-click a handful of
      // items and nuke them in one stroke.
      const ms = useMultiSelectStore.getState();
      if (!ms.isEmpty()) {
        const pipeIdsToRemove = ms.selectedPipeIds();
        const fixtureIdsToRemove = ms.selectedFixtureIds();
        for (const id of pipeIdsToRemove) usePipeStore.getState().removePipe(id);
        for (const id of fixtureIdsToRemove) useFixtureStore.getState().removeFixture(id);
        ms.clear();
        break;
      }
      const sel = usePipeStore.getState().selectedId;
      if (sel) usePipeStore.getState().removePipe(sel);
      break;
    }
    case 'a': case 'A': {
      // Phase 14.I — Ctrl+A selects every visible pipe + fixture
      // into the multi-select set. Bypasses if the user is typing
      // (isEditableTarget already gates the outer handler).
      if (!e.ctrlKey || e.shiftKey || e.metaKey) break;
      if (st.mode === 'draw') break; // reserve for draw-mode semantics
      e.preventDefault();
      const allPipeIds = usePipeStore.getState().pipeOrder;
      const allFixtureIds = Object.keys(useFixtureStore.getState().fixtures);
      useMultiSelectStore.getState().setSelection(allPipeIds, allFixtureIds);
      break;
    }
    case '1': if (st.mode === 'draw') st.setDrawDiameter(0.5); break;
    case '2': if (st.mode === 'draw') st.setDrawDiameter(1); break;
    case '3': if (st.mode === 'draw') st.setDrawDiameter(1.5); break;
    case '4': if (st.mode === 'draw') st.setDrawDiameter(2); break;
    case '5': if (st.mode === 'draw') st.setDrawDiameter(3); break;
    case '6': if (st.mode === 'draw') st.setDrawDiameter(4); break;

    // Phase 7.C.ii: M enters manifold-placement mode. A translucent
    // ghost follows the cursor; click to drop, Escape to cancel,
    // R to rotate 90°. Re-pressing M while a session is active is a
    // no-op (handled inside beginManifoldPlacement).
    case 'm':
    case 'M': {
      if (st.mode === 'draw') break;
      if (isManifoldPlacementActive()) break;
      beginManifoldPlacement();
      break;
    }
  }
}

/**
 * React mount point for the window-level keyboard dispatcher.
 * Installs + tears down the `keydown` listener for the app's
 * lifetime. Call it once inside the top-level `<App />` tree.
 */
export function KeyboardHandler(): null {
  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardEvent);
    return () => window.removeEventListener('keydown', handleKeyboardEvent);
  }, []);
  return null;
}
