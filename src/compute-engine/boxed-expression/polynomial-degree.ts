import type { Expression, FunctionInterface } from '../global-types.js';
import { asSmallInteger } from './numerics.js';
import { isSymbol, isFunction, isNumber } from './type-guards.js';

/**
 * Per-call memo of the two degree walks. A polynomial spine that SHARES its
 * operands (`2e + 3e²` where `e` is the same object in both terms, nested
 * once per level) unfolds exponentially in its depth when each operand is
 * walked on its own, while the degree of a node never changes within one
 * call — so a node is walked once per call. Per call rather than module-level:
 * a symbol's constness, which the leaf case reads, is a definition property
 * that a later declaration can change.
 */
type DegreeMemo = {
  total: Map<Expression, number>;
  max: Map<Expression, number>;
};

const newDegreeMemo = (): DegreeMemo => ({ total: new Map(), max: new Map() });

/**
 * The total degree of an expression is the sum of the
 * positive integer degrees of the factors in the expression:
 *
 * `3√2x^5y^3` -> 5 + 3 = 8
 */
export function totalDegree(
  expr: Expression,
  memo: DegreeMemo = newDegreeMemo()
): number {
  // e.g. "x"
  if (isSymbol(expr) && !expr.isConstant) return 1;

  if (!isFunction(expr)) return 0;

  const cached = memo.total.get(expr);
  if (cached !== undefined) return cached;
  const deg = totalDegreeUncached(expr, memo);
  memo.total.set(expr, deg);
  return deg;
}

function totalDegreeUncached(
  expr: Expression & FunctionInterface,
  memo: DegreeMemo
): number {
  if (expr.operator === 'Power' && isNumber(expr.op2)) {
    // If the base has no unknowns, the degree is 0, e.g. 2^3
    if (totalDegree(expr.op1, memo) === 0) return 0;
    const deg = asSmallInteger(expr.op2);
    if (deg !== null && deg > 0) return deg;
    return 0;
  }

  if (expr.operator === 'Multiply') {
    let deg = 0;
    for (const arg of expr.ops) {
      const t = totalDegree(arg, memo);
      deg = deg + t;
    }
    return deg;
  }

  if (expr.operator === 'Add' || expr.operator === 'Subtract') {
    let deg = 0;
    for (const arg of expr.ops) deg = Math.max(deg, totalDegree(arg, memo));
    return deg;
  }

  if (expr.operator === 'Negate') return totalDegree(expr.op1, memo);

  if (expr.operator === 'Divide') return totalDegree(expr.op1, memo);

  return 0;
}

/**
 * The max degree of a polynomial is the largest positive integer degree
 * in the factors (monomials) of the expression
 *
 * `3√2x^5y^3` -> 5
 *
 */
export function maxDegree(
  expr: Expression,
  memo: DegreeMemo = newDegreeMemo()
): number {
  // e.g. "x"
  if (isSymbol(expr) && !expr.isConstant) return 1;

  if (!isFunction(expr)) return 0;

  const cached = memo.max.get(expr);
  if (cached !== undefined) return cached;
  const deg = maxDegreeUncached(expr, memo);
  memo.max.set(expr, deg);
  return deg;
}

function maxDegreeUncached(
  expr: Expression & FunctionInterface,
  memo: DegreeMemo
): number {
  if (expr.operator === 'Power' && isNumber(expr.op2)) {
    // If the base has no unknowns, the degree is 0, e.g. 2^3
    if (maxDegree(expr.op1, memo) === 0) return 0;

    const deg = asSmallInteger(expr.op2);
    if (deg !== null && deg > 0) return deg;
    return 0;
  }

  if (
    expr.operator === 'Multiply' ||
    expr.operator === 'Add' ||
    expr.operator === 'Subtract'
  ) {
    let deg = 0;
    for (const arg of expr.ops) deg = Math.max(deg, totalDegree(arg, memo));
    return deg;
  }

  if (expr.operator === 'Negate') return maxDegree(expr.op1, memo);

  if (expr.operator === 'Divide') return maxDegree(expr.op1, memo);

  return 0;
}

