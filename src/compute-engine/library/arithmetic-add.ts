import { Complex } from 'complex.js';
import { BoxedExpression, BoxedDomain, IComputeEngine } from '../public';
import {
  complexAllowed,
  getImaginaryCoef,
  preferBignum as preferBignum,
} from '../boxed-expression/utils';
import { flattenOps } from '../symbolic/flatten';
import { Sum } from '../symbolic/sum';
import {
  isInMachineRange,
  reducedRational as reducedBigRational,
} from '../numerics/numeric-bignum';
import {
  MAX_ITERATION,
  MAX_SYMBOLIC_TERMS,
  reducedRational,
} from '../numerics/numeric';
import { sharedAncestorDomain } from '../boxed-expression/boxed-domain';

/** The canonical form of `Add`:
 * - removes `0`
 * - capture complex numbers (a + ib or ai +b)
 * */
export function canonicalAdd(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  console.assert(ops.every((x) => x.isCanonical));
  ops = flattenOps(ops, 'Add') ?? ops;

  ops = ops.filter((x) => !(x.isLiteral && x.isZero));

  if (ops.length === 0) return ce.number(0);
  if (ops.length === 1) return ops[0];
  if (ops.length === 2) {
    //
    // Is this a  complex number, i.e. `a + ib` or `ai + b`?
    //
    let im: number | null = 0;
    let re: number | null = 0;
    if (ops[0].isLiteral) {
      re = ops[0].machineValue;
      if (re === null && ops[0].bignumValue) re = ops[0].asFloat;
    }
    if (re !== null && re !== 0) im = getImaginaryCoef(ops[1]);
    else {
      im = getImaginaryCoef(ops[0]);
      if (im !== 0) {
        re = ops[1].machineValue;
        if (re === null && ops[1].bignumValue) re = ops[1].asFloat;
      }
    }
    if (re !== null && im !== null && im !== 0)
      return ce.number(ce.complex(re, im));
  }

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
  for (const arg of args) {
    if (arg.isImaginary && arg.isInfinity) return ce.symbol('ComplexInfinity');
    if (arg.isNaN || arg.symbol === 'Undefined') return ce._NAN;
    if (!arg.isZero) sum.addTerm(arg);
  }

  return sum.asExpression();
}

export function evalAdd(
  ce: IComputeEngine,
  args: BoxedExpression[],
  mode: 'N' | 'eval' = 'eval'
): BoxedExpression {
  //
  // First pass: looking for early exits
  //
  for (const arg of args) {
    if (arg.isImaginary && arg.isInfinity) return ce.symbol('ComplexInfinity');
    if (arg.isNaN || arg.symbol === 'Undefined') return ce._NAN;
  }

  console.assert(flattenOps(args, 'Add') === null);

  const sum = new Sum(ce);

  //
  // Accumulate rational, machine, bignum, complex and symbolic terms
  //
  let [numer, denom] = [0, 1];
  let [bigNumer, bigDenom] = [ce._BIGNUM_ZERO, ce._BIGNUM_ONE];
  let machineSum = 0;
  let machineIntegerSum = 0;
  let bigSum = ce._BIGNUM_ZERO;
  let complexSum = Complex.ZERO;

  for (const arg of args) {
    if (arg.isNothing || arg.isZero) continue;
    if (arg.isLiteral) {
      const [n, d] = arg.rationalValue;
      if (n !== null && d !== null) {
        [numer, denom] = reducedRational([numer * d + denom * n, denom * d]);
      } else if (arg.bignumValue !== null) {
        if (arg.bignumValue.isInteger())
          bigNumer = bigNumer.add(bigDenom.mul(arg.bignumValue));
        else bigSum = bigSum.add(arg.bignumValue);
      } else if (arg.machineValue !== null) {
        if (preferBignum(ce)) {
          if (Number.isInteger(arg.machineValue))
            bigNumer = bigNumer.add(bigDenom.mul(arg.machineValue));
          else bigSum = bigSum.add(arg.machineValue);
        } else {
          if (Number.isInteger(arg.machineValue))
            machineIntegerSum += arg.machineValue;
          else machineSum += arg.machineValue;
        }
      } else if (arg.complexValue !== null) {
        complexSum = complexSum.add(arg.complexValue);
      } else sum.addTerm(arg);
    } else if (arg.head === 'Rational' && arg.nops === 2) {
      // If this is a Rational head, it's a rational of bignums
      const [dn, dd] = [
        arg.op1.bignumValue ?? arg.op1.machineValue,
        arg.op2.bignumValue ?? arg.op1.machineValue,
      ];
      if (dn !== null && dd !== null) {
        bigNumer = bigNumer.mul(dd).add(bigDenom.mul(dn));
        bigDenom = bigDenom.mul(dd);
      } else sum.addTerm(arg);
    } else sum.addTerm(arg);
  }

  // If we have an imaginary term, but complex are not allowed, return NaN
  if (!complexAllowed(ce) && complexSum.im !== 0) return ce._NAN;

  //
  // If we prefer to use bignum, or if we had any bignum term,
  // do bignum calculations
  //
  if (preferBignum(ce) || ce.chop(bigSum) !== 0 || !bigNumer.isZero()) {
    let d = bigSum;
    if (machineSum !== 0) d = d.add(machineSum);
    if (complexSum.re !== 0) d = d.add(complexSum.re);

    bigNumer = bigNumer.add(bigDenom.mul(machineIntegerSum));
    bigNumer = bigNumer.mul(denom).add(bigDenom.mul(numer));
    bigDenom = bigDenom.mul(denom);
    [bigNumer, bigDenom] = reducedBigRational([bigNumer, bigDenom]);

    // machineSum = 0;
    // numer = 0;
    // denom = 1;
    // machineIntegerSum = 0;

    if (bigDenom.eq(1)) d = d.add(bigNumer);
    else {
      // In 'N' mode we should divide the numerator and denominator
      if (mode === 'N') d = d.add(bigNumer.div(bigDenom));
      else {
        // In 'eval' mode, preserve a rational
        sum.addTerm(
          ce.box(['Rational', ce.number(bigNumer), ce.number(bigDenom)])
            .canonical
        );
      }
    }

    // Fold in any remaining imaginary part
    if (complexSum.im !== 0) {
      if (isInMachineRange(d)) {
        // We can fold into a Complex Number
        const c = ce.number(ce.complex(d.toNumber(), complexSum.im));
        if (sum.isEmpty) return c;
        sum.addTerm(c);
      } else {
        // We have to keep a complex and bignum term
        sum.addTerm(ce.number(ce.complex(0, complexSum.im)));
        sum.addTerm(ce.number(d));
      }
    } else if (sum.isEmpty) return ce.number(d);
    else sum.addTerm(ce.number(d));

    return sum.asExpression();
  }

  //
  // Machine Number calculation
  //
  // Fold into machine: we don't prefer bignum and we had no bignum terms

  if (mode === 'N' || denom === 1) {
    const re = machineSum + machineIntegerSum + complexSum.re + numer / denom;
    const c = ce.number(
      complexSum.im === 0 ? re : ce.complex(re, complexSum.im)
    );
    if (sum.isEmpty) return c;
    sum.addTerm(c);
  } else {
    if (numer !== 0) {
      if (denom === 1) {
        machineSum += machineIntegerSum + numer;
      } else {
        [numer, denom] = reducedRational([
          numer + denom * machineIntegerSum,
          denom,
        ]);
        sum.addTerm(ce.number([numer, denom]));
      }
    } else {
      machineSum += machineIntegerSum;
    }
    const re = machineSum + complexSum.re;
    const c = ce.number(
      complexSum.im === 0 ? re : ce.complex(re, complexSum.im)
    );
    if (sum.isEmpty) return c;
    sum.addTerm(c);
  }

  return sum.asExpression();
}

