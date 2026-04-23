/**
 * formulaEngine — Phase 14.AB.1
 *
 * Zero-dependency shunting-yard expression evaluator. Ported from
 * LOVEDECIDES/WiDecide's `formula_engine.dart`, rewritten in
 * TypeScript with:
 *
 *   • Typed variable context `Record<string, number>` (Dart used
 *     `Map<String, dynamic>` with runtime $/comma stripping — our
 *     port sticks with pre-normalized numbers since callers already
 *     have strongly-typed records).
 *   • Error reporting via a `FormulaResult` union instead of
 *     swallow-and-return-0. Pricing calculations should fail loudly
 *     when an expression is malformed.
 *   • Unary minus handling preserved from the Dart version.
 *   • Divide-by-zero returns `{ ok: false, error }` rather than 0
 *     so BOM rows don't silently mis-price.
 *
 * Grammar (pragma):
 *
 *   expr      = term ( ('+' | '-') term )*
 *   term      = factor ( ('*' | '/') factor )*
 *   factor    = '-'? ( number | '[' ident ']' | '(' expr ')' )
 *   ident     = [A-Za-z0-9_ ]+
 *
 * Operator precedence:
 *   + -   prec 1
 *   * /   prec 2 (left-assoc)
 *
 * Variable references are wrapped in square brackets: `[Qty]`,
 * `[Material Cost]`. Brackets let identifiers contain spaces which
 * matches accounting / spreadsheet conventions the user is already
 * familiar with.
 *
 * Pure module — no React, no Zustand, no I/O. 100% unit-testable.
 *
 * Usage sketch (future 14.AB integration):
 *
 *   const profile = { 'elbow_90': '[materialCost] * 1.2 + 5' };
 *   const vars = { materialCost: 4.80, laborHours: 0.15 };
 *   const r = evaluateFormula(profile['elbow_90'], vars);
 *   if (r.ok) item.priceOverride = r.value;
 */

// ── Public API shape ──────────────────────────────────────────

export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export interface FormulaVariables {
  [name: string]: number;
}

// ── Tokenization ──────────────────────────────────────────────

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'paren'; value: '(' | ')' };

/**
 * Resolve `[Variable Name]` references against the variable map,
 * substituting their numeric value. Missing variables are replaced
 * with 0 and recorded in `missing` for the caller to report.
 */
function resolveVariables(
  expression: string,
  vars: FormulaVariables,
): { resolved: string; missing: string[] } {
  const missing: string[] = [];
  const resolved = expression.replace(/\[([^\]]+)\]/g, (_m, name: string) => {
    const v = vars[name];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      missing.push(name);
      return '0';
    }
    return String(v);
  });
  return { resolved, missing };
}

/**
 * Split a number-ops-parens stream into tokens. Unary minus is
 * folded into the following numeric literal rather than emitted as
 * a separate op — simplifies the shunting-yard pass.
 */
function tokenize(src: string): { ok: true; tokens: Token[] } | { ok: false; error: string } {
  const tokens: Token[] = [];
  let buf = '';

  const flushBuf = (): boolean => {
    if (!buf) return true;
    const n = Number(buf);
    if (!Number.isFinite(n)) {
      return false;
    }
    tokens.push({ kind: 'num', value: n });
    buf = '';
    return true;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === ' ' || ch === '\t') {
      if (!flushBuf()) {
        return { ok: false, error: `invalid number near "${buf}"` };
      }
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      if (!flushBuf()) {
        return { ok: false, error: `invalid number near "${buf}"` };
      }
      // Unary minus: when '-' appears at the start, after '(', or
      // after another operator, fold it into the next numeric literal.
      const last = tokens[tokens.length - 1];
      if (
        ch === '-'
        && (!last
          || (last.kind === 'paren' && last.value === '(')
          || last.kind === 'op')
      ) {
        buf = '-';
        continue;
      }
      if (ch === '(' || ch === ')') {
        tokens.push({ kind: 'paren', value: ch });
      } else {
        tokens.push({ kind: 'op', value: ch as '+' | '-' | '*' | '/' });
      }
      continue;
    }
    // Any other char — including decimals, digits, leading signs —
    // accumulates into the numeric buffer.
    buf += ch;
  }
  if (!flushBuf()) {
    return { ok: false, error: `invalid number near "${buf}"` };
  }
  return { ok: true, tokens };
}

// ── Shunting-yard (infix → postfix) ──────────────────────────

