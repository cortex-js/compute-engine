import type { IComputeEngine as ComputeEngine, Expression } from '../global-types';
import { collectionElementType } from '../../common/type/utils';

import { isFunction, sym } from './type-guards';
import { asRational, asBigint, asSmallInteger } from './numerics';
import { expand } from './expand';

import {
  solveLinearDiophantine,
  solvePell,
  DiophantineBudgetError,
  type LinearSolution,
  type PellResult,
} from '../numerics/diophantine';

/**
 * Symbolic diophantine solving for the `Solve` pipeline (Phase 3).
 *
 * Recognizes two families of integer equations over the given unknowns and
 * dispatches them to the pure-bigint kernels in `numerics/diophantine.ts`:
 *
 * - **Linear** `a₁x₁ + … + aₙxₙ + c = 0` (any number of unknowns, exact
 *   integer/rational coefficients);
 * - **Pell-like** `A·u² + B·v² + C = 0` (exactly two unknowns, no cross or
 *   linear terms, reducible to `X² − D·Y² = N` because `|A| = 1` or `|B| = 1`).
 *
 * Result contract (see `docs/plans/2026-07-04-solve-domain-design.md`, Phase 3):
 * - all unknowns constrained to a **bounded finite integer domain** → a
 *   concrete list of `Tuple`s (the members the family produces inside the box,
 *   each honoring the domain's step via `contains` and exact-confirmed);
 * - all unknowns **fully unbounded** over ℤ → a **parametric** list of `Tuple`s
 *   in fresh integer parameters (free symbols ranging over ℤ);
 * - **half-bounded** (or otherwise not finitely instantiable) domains → the
 *   attempt declines (`undefined`), leaving the existing pipeline untouched.
 *
 * A return of `[]` is a decision — the equation has no solutions (e.g.
 * `6x + 9y = 4`). A return of `undefined` means "not a diophantine problem I
 * handle" — the caller falls through to its existing path.
 *
 * The unknown↔coordinate mapping is preserved end to end: emitted tuples are in
 * the caller's `unknowns` order.
 */

/**
 * Cap on the number of concrete members a bounded instantiation may materialize.
 * Above this, the attempt declines so the caller's enumeration/budget path runs
 * unchanged (it may itself refuse, but the decision stays there).
 */
export const MAX_DIOPHANTINE_EXPANSION = 1000;

/** Hard iteration backstop for the Pell family walk (per class, per direction).
 * The family grows monotonically past a minimal member, so a bounded box is
 * exhausted quickly; this only guards against a pathological non-termination. */
const MAX_PELL_WALK = 200_000;

//
// ─── bigint helpers ─────────────────────────────────────────────────────────
//

function babs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function blcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return babs(a / bgcd(a, b) * b);
}

/** `⌈a/b⌉` for `b ≠ 0`. */
function ceilDiv(a: bigint, b: bigint): bigint {
  let q = a / b;
  if (a % b !== 0n && a < 0n === b < 0n) q += 1n;
  return q;
}

/** `⌊a/b⌋` for `b ≠ 0`. */
function floorDiv(a: bigint, b: bigint): bigint {
  let q = a / b;
  if (a % b !== 0n && a < 0n !== b < 0n) q -= 1n;
  return q;
}

//
// ─── Coefficient / monomial extraction ──────────────────────────────────────
//

interface Monomial {
  /** Exponent of each unknown (index-aligned with the `unknowns` array). */
  exps: number[];
  /** The (unknown-free) coefficient expression of this monomial. */
  coef: Expression;
}

/**
 * One factor's contribution: `{ idx, exp }` for a pure power of unknown `idx`,
 * `{ idx: -1 }` for an unknown-free coefficient factor, or `null` when the
 * factor uses an unknown in a non-polynomial way (`Sin(x)`, `x^y`, `1/x`, a
 * non-integer or negative power, …).
 */
