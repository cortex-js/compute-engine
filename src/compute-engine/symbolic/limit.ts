import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { differentiate } from './derivative.js';
import {
  polynomialDegree,
  getPolynomialCoefficients,
} from '../boxed-expression/polynomials.js';
import { uncachedHostCallCount } from '../boxed-expression/host-handler-changes.js';
import {
  memoDepsStillValid,
  snapshotMemoDeps,
  type MemoDeps,
} from '../boxed-expression/collection-element-memo.js';
import {
  reduceTransformerHead,
  withValueShield,
} from '../boxed-expression/utils.js';
import { implicitCompile } from '../implicit-compile.js';
import { laurentData } from './series.js';
import { expand } from '../boxed-expression/expand.js';
import { asExactSmallInteger } from '../boxed-expression/numerics.js';
import {
  limit as numericLimit,
  LIMIT_PROBE_ITERATION_BUDGET,
} from '../numerics/numeric.js';
import {
  checkDeadline,
  CancellationError,
} from '../../common/interruptible.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { journalCheckpointMemoEntry } from '../checkpoint-journal.js';
import {
  exactlyEqual,
  hasIrrationalAlgebraic,
  isUnfoldedZero,
} from './contour.js';

// The base `Expression` type exposes operands only after a type-guard narrows it
// to a function (`isFunction`). Internally we always hold real boxed expressions
// whose `op1`/`op2`/`op3`/`ops` getters are always present (returning `Nothing`
// / `[]` for non-functions), so read them through these thin typed accessors.
const o1 = (e: Expression): Expression =>
  (e as unknown as { op1: Expression }).op1;
const o2 = (e: Expression): Expression =>
  (e as unknown as { op2: Expression }).op2;
const oo = (e: Expression): ReadonlyArray<Expression> =>
  (e as unknown as { ops: ReadonlyArray<Expression> | null }).ops ?? [];

/**
 * Symbolic limit evaluation.
 *
 * A best-effort *symbolic* companion to the numeric (Richardson) limit path:
 * given the body of a `Limit`, it tries to produce an **exact closed form**
 * (`lim_{x→2} x²+1 = 5`, `lim_{x→0} sin x/x = 1`, `lim_{x→∞} (3ˣ+5ˣ)^{1/x} = 5`).
 * It returns `undefined` whenever it cannot determine the limit, so the caller
 * falls back to the numeric path — the symbolic path is purely additive and
 * cannot regress existing behavior.
 *
 * Strategies, in rough order of application:
 *  - constant (body free of the variable);
 *  - finite point: direct substitution (continuous case), then algebraic
 *    cancellation, then L'Hôpital for 0/0 and ∞/∞ (reuses `differentiate`);
 *  - infinite point: a "leading-order" rewrite that replaces every sum with its
 *    asymptotically-dominant term(s) (a Gruntz-lite — `3ˣ+5ˣ → 5ˣ`,
 *    `sin x+ln x → ln x`), then a structural evaluation of the simplified form
 *    (polynomial/rational growth, exp/ln, products, `f^g` via `exp(g·ln f)`,
 *    bounded `sin`/`cos`/`arctan`).
 *
 * @param body     the function body, e.g. `Divide(Sin(x), x)`
 * @param x        the limit variable name
 * @param point    the limit point (a number, or ±∞)
 * @param dir      +1 (from the right), −1 (from the left), 0/undefined (both)
 */
export function symbolicLimit(
  body: Expression,
  x: string,
  point: Expression,
  dir: number | undefined,
  ce: ComputeEngine
): Expression | undefined {
  try {
    // A `Function` literal wraps its body in a `Block` (`(x) ↦ {body}`); unwrap
    // it so the structural strategies see the actual operator (Divide, Power…).
    let b = body;
    while (b.operator === 'Block' && oo(b)?.length === 1) b = o1(b);

    // A `Return` ends the function literal with its value, so a body that is
    // `Return(v)` has the limit of `v`. This code substitutes into the body
    // and never runs it, so a `Return` anywhere else (a statement block, a
    // branch) cannot be read here: decline and let the caller fall back
    // (CE-400).
    if (b.operator === 'Return' && oo(b)?.length === 1) b = o1(b);
    else if (b.has('Return')) return undefined;

    // A transformer head (`Limit(Simplify(f), …)`, e.g. from the pipeline
    // `f |> Simplify |> Limit`) is a computation step: reduce it so the
    // structural strategies see the transformed expression rather than an
    // opaque `Simplify` node. Shield the limit variable while reducing: the
    // `Simplify` operator evaluates its argument, so a value-bound limit
    // variable (`x := 5`) would fold `Simplify(x²)` to `25` before the limit
    // is taken. It is a bound variable — its assigned value must not apply.
    b = withValueShield(ce, [x], () => reduceTransformerHead(b));

    // Soundness guard for special-function poles. The structural strategies
    // (notably direct substitution) don't model the poles of Gamma/Digamma/…,
    // so `(x+1)·Digamma(x)` at -1 substitutes `Digamma(-1)` as a finite symbol
    // and returns a WRONG 0. If a special function provably blows up at the
    // finite limit point, resolve the limit from the exact Laurent expansion
    // about the point instead (item 7c: the constant term is exactly the
    // quantity a leading-term rewrite gets wrong — `lim_{x→0} Gamma(x) − 1/x
    // = −γ`, not 0). When the Laurent kernel declines (branch point,
    // essential singularity, exhausted window) or the expansion has a pole
    // (negative valuation), defer (return undefined) so the caller falls back
    // rather than risk a wrong value — two-sided pole limits stay inert
    // engine-wide (`lim 1/x²` at 0), and this path keeps that convention.
    // Detection uses the pole-aware `N()` store (item 7), so it covers any
    // argument that lands on a pole.
    if (point.isFinite === true && b.has(SPECIAL_POLE_FNS)) {
      for (const fn of SPECIAL_POLE_FNS) {
        for (const s of b.getSubexpressions(fn)) {
          const at = s.subs({ [x]: point }).N();
          if (at.isNaN === true || at.isFinite !== true) {
            // W = 3: only the constant term is consulted, and the kernel
            // deepens internally where a denominator demands it.
            const L = laurentData(b, x, point, ce, 3);
            if (L && L.v > 0) return ce.Zero;
            if (L && L.v === 0) {
              const c0 = L.coeff(0).evaluate();
              if (c0.isValid && c0.isNaN !== true) return c0;
            }
            // Negative valuation: a genuine pole — resolve to a signed
            // infinity when the direction/parity allows (see
            // signedPoleInfinity); otherwise defer as before. Never fall
            // through to the structural strategies: direct substitution
            // does not model these poles (that is this guard's purpose).
            if (L && L.v < 0) {
              const inf = signedPoleInfinity(L, dir ?? 0, ce);
              if (inf) return inf;
            }
            return undefined;
          }
        }
      }
    }

    const r = limitDispatch(b, x, point, dir ?? 0, ce, 0);
    if (r === undefined) return limitAtSymbolicPoint(b, x, point, dir, ce);
    if (r.isNaN === true) return undefined;
    // A limit in terms of a parameter is the GENERIC answer: `1/a` for
    // `lim_{x→a} 1/x`, although the limit does not exist at `a = 0`. The one
    // exception is an answer with a jump at a value the parameter can take:
    // `|a|/a` for `lim_{x→a} |x|/x` is `1` or `−1`, and it is not the limit
    // at `a = 0` from either side.
    if (limitResultHasJump(r, b)) return undefined;
    return r;
  } catch (e) {
    // A deadline/interrupt must unwind to the public evaluate boundary rather
    // than be swallowed as "couldn't determine the limit" (which would then
    // launch the numeric fallback and blow the budget a second time). Only
    // genuine internal errors are absorbed into an `undefined` (defer) result.
    if (e instanceof CancellationError) throw e;
    return undefined;
  }
}

/**
 * The limit of `body` as `x → point` when the point is not a number literal
 * (a symbol `a`, or an expression such as `a + 1` or `π`), from the limit at
 * the number literal 0: `lim_{x→a} f(x) = lim_{t→0} f(a + t)`, with the same
 * direction. The strategies that resolve a pole, a logarithm or a jump read
 * the Laurent expansion of the body about the point, and that expansion
 * needs a point that is known to be finite: a symbol `a` is not, so
 * `lim_{x→a⁺} 1/(x − a)` stayed unevaluated while `lim_{x→0⁺} 1/x` is `+∞`.
 * After the shift, the point is 0 and `1/(x − a)` is `1/t`.
 *
 * The shift is exact, so a limit that depends on the sign of a parameter
 * still declines: `1/(x² − a²)` at `a⁺` is `1/(2at + t²)`, whose leading
 * coefficient `2a` has no known sign. The point is read as generic, as
 * direct substitution already reads it (`lim_{x→a} x² = a²`).
 *
 * Canonicalization does not collect like terms, so the substitution gives
 * `1/(a − a + t)`: each sum that contains `t` is evaluated again, which
 * collects the terms (`1/t`). Only the sums are evaluated, so the structure
 * that the strategies read (a quotient, a product) is kept.
 *
 * The fresh variable `t` is declared `real` in a temporary scope, so it has
 * no binding outside this function. A result that still contains it is
 * discarded. Returns `undefined` when the point is a number literal, an
 * infinity, contains `x`, or when the limit at 0 is not found.
 */
function limitAtSymbolicPoint(
  body: Expression,
  x: string,
  point: Expression,
  dir: number | undefined,
  ce: ComputeEngine
): Expression | undefined {
  if (isNumber(point) || !point.isValid) return undefined;
  if (point.isInfinity === true || point.isFinite === false) return undefined;
  if (point.has(x)) return undefined;
  const t = ['t', 's', 'u', 'w', 'q', 'tau', 'xi', 'eta'].find(
    (name) => name !== x && !body.has(name) && !point.has(name)
  );
  if (t === undefined) return undefined;
  ce.pushScope();
  try {
    ce.declare(t, 'real');
    const collect = (e: Expression): Expression => {
      if (!isFunction(e) || !e.has(t)) return e;
      const rebuilt = ce.function(e.operator, e.ops.map(collect));
      return rebuilt.operator === 'Add' ? rebuilt.evaluate() : rebuilt;
    };
    const shifted = collect(
      body.subs({ [x]: ce.function('Add', [point, ce.symbol(t)]) })
    );
    const r = symbolicLimit(shifted, t, ce.Zero, dir, ce);
    if (r === undefined || r.has(t)) return undefined;
    return r;
  } finally {
    ce.popScope();
  }
}

// Special functions whose poles the structural limit strategies don't model.
// Elementary functions (ln, sin, …) are handled by the dispatch and excluded —
// listing them here would needlessly defer limits like `lim x·ln x`.
const SPECIAL_POLE_FNS = [
  'Gamma',
  'Digamma',
  'Trigamma',
  'PolyGamma',
  'Zeta',
  'Beta',
  'GammaLn',
];

const MAX_DEPTH = 14;

function limitDispatch(
  e: Expression,
  x: string,
  point: Expression,
  dir: number,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  if (depth > MAX_DEPTH) return undefined;
  // The symbolic recursion (leading-order rewrites, L'Hôpital differentiation of
  // exp/log towers, numeric growth probes) can grind for many minutes on hard
  // Gruntz-class limits. Bound it by the engine evaluation deadline: the throw
  // unwinds to the public boundary, which returns the inert `Limit` form.
  checkDeadline(ce._deadlineFrame);
  if (!e.has(x)) return e.evaluate();

  if (point.isInfinity === true) {
    // Map x → −∞ onto x → +∞ via the substitution x ↦ −x.
    let g = point.isNegative === true ? e.subs({ [x]: ce.symbol(x).neg() }) : e;
    // Combine cancellation-prone `ln`/`√` differences BEFORE any leading-order
    // or growth ranking: co-dominant pairs like `ln(x+1) − ln x` (~1/x) defeat
    // the asymptotic pass, which ranked them by their (cancelling) leading
    // terms and produced wrong finite limits — `x·(ln(x+1) − ln x)` → 0
    // instead of 1 (CORRECTNESS_FINDINGS P0-3). The combined forms
    // (`ln((x+1)/x)`, conjugate quotients) are handled exactly by the
    // existing strategies.
    g = combineCancellingPairs(g, x, ce);
    // The strategies at infinity read the SIGN of a term to choose between
    // `+∞` and `−∞`, which has no meaning for a complex value: `i·x` was
    // read as `+∞`, so `e^{ix}` gave `+∞` and `Erf(ix)` gave `1`. An
    // expression with a non-real constant is resolved through its real and
    // imaginary parts instead, or declined. This test comes before the
    // numeric stability test below, whose probes read a complex value as
    // `NaN`.
    if (hasNonRealConstant(g)) return complexLimitAtPosInf(g, x, ce, depth);
    // Bail *before* simplify (which can distribute and mangle the structure) if
    // any subexpression cancels catastrophically or overflows at the probes —
    // the symbolic pass can't rank such a form, so defer to the numeric limit.
    if (numericallyUnstable(g, x, ce, 0)) return undefined;
    // `simplify` is otherwise helpful at infinity (the leading-order rewrite
    // handles sums); at a finite point it can distribute a quotient into a sum
    // and defeat L'Hôpital, so the finite path keeps the structure instead.
    const r = limitAtPosInf(g.simplify(), x, ce, depth);
    if (r !== undefined) return r;
    // The strategies at infinity read the growth of the terms, and they do
    // not see a product such as `x·(e^{1/x} − 1)`, whose factors go to `+∞`
    // and to 0. The series of the function with `x = 1/u` at `u = 0` gives
    // its exact limit (1) when that series has no negative power.
    return constantTermAtInfinity(g, x, ce);
  }

  return limitAtFinite(e, x, point, dir, ce, depth);
}

// ──────────────────────────────────────────────────────────────────────────
// Finite point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Sign of `c_v·(x − a)^v` (the leading Laurent term) as `x → a` from `dir`
 * (+1 right, −1 left, 0 two-sided), or `undefined` when indeterminate:
 * a two-sided approach with odd `|v|` (the two sides disagree), or a
 * leading coefficient whose sign the engine cannot decide.
 */
