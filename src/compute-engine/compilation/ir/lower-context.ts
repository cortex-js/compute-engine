/**
 * What the three files of the lowering share: the `Decline` of a program
 * out of scope, the frames of names, and the operations of the walk that
 * `lower-lists.ts` and `lower-functions.ts` call (`Lowering`).
 */

import type {
  BoxedValueDefinition,
  Expression,
  FunctionInterface,
  IComputeEngine,
  Scope,
} from '../../global-types.js';
import type {
  RecordType,
  TupleType,
  Type,
  TypeReference,
} from '../../../common/type/types.js';
import { typesOverlap } from '../../../common/type/reduce.js';
import type { CompileDiagnosticKind } from '../types.js';
import {
  isNumericScalarType,
  resolveTypeAlias,
} from '../../../common/type/utils.js';
import {
  isDictionary,
  isExpression,
  isFunction,
  isSymbol,
} from '../../boxed-expression/type-guards.js';
import type {
  Assigned,
  Builder,
  FieldType,
  IRType,
  Lane,
  Region,
  V,
} from './ir.js';
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

/** The decline of a real written to a list local written in place whose
 *  integer lane comes from its value (`listWrite()` of `lower.ts`), or of
 *  reals written to a local that holds a list of lists of run-time length
 *  of integers (`assign()`): `lower()` lowers the program again with the
 *  local of the declaration `declaration` on the real lane, as the
 *  interpreter widens the list. */
export class WidenList extends Decline {
  constructor(
    d: Decline,
    readonly declaration: Expression
  ) {
    super(d.node, d.cause, d.head, d.reason);
  }
}

/** A program whose inputs `names` have the type `unknown` or `any`: the
 *  adapters refuse it with the diagnostic `untyped-input`
 *  (`sliceError()`). */
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
 *  (`list<real> | real`) is not: it is a declaration of one shape per
 *  member (rule R6), not an unsettled shape. */
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

/** Whether the declared type `t` of a parameter settles no shape: an
 *  unsettled type (`hasUnsettledShape()`), or a union of such types and
 *  tuples with at least one of the first (`collection<any> | tuple`, the
 *  type that the document preparation infers for a parameter read as a
 *  point). A union with a scalar or a settled list member
 *  (`real | list`, `real | list<real>`) is a declared union of shapes,
 *  which declines (R4). */
export function settlesNoShape(t: Type): boolean {
  if (hasUnsettledShape(t)) return true;
  const r = resolveTypeAlias(t);
  if (typeof r !== 'object' || r.kind !== 'union') return false;
  const tuple = (u: Type) => {
    const v = resolveTypeAlias(u);
    return v === 'tuple' || (typeof v === 'object' && v.kind === 'tuple');
  };
  return (
    r.types.some((u) => hasUnsettledShape(u)) &&
    r.types.every((u) => hasUnsettledShape(u) || tuple(u))
  );
}

/** Whether `t` is `unknown` or `any`, after the transparent aliases that
 *  name it (`resolveTypeAlias()`). */
export function isUntyped(t: Type): boolean {
  const r = resolveTypeAlias(t);
  return r === 'unknown' || r === 'any';
}

/** The definition `def` of the operator `name` has a `compile` handler
 *  other than the one of the standard library's definition of `name` (a
 *  host that sets `ce.lookupDefinition('At').operator.compile`). The key
 *  `compileHelpers` throws when an operator is declared with it. */
export function hasOwnLowering(
  name: string,
  def: { compile?: unknown } | undefined
): boolean {
  if (def?.compile === undefined) return false;
  const standard = STANDARD_LIBRARIES.flatMap((l) => [l.definitions].flat())
    .map((t) => t?.[name] as { compile?: unknown } | undefined)
    .find((d) => d !== undefined);
  return def.compile !== standard?.compile;
}

/** The answer of the host's `compile` handler of `e` (`hasOwnLowering()`)
 *  on the target `language`: `undefined` when it defers, the expression it
 *  returns, or the cause of a decline (text, a call of the `compile`
 *  callback, a throw). The callback gives `'0'`, so that a handler that
 *  builds code text from its operands' code declines and does not see
 *  their code. README, "Selecting the pipeline". */
