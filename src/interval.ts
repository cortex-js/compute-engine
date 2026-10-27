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
} from './compute-engine/interval/types.js';

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
  enclose,
  stripEnclosure,
  finiteOperand,
} from './compute-engine/interval/util.js';

// Arithmetic operations
export {
  add,
  sub,
  mul,
  div,
  negate,
  _mul,
} from './compute-engine/interval/arithmetic.js';

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
} from './compute-engine/interval/elementary.js';

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
} from './compute-engine/interval/trigonometric.js';

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
} from './compute-engine/interval/comparison.js';

// Runtime library object for compiled interval arithmetic functions, and the
// version an `interval-js` compilation result carries as `runtimeVersion`.
export {
  IntervalArithmetic,
  INTERVAL_RUNTIME_VERSION,
} from './compute-engine/interval/index.js';

// Batch evaluation: the `kind` codes of a `broadcast()` result, the encoder of
// one `IntervalResult` into the `lo, hi, kind` triple, and the loop that
// evaluates a rebuilt interval function over a batch (what a worker runs).
export {
  INTERVAL_KIND,
  encodeIntervalResult,
  broadcastIntervals,
  type IntervalKindCode,
} from './compute-engine/compilation/broadcast.js';
export type {
  BroadcastInputs,
  BroadcastOptions,
} from './compute-engine/compilation/types.js';

// The standalone runtime: rebuild the function of a stored `interval-js`
// compilation result with no engine behind it (a page, a worker, a server).
export {
  createIntervalRuntime,
  type IntervalRuntime,
  type StoredIntervalJavaScript,
} from './compute-engine/compilation/interval-runtime.js';