function precedence(op: '+' | '-' | '*' | '/'): 1 | 2 {
  return op === '+' || op === '-' ? 1 : 2;
}

function toPostfix(
  tokens: readonly Token[],
): { ok: true; postfix: Token[] } | { ok: false; error: string } {
  const output: Token[] = [];
  const ops: Token[] = [];

  for (const tok of tokens) {
    if (tok.kind === 'num') {
      output.push(tok);
    } else if (tok.kind === 'op') {
      while (
        ops.length > 0
        && ops[ops.length - 1]!.kind === 'op'
        && precedence((ops[ops.length - 1] as { kind: 'op'; value: '+' | '-' | '*' | '/' }).value) >= precedence(tok.value)
      ) {
        output.push(ops.pop()!);
      }
      ops.push(tok);
    } else if (tok.value === '(') {
      ops.push(tok);
    } else if (tok.value === ')') {
      while (ops.length > 0 && !(ops[ops.length - 1]!.kind === 'paren' && (ops[ops.length - 1] as { kind: 'paren'; value: '(' | ')' }).value === '(')) {
        output.push(ops.pop()!);
      }
      if (ops.length === 0) {
        return { ok: false, error: 'unbalanced ")"' };
      }
      ops.pop(); // discard '('
    }
  }

  while (ops.length > 0) {
    const top = ops.pop()!;
    if (top.kind === 'paren') {
      return { ok: false, error: 'unbalanced "("' };
    }
    output.push(top);
  }

  return { ok: true, postfix: output };
}

// ── Postfix evaluation ───────────────────────────────────────

function evalPostfix(
  postfix: readonly Token[],
): { ok: true; value: number } | { ok: false; error: string } {
  const stack: number[] = [];
  for (const tok of postfix) {
    if (tok.kind === 'num') {
      stack.push(tok.value);
    } else if (tok.kind === 'op') {
      if (stack.length < 2) {
        return { ok: false, error: 'malformed expression (underflow)' };
      }
      const b = stack.pop()!;
      const a = stack.pop()!;
      switch (tok.value) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/':
          if (b === 0) {
            return { ok: false, error: 'divide by zero' };
          }
          stack.push(a / b);
          break;
      }
    }
    // paren tokens are already dropped by shunting-yard
  }
  if (stack.length !== 1) {
    return { ok: false, error: 'malformed expression' };
  }
  return { ok: true, value: stack[0]! };
}

// ── Public entry ──────────────────────────────────────────────

/**
 * Evaluate `expression` against `vars`. Returns a discriminated
 * union — callers MUST check `result.ok` before reading `.value`.
 *
 * Empty expression evaluates to 0 (treated as "no formula / use
 * default"). This is intentional: a pricing profile with an
 * empty formula string should not produce an error; it should fall
 * through to the default pricing path.
 */
export function evaluateFormula(
  expression: string,
  vars: FormulaVariables = {},
): FormulaResult {
  if (!expression || !expression.trim()) {
    return { ok: true, value: 0 };
  }

  const { resolved, missing } = resolveVariables(expression, vars);
  if (missing.length > 0) {
    return { ok: false, error: `unknown variable(s): ${missing.join(', ')}` };
  }

  const tok = tokenize(resolved);
  if (!tok.ok) return tok;

  const pf = toPostfix(tok.tokens);
  if (!pf.ok) return pf;

  const ev = evalPostfix(pf.postfix);
  if (!ev.ok) return ev;

  if (!Number.isFinite(ev.value)) {
    return { ok: false, error: 'non-finite result (NaN or Infinity)' };
  }
  return ev;
}

/**
 * Convenience: parse a string that might contain a currency
 * value (`$4.80`), thousands separators (`1,234`), or a plain
 * number. Returns 0 for empty / unparseable input. Mirrors the
 * original Dart `toDouble` helper — useful when pricing inputs
 * come from spreadsheets.
 */
export function parseCurrencyNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value).replace(/\$/g, '').replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Aggregate helper — mirrors the Dart version's `computeSectionSummary`.
 * Used when multiple rows need rolling up (sum / average / count).
 */
export type AggregationType = 'sum' | 'average' | 'count';

export function aggregate(
  rows: readonly Record<string, unknown>[],
  column: string,
  kind: AggregationType,
): number {
  if (kind === 'count') return rows.length;
  let total = 0;
  for (const r of rows) total += parseCurrencyNumber(r[column]);
  if (kind === 'sum') return total;
  return rows.length === 0 ? 0 : total / rows.length;
}
