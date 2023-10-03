import { BoxedExpression, BoxedDomain, IComputeEngine } from '../public';
import {
  getImaginaryCoef,
  bignumPreferred as bignumPreferred,
} from '../boxed-expression/utils';
import { Sum } from '../symbolic/sum';
import { asBignum, asFloat, MAX_SYMBOLIC_TERMS } from '../numerics/numeric';
import { widen } from '../boxed-expression/boxed-domain';
import { sortAdd } from '../boxed-expression/order';
import { checkArg } from '../boxed-expression/validate';
import { normalizeLimits } from './utils';

/** The canonical form of `Add`:
 * - removes `0`
 * - capture complex numbers (a + ib or ai +b)
 * */
export function canonicalAdd(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  console.assert(ops.every((x) => x.isCanonical));

  // Remove literal 0
  ops = ops.filter((x) => x.numericValue === null || !x.isZero);

  if (ops.length === 0) return ce.Zero;
  if (ops.length === 1) return ops[0];
  //
  // Is this a  complex number, i.e. `a + ib` or `ai + b`?
  //
  if (ops.length === 2) {
    let im: number | null = 0;
    let re: number | null = 0;
    re = asFloat(ops[0]);
    if (re !== null && re !== 0) im = getImaginaryCoef(ops[1]);
    else {
      im = getImaginaryCoef(ops[0]);
      if (im !== 0 && ops[1].numericValue !== null) re = asFloat(ops[1]);
    }
    if (re !== null && im !== null && im !== 0)
      return ce.number(ce.complex(re, im));
  }

  // Commutative, sort
  if (ops.length > 1) ops = sortAdd(ce, ops);

  return ce._fn('Add', ops);
}

export function domainAdd(
  _ce: IComputeEngine,
  args: BoxedDomain[]
): BoxedDomain | null {
  let dom: BoxedDomain | null = null;
  for (const arg of args) {
    if (!arg.isNumeric) return null;
    if (!dom) dom = arg;
    else dom = widen(dom, arg);
  }
  return dom;
}

