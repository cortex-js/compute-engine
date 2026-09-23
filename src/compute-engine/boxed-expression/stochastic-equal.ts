import type { Expression } from '../global-types.js';
import { CancellationError } from '../../common/interruptible.js';
import { mixTags } from '../numerics/random.js';

// Lazy reference to break circular dependency:
// compare → stochastic-equal → compile-expression → base-compiler → utils → ...
// Inline the subset of `compile`'s return type we actually need, so we don't
// import from compile-expression.ts at all (madge follows import type too).
type ComplexResult = { re: number; im: number };
type CompileFn = (expr: Expression) => {
  run?: ((vars: Record<string, number>) => number | ComplexResult) | undefined;
};
let _compile: CompileFn;
/** @internal */
export function _setCompile(fn: CompileFn) {
  _compile = fn;
}

const WELL_KNOWN_POINTS = [
  0,
  -1,
  1,
  Math.PI,
  Math.E,
  -Math.PI,
  -Math.E,
  0.5,
  -0.5,
];
const NUM_RANDOM = 41;
const RANDOM_RANGE = 1000;
// The maximum number of sample points, per call, at which a disagreement of
// the compiled (machine-float) values is checked again at engine precision.
// See `testPoint` in `stochasticEqual`.
const MAX_PRECISE_RECHECKS = 3;

type ComplexValue = { re: number; im: number };

/**
 * Stochastic equality check: evaluate both expressions at random sample points
 * and compare results (both real and imaginary parts). Returns `true` if they
 * agree at all informative points, `false` if they disagree, or `undefined`
 * if no informative points were found or a disagreement could not be
 * confirmed at engine precision.
 */
