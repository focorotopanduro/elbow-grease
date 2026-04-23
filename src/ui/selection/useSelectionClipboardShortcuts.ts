/**
 * useSelectionClipboardShortcuts — Phase 14.P
 *
 * Binds Ctrl+C / Ctrl+V / Ctrl+D to copy / paste / duplicate the
 * current multi-select (or single-select, when multi-select is empty).
 *
 * Behavior:
 *
 *   Ctrl + C  → extract the current selection into `plumbingClipboardStore`.
 *               No-op on empty selection. Doesn't clear existing
 *               clipboard on empty copy (so accidental Ctrl+C in
 *               empty scene doesn't wipe a useful clipboard).
 *
 *   Ctrl + V  → paste the clipboard at the default offset
 *               (`DEFAULT_DUPLICATE_OFFSET`). Fresh ids minted for
 *               every pipe + fixture. After paste, the pasted items
 *               become the new multi-select so the user can
 *               immediately drag / rotate / mass-edit them.
 *
 *   Ctrl + D  → same as "copy current selection + paste at default
 *               offset" in one keystroke. Doesn't touch the
 *               clipboard (plumbingClipboardStore.payload is unchanged).
 *               Standard "duplicate in place" shortcut — avoids the
 *               Ctrl+C/Ctrl+V two-step for the most common flow.
 *
 * Text-input guard: standard "don't steal typing" — skipped when
 * focus is in an INPUT / TEXTAREA / contenteditable element.
 *
 * Platform note: Ctrl is accepted on every OS. macOS's Cmd (metaKey)
 * is also accepted so users on Mac (or remote-desktoping into
 * Windows from a Mac) get the native shortcut. Shift+modifier
 * variants are NOT bound — leaving them free for future features
 * like "paste inverted" or "paste special".
 */

import { useEffect } from 'react';
import { usePlumbingMultiSelectStore } from '@store/plumbingMultiSelectStore';
import { usePlumbingClipboardStore } from '@store/plumbingClipboardStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import {
  DEFAULT_DUPLICATE_OFFSET,
  extractForCopy,
  preparePaste,
  type ClipboardPayload,
} from '@core/selection/selectionClipboard';
import { eventBus } from '@core/EventBus';
import { EV } from '@core/events';
import { logger } from '@core/logger/Logger';

const log = logger('SelectionClipboard');

// ── ID generation ─────────────────────────────────────────────

/**
 * Fresh-id factory shared across pipes + fixtures. Uses the same
 * alphabet as the existing stores so ids remain uniform in logs /
 * exports. `kind` is just a prefix for readability.
 */
