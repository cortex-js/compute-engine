/**
 * The typing pass of a compile fragment: the positive list of what one
 * target compiles, as a pass that gives each node of a prepared tree a
 * fragment type, a representation on the target and one resolved conversion
 * per operand.
 *
 * This module names no target. A target gives a `FragmentDefinition`: its
 * rules (one per head), the type of a free symbol and the representation of
 * each type. `glsl-fragment.ts` gives the first one.
 *
 * The pass reads the tree that the prepare stage of the target returns, and
 * it changes no node: the annotation is kept beside the tree, in one table
 * per scope. It stops at the first node that has no type, and returns that
 * node as the refusal of the annotation. The parts of the refused node all
 * have a type (the walk types the operands first), so the refusal names the
 * innermost cause: `Add(Integrate(f, x), 1)` is refused at `Integrate`.
 *
 * The design is `docs/plans/2026-11-08-glsl-fragment-annotation-design.md`;
 * the list of what the GLSL target accepts is
 * `docs/plans/2026-11-08-glsl-fragment-spec.md`, section 2.
 */

import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import type { CompileDiagnostic } from './types.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  declareTypeOperand,
  declaredTypeSource,
  declareValueOperand,
  enforcedLocalTargets,
  leafAlwaysFits,
} from './compile-declarations.js';
import type { EnforcedTargets } from './compiler-state.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import { foldCaptureRefusal } from './compile-folded-values.js';
import { booleanClaim } from './compile-conditions.js';
import { contradictedDeclaredResult } from './compile-callbacks.js';
import { isRuntimePointShaped } from './compiler-type-facts.js';

//
// Types (the design note, section 2)
//

/** A type that a local, a parameter or the result of a function can have. */
export type FragmentValueType =
  | { kind: 'real' }
  | { kind: 'integer' }
  | { kind: 'boolean' }
  | { kind: 'complex' }
  | { kind: 'point'; size: number }
  | { kind: 'color' };

/** The type of an element of a list. */
export type FragmentElementType =
  { kind: 'real' } | { kind: 'integer' } | { kind: 'point'; size: number };

/** A list. `count` is absent when it is known only at run time. */
export type FragmentListType = {
  kind: 'list';
  element: FragmentElementType;
  count?: number;
};

export type FragmentType =
  | FragmentValueType
  | FragmentListType
  /** A `Range` with integer bounds. Only the index set of `Sum`, `Product`
   * or `At`. */
  | { kind: 'range' }
  /** A statement of a block in a function body: it has no value. */
  | { kind: 'statement' }
  /** A user function that is emitted once as a function of the target. */
  | {
      kind: 'function';
      parameters: readonly {
        name: string;
        type: FragmentValueType | FragmentListType;
      }[];
      /** A list result has a static count: the compiler writes the body of
       *  such a function at each call. */
      result: FragmentValueType | FragmentListType;
    };

/**
 * The conversion of one operand, as the node reads it. `none` where nothing
 * changes. `real-to-complex` reads a real as a complex number. `broadcast`
 * reads a scalar as a point or a list of the size of its neighbour.
 * `to-float` reads an integer that the target holds as an integer type in
 * floating-point arithmetic. `to-int` reads a value as an index.
 */
export type FragmentConversion<R> = {
  kind: 'none' | 'real-to-complex' | 'broadcast' | 'to-float' | 'to-int';
  /** What the node reads the operand as, after the conversion. For a
   *  broadcast, the type holds the resolved size. */
  type: FragmentType;
  representation: R;
};

/** The facts of a node that has a value at run time. */
export type FragmentValueFacts<R> = {
  readonly type: FragmentValueType | FragmentListType;
  readonly representation: R;
  /** One resolved conversion per operand that the node reads as a value.
   *  Absent for a node with no such operand. */
  readonly conversions?: readonly FragmentConversion<R>[];
};

/** The facts of a node. */
export type FragmentFacts<R> =
  | FragmentValueFacts<R>
  /** A statement, a range or a function: no value at run time. */
  | {
      readonly type: FragmentType & {
        kind: 'statement' | 'range' | 'function';
      };
    };

/** The role of a name where it is bound. */
export type FragmentBindingRole = 'input' | 'parameter' | 'local' | 'index';

export type FragmentScope<R> = {
  readonly parent?: FragmentScope<R>;
  /** The names that this scope binds: the inputs (root scope), the
   *  parameters, the locals, the index of a loop or of a `Sum`. */
  readonly bindings: Map<string, FragmentFacts<R>>;
  /** The facts of each node that was typed in this scope. */
  readonly facts: Map<Expression, FragmentFacts<R>>;
  /** The statements (an `Assign`, a `Loop`, a `Break`, ...) that the pass
   *  checked in this scope. A statement has no facts in `facts`: it is
   *  checked again at each use, because a `Break` is valid in a loop and
   *  not outside one. */
  readonly statements: Set<Expression>;
  /** The scope that a node of this scope opens. Only a node that binds a
   *  name opens one: a block, a loop, a `Sum` or a `Product`. A function
   *  opens its scope in `FragmentAnnotation.functions`. */
  readonly inner: Map<Expression, FragmentScope<R>>;
};

/** Why a node has no type. Each reason has one form of message. */
export type FragmentRefusalReason =
  /** The head is not in the list (`Integrate`). */
  | 'head'
  /** No signature of the head takes these operands (`Less` on a complex
   *  operand; an `If` whose branches have two types). */
  | 'signature'
  /** A free symbol has no fragment type (`a` typed `unknown`). */
  | 'symbol'
  /** The form is in the list, but not at this place (a `Block` at the row
   *  root, a `Range` as a value). */
  | 'place'
  /** A limit (a list of 9,801 elements, a recursive function). */
  | 'limit';

/** The first node with no type. */
export type FragmentRefusal = {
  readonly node: Expression;
  readonly reason: FragmentRefusalReason;
  readonly message: string;
  /** The head of the node, when it is a function expression. */
  readonly operator?: string;
  /** The name of the symbol, when the node is a free symbol or a name that
   *  a statement reads or writes. */
  readonly binding?: string;
  /** The key of the user function whose body holds the node. */
  readonly function?: string;
};

export type FragmentAnnotation<R> = {
  /** The prepared root. Emission walks this tree. */
  readonly root: Expression;
  readonly scope: FragmentScope<R>;
  /** One entry per function to emit, under the key that
   *  `FragmentDefinition.functionOf()` gives. */
  readonly functions: Map<
    string,
    {
      body: Expression;
      scope: FragmentScope<R>;
      type: FragmentType;
      sizeCheck?: FragmentFunction['sizeCheck'];
    }
  >;
  /** The first node with no type. Absent when every node has one. */
  readonly refusal?: FragmentRefusal;
};

//
// Rules (the design note, section 4)
//

/**
 * The type of one operand place in a signature.
 *
 * - `real`: a real or an integer.
 * - `integer`: an integer.
 * - `index`: a real or an integer, read as an index (`to-int` when the
 *   representation of the operand is not the representation of an index).
 * - `boolean`, `complex` (a real is converted), `color` (also a literal
 *   `Tuple` of three reals, read as an sRGB colour, or a string literal,
 *   which names a colour at compile time; a point input or a computed
 *   point is not a colour).
 * - `name`: a string literal, which names a colour space or another option
 *   at compile time. It is not a value at run time.
 * - `point`: a point of the size of the signature, or a list of that many
 *   reals. With `broadcast`, also a real, which is broadcast.
 * - `real-list`: a list of reals with a representation.
 * - `real-or-list`: a real, or a list of reals with a representation (the
 *   operands of a reduction that flattens its lists, `Max(L, x)`).
 * - `tuple`: a point of the size of the signature, not a list.
 */
export type FragmentPattern =
  | 'real'
  | 'integer'
  | 'index'
  | 'boolean'
  | 'complex'
  | 'color'
  | 'name'
  | 'point'
  | 'real-list'
  | 'real-or-list'
  | 'tuple';

/** The type of the result of a signature. `point` has the size of the
 *  signature. A `real` result is an `integer` when the engine type of the
 *  node is an integer type. */
export type FragmentResultPattern =
  | 'real'
  | 'integer'
  | 'boolean'
  | 'complex'
  | 'color'
  | 'point'
  | { kind: 'point'; size: number };

/**
 * One signature of a head that binds no name. It matches `operands.length`
 * operands, or more when `rest` is given (each further operand of the
 * pattern `rest`). A signature that names `point` is tried for each size of
 * `sizes` (default 2, 3, 4), and matches only when at least one operand is
 * a point or a list (a scalar operand alone matches a scalar signature).
 */
export type FragmentSignature = {
  readonly operands: readonly FragmentPattern[];
  readonly rest?: FragmentPattern;
  readonly result: FragmentResultPattern;
  /** The sizes of a `point` pattern. Default: 2, 3 and 4. */
  readonly sizes?: readonly number[];
  /** A `real` operand at a `point` place is broadcast to the point. */
  readonly broadcast?: boolean;
  /** The positions (0-based) where a broadcast scalar may stand, when the
   *  target admits it at some positions only (GLSL `mod(vec3, float)`, but
   *  not `mod(float, vec3)`). Absent: every position. */
  readonly scalarSlots?: readonly number[];
  /** The positions (0-based) where a broadcast scalar may stand when a
   *  vector operand is a point (a tuple), not a list. The interpreter
   *  refuses a point and a number in a sum (`(1, 2) + 3` is an
   *  `incompatible-type` error) and a number divided by a point, but takes
   *  a number added to a list. Absent: the positions of `scalarSlots`. */
  readonly pointScalarSlots?: readonly number[];
  /** The signature applies only to a node for which `when` is true, in the
   *  scope where the pass reads it. The GLSL target uses it for a node whose
   *  value the compiler reads as complex although its operands are real
   *  (`Arcsin(x)` with `x` real): the emitter writes it with the complex
   *  helper. Absent: every node. */
  readonly when?: (node: Expression, scope: FragmentScope<unknown>) => boolean;
};

/** The place of a use (the design note, section 4). */
export type FragmentPlace = 'value' | 'statement' | 'index-set' | 'at-base';

/** The context that the walk passes to each node. */
export type FragmentContext<R> = {
  readonly place: FragmentPlace;
  /** The key of the user function whose body is being typed. */
  readonly fn?: string;
  /** The loop that encloses the node, if any, and the scope that it opens. */
  readonly loop?: { kind: 'loop' | 'parallel'; scope: FragmentScope<R> };
  /** The scope of the innermost parallel loop that encloses the node, if
   *  any. A counted loop inside a parallel loop replaces `loop`, but not
   *  this field: a statement at any depth of a parallel loop writes a local
   *  bound outside it only with `AddTo`. */
  readonly parallel?: FragmentScope<R>;
};

/** The operations that a rule that walks can use. */
export type FragmentWalker<R> = {
  readonly definition: FragmentDefinition<R>;
  /** Type `node` in `scope` and check it against the place of `context`. */
  type(
    node: Expression,
    scope: FragmentScope<R>,
    context: FragmentContext<R>
  ): FragmentFacts<R>;
  /** Type `node` as a value. */
  value(
    node: Expression,
    scope: FragmentScope<R>,
    context: FragmentContext<R>
  ): FragmentValueFacts<R>;
  /** Type `node` as an index or a bound: an integer or a real value, with
   *  the conversion that reads it as an index. */
  index(
    node: Expression,
    scope: FragmentScope<R>,
    context: FragmentContext<R>
  ): FragmentConversion<R>;
  /** The constant that the compiler writes in place of `node` in `scope`
   *  (`FragmentDefinition.constantValue`), or `undefined`. A node that reads
   *  a name that a form binds is not constant. */
  constant(node: Expression, scope: FragmentScope<R>): Expression | undefined;
  /** Open the scope of `node`, a child of `scope`. */
  open(node: Expression, scope: FragmentScope<R>): FragmentScope<R>;
  /** Bind `name` in `scope`. Refuses when the target has no representation
   *  for the type in this role. */
  bind(
    node: Expression,
    scope: FragmentScope<R>,
    name: string,
    type: FragmentValueType | FragmentListType,
    role: FragmentBindingRole
  ): FragmentValueFacts<R>;
  /** Collect `names` in `scope` before their declaration: a read of one of
   *  them is refused until `bind()` reaches it. */
  collect(scope: FragmentScope<R>, names: readonly string[]): void;
  /** The binding of `name` that a statement of the current function can
   *  write, with its role, or `undefined`. */
  binding(
    scope: FragmentScope<R>,
    name: string
  ):
    | {
        facts: FragmentFacts<R>;
        role: FragmentBindingRole;
        scope: FragmentScope<R>;
      }
    | undefined;
  /** The facts of a computed value of `type`, or a refusal when the target
   *  has no representation for it. */
  valueFacts(
    node: Expression,
    type: FragmentValueType | FragmentListType,
    conversions?: readonly FragmentConversion<R>[]
  ): FragmentValueFacts<R>;
  /** The conversion that reads `facts` as `type`, or `undefined` when no
   *  conversion does. */
  convert(
    facts: FragmentValueFacts<R>,
    type: FragmentValueType | FragmentListType
  ): FragmentConversion<R> | undefined;
  /** The type of one branch for two branches, or `undefined`. */
  join(
    a: FragmentValueType | FragmentListType,
    b: FragmentValueType | FragmentListType
  ): FragmentValueType | FragmentListType | undefined;
  /** Whether the program writes `name = name + e` (an `Assign`, not a
   *  `+=`) in the body that the pass types (the root, or the body of a user
   *  function), or `undefined` when this is not known
   *  (`FragmentDefinition.sumAssigned`, `FragmentFunction.sumAssigned`). */
  sumAssigned(name: string): boolean | undefined;
  /** Refuse `node`. */
  refuse(
    node: Expression,
    reason: FragmentRefusalReason,
    message: string,
    binding?: string
  ): never;
  /** The facts of `node` typed by a list of signatures, as for a rule with
   *  `signatures`. A rule that walks calls it after its own checks. */
  signatures(
    node: Expression,
    scope: FragmentScope<R>,
    context: FragmentContext<R>,
    signatures: readonly FragmentSignature[]
  ): FragmentFacts<R>;
};

/**
 * The rule of one head: a list of signatures, for a head that binds no
 * name; or a function that walks, for a head that binds a name or restricts
 * a place. A rule that walks types the parts of the node in its own order,
 * with the walker, and returns the facts of the node.
 */
export type FragmentRule<R> =
  | { readonly signatures: readonly FragmentSignature[] }
  | {
      readonly walk: (
        node: Expression,
        scope: FragmentScope<R>,
        context: FragmentContext<R>,
        walker: FragmentWalker<R>
      ) => FragmentFacts<R>;
    };

