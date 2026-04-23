/**
 * usePrefersReducedMotion — kept as a thin re-export during the
 * Phase 10.C rollout so RadialMenu (Phase 5) continues working
 * without code changes. New code should import directly from
 * `@core/a11y/useReducedMotion`.
 */

export { useReducedMotion as usePrefersReducedMotion } from '@core/a11y/useReducedMotion';
