// Symbolic residue calculus (ROADMAP item 7, part c).
//
// `residue(f, x, a)` computes the residue of `f` (a function of `x`) at the
// point `x = a` — the coefficient of `(x − a)⁻¹` in the Laurent expansion of
// `f` about `a`. It is the engine behind the `Residue` operator.
//
// Method: for a pole of order `m`,
//
//     Res_{x=a} f = lim_{x→a} 1/(m−1)! · dᵐ⁻¹/dxᵐ⁻¹ [ (x − a)ᵐ · f(x) ]
//
// The order is found by probing `lim (x−a)ⁿ f` for increasing `n` (the smallest
// `n` with a finite limit is the order; an analytic `f` falls out as order 1
// with residue 0). The computation reuses the symbolic limit engine
// (`symbolicLimit`) and `differentiate`, so it stays exact whenever they do.
//
// When the generic limit method cannot expand a special function at its pole
// (e.g. `Gamma` near a non-positive integer), it falls back to a small table of
// closed-form residues, gated by the analytic-property metadata store
// confirming the point is a recorded pole of that function.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types';

import { symbolicLimit } from './limit';
import { differentiate } from './derivative';
import { sym } from '../boxed-expression/type-guards';
import { getFunctionProperties } from '../function-properties';

// The base `Expression` type only exposes operands after a type guard; the
// boxed objects always have an `ops` getter (see limit.ts for the same idiom).
const oo = (e: Expression): ReadonlyArray<Expression> =>
  (e as unknown as { ops: ReadonlyArray<Expression> | null }).ops ?? [];

const MAX_ORDER = 8;

function factorialBig(n: number): bigint {
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
}

/**
 * Residue of `body` (a function of `varName`) at `varName = point`, or
 * `undefined` when it cannot be determined (the operator then stays symbolic).
 * Residue at infinity is not yet supported.
 */
export function residue(
  body: Expression,
  varName: string,
  point: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (point.isFinite === false || point.isInfinity === true) return undefined;

  // Authoritative closed-form residues for recognized special functions. This
  // runs FIRST: the generic limit method can't see a special function's poles
  // (it would treat e.g. Digamma(-1) as finite and return a wrong 0).
  const special = specialFunctionResidue(body, varName, point, ce);
  if (special !== undefined) return special;

  const x = ce.symbol(varName);
  const xMinusA = ce.function('Subtract', [x, point]);

  // Combine an expression into a single cancelled fraction. The limit engine
  // can resolve a 0/0 quotient (cancellation / L'Hôpital) but not the 0·∞ form
  // left by an un-cancelled product like `(x−a)ⁿ · f` — and `.simplify()` only
  // cancels polynomial numerators, missing `eˣ·(x−a)ⁿ/(x−a)ⁿ`. The
  // `numeratorDenominator` getter cancels common factors across the quotient.
  const frac = (e: Expression): Expression =>
    ce.function('Divide', e.numeratorDenominator);

  const shifted = (n: number): Expression =>
    frac(
      ce.function('Multiply', [ce.function('Power', [xMinusA, ce.number(n)]), body])
    );

  // Pole order m = smallest n ≥ 1 with a finite lim (x−a)ⁿ·f. An analytic f
  // gives a finite (zero) limit at n = 1, so its residue comes out 0.
  let order: number | undefined;
  let simpleLimit: Expression | undefined;
  for (let n = 1; n <= MAX_ORDER; n++) {
    const L = symbolicLimit(shifted(n), varName, point, undefined, ce);
    if (L !== undefined && L.isFinite === true) {
      order = n;
      simpleLimit = L;
      break;
    }
  }

  if (order === undefined) return undefined;

  // Simple pole: residue = lim (x−a)·f (already computed above).
  if (order === 1) return simpleLimit;

  // Order m ≥ 2: residue = lim dᵐ⁻¹[(x−a)ᵐ·f] / (m−1)!, keeping a single
  // cancelled fraction across each differentiation.
  let g: Expression = shifted(order);
  for (let k = 0; k < order - 1; k++) {
    const d = differentiate(g, varName);
    if (d === undefined) return undefined;
    g = frac(d);
  }
  const L = symbolicLimit(g, varName, point, undefined, ce);
  if (L === undefined || L.isFinite !== true) return undefined;
  return ce.function('Divide', [L, ce.number(factorialBig(order - 1))]);
}

// Special functions with simple poles whose closed-form residues the generic
// limit method can't reach (it can't see the pole and would return a wrong 0).
const SPECIAL_POLE_FNS = ['Gamma', 'Digamma', 'Zeta'] as const;

// Residue ρ of the special function `op` at its simple pole `point`, gated by
// the analytic-property store; `undefined` if `point` is not a recorded simple
// pole of `op`.
function simplePoleResidue(
  op: string,
  point: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (point.im !== 0) return undefined;
  const re = point.re;

  // Synergy with the analytic-property store: require a recorded pole here.
  const poles = getFunctionProperties(ce, op)?.poles;
  if (!poles) return undefined;
  if (ce.function('Element', [point, poles]).evaluate().valueOf() !== true)
    return undefined;

  switch (op) {
    case 'Gamma': {
      // Simple pole at z = −n (n ≥ 0): residue = (−1)ⁿ / n!.
      if (!Number.isInteger(re) || re > 0) return undefined;
      const n = -re;
      return ce.function('Divide', [
        ce.number(n % 2 === 0 ? 1n : -1n),
        ce.number(factorialBig(n)),
      ]);
    }
    case 'Digamma':
      // Simple poles at z = −n: residue = −1.
      if (!Number.isInteger(re) || re > 0) return undefined;
      return ce.number(-1);
    case 'Zeta':
      // Simple pole at s = 1: residue = 1.
      if (re !== 1) return undefined;
      return ce.number(1);
  }
  return undefined;
}

// Residue of an expression whose only singularity at `point` is a simple pole
// of a recognized special function `s = Op(varName)`. Factor `f = h · s` with
// `h` analytic, so `Res[h·s] = h(point)·ρ` (ρ the residue of `s`). This handles
// bare `Op(x)` (`h = 1`) and composite forms (`c·Gamma(x)`, `Gamma(x)/(x−5)`,
// `x²·Digamma(x)`, …). It is gated on the body actually containing `Op(varName)`
// — otherwise a point that happens to be a recorded pole of some special
// function (e.g. `Zeta` at 1) would spuriously divide an unrelated body by it.
function specialFunctionResidue(
  body: Expression,
  varName: string,
  point: Expression,
  ce: ComputeEngine
): Expression | undefined {
  const x = ce.symbol(varName);
  for (const op of SPECIAL_POLE_FNS) {
    if (!body.getSubexpressions(op).some((e) => sym(oo(e)[0]) === varName))
      continue;
    const rho = simplePoleResidue(op, point, ce);
    if (rho === undefined) continue;

    // Cofactor h = f / Op(x), which must be analytic at the point. If the body
    // had another singularity there (e.g. Op(x)² or Op(x)/(x−a)), h stays
    // singular → h(point) is not finite → skip (deferred), keeping the result
    // sound rather than wrong. (A cofactor that is itself an unreduced special
    // function — e.g. the Gamma·Zeta product at 1 — also defers.)
    const h = ce.function('Divide', [body, ce.function(op, [x])]).simplify();
    const hAtPoint = symbolicLimit(h, varName, point, undefined, ce);
    if (hAtPoint !== undefined && hAtPoint.isFinite === true)
      return ce.function('Multiply', [hAtPoint, rho]);
  }
  return undefined;
}
