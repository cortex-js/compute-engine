// Entry point for the `@cortex-js/compute-engine/interval` sub-path.
//
// Re-exports the interval arithmetic library for reliable function evaluation.
// Provides interval versions of mathematical operations that return guaranteed
// enclosures of the true result.

export const version = '{{SDK_VERSION}}';

// Types
export type {
  Interval,
  IntervalResult,
  BoolInterval,
} from './compute-engine/interval/types';

// Utilities
export {
  ok,
  point,
  containsExtremum,
  unionResults,
  mergeDomainClip,
  isPoint,
  containsZero,
  isPositive,
  isNegative,
  isNonNegative,
  isNonPositive,
  width,
  midpoint,
  getValue,
  unwrap,
  unwrapOrPropagate,
} from './compute-engine/interval/util';

// Arithmetic operations
export {
  add,
  sub,
  mul,
  div,
  negate,
  _mul,
} from './compute-engine/interval/arithmetic';

// Elementary functions
export {
  sqrt,
  square,
  pow,
  powInterval,
  exp,
  ln,
  log10,
  log2,
  abs,
  floor,
  ceil,
  round,
  fract,
  trunc,
  min,
  max,
  mod,
  remainder,
  heaviside,
  sign,
  gamma,
  gammaln,
  factorial,
  factorial2,
  binomial,
  gcd,
  lcm,
  chop,
  erf,
  erfc,
  exp2,
  hypot,
} from './compute-engine/interval/elementary';

// Trigonometric functions
export {
  sin,
  cos,
  tan,
  cot,
  sec,
  csc,
  asin,
  acos,
  atan,
  atan2,
  sinh,
  cosh,
  tanh,
  asinh,
  acosh,
  atanh,
  acot,
  acsc,
  asec,
  coth,
  csch,
  sech,
  acoth,
  acsch,
  asech,
  sinc,
  fresnelS,
  fresnelC,
} from './compute-engine/interval/trigonometric';

// Comparison operations
export {
  less,
  lessEqual,
  greater,
  greaterEqual,
  equal,
  notEqual,
  and,
  or,
  not,
  piecewise,
  clamp,
} from './compute-engine/interval/comparison';

// Runtime library object for compiled interval arithmetic functions
export { IntervalArithmetic } from './compute-engine/interval/index';
