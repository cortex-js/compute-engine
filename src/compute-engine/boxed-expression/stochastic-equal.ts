import type { Expression } from '../global-types';

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

const WELL_KNOWN_POINTS = [0, -1, 1, Math.PI, Math.E, -Math.PI, -Math.E, 0.5, -0.5];
const NUM_RANDOM = 41;
const RANDOM_RANGE = 1000;

type ComplexValue = { re: number; im: number };

/**
 * Stochastic equality check: evaluate both expressions at random sample points
 * and compare results (both real and imaginary parts). Returns `true` if they
 * agree at all informative points, `false` if they disagree, or `undefined`
 * if no informative points were found.
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

  try {
    const compiledA = _compile(a);
    if (compiledA.run)
      evalA = (vars) => toComplex(compiledA.run!(vars));
  } catch { /* fall back to subs */ }

  try {
    const compiledB = _compile(b);
    if (compiledB.run)
      evalB = (vars) => toComplex(compiledB.run!(vars));
  } catch { /* fall back to subs */ }

  // Fallback evaluator using subs + N (returns both re and im)
  const subsEval = (expr: Expression, vars: Record<string, number>): ComplexValue => {
    const result = expr.subs(vars).N();
    return { re: result.re, im: result.im };
  };

  const doEvalA = evalA ?? ((vars: Record<string, number>) => subsEval(a, vars));
  const doEvalB = evalB ?? ((vars: Record<string, number>) => subsEval(b, vars));

  let informativeCount = 0;

  const testPoint = (vars: Record<string, number>): false | undefined => {
    let va: ComplexValue;
    let vb: ComplexValue;
    try {
      va = doEvalA(vars);
      vb = doEvalB(vars);
    } catch {
      return undefined; // skip on error
    }

    // If either value has a NaN component, skip — likely a singularity/pole
    if (Number.isNaN(va.re) || Number.isNaN(va.im) ||
        Number.isNaN(vb.re) || Number.isNaN(vb.im)) return undefined;

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
  }

  // Test random points (independent value per unknown)
  for (let i = 0; i < NUM_RANDOM; i++) {
    const vars: Record<string, number> = {};
    for (const u of unknowns)
      vars[u] = (Math.random() - 0.5) * 2 * RANDOM_RANGE;
    const result = testPoint(vars);
    if (result === false) return false;
  }

  if (informativeCount === 0) return undefined;
  return true;
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
