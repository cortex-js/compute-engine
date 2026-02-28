// Entry point for the `@cortex-js/compute-engine/numerics` sub-path.
//
// Re-exports numeric primitives: rationals, big integers, arbitrary-precision
// decimals, complex numbers, special functions, statistics, primes, etc.

export const version = '{{SDK_VERSION}}';

//
// Types (numerics)
//
export type {
  SmallInteger,
  Rational,
  BigNum,
  BigNumFactory,
  IBigNum,
} from './compute-engine/numerics/types';

//
// Types (numeric-value)
//
export type {
  ExactNumericValueData,
  NumericValueData,
  NumericValueFactory,
} from './compute-engine/numeric-value/types';

export { NumericValue } from './compute-engine/numeric-value/types';

//
// Numeric value classes
//
export { BigNumericValue } from './compute-engine/numeric-value/big-numeric-value';
export { ExactNumericValue } from './compute-engine/numeric-value/exact-numeric-value';
export { MachineNumericValue } from './compute-engine/numeric-value/machine-numeric-value';

//
// Non-colliding modules — export * is safe
//
export * from './compute-engine/numerics/bigint';
export * from './compute-engine/numerics/expression';
export * from './compute-engine/numerics/interval';
export * from './compute-engine/numerics/linear-algebra';
export * from './compute-engine/numerics/monte-carlo';
export * from './compute-engine/numerics/primes';
export * from './compute-engine/numerics/rationals';
export * from './compute-engine/numerics/richardson';
export * from './compute-engine/numerics/statistics';
export * from './compute-engine/numerics/strings';
export * from './compute-engine/numerics/unit-data';

//
// numeric.ts — machine-precision utilities and constants.
// `gcd`, `lcm`, `factorial`, `factorial2`, `canonicalInteger` exported
// with their original names (these are the machine-number versions).
//
export {
  DEFAULT_PRECISION,
  MACHINE_PRECISION_BITS,
  MACHINE_PRECISION,
  DEFAULT_TOLERANCE,
  SMALL_INTEGER,
  MAX_BIGINT_DIGITS,
  MAX_ITERATION,
  MAX_SYMBOLIC_TERMS,
  nextUp,
  nextDown,
  canonicalInteger,
  gcd,
  lcm,
  factorial,
  factorial2,
  chop,
  centeredDiff8thOrder,
  limit,
  cantorEnumerateRationals,
  cantorEnumeratePositiveRationals,
  cantorEnumerateComplexNumbers,
  cantorEnumerateIntegers,
  cantorEnumerateNaturalNumbers,
} from './compute-engine/numerics/numeric';

//
// numeric-bigint.ts — bigint-precision variants.
// Colliding names are re-exported with a `bigint` prefix.
//
export {
  gcd as bigintGcd,
  lcm as bigintLcm,
  canonicalInteger as bigintCanonicalInteger,
  reducedInteger,
  factorial as bigintFactorial,
} from './compute-engine/numerics/numeric-bigint';

//
// numeric-bignum.ts — arbitrary-precision (Decimal) variants.
// Colliding names are re-exported with a `bignum` prefix.
//
export {
  gcd as bignumGcd,
  lcm as bignumLcm,
  factorial2 as bignumFactorial2,
  isInMachineRange,
} from './compute-engine/numerics/numeric-bignum';

//
// special-functions.ts — machine-precision special functions.
// `gamma` and `gammaln` exported with their original names (machine number versions).
//
export {
  gamma,
  gammaln,
  erfInv,
  erfc,
  erf,
  bigGammaln,
  bigGamma,
  bigDigamma,
  bigTrigamma,
  bigPolygamma,
  bigBeta,
  bigZeta,
  bigLambertW,
  digamma,
  trigamma,
  polygamma,
  beta,
  zeta,
  lambertW,
  besselJ,
  besselY,
  besselI,
  besselK,
  airyAi,
  airyBi,
  fresnelS,
  fresnelC,
  sinc,
} from './compute-engine/numerics/special-functions';

//
// numeric-complex.ts — complex-number variants.
// Colliding names are re-exported with a `complex` prefix.
//
export {
  gamma as complexGamma,
  gammaln as complexGammaln,
} from './compute-engine/numerics/numeric-complex';
