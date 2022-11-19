import {
  BoxedExpression,
  BoxedDomain,
  IComputeEngine,
  Rational,
} from '../public';
import {
  getImaginaryCoef,
  bignumPreferred as bignumPreferred,
} from '../boxed-expression/utils';
import { flattenOps, flattenSequence } from '../symbolic/flatten';
import { Sum } from '../symbolic/sum';
import {
  asFloat,
  asSmallInteger,
  MAX_ITERATION,
  MAX_SYMBOLIC_TERMS,
} from '../numerics/numeric';
import { add, isMachineRational } from '../numerics/rationals';
import { sharedAncestorDomain } from '../boxed-expression/boxed-domain';
import { sortAdd } from '../boxed-expression/order';

/** The canonical form of `Add`:
 * - removes `0`
 * - capture complex numbers (a + ib or ai +b)
 * */
export function canonicalAdd(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  console.assert(ops.every((x) => x.isCanonical));

  ops = flattenOps(flattenSequence(ops.map((x) => x.canonical)), 'Add') ?? ops;

  // Remove literal 0
  ops = ops.filter((x) => x.numericValue === null || !x.isZero);

  if (ops.length === 0) return ce.number(0);
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
    else dom = sharedAncestorDomain(dom, arg);
  }
  return dom;
}

export function simplifyAdd(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | undefined {
  console.assert(args.length > 1, `simplifyAdd: not enough args`);

  const sum = new Sum(ce);
  for (let arg of args) {
    arg = arg.simplify();
    if (arg.isImaginary && arg.isInfinity) return ce.symbol('ComplexInfinity');
    if (arg.isNaN || arg.symbol === 'Undefined') return ce._NAN;
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
    if (arg.isImaginary && arg.isInfinity) return ce.symbol('ComplexInfinity');
    if (arg.isNaN || arg.symbol === 'Undefined') return ce._NAN;
    if (!arg.isExact) mode = 'N';
  }

  console.assert(flattenOps(ops, 'Add') === null);

  if (mode === 'N') ops = ops.map((x) => x.N());
  else ops = ops.map((x) => x.evaluate());
  return new Sum(ce, ops).asExpression(mode === 'N' ? 'numeric' : 'expression');
}

export function canonicalSummation(
  ce: IComputeEngine,
  body: BoxedExpression,
  range: BoxedExpression | undefined
) {
  body ??= ce.error(['missing', 'Function']); // @todo not exactly a function, more like a 'NumericExpression'

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
  index ??= ce.symbol('Nothing');

  if (!index.symbol)
    index = ce.error(['incompatible-domain', 'Symbol', index.domain]);

  if (index.symbol) ce.pushScope({ [index.symbol]: { domain: 'Integer' } });
  const fn = body.canonical;
  if (index.symbol) {
    ce.popScope();
    index = index = ce.hold(index);
  }

  if (lower && upper) range = ce.tuple([index, lower, upper]);
  else if (upper)
    range = ce.tuple([index, lower ?? ce._NEGATIVE_INFINITY, upper]);
  else if (lower) range = ce.tuple([index, lower]);
  else range = index;

  return ce._fn('Sum', [fn, range]);
}

export function evalSummation(
  ce: IComputeEngine,
  expr: BoxedExpression,
  range: BoxedExpression,
  mode: 'simplify' | 'N' | 'evaluate'
): BoxedExpression | undefined {
  const fn = expr;

  let lower = 1;
  let upper = MAX_ITERATION;
  let index = 'Nothing';
  if (
    range.head === 'Tuple' ||
    range.head === 'Triple' ||
    range.head === 'Pair' ||
    range.head === 'Single'
  ) {
    index =
      (range.op1.head === 'Hold' ? range.op1.op1.symbol : range.op1.symbol) ??
      'Nothing';
    lower = asSmallInteger(range.op2) ?? 1;
    upper = asSmallInteger(range.op3) ?? MAX_ITERATION;
  }
  if (lower >= upper || upper - lower >= MAX_SYMBOLIC_TERMS) return undefined;

  const savedContext = ce.context;
  ce.context = fn.scope ?? ce.context;

  if (mode === 'simplify') {
    const terms: BoxedExpression[] = [];
    if (!fn.scope)
      for (let i = lower; i <= upper; i++) terms.push(fn.simplify());
    else
      for (let i = lower; i <= upper; i++) {
        ce.set({ [index]: i });
        terms.push(fn.simplify());
      }
    ce.context = savedContext;
    return ce.add(terms).simplify();
  }

  if (mode === 'evaluate') {
    const terms: BoxedExpression[] = [];
    if (!fn.scope)
      for (let i = lower; i <= upper; i++) terms.push(fn.evaluate());
    else
      for (let i = lower; i <= upper; i++) {
        ce.set({ [index]: i });
        terms.push(fn.evaluate());
      }
    ce.context = savedContext;
    return ce.add(terms).evaluate();
  }

  let sum: Rational = bignumPreferred(ce)
    ? [ce._BIGNUM_ZERO, ce._BIGNUM_ONE]
    : [0, 1];

  if (!fn.scope)
    for (let i = lower; i <= upper; i++) {
      const term = fn.N();
      if (term.numericValue === null) return undefined;
      sum = add(sum, term);
    }
  else
    for (let i = lower; i <= upper; i++) {
      ce.set({ [index]: i });
      const term = fn.N();
      if (term.numericValue === null) {
        ce.context = savedContext;
        return undefined;
      }
      sum = add(sum, term);
    }
  ce.context = savedContext;

  if (isMachineRational(sum)) return ce.number(sum[0] / sum[1]);
  return ce.number(sum[0].div(sum[1]));
}