function factorInfo(
  f: Expression,
  unknowns: string[]
): { idx: number; exp: number } | null {
  const s = sym(f);
  if (s !== undefined) {
    const i = unknowns.indexOf(s);
    return i >= 0 ? { idx: i, exp: 1 } : { idx: -1, exp: 0 };
  }

  if (isFunction(f, 'Power')) {
    const base = sym(f.op1);
    const i = base === undefined ? -1 : unknowns.indexOf(base);
    if (i >= 0) {
      const e = asSmallInteger(f.op2);
      if (e === null || e < 0) return null;
      return { idx: i, exp: e };
    }
    // Power of a non-unknown base: a coefficient only if free of the unknowns.
    return freeOfUnknowns(f, unknowns) ? { idx: -1, exp: 0 } : null;
  }

  return freeOfUnknowns(f, unknowns) ? { idx: -1, exp: 0 } : null;
}

function freeOfUnknowns(e: Expression, unknowns: string[]): boolean {
  return unknowns.every((u) => !e.has(u));
}

/**
 * Decompose an equation residual into monomials over `unknowns`, aggregated by
 * exponent vector. Returns `null` when the residual is not a polynomial in the
 * unknowns (a non-polynomial occurrence, a non-integer/rational coefficient).
 */
function extractCoefficients(
  ce: ComputeEngine,
  residual: Expression,
  unknowns: string[]
): Map<string, { exps: number[]; coef: bigint /* numerator */; den: bigint }> | null {
  const expanded = expand(residual) ?? residual;
  const terms = isFunction(expanded, 'Add') ? [...expanded.ops] : [expanded];

  const monos: Monomial[] = [];
  for (let term of terms) {
    let neg = false;
    if (isFunction(term, 'Negate')) {
      term = term.op1;
      neg = true;
    }
    const exps = new Array<number>(unknowns.length).fill(0);
    const coefFactors: Expression[] = [];
    const factors = isFunction(term, 'Multiply') ? [...term.ops] : [term];
    for (const f of factors) {
      const info = factorInfo(f, unknowns);
      if (info === null) return null;
      if (info.idx >= 0) exps[info.idx] += info.exp;
      else coefFactors.push(f);
    }
    let coef =
      coefFactors.length === 0
        ? ce.One
        : coefFactors.length === 1
          ? coefFactors[0]
          : ce.function('Multiply', coefFactors);
    if (neg) coef = ce.function('Negate', [coef]);
    monos.push({ exps, coef });
  }

  // Aggregate by exponent vector, folding coefficients exactly.
  const byKey = new Map<string, Expression>();
  for (const m of monos) {
    const key = m.exps.join(',');
    const prev = byKey.get(key);
    byKey.set(key, prev ? ce.function('Add', [prev, m.coef]) : m.coef);
  }

  const out = new Map<
    string,
    { exps: number[]; coef: bigint; den: bigint }
  >();
  for (const [key, coefExpr] of byKey) {
    const value = coefExpr.evaluate();
    const rational = asRational(value);
    if (rational === undefined) return null; // non-rational coefficient
    const num = BigInt(rational[0]);
    const den = BigInt(rational[1]);
    if (den === 0n) return null;
    // Normalize sign so the denominator is positive.
    const sign = den < 0n ? -1n : 1n;
    const exps = key.split(',').map((s) => parseInt(s, 10));
    out.set(key, { exps, coef: num * sign, den: babs(den) });
  }
  return out;
}

//
// ─── Domain classification ──────────────────────────────────────────────────
//

type DomainKind =
  | { kind: 'unbounded' }
  | { kind: 'bounded'; lo: bigint; hi: bigint; domain: Expression }
  | { kind: 'reject' };

/**
 * Classify a per-unknown domain constraint. `undefined` (a declared
 * integer-typed unknown with no domain) is fully unbounded ℤ. An integer
 * `Range` with two finite endpoints is a bounded box; the doubly-infinite
 * `Range(-∞, +∞)` and the `Integers` collection are unbounded; a half-bounded
 * `Range` (one infinite endpoint) or any non-integer / non-`Range` collection
 * is rejected (the attempt declines).
 */
