import { toBigint, toInteger } from '../boxed-expression/numerics.js';
import type { Expression, SymbolDefinitions } from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { apply2 } from '../boxed-expression/apply.js';
import { gamma, bigGamma, gammaln } from '../numerics/special-functions.js';
import { checkDeadline } from '../../common/interruptible.js';

/**
 * Above this many decimal digits, an exact combinatorial result (Fibonacci,
 * Binomial, BellNumber, Subfactorial) is impractical to materialize as a
 * bigint — the loops below would grind for a very long time to build a
 * multi-hundred-thousand-digit number nobody can use. Stay symbolic instead
 * (mirrors `MAX_EXACT_POW_DIGITS` in boxed-expression/arithmetic-power.ts).
 * The loops also carry `checkDeadline` calls as a backstop for whatever
 * slips under this threshold on a slow host. See WP-2.11 / EX-14.
 */
const MAX_EXACT_COMBINATORICS_DIGITS = 1_000_000;

/**
 * Largest literal integer second argument for which `Binomial`/`Pochhammer`
 * with a *symbolic* first argument expand to their explicit product form
 * (Wester B13). The expansion has `k` factors, so keep the cap small to avoid
 * churning out large factored polynomials.
 */
const SYMBOLIC_EXPANSION_CAP = 20n;

/** log10(φ): F(n) has ≈ n·log10(φ) decimal digits (φ = golden ratio). */
const LOG10_PHI = Math.log10((1 + Math.sqrt(5)) / 2);

/** Rough estimate of the decimal digit count of n!, via lgamma(n+1). */
function estimatedFactorialDigits(n: number): number {
  if (!Number.isFinite(n) || n < 0) return Infinity;
  if (n < 2) return 1;
  const digits = gammaln(n + 1) / Math.LN10;
  return Number.isFinite(digits) ? digits : Infinity;
}

/** Rough estimate of the decimal digit count of Binomial(n, k), via lgamma. */
function estimatedBinomialDigits(n: bigint, k: bigint): number {
  const nf = Number(n);
  const kf = Number(k);
  if (!Number.isFinite(nf) || !Number.isFinite(kf)) return Infinity;
  const logC =
    (gammaln(nf + 1) - gammaln(kf + 1) - gammaln(nf - kf + 1)) / Math.LN10;
  return Number.isFinite(logC) ? logC : Infinity;
}

/**
 * Rough estimate of the decimal digit count of the Bell number B(n), via the
 * leading terms of the de Bruijn asymptotic: ln B(n) ≈ n·ln(n) − n·ln(ln(n)) − n.
 */
function estimatedBellDigits(n: number): number {
  if (!Number.isFinite(n) || n < 0) return Infinity;
  if (n < 3) return 1;
  const lnN = Math.log(n);
  const lnB = n * lnN - n * Math.log(lnN) - n;
  return lnB > 0 ? lnB / Math.LN10 : 1;
}

/**
 * Exact binomial coefficient for bigint n, k.
 *
 * - k < 0 → 0 (no combinatorial meaning, regardless of n).
 * - n ≥ 0 and k > n → 0 (standard convention).
 * - n < 0 → the standard extension via Pascal's rule analytic continuation:
 *   Binomial(n, k) = (-1)^k · Binomial(k-n-1, k), e.g.
 *   Binomial(-2, 3) = (-1)³·Binomial(4, 3) = -4 (matches Mathematica/sympy).
 *
 * Returns `undefined` (stay symbolic) rather than an exact bigint when the
 * result would exceed MAX_EXACT_COMBINATORICS_DIGITS decimal digits — e.g.
 * `Binomial(2e9, 1e9)` has ~6×10⁸ digits, pathological to build.
 */
function binomialBigint(
  n: bigint,
  k: bigint,
  deadline?: number
): bigint | undefined {
  if (k < 0n) return 0n;
  if (n < 0n) {
    const sign = k % 2n === 0n ? 1n : -1n;
    const inner = binomialBigint(k - n - 1n, k, deadline);
    return inner === undefined ? undefined : sign * inner;
  }
  if (k > n) return 0n;
  // Use the smaller of k and n-k to minimize the number of iterations.
  const kk = k < n - k ? k : n - k;
  if (kk === 0n) return 1n;
  if (estimatedBinomialDigits(n, kk) > MAX_EXACT_COMBINATORICS_DIGITS)
    return undefined;
  let result = 1n;
  let steps = 0;
  for (let i = 1n; i <= kk; i++) {
    if ((++steps & 0xffff) === 0) checkDeadline(deadline);
    result = (result * (n - kk + i)) / i;
  }
  return result;
}

