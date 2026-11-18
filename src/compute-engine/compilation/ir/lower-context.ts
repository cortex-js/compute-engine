/**
 * What the three files of the lowering share: the `Decline` of a program
 * out of scope, the frames of names, and the operations of the walk that
 * `lower-lists.ts` and `lower-functions.ts` call (`Lowering`).
 */

import type { Expression, FunctionInterface } from '../../global-types.js';
import type { Type } from '../../../common/type/types.js';
import type { CompileDiagnosticKind } from '../types.js';
import {
  isNumericScalarType,
  resolveTypeAlias,
} from '../../../common/type/utils.js';
import {
  isExpression,
  isFunction,
} from '../../boxed-expression/type-guards.js';
import type { Builder, IRType, Lane, Region, V } from './ir.js';
import type { OperatorRow } from './operators.js';
import { STANDARD_LIBRARIES } from '../../library/library.js';

export type Fn = Expression & FunctionInterface;

/** The diagnostic code of a decline whose reason has a code of its own
 *  (`CompileDiagnostic`, `../diagnostics.ts`), and its kind when it is not
 *  `'capability'`. A decline with none is `'outside-profile'`
 *  (`sliceError()`, `adapter.ts`). */
export type DeclineReason = {
  readonly code: string;
  readonly kind?: CompileDiagnosticKind;
};

/** A sub-expression whose static type is `error`. */
export const STATIC_TYPE_ERROR: DeclineReason = {
  code: 'static-type-error',
  kind: 'correctness',
};

/** A value whose shape is not settled at compile time (rules R1 to R6 of
 *  "Shapes are settled at compile time", `docs/COMPILATION-MODEL.md`). */
export const UNSETTLED_SHAPE: DeclineReason = { code: 'unsettled-shape' };

/** A mode that the target does not offer. */
export const UNSUPPORTED_MODE: DeclineReason = { code: 'unsupported-mode' };

/** A complex value bound where a real one is declared. */
export const LANE_MISMATCH: DeclineReason = {
  code: 'lane-mismatch',
  kind: 'correctness',
};

/** In the bigint mode, a node that is not on the integer lane. */
export const BIGINT_LANE: DeclineReason = { code: 'bigint-lane' };

/** A value that can be `Nothing` where the code needs a value. */
export const POSSIBLE_NOTHING: DeclineReason = { code: 'possible-nothing' };

/** A program that the slice does not compile: the text of the node, its
 *  head (when it is a function), the cause, and the code of the cause when
 *  it has one. */
export class Decline extends Error {
  constructor(
    readonly node: string,
    readonly cause: string,
    readonly head?: string,
    readonly reason?: DeclineReason
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

/** The class of shape of the values of `t` (`'scalar'`, `'boolean'`,
 *  `'string'`, `'list'`, `'tuple'`), or `undefined` when its values can
 *  have more than one, or another (`any`, `value`, `broadcastable<real>`,
 *  a union of a list and a scalar, a set, …). */
function shapeClass(t: Type): string | undefined {
  const r = resolveTypeAlias(t);
  if (isNumericScalarType(r)) return 'scalar';
  if (r === 'boolean' || r === 'string') return r;
  if (typeof r === 'string') return undefined;
  if (r.kind === 'tuple') return 'tuple';
  if (r.kind === 'value') return typeof r.value;
  if (r.kind === 'list') return 'list';
  if (r.kind !== 'union') return undefined;
  const classes = new Set(r.types.map(shapeClass));
  return classes.size === 1 ? [...classes][0] : undefined;
}

/** Whether the shape of a value of the declared type `t` is not settled at
 *  compile time (rules R1 to R6 of "Shapes are settled at compile time",
 *  `docs/COMPILATION-MODEL.md`): `t` is `any`, `unknown`, `value`,
 *  `expression`, `broadcastable<…>`, a bare collection, or a collection
 *  whose elements are of such a type or of a union of several classes of
 *  shapes (`list<number | tensor>`). A union of shapes at the top
 *  (`list<real> | real`) is not: it is a declaration that the existing
 *  compilers read with one body per member. */
export function hasUnsettledShape(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string')
    return [
      'any',
      'unknown',
      'value',
      'expression',
      'list',
      'collection',
      'indexed_collection',
    ].includes(r);
  if (r.kind === 'broadcastable') return true;
  if (
    r.kind === 'list' ||
    r.kind === 'collection' ||
    r.kind === 'indexed_collection'
  )
    return (
      hasUnsettledShape(r.elements) || shapeClass(r.elements) === undefined
    );
  return false;
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

/** The answer of the host's `compile` handler of `e` (`hasOwnLowering()`)
 *  on the target `language`: `undefined` when it defers, the expression it
 *  returns, or the cause of a decline (text, a call of the `compile`
 *  callback, a throw, `compileHelpers` with no handler). The callback
 *  gives `'0'`, the placeholder of the reference analysis of the existing
 *  compilers, which a handler that records its operands' code already
 *  tells apart. README, "Selecting the pipeline". */
export function handlerAnswer(
  e: Fn,
  language: string
): Expression | string | undefined {
  const own = `the definition of ${e.operator} has its own lowering (compile or compileHelpers), which the profile does not call`;
  const handler = e.operatorDefinition?.compile;
  if (handler === undefined) return own;
  let asked = false;
  try {
    const r: unknown = handler(e.ops, () => ((asked = true), '0'), {
      language,
      typeOf: (x) => x.type.type,
    });
    if (!asked && (r == null || r === '')) return undefined;
    return !asked && isExpression(r) ? r : own;
  } catch (error) {
    if (error instanceof Error && error.name === 'CancellationError')
      throw error;
    return `the compile handler of ${e.operator} throws: ${error instanceof Error ? error.message : String(error)}`;
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

export function decline(
  e: Expression,
  cause: string,
  reason?: DeclineReason
): never {
  throw new Decline(
    text(e),
    cause,
    isFunction(e) ? e.operator : undefined,
    reason
  );
}

/** The binding of a name. `lane` is the declared lane of a local. A
 *  `constant` is a local that no `Assign` writes. `exact` is the number
 *  literal of a local that no `Assign` of its block writes. */
export type Binding = {
  v: V;
  lane?: Lane;
  exact?: Expression;
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
   *  function, not a shadowed name, no host's `compile` handler that
   *  answers for it: one that defers keeps the library's). */
  isLibrary(e: Fn): boolean;
  /** The input `name` of the engine type `t`, which a function that the
   *  call `e` calls reads, read at the call. */
  free(e: Fn, name: string, t: Type): V;
  /** `v` where a value of `lane` is read (a real converted to complex). */
  widen(v: V, lane: Lane): V;
  /** The lane of an input of type `number`, `unknown` or none: complex in
   *  `mode: 'complex'`. */
  readonly wide: 'real' | 'complex';
  /** The interval mode (`LowerOptions.mode`). */
  readonly interval: boolean;
  /** The name of the user function whose body is being lowered. */
  inFunction?: string;
  /** The `iterationBudget`: a `Sum` or a `Product` of more passes is NaN. */
  readonly budget?: number;
  /** The target holds a list of a run-time length (`LowerOptions`). */
  readonly runtimeLengths: boolean;
  /** The most passes of a `Sum` or a `Product` of constant bounds that is
   *  written out (`LowerOptions`). */
  readonly unrollSums: number;
  /** The longest list of a constant length that is written out
   *  (`LowerOptions`). */
  readonly unrollBuilds: number;
  /** `LowerOptions.attempted`. */
  readonly attempted: () => void;
  /** The number of `x`: a literal, or the value a free name holds. */
  numberOf(x: Expression): Expression | undefined;
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