/** The user function that a call reaches (`FragmentDefinition.functionOf`). */
export type FragmentFunction = {
  /** The key of its entry in `FragmentAnnotation.functions`. */
  readonly key: string;
  /** The name of the function, for a message. */
  readonly name: string;
  /** The names of the parameters, in order. */
  readonly parameters: readonly string[];
  /** The type of each parameter, from the declared signature, or
   *  `undefined` when the parameter has no fragment type. A list type is
   *  bound as it is: the definition decides with
   *  `representationOfBinding()` whether it holds it. */
  readonly parameterTypes: readonly (
    FragmentValueType | FragmentListType | undefined
  )[];
  /** For each parameter, `true` when its declared or inferred type is a
   *  collection with no fragment type (`list<number>`, which the engine
   *  infers from the `At` reads of the body). Such a parameter takes a
   *  list argument whole, and a list argument of 2 to 4 numbers gives it
   *  that list type, held as a `vecN` (the spec, decision 18). A parameter
   *  with no type, or of a scalar type, does not: the interpreter applies the
   *  function to each element of a list argument. */
  readonly collectionParameters?: readonly boolean[];
  /** `true` when the interpreter applies the function to each element of
   *  a list argument, because every parameter has a scalar type (the
   *  spec, decision 19). A call with a list of 2 to 4 reals at a scalar
   *  parameter is then the list of the values of the function at the
   *  elements, which the emitter writes with an element-wise wrapper. */
  readonly broadcasts?: boolean;
  /** The symbol of each parameter in the function literal, when the
   *  literal has one. The pass binds the parameter with it, so that the
   *  check of a reserved name and the message of a limit read the name. */
  readonly parameterSymbols?: readonly (Expression | undefined)[];
  /** The arguments of the call that bind the parameters. A call of a
   *  variant that reads a list input by name passes fewer arguments than
   *  the function has. */
  readonly arguments: readonly Expression[];
  /** The prepared body. */
  readonly body: Expression;
  /** The tree whose size the emitter checks: the body of a definition,
   *  which has a common-subexpression pass of its own, so the check counts
   *  a node that several paths reach once. `undefined` when the emitter
   *  checks no size for this function. */
  readonly sizeCheck?: { body: Expression };
  /** The names `s` of the statements `s = s + e` of the body as the
   *  program wrote it (`sumAssignedNames()`), or `undefined` when they are
   *  not known: the pass then reads no `Assign` of the body as a lowered
   *  `+=`. */
  readonly sumAssigned?: ReadonlySet<string>;
};

/** What one target compiles. `R` is the type of its representations. Two
 *  representations are the same when they are `===`. */
export type FragmentDefinition<R> = {
  /** The name of the fragment in a message: "GLSL". */
  readonly name: string;
  /** The positive list: one rule per head. */
  readonly rules: Readonly<Record<string, FragmentRule<R>>>;
  /** The type of a free symbol, from its engine type, or `undefined` when
   *  the fragment has no type for it. */
  typeOfSymbol(
    symbol: Expression
  ): FragmentValueType | FragmentListType | undefined;
  /** The type of a free symbol that the pass reads as an input of the
   *  expression, when it differs from `typeOfSymbol()` (a node boxed before
   *  the declaration of its name). Absent: `typeOfSymbol()`. */
  typeOfInput?(
    symbol: Expression
  ): FragmentValueType | FragmentListType | undefined;
  /** The fragment type of the engine type `t` (the ascribed type of a
   *  `Typed`), or `undefined` when the fragment has no type for it. */
  typeOfType?(t: Type): FragmentValueType | FragmentListType | undefined;
  /** The value that the compiler writes in place of the free symbol
   *  `symbol` (its stored value), or `undefined` when the compiler reads
   *  the symbol as an input. The pass types the value in place of the
   *  symbol. */
  storedValue?(symbol: Expression): Expression | undefined;
  /** How the target holds the value of a name, chosen once, where the name
   *  is bound, from its type, its role and its declaration. `undefined`
   *  when the target cannot hold it. */
  representationOfBinding(
    type: FragmentValueType | FragmentListType,
    binding: {
      role: FragmentBindingRole;
      /** The name. Absent when the pass asks for the representation of a
       *  role only: the value of an index or a bound, which the target
       *  converts to its loop counter. */
      symbol?: Expression;
      /** The shader type that the caller of `compileFunction()` or
       *  `compileShader()` wrote for the name. */
      declared?: string;
    }
  ): R | undefined;
  /** How the target holds a computed value of this type, or `undefined`. */
  representationOfValue(
    type: FragmentValueType | FragmentListType
  ): R | undefined;
  /** The names `s` of the statements `s = s + e` of the root as the
   *  program wrote it (`sumAssignedNames()`), or `undefined` when they are
   *  not known: the pass then reads no `Assign` of the root as a lowered
   *  `+=`. */
  readonly sumAssigned?: ReadonlySet<string>;
  /** The user function that a call reaches, or `undefined`. */
  functionOf(
    call: Expression,
    scope: FragmentScope<R>
  ): FragmentFunction | undefined;
  /** The constant value that the compiler writes in place of `node`, or
   *  `undefined` when it does not fold `node`. The pass types the value in
   *  place of the node. */
  constantValue?(node: Expression): Expression | undefined;
  /** Why a binding has no representation, for the message of the refusal
   *  (a limit of the target, a name that the target reserves), or
   *  `undefined` for the default message. */
  bindingLimit?(
    type: FragmentValueType | FragmentListType,
    binding: { role: FragmentBindingRole; symbol: Expression }
  ): string | undefined;
  /** Whether the string literal `text` is valid at a place of the pattern
   *  `color` (a colour name or code) or `name` (a colour space or another
   *  option) of the head `operator`. Absent: every string literal is valid
   *  there. */
  literal?(pattern: 'color' | 'name', text: string, operator: string): boolean;
  /** The range of a constant bound of a counted loop, a `Sum` or a
   *  `Product` (inclusive), when the loop counter of the target has one. */
  counterRange?: readonly [lower: number, upper: number];
  /** Whether the target writes the `Sum` or `Product` `node` over the
   *  constant integers `lower` to `upper` with no loop (the empty range, or
   *  terms written out one by one): its bounds then need not fit the loop
   *  counter. */
  aggregateHasNoLoop?(node: Expression, lower: number, upper: number): boolean;
  /** The type of the local that a `Declare` with a value declares, or
   *  `undefined` for the rule of the pass, `localType()`, which widens an
   *  integer to a real. `value`: the type of the value; `declared`: the
   *  spelling of the declared type (`integer`), or `undefined` for a
   *  declaration with no type (the form of a `let`, `Declare(t, {value:
   *  …})`); `inferred`: the type that the engine infers for the local in
   *  its block, from its value and from every value written to it;
   *  `name`: the name of the local. Absent: the rule of the pass. */
  localType?(local: {
    name: string;
    value: FragmentValueType | FragmentListType;
    declared: string | undefined;
    inferred: Type | undefined;
  }): FragmentValueType | FragmentListType | undefined;
  /** Whether the target reads the bound `bound` of a counted loop, which
   *  it does not fold and whose static type is not `integer`, as an
   *  integer. `isInteger` answers whether the fact of a node of the bound
   *  is `integer`. The JavaScript structured route admits a bound computed
   *  from the length of a list with integer arithmetic, which the engine
   *  types `integer | signed_infinity` or `real`. Absent: such a bound is
   *  refused, as the shader emitters read the static type of a bound. */
  loopBoundFromFact?(
    bound: Expression,
    isInteger: (node: Expression) => boolean
  ): boolean;
  /** Whether a call passes a list argument of the type `argument` to a
   *  declared list parameter of another type `parameter` as it is, with no
   *  conversion (a list of integers to a list of reals, when the target
   *  holds both as one array of numbers). Absent: such an argument is
   *  refused. */
  passesListArgument?(
    argument: FragmentListType,
    parameter: FragmentListType
  ): boolean;
};

//
// The pass
//

/**
 * A name that the caller of the compilation declares with a type spelling of
 * the target (a parameter of `compileFunction()`, an input, a uniform or an
 * output of `compileShader()`). The pass binds it in the root scope, with the
 * role `input`, at its first read. `type` is `undefined` when the spelling has
 * no fragment type (`ivec2`, `mat3`, an array): a read of the name is then
 * refused, and a declaration that the body does not read is not checked.
 */
export type FragmentDeclaredInput = {
  readonly name: string;
  readonly type: FragmentValueType | FragmentListType | undefined;
  /** The spelling that the caller wrote (`vec2`, `uint`). */
  readonly declared: string;
};

/** The options of one run of the pass. */
export type FragmentPassOptions = {
  /** The names that the caller declares (`FragmentDeclaredInput`). They
   *  hide an engine symbol of the same name. */
  readonly inputs?: ReadonlyArray<FragmentDeclaredInput>;
};

/** A refusal, thrown inside the pass and caught at its entry. */
class RefusalSignal {
  constructor(readonly refusal: FragmentRefusal) {}
}

/** The side tables of one run of the pass, which the scope type does not
 * hold: the role of each binding, the names collected before their
 * declaration, and the scopes that are the scope of a function. */
type PassState<R> = {
  readonly roles: WeakMap<FragmentScope<R>, Map<string, FragmentBindingRole>>;
  readonly pending: WeakMap<FragmentScope<R>, Set<string>>;
  readonly functionScopes: WeakSet<FragmentScope<R>>;
  readonly root: FragmentScope<R>;
  readonly functions: FragmentAnnotation<R>['functions'];
  /** The keys of the functions whose body is being typed. */
  readonly typing: Set<string>;
  /** The names of the free symbols whose stored value is being typed. */
  readonly storing: Set<string>;
  /** The names that the caller declares, by name. */
  readonly declared: ReadonlyMap<string, FragmentDeclaredInput>;
  /** For each function key, which parameters have no declared type and take
   *  the type of their argument at the first call (the spec, decision 11). */
  readonly inferred: Map<string, readonly boolean[]>;
};

/** The operands of a function expression, or none. */
function opsOf(node: Expression): readonly Expression[] {
  return isFunction(node) ? node.ops : [];
}

function newScope<R>(parent?: FragmentScope<R>): FragmentScope<R> {
  return {
    parent,
    bindings: new Map(),
    facts: new Map(),
    statements: new Set(),
    inner: new Map(),
  };
}

function isValueFacts<R>(
  facts: FragmentFacts<R>
): facts is FragmentValueFacts<R> {
  return 'representation' in facts;
}

/** The type as a message writes it: `real`, `point<3>`, `list<real, 9801>`. */
export function fragmentTypeToString(t: FragmentType): string {
  switch (t.kind) {
    case 'point':
      return `point<${t.size}>`;
    case 'list':
      return `list<${fragmentTypeToString(t.element)}${t.count === undefined ? '' : `, ${t.count}`}>`;
    case 'function':
      return `(${t.parameters.map((p) => fragmentTypeToString(p.type)).join(', ')}) -> ${fragmentTypeToString(t.result)}`;
    default:
      return t.kind;
  }
}

function sameType(a: FragmentType, b: FragmentType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'point') return a.size === (b as { size: number }).size;
  if (a.kind === 'list') {
    const l = b as FragmentListType;
    return a.count === l.count && sameType(a.element, l.element);
  }
  return true;
}

function isScalarNumeric(t: FragmentType): boolean {
  return t.kind === 'real' || t.kind === 'integer';
}

/**
 * Type the prepared tree `root` with the fragment `definition`. The result
 * holds the facts of every node that was typed, and the first node with no
 * type, if any.
 *
 * The pass throws only for an error of the engine that it calls (a type
 * that cannot be computed); a node outside the fragment is the `refusal`
 * of the result.
 */
export function typeFragment<R>(
  root: Expression,
  definition: FragmentDefinition<R>,
  options: FragmentPassOptions = {}
): FragmentAnnotation<R> {
  const rootScope = newScope<R>();
  const state: PassState<R> = {
    roles: new WeakMap(),
    pending: new WeakMap(),
    functionScopes: new WeakSet(),
    root: rootScope,
    functions: new Map(),
    typing: new Set(),
    storing: new Set(),
    declared: new Map((options.inputs ?? []).map((d) => [d.name, d])),
    inferred: new Map(),
  };
  const walker = makeWalker(definition, state);
  try {
    walker.value(root, rootScope, { place: 'value' });
  } catch (e) {
    if (e instanceof RefusalSignal)
      return {
        root,
        scope: rootScope,
        functions: state.functions,
        refusal: e.refusal,
      };
    throw e;
  }
  return { root, scope: rootScope, functions: state.functions };
}

/**
 * The facts of `node` in `scope`, as the pass recorded them, or `undefined`
 * when the pass did not type `node` in that scope. A node that emission
 * makes is never typed here on request: a trusted lowering registers it
 * (the design note, section 3).
 */
export function fragmentFactsOf<R>(
  scope: FragmentScope<R>,
  node: Expression
): FragmentFacts<R> | undefined {
  return scope.facts.get(node);
}

/**
 * The fields that a compile target of the emitter carries for the fragment,
 * as an intersection with `CompileTarget`, so that `CompileTarget` has no
 * member of its own for them. A copy of the target (`{ ...target }`) keeps
 * them.
 *
 * - `fragmentScope`: the scope of the annotation where the emitter writes
 *   code: the root scope, or the scope of the user function whose body it
 *   writes. A block, a loop and an aggregate inside open inner scopes, which
 *   `fragmentFactsUnder()` searches.
 * - `fragmentBody`: in the body of a user function, the body of its entry
 *   in `FragmentAnnotation.functions`, which the pass typed in
 *   `fragmentScope` and which the emitter writes. A node that the emitter
 *   writes and that is not a node of this tree is a node that emission
 *   made (a folded constant, an unrolled term).
 * - `fragmentPassBudget`: the pass cap of the evaluation (the
 *   `iterationBudget` option). Each loop that the emitter writes counts its
 *   passes when it is set.
 */
export type FragmentTargetFields<R> = {
  fragmentScope?: FragmentScope<R>;
  fragmentBody?: Expression;
  fragmentPassBudget?: number;
};

/**
 * The facts of `node` in `scope` or in a scope inside it, when the pass typed
 * `node` there with one representation. `undefined` when the pass did not
 * type `node` under `scope`, or typed it with two representations in two
 * scopes: the emitter then asks its own analysis.
 *
 * The emitter knows the scope of the function whose body it writes, and not
 * the inner scope of each block or loop of the body, so it searches them.
 */
export function fragmentFactsUnder<R>(
  scope: FragmentScope<R> | undefined,
  node: Expression
): FragmentValueFacts<R> | undefined {
  if (scope === undefined) return undefined;
  const facts = factsUnderScope(scope).get(node);
  return facts === CONFLICTING_FACTS ? undefined : facts;
}

/**
 * The contract of a trusted lowering, as `fragmentReplaceOperands()` checks
 * it: the heads that a node made by the lowering can have, and the operand
 * count of the outermost made node.
 */
export type FragmentLoweringContract = {
  /** The name of the lowering, for the message of an internal error. */
  readonly name: string;
  /** The heads of the nodes that the lowering makes. `'any'` when the
   *  lowering copies the heads of another expression (the body of a
   *  function literal). */
  readonly operators: readonly string[] | 'any';
  /** The operand count of the outermost made node: a number, or a range
   *  `[min, max]`. Absent: any count. */
  readonly nops?: number | readonly [number, number];
  /** True when a leaf of the made tree can be a symbol that the lowering
   *  copied from another expression (a name of a function body). */
  readonly symbolLeaves?: boolean;
  /** Names of symbols that no leaf of the made tree can be, also when the
   *  leaf is accepted otherwise (a symbol of the original). A lowering that
   *  removes a constant (`Pi`) states it here. */
  readonly forbiddenSymbols?: readonly string[];
};

