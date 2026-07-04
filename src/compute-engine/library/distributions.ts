import {
  bigBetaRegularized,
  bigGammaQ,
  betaRegularized,
  gammaQ,
} from '../numerics/special-functions';
import { apply2, applyN, shouldNumericize } from '../boxed-expression/apply';
import { isFunction, isNumber } from '../boxed-expression/type-guards';
import {
  binomialQuantile,
  poissonQuantile,
} from '../numerics/distributions';
import type {
  Expression,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types';

//
// Probability distributions (Phase 1).
//
// Distributions are first-class inert *values* built by constructor heads
// (`NormalDistribution`, …), Mathematica-style. The generic `PDF`/`CDF`/
// `Quantile` operators consume them and **lower to a closed form** — a plain
// expression in the remaining symbolic arguments — so display, `simplify`,
// `D`, `Integrate`, `compile`, and plotting all work with no
// distribution-specific support. See `docs/plans/2026-07-04-statistics-design.md`.
//
// The two regularized incomplete functions the discrete CDFs lower to
// (`GammaRegularized`, `BetaRegularized`) are exposed as first-class special
// functions here as well, following the `Erf` template in `library/statistics.ts`.
//

const DISTRIBUTION_HEADS = [
  'NormalDistribution',
  'BinomialDistribution',
  'PoissonDistribution',
  'UniformDistribution',
  'ExponentialDistribution',
];

/** True if `x` is one of the five distribution constructor expressions. */
export function isDistributionExpression(x: Expression): boolean {
  return DISTRIBUTION_HEADS.includes(x.operator);
}

/** Operands of a distribution expression (always a function). */
function distOps(dist: Expression): ReadonlyArray<Expression> {
  return isFunction(dist) ? dist.ops : [];
}

/** Finite real value of a number literal, or `undefined` if not a literal. */
function litVal(x: Expression): number | undefined {
  if (isNumber(x) && x.im === 0 && x.isFinite === true) return x.re;
  return undefined;
}

/** Build an out-of-range error node for a bad literal parameter. */
function rangeError(ce: ComputeEngine, expected: string, x: Expression) {
  return ce.error(['out-of-range', expected, x.toString()]);
}

export const DISTRIBUTIONS_LIBRARY: SymbolDefinitions[] = [
  {
    //
    // Regularized incomplete gamma / beta, following the `Erf` template:
    // exact special values fold in `evaluate()`; an inexact (float) argument
    // numericizes even under plain `evaluate()` (policy D2); `.N()` always
    // numericizes, dispatching machine vs. bignum via `shouldNumericize`.
    // Complex arguments stay symbolic (no complex kernel).
    //
    GammaRegularized: {
      description:
        'Regularized upper incomplete gamma function Q(a, z) = Γ(a, z)/Γ(a)',
      complexity: 7500,
      signature: '(number, number) -> number',
      type: () => 'finite_real',
      evaluate: ([a, z], { numericApproximation, engine: ce }) => {
        if (!a || !z) return undefined;
        // Q(a, 0) = 1 (for any a); Q(1, z) = e^{−z} (for any z) — fold even
        // when the other argument is symbolic.
        if (isNumber(z) && z.isSame(0)) return ce.One;
        if (isNumber(a) && a.isSame(1)) {
          const r = ce.function('Exp', [ce.function('Negate', [z])]);
          return numericApproximation ? r.N() : r.evaluate();
        }
        if (!isNumber(a) || !isNumber(z)) return undefined;
        if (a.im !== 0 || z.im !== 0) return undefined; // complex → symbolic
        if (!shouldNumericize(numericApproximation, a, z)) return undefined;
        return apply2(
          a,
          z,
          (a, z) => gammaQ(a, z),
          (a, z) => bigGammaQ(ce, a, z)
        );
      },
    },

    BetaRegularized: {
      description: 'Regularized incomplete beta function I_x(a, b)',
      complexity: 7500,
      signature: '(number, number, number) -> number',
      type: () => 'finite_real',
      evaluate: ([x, a, b], { numericApproximation, engine: ce }) => {
        if (!x || !a || !b) return undefined;
        // I_0(a, b) = 0, I_1(a, b) = 1 — fold even when a, b are symbolic.
        if (isNumber(x) && x.isSame(0)) return ce.Zero;
        if (isNumber(x) && x.isSame(1)) return ce.One;
        if (!isNumber(x) || !isNumber(a) || !isNumber(b)) return undefined;
        if (x.im !== 0 || a.im !== 0 || b.im !== 0) return undefined;
        if (!shouldNumericize(numericApproximation, x, a, b)) return undefined;
        return applyN(
          [x, a, b],
          (x, a, b) => betaRegularized(x, a, b),
          (x, a, b) => bigBetaRegularized(ce, x, a, b)
        );
      },
    },
  },

  {
    //
    // Distribution constructors: canonical but inert (no `evaluate`). They
    // validate arity and *literal* out-of-range parameters; symbolic
    // parameters pass through untouched.
    //
    NormalDistribution: {
      description:
        'Normal (Gaussian) distribution with mean μ and standard deviation σ.',
      signature: '(number, number) -> expression<NormalDistribution>',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 2) return null;
        const mu = ops[0].canonical;
        let sigma = ops[1].canonical;
        const s = litVal(sigma);
        if (s !== undefined && s <= 0) sigma = rangeError(ce, 'σ > 0', sigma);
        return ce._fn('NormalDistribution', [mu, sigma]);
      },
    },

    BinomialDistribution: {
      description:
        'Binomial distribution: number of successes in n independent trials, ' +
        'each with success probability p.',
      signature: '(number, number) -> expression<BinomialDistribution>',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 2) return null;
        let n = ops[0].canonical;
        let p = ops[1].canonical;
        if (isNumber(n) && (n.isInteger !== true || n.re < 0))
          n = rangeError(ce, 'n ∈ ℤ≥0', n);
        const pv = litVal(p);
        if (pv !== undefined && (pv < 0 || pv > 1))
          p = rangeError(ce, '0 ≤ p ≤ 1', p);
        return ce._fn('BinomialDistribution', [n, p]);
      },
    },

    PoissonDistribution: {
      description: 'Poisson distribution with rate parameter λ.',
      signature: '(number) -> expression<PoissonDistribution>',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 1) return null;
        let lambda = ops[0].canonical;
        const l = litVal(lambda);
        if (l !== undefined && l <= 0) lambda = rangeError(ce, 'λ > 0', lambda);
        return ce._fn('PoissonDistribution', [lambda]);
      },
    },

    UniformDistribution: {
      description: 'Continuous uniform distribution on the interval [a, b].',
      signature: '(number, number) -> expression<UniformDistribution>',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 2) return null;
        const a = ops[0].canonical;
        let b = ops[1].canonical;
        const av = litVal(a);
        const bv = litVal(b);
        if (av !== undefined && bv !== undefined && av >= bv)
          b = rangeError(ce, 'a < b', b);
        return ce._fn('UniformDistribution', [a, b]);
      },
    },

    ExponentialDistribution: {
      description: 'Exponential distribution with rate parameter λ.',
      signature: '(number) -> expression<ExponentialDistribution>',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 1) return null;
        let lambda = ops[0].canonical;
        const l = litVal(lambda);
        if (l !== undefined && l <= 0) lambda = rangeError(ce, 'λ > 0', lambda);
        return ce._fn('ExponentialDistribution', [lambda]);
      },
    },
  },

  {
    //
    // `PDF`/`CDF`/`Quantile`: lower to the closed form for the distribution.
    // `evaluate` returns the exact/symbolic form; `.N()` numericizes it.
    //
    PDF: {
      description:
        'Probability density (continuous) or mass (discrete) function of a ' +
        'distribution, evaluated at x.',
      complexity: 7500,
      signature: '(distribution, number) -> number',
      evaluate: ([dist, x], { numericApproximation, engine: ce }) => {
        if (!dist || !x || !isDistributionExpression(dist)) return undefined;
        const r = distributionPDF(ce, dist, x);
        if (!r) return undefined;
        return numericApproximation ? r.N() : r.evaluate();
      },
    },

    CDF: {
      description:
        'Cumulative distribution function P(X ≤ x) of a distribution.',
      complexity: 7500,
      signature: '(distribution, number) -> number',
      evaluate: ([dist, x], { numericApproximation, engine: ce }) => {
        if (!dist || !x || !isDistributionExpression(dist)) return undefined;
        const r = distributionCDF(ce, dist, x);
        if (!r) return undefined;
        return numericApproximation ? r.N() : r.evaluate();
      },
    },

    Quantile: {
      description:
        'Quantile (inverse CDF): the least x with CDF(x) ≥ p, for p in [0, 1].',
      complexity: 7500,
      signature: '(distribution, number) -> number',
      evaluate: ([dist, p], { numericApproximation, engine: ce }) => {
        if (!dist || !p || !isDistributionExpression(dist)) return undefined;
        const pv = litVal(p);
        if (pv !== undefined && (pv < 0 || pv > 1))
          return rangeError(ce, '0 ≤ p ≤ 1', p);
        const r = distributionQuantile(ce, dist, p, pv, !!numericApproximation);
        if (!r) return undefined;
        return numericApproximation ? r.N() : r.evaluate();
      },
    },
  },
];

