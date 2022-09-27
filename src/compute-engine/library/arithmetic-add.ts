import { Complex } from 'complex.js';
import { BoxedExpression, BoxedDomain, IComputeEngine } from '../public';
import {
  complexAllowed,
  getImaginaryCoef,
  preferDecimal,
} from '../boxed-expression/utils';
import { flattenOps } from '../symbolic/flatten';
import { Sum } from '../symbolic/sum';
import {
  isInMachineRange,
  reducedRational as reducedRationalDecimal,
} from '../numerics/numeric-decimal';
import { reducedRational } from '../numerics/numeric';
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
      if (re === null && ops[0].decimalValue) re = ops[0].asFloat;
    }
    if (re !== null && re !== 0) im = getImaginaryCoef(ops[1]);
    else {
      im = getImaginaryCoef(ops[0]);
      if (im !== 0) {
        re = ops[1].machineValue;
        if (re === null && ops[1].decimalValue) re = ops[1].asFloat;
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
  // Accumulate rational, machine, decimal, complex and symbolic terms
  //
  let [numer, denom] = [0, 1];
  let [decimalNumer, decimalDenom] = [ce._DECIMAL_ZERO, ce._DECIMAL_ONE];
  let machineSum = 0;
  let machineIntegerSum = 0;
  let decimalSum = ce._DECIMAL_ZERO;
  let complexSum = Complex.ZERO;

  for (const arg of args) {
    if (arg.symbol === 'Nothing' || arg.isZero) continue;
    if (arg.isLiteral) {
      const [n, d] = arg.rationalValue;
      if (n !== null && d !== null) {
        [numer, denom] = reducedRational([numer * d + denom * n, denom * d]);
      } else if (arg.decimalValue !== null) {
        if (arg.decimalValue.isInteger())
          decimalNumer = decimalNumer.add(decimalDenom.mul(arg.decimalValue));
        else decimalSum = decimalSum.add(arg.decimalValue);
      } else if (arg.machineValue !== null) {
        if (preferDecimal(ce)) {
          if (Number.isInteger(arg.machineValue))
            decimalNumer = decimalNumer.add(decimalDenom.mul(arg.machineValue));
          else decimalSum = decimalSum.add(arg.machineValue);
        } else {
          if (Number.isInteger(arg.machineValue))
            machineIntegerSum += arg.machineValue;
          else machineSum += arg.machineValue;
        }
      } else if (arg.complexValue !== null) {
        complexSum = complexSum.add(arg.complexValue);
      } else sum.addTerm(arg);
    } else if (arg.head === 'Rational' && arg.nops === 2) {
      // If this is a Rational head, it's a rational of Decimal values
      const [dn, dd] = [
        arg.op1.decimalValue ?? arg.op1.machineValue,
        arg.op2.decimalValue ?? arg.op1.machineValue,
      ];
      if (dn !== null && dd !== null) {
        decimalNumer = decimalNumer.mul(dd).add(decimalDenom.mul(dn));
        decimalDenom = decimalDenom.mul(dd);
      } else sum.addTerm(arg);
    } else sum.addTerm(arg);
  }

  // If we have an imaginary term, but complex are not allowed, return NaN
  if (!complexAllowed(ce) && complexSum.im !== 0) return ce._NAN;

  //
  // If we prefer to use Decimal, or if we had any decimal term,
  // do Decimal calculations
  //
  if (
    preferDecimal(ce) ||
    ce.chop(decimalSum) !== 0 ||
    !decimalNumer.isZero()
  ) {
    let d = decimalSum;
    if (machineSum !== 0) d = d.add(machineSum);
    if (complexSum.re !== 0) d = d.add(complexSum.re);

    decimalNumer = decimalNumer.add(decimalDenom.mul(machineIntegerSum));
    decimalNumer = decimalNumer.mul(denom).add(decimalDenom.mul(numer));
    decimalDenom = decimalDenom.mul(denom);
    [decimalNumer, decimalDenom] = reducedRationalDecimal([
      decimalNumer,
      decimalDenom,
    ]);

    // machineSum = 0;
    // numer = 0;
    // denom = 1;
    // machineIntegerSum = 0;

    if (decimalDenom.eq(1)) d = d.add(decimalNumer);
    else {
      // In 'N' mode we should divide the numerator and denominator
      if (mode === 'N') d = d.add(decimalNumer.div(decimalDenom));
      else {
        // In 'eval' mode, preserve a rational
        sum.addTerm(
          ce.box(['Rational', ce.number(decimalNumer), ce.number(decimalDenom)])
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
        // We have to keep a complex and Decimal term
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
  // Fold into machine: we don't prefer decimal and we had no Decimal terms

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

export function evalSummation(
  ce: IComputeEngine,
  expr: BoxedExpression,
  range: BoxedExpression
): BoxedExpression {
  const index = range.op1.symbol ?? 'i';
  const lower = range.op2.asSmallInteger ?? 1;
  const upper = range.op3.asSmallInteger ?? 1000000;

  const fn = expr.head === 'Lambda' ? expr.op1 : expr.subs({ [index]: '_' });

  if (preferDecimal(ce)) {
    let v = ce.decimal(0);
    for (let i = lower; i <= upper; i++) {
      const n = ce.number(i);
      const r = fn.subs({ _1: n, _: n }).evaluate();
      v = v.add(r.decimalValue ?? r.asFloat ?? NaN);
    }
  }
  let v = 0;
  for (let i = lower; i <= upper; i++) {
    const n = ce.number(i);
    const r = fn.subs({ _1: n, _: n }).evaluate();
    v += r.asFloat ?? NaN;
  }

  return ce.number(v);
}