/**
 * Shared evaluate logic for `Binomial` and `Choose` — the two names must
 * agree everywhere both are defined, so both handlers delegate here.
 *
 * - Exact integers (any sign of n): exact bigint result (see
 *   `binomialBigint`), regardless of `numericApproximation`.
 * - Exact non-integers (rationals, radicals, symbolic constants like π):
 *   no closed form, so stay symbolic under plain `evaluate()`; under `.N()`
 *   numericize via the Gamma form Γ(n+1)/(Γ(k+1)·Γ(n−k+1)).
 * - Inexact (float) operands numericize under both `evaluate()` and `.N()`,
 *   per the exactness contract (an inexact argument always numericizes).
 * - Complex or non-numeric (symbolic) operands: stay symbolic (no closed
 *   form implemented for complex args; symbolic args can't be evaluated).
 */
function evaluateBinomial(
  nExpr: Expression,
  kExpr: Expression,
  numericApproximation: boolean | undefined,
  ce: Expression['engine']
): Expression | undefined {
  // Exact integers: exact bigint arithmetic (handles negative n).
  if (
    isNumber(nExpr) &&
    isNumber(kExpr) &&
    nExpr.im === 0 &&
    kExpr.im === 0 &&
    nExpr.isInteger &&
    kExpr.isInteger
  ) {
    const n = toBigint(nExpr);
    const k = toBigint(kExpr);
    if (n !== null && k !== null) {
      const r = binomialBigint(n, k, ce._deadline);
      return r === undefined ? undefined : ce.number(r);
    }
  }

  // Complex operands: no closed form implemented here; stay symbolic.
  if (
    (isNumber(nExpr) && nExpr.im !== 0) ||
    (isNumber(kExpr) && kExpr.im !== 0)
  )
    return undefined;

  // Inexact (float) operands numericize even under plain evaluate(); exact
  // non-integer operands (rationals, radicals, π, ...) only numericize
  // under .N() — and otherwise stay symbolic (no closed form).
  const inexact =
    (isNumber(nExpr) && !nExpr.isExact) || (isNumber(kExpr) && !kExpr.isExact);
  if (numericApproximation || inexact) {
    return apply2(
      nExpr,
      kExpr,
      (n, k) => gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1)),
      (n, k) =>
        bigGamma(ce, n.add(1)).div(
          bigGamma(ce, k.add(1)).mul(bigGamma(ce, n.sub(k).add(1)))
        )
    );
  }

  // Symbolic first argument with a small nonnegative integer second argument:
  // expand to the explicit falling-factorial form n(n-1)…(n-k+1)/k! (Wester
  // B13). This is an exact closed form. It is built non-canonically so the
  // factored structure survives serialization — canonicalizing it would fold
  // the 1/k! into a leading rational coefficient and, on evaluation, distribute
  // into an expanded polynomial.
  if (
    !isNumber(nExpr) &&
    isNumber(kExpr) &&
    kExpr.im === 0 &&
    kExpr.isInteger
  ) {
    const k = toBigint(kExpr);
    if (k !== null && k >= 0n && k <= SYMBOLIC_EXPANSION_CAP) {
      const kn = Number(k);
      if (kn === 0) return ce.One;
      if (kn === 1) return nExpr;
      const factors: Expression[] = [nExpr];
      for (let i = 1; i < kn; i++)
        factors.push(
          ce.function('Subtract', [nExpr, ce.number(i)], { structural: true })
        );
      let fact = 1n;
      for (let i = 2n; i <= k; i++) fact *= i;
      return ce.function(
        'Divide',
        [
          ce.function('Multiply', factors, { structural: true }),
          ce.number(fact),
        ],
        { structural: true }
      );
    }
  }

  return undefined;
}

