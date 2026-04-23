/**
 * formulaEngine — Phase 14.AB.1 tests.
 *
 * Covers the shunting-yard parser + evaluator + aux helpers.
 * Locks the port behavior against the original Dart formula
 * engine while tightening error reporting.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateFormula,
  parseCurrencyNumber,
  aggregate,
} from '../formulaEngine';

// ── evaluateFormula ──────────────────────────────────────────

describe('evaluateFormula — basic arithmetic', () => {
  it('empty / whitespace → 0 (no error)', () => {
    expect(evaluateFormula('')).toEqual({ ok: true, value: 0 });
    expect(evaluateFormula('   ')).toEqual({ ok: true, value: 0 });
  });

  it('single literal', () => {
    expect(evaluateFormula('42')).toEqual({ ok: true, value: 42 });
  });

  it('addition', () => {
    expect(evaluateFormula('1 + 2')).toEqual({ ok: true, value: 3 });
  });

  it('subtraction', () => {
    expect(evaluateFormula('10 - 3')).toEqual({ ok: true, value: 7 });
  });

  it('multiplication', () => {
    expect(evaluateFormula('4 * 5')).toEqual({ ok: true, value: 20 });
  });

  it('division', () => {
    expect(evaluateFormula('20 / 4')).toEqual({ ok: true, value: 5 });
  });

  it('decimals preserved', () => {
    expect(evaluateFormula('1.5 + 2.5')).toEqual({ ok: true, value: 4 });
    expect(evaluateFormula('0.25 * 8')).toEqual({ ok: true, value: 2 });
  });
});

describe('evaluateFormula — precedence + parens', () => {
  it('* before +', () => {
    expect(evaluateFormula('2 + 3 * 4')).toEqual({ ok: true, value: 14 });
  });

  it('parens override precedence', () => {
    expect(evaluateFormula('(2 + 3) * 4')).toEqual({ ok: true, value: 20 });
  });

  it('nested parens', () => {
    expect(evaluateFormula('((1 + 2) * (3 + 4))')).toEqual({ ok: true, value: 21 });
  });

  it('left-to-right on equal precedence', () => {
    expect(evaluateFormula('100 - 30 - 20')).toEqual({ ok: true, value: 50 });
    expect(evaluateFormula('100 / 5 / 2')).toEqual({ ok: true, value: 10 });
  });
});

describe('evaluateFormula — unary minus', () => {
  it('literal at start', () => {
    expect(evaluateFormula('-5')).toEqual({ ok: true, value: -5 });
  });

  it('literal after operator', () => {
    expect(evaluateFormula('10 + -3')).toEqual({ ok: true, value: 7 });
  });

  it('literal after open paren', () => {
    expect(evaluateFormula('(-2) * 3')).toEqual({ ok: true, value: -6 });
  });

  it('variable negation via manual -1 *', () => {
    const r = evaluateFormula('-1 * [price]', { price: 20 });
    expect(r).toEqual({ ok: true, value: -20 });
  });
});

describe('evaluateFormula — variables', () => {
  it('single [Name] reference', () => {
    const r = evaluateFormula('[price]', { price: 42 });
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it('mixed literal + variable', () => {
    const r = evaluateFormula('[qty] * [price]', { qty: 3, price: 10 });
    expect(r).toEqual({ ok: true, value: 30 });
  });

  it('variable names with spaces', () => {
    const r = evaluateFormula('[Material Cost] + [Labor Hours] * 100', {
      'Material Cost': 50,
      'Labor Hours': 0.25,
    });
    expect(r).toEqual({ ok: true, value: 75 });
  });

  it('missing variable → error', () => {
    const r = evaluateFormula('[qty] + 1', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('qty');
  });

  it('multiple missing variables reported', () => {
    const r = evaluateFormula('[a] + [b] + [c]', { b: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('a');
      expect(r.error).toContain('c');
      expect(r.error).not.toContain(' b,'); // b is present
    }
  });
});

describe('evaluateFormula — divide-by-zero + errors', () => {
  it('divide by zero → ok:false, error: "divide by zero"', () => {
    const r = evaluateFormula('10 / 0');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain('divide by zero');
  });

  it('unbalanced ( → error', () => {
    const r = evaluateFormula('(1 + 2');
    expect(r.ok).toBe(false);
  });

  it('unbalanced ) → error', () => {
    const r = evaluateFormula('1 + 2)');
    expect(r.ok).toBe(false);
  });

  it('stack underflow on lone operator → error', () => {
    const r = evaluateFormula('+');
    expect(r.ok).toBe(false);
  });
});

describe('evaluateFormula — realistic pricing formulas', () => {
  it('fitting cost = material + labor_hours * labor_rate + markup', () => {
    const r = evaluateFormula(
      '[material] + [laborHours] * [rate] + 2.5',
      { material: 4.8, laborHours: 0.15, rate: 95 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(4.8 + 0.15 * 95 + 2.5, 5);
  });

  it('DFU-scaled pipe price', () => {
    const r = evaluateFormula(
      '[basePrice] * (1 + [dfu] / 100)',
      { basePrice: 15, dfu: 20 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(15 * 1.2);
  });

  it('tiered markup: (cost + 5) * 1.15', () => {
    const r = evaluateFormula('([material] + 5) * 1.15', { material: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(17.25, 5);
  });
});

// ── parseCurrencyNumber ──────────────────────────────────────

describe('parseCurrencyNumber', () => {
  it('plain number passes through', () => {
    expect(parseCurrencyNumber(42)).toBe(42);
    expect(parseCurrencyNumber(3.14)).toBeCloseTo(3.14);
  });

  it('strips $ and commas', () => {
    expect(parseCurrencyNumber('$1,234.56')).toBeCloseTo(1234.56);
    expect(parseCurrencyNumber('$42')).toBe(42);
  });

  it('null / undefined → 0', () => {
    expect(parseCurrencyNumber(null)).toBe(0);
    expect(parseCurrencyNumber(undefined)).toBe(0);
  });

  it('garbage string → 0', () => {
    expect(parseCurrencyNumber('hello')).toBe(0);
  });

  it('Infinity / NaN → 0', () => {
    expect(parseCurrencyNumber(Infinity)).toBe(0);
    expect(parseCurrencyNumber(NaN)).toBe(0);
  });
});

// ── aggregate ─────────────────────────────────────────────────

describe('aggregate', () => {
  const rows = [
    { cost: 10, qty: 2 },
    { cost: 20, qty: 3 },
    { cost: '$15', qty: 1 }, // currency string works
  ];

  it('sum totals column', () => {
    expect(aggregate(rows, 'cost', 'sum')).toBe(45);
    expect(aggregate(rows, 'qty', 'sum')).toBe(6);
  });

  it('average', () => {
    expect(aggregate(rows, 'cost', 'average')).toBe(15);
  });

  it('count returns row count regardless of column', () => {
    expect(aggregate(rows, 'cost', 'count')).toBe(3);
    expect(aggregate(rows, 'nonexistent', 'count')).toBe(3);
  });

  it('empty list: sum 0, avg 0, count 0', () => {
    expect(aggregate([], 'cost', 'sum')).toBe(0);
    expect(aggregate([], 'cost', 'average')).toBe(0);
    expect(aggregate([], 'cost', 'count')).toBe(0);
  });
});
