import { Complex } from 'complex-esm';

import type { Expression, BoxedSubstitution, Rule } from '../global-types';

import { durandKernerRoots } from '../numerics/polynomial-roots';
import { mul } from '../boxed-expression/arithmetic-mul-div';
import { add } from '../boxed-expression/arithmetic-add';
import { matchAnyRules } from '../boxed-expression/rules';
import { expandAll } from '../boxed-expression/expand';
import { differentiate } from './derivative';
import { findUnivariateRoots } from '../boxed-expression/solve';
import {
  cancelCommonFactors,
  getPolynomialCoefficients,
  polynomialDegree,
  polynomialDivide,
} from '../boxed-expression/polynomials';
import { partialFraction } from '../boxed-expression/factor';
import {
  isFunction,
  isNumber,
  isSymbol,
  sym,
} from '../boxed-expression/type-guards';

//  @todo: implement using Risch Algorithm

/**
 * LIATE priority for choosing 'u' in integration by parts.
 * Higher number = choose as 'u' (to differentiate).
 * Lower number = choose as 'dv' (to integrate).
 *
 * L: Logarithmic (5)
 * I: Inverse trig (4)
 * A: Algebraic/polynomial (3)
 * T: Trigonometric (2)
 * E: Exponential (1)
 */
function liatePriority(expr: Expression, index: string): number {
  if (!expr.has(index)) return 0; // Constants have lowest priority

  const op = expr.operator;

  // Logarithmic functions - highest priority (want to differentiate these)
  if (op === 'Ln' || op === 'Log' || op === 'Log2' || op === 'Log10') return 5;

  // Inverse trig functions
  if (
    op === 'Arcsin' ||
    op === 'Arccos' ||
    op === 'Arctan' ||
    op === 'Arcsec' ||
    op === 'Arccsc' ||
    op === 'Arccot'
  )
    return 4;

  // Algebraic (polynomials, powers of x)
  if (sym(expr) === index) return 3;
  if (
    op === 'Power' &&
    isFunction(expr) &&
    sym(expr.op1) === index &&
    !expr.op2.has(index)
  )
    return 3;
  if (op === 'Sqrt' && isFunction(expr) && expr.op1.has(index)) return 3;

  // Trigonometric functions - lower priority (easier to integrate repeatedly)
  if (
    op === 'Sin' ||
    op === 'Cos' ||
    op === 'Tan' ||
    op === 'Sec' ||
    op === 'Csc' ||
    op === 'Cot'
  )
    return 2;

  // Exponential functions - lowest priority for 'u' (easy to integrate)
  if (op === 'Exp') return 1;
  if (
    op === 'Power' &&
    isFunction(expr) &&
    !expr.op1.has(index) &&
    expr.op2.has(index)
  )
    return 1;

  // Default: treat as algebraic
  return 3;
}

/**
 * Try integration by parts: ∫u·dv = u·v - ∫v·du
 *
 * Returns the result if successful, or null if integration by parts
 * doesn't apply or leads to a more complex integral.
 */
// `tryIntegrationByParts` → `antiderivativeWithByParts` can fall back into
// the full `antiderivative()`, which re-enters by-parts with a fresh
// `depth` of 0 — the threaded depth cap alone does not terminate. For
// integrands with symbolic exponents there is no shrinking measure along
// that cycle (x^m·(a+b·x^(2+2m))² overflowed the stack this way), so the
// TOTAL number of by-parts frames on the stack is capped as well.
let byPartsFrames = 0;
const MAX_BY_PARTS_FRAMES = 8;

function tryIntegrationByParts(
  factors: ReadonlyArray<Expression>,
  index: string,
  depth: number = 0
): Expression | null {
  if (factors.length < 2 || depth > 2) return null; // Limit recursion depth
  if (byPartsFrames >= MAX_BY_PARTS_FRAMES) return null;

  byPartsFrames += 1;
  try {
    // Sort factors by LIATE priority (descending)
    const sorted = [...factors].sort(
      (a, b) => liatePriority(b, index) - liatePriority(a, index)
    );

    // Choose u (highest LIATE priority) and dv (rest)
    const u = sorted[0];
    const dvFactors = sorted.slice(1);
    const dv = dvFactors.length === 1 ? dvFactors[0] : mul(...dvFactors);

    // Compute du = derivative of u
    const du = differentiate(u, index);
    if (!du) return null;

    // Compute v = antiderivative of dv
    // Use a simple check to avoid infinite recursion
    const v = antiderivativeSimple(dv, index);
    if (!v || v.operator === 'Integrate') return null; // Couldn't integrate dv

    // Integration by parts: u·v - ∫v·du
    const uv = u.mul(v);
    const vdu = v.mul(du);

    // Try to integrate v·du
    const integralVdu = antiderivativeWithByParts(vdu, index, depth + 1);
    if (!integralVdu || integralVdu.operator === 'Integrate') return null;

    return uv.sub(integralVdu).simplify();
  } finally {
    byPartsFrames -= 1;
  }
}

/**
 * Simple antiderivative without integration by parts (to avoid recursion).
 */
function antiderivativeSimple(
  fn: Expression,
  index: string
): Expression | null {
  const ce = fn.engine;

  // Is it the index?
  if (sym(fn) === index)
    return ce.expr(['Divide', ['Power', fn, 2], 2]).simplify();

  // Is it a constant?
  if (!fn.has(index))
    return ce.expr(['Multiply', fn, ce.symbol(index)]).simplify();

  // Basic trig
  if (isFunction(fn, 'Sin') && sym(fn.op1) === index)
    return ce.expr(['Negate', ['Cos', index]]);
  if (isFunction(fn, 'Cos') && sym(fn.op1) === index)
    return ce.expr(['Sin', index]);

  // Exponential
  if (isFunction(fn, 'Exp') && sym(fn.op1) === index) return fn;
  if (
    isFunction(fn, 'Power') &&
    sym(fn.op1) === 'ExponentialE' &&
    sym(fn.op2) === index
  )
    return fn;

  // Power rule: x^n -> x^(n+1)/(n+1)
  if (isFunction(fn, 'Power') && sym(fn.op1) === index) {
    const exponent = fn.op2;
    if (!exponent.has(index) && !exponent.isSame(-1)) {
      return ce
        .expr([
          'Divide',
          ['Power', index, ['Add', exponent, 1]],
          ['Add', exponent, 1],
        ])
        .simplify();
    }
  }

  return null;
}

/**
 * If every factor is the index or a power of the index with an index-free
 * exponent, fold the product into a single power x^(Σα).
 *
 * Canonicalization only combines same-base powers with numeric exponents,
 * so symbolic-exponent products (x^m·x^(2m+2), typical after expanding a
 * binomial with symbolic powers) stay as products — and integration by
 * parts has no shrinking measure for them.
 *
 * Returns null when a factor has another shape or when all exponents are
 * numeric (those products are already folded by canonicalization).
 */
function foldIndexPowers(
  factors: ReadonlyArray<Expression>,
  index: string
): Expression | null {
  if (factors.length < 2) return null;
  const ce = factors[0].engine;
  const exponents: Expression[] = [];
  let symbolic = false;
  for (const f of factors) {
    if (sym(f) === index) exponents.push(ce.One);
    else if (
      isFunction(f, 'Power') &&
      sym(f.op1) === index &&
      !f.op2.has(index)
    ) {
      exponents.push(f.op2);
      if (!isNumber(f.op2)) symbolic = true;
    } else return null;
  }
  if (!symbolic) return null;
  return ce.function('Power', [ce.symbol(index), add(...exponents).evaluate()]);
}

/**
 * Antiderivative with optional integration by parts.
 */
function antiderivativeWithByParts(
  fn: Expression,
  index: string,
  depth: number
): Expression {
  // First try simple antiderivative
  const simple = antiderivativeSimple(fn, index);
  if (simple) return simple;

  // For products, try integration by parts
  if (isFunction(fn, 'Multiply')) {
    const variableFactors = fn.ops.filter((op) => op.has(index));
    if (variableFactors.length >= 2) {
      const result = tryIntegrationByParts(variableFactors, index, depth);
      if (result) {
        // Multiply back any constant factors
        const constantFactors = fn.ops.filter((op) => !op.has(index));
        if (constantFactors.length > 0) {
          return mul(...constantFactors).mul(result);
        }
        return result;
      }
    }
  }

  // Fall back to full antiderivative
  return antiderivative(fn, index);
}

/**
 * Try u-substitution: ∫f(g(x))·g'(x) dx = F(g(x))
 * where F is the antiderivative of f.
 *
 * Returns the result if successful, or null if u-substitution doesn't apply.
 */
function tryUSubstitution(fn: Expression, index: string): Expression | null {
  if (!isFunction(fn, 'Multiply')) return null;

  const ce = fn.engine;
  const factors = fn.ops;

  // Look for a factor that's a composite function f(g(x))
  for (let i = 0; i < factors.length; i++) {
    const factor = factors[i];
    const innerFunc = getInnerFunction(factor, index);
    if (!innerFunc) continue;

    const { outer, inner } = innerFunc;

    // Compute g'(x) - the derivative of the inner function
    const innerDerivative = differentiate(inner, index);
    if (!innerDerivative) continue;

    // Get the other factors (what we're matching against g'(x))
    const otherFactors = factors.filter((_, j) => j !== i);
    const otherProduct =
      otherFactors.length === 1 ? otherFactors[0] : mul(...otherFactors);

    // Check if otherProduct = c * g'(x) for some constant c
    const ratio = tryGetConstantRatio(otherProduct, innerDerivative, index);
    if (ratio === null) continue;

    // We have ∫f(g(x))·c·g'(x) dx = c·F(g(x))
    // where F is antiderivative of f

    // Get the antiderivative of the outer function applied to a dummy variable
    const dummy = ce.symbol('_u_');
    const outerAtDummy = applyOuter(outer, dummy, ce);
    const outerAntideriv = antiderivativeSimple(outerAtDummy, '_u_');
    if (!outerAntideriv) continue;

    // Substitute back g(x) for the dummy variable
    const result = outerAntideriv.subs({ _u_: inner });

    // Multiply by the constant ratio
    if (!ratio.isSame(1)) {
      return ratio.mul(result).simplify();
    }
    return result.simplify();
  }

  return null;
}

/**
 * Extract the inner function from a composite function f(g(x)).
 * Returns { outer: f, inner: g(x) } or null if not a composite.
 */
function getInnerFunction(
  expr: Expression,
  index: string
): { outer: string; inner: Expression } | null {
  const op = expr.operator;
  if (!op) return null;

  // Check for trig, exp, log functions with non-trivial argument
  const compositeFunctions = [
    'Sin',
    'Cos',
    'Tan',
    'Sec',
    'Csc',
    'Cot',
    'Exp',
    'Ln',
    'Sinh',
    'Cosh',
    'Tanh',
    'Sqrt',
  ];

  if (compositeFunctions.includes(op) && isFunction(expr) && expr.nops === 1) {
    const inner = expr.op1;
    // Only interesting if inner is more complex than just the variable
    if (sym(inner) === index) return null;
    if (inner.has(index)) {
      return { outer: op, inner };
    }
  }

  // Handle e^(g(x)) which is ['Power', 'ExponentialE', g(x)]
  if (op === 'Power' && isFunction(expr) && sym(expr.op1) === 'ExponentialE') {
    const inner = expr.op2;
    // Only interesting if inner is more complex than just the variable
    if (sym(inner) === index) return null;
    if (inner.has(index)) {
      return { outer: 'Exp', inner };
    }
  }

  return null;
}

/**
 * Apply an outer function to an expression.
 */
function applyOuter(
  outer: string,
  arg: Expression,
  ce: Expression['engine']
): Expression {
  // Exp is represented as ['Power', 'ExponentialE', arg] in canonical form
  if (outer === 'Exp') {
    return ce.expr(['Power', 'ExponentialE', arg]);
  }
  return ce.expr([outer, arg]);
}

/**
 * Try linear substitution: ∫f(ax+b) dx = (1/a)*F(ax+b)
 * Handles cases where the integrand is a composite function with a linear inner function.
 */
function tryLinearSubstitution(
  fn: Expression,
  index: string
): Expression | null {
  const ce = fn.engine;
  const innerInfo = getInnerFunction(fn, index);
  if (!innerInfo) return null;

  const { outer, inner } = innerInfo;

  // Check if inner is linear in index: ax + b form
  // or just ax (when b = 0)
  let coefficient: Expression | null = null;

  if (isFunction(inner, 'Multiply')) {
    // Check if it's c*x form
    const factors = inner.ops;
    const varFactor = factors.find((f) => sym(f) === index);
    if (varFactor) {
      const constFactors = factors.filter((f) => f !== varFactor);
      if (constFactors.every((f) => !f.has(index))) {
        coefficient =
          constFactors.length === 1
            ? constFactors[0]
            : ce.expr(['Multiply', ...constFactors]);
      }
    }
  } else if (isFunction(inner, 'Add')) {
    // Check for ax + b form
    const terms = inner.ops;
    let linearTerm: Expression | null = null;
    const constantTerms: Expression[] = [];

    for (const term of terms) {
      if (!term.has(index)) {
        constantTerms.push(term);
      } else if (sym(term) === index) {
        linearTerm = ce.One;
      } else if (isFunction(term, 'Multiply')) {
        const factors = term.ops;
        const varFactor = factors.find((f) => sym(f) === index);
        if (varFactor) {
          const constFactors = factors.filter((f) => f !== varFactor);
          if (constFactors.every((f) => !f.has(index))) {
            linearTerm =
              constFactors.length === 1
                ? constFactors[0]
                : ce.expr(['Multiply', ...constFactors]);
          }
        }
      } else {
        // Non-linear term, can't apply linear substitution
        return null;
      }
    }

    if (linearTerm) {
      coefficient = linearTerm;
    }
  }

  if (!coefficient) return null;

  // Get the antiderivative of the outer function
  const dummy = ce.symbol('_u_');
  const outerAtDummy = applyOuter(outer, dummy, ce);
  const outerAntideriv = antiderivativeSimple(outerAtDummy, '_u_');
  if (!outerAntideriv) return null;

  // Substitute back the inner function
  const result = outerAntideriv.subs({ _u_: inner });

  // Divide by the coefficient (chain rule)
  return result.div(coefficient).simplify();
}

/**
 * Check if expr1 = c * expr2 for some constant c (w.r.t. index).
 * Returns c if true, null otherwise.
 */
function tryGetConstantRatio(
  expr1: Expression,
  expr2: Expression,
  index: string
): Expression | null {
  const ce = expr1.engine;

  // Simple case: exact match
  if (expr1.isSame(expr2)) return ce.One;

  // Try dividing
  const ratio = expr1.div(expr2).simplify();

  // Check if the ratio is constant (doesn't contain the index)
  if (!ratio.has(index)) {
    return ratio;
  }

  return null;
}

/**
 * Try to integrate cyclic e^x * trig patterns directly.
 * These patterns (e^x * sin(x), e^x * cos(x)) require the "solve for the integral"
 * technique and cannot be solved by standard integration by parts.
 *
 * ∫ e^x * sin(ax+b) dx = (e^x/(a² + 1)) * (sin(ax+b) - a*cos(ax+b))
 * ∫ e^x * cos(ax+b) dx = (e^x/(a² + 1)) * (a*sin(ax+b) + cos(ax+b))
 */
function tryCyclicExpTrigIntegral(
  factors: ReadonlyArray<Expression>,
  index: string
): Expression | null {
  if (factors.length !== 2) return null;

  const ce = factors[0].engine;
  let expFactor: Expression | null = null;
  let trigFactor: Expression | null = null;

  for (const f of factors) {
    // Check for e^x
    if (isFunction(f, 'Exp') && sym(f.op1) === index) {
      expFactor = f;
    } else if (
      isFunction(f, 'Power') &&
      sym(f.op1) === 'ExponentialE' &&
      sym(f.op2) === index
    ) {
      expFactor = f;
    }
    // Check for sin(x) or cos(x) or sin(ax+b) or cos(ax+b)
    else if (f.operator === 'Sin' || f.operator === 'Cos') {
      trigFactor = f;
    }
  }

  if (!expFactor || !isFunction(trigFactor)) return null;

  const trigOp = trigFactor.operator as 'Sin' | 'Cos';
  const trigArg = trigFactor.op1;

  // Case 1: sin(x) or cos(x) - simple argument
  if (sym(trigArg) === index) {
    if (trigOp === 'Sin') {
      // ∫ e^x * sin(x) dx = (e^x/2) * (sin(x) - cos(x))
      return ce
        .expr([
          'Multiply',
          ['Rational', 1, 2],
          ['Exp', index],
          ['Subtract', ['Sin', index], ['Cos', index]],
        ])
        .simplify();
    } else {
      // ∫ e^x * cos(x) dx = (e^x/2) * (sin(x) + cos(x))
      return ce
        .expr([
          'Multiply',
          ['Rational', 1, 2],
          ['Exp', index],
          ['Add', ['Sin', index], ['Cos', index]],
        ])
        .simplify();
    }
  }

  // Case 2: sin(ax) where argument is just a*x (Multiply)
  if (isFunction(trigArg, 'Multiply')) {
    // Find the coefficient and the variable
    let coefficient: Expression | null = null;
    let hasIndex = false;

    for (const op of trigArg.ops) {
      if (sym(op) === index) {
        hasIndex = true;
      } else if (!op.has(index)) {
        coefficient = coefficient ? coefficient.mul(op) : op;
      }
    }

    if (hasIndex && coefficient) {
      const a = coefficient;
      // Coefficient: e^x / (a² + 1)
      const expX = ce.expr(['Exp', index]);
      const denominator = ce.expr(['Add', ['Power', a.json, 2], 1]);
      const coeff = expX.div(denominator);

      if (trigOp === 'Sin') {
        // ∫ e^x * sin(ax) dx = (e^x/(a²+1)) * (sin(ax) - a*cos(ax))
        const sinPart = trigFactor;
        const cosPart = ce.expr(['Cos', trigArg.json]);
        const result = coeff.mul(sinPart.sub(a.mul(cosPart)));
        return result.simplify();
      } else {
        // ∫ e^x * cos(ax) dx = (e^x/(a²+1)) * (a*sin(ax) + cos(ax))
        const sinPart = ce.expr(['Sin', trigArg.json]);
        const cosPart = trigFactor;
        const result = coeff.mul(a.mul(sinPart).add(cosPart));
        return result.simplify();
      }
    }
  }

  // Case 3: sin(ax+b) or cos(ax+b) - linear argument (Add form)
  const linearCoeffs = getLinearCoefficients(trigArg, index);
  if (linearCoeffs) {
    const { a } = linearCoeffs;
    // Coefficient: e^x / (a² + 1)
    const expX = ce.expr(['Exp', index]);
    const denominator = ce.expr(['Add', ['Power', a.json, 2], 1]);
    const coeff = expX.div(denominator);

    if (trigOp === 'Sin') {
      // ∫ e^x * sin(ax+b) dx = (e^x/(a²+1)) * (sin(ax+b) - a*cos(ax+b))
      const sinPart = trigFactor;
      const cosPart = ce.expr(['Cos', trigArg.json]);
      const result = coeff.mul(sinPart.sub(a.mul(cosPart)));
      return result.simplify();
    } else {
      // ∫ e^x * cos(ax+b) dx = (e^x/(a²+1)) * (a*sin(ax+b) + cos(ax+b))
      const sinPart = ce.expr(['Sin', trigArg.json]);
      const cosPart = trigFactor;
      const result = coeff.mul(a.mul(sinPart).add(cosPart));
      return result.simplify();
    }
  }

  return null;
}

