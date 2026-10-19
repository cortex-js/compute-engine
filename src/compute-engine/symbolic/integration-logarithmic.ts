import type { Expression } from '../global-types.js';
import { isFunction, sym } from '../boxed-expression/type-guards.js';
import {
  definiteArithmetic,
  definiteUnshadowed,
  finiteConstant,
} from './definite-integrate.js';
import {
  boundedInteger,
  exactExpression,
  multiplicativeFactors,
} from './definite-transform.js';
import { exactSign } from './contour.js';

/** Finite integration-by-parts recurrence for c*x^p*log(x)^m. */
export function logarithmicPrimitive(
  f: Expression,
  x: string
): Expression | undefined {
  if (
    !f.has('Ln') ||
    !f.isPure ||
    !definiteUnshadowed(f) ||
    !exactExpression(f)
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce),
    factors = multiplicativeFactors(f);
  if (!factors) return undefined;
  let p = ce.Zero,
    m = 0;
  const constants: Expression[] = [];
  for (const [base, exponent] of factors) {
    if (exponent.has(x) || !finiteConstant(exponent)) return undefined;
    if (!base.has(x)) {
      if (
        !finiteConstant(base) ||
        (!exponent.isInteger && exactSign(base) !== 1)
      )
        return undefined;
      constants.push(op('Power', base, exponent));
    } else if (sym(base) === x) p = op('Add', p, exponent);
    else if (isFunction(base, 'Ln') && sym(base.op1) === x) {
      const n = boundedInteger(exponent, 1, 8);
      if (n === undefined) return undefined;
      m += n;
    } else return undefined;
  }
  if (m === 0 || m > 8) return undefined;
  const a = op('Add', p, 1),
    log = op('Ln', ce.symbol(x));
  if (a.isSame(0))
    return op(
      'Divide',
      op('Multiply', ...constants, op('Power', log, m + 1)),
      m + 1
    );
  if (![1, -1].includes(exactSign(a) ?? 0)) return undefined;
  let coefficient = ce.One;
  const terms: Expression[] = [];
  for (let j = 0; j <= m; j++) {
    if (j > 0) coefficient = op('Multiply', coefficient, -(m - j + 1));
    terms.push(
      op(
        'Divide',
        op('Multiply', coefficient, j === m ? ce.One : op('Power', log, m - j)),
        op('Power', a, j + 1)
      )
    );
  }
  return op(
    'Multiply',
    ...constants,
    op('Power', ce.symbol(x), a),
    op('Add', ...terms)
  );
}

/** Sum c_j*x^p_j/log(x), sum c_j=0, p_j>-1 on [0,1]. Subtracting
 * a common power makes the endpoint at 1 removable; parameter integration
 * gives sum c_j*log(p_j+1) without splitting divergent individual terms. */
export function logarithmicParameterDifference(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  const reversed = lower.isSame(1) && upper.isSame(0);
  if (!(lower.isSame(0) && upper.isSame(1)) && !reversed) return undefined;
  if (
    !isFunction(f, 'Divide') ||
    !isFunction(f.op2, 'Ln') ||
    sym(f.op2.op1) !== x ||
    !f.isPure ||
    !definiteUnshadowed(f) ||
    !exactExpression(f)
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce),
    terms = isFunction(f.op1, 'Add') ? f.op1.ops : [f.op1];
  if (terms.length > 32) return undefined;
  const coefficients: Expression[] = [],
    values: Expression[] = [];
  for (const term of terms) {
    const factors = multiplicativeFactors(term);
    if (!factors) return undefined;
    let p = ce.Zero;
    const constants: Expression[] = [];
    for (const [base, exponent] of factors) {
      if (exponent.has(x) || !finiteConstant(exponent)) return undefined;
      if (sym(base) === x) p = op('Add', p, exponent);
      else if (
        !base.has(x) &&
        finiteConstant(base) &&
        (exponent.isInteger || exactSign(base) === 1)
      )
        constants.push(op('Power', base, exponent));
      else return undefined;
    }
    if (exactSign(op('Add', p, 1)) !== 1) return undefined;
    const c = op('Multiply', ...constants);
    coefficients.push(c);
    values.push(op('Multiply', c, op('Ln', op('Add', p, 1))));
  }
  if (!op('Add', ...coefficients).isSame(0)) return undefined;
  return op('Multiply', reversed ? -1 : 1, op('Add', ...values));
}
