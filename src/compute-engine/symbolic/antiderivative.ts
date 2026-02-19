import type { Expression, BoxedSubstitution, Rule } from '../global-types';

import { mul } from '../boxed-expression/arithmetic-mul-div';
import { add } from '../boxed-expression/arithmetic-add';
import { matchAnyRules } from '../boxed-expression/rules';
import { expandAll } from '../boxed-expression/expand';
import { differentiate } from './derivative';
import { findUnivariateRoots } from '../boxed-expression/solve';
import {
  cancelCommonFactors,
  polynomialDegree,
  polynomialDivide,
} from '../boxed-expression/polynomials';
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
function tryIntegrationByParts(
  factors: ReadonlyArray<Expression>,
  index: string,
  depth: number = 0
): Expression | null {
  if (factors.length < 2 || depth > 2) return null; // Limit recursion depth

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
    return ce.box(['Divide', ['Power', fn, 2], 2]).simplify();

  // Is it a constant?
  if (!fn.has(index))
    return ce.box(['Multiply', fn, ce.symbol(index)]).simplify();

  // Basic trig
  if (isFunction(fn, 'Sin') && sym(fn.op1) === index)
    return ce.box(['Negate', ['Cos', index]]);
  if (isFunction(fn, 'Cos') && sym(fn.op1) === index)
    return ce.box(['Sin', index]);

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
        .box([
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
    return ce.box(['Power', 'ExponentialE', arg]);
  }
  return ce.box([outer, arg]);
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
            : ce.box(['Multiply', ...constFactors]);
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
                : ce.box(['Multiply', ...constFactors]);
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
        .box([
          'Multiply',
          ['Rational', 1, 2],
          ['Exp', index],
          ['Subtract', ['Sin', index], ['Cos', index]],
        ])
        .simplify();
    } else {
      // ∫ e^x * cos(x) dx = (e^x/2) * (sin(x) + cos(x))
      return ce
        .box([
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
      const expX = ce.box(['Exp', index]);
      const denominator = ce.box(['Add', ['Power', a.json, 2], 1]);
      const coeff = expX.div(denominator);

      if (trigOp === 'Sin') {
        // ∫ e^x * sin(ax) dx = (e^x/(a²+1)) * (sin(ax) - a*cos(ax))
        const sinPart = trigFactor;
        const cosPart = ce.box(['Cos', trigArg.json]);
        const result = coeff.mul(sinPart.sub(a.mul(cosPart)));
        return result.simplify();
      } else {
        // ∫ e^x * cos(ax) dx = (e^x/(a²+1)) * (a*sin(ax) + cos(ax))
        const sinPart = ce.box(['Sin', trigArg.json]);
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
    const expX = ce.box(['Exp', index]);
    const denominator = ce.box(['Add', ['Power', a.json, 2], 1]);
    const coeff = expX.div(denominator);

    if (trigOp === 'Sin') {
      // ∫ e^x * sin(ax+b) dx = (e^x/(a²+1)) * (sin(ax+b) - a*cos(ax+b))
      const sinPart = trigFactor;
      const cosPart = ce.box(['Cos', trigArg.json]);
      const result = coeff.mul(sinPart.sub(a.mul(cosPart)));
      return result.simplify();
    } else {
      // ∫ e^x * cos(ax+b) dx = (e^x/(a²+1)) * (a*sin(ax+b) + cos(ax+b))
      const sinPart = ce.box(['Sin', trigArg.json]);
      const cosPart = trigFactor;
      const result = coeff.mul(a.mul(sinPart).add(cosPart));
      return result.simplify();
    }
  }

  return null;
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
  // \sin^2(ax + b) -> \frac{1}{2} \left( x - \frac{\sin(2(ax + b))}{2a} \right)
  {
    match: ['Power', ['Sin', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Divide',
      ['Add', '_x', ['Divide', ['Sin', ['Multiply', 2, '_a', '_x']], 2]],
      2,
    ],
    condition: filter,
  },
  // \cos^2(ax + b) -> \frac{1}{2} \left( x + \frac{\sin(2(ax + b))}{2a} \right)
  {
    match: ['Power', ['Cos', ['Add', ['Multiply', '_a', '_x'], '__b']], 2],
    replace: [
      'Divide',
      ['Add', '_x', ['Divide', ['Sin', ['Multiply', 2, '_a', '_x']], 2]],
      2,
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

  // Must be an Add expression
  if (!isFunction(expr, 'Add')) return null;

  const ops = expr.ops;
  let a: Expression | null = null;
  let b: Expression = ce.Zero;

  for (const op of ops) {
    if (!op.has(index)) {
      // Constant term
      b = b.add(op);
    } else if (sym(op) === index) {
      // Just x (coefficient 1)
      a = a ? a.add(ce.One) : ce.One;
    } else if (isFunction(op, 'Multiply')) {
      // Check for c*x form
      const factors = op.ops;
      const varFactor = factors.find((f) => sym(f) === index);
      if (varFactor) {
        const constFactors = factors.filter((f) => sym(f) !== index);
        if (constFactors.every((f) => !f.has(index))) {
          const coeff =
            constFactors.length === 1 ? constFactors[0] : mul(...constFactors);
          a = a ? a.add(coeff) : coeff;
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
              : ce.box(['Multiply', ...constFactors]);
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

  for (const op of ops) {
    if (!op.has(index)) {
      // Constant term
      c = c.add(op);
    } else if (sym(op) === index) {
      // Just x (coefficient 1 for linear term)
      b = b.add(ce.One);
    } else if (
      isFunction(op, 'Power') &&
      sym(op.op1) === index &&
      op.op2.isSame(2)
    ) {
      // x² term
      a = a.add(ce.One);
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
                : ce.box(['Multiply', ...constFactors]);
          a = a.add(coeff);
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
                : ce.box(['Multiply', ...constFactors]);
          b = b.add(coeff);
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
export function antiderivative(fn: Expression, index: string): Expression {
  if (isFunction(fn, 'Function')) return antiderivative(fn.op1, index);
  if (isFunction(fn, 'Block')) return antiderivative(fn.op1, index);
  if (isFunction(fn, 'Delimiter')) return antiderivative(fn.op1, index);

  const ce = fn.engine;

  // Is it the index?
  if (sym(fn) === index) return ce.box(['Divide', ['Power', fn, 2], 2]);

  // Is it a constant?
  if (!fn.has(index)) return ce.box(['Multiply', fn, ce.symbol(index)]);

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

    // Then try integration by parts for products of variable terms
    if (fn.ops.length >= 2) {
      const result = tryIntegrationByParts(fn.ops, index, 0);
      if (result) return result;
    }
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

    // Case A: If deg(numerator) >= deg(denominator), divide first
    // ∫ P(x)/Q(x) dx where deg(P) >= deg(Q) becomes ∫ (quotient + remainder/Q) dx
    const numDeg = polynomialDegree(fn.op1, index);
    const denDeg = polynomialDegree(fn.op2, index);
    if (numDeg >= 0 && denDeg >= 0 && numDeg >= denDeg) {
      const divResult = polynomialDivide(fn.op1, fn.op2, index);
      if (divResult) {
        const [quotient, remainder] = divResult;
        // ∫ P/Q dx = ∫ quotient dx + ∫ remainder/Q dx
        const quotientIntegral = antiderivative(quotient, index);
        if (!remainder.isSame(0)) {
          const remainderFraction = remainder.div(fn.op2);
          const remainderIntegral = antiderivative(remainderFraction, index);
          return add(quotientIntegral, remainderIntegral);
        }
        return quotientIntegral;
      }
    }

    if (!fn.op2.has(index)) {
      // ∫ f(x)/c dx = (1/c) * ∫f(x) dx
      const antideriv = antiderivative(fn.op1, index);
      return fn.engine.box(['Divide', antideriv, fn.op2]);
    }
    // Handle ∫ 1/x dx = ln|x|
    if (fn.op1.isSame(1) && sym(fn.op2) === index) {
      return ce.box(['Ln', ['Abs', index]]);
    }
    // Handle ∫ c/x dx = c * ln|x|
    if (!fn.op1.has(index) && sym(fn.op2) === index) {
      return ce.box(['Multiply', fn.op1, ['Ln', ['Abs', index]]]);
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
        const arctan = ce.box(['Arctan', index]);
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
            return ce.box(['Arcsec', index]);
          }
        }
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
          const lnExpr = ce.box(['Ln', ['Abs', fn.op2]]);
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
          const lnExpr = ce.box(['Ln', ['Abs', f]]);
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
        const lnExpr = ce.box(['Ln', ['Abs', fn.op2]]);
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
            let result = coeff.mul(ce.box(['Power', base, newExp]));
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
          const sqrtDisc = ce.box(['Sqrt', fourAcMinusB2]).simplify();
          // 2ax + b
          const innerExpr = ce
            .number(2)
            .mul(a)
            .mul(ce.symbol(index))
            .add(b)
            .simplify();
          // arctan((2ax+b)/√(4ac-b²))
          const arctanArg = innerExpr.div(sqrtDisc).simplify();
          const arctanExpr = ce.box(['Arctan', arctanArg]);
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
            const newPower = ce.box(['Power', base, ce.number(n - 1)]);
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
                : ce.One.div(ce.box(['Power', base, ce.number(n - 1)]));
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
          const term1 = A.mul(ce.box(['Ln', ['Abs', linearFactor]]));

          // 2. (Bx+C)/(x²+bx+c) splits into:
          //    B/2 * (2x+b)/(x²+bx+c) + (C - Bb/2)/(x²+bx+c)
          // First part: derivative pattern → B/2 * ln|x²+bx+c|
          const BHalf = B.div(ce.number(2));
          const term2 = BHalf.mul(ce.box(['Ln', ['Abs', quadFactor]]));

          // Second part: (C - Bb/2)/(x²+bx+c) → completing the square
          const CMinusBbHalf = C.sub(B.mul(qb).div(ce.number(2))).simplify();
          // ∫ k/(x²+bx+c) dx = k * (2/√(4c-b²)) * arctan((2x+b)/√(4c-b²))
          const fourCMinusB2 = ce.number(4).mul(qc).sub(qb.mul(qb)).simplify();
          const sqrtDisc = ce.box(['Sqrt', fourCMinusB2]).simplify();
          const innerExpr = ce
            .number(2)
            .mul(ce.symbol(index))
            .add(qb)
            .simplify();
          const arctanArg = innerExpr.div(sqrtDisc).simplify();
          const arctanCoeff = ce.number(2).div(sqrtDisc).simplify();
          const term3 = CMinusBbHalf.mul(arctanCoeff).mul(
            ce.box(['Arctan', arctanArg])
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

      if (roots.length >= 2) {
        // Check that all roots are distinct and numeric
        const numericRoots = roots.map((r) => r.N().re);
        const allDistinct = numericRoots.every(
          (r, i) =>
            r !== null &&
            isFinite(r) &&
            numericRoots.every((r2, j) => i === j || Math.abs(r - r2) > 1e-10)
        );

        if (allDistinct) {
          // Use partial fraction decomposition
          // For 1/((x-r1)(x-r2)...(x-rn)), each coefficient Ai = 1/∏(ri-rj) for j≠i
          // Then ∫1/((x-r1)...(x-rn)) dx = Σ Ai * ln|x-ri|
          const resultTerms: Expression[] = [];

          for (let i = 0; i < roots.length; i++) {
            // Compute coefficient Ai using cover-up method
            // Ai = 1 / product of (ri - rj) for all j != i
            let productOfDiffs = ce.One;
            for (let j = 0; j < roots.length; j++) {
              if (i !== j) {
                productOfDiffs = productOfDiffs.mul(roots[i].sub(roots[j]));
              }
            }
            const coefficient = ce.One.div(productOfDiffs);

            // The partial fraction term integrates to coefficient * ln|x - ri|
            const lnTerm = ce.box([
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
                const term1 = A.mul(ce.box(['Ln', ['Abs', linearFactor]]));

                // 2. (Bx+C)/(x²+bx+c) splits into:
                //    B/2 * (2x+b)/(x²+bx+c) + (C - Bb/2)/(x²+bx+c)
                // First part: derivative pattern → B/2 * ln|x²+bx+c|
                const BHalf = B.div(ce.number(2));
                const term2 = BHalf.mul(ce.box(['Ln', ['Abs', quad]]));

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
                const sqrtDisc = ce.box(['Sqrt', fourCMinusB2]).simplify();
                const innerExpr = ce
                  .number(2)
                  .mul(ce.symbol(index))
                  .add(qb)
                  .simplify();
                const arctanArg = innerExpr.div(sqrtDisc).simplify();
                const arctanCoeff = ce.number(2).div(sqrtDisc).simplify();
                const term3 = CMinusBbHalf.mul(arctanCoeff).mul(
                  ce.box(['Arctan', arctanArg])
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
          return ce.box(['Arcsin', index]);
        }

        // Check for x²+1 form: ['Add', ['Power', 'x', 2], 1]
        // ∫ 1/√(x²+1) dx = arcsinh(x)
        const powerTerm = addOps.find(
          (op) =>
            isFunction(op, 'Power') && sym(op.op1) === index && op.op2.isSame(2)
        );
        if (oneTerm && powerTerm) {
          return ce.box(['Arsinh', index]);
        }

        // Check for x²-1 form: ['Add', ['Power', 'x', 2], -1]
        // ∫ 1/√(x²-1) dx = arccosh(x)  (for x > 1)
        const negOneTerm = addOps.find((op) => op.isSame(-1));
        if (negOneTerm && powerTerm) {
          return ce.box(['Arcosh', index]);
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
            const a = ce.box(['Sqrt', a2]).simplify();
            const sqrtExpr = fn; // √(a² - x²)
            // Result: (1/2) * (x * sqrt + a² * arcsin(x/a))
            const xTimesRoot = ce.box(['Multiply', index, sqrtExpr]);
            const arcsinPart = a.isSame(1)
              ? ce.box(['Arcsin', index])
              : ce.box(['Arcsin', ['Divide', index, a]]);
            const a2ArcsinPart = a2.mul(arcsinPart);
            return ce.box([
              'Multiply',
              ['Rational', 1, 2],
              ['Add', xTimesRoot, a2ArcsinPart],
            ]);
          } else if (x2Term && constVal !== null && constVal > 0) {
            // Pattern: √(x² + a²) where constTerm = a²
            // ∫√(x² + a²) dx = (1/2)(x√(x²+a²) + a²·arcsinh(x/a))
            // For a = 1: (1/2)(x√(1+x²) + arcsinh(x))
            const a2 = constTerm;
            const a = ce.box(['Sqrt', a2]).simplify();
            const sqrtExpr = fn; // √(x² + a²)
            const xTimesRoot = ce.box(['Multiply', index, sqrtExpr]);
            const arcsinhPart = a.isSame(1)
              ? ce.box(['Arsinh', index])
              : ce.box(['Arsinh', ['Divide', index, a]]);
            const a2ArcsinhPart = a2.mul(arcsinhPart);
            return ce.box([
              'Multiply',
              ['Rational', 1, 2],
              ['Add', xTimesRoot, a2ArcsinhPart],
            ]);
          } else if (x2Term && constVal !== null && constVal < 0) {
            // Pattern: √(x² - a²) where constTerm = -a²
            // ∫√(x² - a²) dx = (1/2)(x√(x²-a²) - a²·arccosh(x/a))
            // For a = 1: (1/2)(x√(x²-1) - arccosh(x))
            const a2 = constTerm.neg(); // Convert -a² to a²
            const a = ce.box(['Sqrt', a2]).simplify();
            const sqrtExpr = fn; // √(x² - a²)
            const xTimesRoot = ce.box(['Multiply', index, sqrtExpr]);
            const arccoshPart = a.isSame(1)
              ? ce.box(['Arcosh', index])
              : ce.box(['Arcosh', ['Divide', index, a]]);
            const a2ArccoshPart = a2.mul(arccoshPart);
            return ce.box([
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
    return ce.box(['Negate', ['Cos', index]]);
  }

  if (isFunction(fn, 'Cos') && sym(fn.op1) === index) {
    // ∫cos(x) dx = sin(x)
    return ce.box(['Sin', index]);
  }

  if (isFunction(fn, 'Ln') && sym(fn.op1) === index) {
    // ∫ln(x) dx = x*ln(x) - x
    return ce.box(['Subtract', ['Multiply', index, ['Ln', index]], index]);
  }

  if (isFunction(fn, 'Power')) {
    // ∫e^x dx = e^x (e^x is parsed as ['Power', 'ExponentialE', 'x'])
    if (sym(fn.op1) === 'ExponentialE' && sym(fn.op2) === index) {
      return fn;
    }

    // ∫x^n dx
    if (sym(fn.op1) === index) {
      const exponent = fn.op2;
      if (isNumber(exponent)) {
        if (exponent.isSame(-1)) {
          // ∫1/x dx = ln|x|
          return ce.box(['Ln', ['Abs', index]]);
        }
        // ∫x^n dx = x^(n+1)/(n+1)
        return ce.box([
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
        const result = coeff.mul(ce.box(['Power', base, newExp]));
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
        const newPower = ce.box(['Power', base, ce.number(n + 1)]); // (x²+a²)^(-(n-1))
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
        const lowerPowerExpr = ce.box(['Power', base, ce.number(n + 1)]);
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
  const xfn = (expandAll(fn) ?? fn).subs(
    { [index]: '_x' },
    { canonical: true }
  );
  const result = matchAnyRules(
    xfn,
    rules,
    { _x: ce.symbol('_x') },
    { useVariations: true, canonical: true }
  );

  if (result && result[0]) return result[0].subs({ _x: index });

  return integrate(fn, index);
}

function integrate(expr: Expression, variable: string): Expression {
  const ce = expr.engine;
  return ce.function('Integrate', [
    expr,
    ce.symbol(variable, { canonical: false }),
  ]);
}