/**
 * The nodes that `fragmentReplaceOperands()` accepted. A lowering can make a
 * node whose operand another lowering made (`Multiply(k, Add(u, c'))`), and
 * the check of the outer node accepts the inner one. A made node is a new
 * object, and the set holds it weakly, so it is released with the code.
 */
const LOWERED_NODES = new WeakSet<Expression>();
/** Whether `part` is `whole` or a node of the subtree of `whole`, or is
 *  structurally the same (`isSame()`) as one of them. A constructor of the
 *  engine can make again a node that it copies (`ce.function('Divide', [u,
 *  d])` can box `d` again), and that node has the type of the node it
 *  copies. */
function isPartOf(part: Expression, whole: Expression): boolean {
  if (part === whole || part.isSame(whole)) return true;
  return isFunction(whole) && whole.ops.some((op) => isPartOf(part, op));
}

/** Whether the pass typed `node` in `scope` or in a scope inside it, with
 *  any facts (also two different facts in two scopes). */
function typedUnder<R>(scope: FragmentScope<R>, node: Expression): boolean {
  if (scope.facts.has(node)) return true;
  for (const inner of scope.inner.values())
    if (typedUnder(inner, node)) return true;
  return false;
}

/**
 * Whether the pass typed `node` where the emitter writes code under
 * `scope`: `node` has facts in `scope` or in a scope inside it, or is a
 * statement that the pass checked there, or a trusted lowering made `node`
 * and `fragmentReplaceOperands()` accepted it. A test reads it to check
 * that the emitter writes only the nodes that the pass typed
 * (`CompilerState._emitProbe`).
 */
export function fragmentNodeIsTyped<R>(
  scope: FragmentScope<R>,
  node: Expression
): boolean {
  if (LOWERED_NODES.has(node) || typedUnder(scope, node)) return true;
  const checked = (s: FragmentScope<R>): boolean =>
    s.statements.has(node) || [...s.inner.values()].some(checked);
  return checked(scope);
}

/**
 * The structural check of a trusted lowering: a rewrite that the emitter
 * makes, after the pass, of an operand `original` of the node that it
 * writes (or of several operands, as an array), into the new expression
 * `made` (the design note
 * `docs/plans/2026-11-08-glsl-fragment-annotation-design.md`, section 3, "A
 * node that emission makes"). The pass did not type `made`, and
 * `fragmentFactsOf()` does not type it on request.
 *
 * `made` is accepted when it is `original`, a node of `original` (or a
 * node structurally the same as one of them, `isSame()`), a node
 * that the pass typed in the scope where the emitter writes code
 * (`FragmentTargetFields.fragmentScope`), or a number literal. Otherwise
 * it must be a function expression with a head of `contract.operators` (and,
 * for the outermost node, `contract.nops` operands), and each operand is
 * checked in the same way. With `contract.symbolLeaves`, a symbol is also
 * accepted. A node that fails the check is an internal error: the lowering
 * made a node that its contract does not state.
 *
 * The check rejects a head outside `contract.operators`, a leaf that is
 * neither part of the original nor a typed node, a non-finite number
 * literal, and a leaf that is a symbol of `contract.forbiddenSymbols`. It
 * does not show that the value is kept: the value tests in
 * `scripts/glsl-check/glsl-driver.test.ts` (`LOWERINGS`) find a wrong value
 * by running each lowering against the interpreter. A target with no annotation (no
 * `fragmentScope`) is not checked. Returns `made`.
 */
export function fragmentReplaceOperands(
  original: Expression | readonly Expression[],
  made: Expression,
  contract: FragmentLoweringContract,
  target: unknown
): Expression {
  const scope = (target as FragmentTargetFields<unknown> | undefined)
    ?.fragmentScope;
  const originals: readonly Expression[] = Array.isArray(original)
    ? original
    : [original as Expression];
  if (scope === undefined || originals.includes(made)) return made;
  // The nodes of the original, by identity. `isPartOf()` (a structural
  // comparison) runs only for a node that is not in the set.
  const nodesOfOriginal = new Set<Expression>();
  const collect = (e: Expression): void => {
    nodesOfOriginal.add(e);
    if (isFunction(e)) for (const op of e.ops) collect(op);
  };
  for (const o of originals) collect(o);
  const ofOriginal = (e: Expression): boolean =>
    nodesOfOriginal.has(e) || originals.some((o) => isPartOf(e, o));
  const accepted = (e: Expression): boolean =>
    LOWERED_NODES.has(e) ||
    ofOriginal(e) ||
    typedUnder(scope, e) ||
    (isNumber(e) && e.isFinite !== false) ||
    (contract.symbolLeaves === true && isSymbol(e));
  const fail = (e: Expression, why: string): never => {
    throw new Error(
      `Internal error: the lowering "${contract.name}" made ` +
        `\`${e.toString()}\` from ` +
        `${originals.map((o) => `\`${o.toString()}\``).join(', ')}, ${why}`
    );
  };
  const check = (e: Expression, outermost: boolean): void => {
    if (!outermost && accepted(e)) return;
    if (outermost && (ofOriginal(e) || typedUnder(scope, e))) return;
    if (outermost && isNumber(e) && e.isFinite !== false) return;
    if (!isFunction(e)) return void fail(e, 'which is not a typed node');
    if (
      contract.operators !== 'any' &&
      !contract.operators.includes(e.operator)
    )
      fail(e, `whose head is not one of ${contract.operators.join(', ')}`);
    const n = contract.nops;
    if (
      outermost &&
      n !== undefined &&
      (typeof n === 'number' ? e.nops !== n : e.nops < n[0] || e.nops > n[1])
    )
      fail(e, `with ${e.nops} operands`);
    for (const op of e.ops) check(op, false);
  };
  check(made, true);
  const forbidden = contract.forbiddenSymbols;
  if (forbidden !== undefined) {
    // The walk covers the whole made tree, also the parts that the check
    // accepted without a visit.
    const walk = (e: Expression): void => {
      if (isSymbol(e) && forbidden.includes(e.symbol))
        fail(e, `which is the forbidden symbol \`${e.symbol}\``);
      if (isFunction(e)) for (const op of e.ops) walk(op);
    };
    walk(made);
  }
  LOWERED_NODES.add(made);
  return made;
}

/** The marker of a node that the pass typed with two representations, or
 *  two kinds of type, in two scopes under one scope. */
const CONFLICTING_FACTS = Symbol('conflicting facts');

/** For each scope that `fragmentFactsUnder()` searched, the facts of each
 *  value node typed in that scope or in a scope inside it. The pass does not
 *  change a scope after it ends, and the emitter reads the facts only then,
 *  so the map is built once per scope. */
const FACTS_UNDER_SCOPE = new WeakMap<
  FragmentScope<unknown>,
  Map<Expression, FragmentValueFacts<unknown> | typeof CONFLICTING_FACTS>
>();

function factsUnderScope<R>(
  scope: FragmentScope<R>
): Map<Expression, FragmentValueFacts<R> | typeof CONFLICTING_FACTS> {
  type Entry = FragmentValueFacts<R> | typeof CONFLICTING_FACTS;
  const known = FACTS_UNDER_SCOPE.get(scope as FragmentScope<unknown>);
  if (known !== undefined) return known as Map<Expression, Entry>;
  const map = new Map<Expression, Entry>();
  const visit = (s: FragmentScope<R>): void => {
    for (const [node, facts] of s.facts) {
      if (!isValueFacts(facts)) continue;
      const found = map.get(node);
      if (found === undefined) map.set(node, facts);
      else if (
        found !== CONFLICTING_FACTS &&
        (found.representation !== facts.representation ||
          found.type.kind !== facts.type.kind)
      )
        map.set(node, CONFLICTING_FACTS);
    }
    for (const inner of s.inner.values()) visit(inner);
  };
  visit(scope);
  FACTS_UNDER_SCOPE.set(
    scope as FragmentScope<unknown>,
    map as Map<
      Expression,
      FragmentValueFacts<unknown> | typeof CONFLICTING_FACTS
    >
  );
  return map;
}

/**
 * Whether `scope`, or a scope that encloses it, binds `name`. A free symbol
 * that no scope binds is an input of the compiled expression.
 */
export function fragmentScopeBinds<R>(
  scope: FragmentScope<R> | undefined,
  name: string
): boolean {
  // The root scope holds the inputs that the pass has met, which are not
  // bound by a form of the expression.
  for (let s = scope; s?.parent !== undefined; s = s.parent)
    if (s.bindings.has(name)) return true;
  return false;
}