//
// Closed-form lowering. All construction uses `ce.function('Add'|…)` (never the
// `.add()`/`.mul()` methods, which fold exact literal pairs to floats), and no
// handler calls `.simplify()`. The returned expression is evaluated by the
// caller (exact under `evaluate`, float under `.N()`).
//

function distributionPDF(
  ce: ComputeEngine,
  dist: Expression,
  x: Expression
): Expression | undefined {
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const sub = (a: Expression, b: Expression) => ce.function('Subtract', [a, b]);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const pow = (a: Expression, b: Expression) => ce.function('Power', [a, b]);
  const neg = (a: Expression) => ce.function('Negate', [a]);
  const fn = (h: string, a: Expression[]) => ce.function(h, a);
  const xv = litVal(x);

  switch (dist.operator) {
    case 'NormalDistribution': {
      const [mu, sigma] = distOps(dist);
      const z = sub(x, mu);
      const num = fn('Exp', [
        neg(div(pow(z, ce.number(2)), mul([ce.number(2), pow(sigma, ce.number(2))]))),
      ]);
      const den = mul([sigma, fn('Sqrt', [mul([ce.number(2), ce.Pi])])]);
      return div(num, den);
    }

    case 'BinomialDistribution': {
      const [n, p] = distOps(dist);
      // Discrete: density at a numeric non-integer point is 0.
      if (xv !== undefined && !Number.isInteger(xv)) return ce.Zero;
      const k = x;
      return mul([
        fn('Binomial', [n, k]),
        pow(p, k),
        pow(sub(ce.One, p), sub(n, k)),
      ]);
    }

    case 'PoissonDistribution': {
      const [lambda] = distOps(dist);
      if (xv !== undefined && !Number.isInteger(xv)) return ce.Zero;
      const k = x;
      return div(
        mul([pow(lambda, k), fn('Exp', [neg(lambda)])]),
        fn('Factorial', [k])
      );
    }

    case 'UniformDistribution': {
      const [a, b] = distOps(dist);
      const av = litVal(a);
      const bv = litVal(b);
      // Numeric point outside the support has zero density.
      if (xv !== undefined && av !== undefined && bv !== undefined && (xv < av || xv > bv))
        return ce.Zero;
      return div(ce.One, sub(b, a));
    }

    case 'ExponentialDistribution': {
      const [lambda] = distOps(dist);
      if (xv !== undefined && xv < 0) return ce.Zero;
      return mul([lambda, fn('Exp', [neg(mul([lambda, x]))])]);
    }
  }
  return undefined;
}

