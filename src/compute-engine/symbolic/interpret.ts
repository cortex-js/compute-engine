import type { Expression } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  collectSymbols,
  freshSymbolName,
  solveLinearSystem,
} from './solver-utils.js';
import { checkDeadline } from '../../common/interruptible.js';

/**
 * Ellipsis interpretation — from *notation* to *meaning*.
 *
 * The ellipsis fold barrier (CHANGELOG 2026-07-09) makes an `Add`/`Multiply`
 * carrying a `ContinuationPlaceholder` an inert notational object:
 * `1 + 2 + \dots + n` parses to `["Add", 1, 2, "ContinuationPlaceholder", "n"]`
 * with source order and nested anchors preserved. This module is the (strictly
 * gated) inference that turns such an object into a `Sum`/`Product`.
 *
 * The recognizer is a shared core; the `Interpret` head is a thin wrapper (see
 * `library/arithmetic.ts`). Future recognizers (e.g. sequence closed-form
 * recognition) live alongside `inferContinuationPattern` here.
 *
 * See `docs/plans/2026-07-09-ellipsis-interpretation-design.md` for the gate
 * and the generalization ladder. Recognizers are tried in order: arithmetic
 * progression (v1) → polynomial via finite differences → geometric (v2) →
 * linear recurrence via Berlekamp–Massey + `RSolve` closed form (v3).
 */

/**
 * A candidate continuation extracted from the operands of a canonical
 * `Add`/`Multiply`: a contiguous run of exact numeric samples immediately
 * preceding the placeholder, a single anchor after it, and any leftover
 * (non-sample) terms that precede the run.
 */
interface Continuation {
  /** The exact numeric sample terms, in source order (length ≥ 2). */
  samples: Expression[];
  /** The single anchor term after the `ContinuationPlaceholder`. */
  anchor: Expression;
  /** Terms before the sample run — kept as-is alongside the interpretation. */
  leftover: Expression[];
}

/** Exact real integer/rational literal (samples are admitted only as these). */
function isExactRationalLiteral(x: Expression): boolean {
  return isNumber(x) && x.isExact && x.isReal === true && x.isRational === true;
}

/**
 * Analyze a single expression node as a continuation-bearing `Add`/`Multiply`,
 * returning the extracted {@link Continuation} (samples, anchor, leftover), or
 * `null` when the node's shape does not qualify. This is the operand-level
 * extraction shared by {@link interpretNode} (which then runs the recognizers)
 * and {@link extractContinuationSamples} (which only needs the samples).
 */
function nodeContinuation(expr: Expression): Continuation | null {
  if (!isFunction(expr)) return null;
  const op = expr.operator;
  if (op !== 'Add' && op !== 'Multiply') return null;

  const ops = expr.ops;

  // Exactly one ContinuationPlaceholder among the operands.
  const placeholderIndices = ops
    .map((x, i) => (isSymbol(x, 'ContinuationPlaceholder') ? i : -1))
    .filter((i) => i >= 0);
  if (placeholderIndices.length !== 1) return null;
  const p = placeholderIndices[0];

  // Exactly one anchor after the placeholder (it must be the last operand).
  if (p !== ops.length - 2) return null;
  const anchor = ops[ops.length - 1];
  if (isSymbol(anchor, 'ContinuationPlaceholder')) return null;

  // Samples: the contiguous run of exact numeric literals ending just before
  // the placeholder. Everything before that run is leftover.
  let start = p;
  while (start > 0 && isExactRationalLiteral(ops[start - 1])) start--;
  const samples = ops.slice(start, p);
  const leftover = ops.slice(0, start);
  if (samples.length < 2) return null;

  return { samples, anchor, leftover };
}

/**
 * Attempt to interpret a single expression node as a continuation-bearing
 * `Add`/`Multiply`, returning the `Sum`/`Product` interpretation, or `null`
 * when no recognizer's gate passes.
 */
function interpretNode(expr: Expression): Expression | null {
  const continuation = nodeContinuation(expr);
  if (!continuation) return null;
  return buildInterpretation(
    expr,
    expr.operator as 'Add' | 'Multiply',
    continuation
  );
}

/**
 * Given a validated candidate, run the recognizers in order — arithmetic
 * progression (v1), polynomial (finite differences), geometric — returning the
 * first `Sum`/`Product` that passes its gate, or `null`.
 */