export function stochasticEqual(
  a: Expression,
  b: Expression
): boolean | undefined {
  const ce = a.engine;
  const tolerance = ce.tolerance;

  // Collect union of unknowns
  const unknowns = [...new Set([...a.unknowns, ...b.unknowns])];

  // Try to compile both expressions for fast evaluation (with complex support)
  let evalA: ((vars: Record<string, number>) => ComplexValue) | null = null;
  let evalB: ((vars: Record<string, number>) => ComplexValue) | null = null;

  // A `CancellationError` (deadline expiry mid-compile) must unwind per the
  // `withTimeLimit` contract — only ordinary compile failures fall back.
  try {
    const compiledA = _compile(a);
    if (compiledA.run) evalA = (vars) => toComplex(compiledA.run!(vars));
  } catch (e) {
    if (e instanceof CancellationError) throw e;
    /* fall back to subs */
  }

  try {
    const compiledB = _compile(b);
    if (compiledB.run) evalB = (vars) => toComplex(compiledB.run!(vars));
  } catch (e) {
    if (e instanceof CancellationError) throw e;
    /* fall back to subs */
  }

  // Fallback evaluator using subs + N (returns both re and im)
  const subsEval = (
    expr: Expression,
    vars: Record<string, number>
  ): ComplexValue => {
    const result = expr.subs(vars).N();
    return { re: result.re, im: result.im };
  };

  const doEvalA =
    evalA ?? ((vars: Record<string, number>) => subsEval(a, vars));
  const doEvalB =
    evalB ?? ((vars: Record<string, number>) => subsEval(b, vars));

  let informativeCount = 0;
  let preciseRechecks = 0;

  // `'unconfirmed'`: the compiled values disagree at this point, and no
  // check at engine precision is left (see below). The caller then returns
  // `undefined` for the whole call.
  const testPoint = (
    vars: Record<string, number>
  ): false | 'unconfirmed' | undefined => {
    let va: ComplexValue;
    let vb: ComplexValue;
    try {
      va = doEvalA(vars);
      vb = doEvalB(vars);
    } catch (e) {
      // A deadline expiry must unwind, as for the compile step above. Any
      // other error skips the point.
      if (e instanceof CancellationError) throw e;
      return undefined;
    }

    // Machine floats can disagree where the exact values agree. Example:
    // `(x+y)^2` and `x^2+2xy+y^2` at x = 765.99, y = -767.09. The second form
    // adds terms near 1e6 to get a result near 1, so its rounding error
    // (about 1e-10) is larger than the tolerance, which is scaled by the
    // result, not by the terms. When a compiled evaluator was used, evaluate
    // that side again at this point at engine precision, and use that
    // comparison instead. A real disagreement needs one such check, because
    // the loop stops at the first confirmed disagreement. The number of
    // checks is limited, because each one is much slower than a compiled
    // evaluation. When no check is left, the disagreement is not confirmed,
    // and the caller answers `undefined` instead of `false`, so that
    // `compare.ts` can try its symbolic proof.
    if (
      (evalA || evalB) &&
      !hasNaN(va) &&
      !hasNaN(vb) &&
      !componentsAgree(va, vb, tolerance)
    ) {
      if (preciseRechecks >= MAX_PRECISE_RECHECKS) return 'unconfirmed';
      preciseRechecks += 1;
      try {
        if (evalA) va = subsEval(a, vars);
        if (evalB) vb = subsEval(b, vars);
      } catch (e) {
        if (e instanceof CancellationError) throw e;
        return undefined;
      }
    }

    // If either value has a NaN component, skip — likely a singularity/pole
    if (hasNaN(va) || hasNaN(vb)) return undefined;

    // Check real parts
    const reResult = compareComponent(va.re, vb.re, tolerance);
    if (reResult === false) return false;

    // Check imaginary parts
    const imResult = compareComponent(va.im, vb.im, tolerance);
    if (imResult === false) return false;

    // Both components agreed — count as informative if at least one was finite
    if (reResult === true || imResult === true) informativeCount++;

    return undefined;
  };

  // Test well-known points (same value for all unknowns)
  for (const v of WELL_KNOWN_POINTS) {
    const vars: Record<string, number> = {};
    for (const u of unknowns) vars[u] = v;
    const result = testPoint(vars);
    if (result === false) return false;
    if (result === 'unconfirmed') return undefined;
  }

  // Test random points (independent value per unknown).
  //
  // Sampled from a sub-stream derived from the ambient `WithRandomSeed` frame
  // (live outside one), so a seeded `isEqual` VERDICT replays — this probe
  // decides true/false/undefined, and which points it happened to draw is what
  // determines whether a near-miss is caught. The tag is symmetric in `a` and
  // `b` because `stochasticEqual(a, b)` and `stochasticEqual(b, a)` are the
  // same question and must not sample differently. It consumes no frame
  // indices, so an `isEqual` in a seeded block does not shift a sibling
  // `Random()` draw. See `docs/RANDOMNESS-MODEL.md`.
  const draw = ce._substream(mixTags(a.hash ^ b.hash));
  for (let i = 0; i < NUM_RANDOM; i++) {
    const vars: Record<string, number> = {};
    for (const u of unknowns) vars[u] = (draw() - 0.5) * 2 * RANDOM_RANGE;
    const result = testPoint(vars);
    if (result === false) return false;
    if (result === 'unconfirmed') return undefined;
  }

  if (informativeCount === 0) return undefined;
  return true;
}

function hasNaN(v: ComplexValue): boolean {
  return Number.isNaN(v.re) || Number.isNaN(v.im);
}

/** Return `false` if the two values disagree in either component. */
function componentsAgree(
  a: ComplexValue,
  b: ComplexValue,
  tolerance: number
): boolean {
  return (
    compareComponent(a.re, b.re, tolerance) !== false &&
    compareComponent(a.im, b.im, tolerance) !== false
  );
}

/** Normalize a compiled result (number or ComplexResult) to { re, im }. */
function toComplex(v: number | ComplexResult): ComplexValue {
  if (typeof v === 'number') return { re: v, im: 0 };
  return { re: v.re, im: v.im };
}

/**
 * Compare a single component (re or im) of two complex values.
 * Returns `true` if both finite and within tolerance, `false` if they
 * disagree, or `undefined` if the comparison is uninformative (both infinite).
 */
function compareComponent(
  a: number,
  b: number,
  tolerance: number
): boolean | undefined {
  const aFinite = Number.isFinite(a);
  const bFinite = Number.isFinite(b);

  // Both infinite → uninformative
  if (!aFinite && !bFinite) return undefined;

  // One finite, one infinite → not equal
  if (aFinite !== bFinite) return false;

  // Both finite — check with relative+absolute tolerance
  const diff = Math.abs(a - b);
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  if (diff > tolerance * scale) return false;

  return true;
}