function makeWalker<R>(
  definition: FragmentDefinition<R>,
  state: PassState<R>
): FragmentWalker<R> {
  const fragment = definition.name;
  /** The key of the function being typed, set while its body is typed. */
  let currentFunction: string | undefined;
  /** The names `s` of the statements `s = s + e` of the body being typed,
   *  as the program wrote it, or `undefined` when not known. */
  let currentSumAssigned = definition.sumAssigned;

  const refuse = (
    node: Expression,
    reason: FragmentRefusalReason,
    message: string,
    binding?: string
  ): never => {
    const fn = currentFunction;
    const name = fn === undefined ? undefined : fn.split('#')[0];
    throw new RefusalSignal({
      node,
      reason,
      message:
        name === undefined
          ? message
          : `${message} (in the body of the user function \`${name}\`)`,
      operator: isFunction(node) ? node.operator : undefined,
      binding: binding ?? (isSymbol(node) ? node.symbol : undefined),
      function: fn,
    });
  };

  const valueFacts = (
    node: Expression,
    type: FragmentValueType | FragmentListType,
    conversions?: readonly FragmentConversion<R>[]
  ): FragmentValueFacts<R> => {
    const representation = definition.representationOfValue(type);
    if (representation === undefined)
      return refuse(
        node,
        type.kind === 'list' ? 'limit' : 'signature',
        `The value of \`${node.toString()}\` has the type ` +
          `\`${fragmentTypeToString(type)}\`, which the ${fragment} target ` +
          `cannot hold` +
          (type.kind === 'list'
            ? ' (a list needs a static count of at most the array limit)'
            : '')
      );
    return conversions === undefined || conversions.length === 0
      ? { type, representation }
      : { type, representation, conversions };
  };

  const convert = (
    facts: FragmentValueFacts<R>,
    type: FragmentValueType | FragmentListType
  ): FragmentConversion<R> | undefined => {
    const from = facts.type;
    const target = definition.representationOfValue(type);
    if (target === undefined) return undefined;
    if (sameType(from, type))
      return { kind: 'none', type, representation: facts.representation };
    if (from.kind === 'integer' && type.kind === 'real')
      return facts.representation === target
        ? { kind: 'none', type, representation: target }
        : { kind: 'to-float', type, representation: target };
    if (isScalarNumeric(from) && type.kind === 'complex')
      return { kind: 'real-to-complex', type, representation: target };
    return undefined;
  };

  /** The type that a parameter with no type in the fragment takes from
   *  an argument of the type `t` (the spec, decisions 11 and 18), or
   *  `undefined` when it takes none. An integer gives a real, as a local of
   *  a function body is: the parameter holds a value of the arithmetic of
   *  the body. For a parameter whose type is a collection (`collection`,
   *  `FragmentFunction.collectionParameters`), a list of 2 to 4 numbers
   *  that the target holds as it holds a point (a GLSL `vec2` to `vec4`)
   *  gives that list type: the parameter `a` of `d(a, b) = a[1] b[1] +
   *  a[2] b[2]` called with `[x, y]` is a `list<real, 2>`, a `vec2`. The
   *  body reads it as a list, as the interpreter does (`Abs(a)` is the
   *  list of the absolute values, not the norm of a point). Another list
   *  gives no type: a list parameter is admitted only bound to a list
   *  input, which the variant of the function reads by name. A list
   *  argument of a parameter that is not a collection gives no type either:
   *  the interpreter applies the function to each element (`f([x, y])` is
   *  `[f(x), f(y)]`). */
  const parameterTypeOf = (
    t: FragmentValueType | FragmentListType,
    collection: boolean
  ): FragmentValueType | FragmentListType | undefined => {
    if (t.kind !== 'list') return localType(t);
    if (!collection) return undefined;
    if (!isScalarNumeric(t.element) || t.count === undefined) return undefined;
    const representation = definition.representationOfValue(t);
    return representation !== undefined &&
      representation ===
        definition.representationOfValue({ kind: 'point', size: t.count })
      ? { kind: 'list', element: { kind: 'real' }, count: t.count }
      : undefined;
  };

  const join = (
    a: FragmentValueType | FragmentListType,
    b: FragmentValueType | FragmentListType
  ): FragmentValueType | FragmentListType | undefined => {
    if (sameType(a, b)) return a;
    if (isScalarNumeric(a) && isScalarNumeric(b)) return { kind: 'real' };
    // A real branch beside a complex one is read as a complex number.
    if (
      (a.kind === 'complex' && isScalarNumeric(b)) ||
      (b.kind === 'complex' && isScalarNumeric(a))
    )
      return { kind: 'complex' };
    return undefined;
  };

  const roleOf = (
    scope: FragmentScope<R>,
    name: string
  ): FragmentBindingRole | undefined => state.roles.get(scope)?.get(name);

  /** The binding of `name` in the chain of `scope`. A name collected in a
   *  block and not yet declared is refused, also when an outer scope binds
   *  the same name: the lookup stops at the block. */
  const lookup = (
    node: Expression,
    scope: FragmentScope<R>,
    name: string
  ):
    | {
        facts: FragmentFacts<R>;
        role: FragmentBindingRole;
        scope: FragmentScope<R>;
      }
    | undefined => {
    for (let s: FragmentScope<R> | undefined = scope; s; s = s.parent) {
      if (state.pending.get(s)?.has(name))
        return refuse(
          node,
          'place',
          `The local \`${name}\` is read before its declaration`,
          name
        );
      const facts = s.bindings.get(name);
      if (facts !== undefined)
        return { facts, role: roleOf(s, name) ?? 'input', scope: s };
    }
    return undefined;
  };

  const bind = (
    node: Expression,
    scope: FragmentScope<R>,
    name: string,
    type: FragmentValueType | FragmentListType,
    role: FragmentBindingRole,
    declared?: string
  ): FragmentValueFacts<R> => {
    const representation = definition.representationOfBinding(type, {
      role,
      symbol: node,
      declared,
    });
    if (representation === undefined) {
      const limit = definition.bindingLimit?.(type, { role, symbol: node });
      return refuse(
        node,
        type.kind === 'list' || limit !== undefined ? 'limit' : 'signature',
        limit ??
          `The ${role === 'input' ? 'input' : role} \`${name}\` has the type ` +
            `\`${fragmentTypeToString(type)}\`, which the ${fragment} target ` +
            `cannot hold as ${role === 'input' ? 'an input' : `a ${role}`}`,
        name
      );
    }
    const facts: FragmentValueFacts<R> = { type, representation };
    scope.bindings.set(name, facts);
    let roles = state.roles.get(scope);
    if (roles === undefined) state.roles.set(scope, (roles = new Map()));
    roles.set(name, role);
    state.pending.get(scope)?.delete(name);
    return facts;
  };

  const collect = (scope: FragmentScope<R>, names: readonly string[]) => {
    let pending = state.pending.get(scope);
    if (pending === undefined) state.pending.set(scope, (pending = new Set()));
    for (const n of names) pending.add(n);
  };

  const open = (node: Expression, scope: FragmentScope<R>) => {
    const inner = newScope<R>(scope);
    scope.inner.set(node, inner);
    return inner;
  };

  /** The binding that a statement of the current function can write: a
   *  name bound in a scope of the function, not in the root scope. */
  const binding = (scope: FragmentScope<R>, name: string) => {
    for (let s: FragmentScope<R> | undefined = scope; s; s = s.parent) {
      if (s === state.root) return undefined;
      const facts = s.bindings.get(name);
      if (facts !== undefined)
        return { facts, role: roleOf(s, name) ?? 'input', scope: s };
      if (state.functionScopes.has(s)) return undefined;
    }
    return undefined;
  };

  /** Check the facts of a node against the place of its use. */
  const checkPlace = (
    node: Expression,
    facts: FragmentFacts<R>,
    context: FragmentContext<R>
  ): void => {
    const kind = facts.type.kind;
    if (kind === 'range') {
      if (context.place !== 'index-set')
        refuse(
          node,
          'place',
          `A \`Range\` is in the ${fragment} fragment only as the index set ` +
            `of a \`Sum\`, a \`Product\` or an \`At\`, not as a value`
        );
      return;
    }
    if (kind === 'statement' || kind === 'function') {
      if (context.place !== 'statement')
        refuse(
          node,
          'place',
          `\`${node.toString()}\` is a statement, and it stands where a ` +
            `value is expected`
        );
      return;
    }
    // A list that the target holds only where it is bound (a list input in
    // a texture) can be read only by an `At`. The test reads the
    // representation of the binding: a list in a texture of 100 elements
    // has the type of a list that a computed value can hold, and it is
    // still not a value.
    if (
      kind === 'list' &&
      context.place !== 'at-base' &&
      isValueFacts(facts) &&
      facts.representation !==
        definition.representationOfValue(facts.type as FragmentListType)
    )
      refuse(
        node,
        'place',
        `The list \`${node.toString()}\` is in the ${fragment} fragment ` +
          `only as the base of an \`At\``
      );
  };

  const walker: FragmentWalker<R> = {
    definition,
    constant: (node, scope) =>
      readsBoundName(node, scope)
        ? undefined
        : definition.constantValue?.(node),
    refuse,
    sumAssigned: (name) => currentSumAssigned?.has(name),
    valueFacts,
    convert,
    join,
    open,
    bind: (node, scope, name, type, role) =>
      bind(node, scope, name, type, role),
    collect,
    binding,
    signatures: (node, scope, context, signatures) =>
      signatureFacts(node, scope, context, signatures),

    type(node, scope, context) {
      let facts = scope.facts.get(node);
      if (facts === undefined) {
        facts = computeFacts(node, scope, context);
        // A statement is checked against its loop at each use, so its facts
        // are not kept: a `Break` is valid in one loop and not outside it.
        // The statement is recorded as checked.
        if (facts.type.kind !== 'statement') scope.facts.set(node, facts);
        else scope.statements.add(node);
      }
      checkPlace(node, facts, context);
      return facts;
    },

    value(node, scope, context) {
      const facts = walker.type(node, scope, { ...context, place: 'value' });
      if (!isValueFacts(facts))
        return refuse(
          node,
          'place',
          `\`${node.toString()}\` has no value, and it stands where a value ` +
            `is expected`
        );
      return facts;
    },

    index(node, scope, context) {
      return indexConversion(node, walker.value(node, scope, context));
    },
  };

  /** The conversion that reads the value `facts` of `node` as an index. */
  const indexConversion = (
    node: Expression,
    facts: FragmentValueFacts<R>
  ): FragmentConversion<R> => {
    if (!isScalarNumeric(facts.type))
      return refuse(
        node,
        'signature',
        `An index or a bound must be an integer or a real, and ` +
          `\`${node.toString()}\` has the type ` +
          `\`${fragmentTypeToString(facts.type)}\``
      );
    const integer: FragmentValueType = { kind: 'integer' };
    // The representation of a loop counter. The operand is not the name of
    // the counter, so the target does not check it as a name: an input
    // with a reserved name that the `vars` option maps is a valid bound.
    const representation =
      definition.representationOfBinding(integer, { role: 'index' }) ??
      facts.representation;
    return representation === facts.representation
      ? { kind: 'none', type: integer, representation }
      : { kind: 'to-int', type: integer, representation };
  };

  const computeFacts = (
    node: Expression,
    scope: FragmentScope<R>,
    context: FragmentContext<R>
  ): FragmentFacts<R> => {
    if (isNumber(node)) return valueFacts(node, numberType(node));
    if (isString(node))
      return refuse(
        node,
        'head',
        `A string is outside the ${fragment} fragment: the target has no ` +
          `text type`
      );
    if (isSymbol(node)) return symbolFacts(node, scope);
    if (!isFunction(node))
      return refuse(
        node,
        'head',
        `\`${node.toString()}\` is outside the ${fragment} fragment`
      );

    // A subtree that the compiler folds to a constant has the type of its
    // value. A subtree that reads a name that a form binds (a local, a
    // parameter, an index) is not folded: the fold would read the engine
    // symbol of the same name (a local `i` would be the imaginary unit).
    const folded = readsBoundName(node, scope)
      ? undefined
      : definition.constantValue?.(node);
    if (folded !== undefined && !folded.isSame(node)) {
      const facts = walker.type(folded, scope, context);
      return facts;
    }

    const fn = definition.functionOf(node, scope);
    if (fn !== undefined) return callFacts(node, scope, context, fn);

    const rule = definition.rules[node.operator];
    if (rule === undefined)
      return refuse(
        node,
        'head',
        `The head \`${node.operator}\` is outside the ${fragment} fragment`
      );
    if ('walk' in rule) return rule.walk(node, scope, context, walker);
    return signatureFacts(node, scope, context, rule.signatures);
  };

  /** The names of the symbols of each node, computed once per node. */
  const namesOf = new Map<Expression, ReadonlySet<string>>();
  const symbolNames = (node: Expression): ReadonlySet<string> => {
    const known = namesOf.get(node);
    if (known !== undefined) return known;
    const set = new Set<string>();
    if (isSymbol(node)) set.add(node.symbol);
    else
      for (const op of opsOf(node)) for (const n of symbolNames(op)) set.add(n);
    namesOf.set(node, set);
    return set;
  };
  /** Whether `node` reads a name that a scope below the root binds. */
  const readsBoundName = (
    node: Expression,
    scope: FragmentScope<R>
  ): boolean => {
    if (scope === state.root) return false;
    for (const name of symbolNames(node))
      if (
        fragmentScopeBinds(scope, name) ||
        state.pending.get(scope)?.has(name)
      )
        return true;
    return false;
  };

  const numberType = (node: Expression): FragmentValueType => {
    const t = node.type.type;
    if (isSubtype(t, 'integer')) return { kind: 'integer' };
    if (isSubtype(t, 'real')) return { kind: 'real' };
    // A complex literal: `2 + 3i`, `ComplexInfinity`.
    if (node.im !== 0 && Number.isFinite(node.im)) return { kind: 'complex' };
    return { kind: 'real' };
  };

  /** A name that the stored value `value` reads, directly or through the
   *  stored value of another symbol, and that a form binds in `scope` or a
   *  scope around it, below the root scope. `undefined` when there is none. */
  const capturedName = (
    value: Expression,
    scope: FragmentScope<R>
  ): string | undefined => {
    if (scope === state.root) return undefined;
    const seen = new Set<Expression>();
    const visit = (n: Expression): string | undefined => {
      if (seen.has(n)) return undefined;
      seen.add(n);
      if (isSymbol(n)) {
        if (fragmentScopeBinds(scope, n.symbol)) return n.symbol;
        const v = definition.storedValue?.(n);
        return v === undefined ? undefined : visit(v);
      }
      for (const op of opsOf(n)) {
        const found = visit(op);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return visit(value);
  };

  const symbolFacts = (
    node: Expression & { symbol: string },
    scope: FragmentScope<R>
  ): FragmentFacts<R> => {
    const name = node.symbol;
    if (name === 'True' || name === 'False')
      return valueFacts(node, { kind: 'boolean' });
    const found = lookup(node, scope, name);
    if (found !== undefined) return found.facts;
    // A name that the caller declares: the declaration hides an engine
    // symbol of the same name, and the type comes from its spelling.
    const declared = state.declared.get(name);
    if (declared !== undefined) {
      if (declared.type === undefined)
        return refuse(
          node,
          'symbol',
          `The name \`${name}\` is declared \`${declared.declared}\`, which has ` +
            `no type in the ${fragment} fragment: declare it with a scalar, ` +
            `boolean or 2 to 4 component vector type`,
          name
        );
      return bind(
        node,
        state.root,
        name,
        declared.type,
        'input',
        declared.declared
      );
    }
    // A free symbol with a stored value: the compiler writes the value in
    // place of the symbol, so the value is typed, in the root scope, where
    // its free names are read. A value that reads its own symbol, directly
    // or through another value, is refused, as the compiler refuses it.
    const stored = definition.storedValue?.(node);
    if (stored !== undefined) {
      if (state.storing.has(name))
        return refuse(
          node,
          'limit',
          `The value of \`${name}\` refers to \`${name}\``,
          name
        );
      // A name of the value, or of a value that it reads, that a form binds
      // where the symbol is read (an index, a local or a parameter) would
      // read the binder. The compiler refuses it (`foldCapturedName()`).
      const captured = capturedName(stored, scope);
      if (captured !== undefined)
        return refuse(
          node,
          'limit',
          // The diagnostic adds the final period.
          foldCaptureRefusal(name, captured).replace(/\.$/, ''),
          name
        );
      state.storing.add(name);
      try {
        return walker.value(stored, state.root, { place: 'value' });
      } finally {
        state.storing.delete(name);
      }
    }
    // A free symbol: an input of the expression, or a constant. It is typed
    // once, and kept in the root scope.
    const type = (definition.typeOfInput ?? definition.typeOfSymbol)(node);
    if (type === undefined)
      return refuse(
        node,
        'symbol',
        `The symbol \`${name}\` has the type \`${node.type.toString()}\`, ` +
          `which has no type in the ${fragment} fragment: declare a numeric ` +
          `type for \`${name}\``,
        name
      );
    return bind(node, state.root, name, type, 'input');
  };

  //
  // Signatures
  //

  type Operand =
    | { kind: 'value'; facts: FragmentValueFacts<R>; node: Expression }
    | { kind: 'string'; node: Expression };

  const signatureFacts = (
    node: Expression,
    scope: FragmentScope<R>,
    context: FragmentContext<R>,
    signatures: readonly FragmentSignature[]
  ): FragmentFacts<R> => {
    // The operands, from left to right, in the current scope. A string
    // literal is not typed: it can match a `name` or a `color` place only.
    const operands: Operand[] = opsOf(node).map((op) =>
      isString(op)
        ? { kind: 'string', node: op }
        : { kind: 'value', facts: walker.value(op, scope, context), node: op }
    );
    for (const signature of signatures) {
      if (signature.when !== undefined && !signature.when(node, scope))
        continue;
      const match = matchSignature(node, operands, signature);
      if (match !== undefined) return match;
    }
    return refuse(
      node,
      'signature',
      `No signature of \`${node.operator}\` in the ${fragment} fragment takes ` +
        `operands of the types (${operands
          .map((o) =>
            o.kind === 'string' ? 'string' : fragmentTypeToString(o.facts.type)
          )
          .join(', ')})`
    );
  };

  const matchSignature = (
    node: Expression,
    operands: readonly Operand[],
    signature: FragmentSignature
  ): FragmentValueFacts<R> | undefined => {
    const fixed = signature.operands.length;
    if (operands.length < fixed) return undefined;
    if (operands.length > fixed && signature.rest === undefined)
      return undefined;
    const patterns = operands.map((_, i) =>
      i < fixed ? signature.operands[i] : signature.rest!
    );
    const usesPoint =
      patterns.includes('point') ||
      patterns.includes('tuple') ||
      signature.result === 'point';
    const sizes = usesPoint ? (signature.sizes ?? [2, 3, 4]) : [0];
    for (const size of sizes) {
      const conversions: FragmentConversion<R>[] = [];
      // The kinds of the vector operands: a point and a list do not mix in
      // a componentwise operation (`(x, 1) * [1, 2]` is a list of points in
      // the interpreter).
      const vectorKinds = new Set<'point' | 'list'>();
      let ok = true;
      for (let i = 0; i < operands.length && ok; i++) {
        const c = matchOperand(
          node,
          operands[i],
          patterns[i],
          size,
          signature,
          i
        );
        if (c === undefined) ok = false;
        else {
          conversions.push(c.conversion);
          if (c.vector !== undefined) vectorKinds.add(c.vector);
        }
      }
      if (!ok || (signature.broadcast === true && vectorKinds.size > 1))
        continue;
      if (
        signature.pointScalarSlots !== undefined &&
        vectorKinds.has('point') &&
        conversions.some(
          (c, i) =>
            c.kind === 'broadcast' && !signature.pointScalarSlots!.includes(i)
        )
      )
        continue;
      if (
        usesPoint &&
        (patterns.includes('point') || patterns.includes('tuple')) &&
        vectorKinds.size === 0 &&
        !patterns.includes('tuple')
      )
        continue;
      let result: FragmentValueType | FragmentListType = resultType(
        node,
        signature.result,
        size
      );
      // An operation on lists of reals gives a list of reals.
      if (result.kind === 'point' && vectorKinds.has('list'))
        result = { kind: 'list', element: { kind: 'real' }, count: size };
      return valueFacts(node, result, conversions);
    }
    return undefined;
  };

  const matchOperand = (
    node: Expression,
    operand: Operand,
    pattern: FragmentPattern,
    size: number,
    signature: FragmentSignature,
    position: number
  ):
    | { conversion: FragmentConversion<R>; vector?: 'point' | 'list' }
    | undefined => {
    if (operand.kind === 'string') {
      // A string literal names a colour or an option at compile time. It
      // is not a value at run time, so it has no representation of its own:
      // the conversion records the representation of a colour.
      if (pattern !== 'name' && pattern !== 'color') return undefined;
      const text = (operand.node as Expression & { string: string }).string;
      if (
        definition.literal?.(
          pattern,
          text,
          isFunction(node) ? node.operator : ''
        ) === false
      )
        return undefined;
      const type: FragmentValueType = { kind: 'color' };
      const representation = definition.representationOfValue(type);
      if (representation === undefined) return undefined;
      return { conversion: { kind: 'none', type, representation } };
    }
    const facts = operand.facts;
    const t = facts.type;
    const none = (): {
      conversion: FragmentConversion<R>;
      vector?: 'point' | 'list';
    } => ({
      conversion: {
        kind: 'none',
        type: t,
        representation: facts.representation,
      },
      vector:
        t.kind === 'point' ? 'point' : t.kind === 'list' ? 'list' : undefined,
    });
    switch (pattern) {
      case 'real': {
        const c = convert(facts, { kind: 'real' });
        return c === undefined ? undefined : { conversion: c };
      }
      case 'integer':
        return t.kind === 'integer' ? none() : undefined;
      case 'index': {
        if (!isScalarNumeric(t)) return undefined;
        // The operand is already typed in the scope of the node: the
        // conversion is read from its facts.
        return { conversion: indexConversion(operand.node, facts) };
      }
      case 'boolean':
        return t.kind === 'boolean' ? none() : undefined;
      case 'complex': {
        const c = convert(facts, { kind: 'complex' });
        return c === undefined ? undefined : { conversion: c };
      }
      case 'color': {
        if (t.kind === 'color') return none();
        // A literal `Tuple` of three real components is an sRGB colour, as
        // the interpreter and the colour emitter read it. A point input or
        // a computed point is not a colour.
        if (
          !isFunction(operand.node, 'Tuple') ||
          t.kind !== 'point' ||
          t.size !== 3
        )
          return undefined;
        const color: FragmentValueType = { kind: 'color' };
        const representation = definition.representationOfValue(color);
        if (
          representation === undefined ||
          representation !== facts.representation
        )
          return undefined;
        return { conversion: { kind: 'none', type: color, representation } };
      }
      case 'name':
        return undefined;
      case 'point': {
        const point: FragmentValueType = { kind: 'point', size };
        const representation = definition.representationOfValue(point);
        if (representation === undefined) return undefined;
        if (t.kind === 'point' && t.size === size) return none();
        // A list of reals of the size, held as the point is held (a list
        // input held as an array has no arithmetic).
        if (
          t.kind === 'list' &&
          isScalarNumeric(t.element) &&
          t.count === size &&
          facts.representation === representation
        )
          return none();
        if (
          signature.broadcast === true &&
          isScalarNumeric(t) &&
          (signature.scalarSlots === undefined ||
            signature.scalarSlots.includes(position))
        )
          return {
            conversion: { kind: 'broadcast', type: point, representation },
          };
        return undefined;
      }
      case 'real-list':
        return t.kind === 'list' && isScalarNumeric(t.element)
          ? none()
          : undefined;
      case 'real-or-list': {
        if (t.kind === 'list')
          return isScalarNumeric(t.element) ? none() : undefined;
        const c = convert(facts, { kind: 'real' });
        return c === undefined ? undefined : { conversion: c };
      }
      case 'tuple':
        return t.kind === 'point' && t.size === size ? none() : undefined;
    }
  };

  const resultType = (
    node: Expression,
    pattern: FragmentResultPattern,
    size: number
  ): FragmentValueType => {
    if (typeof pattern !== 'string') return pattern;
    if (pattern === 'point') return { kind: 'point', size };
    if (pattern === 'real') {
      // `Floor(x)` has the engine type `integer`: an integer is a type of
      // the fragment, read from the engine type of the node.
      const t = node.type.type;
      if (t !== 'unknown' && t !== 'any' && isSubtype(t, 'integer'))
        return { kind: 'integer' };
      return { kind: 'real' };
    }
    return { kind: pattern };
  };

  //
  // Calls of user functions
  //

  const callFacts = (
    node: Expression,
    scope: FragmentScope<R>,
    context: FragmentContext<R>,
    fn: FragmentFunction
  ): FragmentFacts<R> => {
    // The arguments, in the scope of the call.
    const args = fn.arguments.map((a) => walker.value(a, scope, context));
    if (args.length !== fn.parameters.length)
      return refuse(
        node,
        'signature',
        `Could not compile a call of \`${fn.name}\`: the function is ` +
          `declared with ${fn.parameters.length} parameter` +
          `${fn.parameters.length === 1 ? '' : 's'} but called with ` +
          `${args.length}. ` +
          (args.length < fn.parameters.length
            ? `The interpreter reads a call with fewer arguments than ` +
              `parameters as a partial application, whose value is a ` +
              `function, which the ${fragment} fragment does not have`
            : `The interpreter reports an error for a call with more ` +
              `arguments than parameters`)
      );
    // A function that the interpreter applies to each element of a list
    // argument (`FragmentFunction.broadcasts`), called with a list of 2 to
    // 4 reals that the target holds as a point (a GLSL `vec2` to `vec4`):
    // the value of the call is the list of the values of the function at
    // the elements (the spec, decision 19). `f(u) := u mod 1` and
    // `f([-x, -y])` give `[f(-x), f(-y)]`. The function is typed with the
    // type of an element at such a parameter, and the emitter writes the
    // call with a wrapper that calls the function on each component. A
    // point argument is not mapped: the interpreter maps a tuple only when
    // the signature of the function is declared.
    const mapped = args.map(
      (a) =>
        fn.broadcasts === true &&
        a.type.kind === 'list' &&
        isScalarNumeric(a.type.element) &&
        a.type.count !== undefined &&
        a.type.count >= 2 &&
        a.representation ===
          definition.representationOfValue({
            kind: 'point',
            size: a.type.count,
          })
    );
    const unmapped = args.findIndex(
      (a, i) =>
        fn.broadcasts === true &&
        !mapped[i] &&
        a.type.kind === 'list' &&
        isScalarNumeric(a.type.element)
    );
    if (unmapped >= 0)
      return refuse(
        fn.arguments[unmapped],
        'signature',
        `The call \`${node.toString()}\` applies \`${fn.name}\` to each ` +
          `element of \`${fn.arguments[unmapped].toString()}\`, of the type ` +
          `\`${fragmentTypeToString(args[unmapped].type)}\`: the ${fragment} ` +
          `code maps a list of 2 to 4 reals only`
      );
    const widths = new Set(
      args.flatMap((a, i) =>
        mapped[i] && a.type.kind === 'list' ? [a.type.count] : []
      )
    );
    if (widths.size > 1)
      return refuse(
        node,
        'signature',
        `The call \`${node.toString()}\` applies \`${fn.name}\` to each ` +
          `element of lists of different lengths`
      );
    const elementArgs = args.map((a, i) => {
      if (!mapped[i] || a.type.kind !== 'list') return a;
      const element = a.type.element as FragmentValueType;
      const representation = definition.representationOfValue(element);
      return representation === undefined
        ? a
        : { type: element, representation };
    });
    let entry = state.functions.get(fn.key);
    if (entry === undefined) {
      if (state.typing.has(fn.key))
        return refuse(
          node,
          'limit',
          `The function \`${fn.name}\` calls itself, directly or through ` +
            `another function: the ${fragment} fragment has no recursion`
        );
      entry = typeFunction(node, fn, elementArgs);
    }
    const type = entry.type as Extract<FragmentType, { kind: 'function' }>;
    const inferred = state.inferred.get(fn.key);
    const conversions = elementArgs.map((a, i) => {
      // A parameter with no declared type has the type of its argument at
      // the first call. A later call with an argument of another type is
      // refused (the spec, decision 11): the function is emitted once, with
      // that parameter type. An integer and a real are one type here.
      const fromArgument =
        inferred?.[i] === true
          ? parameterTypeOf(a.type, fn.collectionParameters?.[i] === true)
          : undefined;
      if (
        inferred?.[i] === true &&
        (fromArgument === undefined ||
          !sameType(fromArgument, type.parameters[i].type))
      )
        return refuse(
          fn.arguments[i],
          'signature',
          `The parameter \`${fn.parameters[i]}\` of \`${fn.name}\` has no ` +
            `declared type in the ${fragment} fragment, and it has the type ` +
            `\`${fragmentTypeToString(type.parameters[i].type)}\` of its ` +
            `argument at the first call; the argument ` +
            `\`${fn.arguments[i].toString()}\` has the type ` +
            `\`${fragmentTypeToString(a.type)}\`. Declare the type of the ` +
            `parameter, or call the function with arguments of one type`,
          fn.parameters[i]
        );
      // A list mapped over a scalar parameter is passed whole to the
      // element-wise wrapper, which converts no element: the parameter must
      // be a real or an integer one, both a GLSL `float`, as the wrapper
      // requires (`elementwiseCall()` in `gpu-shader-target.ts`).
      const whole = args[i];
      const parameterType = type.parameters[i].type;
      if (mapped[i]) {
        if (
          !isScalarNumeric(parameterType) ||
          convert(a, parameterType) === undefined
        )
          return refuse(
            fn.arguments[i],
            'signature',
            `The call \`${node.toString()}\` applies \`${fn.name}\` to each ` +
              `element of \`${fn.arguments[i].toString()}\`, and the ` +
              `parameter \`${fn.parameters[i]}\` has the type ` +
              `\`${fragmentTypeToString(parameterType)}\`, not \`real\``
          );
        return {
          kind: 'none' as const,
          type: whole.type,
          representation: whole.representation,
        };
      }
      // A list argument of a list parameter is passed as it is: an
      // integer list has the representation of a real list of its length.
      const c =
        a.type.kind === 'list' && fromArgument !== undefined
          ? {
              kind: 'none' as const,
              type: fromArgument,
              representation: a.representation,
            }
          : a.type.kind === 'list' &&
              parameterType.kind === 'list' &&
              definition.passesListArgument?.(a.type, parameterType) === true
            ? {
                kind: 'none' as const,
                type: parameterType,
                representation: a.representation,
              }
            : convert(a, parameterType);
      if (c === undefined)
        return refuse(
          fn.arguments[i],
          'signature',
          `The argument \`${fn.arguments[i].toString()}\` of \`${fn.name}\` ` +
            `has the type \`${fragmentTypeToString(a.type)}\`, and the ` +
            `parameter \`${fn.parameters[i]}\` has the type ` +
            `\`${fragmentTypeToString(type.parameters[i].type)}\``
        );
      return c;
    });
    // A function whose declared result its body contradicts
    // (`contradictedDeclaredResult()`: `a: (number) -> number`,
    // `a := t ↦ h(t)`, `h := t ↦ [cos t, sin t]`) is refused: the compiler
    // declines its definition.
    if (contradictedDeclaredResult(node.engine, fn.name) !== undefined)
      return refuse(
        node,
        'signature',
        `The body of the function \`${fn.name}\` contradicts its declared ` +
          `result type`
      );
    // A call whose engine type admits a point and another shape
    // (`isRuntimePointShaped()`: `Q: (real) -> list<tuple<number, number>>
    // | tuple<number, number>`) has no settled shape: the compiler reads
    // the call by that type, not by the type of the body, and declines it
    // where a point is read (`Norm(Q(x))`).
    const result = type.result;
    if (isRuntimePointShaped(node))
      return refuse(
        node,
        'signature',
        `The call \`${node.toString()}\` has the type ` +
          `\`${node.type.toString()}\`, which admits more than one shape`
      );
    // A call applied to each element of lists of the length `n` is a list
    // of `n` reals. The wrapper builds a `vecN` of the values of the
    // function, so the function must have a real value. The wrapper passes
    // each other argument unchanged, and a complex or colour parameter
    // converts its argument at the call, so the emitter declines a wrapper
    // of a function with such a parameter.
    const [width] = widths;
    if (width !== undefined) {
      const converting = type.parameters.findIndex(
        (p) => p.type.kind === 'complex' || p.type.kind === 'color'
      );
      if (converting >= 0)
        return refuse(
          node,
          'signature',
          `The call \`${node.toString()}\` applies \`${fn.name}\` to each ` +
            `element of a list, and the parameter ` +
            `\`${fn.parameters[converting]}\` has the type ` +
            `\`${fragmentTypeToString(type.parameters[converting].type)}\`: ` +
            `the element-wise call has no complex or colour parameter`
        );
      if (!isScalarNumeric(result))
        return refuse(
          node,
          'signature',
          `The call \`${node.toString()}\` applies \`${fn.name}\` to each ` +
            `element of a list, and the value of \`${fn.name}\` has the ` +
            `type \`${fragmentTypeToString(result)}\`, not \`real\``
        );
      return valueFacts(
        node,
        { kind: 'list', element: { kind: 'real' }, count: width },
        conversions
      );
    }
    // A call whose value is a list here, and whose engine type is not a
    // list, is refused: the emitter writes the operator that reads the call
    // by the engine type. `g(p) := p[1] + p[2] + |p|` called with `[x, y]`
    // is a `vec2` (the interpreter maps `Abs` over the list), but the engine
    // type of the call is `number | vector<real^2>`, and the emitter then
    // writes `Sin(g([x, y]))` with the `float` helper of `Sin`.
    if (result.kind === 'list' && !isSubtype(node.type.type, 'list<any>'))
      return refuse(
        node,
        'signature',
        `The call \`${node.toString()}\` has a list value, and its type ` +
          `\`${node.type.toString()}\` is not a list type`
      );
    return valueFacts(node, result, conversions);
  };

  const typeFunction = (
    call: Expression,
    fn: FragmentFunction,
    args: readonly FragmentValueFacts<R>[]
  ): { body: Expression; scope: FragmentScope<R>; type: FragmentType } => {
    // The function is emitted at the top level, so its scope is a child of
    // the root scope, not of the scope of the call.
    const scope = newScope<R>(state.root);
    state.functionScopes.add(scope);
    const outer = currentFunction;
    const outerSumAssigned = currentSumAssigned;
    state.typing.add(fn.key);
    currentFunction = fn.key;
    currentSumAssigned = fn.sumAssigned;
    try {
      const inferred = fn.parameters.map(
        (_, i) => fn.parameterTypes[i] === undefined
      );
      state.inferred.set(fn.key, inferred);
      const parameters = fn.parameters.map((name, i) => {
        // A parameter with no type in the fragment takes the type of its
        // argument at this call, the first one (the spec, decisions 11 and
        // 18; `parameterTypeOf()`).
        const fromArgument = args[i]?.type;
        const type =
          fn.parameterTypes[i] ??
          (fromArgument === undefined
            ? undefined
            : parameterTypeOf(
                fromArgument,
                fn.collectionParameters?.[i] === true
              ));
        if (type === undefined)
          return refuse(
            call,
            'symbol',
            `The parameter \`${name}\` of \`${fn.name}\` has no type in the ` +
              `${fragment} fragment: declare a numeric type for it`,
            name
          );
        bind(fn.parameterSymbols?.[i] ?? call, scope, name, type, 'parameter');
        return { name, type };
      });
      const result = walker.value(fn.body, scope, {
        place: 'value',
        fn: fn.key,
      });
      const entry = {
        body: fn.body,
        sizeCheck: fn.sizeCheck,
        scope,
        type: {
          kind: 'function' as const,
          parameters,
          result: result.type,
        },
      };
      state.functions.set(fn.key, entry);
      return entry;
    } finally {
      state.typing.delete(fn.key);
      currentFunction = outer;
      currentSumAssigned = outerSumAssigned;
    }
  };

  return walker;
}

//
// The rules that walk, shared by the definitions
//

/** The names of the index and the bounds of one index of a `Sum`, a
 * `Product` or a `Loop`: `Limits(k, a, b)` or `Element(k, Range(a, b))`.
 * With `parallel`, also `Element(k, ParallelDomain(Range(a, b)))`, the
 * clause of a `parallel for` that `lowerParallelHeads()` lowered to a
 * `Loop`. */
function indexOf(
  spec: Expression,
  parallel = false
):
  | {
      name: string;
      symbol: Expression;
      lower: Expression;
      upper: Expression;
      step?: Expression;
    }
  | undefined {
  if (
    parallel &&
    isFunction(spec, 'Element') &&
    spec.nops === 2 &&
    isSymbol(spec.op1) &&
    isFunction(spec.op2, 'ParallelDomain') &&
    spec.op2.nops === 1
  ) {
    const domain = spec.op2.op1;
    if (isFunction(domain, 'Range') && (domain.nops === 2 || domain.nops === 3))
      return {
        name: spec.op1.symbol,
        symbol: spec.op1,
        lower: domain.op1,
        upper: domain.op2,
        step: domain.nops === 3 ? domain.op3 : undefined,
      };
    return undefined;
  }
  if (isFunction(spec, 'Limits') && spec.nops === 3 && isSymbol(spec.op1))
    return {
      name: spec.op1.symbol,
      symbol: spec.op1,
      lower: spec.op2,
      upper: spec.op3,
    };
  if (
    isFunction(spec, 'Element') &&
    isSymbol(spec.op1) &&
    isFunction(spec.op2, 'Range') &&
    (spec.op2.nops === 2 || spec.op2.nops === 3)
  )
    return {
      name: spec.op1.symbol,
      symbol: spec.op1,
      lower: spec.op2.op1,
      upper: spec.op2.op2,
      step: spec.op2.nops === 3 ? spec.op2.op3 : undefined,
    };
  return undefined;
}

/** The bounds (and the step) of one index, typed as indexes. A constant
 * bound must be finite and inside the range of the loop counter of the
 * target (`FragmentDefinition.counterRange`): the counter is written with
 * the bound as a literal, and `upper + 1` must not overflow it. */
function indexBounds<R>(
  node: Expression,
  index: { lower: Expression; upper: Expression; step?: Expression },
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentConversion<R>[] {
  // An aggregate that the target writes with no loop has no loop counter.
  const value = (b: Expression): number | undefined => {
    const v = isNumber(b)
      ? b
      : isFunction(b)
        ? w.constant(b, scope)
        : undefined;
    return isNumber(v) && Number.isFinite(v.re) ? v.re : undefined;
  };
  const lo = value(index.lower);
  const hi = value(index.upper);
  const range =
    lo !== undefined &&
    hi !== undefined &&
    (node.operator === 'Sum' || node.operator === 'Product') &&
    w.definition.aggregateHasNoLoop?.(node, lo, hi) === true
      ? undefined
      : w.definition.counterRange;
  const parts: [string, Expression][] = [
    ['lower', index.lower],
    ['upper', index.upper],
  ];
  if (index.step !== undefined) parts.push(['step', index.step]);
  return parts.map(([which, bound]) => {
    const conversion = w.index(bound, scope, context);
    // A bound that the compiler folds is checked with its value.
    const value = isNumber(bound)
      ? bound
      : isFunction(bound)
        ? w.constant(bound, scope)
        : undefined;
    if (isNumber(value)) {
      const v = value.re;
      if (!Number.isFinite(v))
        w.refuse(
          node,
          'limit',
          `The ${which} bound \`${bound.toString()}\` of \`${node.operator}\` ` +
            `is not a finite number`
        );
      if (
        range !== undefined &&
        which !== 'step' &&
        (v < range[0] || v > (which === 'upper' ? range[1] - 1 : range[1]))
      )
        w.refuse(
          node,
          'limit',
          `The ${which} bound ${v} of \`${node.operator}\` is outside the ` +
            `range of the loop counter of the ${w.definition.name} target`
        );
    }
    return conversion;
  });
}

/** `Sum` and `Product`: for each index in order, its bounds in a scope that
 * holds the indexes before it, then the index. Then the body. */
export function walkAggregate<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const ops = opsOf(node);
  if (ops.length < 2)
    return w.refuse(
      node,
      'signature',
      `\`${node.operator}\` is in the ${w.definition.name} fragment only ` +
        `over one or more integer index ranges`
    );
  const inner = w.open(node, scope);
  const conversions: FragmentConversion<R>[] = [];
  for (const spec of ops.slice(1)) {
    const index = indexOf(spec);
    if (index === undefined)
      return w.refuse(
        spec,
        'signature',
        `The index set \`${spec.toString()}\` of \`${node.operator}\` is not ` +
          `an integer range`
      );
    // The step of a `Range` index set is 1: an aggregate visits each
    // integer of its range.
    if (
      index.step !== undefined &&
      !(isNumber(index.step) && index.step.re === 1)
    )
      return w.refuse(
        spec,
        'signature',
        `The index set \`${spec.toString()}\` of \`${node.operator}\` has a ` +
          `step, and an aggregate of the ${w.definition.name} fragment visits ` +
          `each integer of its range`
      );
    conversions.push(...indexBounds(node, index, inner, context, w));
    w.bind(index.symbol, inner, index.name, { kind: 'integer' }, 'index');
  }
  // The body is an expression, not a loop: a `Break` in it has no loop to
  // leave.
  const body = w.value(ops[0], inner, { ...context, loop: undefined });
  const t = body.type;
  if (!(isScalarNumeric(t) || t.kind === 'complex'))
    return w.refuse(
      node,
      'signature',
      `The body of \`${node.operator}\` has the type ` +
        `\`${fragmentTypeToString(t)}\`, and an aggregate of the ` +
        `${w.definition.name} fragment adds or multiplies real or complex ` +
        `numbers`
    );
  return w.valueFacts(node, t, [
    ...conversions,
    { kind: 'none', type: t, representation: body.representation },
  ]);
}

/** A counted loop (`Loop` over `Element(k, Range(a, b))`) or a
 * `ParallelLoop`, in the body of a user function or at the root of the
 * expression, which takes the forms of a function body (the spec, decision
 * 13). A `Loop` over `Element(k, ParallelDomain(Range(a, b)))` is a
 * `ParallelLoop` that `lowerParallelHeads()` lowered: the compiler lowers
 * it before the pass, so that the pass types the tree that the emitter
 * writes, and it has the rules of a `ParallelLoop`. */
function walkLoop(kind: 'loop' | 'parallel') {
  return <R>(
    node: Expression,
    scope: FragmentScope<R>,
    context: FragmentContext<R>,
    w: FragmentWalker<R>
  ): FragmentFacts<R> => {
    const head = node.operator;
    const ops = opsOf(node);
    const loopKind =
      kind === 'loop' &&
      ops.length === 2 &&
      isFunction(ops[1], 'Element') &&
      isFunction(ops[1].op2, 'ParallelDomain')
        ? 'parallel'
        : kind;
    const index =
      ops.length === 2 ? indexOf(ops[1], loopKind === 'parallel') : undefined;
    if (index === undefined || !isFunction(ops[1], 'Element'))
      return w.refuse(
        node,
        'signature',
        `\`${head}\` is in the ${w.definition.name} fragment only as a ` +
          `counted loop over an integer range`
      );
    indexBounds(node, index, scope, context, w);
    // The emitter writes a bound that it cannot fold (a number, a symbol
    // with a finite value, a constant subtree) as an `int` read at run time,
    // and refuses such a bound when its static type is not `integer`
    // (the `Loop` lowering of `gpu-functions.ts`): a bound `n` of the type
    // `number` is refused there, so it is refused here too.
    for (const [which, bound] of [
      ['lower', index.lower],
      ['upper', index.upper],
    ] as const) {
      const folded =
        isNumber(bound) ||
        (isSymbol(bound) && Number.isFinite(bound.re)) ||
        (isFunction(bound) && isNumber(w.constant(bound, scope)));
      if (
        !folded &&
        !bound.type.matches('integer') &&
        w.definition.loopBoundFromFact?.(
          bound,
          (node) => w.value(node, scope, context).type.kind === 'integer'
        ) !== true
      )
        return w.refuse(
          node,
          'signature',
          `The ${which} bound \`${bound.toString()}\` of \`${head}\` is read ` +
            `at run time, and the ${w.definition.name} fragment admits such ` +
            `a bound only with the static type \`integer\` (it has the type ` +
            `\`${bound.type.toString()}\`)`
        );
    }
    const inner = w.open(node, scope);
    w.bind(index.symbol, inner, index.name, { kind: 'integer' }, 'index');
    // A guard (`Element(i, Range(1, 5), i > 2)`) skips the passes where it
    // is false: it is a boolean of the index.
    const guard =
      (ops[1] as Expression & { nops: number; op3: Expression }).nops === 3
        ? (ops[1] as Expression & { op3: Expression }).op3
        : undefined;
    if (guard !== undefined) {
      const g = w.value(guard, inner, { ...context, place: 'value' });
      if (g.type.kind !== 'boolean')
        return w.refuse(
          guard,
          'signature',
          `The guard of the index \`${index.name}\` has the type ` +
            `\`${fragmentTypeToString(g.type)}\`, not \`boolean\``
        );
    }
    w.type(ops[0], inner, {
      place: 'statement',
      fn: context.fn,
      loop: { kind: loopKind, scope: inner },
      parallel: loopKind === 'parallel' ? inner : context.parallel,
    });
    return { type: { kind: 'statement' } };
  };
}

/** `Break`: refused when no loop encloses it, and in a `ParallelLoop`,
 * whose passes are independent. */
export function walkBreak<R>(
  node: Expression,
  _scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  if (context.loop === undefined || context.loop.kind !== 'loop')
    return w.refuse(
      node,
      'place',
      context.loop === undefined
        ? `\`Break\` is in the ${w.definition.name} fragment only inside a ` +
            `counted loop of a function body`
        : `\`Break\` is not in the ${w.definition.name} fragment inside a ` +
            `parallel loop`
    );
  if (opsOf(node).length > 0)
    return w.refuse(
      node,
      'signature',
      `\`Break\` with a value is not in the ${w.definition.name} fragment`
    );
  return { type: { kind: 'statement' } };
}

/** The type of a declared or written local: an integer value gives a real
 * local, since a local of a function body is assigned values of the
 * arithmetic of its body (`let n = 0` and later `n = k / 2`). */
function localType(
  t: FragmentValueType | FragmentListType
): FragmentValueType | FragmentListType {
  return t.kind === 'integer' ? { kind: 'real' } : t;
}

/** The names that a `Declare` statement declares: one symbol, or a tuple of
 * symbols (a destructuring declaration). */
function declaredNames(statement: Expression): Expression[] | undefined {
  const target = opsOf(statement)[0];
  if (isSymbol(target)) return [target];
  if (isFunction(target, 'Tuple') && target.ops.every((t) => isSymbol(t)))
    return [...target.ops];
  return undefined;
}

/**
 * Whether the value of a destructuring declaration or assignment is one
 * that the code writes as a literal tuple: a literal tuple, or the call of
 * a user function (a head with no rule in the fragment), whose body the
 * compiler writes in place of the call. The code writes each name from its
 * component of the literal tuple. It does not read the components of
 * another value, such as a point local, a point input or a sum of points
 * (`destructureViaTemp()` does it on JavaScript only): `(a, b) ≔ (b, a + b)`
 * and `(v, j) ≔ step(j)` are in the fragment, `(a, b) ≔ p` is not.
 */
function isDestructurableValue<R>(
  value: Expression,
  w: FragmentWalker<R>
): boolean {
  if (isFunction(value, 'Tuple')) return true;
  return (
    isFunction(value) && !Object.hasOwn(w.definition.rules, value.operator)
  );
}

/** The reason to refuse a destructuring declaration or assignment whose
 * value is not one that the code writes as a literal tuple
 * (`isDestructurableValue()`). */
function nonLiteralTupleValue(
  kind: 'declaration' | 'assignment',
  value: Expression
): string {
  return (
    `The value of the destructuring ${kind}, \`${value.toString()}\`, ` +
    `is not a literal tuple`
  );
}

/** The component types of a value that a tuple of `n` names receives. */
function componentTypes<R>(
  facts: FragmentValueFacts<R>,
  n: number
): FragmentValueType[] | undefined {
  if (facts.type.kind === 'point' && facts.type.size === n)
    return Array.from({ length: n }, () => ({ kind: 'real' }));
  return undefined;
}

/** A `Declare` statement of a block, which `walkBlock` reads. `inferred`:
 * the type that the engine infers for a local of the block
 * (`FragmentDefinition.localType`). */
function walkDeclare<R>(
  statement: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>,
  inferred?: (name: string) => Type | undefined
): void {
  const names = declaredNames(statement);
  if (names === undefined)
    return void w.refuse(
      statement,
      'signature',
      `The declaration \`${statement.toString()}\` declares a pattern that ` +
        `is not a name or a tuple of names`
    );
  const value = declareValueOperand(opsOf(statement));
  const declared = declareTypeOperand(opsOf(statement));
  if (value === undefined) {
    // A declaration with no value: the type of the local is its declared
    // type, read from the engine type of the name.
    for (const name of names) {
      const t =
        declared === undefined ? undefined : w.definition.typeOfSymbol(name);
      if (t === undefined || t.kind === 'list')
        return void w.refuse(
          name,
          'symbol',
          `The local \`${name.toString()}\` has no value and no scalar, ` +
            `complex or point type`
        );
      w.bind(
        name,
        scope,
        (name as Expression & { symbol: string }).symbol,
        localType(t),
        'local'
      );
    }
    return;
  }
  const facts = w.value(value, scope, context);
  if (names.length === 1) {
    const name = names[0] as Expression & { symbol: string };
    let type: FragmentValueType | FragmentListType = localType(facts.type);
    if (declared !== undefined) {
      const t = w.definition.typeOfSymbol(name);
      if (t !== undefined && t.kind !== 'list') type = localType(t);
      // A declared scalar type with a value that is a point or a list
      // (`Declare(p, "number", (t, t^2, 1))`) gives the name two shapes.
      const source = declaredTypeSource(declared);
      if (
        source !== undefined &&
        /^(number|real|integer|rational|complex|finite_\w+|boolean)$/.test(
          source
        ) &&
        (facts.type.kind === 'point' || facts.type.kind === 'list')
      )
        return void w.refuse(
          statement,
          'signature',
          `The local \`${name.symbol}\` is declared \`${source}\`, and its ` +
            `value has the type \`${fragmentTypeToString(facts.type)}\``,
          name.symbol
        );
    }
    type =
      w.definition.localType?.({
        name: name.symbol,
        value: facts.type,
        declared:
          declared === undefined ? undefined : declaredTypeSource(declared),
        inferred: inferred?.(name.symbol),
      }) ?? type;
    if (type.kind === 'list')
      return void w.refuse(
        statement,
        'signature',
        `The local \`${name.symbol}\` is a list: a function body of the ` +
          `${w.definition.name} fragment has scalar, complex or point locals`,
        name.symbol
      );
    if (w.convert(facts, type as FragmentValueType) === undefined)
      return void w.refuse(
        statement,
        'signature',
        `The value of the local \`${name.symbol}\` has the type ` +
          `\`${fragmentTypeToString(facts.type)}\`, and the local is declared ` +
          `\`${fragmentTypeToString(type)}\``,
        name.symbol
      );
    w.bind(name, scope, name.symbol, type, 'local');
    return;
  }
  // A name that the pattern of a destructuring declaration has twice has
  // no single value.
  const symbolOf = (e: Expression): string =>
    (e as Expression & { symbol: string }).symbol;
  const repeated = names.find(
    (n, i) => names.findIndex((m) => symbolOf(m) === symbolOf(n)) !== i
  );
  if (repeated !== undefined)
    return void w.refuse(
      statement,
      'signature',
      `The destructuring declaration has the name ` +
        `\`${repeated.toString()}\` at more than one position`
    );
  if (!isDestructurableValue(value, w))
    return void w.refuse(
      statement,
      'signature',
      nonLiteralTupleValue('declaration', value)
    );
  const components = componentTypes(facts, names.length);
  if (components === undefined)
    return void w.refuse(
      statement,
      'signature',
      `The value of the destructuring declaration has the type ` +
        `\`${fragmentTypeToString(facts.type)}\`, which is not a point of ` +
        `${names.length} components`
    );
  names.forEach((name, i) =>
    w.bind(
      name,
      scope,
      (name as Expression & { symbol: string }).symbol,
      components[i],
      'local'
    )
  );
}

/** `Block`, in the body of a user function or at the root of the expression
 * (the spec, decision 13). First the names of the `Declare` statements, then
 * the statements in order. The value of the block is the value of its last
 * statement.
 *
 * An `Assign` statement of the block to a name that the scope of the block
 * binds, with no `Declare` of the name in the block and no binding of it in
 * an enclosing scope of the function, declares the name: the compiler
 * declares such a local (`withImplicitLocalDeclares()`), with the type of the
 * value of the first such assignment. */
export function walkBlock<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const inner = w.open(node, scope);
  const statements = opsOf(node);
  const names: string[] = [];
  for (const s of statements)
    if (isFunction(s, 'Declare'))
      for (const n of declaredNames(s) ?? [])
        names.push((n as Expression & { symbol: string }).symbol);
  const blockScope = node.localScope;
  const implicit = new Set<string>();
  for (const s of statements)
    if (
      isFunction(s, 'Assign') &&
      isSymbol(s.op1) &&
      blockScope?.bindings.has(s.op1.symbol) === true &&
      !names.includes(s.op1.symbol) &&
      w.binding(scope, s.op1.symbol) === undefined
    )
      implicit.add(s.op1.symbol);
  // An implicit local is collected too: a read of it before its first
  // assignment, also in the value of that assignment (`x ≔ x + 1`), reads
  // a local that has no value yet, and is refused.
  w.collect(inner, [...names, ...implicit]);
  if (names.length > 0)
    ENFORCED_LOCALS.set(
      inner as FragmentScope<unknown>,
      enforcedLocalTargets(statements)
    );
  let last: FragmentFacts<R> = { type: { kind: 'statement' } };
  statements.forEach((s, i) => {
    const place = i === statements.length - 1 ? context.place : 'statement';
    if (
      isFunction(s, 'Assign') &&
      isSymbol(s.op1) &&
      implicit.has(s.op1.symbol)
    ) {
      // The first assignment of an implicit local declares it.
      const name = s.op1.symbol;
      implicit.delete(name);
      const value = w.value(s.op2, inner, { ...context, place: 'value' });
      const type = localType(value.type);
      if (type.kind === 'list')
        return void w.refuse(
          s,
          'signature',
          `The local \`${name}\` is a list: a block of the ` +
            `${w.definition.name} fragment has scalar, complex or point locals`,
          name
        );
      w.bind(s.op1, inner, name, type, 'local');
      inner.statements.add(s);
      last = { type: { kind: 'statement' } };
      if (place !== 'statement')
        w.refuse(
          s,
          'place',
          `The block ends with an assignment, so it has no value`
        );
      return;
    }
    if (isFunction(s, 'Declare')) {
      walkDeclare(s, inner, { ...context, place: 'value' }, w, (name) => {
        const definition = blockScope?.bindings.get(name);
        return definition !== undefined && 'value' in definition
          ? definition.value.type.type
          : undefined;
      });
      inner.statements.add(s);
      last = { type: { kind: 'statement' } };
      if (place !== 'statement')
        w.refuse(
          s,
          'place',
          `The block ends with a declaration, so it has no value`
        );
      return;
    }
    last = w.type(s, inner, { ...context, place });
  });
  if (statements.length === 0 && context.place !== 'statement')
    return w.refuse(node, 'place', `An empty block has no value`);
  return last;
}

/** `If`: the condition, then the branches, in the current scope. As a
 * value with two branches, the branches have one type. As a value with no
 * else branch, the `If` has the type of its one branch: the compiler writes
 * it as the `Which` of one clause, whose value where the condition fails is
 * the absent value of that type (`NaN`, or `False` for a boolean). The
 * target rule decides which types have such a value. As a statement, the
 * `else` branch is optional. */
export function walkIf<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const ops = opsOf(node);
  const condition = w.value(ops[0], scope, context);
  if (condition.type.kind !== 'boolean')
    return w.refuse(
      node,
      'signature',
      `The condition of \`If\` has the type ` +
        `\`${fragmentTypeToString(condition.type)}\`, not \`boolean\``
    );
  // A condition that the code decides at compile time selects its branch:
  // the other branch is not written. An `If` with no else branch is
  // written as a `Which` (`If(True, x)` is `x`).
  const decided = constantCondition(ops.length === 2 ? 'Which' : 'If', ops[0]);
  if (decided !== undefined) {
    const branch = decided ? ops[1] : ops[2];
    if (branch !== undefined) return w.type(branch, scope, context);
    if (context.place === 'statement') return { type: { kind: 'statement' } };
  }
  if (context.place === 'statement') {
    for (const branch of ops.slice(1)) w.type(branch, scope, context);
    // The GLSL code of an `If` statement with two branches that are
    // assignments is a conditional expression too (`c ? (p = a) : (n = b)`),
    // and an assignment has the type of its value: the two values must have
    // one type.
    if (
      ops.length === 3 &&
      ops.slice(1).every((b) => isFunction(b, 'Assign'))
    ) {
      const [a, b] = ops
        .slice(1)
        .map((x) =>
          w.value((x as Expression & { op2: Expression }).op2, scope, context)
        );
      if (w.join(a.type, b.type) === undefined)
        return w.refuse(
          node,
          'signature',
          `The branches of the \`If\` statement assign values of the types ` +
            `\`${fragmentTypeToString(a.type)}\` and ` +
            `\`${fragmentTypeToString(b.type)}\`, and they must have one type`
        );
    }
    return { type: { kind: 'statement' } };
  }
  if (ops.length === 2) {
    // A condition decided false has the type of the branch too: the code
    // writes the `If` as a `Which` of one clause, whose value is the
    // absence value of the type of the branch (`NaN` for a number).
    // One conversion per operand: the condition, then the branch read as
    // its own type.
    const value = w.value(ops[1], scope, context);
    const conversions = [
      w.convert(condition, { kind: 'boolean' }),
      w.convert(value, value.type),
    ];
    if (conversions.some((c) => c === undefined))
      return w.refuse(
        node,
        'signature',
        `The branch of the \`If\` has the type ` +
          `\`${fragmentTypeToString(value.type)}\`, which is not read as itself`
      );
    return w.valueFacts(
      node,
      value.type,
      conversions as FragmentConversion<R>[]
    );
  }
  if (ops.length !== 3)
    return w.refuse(
      node,
      'signature',
      `An \`If\` needs a condition and one or two branches`
    );
  const a = w.value(ops[1], scope, context);
  const b = w.value(ops[2], scope, context);
  const t = w.join(a.type, b.type);
  // One conversion per operand: the condition, then each branch read as
  // the type of the `If`.
  const conversions =
    t === undefined
      ? undefined
      : [
          w.convert(condition, { kind: 'boolean' }),
          w.convert(a, t),
          w.convert(b, t),
        ];
  if (t === undefined || conversions!.some((c) => c === undefined))
    return w.refuse(
      node,
      'signature',
      `The branches of \`If\` have the types ` +
        `\`${fragmentTypeToString(a.type)}\` and ` +
        `\`${fragmentTypeToString(b.type)}\`, and they must have one type`
    );
  return w.valueFacts(node, t, conversions as FragmentConversion<R>[]);
}