/**
 * Evaluate `Pochhammer(a, k)` — the rising factorial (a)_k = a(a+1)…(a+k-1)
 * — for a small nonnegative integer `k` (Wester B13).
 *
 * - `k` not a small nonnegative integer literal: stay symbolic (inert).
 * - Numeric `a`: fold to the numeric value (exact for integer/rational `a`,
 *   float for an inexact `a`).
 * - Symbolic `a`: return the explicit factored product, kept non-canonical so
 *   the factored structure survives serialization.
 */
function evaluatePochhammer(
  aExpr: Expression,
  kExpr: Expression,
  ce: Expression['engine']
): Expression | undefined {
  if (!isNumber(kExpr) || kExpr.im !== 0 || !kExpr.isInteger) return undefined;
  const k = toBigint(kExpr);
  if (k === null || k < 0n || k > SYMBOLIC_EXPANSION_CAP) return undefined;
  const kn = Number(k);
  if (kn === 0) return ce.One;
  if (kn === 1) return aExpr;

  // Numeric first argument: fold the product to a number (evaluate() respects
  // the exact/float split — floats are otherwise excluded from canonical
  // folding, so the product must be evaluated rather than merely constructed).
  if (isNumber(aExpr) && aExpr.im === 0) {
    const factors: Expression[] = [];
    for (let i = 0; i < kn; i++) factors.push(aExpr.add(ce.number(i)));
    return ce.function('Multiply', factors).evaluate();
  }

  // Symbolic first argument: explicit rising-factorial product, non-canonical.
  const factors: Expression[] = [aExpr];
  for (let i = 1; i < kn; i++)
    factors.push(
      ce.function('Add', [aExpr, ce.number(i)], { structural: true })
    );
  return ce.function('Multiply', factors, { structural: true });
}

