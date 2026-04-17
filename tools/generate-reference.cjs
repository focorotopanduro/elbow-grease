/**
 * generate-reference.cjs
 *
 * Auto-generates REFERENCE.md — a comprehensive codebase reference
 * document that other AIs can read to understand the ELBOW GREASE
 * project structure, architecture, and data flow.
 *
 * Runs after any Edit/Write/MultiEdit in src/ via a Claude Code hook.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'REFERENCE.md');

// ── Helpers ─────────────────────────────────────────────────────

/** Extract the top-level JSDoc comment from a file. */
function extractJSDoc(content) {
  const match = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!match) return null;
  const raw = match[1];
  const lines = raw
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .filter((l) => !l.match(/^@\w+/)); // skip @param/@returns tags
  // Take until the first blank line (the summary block)
  const summary = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (summary.length === 0) continue;
      break;
    }
    summary.push(line);
  }
  return summary.join(' ').trim();
}

/** Extract exported symbol names from a file. */
function extractExports(content) {
  const exports = [];
  const patterns = [
    /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g,
    /export\s+\{([^}]+)\}/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(content)) !== null) {
      const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean);
      exports.push(...names);
    }
  }
  return [...new Set(exports)];
}

/** Walk a directory recursively. */
function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, base, out);
    } else if (entry.isFile() && /\.(ts|tsx|cjs|js)$/.test(entry.name)) {
      out.push({
        absPath: full,
        relPath: path.relative(base, full).replace(/\\/g, '/'),
      });
    }
  }
  return out;
}

/** Group files by their top-level directory under src/. */
function groupByDir(files) {
  const groups = new Map();
  for (const f of files) {
    const parts = f.relPath.split('/');
    const dir = parts.length === 1 ? '(root)' : parts.slice(0, -1).join('/');
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }
  return groups;
}

// ── Static sections (manually curated, these don't auto-detect) ──

const HEADER = `# ELBOW GREASE — Codebase Reference

> **Auto-generated** from \`src/\` after every edit. Do not hand-edit.
> Last regenerated: ${new Date().toISOString()}

A videogame-styled plumbing CAD application built with React, Three.js,
and React Three Fiber. Provides realistic 3D pipe drawing, auto-routing,
hydraulic simulation, code compliance checking, BIM export, and more.
`;

const QUICKSTART = `
## Quickstart

**Run dev server:**
\`\`\`bash
cd "C:/Program Files/ELBOW GREASE"
npm install
npx vite --host --port 5173
\`\`\`

Open http://localhost:5173 in Edge.

**Build production:**
\`\`\`bash
npx vite build
\`\`\`
Output in \`dist/\`. Served by \`server.cjs\` when packaged as .exe.

**Standalone executable:**
Built at \`C:/Users/Owner/OneDrive/Desktop/ElbowGrease/\`. Contains
\`ElbowGrease.exe\` (Node.js embedded) and \`dist/\`. Portable.
`;

const TECH_STACK = `
## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript (strict mode) |
| 3D Rendering | Three.js + React Three Fiber + drei |
| State | Zustand (stores in \`src/store/\`) |
| Bundler | Vite 6 |
| Path aliases | \`@core\`, \`@ui\`, \`@hooks\`, \`@store\` |
| Simulation | Web Worker (\`src/engine/worker/simulation.worker.ts\`) |
| Standalone | pkg (compiles server to single .exe) |
`;

const KEYS = `
## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| \`N\` | Navigate mode (orbit camera) |
| \`D\` | Draw mode (click to place waypoints) |
| \`S\` | Select mode |
| \`Q\` | Toggle 3D / Fast pipe rendering |
| \`H\` | Horizontal draw plane (in draw mode) |
| \`V\` | Vertical draw plane (in draw mode) |
| \`1-6\` | Quick diameter (0.5" → 4") while drawing |
| \`Enter\` | Finish current pipe |
| \`Escape\` | Cancel draw / return to Navigate |
| \`Delete\` / \`Backspace\` | Remove selected pipe |
| \`Ctrl+Z\` | Undo |
| \`Ctrl+Y\` / \`Ctrl+Shift+Z\` | Redo |
| \`Ctrl+S\` | Save project to .elbow file |
| \`Ctrl+O\` | Open .elbow project file |

**Mouse:**
- Left-click: context-dependent (orbit in Navigate, place point in Draw, select in Select)
- Right-click: cancel draw / pan camera
- Double-click: finish pipe in draw mode
`;

