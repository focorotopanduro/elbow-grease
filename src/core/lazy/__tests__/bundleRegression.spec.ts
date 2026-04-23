// Bundle regression guard — Phase 10.B.
//
// The SVGExporter and IFCSerializer modules MUST stay out of the
// eager import graph rooted at App.tsx, ExportPanel.tsx, and any
// other top-level UI entry point. If someone adds a direct static
// import by mistake, Vite silently folds the module back into the
// main bundle and our first-load budget silently grows.
//
// Strategy: grep every src/ .ts/.tsx file (excluding the lazy-loader
// file itself and the exporter files) for static import statements
// that reference the exporter paths. Any hit fails the test with
// the exact file + line so the author sees immediately what broke.
//
// What we ACCEPT:
//   - import type - type-only, erased at build.
//   - Dynamic import('path') - that's the lazy path we want.
//   - The file paths themselves in comments / ADRs / strings.
//
// What we REJECT:
//   - Any static `import { ... } from '.../SVGExporter'`
//   - Any static `import ... from '.../IFCSerializer'`

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');
const FORBIDDEN_MODULES = ['SVGExporter', 'IFCSerializer'];

// Files excluded from the check — either because they own the module
// or because they wrap it behind a lazy loader.
const ALLOWED_FILES = new Set<string>([
  'src/engine/export/SVGExporter.ts',
  'src/engine/export/IFCSerializer.ts',
  'src/core/lazy/loaders.ts',
  // Tests are allowed to assert things about these modules.
]);

interface Hit {
  file: string;
  line: number;
  text: string;
}

function findEagerImports(): Hit[] {
  const hits: Hit[] = [];

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const relToCwd = full.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '').replace(/\\/g, '/');
      if (ALLOWED_FILES.has(relToCwd)) continue;
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
      const content = readFileSync(full, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip type-only imports (erased at build time).
        if (/^\s*import\s+type\b/.test(line)) continue;
        // Skip lines that are comments only.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

        for (const forbidden of FORBIDDEN_MODULES) {
          // Catch `import ... from './.../SVGExporter'` or similar.
          // Match static `import` (not dynamic `import(...)`).
          const staticImportRegex = new RegExp(
            String.raw`^\s*import\s+[^(]*from\s+['"][^'"]*${forbidden}['"]`,
          );
          if (staticImportRegex.test(line)) {
            hits.push({ file: relToCwd, line: i + 1, text: line.trim() });
          }
        }
      }
    }
  };

  walk(SRC_ROOT);
  return hits;
}

describe('Bundle regression — lazy-loaded exporters stay lazy', () => {
  it('no eager imports of SVGExporter or IFCSerializer anywhere in src/', () => {
    const hits = findEagerImports();
    if (hits.length > 0) {
      const report = hits
        .map((h) => `  ${h.file}:${h.line}  →  ${h.text}`)
        .join('\n');
      throw new Error(
        'Eager import(s) of lazy-loaded modules detected:\n' +
        report +
        '\n\nUse `loadSvgExporter` / `loadIfcSerializer` from @core/lazy/loaders instead.',
      );
    }
    expect(hits).toHaveLength(0);
  });

  it('loaders.ts is the only place the forbidden modules appear in a dynamic import()', () => {
    // Sanity: make sure our loaders file actually references both.
    const loaders = readFileSync(join(SRC_ROOT, 'core/lazy/loaders.ts'), 'utf8');
    expect(loaders).toContain('SVGExporter');
    expect(loaders).toContain('IFCSerializer');
  });
});
