/**
 * What the three files of the lowering share: the `Decline` of a program
 * out of scope, the frames of names, and the operations of the walk that
 * `lower-lists.ts` and `lower-functions.ts` call (`Lowering`).
 */

import type { Expression, FunctionInterface } from '../../global-types.js';
import type { Type } from '../../../common/type/types.js';
import { resolveTypeAlias } from '../../../common/type/utils.js';
import { isFunction } from '../../boxed-expression/type-guards.js';
import type { Builder, IRType, Lane, Region, V } from './ir.js';
import type { OperatorRow } from './operators.js';
import { STANDARD_LIBRARIES } from '../../library/library.js';

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

/** A program whose inputs `names` have the type `unknown` or `any`: the
 *  adapters refuse it with the diagnostic of the existing compiler
 *  (`untyped-input`, `sliceError()`). */
export class UntypedInputs extends Decline {
  constructor(readonly names: string[]) {
    super(
      'program',
      names.length === 1
        ? `the input ${names[0]} has no type`
        : `the inputs ${names.join(', ')} have no type`
    );
  }
}

/** Whether `t` is `unknown` or `any`, after the transparent aliases that
 *  name it (`resolveTypeAlias()`). */
export function isUntyped(t: Type): boolean {
  const r = resolveTypeAlias(t);
  return r === 'unknown' || r === 'any';
}

/** The definition `def` of the operator `name` has a lowering of its own,
 *  which the slice does not call: `compileHelpers`, or a `compile` handler
 *  other than the one of the standard library's definition of `name` (a
 *  host that sets `ce.lookupDefinition('At').operator.compile`). */
export function hasOwnLowering(
  name: string,
  def: { compile?: unknown; compileHelpers?: unknown } | undefined
): boolean {
  if (def?.compileHelpers !== undefined) return true;
  if (def?.compile === undefined) return false;
  const standard = STANDARD_LIBRARIES.flatMap((l) => [l.definitions].flat())
    .map((t) => t?.[name] as { compile?: unknown } | undefined)
    .find((d) => d !== undefined);
  return def.compile !== standard?.compile;
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

/** The binding of a name. `lane` is the declared lane of a local. A
 *  `constant` is a local that no `Assign` writes. */
export type Binding = {
  v: V;
  lane?: Lane;
  role: 'input' | 'local' | 'constant' | 'index';
};
/** The names of one scope. A loop frame stops writes to outer locals. */
export type Frame = { names: Map<string, Binding>; loop: boolean };

/** A list operand: its length, and its element at a value from 0 (a
 *  `Range` is a list only when its value is read). */
export type Source = { length: V; at: (k: V) => V };

/** The heads whose value on a tuple is their value on the list of the same
 *  elements, by how they read a tuple operand: `each`, element by element
 *  with scalars; `all`, every operand a tuple; `scale`, one tuple and
 *  scalars, the tuple first for `Divide`; `norm`, the Euclidean norm of a
 *  tuple of numbers (`README.md`, "Tuples"). */
type TupleRule = 'each' | 'all' | 'scale' | 'norm';
export const TUPLE_RULES: Readonly<Record<string, TupleRule>> = Object.freeze({
  Power: 'each',
  Mod: 'each',
  Root: 'each',
  Arctan2: 'each',
  Add: 'all',
  Multiply: 'scale',
  Divide: 'scale',
  Abs: 'norm',
});

/** The operations of the walk (`lower.ts`) that the other parts call. */
export type Lowering = {
  readonly b: Builder;
  readonly rows: readonly OperatorRow[];
  readonly frames: Frame[];
  value(e: Expression, want?: boolean): V | undefined;
  /** The value of `e`, which must be a scalar. */
  scalar(e: Expression): V;
  /** Apply the row `r`, or the row of the library head of that name, to
   *  `args`. */
  apply(node: Expression, r: OperatorRow | string, args: V[]): V;
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
  /** The list of `elements` (`List(…)`). */
  list(e: Fn, elements: V[]): V;
  /** `e` is a call of the library operator of its name (not a user
   *  function, not a shadowed name). */
  isLibrary(e: Fn): boolean;
  /** The input `name` of the engine type `t`, which a function that the
   *  call `e` calls reads, read at the call. */
  free(e: Fn, name: string, t: Type): V;
  /** `v` where a value of `lane` is read (a real converted to complex). */
  widen(v: V, lane: Lane): V;
  /** The lane of an input of type `number`, `unknown` or none: complex in
   *  `mode: 'complex'`. */
  readonly wide: 'real' | 'complex';
  /** The name of the user function whose body is being lowered. */
  inFunction?: string;
  /** The `iterationBudget`: a `Sum` or a `Product` of more passes is NaN. */
  readonly budget?: number;
  /** The target holds a list of a run-time length (`LowerOptions`). */
  readonly runtimeLengths: boolean;
  /** The most passes of a `Sum` or a `Product` of constant bounds that is
   *  written out (`LowerOptions`). */
  readonly unrollSums: number;
  /** The value that `f` lowers in a region of its own, whose instructions
   *  then go to the current region; `undefined`, the region discarded, when
   *  `f` gives no value or declines, or `accept` refuses the region. The
   *  nodes and what `refund` restores are given back only when no user
   *  function began to be lowered in `f`; a decline after that begins is
   *  the program's. `f` reads the nodes it has lowered (`spent()`) and the
   *  nodes left (`left`). `README.md`, "Lists", the sums written out. */
  attempt(
    f: (spent: () => number, left: number) => V | undefined,
    accept: (r: Region) => boolean,
    refund: () => void
  ): V | undefined;
  /** The values that are a tuple, or hold tuples: the index in the shape
   *  of the axis that is a tuple (0 for a `Tuple`, 1 for a list of them).
   *  An operator whose value on a tuple differs from its value on a list
   *  declines such an operand (`README.md`, "Tuples"). */
  readonly tuples: Map<V, number>;
};
