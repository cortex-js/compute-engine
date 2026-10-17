import type { Expression } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { checkDeadline } from '../../common/interruptible.js';
import { differentiate } from './derivative.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { exactSign } from './contour.js';
import {
  continuousRange,
  definiteArithmetic,
  definiteUnshadowed,
  finiteConstant,
} from './definite-integrate.js';

/** Internal derivation data: only established conditions appear here. An
 * unsupported transformation returns undefined, not a claim of divergence. */
export interface DefiniteReduction {
  value: Expression;
  steps: { method: string; conditions: string[]; substitution?: Expression }[];
}

export function exactExpression(e: Expression): boolean {
  return isNumber(e)
    ? e.isExact
    : !isFunction(e) || e.ops.every(exactExpression);
}

export function boundedInteger(e: Expression, min: number, max: number) {
  return isNumber(e) &&
    e.isExact &&
    e.isInteger &&
    Number.isSafeInteger(e.re) &&
    e.re >= min &&
    e.re <= max
    ? e.re
    : undefined;
}

/** Detect powers whose expansion would overwhelm primitive-first integration.
 * This selects only direct, domain-certified terminals, never a substitution
 * search or polynomial conversion. */
export function hasLargeIntegrationPower(f: Expression, x: string): boolean {
  let nodes = 128;
  const visit = (e: Expression): boolean => {
    if (--nodes < 0 || !isFunction(e) || !e.has(x)) return false;
    if (e.operator === 'Power' && boundedInteger(e.op2, 65, 8192) !== undefined)
      return true;
    return e.ops.some(visit);
  };
  return visit(f);
}

/** Flatten only products, quotients and integer outer powers. Fractional
 * powers stay intact: distributing them would silently choose root branches. */
export function multiplicativeFactors(
  f: Expression,
  preserveFractionalBases = false
): [Expression, Expression][] | undefined {
  const ce = f.engine,
    op = definiteArithmetic(ce);
  const result: [Expression, Expression][] = [];
  let nodes = 128;
  const walk = (e: Expression, p: Expression): boolean => {
    if (--nodes < 0) return false;
    if (isFunction(e, 'Multiply')) return e.ops.every((t) => walk(t, p));
    if (isFunction(e, 'Divide'))
      return walk(e.op1, p) && walk(e.op2, op('Negate', p));
    if (isFunction(e, 'Negate'))
      return walk(ce.NegativeOne, p) && walk(e.op1, p);
    if (
      isFunction(e, 'Power') &&
      (!preserveFractionalBases || e.op2.isInteger) &&
      !e.op2.has([...e.op1.unknowns]) &&
      p.isInteger
    ) {
      result.push([e.op1, op('Multiply', p, e.op2)]);
    } else if (
      !preserveFractionalBases &&
      isFunction(e, 'Sqrt') &&
      p.isInteger
    ) {
      result.push([e.op1, op('Divide', p, 2)]);
    } else if (
      isFunction(e, 'Root') &&
      !preserveFractionalBases &&
      p.isInteger &&
      boundedInteger(e.op2, 1, 8192) !== undefined
    ) {
      result.push([e.op1, op('Divide', p, e.op2)]);
    } else result.push([e, p]);
    return true;
  };
  return walk(f, ce.One) ? result : undefined;
}

/** Cancel identical multiplicative bases without expanding sums or running a
 * polynomial GCD. Candidate discovery must stay cheap even when no substitution
 * removes the old variable. Fractional bases retain their branch convention. */
export function structuralQuotient(
  numerator: Expression,
  denominator: Expression
): Expression {
  const ce = numerator.engine,
    op = definiteArithmetic(ce);
  const top = multiplicativeFactors(numerator, true);
  const bottom = multiplicativeFactors(denominator, true);
  if (!top || !bottom) return ce.function('Divide', [numerator, denominator]);
  const combined: [Expression, Expression][] = [];
  for (const [base, exponent] of [
    ...top,
    ...bottom.map(([b, p]): [Expression, Expression] => [b, p.neg()]),
  ]) {
    const found = combined.find(([b]) => b.isSame(base));
    if (found) found[1] = op('Add', found[1], exponent);
    else combined.push([base, exponent]);
  }
  return op(
    'Multiply',
    ...combined
      .filter(([, p]) => !p.isSame(0))
      .map(([b, p]) => (p.isSame(1) ? b : op('Power', b, p)))
  );
}