/** `Which`: the conditions and the values in order, in the current scope.
 * Every value has one type. */
export function walkWhich<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const ops = opsOf(node);
  if (ops.length < 2 || ops.length % 2 !== 0)
    return w.refuse(
      node,
      'signature',
      `\`Which\` needs condition and value pairs`
    );
  let t: FragmentValueType | FragmentListType | undefined;
  // The operands that the node reads as values, in order: each condition
  // that does not fold to `False`, and its value.
  const read: { facts: FragmentValueFacts<R>; condition: boolean }[] = [];
  for (let i = 0; i < ops.length; i += 2) {
    const condition = w.value(ops[i], scope, context);
    if (condition.type.kind !== 'boolean')
      return w.refuse(
        ops[i],
        'signature',
        `A condition of \`Which\` has the type ` +
          `\`${fragmentTypeToString(condition.type)}\`, not \`boolean\``
      );
    // A condition that the compiler folds to `False` drops its value, and
    // one that it folds to `True` drops the values after it.
    const decided = constantCondition('Which', ops[i]);
    if (decided === false) continue;
    read.push({ facts: condition, condition: true });
    if (context.place === 'statement') {
      w.type(ops[i + 1], scope, context);
      if (decided === true) break;
      continue;
    }
    const value = w.value(ops[i + 1], scope, context);
    read.push({ facts: value, condition: false });
    const joined: FragmentValueType | FragmentListType | undefined =
      t === undefined ? value.type : w.join(t, value.type);
    if (joined === undefined)
      return w.refuse(
        node,
        'signature',
        `The values of \`Which\` have the types ` +
          `\`${fragmentTypeToString(t!)}\` and ` +
          `\`${fragmentTypeToString(value.type)}\`, and they must have one type`
      );
    t = joined;
    if (decided === true) break;
  }
  if (context.place === 'statement') return { type: { kind: 'statement' } };
  if (t === undefined)
    return w.refuse(node, 'signature', `Every condition of \`Which\` is false`);
  const valueType = t;
  const conversions = read.map((r) =>
    w.convert(r.facts, r.condition ? { kind: 'boolean' } : valueType)
  );
  const bad = conversions.findIndex((c) => c === undefined);
  if (bad >= 0)
    return w.refuse(
      node,
      'signature',
      `A value of \`Which\` has the type ` +
        `\`${fragmentTypeToString(read[bad].facts.type)}\`, which is not read ` +
        `as \`${fragmentTypeToString(valueType)}\``
    );
  return w.valueFacts(node, t, conversions as FragmentConversion<R>[]);
}

