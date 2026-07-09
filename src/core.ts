// Entry point for the `@cortex-js/compute-engine/core` sub-path.
// Core engine: ComputeEngine + expr() + type guards.
// No LaTeX parsing/serialization, no compilation targets.

export const version = '{{SDK_VERSION}}';

export { ComputeEngine } from './compute-engine/index.js';

// Thrown when an evaluation exceeds `ce.timeLimit` or `ce.iterationLimit`
export { CancellationError } from './common/interruptible.js';

export type * from './compute-engine/types.js';

export type {
  Interval,
  IntervalResult,
  BoolInterval,
} from './compute-engine/interval/types.js';

// Free functions backed by a lazily-instantiated global engine
// (no LaTeX-accepting overloads — those are in the full package)
export {
  expr,
  simplify,
  evaluate,
  N,
  declare,
  assign,
  expand,
  expandAll,
  factor,
  solve,
  getDefaultEngine,
} from './compute-engine/free-functions.js';

export {
  isExpression,
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isTensor,
  isDictionary,
  isCollection,
  isIndexedCollection,
  numericValue,
} from './compute-engine/boxed-expression/type-guards.js';

export type { BoxedNumber } from './compute-engine/boxed-expression/boxed-number.js';
export type { BoxedSymbol } from './compute-engine/boxed-expression/boxed-symbol.js';
export type { BoxedFunction } from './compute-engine/boxed-expression/boxed-function.js';
export type { BoxedString } from './compute-engine/boxed-expression/boxed-string.js';
export type { BoxedTensor } from './compute-engine/boxed-expression/boxed-tensor.js';
