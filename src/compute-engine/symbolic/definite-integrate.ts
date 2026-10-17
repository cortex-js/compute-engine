import type { Expression, IComputeEngine } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { checkDeadline } from '../../common/interruptible.js';
import { exactSign } from './contour.js';

type Range = readonly [Expression, Expression];

/** Exact, bounded operations used by the definite reductions. Unlike arithmetic
 * methods on number literals, these retain sums of unlike exact radicals. */
export function definiteArithmetic(ce: IComputeEngine) {
  return (h: string, ...xs: (Expression | number)[]) =>
    ce
      .function(
        h,
        xs.map((x) => (typeof x === 'number' ? ce.number(x) : x))
      )
      .evaluate();
}
const arithmetic = definiteArithmetic;

export function finiteConstant(e: Expression): boolean {
  // Symbolic sums/products of finite constants need not expose isFinite.
  // Numerical evaluation here only establishes finiteness, never a sign or
  // equality used in a mathematical certificate.
  return e.isFinite === true || e.N().isFinite === true;
}

function integer(e: Expression, min: number, max: number): number | undefined {
  return isNumber(e) &&
    e.isExact &&
    e.isInteger &&
    Number.isSafeInteger(e.re) &&
    e.re >= min &&
    e.re <= max
    ? e.re
    : undefined;
}

export function definiteUnshadowed(f: Expression): boolean {
  let nodes = 0;
  const walk = (e: Expression): boolean => {
    if (++nodes > 256) return false;
    return (
      !isFunction(e) ||
      (!shadowsLibraryName(e.engine, e.operator) && e.ops.every(walk))
    );
  };
  return (
    ![
      'Pi',
      'Factorial',
      'Sin',
      'Cos',
      'Ln',
      'Exp',
      'ExponentialE',
      'Sqrt',
      'Power',
      'Add',
      'Multiply',
      'Divide',
      'Subtract',
      'Negate',
      'Floor',
      'Fract',
      'Tan',
      'Arctan',
      'Root',
      'Beta',
      'Gamma',
      'PolyGamma',
      'Zeta',
      'HurwitzZeta',
      'PolyLog',
      'EulerGamma',
    ].some((h) => shadowsLibraryName(f.engine, h)) && walk(f)
  );
}
const unshadowed = definiteUnshadowed;

function halfIntegerGamma(ce: IComputeEngine, twice: number): Expression {
  const op = arithmetic(ce);
  return twice % 2 === 0
    ? op('Factorial', twice / 2 - 1)
    : op(
        'Divide',
        op('Multiply', op('Factorial', twice - 1), op('Sqrt', ce.Pi)),
        op(
          'Multiply',
          op('Power', 4, (twice - 1) / 2),
          op('Factorial', (twice - 1) / 2)
        )
      );
}

/** Proves a real continuous enclosure on a finite interval for a restricted
 * expression language. Unknown signs, poles and unsupported functions decline;
 * point samples are not continuity or convergence certificates. */
