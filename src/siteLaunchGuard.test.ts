import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIVE_READINESS } from './data/liveReadiness';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(...segments: string[]) {
  return readFileSync(resolve(ROOT, ...segments), 'utf8');
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

describe('public launch guards', () => {
  it('keeps the deferred hurricane simulator out of public redirects', () => {
    const vercel = JSON.parse(readProjectFile('vercel.json')) as {
      redirects?: Array<{ source?: string; destination?: string }>;
    };

    const redirects = vercel.redirects ?? [];
    const hurricaneRedirects = redirects.filter((r) =>
      String(r.source ?? '').includes('hurricane-uplift'),
    );

    expect(
      redirects.some((r) => String(r.destination ?? '').includes('/hurricane-uplift.html')),
    ).toBe(false);
    expect(hurricaneRedirects.length).toBeGreaterThan(0);
    expect(hurricaneRedirects.every((r) => r.destination === '/#contact')).toBe(true);
  });

  it('allows crawlers to fetch production CSS and JS assets', () => {
    const robots = readProjectFile('public', 'robots.txt');

    expect(robots).not.toMatch(/^Disallow:\s*\/assets\/?$/m);
    expect(robots).toMatch(/^Disallow:\s*\/hurricane-uplift(?:\.html)?$/m);
  });

  it('keeps live route metadata free of unverified trust claims', () => {
    const manifest = JSON.parse(readProjectFile('src', 'data', 'site-routes.json')) as {
      routes: Array<{ status?: string; description?: string }>;
    };

    const liveDescriptions = manifest.routes
      .filter((route) => route.status === 'live')
      .map((route) => route.description ?? '');

    expect(liveDescriptions).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/licensed\s*(?:&|and)\s*insured|fully insured|guaranteed results/i),
      ]),
    );
  });

  it('keeps frontend launch gates aligned with the JSON build switches', () => {
    const flags = JSON.parse(readProjectFile('src', 'data', 'liveReadiness.json'));

    expect(LIVE_READINESS).toEqual(flags);
  });

  it('keeps unverified proof modules behind compile-time launch gates', () => {
    const app = readProjectFile('src', 'App.tsx');
    const cityPage = readProjectFile('src', 'pages', 'CityPage.tsx');
    const cityCss = readProjectFile('src', 'pages', 'CityPage.css');

    expect(app).not.toMatch(/import\s+Stats\s+from\s+['"]\.\/sections\/Stats['"]/);
    expect(app).not.toMatch(/import\s+Testimonials\s+from\s+['"]\.\/sections\/Testimonials['"]/);
    expect(app).toMatch(/const Stats = SHOW_STATS \? lazy/);
    expect(app).toMatch(/const Testimonials = SHOW_TESTIMONIALS/);

    expect(cityPage).not.toMatch(/import\s+Testimonials\s+from\s+['"]\.\.\/sections\/Testimonials['"]/);
    expect(cityPage).toMatch(/const CityProjects = SHOW_CITY_PROJECT_GALLERIES/);
    expect(cityCss).not.toMatch(/city-projects/);
  });

  it('ships a fresh service-worker cache namespace for the current launch pass', () => {
    const sw = readProjectFile('public', 'sw.js');

    expect(sw).toContain("const VERSION = 'BBC_CACHE_v2026_05_03';");
    expect(sw).not.toContain("const VERSION = 'BBC_CACHE_v1';");
  });

  it('keeps source backups out of the public deploy folder', () => {
    const publicDir = resolve(ROOT, 'public');
    const forbidden = listFiles(publicDir)
      .map((file) => relative(publicDir, file).replace(/\\/g, '/'))
      .filter((file) => /\.(?:bak|psd|ai|sketch|fig|zip|rar|7z)$/i.test(file));

    expect(forbidden).toEqual([]);
  });

  it('keeps Hostinger static routing from faking API success', () => {
    const htaccess = readProjectFile('public', '.htaccess');

    expect(htaccess).toMatch(/RewriteRule\s+\^api\/\s+-\s+\[R=404,L\]/);
    expect(htaccess).toContain('https://api.web3forms.com');
    expect(htaccess).toMatch(/RewriteRule\s+\^\(\.\+\?\)\/\?\$\s+\$1\.html\s+\[L\]/);
  });
});
