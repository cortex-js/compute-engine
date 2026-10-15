import type { Expression, IComputeEngine } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { exactSign } from './contour.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { checkDeadline } from '../../common/interruptible.js';

// These reductions avoid enumerating integer crossings. Unsupported arguments
// still go through the bounded piecewise partitioner.
export function integrateDiscrete(
  ce: IComputeEngine,
  body: Expression,
  variable: string,
  lo: Expression,
  hi: Expression
): Expression | undefined {
  checkDeadline(ce._deadlineFrame);
  const affine = (e: Expression): [Expression, Expression] | undefined => {
    const p = getPolynomialCoefficients(e, variable);
    if (!p || p.length > 2) return undefined;
    const a = (p[0] ?? ce.Zero).evaluate();
    const b = (p[1] ?? ce.Zero).evaluate();
    return [a, b].every(
      (x) => x.isFinite !== false && x.isNaN !== true && x.type.matches('real')
    )
      ? [a, b]
      : undefined;
  };
  const floor = (x: Expression): Expression | undefined => {
    if (shadowsLibraryName(ce, 'Floor')) return undefined;
    const n = ce.function('Floor', [x]).evaluate();
    if (!isNumber(n) || !n.isExact || !n.isInteger) return undefined;
    // Exact enclosure refinement must separate both neighbors. A rounded
    // integer at the precision limit is not an admissible period count.
    const left = exactSign(x.sub(n));
    return left !== undefined && left >= 0 && exactSign(n.add(1).sub(x)) === 1
      ? n
      : undefined;
  };
  let selector = body;
  let weight = ce.One;
  if (isFunction(body, 'Multiply')) {
    const parts = body.ops.filter((x) => x.has(['Floor', 'Ceil', 'Fract']));
    if (parts.length !== 1) return undefined;
    selector = parts[0];
    weight = ce.function(
      'Multiply',
      body.ops.filter((x) => x !== selector)
    );
  }
  if (!isFunction(selector) || shadowsLibraryName(ce, selector.operator))
    return undefined;
  if (['Floor', 'Ceil', 'Fract'].includes(selector.operator)) {
    const p = affine(selector.op1);
    const w = affine(weight);
    if (p && w && exactSign(p[1]) !== undefined && exactSign(p[1]) !== 0) {
      const [m, k] = p;
      // After u = k*x + m, an affine weight needs only moments 0 and 1.
      const moments = (x: Expression): [Expression, Expression] | undefined => {
        const u = m.add(k.mul(x)).evaluate();
        const n = floor(u);
        if (n === undefined) return undefined;
        const f0 = n
          .mul(n.sub(ce.One))
          .div(2)
          .add(n.mul(u.sub(n)));
        const f1 = n
          .mul(n.sub(ce.One))
          .mul(n.mul(4).add(1))
          .div(12)
          .add(n.mul(u.pow(2).sub(n.pow(2))).div(2));
        if (selector.operator === 'Floor') return [f0, f1];
        if (selector.operator === 'Ceil')
          return [f0.add(u), f1.add(u.pow(2).div(2))];
        return [u.pow(2).div(2).sub(f0), u.pow(3).div(3).sub(f1)];
      };
      const a = moments(lo);
      const b = moments(hi);
      if (!a || !b) return undefined;
      const slope = w[1].div(k);
      const offset = w[0].sub(slope.mul(m));
      return offset
        .mul(b[0].sub(a[0]))
        .add(slope.mul(b[1].sub(a[1])))
        .div(k)
        .evaluate();
    }
    // For c/x on (0,b], floor and ceiling diverge by comparison with c/x.
    // The fractional part is bounded; its cell sum telescopes using
    // H_n - log(n) -> EulerGamma. Only positive c and b are admitted.
    if (
      !weight.isSame(1) ||
      !lo.isSame(0) ||
      exactSign(hi) !== 1 ||
      !isFunction(selector.op1, 'Divide') ||
      sym(selector.op1.op2) !== variable
    )
      return undefined;
    const c = selector.op1.op1.evaluate();
    if (c.has(variable) || c.isFinite !== true || exactSign(c) !== 1)
      return undefined;
    if (selector.operator !== 'Fract') return ce.PositiveInfinity;
    if (shadowsLibraryName(ce, 'EulerGamma') || shadowsLibraryName(ce, 'Ln'))
      return undefined;
    const t = c.div(hi).evaluate();
    const n = floor(t);
    // Bound the exact harmonic-number construction independently of jump count.
    if (!n || !Number.isSafeInteger(n.re) || n.re < 0 || n.re > 128)
      return undefined;
    let harmonic = ce.Zero;
    for (let j = 1; j <= n.re; j++) {
      checkDeadline(ce._deadlineFrame);
      harmonic = harmonic.add(ce.One.div(j));
    }
    return c
      .mul(
        harmonic
          .sub(ce.symbol('EulerGamma'))
          .sub(ce.function('Ln', [t]))
          .add(1)
          .sub(n.div(t))
      )
      .evaluate();
  }
  if (
    !weight.isSame(1) ||
    !['Abs', 'Sign'].includes(selector.operator) ||
    !isFunction(selector.op1) ||
    !['Sin', 'Cos'].includes(selector.op1.operator) ||
    shadowsLibraryName(ce, selector.op1.operator)
  )
    return undefined;
  if (shadowsLibraryName(ce, 'Pi')) return undefined;
  const p = affine(selector.op1.op1);
  if (!p) return undefined;
  const [m, k] = p;
  const direction = exactSign(k);
  if (direction === undefined || direction === 0) return undefined;
  const u = m.add(k.mul(direction > 0 ? lo : hi)).evaluate();
  const v = m.add(k.mul(direction > 0 ? hi : lo)).evaluate();
  const period = ce.Pi.mul(2);
  const count = floor(v.sub(u).div(period));
  if (!count || exactSign(count) !== 1) return undefined;
  const start = floor(u.div(period));
  if (!start) return undefined;
  const phase = u.sub(start.mul(period)).evaluate();
  const remainder = v.sub(u).sub(count.mul(period)).evaluate();
  const end = phase.add(remainder).evaluate();
  const f = ce.function(selector.operator, [
    ce.function(selector.op1.operator, [ce.symbol(variable)]),
  ]);
  const tail = ce
    .function('Integrate', [
      f,
      ce.function('Limits', [ce.symbol(variable), phase, end]),
    ])
    .evaluate();
  if (
    tail.has(['Integrate', 'Limit', 'EvaluateAt']) ||
    tail.isFinite === false ||
    tail.isNaN === true ||
    !tail.type.matches('real')
  )
    return undefined;
  return count
    .mul(selector.operator === 'Abs' ? 4 : 0)
    .add(tail)
    .div(direction > 0 ? k : k.neg())
    .evaluate();
}