export function canonicalSummation(
  ce: IComputeEngine,
  expr: BoxedExpression,
  range: BoxedExpression | undefined
) {
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
    lower = range.ops?.[1] ?? null;
    upper = range.ops?.[2] ?? null;
  }

  let fn: BoxedExpression;
  if (index !== null && index.symbol)
    fn = expr.head === 'Lambda' ? expr.op1 : expr.subs({ [index.symbol]: '_' });
  else fn = expr.head === 'Lambda' ? expr.op1 : expr;

  index ??= ce.symbol('Nothing');

  if (upper) range = ce.tuple([index, lower ?? ce.symbol('Nothing'), upper]);
  else if (lower && upper) range = ce.tuple([index, lower, upper]);
  else if (lower) range = ce.tuple([index, lower]);
  else range = index;

  return ce._fn('Sum', [ce._fn('Lambda', [fn]), range]);
}

export function evalSummation(
  ce: IComputeEngine,
  expr: BoxedExpression,
  range: BoxedExpression,
  mode: 'simplify' | 'N' | 'evaluate'
): BoxedExpression | undefined {
  if (expr.head !== 'Lambda') return undefined;
  const fn = expr.op1;

  let lower = 1;
  let upper = MAX_ITERATION;
  if (
    range.head === 'Tuple' ||
    range.head === 'Triple' ||
    range.head === 'Pair' ||
    range.head === 'Single'
  ) {
    lower = range.op2.asSmallInteger ?? 1;
    upper = range.op3.asSmallInteger ?? MAX_ITERATION;
  }
  if (lower >= upper || upper - lower >= MAX_SYMBOLIC_TERMS) return undefined;

  if (mode === 'evaluate' || mode === 'simplify') {
    const terms: BoxedExpression[] = [];
    for (let i = lower; i <= upper; i++) {
      const n = ce.number(i);
      terms.push(fn.subs({ _1: n, _: n }));
    }
    if (mode === 'simplify') return ce.add(terms).simplify();
    return ce.add(terms).evaluate();
  }

  if (preferBignum(ce)) {
    let v = ce.bignum(0);
    for (let i = lower; i <= upper; i++) {
      const n = ce.number(i);
      const r = fn.subs({ _1: n, _: n }).evaluate();
      const val = r.bignumValue ?? r.asFloat;
      if (!val) return undefined;
      v = v.add(val);
    }
  }
  let v = 0;
  for (let i = lower; i <= upper; i++) {
    const n = ce.number(i);
    const r = fn.subs({ _1: n, _: n }).evaluate();
    if (!r.asFloat) return undefined;
    v += r.asFloat;
  }

  return ce.number(v);
}