export function exactBeta(a: Expression, b: Expression): Expression {
  const ce = a.engine,
    op = definiteArithmetic(ce);
  const gamma = (v: Expression) => {
    const twice = boundedInteger(op('Multiply', 2, v), 1, 16384);
    if (twice === undefined) return op('Gamma', v);
    if (twice % 2 === 0) return op('Factorial', twice / 2 - 1);
    return op(
      'Divide',
      op('Multiply', op('Factorial', twice - 1), op('Sqrt', ce.Pi)),
      op(
        'Multiply',
        op('Power', 4, (twice - 1) / 2),
        op('Factorial', (twice - 1) / 2)
      )
    );
  };
  // B(n,z)=(n-1)!/(z*(z+1)*...*(z+n-1)). Cancel the Gamma quotient before
  // constructing large factorials, preserving rational answers even when z
  // exceeds the library Beta evaluator's direct-reduction budget.
  const smallA = boundedInteger(a, 1, 64),
    smallB = boundedInteger(b, 1, 64);
  if (smallA !== undefined || smallB !== undefined) {
    const useA =
      smallA !== undefined && (smallB === undefined || smallA <= smallB);
    const n = (useA ? smallA : smallB)!,
      z = useA ? b : a;
    let denominator = ce.One;
    for (let k = 0; k < n; k++) {
      checkDeadline(ce._deadlineFrame);
      denominator = op('Multiply', denominator, op('Add', z, k));
    }
    return op('Divide', op('Factorial', n - 1), denominator);
  }
  // Larger integer arguments stay factored; half-integer Gamma values
  // additionally give exact multiples of π.
  if (a.isInteger || b.isInteger) return op('Beta', a, b);
  return op(
    'Divide',
    op('Multiply', gamma(a), gamma(b)),
    gamma(op('Add', a, b))
  );
}

/** c*x^p*(A+B*x^r)^q on its positive finite support or positive half-line.
 * u=|B|*x^r/A gives Beta/Beta-prime without expanding large powers. */
export function generalizedBeta(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): DefiniteReduction | undefined {
  const ce = f.engine,
    op = definiteArithmetic(ce);
  if (['Beta', 'Gamma'].some((h) => shadowsLibraryName(ce, h)))
    return undefined;
  let lo = lower,
    hi = upper,
    direction = 1;
  if (upper.isSame(0)) {
    lo = upper;
    hi = lower;
    direction = -1;
  }
  if (!lo.isSame(0)) return undefined;
  const factors = multiplicativeFactors(f);
  if (!factors) return undefined;
  let p = ce.Zero,
    q: Expression | undefined,
    A: Expression | undefined,
    B: Expression | undefined,
    r: Expression | undefined;
  const constants: Expression[] = [];
  for (const [base, power] of factors) {
    if (
      power.has(x) ||
      !finiteConstant(power) ||
      exactSign(power) === undefined
    )
      return undefined;
    if (!base.has(x)) {
      if (
        !finiteConstant(base) ||
        exactSign(base) === undefined ||
        (!power.isInteger && exactSign(base) !== 1)
      )
        return undefined;
      constants.push(op('Power', base, power));
    } else if (sym(base) === x) p = op('Add', p, power);
    else {
      if (A || !isFunction(base, 'Add') || base.nops !== 2) return undefined;
      A = base.ops.find((t) => !t.has(x));
      const term = base.ops.find((t) => t.has(x));
      if (!A || !term || exactSign(A) !== 1) return undefined;
      const fs = multiplicativeFactors(term);
      if (!fs) return undefined;
      const variable = fs.filter(([v]) => v.has(x));
      if (variable.length !== 1 || sym(variable[0][0]) !== x) return undefined;
      r = variable[0][1];
      B = op(
        'Multiply',
        ...fs.filter(([v]) => !v.has(x)).map(([v, k]) => op('Power', v, k))
      );
      q = power;
    }
  }
  if (!A || !B || !q || !r || exactSign(r) !== 1 || !finiteConstant(r))
    return undefined;
  const sign = exactSign(B);
  if (sign !== 1 && sign !== -1) return undefined;
  const a = op('Divide', op('Add', p, 1), r);
  const b = sign === -1 ? op('Add', q, 1) : op('Subtract', op('Negate', q), a);
  if (exactSign(a) !== 1 || exactSign(b) !== 1) return undefined;
  if (sign === 1) {
    if (!hi.isSame(ce.PositiveInfinity)) return undefined;
  } else if (
    !finiteConstant(hi) ||
    exactSign(hi) !== 1 ||
    !op('Add', A, op('Multiply', B, op('Power', hi, r)))
      .simplify()
      .isSame(0)
  )
    return undefined;
  const scale = op('Divide', A, op('Multiply', sign, B));
  const value = op(
    'Multiply',
    direction,
    ...constants,
    op(
      'Divide',
      op('Multiply', op('Power', A, q), op('Power', scale, a), exactBeta(a, b)),
      r
    )
  );
  if (!exactExpression(value)) return undefined;
  return {
    value,
    steps: [
      {
        method: sign === -1 ? 'generalized-beta' : 'beta-prime',
        substitution: op('Divide', op('Power', ce.symbol(x), r), scale),
        conditions: [
          'positive real substitution',
          'both Beta parameters positive',
          'transformed endpoint limits',
        ],
      },
    ],
  };
}

