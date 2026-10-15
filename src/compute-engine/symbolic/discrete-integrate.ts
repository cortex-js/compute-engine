import type { Expression, IComputeEngine } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { exactSign } from './contour.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { checkDeadline } from '../../common/interruptible.js';
import { angularChainFactor } from './angular-unit.js';

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
  // The `.add()`, `.sub()`, `.mul()` and `.div()` methods fold two exact
  // number literals that do not combine exactly (for example √2 and 1) to a
  // machine float. These helpers build each combination as a function
  // expression and evaluate it, so that the result stays exact.
  const add = (...xs: Expression[]) => ce.function('Add', xs).evaluate();
  const sub = (x: Expression, y: Expression) =>
    ce.function('Subtract', [x, y]).evaluate();
  const mul = (...xs: Expression[]) => ce.function('Multiply', xs).evaluate();
  const div = (x: Expression, y: Expression) =>
    ce.function('Divide', [x, y]).evaluate();
  const neg = (x: Expression) => ce.function('Negate', [x]).evaluate();
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
    const left = exactSign(ce.function('Subtract', [x, n]));
    return left !== undefined &&
      left >= 0 &&
      exactSign(ce.function('Subtract', [n.add(1), x])) === 1
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
        const u = add(m, mul(k, x));
        const n = floor(u);
        if (n === undefined) return undefined;
        const two = ce.number(2);
        const three = ce.number(3);
        const f0 = add(div(mul(n, sub(n, ce.One)), two), mul(n, sub(u, n)));
        const f1 = add(
          div(
            mul(n, sub(n, ce.One), add(mul(n, ce.number(4)), ce.One)),
            ce.number(12)
          ),
          div(mul(n, sub(u.pow(2), n.pow(2))), two)
        );
        if (selector.operator === 'Floor') return [f0, f1];
        if (selector.operator === 'Ceil')
          return [add(f0, u), add(f1, div(u.pow(2), two))];
        return [sub(div(u.pow(2), two), f0), sub(div(u.pow(3), three), f1)];
      };
      const a = moments(lo);
      const b = moments(hi);
      if (!a || !b) return undefined;
      const slope = div(w[1], k);
      const offset = sub(w[0], mul(slope, m));
      return div(
        add(mul(offset, sub(b[0], a[0])), mul(slope, sub(b[1], a[1]))),
        k
      );
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
    const t = div(c, hi);
    const n = floor(t);
    // Bound the exact harmonic-number construction independently of jump count.
    if (!n || !Number.isSafeInteger(n.re) || n.re < 0 || n.re > 128)
      return undefined;
    let harmonic = ce.Zero;
    for (let j = 1; j <= n.re; j++) {
      checkDeadline(ce._deadlineFrame);
      harmonic = add(harmonic, div(ce.One, ce.number(j)));
    }
    return mul(
      c,
      add(
        harmonic,
        neg(ce.symbol('EulerGamma')),
        neg(ce.function('Ln', [t])),
        ce.One,
        neg(div(n, t))
      )
    );
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
  const u = add(m, mul(k, direction > 0 ? lo : hi));
  const v = add(m, mul(k, direction > 0 ? hi : lo));
  // The period of `Sin` and `Cos` in the engine's angular unit is 2π/chain,
  // where chain is the factor from the unit to radians (π/180 in degree
  // mode, so the period is 360), and one period of |sin| integrates to
  // 4/chain.
  const chain = angularChainFactor(ce);
  const period = div(mul(ce.Pi, ce.number(2)), chain);
  const count = floor(div(sub(v, u), period));
  if (!count || exactSign(count) !== 1) return undefined;
  const start = floor(div(u, period));
  if (!start) return undefined;
  const phase = sub(u, mul(start, period));
  const remainder = sub(sub(v, u), mul(count, period));
  const end = add(phase, remainder);
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
  return div(
    add(
      mul(
        count,
        selector.operator === 'Abs' ? div(ce.number(4), chain) : ce.Zero
      ),
      tail
    ),
    direction > 0 ? k : neg(k)
  );
}
