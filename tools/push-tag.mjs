#!/usr/bin/env node
/**
 * push-tag.mjs — commit the version bump and push a `vX.Y.Z` tag.
 * The tag push is what GitHub Actions watches for — it triggers the
 * release workflow that builds the Windows installer, signs it with
 * the Tauri minisign key, and publishes it + `latest.json` to
 * GitHub Releases. No other manual step is needed after this.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;

// Ensure we're in a clean git state apart from the version-bump files.
try {
  const changed = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
  const lines = changed.split('\n').filter(Boolean);
  const allowed = new Set([
    'package.json',
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml',
    'src-tauri/Cargo.lock',
  ]);
  const stray = lines
    .map((l) => l.replace(/^...\s?/, '').trim())
    .filter((p) => !allowed.has(p));
  if (stray.length > 0) {
    console.error('Refusing to tag: there are uncommitted changes beyond the version bump:');
    stray.forEach((p) => console.error('  ' + p));
    console.error('Commit or stash them first.');
    process.exit(1);
  }
} catch (err) {
  console.error('git status failed:', err.message);
  process.exit(1);
}

run('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock');
run(`git commit -m "chore(release): ${tag}"`);
run(`git tag -a ${tag} -m "Release ${tag}"`);
run('git push');
run(`git push origin ${tag}`);

console.log(`\n✓ Pushed ${tag}. GitHub Actions will now build + publish the release.`);
console.log('  Watch: https://github.com/<owner>/<repo>/actions');