export function continuousRange(
  f: Expression,
  x: string,
  lo: Expression,
  hi: Expression,
  budget = { nodes: 256 }
): Range | undefined {
  if (--budget.nodes < 0) return undefined;
  const ce = f.engine,
    op = arithmetic(ce);
  checkDeadline(ce._deadlineFrame);
  if (sym(f) === x) return [lo, hi];
  if (!f.has(x)) {
    if (finiteConstant(f) && exactSign(f) !== undefined) return [f, f];
    return undefined;
  }
  if (!isFunction(f)) return undefined;
  const rs = f.ops.map((a) => continuousRange(a, x, lo, hi, budget));
  if (rs.some((r) => !r)) return undefined;
  const ranges = rs as Range[];
  const extremes = (xs: Expression[]): Range | undefined => {
    let a = xs[0],
      b = a;
    for (const v of xs.slice(1)) {
      const l = exactSign(op('Subtract', v, a)),
        u = exactSign(op('Subtract', v, b));
      if (l === undefined || u === undefined) return undefined;
      if (l < 0) a = v;
      if (u > 0) b = v;
    }
    return [a, b];
  };
  if (f.operator === 'Add')
    return [
      op('Add', ...ranges.map((r) => r[0])),
      op('Add', ...ranges.map((r) => r[1])),
    ];
  if (f.operator === 'Negate')
    return [op('Negate', ranges[0][1]), op('Negate', ranges[0][0])];
  if (f.operator === 'Multiply') {
    let r: Range = [ce.One, ce.One];
    for (const t of ranges) {
      const next = extremes([
        op('Multiply', r[0], t[0]),
        op('Multiply', r[0], t[1]),
        op('Multiply', r[1], t[0]),
        op('Multiply', r[1], t[1]),
      ]);
      if (!next) return undefined;
      r = next;
    }
    return r;
  }
  const [a, b] = ranges[0];
  if (f.operator === 'Divide') {
    const [c, d] = ranges[1];
    if (exactSign(c) !== 1 && exactSign(d) !== -1) return undefined;
    return extremes([
      op('Divide', a, c),
      op('Divide', a, d),
      op('Divide', b, c),
      op('Divide', b, d),
    ]);
  }
  if (f.operator === 'Sin' || f.operator === 'Cos') {
    const full: Range = [ce.NegativeOne, ce.One];
    if (ce.angularUnit !== 'rad') return full;
    const unit = op('Divide', ce.Pi, 2);
    const left = op('Divide', a, unit),
      right = op('Divide', b, unit);
    const i = integer(op('Floor', left), -4096, 4096),
      j = integer(op('Floor', right), -4096, 4096);
    if (
      i === undefined ||
      j === undefined ||
      j - i > 4 ||
      j < i ||
      ![0, 1].includes(exactSign(op('Subtract', left, i)) ?? -1) ||
      exactSign(op('Subtract', i + 1, left)) !== 1 ||
      ![0, 1].includes(exactSign(op('Subtract', right, j)) ?? -1) ||
      exactSign(op('Subtract', j + 1, right)) !== 1
    )
      return full;
    const values = [op(f.operator, a), op(f.operator, b)];
    for (let k = i + 1; k <= j; k++)
      values.push(op(f.operator, op('Multiply', k, unit)));
    return extremes(values) ?? full;
  }
  if (f.operator === 'Exp') return [op('Exp', a), op('Exp', b)];
  if (f.operator === 'Ln' && exactSign(a) === 1)
    return [op('Ln', a), op('Ln', b)];
  if (f.operator === 'Sqrt' && (exactSign(a) === 0 || exactSign(a) === 1))
    return [op('Sqrt', a), op('Sqrt', b)];
  if (f.operator === 'Power') {
    const n = integer(f.op2, 0, 4096);
    if (n !== undefined) {
      if (n === 0) return [ce.One, ce.One];
      const ends = [op('Power', a, n), op('Power', b, n)];
      if (n % 2 === 0 && exactSign(a) !== 1 && exactSign(b) !== -1)
        ends.push(ce.Zero);
      return extremes(ends);
    }
    if (!f.op2.has(x) && exactSign(a) === 1 && exactSign(f.op2) !== undefined)
      return extremes([op('Power', a, f.op2), op('Power', b, f.op2)]);
  }
  return undefined;
}

function parity(f: Expression, x: string): -1 | 1 | undefined {
  if (!f.has(x)) return 1;
  if (sym(f) === x) return -1;
  if (!isFunction(f)) return undefined;
  if (f.operator === 'Negate') return parity(f.op1, x);
  const p = f.ops.map((a) => parity(a, x));
  if (f.operator === 'Add' && p.every((v) => v === p[0])) return p[0];
  if (
    (f.operator === 'Multiply' || f.operator === 'Divide') &&
    p.every((v) => v !== undefined)
  )
    return p.reduce<number>((a, b) => a * b!, 1) as -1 | 1;
  if (f.operator === 'Power') {
    const n = integer(f.op2, 0, 4096);
    if (n !== undefined && p[0] !== undefined) return n % 2 === 0 ? 1 : p[0];
  }
  if (['Sin', 'Sinh', 'Tan', 'Arctan'].includes(f.operator)) return p[0];
  if (['Cos', 'Cosh', 'Abs'].includes(f.operator) && p[0] !== undefined)
    return 1;
  if (p[0] === 1 && ['Exp', 'Ln', 'Sqrt'].includes(f.operator)) return 1;
  return undefined;
}

