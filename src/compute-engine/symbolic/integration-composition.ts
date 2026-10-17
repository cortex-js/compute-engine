import type { Expression, IComputeEngine } from '../global-types.js';
import { isFunction, sym } from '../boxed-expression/type-guards.js';
import { differentiate } from './derivative.js';
import { checkDeadline } from '../../common/interruptible.js';
import { exactSign } from './contour.js';
import {
  definiteArithmetic,
  definiteUnshadowed,
  finiteConstant,
} from './definite-integrate.js';
import { boundedInteger, exactExpression } from './definite-transform.js';
import { normalizeIntegrationFunctions } from './integration-normalize.js';
import { reduceIntegrationRational } from './integration-rational.js';

const active = new WeakMap<IComputeEngine, number>();

/** Compose reverse-chain substitutions with the existing primitive/definite
 * solver. Integer powers of the inner variable may match algebraically rather
 * than as identical subtrees. Fractional rationalization needs a positive real
 * interval; it is never inferred for an unrestricted complex primitive. */
export function integrateComposition(
  f: Expression,
  x: string,
  solve: (
    body: Expression,
    variable: string,
    bounds?: [Expression, Expression]
  ) => Expression,
  bounds?: [Expression, Expression]
): Expression | undefined {
  // Degree bounds do not bound polynomial GCD work over free symbolic
  // coefficients. Keep parameter-dependent inputs on the established solver
  // paths instead of expanding a new rational coordinate speculatively.
  if (f.unknowns.some((name) => name !== x)) return undefined;
  f = normalizeIntegrationFunctions(f) ?? f;
  const ce = f.engine,
    op = definiteArithmetic(ce);
  const depth = active.get(ce) ?? 0;
  if (
    depth >= 2 ||
    !f.isPure ||
    !definiteUnshadowed(f) ||
    !exactExpression(f) ||
    f.has([
      'Sum',
      'Product',
      'Integrate',
      'Function',
      'Floor',
      'Ceil',
      'Fract',
      'Abs',
      'Min',
      'Max',
    ])
  )
    return undefined;
  if (
    !f.has([
      'Exp',
      'ExponentialE',
      'Ln',
      'Sin',
      'Cos',
      'Sqrt',
      'Root',
      'Divide',
    ])
  )
    return undefined;
  let nodes = 128;
  const candidates: Expression[] = [];
  let denominator = 1;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const monomialExponent = (e: Expression): Expression | undefined => {
    if (sym(e) === x) return ce.One;
    if (isFunction(e, 'Power') && sym(e.op1) === x && !e.op2.has(x))
      return e.op2;
    if (isFunction(e, 'Sqrt') && sym(e.op1) === x) return ce.Half;
    if (
      isFunction(e, 'Root') &&
      sym(e.op1) === x &&
      boundedInteger(e.op2, 2, 12)
    )
      return op('Divide', 1, e.op2);
    return undefined;
  };
  const collect = (e: Expression): boolean => {
    if (--nodes < 0) return false;
    if (!e.has(x) || !isFunction(e)) return true;
    if (
      isFunction(e, 'Power') &&
      e.op2.isInteger &&
      boundedInteger(e.op2, -32, 32) === undefined
    )
      return false;
    const p = monomialExponent(e);
    if (p && !p.isInteger)
      for (let q = 2; q <= 12; q++) {
        if (boundedInteger(op('Multiply', p, q), -64, 64) !== undefined) {
          denominator = (denominator * q) / gcd(denominator, q);
          break;
        }
      }
    if (p && !p.isSame(1)) candidates.push(e);
    if (['Exp', 'Ln', 'Sin', 'Cos'].includes(e.operator) && e.op1.has(x))
      candidates.push(e.op1);
    if (
      e.operator === 'Exp' ||
      (e.operator === 'Power' && sym(e.op1) === 'ExponentialE')
    ) {
      candidates.push(e);
      if (e.operator === 'Power') candidates.push(e.op2);
    }
    return e.ops.every(collect);
  };
  if (!collect(f)) return undefined;
  const positive = bounds
    ? bounds.every((b) => [0, 1].includes(exactSign(b) ?? -1)) &&
      !bounds[0].isSame(bounds[1])
    : ce.symbol(x).isPositive === true;
  if (positive && denominator > 1 && denominator <= 12)
    candidates.unshift(op('Power', ce.symbol(x), op('Divide', 1, denominator)));
  const unique = candidates
    .filter(
      (g, i) =>
        g.has(x) &&
        sym(g) !== x &&
        !candidates.slice(0, i).some((t) => t.isSame(g))
    )
    .slice(0, 6);
  if (!unique.length) return undefined;
  let name = `_composition_${depth}`;
  while (f.has(name) || ce.lookupDefinition(name)) name += '_';
  const u = ce.symbol(name);
  const exponentialArgument = (e: Expression) =>
    isFunction(e, 'Exp')
      ? e.op1
      : isFunction(e, 'Power') && sym(e.op1) === 'ExponentialE'
        ? e.op2
        : undefined;
  active.set(ce, depth + 1);
  try {
    for (const g of unique) {
      checkDeadline(ce._deadlineFrame);
      const p = monomialExponent(g);
      if (p && !p.isInteger && !positive) continue;
      const derivative = differentiate(g, x)?.evaluate();
      if (!derivative || derivative.isSame(0)) continue;
      let transformedBounds: [Expression, Expression] | undefined;
      if (bounds) {
        // These maps are continuous and monotone on their declared intervals.
        // The downstream solver is responsible for integrability, including
        // infinite transformed endpoints; no original poles are cancelled.
        const isLog = isFunction(g, 'Ln') && sym(g.op1) === x;
        const exponential = isFunction(g, 'Exp')
          ? g.op1
          : isFunction(g, 'Power') && sym(g.op1) === 'ExponentialE'
            ? g.op2
            : undefined;
        if (
          p ? !positive || exactSign(p) !== 1 : isLog ? !positive : !exponential
        )
          continue;
        if (exponential) {
          const d = differentiate(exponential, x)?.evaluate();
          if (
            !d ||
            d.has(x) ||
            !finiteConstant(d) ||
            ![1, -1].includes(exactSign(d) ?? 0)
          )
            continue;
        }
        const endpoint = (b: Expression) =>
          isLog && b.isSame(0)
            ? ce.NegativeInfinity
            : g.subs({ [x]: b }).evaluate();
        transformedBounds = [endpoint(bounds[0]), endpoint(bounds[1])];
        if (transformedBounds.some((b) => b.isNaN || b.has(x))) continue;
      }
      const replace = (e: Expression): Expression => {
        if (e.isSame(g)) return u;
        const arg = exponentialArgument(e),
          phase = exponentialArgument(g);
        if (arg && phase) {
          const n = op('Divide', arg, phase).simplify();
          if (boundedInteger(n, -8, 8) !== undefined) return op('Power', u, n);
        }
        const k = p && monomialExponent(e);
        if (k) {
          const n = op('Divide', k, p!);
          if (boundedInteger(n, -64, 64) !== undefined)
            return op('Power', u, n);
        }
        return isFunction(e) ? ce.function(e.operator, e.ops.map(replace)) : e;
      };
      let transformed = replace(op('Divide', f, derivative).simplify());
      if (transformed.has(x)) continue;
      transformed = reduceIntegrationRational(transformed, name) ?? transformed;
      const value = solve(transformed, name, transformedBounds);
      if (
        value.has(['Integrate', 'Limit', 'EvaluateAt']) ||
        value.isNaN ||
        !exactExpression(value)
      )
        continue;
      return bounds ? value : value.subs({ [name]: g });
    }
  } finally {
    active.set(ce, depth);
  }
  return undefined;
}
