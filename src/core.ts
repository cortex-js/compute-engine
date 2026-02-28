// Entry point for the `@cortex-js/compute-engine/core` sub-path.
// Core engine: ComputeEngine + expr() + type guards.
// No LaTeX parsing/serialization, no compilation targets.

export const version = '{{SDK_VERSION}}';

export { ComputeEngine } from './compute-engine/index';

export type * from './compute-engine/types';

export type {
  Interval,
  IntervalResult,
  BoolInterval,
} from './compute-engine/interval/types';

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
} from './compute-engine/free-functions';

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
} from './compute-engine/boxed-expression/type-guards';

export type { BoxedNumber } from './compute-engine/boxed-expression/boxed-number';
export type { BoxedSymbol } from './compute-engine/boxed-expression/boxed-symbol';
export type { BoxedFunction } from './compute-engine/boxed-expression/boxed-function';
export type { BoxedString } from './compute-engine/boxed-expression/boxed-string';
export type { BoxedTensor } from './compute-engine/boxed-expression/boxed-tensor';
