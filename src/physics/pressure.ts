/**
 * Wind pressure calculations — ASCE 7-22 Chapter 30 (C&C) for low-rise buildings.
 * All functions are pure. No DOM, no React, no side effects.
 */

import {
  ASCE_VELOCITY_CONSTANT,
  ORLANDO_RANCH_VELOCITY_K,
  GCp,
  GCP_BY_SHAPE,
  GCpi_PARTIALLY_ENCLOSED,
  GCpi_FULLY_ENCLOSED,
  type RoofZone,
  type RoofShape,
} from './constants';
import { kzAtHeight, heightForStories, type Exposure } from './exposure';

/**
 * Generic ASCE velocity pressure:
 *   q = 0.00256 · Kz · Kzt · Kd · Ke · V²
 */
export function velocityPressure(
  V: number,
  Kz: number,
  Kzt = 1.0,
  Kd = 0.85,
  Ke = 1.0,
): number {
  return ASCE_VELOCITY_CONSTANT * Kz * Kzt * Kd * Ke * V * V;
}

/**
 * Pre-simplified Orlando one-story ranch (Exposure B, h=12 ft):
 *   q ≈ 0.001523 · V²  psf
 * Preserved for the disclosure drawer's worked example. Use
 * configurableVelocityPressure() for any non-default config.
 */
export function orlandoRanchVelocityPressure(V: number): number {
  return ORLANDO_RANCH_VELOCITY_K * V * V;
}

/**
 * Velocity pressure with a configurable house — derives Kz from height
 * (which we get from story count) and the chosen exposure category.
 * For 1-story ranch + Exposure B this matches orlandoRanchVelocityPressure
 * within ~0.5%.
 */
export function configurableVelocityPressure(
  V: number,
  config: { stories: 1 | 2 | 3; exposure: Exposure },
): number {
  const h = heightForStories(config.stories);
  const Kz = kzAtHeight(h, config.exposure);
  return velocityPressure(V, Kz);
}

/**
 * Net uplift on a C&C roof element:
 *   p = q · |GCp - GCpi|
 *
 * Worst-case combo: GCp negative (outward suction) with GCpi positive
 * (interior pressurization pushes out). Magnitudes add.
 */
export function netUpliftPressure(
  q: number,
  zone: RoofZone,
  GCpi: number = GCpi_PARTIALLY_ENCLOSED,
  shape: RoofShape = 'gable',
): number {
  const gcp = GCP_BY_SHAPE[shape][zone];
  return q * Math.abs(gcp - GCpi);
}

export interface UpliftProfile {
  V: number;
  q: number;
  field: number;
  edge: number;
  corner: number;
}

/**
 * Convenience: full uplift profile across all zones at a given wind speed,
 * using the Orlando ranch reference (legacy default).
 */
export function orlandoUpliftProfile(V: number): UpliftProfile {
  const q = orlandoRanchVelocityPressure(V);
  return {
    V,
    q,
    field: netUpliftPressure(q, 'field'),
    edge: netUpliftPressure(q, 'edge'),
    corner: netUpliftPressure(q, 'corner'),
  };
}

/**
 * Configurable uplift profile — accepts the full house config.
 */
export interface HouseConfig {
  stories: 1 | 2 | 3;
  exposure: Exposure;
  shape: RoofShape;
  enclosed: 'fully' | 'partial';
}

export const DEFAULT_HOUSE_CONFIG: HouseConfig = {
  stories: 1,
  exposure: 'B',
  shape: 'gable',
  enclosed: 'partial',
};

export function configurableUpliftProfile(
  V: number,
  config: HouseConfig = DEFAULT_HOUSE_CONFIG,
): UpliftProfile {
  const q = configurableVelocityPressure(V, config);
  const GCpi =
    config.enclosed === 'fully' ? GCpi_FULLY_ENCLOSED : GCpi_PARTIALLY_ENCLOSED;
  return {
    V,
    q,
    field: netUpliftPressure(q, 'field', GCpi, config.shape),
    edge: netUpliftPressure(q, 'edge', GCpi, config.shape),
    corner: netUpliftPressure(q, 'corner', GCpi, config.shape),
  };
}

// re-export for downstream consumers that previously imported from constants
export { GCp };
