/**
 * What the three files of the lowering share: the `Decline` of a program
 * out of scope, the frames of names, and the operations of the walk that
 * `lower-lists.ts` and `lower-functions.ts` call (`Lowering`).
 */

import type { Expression, FunctionInterface } from '../../global-types.js';
import { isFunction } from '../../boxed-expression/type-guards.js';
import type { Builder, IRType, Lane, V } from './ir.js';
import type { OperatorRow } from './operators.js';

export type Fn = Expression & FunctionInterface;

/** A program that the slice does not compile: the text of the node, its
 *  head (when it is a function) and the cause. */
export class Decline extends Error {
  constructor(
    readonly node: string,
    readonly cause: string,
    readonly head?: string
  ) {
    super(`${node}: ${cause}`);
    this.name = 'Decline';
  }
}

/** The text of `e`, at most about 120 characters (a shared tree can have
 *  a text of exponential length). */
export function text(e: Expression, budget = 120): string {
  if (!isFunction(e)) return e.toString().slice(0, budget);
  let s = `${e.operator}(`;
  for (const [i, op] of e.ops.entries()) {
    if (s.length >= budget) return s + '…)';
    s += (i > 0 ? ', ' : '') + text(op, budget - s.length);
  }
  return s + ')';
}

export function decline(e: Expression, cause: string): never {
  throw new Decline(text(e), cause, isFunction(e) ? e.operator : undefined);
}

/** The binding of a name. `lane` is the declared lane of a local. */
export type Binding = { v: V; lane?: Lane; role: 'input' | 'local' | 'index' };
/** The names of one scope. A loop frame stops writes to outer locals. */
export type Frame = { names: Map<string, Binding>; loop: boolean };

/** A list operand: its length, its element at a value from 0, and its
 *  value (a `Range` is a list only when its value is read). */
export type Source = { length: V; at: (k: V) => V; value: () => V };

/** The operations of the walk (`lower.ts`) that the other parts call. */
export type Lowering = {
  readonly ce: Expression['engine'];
  readonly b: Builder;
  readonly rows: readonly OperatorRow[];
  readonly frames: Frame[];
  value(e: Expression, want?: boolean): V | undefined;
  /** The value of `e`, which must be a scalar. */
  scalar(e: Expression): V;
  apply(node: Expression, r: OperatorRow, args: V[]): V;
  /** The row of the library head `head`, or of the IR operation `op`. */
  row(head: string): OperatorRow;
  type(v: V): IRType;
  constant(v: V): number | undefined;
  branch(
    node: Expression,
    cond: V,
    then: () => V | undefined,
    otherwise: () => V | undefined,
    want: boolean
  ): V | undefined;
  withFrame<T>(loop: boolean, f: (frame: Frame) => T): T;
  /** The region row `op` over the region `f` makes from `params`. */
  region(
    op: string,
    args: V[],
    params: V[],
    f: () => V[],
    site: Expression
  ): V[];
  /** `e` is a call of the library operator of its name (not a user
   *  function, not a shadowed name). */
  isLibrary(e: Fn): boolean;
  /** `v` where a value of `lane` is read (a real converted to complex). */
  widen(v: V, lane: Lane): V;
  /** The lane of an input of type `number`, `unknown` or none: complex in
   *  `mode: 'complex'`. */
  readonly wide: 'real' | 'complex';
  /** The name of the user function whose body is being lowered. */
  inFunction?: string;
};
