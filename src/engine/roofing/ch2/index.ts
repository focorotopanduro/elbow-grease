/**
 * Chapter 2 — Sheathing, Decking & Loading module.
 *
 * Public API surface. Import from here:
 *
 *     import {
 *       determine_sheathing_type,
 *       SheathingSpecViolation,
 *       type JobInputs,
 *       type BidOutput,
 *     } from '@engine/roofing/ch2';
 *
 * Phased implementation status:
 *   • Phase 1 (shipped): types, constants, errors, ALG-001
 *   • Phase 2 (pending): ALG-002/003/013 loads + APA panel + OSB
 *   • Phase 3 (pending): ALG-004–011 board/spaced/fasteners/gaps/zones
 *   • Phase 4 (pending): ALG-014–017 tile staging + frame-load + venting
 *   • Phase 5 (pending): ALG-018–020 + RateSet + FL overrides + cost engine
 *   • Phase 6 (pending): 40-row edge-case matrix + RoofingInspector wiring
 *
 * Each phase lands as its own commit; public API stays additive.
 */

// Types
export * from './types';

// Constants
export * from './constants';

// Errors
export * from './errors';

// Algorithms
export { determine_sheathing_type } from './algorithms/sheathingDecision';
