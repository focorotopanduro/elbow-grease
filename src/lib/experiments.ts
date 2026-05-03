import { useEffect, useState } from 'react';
import { track } from './analytics';
import { getSessionId } from './session';

/**
 * Lightweight first-party A/B test framework.
 *
 * Design principles:
 *   - **First-party only.** No Optimizely / VWO / Google Optimize.
 *     Variant assignment happens entirely in-browser via session
 *     storage + a deterministic hash of session_id + experiment_id.
 *   - **Deterministic per session.** The same visitor sees the same
 *     variant on every page within a session. No per-render flicker.
 *   - **URL-param override.** `?variant=experiment_id:variant_name`
 *     forces a specific variant (for QA + screenshots). Persists
 *     in session storage so navigating away keeps the override.
 *   - **Self-tracking.** Each fresh assignment fires an
 *     `experiment_assigned` cta_click event with the experiment id
 *     + variant, so the analytics layer knows which cohort the
 *     visitor was in when they did (or didn't) convert.
 *   - **Graceful degradation.** SSR-safe — returns the first variant
 *     when window/sessionStorage are unavailable.
 *
 * USAGE:
 *
 *   const variant = useExperiment('hero_cta_copy_v1');
 *   const copy = HERO_COPY_BY_VARIANT[variant] ?? HERO_COPY_BY_VARIANT.A;
 *
 * REGISTRY: docs/experiments.md catalogs every active experiment +
 * its success metric + minimum sample size.
 */

export type VariantName = string;

export interface Experiment {
  /** Stable id — also the analytics placement value. */
  id: string;
  /** Available variants. First entry is the control. */
  variants: VariantName[];
  /**
   * Optional weights for non-uniform traffic split. If omitted, equal
   * weight per variant. Length must match `variants` when provided.
   * Example: [50, 25, 25] for 50/25/25 split.
   */
  weights?: number[];
  /** Human-readable description of what's being tested. */
  description: string;
}

/* ─── Active experiment registry ─────────────────────────────────────── */

export const EXPERIMENTS: readonly Experiment[] = [
  {
    id: 'hero_cta_copy_v1',
    variants: ['A', 'B', 'C'],
    description:
      'Hero headline + sub + CTA copy. A=control (current copy), ' +
      'B=urgency ("Book Free Inspection — Today"), C=specificity ' +
      '("See My Roof\'s True Condition" + drone documentation).',
  },
] as const;

export function getActiveExperiments(): readonly Experiment[] {
  return EXPERIMENTS;
}

export function getExperiment(id: string): Experiment | undefined {
  return EXPERIMENTS.find((e) => e.id === id);
}

/* ─── Hash + assignment ──────────────────────────────────────────────── */

/**
 * FNV-1a 32-bit hash. Fast, deterministic, no external deps. Used for
 * variant assignment so the same session always sees the same variant.
 */
function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

function assignVariant(exp: Experiment, sessionId: string): VariantName {
  const hash = fnv1a(`${exp.id}:${sessionId}`);
  if (!exp.weights || exp.weights.length !== exp.variants.length) {
    return exp.variants[hash % exp.variants.length];
  }
  const totalWeight = exp.weights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) return exp.variants[0];
  const target = hash % totalWeight;
  let cumulative = 0;
  for (let i = 0; i < exp.variants.length; i++) {
    cumulative += exp.weights[i];
    if (target < cumulative) return exp.variants[i];
  }
  return exp.variants[exp.variants.length - 1];
}

/* ─── URL-param override ─────────────────────────────────────────────── */

/**
 * Parse `?variant=experiment_id:variant_name` from the URL.
 * Allows QA / screenshot workflows to force a specific variant.
 *
 * Supports a single override per page load. If you need multiple,
 * use `?variant=foo:A&variant=bar:B` — `URLSearchParams.getAll('variant')`
 * returns both.
 */
function getOverridesFromUrl(): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof window === 'undefined') return out;
  try {
    const params = new URLSearchParams(window.location.search);
    for (const value of params.getAll('variant')) {
      const [expId, variant] = value.split(':');
      if (expId && variant) out.set(expId, variant);
    }
  } catch {
    /* malformed search string — ignore */
  }
  return out;
}

/* ─── Storage ────────────────────────────────────────────────────────── */

const STORAGE_PREFIX = 'beit:exp:';

function getStored(experimentId: string): VariantName | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(STORAGE_PREFIX + experimentId);
  } catch {
    return null;
  }
}

function setStored(experimentId: string, variant: VariantName): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + experimentId, variant);
  } catch {
    /* private mode / quota full — variant just won't persist this session */
  }
}

/* ─── Hook ───────────────────────────────────────────────────────────── */

/**
 * Resolve the variant for a given experiment id. Returns the first
 * (control) variant during SSR / before hydration; the deterministic
 * variant on first effect tick. The `assigned-then-store` flow
 * guarantees no flicker on subsequent renders within the session.
 *
 * Resolution priority:
 *   1. URL-param override (`?variant=exp:variant`)
 *   2. Previously-stored assignment (sessionStorage)
 *   3. Fresh deterministic assignment
 */
export function useExperiment(experimentId: string): VariantName {
  const exp = getExperiment(experimentId);
  // SSR + first paint: return control. The actual assignment happens
  // in useEffect to avoid hydration mismatches.
  const [variant, setVariant] = useState<VariantName>(
    () => exp?.variants[0] ?? 'A',
  );

  useEffect(() => {
    if (!exp) return;

    // 1) URL-param override wins. Persist so the override survives
    //    in-page navigation.
    const overrides = getOverridesFromUrl();
    const urlOverride = overrides.get(experimentId);
    if (urlOverride && exp.variants.includes(urlOverride)) {
      setVariant(urlOverride);
      setStored(experimentId, urlOverride);
      return;
    }

    // 2) Previous assignment for this session — keeps consistency
    //    across pages within a single visit.
    const stored = getStored(experimentId);
    if (stored && exp.variants.includes(stored)) {
      setVariant(stored);
      return;
    }

    // 3) Fresh deterministic assignment. Track the assignment ONCE
    //    so analytics knows the cohort.
    const sessionId = getSessionId();
    const assigned = assignVariant(exp, sessionId);
    setVariant(assigned);
    setStored(experimentId, assigned);
    track('cta_click', {
      cta: 'experiment_assigned',
      placement: experimentId,
      variant: assigned,
    });
  }, [experimentId, exp]);

  return variant;
}

/* ─── Pure helpers (test-friendly) ───────────────────────────────────── */

/**
 * Pure variant assignment — exposed for unit tests. Given a session id
 * + experiment, returns the deterministic variant. No side effects.
 */
export function _assignVariantPure(
  exp: Experiment,
  sessionId: string,
): VariantName {
  return assignVariant(exp, sessionId);
}