function classifyDomain(
  ce: ComputeEngine,
  domain: Expression | undefined
): DomainKind {
  if (domain === undefined) return { kind: 'unbounded' };

  if (sym(domain) === 'Integers') return { kind: 'unbounded' };

  if (isFunction(domain, 'Range')) {
    // `Range(n)` means `1..n`; `Range(lo, hi[, step])`.
    const loExpr = domain.nops >= 2 ? domain.op1 : ce.One;
    const hiExpr = domain.nops >= 2 ? domain.op2 : domain.op1;
    const lo = asBigint(loExpr);
    const hi = asBigint(hiExpr);
    const loInf = lo === null;
    const hiInf = hi === null;
    if (!loInf && !hiInf) {
      return {
        kind: 'bounded',
        lo: lo < hi ? lo : hi,
        hi: lo < hi ? hi : lo,
        domain,
      };
    }
    // Both infinite → unbounded; exactly one infinite → half-bounded (reject).
    if (loInf && hiInf) return { kind: 'unbounded' };
    return { kind: 'reject' };
  }

  return { kind: 'reject' };
}

/**
 * Whether a domain collection's element type is integer-valued — the gate the
 * caller uses before dispatching here (a bounded integer `Range` or the
 * `Integers` set qualifies; a real `Interval` or a half-bounded `Range`, whose
 * element type degrades to `number`, does not).
 */
export function isIntegerDomain(
  ce: ComputeEngine,
  domain: Expression
): boolean {
  const et = collectionElementType(domain.type.type);
  return et !== undefined && ce.type(et).matches('integer');
}

//
// ─── Fresh parameters ───────────────────────────────────────────────────────
//

/**
 * `count` fresh integer-parameter symbols named `t, t_1, t_2, …`, skipping any
 * name that occurs in the equation or is bound to a value in the current
 * context (a bound `t` with a value would evaluate inside the result). Nothing
 * is declared in the user's scope — the parameters surface as free symbols.
 */
function freshParameters(
  ce: ComputeEngine,
  eq: Expression,
  count: number
): Expression[] {
  const used = new Set<string>(eq.symbols);
  const out: Expression[] = [];
  let i = 0;
  while (out.length < count) {
    const name = i === 0 ? 't' : `t_${i}`;
    i++;
    if (used.has(name)) continue;
    if (ce.symbol(name).value !== undefined) continue; // bound to a value
    used.add(name);
    out.push(ce.symbol(name));
  }
  return out;
}

//
// ─── Tuple construction ─────────────────────────────────────────────────────
//

/** Place `X`/`Y` (Pell coordinates) into a caller-order tuple of arity `n`. */
function orderedTuple(
  ce: ComputeEngine,
  X: Expression,
  Y: Expression,
  xIdx: number,
  yIdx: number
): Expression {
  const coords: Expression[] = [];
  coords[xIdx] = X;
  coords[yIdx] = Y;
  return ce.tuple(...coords);
}

/** An affine form `base + Σ coef[j]·params[j]` as a canonical expression. */
function affine(
  ce: ComputeEngine,
  base: bigint,
  coef: bigint[],
  params: Expression[]
): Expression {
  const terms: Expression[] = [];
  if (base !== 0n) terms.push(ce.number(base));
  for (let j = 0; j < coef.length; j++) {
    if (coef[j] === 0n) continue;
    terms.push(ce.function('Multiply', [ce.number(coef[j]), params[j]]));
  }
  if (terms.length === 0) return ce.number(0);
  if (terms.length === 1) return terms[0];
  return ce.function('Add', terms);
}

//
// ─── Exact confirmation & membership ────────────────────────────────────────
//

/** Substitute integer values and confirm the residual is exactly zero. */
function confirm(
  ce: ComputeEngine,
  residual: Expression,
  unknowns: string[],
  values: bigint[]
): boolean {
  const subs: Record<string, Expression> = {};
  for (let i = 0; i < unknowns.length; i++) subs[unknowns[i]] = ce.number(values[i]);
  return residual.subs(subs).evaluate().isEqual(0) === true;
}

/** Whether a concrete integer lies in its (bounded) domain, honoring steps. */
function inBoundedDomain(
  ce: ComputeEngine,
  kind: { domain: Expression },
  value: bigint
): boolean {
  return kind.domain.contains(ce.number(value)) === true;
}