/** `true` or `false` when the code of the conditional `operator` selects
 * its branch at compile time on the condition `node`; `undefined` when the
 * code keeps the branches. The pass keeps the branches that the code keeps,
 * because every branch that the shader code has must have one type:
 * - an `If` selects its branch only when the static type of the condition
 *   is the literal value `True` or `False` (`booleanClaim()`, as for
 *   `2 < 3`). An `If` whose condition is the symbol `False` keeps both
 *   branches, so `If(False, (1, 2), 0)` is refused (a `vec2` and a `float`
 *   branch).
 * - a `Which` drops only the clauses after a condition that is the symbol
 *   `True`: `Which(2 < 3, (1, 2), True, 0)` is refused.
 * This is the rule of the shader code in `docs/COMPILATION-MODEL.md`
 * ("On the shader targets, only the branches that the shader code keeps
 * are compared"). */
function constantCondition(
  operator: 'If' | 'Which',
  node: Expression
): boolean | undefined {
  if (operator === 'Which') return isSymbol(node, 'True') || undefined;
  return booleanClaim(node);
}

/** The constant integer value of `node`, or `undefined`. */
function constantInteger(node: Expression): number | undefined {
  if (!isNumber(node)) return undefined;
  const v = node.re;
  return Number.isInteger(v) && node.im === 0 ? v : undefined;
}