let seq = 0;
function mintId(kind: 'p' | 'f'): string {
  seq = (seq + 1) & 0xffff;
  return `${kind}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

// ── Gather current selection ──────────────────────────────────

/**
 * Collapses the multi-select + single-select stores into a unified
 * `{pipeIds, fixtureIds}` list. When multi-select is empty, the
 * single-select stores contribute their selected id (if any). When
 * multi-select has ≥ 1, it wins outright — single-select is ignored
 * to match the rest of the 14.I contract.
 */
function currentSelectionIds(): { pipeIds: string[]; fixtureIds: string[] } {
  const ms = usePlumbingMultiSelectStore.getState();
  const msPipes = ms.selectedPipeIds();
  const msFixtures = ms.selectedFixtureIds();
  if (msPipes.length + msFixtures.length > 0) {
    return { pipeIds: msPipes, fixtureIds: msFixtures };
  }
  // Fall back to single-select stores.
  const singlePipe = usePipeStore.getState().selectedId;
  const singleFixture = useFixtureStore.getState().selectedFixtureId;
  return {
    pipeIds: singlePipe ? [singlePipe] : [],
    fixtureIds: singleFixture ? [singleFixture] : [],
  };
}

// ── Actions ───────────────────────────────────────────────────

/** Extract current selection and stash on the clipboard. */
export function copySelectionToClipboard(): boolean {
  const { pipeIds, fixtureIds } = currentSelectionIds();
  const pipes = usePipeStore.getState().pipes;
  const fixtures = useFixtureStore.getState().fixtures;
  const payload = extractForCopy(pipeIds, fixtureIds, pipes, fixtures);
  if (!payload) {
    log.debug('copy: nothing selected, no-op');
    return false;
  }
  usePlumbingClipboardStore.getState().setPayload(payload);
  log.info('copied to clipboard', {
    pipes: payload.pipes.length,
    fixtures: payload.fixtures.length,
  });
  return true;
}

/**
 * Apply a `ClipboardPayload` to the live stores at a given delta.
 * Returns the new ids so the caller can reselect them.
 *
 * Commits fixtures via the public `addFixture` action so the
 * FIXTURE_PLACED event fires (AutoRouteTrigger + ConnectivityManager
 * depend on it). Commits pipes directly via `setState` because
 * `addPipe` defaults color/system from diameter and would drop the
 * carried material/system/color fields — we need the paste to
 * preserve exactly what was copied.
 */
function applyPaste(payload: ClipboardPayload, delta: [number, number, number]): {
  newPipeIds: string[];
  newFixtureIds: string[];
} {
  const prepared = preparePaste(payload, delta, () => mintId('p'));
  // Re-assign the second half — preparePaste used one factory for all;
  // we want a separate prefix for fixtures so ids are readable in logs.
  const newPipeIds = prepared.pipes.map((p) => p.id);
  const newFixtureIds: string[] = [];

  // Commit pipes directly.
  if (prepared.pipes.length > 0) {
    const pipeStore = usePipeStore.getState();
    const nextPipes = { ...pipeStore.pipes };
    const nextOrder = [...pipeStore.pipeOrder];
    for (const p of prepared.pipes) {
      nextPipes[p.id] = {
        id: p.id,
        points: p.points,
        diameter: p.diameter,
        material: p.material,
        system: p.system,
        color: p.color,
        visible: p.visible,
        selected: false,
      };
      nextOrder.push(p.id);
    }
    usePipeStore.setState({ pipes: nextPipes, pipeOrder: nextOrder });
    // Emit PIPE_COMPLETE for each so downstream (ConnectivityManager,
    // SimulationBridge) re-solves against the fresh geometry.
    for (const p of prepared.pipes) {
      eventBus.emit(EV.PIPE_COMPLETE, {
        id: p.id,
        points: p.points,
        diameter: p.diameter,
        material: p.material,
      });
    }
  }

  // Commit fixtures via public addFixture so FIXTURE_PLACED + any
  // downstream handlers get a consistent event. We want the id we
  // already picked, but addFixture mints its own — so we side-door:
  // setState the instance directly + emit FIXTURE_PLACED.
  if (prepared.fixtures.length > 0) {
    const fixtureStore = useFixtureStore.getState();
    const nextFixtures = { ...fixtureStore.fixtures };
    const fixtureId = () => mintId('f');
    for (const f of prepared.fixtures) {
      const id = fixtureId();
      newFixtureIds.push(id);
      nextFixtures[id] = {
        id,
        subtype: f.subtype,
        position: f.position,
        params: f.params,
        createdTs: Date.now(),
        connectedPipeIds: [],
      };
      eventBus.emit(EV.FIXTURE_PLACED, {
        id,
        subtype: f.subtype,
        position: f.position,
        params: f.params,
      });
    }
    useFixtureStore.setState({ fixtures: nextFixtures });
  }

  log.info('paste committed', {
    delta,
    newPipes: newPipeIds.length,
    newFixtures: newFixtureIds.length,
  });

  return { newPipeIds, newFixtureIds };
}

/** Ctrl+V — paste the current clipboard at the default offset. */
export function pasteFromClipboard(): boolean {
  const payload = usePlumbingClipboardStore.getState().payload;
  if (!payload) {
    log.debug('paste: clipboard empty, no-op');
    return false;
  }
  const { newPipeIds, newFixtureIds } = applyPaste(payload, DEFAULT_DUPLICATE_OFFSET);
  // Auto-select the pasted items so Ctrl+V → arrow-keys immediately
  // moves them without an extra "click to select" step.
  usePlumbingMultiSelectStore.getState().setSelection(newPipeIds, newFixtureIds);
  return true;
}

/** Ctrl+D — copy + paste current selection in one stroke. */
export function duplicateSelection(): boolean {
  const { pipeIds, fixtureIds } = currentSelectionIds();
  const pipes = usePipeStore.getState().pipes;
  const fixtures = useFixtureStore.getState().fixtures;
  const payload = extractForCopy(pipeIds, fixtureIds, pipes, fixtures);
  if (!payload) {
    log.debug('duplicate: nothing selected, no-op');
    return false;
  }
  const { newPipeIds, newFixtureIds } = applyPaste(payload, DEFAULT_DUPLICATE_OFFSET);
  usePlumbingMultiSelectStore.getState().setSelection(newPipeIds, newFixtureIds);
  return true;
}

// ── Hook ──────────────────────────────────────────────────────

export function useSelectionClipboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Text-input guard
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }

      // Require EITHER Ctrl or Cmd; don't trigger on bare letters.
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Don't hijack Ctrl+Shift+C etc — those are free for future use.
      if (e.shiftKey || e.altKey) return;

      const key = e.key.toLowerCase();
      switch (key) {
        case 'c':
          e.preventDefault();
          copySelectionToClipboard();
          break;
        case 'v':
          e.preventDefault();
          pasteFromClipboard();
          break;
        case 'd':
          e.preventDefault();
          duplicateSelection();
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Thin component mount-point for App.tsx — same pattern as other phases. */
export function SelectionClipboardShortcutsBinder(): null {
  useSelectionClipboardShortcuts();
  return null;
}