/**
 * Longest lexicographic key kept per node, in characters. The key of a node is
 * the space-joined symbol sequence of its whole subtree, so on a subtree that
 * SHARES operands (a user function applied to its own previous result, where
 * each level embeds the one below it several times) the full key grows
 * exponentially with the nesting depth while the number of distinct nodes
 * stays small. Only the key's END matters to `revlex`, which reads it last
 * symbol first, so a node whose key would exceed this length keeps the
 * trailing `LEX_KEY_MAX` characters and is marked truncated; a parent stops
 * extending its own key at such an operand, which keeps every stored key a
 * SUFFIX of the true one. Keys that fit are byte-identical to the unbounded
 * key, so ordering is unchanged for every sum whose terms' keys fit.
 */
const LEX_KEY_MAX = 1024;

/** Per-node memo of `lex`: a shared subtree is keyed once, not once per
 *  path that reaches it. Keyed on the expression object, so it is collected
 *  with the expression. */
const LEX_KEY = new WeakMap<Expression, string>();
/** The nodes whose stored key is a truncated suffix of the true key. */
const LEX_KEY_TRUNCATED = new WeakSet<Expression>();

/**
 * The lexicographic key of `expr`: its non-constant symbols, in subtree order,
 * joined by spaces — `xy^2` → `x y`. The key of a large subtree is a SUFFIX of
 * the full sequence of at most `LEX_KEY_MAX` characters (see there).
 */
export function lex(expr: Expression): string {
  // Consider symbols, but ignore constants such as "Pi" or "ExponentialE"
  if (isSymbol(expr) && !expr.isConstant) return expr.symbol;
  if (!isFunction(expr)) return '';
  const cached = LEX_KEY.get(expr);
  if (cached !== undefined) return cached;

  // The stored key must be a function of the TRUE key alone — its trailing
  // `LEX_KEY_MAX` characters — so that two nodes with equal true keys get
  // equal stored keys whatever their shapes: `Mod(F, 2)` and `F` have the
  // same true key (the `2` contributes nothing), and must tie here exactly
  // as they tie unbounded. The true key is `ops.map(lex).join(' ').trim()`,
  // so it is assembled from the LAST operand backwards: trailing operands
  // with empty keys contribute only the spaces the trim removes, so they are
  // skipped; the walk stops at an operand whose own key is already a
  // truncated suffix (nothing joined in front of it belongs to the true
  // key's suffix), or once the suffix is long enough; and the leading trim
  // applies only to a key that was not cut (the cut already removed the
  // head, and a space inside the suffix is part of the true key).
  const ops = expr.ops;
  let last = ops.length - 1;
  while (last >= 0 && lex(ops[last]) === '') last--;
  if (last < 0) {
    LEX_KEY.set(expr, '');
    return '';
  }
  let key = lex(ops[last]);
  let truncated = LEX_KEY_TRUNCATED.has(ops[last]);
  for (let i = last - 1; i >= 0 && !truncated; i--) {
    const op = ops[i];
    key = lex(op) + ' ' + key;
    if (LEX_KEY_TRUNCATED.has(op) || key.length > LEX_KEY_MAX) {
      key = key.slice(-LEX_KEY_MAX);
      truncated = true;
    }
  }
  if (!truncated) key = key.trimStart();
  LEX_KEY.set(expr, key);
  if (truncated) LEX_KEY_TRUNCATED.add(expr);
  return key;
}

/** Per-node memo of `revlex`: `sortAddTerms` keys each term of every sum it
 *  orders, and the same term object recurs across the sums of one
 *  evaluation. */
const REVLEX_KEY = new WeakMap<Expression, string>();

/** The `lex` key read last symbol first: `x y` → `y x`. */
export function revlex(expr: Expression): string {
  if (!isFunction(expr)) return lex(expr);
  const cached = REVLEX_KEY.get(expr);
  if (cached !== undefined) return cached;
  const key = lex(expr).split(' ').reverse().join(' ').trim();
  REVLEX_KEY.set(expr, key);
  return key;
}