function buildInterpretation(
  expr: Expression,
  op: 'Add' | 'Multiply',
  continuation: Continuation
): Expression | null {
  return (
    tryArithmeticProgression(expr, op, continuation) ??
    tryPolynomial(expr, op, continuation) ??
    tryGeometric(expr, op, continuation) ??
    tryRecurrence(expr, op, continuation)
  );
}

/** A fresh index symbol not used anywhere in `expr` (prefers `k`, `j`, `i`). */
function freshIndex(expr: Expression): Expression {
  const used = collectSymbols(expr);
  let indexName: string | undefined;
  for (const candidate of ['k', 'j', 'i']) {
    if (!used.has(candidate)) {
      indexName = candidate;
      break;
    }
  }
  indexName ??= freshSymbolName('k', used);
  return expr.engine.symbol(indexName);
}

/** Assemble the `Sum`/`Product`, re-attaching any leftover leading terms. */
function assemble(
  expr: Expression,
  op: 'Add' | 'Multiply',
  leftover: Expression[],
  term: Expression,
  index: Expression,
  U: Expression
): Expression {
  const ce = expr.engine;
  const bigOp = op === 'Add' ? 'Sum' : 'Product';
  const interpretation = ce.function(bigOp, [
    term,
    ce.function('Tuple', [index, ce.One, U]),
  ]);
  if (leftover.length === 0) return interpretation;
  return ce.function(op, [...leftover, interpretation]);
}

// ---------------------------------------------------------------------------
// v1 — arithmetic progression (shapes must stay byte-identical).
// ---------------------------------------------------------------------------

/**
 * Arithmetic progression: constant exact difference `d ≠ 0`, general term
 * `t(k) = s₁ + (k − 1)·d`, upper bound `U = (A − s₁)/d + 1` computed
 * symbolically and gated by {@link isValidUpperBound}.
 */
function tryArithmeticProgression(
  expr: Expression,
  op: 'Add' | 'Multiply',
  { samples, anchor, leftover }: Continuation
): Expression | null {
  const ce = expr.engine;
  const m = samples.length;
  const s1 = samples[0];

  const d = ce.function('Subtract', [samples[1], s1]).evaluate();
  if (d.isSame(0)) return null;
  for (let i = 1; i < m; i++) {
    const di = ce.function('Subtract', [samples[i], samples[i - 1]]).evaluate();
    if (!di.isSame(d)) return null;
  }

  const U = ce
    .function('Add', [
      ce.function('Divide', [ce.function('Subtract', [anchor, s1]), d]),
      ce.One,
    ])
    .simplify();
  if (!isValidUpperBound(U, m)) return null;

  const index = freshIndex(expr);
  const term = ce
    .function('Add', [
      s1,
      ce.function('Multiply', [ce.function('Subtract', [index, ce.One]), d]),
    ])
    .simplify();

  return assemble(expr, op, leftover, term, index, U);
}

// ---------------------------------------------------------------------------
// v2 — polynomial via finite differences.
// ---------------------------------------------------------------------------

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * Polynomial recognizer (degree `g ≥ 2`). Successive finite differences of the
 * samples until a constant row give the degree `g`; the general term is
 * Newton's forward-difference formula `t(k) = Σⱼ Δʲs₁·C(k−1, j)`. Degree 1 is
 * left to {@link tryArithmeticProgression}. The anchor must validate to a
 * well-formed upper bound (this is also the m = g+1 structural confirmation).
 */
function tryPolynomial(
  expr: Expression,
  op: 'Add' | 'Multiply',
  { samples, anchor, leftover }: Continuation
): Expression | null {
  const ce = expr.engine;
  const m = samples.length;

  // Successive finite-difference rows: rows[i] has length m − i.
  const rows: Expression[][] = [samples];
  while (rows[rows.length - 1].length > 1) {
    const cur = rows[rows.length - 1];
    const next: Expression[] = [];
    for (let i = 1; i < cur.length; i++)
      next.push(ce.function('Subtract', [cur[i], cur[i - 1]]).evaluate());
    rows.push(next);
  }

  // Degree = smallest g ≥ 1 whose difference row is constant. A length-1 row
  // (g = m − 1) is trivially constant: that is the m = g+1 case, where the term
  // is the unique interpolant and the anchor must carry the evidence.
  const isConstant = (row: Expression[]): boolean =>
    row.every((x) => x.isSame(row[0]));
  let degree = -1;
  for (let g = 1; g < rows.length; g++) {
    if (isConstant(rows[g])) {
      degree = g;
      break;
    }
  }
  if (degree < 2) return null;

  const coefficients: Expression[] = [];
  for (let j = 0; j <= degree; j++) coefficients.push(rows[j][0]);

  const index = freshIndex(expr);
  const term = newtonTerm(ce, coefficients, index);

  const U = validateAnchor(ce, term, index, anchor, m, null);
  if (!U) return null;

  return assemble(expr, op, leftover, term, index, U);
}

