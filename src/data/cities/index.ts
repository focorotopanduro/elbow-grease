/**
 * Cities barrel — central registry of every city landing page we ship.
 *
 * Add a new city in three steps:
 *   1. Create src/data/cities/<slug>.ts exporting a CityData const.
 *   2. Add it to the CITIES array below.
 *   3. Flip its entry in src/data/site-routes.json from
 *      `status: "draft"` to `status: "live"`.
 *   4. Add a per-city HTML entry (e.g., <slug>.html) and register it in
 *      vite.config.ts rollupOptions.input.
 *
 * The CityPage runtime resolves which city to render via the
 * data-city="<slug>" attribute on the #root element of each HTML file.
 */

import { ORLANDO } from './orlando';
import { WINTER_PARK } from './winter-park';
import { OVIEDO } from './oviedo';
import { OVIEDO_STORM_DAMAGE } from './oviedo-storm-damage';
import type { CityData } from './types';

export const CITIES: CityData[] = [
  ORLANDO,
  WINTER_PARK,
  OVIEDO,
  OVIEDO_STORM_DAMAGE,
];

/** Lookup helper — used by city-mount.tsx + tests. */
export function getCityBySlug(slug: string): CityData | undefined {
  return CITIES.find((c) => c.slug === slug);
}

export type { CityData };
