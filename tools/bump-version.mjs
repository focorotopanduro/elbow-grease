#!/usr/bin/env node
/**
 * bump-version.mjs — sync SemVer across the three version strings that
 * Tauri + npm + Cargo each track independently.
 *
 *   package.json        "version": "X.Y.Z"
 *   src-tauri/tauri.conf.json  "version": "X.Y.Z"
 *   src-tauri/Cargo.toml       version = "X.Y.Z"   (top-level [package])
 *
 * Usage:
 *   node tools/bump-version.mjs patch    →  0.1.0 → 0.1.1
 *   node tools/bump-version.mjs minor    →  0.1.0 → 0.2.0
 *   node tools/bump-version.mjs major    →  0.1.0 → 1.0.0
 *   node tools/bump-version.mjs 1.2.3    →  set exact version
 *
 * Why a custom script: `npm version patch` only touches package.json,
 * leaving Tauri + Cargo stale → updater manifests end up mismatched
 * and auto-update loops. This keeps them identical.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PKG_JSON   = resolve(ROOT, 'package.json');
const TAURI_JSON = resolve(ROOT, 'src-tauri/tauri.conf.json');
const CARGO_TOML = resolve(ROOT, 'src-tauri/Cargo.toml');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function bump(current, kind) {
  // Exact version?
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;

  const [maj, min, patch] = current.split('.').map((n) => parseInt(n, 10));
  if (Number.isNaN(maj) || Number.isNaN(min) || Number.isNaN(patch)) {
    throw new Error(`Cannot parse current version: ${current}`);
  }
  switch (kind) {
    case 'major': return `${maj + 1}.0.0`;
    case 'minor': return `${maj}.${min + 1}.0`;
    case 'patch': return `${maj}.${min}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump kind: ${kind} (use patch|minor|major|X.Y.Z)`);
  }
}

function updateCargoToml(path, newVersion) {
  const text = readFileSync(path, 'utf8');
  // Only update the FIRST `version = "..."` (top-level [package]).
  // Dependencies also have version = "..." lines — don't touch those.
  const lines = text.split('\n');
  let inPackage = false;
  let done = false;
  const out = lines.map((line) => {
    if (done) return line;
    if (/^\s*\[package\]\s*$/.test(line)) { inPackage = true; return line; }
    if (/^\s*\[/.test(line)) inPackage = false;
    if (inPackage && /^\s*version\s*=/.test(line)) {
      done = true;
      return line.replace(/version\s*=\s*"[^"]*"/, `version = "${newVersion}"`);
    }
    return line;
  });
  if (!done) throw new Error('Could not find [package] version in Cargo.toml');
  writeFileSync(path, out.join('\n'));
}

// ── main ──────────────────────────────────────────────────────────

const kind = process.argv[2];
if (!kind) {
  console.error('Usage: bump-version.mjs <patch|minor|major|X.Y.Z>');
  process.exit(1);
}

const pkg = readJson(PKG_JSON);
const current = pkg.version;
const next = bump(current, kind);

console.log(`Bumping: ${current} → ${next}`);

// 1. package.json
pkg.version = next;
writeJson(PKG_JSON, pkg);

// 2. tauri.conf.json
const tauriCfg = readJson(TAURI_JSON);
tauriCfg.version = next;
writeJson(TAURI_JSON, tauriCfg);

// 3. Cargo.toml
updateCargoToml(CARGO_TOML, next);

console.log('✓ package.json, tauri.conf.json, Cargo.toml updated');
console.log(`Next: npm run release:tag  (creates v${next} git tag and pushes)`);