/** Finite-interval reductions that establish integrability before applying
 * symmetry. The return value is absent when the required proof is unavailable. */
export function integrateDefiniteElementary(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  const ce = f.engine,
    op = arithmetic(ce);
  if (!f.isPure || !lower.isPure || !upper.isPure || !unshadowed(f))
    return undefined;
  const odd = parity(f, x) === -1;
  if (!odd && !(isFunction(f, 'Divide') && isFunction(f.op2, 'Add')))
    return undefined;
  const direction = exactSign(op('Subtract', upper, lower));
  if (direction !== 1 && direction !== -1) return undefined;
  const lo = direction === 1 ? lower : upper,
    hi = direction === 1 ? upper : lower;
  if (
    !finiteConstant(lo) ||
    !finiteConstant(hi) ||
    exactSign(lo) === undefined ||
    exactSign(hi) === undefined
  )
    return undefined;
  const orient = (e: Expression) => (direction === 1 ? e : op('Negate', e));
  const width = op('Subtract', hi, lo);
  if (op('Add', lo, hi).isSame(0) && odd && continuousRange(f, x, lo, hi))
    return ce.Zero;
  // p(x)/(p(x)+p(a+b-x)) has reflection sum 1. Enclosures certify that
  // neither branch nor the denominator can cross a singularity.
  if (
    isFunction(f, 'Divide') &&
    isFunction(f.op2, 'Add') &&
    f.op2.nops === 2 &&
    continuousRange(f, x, lo, hi)
  ) {
    const p = f.op1;
    const q = f.op2.ops.find((t) => !t.isSame(p));
    if (q && f.op2.ops.some((t) => t.isSame(p))) {
      const reflected = p
        .subs({ [x]: op('Subtract', op('Add', lo, hi), ce.symbol(x)) })
        .simplify();
      if (op('Subtract', reflected, q).simplify().isSame(0))
        return orient(op('Divide', width, 2));
    }
  }
  // On a positive quadrant, tan(x)^p and its reflected reciprocal have
  // complementary fractions, with finite one-sided limits at both endpoints.
  if (
    ce.angularUnit === 'rad' &&
    lo.isSame(0) &&
    hi.isSame(op('Divide', ce.Pi, 2)) &&
    isFunction(f, 'Divide') &&
    f.op1.isSame(1) &&
    isFunction(f.op2, 'Add')
  ) {
    const t = f.op2.ops.find((t) => !t.isSame(1));
    const base =
      t && (isFunction(t, 'Power') || isFunction(t, 'Sqrt')) ? t.op1 : t;
    const exponent =
      t && isFunction(t, 'Power')
        ? t.op2
        : t && isFunction(t, 'Sqrt')
          ? ce.Half
          : ce.One;
    if (
      f.op2.nops === 2 &&
      f.op2.ops.some((t) => t.isSame(1)) &&
      t &&
      base &&
      isFunction(base, 'Tan') &&
      sym(base.op1) === x &&
      !exponent.has(x) &&
      finiteConstant(exponent) &&
      exactSign(exponent) === 1
    )
      return orient(op('Divide', ce.Pi, 4));
  }
  return undefined;
}

/** Beta moments on [0,1] keep powers factored and avoid cancellation between
 * enormous expanded coefficients. Positive shape parameters certify convergence. */