//
// ─── Public entry point ─────────────────────────────────────────────────────
//

/**
 * Attempt a symbolic diophantine solve. Returns the `List` contents (an array
 * of `Tuple`s) on success — possibly empty (a decided "no solutions") — or
 * `undefined` to fall through to the caller's existing path.
 *
 * @param unknowns The unknowns, in the order coordinates should appear.
 * @param domains  Per-unknown domain expressions (index-aligned), or
 *   `undefined` for the fully unbounded (declared integer-typed, no domain)
 *   case. An individual `undefined` entry is treated as unbounded ℤ.
 */
export function tryDiophantineSolve(
  ce: ComputeEngine,
  eq: Expression,
  unknowns: string[],
  domains: ReadonlyArray<Expression | undefined> | undefined
): Expression[] | undefined {
  if (unknowns.length === 0) return undefined;

  try {
    // Normalize to a residual `= 0`. Only genuine equations are diophantine;
    // a boolean predicate (`Congruent`, `Divides`, …) is left to enumeration.
    let residual: Expression;
    if (isFunction(eq, 'Equal')) {
      residual = ce.function('Subtract', [eq.op1, eq.op2]);
    } else if (eq.type.matches('boolean')) {
      return undefined;
    } else {
      residual = eq;
    }

    // Classify each unknown's domain.
    const kinds = unknowns.map((_, i) =>
      classifyDomain(ce, domains ? domains[i] : undefined)
    );
    if (kinds.some((k) => k.kind === 'reject')) return undefined;
    const allBounded = kinds.every((k) => k.kind === 'bounded');
    const allUnbounded = kinds.every((k) => k.kind === 'unbounded');
    if (!allBounded && !allUnbounded) return undefined; // mixed → inert

    // Extract coefficients over the unknowns.
    const coeffs = extractCoefficients(ce, residual, unknowns);
    if (coeffs === null) return undefined;

    const maxDeg = Math.max(
      0,
      ...[...coeffs.values()].map((m) => m.exps.reduce((a, b) => a + b, 0))
    );

    if (maxDeg <= 1) {
      return solveLinearCase(
        ce,
        eq,
        residual,
        unknowns,
        coeffs,
        kinds,
        allBounded
      );
    }

    if (unknowns.length === 2) {
      return solvePellCase(
        ce,
        eq,
        residual,
        unknowns,
        coeffs,
        kinds,
        allBounded
      );
    }

    return undefined;
  } catch (e) {
    if (e instanceof DiophantineBudgetError) return undefined;
    throw e;
  }
}

//
// ─── Linear case ─────────────────────────────────────────────────────────────
//

function solveLinearCase(
  ce: ComputeEngine,
  eq: Expression,
  residual: Expression,
  unknowns: string[],
  coeffs: Map<string, { exps: number[]; coef: bigint; den: bigint }>,
  kinds: DomainKind[],
  allBounded: boolean
): Expression[] | undefined {
  const n = unknowns.length;

  // Clear denominators: scale the whole equation by the lcm of denominators so
  // every coefficient and the constant becomes an exact integer.
  let scale = 1n;
  for (const m of coeffs.values()) scale = blcm(scale, m.den);
  if (scale === 0n) scale = 1n;

  const A = new Array<bigint>(n).fill(0n);
  let C = 0n;
  for (const m of coeffs.values()) {
    const value = m.coef * (scale / m.den);
    const deg = m.exps.reduce((a, b) => a + b, 0);
    if (deg === 0) C = value;
    else {
      const idx = m.exps.findIndex((e) => e === 1);
      if (idx < 0) return undefined; // should not happen for maxDeg ≤ 1
      A[idx] = value;
    }
  }

  // Σ A_i x_i = −C.
  const solution = solveLinearDiophantine(A, -C);
  if (solution === null) return []; // gcd(A) ∤ (−C) → decided: no solutions

  if (allBounded) {
    const res = instantiateLinearBounded(ce, residual, unknowns, solution, kinds);
    // Bounded linear: surface ONLY a decided-empty result — a proven-unsolvable
    // equation or an empty box intersection. A *non-empty* bounded linear family
    // is deferred to the caller's enumeration, which produces identical concrete
    // tuples within budget and, crucially, keeps the established Phase-2 contract
    // that an over-budget box stays inert (rather than being solved
    // symbolically). Phase 3's genuinely new bounded capability — reaching a
    // family enumeration cannot, over a box far beyond the enumeration budget —
    // is exercised by the Pell path, not the trivially-enumerable linear one.
    if (res === undefined) return undefined;
    return res.length === 0 ? [] : undefined;
  }
  // Fully unbounded → parametric.
  return parametricLinear(ce, eq, unknowns, solution);
}