export const COMBINATORICS_LIBRARY: SymbolDefinitions[] = [
  {
    Choose: {
      description:
        'Binomial coefficient: number of ways to choose k items from n. Agrees with Binomial for all defined values.',
      complexity: 1200,
      signature: '(n:number, m:number) -> number',
      type: () => 'finite_integer',

      evaluate: ([n, k], { numericApproximation, engine: ce }) =>
        evaluateBinomial(n, k, numericApproximation, ce),
    },
  },

  {
    Fibonacci: {
      description: 'Compute the nth Fibonacci number.',
      wikidata: 'Q47577',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;

        // Compute F(|k|); negative indices use the reflection formula below.
        const m = k < 0n ? -k : k;

        // F(m) has ~m·log10(φ) digits: for huge m (e.g. Fibonacci(1e9), a
        // ~2×10⁸-digit result) the loop below would grind for a very long
        // time to build an unusable number — stay symbolic instead.
        if (Number(m) * LOG10_PHI > MAX_EXACT_COMBINATORICS_DIGITS)
          return undefined;

        let result: bigint;
        if (m === 0n) result = 0n;
        else if (m === 1n) result = 1n;
        else {
          let a = 0n;
          let b = 1n;
          let steps = 0;
          for (let i = 2n; i <= m; i++) {
            if ((++steps & 0xffff) === 0) checkDeadline(ce._deadline);
            const next = a + b;
            a = b;
            b = next;
          }
          result = b;
        }

        // Reflection formula: F(−m) = (−1)^{m+1} F(m). The previous code built
        // a malformed `Negate(Fibonacci, m)` (two operands) → an Error.
        if (k < 0n && m % 2n === 0n) result = -result;
        return ce.number(result);
      },
    },

    Binomial: {
      description:
        'Compute the binomial coefficient C(n, k) = n! / (k! (n-k)!). Agrees with Choose for all defined values.',
      keywords: ['choose', 'nCr', 'combination'],
      wikidata: 'Q209875',
      // Was `(integer, integer) -> integer`: too strict — it turned any
      // non-integer (rational, radical, symbolic n/k inferred as `number`)
      // into an Error() at canonicalization time, before `evaluate` ever
      // ran. Binomial is well-defined (via Gamma) for real n, k.
      signature: '(number, number) -> number',
      type: () => 'finite_integer',
      evaluate: ([n, k], { numericApproximation, engine: ce }) =>
        evaluateBinomial(n, k, numericApproximation, ce),
    },
    Pochhammer: {
      description:
        'Rising factorial (Pochhammer symbol) (a)_k = a(a+1)…(a+k-1).',
      wikidata: 'Q2367490',
      signature: '(number, number) -> number',
      evaluate: ([a, k], { engine: ce }) => evaluatePochhammer(a, k, ce),
    },
    CartesianProduct: {
      description: 'Return the Cartesian product of input sets.',
      // Aka the product set, the set direct product or cross product
      // Notation: \times
      wikidata: 'Q173740',
      signature: '(set+) -> set',
      collection: {
        contains: (expr, x) => {
          if (!isFunction(expr)) return false;
          const factors = expr.ops;
          if (
            !x.isCollection ||
            !isFunction(x) ||
            x.ops.length !== factors.length
          )
            return false;
          const xOps = x.ops;
          return factors.every(
            (factor, i) => factor.contains(xOps[i]) ?? false
          );
        },
        count: (expr) => {
          if (!isFunction(expr)) return 0;
          const sizes = expr.ops.map((op) => op.count);
          if (sizes.includes(Infinity)) return Infinity;
          return sizes.reduce((a, b) => a! * b!, 1);
        },
        iterator: cartesianProductIterator,
      },
    },

    PowerSet: {
      description: 'Return the power set of a set (set of all subsets).',
      wikidata: 'Q205170',
      signature: '(set) -> set',
      collection: {
        contains: (expr, x) => {
          if (!isFunction(expr)) return false;
          const base = expr.ops[0];
          if (!x.isCollection || !isFunction(x)) return false;
          return x.ops.every((elem) => base.contains(elem) ?? false);
        },
        count: (expr) => {
          if (!isFunction(expr)) return 0;
          const xs = expr.ops[0];
          if (xs.isEmptyCollection) return 1; // Power set of empty set is {{}}
          if (xs.isFiniteCollection === false) return Infinity;
          return 2 ** xs.count!;
        },
        iterator: powerSetIterator,
      },
    },

    Permutations: {
      description:
        'Return all permutations of length k (default full length) of a collection.',
      keywords: ['nPr'],
      signature: '(collection, integer?) -> list<list>',
      // A lazy indexed collection (like `CartesianProduct`/`PowerSet`): the
      // result has `P(n, k)` elements — factorially many — so it is NEVER
      // materialized up front. `.count` is the closed form `n·(n-1)···(n-k+1)`
      // (no walk); elements stream from `iterator`, and `at(i)` yields only the
      // first `i` ARRANGEMENTS (after reading the — typically small — base
      // collection once). Binding an unread `Permutations` is O(1).
      collection: {
        isLazy: () => true,
        count: (expr) => permutationsCount(expr),
        isEmpty: (expr) => {
          const c = permutationsCount(expr);
          return c === undefined ? undefined : c === 0;
        },
        // Finiteness comes from the BASE collection, not `count`: a permutation
        // of a finite collection is finite even when the count is so large it
        // rounds to `Infinity` as a JS number. `k = 0` is the lone exception —
        // the single empty arrangement is finite even over an infinite base.
        // An infinite base with `k > 0` can't be enumerated, so report
        // `undefined` (unknown) rather than `false` — which would advertise an
        // infinite collection that yields nothing.
        isFinite: (expr) => {
          if (!isFunction(expr)) return undefined;
          const k = expr.ops[1] ? toInteger(expr.ops[1]) : expr.op1.count;
          if (k === 0) return true;
          const f = expr.op1.isFiniteCollection;
          return f === false ? undefined : f;
        },
        iterator: permutationsIterator,
        at: (expr, index) =>
          nthFromIterator(expr, index, permutationsIterator, permutationsCount),
      },
    },

    Combinations: {
      description: 'Return all k-element combinations of a collection.',
      wikidata: 'Q193606',
      signature: '(collection, integer) -> list<list>',
      // Lazy indexed collection: `C(n, k)` elements, never materialized up
      // front. `.count` is the closed form `P(n, k) / k!`; elements stream from
      // `iterator`, and `at(i)` yields only the first `i` combinations (after
      // reading the — typically small — base collection once).
      collection: {
        isLazy: () => true,
        count: (expr) => combinationsCount(expr),
        isEmpty: (expr) => {
          const c = combinationsCount(expr);
          return c === undefined ? undefined : c === 0;
        },
        // Finiteness comes from the BASE collection, not `count` (see
        // `Permutations`); `k = 0` is finite even over an infinite base, and an
        // infinite base with `k > 0` is `undefined` (unenumerable), not `false`.
        isFinite: (expr) => {
          if (!isFunction(expr)) return undefined;
          const k = expr.ops[1] ? toInteger(expr.ops[1]) : expr.op1.count;
          if (k === 0) return true;
          const f = expr.op1.isFiniteCollection;
          return f === false ? undefined : f;
        },
        iterator: combinationsIterator,
        at: (expr, index) =>
          nthFromIterator(expr, index, combinationsIterator, combinationsCount),
      },
    },

    Multinomial: {
      description: 'Compute the multinomial coefficient for multiple integers.',
      wikidata: 'Q20820114',
      signature: '(integer+) -> integer',
      type: () => 'finite_integer',
      evaluate: (ops, { engine: ce }) => {
        const ks = ops.map(toInteger);
        if (ks.some((k) => k === null || k < 0)) return undefined;
        const n = ks.reduce((a, b) => a! + (b ?? 0), 0)!;

        // n! dwarfs the individual k! factors, so its digit count bounds the
        // whole computation — stay symbolic rather than grind through an
        // unusably large exact factorial (same class of issue as
        // Subfactorial/Fibonacci/BellNumber, see WP-2.11 / EX-14).
        if (estimatedFactorialDigits(n) > MAX_EXACT_COMBINATORICS_DIGITS)
          return undefined;

        // Use exact bigint arithmetic — the float version overflowed past
        // n ≈ 170 and lost precision (`Multinomial(20,20)` → …820.00003).
        // n! / (k1! · k2! · …) is always an integer, so the divisions are exact.
        const factorial = (m: number): bigint => {
          let r = 1n;
          let steps = 0;
          for (let i = 2n; i <= BigInt(m); i++) {
            if ((++steps & 0xffff) === 0) checkDeadline(ce._deadline);
            r *= i;
          }
          return r;
        };
        let result = factorial(n);
        for (const k of ks) result /= factorial(k!);
        return ce.number(result);
      },
    },

    Subfactorial: {
      description:
        'Compute the number of derangements (subfactorial) of n items.',
      wikidata: 'Q2361661',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        // Derangements are defined only for non-negative integers; stay
        // symbolic for anything else rather than rounding the argument.
        if (n.isInteger !== true) return undefined;
        const k = toInteger(n);
        if (k === null || k < 0) return undefined;
        // !n has the same order of magnitude as n! (!n = round(n!/e)): for
        // huge n (e.g. Subfactorial(1e6), a ~5.6×10⁶-digit result) the loop
        // below would grind for a very long time — stay symbolic instead.
        if (estimatedFactorialDigits(k) > MAX_EXACT_COMBINATORICS_DIGITS)
          return undefined;
        // Recurrence (exact, in bigint): !0 = 1, !m = m·!(m−1) + (−1)^m.
        // The previous float formula reduced to result·(i−1), which is 0 at
        // i = 1 and pinned every !n≥1 to 0.
        let result = 1n;
        let sign = 1n;
        let steps = 0;
        for (let i = 1; i <= k; i++) {
          if ((++steps & 0xffff) === 0) checkDeadline(ce._deadline);
          sign = -sign;
          result = BigInt(i) * result + sign;
        }
        return ce.number(result);
      },
    },

    BellNumber: {
      description:
        'Compute the Bell number B(n), the number of partitions of a set of n elements.',
      wikidata: 'Q816063',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        // Bell numbers count set partitions, defined only for non-negative
        // integers; stay symbolic rather than rounding the argument.
        if (n.isInteger !== true) return undefined;
        const k = toInteger(n);
        if (k === null || k < 0) return undefined;

        // B(n) grows faster than exponentially (ln B(n) ≈ n·ln(n) −
        // n·ln(ln(n)) − n, de Bruijn): for huge n (e.g. BellNumber(20000)
        // already has ~57000 digits, and the O(n²) triangle cost grows much
        // faster still) stay symbolic rather than grind. The `checkDeadline`
        // below is the primary guard in the range this estimate misses.
        if (estimatedBellDigits(k) > MAX_EXACT_COMBINATORICS_DIGITS)
          return undefined;

        // Bell triangle (Aitken's array) in exact bigint — the float
        // recurrence lost precision past n ≈ 25 (`BellNumber(25)` was
        // …9000 instead of …9353). B(n) is the first entry of row n.
        let row: bigint[] = [1n];
        let steps = 0;
        for (let i = 1; i <= k; i++) {
          const next: bigint[] = [row[row.length - 1]];
          for (let j = 0; j < row.length; j++) {
            if ((++steps & 0xffff) === 0) checkDeadline(ce._deadline);
            next.push(next[j] + row[j]);
          }
          row = next;
        }
        return ce.number(row[0]);
      },
    },
  },
];

function* cartesianProductIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const factors = expr.ops;
  const iterators = factors.map((f) => [...f.each()] as Expression[]);
  const lengths = iterators.map((it) => it.length);
  if (lengths.some((len) => len === 0)) return;

  const indices = Array(factors.length).fill(0);
  while (true) {
    const tuple = indices.map((i, j) => iterators[j][i]);
    yield expr.engine._fn('Tuple', tuple);

    // Increment indices
    let j = indices.length - 1;
    while (j >= 0) {
      indices[j]++;
      if (indices[j] < lengths[j]) break;
      indices[j] = 0;
      j--;
    }
    if (j < 0) break;
  }
}

function* powerSetIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const elements = [...expr.ops[0].each()] as Expression[];
  const n = elements.length;
  const ce = expr.engine;

  const total = 1 << n; // 2ⁿ subsets
  for (let mask = 0; mask < total; mask++) {
    const subset: Expression[] = [];
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0) {
        subset.push(elements[i]);
      }
    }
    yield subset.length === 0 ? ce.symbol('EmptySet') : ce._fn('Set', subset);
  }
}

// NOTE on precision: `count` returns a JS `number`, so values past 2^53 are not
// exact and values past ~1.8e308 round to `Infinity` — the same ceiling every
// collection `count` handler has (cf. `PowerSet`'s `2 ** n`). The products below
// are accumulated in `bigint` so everything that DOES fit is exact and there is
// no float rounding; only the final `Number(...)` conversion is lossy. The
// `isFinite` handlers report finiteness from the BASE collection, not from
// `count`, so a finite-but-huge result that rounds to `Infinity` is never
// mistaken for an infinite collection.

