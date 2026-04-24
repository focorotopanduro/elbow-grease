/**
 * ALG-014 + ALG-015 — Tile loading / staging patterns.
 *
 * Source: spec §6 ALG-014, ALG-015. Book §2M (Figure 2-18 for hip).
 *
 * ─── What this produces ───────────────────────────────────────
 *
 * Tile roofs require pre-staging pallets of tile on the deck
 * before the installer starts setting them. Staging in the wrong
 * place wastes labor (moving stacks) and can overload the deck
 * (tile is heavy — 10–16 psf — plus crew + equipment weight).
 *
 * §2M prescribes a pattern: 8-tile stacks on every 4th course,
 * 4-tile stacks at the ridge, all with 1 ft horizontal gaps.
 * Gable roofs get a clean tabulated layout (ALG-014). Hip roofs
 * need course-length scaling (the courses narrow toward the
 * peak) which the book doesn't tabulate — ALG-015 is a stub
 * until SKU-specific data lands.
 *
 * ─── Gable algorithm (ALG-014) ────────────────────────────────
 *
 * For each course 1..slope_courses:
 *   course == slope_courses (ridge)     → stack 4
 *   course % 4 == 0 (every 4th below)   → stack 8
 *   otherwise                           → not loaded (absent)
 *
 * Ridge priority: when slope_courses is divisible by 4, the ridge
 * rule overrides the every-4th rule. The ridge gets a SMALLER (4)
 * stack because the peak has less area for tile to spread across.
 *
 * Spec §6 ALG-014 edge cases:
 *
 *   slope_courses | output
 *   --------------|-----------------------------------------------
 *        10       | [{4,8}, {8,8}, {10,4}]   (ridge at 10, size 4)
 *         3       | [{3,4}]                  (ridge at 3 only)
 *         0       | raises InvalidGeometry
 *
 * ─── Hip algorithm (ALG-015) — STUB ───────────────────────────
 *
 * Returns empty stacks + general-rule strings + appends the
 * `hip_tile_loading_review_needed` flag so downstream estimators
 * know to get human input for a real hip staging plan. Full
 * implementation blocked on course-length-scaled SKU tables.
 */

import type { TileLoadingPattern, TileStackEntry, WarningFlag } from '../types';
import {
  GABLE_COURSE_INTERVAL_FOR_STACKS,
  GABLE_STACK_SIZE_AT_RIDGE,
  GABLE_STACK_SIZE_EVERY_4TH_COURSE,
  TILE_HORIZONTAL_GAP_BETWEEN_STACKS_FT,
} from '../constants';
import { InvalidGeometry } from '../errors';

/** Human-readable staging rules for gable roofs. Cost engine
 *  concatenates these into BidOutput.staging_instruction. */
export const GABLE_TILE_GENERAL_RULES: readonly string[] = Object.freeze([
  `Load every ${GABLE_COURSE_INTERVAL_FOR_STACKS}th course with ` +
    `${GABLE_STACK_SIZE_EVERY_4TH_COURSE}-tile stacks spaced ` +
    `${TILE_HORIZONTAL_GAP_BETWEEN_STACKS_FT} ft apart horizontally (§2M).`,
  `Load the ridge course with ${GABLE_STACK_SIZE_AT_RIDGE}-tile ` +
    `stacks at the same ${TILE_HORIZONTAL_GAP_BETWEEN_STACKS_FT} ft ` +
    `horizontal spacing.`,
  'On reroof jobs: pre-load pallets onto the deck BEFORE tearing ' +
    'off the existing covering — saves a second crane lift.',
]);

/** Human-readable staging rules for hip roofs. Keep this aligned
 *  with the `hip_tile_loading_review_needed` flag message — both
 *  live in the same algorithm stub. */