type Terminal = (
  f: Expression,
  x: string,
  lo: Expression,
  hi: Expression
) => DefiniteReduction | undefined;

/** Bounded composition of derivative-matching substitutions. A continuous
 * monotone inner expression needs no inverse branch. A successful terminal
 * certifies integrability on the transformed interval, including endpoints. */
export function integrateBySubstitution(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression,
  terminals: readonly Terminal[] = [generalizedBeta]
): DefiniteReduction | undefined {
  if (
    !f.isPure ||
    !lower.isPure ||
    !upper.isPure ||
    !definiteUnshadowed(f) ||
    !exactExpression(f) ||
    !exactExpression(lower) ||
    !exactExpression(upper)
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce);
  const visited = new Set<string>();
  let attempts = 20;
  const solve = (
    body: Expression,
    variable: string,
    a: Expression,
    b: Expression,
    depth: number
  ): DefiniteReduction | undefined => {
    checkDeadline(ce._deadlineFrame);
    const key = JSON.stringify([body.json, a.json, b.json]);
    if (visited.has(key)) return undefined;
    visited.add(key);
    for (const terminal of terminals) {
      const result = terminal(body, variable, a, b);
      if (result) return result;
    }
    // These terminals contain no switching/trigonometric functions. Searching
    // their inner expressions cannot expose a terminal and delays the dedicated
    // piecewise/trig methods; binders must not be rewritten as free expressions.
    if (
      body.has([
        'Sin',
        'Cos',
        'Tan',
        'Floor',
        'Ceil',
        'Fract',
        'Abs',
        'Min',
        'Max',
        'Sum',
        'Product',
        'Integrate',
        'Function',
      ])
    )
      return undefined;
    // The existing primitive provider already integrates polynomials. Do not
    // differentiate candidate powers or apply an affine normalization first:
    // even a sparse high-degree polynomial can then trigger a huge expansion.
    // Direct Beta terminals above still get their cheap factored reductions.
    let polynomialNodes = 128;
    const polynomial = (e: Expression): boolean => {
      if (--polynomialNodes < 0) return false;
      if (!e.has(variable) || sym(e) === variable) return true;
      if (!isFunction(e)) return false;
      if (['Add', 'Multiply', 'Negate'].includes(e.operator))
        return e.ops.every(polynomial);
      if (e.operator === 'Divide' && !e.op2.has(variable))
        return polynomial(e.op1);
      return (
        e.operator === 'Power' &&
        boundedInteger(e.op2, 0, Number.MAX_SAFE_INTEGER) !== undefined &&
        polynomial(e.op1)
      );
    };
    if (polynomial(body)) return undefined;
    // Rational simplification invokes polynomial GCD, which expands powers.
    // Bound the possible numerator/denominator degrees before candidate or
    // affine substitutions reach simplify(); counting syntax nodes alone does
    // not bound the expansion of a sparse high-degree expression.
    let rationalNodes = 128;
    const rationalDegrees = (e: Expression): [number, number] | undefined => {
      if (--rationalNodes < 0) return undefined;
      if (!e.has(variable)) return [0, 0];
      if (sym(e) === variable) return [1, 0];
      if (!isFunction(e)) return undefined;
      if (e.operator === 'Power') {
        const n = boundedInteger(
          e.op2,
          -Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER
        );
        const d = rationalDegrees(e.op1);
        if (n === undefined || !d) return undefined;
        return n >= 0 ? [d[0] * n, d[1] * n] : [-d[1] * n, -d[0] * n];
      }
      if (!['Add', 'Multiply', 'Divide', 'Negate'].includes(e.operator))
        return undefined;
      const ds = e.ops.map(rationalDegrees);
      if (ds.some((d) => !d)) return undefined;
      const degrees = ds as [number, number][];
      if (e.operator === 'Negate') return degrees[0];
      if (e.operator === 'Divide')
        return [degrees[0][0] + degrees[1][1], degrees[0][1] + degrees[1][0]];
      const denominator = degrees.reduce((sum, d) => sum + d[1], 0);
      return [
        e.operator === 'Add'
          ? Math.max(...degrees.map((d) => d[0] + denominator - d[1]))
          : degrees.reduce((sum, d) => sum + d[0], 0),
        denominator,
      ];
    };
    const degrees = rationalDegrees(body);
    if (degrees && Math.max(...degrees) > 64) return undefined;
    if (depth >= 3 || !finiteConstant(a) || !finiteConstant(b))
      return undefined;
    const direction = exactSign(op('Subtract', b, a));
    if (direction !== 1 && direction !== -1) return undefined;
    const lo = direction > 0 ? a : b,
      hi = direction > 0 ? b : a;
    const candidates: Expression[] = [];
    let nodes = 128;
    const collect = (e: Expression) => {
      if (--nodes < 0 || !isFunction(e) || !e.has(variable)) return;
      if (['Sum', 'Product', 'Integrate', 'Function'].includes(e.operator))
        return;
      e.ops.forEach(collect);
      if (
        ['Add', 'Power', 'Sqrt', 'Ln', 'Exp'].includes(e.operator) &&
        !candidates.some((t) => t.isSame(e))
      )
        candidates.push(e);
    };
    collect(body);
    for (const g of candidates.slice(0, 12)) {
      if (--attempts < 0) return undefined;
      if (!continuousRange(g, variable, lo, hi)) continue;
      const derivative = differentiate(g, variable)?.evaluate();
      if (!derivative || derivative.isSame(0)) continue;
      const range = continuousRange(derivative, variable, lo, hi);
      if (
        !range ||
        !(
          [0, 1].includes(exactSign(range[0]) ?? -2) ||
          [-1, 0].includes(exactSign(range[1]) ?? 2)
        )
      )
        continue;
      const start = g.subs({ [variable]: a }).evaluate(),
        end = g.subs({ [variable]: b }).evaluate();
      if (exactSign(op('Subtract', end, start)) === 0) continue;
      let name = `_integration_u${depth}`;
      while (body.has(name) || ce.lookupDefinition(name)) name += '_';
      const u = ce.symbol(name);
      const replace = (e: Expression): Expression =>
        e.isSame(g)
          ? u
          : isFunction(e)
            ? ce.function(e.operator, e.ops.map(replace))
            : e;
      const quotient = structuralQuotient(body, derivative);
      const transformed = replace(quotient);
      if (transformed.has(variable)) continue;
      const result = solve(transformed, name, start, end, depth + 1);
      if (result)
        return {
          value: result.value,
          steps: [
            {
              method: 'derivative-substitution',
              substitution: g,
              conditions: [
                'continuous inner expression',
                'monotone on interval',
                'exact derivative cancellation',
              ],
            },
            ...result.steps,
          ],
        };
    }
    if (!(lo.isSame(0) && hi.isSame(1)) && attempts > 0) {
      let name = `_integration_affine${depth}`;
      while (body.has(name) || ce.lookupDefinition(name)) name += '_';
      const width = op('Subtract', b, a);
      const inverse = op('Add', a, op('Multiply', width, ce.symbol(name)));
      const transformed = op(
        'Multiply',
        width,
        body.subs({ [variable]: inverse })
      ).simplify();
      const result = solve(transformed, name, ce.Zero, ce.One, depth + 1);
      if (result)
        return {
          value: result.value,
          steps: [
            {
              method: 'affine-substitution',
              substitution: inverse,
              conditions: [
                'nonzero real interval width',
                'exact transformed bounds',
              ],
            },
            ...result.steps,
          ],
        };
    }
    return undefined;
  };
  return solve(f, x, lower, upper, 0);
}
