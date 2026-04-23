/**
 * ShortcutRegistry — single source of truth for every keyboard
 * shortcut in the app.
 *
 * Why a registry:
 *   • Discoverability — `?` key renders a human-readable table.
 *   • Conflict detection — a future lint can ensure no two bindings
 *     collide.
 *   • Telemetry-ready — if we ever track "most-used shortcut" we have
 *     a stable set of identifiers to key on.
 *
 * This is a STATIC registry (no runtime registration). Shortcuts are
 * actually dispatched by individual subsystems (App.tsx KeyboardHandler,
 * God Mode, Compliance debugger, RadialMenu, etc.). The registry is
 * informational — adding an entry here DOES NOT install a handler.
 * Its purpose is documentation + the help overlay.
 *
 * When a new shortcut ships, both the handler AND a registry entry
 * go in the same commit. An ESLint rule could enforce this in a
 * follow-up; for now it's a convention.
 */

export type ShortcutCategory =
  | 'navigation'
  | 'drawing'
  | 'selection'
  | 'layers'
  | 'views'
  | 'manifold'
  | 'debug'
  | 'editing'
  | 'project';

export interface Shortcut {
  /** Unique stable id — for telemetry keys and the registry lookup. */
  id: string;
  /** Category for visual grouping. */
  category: ShortcutCategory;
  /**
   * Human-readable keybinding. Use ` + ` between modifier keys; use
   * `, ` between sequential presses. Examples: `"S"`, `"Ctrl + Z"`,
   * `"Ctrl + E, F"`.
   */
  keys: string;
  /** One-line description shown in the help overlay. */
  description: string;
  /** Optional hint shown in smaller text below the description. */
  hint?: string;
}

// ── Registry ───────────────────────────────────────────────────