/** `At`: the base, then the index. The type of the base decides: a point,
 * or a list (an array or a list in a texture). */
export function walkAt<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const ops = opsOf(node);
  if (ops.length !== 2)
    return w.refuse(
      node,
      'signature',
      `\`At\` is in the ${w.definition.name} fragment with one index`
    );
  const base = w.type(ops[0], scope, { ...context, place: 'at-base' });
  if (!('representation' in base))
    return w.refuse(node, 'signature', `The base of \`At\` has no value`);
  const t = base.type;
  const element: FragmentValueType | undefined =
    t.kind === 'point'
      ? { kind: 'real' }
      : t.kind === 'list'
        ? t.element
        : undefined;
  if (element === undefined)
    return w.refuse(
      node,
      'signature',
      `The base of \`At\` has the type \`${fragmentTypeToString(t)}\`, and ` +
        `\`At\` reads a point or a list`
    );
  const index = ops[1];
  if (isFunction(index, 'Range')) {
    // A slice with constant bounds: a list of a static count.
    w.type(index, scope, { ...context, place: 'index-set' });
    const lo = constantInteger(index.op1);
    const hi = constantInteger(index.op2);
    if (lo === undefined || hi === undefined || index.nops !== 2 || hi < lo)
      return w.refuse(
        node,
        'signature',
        `\`At\` over a \`Range\` is in the ${w.definition.name} fragment only ` +
          `with constant integer bounds`
      );
    if (t.kind !== 'list')
      return w.refuse(
        node,
        'signature',
        `\`At\` over a \`Range\` reads a list`
      );
    // A bound outside the static count is refused, as a constant index is
    // below: the interpreter reads 1 to n, and -n to -1 from the end.
    const n = t.count;
    if (n !== undefined)
      for (const b of [lo, hi])
        if (b === 0 || Math.abs(b) > n)
          return w.refuse(
            node,
            'signature',
            `The bound ${b} of the slice ${lo} to ${hi} of \`At\` is ` +
              `outside the ${n} elements of its base`
          );
    return w.valueFacts(
      node,
      { kind: 'list', element: t.element, count: hi - lo + 1 },
      [{ kind: 'none', type: t, representation: base.representation }]
    );
  }
  const conversion = w.index(index, scope, context);
  // A constant index outside the static size is refused: the interpreter
  // reads 1 to n, and -n to -1 from the end.
  const n =
    t.kind === 'point' ? t.size : t.kind === 'list' ? t.count : undefined;
  const i = constantInteger(
    isNumber(index) ? index : (w.constant(index, scope) ?? index)
  );
  if (n !== undefined && i !== undefined && (i === 0 || Math.abs(i) > n))
    return w.refuse(
      node,
      'signature',
      `The index ${i} of \`At\` is outside the ${n} elements of its base`
    );
  return w.valueFacts(node, element, [
    { kind: 'none', type: t, representation: base.representation },
    conversion,
  ]);
}

/** `Range`: the bounds as indexes. The place check of the walk accepts it
 * only as an index set. */
export function walkRange<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  for (const op of opsOf(node))
    w.index(op, scope, { ...context, place: 'value' });
  return { type: { kind: 'range' } };
}

/** The point constructor (`Tuple`, `PointList` of scalars): 2 to 4 real
 * components. */