export function integrateBetaMoment(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  const ce = f.engine,
    op = arithmetic(ce);
  const reversed = lower.isSame(1) && upper.isSame(0);
  if (!(lower.isSame(0) && upper.isSame(1)) && !reversed) return undefined;
  if (!f.isPure || !unshadowed(f)) return undefined;
  let p = ce.Zero,
    q = ce.Zero;
  const constants: Expression[] = [];
  const oneMinusX = op('Subtract', 1, ce.symbol(x));
  const collect = (e: Expression, power: Expression): boolean => {
    if (!power.isInteger) {
      const r = continuousRange(e, x, ce.Zero, ce.One);
      if (!r || ![0, 1].includes(exactSign(r[0]) ?? -1)) return false;
    }
    if (!e.has(x)) {
      if (
        e.isFinite !== true ||
        exactSign(e) === undefined ||
        (e.isSame(0) && exactSign(power) !== 1)
      )
        return false;
      constants.push(op('Power', e, power));
      return true;
    }
    if (sym(e) === x) {
      p = op('Add', p, power);
      return true;
    }
    if (e.isSame(oneMinusX)) {
      q = op('Add', q, power);
      return true;
    }
    if (isFunction(e, 'Multiply')) return e.ops.every((a) => collect(a, power));
    if (isFunction(e, 'Divide'))
      return collect(e.op1, power) && collect(e.op2, op('Negate', power));
    if (isFunction(e, 'Sqrt')) return collect(e.op1, op('Divide', power, 2));
    if (
      isFunction(e, 'Power') &&
      !e.op2.has(x) &&
      exactSign(e.op2) !== undefined
    ) {
      if (!power.isInteger) {
        const r = continuousRange(e.op1, x, ce.Zero, ce.One);
        if (!r || ![0, 1].includes(exactSign(r[0]) ?? -1)) return false;
      }
      return collect(e.op1, op('Multiply', power, e.op2));
    }
    return false;
  };
  if (!collect(f, ce.One)) return undefined;
  // Leave elementary single-endpoint powers to the registered provider and
  // power-rule path. This reduction is for genuinely two-endpoint moments.
  if (p.isSame(0) || q.isSame(0)) return undefined;
  const a = op('Add', p, 1),
    b = op('Add', q, 1);
  if (exactSign(a) !== 1 || exactSign(b) !== 1) return undefined;
  // Small integer/half-integer parameters have exact factorial/radical values.
  const twiceA = integer(op('Multiply', 2, a), 1, 8192),
    twiceB = integer(op('Multiply', 2, b), 1, 8192);
  if (twiceA === undefined || twiceB === undefined) return undefined;
  const gamma = (twice: number) => halfIntegerGamma(ce, twice);
  const value = op(
    'Multiply',
    ...constants,
    op(
      'Divide',
      op('Multiply', gamma(twiceA), gamma(twiceB)),
      gamma(twiceA + twiceB)
    )
  );
  return reversed ? op('Negate', value) : value;
}

/** Integrate finite trigonometric polynomials by real product-to-sum identities.
 * Large powers on complete quadrants use Wallis moments, not exponential expansion. */