function laurentSignNear(
  L: { v: number; coeff: (p: number) => Expression },
  dir: number
): 1 | -1 | undefined {
  const odd = Math.abs(L.v) % 2 === 1;
  if (dir === 0 && odd) return undefined;
  const c = L.coeff(L.v).evaluate();
  if (!c.isValid || c.isNaN === true) return undefined;
  let s: 1 | -1;
  if (c.isPositive === true) s = 1;
  else if (c.isNegative === true) s = -1;
  else return undefined;
  // From the left, x − a = −t (t > 0): odd powers flip the sign.
  if (dir === -1 && odd) s = s === 1 ? -1 : 1;
  return s;
}

/**
 * Signed-infinity resolution of a pole (negative-valuation Laurent
 * expansion) — the 2026-07-10 convention decision: a *directional* limit at
 * a pole resolves to `±∞` from the sign of the leading coefficient and the
 * parity of the valuation; a *two-sided* limit resolves only when both
 * sides agree (even valuation, `lim 1/x² = +∞`). An odd-valuation two-sided
 * limit (`lim 1/x` at 0) stays inert — the engine does not produce
 * `ComplexInfinity` limits.
 */
function signedPoleInfinity(
  L: { v: number; coeff: (p: number) => Expression },
  dir: number,
  ce: ComputeEngine
): Expression | undefined {
  if (L.v >= 0) return undefined;
  const s = laurentSignNear(L, dir);
  if (s === undefined) return undefined;
  return s > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
}

/**
 * Operator heads with JUMP discontinuities: piecewise-constant-like
 * functions whose value changes discontinuously as their argument crosses a
 * threshold. Direct substitution is unsound for a subterm of one of these
 * sitting ON its jump: the value AT the point is not the limit from either
 * side (`sgn(0) = 0`, but `lim_{x→0⁻} sgn x = −1`). The finite-point
 * strategies resolve such a subterm per DIRECTION instead — see
 * `substituteAtFinitePoint`. Kink-continuous heads (`Abs`) do not belong
 * here: their value at the point IS the two-sided limit.
 */
const JUMP_FNS = ['Sign', 'Heaviside', 'Floor', 'Ceil', 'Round', 'Mod'];

/**
 * Where `sub` (a `JUMP_FNS` application) stands relative to its jumps at
 * `x = a` — a TRI-STATE, because "not on a jump" and "cannot decide" must
 * not be conflated: the first authorizes direct substitution, the second
 * must decline the whole substitution (treating an undecidable case as
 * continuous is how a wrong value slips through — e.g. a negative-modulus
 * `Mod` sitting on a jump).
 *
 * - `'off'` — provably not on a jump: substitution at the point is sound;
 * - an OFFSET expression — ON a jump; the offset's sign as `x → a` selects
 *   the side of the jump;
 * - `'unknown'` — unclassifiable: a non-literal or non-real argument value,
 *   an arity this analysis does not model (`Round(u, precision)` jumps on
 *   a scaled lattice), a symbolic or zero modulus.
 *
 * The classification reads the argument's value as a NUMBER LITERAL only
 * (`isNumber` guard): an algebraically-zero-but-unreduced compound must
 * not be classified by a tolerance comparison, and `.re` of a complex
 * value would pass the integer tests while describing nothing. Integer
 * tests use `Number.isSafeInteger`: past 2^53 the double reading cannot
 * distinguish a value from its neighbors, so on/off is undecidable there
 * — `'unknown'`, never a guess.
 */
function jumpOffsetAt(
  sub: Expression,
  x: string,
  a: Expression,
  ce: ComputeEngine
): Expression | 'off' | 'unknown' {
  const u = o1(sub);
  if (u === undefined) return 'unknown';
  const at = u.subs({ [x]: a }).evaluate();
  if (!isNumber(at) || !at.isValid || at.isFinite !== true || at.isComplex)
    return 'unknown';
  const op = sub.operator;
  const arity = oo(sub).length;
  if (op === 'Sign' || op === 'Heaviside') {
    if (arity !== 1) return 'unknown';
    return at.is(0) ? u : 'off';
  }
  if (op === 'Floor' || op === 'Ceil') {
    if (arity !== 1) return 'unknown';
    if (!Number.isSafeInteger(at.re))
      return Math.abs(at.re) >= 2 ** 53 ? 'unknown' : 'off';
    return ce.function('Subtract', [u, ce.number(at.re)]);
  }
  if (op === 'Round') {
    if (arity !== 1) return 'unknown';
    if (Math.abs(at.re) >= 2 ** 52) return 'unknown';
    if (Number.isInteger(at.re) || !Number.isInteger(at.re * 2)) return 'off';
    return ce.function('Subtract', [
      u,
      ce.box(['Rational', Math.round(at.re * 2), 2]),
    ]);
  }
  if (op === 'Mod') {
    const m = o2(sub);
    if (m === undefined || m.has(x) || arity !== 2) return 'unknown';
    const mv = m.evaluate();
    if (
      !isNumber(mv) ||
      mv.isFinite !== true ||
      mv.isComplex ||
      mv.is(0) === true
    )
      return 'unknown';
    const ratio = at.div(mv).evaluate();
    if (!isNumber(ratio) || Math.abs(ratio.re) >= 2 ** 53) return 'unknown';
    if (!Number.isInteger(ratio.re)) return 'off';
    return ce.function('Subtract', [u, at]);
  }
  return 'unknown';
}

/**
 * Substitute `x = a` into `e` — SOUNDLY. Plain substitution answers the
 * value AT the point, which for an expression containing a `JUMP_FNS`
 * subterm ON its jump is not the limit from either side (`|x|/x` reaches
 * this via L'Hôpital as `sgn(x)/1`, and `sgn(0) = 0` where the one-sided
 * limits are ∓1). When such a subterm is present:
 *
 * - a DIRECTIONAL substitution (`dir = ±1`) replaces the subterm by its
 *   one-sided value — the side read from the sign of the offset's leading
 *   Laurent term (`laurentSignNear`) — and substitutes into the rewritten
 *   expression, iterating while jumps remain. Candidates are resolved
 *   INNERMOST-FIRST (smallest by node count): a jump nested inside another
 *   jump's argument must be replaced before the outer offset is readable
 *   at all.
 * - a TWO-SIDED substitution (`dir = 0`) answers `undefined`; the caller
 *   (`limitAtFinite`) resolves the two directions independently and
 *   combines them.
 *
 * ANY `'unknown'` classification declines the whole substitution rather
 * than answer from a partial rewrite, and an offset whose approach sign
 * cannot be decided does the same.
 */
function substituteAtFinitePoint(
  e: Expression,
  x: string,
  a: Expression,
  dir: number,
  ce: ComputeEngine
): Expression | undefined {
  // A substitution can land an operand outside a Contract B carrier — at
  // `x = 0`, `Ln(1/x²)` substitutes to `Ln(~oo)` (division by zero folds
  // to the unsigned pole), which is an incompatible-type Error since the
  // complex-extension carrier flips. An invalid substitute is NOT the
  // limit's answer: the LIMIT can still exist through the directed
  // strategies (the inner limit of `1/x²` is `+∞`, and `Ln(+∞) = +∞`),
  // so decline and let the caller fall through to them.
  //
  // A subterm whose value at the point is 0, although that value does not
  // fold to the number literal 0 (see `isUnfoldedZero`), is replaced by 0
  // before the substitution. Otherwise `1/(x³ + 1)` at x = 1/2 + (√3/2)i
  // substitutes to `1/(1 + (1/2 + (√3/2)i)³)`, which reads as a finite value
  // but is `1/0`, and `(x − a)/(x³ + 1)` substitutes to `0`, although it is
  // `0/0`. With the replacement they give `~∞` and `NaN`, which are not read
  // as a limit, and the caller uses L'Hôpital or the pole resolution.
  const substituteAndCheck = (expr: Expression): Expression | undefined => {
    const at = replaceExactZeros(expr, x, a, ce)
      .subs({ [x]: a })
      .evaluate();
    return at.isValid ? at : undefined;
  };
  let current = e;
  // Each pass resolves ONE on-jump subterm (innermost first); the rewrite
  // can nest, so iterate, capped well above any practical nesting.
  for (let pass = 0; pass < 8; pass++) {
    if (!current.has(JUMP_FNS)) return substituteAndCheck(current);
    let jump: Expression | undefined = undefined;
    let offset: Expression | undefined = undefined;
    let jumpSize = Infinity;
    for (const head of JUMP_FNS) {
      for (const sub of current.getSubexpressions(head)) {
        const off = jumpOffsetAt(sub, x, a, ce);
        if (off === 'unknown') return undefined;
        if (off === 'off') continue;
        const size = sub.getSubexpressions('').length;
        if (size < jumpSize) {
          jump = sub;
          offset = off;
          jumpSize = size;
        }
      }
    }
    if (jump === undefined) return substituteAndCheck(current);
    if (dir === 0) return undefined;
    // The expansion anchor must be EXACT when representable: a machine-float
    // point (`0.5` parsed from the limit) mixed with the exact subtrahend of
    // the offset leaves an unfoldable `−1/2 + 0.5` constant term in the
    // series (machine floats are excluded from canonical `Add` folding), a
    // broken datum whose sign read declines. Integers and half-integers —
    // the anchors this code's offsets create — exactify losslessly.
    let anchor = a;
    const ar = a.re;
    if (Number.isFinite(ar) && Number.isInteger(ar * 2))
      anchor = Number.isInteger(ar)
        ? ce.number(ar)
        : ce.box(['Rational', Math.round(ar * 2), 2]);
    const L = laurentData(offset!, x, anchor, ce, 3);
    if (!L) return undefined;
    const s = laurentSignNear(L, dir);
    if (s === undefined) return undefined;
    const value = jumpReplacementValue(jump, s, x, a, ce);
    if (value === undefined) return undefined;
    current = replaceSubterm(current, jump, value);
  }
  return undefined;
}

/**
 * `e` with each largest subterm that contains `x` and whose value at
 * `x = a` is an exact zero that does not fold to the number literal 0 (see
 * `isUnfoldedZero`) replaced by 0. `e` itself when there is no such
 * subterm.
 *
 * When the point is a rational number literal or a float and `e` holds no
 * constant other than rational number literals and no radical
 * (`hasNonRationalConstant`, `hasIrrationalAlgebraic`),
 * `e` is returned at once, without the walk (which evaluates each
 * subterm). There, the value of a polynomial or a rational function folds
 * to a number literal. With a radical, `i`, a constant symbol such as `π`,
 * or a function of constants such as `ln 2`, the walk is necessary:
 * `(x + 1)² − 3 − 2√2` does not fold at √2, and
 * `(1 + π + t)² − 1 − 2π − π²` does not fold at t = 0 (the limit at a point
 * that is a sum is taken at 0 after a shift), because `evaluate()` does not
 * expand a power of a sum.
 */
function replaceExactZeros(
  e: Expression,
  x: string,
  a: Expression,
  ce: ComputeEngine
): Expression {
  if (
    isNumber(a) &&
    (a.isRational === true || !a.isExact) &&
    !hasIrrationalAlgebraic(a) &&
    !hasIrrationalAlgebraic(e) &&
    !hasNonRationalConstant(e, x)
  )
    return e;
  return replaceExactZerosWalk(e, x, a, ce);
}

/**
 * Whether `e` holds a constant other than a rational number literal: an
 * exact number literal that is not rational, a constant symbol (`π`, `e`,
 * `i`), or a function of constants (`√2`, `ln 2`, `sin 1`). A float literal is not such a constant: a float operand makes
 * the value a float, and a float is not tested for an exact zero. The test
 * reads the structure only; it evaluates nothing.
 */
function hasNonRationalConstant(e: Expression, x: string): boolean {
  if (isNumber(e)) return e.isExact && e.isRational !== true;
  if (isSymbol(e)) return e.symbol !== x && e.isConstant === true;
  if (!isFunction(e)) return false;
  if (!e.has(x)) return e.unknowns.length === 0;
  return e.ops.some((op) => hasNonRationalConstant(op, x));
}

function replaceExactZerosWalk(
  e: Expression,
  x: string,
  a: Expression,
  ce: ComputeEngine
): Expression {
  if (!isFunction(e) || !e.has(x)) return e;
  if (isUnfoldedZero(e.subs({ [x]: a }).evaluate())) return ce.Zero;
  const ops = e.ops.map((op) => replaceExactZerosWalk(op, x, a, ce));
  if (ops.every((op, i) => op === e.ops[i])) return e;
  return ce.function(e.operator, ops);
}

/**
 * Whether `e` is an entire function of `x`: a polynomial in `x`, or a
 * function built from `x` and constants with `+`, `×`, powers with a
 * nonnegative integer exponent, `exp`, `sin`, `cos`, `sinh` and `cosh`.
 * Such a function is analytic at each point, so its Taylor coefficients at
 * a point are the values of its derivatives there, and the order of a zero
 * is the number of derivatives that are 0 at the point.
 */
export function isEntireIn(e: Expression, x: string): boolean {
  if (!e.has(x)) return true;
  if (isSymbol(e)) return true;
  if (!isFunction(e)) return false;
  const op = e.operator;
  if (op === 'Power') {
    if (isSymbol(e.op1) && e.op1.symbol === 'ExponentialE')
      return isEntireIn(e.op2, x);
    const k = e.op2;
    return (
      !k.has(x) &&
      isNumber(k) &&
      k.isInteger === true &&
      k.isNonNegative === true &&
      isEntireIn(e.op1, x)
    );
  }
  if (!ENTIRE_HEADS.has(op)) return false;
  return e.ops.every((arg) => isEntireIn(arg, x));
}

const ENTIRE_HEADS = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Exp',
  'Sin',
  'Cos',
  'Sinh',
  'Cosh',
]);

/**
 * The leading Laurent term of `n0 / den` at `x = a`, where `n0` is the
 * nonzero limit of the numerator and `den` is an entire function of `x`
 * (`isEntireIn`) that is 0 at the point. The order `k`
 * of the zero of `den` is the smallest `k` with a nonzero `den⁽ᵏ⁾(a)`, so
 * `n0 / den` is `n0 · k! / den⁽ᵏ⁾(a) · (x − a)⁻ᵏ + …`. This decides the pole
 * when the Laurent kernel declines the point: the kernel declines a point
 * that is a sum (`1 + √2`, `1/2 + (√3/2)i`), because `evaluate()` does not
 * fold the coefficients that are 0 there.
 *
 * Each derivative value must be decided exactly: a value that is 0 must be
 * the number 0 or an exact zero (`isUnfoldedZero`), and the first value
 * that is not 0 must be proved nonzero (`exactlyEqual()`) and be finite.
 * `undefined` otherwise, and when the order is greater than 8.
 */