/**
 * ∫ P(x)·eˣ·sin(b·x) dx and ∫ P(x)·eˣ·cos(b·x) dx for a polynomial P and a
 * constant b ≠ 0 (no additive phase). The antiderivative has the closed form
 * eˣ·(A(x)·sin(b·x) + B(x)·cos(b·x)) with A, B polynomials of the same degree
 * as P. Differentiating that form and matching gives, for the sin integrand,
 *   A + A′ − b·B = P,   b·A + B + B′ = 0,
 * and for cos the right-hand sides swap (0 and P). Solving degree-by-degree
 * from the top — each step a 2×2 system with determinant 1 + b² — keeps every
 * coefficient exact, with no complex arithmetic and no float leakage.
 *
 * This is the "by-parts composed with the cyclic e·trig solver" case: the pure
 * cyclic solver (`tryCyclicExpTrigIntegral`) is the P = constant instance.
 * Returns null unless the factors are exactly one eˣ, one sin/cos(b·x), and a
 * non-constant polynomial remainder (or if any coefficient is not exact).
 */
function tryPolyExpTrigIntegral(
  factors: ReadonlyArray<Expression>,
  index: string
): Expression | null {
  if (factors.length < 2) return null;
  const ce = factors[0].engine;
  const x = ce.symbol(index);

  let expFactor: Expression | null = null;
  let trigFactor: Expression | null = null;
  const polyFactors: Expression[] = [];
  for (const f of factors) {
    if (
      !expFactor &&
      ((isFunction(f, 'Exp') && sym(f.op1) === index) ||
        (isFunction(f, 'Power') &&
          sym(f.op1) === 'ExponentialE' &&
          sym(f.op2) === index))
    )
      expFactor = f;
    else if (!trigFactor && (isFunction(f, 'Sin') || isFunction(f, 'Cos')))
      trigFactor = f;
    else polyFactors.push(f);
  }
  if (!expFactor || !isFunction(trigFactor) || polyFactors.length === 0)
    return null;

  // The trig argument must be b·x with b a non-zero constant (no phase).
  const trigArg = trigFactor.op1;
  const b = trigArg.div(x).simplify();
  if (b.has(index) || b.isSame(0)) return null;

  // The remaining factors must multiply to a polynomial P(x).
  const polyProduct =
    polyFactors.length === 1 ? polyFactors[0] : mul(...polyFactors);
  const pCoeffs = getPolynomialCoefficients(polyProduct, index);
  if (!pCoeffs) return null;
  const n = pCoeffs.length - 1;
  const isSin = trigFactor.operator === 'Sin';

  // Solve for A, B (coefficients aC, bC ascending) descending from degree n.
  const aC: Expression[] = new Array(n + 1).fill(ce.Zero);
  const bC: Expression[] = new Array(n + 1).fill(ce.Zero);
  const det = ce.One.add(b.mul(b)); // 1 + b²
  const p = (i: number): Expression => pCoeffs[i] ?? ce.Zero;
  for (let i = n; i >= 0; i--) {
    const aHi = i + 1 <= n ? aC[i + 1] : ce.Zero;
    const bHi = i + 1 <= n ? bC[i + 1] : ce.Zero;
    // r1 = (sin ? pᵢ : 0) − (i+1)·a₍ᵢ₊₁₎;  r2 = (sin ? 0 : pᵢ) − (i+1)·b₍ᵢ₊₁₎
    const r1 = (isSin ? p(i) : ce.Zero).sub(ce.number(i + 1).mul(aHi));
    const r2 = (isSin ? ce.Zero : p(i)).sub(ce.number(i + 1).mul(bHi));
    // [1, −b; b, 1]·[aᵢ; bᵢ] = [r1; r2]  ⇒  solve with determinant 1 + b²
    aC[i] = r1.add(b.mul(r2)).div(det);
    bC[i] = r2.sub(b.mul(r1)).div(det);
  }

  const buildPoly = (coeffs: Expression[]): Expression => {
    const terms: Expression[] = [];
    for (let i = 0; i <= n; i++) {
      if (coeffs[i].isSame(0)) continue;
      terms.push(
        i === 0
          ? coeffs[i]
          : ce.function('Multiply', [
              coeffs[i],
              ce.function('Power', [x, ce.number(i)]),
            ])
      );
    }
    return terms.length === 0 ? ce.Zero : add(...terms);
  };

  const result = ce
    .function('Exp', [x])
    .mul(
      add(
        buildPoly(aC).mul(ce.function('Sin', [trigArg])),
        buildPoly(bC).mul(ce.function('Cos', [trigArg]))
      )
    )
    .simplify();

  if (hasInexactNumber(result)) return null;
  return result;
}

function filter(sub: BoxedSubstitution): boolean {
  for (const [k, v] of Object.entries(sub)) {
    if (k !== 'x' && k !== '_x' && v.has('_x')) return false;
  }
  return true;
}