/** One tuple of affine forms in `nParams` fresh parameters. */
function parametricLinear(
  ce: ComputeEngine,
  eq: Expression,
  unknowns: string[],
  solution: LinearSolution
): Expression[] {
  const params = freshParameters(ce, eq, solution.nParams);
  const coords = unknowns.map((_, i) =>
    affine(ce, solution.base[i], solution.coef[i], params)
  );
  return [ce.tuple(...coords)];
}

/**
 * Instantiate a bounded linear solve. Only the single-parameter case (the
 * generic two-unknown reduction, or a two-unknown system with one free
 * variable) is handled here; a ≥2-parameter family over a box is left to the
 * caller's enumeration.
 */
function instantiateLinearBounded(
  ce: ComputeEngine,
  residual: Expression,
  unknowns: string[],
  solution: LinearSolution,
  kinds: DomainKind[]
): Expression[] | undefined {
  if (solution.nParams !== 1) return undefined;

  const n = unknowns.length;
  const base = solution.base;
  const hom = solution.coef.map((row) => row[0]);

  // Intersect the per-coordinate constraints `lo ≤ base + hom·t ≤ hi` into a
  // single integer `t` interval.
  let tMin: bigint | undefined;
  let tMax: bigint | undefined;
  for (let i = 0; i < n; i++) {
    const k = kinds[i];
    if (k.kind !== 'bounded') return undefined;
    if (hom[i] === 0n) {
      // `x_i` is constant; it must already lie in the box.
      if (base[i] < k.lo || base[i] > k.hi) return [];
      continue;
    }
    // lo ≤ base + hom·t ≤ hi.
    let a = k.lo - base[i];
    let b = k.hi - base[i];
    let cLo: bigint;
    let cHi: bigint;
    if (hom[i] > 0n) {
      cLo = ceilDiv(a, hom[i]);
      cHi = floorDiv(b, hom[i]);
    } else {
      cLo = ceilDiv(b, hom[i]);
      cHi = floorDiv(a, hom[i]);
    }
    tMin = tMin === undefined ? cLo : cLo > tMin ? cLo : tMin;
    tMax = tMax === undefined ? cHi : cHi < tMax ? cHi : tMax;
  }

  if (tMin === undefined || tMax === undefined) return undefined; // no varying coord
  if (tMin > tMax) return []; // empty intersection: decided no solutions
  if (tMax - tMin + 1n > BigInt(MAX_DIOPHANTINE_EXPANSION)) return undefined;

  const rows: bigint[][] = [];
  for (let t = tMin; t <= tMax; t++) {
    const values = unknowns.map((_, i) => base[i] + hom[i] * t);
    if (!values.every((v, i) => inBoundedDomain(ce, kinds[i] as any, v))) continue;
    if (!confirm(ce, residual, unknowns, values)) continue;
    rows.push(values);
    if (rows.length > MAX_DIOPHANTINE_EXPANSION) return undefined;
  }
  return sortedTuples(ce, rows);
}

//
// ─── Pell case ───────────────────────────────────────────────────────────────
//