function leadingPoleTerm(
  n0: Expression,
  den: Expression,
  x: string,
  a: Expression,
  ce: ComputeEngine
): { v: number; coeff: (p: number) => Expression } | undefined {
  let g = den;
  let factorial = 1;
  for (let k = 1; k <= 8; k++) {
    const dg = differentiate(g, x);
    if (dg === undefined) return undefined;
    g = dg;
    factorial *= k;
    const c = g.subs({ [x]: a }).evaluate();
    if (!c.isValid || c.isNaN === true || c.isInfinity === true)
      return undefined;
    if (c.isSame(0) || isUnfoldedZero(c)) continue;
    if (!isNumber(c) && exactlyEqual(c, ce.Zero) !== false) return undefined;
    const lead = ce
      .function('Divide', [
        ce.function('Multiply', [n0, ce.number(factorial)]),
        c,
      ])
      .evaluate();
    return { v: -k, coeff: () => lead };
  }
  return undefined;
}

/**
 * Whether the limit `r` of `body` has a jump at a value that its parameters
 * can take, so that `r` is not the limit for that value:
 *
 * - a `JUMP_FNS` application in `r` that did not evaluate (`Sign(a)`,
 *   `Floor(a)`): its argument can be on the jump;
 * - a quotient `|w|/w` or `w/|w|` in `r` (the sign of `w`), when `w` is not
 *   known to be nonzero from its sign or from an assumption such as `a ≠ 0`.
 *   `√(w²)` is read as `|w|` for a real `w`.
 *   `|x|/x` at `a` gives `|a|/a`, which is `1` or `−1` and has a jump at
 *   `a = 0`. A power of either factor (`|w|³/w³`) is the same quotient.
 *
 * A subexpression that is in `body` too, unchanged, is not a result of the
 * limit: the body `x + |a|/a` has the limit `|a|/a` at 0 for each `a`, and
 * that limit has no other answer.
 */
function limitResultHasJump(r: Expression, body: Expression): boolean {
  if (!isFunction(r)) return false;
  const inBody = (e: Expression): boolean =>
    body.getSubexpressions(e.operator).some((s) => s.isSame(e));
  for (const head of JUMP_FNS)
    for (const sub of r.getSubexpressions(head)) if (!inBody(sub)) return true;

  // The factors of a product, with integer powers read as their base.
  const factors = (e: Expression, into: Expression[]): void => {
    if (e.operator === 'Multiply') oo(e).forEach((f) => factors(f, into));
    else if (e.operator === 'Negate') factors(o1(e), into);
    else if (
      e.operator === 'Power' &&
      isNumber(o2(e)) &&
      o2(e).isInteger === true &&
      o2(e).isPositive === true
    )
      factors(o1(e), into);
    else into.push(e);
  };
  const quotients = [
    ...r.getSubexpressions('Divide'),
    ...r.getSubexpressions('Multiply'),
  ];
  if (isFunction(r, 'Divide') || isFunction(r, 'Multiply')) quotients.push(r);
  for (const q of quotients) {
    const num: Expression[] = [];
    const den: Expression[] = [];
    if (q.operator === 'Divide') {
      factors(o1(q), num);
      factors(o2(q), den);
    } else {
      for (const f of oo(q)) {
        const k = o2(f);
        if (f.operator === 'Power' && isNumber(k) && k.isNegative === true) {
          if (k.isInteger !== true) continue;
          factors(o1(f), den);
        } else factors(f, num);
      }
    }
    const isSign = (abs: Expression[], other: Expression[]): boolean =>
      abs.some((f) => {
        const w = absoluteValueArgument(f);
        if (w === undefined || inBody(f)) return false;
        if (isKnownNonZero(w)) return false;
        const minusW = w.neg();
        return other.some((g) => g.isSame(w) || g.isSame(minusW));
      });
    if (isSign(num, den) || isSign(den, num)) return true;
  }
  return false;
}

/** The `w` of `|w|`, or of `√(w²)`, which is `|w|` for a real `w`;
 * `undefined` for any other expression. */
function absoluteValueArgument(e: Expression): Expression | undefined {
  if (e.operator === 'Abs') return o1(e);
  if (e.operator === 'Sqrt' && o1(e).operator === 'Power') {
    const k = o2(o1(e));
    if (isNumber(k) && k.is(2) && o1(o1(e)).type.matches('real'))
      return o1(o1(e));
  }
  return undefined;
}

/** `e` is known not to be 0: by its sign, by its value, or by an assumption
 * such as `a ≠ 0`. */
function isKnownNonZero(e: Expression): boolean {
  return (
    e.isPositive === true || e.isNegative === true || e.isEqual(0) === false
  );
}

/**
 * The constant `sub` (a `JUMP_FNS` application ON its jump at `x = a`)
 * equals as `x → a` from the side where its offset has sign `s`. In each
 * case the function is constant on either side of the jump, so the
 * one-sided limit is the neighboring plateau's value. (The `.re` readings
 * are safe here: `jumpOffsetAt` already refused the magnitudes where a
 * double cannot represent the neighboring plateau exactly.)
 */
function jumpReplacementValue(
  sub: Expression,
  s: 1 | -1,
  x: string,
  a: Expression,
  ce: ComputeEngine
): Expression | undefined {
  const op = sub.operator;
  if (op === 'Sign') return ce.number(s);
  if (op === 'Heaviside') return s > 0 ? ce.One : ce.Zero;
  const u = o1(sub);
  if (u === undefined) return undefined;
  const at = u.subs({ [x]: a }).evaluate();
  const n = at.re;
  if (!Number.isFinite(n)) return undefined;
  if (op === 'Floor') return ce.number(s > 0 ? n : n - 1);
  if (op === 'Ceil') return ce.number(s > 0 ? n + 1 : n);
  if (op === 'Round') return ce.number(s > 0 ? n + 0.5 : n - 0.5);
  if (op === 'Mod') {
    // The engine's Mod takes the DIVISOR's sign (result in [0, m) for
    // m > 0, in (m, 0] for m < 0), so which plateau adjoins which side
    // depends on that sign: for m > 0 the value climbs to m from below a
    // multiple and restarts at 0 above it; for m < 0 it decays to m from
    // ABOVE and restarts at 0 below.
    const m = o2(sub)?.evaluate();
    if (m === undefined || !isNumber(m)) return undefined;
    if (m.re > 0) return s > 0 ? ce.Zero : m;
    return s > 0 ? m : ce.Zero;
  }
  return undefined;
}

/** `e` with every occurrence of `target` (by `isSame`) replaced. */
function replaceSubterm(
  e: Expression,
  target: Expression,
  replacement: Expression
): Expression {
  if (e.isSame(target)) return replacement;
  const ops = oo(e);
  if (ops.length === 0) return e;
  let changed = false;
  const next = ops.map((op) => {
    const r = replaceSubterm(op, target, replacement);
    if (r !== op) changed = true;
    return r;
  });
  return changed ? e.engine.function(e.operator, next) : e;
}

function limitAtFinite(
  e: Expression,
  x: string,
  a: Expression,
  dir: number,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  // 1. Direct substitution (continuous case) — through the jump-aware
  //    substitution, which resolves a `JUMP_FNS` subterm sitting on its
  //    jump per direction instead of reading its value AT the point
  //    (`sgn(0) = 0` is not a limit of `sgn`). Computed ONCE and shared
  //    with the two-sided combine below.
  const direct = substituteAtFinitePoint(e, x, a, dir, ce);
  if (direct !== undefined && isDefiniteValue(direct, x)) return direct;

  // 1a. A TWO-SIDED limit whose substitution declined and that contains a
  //     jump head: resolve each direction independently and combine —
  //     equal sides are the limit (`sgn(x)²` → 1), unequal or undecided
  //     sides fall THROUGH to the remaining strategies (an `'unknown'`
  //     jump classification declines substitution too, and the later
  //     steps may still resolve such a limit; `sgn(x)` and `|x|/x` end
  //     inert). The directional recursions carry `dir = ±1`, so they never
  //     re-enter this combine. Gated on the presence of a jump head — the
  //     `SPECIAL_POLE_FNS` idiom — so ordinary limits skip it.
  if (dir === 0 && direct === undefined && e.has(JUMP_FNS)) {
    const below = limitAtFinite(e, x, a, -1, ce, depth + 1);
    if (below !== undefined) {
      const above = limitAtFinite(e, x, a, 1, ce, depth + 1);
      if (above !== undefined && below.isSame(above)) return below;
    }
  }

  // 1b. Fallback: a simplified form may cancel a removable singularity
  //     ((x²−1)/(x−1) → x+1) — try substituting into it too.
  const es = e.simplify();
  if (!es.isSame(e)) {
    const direct2 = substituteAtFinitePoint(es, x, a, dir, ce);
    if (direct2 !== undefined && isDefiniteValue(direct2, x)) return direct2;
  }

  // 2. L'Hôpital for a quotient that is 0/0 or ∞/∞ (use the original structure,
  //    which preserves the quotient that `simplify` would distribute away).
  const ratio = asRatio(e, ce);
  if (ratio) {
    const r = limitOfQuotientAtFinite(
      ratio.num,
      ratio.den,
      x,
      a,
      dir,
      ce,
      depth
    );
    if (r !== undefined) return r;
  }

  // 2a. A product with a factor that tends to 0 and a factor that does not
  //     (`t·ln t` at 0⁺, where the substitution gives `0·(−∞)`): L'Hôpital
  //     on the quotient `(other factors) / (1 / zero factor)`, as
  //     `limitProductAtPosInf` does at infinity. The quotient is handed to
  //     the L'Hôpital step as two parts, not as a `Divide` node, which
  //     canonicalization would fold back into the product.
  // The limits of the parts of a sum, a product or a power, computed once
  // for steps 2a and 2b.
  const partLimits =
    e.operator === 'Multiply' || e.operator === 'Add' || e.operator === 'Power'
      ? oo(e).map((part) => limitDispatch(part, x, a, dir, ce, depth + 1))
      : [];
  if (e.operator === 'Multiply') {
    const zero: Expression[] = [];
    const rest: Expression[] = [];
    oo(e).forEach((f, i) => {
      const l = partLimits[i];
      if (l !== undefined && l.is(0)) zero.push(f);
      else rest.push(f);
    });
    if (zero.length > 0 && rest.length > 0) {
      const num = rest.length === 1 ? rest[0] : ce.function('Multiply', rest);
      const reciprocal = (f: Expression) =>
        ce.function('Power', [f, ce.number(-1)]);
      const den =
        zero.length === 1
          ? reciprocal(zero[0])
          : ce.function('Multiply', zero.map(reciprocal));
      const r = limitOfQuotientAtFinite(num, den, x, a, dir, ce, depth);
      if (r !== undefined) return r;
    }
  }

  // 2b. The arithmetic of the limits of the parts, when each part has a
  //     limit that is a definite value or a signed infinity: the terms of
  //     `t·ln t − t` at 0⁺ tend to 0 and 0 (the substitution gave
  //     `0·(−∞) − 0`), so the sum does; `2·ln t − 1` tends to `−∞`;
  //     `ln²t` to `+∞`. Indeterminate combinations (`∞ − ∞`, `0·∞`, which
  //     step 2a handles for a product) are left to the strategies below.
  const combined = combineLimitsOfParts(e, partLimits, x, ce);
  if (combined !== undefined) return combined;

  // 3. Pole resolution (7c follow-up; the 2026-07-10 convention decision —
  //    directional limits at poles resolve to ±∞, two-sided only when both
  //    sides agree).
  //
  // 3a. Logarithmic divergence: `ln`/`log` of an argument approaching 0⁺ is
  //     −∞, and of one blowing up to +∞ is +∞. The Laurent kernel declines
  //     `Ln` itself (logarithmic branch point), but the *argument*'s
  //     expansion decides the approach. An argument approaching 0⁻ or −∞
  //     leaves the real logarithm undefined — defer. (A two-sided
  //     `lim ln x` at 0 also stays inert: resolving it would be a
  //     domain-restricted-limit convention, not taken here; `ln(x²)`
  //     two-sided does resolve — the argument approaches 0⁺ from both
  //     sides.)
  const op = e.operator;
  if (op === 'Ln' || op === 'Log') {
    const eOps = oo(e);
    // Log(z, b): a constant base > 1 preserves the divergence direction.
    const baseOk =
      op === 'Ln' ||
      eOps.length < 2 ||
      (!eOps[1].has(x) && eOps[1].isGreater(1) === true);
    if (baseOk && eOps[0]) {
      const Li = laurentData(eOps[0], x, a, ce, 3);
      if (Li && laurentSignNear(Li, dir) === 1) {
        if (Li.v > 0) return ce.NegativeInfinity; // argument → 0⁺
        if (Li.v < 0) return ce.PositiveInfinity; // argument → +∞
      }
    }
    return undefined;
  }

  // 3b. Meromorphic pole: the leading Laurent term decides the signed
  //     infinity (elementary poles like 1/x² reach here after direct
  //     substitution and L'Hôpital decline; special-function poles are
  //     intercepted earlier by the soundness guard in `symbolicLimit`).
  const L = laurentData(e, x, a, ce, 3);
  if (L) return signedPoleInfinity(L, dir, ce);

  return undefined;
}

/**
 * The limit at the finite point `a` of a sum, a product or a power from the
 * limits of its parts, when those combine without an indeterminate form:
 *
 * - a sum: the sum of definite limits; a signed infinity when every
 *   infinite term has that sign (`2·ln t − 1 → −∞`); `undefined` for
 *   infinities of both signs;
 * - a product: the product of definite limits; a signed infinity when some
 *   factor is infinite and the product of the finite factors has a decided
 *   nonzero sign (`−ln t / 2 → +∞`); `undefined` when that product is 0 or
 *   of unknown sign;
 * - a power `u^k` with a REAL number `k`: for `u → ±∞`, `0` when `k < 0`,
 *   and an infinity when `k > 0` — of the sign `(±1)^k` for an integer `k`
 *   (`ln²t → +∞`; the parity is read exactly, not from a double), `+∞` for
 *   `u → +∞` otherwise; `undefined` for a non-integer `k` and `u → −∞`. A
 *   complex `k` gives no limit here: `|u^k|` grows but its phase turns.
 *
 * `partLimits` are the limits of the operands of `e`, in order. `undefined`
 * when a part has no limit, or when `e` is none of these.
 */
