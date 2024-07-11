import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import { Rational, isRational } from './numerics/rationals';
import type {
  BoxedDomain,
  BoxedFunctionSignature,
  DomainExpression,
  DomainLiteral,
  FunctionSignature,
  IComputeEngine,
  SemiBoxedExpression,
} from './public';
import { ops, head, nops } from '../math-json/utils';

/**
 * Determine the numeric domain of a number.
 */
export function inferNumericDomain(
  value: number | Decimal | Complex | Rational
): DomainLiteral {
  //
  // 1. Is it a number?
  //

  if (typeof value === 'number' && !isNaN(value)) {
    if (!isFinite(value)) return 'ExtendedRealNumbers';

    // if (value === 0) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (Number.isInteger(value)) {
      if (value > 0) return 'PositiveIntegers';
      if (value < 0) return 'NegativeIntegers';
      return 'Integers';
    }

    if (value > 0) return 'PositiveNumbers';
    if (value < 0) return 'NegativeNumbers';

    return 'RealNumbers';
  }

  //
  // 2 Is it a bignum?
  //
  if (value instanceof Decimal) {
    if (value.isNaN()) return 'Numbers';
    if (!value.isFinite()) return 'ExtendedRealNumbers';
    // if (value.isZero()) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (value.isInteger()) {
      if (value.isPositive()) return 'PositiveIntegers';
      if (value.isNegative()) return 'NegativeIntegers';
      return 'Integers';
    }

    if (value.isPositive()) return 'PositiveNumbers';
    if (value.isNegative()) return 'NegativeNumbers';
    return 'RealNumbers';
  }

  //
  // 3 Is it a complex number?
  //
  if (value instanceof Complex) {
    const c = value as Complex;
    console.assert(c.im !== 0);
    if (c.re === 0) return 'ImaginaryNumbers';
    return 'ComplexNumbers';
  }

  //
  // 4. Is it a rational? (machine or bignum)
  //

  if (isRational(value)) {
    const [numer, denom] = value;

    // The value is a rational number
    console.assert(
      typeof numer !== 'number' ||
        (!Number.isNaN(numer) && !Number.isNaN(denom))
    );
    return 'RationalNumbers';
  }

  return 'Numbers';
}

/**
 * Extract the parts of a function domain.
 */
export function functionDomain(
  dom: BoxedDomain
): [
  params: BoxedDomain[],
  optParams: BoxedDomain[],
  restParam: BoxedDomain | undefined,
  result: BoxedDomain,
] {
  console.assert(dom.ctor === 'FunctionOf');

  const ce = dom.engine;

  const allParams = dom.params;

  const params: BoxedDomain[] = [];
  const optParams: BoxedDomain[] = [];
  let restParam: BoxedDomain | undefined = undefined;
  const result = ce.domain(allParams[allParams.length - 1]);

  for (const arg of allParams.slice(0, -1)) {
    if (head(arg) === 'OptArg') {
      if (optParams.length > 0)
        throw Error(`Unexpected multiple OptArg in domain ${dom}`);
      if (restParam)
        throw Error(`Unexpected OptArg after VarArg in domain ${dom}`);
      if (nops(arg) === 0)
        throw Error(`Unexpected empty OptArg in domain ${dom}`);
      for (const optParam of ops(arg)!) {
        if (head(optParam) === 'OptArg')
          throw Error(`Unexpected OptArg of OptArg in domain ${dom}`);
        if (head(optParam) === 'VarArg')
          throw Error(
            `Unexpected superfluous OptArg of VarArg in domain ${dom}`
          );
        optParams.push(ce.domain(optParam as DomainExpression));
      }
    } else if (head(arg) === 'VarArg') {
      const params = ops(arg)!;
      if (params.length !== 1) throw Error(`Invalid VarArg in domain ${dom}`);
      if (head(params[0]) === 'OptArg')
        throw Error(`Unexpectedf VarArg of OptArg in domain ${dom}`);
      if (head(params[0]) === 'VarArg')
        throw Error(`Unexpected VarArg of VarArg in domain ${dom}`);

      restParam = ce.domain(params[0] as DomainExpression);
    } else {
      if (optParams.length > 0)
        throw Error(
          `Unexpected required parameter after OptArg in domain ${dom}`
        );
      if (restParam)
        throw Error(
          `Unexpected required parameter after VarArg in domain ${dom}`
        );
      params.push(ce.domain(arg));
    }
  }

  return [params, optParams, restParam, result];
}

export function domainToSignature(
  dom: BoxedDomain
): Partial<FunctionSignature> {
  const [params, optParams, restParam, result] = functionDomain(dom);

  return {
    params: params.map((x) => x.json as DomainExpression),
    optParams: optParams.map((x) => x.json as DomainExpression),
    restParam: restParam?.json as DomainExpression,
    result: result.json as DomainExpression,
  } as Partial<FunctionSignature>;
}

export function signatureToDomain(
  ce: IComputeEngine,
  sig: BoxedFunctionSignature
): BoxedDomain {
  try {
    const fnParams: SemiBoxedExpression[] = [...sig.params];
    if (sig.optParams.length > 0) fnParams.push(['OptArg', ...sig.optParams]);
    if (sig.restParam) fnParams.push(['VarArg', sig.restParam]);

    if (typeof sig.result === 'function')
      fnParams.push(sig.result(ce, []) ?? ce.symbol('Anything'));
    else fnParams.push(sig.result);

    return ce.domain(['FunctionOf', ...(fnParams as DomainExpression[])]);
  } catch (e) {
    console.error('signatureToDomain():', e);
  }
  return ce.domain(['FunctionOf', 'Anything', 'Anything']);
}
