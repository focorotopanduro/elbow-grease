/**
 * useFixtureRotationShortcuts — Phase 14.E tests.
 *
 * Covers the pure `rotationKeyToDeg` handler in isolation. The
 * DOM-bound useEffect path is integration-level (needs a live
 * fixture store + a dispatched keydown) and is exercised in manual
 * QA per ADR 036.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeDeg,
  rotationKeyToDeg,
  type RotationKeyEvent,
} from '../useFixtureRotationShortcuts';

function ev(
  key: string,
  mods: Partial<Pick<RotationKeyEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>> = {},
): RotationKeyEvent {
  return {
    key,
    shiftKey: mods.shiftKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
  };
}

// ── normalizeDeg ──────────────────────────────────────────────

describe('normalizeDeg', () => {
  it('leaves 0..359 unchanged', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(90)).toBe(90);
    expect(normalizeDeg(359)).toBe(359);
  });

  it('wraps 360 → 0', () => {
    expect(normalizeDeg(360)).toBe(0);
  });

  it('wraps above 360', () => {
    expect(normalizeDeg(375)).toBe(15);
    expect(normalizeDeg(720)).toBe(0);
  });

  it('wraps negative values', () => {
    expect(normalizeDeg(-15)).toBe(345);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(-360)).toBe(0);
  });
});

// ── Bare brackets: ±15° ────────────────────────────────────────

describe('bare brackets — ±15° nudge', () => {
  it('] → +15°', () => {
    expect(rotationKeyToDeg(0, ev(']'))).toBe(15);
    expect(rotationKeyToDeg(345, ev(']'))).toBe(0); // wraps
  });

  it('[ → -15°', () => {
    expect(rotationKeyToDeg(15, ev('['))).toBe(0);
    expect(rotationKeyToDeg(0, ev('['))).toBe(345); // wraps
  });
});

// ── Shift+brackets: ±5° fine ──────────────────────────────────

describe('Shift+brackets — ±5° fine', () => {
  it('Shift+] → +5°', () => {
    expect(rotationKeyToDeg(0, ev('}', { shiftKey: true }))).toBe(5);
  });

  it('Shift+[ → -5°', () => {
    expect(rotationKeyToDeg(5, ev('{', { shiftKey: true }))).toBe(0);
  });

  it('accepts the produced char `{` / `}` OR the base `[` / `]` key', () => {
    // Some layouts report `key: ']'` with shiftKey:true instead of `}`.
    expect(rotationKeyToDeg(0, ev(']', { shiftKey: true }))).toBe(5);
    expect(rotationKeyToDeg(0, ev('[', { shiftKey: true }))).toBe(355);
  });
});

// ── Ctrl+brackets: ±90° cardinal ──────────────────────────────

describe('Ctrl+brackets — ±90° cardinal', () => {
  it('Ctrl+] → +90°', () => {
    expect(rotationKeyToDeg(0, ev(']', { ctrlKey: true }))).toBe(90);
    expect(rotationKeyToDeg(90, ev(']', { ctrlKey: true }))).toBe(180);
    expect(rotationKeyToDeg(270, ev(']', { ctrlKey: true }))).toBe(0); // wraps
  });

  it('Ctrl+[ → -90°', () => {
    expect(rotationKeyToDeg(0, ev('[', { ctrlKey: true }))).toBe(270);
    expect(rotationKeyToDeg(90, ev('[', { ctrlKey: true }))).toBe(0);
  });
});

// ── Non-matching keys ─────────────────────────────────────────

describe('non-matching keys', () => {
  it('returns null for unrelated keys', () => {
    expect(rotationKeyToDeg(0, ev('r'))).toBeNull();
    expect(rotationKeyToDeg(0, ev('ArrowLeft'))).toBeNull();
    expect(rotationKeyToDeg(0, ev('Escape'))).toBeNull();
    expect(rotationKeyToDeg(0, ev('(')))
      .toBeNull();
    expect(rotationKeyToDeg(0, ev(')')))
      .toBeNull();
  });

  it('returns null when meta key is held (browser shortcut territory)', () => {
    expect(rotationKeyToDeg(0, ev(']', { metaKey: true }))).toBeNull();
    expect(rotationKeyToDeg(0, ev('[', { metaKey: true }))).toBeNull();
  });
});

// ── Precedence ────────────────────────────────────────────────

describe('Ctrl beats Shift when both modifiers are held', () => {
  // Ctrl+Shift+] → should be 90° (Ctrl wins), not 5°.
  // This matches OS convention: Ctrl is the "coarser" modifier.
  it('prefers Ctrl (90°) over Shift (5°) when both are held', () => {
    expect(rotationKeyToDeg(0, ev(']', { ctrlKey: true, shiftKey: true }))).toBe(90);
  });
});
