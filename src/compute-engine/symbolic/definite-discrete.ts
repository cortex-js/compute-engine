import type { Expression } from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { exactSign } from './contour.js';
import { integrateDiscrete } from './discrete-integrate.js';
import { checkDeadline } from '../../common/interruptible.js';
import {
  definiteArithmetic,
  definiteUnshadowed,
  finiteConstant,
} from './definite-integrate.js';

/** Periodic moments and integer-valued compositions avoid enumerating jump
 * sets. Endpoint values at the jumps do not affect these bounded integrals. */
export function integrateDiscreteMoments(
  f: Expression,
  x: string,
  lo: Expression,
  hi: Expression
): Expression | undefined {
  if (
    !f.has(['Floor', 'Ceil', 'Fract']) ||
    !f.isPure ||
    !lo.isPure ||
    !hi.isPure ||
    !definiteUnshadowed(f) ||
    !finiteConstant(lo) ||
    !finiteConstant(hi)
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce);
  checkDeadline(ce._deadlineFrame);
  if (exactSign(lo) === undefined || exactSign(hi) === undefined)
    return undefined;
  const affine = (e: Expression) => {
    const p = getPolynomialCoefficients(e, x);
    return p &&
      p.length === 2 &&
      p.every(
        (t) => !t.has(x) && finiteConstant(t) && exactSign(t) !== undefined
      ) &&
      exactSign(p[1]) !== 0
      ? p
      : undefined;
  };
  const floor = (e: Expression): Expression | undefined => {
    const n = op('Floor', e);
    if (!isNumber(n) || !n.isInteger || !n.isExact) return undefined;
    const left = exactSign(op('Subtract', e, n));
    return left !== undefined &&
      left >= 0 &&
      exactSign(op('Subtract', op('Add', n, 1), e)) === 1
      ? n
      : undefined;
  };
  if (isFunction(f) && ['Floor', 'Ceil'].includes(f.operator)) {
    const factors = isFunction(f.op1, 'Multiply') ? f.op1.ops : [f.op1];
    const inner = factors.filter((t) => isFunction(t, 'Floor'));
    if (inner.length === 1 && isFunction(inner[0], 'Floor')) {
      const c = op('Multiply', ...factors.filter((t) => t !== inner[0]));
      const m = op('Divide', 1, c);
      if (
        !c.has(x) &&
        isNumber(m) &&
        m.isExact &&
        m.isInteger &&
        m.re > 0 &&
        affine(inner[0].op1)
      ) {
        // floor(floor(u)/m)=floor(u/m), and ceil(floor(u)/m)
        // =floor((u+m-1)/m), for positive integer m.
        const u =
          f.operator === 'Floor'
            ? inner[0].op1
            : op('Add', inner[0].op1, op('Subtract', m, 1));
        return integrateDiscrete(
          ce,
          ce.function('Floor', [op('Divide', u, m)]),
          x,
          lo,
          hi
        );
      }
    }
  }
  const argument = (e: Expression): Expression | undefined => {
    if (isFunction(e, 'Fract')) return e.op1;
    if (!isFunction(e, 'Add')) return undefined;
    for (const t of e.ops) {
      if (
        isFunction(t, 'Negate') &&
        isFunction(t.op1, 'Floor') &&
        op('Subtract', e, op('Subtract', t.op1.op1, t.op1))
          .simplify()
          .isSame(0)
      )
        return t.op1.op1;
    }
    return undefined;
  };
  const moment = (e: Expression): Expression | undefined => {
    const factors = isFunction(e, 'Multiply') ? e.ops : [e];
    const dependent = factors.filter((t) => t.has(x));
    if (dependent.length !== 1) return undefined;
    const c = op('Multiply', ...factors.filter((t) => !t.has(x)));
    if (!finiteConstant(c) || exactSign(c) === undefined) return undefined;
    const t = dependent[0],
      base = isFunction(t, 'Power') ? t.op1 : t;
    const n = isFunction(t, 'Power') ? t.op2 : ce.One;
    if (!isNumber(n) || !n.isExact || !n.isInteger || n.re < 2 || n.re > 64)
      return undefined;
    const u = argument(base);
    if (!u) return undefined;
    const p = affine(u);
    if (!p) return undefined;
    const primitive = (v: Expression): Expression | undefined => {
      const a = op('Add', p[0], op('Multiply', p[1], v)),
        k = floor(a);
      if (!k) return undefined;
      return op(
        'Divide',
        op('Add', k, op('Power', op('Subtract', a, k), n.re + 1)),
        n.re + 1
      );
    };
    const a = primitive(lo),
      b = primitive(hi);
    return a && b
      ? op('Divide', op('Multiply', c, op('Subtract', b, a)), p[1])
      : undefined;
  };
  const terms = isFunction(f, 'Add') ? f.ops : [f];
  if (terms.length > 64) return undefined;
  const values = terms.map(moment);
  return values.every((v) => v !== undefined)
    ? op('Add', ...(values as Expression[]))
    : undefined;
}
