import type { BoxedExpression, BoxedSubstitution, Rule } from '../global-types';

import { mul } from '../boxed-expression/arithmetic-mul-div';
import { add } from '../boxed-expression/arithmetic-add';
import { matchAnyRules } from '../boxed-expression/rules';
import { expandAll } from '../boxed-expression/expand';
import { differentiate } from './derivative';
import { findUnivariateRoots } from '../boxed-expression/solve';

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
function liatePriority(expr: BoxedExpression, index: string): number {
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
  if (expr.symbol === index) return 3;
  if (op === 'Power' && expr.op1.symbol === index && !expr.op2.has(index))
    return 3;
  if (op === 'Sqrt' && expr.op1.has(index)) return 3;

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
  if (op === 'Power' && !expr.op1.has(index) && expr.op2.has(index)) return 1;

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
  factors: ReadonlyArray<BoxedExpression>,
  index: string,
  depth: number = 0
): BoxedExpression | null {
  if (factors.length < 2 || depth > 2) return null; // Limit recursion depth

  const ce = factors[0].engine;

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
  fn: BoxedExpression,
  index: string
): BoxedExpression | null {
  const ce = fn.engine;

  // Is it the index?
  if (fn.symbol === index)
    return ce.box(['Divide', ['Power', fn, 2], 2]).simplify();

  // Is it a constant?
  if (!fn.has(index))
    return ce.box(['Multiply', fn, ce.symbol(index)]).simplify();

  // Basic trig
  if (fn.operator === 'Sin' && fn.op1.symbol === index)
    return ce.box(['Negate', ['Cos', index]]);
  if (fn.operator === 'Cos' && fn.op1.symbol === index)
    return ce.box(['Sin', index]);

  // Exponential
  if (fn.operator === 'Exp' && fn.op1.symbol === index) return fn;
  if (
    fn.operator === 'Power' &&
    fn.op1.symbol === 'ExponentialE' &&
    fn.op2.symbol === index
  )
    return fn;

  // Power rule: x^n -> x^(n+1)/(n+1)
  if (fn.operator === 'Power' && fn.op1.symbol === index) {
    const exponent = fn.op2;
    if (!exponent.has(index) && !exponent.is(-1)) {
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
  fn: BoxedExpression,
  index: string,
  depth: number
): BoxedExpression {
  // First try simple antiderivative
  const simple = antiderivativeSimple(fn, index);
  if (simple) return simple;

  // For products, try integration by parts
  if (fn.operator === 'Multiply') {
    const variableFactors = fn.ops!.filter((op) => op.has(index));
    if (variableFactors.length >= 2) {
      const result = tryIntegrationByParts(variableFactors, index, depth);
      if (result) {
        // Multiply back any constant factors
        const constantFactors = fn.ops!.filter((op) => !op.has(index));
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
function tryUSubstitution(
  fn: BoxedExpression,
  index: string
): BoxedExpression | null {
  if (fn.operator !== 'Multiply') return null;

  const ce = fn.engine;
  const factors = fn.ops!;

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
    if (!ratio.is(1)) {
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
  expr: BoxedExpression,
  index: string
): { outer: string; inner: BoxedExpression } | null {
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

  if (compositeFunctions.includes(op) && expr.nops === 1) {
    const inner = expr.op1;
    // Only interesting if inner is more complex than just the variable
    if (inner.symbol === index) return null;
    if (inner.has(index)) {
      return { outer: op, inner };
    }
  }

  // Handle e^(g(x)) which is ['Power', 'ExponentialE', g(x)]
  if (op === 'Power' && expr.op1.symbol === 'ExponentialE') {
    const inner = expr.op2;
    // Only interesting if inner is more complex than just the variable
    if (inner.symbol === index) return null;
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
  arg: BoxedExpression,
  ce: BoxedExpression['engine']
): BoxedExpression {
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
  fn: BoxedExpression,
  index: string
): BoxedExpression | null {
  const ce = fn.engine;
  const innerInfo = getInnerFunction(fn, index);
  if (!innerInfo) return null;

  const { outer, inner } = innerInfo;

  // Check if inner is linear in index: ax + b form
  // or just ax (when b = 0)
  let coefficient: BoxedExpression | null = null;

  if (inner.operator === 'Multiply') {
    // Check if it's c*x form
    const factors = inner.ops!;
    const varFactor = factors.find((f) => f.symbol === index);
    if (varFactor) {
      const constFactors = factors.filter((f) => f !== varFactor);
      if (constFactors.every((f) => !f.has(index))) {
        coefficient =
          constFactors.length === 1
            ? constFactors[0]
            : ce.box(['Multiply', ...constFactors]);
      }
    }
  } else if (inner.operator === 'Add') {
    // Check for ax + b form
    const terms = inner.ops!;
    let linearTerm: BoxedExpression | null = null;
    let constantTerms: BoxedExpression[] = [];

    for (const term of terms) {
      if (!term.has(index)) {
        constantTerms.push(term);
      } else if (term.symbol === index) {
        linearTerm = ce.One;
      } else if (term.operator === 'Multiply') {
        const factors = term.ops!;
        const varFactor = factors.find((f) => f.symbol === index);
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
  expr1: BoxedExpression,
  expr2: BoxedExpression,
  index: string
): BoxedExpression | null {
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
    condition: (sub) => filter(sub) && !sub._n.is(-1),
  },

  // \sqrt{ax + b} -> \frac{2}{3a} (ax + b)^{3/2}
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 1 / 2],
    replace: [
      'Divide',
      ['Multiply', 2, ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 3]],
      ['Multiply', 3, '_a'],
    ],
    condition: (sub) => filter(sub) && sub._a.isNumberLiteral,
  },

  // \sqrt[3]{ax + b} -> \frac{3}{4a} (ax + b)^{4/3}
  {
    match: ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 1 / 3],
    replace: [
      'Divide',
      ['Multiply', 3, ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 4]],
      ['Multiply', 4, '_a'],
    ],
    condition: (sub) => filter(sub) && sub._a.isNumberLiteral,
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
    condition: (sub) => filter(sub) && sub._x.symbol !== null,
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
    condition: (sub) => filter(sub) && sub._x.symbol !== null,
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
    match: ['Arcsinh', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
    match: ['Arccosh', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
    match: ['Arctanh', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
    match: ['Arcsech', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
    match: ['Arccsch', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
    match: ['Arccoth', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
    match: ['Arccsch', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
    match: ['Arccoth', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
  // \arctan(ax + b) -> \frac{1}{a} \ln(\sec(ax + b) + \tan(ax + b))
  {
    match: ['Arctan', ['Add', ['Multiply', '_a', '_x'], '__b']],
    replace: [
      'Divide',
      [
        'Ln',
        [
          'Add',
          ['Sec', ['Add', ['Multiply', '_a', '_x'], '__b']],
          ['Tan', ['Add', ['Multiply', '_a', '_x'], '__b']],
        ],
      ],
      '_a',
    ],
    condition: filter,
  },
  // \arccos(ax + b) -> \frac{1}{a} \ln(ax + b + \sqrt{(ax + b)^2 - 1})
  {
    match: ['Arccos', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
  // \arcsin(ax + b) -> \frac{1}{a} \ln(ax + b + \sqrt{1 - (ax + b)^2})
  {
    match: ['Arcsin', ['Add', ['Multiply', '_a', '_x'], '__b']],
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
              1,
              ['Power', ['Add', ['Multiply', '_a', '_x'], '__b'], 2],
            ],
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
];

/**
 * Check if an expression is a linear function of the variable (ax + b form).
 * Returns the coefficients { a, b } if it is, null otherwise.
 */
function getLinearCoefficients(
  expr: BoxedExpression,
  index: string
): { a: BoxedExpression; b: BoxedExpression } | null {
  const ce = expr.engine;

  // Just the variable: x -> a=1, b=0
  if (expr.symbol === index) {
    return { a: ce.One, b: ce.Zero };
  }

  // Must be an Add expression
  if (expr.operator !== 'Add') return null;

  const ops = expr.ops!;
  let a: BoxedExpression | null = null;
  let b: BoxedExpression = ce.Zero;

  for (const op of ops) {
    if (!op.has(index)) {
      // Constant term
      b = b.add(op);
    } else if (op.symbol === index) {
      // Just x (coefficient 1)
      a = a ? a.add(ce.One) : ce.One;
    } else if (op.operator === 'Multiply') {
      // Check for c*x form
      const factors = op.ops!;
      const varFactor = factors.find((f) => f.symbol === index);
      if (varFactor) {
        const constFactors = factors.filter((f) => f.symbol !== index);
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

/** Calculate the antiderivative of fn, as an expression (not a function) */
export function antiderivative(
  fn: BoxedExpression,
  index: string
): BoxedExpression {
  if (fn.operator === 'Function') return antiderivative(fn.op1, index);
  if (fn.operator === 'Block') return antiderivative(fn.op1, index);
  if (fn.operator === 'Delimiter') return antiderivative(fn.op1, index);

  const ce = fn.engine;

  // Is it the index?
  if (fn.symbol === index) return ce.box(['Divide', ['Power', fn, 2], 2]);

  // Is it a constant?
  if (!fn.has(index)) return ce.box(['Multiply', fn, ce.symbol(index)]);

  // Apply the chain rule
  if (fn.operator === 'Add') {
    const terms = fn.ops!.map((op) => antiderivative(op, index));
    return add(...(terms as BoxedExpression[])).evaluate();
  }

  if (fn.operator === 'Negate') return antiderivative(fn.op1, index).neg();

  if (fn.operator === 'Multiply') {
    // Separate constant factors from variable factors
    const constantFactors: BoxedExpression[] = [];
    const variableFactors: BoxedExpression[] = [];

    for (const op of fn.ops!) {
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

      const antideriv = antiderivative(variableProduct, index);
      return constantProduct.mul(antideriv).evaluate();
    }

    // No constant factors - all terms contain the variable
    // First try u-substitution (chain rule recognition)
    const uSubResult = tryUSubstitution(fn, index);
    if (uSubResult) return uSubResult;

    // Then try integration by parts for products of variable terms
    if (fn.ops!.length >= 2) {
      const result = tryIntegrationByParts(fn.ops!, index, 0);
      if (result) return result;
    }
    // Fall through to rule-based matching
  }

  if (fn.operator === 'Divide') {
    if (!fn.op2.has(index)) {
      // ∫ f(x)/c dx = (1/c) * ∫f(x) dx
      const antideriv = antiderivative(fn.op1, index);
      return fn.engine.box(['Divide', antideriv, fn.op2]);
    }
    // Handle ∫ 1/x dx = ln|x|
    if (fn.op1.is(1) && fn.op2.symbol === index) {
      return ce.box(['Ln', ['Abs', index]]);
    }
    // Handle ∫ c/x dx = c * ln|x|
    if (!fn.op1.has(index) && fn.op2.symbol === index) {
      return ce.box(['Multiply', fn.op1, ['Ln', ['Abs', index]]]);
    }
    // Handle ∫ 1/(1+x²) dx = arctan(x)
    // Canonical form: ['Divide', 1, ['Add', ['Power', 'x', 2], 1]]
    if (fn.op1.is(1) && fn.op2.operator === 'Add' && fn.op2.nops === 2) {
      const addOps = fn.op2.ops!;
      // Check for x² + 1 form
      const powerTerm = addOps.find(
        (op) =>
          op.operator === 'Power' &&
          op.op1.symbol === index &&
          op.op2.is(2)
      );
      const oneTerm = addOps.find((op) => op.is(1));
      if (powerTerm && oneTerm) {
        return ce.box(['Arctan', index]);
      }
    }
    // Handle ∫ 1/(ax+b) dx = (1/a) * ln|ax+b|
    // Check if denominator is a linear function of x
    if (fn.op1.is(1) || !fn.op1.has(index)) {
      const linearCoeffs = getLinearCoefficients(fn.op2, index);
      if (linearCoeffs) {
        const { a, b } = linearCoeffs;
        // ∫ 1/(ax+b) dx = (1/a) * ln|ax+b|
        const lnExpr = ce.box(['Ln', ['Abs', fn.op2]]);
        if (a.is(1)) {
          // If numerator is not 1, multiply
          if (!fn.op1.is(1)) {
            return fn.op1.mul(lnExpr);
          }
          return lnExpr;
        }
        // Divide by a
        const result = lnExpr.div(a);
        if (!fn.op1.is(1)) {
          return fn.op1.mul(result);
        }
        return result;
      }
    }

    // Handle partial fractions for ∫ c/(polynomial) dx
    // where polynomial has distinct linear roots
    if (fn.op1.is(1) || !fn.op1.has(index)) {
      const numerator = fn.op1;
      const denominator = fn.op2;

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
          let resultTerms: BoxedExpression[] = [];

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
          if (!numerator.is(1)) {
            result = numerator.mul(result);
          }

          return result.simplify();
        }
      }
    }

    return integrate(fn, index);
  }

  // Handle ∫ √(1/(1-x²)) dx = arcsin(x)
  // Canonical form: ['Sqrt', ['Divide', 1, ['Add', ['Negate', ['Power', 'x', 2]], 1]]]
  if (fn.operator === 'Sqrt') {
    const inner = fn.op1;
    if (inner.operator === 'Divide' && inner.op1.is(1)) {
      const denom = inner.op2;
      // Check for 1-x² form: ['Add', ['Negate', ['Power', 'x', 2]], 1]
      if (denom.operator === 'Add' && denom.nops === 2) {
        const addOps = denom.ops!;
        const oneTerm = addOps.find((op) => op.is(1));
        const negPowerTerm = addOps.find(
          (op) =>
            op.operator === 'Negate' &&
            op.op1.operator === 'Power' &&
            op.op1.op1.symbol === index &&
            op.op1.op2.is(2)
        );
        if (oneTerm && negPowerTerm) {
          return ce.box(['Arcsin', index]);
        }
      }
    }
  }

  // Handle basic functions: e^x, sin(x), cos(x), ln(x), x^n
  if (fn.operator === 'Exp' && fn.op1.symbol === index) {
    // ∫e^x dx = e^x
    return fn;
  }

  if (fn.operator === 'Sin' && fn.op1.symbol === index) {
    // ∫sin(x) dx = -cos(x)
    return ce.box(['Negate', ['Cos', index]]);
  }

  if (fn.operator === 'Cos' && fn.op1.symbol === index) {
    // ∫cos(x) dx = sin(x)
    return ce.box(['Sin', index]);
  }

  if (fn.operator === 'Ln' && fn.op1.symbol === index) {
    // ∫ln(x) dx = x*ln(x) - x
    return ce.box(['Subtract', ['Multiply', index, ['Ln', index]], index]);
  }

  if (fn.operator === 'Power') {
    // ∫e^x dx = e^x (e^x is parsed as ['Power', 'ExponentialE', 'x'])
    if (fn.op1.symbol === 'ExponentialE' && fn.op2.symbol === index) {
      return fn;
    }

    // ∫x^n dx
    if (fn.op1.symbol === index) {
      const exponent = fn.op2;
      if (exponent.isNumberLiteral) {
        if (exponent.is(-1)) {
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

function integrate(expr: BoxedExpression, variable: string): BoxedExpression {
  const ce = expr.engine;
  return ce.function('Integrate', [
    expr,
    ce.symbol(variable, { canonical: false }),
  ]);
}
