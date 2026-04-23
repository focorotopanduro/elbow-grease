/**
 * DrawingWheel — workspace-accent integration tests.
 *
 * The wheel's accent color is now sourced from
 * `APP_MODE_ACCENTS[currentMode]` rather than a hardcoded
 * `#00e5ff`. Locks in:
 *
 *   • In plumbing mode, `accentColor` is cyan (visually
 *     unchanged from the pre-refactor hardcoded value — this
 *     is the backwards-compat assertion).
 *   • In roofing mode (if the wheel ever opens there), the
 *     accent is orange. Today's hotkey is plumbing-gated so
 *     the wheel won't open in roofing, but the pure helper is
 *     ready for future wiring.
 *   • The pure `getDrawingWheelConfig(accent)` helper is a
 *     1:1 pass-through — whatever accent you pass is what the
 *     config carries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { getDrawingWheelConfig } from '../DrawingWheel';
import { APP_MODE_ACCENTS } from '@store/appModeStore';

beforeEach(() => {
  // No store seeding needed — the pure helper accepts the
  // accent as an argument.
});

afterEach(() => {
  cleanup();
});

describe('DrawingWheel config — accent comes from the caller', () => {
  it('passes the plumbing accent straight through to config.accentColor', () => {
    const config = getDrawingWheelConfig(APP_MODE_ACCENTS.plumbing);
    expect(config.accentColor).toBe(APP_MODE_ACCENTS.plumbing);
  });

  it('passes the roofing accent straight through (forward-compat)', () => {
    const config = getDrawingWheelConfig(APP_MODE_ACCENTS.roofing);
    expect(config.accentColor).toBe(APP_MODE_ACCENTS.roofing);
  });

  it('accepts any string accent (pure helper — no validation)', () => {
    const config = getDrawingWheelConfig('#123456');
    expect(config.accentColor).toBe('#123456');
  });

  it('accentColor replaces the pre-refactor hardcoded `#00e5ff`', () => {
    // Sanity check that the plumbing accent value hasn't drifted
    // from the cyan hex. If this changes, either `APP_MODE_ACCENTS`
    // updated intentionally or the wheel's accent just broke.
    expect(APP_MODE_ACCENTS.plumbing).toBe('#00e5ff');
  });

  it('preserves the rest of the config (title, sectors, radii)', () => {
    const config = getDrawingWheelConfig(APP_MODE_ACCENTS.plumbing);
    expect(config.id).toBe('drawing');
    expect(config.title).toBe('DRAWING');
    expect(config.sectors).toHaveLength(4);
    expect(config.outerRadiusPx).toBe(220);
    expect(config.innerRadiusPx).toBe(70);
  });
});