function distributionCDF(
  ce: ComputeEngine,
  dist: Expression,
  x: Expression
): Expression | undefined {
  const add = (a: Expression[]) => ce.function('Add', a);
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const sub = (a: Expression, b: Expression) => ce.function('Subtract', [a, b]);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const fn = (h: string, a: Expression[]) => ce.function(h, a);
  const xv = litVal(x);

  switch (dist.operator) {
    case 'NormalDistribution': {
      const [mu, sigma] = distOps(dist);
      const arg = div(sub(x, mu), mul([sigma, fn('Sqrt', [ce.number(2)])]));
      return mul([ce.Half, add([ce.One, fn('Erf', [arg])])]);
    }

    case 'BinomialDistribution': {
      const [n, p] = distOps(dist);
      const nv = litVal(n);
      // Numeric outside support: below 0 → 0, at/above n → 1.
      if (xv !== undefined && xv < 0) return ce.Zero;
      if (xv !== undefined && nv !== undefined && xv >= nv) return ce.One;
      // Use ⌊k⌋ only for a numeric non-integer point; symbolic/integer k pass
      // through directly.
      const k =
        xv !== undefined && !Number.isInteger(xv)
          ? fn('Floor', [x]).evaluate()
          : x;
      // CDF(k) = I_{1−p}(n−k, k+1)
      return fn('BetaRegularized', [
        sub(ce.One, p),
        sub(n, k),
        add([k, ce.One]),
      ]);
    }

    case 'PoissonDistribution': {
      const [lambda] = distOps(dist);
      if (xv !== undefined && xv < 0) return ce.Zero;
      const k =
        xv !== undefined && !Number.isInteger(xv)
          ? fn('Floor', [x]).evaluate()
          : x;
      // CDF(k) = Q(⌊k⌋+1, λ)
      return fn('GammaRegularized', [add([k, ce.One]), lambda]);
    }

    case 'UniformDistribution': {
      const [a, b] = distOps(dist);
      const av = litVal(a);
      const bv = litVal(b);
      if (xv !== undefined && av !== undefined && xv <= av) return ce.Zero;
      if (xv !== undefined && bv !== undefined && xv >= bv) return ce.One;
      return div(sub(x, a), sub(b, a));
    }

    case 'ExponentialDistribution': {
      const [lambda] = distOps(dist);
      if (xv !== undefined && xv < 0) return ce.Zero;
      return sub(ce.One, fn('Exp', [ce.function('Negate', [mul([lambda, x])])]));
    }
  }
  return undefined;
}