export const SHORTCUTS: Shortcut[] = [
  // ── Navigation / modes ───────────────────────────────────
  { id: 'mode.navigate', category: 'navigation', keys: 'N',
    description: 'Switch to Navigate mode' },
  { id: 'mode.draw', category: 'navigation', keys: 'D',
    description: 'Switch to Draw mode' },
  { id: 'mode.select', category: 'navigation', keys: 'S',
    description: 'Switch to Select mode' },
  { id: 'nav.freeze', category: 'navigation', keys: 'Space (hold)',
    description: 'Freeze orbit/pan/zoom while held',
    hint: 'Use this when you need to drag-extend a pipe or manifold without the camera following' },

  // ── Drawing ──────────────────────────────────────────────
  { id: 'draw.horizontal', category: 'drawing', keys: 'H',
    description: 'Set draw plane: horizontal (ground)' },
  { id: 'draw.vertical', category: 'drawing', keys: 'V',
    description: 'Set draw plane: vertical' },
  { id: 'draw.enter', category: 'drawing', keys: 'Enter',
    description: 'Finalize current pipe route' },
  { id: 'draw.clear', category: 'drawing', keys: 'Escape',
    description: 'Cancel / clear / deselect (priority chain)',
    hint: 'Wheel → pending fixture → draw → selection → mode' },
  { id: 'draw.diameter.1', category: 'drawing', keys: '1', description: '½" diameter' },
  { id: 'draw.diameter.2', category: 'drawing', keys: '2', description: '1" diameter' },
  { id: 'draw.diameter.3', category: 'drawing', keys: '3', description: '1½" diameter' },
  { id: 'draw.diameter.4', category: 'drawing', keys: '4', description: '2" diameter' },
  { id: 'draw.diameter.5', category: 'drawing', keys: '5', description: '3" diameter' },
  { id: 'draw.diameter.6', category: 'drawing', keys: '6', description: '4" diameter' },
  { id: 'draw.quality', category: 'drawing', keys: 'Q',
    description: 'Toggle pipe render quality (3D ↔ fast)' },

  // ── Selection / editing ──────────────────────────────────
  { id: 'edit.delete', category: 'editing', keys: 'Delete | Backspace',
    description: 'Delete selected pipe' },
  { id: 'edit.undo', category: 'editing', keys: 'Ctrl + Z',
    description: 'Undo last action (Phase 8.B — universal)',
    hint: 'Walks the command log; every command whose handler defines undo() is reversible' },
  { id: 'edit.redo', category: 'editing', keys: 'Ctrl + Y  |  Ctrl + Shift + Z',
    description: 'Redo' },
  { id: 'edit.pipe.extend', category: 'editing', keys: 'Drag from + glyph',
    description: 'Extend a new pipe from an endpoint (Phase 6)' },
  { id: 'edit.pipe.tee', category: 'editing', keys: 'Drag from pipe body',
    description: 'Insert a tee at the drag start + extend branch (Phase 7.A)' },

  // ── Manifold ─────────────────────────────────────────────
  { id: 'manifold.place', category: 'manifold', keys: 'M',
    description: 'Drop a 2-port manifold (cursor ghost)' },
  { id: 'manifold.rotate.ghost', category: 'manifold', keys: 'R (during placement)',
    description: 'Rotate placement ghost 90°' },

  // ── Radial wheels ────────────────────────────────────────
  { id: 'wheel.drawing', category: 'drawing', keys: 'Ctrl + Space (hold)',
    description: 'Open the DRAWING wheel' },
  { id: 'wheel.fixture', category: 'drawing', keys: 'Ctrl + F (hold)',
    description: 'Open the FIXTURE wheel' },
  { id: 'wheel.customer.edit', category: 'project', keys: 'Ctrl + E, F',
    description: 'Open the CUSTOMER EDIT wheel' },

  // ── Views ────────────────────────────────────────────────
  { id: 'view.perspective', category: 'views', keys: '0',
    description: 'Perspective view (orbit enabled)' },
  { id: 'view.isometric',  category: 'views', keys: '9', description: 'Isometric view' },
  { id: 'view.top',        category: 'views', keys: '7', description: 'Top (plan) view' },
  { id: 'view.front',      category: 'views', keys: '8', description: 'Front elevation' },
  { id: 'view.side',       category: 'views', keys: '6', description: 'Side elevation' },
  // Phase 12.A — Sims-style wall visibility cycle.
  { id: 'view.walls.cycle', category: 'views', keys: 'Shift + W',
    description: 'Cycle wall render mode: Walls Up → Walls Down → Cutaway',
    hint: 'Cutaway dims walls between the camera and the point you are looking at, like The Sims' },

  // ── Layers (Phase 2.G) ───────────────────────────────────
  { id: 'layer.waste',       category: 'layers', keys: 'W', description: 'Toggle waste system' },
  { id: 'layer.vent',        category: 'layers', keys: 'V', description: 'Toggle vent system', hint: 'Only outside draw mode' },
  { id: 'layer.cold',        category: 'layers', keys: 'C', description: 'Toggle cold supply' },
  { id: 'layer.hot',         category: 'layers', keys: 'H', description: 'Toggle hot supply', hint: 'Only outside draw mode' },
  { id: 'layer.storm',       category: 'layers', keys: 'T', description: 'Toggle storm system' },
  { id: 'layer.all',         category: 'layers', keys: 'A', description: 'Show all systems' },

  // ── Project ──────────────────────────────────────────────
  { id: 'project.save', category: 'project', keys: 'Ctrl + S',
    description: 'Save — writes to the current file silently, or prompts if no file yet',
    hint: 'Autosave also runs every 10 seconds to localStorage as a crash-recovery safety net' },
  { id: 'project.saveAs', category: 'project', keys: 'Ctrl + Shift + S',
    description: 'Save As — always prompts for a file location',
    hint: 'In Tauri this opens the native Save dialog; in the browser it triggers a download' },
  { id: 'project.open', category: 'project', keys: 'Ctrl + O',
    description: 'Open an .elbow project bundle' },
  { id: 'project.pricing', category: 'project', keys: 'Ctrl + Shift + B',
    description: 'Pricing profile — labor rate, overhead, margin, sales tax',
    hint: 'Edits your bid math inputs. Applied to the next BOM export.' },
  { id: 'project.contractor', category: 'project', keys: 'Ctrl + Shift + I',
    description: 'Contractor profile — identity info for PDF proposal title blocks',
    hint: 'Company name, license #, address, logo, proposal terms. Set once per installation.' },
  { id: 'project.templates', category: 'project', keys: 'Ctrl + Shift + T',
    description: 'Assembly templates — save/load reusable pipe + fixture groups',
    hint: 'Capture the current scene as a reusable layout; drop it into future bids centered at scene origin.' },
  { id: 'project.compliance', category: 'project', keys: 'Ctrl + Shift + L',
    description: 'Plumbing code compliance — auto-planned p-traps + cleanouts',
    hint: 'Read-only review of IPC-required p-traps + cleanouts. Items are already folded into BOM exports.' },
  { id: 'project.revisions', category: 'project', keys: 'Ctrl + Shift + V',
    description: 'Proposal revisions — browse history + print signable change orders',
    hint: 'Every proposal print auto-saves as R1, R2, R3… Pick any two to diff + generate a change order PDF.' },
  { id: 'project.library', category: 'project', keys: 'Ctrl + Shift + X',
    description: 'Library eXchange — export/import contractor profile, pricing, templates, revisions',
    hint: 'Move settings between machines or share templates with colleagues as a single .elbowlib.json file.' },
  { id: 'fixture.rotate.nudge', category: 'editing', keys: '[ / ]',
    description: 'Rotate selected fixture ±15° (Y axis)',
    hint: 'Works any time a fixture is selected. Designed for tracing fixtures against imported blueprints.' },
  { id: 'fixture.rotate.fine', category: 'editing', keys: 'Shift + [ / ]',
    description: 'Rotate selected fixture ±5° (fine nudge)' },
  { id: 'fixture.rotate.cardinal', category: 'editing', keys: 'Ctrl + [ / ]',
    description: 'Rotate selected fixture ±90° (cardinal snap)',
    hint: 'Quickest way to flip a fixture to face the right wall in a blueprint trace.' },

  // ── Multi-select (Phase 14.I + 14.M) ─────────────────────
  { id: 'select.toggle', category: 'selection', keys: 'Shift + Click',
    description: 'Toggle a pipe or fixture in the multi-select set',
    hint: 'Bare click = single-select (existing). Shift+click = add or remove from the running group.' },
  { id: 'select.remove', category: 'selection', keys: 'Alt + Click',
    description: 'Remove a pipe or fixture from the multi-select set',
    hint: 'Useful while fine-tuning a lasso selection without toggling.' },
  { id: 'select.similar', category: 'selection', keys: 'Ctrl + Shift + Click',
    description: 'Select all similar (same material for pipes, same subtype for fixtures)',
    hint: 'Click any copper supply line to select every copper pipe. Click any toilet to select every toilet.' },
  { id: 'select.mode', category: 'selection', keys: 'S',
    description: 'Toggle Select mode (lasso / box-select)',
    hint: 'In Select mode, drag on empty canvas draws a selection rectangle. Press S again to exit.' },
  { id: 'select.lasso', category: 'selection', keys: 'Drag (Select mode)',
    description: 'Draw a box to select every pipe + fixture inside it',
    hint: 'Shift+drag to add to an existing selection. Escape during drag cancels.' },
  { id: 'select.all', category: 'selection', keys: 'Ctrl + A',
    description: 'Select every pipe + fixture in the scene',
    hint: 'Skipped while in Draw mode or while typing in a text input.' },
  { id: 'select.clear', category: 'selection', keys: 'Escape',
    description: 'Clear multi-select (one press per layer: group → single → mode)',
    hint: 'First Escape clears the group. Second clears the single-select. Third drops to Navigate.' },
  { id: 'select.delete', category: 'selection', keys: 'Delete / Backspace',
    description: 'Remove every selected pipe + fixture',
    hint: 'Applies to multi-select if non-empty, otherwise the single-selected pipe.' },
  { id: 'select.group.rotate', category: 'selection', keys: '[ / ]',
    description: 'Rotate the group ±15° around its centroid (when ≥ 2 selected)',
    hint: 'Shift = ±5° fine · Ctrl = ±90° cardinal. Pipes transform alongside fixtures.' },
  { id: 'select.mass.edit', category: 'selection', keys: 'Ctrl + Shift + M',
    description: 'Mass-edit material / diameter / system / visibility on every selected pipe',
    hint: 'Blank fields leave the property untouched. Only pipes whose current value differs get written.' },
  { id: 'select.translate.keys', category: 'selection', keys: '← → ↑ ↓',
    description: 'Translate selection ±1 ft in X / Z (arrow keys)',
    hint: 'Shift = ±0.1 ft fine · Ctrl = ±5 ft coarse. Works on group (≥ 2) or single selected pipe / fixture.' },
  { id: 'select.translate.drag', category: 'selection', keys: 'Drag cross handle',
    description: 'Drag the cyan cross at group centroid to translate in XZ',
    hint: 'Shift = axis-constrain · Ctrl = snap to 1 ft grid. Live "+X, +Z ft" readout above the handle.' },
  { id: 'project.recent', category: 'project', keys: 'Ctrl + Shift + R',
    description: 'Recent projects — quick-open from history',
    hint: 'Desktop only. Uses stored paths from prior saves; browser mode shows an empty state.' },
  { id: 'project.export.svg', category: 'project', keys: 'Ctrl + Shift + E',
    description: 'Export SVG / Print PDF' },

  // ── Debug tools ──────────────────────────────────────────
  { id: 'debug.god',      category: 'debug', keys: 'Ctrl + Shift + G',
    description: 'God Mode console (command stream + flags)' },
  { id: 'debug.trace',    category: 'debug', keys: 'Ctrl + Shift + D',
    description: 'Compliance trace debugger' },
  { id: 'debug.perf',     category: 'debug', keys: 'Ctrl + Shift + P',
    description: 'Performance HUD (FPS, frame-time, worker, draws, heap)',
    hint: 'Polls at 10 Hz; renderer.info sampler unmounts when HUD is off — zero cost when closed' },
  { id: 'debug.help',     category: 'debug', keys: '?  (or Shift + /)',
    description: 'This help overlay' },
];

// ── Helpers ────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  navigation: 'Navigation',
  drawing: 'Drawing',
  selection: 'Selection',
  editing: 'Editing',
  manifold: 'Manifolds',
  views: 'Views',
  layers: 'Layers',
  project: 'Project',
  debug: 'Debug',
};

/** Group shortcuts by category, preserving category label order. */
export function groupedShortcuts(): Array<{
  category: ShortcutCategory;
  label: string;
  entries: Shortcut[];
}> {
  const byCat = new Map<ShortcutCategory, Shortcut[]>();
  for (const s of SHORTCUTS) {
    const list = byCat.get(s.category) ?? [];
    list.push(s);
    byCat.set(s.category, list);
  }
  return (Object.keys(CATEGORY_LABELS) as ShortcutCategory[]).flatMap((cat) => {
    const entries = byCat.get(cat);
    if (!entries) return [];
    return [{ category: cat, label: CATEGORY_LABELS[cat], entries }];
  });
}
