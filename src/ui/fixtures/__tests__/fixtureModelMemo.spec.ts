/**
 * FixtureWithSelection memo guard — Phase 14.AD.3.
 *
 * React.memo short-circuits the render cycle of `FixtureWithSelection`
 * when its props are referentially unchanged. That's what keeps a
 * 50-fixture scene from re-rendering all 50 sub-trees when one
 * fixture moves — Zustand's immutable updates keep the other 49
 * fixtures' object refs identical, so memo's default shallow
 * compare returns equal.
 *
 * This spec checks the wrapping structurally. If a refactor drops
 * the `memo()` call, `$$typeof` reverts to `react.element` and the
 * test trips with a named failure.
 */

import { describe, it, expect } from 'vitest';
import { FixtureWithSelection } from '../FixtureModels';

describe('FixtureWithSelection — React.memo regression guard', () => {
  it('is a React.memo-wrapped component', () => {
    // React memo wrappers are tagged with Symbol.for('react.memo') on
    // their `$$typeof` marker. Plain function components don't have
    // this — they're raw function values. If this assertion fails,
    // the component was un-memoized at some point.
    const typeOf = (FixtureWithSelection as unknown as { $$typeof?: symbol }).$$typeof;
    expect(typeOf).toBe(Symbol.for('react.memo'));
  });

  it('wraps the inner component under `type`', () => {
    // The memoized entry exposes the original component under `type`
    // (React convention). Just verifies the wrapper is well-formed.
    const inner = (FixtureWithSelection as unknown as { type?: unknown }).type;
    expect(typeof inner).toBe('function');
  });
});
