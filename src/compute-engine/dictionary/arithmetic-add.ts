import { Complex } from 'complex.js';
import { BoxedExpression, IComputeEngine } from '../public';
import {
  complexAllowed,
  getImaginaryCoef,
  useDecimal,
} from '../boxed-expression/utils';
import { flattenOps } from '../symbolic/flatten';
import { Sum } from '../symbolic/sum';
import { isInMachineRange } from '../numerics/numeric-decimal';

/** The canonical form of `Add`:
 * - removes `0`
 * - adds up small integers and rational numbers
 * - capture complex numbers (a + ib or ai +b)
 * - groups repeated terms (a + a -> 2a)
 * */
export function canonicalAdd(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  console.assert(ops.every((x) => x.isCanonical));
  ops = flattenOps(ops, 'Add') ?? ops;

  if (ops.length <= 1) return ops[0] ?? ce.symbol('Nothing');

  if (ops.length === 2) {
    //
    // Is this a  complex number, i.e. `a + ib` or `ai + b`?
    //
    let im: number | null = 0;
    let re: number | null = 0;
    if (ops[0].isLiteral) {
      re = ops[0].machineValue;
      if (re === null && ops[0].decimalValue) re = ops[0].asFloat ?? 0;
      else re = 0;
    }
    if (re !== 0) im = getImaginaryCoef(ops[1]);
    else {
      im = getImaginaryCoef(ops[0]);
      if (im !== 0) {
        re = ops[1].machineValue;
        if (re === null && ops[1].decimalValue) re = ops[1].asFloat ?? 0;
        else re = 0;
      }
    }
    if (im !== 0) return ce.number(ce.complex(re, im));

    //
    // Shortcuts
    //
    if (ops[0].isLiteral && ops[1].isLiteral) {
      if (ops[0].isZero) return ops[1];
      if (ops[1].isZero) return ops[0];

      const [n1, d1] = ops[0].asRational;
      const [n2, d2] = ops[1].asRational;
      if (n1 !== null && d1 !== null && n2 !== null && d2 !== null)
        return ce.number([n1 * d2 + n2 * d1, d1 * d2]);
    }
  }

  return new Sum(ce, ops).asExpression();
}

export function domainAdd(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | string {
  let dom: BoxedExpression | string = 'Nothing';
  for (const arg of args) {
    const argDom = arg.domain;
    if (!argDom.isSubsetOf('Number')) return 'Nothing';
    if (!argDom.isSubsetOf(dom)) dom = argDom;
  }
  return dom;
}

export function numEvalAdd(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression {
  for (const arg of args) {
    if (arg.isImaginary && arg.isInfinity) return ce.symbol('ComplexInfinity');
    if (arg.isNaN || arg.isMissing || arg.symbol === 'Undefined') return ce.NAN;
  }
  // Accumulate rational, machine, decimal, complex and symbolic products
  let [numer, denom] = [0, 1];
  let machineSum = 0;
  let decimalSum = ce.DECIMAL_ZERO;
  let complexSum = Complex.ZERO;
  const sum = new Sum(ce);

  for (const arg of args) {
    if (arg.symbol !== 'Nothing' && !arg.isZero) {
      const [n, d] = arg.rationalValue;
      if (n !== null && d !== null) {
        [numer, denom] = [numer * d + denom * n, denom * d];
      } else if (arg.decimalValue !== null) {
        decimalSum = decimalSum.add(arg.decimalValue);
      } else if (arg.machineValue !== null) {
        if (useDecimal(ce)) decimalSum = decimalSum.add(arg.machineValue);
        else machineSum += arg.machineValue;
      } else if (arg.complexValue !== null) {
        complexSum = complexSum.add(arg.complexValue);
      } else sum.addTerm(arg);
    }
  }

  if (!complexAllowed(ce) && complexSum.im !== 0) return ce.NAN;

  if (useDecimal(ce) || ce.chop(decimalSum) !== 0) {
    // Fold into decimal
    let d = decimalSum;
    if (numer !== 0) d = d.mul(denom).add(numer).div(denom);
    if (machineSum !== 0) d = d.add(machineSum);
    if (complexSum.re !== 0) d = d.add(complexSum.re);

    // Fold in any remaining imaginary part
    if (complexSum.im !== 0) {
      if (isInMachineRange(d)) {
        const c = ce.number(ce.complex(d.toNumber(), complexSum.im));
        if (sum.isEmpty) return c;
        sum.addTerm(c);
      } else {
        sum.addTerm(ce.number(ce.complex(0, complexSum.im)));
        sum.addTerm(ce.number(d));
      }
    } else if (sum.isEmpty) return ce.number(d);
    else sum.addTerm(ce.number(d));
  } else {
    // Fold into machine
    const re = machineSum + complexSum.re + numer / denom;
    const c = ce.number(
      complexSum.im === 0 ? re : ce.complex(re, complexSum.im)
    );
    if (sum.isEmpty) return c;
    sum.addTerm(c);
  }

  return sum.asExpression();
}

export function processAdd(
  ce: IComputeEngine,
  args: BoxedExpression[],
  _mode: 'simplify' | 'evaluate'
): BoxedExpression | undefined {
  console.assert(args.length > 1, `ProcessAdd: not enough args`);

  const sum = new Sum(ce);
  for (const arg of args) {
    if (arg.isImaginary && arg.isInfinity) return ce.symbol('ComplexInfinity');
    if (arg.isNaN || arg.isMissing || arg.symbol === 'Undefined') return ce.NAN;
    sum.addTerm(arg);
  }

  return sum.asExpression();
}