function solvePellCase(
  ce: ComputeEngine,
  eq: Expression,
  residual: Expression,
  unknowns: string[],
  coeffs: Map<string, { exps: number[]; coef: bigint; den: bigint }>,
  kinds: DomainKind[],
  allBounded: boolean
): Expression[] | undefined {
  // Allowed monomials: u², v², constant. Anything else (cross/linear) declines.
  const allowed = new Set(['2,0', '0,2', '0,0']);
  for (const key of coeffs.keys()) if (!allowed.has(key)) return undefined;

  // Clear denominators.
  let scale = 1n;
  for (const m of coeffs.values()) scale = blcm(scale, m.den);
  if (scale === 0n) scale = 1n;
  const intCoef = (key: string): bigint => {
    const m = coeffs.get(key);
    return m ? m.coef * (scale / m.den) : 0n;
  };
  const A = intCoef('2,0'); // coefficient of unknowns[0]²
  const B = intCoef('0,2'); // coefficient of unknowns[1]²
  const C = intCoef('0,0');
  if (A === 0n || B === 0n) return undefined; // not a genuine binary quadratic

  // Reduce `A·u² + B·v² + C = 0` to `X² − D·Y² = N` (X coefficient ±1).
  let xIdx: number;
  let yIdx: number;
  let D: bigint;
  let N: bigint;
  if (babs(A) === 1n) {
    // ×A: u² + A·B·v² + A·C = 0 → u² − (−A·B)·v² = −A·C.
    xIdx = 0;
    yIdx = 1;
    D = -A * B;
    N = -A * C;
  } else if (babs(B) === 1n) {
    // ×B: v² + A·B·u² + B·C = 0 → v² − (−A·B)·u² = −B·C.
    xIdx = 1;
    yIdx = 0;
    D = -A * B;
    N = -B * C;
  } else {
    return undefined; // not reducible to a unit-coefficient Pell form
  }

  const result = solvePell(D, N);

  if (allBounded) {
    return instantiatePellBounded(
      ce,
      residual,
      unknowns,
      result,
      D,
      xIdx,
      yIdx,
      kinds
    );
  }
  return parametricPell(ce, eq, unknowns, result, D, xIdx, yIdx);
}

/** Parametric closed forms for an unbounded Pell solve. */
function parametricPell(
  ce: ComputeEngine,
  eq: Expression,
  unknowns: string[],
  result: PellResult,
  D: bigint,
  xIdx: number,
  yIdx: number
): Expression[] | undefined {
  if (result.kind === 'empty') return [];

  if (result.kind === 'finite') {
    // Already complete: concrete tuples.
    return result.solutions.map(([X, Y]) =>
      orderedTuple(ce, ce.number(X), ce.number(Y), xIdx, yIdx)
    );
  }

  if (result.kind === 'linear-family') {
    // Degenerate: X = a + b·Y, Y free. One fresh parameter across families.
    const param = freshParameters(ce, eq, 1)[0];
    return result.families.map((fam) => {
      const [a, b] = fam.xOfY;
      const X = affine(ce, a, [b], [param]);
      return orderedTuple(ce, X, param, xIdx, yIdx);
    });
  }

  // result.kind === 'family': closed forms in one fresh parameter t ∈ ℤ.
  const t = freshParameters(ce, eq, 1)[0];
  const sqrtD = ce.function('Sqrt', [ce.number(D)]);
  const [T, U] = result.unit;
  const unit = ce.function('Add', [
    ce.number(T),
    ce.function('Multiply', [ce.number(U), sqrtD]),
  ]);
  const unitBar = ce.function('Subtract', [
    ce.number(T),
    ce.function('Multiply', [ce.number(U), sqrtD]),
  ]);
  const two = ce.number(2);
  const twoSqrtD = ce.function('Multiply', [two, sqrtD]);

  const out: Expression[] = [];
  for (const [r, s] of result.classes) {
    const alpha = ce.function('Add', [
      ce.number(r),
      ce.function('Multiply', [ce.number(s), sqrtD]),
    ]);
    const alphaBar = ce.function('Subtract', [
      ce.number(r),
      ce.function('Multiply', [ce.number(s), sqrtD]),
    ]);
    const memb = ce.function('Multiply', [alpha, ce.function('Power', [unit, t])]);
    const conj = ce.function('Multiply', [
      alphaBar,
      ce.function('Power', [unitBar, t]),
    ]);
    const X = ce.function('Divide', [ce.function('Add', [memb, conj]), two]);
    const Y = ce.function('Divide', [
      ce.function('Subtract', [memb, conj]),
      twoSqrtD,
    ]);
    out.push(orderedTuple(ce, X, Y, xIdx, yIdx));
    // The negation of every member is also a solution.
    out.push(
      orderedTuple(
        ce,
        ce.function('Negate', [X]),
        ce.function('Negate', [Y]),
        xIdx,
        yIdx
      )
    );
  }
  return out;
}