const ARCHITECTURE = `
## Architecture

\`\`\`
┌──────────────────────────────────────────────────────────────┐
│  UI Layer  (src/ui/ — React components, R3F scene)           │
│    • Mode-based interaction (Navigate / Draw / Select)        │
│    • Toolbar, PipeInspector, LayerPanel, ExportPanel          │
│    • Canvas with GlowRings, PipeRenderer, FittingRenderer     │
└────────────┬─────────────────────────────────────────────────┘
             │ EventBus (pub/sub, src/core/EventBus.ts)
             ▼
┌──────────────────────────────────────────────────────────────┐
│  State  (src/store/ — Zustand stores)                        │
│    • pipeStore    — committed pipes + undo/redo               │
│    • layerStore   — system visibility toggles                 │
│    • interactionStore — mode, draw plane, diameter            │
└────────────┬─────────────────────────────────────────────────┘
             │ SimulationBridge (src/engine/worker/)
             ▼
┌──────────────────────────────────────────────────────────────┐
│  Engine  (src/engine/ — Web Worker, headless)                │
│    • PlumbingDAG — directed acyclic graph of nodes/edges      │
│    • PropagationSolver — 5-pass pipeline:                     │
│        1. DFU accumulation (IPC Table 709.1)                  │
│        2. Auto pipe sizing (IPC Tables 710.1 / 604.4)         │
│        3. Darcy-Weisbach pressure drop (Colebrook-White)      │
│        4. ACC compliance (Knowledge Graph + PCSP)             │
│        5. BOM aggregation + cut-length optimization           │
│    • ZTPBD demand model (UPC 2024 Appendix M)                 │
│    • Auto-router (SDF + gravity-aware A*)                     │
│    • IFC export (ISO 16739)                                   │
└──────────────────────────────────────────────────────────────┘
\`\`\`

### Data Flow: User draws a pipe

\`\`\`
1. User presses D → Navigate mode → Draw mode
2. User clicks twice to place waypoints
3. User presses Enter → finishDraw() → EV.PIPE_COMPLETE
4. pipeStore.addPipe() ← subscribed to PIPE_COMPLETE
5. PipeRenderer re-renders with new pipe (TubeGeometry)
6. SimulationBridge intercepts PIPE_COMPLETE → creates graph nodes/edges
7. Web Worker runs 5-pass solver (~10ms)
8. Results bounce back via SimulationMessageBus
9. pipeStore updates diameter if solver resized
10. Compliance violations emit EV.CODE_VIOLATION → red highlights
\`\`\`
`;

// ── Main ────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('ERROR: src/ not found at', SRC);
    process.exit(1);
  }

  const files = walk(SRC, SRC);
  const groups = groupByDir(files);

  const sections = [HEADER, QUICKSTART, TECH_STACK, KEYS, ARCHITECTURE];

  // ── File tree with descriptions ────────────────────────────
  sections.push('\n## Source File Index\n');
  sections.push(`Total TypeScript/TSX files: **${files.length}**\n`);

  const sortedDirs = [...groups.keys()].sort((a, b) => {
    if (a === '(root)') return -1;
    if (b === '(root)') return 1;
    return a.localeCompare(b);
  });

  for (const dir of sortedDirs) {
    const filesInDir = groups.get(dir).sort((a, b) => a.relPath.localeCompare(b.relPath));
    const dirHeader = dir === '(root)' ? 'src/' : `src/${dir}/`;
    sections.push(`### \`${dirHeader}\`\n`);
    sections.push('| File | Purpose | Exports |');
    sections.push('|------|---------|---------|');

    for (const f of filesInDir) {
      try {
        const content = fs.readFileSync(f.absPath, 'utf8');
        const doc = extractJSDoc(content);
        const exports = extractExports(content);
        const fileName = f.relPath.split('/').pop();
        const summary = doc
          ? doc.substring(0, 100).replace(/\|/g, '\\|') + (doc.length > 100 ? '…' : '')
          : '—';
        const exportList = exports.length > 0
          ? exports.slice(0, 4).join(', ') + (exports.length > 4 ? `, +${exports.length - 4}` : '')
          : '—';
        sections.push(`| \`${fileName}\` | ${summary} | ${exportList} |`);
      } catch {
        // skip unreadable files
      }
    }
    sections.push('');
  }

  // ── Footer ─────────────────────────────────────────────────
  sections.push('\n---\n');
  sections.push(`\n_Generated by \`tools/generate-reference.cjs\` on ${new Date().toISOString()}_\n`);

  fs.writeFileSync(OUT, sections.join('\n'), 'utf8');
  console.log(`[generate-reference] Wrote ${OUT} (${files.length} files indexed)`);
}

try {
  main();
} catch (err) {
  console.error('[generate-reference] Failed:', err.message);
  process.exit(0); // fail silently so hook doesn't block
}