function combineLimitsOfParts(
  e: Expression,
  partLimits: ReadonlyArray<Expression | undefined>,
  x: string,
  ce: ComputeEngine
): Expression | undefined {
  const op = e.operator;
  if (op !== 'Add' && op !== 'Multiply' && op !== 'Power') return undefined;
  const limits: Expression[] = [];
  for (const l of partLimits) {
    if (l === undefined) return undefined;
    if (!isDefiniteValue(l, x) && l.isInfinity !== true) return undefined;
    limits.push(l);
  }
  const infinite = limits.filter((l) => l.isInfinity === true);
  const finite = limits.filter((l) => l.isInfinity !== true);
  if (infinite.some((l) => l.isPositive !== true && l.isNegative !== true))
    return undefined;

  if (op === 'Add') {
    if (infinite.length === 0) return ce.function('Add', finite).evaluate();
    const positive = infinite.every((l) => l.isPositive === true);
    const negative = infinite.every((l) => l.isNegative === true);
    if (positive) return ce.PositiveInfinity;
    if (negative) return ce.NegativeInfinity;
    return undefined;
  }

  if (op === 'Multiply') {
    const product =
      finite.length === 0 ? ce.One : ce.function('Multiply', finite).evaluate();
    if (infinite.length === 0) return product;
    let sign =
      product.isPositive === true ? 1 : product.isNegative === true ? -1 : 0;
    if (sign === 0) return undefined;
    for (const l of infinite) if (l.isNegative === true) sign = -sign;
    return sign > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
  }

  // Power
  const [u, k] = limits;
  // A constant real base `b > 0`, `b ≠ 1`, and an exponent that tends to a
  // signed infinity: `b^k` tends to `+∞` or to 0, from the side of 1 the base
  // is on (`e^{−1/t}` at 0⁺ is 0, at 0⁻ it is `+∞`). A base whose position
  // relative to 1 is not known gives no limit here.
  const base = o1(e);
  if (!base.has(x) && k.isInfinity === true) {
    if (base.isGreater(1) === true)
      return k.isPositive === true ? ce.PositiveInfinity : ce.Zero;
    if (base.isPositive === true && base.isLess(1) === true)
      return k.isPositive === true ? ce.Zero : ce.PositiveInfinity;
    return undefined;
  }
  const exponent = o2(e);
  if (
    !isNumber(exponent) ||
    exponent.has(x) ||
    !exponent.isNumberLiteral ||
    exponent.isComplex
  )
    return undefined;
  if (u.isInfinity !== true || k.isInfinity === true) return undefined;
  const kv = exponent.re;
  if (kv < 0) return ce.Zero;
  if (!(kv > 0)) return undefined;
  if (u.isPositive === true) return ce.PositiveInfinity;
  if (exponent.isEven === true) return ce.PositiveInfinity;
  if (exponent.isOdd === true) return ce.NegativeInfinity;
  return undefined;
}

/**
 * The limit of the quotient `num / den` at the finite point `a`: L'Hôpital
 * when the limits of the parts are `0/0` or `∞/∞` (differentiate both and
 * take the limit of the new quotient, through `limitAtFinite`, which can
 * apply the rule again); the quotient of the limits when both are definite
 * values and the denominator's is not 0. `undefined` otherwise.
 */
function limitOfQuotientAtFinite(
  num: Expression,
  den: Expression,
  x: string,
  a: Expression,
  dir: number,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  const n0 = limitDispatch(num, x, a, dir, ce, depth + 1);
  const d0 = limitDispatch(den, x, a, dir, ce, depth + 1);
  if (n0 && d0 && isIndeterminateRatio(n0, d0)) {
    const dn = differentiate(num, x);
    const dd = differentiate(den, x);
    if (dn && dd) {
      const next = ce.function('Divide', [dn, dd]);
      return limitAtFinite(next, x, a, dir, ce, depth + 1);
    }
  }
  // Determinate quotient: n0 / d0 when d0 ≠ 0 and both finite.
  if (n0 && d0 && !d0.is(0) && isDefiniteValue(n0, x) && isDefiniteValue(d0, x))
    return n0.div(d0).evaluate();
  // A nonzero numerator over a denominator that tends to 0 with a known sign
  // near the point: a signed infinity (`1/√t` at 0⁺ is `+∞`). The step 3b
  // pole resolution reads the sign of a Laurent expansion, and a root such as
  // `√t` has none (it is a Puiseux series), so it is decided here.
  if (n0 && d0 && d0.is(0) && isDefiniteValue(n0, x)) {
    const sn = n0.isPositive === true ? 1 : n0.isNegative === true ? -1 : 0;
    const sd = rootSignNear(den, x, a, dir, ce);
    if (sn !== 0 && sd !== undefined)
      return sn * sd > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
  }
  // A nonzero numerator over an entire denominator (`isEntireIn`) that is
  // exactly 0 at the point: a pole, whose order and leading coefficient come
  // from the derivatives of the denominator (`leadingPoleTerm`). It resolves
  // to a signed infinity under the same rule as the Laurent pole resolution
  // (`signedPoleInfinity`).
  if (
    n0 &&
    d0 &&
    d0.isSame(0) &&
    isDefiniteValue(n0, x) &&
    !n0.isSame(0) &&
    isEntireIn(den, x)
  ) {
    const L = leadingPoleTerm(n0, den, x, a, ce);
    if (L) {
      const inf = signedPoleInfinity(L, dir, ce);
      if (inf) return inf;
    }
  }
  return undefined;
}

/**
 * The sign, near the point `a` from `dir`, of a root or a positive power of
 * an argument `u` that tends to 0 from above: `√u`, `Root(u, n)` or `u^r`
 * with a real number `r > 0`. Each is a positive real number when `u` is, so
 * the sign is `1` when the Laurent expansion of `u` shows that `u` is
 * positive near the point. A product of such factors and of constants of
 * known sign (`(3/2)·√t`, which L'Hôpital gives for `t^{3/2}`) has the sign
 * of the product. `undefined` for any other expression, and when `u` can be
 * negative near the point (where the root is not real).
 */
function rootSignNear(
  e: Expression,
  x: string,
  a: Expression,
  dir: number,
  ce: ComputeEngine
): 1 | -1 | undefined {
  const op = e.operator;
  if (op === 'Multiply') {
    let sign: 1 | -1 = 1;
    let roots = 0;
    for (const f of oo(e)) {
      if (!f.has(x)) {
        if (f.isNegative === true) sign = sign === 1 ? -1 : 1;
        else if (f.isPositive !== true) return undefined;
        continue;
      }
      if (rootSignNear(f, x, a, dir, ce) !== 1 || f.operator === 'Multiply')
        return undefined;
      roots += 1;
    }
    return roots > 0 ? sign : undefined;
  }
  if (op === 'Power') {
    const r = o2(e);
    if (!isNumber(r) || r.isComplex || !(r.re > 0)) return undefined;
  } else if (op !== 'Sqrt' && op !== 'Root') return undefined;
  const L = laurentData(o1(e), x, a, ce, 3);
  if (L === null || L.v <= 0) return undefined;
  return laurentSignNear(L, dir) === 1 ? 1 : undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Infinite point (x → +∞)
// ──────────────────────────────────────────────────────────────────────────

function limitAtPosInf(
  e0: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  if (depth > MAX_DEPTH) return undefined;
  checkDeadline(ce._deadlineFrame);
  // Rewrite to leading asymptotic order (drop negligible additive terms), which
  // often collapses the expression to something a structural pass can finish.
  const e = forPositiveVariable(
    leadingOrder(e0, x, ce, depth).simplify(),
    x,
    ce
  );
  if (!e.has(x)) return e.evaluate();

  // Polynomial in x → signed infinity by leading coefficient.
  const deg = polynomialDegree(e, x);
  if (deg > 0) {
    const coeffs = getPolynomialCoefficients(e, x);
    const lead = coeffs?.[deg];
    // A leading coefficient with no decided sign (a symbol `a` with no
    // assumption) has no decided limit: `a·x` goes to `+∞`, to `−∞` or stays
    // at `0`, depending on `a`.
    if (lead?.isNegative === true) return ce.NegativeInfinity;
    if (lead?.isPositive === true) return ce.PositiveInfinity;
    if (lead) return undefined;
  }

  const op = e.operator;

  if (op === 'Negate') {
    const l = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (!l) return undefined;
    if (l.isInfinity === true)
      return l.isNegative === true ? ce.PositiveInfinity : ce.NegativeInfinity;
    if (isDefiniteValue(l)) return l.neg().evaluate();
    return undefined;
  }

  // `|u|` is continuous, and it goes to `+∞` when `u` goes to `+∞` or to
  // `−∞`. This rule is necessary for a radical: the leading order of
  // `√(x² + 1)` is `√(x²)`, which simplifies to `|x|`.
  if (op === 'Abs') {
    const l = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (!l) return undefined;
    if (l.isInfinity === true)
      return l.isPositive === true || l.isNegative === true
        ? ce.PositiveInfinity
        : undefined;
    if (isDefiniteValue(l)) return ce.function('Abs', [l]).evaluate();
    return undefined;
  }

  if (op === 'Add') {
    // After the leading-order rewrite the surviving terms are co-dominant
    // (e.g. 1/x + 1/x², both → 0); sum their individual limits.
    // The finite limits are added with an `Add` expression, not with the
    // `.add()` method: `.add()` changes a sum of exact numbers such as
    // `√3 + √5` to a float.
    const finite: Expression[] = [];
    let posInf = 0;
    let negInf = 0;
    for (const t of oo(e)) {
      const l = limitAtPosInf(t, x, ce, depth + 1);
      if (!l) return undefined;
      if (l.isInfinity === true) {
        if (l.isNegative === true) negInf++;
        else posInf++;
      } else if (isDefiniteValue(l)) finite.push(l);
      else return undefined;
    }
    if (posInf > 0 && negInf > 0) return undefined; // ∞ − ∞ (needs cancellation)
    if (posInf > 0) return ce.PositiveInfinity;
    if (negInf > 0) return ce.NegativeInfinity;
    if (finite.length === 0) return ce.Zero;
    return ce.function('Add', finite).evaluate();
  }

  if (op === 'Divide') return limitRatioAtPosInf(o1(e), o2(e), x, ce, depth);

  if (op === 'Power') return limitPowerAtPosInf(o1(e), o2(e), x, ce, depth);

  // √u and ⁿ√u (canonical forms of u^{1/2}, u^{1/n}): monotone for a real
  // radicand, so they carry the argument's limit. A radicand → −∞ heads to an
  // imaginary infinity — deferred (undefined) rather than resolved.
  // These rules are correct only for a degree that is a constant known to be
  // positive. Any other degree (`Root(x, x) = x^{1/x}`, which tends to 1, or
  // a degree with an unknown sign) goes to the rule for `u^{1/n}`.
  if (op === 'Root' && !(!o2(e).has(x) && o2(e).isPositive === true))
    return limitPowerAtPosInf(
      o1(e),
      ce.function('Divide', [ce.One, o2(e)]),
      x,
      ce,
      depth
    );
  if (op === 'Sqrt' || op === 'Root') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (!inner) return undefined;
    if (inner.isInfinity === true)
      return inner.isPositive === true ? ce.PositiveInfinity : undefined;
    if (isDefiniteValue(inner)) {
      const rest = op === 'Root' ? [inner, o2(e)] : [inner];
      return ce.function(op, rest).evaluate();
    }
    return undefined;
  }

  if (op === 'Exp') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    return expOfLimit(inner, ce);
  }

  if (op === 'Ln' || op === 'Log') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    return lnOfLimit(inner, ce);
  }

  if (op === 'Multiply') return limitProductAtPosInf(oo(e), x, ce, depth);

  if (op === 'Arctan') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (inner?.isInfinity === true)
      return inner.isNegative === true ? ce.Pi.div(-2) : ce.Pi.div(2);
    if (inner && isDefiniteValue(inner))
      return ce.function('Arctan', [inner]).evaluate();
    return undefined;
  }

  if (op === 'Sin' || op === 'Cos' || op === 'Tan') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (inner && isDefiniteValue(inner))
      return ce.function(op, [inner]).evaluate();
    return undefined; // oscillatory
  }

  if (op === 'Tanh') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (inner?.isInfinity === true)
      return inner.isNegative === true ? ce.number(-1) : ce.One;
    if (inner && isDefiniteValue(inner))
      return ce.function('Tanh', [inner]).evaluate();
    return undefined;
  }

  // Gamma grows without bound at `+∞`. At `−∞` it has no limit (a pole at
  // each negative integer).
  if (op === 'Gamma' && oo(e).length === 1) {
    if (!isRealValuedAtProbe(o1(e), x, ce)) return undefined;
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (inner?.isInfinity === true && inner.isPositive === true)
      return ce.PositiveInfinity;
    return undefined;
  }

  // Erf saturates: Erf(+∞) = 1, Erf(−∞) = −1. Erfc = 1 − Erf: Erfc(+∞) = 0,
  // Erfc(−∞) = 2. (The argument's own limit decides which end applies.)
  if (op === 'Erf' || op === 'Erfc') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (!inner) return undefined;
    if (inner.isInfinity === true) {
      // Only a *signed* real infinity saturates. A directionless infinity
      // (e.g. ComplexInfinity) has neither `isPositive` nor `isNegative` set —
      // stay symbolic rather than defaulting to the +∞ branch (mirrors the
      // Sqrt/Root guard above).
      if (inner.isPositive === true) return op === 'Erf' ? ce.One : ce.Zero;
      if (inner.isNegative === true)
        return op === 'Erf' ? ce.number(-1) : ce.number(2);
      return undefined;
    }
    if (isDefiniteValue(inner)) return ce.function(op, [inner]).evaluate();
    return undefined;
  }

  return undefined;
}