/** Instantiate a bounded Pell solve over the domain box. */
function instantiatePellBounded(
  ce: ComputeEngine,
  residual: Expression,
  unknowns: string[],
  result: PellResult,
  D: bigint,
  xIdx: number,
  yIdx: number,
  kinds: DomainKind[]
): Expression[] | undefined {
  if (result.kind === 'empty') return [];

  const xKind = kinds[xIdx];
  const yKind = kinds[yIdx];
  if (xKind.kind !== 'bounded' || yKind.kind !== 'bounded') return undefined;

  const rows: bigint[][] = [];
  const emit = (X: bigint, Y: bigint): boolean => {
    // Values into caller order.
    const values: bigint[] = [];
    values[xIdx] = X;
    values[yIdx] = Y;
    if (!inBoundedDomain(ce, xKind, X)) return true;
    if (!inBoundedDomain(ce, yKind, Y)) return true;
    if (!confirm(ce, residual, unknowns, values)) return true;
    rows.push(values);
    return rows.length <= MAX_DIOPHANTINE_EXPANSION;
  };

  if (result.kind === 'finite') {
    for (const [X, Y] of result.solutions) if (!emit(X, Y)) return undefined;
    return sortedTuples(ce, rows);
  }

  if (result.kind === 'linear-family') {
    // X = a + b·Y, Y free — iterate Y over its box.
    for (const fam of result.families) {
      const [a, b] = fam.xOfY;
      for (let Y = yKind.lo; Y <= yKind.hi; Y++) {
        const X = a + b * Y;
        if (!emit(X, Y)) return undefined;
      }
    }
    return sortedTuples(ce, rows);
  }

  // result.kind === 'family': walk each class forward and backward from t = 0.
  const [T, U] = result.unit;
  const xMax = xKind.hi > -xKind.lo ? xKind.hi : -xKind.lo;
  const yMax = yKind.hi > -yKind.lo ? yKind.hi : -yKind.lo;

  for (const [r, s] of result.classes) {
    // Forward: multiply by the fundamental unit (T, U); the members are the
    // t = 0, 1, 2, … family. Backward: multiply by the inverse unit (T, −U),
    // the t = 0, −1, −2, … family (t = 0 is the shared class rep, deduped).
    for (const dir of [1n, -1n]) {
      const uu = dir === 1n ? U : -U;
      let x = r;
      let y = s;
      let prevMag = -1n; // magnitude of the previous member (−1 ⇒ none yet)
      let guard = 0;
      for (;;) {
        if (++guard > MAX_PELL_WALK) return undefined;
        if (!emit(x, y)) return undefined;
        if (!emit(-x, -y)) return undefined;
        // Past its minimal member the family magnitude strictly increases, so a
        // member that is BOTH outside the box AND larger than the previous one
        // is on the terminal growth branch — no later member can re-enter. This
        // never fires during the backward "dip" (magnitude decreasing there).
        const mag = babs(x) + babs(y);
        const outside = babs(x) > xMax || babs(y) > yMax;
        if (outside && prevMag >= 0n && mag > prevMag) break;
        prevMag = mag;
        const nx = x * T + D * y * uu;
        const ny = x * uu + y * T;
        x = nx;
        y = ny;
      }
    }
  }
  return sortedTuples(ce, rows);
}

//
// ─── Result assembly ─────────────────────────────────────────────────────────
//

/** De-duplicate integer rows, sort lexicographically ascending, box to tuples. */
function sortedTuples(ce: ComputeEngine, rows: bigint[][]): Expression[] {
  const seen = new Set<string>();
  const unique: bigint[][] = [];
  for (const row of rows) {
    const key = row.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  unique.sort((a, b) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
  });
  return unique.map((row) => ce.tuple(...row.map((v) => ce.number(v))));
}