export const HIP_TILE_GENERAL_RULES: readonly string[] = Object.freeze([
  `Space tile stacks ${TILE_HORIZONTAL_GAP_BETWEEN_STACKS_FT} ft ` +
    `apart horizontally regardless of course (§2M).`,
  'Use multiple pallets distributed across the roof — never a ' +
    'single concentrated load.',
  'On reroof: pre-load before tear-off (same rule as gable).',
  'Course length narrows toward the hip peak — stack sizes should ' +
    'scale accordingly. Review with installer; book table does ' +
    'not publish scaled values (see Figure 2-18 for illustration).',
]);

// ── ALG-014 ────────────────────────────────────────────────────

/**
 * Return the gable-roof tile staging pattern for a given course
 * count.
 *
 * @param slope_courses  Number of shingle/tile courses from eave
 *                       to ridge. Integer ≥ 1. Non-integer inputs
 *                       are coerced via `Math.floor` before
 *                       iteration — a half-course doesn't make
 *                       physical sense.
 *
 * @throws {InvalidGeometry} slope_courses ≤ 0 or non-finite.
 */
export function gable_tile_loading_pattern(slope_courses: number): TileLoadingPattern {
  if (!Number.isFinite(slope_courses) || slope_courses <= 0) {
    throw new InvalidGeometry(
      `slope_courses must be > 0 (finite), got ${slope_courses}`,
    );
  }

  // Coerce to integer — half-courses don't exist. Matches §2M
  // which tabulates by whole courses.
  const total = Math.floor(slope_courses);

  const stacks: TileStackEntry[] = [];
  for (let course = 1; course <= total; course++) {
    let stack_size: number | null = null;
    if (course === total) {
      // Ridge priority — ridge's 4-tile stack overrides the
      // every-4th rule even when the ridge is itself a multiple
      // of 4 (e.g. slope_courses=8 or 12).
      stack_size = GABLE_STACK_SIZE_AT_RIDGE;
    } else if (course % GABLE_COURSE_INTERVAL_FOR_STACKS === 0) {
      stack_size = GABLE_STACK_SIZE_EVERY_4TH_COURSE;
    }

    if (stack_size !== null) {
      stacks.push({
        course,
        stack_size,
        horizontal_gap_ft: TILE_HORIZONTAL_GAP_BETWEEN_STACKS_FT,
      });
    }
  }

  return {
    stacks,
    general_rules: GABLE_TILE_GENERAL_RULES,
  };
}

// ── ALG-015 (stub) ────────────────────────────────────────────

/**
 * Hip-roof tile loading pattern — STUB per spec §6 ALG-015.
 *
 * Hips need course-length-scaled stack sizes (courses shrink
 * toward the peak). The book illustrates the idea in Figure 2-18
 * but doesn't publish scaled values. Full implementation blocked
 * until SKU-specific data lands.
 *
 * Until then: returns empty `stacks` array + the human-readable
 * general rules + appends a `hip_tile_loading_review_needed` flag
 * so the cost engine surfaces "this needs human staging input"
 * to the user.
 *
 * @param slope_courses   Validated for geometry only — the stub
 *                        doesn't use it to compute stack sizes.
 * @param flags           Optional flag collector. When provided,
 *                        the review-needed flag is appended.
 */
export function hip_tile_loading_pattern(
  slope_courses: number,
  flags?: WarningFlag[],
): TileLoadingPattern {
  if (!Number.isFinite(slope_courses) || slope_courses <= 0) {
    throw new InvalidGeometry(
      `slope_courses must be > 0 (finite), got ${slope_courses}`,
    );
  }

  if (flags !== undefined) {
    flags.push({
      code: 'hip_tile_loading_review_needed',
      severity: 'warning',
      message:
        'Hip-roof tile staging pattern is not yet computed — book ' +
        'does not tabulate course-length-scaled stack sizes (§2M ' +
        'Figure 2-18 shows the concept only). Treat the general ' +
        'rules as guidance; have the installer produce a site-' +
        'specific staging plan.',
      remediation:
        'Get installer-provided staging plan OR use gable pattern ' +
        'as conservative proxy (over-stages the peak).',
    });
  }

  return {
    stacks: [],
    general_rules: HIP_TILE_GENERAL_RULES,
  };
}
