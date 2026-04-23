/**
 * ShortcutRegistry — Phase 2a (ARCHITECTURE.md §4.1) tests.
 *
 * Covers:
 *   • `shortcutMatchesMode` pure decision helper.
 *   • Every registry entry carries a `mode` tag so the help
 *     overlay + future dispatcher filters can trust the field.
 *   • Sampled plumbing-only entries (N / D / S / Q / 1–6) are
 *     tagged `plumbing`.
 *   • Sampled genuinely-global entries (undo / redo / save / open /
 *     help / perf HUD / mode toggle) are tagged `global`.
 */

import { describe, it, expect } from 'vitest';
import {
  SHORTCUTS,
  shortcutMatchesMode,
  type Shortcut,
} from '../ShortcutRegistry';

// ── shortcutMatchesMode — pure helper ─────────────────────────

describe('shortcutMatchesMode', () => {
  it('global entries fire regardless of current mode', () => {
    expect(shortcutMatchesMode('global', 'plumbing')).toBe(true);
    expect(shortcutMatchesMode('global', 'roofing')).toBe(true);
  });

  it('plumbing entries fire only in plumbing mode', () => {
    expect(shortcutMatchesMode('plumbing', 'plumbing')).toBe(true);
    expect(shortcutMatchesMode('plumbing', 'roofing')).toBe(false);
  });

  it('roofing entries fire only in roofing mode', () => {
    expect(shortcutMatchesMode('roofing', 'roofing')).toBe(true);
    expect(shortcutMatchesMode('roofing', 'plumbing')).toBe(false);
  });

  it('missing mode (undefined) defaults to global — fires anywhere', () => {
    expect(shortcutMatchesMode(undefined, 'plumbing')).toBe(true);
    expect(shortcutMatchesMode(undefined, 'roofing')).toBe(true);
  });
});

// ── Registry shape ────────────────────────────────────────────

describe('SHORTCUTS registry tagging (Phase 2a)', () => {
  function byId(id: string): Shortcut {
    const s = SHORTCUTS.find((x) => x.id === id);
    if (!s) throw new Error(`shortcut id '${id}' not in registry`);
    return s;
  }

  it('every entry carries an explicit mode (no accidental defaults)', () => {
    for (const s of SHORTCUTS) {
      expect(s.mode, `shortcut '${s.id}' missing mode`).toBeDefined();
      expect(['global', 'plumbing', 'roofing']).toContain(s.mode);
    }
  });

  // Plumbing-specific — the D key is the canonical case the
  // architecture is fixing.
  it('plumbing navigation keys are tagged plumbing', () => {
    expect(byId('mode.navigate').mode).toBe('plumbing');
    expect(byId('mode.draw').mode).toBe('plumbing');
    expect(byId('mode.select').mode).toBe('plumbing');
  });

  it('plumbing diameter shortcuts are tagged plumbing', () => {
    expect(byId('draw.diameter.1').mode).toBe('plumbing');
    expect(byId('draw.diameter.6').mode).toBe('plumbing');
  });

  it('plumbing draw-plane shortcuts are tagged plumbing', () => {
    expect(byId('draw.horizontal').mode).toBe('plumbing');
    expect(byId('draw.vertical').mode).toBe('plumbing');
  });

  it('plumbing layer toggles are tagged plumbing', () => {
    expect(byId('layer.waste').mode).toBe('plumbing');
    expect(byId('layer.cold').mode).toBe('plumbing');
    expect(byId('layer.all').mode).toBe('plumbing');
  });

  // Global-by-design — the shell-level shortcuts users would
  // expect to work in either workspace.
  it('universal undo / redo are global', () => {
    expect(byId('edit.undo').mode).toBe('global');
    expect(byId('edit.redo').mode).toBe('global');
  });

  it('project save / open / recent are global', () => {
    expect(byId('project.save').mode).toBe('global');
    expect(byId('project.saveAs').mode).toBe('global');
    expect(byId('project.open').mode).toBe('global');
    expect(byId('project.recent').mode).toBe('global');
  });

  it('camera view presets are global', () => {
    expect(byId('view.perspective').mode).toBe('global');
    expect(byId('view.top').mode).toBe('global');
    expect(byId('view.walls.cycle').mode).toBe('global');
  });

  it('debug help + perf HUD are global', () => {
    expect(byId('debug.help').mode).toBe('global');
    expect(byId('debug.perf').mode).toBe('global');
  });
});
