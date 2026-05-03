import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CityPage from './CityPage';
import { getCityBySlug } from '../data/cities';
import { reportWebVitals } from '../lib/webVitals';
import { installGlobalErrorHandlers } from '../lib/globalErrors';
import '../styles/index.css';

// Tier 7 — wire the global error handler before React mounts.
installGlobalErrorHandlers();

/**
 * city-mount — generic entrypoint shared by every per-city HTML file.
 *
 * Each city HTML page (orlando-roofing.html, winter-park-roofing.html, …)
 * boots this script and renders into a #root that carries
 * `data-city="<slug>"`. The slug resolves to one CityData object via
 * src/data/cities/index.ts.
 *
 * Why this pattern: Vite's MPA model is one HTML entry per city, but the
 * runtime is a single React app that knows how to render any city. New
 * cities only need a new HTML file (a copy with city-specific head meta)
 * and a new entry in the cities barrel — no per-city JS bundles.
 */

const root = document.getElementById('root');
if (!root) {
  throw new Error('city-mount: #root element not found in document');
}

const slug = root.dataset.city;
if (!slug) {
  throw new Error(
    'city-mount: #root is missing data-city="<slug>" attribute. ' +
      'Each city HTML must declare the slug it represents.',
  );
}

const city = getCityBySlug(slug);
if (!city) {
  throw new Error(
    `city-mount: no CityData registered for slug "${slug}". ` +
      'Add the city to src/data/cities/index.ts CITIES array.',
  );
}

createRoot(root).render(
  <StrictMode>
    <CityPage city={city} />
  </StrictMode>,
);

// Tier 3 — Core Web Vitals telemetry on city pages too. Each city page
// reports independently, so dashboards can split CWV by route surface
// (home vs city vs blog).
reportWebVitals();