function distributionQuantile(
  ce: ComputeEngine,
  dist: Expression,
  p: Expression,
  pv: number | undefined,
  numericApproximation: boolean
): Expression | undefined {
  const add = (a: Expression[]) => ce.function('Add', a);
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const sub = (a: Expression, b: Expression) => ce.function('Subtract', [a, b]);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const neg = (a: Expression) => ce.function('Negate', [a]);
  const fn = (h: string, a: Expression[]) => ce.function(h, a);

  switch (dist.operator) {
    case 'NormalDistribution': {
      const [mu, sigma] = distOps(dist);
      if (pv === 0) return ce.NegativeInfinity;
      if (pv === 1) return ce.PositiveInfinity;
      // μ + σ·√2·ErfInv(2p − 1)
      const inner = fn('ErfInv', [sub(mul([ce.number(2), p]), ce.One)]);
      return add([mu, mul([sigma, fn('Sqrt', [ce.number(2)]), inner])]);
    }

    case 'UniformDistribution': {
      const [a, b] = distOps(dist);
      if (pv === 0) return a;
      if (pv === 1) return b;
      // a + p·(b − a)
      return add([a, mul([p, sub(b, a)])]);
    }

    case 'ExponentialDistribution': {
      const [lambda] = distOps(dist);
      if (pv === 0) return ce.Zero;
      if (pv === 1) return ce.PositiveInfinity;
      // −ln(1 − p)/λ
      return div(neg(fn('Ln', [sub(ce.One, p)])), lambda);
    }

    case 'BinomialDistribution': {
      const [n, p0] = distOps(dist);
      const nv = litVal(n);
      if (pv === 0) return ce.Zero;
      if (pv === 1) return nv !== undefined ? ce.number(nv) : ce.PositiveInfinity;
      // No closed form: stay symbolic under `evaluate`; search under `.N()`.
      if (!numericApproximation) return undefined;
      const nn = litVal(n);
      const ppv = litVal(p0);
      if (nn === undefined || ppv === undefined || pv === undefined)
        return undefined;
      return ce.number(binomialQuantile(nn, ppv, pv, ce._deadline));
    }

    case 'PoissonDistribution': {
      const [lambda] = distOps(dist);
      if (pv === 0) return ce.Zero;
      if (pv === 1) return ce.PositiveInfinity;
      if (!numericApproximation) return undefined;
      const lv = litVal(lambda);
      if (lv === undefined || pv === undefined) return undefined;
      return ce.number(poissonQuantile(lv, pv, ce._deadline));
    }
  }
  return undefined;
}