export function simplifyAdd(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression {
  console.assert(args.length > 1, `simplifyAdd: not enough args`);

  const sum = new Sum(ce);
  for (let arg of args) {
    arg = arg.simplify();
    if (arg.isImaginary && arg.isInfinity) return ce.ComplexInfinity;
    if (arg.isNaN || arg.symbol === 'Undefined') return ce.NaN;
    if (!arg.isZero) sum.addTerm(arg);
  }

  return sum.asExpression('expression');
}

function evalAddNum(ops: BoxedExpression[]): number | null {
  let sum = 0;
  for (const op of ops) {
    const v = op.numericValue;
    if (typeof v === 'number') sum += v;
    else return null;
  }
  return sum;
}

export function evalAdd(
  ce: IComputeEngine,
  ops: BoxedExpression[],
  mode: 'N' | 'evaluate' = 'evaluate'
): BoxedExpression {
  // @fastpath
  if (mode === 'N' && ce.numericMode === 'machine') {
    ops = ops.map((x) => x.N());
    const sum = evalAddNum(ops);
    if (sum !== null) return ce.number(sum);
  }

  //
  // First pass: looking for early exits
  //
  for (const arg of ops) {
    if (arg.isImaginary && arg.isInfinity) return ce.ComplexInfinity;
    if (arg.isNaN || arg.symbol === 'Undefined') return ce.NaN;
    if (!arg.isExact) mode = 'N';
  }

  if (mode === 'N') ops = ops.map((x) => x.N());
  else ops = ops.map((x) => x.evaluate());
  return new Sum(ce, ops).asExpression(mode === 'N' ? 'numeric' : 'expression');
}

export function canonicalSummation(
  ce: IComputeEngine,
  body: BoxedExpression,
  range: BoxedExpression | undefined
) {
  // Sum is a scoped function (to declare the index)
  ce.pushScope();

  body ??= ce.error('missing');

  let index: BoxedExpression | null = null;
  let lower: BoxedExpression | null = null;
  let upper: BoxedExpression | null = null;
  if (
    range &&
    range.head !== 'Tuple' &&
    range.head !== 'Triple' &&
    range.head !== 'Pair' &&
    range.head !== 'Single'
  ) {
    index = range;
  } else if (range) {
    index = range.ops?.[0] ?? null;
    lower = range.ops?.[1]?.canonical ?? null;
    upper = range.ops?.[2]?.canonical ?? null;
  }

  if (index?.head === 'Hold') index = index.op1;
  if (index?.head === 'ReleaseHold') index = index.op1?.evaluate();
  index ??= ce.Nothing;

  if (index.symbol) {
    ce.declare(index.symbol, { domain: 'Integers' });
    index = ce.hold(index);
  } else index = ce.error(['incompatible-domain', 'Symbols', index.domain]);

  // The range bounds, if present, should be integers numbers
  if (lower && lower.isFinite) lower = checkArg(ce, lower, 'Integers');
  if (upper && upper.isFinite) upper = checkArg(ce, upper, 'Integers');

  if (lower && upper) range = ce.tuple([index, lower, upper]);
  else if (upper) range = ce.tuple([index, ce.One, upper]);
  else if (lower) range = ce.tuple([index, lower]);
  else range = index;

  const result = ce._fn('Sum', [body.canonical, range]);
  ce.popScope();
  return result;
}

export function evalSummation(
  ce: IComputeEngine,
  expr: BoxedExpression,
  range: BoxedExpression,
  mode: 'simplify' | 'N' | 'evaluate'
): BoxedExpression | undefined {
  const [index, lower, upper, isFinite] = normalizeLimits(range);

  const fn = expr;
  if (mode !== 'N' && (lower >= upper || upper - lower >= MAX_SYMBOLIC_TERMS))
    return undefined;

  let result: BoxedExpression | undefined | null = null;
  const savedContext = ce.swapScope(fn.scope);
  ce.pushScope();
  fn.rebind();

  if (mode === 'simplify') {
    const terms: BoxedExpression[] = [];
    for (let i = lower; i <= upper; i++) {
      ce.assign({ [index]: i });
      terms.push(fn.simplify());
    }
    result = ce.add(terms).simplify();
  }

  if (mode === 'evaluate') {
    const terms: BoxedExpression[] = [];
    for (let i = lower; i <= upper; i++) {
      ce.assign({ [index]: i });
      terms.push(fn.evaluate());
    }
    result = ce.add(terms).evaluate();
  }

  if (mode === 'N') {
    // if (result === null && !fn.scope) {
    //   //
    //   // The term is not a function of the index
    //   //

    //   const n = fn.N();
    //   if (!isFinite) {
    //     if (n.isZero) result = ce._ZERO;
    //     else if (n.isPositive) result = ce._POSITIVE_INFINITY;
    //     else result = ce._NEGATIVE_INFINITY;
    //   }
    //   if (result === null && fn.isPure)
    //     result = ce.mul([ce.number(upper - lower + 1), n]);

    //   // If the term is not a function of the index, but it is not pure,
    //   // fall through to the general case
    // }

    //
    // Finite series. Evaluate each term and add them up
    //
    if (result === null && isFinite) {
      if (bignumPreferred(ce)) {
        let sum = ce.bignum(0);
        for (let i = lower; i <= upper; i++) {
          ce.assign({ [index]: i });
          const term = asBignum(fn.N());
          if (term === null) {
            result = undefined;
            break;
          }
          if (!term.isFinite()) {
            sum = term;
            break;
          }
          sum = sum.add(term);
        }
        if (result === null) result = ce.number(sum);
      } else {
        // Machine precision
        const numericMode = ce.numericMode;
        ce.numericMode = 'machine';
        let sum = 0;
        for (let i = lower; i <= upper; i++) {
          ce.assign({ [index]: i });
          const term = asFloat(fn.N());
          if (term === null) {
            result = undefined;
            break;
          }
          if (!Number.isFinite(term)) {
            sum = term;
            break;
          }
          sum += term;
        }
        ce.numericMode = numericMode;
        if (result === null) result = ce.number(sum);
      }
    } else if (result === null) {
      //
      // Infinite series.
      //

      // First, check for divergence
      ce.assign({ [index]: 1000 });
      const nMax = fn.N();
      ce.assign({ [index]: 999 });
      const nMaxMinusOne = fn.N();

      const ratio = asFloat(ce.div(nMax, nMaxMinusOne).N());
      if (ratio !== null && Number.isFinite(ratio) && Math.abs(ratio) > 1) {
        result = ce.PositiveInfinity;
      } else {
        // Potentially converging series.
        // Evaluate as a machine number (it's an approximation to infinity, so
        // no point in calculating with high precision), and check for convergence
        let sum = 0;
        const numericMode = ce.numericMode;
        ce.numericMode = 'machine';
        for (let i = lower; i <= upper; i++) {
          ce.assign({ [index]: i });
          const term = asFloat(fn.N());
          if (term === null) {
            result = undefined;
            break;
          }
          // Converged (or diverged), early exit
          if (Math.abs(term) < Number.EPSILON || !Number.isFinite(term)) break;
          sum += term;
        }
        ce.numericMode = numericMode;
        if (result === null) result = ce.number(sum);
      }
    }
  }

  ce.popScope();
  ce.swapScope(savedContext);

  return result ?? undefined;
}