function limitRatioAtPosInf(
  num: Expression,
  den: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  checkDeadline(ce._deadlineFrame);
  // Bail on a numerator/denominator that suffers catastrophic cancellation or
  // overflow at the probe points (e.g. e^stuff − eˣ, whose huge terms cancel to
  // a far smaller value): neither the asymptotic nor the numeric pass can rank
  // it reliably, so defer to the numeric limit (which has its own guard).
  if (hasCancellation(num, x, ce) || hasCancellation(den, x, ce))
    return undefined;

  const n = forPositiveVariable(
    leadingOrder(num, x, ce, depth).simplify(),
    x,
    ce
  );
  const d = forPositiveVariable(
    leadingOrder(den, x, ce, depth).simplify(),
    x,
    ce
  );

  // Compare growth *first*. (Simplifying the quotient first can re-expand it
  // back into the original product and loop — e.g. x/(1/ln(1+a/x)).)
  const cmp = compareGrowth(n, d, x, ce);
  if (cmp !== undefined) {
    if (cmp < 0) return ce.Zero; // numerator grows slower → 0
    if (cmp > 0) {
      // The sign of each term is read from numeric probes at three growing
      // points. When the probes give no sign (a symbolic coefficient, as in
      // `x/e^{q·x}`, or a value that underflows to 0, as `e^{x − x²}` does),
      // use the sign that the engine can prove (`e^g` is always positive).
      // If the sign is still not known (`a·eˣ/x` with `a` unknown, or
      // `√x − 50`, which is negative at 120 and positive at 10⁴), the sign
      // of the infinity is undecided: decline.
      const sn = stableSignAtInf(n, x, ce) || provenSignAtInf(n, x, ce);
      const sd = stableSignAtInf(d, x, ce) || provenSignAtInf(d, x, ce);
      if (sn === 0 || sd === 0) return undefined;
      return sn !== sd ? ce.NegativeInfinity : ce.PositiveInfinity;
    }
    // Same growth order → ratio of leading coefficients.
    const r = n.div(d).simplify();
    if (!r.has(x)) return r.evaluate();
    // The numeric growth comparison does not see a very small power:
    // `x^(1 + 10^-30)` and `x` have almost the same value at each probe
    // point, so they were taken to grow at the same rate, and the numeric
    // ratio gave 1. When the exact quotient is `k·x^c` with constants `k`
    // and `c`, the signs of `k` and `c` give the limit.
    const [k, p] =
      r.operator === 'Multiply' && oo(r).length === 2 && !o1(r).has(x)
        ? [o1(r), o2(r)]
        : [ce.One, r];
    const base = o1(p);
    if (
      p.operator === 'Power' &&
      isSymbol(base) &&
      base.symbol === x &&
      !o2(p).has(x)
    ) {
      const c = o2(p);
      if (c.isNegative === true) return ce.Zero;
      if (c.isPositive === true) {
        if (k.isPositive === true) return ce.PositiveInfinity;
        if (k.isNegative === true) return ce.NegativeInfinity;
      }
    }
    // Same growth order but no ratio of leading coefficients (`ln(3x)` and
    // `ln(x^π)`: both are logarithmic, and neither is a monomial): L'Hôpital
    // below (CE-147). L'Hôpital applies only to an indeterminate form, so
    // both parts must be shown to tend to infinity (or both to 0). A part
    // that oscillates, as in `(2 + sin x)/(3 + sin x)`, has a leading order
    // of the same growth as the other part but no limit: decline.
    const lc = leadingCoefficientRatio(n, d, x, ce);
    if (lc !== undefined) return lc;
    const ln_ = limitAtPosInf(num, x, ce, depth + 1);
    const ld = limitAtPosInf(den, x, ce, depth + 1);
    const bothInfinite = ln_?.isInfinity === true && ld?.isInfinity === true;
    const bothZero = ln_?.is(0) === true && ld?.is(0) === true;
    if (!bothInfinite && !bothZero) return undefined;
  }

  // Growth comparison inconclusive: a genuine 0/0 or ∞/∞ that the asymptotic
  // pass couldn't rank → L'Hôpital (differentiate top and bottom, recurse).
  if (depth < MAX_DEPTH) {
    const dn = differentiate(n, x);
    const dd = differentiate(d, x);
    if (dn && dd && !dd.is(0)) {
      const lh = limitRatioAtPosInf(dn, dd, x, ce, depth + 1);
      if (lh) return lh;
    }
  }
  return undefined;
}

function limitPowerAtPosInf(
  base: Expression,
  expo: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  const baseHasX = base.has(x);
  const expoHasX = expo.has(x);

  // Constant exponent: bⁿ.
  if (!expoHasX) {
    const b = limitAtPosInf(base, x, ce, depth + 1);
    if (!b) return undefined;
    if (b.isInfinity === true) {
      if (expo.isNegative === true) return ce.Zero;
      if (expo.isPositive !== true) return undefined;
      if (b.isPositive === true) return ce.PositiveInfinity;
      // A base that goes to `−∞`: an integer exponent gives a signed
      // infinity by its parity. Any other exponent gives a complex value
      // (`(−x)^{3/2} = −i·x^{3/2}`), which has no signed limit.
      // `isInteger` is read first: the exact `2 + 10^-30` has the double
      // value 2, but it is not an integer.
      if (
        b.isNegative === true &&
        isNumber(expo) &&
        expo.im === 0 &&
        expo.isInteger === true
      ) {
        const n = expo.re;
        if (Number.isSafeInteger(n))
          return n % 2 === 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
      }
      return undefined;
    }
    if (isDefiniteValue(b)) return ce.function('Power', [b, expo]).evaluate();
    return undefined;
  }

  // Constant base: cˣ.
  if (!baseHasX) {
    if (base.isGreater?.(ce.One) === true) {
      // > 1: cˣ → ±∞ depending on the exponent's limit
      const el = limitAtPosInf(expo, x, ce, depth + 1);
      if (el?.isInfinity === true)
        return el.isNegative === true ? ce.Zero : ce.PositiveInfinity;
    }
  }

  // General fᵍ → exp(g · ln f), provided the base is eventually positive.
  if (
    base.isNonNegative === true ||
    base.isPositive === true ||
    baseEventuallyPositive(base, x, ce)
  ) {
    const g = expo.mul(ce.function('Ln', [base]));
    const inner = limitAtPosInf(g, x, ce, depth + 1);
    const r = expOfLimit(inner, ce);
    if (r) return r;
  }
  return undefined;
}

function limitProductAtPosInf(
  factors: ReadonlyArray<Expression>,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  // Move every decaying factor (→ 0) into a denominator as its reciprocal, then
  // evaluate the resulting quotient — this resolves the 0·∞ race directly
  // (x·e^{−x} → x/eˣ → 0) via the growth comparison in `limitRatioAtPosInf`.
  const numer: Expression[] = [];
  const denom: Expression[] = [];
  for (const f of factors) {
    const l = limitAtPosInf(f, x, ce, depth + 1);
    if (l && l.is(0)) denom.push(ce.function('Power', [f, ce.number(-1)]));
    else numer.push(f);
  }
  if (denom.length > 0) {
    const num =
      numer.length === 0
        ? ce.One
        : numer.length === 1
          ? numer[0]
          : ce.function('Multiply', numer);
    const den = denom.length === 1 ? denom[0] : ce.function('Multiply', denom);
    return limitRatioAtPosInf(num, den, x, ce, depth + 1);
  }

  // No decaying factors: a straightforward product of the factor limits.
  let result: Expression = ce.One;
  let infinities = 0;
  let infinitySign = 1;
  for (const f of factors) {
    const l = limitAtPosInf(f, x, ce, depth + 1);
    if (!l) return undefined;
    if (l.isInfinity === true) {
      infinities++;
      if (l.isNegative === true) infinitySign = -infinitySign;
    } else if (isDefiniteValue(l)) {
      result = result.mul(l);
    } else return undefined;
  }
  if (infinities > 0) {
    // The finite part must have a decided, non-zero sign: an unknown factor
    // can turn the infinity, and `0·∞` has no value.
    if (result.isNegative !== true && result.isPositive !== true)
      return undefined;
    const s = (result.isNegative === true ? -1 : 1) * infinitySign;
    return s < 0 ? ce.NegativeInfinity : ce.PositiveInfinity;
  }
  return result.evaluate();
}

// ──────────────────────────────────────────────────────────────────────────
// Complex-valued expressions at an infinite point
// ──────────────────────────────────────────────────────────────────────────

/**
 * True when `e` contains a number literal with a non-zero imaginary part, or
 * the symbol `ImaginaryUnit`. Such an expression can take complex values for
 * a real argument, so the sign-based strategies do not apply to it.
 */
export function hasNonRealConstant(e: Expression): boolean {
  if (isNumber(e)) return e.im !== 0;
  if (isSymbol(e, 'ImaginaryUnit')) return true;
  return oo(e).some((op) => hasNonRealConstant(op));
}

/**
 * True when `e` has a real numeric value at two large values of `x`. The
 * rules for `Gamma` need a real operand, and an expression with no non-real
 * constant can still take complex values: `(−x)^{3/2}` is `−i·x^{3/2}`. A
 * complex or missing value at a probe reads as `NaN` (see `numericAt`).
 */
function isRealValuedAtProbe(
  e: Expression,
  x: string,
  ce: ComputeEngine
): boolean {
  return [60, 120].every((xv) => !Number.isNaN(numericAt(e, x, xv, ce)));
}

/**
 * Limit as `x → +∞` of an expression that contains a non-real constant.
 *
 * The limit variable is real. The limit exists when the real part and the
 * imaginary part both have a finite limit, and it is then `re + i·im`. A
 * limit that is not finite is declined (`undefined`): the engine has no
 * directed complex infinity, and a limit never answers `ComplexInfinity`.
 */
function complexLimitAtPosInf(
  e: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  if (depth > MAX_DEPTH) return undefined;
  checkDeadline(ce._deadlineFrame);
  if (!e.has(x)) return e.evaluate();

  const finite = (l: Expression | undefined): l is Expression =>
    l !== undefined && isDefiniteValue(l, x) && l.isFinite !== false;

  // The limit of a part that has no non-real constant, by the real
  // strategies. The numeric stability test of `limitDispatch` applies to
  // each part: a part whose terms cancel catastrophically at the probes is
  // declined, because the leading-order rewrite gives a wrong finite value
  // for it.
  const realLimit = (part: Expression): Expression | undefined =>
    numericallyUnstable(part, x, ce, 0)
      ? undefined
      : limitAtPosInf(part.simplify(), x, ce, depth + 1);

  if (!hasNonRealConstant(e)) {
    const l = realLimit(e);
    return finite(l) ? l : undefined;
  }

  // `Gamma(σ + i·y)` goes to 0 when `y → ±∞` with `σ` fixed: its modulus is
  // asymptotic to `√(2π)·|y|^(σ − 1/2)·e^(−π|y|/2)` (DLMF 5.11.9).
  if (e.operator === 'Gamma' && oo(e).length === 1) {
    const parts = realAndImaginaryParts(o1(e), x, ce, 0);
    if (parts && !parts[0].has(x) && isRealValuedAtProbe(parts[1], x, ce)) {
      const im = realLimit(parts[1]);
      if (im?.isInfinity === true) return ce.Zero;
    }
    return undefined;
  }

  // These heads are continuous: they carry a finite limit of their operand.
  if (
    (e.operator === 'Abs' ||
      e.operator === 'Real' ||
      e.operator === 'Imaginary' ||
      e.operator === 'Conjugate') &&
    oo(e).length === 1
  ) {
    const inner = complexLimitAtPosInf(o1(e), x, ce, depth + 1);
    return finite(inner)
      ? ce.function(e.operator, [inner]).evaluate()
      : undefined;
  }

  // A sum or a product of terms that each have a finite limit.
  if (e.operator === 'Add' || e.operator === 'Multiply') {
    const limits = oo(e).map((t) => complexLimitAtPosInf(t, x, ce, depth + 1));
    if (limits.every(finite)) return ce.function(e.operator, limits).evaluate();
  }

  const parts = realAndImaginaryParts(e, x, ce, 0);
  if (!parts) return undefined;
  const re = realLimit(parts[0]);
  if (!finite(re)) return undefined;
  const im = realLimit(parts[1]);
  if (!finite(im)) return undefined;
  return ce
    .function('Add', [re, ce.function('Multiply', [ce.I, im])])
    .evaluate();
}

/**
 * The real part and the imaginary part of `e`, as two expressions with no
 * non-real constant, for a real limit variable `x`. A subexpression with no
 * non-real constant is taken as real-valued, which is the assumption of all
 * the strategies at infinity. `undefined` when `e` has an operator that this
 * function cannot separate (only sums, products, quotients, integer powers
 * and the exponential are separated).
 */
function realAndImaginaryParts(
  e: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): [re: Expression, im: Expression] | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (!hasNonRealConstant(e)) return [e, ce.Zero];
  if (!e.has(x)) {
    const re = ce.function('Real', [e]).evaluate();
    const im = ce.function('Imaginary', [e]).evaluate();
    if (hasNonRealConstant(re) || hasNonRealConstant(im)) return undefined;
    return [re, im];
  }

  type Parts = [Expression, Expression];
  const fn = (name: string, ops: Expression[]): Expression =>
    ce.function(name, ops);
  // A product with the literal `0` is written `0`: the canonical form keeps
  // `0·x` (the value of `x` could be infinite), and the part would then
  // depend on the limit variable when it does not.
  const times = (a: Expression, b: Expression): Expression =>
    a.isSame(0) || b.isSame(0) ? ce.Zero : fn('Multiply', [a, b]);
  const mul = ([a, b]: Parts, [c, d]: Parts): Parts => [
    fn('Subtract', [times(a, c), times(b, d)]),
    fn('Add', [times(a, d), times(b, c)]),
  ];
  const div = ([a, b]: Parts, [c, d]: Parts): Parts => {
    // (a + ib)/(c + id) = ((ac + bd) + i(bc − ad)) / (c² + d²)
    const den = fn('Add', [times(c, c), times(d, d)]);
    return [
      fn('Divide', [fn('Add', [times(a, c), times(b, d)]), den]),
      fn('Divide', [fn('Subtract', [times(b, c), times(a, d)]), den]),
    ];
  };
  const partsOf = (op: Expression): Parts | undefined =>
    realAndImaginaryParts(op, x, ce, depth + 1);

  const op = e.operator;
  if (op === 'Negate') {
    const p = partsOf(o1(e));
    return p && [fn('Negate', [p[0]]), fn('Negate', [p[1]])];
  }
  if (op === 'Add' || op === 'Multiply') {
    const all: Parts[] = [];
    for (const t of oo(e)) {
      const p = partsOf(t);
      if (!p) return undefined;
      all.push(p);
    }
    if (op === 'Add')
      return [
        fn(
          'Add',
          all.map((p) => p[0])
        ),
        fn(
          'Add',
          all.map((p) => p[1])
        ),
      ];
    return all.reduce(mul);
  }
  if (op === 'Divide') {
    const n = partsOf(o1(e));
    const d = partsOf(o2(e));
    return n && d && div(n, d);
  }
  if (op === 'Exp' || (op === 'Power' && isSymbol(o1(e), 'ExponentialE'))) {
    // e^(a + ib) = e^a·cos b + i·e^a·sin b
    const p = partsOf(op === 'Exp' ? o1(e) : o2(e));
    if (!p) return undefined;
    const modulus = fn('Exp', [p[0]]);
    return [
      times(modulus, fn('Cos', [p[1]])),
      times(modulus, fn('Sin', [p[1]])),
    ];
  }
  if (op === 'Power') {
    const n = o2(e);
    if (!isNumber(n) || !Number.isInteger(n.re) || n.im !== 0) return undefined;
    const k = Math.abs(n.re);
    if (k === 0 || k > 8) return undefined;
    const base = partsOf(o1(e));
    if (!base) return undefined;
    let result = base;
    for (let i = 1; i < k; i++) result = mul(result, base);
    return n.re < 0 ? div([ce.One, ce.Zero], result) : result;
  }
  return undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Leading-order rewrite + growth ordering (Gruntz-lite)