export function integrateTrigPolynomial(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  const ce = f.engine,
    op = arithmetic(ce);
  if (
    !f.has(['Sin', 'Cos']) ||
    ce.angularUnit !== 'rad' ||
    !f.isPure ||
    !lower.isPure ||
    !upper.isPure ||
    !unshadowed(f) ||
    !finiteConstant(lower) ||
    !finiteConstant(upper)
  )
    return undefined;
  const direction = exactSign(op('Subtract', upper, lower));
  if (direction !== 1 && direction !== -1) return undefined;
  const lo = direction === 1 ? lower : upper,
    hi = direction === 1 ? upper : lower;
  const factors = isFunction(f, 'Multiply') ? f.ops : [f];
  let coefficient = ce.One,
    m = 0,
    n = 0,
    simple = true;
  const trigs: { head: 'Sin' | 'Cos'; arg: Expression; count: number }[] = [];
  for (const term of factors) {
    if (!term.has(x)) {
      if (term.isFinite !== true || exactSign(term) === undefined)
        return undefined;
      coefficient = op('Multiply', coefficient, term);
      continue;
    }
    const atom = isFunction(term, 'Power') ? term.op1 : term;
    const count = isFunction(term, 'Power') ? integer(term.op2, 0, 4096) : 1;
    if (
      !isFunction(atom) ||
      !['Sin', 'Cos'].includes(atom.operator) ||
      count === undefined
    )
      return undefined;
    const p = getPolynomialCoefficients(atom.op1, x);
    if (
      !p ||
      p.length > 2 ||
      !p.every((v) => !v.has(x) && exactSign(v) !== undefined)
    )
      return undefined;
    trigs.push({ head: atom.operator as 'Sin' | 'Cos', arg: atom.op1, count });
    if (sym(atom.op1) !== x) simple = false;
    if (atom.operator === 'Sin') m += count;
    else n += count;
  }
  if (trigs.length === 0) return undefined;
  // A lone affine sine/cosine already has an elementary primitive; preserve
  // the provider route used for smooth cells of piecewise integration.
  if (m + n === 1) return undefined;
  if (simple && m + n <= 4096) {
    let quadrants: number | undefined;
    if (lo.isSame(0) && hi.isSame(op('Divide', ce.Pi, 2))) quadrants = 1;
    if (lo.isSame(0) && hi.isSame(ce.Pi)) {
      if (n % 2) return ce.Zero;
      quadrants = 2;
    }
    if (
      (lo.isSame(0) && hi.isSame(op('Multiply', 2, ce.Pi))) ||
      (lo.isSame(op('Negate', ce.Pi)) && hi.isSame(ce.Pi))
    ) {
      if (m % 2 || n % 2) return ce.Zero;
      quadrants = 4;
    }
    if (quadrants !== undefined)
      return op(
        'Multiply',
        direction,
        coefficient,
        op(
          'Divide',
          op(
            'Multiply',
            quadrants,
            halfIntegerGamma(ce, m + 1),
            halfIntegerGamma(ce, n + 1)
          ),
          op('Multiply', 2, halfIntegerGamma(ce, m + n + 2))
        )
      );
  }
  if (trigs.reduce((a, t) => a + t.count, 0) > 8) return undefined;
  type Atom = { head: 'Sin' | 'Cos'; arg: Expression; coef: Expression };
  let terms: Atom[] = [{ head: 'Cos', arg: ce.Zero, coef: coefficient }];
  for (const t of trigs)
    for (let k = 0; k < t.count; k++) {
      checkDeadline(ce._deadlineFrame);
      const next: Atom[] = [];
      for (const a of terms) {
        const plus = op('Add', a.arg, t.arg),
          minus = op('Subtract', a.arg, t.arg),
          half = op('Divide', a.coef, 2);
        if (a.head === t.head) {
          next.push(
            { head: 'Cos', arg: minus, coef: half },
            {
              head: 'Cos',
              arg: plus,
              coef: a.head === 'Sin' ? op('Negate', half) : half,
            }
          );
        } else {
          next.push(
            { head: 'Sin', arg: plus, coef: half },
            {
              head: 'Sin',
              arg: minus,
              coef: a.head === 'Cos' ? op('Negate', half) : half,
            }
          );
        }
      }
      terms = next;
    }
  const values: Expression[] = [];
  for (const t of terms) {
    const p = getPolynomialCoefficients(t.arg, x);
    if (!p || p.length > 2) return undefined;
    const slope = p[1] ?? ce.Zero;
    if (slope.isSame(0))
      values.push(
        op('Multiply', t.coef, op(t.head, t.arg), op('Subtract', upper, lower))
      );
    else {
      if (exactSign(slope) === undefined) return undefined;
      const a = t.arg.subs({ [x]: lower }),
        b = t.arg.subs({ [x]: upper });
      const h = t.head === 'Sin' ? 'Cos' : 'Sin';
      values.push(
        op(
          'Divide',
          op(
            'Multiply',
            t.coef,
            t.head === 'Sin' ? -1 : 1,
            op('Subtract', op(h, b), op(h, a))
          ),
          slope
        )
      );
    }
  }
  return op('Add', ...values);
}