export function walkPoint<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const ops = opsOf(node);
  const facts = ops.map((op) => w.value(op, scope, context));
  const bad = facts.findIndex((f) => !isScalarNumeric(f.type));
  if (bad >= 0)
    return w.refuse(
      node,
      'signature',
      `The component ${bad + 1} of the point \`${node.toString()}\` has the ` +
        `type \`${fragmentTypeToString(facts[bad].type)}\`: a point of the ` +
        `${w.definition.name} fragment has real components`
    );
  if (ops.length < 2 || ops.length > 4)
    return w.refuse(
      node,
      'limit',
      `The point \`${node.toString()}\` has ${ops.length} components, and a ` +
        `point of the ${w.definition.name} fragment has 2 to 4`
    );
  return w.valueFacts(
    node,
    { kind: 'point', size: ops.length },
    facts.map((f) => w.convert(f, { kind: 'real' })!)
  );
}

/** A `List` literal: reals, or points of one size. */
export function walkList<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const ops = opsOf(node);
  const facts = ops.map((op) => w.value(op, scope, context));
  let element: FragmentElementType | undefined;
  if (facts.length > 0 && facts.every((f) => isScalarNumeric(f.type)))
    element = { kind: 'real' };
  else if (
    facts.length > 0 &&
    facts.every(
      (f) =>
        f.type.kind === 'point' &&
        f.type.size === (facts[0].type as { size: number }).size
    )
  )
    element = facts[0].type as FragmentElementType;
  // One conversion per element, read as the element type.
  const conversions =
    element === undefined ? [] : facts.map((f) => w.convert(f, element));
  if (element === undefined || conversions.some((c) => c === undefined))
    return w.refuse(
      node,
      'signature',
      `The list \`${node.toString()}\` is not a list of reals or of points ` +
        `of one size`
    );
  return w.valueFacts(
    node,
    { kind: 'list', element, count: ops.length },
    conversions as FragmentConversion<R>[]
  );
}

/** `First`, `Second`, `Third`, `Last` and `Length` of a point or a list. */
export function walkElement<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const head = node.operator;
  const ops = opsOf(node);
  if (ops.length !== 1)
    return w.refuse(node, 'signature', `\`${head}\` takes one operand`);
  const base = w.type(ops[0], scope, { ...context, place: 'at-base' });
  if (!('representation' in base))
    return w.refuse(node, 'signature', `\`${head}\` reads a value`);
  const t = base.type;
  const n =
    t.kind === 'point' ? t.size : t.kind === 'list' ? t.count : undefined;
  if (t.kind !== 'point' && t.kind !== 'list')
    return w.refuse(
      node,
      'signature',
      `\`${head}\` reads a point or a list, and its operand has the type ` +
        `\`${fragmentTypeToString(t)}\``
    );
  const conversions = [
    { kind: 'none' as const, type: t, representation: base.representation },
  ];
  if (head === 'Length') {
    if (n === undefined)
      return w.refuse(
        node,
        'signature',
        `\`Length\` of a list with no static count is not in the ` +
          `${w.definition.name} fragment`
      );
    // The compiler writes the static count and does not write the operand.
    // An operand with an effect (an assignment, a random draw) would then
    // lose it, so it is refused.
    if (!ops[0].isPure)
      return w.refuse(
        node,
        'signature',
        `\`Length\` of an operand with an effect is not in the ` +
          `${w.definition.name} fragment: the compiler writes the count ` +
          `and not the operand`
      );
    return w.valueFacts(node, { kind: 'integer' }, conversions);
  }
  if (head === 'Last' && n === undefined)
    return w.refuse(
      node,
      'signature',
      `\`Last\` of a list with no static count is not in the ` +
        `${w.definition.name} fragment`
    );
  // `Second` and `Third` read the element 2 or 3, which a base of a smaller
  // static size does not have.
  const position = head === 'Second' ? 2 : head === 'Third' ? 3 : 1;
  if (n !== undefined && n < position)
    return w.refuse(
      node,
      'signature',
      `\`${head}\` reads the element ${position}, and its operand has ` +
        `${n} element(s)`
    );
  const element: FragmentValueType =
    t.kind === 'point' ? { kind: 'real' } : t.element;
  return w.valueFacts(node, element, conversions);
}

/** `Typed(value, type)`: the value, in the place of the node, read as the
 * ascribed type. A complex ascription reads a real value as a complex
 * number (a recorded conversion); a real ascription of a complex value is a
 * contradiction, and it is refused, as the compiler refuses it. Any other
 * ascription keeps the type of the value. */
export function walkTyped<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const value = opsOf(node)[0];
  const facts = w.type(value, scope, context);
  if (!isValueFacts(facts)) return facts;
  const ascribedType = node.type.type;
  const ascribed = w.definition.typeOfType?.(ascribedType);
  if (ascribed === undefined) return facts;
  if (ascribed.kind === 'complex' && facts.type.kind !== 'complex') {
    const conversion = w.convert(facts, ascribed);
    if (conversion === undefined)
      return w.refuse(
        node,
        'signature',
        `The ascribed type \`${node.type.toString()}\` says the value is ` +
          `complex, and the value \`${value.toString()}\` has the type ` +
          `\`${fragmentTypeToString(facts.type)}\``
      );
    return w.valueFacts(node, ascribed, [conversion]);
  }
  if (
    facts.type.kind === 'complex' &&
    ascribed.kind !== 'complex' &&
    ascribedType !== 'unknown' &&
    ascribedType !== 'any' &&
    isSubtype(ascribedType, 'real')
  )
    return w.refuse(
      node,
      'signature',
      `The ascribed type \`${node.type.toString()}\` says the value is ` +
        `real, and the value \`${value.toString()}\` is complex`
    );
  return facts;
}

/**
 * `AddTo(s, e)` when `node` is the lowered form of that `+=`, or
 * `undefined`. `lowerParallelHeads()` writes `s += e` as
 * `Assign(s, Add(s, e))`, and the rewrites after it can write the operands
 * of the `Add` in another order. The program can write the same form with
 * `=` (`s = s + e`), which has other rules (a parallel loop admits it only
 * for a local of the loop): the form is a `+=` only when the program writes
 * no `s = s + e` in the body (`FragmentWalker.sumAssigned()`,
 * `sumAssignedNames()`).
 */
function loweredAddTo<R>(
  node: Expression,
  w: FragmentWalker<R>
): Expression | undefined {
  if (!isFunction(node, 'Assign')) return;
  const [target, value] = opsOf(node);
  if (!isSymbol(target) || !isFunction(value, 'Add')) return;
  if (w.sumAssigned(target.symbol) !== false) return;
  const at = value.ops.findIndex(
    (op) => isSymbol(op) && op.symbol === target.symbol
  );
  if (at < 0) return;
  const rest = value.ops.filter((_, i) => i !== at);
  const ce = node.engine;
  return ce._fn('AddTo', [
    target,
    rest.length === 1 ? rest[0] : ce._fn('Add', rest),
  ]);
}

/** For each block scope whose statements have a `Declare`, the locals that
 *  a tuple assignment may write only under a condition: a constant, or a
 *  local with a declared type (`enforcedLocalTargets()`). The compiled
 *  tuple assignment checks the same map (`assertLeafAssignable()`), so the
 *  pass refuses what the compilation declines. */
const ENFORCED_LOCALS = new WeakMap<FragmentScope<unknown>, EnforcedTargets>();

/** The static type of the component `i` of the value of a tuple
 *  assignment: of the element of a literal `Tuple`, or of the position of a
 *  value whose static type is a tuple. `undefined` when neither is known. */
function tupleComponentType(
  value: Expression,
  i: number
): BoxedType | undefined {
  if (isFunction(value, 'Tuple')) return value.ops[i]?.type;
  const t = value.type.type;
  if (typeof t === 'string' || t.kind !== 'tuple') return undefined;
  const element = t.elements[i];
  return element === undefined ? undefined : value.engine.type(element.type);
}

/** `Assign`, `AddTo`, a tuple assignment: the value, then the check that
 * each target is a local of the function with that type. In a parallel
 * loop, a local bound outside the loop is written only by `AddTo`.
 *
 * A tuple assignment to a local that is a constant, or that has a declared
 * type which the static type of its component does not prove, is refused:
 * the interpreter checks every component before it writes any and refuses
 * the whole assignment when one does not fit, and the compiled writes have
 * no such check. With `a, b: real`, `(a, b) := (b, a + b)` is accepted;
 * with `a: integer, b: real`, it is refused, because `b` is a `real`. */
export function walkAssign<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  // `AddTo(s, e)`, or its lowered form `Assign(s, Add(s, e))`
  // (`lowerParallelHeads()`), which the compiler makes before the pass. A
  // refusal of the lowered form names an `AddTo`.
  const shown = loweredAddTo(node, w) ?? node;
  const head = shown.operator;
  const ops = opsOf(node);
  const addTo = head === 'AddTo';
  if (ops.length !== 2)
    return w.refuse(shown, 'signature', `\`${head}\` takes a name and a value`);
  const value = w.value(ops[1], scope, context);
  const targets = isSymbol(ops[0])
    ? [ops[0]]
    : head === 'Assign' &&
        isFunction(ops[0], 'Tuple') &&
        ops[0].ops.every((t) => isSymbol(t))
      ? [...ops[0].ops]
      : undefined;
  if (targets === undefined)
    return w.refuse(
      node,
      'signature',
      `\`${head}\` writes a name or a tuple of names, not ` +
        `\`${ops[0].toString()}\``
    );
  if (targets.length > 1 && !isDestructurableValue(ops[1], w))
    return w.refuse(
      node,
      'signature',
      nonLiteralTupleValue('assignment', ops[1])
    );
  const types =
    targets.length === 1 ? [value.type] : componentTypes(value, targets.length);
  if (types === undefined)
    return w.refuse(
      node,
      'signature',
      `The value of the tuple assignment has the type ` +
        `\`${fragmentTypeToString(value.type)}\`, which is not a point of ` +
        `${targets.length} components`
    );
  targets.forEach((t, i) => {
    const name = (t as Expression & { symbol: string }).symbol;
    const found = w.binding(scope, name);
    if (found === undefined || found.role !== 'local')
      return w.refuse(
        shown,
        'signature',
        `\`${head}\` writes \`${name}\`, which is not a local of the function` +
          (found === undefined ? '' : ` (it is a ${found.role})`),
        name
      );
    // Every enclosing block of the function that declares the name is
    // checked, not only the one that binds it, as the compiled assignment
    // checks every enclosing frame (`assertLeafAssignable()`): with
    // `a: integer` in an outer block and `a, b: real` in an inner block,
    // `(a, b) := (b, a + b)` in the inner block is refused, because `b` does
    // not prove `integer`. A function scope has the root scope as its
    // parent, so the walk stays in the function.
    for (
      let s: FragmentScope<R> | undefined =
        targets.length > 1 ? scope : undefined;
      s !== undefined;
      s = s.parent
    ) {
      const enforced = ENFORCED_LOCALS.get(s as FragmentScope<unknown>);
      if (enforced?.has(name) === true) {
        const declared = enforced.get(name);
        if (
          declared === undefined ||
          !leafAlwaysFits(tupleComponentType(ops[1], i), declared)
        )
          return w.refuse(
            shown,
            'signature',
            `The tuple assignment writes \`${name}\`, which is ` +
              (declared === undefined
                ? `a constant or has a declared type that the compiler ` +
                  `cannot read`
                : `declared \`${declared}\`, and the static type of its ` +
                  `value does not prove that type`),
            name
          );
      }
    }
    // The innermost parallel loop, also when a counted loop inside it
    // encloses the statement.
    if (
      context.parallel !== undefined &&
      !addTo &&
      !isInside(scope, found.scope, context.parallel)
    )
      return w.refuse(
        shown,
        'place',
        `A parallel loop writes the local \`${name}\` of the function only ` +
          `with \`+=\``,
        name
      );
    const local = found.facts.type;
    const from = types[i];
    const facts =
      targets.length === 1
        ? value
        : ({
            type: from,
            representation: value.representation,
          } as FragmentValueFacts<R>);
    if (
      local.kind === 'list' ||
      local.kind === 'statement' ||
      local.kind === 'range' ||
      local.kind === 'function' ||
      w.convert(facts, local) === undefined
    )
      return w.refuse(
        shown,
        'signature',
        `\`${head}\` writes a value of the type ` +
          `\`${fragmentTypeToString(from)}\` to the local \`${name}\` of the ` +
          `type \`${fragmentTypeToString(local)}\``,
        name
      );
    // `AddTo` adds to a scalar local only (`s += e`).
    if (addTo && !isScalarNumeric(local))
      return w.refuse(
        shown,
        'signature',
        `\`AddTo\` adds to a scalar local, and \`${name}\` has the type ` +
          `\`${fragmentTypeToString(local)}\``,
        name
      );
  });
  return { type: { kind: 'statement' } };
}

/** Whether the scope `binder` is `loop` or a scope inside it, from `scope`. */
function isInside<R>(
  scope: FragmentScope<R>,
  binder: FragmentScope<R>,
  loop: FragmentScope<R>
): boolean {
  for (let s: FragmentScope<R> | undefined = scope; s; s = s.parent) {
    if (s === binder) return true;
    if (s === loop) return false;
  }
  return false;
}

/** `Declare` outside a block: refused. */
export function walkDeclareOutsideBlock<R>(
  node: Expression,
  _scope: FragmentScope<R>,
  _context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  return w.refuse(
    node,
    'place',
    `\`Declare\` is in the ${w.definition.name} fragment only as a ` +
      `statement of a block`
  );
}

export const walkCountedLoop = walkLoop('loop');
export const walkParallelLoop = walkLoop('parallel');

//
// The diagnostic (the design note, section 7)
//

/** The answer of `canCompile()`. */
export type CanCompileResult =
  { ok: true } | { ok: false; diagnostic: CompileDiagnostic };

/** The `outside-fragment` diagnostic of a refusal of the pass. */
export function fragmentRefusalDiagnostic(
  refusal: FragmentRefusal
): CompileDiagnostic {
  const diagnostic: CompileDiagnostic = {
    code: 'outside-fragment',
    kind: 'capability',
    message: `${refusal.message}.`,
    value: refusal.node.toString(),
  };
  if (refusal.operator !== undefined) diagnostic.operator = refusal.operator;
  if (refusal.binding !== undefined) diagnostic.binding = refusal.binding;
  return diagnostic;
}

/** The `outside-fragment` diagnostic of an error that the preparation of
 * the tree, or the check of an option, raised. */
export function fragmentErrorDiagnostic(e: unknown): CompileDiagnostic {
  const message =
    e instanceof Error ? e.message : `Could not compile: ${String(e)}`;
  const diagnostic: CompileDiagnostic = {
    code: 'outside-fragment',
    kind: 'capability',
    message,
  };
  // A decline of the compiler carries its own fields: the name and the
  // value that it is about.
  const inner = (e as { diagnostic?: CompileDiagnostic } | undefined)
    ?.diagnostic;
  if (inner?.binding !== undefined) diagnostic.binding = inner.binding;
  if (inner?.value !== undefined) diagnostic.value = inner.value;
  return diagnostic;
}
