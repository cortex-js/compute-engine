import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import {
  definiteArithmetic,
  definiteUnshadowed,
} from './definite-integrate.js';
import { boundedInteger } from './definite-transform.js';
import { polynomialDegree } from '../boxed-expression/polynomials.js';

/** Elementary affine functions and their integer powers keep the established
 * primitive forms. Reciprocal syntax is included before normalization rewrites
 * the function into a larger rational expression. */
export function isElementaryIntegrationFunction(
  f: Expression,
  x: string,
  includePowers = true
): boolean {
  let base = f;
  if (isFunction(base, 'Divide') && !base.op1.has(x)) base = base.op2;
  if (isFunction(base, 'Power') && base.op2.isInteger) {
    if (!includePowers) return false;
    base = base.op1;
  }
  return (
    isFunction(base) &&
    [
      'Sin',
      'Cos',
      'Tan',
      'Cot',
      'Sec',
      'Csc',
      'Sinh',
      'Cosh',
      'Tanh',
      'Coth',
      'Sech',
      'Csch',
    ].includes(base.operator) &&
    polynomialDegree(base.op1, x) === 1
  );
}

/** Normalize reciprocal trig and hyperbolic functions to the existing rational
 * transformation languages. Rewriting preserves denominators; no cancellation
 * of singularities is performed here. */
export function normalizeIntegrationFunctions(
  f: Expression
): Expression | undefined {
  if (
    !f.isPure ||
    !definiteUnshadowed(f) ||
    !f.has([
      'Tan',
      'Cot',
      'Sec',
      'Csc',
      'Sinh',
      'Cosh',
      'Tanh',
      'Coth',
      'Sech',
      'Csch',
    ])
  )
    return undefined;
  const op = definiteArithmetic(f.engine);
  let nodes = 128,
    valid = true;
  const walk = (e: Expression): Expression => {
    if (--nodes < 0) {
      valid = false;
      return e;
    }
    if (!isFunction(e)) return e;
    if (['Sum', 'Product', 'Integrate', 'Function'].includes(e.operator)) {
      valid = false;
      return e;
    }
    const args = e.ops.map(walk),
      a = args[0];
    if (
      e.operator === 'Power' &&
      isFunction(a, 'Divide') &&
      boundedInteger(args[1], 1, 16) !== undefined
    )
      return op(
        'Divide',
        op('Power', a.op1, args[1]),
        op('Power', a.op2, args[1])
      );
    if (['Tan', 'Cot', 'Sec', 'Csc'].includes(e.operator)) {
      if (f.engine.angularUnit !== 'rad') {
        valid = false;
        return e;
      }
      const s = op('Sin', a),
        c = op('Cos', a);
      return e.operator === 'Tan'
        ? op('Divide', s, c)
        : e.operator === 'Cot'
          ? op('Divide', c, s)
          : op('Divide', 1, e.operator === 'Sec' ? c : s);
    }
    if (['Sinh', 'Cosh', 'Tanh', 'Coth', 'Sech', 'Csch'].includes(e.operator)) {
      const p = op('Exp', a),
        m = op('Exp', op('Negate', a));
      const s = op('Subtract', p, m),
        c = op('Add', p, m);
      return e.operator === 'Sinh'
        ? op('Divide', s, 2)
        : e.operator === 'Cosh'
          ? op('Divide', c, 2)
          : e.operator === 'Tanh'
            ? op('Divide', s, c)
            : e.operator === 'Coth'
              ? op('Divide', c, s)
              : op('Divide', 2, e.operator === 'Sech' ? c : s);
    }
    return f.engine.function(e.operator, args);
  };
  const value = walk(f);
  return valid && !value.isSame(f) ? value : undefined;
}