/**
 * Newton's forward-difference general term for the exact sample differences
 * `coefficients[j] = Δʲs₁`: `t(k) = Σⱼ coefficients[j]·C(k−1, j)`, with
 * `C(k−1, j) = (k−1)(k−2)…(k−j)/j!`. Built with canonical operations and
 * simplified (never `.add()`/`.mul()`, which would fold exact literals).
 */
function newtonTerm(
  ce: Expression['engine'],
  coefficients: Expression[],
  index: Expression
): Expression {
  const g = coefficients.length - 1;
  const terms: Expression[] = [];
  for (let j = 0; j <= g; j++) {
    const cj = coefficients[j];
    if (j === 0) {
      terms.push(cj);
      continue;
    }
    const factors: Expression[] = [];
    for (let i = 0; i < j; i++)
      factors.push(ce.function('Subtract', [index, ce.number(i + 1)]));
    const numerator =
      factors.length === 1 ? factors[0] : ce.function('Multiply', factors);
    const binomial = ce.function('Divide', [
      numerator,
      ce.number(factorial(j)),
    ]);
    terms.push(ce.function('Multiply', [cj, binomial]));
  }
  return ce.function('Add', terms).simplify();
}

// ---------------------------------------------------------------------------
// v2 — geometric.
// ---------------------------------------------------------------------------

/**
 * Geometric recognizer: constant exact ratio `r` (`r ≠ 0, |r| ≠ 1`) between
 * consecutive samples, general term `t(k) = s₁·r^(k−1)`. The anchor must
 * validate to a well-formed upper bound (also the m = 2 structural
 * confirmation).
 */
function tryGeometric(
  expr: Expression,
  op: 'Add' | 'Multiply',
  { samples, anchor, leftover }: Continuation
): Expression | null {
  const ce = expr.engine;
  const m = samples.length;
  const s1 = samples[0];
  if (s1.isSame(0)) return null;

  const r = ce.function('Divide', [samples[1], s1]).evaluate();
  if (r.isSame(0) || r.isSame(1) || r.isSame(-1)) return null;
  for (let i = 1; i < m; i++) {
    const ri = ce.function('Divide', [samples[i], samples[i - 1]]).evaluate();
    if (!ri.isSame(r)) return null;
  }

  const index = freshIndex(expr);
  const term = ce
    .function('Multiply', [
      s1,
      ce.function('Power', [r, ce.function('Subtract', [index, ce.One])]),
    ])
    .simplify();

  const U = validateAnchor(ce, term, index, anchor, m, { s1, r });
  if (!U) return null;

  return assemble(expr, op, leftover, term, index, U);
}

// ---------------------------------------------------------------------------
// v3 — linear recurrence via Berlekamp–Massey + `RSolve` closed form.
// ---------------------------------------------------------------------------

/**
 * An exact rational as a normalized `bigint` pair (`d > 0`, `gcd(|n|, d) = 1`).
 * Berlekamp–Massey and the anchor search run entirely in this exact arithmetic;
 * floats are never used for the recognition or the bound.
 */
interface Rational {
  n: bigint;
  d: bigint;
}

function bigintGcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function ratOf(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bigintGcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

const RAT_ZERO = ratOf(0n, 1n);
const ratIsZero = (a: Rational): boolean => a.n === 0n;
const ratEq = (a: Rational, b: Rational): boolean => a.n === b.n && a.d === b.d;
const ratAdd = (a: Rational, b: Rational): Rational =>
  ratOf(a.n * b.d + b.n * a.d, a.d * b.d);
const ratSub = (a: Rational, b: Rational): Rational =>
  ratOf(a.n * b.d - b.n * a.d, a.d * b.d);
const ratMul = (a: Rational, b: Rational): Rational =>
  ratOf(a.n * b.n, a.d * b.d);
const ratDiv = (a: Rational, b: Rational): Rational =>
  ratOf(a.n * b.d, a.d * b.n);
const ratNeg = (a: Rational): Rational => ({ n: -a.n, d: a.d });
const ratMagnitude = (a: Rational): Rational => ({
  n: a.n < 0n ? -a.n : a.n,
  d: a.d,
});
/** Sign of `a − b` (both denominators positive). */
const ratCompare = (a: Rational, b: Rational): number => {
  const t = a.n * b.d - b.n * a.d;
  return t < 0n ? -1 : t > 0n ? 1 : 0;
};

/** Extract an exact rational literal as a {@link Rational} (else `null`). */
function toRational(x: Expression): Rational | null {
  if (!isExactRationalLiteral(x)) return null;
  const num = (x as unknown as { numerator?: Expression }).numerator;
  const den = (x as unknown as { denominator?: Expression }).denominator;
  if (!num || !den) return null;
  try {
    return ratOf(BigInt(num.toString()), BigInt(den.toString()));
  } catch {
    return null;
  }
}

/** Build an exact-rational literal `Expression` from a {@link Rational}. */
function fromRational(ce: Expression['engine'], r: Rational): Expression {
  if (r.d === 1n) return ce.number(r.n);
  return ce.function('Divide', [ce.number(r.n), ce.number(r.d)]).evaluate();
}

/**
 * Berlekamp–Massey over the exact rationals: the minimal-order linear
 * constant-coefficient recurrence
 * `s[i] = Σⱼ rec[j−1]·s[i−j]` (`j = 1…L`) generating the sample sequence.
 * Returns the coefficients and order `L`, or `null` when the sequence has no
 * linear complexity (empty input).
 */
function berlekampMassey(s: Rational[]): { rec: Rational[]; L: number } | null {
  const n = s.length;
  const c: Rational[] = [ratOf(1n, 1n)];
  let b: Rational[] = [ratOf(1n, 1n)];
  let L = 0;
  let m = 1;
  let bb: Rational = ratOf(1n, 1n);
  for (let i = 0; i < n; i++) {
    // Discrepancy d = Σ_{j=0}^{L} c[j]·s[i−j].
    let d = s[i];
    for (let j = 1; j <= L; j++) d = ratAdd(d, ratMul(c[j], s[i - j]));

    if (ratIsZero(d)) {
      m += 1;
    } else if (2 * L <= i) {
      const t = c.slice();
      const coef = ratDiv(d, bb);
      while (c.length < b.length + m) c.push(RAT_ZERO);
      for (let j = 0; j < b.length; j++)
        c[j + m] = ratSub(c[j + m], ratMul(coef, b[j]));
      L = i + 1 - L;
      b = t;
      bb = d;
      m = 1;
    } else {
      const coef = ratDiv(d, bb);
      while (c.length < b.length + m) c.push(RAT_ZERO);
      for (let j = 0; j < b.length; j++)
        c[j + m] = ratSub(c[j + m], ratMul(coef, b[j]));
      m += 1;
    }
  }
  if (L === 0) return null;
  // Connection polynomial C(x) = 1 + c[1]·x + … ; the recurrence is
  // s[i] = −Σ_{j=1}^{L} c[j]·s[i−j].
  const rec: Rational[] = [];
  for (let j = 1; j <= L; j++) rec.push(ratNeg(c[j] ?? RAT_ZERO));
  return { rec, L };
}

/** The recurrence reproduces every sample beyond the first `L` (exact). */
function recurrenceReproduces(
  s: Rational[],
  rec: Rational[],
  L: number
): boolean {
  for (let i = L; i < s.length; i++) {
    let acc = RAT_ZERO;
    for (let j = 1; j <= L; j++)
      acc = ratAdd(acc, ratMul(rec[j - 1], s[i - j]));
    if (!ratEq(acc, s[i])) return false;
  }
  return true;
}

/**
 * Iterate the recurrence in exact rational arithmetic from the samples to find
 * the least `U ≥ m + 1` with `a(U) = anchor`. Bounded by a hard cap; the search
 * also stops once the term magnitude grows past the anchor (the recognized
 * sequences are eventually magnitude-monotone, so a later exact match is then
 * impossible — this handles sign-alternating sequences too, whose magnitudes
 * still grow).
 */
function findRecurrenceUpperBound(
  samples: Rational[],
  rec: Rational[],
  L: number,
  anchor: Rational,
  m: number,
  deadline?: number
): number | null {
  const CAP = 10000;
  // A non-integer (rational) recurrence — a spurious fit to non-recurrent data
  // — makes the exact denominators balloon (~3 digits/step). Beyond this size
  // each step's bigint arithmetic dominates the run for no benefit; the family
  // we recognize has bounded (integer or small) denominators, so bail. Cheap
  // secondary guard alongside the cooperative deadline below.
  const MAX_DEN_BITS = 4096;
  const seq = samples.slice();
  const anchorMag = ratMagnitude(anchor);
  let prevMag = ratMagnitude(seq[seq.length - 1]);
  for (let u = m + 1; u <= CAP; u++) {
    // Late steps carry large-magnitude bigints; check the deadline every step
    // so a cancel lands within one step of the limit rather than after minutes.
    checkDeadline(deadline);
    let acc = RAT_ZERO;
    for (let j = 1; j <= L; j++)
      acc = ratAdd(acc, ratMul(rec[j - 1], seq[u - 1 - j]));
    seq.push(acc);
    if (ratEq(acc, anchor)) return u;
    if (acc.d !== 1n && acc.d.toString(2).length > MAX_DEN_BITS) return null;
    const mag = ratMagnitude(acc);
    if (ratCompare(mag, anchorMag) > 0 && ratCompare(mag, prevMag) > 0)
      return null;
    prevMag = mag;
  }
  return null;
}

/**
 * Famous-sequence display body. When the recurrence is exactly `a(k) = a(k−1) +
 * a(k−2)` and the samples match the library `Fibonacci` head at `k = 1…m`
 * (its convention is `Fibonacci(1) = Fibonacci(2) = 1`), return `Fibonacci(k)`
 * — a compact, exactly-evaluable body. Returns `null` otherwise (including when
 * no such head is available in the loaded library).
 */
function fibonacciBody(
  ce: Expression['engine'],
  rec: Rational[],
  L: number,
  samples: Expression[],
  index: Expression
): Expression | null {
  if (L !== 2) return null;
  if (!(ratEq(rec[0], ratOf(1n, 1n)) && ratEq(rec[1], ratOf(1n, 1n))))
    return null;
  if (
    !ce
      .function('Fibonacci', [ce.number(5)])
      .evaluate()
      .isSame(5)
  )
    return null;
  for (let i = 0; i < samples.length; i++) {
    const f = ce.function('Fibonacci', [ce.number(i + 1)]).evaluate();
    if (!f.isSame(samples[i])) return null;
  }
  return ce.function('Fibonacci', [index]);
}

/**
 * Closed-form body via the engine's `RSolve` (never a static import — the
 * solver is reached through `ce.function('RSolve', …)`). The general solution
 * (no initial conditions) is reliable and fast; its arbitrary constants
 * `c_1…c_L` are then resolved against the first `L` samples by an exact linear
 * solve here, yielding a Binet-style body. Returns `null` when `RSolve` is
 * inert, its solution has an unexpected shape, or the constant solve fails.
 */
function rSolveBody(
  ce: Expression['engine'],
  rec: Rational[],
  L: number,
  samples: Expression[],
  index: Expression
): Expression | null {
  try {
    const n = ce.symbol('n');
    // a(n + L) = Σⱼ rec[j−1]·a(n + L − j).
    const lhs = ce.function('a', [ce.function('Add', [n, ce.number(L)])]);
    const rhsTerms: Expression[] = [];
    for (let j = 1; j <= L; j++) {
      const coef = fromRational(ce, rec[j - 1]);
      if (coef.isSame(0)) continue;
      const shift = L - j;
      const arg = shift === 0 ? n : ce.function('Add', [n, ce.number(shift)]);
      const call = ce.function('a', [arg]);
      rhsTerms.push(
        coef.isSame(1) ? call : ce.function('Multiply', [coef, call])
      );
    }
    const equation = ce.function('Equal', [lhs, ce.function('Add', rhsTerms)]);
    const solution = ce
      .function('RSolve', [equation, ce.symbol('a'), n])
      .evaluate();

    if (!isFunction(solution, 'List') || solution.nops !== 1) return null;
    const solEq = solution.op1;
    if (!isFunction(solEq, 'Equal')) return null;
    const generalTerm = solEq.op2;

    const constants = generalTerm.freeVariables
      .filter((v) => /^c_\d+$/.test(v))
      .sort();
    if (constants.length !== L) return null;
    if (generalTerm.freeVariables.some((v) => v !== 'n' && !/^c_\d+$/.test(v)))
      return null;

    // Basis functions B_i(n): the general term with c_i = 1 and c_{j≠i} = 0.
    const basis = constants.map((ci) => {
      const map: Record<string, number> = {};
      for (const cj of constants) map[cj] = cj === ci ? 1 : 0;
      return generalTerm.subs(map).simplify();
    });

    // Resolve the constants: Σᵢ cᵢ·Bᵢ(j) = sⱼ for j = 1…L.
    const matrix: Expression[][] = [];
    for (let j = 1; j <= L; j++)
      matrix.push(basis.map((b) => b.subs({ n: j }).evaluate()));
    const coefficients = solveLinearSystem(ce, matrix, samples.slice(0, L));
    if (!coefficients) return null;

    const terms = basis.map((b, i) =>
      ce.function('Multiply', [coefficients[i], b.subs({ n: index })])
    );
    return ce.function('Add', terms).simplify();
  } catch {
    return null;
  }
}

/** The closed-form body reproduces every sample numerically (high precision). */
function bodyReproducesSamples(
  body: Expression,
  index: Expression,
  samples: Expression[]
): boolean {
  const name = isSymbol(index) ? index.symbol : '';
  for (let i = 0; i < samples.length; i++) {
    const bv = body.subs({ [name]: i + 1 }).N();
    const sv = samples[i].N();
    const tol = 1e-8 * Math.max(1, Math.abs(sv.re), Math.abs(sv.im ?? 0));
    if (Math.hypot(bv.re - sv.re, (bv.im ?? 0) - (sv.im ?? 0)) > tol)
      return false;
  }
  return true;
}

/**
 * Linear-recurrence recognizer (order `L ≥ 2`). Berlekamp–Massey over the exact
 * rational samples finds the minimal recurrence; a length-`L` recurrence needs
 * `2L` samples to be determined, so the evidence gate requires `m ≥ 2L` (the
 * `m = 2L` case is confirmed by the anchor, an extra witness). Order 1 is the
 * geometric family and is excluded here.
 *
 * The closed form is obtained through the engine's `RSolve` (or a famous-
 * sequence head such as `Fibonacci` for display), then trust-but-verified
 * against every sample. The upper bound `U` comes from iterating the recurrence
 * itself in exact arithmetic to a numeric anchor; symbolic anchors decline in
 * v3 (per the design gate).
 */
function tryRecurrence(
  expr: Expression,
  op: 'Add' | 'Multiply',
  { samples, anchor, leftover }: Continuation
): Expression | null {
  const ce = expr.engine;
  const m = samples.length;

  const sampleRationals: Rational[] = [];
  for (const s of samples) {
    const r = toRational(s);
    if (!r) return null;
    sampleRationals.push(r);
  }

  const bm = berlekampMassey(sampleRationals);
  if (!bm || bm.L < 2) return null;
  const { rec, L } = bm;
  if (!recurrenceReproduces(sampleRationals, rec, L)) return null;

  // Evidence: m ≥ 2L (m = 2L confirmed below by a successful anchor witness).
  if (m < 2 * L) return null;

  // Anchor: numeric only in v3. Symbolic anchors decline.
  if (anchor.freeVariables.length !== 0) return null;
  const anchorRational = toRational(anchor);
  if (!anchorRational) return null;
  const U = findRecurrenceUpperBound(
    sampleRationals,
    rec,
    L,
    anchorRational,
    m,
    ce._deadline
  );
  if (U === null) return null;

  const index = freshIndex(expr);
  const body =
    fibonacciBody(ce, rec, L, samples, index) ??
    rSolveBody(ce, rec, L, samples, index);
  if (!body) return null;

  // Trust but verify: the closed form must reproduce every sample.
  if (!bodyReproducesSamples(body, index, samples)) return null;

  return assemble(expr, op, leftover, body, index, ce.number(U));
}

// ---------------------------------------------------------------------------
// Anchor validation (polynomial + geometric families).
// ---------------------------------------------------------------------------

/**
 * Find an upper bound `U` such that `t(U) = A`, gated so the resulting `Sum` is
 * well-formed. `geo` is `null` for polynomials (candidate `U = s` by
 * substitution) or `{ s1, r }` for geometric (candidate `U = log_r(A/s₁) + 1`).
 *
 *  - *numeric anchor* `A`: bounded exact integer search for `U ≥ m + 1` with
 *    `t(U) = A` (the sequence is eventually monotonic, so the search stops on
 *    overshoot); accepts only exact integer bounds.
 *  - *symbolic anchor* `A` (one free symbol): the family candidate `U`, accepted
 *    iff `t(U) ≡ A` exactly and `U` passes the v1 shape gate.
 */
function validateAnchor(
  ce: Expression['engine'],
  term: Expression,
  index: Expression,
  anchor: Expression,
  m: number,
  geo: { s1: Expression; r: Expression } | null
): Expression | null {
  const free = anchor.freeVariables;

  if (free.length === 0)
    return findNumericUpperBound(ce, term, index, anchor, m);

  if (free.length !== 1) return null;

  let U: Expression;
  if (geo) {
    // U = log_r(A / s₁) + 1. Simplify the logarithm on its own first: the
    // exact reduction log_b(b^k) = k does not fire when the Log is buried in an
    // unsimplified Add, which would leave a non-affine bound.
    const logPart = ce
      .function('Log', [ce.function('Divide', [anchor, geo.s1]), geo.r])
      .simplify();
    U = ce.function('Add', [logPart, ce.One]).simplify();
  } else {
    U = ce.symbol(free[0]);
  }

  if (verifyTerm(ce, term, index, U, anchor) && isValidUpperBound(U, m))
    return U;
  return null;
}

/** `t(U) ≡ A` — the difference evaluates exactly to zero. */
function verifyTerm(
  ce: Expression['engine'],
  term: Expression,
  index: Expression,
  U: Expression,
  anchor: Expression
): boolean {
  const name = isSymbol(index) ? index.symbol : '';
  const value = ce
    .function('Subtract', [term.subs({ [name]: U }), anchor])
    .evaluate();
  return value.isSame(0);
}

/**
 * Bounded exact integer search for `U ≥ m + 1` with `t(U) = A`. The recognized
 * families are eventually monotonic, so the search stops once the numeric value
 * of `t` overshoots `A` (a hard cap guards against pathological terms).
 */
function findNumericUpperBound(
  ce: Expression['engine'],
  term: Expression,
  index: Expression,
  anchor: Expression,
  m: number
): Expression | null {
  const CAP = 100000;
  const anchorValue = anchor.N().re;
  const name = isSymbol(index) ? index.symbol : '';

  // A polynomial term is eventually monotonic, so once its value is on the far
  // side of the anchor AND still moving further away it can never return: stop.
  // The break uses the *local* trend (previous → current), not the sample
  // endpoints — a spurious high-degree interpolant of non-polynomial data (e.g.
  // the degree-5 fit to Fibonacci samples, leading coefficient −1/40) climbs
  // like the samples yet eventually falls, so a sample-derived "increasing"
  // flag never fires and the search used to grind all `CAP` steps.
  //
  // But a *genuine* polynomial can dip on the wrong side of the anchor and
  // still return to it (e.g. k³−21k²+120k for anchor 308 falls from k=5 to
  // k=10 before climbing to hit the anchor at k=14). A single wrong-side-and-
  // falling step must therefore not abort the search — only a sustained run of
  // them (a term truly running away) is conclusive. The `AWAY_STREAK` bound is
  // heuristic; the hard safety net for a runaway search is the CAP and the
  // caller's evaluation deadline.
  const AWAY_STREAK = 32;
  let prev: number | undefined;
  let awayStreak = 0;
  for (let u = m + 1; u <= CAP; u++) {
    const value = term.subs({ [name]: u }).evaluate();
    if (value.isSame(anchor)) return ce.number(u);
    const numeric = value.N().re;
    if (!Number.isFinite(numeric)) break;
    if (prev !== undefined) {
      const runningAway =
        (numeric > anchorValue && numeric > prev) || // above and rising
        (numeric < anchorValue && numeric < prev); // below and falling
      if (runningAway) {
        if (++awayStreak >= AWAY_STREAK) break;
      } else awayStreak = 0;
    }
    prev = numeric;
  }
  return null;
}

/**
 * The upper bound is valid when it is either:
 *  - a positive integer literal ≥ m + 1 (the anchor lies beyond the samples), or
 *  - affine in exactly one free symbol with integer coefficients (e.g. `n`,
 *    `n + 1`, `2n − 3`). This rejects `1 + 3 + \dots + 2n`, whose even anchor
 *    does not belong to the odd progression (U = n + 1/2), and non-affine bounds
 *    such as `log₂(m) + 1` from a spurious geometric match.
 */
function isValidUpperBound(U: Expression, m: number): boolean {
  const free = U.freeVariables;

  if (free.length === 0)
    return isNumber(U) && U.isInteger === true && U.re >= m + 1;

  if (free.length !== 1) return false;

  const ce = U.engine;
  const s = free[0];

  // Extract the affine coefficients: c₀ = U|ₛ₌₀, c₁ = (U|ₛ₌₁) − c₀.
  const c0 = U.subs({ [s]: 0 }).simplify();
  const c1 = ce.function('Subtract', [U.subs({ [s]: 1 }), c0]).simplify();
  if (!(isNumber(c0) && c0.isInteger === true)) return false;
  if (!(isNumber(c1) && c1.isInteger === true) || c1.isSame(0)) return false;

  // Confirm U is exactly affine (degree ≤ 1): U − (c₁·s + c₀) ≡ 0.
  const residual = ce
    .function('Subtract', [
      U,
      ce.function('Add', [ce.function('Multiply', [c1, ce.symbol(s)]), c0]),
    ])
    .simplify();
  return residual.isSame(0);
}

/**
 * Interpret every continuation-bearing `Add`/`Multiply` in `expr`, descending
 * into subexpressions so that `x + (1 + 2 + \dots + n)` and
 * `Equal(lhs, ellipsisExpr)` get their inner continuation interpreted. Each
 * candidate is gated independently.
 *
 * Returns the rewritten expression when at least one continuation fired, or
 * `null` when nothing in the tree matched a gate.
 */
export function inferContinuationPattern(expr: Expression): Expression | null {
  // `Interpret` holds its argument lazily, so a full-string parse such as
  // `\operatorname{Interpret}(1 - 1 + 2 - 3 + … + 13)` reaches here still
  // non-canonical (`Add(1, Negate(1), …)`). Canonicalize so the recognizer
  // sees the folded signed literals (`-1`) it admits as samples; the ellipsis
  // fold barrier keeps the notational order and samples intact. Idempotent for
  // the already-canonical arguments the `Interpret(parse(…))` path supplies.
  if (!expr.isCanonical) expr = expr.canonical;

  // A node that itself is a continuation-bearing Add/Multiply: interpret it
  // directly (its samples are literals, so there is nothing deeper to descend
  // into).
  const direct = interpretNode(expr);
  if (direct) return direct;

  // Otherwise descend into the operands, rebuilding if any child fired.
  if (!isFunction(expr)) return null;
  const ops = expr.ops;
  let changed = false;
  const newOps = ops.map((child) => {
    const r = inferContinuationPattern(child);
    if (r) {
      changed = true;
      return r;
    }
    return child;
  });
  if (!changed) return null;
  return expr.engine.function(expr.operator, newOps);
}

/**
 * Extract the exact numeric sample run from the first continuation-bearing
 * `Add`/`Multiply` in `expr` — the same run the recognizers see — for use by
 * the async OEIS-backed proposal flow (`interpret-oeis.ts`). Canonicalizes
 * first (matching {@link inferContinuationPattern}), then returns the samples
 * in source order, or `null` when the tree carries no continuation. Runs no
 * recognizer and performs no I/O.
 */
export function extractContinuationSamples(
  expr: Expression
): Expression[] | null {
  if (!expr.isCanonical) expr = expr.canonical;

  const direct = nodeContinuation(expr);
  if (direct) return direct.samples;

  if (!isFunction(expr)) return null;
  for (const child of expr.ops) {
    const r = extractContinuationSamples(child);
    if (r) return r;
  }
  return null;
}
