// Entry point for the `@cortex-js/compute-engine/core` sub-path.
// Core engine: ComputeEngine + expr() + type guards.
// No LaTeX parsing/serialization, no compilation targets.

export const version = '{{SDK_VERSION}}';

import { ComputeEngine as ComputeEngineImpl } from './compute-engine/index.js';
import type { IComputeEngine } from './compute-engine/types.js';

/** The constructor (and statics) of {@link ComputeEngine}. */
export interface ComputeEngineConstructor {
  new (
    options?: ConstructorParameters<typeof ComputeEngineImpl>[0]
  ): ComputeEngine;
  getStandardLibrary: typeof ComputeEngineImpl.getStandardLibrary;
}

/**
 * The `ComputeEngine` value is the engine constructor; the `ComputeEngine`
 * type is the structural `IComputeEngine` interface. Exporting the interface
 * (rather than the class, whose private fields make its type nominal) keeps
 * `new ComputeEngine()`, `expr.engine` and `ExpressionComputeEngine`
 * mutually assignable without casts.
 */
export const ComputeEngine: ComputeEngineConstructor = ComputeEngineImpl;
export type ComputeEngine = IComputeEngine;

// Thrown when an evaluation exceeds a `ce.withTimeLimit` span or `ce.iterationLimit`
export { CancellationError } from './common/interruptible.js';
export type { CancellationCause } from './common/interruptible.js';

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
  isObject,
  isCollection,
  isIndexedCollection,
  numericValue,
} from './compute-engine/boxed-expression/type-guards.js';

export type { BoxedNumber } from './compute-engine/boxed-expression/boxed-number.js';
export type { BoxedSymbol } from './compute-engine/boxed-expression/boxed-symbol.js';
export type { BoxedFunction } from './compute-engine/boxed-expression/boxed-function.js';
export type { BoxedString } from './compute-engine/boxed-expression/boxed-string.js';
export type { BoxedObject } from './compute-engine/boxed-expression/boxed-object.js';