// Once a running count exceeds the largest finite JS number, `Number(...)` can
// only ever yield `Infinity`, so the products below stop early at this bigint
// threshold rather than grinding through (potentially billions of) remaining
// terms for an astronomically large — but finite — collection.
const MAX_FINITE_COUNT = BigInt(Number.MAX_VALUE);

/**
 * The number of length-`k` permutations of an `n`-element collection,
 * `P(n, k) = n·(n-1)···(n-k+1)`, WITHOUT enumerating them. `k` defaults to the
 * collection size. Returns `1` for `k = 0` (the empty arrangement); `undefined`
 * when the size is unknown, `k` is out of range, or the base is infinite with
 * `k > 0` (which the iterator cannot enumerate); `Infinity` only when a finite
 * base's count exceeds the largest finite JS number.
 */
function permutationsCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const n = expr.op1.count;
  if (n === undefined) return undefined;
  const kExpr = expr.ops[1];
  const k = kExpr ? toInteger(kExpr) : n;
  // Validate `k` BEFORE the infinite short-circuit: an out-of-range `k` is an
  // invalid expression, not an infinite collection.
  if (k === null || k < 0 || (Number.isFinite(n) && k > n)) return undefined;
  if (k === 0) return 1; // P(n, 0) = 1
  // A valid `k > 0` over an infinite base has infinitely many arrangements, but
  // the iterator can't enumerate them (it can't materialize the source): report
  // `undefined` (unsupported) rather than a count no consumer can back up.
  if (!Number.isFinite(n)) return undefined;
  let p = 1n;
  const bn = BigInt(n);
  for (let j = 0n; j < BigInt(k); j++) {
    p *= bn - j;
    if (p > MAX_FINITE_COUNT) return Infinity;
  }
  return Number(p);
}

/**
 * The number of `k`-element combinations of an `n`-element collection,
 * `C(n, k) = P(n, k) / k!`, WITHOUT enumerating them. Returns `1` for `k = 0`;
 * `undefined` when the size is unknown, `k` is out of range, or the base is
 * infinite with `k > 0`; `Infinity` only when a finite base's count exceeds the
 * largest finite JS number.
 */
function combinationsCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const n = expr.op1.count;
  if (n === undefined) return undefined;
  const k = toInteger(expr.ops[1]);
  if (k === null || k < 0 || (Number.isFinite(n) && k > n)) return undefined;
  if (k === 0) return 1; // C(n, 0) = 1
  if (!Number.isFinite(n)) return undefined; // see `permutationsCount`
  // Symmetry C(n,k) = C(n,n-k) keeps the running product smallest. Each step
  // `c·(n-j)/(j+1)` is an exact integer division because the product of `j+1`
  // consecutive integers is divisible by `(j+1)!`.
  const bn = BigInt(n);
  const kk = BigInt(Math.min(k, n - k));
  let c = 1n;
  for (let j = 0n; j < kk; j++) {
    c = (c * (bn - j)) / (j + 1n);
    if (c > MAX_FINITE_COUNT) return Infinity;
  }
  return Number(c);
}

/** Stream the length-`k` permutations of a (finite) collection as `List`s, in
 * the same lexicographic-by-removal order as the former eager evaluator. */
function* permutationsIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const xs = expr.op1;
  const ce = expr.engine;
  const kExpr = expr.ops[1];
  // P(n, 0) = 1: the single empty arrangement — yield it without touching the
  // source (so it also works for an infinite source, which can't be
  // enumerated). A negative/invalid explicit `k` yields nothing.
  if (kExpr) {
    const k0 = toInteger(kExpr);
    if (k0 === null || k0 < 0) return;
    if (k0 === 0) {
      yield ce.function('List', []);
      return;
    }
  }
  if (!xs.isFiniteCollection) return;
  const all = [...xs.each()] as Expression[];
  const k = kExpr ? toInteger(kExpr) : all.length;
  if (k === null || k < 0 || k > all.length) return;

  function* permute(
    prefix: Expression[],
    rest: Expression[]
  ): Generator<Expression[]> {
    if (prefix.length === k) {
      yield prefix;
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      const next = rest.slice();
      const [item] = next.splice(i, 1);
      yield* permute([...prefix, item], next);
    }
  }
  for (const perm of permute([], all)) yield ce.function('List', perm);
}

/** Stream the `k`-element combinations of a (finite) collection as `List`s, in
 * ascending-index order (same as the former eager evaluator). */
function* combinationsIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const xs = expr.op1;
  const ce = expr.engine;
  const kExpr = expr.ops[1];
  // C(n, 0) = 1: the single empty combination — yield it without touching the
  // source (works for an infinite source too). Negative/invalid `k` → nothing.
  const k0 = kExpr ? toInteger(kExpr) : null;
  if (k0 === null || k0 < 0) return;
  if (k0 === 0) {
    yield ce.function('List', []);
    return;
  }
  if (!xs.isFiniteCollection) return;
  const all = [...xs.each()] as Expression[];
  const k = k0;
  if (k > all.length) return;

  function* combine(
    start: number,
    combo: Expression[]
  ): Generator<Expression[]> {
    if (combo.length === k) {
      yield combo;
      return;
    }
    for (let i = start; i < all.length; i++) {
      yield* combine(i + 1, [...combo, all[i]]);
    }
  }
  for (const combo of combine(0, [])) yield ce.function('List', combo);
}

/**
 * Return the element at `index` (1-based; negative counts from the end) of a
 * lazy collection defined by a streaming `gen`, walking only as far as needed.
 * A negative index needs the length, taken from `countFn` (closed form here),
 * so it never forces a full materialization for a known count.
 */
function nthFromIterator(
  expr: Expression,
  index: number | string,
  gen: (e: Expression) => Generator<Expression, undefined, any>,
  countFn: (e: Expression) => number | undefined
): Expression | undefined {
  if (typeof index !== 'number' || !Number.isInteger(index) || index === 0)
    return undefined;
  let target = index;
  if (index < 0) {
    const c = countFn(expr);
    if (c === undefined || !Number.isFinite(c)) return undefined;
    target = c + index + 1;
    if (target < 1) return undefined;
  }
  let i = 0;
  for (const el of gen(expr)) {
    if (++i === target) return el;
  }
  return undefined;
}