// ──────────────────────────────────────────────────────────────────────────

/** Replace every sum in `e` with its asymptotically-dominant term(s). */
function leadingOrder(
  e: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression {
  if (depth > MAX_DEPTH || !e.has(x)) return e;
  checkDeadline(ce._deadlineFrame);
  const op = e.operator;

  if (op === 'Add') {
    const terms = oo(e).map((t) => leadingOrder(t, x, ce, depth + 1));
    const dom = dominantTerms(terms, x, ce);
    // Only drop dominated terms when the dominant one is *unbounded*. If the sum
    // tends to a finite constant (1 + 1/x → 1), the vanishing terms are
    // essential to any function applied to it — ln(1+1/x) ~ 1/x, not ln(1) = 0.
    if (
      dom.length < terms.length &&
      dom.some((t) => tendsToInfinity(t, x, ce) === true)
    )
      return dom.length === 1 ? dom[0] : ce.function('Add', dom);
    return terms.length === 1 ? terms[0] : ce.function('Add', terms);
  }

  // Rewrite INSIDE an argument only under a head that is insensitive to a
  // dominated additive term there: for these heads `f(x + o(x))` has the same
  // leading order as `f(x)` (`ln(x+1) ~ ln x`, `(x+1)² ~ x²`, `√(x+1) ~ √x`).
  // Every other head keeps its argument intact. Under an exponential-class
  // head the dropped term changes the VALUE, not just a lower order:
  // `Fibonacci(n+1)/Fibonacci(n)` → φ, `Γ(x+1)/(x·Γ(x))` → 1, `(1+1/x)^x`
  // → e; rewriting `n+1` to `n` inside those made each ratio collapse to 1
  // (or `x^x/x^x`) — a wrong finite answer. An unknown function `f(n+1)` is
  // in the same class: nothing is known about how fast it varies.
  if (op === 'Power') {
    const expo = o2(e);
    if (expo.has(x)) return e;
    return ce.function('Power', [leadingOrder(o1(e), x, ce, depth + 1), expo]);
  }
  if (LEADING_ORDER_TRANSPARENT_HEADS.has(op) && oo(e) && oo(e).length > 0) {
    const newOps = oo(e).map((o) => leadingOrder(o, x, ce, depth + 1));
    return ce.function(op, newOps);
  }
  return e;
}

/** Heads whose argument may be replaced by its leading order — see
 * `leadingOrder`. `Add` and `Power` are handled inline there. */
const LEADING_ORDER_TRANSPARENT_HEADS = new Set([
  'Multiply',
  'Divide',
  'Negate',
  'Ln',
  'Log',
  'Sqrt',
  'Root',
  'Abs',
]);

/** From a list of terms, return those of maximal growth as x → +∞ (ties kept). */
function dominantTerms(
  terms: ReadonlyArray<Expression>,
  x: string,
  ce: ComputeEngine
): Expression[] {
  if (terms.length <= 1) return [...terms];
  let best = [terms[0]];
  for (let i = 1; i < terms.length; i++) {
    const c = compareGrowth(terms[i], best[0], x, ce);
    if (c === undefined) return [...terms]; // can't order → keep everything (safe)
    if (c > 0) best = [terms[i]];
    else if (c === 0) best.push(terms[i]);
  }
  return best;
}

/**
 * Compare the growth of `a` and `b` as x → +∞.
 * Returns 1 (a faster), −1 (a slower), 0 (same order), or undefined (unknown).
 *
 * Uses a coarse *symbolic* growth level (bounded < log < poly < exp < …) to
 * settle cross-class comparisons — moderate-x numeric probing cannot see, for
 * instance, that eˣ overtakes x¹⁰⁰ (their crossover is near x ≈ 700) and would
 * wrongly rank x¹⁰⁰ higher. Within the same level (3ˣ vs 5ˣ, x² vs x³) numeric
 * probing is reliable, so it decides those.
 */
function compareGrowth(
  a: Expression,
  b: Expression,
  x: string,
  ce: ComputeEngine
): number | undefined {
  const la = growthLevel(a, x, ce, 0);
  const lb = growthLevel(b, x, ce, 0);
  if (la !== undefined && lb !== undefined && la !== lb)
    return la < lb ? -1 : 1;
  return numericGrowthCompare(a, b, x, ce);
}

/**
 * Coarse order-of-growth level of `e` as x → +∞:
 * 0 bounded/decaying · 1 logarithmic · 2 polynomial · 3 exponential ·
 * 4+ iterated exponential. `undefined` when the form can't be classified
 * symbolically (the caller then falls back to numeric probing).
 */
function growthLevel(
  e: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): number | undefined {
  if (depth > MAX_DEPTH) return undefined;
  checkDeadline(ce._deadlineFrame);
  if (!e.has(x)) return 0;
  const op = e.operator;

  if (
    op === 'Sin' ||
    op === 'Cos' ||
    op === 'Arctan' ||
    op === 'Arccot' ||
    op === 'Tanh'
  )
    return 0;

  const deg = polynomialDegree(e, x);
  if (deg > 0) return 2;
  if (deg === 0) return 0;

  if (op === 'Negate' || op === 'Abs')
    return growthLevel(o1(e), x, ce, depth + 1);

  // A root keeps the growth class of its radicand: `√x` is polynomial,
  // `√(eˣ) = e^{x/2}` is exponential, `√(ln x)` is logarithmic. Without this
  // level, `√x − 50` was ranked by numeric probes at small `x`, where the
  // constant dominates, and `(√x − 50)/ln x` gave `0` instead of `+∞`.
  // This is true only for a degree that is a constant known to be positive
  // (`Sqrt` has degree 2). A constant negative degree gives a root that
  // decays (level 0). Any other degree has no level here: `Root(x, x)` is
  // `x^{1/x}`, which tends to 1, and is not polynomial.
  if (op === 'Sqrt') return growthLevel(o1(e), x, ce, depth + 1);
  if (op === 'Root') {
    const n = o2(e);
    if (n.has(x)) return undefined;
    if (n.isPositive === true) return growthLevel(o1(e), x, ce, depth + 1);
    if (n.isNegative === true) return 0;
    return undefined;
  }

  if (op === 'Ln' || op === 'Log') {
    const gl = growthLevel(o1(e), x, ce, depth + 1);
    if (gl === undefined || gl <= 0) return undefined;
    return gl <= 2 ? 1 : gl - 1; // ln(poly)→log; ln(expᴸ)→L−1
  }

  // `e^g` and `b^g` (constant `b > 1`) grow only when `g → +∞`. When `g` is
  // bounded or negative they are bounded (level 0). When it is not known
  // whether `g` grows, or with which sign (`e^{a·x}` with `a` unknown, or
  // `e^{√x}`, which `tendsToInfinity` does not classify), the level is not
  // known: reading it as 0 ranked `e^{√x}` below `x`, and `x/e^{√x}` gave
  // `+∞` instead of `0`.
  if (op === 'Exp') {
    const t = exponentialTendsToInfinity(o1(e), x, ce);
    if (t !== true) return t === false ? 0 : undefined;
    const gl = growthLevel(o1(e), x, ce, depth + 1);
    return gl === undefined ? undefined : Math.max(3, gl + 1);
  }

  if (op === 'Power') {
    const base = o1(e);
    const expo = o2(e);
    if (!base.has(x) && expo.has(x)) {
      if (base.isGreater?.(ce.One) === true) {
        const t = exponentialTendsToInfinity(expo, x, ce);
        if (t !== true) return t === false ? 0 : undefined;
        const gl = growthLevel(expo, x, ce, depth + 1);
        return gl === undefined ? undefined : Math.max(3, gl + 1);
      }
      if (base.isPositive === true && base.isLess?.(ce.One) === true) return 0;
      return undefined;
    }
    if (base.has(x) && !expo.has(x)) {
      if (expo.isNegative === true) return 0; // base^(−k) → 0
      return growthLevel(base, x, ce, depth + 1); // (ln x)^k→1, (eˣ)^k→3
    }
    return undefined;
  }

  if (op === 'Multiply') {
    // Dominated by the fastest-growing factor — but a decaying factor (→0) can
    // pull the product down, so bail to numeric if one is present.
    let lvl = 0;
    for (const f of oo(e)) {
      const g = growthLevel(f, x, ce, depth + 1);
      if (g === undefined) return undefined;
      if (g === 0 && f.has(x)) return undefined; // possibly decaying
      lvl = Math.max(lvl, g);
    }
    return lvl;
  }

  if (op === 'Add') {
    const levels: number[] = [];
    for (const t of oo(e)) {
      const g = growthLevel(t, x, ce, depth + 1);
      if (g === undefined) return undefined;
      levels.push(g);
    }
    const maxL = Math.max(...levels);
    // Two or more terms at the top level may cancel (e^stuff − eˣ → −e²x), so
    // the net growth is indeterminate — defer to numeric rather than claiming a
    // (possibly spurious) exponential order.
    if (levels.filter((l) => l === maxL).length > 1) return undefined;
    return maxL;
  }

  return undefined; // Divide and anything else → numeric
}

/** Does |e| → ∞ as x → +∞?  true / false / undefined (unknown). */
function tendsToInfinity(
  e: Expression,
  x: string,
  ce: ComputeEngine
): boolean | undefined {
  if (!e.has(x)) return false;
  const op = e.operator;

  // Bounded functions, regardless of argument.
  if (
    op === 'Sin' ||
    op === 'Cos' ||
    op === 'Arctan' ||
    op === 'Arccot' ||
    op === 'Tanh'
  )
    return false;

  const deg = polynomialDegree(e, x);
  if (deg > 0) return true;
  if (deg === 0) return false;

  if (op === 'Exp') return exponentialTendsToInfinity(o1(e), x, ce);
  if (op === 'Ln' || op === 'Log') return tendsToInfinity(o1(e), x, ce);

  if (op === 'Power') {
    const base = o1(e);
    const expo = o2(e);
    if (!expo.has(x)) {
      const bi = tendsToInfinity(base, x, ce);
      if (expo.isPositive === true) return bi;
      if (expo.isNegative === true) return false;
    }
    if (!base.has(x)) {
      if (base.isGreater?.(ce.One) === true)
        return exponentialTendsToInfinity(expo, x, ce);
      if (base.isPositive === true && base.isLess?.(ce.One) === true)
        return false;
    }
    // fᵍ via numeric fallback
    return numericTendsToInfinity(e, x, ce);
  }

  if (op === 'Add') {
    // → ∞ if at least one term → ∞ and the dominant term(s) don't cancel.
    const dom = dominantTerms(oo(e), x, ce);
    const domInf = dom.map((t) => tendsToInfinity(t, x, ce));
    if (domInf.some((t) => t === true)) {
      const reduced = (
        dom.length === 1 ? dom[0] : ce.function('Add', dom)
      ).simplify();
      if (reduced.has(x)) return numericTendsToInfinity(reduced, x, ce);
      return false;
    }
    // The sum is bounded only when each dominant term is bounded. A dominant
    // term that is not classified (`√x` in `√x − 50`) leaves the answer
    // unknown.
    return domInf.every((t) => t === false) ? false : undefined;
  }

  if (op === 'Multiply' || op === 'Divide')
    return numericTendsToInfinity(e, x, ce);

  return numericTendsToInfinity(e, x, ce);
}

/**
 * Does `b^g` → ∞ as x → +∞, for a constant base `b > 1` (`e^g` included)?
 * `true` when `|g|` → ∞ and `g` is positive, `false` when `g` is bounded
 * (then `b^g` is bounded) or negative (then `b^g` is in `(0, 1)`), and
 * `undefined` otherwise.
 *
 * The sign of `g` is read from numeric probes. When a probe has no value (a
 * symbolic parameter, as in `e^{a·x}`) or the probes disagree, a polynomial
 * `g` takes the sign of its leading coefficient, when that sign is known
 * (`a > 0` assumed). Otherwise the sign is not known: `a·x` goes to `+∞` or
 * to `−∞` depending on `a`, so the answer is `undefined`, not `true`.
 */
function exponentialTendsToInfinity(
  g: Expression,
  x: string,
  ce: ComputeEngine
): boolean | undefined {
  const t = tendsToInfinity(g, x, ce);
  if (t === false) return false;
  let sign = stableSignAtInf(g, x, ce);
  if (sign === 0) {
    const deg = polynomialDegree(g, x);
    const lead = deg > 0 ? getPolynomialCoefficients(g, x)?.[deg] : undefined;
    if (lead?.isPositive === true) sign = 1;
    else if (lead?.isNegative === true) sign = -1;
  }
  if (sign < 0) return false;
  if (sign > 0 && t === true) return true;
  return undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Numeric oracles (used only to decide ordering / divergence, never for the
// returned value, which stays symbolic)
// ──────────────────────────────────────────────────────────────────────────

const PROBES = [8, 30, 120];

// Compiled machine-float probe functions, keyed by the probed expression.
// These oracles decide only order-of-growth / divergence (never the returned
// limit value), so machine precision suffices — and, crucially, a compiled
// tower overflows cleanly to ±Infinity instead of grinding. `null` marks an
// expression that could not be compiled (fall back to interpreted `.N()`).
// An entry is for one expression and one variable: the variable is part of
// the entry, and a probe of the same expression in another variable
// replaces it. The compiled code can hold the values of the symbols of the
// expression and the definitions in force at the time of the compilation,
// so an entry is valid while the dependencies of the expression
// (`snapshotMemoDeps()`), the world and definition versions of the engine,
// and the visibility of the assumptions are unchanged. The cache generation
// (`ce._cacheGeneration()`) is not a usable stamp: each probe builds a
// function literal, whose parameter declaration moves the generation, so a
// generation stamp never matched. A probe whose compilation ran host code
// that does not state its purity is not kept (`host-handler-changes.ts`).
type ProbeEntry = {
  x: string;
  fn: ((x: number) => number) | null;
  worldVersion: number;
  definitionVersion: number;
  factsHidden: boolean;
  deps: MemoDeps;
};
const probeCache = new WeakMap<object, ProbeEntry>();

/** The number of probes that `compiledProbe()` compiled, in this process.
 * For tests. */
export let limitProbeCompileCount = 0;

function compiledProbe(
  e: Expression,
  x: string,
  ce: ComputeEngine
): ((x: number) => number) | null {
  const key = e as unknown as object;
  const cached = probeCache.get(key);
  if (
    cached !== undefined &&
    cached.x === x &&
    cached.worldVersion === ce._worldVersion &&
    cached.definitionVersion === ce._definitionVersion &&
    cached.factsHidden === ce._factsHidden() &&
    memoDepsStillValid(e, cached.deps)
  )
    return cached.fn;
  const worldVersion = ce._worldVersion;
  const definitionVersion = ce._definitionVersion;
  const factsHidden = ce._factsHidden();
  const deps = snapshotMemoDeps(e);
  let fn: ((x: number) => number) | null = null;
  const hostCallsBefore = uncachedHostCallCount();
  limitProbeCompileCount += 1;
  try {
    const lit = ce.function('Function', [e, ce.symbol(x)]);
    // Budgeted so a probe of a Sum/Product with a variable-dependent (or
    // infinite) bound stays cheap — over-budget calls read as NaN, which the
    // growth oracles already treat as "unreliable, bail".
    const compiled = implicitCompile(ce, lit, {
      iterationBudget: LIMIT_PROBE_ITERATION_BUDGET,
    }) as { run?: (x: number) => number } | undefined;
    if (typeof compiled?.run === 'function') fn = compiled.run;
  } catch {
    fn = null;
  }
  if (deps === undefined || uncachedHostCallCount() !== hostCallsBefore)
    return fn;
  // Checkpoint journal (funnel 7): the compiled probe closes over the
  // definitions in force when it was built — a probe compiled during the
  // window must not outlive a restore.
  journalCheckpointMemoEntry(ce, probeCache, key, 'limit-probe');
  probeCache.set(key, {
    x,
    fn,
    worldVersion,
    definitionVersion,
    factsHidden,
    deps,
  });
  return fn;
}

function numericAt(
  e: Expression,
  x: string,
  xv: number,
  ce: ComputeEngine
): number {
  checkDeadline(ce._deadlineFrame);
  // Prefer a compiled MACHINE-float evaluation over arbitrary-precision `.N()`.
  // On iterated-exponential (Gruntz-class) forms the interpreted BigDecimal path
  // builds astronomically large intermediates and burns minutes of CPU per
  // probe; the compiled path overflows to ±Infinity immediately. The growth
  // oracles only read magnitude/trend, so this does not change any decision they
  // could reliably make — and it matches the numeric-limit fallback's own
  // machine-float behaviour. See CORRECTNESS_FINDINGS #28.
  const fn = compiledProbe(e, x, ce);
  if (fn) {
    try {
      const v = fn(xv);
      return typeof v === 'number' ? v : NaN;
    } catch (err) {
      if (err instanceof CancellationError) throw err;
      return NaN;
    }
  }
  // Fallback: interpreted arbitrary-precision (only when compilation fails).
  try {
    return e.subs({ [x]: ce.number(xv) }).N().re;
  } catch (err) {
    // A deadline interrupt must propagate; only genuine evaluation failures
    // (overflow, domain) degrade to NaN so probing can bail gracefully.
    if (err instanceof CancellationError) throw err;
    return NaN;
  }
}

function numericTendsToInfinity(
  e: Expression,
  x: string,
  ce: ComputeEngine
): boolean | undefined {
  const v = PROBES.map((xv) => Math.abs(numericAt(e, x, xv, ce)));
  if (v.some((y) => Number.isNaN(y))) return undefined;
  if (v[2] === Infinity) return true;
  // Growing strongly and unbounded.
  if (v[2] > v[1] && v[1] > v[0] && v[2] > 1e3 && v[2] > 100 * v[0])
    return true;
  // Clearly settling to a finite value.
  if (v[2] < 1e3 && Math.abs(v[2] - v[1]) <= 0.01 * Math.max(1, v[2]))
    return false;
  return undefined;
}

function numericGrowthCompare(
  a: Expression,
  b: Expression,
  x: string,
  ce: ComputeEngine
): number | undefined {
  // Compare growth via the trend of D(x) = ln|a(x)| − ln|b(x)| = ln|a/b|.
  // D → +∞ ⟹ a grows faster; D → −∞ ⟹ slower; D → const ⟹ same order. Using
  // log-magnitudes keeps moderate-x probes overflow-free and resolves even very
  // slow rate differences (ln x vs x) that a raw ratio misses.
  const lnMag = (e: Expression, xv: number): number => {
    const v = Math.abs(numericAt(e, x, xv, ce));
    // A probe that hits 0 (often catastrophic cancellation) or a non-finite
    // value (overflow) is unreliable for a growth comparison — bail rather than
    // read a spurious order from it (e.g. eˣ-terms cancelling to 0).
    if (!Number.isFinite(v) || v === 0) return NaN;
    return Math.log(v);
  };
  const d = PROBES.map((xv) => lnMag(a, xv) - lnMag(b, xv));
  if (d.some((v) => !Number.isFinite(v))) return undefined;
  const span = d[2] - d[0];
  // Monotone and meaningfully separating across the probe range.
  if (d[2] > d[1] && d[1] >= d[0] && span > 1) return 1;
  if (d[2] < d[1] && d[1] <= d[0] && span < -1) return -1;
  if (Math.abs(span) < 0.5) return 0; // settled → same order
  return undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────────

/** Split `e` into a numerator/denominator if it is a quotient. */
function asRatio(
  e: Expression,
  ce: ComputeEngine
): { num: Expression; den: Expression } | undefined {
  if (e.operator === 'Divide') return { num: o1(e), den: o2(e) };
  // b⁻ᵏ form: canonicalization writes `1/(x² − 2)²` as `(x² − 2)^(−2)`,
  // and the quotient strategies read it as `1 / (x² − 2)²`.
  if (e.operator === 'Power' && o2(e).isNegative === true)
    return { num: ce.One, den: ce.function('Power', [o1(e), o2(e).neg()]) };
  // a · b⁻¹ form
  if (e.operator === 'Multiply') {
    const num: Expression[] = [];
    const den: Expression[] = [];
    for (const f of oo(e)) {
      if (f.operator === 'Power' && o2(f).isNegative === true) {
        den.push(ce.function('Power', [o1(f), o2(f).neg()]));
      } else num.push(f);
    }
    if (den.length > 0) {
      return {
        num:
          num.length === 0
            ? ce.One
            : num.length === 1
              ? num[0]
              : ce.function('Multiply', num),
        den: den.length === 1 ? den[0] : ce.function('Multiply', den),
      };
    }
  }
  return undefined;
}

function isIndeterminateRatio(n0: Expression, d0: Expression): boolean {
  if (n0.is(0) && d0.is(0)) return true; // 0/0
  if (n0.isInfinity === true && d0.isInfinity === true) return true; // ∞/∞
  return false;
}

/**
 * A resolved, usable limit value: free of the limit variable, and neither
 * (complex) infinity nor NaN. Crucially this accepts finite *symbolic*
 * constants (`ln 5`, `π/4`, `e`), whose `.isFinite` is `undefined` because the
 * engine hasn't numericized them.
 *
 * A value that holds a quotient by the number 0 is not a limit value. The
 * quotient is kept when its numerator may be zero (`a/0` with `a` a free
 * symbol is `0/0` when `a` is 0, and `ComplexInfinity` otherwise), so the
 * substitution `x = a` into `x/(x − a)` gives `a/0`, which the pole
 * strategies must resolve.
 */
function isDefiniteValue(e: Expression, x?: string): boolean {
  if (e.isNaN === true) return false;
  if (e.isInfinity === true) return false;
  if (x !== undefined && e.has(x)) return false;
  if (hasQuotientByZero(e)) return false;
  return true;
}

/** Whether `e` holds a `Divide` whose divisor is the number 0. */
function hasQuotientByZero(e: Expression): boolean {
  if (!isFunction(e)) return false;
  if (e.operator === 'Divide' && isNumber(e.op2) && e.op2.isSame(0))
    return true;
  return e.ops.some(hasQuotientByZero);
}

function expOfLimit(
  inner: Expression | undefined,
  ce: ComputeEngine
): Expression | undefined {
  if (!inner) return undefined;
  if (inner.isInfinity === true)
    return inner.isNegative === true ? ce.Zero : ce.PositiveInfinity;
  if (isDefiniteValue(inner)) return ce.function('Exp', [inner]).evaluate();
  return undefined;
}

function lnOfLimit(
  inner: Expression | undefined,
  ce: ComputeEngine
): Expression | undefined {
  if (!inner) return undefined;
  if (inner.isInfinity === true && inner.isNegative !== true)
    return ce.PositiveInfinity;
  if (inner.is(0)) return ce.NegativeInfinity; // ln 0⁺
  if (inner.isPositive === true && isDefiniteValue(inner))
    return ce.function('Ln', [inner]).evaluate();
  return undefined;
}

/** The values of `x` where `stableSignAtInf` and `provenSignAtInf` probe. */
const SIGN_PROBE_POINTS = [120, 1e4, 1e8];

/**
 * The sign of `e` as `x → +∞`, read from numeric probes at `x = 120`, `10⁴`
 * and `10⁸`: `1` or `−1` when the three probes have values of that sign,
 * `0` when a probe has no value or is zero, or when the probes disagree (a
 * term that changes sign past the first probe, `√x − 50`). A single probe
 * at 120 read `x/(√x − 50)` as `−∞`.
 */
function stableSignAtInf(e: Expression, x: string, ce: ComputeEngine): number {
  let sign = 0;
  for (const point of SIGN_PROBE_POINTS) {
    const v = numericAt(e, x, point, ce);
    if (Number.isNaN(v) || v === 0) return 0;
    const s = v < 0 ? -1 : 1;
    if (sign === 0) sign = s;
    else if (s !== sign) return 0;
  }
  return sign;
}

/**
 * The sign of `e` for large positive `x`, when it can be proved without a
 * numeric probe: `1` or `−1`, else `0`.
 *
 * The engine does not know that the limit variable `x` is real, so it cannot
 * prove that `e^{q·x}` is positive. This function proves it from the form:
 * `e^g` and `b^g` (a constant `b > 0`) are positive when `g` is real. `g` is
 * taken as real when its type is real with `x` replaced by each of the
 * three probe points of `stableSignAtInf` (`q·x` with `q` declared real).
 * This is a check at three points, not a proof for all large `x`: it
 * rejects `√(200 − x)`, which is real at 120 and imaginary past 200, but
 * it does not reject an exponent that is real at the three points and
 * not real between them. A product or a quotient takes the
 * product of the signs of its parts. Any other form uses the sign that the
 * engine proves for it.
 */
function provenSignAtInf(e: Expression, x: string, ce: ComputeEngine): number {
  if (e.isPositive === true) return 1;
  if (e.isNegative === true) return -1;
  const op = e.operator;
  if (op === 'Negate') return -provenSignAtInf(o1(e), x, ce);
  if (op === 'Multiply' || op === 'Divide') {
    let sign = 1;
    for (const f of oo(e)) sign *= provenSignAtInf(f, x, ce);
    return sign;
  }
  let g: Expression | undefined;
  if (op === 'Exp') g = o1(e);
  else if (op === 'Power' && !o1(e).has(x) && o1(e).isPositive === true)
    g = o2(e);
  if (
    g !== undefined &&
    !hasNonRealConstant(g) &&
    SIGN_PROBE_POINTS.every((point) =>
      g!.subs({ [x]: ce.number(point) }).type.matches('real')
    )
  )
    return 1;
  return 0;
}

function leadingCoefficientRatio(
  n: Expression,
  d: Expression,
  x: string,
  ce: ComputeEngine
): Expression | undefined {
  // Same growth order ⟹ the limit is a finite constant (the ratio of leading
  // coefficients). First try the exact value from a series: with `x = 1/u`,
  // the limit as `x → +∞` is the constant term of the series of the ratio
  // at `u = 0` (`x·ln(1 + π/x)` is `ln(1 + π·u)/u = π − π²·u/2 + …`).
  const ratio = n.div(d);
  const exact = constantTermAtInfinity(ratio, x, ce);
  if (exact !== undefined) return exact;
  // Else recover it with Richardson extrapolation — which converges even for
  // slow approaches such as x·ln(1+1/x) → 1 that a single large probe would
  // under-shoot — then recognize an integer or a simple fraction. Any other
  // value is not known exactly, and a float is not a result of `evaluate()`
  // (the exactness contract): return `undefined`, so that `evaluate()` keeps
  // the limit unevaluated and `.N()` uses the numeric limit.
  // Shift the probe ladder a little past x = 1: forms like x·ln(1−1/x) are
  // singular there (ln 0), which would poison the extrapolation. The shift
  // leaves the x → ∞ limit unchanged.
  const v = numericLimit(
    (xv) => numericAt(ratio, x, xv + 2, ce),
    Infinity,
    1,
    ce._deadline
  );
  if (!Number.isFinite(v)) return undefined;
  const rounded = Math.round(v);
  if (Math.abs(v - rounded) < 1e-7) return ce.number(rounded);
  for (let q = 2; q <= 24; q++) {
    const p = Math.round(v * q);
    if (Math.abs(v - p / q) < 1e-9) return ce.number(p).div(ce.number(q));
  }
  return undefined;
}

/**
 * The limit of `e` as `x → +∞` from the series of `e` with `x = 1/u` at
 * `u = 0`: the constant term when the series starts at the power 0, and 0
 * when it starts at a positive power. `undefined` when there is no such
 * series (a branch point, an essential singularity, a power of `u` with a
 * negative exponent) or when the value still contains `u`.
 *
 * The fresh variable `u` is declared `real` in a temporary scope, so it has
 * no binding outside this function.
 */
function constantTermAtInfinity(
  e: Expression,
  x: string,
  ce: ComputeEngine
): Expression | undefined {
  const u = ['u', 'w', 's', 't', 'q', 'tau', 'xi', 'eta'].find(
    (name) => name !== x && !e.has(name)
  );
  if (u === undefined) return undefined;
  ce.pushScope();
  try {
    ce.declare(u, 'real');
    const f = e.subs({ [x]: ce.function('Divide', [ce.One, ce.symbol(u)]) });
    const L = laurentData(f, u, ce.Zero, ce, 3);
    if (!L || L.v < 0) return undefined;
    if (L.v > 0) return ce.Zero;
    const c = L.coeff(0).evaluate();
    if (!c.isValid || c.isNaN === true || c.has(u) || c.has(x))
      return undefined;
    return c;
  } finally {
    ce.popScope();
  }
}

/**
 * `e` with each `|x|` replaced by `x`, and each `√(x^m)` and `ⁿ√(x^m)`
 * (a real constant `m`, an exact integer degree `n ≥ 2`) replaced by
 * `x^(m/n)`. As `x → +∞`, `x` is positive for large values, so these forms
 * are equal there. The leading-order rewrite gives such terms: the leading order of
 * `√(2x² + 1)/x` is `√2·√(x²)/x`. Without this step, the ratio still
 * contains `x`, and `leadingCoefficientRatio()` reads its value from
 * numeric probes: the result was the float `1.414…`, not `√2`.
 */
function forPositiveVariable(
  e: Expression,
  x: string,
  ce: ComputeEngine
): Expression {
  if (!isFunction(e) || !e.has(x)) return e;
  const isX = (u: Expression): boolean => isSymbol(u) && u.symbol === x;
  if (e.operator === 'Abs' && isX(e.op1)) return e.op1;
  if (
    (e.operator === 'Sqrt' || e.operator === 'Root') &&
    e.op1.operator === 'Power' &&
    isX(o1(e.op1))
  ) {
    // The exponent `m` is kept as an expression, and the new exponent is the
    // `Divide` expression `m/n`. The double value of `m` is not read: the
    // exact `2 + 10^-30` has the double value `2`, but `√(x^(2 + 10^-30))`
    // is not `x`. A float exponent stays a float. The degree must be an
    // exact integer, for the same reason.
    const m = o2(e.op1);
    const n = e.operator === 'Sqrt' ? 2 : asExactSmallInteger(e.op2);
    if (n !== null && n >= 2 && !m.has(x) && m.type.matches('finite_real'))
      return ce.function('Power', [
        o1(e.op1),
        ce.function('Divide', [m, ce.number(n)]),
      ]);
  }
  const ops = e.ops.map((op) => forPositiveVariable(op, x, ce));
  if (ops.every((op, k) => op === e.ops[k])) return e;
  return ce.function(e.operator, ops);
}

function baseEventuallyPositive(
  base: Expression,
  x: string,
  ce: ComputeEngine
): boolean {
  return numericAt(base, x, 120, ce) > 0;
}

/**
 * Combine cancellation-prone pairs inside sums, recursively over the whole
 * expression:
 *
 *   ln u − ln v   →  ln(u/v)              (u, v eventually positive)
 *   √u − √v       →  (u − v)/(√u + √v)    (u, v eventually positive)
 *   √u − q        →  (u − q²)/(√u + q)    (u, q eventually positive, and √u
 *                                          and q grow at the same rate)
 *
 * Differences of co-dominant terms like these lose their magnitude to
 * cancellation, so neither the leading-order rewrite nor the growth
 * comparison can rank them (they see the individual terms, not the ~1/x
 * difference). The combined forms are mathematically identical on the
 * eventually-positive domain and are handled exactly by the existing
 * strategies.
 *
 * The radical rules also apply to a root of an integer degree `n` from 2 to
 * `MAX_CONJUGATE_DEGREE` (`Root(u, n)`), with the identity
 * `a − b = (aⁿ − bⁿ)/(aⁿ⁻¹ + aⁿ⁻²·b + … + bⁿ⁻¹)`. The identity is true when
 * the denominator is not zero, and the denominator is positive when `a` and
 * `b` are positive. The numerator `aⁿ − bⁿ` is expanded, so that its leading
 * terms cancel: `√(x² + x) − x` gives `(x² + x − x²)/(√(x² + x) + x)`, which
 * is `x/(√(x² + x) + x)`. Without the expansion the numerator stays
 * `x² + x − x²` (canonical forms do not collect like terms), and the
 * leading-order rewrite reads it as `x² − x²`. The radicands `u`, `v` and
 * the term `q` must be polynomials in `x`: the expansion cancels the leading
 * terms of polynomials only.
 *
 * A radical term can have a number coefficient: `2√u − 2√v` is
 * `2·(√u − √v)` and `2√u − x` is `2·(√u − x/2)`. A logarithm pair must have
 * unit coefficients. The rule `√u − q` applies only when `√u` and `q` grow
 * at the same rate (their difference then cancels at leading order); any
 * other sum is left untouched (and remains protected by the fail-closed
 * instability guards).
 */
function combineCancellingPairs(
  e: Expression,
  x: string,
  ce: ComputeEngine
): Expression {
  const eOps = oo(e);
  if (eOps.length === 0 || !e.has(x)) return e;

  // Rewrite operands first so nested sums (e.g. inside a product or an
  // exponential) are covered.
  const ops = eOps.map((op) => combineCancellingPairs(op, x, ce));
  let changed = ops.some((op, k) => op !== eOps[k]);

  if (e.operator !== 'Add') {
    if (!changed) return e;
    return ce.function(e.operator, ops);
  }

  // Decompose each term into (sign, core), pairing `Ln` terms of opposite
  // sign.
  const sign = (t: Expression): 1 | -1 => (t.operator === 'Negate' ? -1 : 1);
  const core = (t: Expression): Expression =>
    t.operator === 'Negate' ? o1(t) : t;

  // `k·ⁿ√u` → `{ k, root: ⁿ√u, u, n }`, where `k` is a non-zero real number
  // literal (1 when the term has no coefficient). `undefined` when the term
  // is not a radical of an integer degree from 2 to `MAX_CONJUGATE_DEGREE`.
  const radicalTerm = (
    t: Expression
  ):
    | { k: Expression; root: Expression; u: Expression; n: number }
    | undefined => {
    let k: Expression = ce.One;
    let r = t;
    if (r.operator === 'Negate') {
      k = ce.NegativeOne;
      r = o1(r);
    }
    if (r.operator === 'Multiply' && oo(r).length === 2) {
      const c = o1(r);
      if (
        !isNumber(c) ||
        c.im !== 0 ||
        (c.isPositive !== true && c.isNegative !== true)
      )
        return undefined;
      k = k.mul(c);
      r = o2(r);
    }
    if (r.operator === 'Sqrt') return { k, root: r, u: o1(r), n: 2 };
    if (r.operator === 'Root') {
      // An exact integer degree only: the exact `3 + 10^-30` projects to the
      // double `3`, but `Root(u, 3 + 10^-30)` is not a cube root.
      const d = asExactSmallInteger(o2(r));
      if (d === null || d < 2 || d > MAX_CONJUGATE_DEGREE) return undefined;
      return { k, root: r, u: o1(r), n: d };
    }
    return undefined;
  };

  // `k·(a − b)` written as `k·(aⁿ − bⁿ)/(aⁿ⁻¹ + aⁿ⁻²·b + … + bⁿ⁻¹)`.
  const rootDifference = (
    k: Expression,
    a: Expression,
    aN: Expression,
    b: Expression,
    bN: Expression,
    n: number
  ): Expression => {
    const pow = (base: Expression, m: number): Expression =>
      m === 0
        ? ce.One
        : m === 1
          ? base
          : ce.function('Power', [base, ce.number(m)]);
    const terms: Expression[] = [];
    for (let m = 0; m < n; m++)
      terms.push(ce.function('Multiply', [pow(a, n - 1 - m), pow(b, m)]));
    const q = ce.function('Divide', [
      expand(ce.function('Subtract', [aN, bN])),
      ce.function('Add', terms),
    ]);
    return k.isSame(1) ? q : ce.function('Multiply', [k, q]);
  };

  // The rewrite `a − b → (aⁿ − bⁿ)/(…)` is used only when `aⁿ` and `bⁿ` are
  // polynomials in `x`. Then `expand()` cancels their leading terms. With
  // another function, such as `x²·cos²(1/x)`, the expanded numerator keeps
  // terms that cancel only at leading order (`x² − x²·cos²(1/x)`), and the
  // leading-order rewrite drops the smaller terms that give the limit:
  // `√(x² + x) − x·cos(1/x)` gave 0, but its limit is 1/2.
  const isPolynomial = (p: Expression): boolean => polynomialDegree(p, x) >= 0;

  const used = ops.map(() => false);
  // The combined form of a pair, at the index of one of its two terms (the
  // first term of a pair of the same kind, the radical of a pair of a
  // radical and another term). The terms of a sum can be in any order.
  const combinedAt: (Expression | undefined)[] = ops.map(() => undefined);

  // Pairs of logarithms, and pairs of radicals of the same degree.
  for (let i = 0; i < ops.length; i++) {
    if (used[i]) continue;
    const si = sign(ops[i]);
    const ci = core(ops[i]);
    const ri = radicalTerm(ops[i]);
    if (ci.operator !== 'Ln' && ri === undefined) continue;
    for (let j = i + 1; j < ops.length; j++) {
      if (used[j]) continue;
      let combined: Expression | undefined = undefined;
      if (ci.operator === 'Ln') {
        const sj = sign(ops[j]);
        const cj = core(ops[j]);
        if (si === sj || cj.operator !== 'Ln') continue;
        // (u, v) so that the pair is `ln(u) − ln(v)`.
        const [u, v] = si === 1 ? [o1(ci), o1(cj)] : [o1(cj), o1(ci)];
        if (
          !baseEventuallyPositive(u, x, ce) ||
          !baseEventuallyPositive(v, x, ce)
        )
          continue;
        combined = ce.function('Ln', [ce.function('Divide', [u, v])]);
      } else if (ri !== undefined) {
        const rj = radicalTerm(ops[j]);
        if (rj === undefined || rj.n !== ri.n || !rj.k.isSame(ri.k.neg()))
          continue;
        // A pair of constants, such as `√3 − √2`, does not need a rewrite.
        if (!ri.root.has(x) && !rj.root.has(x)) continue;
        if (!isPolynomial(ri.u) || !isPolynomial(rj.u)) continue;
        // (a, b) so that the pair is `k·(a − b)` with `k > 0`.
        const [a, b] = ri.k.isPositive === true ? [ri, rj] : [rj, ri];
        if (
          !baseEventuallyPositive(a.u, x, ce) ||
          !baseEventuallyPositive(b.u, x, ce)
        )
          continue;
        combined = rootDifference(a.k, a.root, a.u, b.root, b.u, ri.n);
      }
      if (combined === undefined) continue;
      combinedAt[i] = combined;
      used[i] = used[j] = true;
      changed = true;
      break;
    }
  }

  // A radical and another term that grows at the same rate, as in
  // `√(x² + x) − x`: `k·ⁿ√u + t` is `k·(ⁿ√u − q)` with `q = −t/k`.
  for (let i = 0; i < ops.length; i++) {
    if (used[i]) continue;
    const ri = radicalTerm(ops[i]);
    if (ri === undefined || !ri.root.has(x) || !isPolynomial(ri.u)) continue;
    if (!baseEventuallyPositive(ri.u, x, ce)) continue;
    for (let j = 0; j < ops.length; j++) {
      if (j === i || used[j]) continue;
      const t = ops[j];
      const q = ri.k.isSame(1)
        ? t.neg()
        : ce.function('Divide', [t.neg(), ri.k]);
      if (!isPolynomial(q)) continue;
      if (stableSignAtInf(q, x, ce) !== 1) continue;
      if (compareGrowth(ri.root, q, x, ce) !== 0) continue;
      combinedAt[i] = rootDifference(
        ri.k,
        ri.root,
        ri.u,
        q,
        ce.function('Power', [q, ce.number(ri.n)]),
        ri.n
      );
      used[i] = used[j] = true;
      changed = true;
      break;
    }
  }

  if (!changed) return e;
  const out: Expression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const c = combinedAt[i];
    if (c !== undefined) out.push(c);
    else if (!used[i]) out.push(ops[i]);
  }
  if (out.length === 1) return out[0];
  return ce.function('Add', out);
}

/** The largest root degree that `combineCancellingPairs` rewrites: the
 * rewrite of `ⁿ√u − ⁿ√v` has a denominator of `n` terms. */
const MAX_CONJUGATE_DEGREE = 6;

/**
 * Does the sum `e` lose most of its magnitude to cancellation (or overflow) at
 * the probe points? A genuine sum keeps a value comparable to its largest term;
 * `e^stuff − eˣ` collapses to ~0 (or NaN past the fp horizon) while each term is
 * astronomically large — a case no black-box numeric pass can rank.
 */
function hasCancellation(e: Expression, x: string, ce: ComputeEngine): boolean {
  if (e.operator !== 'Add' || !oo(e) || oo(e).length < 2) return false;
  for (const xv of [60, 120]) {
    const sum = Math.abs(numericAt(e, x, xv, ce));
    let maxTerm = 0;
    for (const t of oo(e)) {
      const tv = Math.abs(numericAt(t, x, xv, ce));
      if (!Number.isFinite(tv)) return true; // a term overflowed
      maxTerm = Math.max(maxTerm, tv);
    }
    if (maxTerm > 0 && sum < 1e-6 * maxTerm) return true;
  }
  return false;
}

/** Recursive `hasCancellation`: true if `e` or any subexpression cancels/overflows. */
function numericallyUnstable(
  e: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): boolean {
  if (depth > MAX_DEPTH || !e.has(x)) return false;
  if (hasCancellation(e, x, ce)) return true;
  if (oo(e))
    for (const o of oo(e))
      if (numericallyUnstable(o, x, ce, depth + 1)) return true;
  return false;
}