const INTEGRATION_RULES: Rule[] = [
  // (ax+b)^n -> \frac{(ax + b)^{n + 1}}{a(n + 1)}
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], '_n'],
    replace: [
      'Divide',
      ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], ['Add', '_n', 1]],
      ['Multiply', '_a', ['Add', '_n', 1]],
    ],
    condition: (sub) => filter(sub) && !sub._n.isSame(-1),
  },

  // \sqrt{ax + b} -> \frac{2}{3a} (ax + b)^{3/2}
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 1 / 2],
    replace: [
      'Divide',
      ['Multiply', 2, ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 3]],
      ['Multiply', 3, '_a'],
    ],
    condition: (sub) => filter(sub) && isNumber(sub._a),
  },

  // \sqrt[3]{ax + b} -> \frac{3}{4a} (ax + b)^{4/3}
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 1 / 3],
    replace: [
      'Divide',
      ['Multiply', 3, ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 4]],
      ['Multiply', 4, '_a'],
    ],
    condition: (sub) => filter(sub) && isNumber(sub._a),
  },

  // a^x -> \frac{a^x}{\ln(a)} where a is a constant (doesn't contain x)
  {
    match: ['Power', '_a', '_x'],
    replace: ['Divide', ['Power', '_a', '_x'], ['Ln', '_a']],
    condition: (sub) => filter(sub) && !sub._a.has('_x'),
  },

  // (ax+b)^{-1} -> \ln(ax + b) / a
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], -1],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },

  // (x+b)^{-1} -> \ln|x + b| (coefficient of x is implicitly 1)
  {
    match: ['Power', ['Add', '_x', '__b'], -1],
    replace: ['Ln', ['Abs', ['Add', '_x', '__b']]],
    condition: (sub) => filter(sub) && isSymbol(sub._x),
  },

  // 1/(ax + b) -> \ln(ax + b) / a
  {
    match: ['Divide', 1, ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },

  // 1/(x + b) -> \ln|x + b| (coefficient of x is implicitly 1)
  {
    match: ['Divide', 1, ['Add', '_x', '__b']],
    replace: ['Ln', ['Abs', ['Add', '_x', '__b']]],
    condition: (sub) => filter(sub) && isSymbol(sub._x),
  },

  // \ln(ax + b) -> (ax + b) \ln(ax + b) - ax - b
  {
    match: ['Ln', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Subtract',
      ['Multiply', ['Add', ['Multiply', '_a', '_x'], '__b'], ['Ln', '_x']],
      ['Subtract', ['Multiply', '_a', '_x'], '__b'],
    ],
    condition: filter,
  },
  // \exp(ax + b) -> \frac{1}{a} \exp(ax + b)
  {
    match: ['Exp', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Exp', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },

  // \sech^2(ax + b) -> \tanh(ax + b) / a
  {
    match: ['Power', ['Sech', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Divide',
      ['Tanh', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },
  // ∫sin²(ax + b) dx = x/2 − sin(2(ax + b))/(4a)
  {
    match: ['Power', ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Subtract',
      ['Divide', '_x', 2],
      [
        'Divide',
        ['Sin', ['Multiply', 2, ['Add', ['Multiply', '_a', '_x'], '__b']]],
        ['Multiply', 4, '_a'],
      ],
    ],
    condition: filter,
  },
  // ∫cos²(ax + b) dx = x/2 + sin(2(ax + b))/(4a)
  {
    match: ['Power', ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Add',
      ['Divide', '_x', 2],
      [
        'Divide',
        ['Sin', ['Multiply', 2, ['Add', ['Multiply', '_a', '_x'], '__b']]],
        ['Multiply', 4, '_a'],
      ],
    ],
    condition: filter,
  },
  // \sin(ax + b) -> -\cos(ax + b) / a
  {
    match: ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Negate', ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },
  // \cos(ax + b) -> \sin(ax + b) / a
  {
    match: ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },
  // \tan(ax + b) -> \ln(\sec(ax + b)) / a
  {
    match: ['Tan', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \sec(ax + b) -> \ln(\sec(ax + b) + \tan(ax + b)) / a
  {
    match: ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Abs',
          [
            'Add',
            ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']],
            ['Tan', ['Add', ['Multiply', '_a', '_x'], '__b']],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \csc(ax + b) -> -\ln(\csc(ax + b) + \cot(ax + b)) / a
  {
    match: ['Csc', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Abs',
            [
              'Add',
              ['Csc', ['Add', ['Multiply', '_a', '_x'], '__b']],
              ['Cot', ['Add', ['Multiply', '_a', '_x'], '__b']],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \cot(ax + b) -> -\ln(\sin(ax + b)) / a
  {
    match: ['Cot', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        ['Ln', ['Abs', ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      ],
      '_a',
    ],
    condition: filter,
  },

  // \sec^2(ax + b) -> \tan(ax + b) / a
  {
    match: ['Power', ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Divide',
      ['Tan', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },
  // \csc^2(ax + b) -> -\cot(ax + b) / a
  {
    match: ['Power', ['Csc', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Divide',
      ['Negate', ['Cot', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },
  // \sec(ax + b) \tan(ax + b) -> \sec(ax + b) / a
  {
    match: [
      'Multiply',
      ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']],
      ['Tan', ['Add', ['Multiply', '_a', '_x'], '__b']],
    ],
    replace: [
      'Divide',
      ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },
  // \csc(ax + b) \cot(ax + b) -> -\csc(ax + b) / a
  {
    match: [
      'Multiply',
      ['Csc', ['Add', ['Multiply', '_a', '_x'], '__b']],
      ['Cot', ['Add', ['Multiply', '_a', '_x'], '__b']],
    ],
    replace: [
      'Divide',
      ['Negate', ['Csc', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },

  // \sinh(ax + b) -> \frac{1}{a} \ln(\cosh(ax + b))
  {
    match: ['Sinh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Cosh', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \cosh(ax + b) -> \frac{1}{a} \ln(\sinh(ax + b))
  {
    match: ['Cosh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Sinh', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \tanh(ax + b) -> \frac{1}{a} \ln(\sech(ax + b))
  {
    match: ['Tanh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Sech', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \sech(ax + b) -> \frac{1}{a} \ln(\tanh(ax + b))
  {
    match: ['Sech', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      ['Ln', ['Abs', ['Tanh', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      '_a',
    ],
    condition: filter,
  },
  // \csch(ax + b) -> -\frac{1}{a} \ln(\coth(ax + b))
  {
    match: ['Csch', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        ['Ln', ['Abs', ['Coth', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \coth(ax + b) -> -\frac{1}{a} \ln(\csch(ax + b))
  {
    match: ['Coth', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        ['Ln', ['Abs', ['Csch', ['Add', ['Multiply', '_a', '_x'], '__b']]]],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arcsinh(ax + b) -> \frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 + 1})
  {
    match: ['Arsinh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Add',
          ['Add', ['Multiply', '_a', '_x'], '__b'],
          [
            'Sqrt',
            ['Add', ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2], 1],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccosh(ax + b) -> \frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 - 1})
  {
    match: ['Arcosh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Add',
          ['Add', ['Multiply', '_a', '_x'], '__b'],
          [
            'Sqrt',
            [
              'Subtract',
              ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
              1,
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arctanh(ax + b) -> \frac{1}{2a} \ln(\frac{1 + ax + b}{1 - ax - b})
  {
    match: ['Artanh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Divide',
          ['Add', 1, ['Add', ['Multiply', '_a', '_x'], '__b']],
          ['Subtract', 1, ['Add', ['Multiply', '_a', '_x'], '__b']],
        ],
      ],
      ['Multiply', 2, '_a'],
    ],
    condition: filter,
  },
  // \arcsech(ax + b) -> -\frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 - 1})
  {
    match: ['Arsech', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Add',
            ['Add', ['Multiply', '_a', '_x'], '__b'],
            [
              'Sqrt',
              [
                'Subtract',
                ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
                1,
              ],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccsch(ax + b) -> -\frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 + 1})
  {
    match: ['Arcsch', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Add',
            ['Add', ['Multiply', '_a', '_x'], '__b'],
            [
              'Sqrt',
              [
                'Add',
                ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
                1,
              ],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccoth(ax + b) -> \frac{1}{2a} \ln(\frac{ax + b + 1}{ax + b - 1})
  {
    match: ['Arcoth', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Divide',
          ['Add', ['Add', ['Multiply', '_a', '_x'], '__b'], 1],
          ['Subtract', ['Add', ['Multiply', '_a', '_x'], '__b'], 1],
        ],
      ],
      ['Multiply', 2, '_a'],
    ],
    condition: filter,
  },
  // \arccsch(ax + b) -> -\frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 + 1})
  {
    match: ['Arcsch', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Add',
            ['Add', ['Multiply', '_a', '_x'], '__b'],
            [
              'Sqrt',
              [
                'Add',
                ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
                1,
              ],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccoth(ax + b) -> -\frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 - 1})
  {
    match: ['Arcoth', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Negate',
        [
          'Ln',
          [
            'Add',
            ['Add', ['Multiply', '_a', '_x'], '__b'],
            [
              'Sqrt',
              [
                'Subtract',
                ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
                1,
              ],
            ],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arctan(ax + b) -> (1/a) * [(ax+b)*arctan(ax+b) - (1/2)*ln(1+(ax+b)^2)]
  {
    match: ['Arctan', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Subtract',
        [
          'Multiply',
          ['Add', ['Multiply', '_a', '_x'], '__b'],
          ['Arctan', ['Add', ['Multiply', '_a', '_x'], '__b']],
        ],
        [
          'Multiply',
          ['Rational', 1, 2],
          [
            'Ln',
            ['Add', 1, ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2]],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccos(ax + b) -> (1/a) * [(ax+b)*arccos(ax+b) - sqrt(1-(ax+b)^2)]
  {
    match: ['Arccos', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Subtract',
        [
          'Multiply',
          ['Add', ['Multiply', '_a', '_x'], '__b'],
          ['Arccos', ['Add', ['Multiply', '_a', '_x'], '__b']],
        ],
        [
          'Sqrt',
          [
            'Subtract',
            1,
            ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arcsin(ax + b) -> (1/a) * [(ax+b)*arcsin(ax+b) + sqrt(1-(ax+b)^2)]
  {
    match: ['Arcsin', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Add',
        [
          'Multiply',
          ['Add', ['Multiply', '_a', '_x'], '__b'],
          ['Arcsin', ['Add', ['Multiply', '_a', '_x'], '__b']],
        ],
        [
          'Sqrt',
          [
            'Subtract',
            1,
            ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
          ],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },

  //
  // Inverse trig integrals (producing inverse trig functions)
  //

  // 1/(1 + (ax+b)^2) -> arctan(ax+b) / a
  // Canonical form: ['Divide', 1, ['Add', ['Power', ...], 1]]
  {
    match: [
      'Divide',
      1,
      ['Add', ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2], 1],
    ],
    replace: [
      'Divide',
      ['Arctan', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },
  // Also try with 1 first (non-canonical)
  {
    match: [
      'Divide',
      1,
      ['Add', 1, ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2]],
    ],
    replace: [
      'Divide',
      ['Arctan', ['Add', ['Multiply', '_a', '_x'], '__b']],
      '_a',
    ],
    condition: filter,
  },

  //
  // Additional hyperbolic integrals
  //

  // \csch^2(ax + b) -> -\coth(ax + b) / a
  {
    match: ['Power', ['Csch', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Divide',
      ['Negate', ['Coth', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },
  // \sech(ax + b) \tanh(ax + b) -> -\sech(ax + b) / a
  {
    match: [
      'Multiply',
      ['Sech', ['Add', ['Multiply', '_a', '_x'], '__b']],
      ['Tanh', ['Add', ['Multiply', '_a', '_x'], '__b']],
    ],
    replace: [
      'Divide',
      ['Negate', ['Sech', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },
  // \csch(ax + b) \coth(ax + b) -> -\csch(ax + b) / a
  {
    match: [
      'Multiply',
      ['Csch', ['Add', ['Multiply', '_a', '_x'], '__b']],
      ['Coth', ['Add', ['Multiply', '_a', '_x'], '__b']],
    ],
    replace: [
      'Divide',
      ['Negate', ['Csch', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      '_a',
    ],
    condition: filter,
  },

  //
  // Cyclic integration patterns (e^x with trig functions)
  // These require the "solve for the integral" technique
  //

  // e^x * sin(x) -> (e^x/2)(sin(x) - cos(x))
  {
    match: ['Multiply', ['Exp', '_x'], ['Sin', '_x']],
    replace: [
      'Multiply',
      ['Rational', 1, 2],
      ['Exp', '_x'],
      ['Subtract', ['Sin', '_x'], ['Cos', '_x']],
    ],
    condition: (sub) => filter(sub) && isSymbol(sub._x),
  },

  // e^x * cos(x) -> (e^x/2)(sin(x) + cos(x))
  {
    match: ['Multiply', ['Exp', '_x'], ['Cos', '_x']],
    replace: [
      'Multiply',
      ['Rational', 1, 2],
      ['Exp', '_x'],
      ['Add', ['Sin', '_x'], ['Cos', '_x']],
    ],
    condition: (sub) => filter(sub) && isSymbol(sub._x),
  },

  // sin(x) * e^x -> (e^x/2)(sin(x) - cos(x)) (commuted order)
  {
    match: ['Multiply', ['Sin', '_x'], ['Exp', '_x']],
    replace: [
      'Multiply',
      ['Rational', 1, 2],
      ['Exp', '_x'],
      ['Subtract', ['Sin', '_x'], ['Cos', '_x']],
    ],
    condition: (sub) => filter(sub) && isSymbol(sub._x),
  },

  // cos(x) * e^x -> (e^x/2)(sin(x) + cos(x)) (commuted order)
  {
    match: ['Multiply', ['Cos', '_x'], ['Exp', '_x']],
    replace: [
      'Multiply',
      ['Rational', 1, 2],
      ['Exp', '_x'],
      ['Add', ['Sin', '_x'], ['Cos', '_x']],
    ],
    condition: (sub) => filter(sub) && isSymbol(sub._x),
  },

  // e^x * sin(ax) -> (e^x/(a² + 1))(sin(ax) - a*cos(ax)) (no constant term)
  {
    match: ['Multiply', ['Exp', '_x'], ['Sin', ['Multiply', '_a', '_x']]],
    replace: [
      'Multiply',
      ['Divide', ['Exp', '_x'], ['Add', ['Power', '_a', 2], 1]],
      [
        'Subtract',
        ['Sin', ['Multiply', '_a', '_x']],
        ['Multiply', '_a', ['Cos', ['Multiply', '_a', '_x']]],
      ],
    ],
    condition: filter,
  },

  // e^x * cos(ax) -> (e^x/(a² + 1))(a*sin(ax) + cos(ax)) (no constant term)
  {
    match: ['Multiply', ['Exp', '_x'], ['Cos', ['Multiply', '_a', '_x']]],
    replace: [
      'Multiply',
      ['Divide', ['Exp', '_x'], ['Add', ['Power', '_a', 2], 1]],
      [
        'Add',
        ['Multiply', '_a', ['Sin', ['Multiply', '_a', '_x']]],
        ['Cos', ['Multiply', '_a', '_x']],
      ],
    ],
    condition: filter,
  },

  // sin(ax) * e^x -> (e^x/(a² + 1))(sin(ax) - a*cos(ax)) (commuted)
  {
    match: ['Multiply', ['Sin', ['Multiply', '_a', '_x']], ['Exp', '_x']],
    replace: [
      'Multiply',
      ['Divide', ['Exp', '_x'], ['Add', ['Power', '_a', 2], 1]],
      [
        'Subtract',
        ['Sin', ['Multiply', '_a', '_x']],
        ['Multiply', '_a', ['Cos', ['Multiply', '_a', '_x']]],
      ],
    ],
    condition: filter,
  },

  // cos(ax) * e^x -> (e^x/(a² + 1))(a*sin(ax) + cos(ax)) (commuted)
  {
    match: ['Multiply', ['Cos', ['Multiply', '_a', '_x']], ['Exp', '_x']],
    replace: [
      'Multiply',
      ['Divide', ['Exp', '_x'], ['Add', ['Power', '_a', 2], 1]],
      [
        'Add',
        ['Multiply', '_a', ['Sin', ['Multiply', '_a', '_x']]],
        ['Cos', ['Multiply', '_a', '_x']],
      ],
    ],
    condition: filter,
  },

  // General case: e^x * sin(ax + b) -> (e^x/(a² + 1))(sin(ax+b) - a*cos(ax+b))
  {
    match: [
      'Multiply',
      ['Exp', '_x'],
      ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']],
    ],
    replace: [
      'Multiply',
      ['Divide', ['Exp', '_x'], ['Add', ['Power', '_a', 2], 1]],
      [
        'Subtract',
        ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']],
        ['Multiply', '_a', ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      ],
    ],
    condition: filter,
  },

  // General case: e^x * cos(ax + b) -> (e^x/(a² + 1))(a*sin(ax+b) + cos(ax+b))
  {
    match: [
      'Multiply',
      ['Exp', '_x'],
      ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']],
    ],
    replace: [
      'Multiply',
      ['Divide', ['Exp', '_x'], ['Add', ['Power', '_a', 2], 1]],
      [
        'Add',
        ['Multiply', '_a', ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']]],
        ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']],
      ],
    ],
    condition: filter,
  },

  // Commuted order: sin(ax + b) * e^x
  {
    match: [
      'Multiply',
      ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']],
      ['Exp', '_x'],
    ],
    replace: [
      'Multiply',
      ['Divide', ['Exp', '_x'], ['Add', ['Power', '_a', 2], 1]],
      [
        'Subtract',
        ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']],
        ['Multiply', '_a', ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']]],
      ],
    ],
    condition: filter,
  },

  // Commuted order: cos(ax + b) * e^x
  {
    match: [
      'Multiply',
      ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']],
      ['Exp', '_x'],
    ],
    replace: [
      'Multiply',
      ['Divide', ['Exp', '_x'], ['Add', ['Power', '_a', 2], 1]],
      [
        'Add',
        ['Multiply', '_a', ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']]],
        ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']],
      ],
    ],
    condition: filter,
  },
];

/**
 * Check if an expression is a linear function of the variable (ax + b form).
 * Returns the coefficients { a, b } if it is, null otherwise.
 */
function getLinearCoefficients(
  expr: Expression,
  index: string
): { a: Expression; b: Expression } | null {
  const ce = expr.engine;

  // Just the variable: x -> a=1, b=0
  if (sym(expr) === index) {
    return { a: ce.One, b: ce.Zero };
  }

  // A bare c·x with no constant term (e.g. 2x) — linear with intercept 0.
  if (isFunction(expr, 'Multiply')) {
    const varFactor = expr.ops.find((f) => sym(f) === index);
    const rest = expr.ops.filter((f) => sym(f) !== index);
    if (varFactor && rest.every((f) => !f.has(index))) {
      const coeff =
        rest.length === 0 ? ce.One : rest.length === 1 ? rest[0] : mul(...rest);
      return { a: coeff, b: ce.Zero };
    }
  }

  // Must be an Add expression
  if (!isFunction(expr, 'Add')) return null;

  const ops = expr.ops;
  let a: Expression | null = null;
  let b: Expression = ce.Zero;

  for (const rawOp of ops) {
    // Unwrap a leading Negate into a −1 sign (the −x in `2 − x` is
    // `Negate(x)`, not `Multiply(-1, x)`).
    const neg = isFunction(rawOp, 'Negate');
    const op = neg ? rawOp.op1 : rawOp;
    const sign = neg ? ce.NegativeOne : ce.One;

    if (!op.has(index)) {
      // Constant term
      b = b.add(sign.mul(op));
    } else if (sym(op) === index) {
      // Just x (coefficient 1)
      a = a ? a.add(sign) : sign;
    } else if (isFunction(op, 'Multiply')) {
      // Check for c*x form
      const factors = op.ops;
      const varFactor = factors.find((f) => sym(f) === index);
      if (varFactor) {
        const constFactors = factors.filter((f) => sym(f) !== index);
        if (constFactors.every((f) => !f.has(index))) {
          const coeff =
            constFactors.length === 1 ? constFactors[0] : mul(...constFactors);
          const signedCoeff = sign.mul(coeff);
          a = a ? a.add(signedCoeff) : signedCoeff;
        } else {
          // Not a linear term
          return null;
        }
      } else {
        // Variable appears in non-linear way
        return null;
      }
    } else {
      // Not a linear term (e.g., x^2, sin(x), etc.)
      return null;
    }
  }

  if (a === null) return null; // No variable term found

  return { a, b };
}

/**
 * Extract coefficients from a quadratic expression ax² + bx + c.
 * Returns null if the expression is not quadratic in the given variable.
 */
function getQuadraticCoefficients(
  expr: Expression,
  index: string
): { a: Expression; b: Expression; c: Expression } | null {
  const ce = expr.engine;

  // Must be an Add expression (or equivalent)
  if (expr.operator !== 'Add') {
    // Check if it's just x² or c*x²
    if (
      isFunction(expr, 'Power') &&
      sym(expr.op1) === index &&
      expr.op2.isSame(2)
    ) {
      return { a: ce.One, b: ce.Zero, c: ce.Zero };
    }
    if (isFunction(expr, 'Multiply')) {
      const factors = expr.ops;
      const powerFactor = factors.find(
        (f) => isFunction(f, 'Power') && sym(f.op1) === index && f.op2.isSame(2)
      );
      if (powerFactor) {
        const constFactors = factors.filter((f) => f !== powerFactor);
        const coeff =
          constFactors.length === 0
            ? ce.One
            : constFactors.length === 1
              ? constFactors[0]
              : ce.expr(['Multiply', ...constFactors]);
        if (!coeff.has(index)) {
          return { a: coeff, b: ce.Zero, c: ce.Zero };
        }
      }
    }
    return null;
  }

  if (!isFunction(expr)) return null;
  const ops = expr.ops;
  let a: Expression = ce.Zero; // coefficient of x²
  let b: Expression = ce.Zero; // coefficient of x
  let c: Expression = ce.Zero; // constant term

  for (const rawOp of ops) {
    // Unwrap a leading Negate into a −1 sign on the term. The canonical form
    // of e.g. `x² − x + 1` represents the −x term as `Negate(x)` (not
    // `Multiply(-1, x)`), which the cases below would otherwise reject —
    // sending rational integrands like 1/(x³+1) to the numeric fallback and
    // leaking float coefficients.
    const neg = isFunction(rawOp, 'Negate');
    const op = neg ? rawOp.op1 : rawOp;
    const sign = neg ? ce.NegativeOne : ce.One;

    if (!op.has(index)) {
      // Constant term
      c = c.add(sign.mul(op));
    } else if (sym(op) === index) {
      // Just x (coefficient 1 for linear term)
      b = b.add(sign);
    } else if (
      isFunction(op, 'Power') &&
      sym(op.op1) === index &&
      op.op2.isSame(2)
    ) {
      // x² term
      a = a.add(sign);
    } else if (isFunction(op, 'Multiply')) {
      const factors = op.ops;
      // Check for c*x² form
      const powerFactor = factors.find(
        (f) => isFunction(f, 'Power') && sym(f.op1) === index && f.op2.isSame(2)
      );
      if (powerFactor) {
        const constFactors = factors.filter((f) => f !== powerFactor);
        if (constFactors.every((f) => !f.has(index))) {
          const coeff =
            constFactors.length === 0
              ? ce.One
              : constFactors.length === 1
                ? constFactors[0]
                : ce.expr(['Multiply', ...constFactors]);
          a = a.add(sign.mul(coeff));
          continue;
        }
      }
      // Check for c*x form (linear term)
      const varFactor = factors.find((f) => sym(f) === index);
      if (varFactor) {
        const constFactors = factors.filter((f) => sym(f) !== index);
        if (constFactors.every((f) => !f.has(index))) {
          const coeff =
            constFactors.length === 0
              ? ce.One
              : constFactors.length === 1
                ? constFactors[0]
                : ce.expr(['Multiply', ...constFactors]);
          b = b.add(sign.mul(coeff));
          continue;
        }
      }
      // Not a valid quadratic term
      return null;
    } else {
      // Not a quadratic expression
      return null;
    }
  }

  // Must have non-zero x² coefficient to be quadratic
  if (a.isSame(0)) return null;

  return { a: a.simplify(), b: b.simplify(), c: c.simplify() };
}

/** Calculate the antiderivative of fn, as an expression (not a function) */
/** True if any number literal in the expression tree is inexact (a float). */
function hasInexactNumber(expr: Expression): boolean {
  if (isNumber(expr) && !expr.isExact) return true;
  if (isFunction(expr)) return expr.ops.some(hasInexactNumber);
  return false;
}

/**
 * ∫ (B·x + C)/(x² + b·x + c) dx for an irreducible quadratic (4c − b² > 0):
 *
 *   (B/2)·ln(x²+bx+c) + (C − B·b/2)·(2/√(4c−b²))·arctan((2x+b)/√(4c−b²))
 *
 * The quadratic is positive-definite when irreducible, so no Abs is needed.
 * For b = 0 the first term vanishes when B = 0 (the pure-arctan case).
 * Coefficients are kept symbolic; the biquadratic caller guards against
 * float leakage in the assembled result.
 */
function integrateLinearOverIrreducibleQuadratic(
  B: Expression,
  C: Expression,
  b: Expression,
  c: Expression,
  index: string
): Expression {
  const ce = B.engine;
  const x = ce.symbol(index);
  // Omit the b·x term when b = 0: canonical Multiply(0, x) stays `0·x` (since
  // 0·∞ = NaN), which would surface as `x² + 0x + c` inside the Ln.
  const quadTerms = [ce.function('Power', [x, ce.number(2)])];
  if (!b.isSame(0)) quadTerms.push(ce.function('Multiply', [b, x]));
  quadTerms.push(c);
  const quad = ce.function('Add', quadTerms);
  // (B/2)·ln(x²+bx+c)
  const lnTerm = B.div(ce.number(2)).mul(ce.function('Ln', [quad]));
  // (C − B·b/2)·(2/√(4c−b²))·arctan((2x+b)/√(4c−b²))
  const fourCMinusB2 = ce.number(4).mul(c).sub(b.mul(b)).simplify();
  const sqrtDisc = ce.function('Sqrt', [fourCMinusB2]).simplify();
  const arctanArg = ce
    .function('Add', [ce.function('Multiply', [ce.number(2), x]), b])
    .div(sqrtDisc);
  const arctanCoeff = C.sub(B.mul(b).div(ce.number(2))).mul(
    ce.number(2).div(sqrtDisc)
  );
  const arctanTerm = arctanCoeff.mul(ce.function('Arctan', [arctanArg]));
  return add(lnTerm, arctanTerm);
}

/**
 * ∫ N(x)/(A·x⁴ + B·x² + C) dx for a biquadratic denominator (only even
 * powers) with no real roots (q = C/A > 0), by factoring it into two real
 * irreducible quadratics and integrating each (β·x + γ)/(x²+b·x+c) piece.
 *
 * Substituting z = x² gives z² + p·z + q (p = B/A, q = C/A), discriminant
 * Δ = p² − 4q. Two real factorizations arise:
 *   • Δ < 0 → conjugate complex z-roots → (x²+s·x+t)(x²−s·x+t), with
 *     t = √q and s = √(2t − p).   [e.g. x⁴+1 → (x²+√2x+1)(x²−√2x+1)]
 *   • Δ ≥ 0, p > 0 → real positive z-roots → (x²+f₁)(x²+f₂), with
 *     f₁,f₂ = (p ± √Δ)/2.   [e.g. x⁴+5x²+4 → (x²+1)(x²+4)]
 * (Δ ≥ 0 with p ≤ 0 means real linear roots — handled by the root paths.)
 *
 * `Factor`/`findUnivariateRoots` leave x⁴+1 unfactored (the real factors
 * need the irrational √2 coefficient), so without this it falls to the
 * numeric partial-fraction fallback and leaks float coefficients. The exact
 * partial-fraction numerators (b₁x+c₁ over x²+e₁x+f₁, b₂x+c₂ over x²+e₂x+f₂)
 * follow from matching M = N/A = (b₁x+c₁)(x²+e₂x+f₂) + (b₂x+c₂)(x²+e₁x+f₁).
 *
 * Returns null when the denominator is not a suitable biquadratic, the
 * factorization is not real, or any float leaks into the result (then the
 * numeric fallback takes over).
 */
function tryBiquadraticPartialFractions(
  numerator: Expression,
  denominator: Expression,
  index: string
): Expression | null {
  const ce = denominator.engine;
  if (polynomialDegree(denominator, index) !== 4) return null;
  if (polynomialDegree(numerator, index) > 3) return null;

  const dCoeffs = getPolynomialCoefficients(denominator, index);
  if (!dCoeffs || dCoeffs.length !== 5) return null;
  const [Cc, d1, Bc, d3, A] = dCoeffs;
  // Biquadratic: no odd-power terms.
  if (!d1.isSame(0) || !d3.isSame(0) || A.isSame(0)) return null;

  // Coefficients must be real numbers to factor.
  const aN = A.N().re;
  const bN = Bc.N().re;
  const cN = Cc.N().re;
  if (aN === null || bN === null || cN === null) return null;

  const p = Bc.div(A); // B/A
  const q = Cc.div(A); // C/A
  const pN = bN / aN;
  const qN = cN / aN;
  if (qN <= 0) return null; // q ≤ 0 ⇒ real linear roots — not this path
  const deltaN = pN * pN - 4 * qN; // discriminant of z² + p·z + q

  // The two real quadratic factors x² + eᵢ·x + fᵢ.
  let e1: Expression, f1: Expression, e2: Expression, f2: Expression;
  if (deltaN < 0) {
    // Case (ii): conjugate complex z-roots.
    const t = q.sqrt(); // √q
    const s = ce.number(2).mul(t).sub(p).sqrt(); // √(2t − p)
    e1 = s;
    f1 = t;
    e2 = s.neg();
    f2 = t;
  } else {
    // Case (i): real z-roots; both must be positive (p > 0) for the factors
    // to be irreducible quadratics with no real x-roots.
    if (pN <= 0) return null;
    const sqrtDelta = p.mul(p).sub(ce.number(4).mul(q)).sqrt(); // √(p²−4q)
    f1 = p.add(sqrtDelta).div(ce.number(2)); // (p+√Δ)/2
    f2 = p.sub(sqrtDelta).div(ce.number(2)); // (p−√Δ)/2
    e1 = ce.Zero;
    e2 = ce.Zero;
    // A repeated quadratic (f₁ = f₂) is a square denominator — handled
    // elsewhere; the partial-fraction solve below would divide by zero.
    const diffN = f1.sub(f2).N().re;
    if (diffN === null || diffN === 0) return null;
  }

  // Partial-fraction numerators b₁x+c₁ (over x²+e₁x+f₁) and b₂x+c₂ (over
  // x²+e₂x+f₂), from M = N/A with coefficients mₖ (ascending, padded).
  const M = numerator.div(A);
  const mCoeffs = getPolynomialCoefficients(M, index);
  if (!mCoeffs) return null;
  const m = (k: number): Expression => mCoeffs[k] ?? ce.Zero;
  const m0 = m(0);
  const m1 = m(1);
  const m2 = m(2);
  const m3 = m(3);

  let b1: Expression, c1: Expression, b2: Expression, c2: Expression;
  if (deltaN < 0) {
    // Symmetric factors (e₂ = −e₁ = −s, f₁ = f₂ = t): work with sums and
    // differences. Bsum = b₁+b₂, Csum = c₁+c₂, etc.
    const s = e1;
    const t = f1;
    const bSum = m3; // b₁ + b₂
    const cSum = m0.div(t); // c₁ + c₂  (from t·(c₁+c₂) = m₀)
    const bDiff = m2.sub(cSum).div(s); // b₂ − b₁
    const cDiff = m1.sub(t.mul(m3)).div(s); // c₂ − c₁
    b1 = bSum.sub(bDiff).div(ce.number(2));
    b2 = bSum.add(bDiff).div(ce.number(2));
    c1 = cSum.sub(cDiff).div(ce.number(2));
    c2 = cSum.add(cDiff).div(ce.number(2));
  } else {
    // Distinct constant factors (e₁ = e₂ = 0, f₁ ≠ f₂): the b's and c's
    // decouple. f₂·b₁ + f₁·b₂ = m₁ with b₁+b₂ = m₃, etc.
    const den = f2.sub(f1);
    b1 = m1.sub(f1.mul(m3)).div(den);
    b2 = f2.mul(m3).sub(m1).div(den);
    c1 = m0.sub(f1.mul(m2)).div(den);
    c2 = f2.mul(m2).sub(m0).div(den);
  }

  const result = add(
    integrateLinearOverIrreducibleQuadratic(b1, c1, e1, f1, index),
    integrateLinearOverIrreducibleQuadratic(b2, c2, e2, f2, index)
  ).simplify();

  // Fail safe: if any radical combination folded to a float, defer to the
  // numeric fallback rather than emit a leaked coefficient.
  if (hasInexactNumber(result)) return null;
  return result;
}

/**
 * Reduce a polynomial (ascending coefficients) modulo the monic quadratic
 * x² + b·x + c, returning [C, B] for the remainder C + B·x. Horner in the
 * field ℚ[x]/(x²+bx+c): each ·x step sends u + v·x ↦ −v·c + (u − v·b)·x
 * (since x² ≡ −b·x − c). All arithmetic stays exact-rational.
 */
function reduceModMonicQuadratic(
  coeffs: ReadonlyArray<Expression>,
  b: Expression,
  c: Expression
): [Expression, Expression] {
  const ce = b.engine;
  let u: Expression = ce.Zero; // constant part
  let v: Expression = ce.Zero; // x-coefficient part
  for (let i = coeffs.length - 1; i >= 0; i--) {
    // (u + v·x)·x ≡ −v·c + (u − v·b)·x
    const mu = v.mul(c).neg();
    const mv = u.sub(v.mul(b));
    u = mu.add(coeffs[i]);
    v = mv;
  }
  return [u, v];
}

/**
 * ∫ P(x)/Q(x) dx by exact symbolic partial fractions when Q factors over ℚ
 * into *distinct* linear and irreducible-quadratic factors (a squarefree
 * rational denominator). `Factor` already splits e.g. x⁴−1 → (x−1)(x+1)(x²+1)
 * and x⁶−1 → (x−1)(x+1)(x²+x+1)(x²−x+1), but the existing symbolic paths only
 * cover narrow shapes (all-real-roots cover-up; one linear × one quadratic in
 * Case F), so mixed factorisations fell to the numeric fallback and leaked
 * floats. This recovers the exact closed form.
 *
 *   • Linear factor (x − r): residue A = P(r)/[Q/(x−r)]ᵣ, contributing
 *     A·ln|x − r|.
 *   • Irreducible quadratic factor F = x²+b·x+c: the numerator N (deg ≤ 1) is
 *     P·(Q/F)⁻¹ reduced in the field ℚ[x]/(F) (conjugate-based inverse, all
 *     rational), integrated by `integrateLinearOverIrreducibleQuadratic`.
 *
 * Returns null when Q does not fully split into distinct linear/quadratic
 * factors (e.g. a genuinely ℚ-irreducible quartic like x⁴+x+1, which `Factor`
 * leaves whole — that needs casus-irreducibilis radicals and stays on the
 * numeric path), when a factor is repeated, or when any float leaks.
 */
function trySymbolicPartialFractions(
  numerator: Expression,
  denominator: Expression,
  index: string
): Expression | null {
  const ce = denominator.engine;
  const x = ce.symbol(index);

  const denDeg = polynomialDegree(denominator, index);
  if (denDeg < 2) return null;
  const numDeg = polynomialDegree(numerator, index);
  if (numDeg < 0 || numDeg >= denDeg) return null; // need a proper fraction

  // Factor Q over ℚ. A denominator that does not split stays whole (degree ≥ 3
  // factor) — the numeric fallback handles it.
  const factored = ce.box(['Factor', denominator]).evaluate();
  const factorList = isFunction(factored, 'Multiply')
    ? [...factored.ops]
    : [factored];

  const linearRoots: Expression[] = [];
  const quadFactors: { b: Expression; c: Expression }[] = [];
  for (const f of factorList) {
    if (!f.has(index)) continue; // numeric (constant) factor — part of Q
    if (isFunction(f, 'Power')) return null; // repeated factor — not squarefree
    const deg = polynomialDegree(f, index);
    if (deg === 1) {
      const lin = getLinearCoefficients(f, index);
      if (!lin) return null;
      linearRoots.push(lin.b.div(lin.a).neg()); // root r = −b/a
    } else if (deg === 2) {
      const quad = getQuadraticCoefficients(f, index);
      if (!quad) return null;
      const b = quad.b.div(quad.a); // monic b
      const c = quad.c.div(quad.a); // monic c
      const disc = b.mul(b).sub(ce.number(4).mul(c)).N().re;
      if (disc === null || disc >= 0) return null; // must be irreducible
      quadFactors.push({ b, c });
    } else return null; // degree ≥ 3 factor — did not split over ℚ
  }
  if (linearRoots.length + quadFactors.length < 1) return null;

  const terms: Expression[] = [];

  // Linear factors: residue A = P(r) / [Q/(x−r)](r).
  for (const r of linearRoots) {
    const divisor = ce.function('Subtract', [x, r]); // x − r
    const div = polynomialDivide(denominator, divisor, index);
    if (!div || !div[1].isSame(0)) return null;
    const cofactorAtR = div[0].subs({ [index]: r }).evaluate();
    if (cofactorAtR.isSame(0)) return null; // repeated root
    const A = numerator
      .subs({ [index]: r })
      .evaluate()
      .div(cofactorAtR);
    terms.push(A.mul(ce.function('Ln', [ce.function('Abs', [divisor])])));
  }

  // Irreducible quadratic factors: numerator N = P·(Q/F)⁻¹ in ℚ[x]/(F).
  for (const { b, c } of quadFactors) {
    const F = ce.function('Add', [
      ce.function('Power', [x, ce.number(2)]),
      ce.function('Multiply', [b, x]),
      c,
    ]);
    const div = polynomialDivide(denominator, F, index);
    if (!div || !div[1].isSame(0)) return null;
    const cofCoeffs = getPolynomialCoefficients(div[0], index);
    const numCoeffs = getPolynomialCoefficients(numerator, index);
    if (!cofCoeffs || !numCoeffs) return null;

    // Reduce cofactor and numerator into ℚ[x]/(F): p + q·x and a + a'·x.
    const [p, qq] = reduceModMonicQuadratic(cofCoeffs, b, c);
    const [a0, a1] = reduceModMonicQuadratic(numCoeffs, b, c);

    // (p + q·x)⁻¹ = ((p − q·b) − q·x)/D with D = p² − p·q·b + q²·c.
    const D = p.mul(p).sub(p.mul(qq).mul(b)).add(qq.mul(qq).mul(c));
    if (D.isSame(0)) return null;
    const s0 = p.sub(qq.mul(b)).div(D); // inverse constant part
    const s1 = qq.neg().div(D); // inverse x-coefficient

    // N = (a0 + a1·x)·(s0 + s1·x) reduced mod F (x² ≡ −b·x − c):
    //   const = a0·s0 − a1·s1·c,  x-coeff = a0·s1 + a1·s0 − a1·s1·b.
    const Bn = a0.mul(s1).add(a1.mul(s0)).sub(a1.mul(s1).mul(b));
    const Cn = a0.mul(s0).sub(a1.mul(s1).mul(c));
    terms.push(integrateLinearOverIrreducibleQuadratic(Bn, Cn, b, c, index));
  }

  const result = add(...terms).simplify();
  if (hasInexactNumber(result)) return null;
  return result;
}

/**
 * ∫ 1/Q(x) dx for a denominator with machine-number coefficients and
 * distinct roots, by full partial fractions over ℂ:
 *
 *    1/Q = Σ Aᵢ/(x − rᵢ),  Aᵢ = 1/Q′(rᵢ)
 *
 * Real roots contribute Aᵢ·ln|x − rᵢ|; conjugate pairs r = α ± βi combine
 * into Re(A)·ln((x−α)² + β²) − 2·Im(A)·arctan((x−α)/β), keeping the
 * result real. Returns null when the coefficients are not all numeric,
 * the degree is < 2, or roots are repeated/non-converged.
 */
function numericPartialFractions(
  denominator: Expression,
  index: string
): Expression | null {
  const ce = denominator.engine;

  const coeffExprs = getPolynomialCoefficients(denominator, index);
  if (!coeffExprs || coeffExprs.length < 3) return null; // degree < 2

  const coeffs: number[] = [];
  for (const cf of coeffExprs) {
    const v = cf.N();
    if (!isNumber(v) || v.im !== 0 || !Number.isFinite(v.re)) return null;
    coeffs.push(v.re);
  }
  if (coeffs[coeffs.length - 1] === 0) return null;

  const roots = durandKernerRoots(coeffs, ce._deadline);
  if (!roots) return null;

  // All roots equal a real r: Q = aₙ(x−r)ⁿ, so
  // ∫1/Q dx = −1/(aₙ·(n−1)·(x−r)^(n−1)). Handles expanded perfect powers
  // like x²−2x+1 that the Power-shaped repeated-linear-root case misses.
  {
    const n = roots.length;
    const mean = roots.reduce((s, r) => s.add(r), new Complex(0, 0)).div(n);
    const allEqual =
      Math.abs(mean.im) <= 1e-7 * (1 + mean.abs()) &&
      roots.every((r) => r.sub(mean).abs() <= 1e-5 * (1 + mean.abs()));
    if (allEqual && n >= 2) {
      const an = coeffs[coeffs.length - 1];
      const r0 = mean.re;
      // Verify Q(z) ≈ aₙ(z−r₀)ⁿ at an off-root test point
      const z = new Complex(r0 + 1.7239, 0.41937);
      let qApprox = new Complex(an, 0);
      for (let k = 0; k < n; k++) qApprox = qApprox.mul(z.sub(r0));
      const qz = (() => {
        let acc = new Complex(coeffs[coeffs.length - 1], 0);
        for (let i = coeffs.length - 2; i >= 0; i--)
          acc = acc.mul(z).add(coeffs[i]);
        return acc;
      })();
      if (qz.sub(qApprox).abs() <= 1e-8 * (1 + qz.abs())) {
        const x = ce.symbol(index);
        const shifted = x.sub(ce.number(r0));
        return ce
          .number(-1 / (an * (n - 1)))
          .div(shifted.pow(ce.number(n - 1)))
          .evaluate();
      }
      return null;
    }
  }

  // Distinct roots only (repeated roots need a different decomposition).
  // Durand–Kerner splits a double root into a pair ~√ε apart, so use a
  // loose tolerance here; the residual check below is the real gate.
  for (let i = 0; i < roots.length; i++)
    for (let j = i + 1; j < roots.length; j++)
      if (roots[i].sub(roots[j]).abs() < 1e-6 * (1 + roots[i].abs()))
        return null;

  // Q′ with numeric coefficients, for the residues Aᵢ = 1/Q′(rᵢ)
  const derivCoeffs = coeffs.slice(1).map((a, i) => a * (i + 1));
  const evalDeriv = (z: Complex): Complex => {
    let r = new Complex(derivCoeffs[derivCoeffs.length - 1], 0);
    for (let i = derivCoeffs.length - 2; i >= 0; i--)
      r = r.mul(z).add(derivCoeffs[i]);
    return r;
  };

  // A-posteriori check: the decomposition 1/Q = Σ 1/(Q′(rᵢ)·(x−rᵢ)) only
  // holds for simple roots. Verify it numerically at test points away from
  // the roots — this rejects near-repeated roots that slipped past the
  // distance check (e.g. (1−x⁴)², whose paired roots produced ~1e8-sized
  // spurious residues), as well as poorly converged root sets.
  const evalQ = (z: Complex): Complex => {
    let r = new Complex(coeffs[coeffs.length - 1], 0);
    for (let i = coeffs.length - 2; i >= 0; i--) r = r.mul(z).add(coeffs[i]);
    return r;
  };
  for (const t of [0.53719, -1.29137, 3.41259]) {
    const z = new Complex(t, 0.31407); // off-axis: avoids real roots too
    if (roots.some((r) => z.sub(r).abs() < 1e-3)) continue;
    const lhs = new Complex(1, 0).div(evalQ(z));
    let rhs = new Complex(0, 0);
    for (const r of roots)
      rhs = rhs.add(new Complex(1, 0).div(evalDeriv(r).mul(z.sub(r))));
    if (lhs.sub(rhs).abs() > 1e-8 * (1 + lhs.abs())) return null;
  }

  const REAL_TOL = 1e-9;
  const x = ce.symbol(index);
  const terms: Expression[] = [];

  for (const r of roots) {
    if (Math.abs(r.im) <= REAL_TOL * (1 + r.abs())) {
      // Real root: A·ln|x − r|
      const A = new Complex(1, 0).div(evalDeriv(new Complex(r.re, 0)));
      if (Math.abs(A.im) > 1e-9 * (1 + A.abs())) return null; // inconsistent
      terms.push(
        ce
          .number(A.re)
          .mul(ce.expr(['Ln', ['Abs', x.sub(ce.number(r.re)).json as any]]))
      );
    } else if (r.im > 0) {
      // One representative per conjugate pair (α + βi, β > 0):
      // Re(A)·ln((x−α)² + β²) − 2·Im(A)·arctan((x−α)/β)
      const A = new Complex(1, 0).div(evalDeriv(r));
      const alpha = r.re;
      const beta = r.im;
      const shifted = x.sub(ce.number(alpha));
      const quad = shifted.mul(shifted).add(ce.number(beta * beta));
      terms.push(ce.number(A.re).mul(ce.expr(['Ln', quad.json as any])));
      terms.push(
        ce
          .number(-2 * A.im)
          .mul(ce.expr(['Arctan', shifted.div(ce.number(beta)).json as any]))
      );
    }
    // r.im < 0: handled by its conjugate
  }

  return add(...terms).evaluate();
}

/**
 * Apply the power rule ∫xⁿ dx = xⁿ⁺¹/(n+1) (n ≠ −1). `index` is the variable
 * name and `exponent` is n as a boxed number.
 */
function integrateIndexPower(index: string, exponent: Expression): Expression {
  const ce = exponent.engine;
  const newExp = exponent.add(ce.One);
  return ce.function('Divide', [
    ce.function('Power', [ce.symbol(index), newExp]),
    newExp,
  ]);
}

/**
 * ∫ e^(a·x² + b·x + c) dx for a numeric, a ≠ 0 (the Gaussian integral).
 *
 * Complete the square: a·x²+b·x+c = a·(x − q)² + r, with q = −b/(2a),
 * r = c − b²/(4a). Then, with u = x − q,
 *   a < 0:  ∫ = e^r · ½·√(π/(−a)) · Erf(√(−a)·u)
 *   a > 0:  ∫ = e^r · ½·√(π/a)   · Erfi(√a·u)
 *
 * Returns null unless the exponent is a numeric quadratic in `index`.
 */
function tryGaussianIntegral(fn: Expression, index: string): Expression | null {
  const ce = fn.engine;

  // Identify e^(arg): either Exp(arg) or Power(ExponentialE, arg).
  let arg: Expression | null = null;
  if (isFunction(fn, 'Exp')) arg = fn.op1;
  else if (isFunction(fn, 'Power') && sym(fn.op1) === 'ExponentialE')
    arg = fn.op2;
  if (!arg || !arg.has(index)) return null;

  const coeffs = getPolynomialCoefficients(arg, index);
  if (!coeffs || coeffs.length !== 3) return null; // need exact degree 2
  const [c, b, a] = coeffs;
  if (a.has(index) || b.has(index) || c.has(index)) return null;

  // The sign of `a` selects Erf vs Erfi, so we need a known numeric value.
  const aVal = a.N().re;
  if (aVal === null || aVal === 0 || !Number.isFinite(aVal)) return null;

  const q = b.neg().div(ce.number(2).mul(a)); // −b/(2a)
  const r = c.sub(b.mul(b).div(ce.number(4).mul(a))); // c − b²/(4a)
  const eR = ce.function('Exp', [r]);
  const u = ce.symbol(index).sub(q);

  const p = aVal < 0 ? a.neg() : a; // |a| > 0
  const sqrtP = ce.function('Sqrt', [p]);
  const coef = ce.function('Sqrt', [ce.Pi.div(p)]).div(ce.number(2));
  const special = ce.function(aVal < 0 ? 'Erf' : 'Erfi', [sqrtP.mul(u)]);
  return eR.mul(coef).mul(special);
}

/**
 * ∫ cos(a·x²) dx = √(π/(2a))·FresnelC(√(2a/π)·x) and
 * ∫ sin(a·x²) dx = √(π/(2a))·FresnelS(√(2a/π)·x), for numeric a > 0.
 *
 * cos is even, so a < 0 uses |a|; sin is odd, so a < 0 negates the result.
 * Restricted to a pure quadratic argument (no linear or constant term).
 */
function tryFresnelIntegral(fn: Expression, index: string): Expression | null {
  if (!isFunction(fn, 'Cos') && !isFunction(fn, 'Sin')) return null;
  const ce = fn.engine;
  const isCos = isFunction(fn, 'Cos');
  const arg = fn.op1;
  if (!arg.has(index)) return null;

  const coeffs = getPolynomialCoefficients(arg, index);
  if (!coeffs || coeffs.length !== 3) return null;
  const [c, b, a] = coeffs;
  if (!c.isSame(0) || !b.isSame(0)) return null; // pure a·x² only

  const aVal = a.N().re;
  if (aVal === null || aVal === 0 || !Number.isFinite(aVal)) return null;

  const aAbs = aVal < 0 ? a.neg() : a;
  const twoA = ce.number(2).mul(aAbs);
  const scale = ce.function('Sqrt', [twoA.div(ce.Pi)]); // √(2a/π)
  const coef = ce.function('Sqrt', [ce.Pi.div(twoA)]); // √(π/(2a))
  const fres = ce.function(isCos ? 'FresnelC' : 'FresnelS', [
    scale.mul(ce.symbol(index)),
  ]);
  let result = coef.mul(fres);
  if (!isCos && aVal < 0) result = result.neg(); // sin is odd
  return result;
}

/**
 * ∫ secⁿx dx / ∫ cscⁿx dx for integer n ≥ 0 via the standard reduction
 * formulas, terminating at the ∫sec x / ∫csc x logarithmic base cases.
 *   ∫secⁿx dx = secⁿ⁻²x·tan x/(n−1) + (n−2)/(n−1)·∫secⁿ⁻²x dx
 *   ∫cscⁿx dx = −cscⁿ⁻²x·cot x/(n−1) + (n−2)/(n−1)·∫cscⁿ⁻²x dx
 */
function integrateSecCscPower(
  op: 'Sec' | 'Csc',
  n: number,
  index: string,
  ce: Expression['engine']
): Expression {
  const x = ce.symbol(index);
  if (n === 0) return x;
  if (op === 'Sec') {
    const sec = ce.function('Sec', [x]);
    const tan = ce.function('Tan', [x]);
    if (n === 1) return ce.function('Ln', [ce.function('Abs', [sec.add(tan)])]);
    const term1 = sec
      .pow(ce.number(n - 2))
      .mul(tan)
      .div(ce.number(n - 1));
    const rest = integrateSecCscPower('Sec', n - 2, index, ce);
    return add(
      term1,
      ce
        .number(n - 2)
        .div(ce.number(n - 1))
        .mul(rest)
    );
  }
  const csc = ce.function('Csc', [x]);
  const cot = ce.function('Cot', [x]);
  if (n === 1)
    return ce.function('Ln', [ce.function('Abs', [csc.add(cot)])]).neg();
  const term1 = csc
    .pow(ce.number(n - 2))
    .mul(cot)
    .div(ce.number(n - 1))
    .neg();
  const rest = integrateSecCscPower('Csc', n - 2, index, ce);
  return add(
    term1,
    ce
      .number(n - 2)
      .div(ce.number(n - 1))
      .mul(rest)
  );
}

/**
 * ∫ tanⁿx dx / ∫ cotⁿx dx for integer n ≥ 0 via the reduction formulas,
 * terminating at the ∫tan x / ∫cot x logarithmic base cases.
 *   ∫tanⁿx dx = tanⁿ⁻¹x/(n−1) − ∫tanⁿ⁻²x dx
 *   ∫cotⁿx dx = −cotⁿ⁻¹x/(n−1) − ∫cotⁿ⁻²x dx
 * Base cases: ∫tan x = ln|sec x|, ∫cot x = ln|sin x|, ∫tan⁰ = ∫cot⁰ = x.
 */
function integrateTanCotPower(
  op: 'Tan' | 'Cot',
  n: number,
  index: string,
  ce: Expression['engine']
): Expression {
  const x = ce.symbol(index);
  if (n === 0) return x;
  if (op === 'Tan') {
    if (n === 1)
      return ce.function('Ln', [ce.function('Abs', [ce.function('Sec', [x])])]);
    const term1 = ce
      .function('Tan', [x])
      .pow(ce.number(n - 1))
      .div(ce.number(n - 1));
    const rest = integrateTanCotPower('Tan', n - 2, index, ce);
    return add(term1, rest.neg());
  }
  if (n === 1)
    return ce.function('Ln', [ce.function('Abs', [ce.function('Sin', [x])])]);
  const term1 = ce
    .function('Cot', [x])
    .pow(ce.number(n - 1))
    .div(ce.number(n - 1))
    .neg();
  const rest = integrateTanCotPower('Cot', n - 2, index, ce);
  return add(term1, rest.neg());
}

/**
 * Reverse power-chain rule: ∫ c·u'(x)·u(x)ⁿ dx = c·u(x)ⁿ⁺¹/(n+1) for a
 * constant `c` and exponent n ≠ −1 (the n = −1 case is ∫u'/u = ln|u|, handled
 * separately). Recognizes the pattern by decomposing the integrand into
 * (base, exponent) factor terms and, for each base u that depends on the
 * index, checking whether the remaining factors equal a constant multiple of
 * u′. Catches e.g. ∫ln(x)/x → ½ln²x (u = ln x, n = 1).
 *
 * Tried late (only when the other strategies leave the integral unevaluated),
 * so it does not change results that already resolve another way.
 */
function tryReversePowerChain(
  fn: Expression,
  index: string
): Expression | null {
  const ce = fn.engine;

  const terms: { base: Expression; exp: Expression }[] = [];
  const pushFactor = (f: Expression, sign: 1 | -1) => {
    if (isFunction(f, 'Power'))
      terms.push({ base: f.op1, exp: sign === 1 ? f.op2 : f.op2.neg() });
    else terms.push({ base: f, exp: sign === 1 ? ce.One : ce.NegativeOne });
  };
  if (isFunction(fn, 'Multiply')) fn.ops.forEach((f) => pushFactor(f, 1));
  else if (isFunction(fn, 'Divide')) {
    const num = fn.op1;
    const den = fn.op2;
    (isFunction(num, 'Multiply') ? num.ops : [num]).forEach((f) =>
      pushFactor(f, 1)
    );
    (isFunction(den, 'Multiply') ? den.ops : [den]).forEach((f) =>
      pushFactor(f, -1)
    );
  } else return null;

  for (const { base: u, exp: n } of terms) {
    // Skip constants, the bare index (ordinary power rule), n = −1 (the ln
    // case), and symbolic exponents.
    if (!u.has(index) || sym(u) === index) continue;
    if (n.isSame(-1) || n.has(index)) continue;
    const uPrime = differentiate(u, index);
    if (!uPrime || uPrime.isSame(0)) continue;

    // The remaining factors (integrand ÷ uⁿ) must be a constant multiple of u′.
    const rest = fn.div(u.pow(n)).simplify();
    const ratio = tryGetConstantRatio(rest, uPrime, index);
    // A genuine match needs `rest = c·u′` for a finite, nonzero constant c.
    // 0 / NaN / ∞ all signal a degenerate `rest` (or a simplification that
    // collapsed), not a reverse-power-chain form.
    if (
      ratio === null ||
      ratio.isSame(0) ||
      ratio.isNaN === true ||
      ratio.isFinite === false
    )
      continue;

    const np1 = n.add(1);
    let result = u.pow(np1).div(np1);
    if (!ratio.isSame(1)) result = ratio.mul(result);
    return result;
  }
  return null;
}

/**
 * ∫ 1/√(c + d·x²) dx as a closed form (no linear term), for numeric c, d.
 *   d > 0, c > 0:  (1/√d)·arsinh(x·√(d/c))
 *   d > 0, c < 0:  (1/√d)·arcosh(x·√(d/(−c)))
 *   d < 0, c > 0:  (1/√(−d))·arcsin(x·√(−d/c))
 * Returns null for the non-real case (d < 0, c ≤ 0) or symbolic c/d.
 */
function integrateInvSqrtQuadratic(
  c: Expression,
  d: Expression,
  index: string
): Expression | null {
  const ce = c.engine;
  const cVal = c.N().re;
  const dVal = d.N().re;
  if (cVal === null || dVal === null || dVal === 0) return null;
  const x = ce.symbol(index);

  if (dVal > 0) {
    const sqrtD = ce.function('Sqrt', [d]);
    if (cVal > 0) {
      const u = x.mul(ce.function('Sqrt', [d.div(c)]));
      return ce.function('Arsinh', [u]).div(sqrtD);
    }
    if (cVal < 0) {
      const u = x.mul(ce.function('Sqrt', [d.div(c.neg())]));
      return ce.function('Arcosh', [u]).div(sqrtD);
    }
    return null; // c == 0: ∫1/√(d x²) = ln-of-x form, not handled here
  }
  // dVal < 0
  if (cVal <= 0) return null; // √(c + d x²) not real on a relevant interval
  const sqrtNegD = ce.function('Sqrt', [d.neg()]);
  const u = x.mul(ce.function('Sqrt', [d.neg().div(c)]));
  return ce.function('Arcsin', [u]).div(sqrtNegD);
}

/**
 * ∫ xᵐ/√(c + d·x²) dx (no linear term) via the reduction
 *   Iₘ = xᵐ⁻¹·√Q/(m·d) − ((m−1)·c/(m·d))·Iₘ₋₂,
 * with base cases I₀ = ∫1/√Q (closed form) and I₁ = √Q/d.
 * Returns null when the base case has no real closed form.
 */
function reduceMonomialOverSqrtQuadratic(
  m: number,
  c: Expression,
  d: Expression,
  Q: Expression,
  index: string
): Expression | null {
  const ce = Q.engine;
  const x = ce.symbol(index);
  const sqrtQ = ce.function('Sqrt', [Q]);
  if (m === 0) return integrateInvSqrtQuadratic(c, d, index);
  if (m === 1) return sqrtQ.div(d);
  const lower = reduceMonomialOverSqrtQuadratic(m - 2, c, d, Q, index);
  if (lower === null) return null;
  const md = ce.number(m).mul(d);
  const term1 = x
    .pow(ce.number(m - 1))
    .mul(sqrtQ)
    .div(md);
  const coef2 = ce
    .number(m - 1)
    .mul(c)
    .div(md)
    .neg();
  return add(term1, coef2.mul(lower));
}

/**
 * ∫ N(x)/√Q(x) dx where Q is a polynomial of degree 1 or 2. Two cases:
 *   (a) N = const·Q′  →  const·2·√Q   (works for any such Q).
 *   (b) Q = c + d·x² (no linear term) and N = xᵐ (m ≥ 1 integer) → reduction.
 * Returns null otherwise. m = 0 (plain 1/√Q) is left to the dedicated
 * arcsin/arsinh/arcosh handlers earlier in the Divide branch.
 */
function tryRadicalQuadratic(
  num: Expression,
  radicand: Expression,
  index: string
): Expression | null {
  const ce = num.engine;
  const qDeg = polynomialDegree(radicand, index);
  if (qDeg < 1 || qDeg > 2) return null;

  // Case (a): numerator is a constant multiple of Q′(x) → c·2√Q. Also covers
  // a degree-1 radicand (e.g. ∫1/√(2x+1) → √(2x+1)).
  const qPrime = differentiate(radicand, index);
  if (qPrime && !qPrime.isSame(0)) {
    const ratio = num.div(qPrime).simplify();
    if (!ratio.has(index)) {
      const sqrtQ = ce.function('Sqrt', [radicand]);
      return ratio.mul(ce.number(2)).mul(sqrtQ);
    }
  }

  const coeffs = getPolynomialCoefficients(radicand, index);
  if (!coeffs || coeffs.length !== 3) return null;
  const [cC, bC, aC] = coeffs; // radicand = aC·x² + bC·x + cC

  // Case (b): linear (or constant) numerator px+q over √(Ax²+Bx+C), via
  // completing the square. With Q = A(x + B/2A)² + (C − B²/4A),
  //   ∫(px+q)/√Q dx = (p/A)·√Q + (q − pB/(2A))·∫1/√Q dx,
  // and ∫1/√Q comes from the shifted no-linear-term form. Handles the linear
  // term the older reduction couldn't, e.g. ∫1/√(x²+x+1) → arsinh((2x+1)/√3),
  // ∫x/√(x²+x+1) → √(x²+x+1) − ½·arsinh((2x+1)/√3).
  let p: Expression | null = null;
  let q: Expression | null = null;
  if (!num.has(index)) {
    p = ce.Zero;
    q = num;
  } else {
    const lin = getLinearCoefficients(num, index);
    if (lin) {
      p = lin.a;
      q = lin.b;
    }
  }
  if (p !== null && q !== null) {
    const twoA = ce.number(2).mul(aC);
    const shift = bC.div(twoA); // B/(2A)
    const cPrime = cC.sub(bC.mul(bC).div(ce.number(4).mul(aC))); // C − B²/(4A)
    const f0 = integrateInvSqrtQuadratic(cPrime, aC, index);
    if (f0) {
      const f0Shifted = f0.subs({ [index]: ce.symbol(index).add(shift) });
      const sqrtQ = ce.function('Sqrt', [radicand]);
      const term1 = p.div(aC).mul(sqrtQ); // (p/A)·√Q
      const coef0 = q.sub(p.mul(bC).div(twoA)); // q − pB/(2A)
      return add(term1, coef0.mul(f0Shifted));
    }
    // f0 null (no real closed form) — fall through.
  }

  // Case (c): xᵐ (m ≥ 2) over √(c + d·x²) (no linear term) via reduction.
  if (!bC.isSame(0)) return null;
  let m: number | null = null;
  if (isFunction(num, 'Power') && sym(num.op1) === index) {
    const ev = num.op2.re;
    if (ev !== null && Number.isInteger(ev) && ev >= 2) m = ev;
  }
  if (m === null) return null;

  return reduceMonomialOverSqrtQuadratic(m, cC, aC, radicand, index);
}

/** Binomial coefficient C(n, k) for small non-negative integers. */
function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

/**
 * ∫ c·xᵐ·(a+b·x)^p dx for an integer m ≥ 0 and a rational exponent p, covering
 * both the canonical `Sqrt(a+b·x)` form and the `Power(a+b·x, p)` form, with a
 * bare or explicit x-coefficient. Substituting u = a+b·x (so x = (u−a)/b):
 *
 *   ∫ c·xᵐ·u^p dx = (c / b^{m+1}) · Σ_{k=0}^m C(m,k)·(−a)^{m−k} · ∫ u^{k+p} du
 *
 * with ∫u^t du = u^{t+1}/(t+1), or ln|u| when t = −1.
 *
 * This is exactly the case the `INTEGRATION_RULES` patterns miss: canonical √
 * is a `Sqrt` node (not `Power(_, 1/2)`) and the patterns also require an
 * explicit `Multiply(a, x)` (so a bare coefficient like `1+x` never matches).
 * As a result ∫√(1+x), ∫√(2x), ∫x·√(1+x), ∫(1+2x)^{3/2} all landed inert.
 */
function tryLinearPower(fn: Expression, index: string): Expression | null {
  const ce = fn.engine;
  let coeff: Expression = ce.One;
  let m = 0;
  let base: Expression | null = null;
  let p: Expression | null = null;

  const factors = isFunction(fn, 'Multiply') ? fn.ops : [fn];
  for (const f of factors) {
    if (!f.has(index)) {
      coeff = coeff.mul(f);
      continue;
    }
    // Monomial xᵏ (k a non-negative integer)
    if (sym(f) === index) {
      m += 1;
      continue;
    }
    if (
      isFunction(f, 'Power') &&
      sym(f.op1) === index &&
      isNumber(f.op2) &&
      f.op2.isInteger === true &&
      (f.op2.re ?? -1) >= 0
    ) {
      m += f.op2.re!;
      continue;
    }
    // A radical/power of a linear function of x
    let L: Expression | null = null;
    let pp: Expression | null = null;
    if (isFunction(f, 'Sqrt')) {
      L = f.op1;
      pp = ce.Half;
    } else if (
      isFunction(f, 'Power') &&
      isNumber(f.op2) &&
      f.op2.isRational === true &&
      !f.op2.has(index)
    ) {
      L = f.op1;
      pp = f.op2;
    }
    if (L === null || pp === null) return null;
    if (base !== null) return null; // only one linear-power factor handled
    if (polynomialDegree(L, index) !== 1) return null;
    base = L;
    p = pp;
  }

  if (base === null || p === null) return null;

  const lin = getLinearCoefficients(base, index);
  if (!lin) return null;
  const b = lin.a; // x-coefficient (slope)
  const a = lin.b; // constant term (intercept)
  if (b.is(0)) return null;

  const u = base; // u = a + b·x
  const terms: Expression[] = [];
  for (let k = 0; k <= m; k++) {
    const binom = ce.number(binomialCoefficient(m, k));
    // (−a)^{m−k}; the exponent-0 case is 1 even when a = 0 (avoid 0^0 → NaN)
    const aPow = m - k === 0 ? ce.One : a.neg().pow(ce.number(m - k));
    const tp1 = p.add(ce.number(k + 1)); // (k + p) + 1
    const inner = tp1.is(0)
      ? ce.function('Ln', [ce.function('Abs', [u])])
      : u.pow(tp1).div(tp1);
    terms.push(binom.mul(aPow).mul(inner));
  }
  const sum = terms.length === 1 ? terms[0] : add(...terms);
  return coeff
    .mul(sum)
    .div(b.pow(ce.number(m + 1)))
    .evaluate();
}

/**
 * ∫ c·Q′(x)·Q(x)^p dx = c·Q(x)^{p+1}/(p+1), the reverse chain rule for a
 * (radical) power of a polynomial Q of degree ≥ 1. Recognizes one `Sqrt(Q)`
 * or `Power(Q, p)` factor (rational p ≠ −1) whose remaining cofactor is a
 * constant multiple of Q′. Handles e.g. ∫x·√(1−x²) (x = −½·(1−x²)′ →
 * −⅓(1−x²)^{3/2}) and ∫(2x+3)·√(x²+3x+1), which the linear-power handler and
 * the √(quadratic)-in-denominator reductions don't cover.
 */
function tryRadicalDerivative(
  fn: Expression,
  index: string
): Expression | null {
  const ce = fn.engine;
  const factors = isFunction(fn, 'Multiply') ? [...fn.ops] : [fn];

  for (let i = 0; i < factors.length; i++) {
    const f = factors[i];
    let Q: Expression | null = null;
    let p: Expression | null = null;
    if (isFunction(f, 'Sqrt')) {
      Q = f.op1;
      p = ce.Half;
    } else if (
      isFunction(f, 'Power') &&
      isNumber(f.op2) &&
      f.op2.isRational === true &&
      !f.op2.has(index) &&
      !f.op2.isSame(-1)
    ) {
      Q = f.op1;
      p = f.op2;
    }
    if (Q === null || p === null) continue;
    if (polynomialDegree(Q, index) < 1) continue;

    const qPrime = differentiate(Q, index);
    if (!qPrime || qPrime.isSame(0)) continue;

    const rest = factors.filter((_, j) => j !== i);
    const N =
      rest.length === 0
        ? ce.One
        : rest.length === 1
          ? rest[0]
          : ce.function('Multiply', rest);

    const ratio = N.div(qPrime).simplify();
    if (ratio.has(index) || ratio.isNaN === true || ratio.isFinite === false)
      continue;

    const p1 = p.add(1);
    return ratio.mul(Q.pow(p1)).div(p1).evaluate();
  }
  return null;
}

/**
 * ∫ N/(√u ± √v)^k dx by rationalizing with the conjugate: multiplying by
 * (√u ∓ √v)^k clears the radical sum, since (√u+√v)(√u−√v) = u−v is a
 * polynomial (a constant when u, v share their leading coefficient, e.g.
 * a+b·x and c+b·x). The rationalized integrand is then integrated term by
 * term by the linear-power / radical handlers.
 *
 * Cleanly closes the k = 1 cases (`1/(√(a+bx)+√(c+bx))` → ⅔(…)^{3/2} terms);
 * for k ≥ 2 the expansion introduces √(u·v) cross terms, so it returns only
 * when every resulting term integrates (the `closes` guard) and otherwise
 * defers.
 */
function tryRationalizeRadicalSum(
  fn: Expression,
  index: string
): Expression | null {
  const ce = fn.engine;
  if (!isFunction(fn, 'Divide')) return null;

  const N = fn.op1;
  let D = fn.op2;
  let k = 1;
  if (
    isFunction(D, 'Power') &&
    isNumber(D.op2) &&
    D.op2.isInteger === true &&
    (D.op2.re ?? 0) >= 1
  ) {
    k = D.op2.re!;
    D = D.op1;
  }
  if (!isFunction(D, 'Add') || D.nops !== 2) return null;

  const [t1, t2] = D.ops;
  const hasSqrt = (e: Expression): boolean =>
    e.operator === 'Sqrt' || (isFunction(e) ? e.ops.some(hasSqrt) : false);
  // Both denominator terms must be radicals whose square is a polynomial — the
  // genuine √u ± √v shape (not e.g. x + √Q, a different Euler-substitution case).
  if (!hasSqrt(t1) || !hasSqrt(t2)) return null;
  const sq1 = t1.pow(2).evaluate();
  const sq2 = t2.pow(2).evaluate();
  if (polynomialDegree(sq1, index) < 0 || polynomialDegree(sq2, index) < 0)
    return null;

  const denomPoly = sq1.sub(sq2).evaluate(); // (√u)² − (√v)² = u − v
  if (denomPoly.is(0)) return null;

  const conj = t1.sub(t2); // √u − √v
  const conjPow =
    k === 1 ? conj : ce.box(['Expand', conj.pow(ce.number(k))]).evaluate();
  const rationalized = ce
    .box(['Expand', N.mul(conjPow).div(denomPoly.pow(ce.number(k)))])
    .evaluate();

  const F = antiderivative(rationalized, index);
  return F.has('Integrate') ? null : F;
}

export function antiderivative(fn: Expression, index: string): Expression {
  if (isFunction(fn, 'Function')) return antiderivative(fn.op1, index);
  if (isFunction(fn, 'Block')) return antiderivative(fn.op1, index);
  if (isFunction(fn, 'Delimiter')) return antiderivative(fn.op1, index);

  const ce = fn.engine;

  // Is it the index?
  if (sym(fn) === index) return ce.expr(['Divide', ['Power', fn, 2], 2]);

  // Is it a constant?
  if (!fn.has(index)) return ce.expr(['Multiply', fn, ce.symbol(index)]);

  // ∫√x dx and ∫1/√x dx. `√x` and `x^(−1/2)` canonicalize to `Sqrt(x)` and
  // `Divide(1, Sqrt(x))` — not `Power` nodes — so the Power-based power rule
  // further below never matches them. Handle them here with exponent ±1/2.
  // (Bare index only; compound radicals like √(1−x²) are handled separately.)
  if (isFunction(fn, 'Sqrt') && sym(fn.op1) === index)
    return integrateIndexPower(index, ce.Half);
  if (
    isFunction(fn, 'Divide') &&
    fn.op1.isSame(1) &&
    isFunction(fn.op2, 'Sqrt') &&
    sym(fn.op2.op1) === index
  )
    return integrateIndexPower(index, ce.Half.neg());

  // Non-elementary closed forms: ∫e^(quadratic) → Erf/Erfi (Gaussian) and
  // ∫cos(a x²)/∫sin(a x²) → Fresnel C/S. Checked here (before the Add /
  // Multiply / Divide branches) so the bare integrand reaches them; a
  // constant-scaled integrand like ∫3·e^(−x²) is reduced by the Multiply
  // branch and recurses back to these.
  const gaussian = tryGaussianIntegral(fn, index);
  if (gaussian) return gaussian;
  const fresnel = tryFresnelIntegral(fn, index);
  if (fresnel) return fresnel;

  // ∫ c·xᵐ·(a+b·x)^p (rational p, Sqrt or Power form, bare or explicit
  // coefficient) — the canonical-√ / bare-coefficient case the pattern rules
  // miss. Tried before the Add/Multiply branches so the whole product reaches
  // it intact (e.g. x·√(1+x)).
  const linPow = tryLinearPower(fn, index);
  if (linPow) return linPow;

  // ∫ c·Q′·Q^p (reverse chain rule for a radical power of a polynomial),
  // e.g. ∫x·√(1−x²). Tried before the Multiply branch so the whole product is
  // examined as a unit.
  const radDeriv = tryRadicalDerivative(fn, index);
  if (radDeriv) return radDeriv;

  // ∫ N/(√u ± √v)^k — rationalize with the conjugate (√u∓√v clears the radical
  // sum). Tried before the generic Divide branch, which would otherwise route
  // the radical-sum denominator to the inert path.
  const radSum = tryRationalizeRadicalSum(fn, index);
  if (radSum) return radSum;

  // Apply the chain rule
  if (isFunction(fn, 'Add')) {
    const terms = fn.ops.map((op) => antiderivative(op, index));
    return add(...(terms as Expression[])).evaluate();
  }

  if (isFunction(fn, 'Negate')) return antiderivative(fn.op1, index).neg();

  if (isFunction(fn, 'Multiply')) {
    // Separate constant factors from variable factors
    const constantFactors: Expression[] = [];
    const variableFactors: Expression[] = [];

    for (const op of fn.ops) {
      if (!op.has(index)) {
        constantFactors.push(op);
      } else {
        variableFactors.push(op);
      }
    }

    // If we have constant factors, pull them out: ∫ c*f(x) dx = c * ∫f(x) dx
    if (constantFactors.length > 0) {
      const constantProduct = mul(...constantFactors);
      if (variableFactors.length === 0) {
        // All constants: ∫ c dx = cx
        return constantProduct.mul(ce.symbol(index));
      }
      const variableProduct =
        variableFactors.length === 1
          ? variableFactors[0]
          : mul(...variableFactors);

      // Try u-substitution on variable part first
      if (variableFactors.length > 1) {
        const uSubResult = tryUSubstitution(variableProduct, index);
        if (uSubResult) return constantProduct.mul(uSubResult).evaluate();
      }

      // Try cyclic e^x * trig patterns
      if (variableFactors.length === 2) {
        const cyclicResult = tryCyclicExpTrigIntegral(variableFactors, index);
        if (cyclicResult) return constantProduct.mul(cyclicResult).evaluate();
      }

      // Polynomial × eˣ × trig (the cyclic solver composed with by-parts)
      const polyExpTrig = tryPolyExpTrigIntegral(variableFactors, index);
      if (polyExpTrig) return constantProduct.mul(polyExpTrig).evaluate();

      const antideriv = antiderivative(variableProduct, index);
      return constantProduct.mul(antideriv).evaluate();
    }

    // No constant factors - all terms contain the variable
    // First try u-substitution (chain rule recognition)
    const uSubResult = tryUSubstitution(fn, index);
    if (uSubResult) return uSubResult;

    // Try cyclic e^x * trig patterns (must be before integration by parts)
    // These patterns would cause infinite recursion with standard integration by parts
    const cyclicResult = tryCyclicExpTrigIntegral(fn.ops, index);
    if (cyclicResult) return cyclicResult;

    // Polynomial × eˣ × trig — by-parts composed with the cyclic solver, but
    // solved in closed form (exact polynomial coefficients) to avoid the
    // unbounded by-parts/cyclic recursion. Must precede integration by parts.
    const polyExpTrig = tryPolyExpTrigIntegral(fn.ops, index);
    if (polyExpTrig) return polyExpTrig;

    // Products of powers of the index fold to a single power:
    // x^m·x^(2m+2) → x^(3m+2), which the power rule integrates directly
    const folded = foldIndexPowers(fn.ops, index);
    if (folded !== null) return antiderivative(folded, index);

    // Then try integration by parts for products of variable terms
    if (fn.ops.length >= 2) {
      const result = tryIntegrationByParts(fn.ops, index, 0);
      if (result) return result;
    }

    // Expanding can reduce the product to a sum of power-rule terms —
    // e.g. x^m·(a+b·x^(2+2m))²: the symbolic exponents defeat both
    // u-substitution and by-parts, but every expanded term is a constant
    // times powers of x. Tried AFTER by-parts so integrands that by-parts
    // already solves keep their current (unexpanded) antiderivative form.
    const expanded = expandAll(fn);
    if (isFunction(expanded, 'Add')) return antiderivative(expanded, index);

    // Fall through to rule-based matching
  }

  if (isFunction(fn, 'Divide')) {
    // First try to cancel common factors in the numerator and denominator
    // This helps with cases like ∫ (x+1)/(x²+3x+2) dx where (x+1) cancels
    const cancelled = cancelCommonFactors(fn, index);
    if (!cancelled.isSame(fn)) {
      // If cancellation changed the expression, integrate the simplified form
      return antiderivative(cancelled, index);
    }

    // Pull a constant (index-free) factor out of a Multiply denominator:
    // ∫ N/(c·D) dx = (1/c)·∫ N/D dx. Without this, denominators that
    // canonicalize to a Multiply rather than an Add — e.g. 2(1+x²) stays
    // Multiply(2, Add(x², 1)) — miss the quadratic/arctan rules below
    // (getQuadraticCoefficients looks for a bare x² factor, not 2·(…)) and
    // fall to the numeric partial-fraction fallback, leaking floats
    // (∫1/(2(1+x²)) → 0.5·arctan x instead of the exact ½·arctan x). This is
    // the root cause of the ∫x·arctan x by-parts coefficient leak, whose
    // inner integral is ∫x²/(2(1+x²)).
    if (isFunction(fn.op2, 'Multiply')) {
      const denomFactors = fn.op2.ops;
      const constFactors = denomFactors.filter((f) => !f.has(index));
      const varFactors = denomFactors.filter((f) => f.has(index));
      if (constFactors.length > 0 && varFactors.length > 0) {
        const constProduct = mul(...constFactors);
        const newDenom =
          varFactors.length === 1 ? varFactors[0] : mul(...varFactors);
        const inner = antiderivative(fn.op1.div(newDenom), index);
        if (inner.operator !== 'Integrate')
          return inner.div(constProduct).evaluate();
      }
    }

    // Case A: If deg(numerator) >= deg(denominator), divide first
    // ∫ P(x)/Q(x) dx where deg(P) >= deg(Q) becomes ∫ (quotient + remainder/Q) dx
    // Requires deg(Q) ≥ 1: an x-free denominator is handled by the constant
    // branch below — "dividing" by it here loops forever, because the
    // quotient re-canonicalizes to the same Divide(P, c) shape
    // (∫x¹¹/(a+bx²)² overflowed the stack this way: the polynomial quotient
    // is Divide(…, b⁴), whose integration re-entered this case).
    const numDeg = polynomialDegree(fn.op1, index);
    const denDeg = polynomialDegree(fn.op2, index);
    if (numDeg >= 0 && denDeg >= 1 && numDeg >= denDeg) {
      const divResult = polynomialDivide(fn.op1, fn.op2, index);
      if (divResult) {
        const [quotient, remainder] = divResult;
        // Guard: with symbolic coefficients the remainder's leading terms
        // can be algebraically zero without being structurally zero, so the
        // division may not actually reduce the degree. Recursing then loops
        // forever on same-degree fractions with ever-growing coefficients
        // (stack overflow on e.g. (d+ex)³(f+gx)²/(d²−e²x²)). Require an
        // actual degree decrease before recursing on the remainder.
        const remDeg = polynomialDegree(remainder, index);
        if (remainder.isSame(0) || (remDeg >= 0 && remDeg < denDeg)) {
          // ∫ P/Q dx = ∫ quotient dx + ∫ remainder/Q dx
          const quotientIntegral = antiderivative(quotient, index);
          if (!remainder.isSame(0)) {
            const remainderFraction = remainder.div(fn.op2);
            const remainderIntegral = antiderivative(remainderFraction, index);
            return add(quotientIntegral, remainderIntegral);
          }
          return quotientIntegral;
        }
        // Division did not reduce the degree: fall through to the other
        // strategies (or the inert integral).
      }
    }

    // Biquadratic denominators with no real roots (e.g. x⁴+1) factor into
    // two real irreducible quadratics with irrational coefficients, which the
    // rational factorizer and findUnivariateRoots both miss — without this
    // they leak floats via the numeric fallback. Tried here (proper fractions
    // only; polynomial division above already reduced deg(num) ≥ deg(den)).
    {
      const biquad = tryBiquadraticPartialFractions(fn.op1, fn.op2, index);
      if (biquad) return biquad;
    }

    if (!fn.op2.has(index)) {
      // ∫ f(x)/c dx = (1/c) * ∫f(x) dx
      const antideriv = antiderivative(fn.op1, index);
      return fn.engine.expr(['Divide', antideriv, fn.op2]);
    }
    // Handle ∫ 1/x dx = ln|x|
    if (fn.op1.isSame(1) && sym(fn.op2) === index) {
      return ce.expr(['Ln', ['Abs', index]]);
    }
    // Handle ∫ c/x dx = c * ln|x|
    if (!fn.op1.has(index) && sym(fn.op2) === index) {
      return ce.expr(['Multiply', fn.op1, ['Ln', ['Abs', index]]]);
    }
    // Handle ∫ c/(1+x²) dx = c * arctan(x)
    // Canonical form: ['Divide', c, ['Add', ['Power', 'x', 2], 1]]
    if (
      !fn.op1.has(index) &&
      fn.op2.operator === 'Add' &&
      isFunction(fn.op2) &&
      fn.op2.nops === 2
    ) {
      const addOps = fn.op2.ops;
      // Check for x² + 1 form
      const powerTerm = addOps.find(
        (op) =>
          isFunction(op, 'Power') && sym(op.op1) === index && op.op2.isSame(2)
      );
      const oneTerm = addOps.find((op) => op.isSame(1));
      if (powerTerm && oneTerm) {
        const arctan = ce.expr(['Arctan', index]);
        if (fn.op1.isSame(1)) {
          return arctan;
        }
        return fn.op1.mul(arctan);
      }
    }

    // Handle ∫ 1/(x·√(x²-1)) dx = arcsec(x)
    // Canonical form: ['Divide', 1, ['Multiply', 'x', ['Sqrt', ['Add', ['Power', 'x', 2], -1]]]]
    if (
      fn.op1.isSame(1) &&
      fn.op2.operator === 'Multiply' &&
      isFunction(fn.op2) &&
      fn.op2.nops === 2
    ) {
      const mulOps = fn.op2.ops;
      const xTerm = mulOps.find((op) => sym(op) === index);
      const sqrtTerm = mulOps.find((op) => op.operator === 'Sqrt');
      if (xTerm && isFunction(sqrtTerm)) {
        const sqrtInner = sqrtTerm.op1;
        // Check if sqrt inner is x² - 1: ['Add', ['Power', 'x', 2], -1]
        if (isFunction(sqrtInner, 'Add') && sqrtInner.nops === 2) {
          const innerOps = sqrtInner.ops;
          const powerTerm = innerOps.find(
            (op) =>
              isFunction(op, 'Power') &&
              sym(op.op1) === index &&
              op.op2.isSame(2)
          );
          const negOneTerm = innerOps.find((op) => op.isSame(-1));
          if (powerTerm && negOneTerm) {
            return ce.expr(['Arcsec', index]);
          }
        }
      }
    }

    // Handle ∫ 1/√(1-x²) dx = arcsin(x), ∫ 1/√(x²+1) dx = arsinh(x),
    // ∫ 1/√(x²-1) dx = arcosh(x).  Canonical form here is Divide(1, Sqrt(q))
    // — the current form of 1/√q. (Before the 1/√u → √(1/u) fold was gated
    // for branch safety, these reached the integrator as Sqrt(1/q), matched
    // by the Sqrt branch further below; that path is kept for such inputs.)
    if (fn.op1.isSame(1) && isFunction(fn.op2, 'Sqrt')) {
      const q = fn.op2.op1;
      if (isFunction(q, 'Add') && q.nops === 2) {
        const qOps = q.ops;
        const oneTerm = qOps.find((op) => op.isSame(1));
        const negX2Term = qOps.find(
          (op) =>
            isFunction(op, 'Negate') &&
            op.op1.operator === 'Power' &&
            isFunction(op.op1) &&
            sym(op.op1.op1) === index &&
            op.op1.op2.isSame(2)
        );
        const x2Term = qOps.find(
          (op) =>
            isFunction(op, 'Power') && sym(op.op1) === index && op.op2.isSame(2)
        );
        const negOneTerm = qOps.find((op) => op.isSame(-1));
        if (oneTerm && negX2Term) return ce.expr(['Arcsin', index]);
        if (oneTerm && x2Term) return ce.expr(['Arsinh', index]);
        if (negOneTerm && x2Term) return ce.expr(['Arcosh', index]);
      }
    }

    // ∫ N(x)/√Q(x) dx with Q a degree-1/2 polynomial: derivative-in-numerator
    // (∫x/√(1−x²) → −√(1−x²)) and the xᵐ/√(c+dx²) reduction
    // (∫x²/√(1−x²) → ½(arcsin x − x√(1−x²))).
    if (isFunction(fn.op2, 'Sqrt')) {
      const radResult = tryRadicalQuadratic(fn.op1, fn.op2.op1, index);
      if (radResult) return radResult;
    }

    // Non-elementary ∫ sin(k·x)/x dx = Si(k·x) and ∫ cos(k·x)/x dx = Ci(k·x)
    // (denominator is the bare index, argument linear through the origin, i.e.
    // arg/x is a non-zero constant — covers both `x` and `k·x`).
    if (
      sym(fn.op2) === index &&
      (isFunction(fn.op1, 'Sin') || isFunction(fn.op1, 'Cos'))
    ) {
      const arg = fn.op1.op1;
      const ratio = arg.div(ce.symbol(index)).simplify();
      if (arg.has(index) && !ratio.has(index) && !ratio.isSame(0)) {
        const op = isFunction(fn.op1, 'Sin') ? 'SinIntegral' : 'CosIntegral';
        return ce.function(op, [arg]);
      }
    }

    // Non-elementary ∫ e^(k·x)/x dx = Ei(k·x) (exponential integral). The
    // numerator is e to a linear-through-origin power (arg/x a non-zero
    // constant), the denominator the bare index. d/dx Ei(k·x) = e^(k·x)/x.
    if (sym(fn.op2) === index) {
      let expArg: Expression | null = null;
      if (isFunction(fn.op1, 'Exp')) expArg = fn.op1.op1;
      else if (
        isFunction(fn.op1, 'Power') &&
        sym(fn.op1.op1) === 'ExponentialE'
      )
        expArg = fn.op1.op2;
      if (expArg && expArg.has(index)) {
        const ratio = expArg.div(ce.symbol(index)).simplify();
        if (!ratio.has(index) && !ratio.isSame(0))
          return ce.function('ExpIntegralEi', [expArg]);
      }
    }

    // Non-elementary ∫ 1/ln(k·x) dx = (1/k)·li(k·x) (logarithmic integral).
    // d/dx (1/k)·li(k·x) = (1/k)·k/ln(k·x) = 1/ln(k·x). For the bare index
    // (k = 1) this is just li(x).
    if (fn.op1.isSame(1) && isFunction(fn.op2, 'Ln') && fn.op2.op1.has(index)) {
      const arg = fn.op2.op1;
      const ratio = arg.div(ce.symbol(index)).simplify();
      if (!ratio.has(index) && !ratio.isSame(0)) {
        const li = ce.function('LogIntegral', [arg]);
        return ratio.isSame(1) ? li : li.div(ratio);
      }
    }

    // Case D: Recognize ∫ f'(x)/f(x) dx = ln|f(x)|
    // Check if numerator is a constant multiple of the derivative of denominator
    if (fn.op1.has(index)) {
      const denomDeriv = differentiate(fn.op2, index);
      if (denomDeriv && !denomDeriv.isSame(0)) {
        // Check if numerator = c * denomDeriv for some constant c
        // numerator / denomDeriv should be a constant (no variable)
        const ratio = fn.op1.div(denomDeriv).simplify();
        if (!ratio.has(index)) {
          // ∫ c*f'(x)/f(x) dx = c*ln|f(x)|
          const lnExpr = ce.expr(['Ln', ['Abs', fn.op2]]);
          if (ratio.isSame(1)) {
            return lnExpr;
          }
          return ratio.mul(lnExpr);
        }
      }
    }

    // Case D2: Recognize ∫ 1/(g(x)·h(x)) dx = ln|h(x)| when g(x) = d/dx(h(x))
    // This handles patterns like ∫ 1/(x·ln(x)) dx = ln|ln(x)|
    // because 1/x = d/dx(ln(x)), so 1/(x·ln(x)) = (1/x)/ln(x) = h'(x)/h(x)
    if (
      (fn.op1.isSame(1) || !fn.op1.has(index)) &&
      fn.op2.operator === 'Multiply' &&
      isFunction(fn.op2)
    ) {
      const factors = fn.op2.ops;
      // For each factor f, check if numerator / (product of other factors) = c * d/dx(f)
      for (let i = 0; i < factors.length; i++) {
        const f = factors[i];
        const fDeriv = differentiate(f, index);
        if (!fDeriv || fDeriv.isSame(0)) continue;

        // Compute product of other factors
        const otherFactors = factors.filter((_, j) => j !== i);
        const otherProduct =
          otherFactors.length === 1 ? otherFactors[0] : mul(...otherFactors);

        // Check if numerator / otherProduct = c * fDeriv for some constant c
        // This means: numerator = c * fDeriv * otherProduct
        const ratio = fn.op1.div(otherProduct.mul(fDeriv)).simplify();
        if (!ratio.has(index)) {
          // ∫ 1/(g·h) dx where g = c·h' gives c·ln|h|
          const lnExpr = ce.expr(['Ln', ['Abs', f]]);
          if (ratio.isSame(1)) {
            return lnExpr;
          }
          return ratio.mul(lnExpr);
        }
      }
    }

    // Handle ∫ 1/(ax+b) dx = (1/a) * ln|ax+b|
    // Check if denominator is a linear function of x
    if (fn.op1.isSame(1) || !fn.op1.has(index)) {
      const linearCoeffs = getLinearCoefficients(fn.op2, index);
      if (linearCoeffs) {
        const { a, b: _b } = linearCoeffs;
        // ∫ 1/(ax+b) dx = (1/a) * ln|ax+b|
        const lnExpr = ce.expr(['Ln', ['Abs', fn.op2]]);
        if (a.isSame(1)) {
          // If numerator is not 1, multiply
          if (!fn.op1.isSame(1)) {
            return fn.op1.mul(lnExpr);
          }
          return lnExpr;
        }
        // Divide by a
        const result = lnExpr.div(a);
        if (!fn.op1.isSame(1)) {
          return fn.op1.mul(result);
        }
        return result;
      }
    }

    // Case B: Handle ∫ c/(ax+b)^n dx for n > 1 (repeated linear roots)
    // ∫ 1/(ax+b)^n dx = -1/(a(n-1)(ax+b)^(n-1))
    if (fn.op1.isSame(1) || !fn.op1.has(index)) {
      const denom = fn.op2;
      if (isFunction(denom, 'Power')) {
        const base = denom.op1;
        const exp = denom.op2;
        const n = exp.re;
        // Check if exponent is a positive integer > 1
        if (n !== null && Number.isInteger(n) && n > 1) {
          const linearCoeffs = getLinearCoefficients(base, index);
          if (linearCoeffs) {
            const { a } = linearCoeffs;
            // ∫ 1/(ax+b)^n dx = -1/(a(n-1)(ax+b)^(n-1))
            // = -1/(a(n-1)) * (ax+b)^(-(n-1))
            const newExp = ce.number(-(n - 1));
            const coeff = ce.One.div(a.mul(ce.number(n - 1))).neg();
            let result = coeff.mul(ce.expr(['Power', base, newExp]));
            // If numerator is not 1, multiply
            if (!fn.op1.isSame(1)) {
              result = fn.op1.mul(result);
            }
            return result.simplify();
          }
        }
      }
    }

    // Case C: Completing the square for irreducible quadratics
    // ∫ 1/(ax² + bx + c) dx where discriminant b²-4ac < 0
    // Result: (2/√(4ac-b²)) * arctan((2ax+b)/√(4ac-b²))
    if (fn.op1.isSame(1) || !fn.op1.has(index)) {
      const quadCoeffs = getQuadraticCoefficients(fn.op2, index);
      if (quadCoeffs) {
        const { a, b, c } = quadCoeffs;
        // Calculate discriminant: b² - 4ac
        const discriminant = b
          .mul(b)
          .sub(ce.number(4).mul(a).mul(c))
          .simplify();
        const discValue = discriminant.N().re;

        // If discriminant < 0, the quadratic is irreducible (no real roots)
        if (discValue !== null && discValue < 0) {
          // 4ac - b² > 0
          const fourAcMinusB2 = ce
            .number(4)
            .mul(a)
            .mul(c)
            .sub(b.mul(b))
            .simplify();
          // √(4ac - b²)
          const sqrtDisc = ce.expr(['Sqrt', fourAcMinusB2]).simplify();
          // 2ax + b
          const innerExpr = ce
            .number(2)
            .mul(a)
            .mul(ce.symbol(index))
            .add(b)
            .simplify();
          // arctan((2ax+b)/√(4ac-b²))
          const arctanArg = innerExpr.div(sqrtDisc).simplify();
          const arctanExpr = ce.expr(['Arctan', arctanArg]);
          // (2/√(4ac-b²)) * arctan(...)
          let result = ce.number(2).div(sqrtDisc).mul(arctanExpr).simplify();

          // If numerator is not 1, multiply
          if (!fn.op1.isSame(1)) {
            result = fn.op1.mul(result);
          }
          return result;
        }
      }
    }

    // Case E: Irreducible quadratic powers ∫ 1/(x²+a²)^n dx
    // Reduction formula: ∫ 1/(x²+a²)^n dx = x/(2a²(n-1)(x²+a²)^(n-1)) + (2n-3)/(2a²(n-1)) * ∫ 1/(x²+a²)^(n-1) dx
    if (fn.op1.isSame(1) || !fn.op1.has(index)) {
      const denom = fn.op2;
      if (isFunction(denom, 'Power')) {
        const base = denom.op1;
        const exp = denom.op2;
        const n = exp.re;
        // Check if exponent is a positive integer > 1
        if (n !== null && Number.isInteger(n) && n > 1) {
          // Check if base is x² + a² form (irreducible quadratic with b=0)
          const quadCoeffs = getQuadraticCoefficients(base, index);
          if (quadCoeffs && quadCoeffs.b.isSame(0) && quadCoeffs.a.isSame(1)) {
            const a2 = quadCoeffs.c; // a² value
            const x = ce.symbol(index);

            // First term: x / (2a²(n-1)(x²+a²)^(n-1))
            const newPower = ce.expr(['Power', base, ce.number(n - 1)]);
            const coeff1 = ce.One.div(
              ce
                .number(2)
                .mul(a2)
                .mul(ce.number(n - 1))
            );
            const term1 = coeff1.mul(x).div(newPower);

            // Second term coefficient: (2n-3) / (2a²(n-1))
            const coeff2 = ce.number(2 * n - 3).div(
              ce
                .number(2)
                .mul(a2)
                .mul(ce.number(n - 1))
            );

            // Recursive integral: ∫ 1/(x²+a²)^(n-1) dx
            const lowerPowerExpr =
              n === 2
                ? ce.One.div(base)
                : ce.One.div(ce.expr(['Power', base, ce.number(n - 1)]));
            const recursiveIntegral = antiderivative(lowerPowerExpr, index);

            let result = add(term1, coeff2.mul(recursiveIntegral)).simplify();

            // If numerator is not 1, multiply
            if (!fn.op1.isSame(1)) {
              result = fn.op1.mul(result);
            }
            return result;
          }
        }
      }
    }

    // Handle partial fractions for ∫ c/(polynomial) dx
    // where polynomial has distinct linear roots
    if (fn.op1.isSame(1) || !fn.op1.has(index)) {
      const numerator = fn.op1;
      const denominator = fn.op2;

      // Case F: Check if denominator is already in factored form (Multiply of linear and quadratic)
      // Handle ∫ 1/((x-r)(x²+bx+c)) dx where quadratic is irreducible
      if (isFunction(denominator, 'Multiply') && denominator.nops === 2) {
        const factors = denominator.ops;
        let linearFactor: Expression | null = null;
        let quadFactor: Expression | null = null;
        let linearRoot: Expression | null = null;

        for (const factor of factors) {
          const linCoeffs = getLinearCoefficients(factor, index);
          if (linCoeffs && linCoeffs.a.isSame(1)) {
            linearFactor = factor;
            linearRoot = linCoeffs.b.neg(); // x - r means root is r = -b
            continue;
          }
          const quadCoeffs = getQuadraticCoefficients(factor, index);
          if (quadCoeffs && quadCoeffs.a.isSame(1)) {
            // Check if irreducible (discriminant < 0)
            const disc = quadCoeffs.b
              .mul(quadCoeffs.b)
              .sub(ce.number(4).mul(quadCoeffs.c))
              .simplify();
            const discValue = disc.N().re;
            if (discValue !== null && discValue < 0) {
              quadFactor = factor;
            }
          }
        }

        if (linearFactor && quadFactor && linearRoot) {
          const quadCoeffs = getQuadraticCoefficients(quadFactor, index)!;
          const { b: qb, c: qc } = quadCoeffs;
          const r = linearRoot;

          // Partial fractions: 1/((x-r)(x²+bx+c)) = A/(x-r) + (Bx+C)/(x²+bx+c)
          // A = 1/(r²+br+c)
          const quadAtR = r.mul(r).add(qb.mul(r)).add(qc).simplify();
          const A = ce.One.div(quadAtR);

          // B = -A, C = -A(b+r)
          const B = A.neg();
          const bPlusR = qb.add(r).simplify();
          const C = A.neg().mul(bPlusR);

          // Integral terms:
          // 1. A * ln|x-r|
          const term1 = A.mul(ce.expr(['Ln', ['Abs', linearFactor]]));

          // 2. (Bx+C)/(x²+bx+c) splits into:
          //    B/2 * (2x+b)/(x²+bx+c) + (C - Bb/2)/(x²+bx+c)
          // First part: derivative pattern → B/2 * ln|x²+bx+c|
          const BHalf = B.div(ce.number(2));
          const term2 = BHalf.mul(ce.expr(['Ln', ['Abs', quadFactor]]));

          // Second part: (C - Bb/2)/(x²+bx+c) → completing the square
          const CMinusBbHalf = C.sub(B.mul(qb).div(ce.number(2))).simplify();
          // ∫ k/(x²+bx+c) dx = k * (2/√(4c-b²)) * arctan((2x+b)/√(4c-b²))
          const fourCMinusB2 = ce.number(4).mul(qc).sub(qb.mul(qb)).simplify();
          const sqrtDisc = ce.expr(['Sqrt', fourCMinusB2]).simplify();
          const innerExpr = ce
            .number(2)
            .mul(ce.symbol(index))
            .add(qb)
            .simplify();
          const arctanArg = innerExpr.div(sqrtDisc).simplify();
          const arctanCoeff = ce.number(2).div(sqrtDisc).simplify();
          const term3 = CMinusBbHalf.mul(arctanCoeff).mul(
            ce.expr(['Arctan', arctanArg])
          );

          let result = add(term1, term2, term3).simplify();

          // If numerator is not 1, multiply
          if (!numerator.isSame(1)) {
            result = numerator.mul(result);
          }

          return result;
        }
      }

      // Try to find roots of the denominator
      const roots = findUnivariateRoots(denominator, index);

      // Simple poles: only valid when the real roots account for the FULL
      // degree of the denominator. With fewer roots (e.g. 1−x⁶: two real
      // roots, two irreducible quadratic factors) the cover-up formula
      // silently drops the missing factors' contributions.
      const denomDegree = polynomialDegree(denominator, index);
      if (roots.length >= 2 && roots.length === denomDegree) {
        // Check that all roots are distinct and numeric
        const numericRoots = roots.map((r) => r.N().re);
        const allDistinct = numericRoots.every(
          (r, i) =>
            r !== null &&
            isFinite(r) &&
            numericRoots.every((r2, j) => i === j || Math.abs(r - r2) > 1e-10)
        );

        if (allDistinct) {
          // Partial fraction decomposition over distinct simple poles:
          // 1/Q = Σ Ai/(x−ri) with Ai = 1/Q′(ri) — the residue form also
          // accounts for Q's leading coefficient, which the bare cover-up
          // product ∏(ri−rj) does not (∫1/(2x²−2) was off by ×2).
          const denomDeriv = differentiate(denominator, index);
          if (denomDeriv && !denomDeriv.isSame(0)) {
            const resultTerms: Expression[] = [];

            for (let i = 0; i < roots.length; i++) {
              const coefficient = ce.One.div(
                denomDeriv.subs({ [index]: roots[i] }).evaluate()
              );

              // The partial fraction term integrates to Ai * ln|x - ri|
              const lnTerm = ce.expr([
                'Ln',
                ['Abs', ['Add', ce.symbol(index), roots[i].neg()]],
              ]);
              resultTerms.push(coefficient.mul(lnTerm));
            }

            // Sum all partial fraction integrals
            let result = add(...resultTerms);

            // If numerator is not 1, multiply
            if (!numerator.isSame(1)) {
              result = numerator.mul(result);
            }

            return result.simplify();
          }
        }
      }

      // Case F: Mixed partial fractions - one real root and one irreducible quadratic
      // ∫ 1/((x-r)(x²+bx+c)) dx where x²+bx+c has no real roots
      if (roots.length === 1) {
        const r = roots[0];
        // Check if denominator / (x-r) gives an irreducible quadratic
        const linearFactor = ce.symbol(index).sub(r);
        const quotient = polynomialDivide(denominator, linearFactor, index);
        if (quotient) {
          const [quad, remainder] = quotient;
          if (remainder.isSame(0)) {
            const quadCoeffs = getQuadraticCoefficients(quad, index);
            if (quadCoeffs) {
              const { a: qa, b: qb, c: qc } = quadCoeffs;
              // Check if quadratic is irreducible (discriminant < 0)
              const discriminant = qb
                .mul(qb)
                .sub(ce.number(4).mul(qa).mul(qc))
                .simplify();
              const discValue = discriminant.N().re;

              if (discValue !== null && discValue < 0 && qa.isSame(1)) {
                // Partial fractions: 1/((x-r)(x²+bx+c)) = A/(x-r) + (Bx+C)/(x²+bx+c)
                // A = 1/(r²+br+c)
                const rVal = r;
                const quadAtR = rVal
                  .mul(rVal)
                  .add(qb.mul(rVal))
                  .add(qc)
                  .simplify();
                const A = ce.One.div(quadAtR);

                // B = -A, C = -A(b+r)
                const B = A.neg();
                const bPlusR = qb.add(rVal).simplify();
                const C = A.neg().mul(bPlusR);

                // Integral terms:
                // 1. A * ln|x-r|
                const term1 = A.mul(ce.expr(['Ln', ['Abs', linearFactor]]));

                // 2. (Bx+C)/(x²+bx+c) splits into:
                //    B/2 * (2x+b)/(x²+bx+c) + (C - Bb/2)/(x²+bx+c)
                // First part: derivative pattern → B/2 * ln|x²+bx+c|
                const BHalf = B.div(ce.number(2));
                const term2 = BHalf.mul(ce.expr(['Ln', ['Abs', quad]]));

                // Second part: (C - Bb/2)/(x²+bx+c) → completing the square
                const CMinusBbHalf = C.sub(
                  B.mul(qb).div(ce.number(2))
                ).simplify();
                // ∫ k/(x²+bx+c) dx = k * (2/√(4c-b²)) * arctan((2x+b)/√(4c-b²))
                const fourCMinusB2 = ce
                  .number(4)
                  .mul(qc)
                  .sub(qb.mul(qb))
                  .simplify();
                const sqrtDisc = ce.expr(['Sqrt', fourCMinusB2]).simplify();
                const innerExpr = ce
                  .number(2)
                  .mul(ce.symbol(index))
                  .add(qb)
                  .simplify();
                const arctanArg = innerExpr.div(sqrtDisc).simplify();
                const arctanCoeff = ce.number(2).div(sqrtDisc).simplify();
                const term3 = CMinusBbHalf.mul(arctanCoeff).mul(
                  ce.expr(['Arctan', arctanArg])
                );

                let result = add(term1, term2, term3).simplify();

                // If numerator is not 1, multiply
                if (!numerator.isSame(1)) {
                  result = numerator.mul(result);
                }

                return result;
              }
            }
          }
        }
      }

      // Exact symbolic partial fractions when Q splits over ℚ into distinct
      // linear + irreducible-quadratic factors (e.g. x⁴−1, x⁶−1). Tried before
      // the numeric fallback so these stay exact instead of leaking floats.
      const symbolicPF = trySymbolicPartialFractions(
        numerator,
        denominator,
        index
      );
      if (symbolicPF) return symbolicPF;

      // Full numeric partial fractions: denominator with numeric
      // coefficients and distinct (possibly complex) roots — produces the
      // log + arctan terms the symbolic paths above cannot (e.g. a
      // ℚ-irreducible quartic like x⁴+x+1, factored only over ℝ/ℂ).
      const numericPF = numericPartialFractions(denominator, index);
      if (numericPF) {
        if (numerator.isSame(1)) return numericPF;
        return numerator.mul(numericPF);
      }
    }

    // Exact symbolic partial fractions for a numerator that contains the
    // index (the constant-numerator block above is skipped for it), e.g.
    // ∫x/(x⁴−1). Q must split over ℚ into distinct linear/quadratic factors.
    if (fn.op1.has(index)) {
      const symbolicPF = trySymbolicPartialFractions(fn.op1, fn.op2, index);
      if (symbolicPF) return symbolicPF;
    }

    // Last resort: term-wise split of a sum numerator.
    // ∫ (u₁ + u₂ + …)/Q dx = Σ ∫ uᵢ/Q dx — exposes forms the strategies
    // above handle (e.g. (a + b·x⁴)/x⁶ → a/x⁶ + b·x⁴/x⁶, both power
    // rules). Only used when every sub-integral resolves; otherwise fall
    // through to the single inert integral.
    if (isFunction(fn.op1, 'Add')) {
      const integrals = fn.op1.ops.map((t) =>
        antiderivative(t.div(fn.op2), index)
      );
      if (integrals.every((r) => !r.has('Integrate')))
        return add(...integrals).evaluate();
    }

    // Reverse power-chain rule, e.g. ∫ln(x)/x → ½ln²x.
    const rpc = tryReversePowerChain(fn, index);
    if (rpc) return rpc;

    // Last resort for a rational function: a full partial-fraction
    // decomposition (handles repeated linear AND irreducible-quadratic
    // factors and monomial content, on an exact bigint solve) integrated
    // term by term. The earlier symbolic/numeric PF paths bail on repeated
    // factors; this closes e.g. ∫1/(x²(x+1)) and ∫P(x)/((x−1)x(1+x²)²(…)).
    // Adopted only when every resulting term integrates to a closed form.
    {
      const pf = partialFraction(fn, index);
      if (!pf.isSame(fn) && isFunction(pf, 'Add')) {
        const parts = pf.ops.map((t) => antiderivative(t, index));
        if (parts.every((p) => !p.has('Integrate')))
          return add(...parts).evaluate();
      }
    }

    return integrate(fn, index);
  }

  // Handle ∫ √(1/(1-x²)) dx = arcsin(x)
  // Canonical form: ['Sqrt', ['Divide', 1, ['Add', ['Negate', ['Power', 'x', 2]], 1]]]
  if (isFunction(fn, 'Sqrt')) {
    const inner = fn.op1;
    if (isFunction(inner, 'Divide') && inner.op1.isSame(1)) {
      const denom = inner.op2;
      // Check for 1-x² form: ['Add', ['Negate', ['Power', 'x', 2]], 1]
      if (isFunction(denom, 'Add') && denom.nops === 2) {
        const addOps = denom.ops;
        const oneTerm = addOps.find((op) => op.isSame(1));
        const negPowerTerm = addOps.find(
          (op) =>
            isFunction(op, 'Negate') &&
            op.op1.operator === 'Power' &&
            isFunction(op.op1) &&
            sym(op.op1.op1) === index &&
            op.op1.op2.isSame(2)
        );
        if (oneTerm && negPowerTerm) {
          return ce.expr(['Arcsin', index]);
        }

        // Check for x²+1 form: ['Add', ['Power', 'x', 2], 1]
        // ∫ 1/√(x²+1) dx = arcsinh(x)
        const powerTerm = addOps.find(
          (op) =>
            isFunction(op, 'Power') && sym(op.op1) === index && op.op2.isSame(2)
        );
        if (oneTerm && powerTerm) {
          return ce.expr(['Arsinh', index]);
        }

        // Check for x²-1 form: ['Add', ['Power', 'x', 2], -1]
        // ∫ 1/√(x²-1) dx = arccosh(x)  (for x > 1)
        const negOneTerm = addOps.find((op) => op.isSame(-1));
        if (negOneTerm && powerTerm) {
          return ce.expr(['Arcosh', index]);
        }
      }
    }

    // Trigonometric substitution patterns for direct √(...) integrals
    // These handle ∫√(a² ± x²) dx and ∫√(x² - a²) dx
    if (isFunction(inner, 'Add') && inner.nops === 2) {
      const addOps = inner.ops;

      // Find x² term
      const x2Term = addOps.find(
        (op) =>
          isFunction(op, 'Power') && sym(op.op1) === index && op.op2.isSame(2)
      );
      // Find -x² term (for a² - x² patterns)
      const negX2Term = addOps.find(
        (op) =>
          isFunction(op, 'Negate') &&
          op.op1.operator === 'Power' &&
          isFunction(op.op1) &&
          sym(op.op1.op1) === index &&
          op.op1.op2.isSame(2)
      );

      if (x2Term || negX2Term) {
        // Get the constant term (a² or -a²)
        const constTerm = addOps.find(
          (op) => op !== x2Term && op !== negX2Term
        );
        if (constTerm && !constTerm.has(index)) {
          const constVal = constTerm.N().re;

          if (negX2Term && constVal !== null && constVal > 0) {
            // Pattern: √(a² - x²) where constTerm = a²
            // ∫√(a² - x²) dx = (1/2)(x√(a²-x²) + a²·arcsin(x/a))
            // For a = 1: (1/2)(x√(1-x²) + arcsin(x))
            const a2 = constTerm;
            const a = ce.expr(['Sqrt', a2]).simplify();
            const sqrtExpr = fn; // √(a² - x²)
            // Result: (1/2) * (x * sqrt + a² * arcsin(x/a))
            const xTimesRoot = ce.expr(['Multiply', index, sqrtExpr]);
            const arcsinPart = a.isSame(1)
              ? ce.expr(['Arcsin', index])
              : ce.expr(['Arcsin', ['Divide', index, a]]);
            const a2ArcsinPart = a2.mul(arcsinPart);
            return ce.expr([
              'Multiply',
              ['Rational', 1, 2],
              ['Add', xTimesRoot, a2ArcsinPart],
            ]);
          } else if (x2Term && constVal !== null && constVal > 0) {
            // Pattern: √(x² + a²) where constTerm = a²
            // ∫√(x² + a²) dx = (1/2)(x√(x²+a²) + a²·arcsinh(x/a))
            // For a = 1: (1/2)(x√(1+x²) + arcsinh(x))
            const a2 = constTerm;
            const a = ce.expr(['Sqrt', a2]).simplify();
            const sqrtExpr = fn; // √(x² + a²)
            const xTimesRoot = ce.expr(['Multiply', index, sqrtExpr]);
            const arcsinhPart = a.isSame(1)
              ? ce.expr(['Arsinh', index])
              : ce.expr(['Arsinh', ['Divide', index, a]]);
            const a2ArcsinhPart = a2.mul(arcsinhPart);
            return ce.expr([
              'Multiply',
              ['Rational', 1, 2],
              ['Add', xTimesRoot, a2ArcsinhPart],
            ]);
          } else if (x2Term && constVal !== null && constVal < 0) {
            // Pattern: √(x² - a²) where constTerm = -a²
            // ∫√(x² - a²) dx = (1/2)(x√(x²-a²) - a²·arccosh(x/a))
            // For a = 1: (1/2)(x√(x²-1) - arccosh(x))
            const a2 = constTerm.neg(); // Convert -a² to a²
            const a = ce.expr(['Sqrt', a2]).simplify();
            const sqrtExpr = fn; // √(x² - a²)
            const xTimesRoot = ce.expr(['Multiply', index, sqrtExpr]);
            const arccoshPart = a.isSame(1)
              ? ce.expr(['Arcosh', index])
              : ce.expr(['Arcosh', ['Divide', index, a]]);
            const a2ArccoshPart = a2.mul(arccoshPart);
            return ce.expr([
              'Multiply',
              ['Rational', 1, 2],
              ['Subtract', xTimesRoot, a2ArccoshPart],
            ]);
          }
        }
      }
    }
  }

  // Handle basic functions: e^x, sin(x), cos(x), ln(x), x^n
  if (isFunction(fn, 'Exp') && sym(fn.op1) === index) {
    // ∫e^x dx = e^x
    return fn;
  }

  if (isFunction(fn, 'Sin') && sym(fn.op1) === index) {
    // ∫sin(x) dx = -cos(x)
    return ce.expr(['Negate', ['Cos', index]]);
  }

  if (isFunction(fn, 'Cos') && sym(fn.op1) === index) {
    // ∫cos(x) dx = sin(x)
    return ce.expr(['Sin', index]);
  }

  if (isFunction(fn, 'Ln') && sym(fn.op1) === index) {
    // ∫ln(x) dx = x*ln(x) - x
    return ce.expr(['Subtract', ['Multiply', index, ['Ln', index]], index]);
  }

  if (isFunction(fn, 'Power')) {
    // ∫e^x dx = e^x (e^x is parsed as ['Power', 'ExponentialE', 'x'])
    if (sym(fn.op1) === 'ExponentialE' && sym(fn.op2) === index) {
      return fn;
    }

    // ∫secⁿx dx / ∫cscⁿx dx (bare index, integer n ≥ 2) via reduction.
    // e.g. ∫sec³x → ½(sec x·tan x + ln|sec x + tan x|).
    if (
      (isFunction(fn.op1, 'Sec') || isFunction(fn.op1, 'Csc')) &&
      sym(fn.op1.op1) === index
    ) {
      const nVal = fn.op2.re;
      if (nVal !== null && Number.isInteger(nVal) && nVal >= 2)
        return integrateSecCscPower(
          isFunction(fn.op1, 'Sec') ? 'Sec' : 'Csc',
          nVal,
          index,
          ce
        );
    }

    // ∫tanⁿx dx / ∫cotⁿx dx (bare index, integer n ≥ 2) via reduction.
    if (
      (isFunction(fn.op1, 'Tan') || isFunction(fn.op1, 'Cot')) &&
      sym(fn.op1.op1) === index
    ) {
      const nVal = fn.op2.re;
      if (nVal !== null && Number.isInteger(nVal) && nVal >= 2)
        return integrateTanCotPower(
          isFunction(fn.op1, 'Tan') ? 'Tan' : 'Cot',
          nVal,
          index,
          ce
        );
    }

    // ∫x^n dx
    if (sym(fn.op1) === index) {
      const exponent = fn.op2;
      if (isNumber(exponent)) {
        if (exponent.isSame(-1)) {
          // ∫1/x dx = ln|x|
          return ce.expr(['Ln', ['Abs', index]]);
        }
        // ∫x^n dx = x^(n+1)/(n+1)
        return ce.expr([
          'Divide',
          ['Power', index, ['Add', exponent, 1]],
          ['Add', exponent, 1],
        ]);
      }
    }

    // ∫(ax+b)^n dx where n is a negative integer (repeated linear roots)
    // ∫(ax+b)^(-n) dx = (ax+b)^(-n+1) / (a(-n+1)) for n > 1
    const exponent = fn.op2;
    const n = exponent.re;
    if (n !== null && Number.isInteger(n) && n < -1) {
      const base = fn.op1;
      const linearCoeffs = getLinearCoefficients(base, index);
      if (linearCoeffs) {
        const { a } = linearCoeffs;
        // New exponent is n+1 (which is negative but closer to 0)
        const newExp = ce.number(n + 1);
        const coeff = ce.One.div(a.mul(newExp));
        const result = coeff.mul(ce.expr(['Power', base, newExp]));
        return result.simplify();
      }

      // Case E: ∫(x²+a²)^(-n) dx where n > 1 (irreducible quadratic powers)
      // Reduction formula: ∫ 1/(x²+a²)^n dx = x/(2a²(n-1)(x²+a²)^(n-1)) + (2n-3)/(2a²(n-1)) * ∫ 1/(x²+a²)^(n-1) dx
      const quadCoeffs = getQuadraticCoefficients(base, index);
      if (quadCoeffs && quadCoeffs.b.isSame(0) && quadCoeffs.a.isSame(1)) {
        const a2 = quadCoeffs.c; // a² value
        const absN = -n; // Positive exponent value
        const x = ce.symbol(index);

        // First term: x / (2a²(n-1)(x²+a²)^(n-1))
        const newPower = ce.expr(['Power', base, ce.number(n + 1)]); // (x²+a²)^(-(n-1))
        const coeff1 = ce.One.div(
          ce
            .number(2)
            .mul(a2)
            .mul(ce.number(absN - 1))
        );
        const term1 = coeff1.mul(x).mul(newPower);

        // Second term coefficient: (2n-3) / (2a²(n-1))
        const coeff2 = ce.number(2 * absN - 3).div(
          ce
            .number(2)
            .mul(a2)
            .mul(ce.number(absN - 1))
        );

        // Recursive integral: ∫ (x²+a²)^(-(n-1)) dx
        const lowerPowerExpr = ce.expr(['Power', base, ce.number(n + 1)]);
        const recursiveIntegral = antiderivative(lowerPowerExpr, index);

        const result = add(term1, coeff2.mul(recursiveIntegral)).simplify();
        return result;
      }
    }
  }

  // Try linear substitution: ∫f(ax+b) dx = (1/a)*F(ax+b)
  const linearResult = tryLinearSubstitution(fn, index);
  if (linearResult) return linearResult;

  // Apply a pattern matching rule...
  const rules = ce.rules(INTEGRATION_RULES);
  const xfn = expandAll(fn).subs({ [index]: '_x' }, { canonical: true });
  const result = matchAnyRules(
    xfn,
    rules,
    { _x: ce.symbol('_x') },
    { useVariations: true, form: 'canonical' }
  );

  if (result && result[0]) return result[0].subs({ _x: index });

  // Reverse power-chain rule for products the strategies above left
  // unevaluated (e.g. ∫ u'·uⁿ forms not caught by u-substitution).
  const rpc = tryReversePowerChain(fn, index);
  if (rpc) return rpc;

  return integrate(fn, index);
}

function integrate(expr: Expression, variable: string): Expression {
  const ce = expr.engine;
  return ce.function('Integrate', [
    expr,
    ce.symbol(variable, { canonical: false }),
  ]);
}