//
// Distribution moments — consumed by the `Mean`/`Variance`/`StandardDeviation`
// overloads in `library/statistics.ts`. Exact/symbolic construction as above.
//

export function distributionMean(
  ce: ComputeEngine,
  dist: Expression
): Expression | undefined {
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const add = (a: Expression[]) => ce.function('Add', a);
  switch (dist.operator) {
    case 'NormalDistribution':
      return distOps(dist)[0].evaluate();
    case 'BinomialDistribution':
      return mul([distOps(dist)[0], distOps(dist)[1]]).evaluate();
    case 'PoissonDistribution':
      return distOps(dist)[0].evaluate();
    case 'UniformDistribution':
      return div(add([distOps(dist)[0], distOps(dist)[1]]), ce.number(2)).evaluate();
    case 'ExponentialDistribution':
      return div(ce.One, distOps(dist)[0]).evaluate();
  }
  return undefined;
}

export function distributionVariance(
  ce: ComputeEngine,
  dist: Expression
): Expression | undefined {
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const sub = (a: Expression, b: Expression) => ce.function('Subtract', [a, b]);
  const pow = (a: Expression, b: Expression) => ce.function('Power', [a, b]);
  switch (dist.operator) {
    case 'NormalDistribution':
      return pow(distOps(dist)[1], ce.number(2)).evaluate();
    case 'BinomialDistribution': {
      const [n, p] = distOps(dist);
      return mul([n, p, sub(ce.One, p)]).evaluate();
    }
    case 'PoissonDistribution':
      return distOps(dist)[0].evaluate();
    case 'UniformDistribution': {
      const [a, b] = distOps(dist);
      return div(pow(sub(b, a), ce.number(2)), ce.number(12)).evaluate();
    }
    case 'ExponentialDistribution':
      return div(ce.One, pow(distOps(dist)[0], ce.number(2))).evaluate();
  }
  return undefined;
}

export function distributionStandardDeviation(
  ce: ComputeEngine,
  dist: Expression
): Expression | undefined {
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  // Normal and Exponential have elementary standard deviations (σ and 1/λ);
  // the rest are the square root of the variance form.
  switch (dist.operator) {
    case 'NormalDistribution':
      return distOps(dist)[1].evaluate();
    case 'ExponentialDistribution':
      return div(ce.One, distOps(dist)[0]).evaluate();
    default: {
      const v = distributionVariance(ce, dist);
      if (!v) return undefined;
      return ce.function('Sqrt', [v]).evaluate();
    }
  }
}