export function handlerAnswer(
  e: Fn,
  language: string
): Expression | string | undefined {
  const own = `the definition of ${e.operator} has a \`compile\` handler that returns code text, which 0.194.0 removed; return an Expression instead`;
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

/** The binding of a name. `lane` is the declared lane of a local (of a
 *  `list` local, of its elements). A `constant` is a local that no `Assign`
 *  writes. A `list` is a list local that its block writes in place: `v` is
 *  the array that it owns, which its writes change (`README.md`, "Lists").
 *  `exact` is the number literal of a local that no `Assign` of its block
 *  writes. `whole`: a `local` that holds a list, which its block writes
 *  whole (`Assign(L, value)`): the lengths of its shape after the first,
 *  which a write keeps, and the tuple mark of a list of points; `lane` is
 *  the lane of its elements; `widen`, the declaration of a list of integers
 *  of no stated type, which a real list written to it widens
 *  (`README.md`, "Lists"). `parts`: an `index` that is a tuple of tuples,
 *  the element of a `Loop` over a literal list of them (`loop()`), read
 *  only by `At` of a constant index; `v` is the index of the loop. */
export type Binding = {
  v: V;
  lane?: Lane;
  exact?: Expression;
  role: 'input' | 'local' | 'constant' | 'index' | 'list';
  whole?: {
    readonly inner: readonly number[];
    readonly points: boolean;
    readonly widen?: Expression;
  };
  parts?: readonly V[];
  /** A list of lists of a variable of the engine that the root function
   *  literal assigns (CE-1721), of this lane of elements: the host's rows
   *  (the lane `rows`) until a write, then the list of rank 2 written. */
  grid?: 'integer' | 'real';
  /** The carried accumulator of a `Reduce` by a function literal. */
  accumulator?: boolean;
  /** A local of the lane `rows` (CE-1736): the lane of the elements of
   *  the value that a loop carries (`rowsElements` of its parameter), and
   *  the declaration that `WidenList` puts on the real lane where a write
   *  gives reals. */
  rows?: { lane: 'integer' | 'real'; declaration: Expression };
  /** A local of the lane `record` that statements write whole (CE-1919):
   *  the type that a loop carries, of which each value written is a
   *  subtype (`looseRecord()` of `lower.ts`). */
  record?: FieldType;
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
/** Whether the engine's value of a value of the code is the value that the
 *  code makes of it at the call of a function of the host (`boxValue()` of
 *  `print-js.ts`; CE-1652, step 5): `true` for a scalar, and for a list or
 *  a tuple that a `List` or a `Tuple` literal made of such values, which
 *  the interpreter holds as that `List` or `Tuple`; for a record, the
 *  `Listed` of each field; `false` where the interpreter can hold a lazy
 *  collection (`Range(1, 3)`, `Reverse(L)`, a `Linspace`), which the code
 *  holds as the array of its elements, or where the code does not know. */
export type Listed = boolean | readonly Listed[];

/** The `Listed` of the value `v` (`Lowering.listed`). */
export function listedOf(cx: Lowering, v: V): Listed {
  const known = cx.listed.get(v);
  if (known !== undefined) return known;
  const t = cx.type(v);
  return t.shape.length === 0 && t.lane !== 'record';
}

/** Every list, tuple and record in a value of the `Listed` `l` is listed. */
export function fullyListed(l: Listed): boolean {
  return l === true || (Array.isArray(l) && l.every(fullyListed));
}

/** A value of the `Listed` `a` stands where one of `p` was given: it is
 *  listed wherever `p` is. */
export function coversListed(a: Listed, p: Listed): boolean {
  if (p === false) return true;
  if (p === true) return a === true;
  return Array.isArray(a)
    ? p.every((x, k) => coversListed(a[k] ?? false, x))
    : p.every((x) => coversListed(false, x));
}

export type Lowering = {
  readonly b: Builder;
  readonly rows: readonly OperatorRow[];
  /** Finite bounds from effective declarations of scalar inputs to GLSL. */
  readonly inputBounds: ReadonlyMap<V, readonly [number, number]>;
  readonly frames: Frame[];
  /** The local scopes of the engine around the node being lowered, the
   *  innermost last: the scope of each node with one (a `Block`), of a
   *  function literal whose body is lowered, and of the root literal. A
   *  part that the canonical form holds raw (a case of a `Match`, the
   *  subject of `MatchesType`) is made canonical in the innermost one, as
   *  the interpreter makes it canonical in the scope of the running
   *  block. */
  readonly scopes: Scope[];
  value(e: Expression, want?: boolean): V | undefined;
  /** The value of `e`, which must be a scalar. */
  scalar(e: Expression): V;
  /** The value of `e`, which may be of the lane `rows` (`rowsParams`): a
   *  read of such a value is admitted only here, where a reader of its rows,
   *  a parameter of that lane, a local or the result takes it whole; a
   *  `Block`, an `If`, a `Which`, a `Coalesce`, a `Typed` and a
   *  `WithRandomSeed` pass the admission to the operands that give their
   *  value. Every other read declines. */
  wholeRows(e: Expression): V;
  /** The parameters of user functions that hold the IR type of their
   *  argument (`held()` of `lower-functions.ts`): a parameter of no stated
   *  type or of type `any` holding a record, a string, a colour, `Nothing`
   *  or (at `any`) a number, and one that takes the shape of its argument
   *  (a point, a list of points, a flat list). Inside the function lowered
   *  for that type, `x is T` of it is decided by that IR type (CE-1652,
   *  step 4b). */
  readonly heldParams: Set<V>;
  /** The tests decided from the IR types of their operands in the function
   *  lowered for them (CE-1652, step 4b): `x is T` of a parameter of
   *  `heldParams`, and `a == b` of a string and a value that is never one.
   *  A condition made of such tests (`And`, `Or`, `Not`) takes its arm,
   *  and the other arm is not lowered (`conditional()` of `lower.ts`). */
  readonly typeTests: Map<Expression, boolean>;
  /** Whether the engine's value of a value of the code is the value that
   *  the code makes of it for a function of the host (`Listed`), for the
   *  values that the lowering knows (CE-1652, step 5): a value not here is
   *  `true` when it is a scalar, else `false` (`listedOf()`). */
  readonly listed: Map<V, Listed>;
  /** A function lowered for the `Listed` of the arguments of its first
   *  call declines a later call of less (`call()` of
   *  `lower-functions.ts`). On in a lowering of a program that passes a
   *  list, a tuple or a record to a function of the host (`hostCall()` of
   *  `lower.ts`), whose `Listed` the code must know. */
  readonly trackListed: boolean;
  /** The value of the string `v` when it is known when the code is
   *  emitted (CE-1652, step 4c; README, "Records"): a string constant, a
   *  parameter whose argument was one, a field of a record made from one
   *  (`holdKnown()`). Only in a lowering that keeps the constants
   *  (`lower()`: a program that the first lowering declines); in the
   *  first, `undefined`, and the lowering notes that a constant could be
   *  there when `v` is a value of `mayHoldKnown()`. */
  known(v: V): string | undefined;
  /** `v` (a string parameter, the read of a string field) is a known
   *  string where the lowering keeps the constants and its argument or its
   *  record holds one: in the first lowering, a test of it with a known
   *  string notes that the constants could decide it (`lower()`). */
  mayHoldKnown(v: V): void;
  /** The lowering keeps the string constants (`known()`). */
  readonly keepsStrings: boolean;
  /** The argument `op` of a call as a value of the engine that the code
   *  does not hold (`IRType.engine`; CE-1911), or `undefined` when `op` is
   *  not a function value. A function value is a name whose static type is
   *  a function type and that the program does not bind, a function
   *  literal, or a parameter that holds such a value. A function literal
   *  that reads a name that the program binds (a parameter, a local)
   *  declines: the engine does not see the value of that name. */
  engineArgument(op: Expression): V | undefined;
  /** The value of the known string `v` that the place `place` (a
   *  parameter `f#i`, a record field `T.k`) keeps in its type, or
   *  `undefined`: the last lowering keeps a constant only at a place whose
   *  constant a decision read (`readKnown()`), so that a constant that no
   *  test reads (a colour) does not lower a function once per value. */
  keepKnown(v: V, place: string): string | undefined;
  /** `v` (a parameter, the read of a field) is the known string `value`,
   *  kept at the place `place` (`keepKnown()`). */
  holdKnown(v: V, value: string, place: string): void;
  /** A decision (`==`, a `Match`) read the known string `v`: the places
   *  its value came through keep their constant (`keepKnown()`). */
  readKnown(v: V): void;
  /** The values of the lane `rows`: the inputs, the parameters, and the
   *  values that the program makes (`rows.build`, `rows.filter`, a call,
   *  a join of two arms, CE-1736). */
  readonly rowsParams: Set<V>;
  /** The expression being compiled: the site of a region that reads a
   *  value of the lane `rows` made where no node is at hand
   *  (`listSource()` of `lower-lists.ts`). */
  readonly root: Expression;
  /** The count of the elements of a row `At(g, i)` of such a value at an
   *  index known at run time, 0 where `i` is out of range, and the value
   *  of `Length` of the row, NaN there (`lower.ts`). */
  readonly rowLengths: Map<V, V>;
  /** The lane of the elements of a value of the engine type `t` that is of
   *  the lane `rows` as an input or a parameter (`rowsElementLane()`). */
  rowsElementLane(t: Type): 'integer' | 'real' | undefined;
  /** The lane of the elements of each value of the lane `rows`
   *  (`rowsParams`). */
  readonly rowsElements: Map<V, 'integer' | 'real'>;
  /** The length of every row of a value of the lane `rows` that a
   *  `rows.build` or a `rows.filter` made, where it is one value made
   *  before the region (`over()` of `lower-lists.ts`): the number of
   *  columns that the matrix operators read (CE-1736). A value made from
   *  it by another instruction (a join of two arms, a loop, a call, a
   *  join of lists) has none. */
  readonly rowWidths: Map<V, V>;
  /** The number of rows of a value of the lane `rows` that a `rows.build`
   *  made: the count of its region. */
  readonly rowCounts: Map<V, V>;
  /** The lane of the elements of `e` where it is of the lane `rows`: that
   *  of the parameter that the name `e` binds (`rowsElements`), whose
   *  declared type can state no lane (`g: list`, CE-1721), or else that of
   *  its engine type (`rowsElementLane()`). */
  rowsLaneOf(e: Expression): 'integer' | 'real' | undefined;
  /** The value `v` of the lane `rows` as a list of rank 2 of its number of
   *  rows and the length of its rows, where its rows have one length
   *  (`rowWidths`) and its elements are reals or integers; `undefined` for
   *  another value. `site` is the node of the region that it makes. */
  asMatrix(site: Expression, v: V): V | undefined;
  /** The list of rank 2 `v` of reals or integers as a value of the lane
   *  `rows` whose count and row length are its two lengths (`rows.of`, the
   *  same array of arrays). */
  rowsOfMatrix(v: V): V;
  /** Let a later operand read a matrix that the current consumer uses whole. */
  withMaterializedMatrices<T>(f: (keep: (v: V) => void) => T): T;
  /** Apply the row `r`, or the row of the library head of that name, to
   *  `args`. */
  apply(node: Expression, r: OperatorRow | string, args: V[]): V;
  type(v: V): IRType;
  constant(v: V): number | undefined;
  /** `v` is proved `>= 0` (`lower.ts`, `nonnegative()`). */
  nonnegative(v: V): boolean;
  /** The integer `v` is proved `>= 1` (`lower.ts`, `positive()`): a
   *  constant, or the number of rows of an input of a matrix type. */
  positive(v: V): boolean;
  /** The values of the lane `rows` that are of a matrix type of no stated
   *  dimensions (a parameter, an input that a user function reads): a
   *  value of such a type has a row, so their number of rows is proved
   *  `>= 1` (`positive()`). */
  readonly matrixValues: Set<V>;
  branch(
    node: Expression,
    cond: V,
    then: () => V | undefined,
    otherwise: () => V | undefined,
    want: boolean
  ): V | undefined;
  withFrame<T>(loop: boolean, f: (frame: Frame) => T): T;
  /** The region row `op` over the region `f` makes from `params`; a
   *  function `op` names the row once `f` has made the region. */
  region(
    op: string | (() => string),
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
   *  call `e` calls reads in the binding `def`, read at the call. */
  free(e: Fn, name: string, t: Type, def?: BoxedValueDefinition): V;
  /** The variables of the engine that the root function literal assigns
   *  (`Program.assigns`) and that the user function of `key` reads or
   *  writes, itself or through the user functions that it calls
   *  (`uses`), and those that it writes (`writes`), in the order of
   *  `Program.assigns` (CE-1776). Both empty for a function that touches
   *  none. `host`: a function of the host that it calls, itself or through
   *  its calls (`hostCall()`). */
  stateOf(key: object): {
    readonly uses: readonly Assigned[];
    readonly writes: readonly string[];
    readonly host?: string;
  };
  /** The binding of the variable `name` of the engine (a name of
   *  `Program.assigns`) that the call `e` of a user function that writes
   *  it rebinds here, at the root or in the body of a user function. A
   *  `Loop` carries it; a call in a frame of a loop (the body of a `Sum`,
   *  a callback of `Map`), or where a local or a parameter hides the
   *  variable, declines (CE-1776). */
  stateWrite(e: Fn, name: string): Binding;
  /** The record of the values `values` (`make()` of `lower-records.ts`),
   *  and the field `k` of the record `r`, read at `e` (`field()`). */
  pack(e: Expression, values: V[]): V;
  field(e: Expression, r: V, k: number): V;
  /** The list of no element of the lane `lane`, made at `e`: a build of no
   *  element. */
  emptyList(e: Expression, lane: Lane): V;
  /** `v` where a value of `lane` is read (a real converted to complex). */
  widen(v: V, lane: Lane): V;
  /** The lane of an input of type `number`, `unknown` or none: complex in
   *  `mode: 'complex'`. */
  readonly wide: 'real' | 'complex';
  /** The interval mode (`LowerOptions.mode`). */
  readonly interval: boolean;
  /** Constants are folded at lowering (`LowerOptions.fold` is not
   *  `false`). */
  readonly fold: boolean;
  /** The name of the user function whose body is being lowered. */
  inFunction?: string;
  /** The variables of the engine that the function whose body is being
   *  lowered writes (`stateOf()`, CE-1776): a write of another one is not
   *  a write of the variable (`writable()` of `lower.ts`). */
  stateWrites?: readonly string[];
  /** The body of each user function being lowered: `nan()`, a list of NaN
   *  can stand for an absent value of it (every reader of the calls that
   *  the IR function serves reads the two alike); `read`, the lowering of
   *  the body relied on `nan()` (`nanForAbsent()` of `lower.ts`). */
  readonly bodies: Map<Expression, { nan: () => boolean; read: boolean }>;
  /** The `iterationBudget`: a `Sum` or a `Product` of more passes is NaN. */
  readonly budget?: number;
  /** The target holds a list of a run-time length (`LowerOptions`). */
  readonly runtimeLengths: boolean;
  /** The `bigint` mode. */
  readonly bigint: boolean;
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

/** The field names of the named tuple type `t` (a reference to a nominal
 *  type whose body is a tuple with a name for each element), or
 *  `undefined`. */
export function recordNames(t: Type): string[] | undefined {
  const body = tupleBody(t);
  return body?.every((x) => x.name !== undefined)
    ? body.map((x) => x.name!)
    : undefined;
}

/** The elements of the body of the nominal tuple type that `t` refers to
 *  (not a parameterized one), or `undefined`. */
export function tupleBody(t: Type) {
  if (
    typeof t !== 'object' ||
    t.kind !== 'reference' ||
    t.alias ||
    t.args !== undefined ||
    typeof t.def !== 'object' ||
    t.def.kind !== 'tuple'
  )
    return undefined;
  return t.def.elements;
}

/** `t` refers to a record type that `type Fig = record{…}` declares (not
 *  a parameterized one, not an alias): a parameter of that type holds a
 *  record of that nominal type (`held()` of `lower-functions.ts`). */
export function isDeclaredRecordType(t: Type): boolean {
  return (
    typeof t === 'object' &&
    t.kind === 'reference' &&
    !t.alias &&
    t.args === undefined &&
    typeof t.def === 'object' &&
    t.def.kind === 'record'
  );
}

/** A record type that `type Fig = record{…}` declares, or a nominal tuple
 *  type that `type V2 = tuple<…>` declares, with the constructor function
 *  `function Fig(…) { {…} }` (`installConstructorFunction()` of
 *  `type-constructors.ts`): the name of the type, its definition, and the
 *  literal of the constructor, whose body computes the payload. */
export type DeclaredRecord = {
  readonly key: object;
  readonly literal: Fn;
  readonly nominal: string;
  readonly def: RecordType | TupleType;
};

/** The declared record or nominal tuple type whose constructor function
 *  the head of `e` resolves to (`DeclaredRecord`), not a parameterized
 *  one; else `undefined`. */
export function declaredRecord(e: Fn): DeclaredRecord | undefined {
  const od = e.operatorDefinition as
    | {
        _mintedTypeConstructor?: string;
        _constructorFunction?: { literal: Expression; type: TypeReference };
      }
    | undefined;
  const c = od?._constructorFunction;
  if (od?._mintedTypeConstructor !== 'constructor' || c === undefined)
    return undefined;
  const { literal, type } = c;
  if (
    !isFunction(literal, 'Function') ||
    type.typeParams !== undefined ||
    typeof type.def !== 'object' ||
    (type.def.kind !== 'record' && type.def.kind !== 'tuple')
  )
    return undefined;
  return { key: od, literal: literal as Fn, nominal: type.name, def: type.def };
}

/** The call `e` of the constructor of the declared type `d` takes the raw
 *  arm, the payload itself (the raw arm of `installConstructorFunction()`):
 *  of a record type, one operand that can be a value of the record type
 *  (`Fig({…})`); of a tuple type, one operand per element, each of which
 *  can be a value of its element (`V2(x, y)`). The two arms do not
 *  overlap, so any other call runs the body. */
export function rawPayloadCall(e: Fn, d: DeclaredRecord): boolean {
  if (d.def.kind === 'record')
    return e.ops?.length === 1 && typesOverlap(e.ops[0].type.type, d.def);
  const elements = d.def.elements;
  return (
    e.ops?.length === elements.length &&
    e.ops.every((op, k) => typesOverlap(op.type.type, elements[k].type))
  );
}

/** The definition that the head of the call `e` resolves to, when it is a
 *  user function with a function literal, and the literal. The constructor
 *  function of a declared record type is one (`declared`), but at a call of
 *  its raw arm (`rawPayloadCall()`). */
export function userBinding(
  e: Fn
): { key: object; literal: Fn; declared?: DeclaredRecord } | undefined {
  const d = declaredRecord(e);
  if (d !== undefined)
    return rawPayloadCall(e, d)
      ? undefined
      : { key: d.key, literal: d.literal, declared: d };
  const od = e.operatorDefinition as
    { _isLambda?: boolean; _lambdaLiteral?: Expression } | undefined;
  const key = od?._isLambda ? od : (e.valueDefinition as object | undefined);
  const value = od?._isLambda
    ? od._lambdaLiteral
    : (e.valueDefinition?.value as Expression | undefined);
  if (key === undefined || !isFunction(value, 'Function')) return undefined;
  return { key, literal: value as Fn };
}

/** Whether every name of `x`, operator names included, holds the
 *  definition of the system scope (a literal, `True`, `Pi`, `[]`, `{->}`):
 *  such a value reads no name of the program, so it can be inlined (a
 *  default of a protocol member, or of a function literal: `call()` of
 *  `lower-functions.ts`). */
export function readsNoProgramName(ce: IComputeEngine, x: Expression): boolean {
  const system = ce.contextStack[0]?.lexicalScope.bindings;
  const walk = (x: Expression): boolean => {
    if (isSymbol(x)) {
      const d = system?.get(x.symbol);
      return (
        d !== undefined &&
        (('value' in d && d.value === x.valueDefinition) ||
          ('operator' in d && d.operator === x.operatorDefinition))
      );
    }
    if (isFunction(x)) {
      const d = system?.get(x.operator);
      return (
        d !== undefined &&
        'operator' in d &&
        d.operator === x.operatorDefinition &&
        x.ops.every(walk)
      );
    }
    if (isDictionary(x)) return x.values.every(walk);
    return true;
  };
  return walk(x);
}
