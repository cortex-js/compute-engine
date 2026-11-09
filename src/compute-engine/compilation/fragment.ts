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
  declareValueOperand,
} from './compile-declarations.js';
import { foldCaptureRefusal } from './compile-folded-values.js';

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
  | { kind: 'real' }
  | { kind: 'integer' }
  | { kind: 'point'; size: number };

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
      parameters: readonly { name: string; type: FragmentValueType }[];
      result: FragmentValueType;
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
    { body: Expression; scope: FragmentScope<R>; type: FragmentType }
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
 * - `boolean`, `complex` (a real is converted), `color` (also a point of
 *   size 3, or a string literal, which names a colour at compile time).
 * - `name`: a string literal, which names a colour space or another option
 *   at compile time. It is not a value at run time.
 * - `point`: a point of the size of the signature, or a list of that many
 *   reals. With `broadcast`, also a real, which is broadcast.
 * - `real-list`: a list of reals with a representation.
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
  | 'real-list';

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
    | { facts: FragmentFacts<R>; role: FragmentBindingRole; scope: FragmentScope<R> }
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
  /** Refuse `node`. */
  refuse(
    node: Expression,
    reason: FragmentRefusalReason,
    message: string,
    binding?: string
  ): never;
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
   *  `undefined` when the parameter has no fragment type. */
  readonly parameterTypes: readonly (FragmentValueType | undefined)[];
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
  typeOfSymbol(symbol: Expression): FragmentValueType | FragmentListType | undefined;
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
  representationOfValue(type: FragmentValueType | FragmentListType): R | undefined;
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
};

//
// The pass
//

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
};

/** The operands of a function expression, or none. */
function opsOf(node: Expression): readonly Expression[] {
  return isFunction(node) ? node.ops : [];
}

function newScope<R>(parent?: FragmentScope<R>): FragmentScope<R> {
  return { parent, bindings: new Map(), facts: new Map(), inner: new Map() };
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
  definition: FragmentDefinition<R>
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
    | { facts: FragmentFacts<R>; role: FragmentBindingRole; scope: FragmentScope<R> }
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
    role: FragmentBindingRole
  ): FragmentValueFacts<R> => {
    const representation = definition.representationOfBinding(type, {
      role,
      symbol: node,
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
    refuse,
    valueFacts,
    convert,
    join,
    open,
    bind: (node, scope, name, type, role) =>
      bind(node, scope, name, type, role),
    collect,
    binding,

    type(node, scope, context) {
      let facts = scope.facts.get(node);
      if (facts === undefined) {
        facts = computeFacts(node, scope, context);
        // A statement is checked against its loop at each use, so its facts
        // are not kept: a `Break` is valid in one loop and not outside it.
        if (facts.type.kind !== 'statement') scope.facts.set(node, facts);
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
    // value.
    const folded = definition.constantValue?.(node);
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
    const type = definition.typeOfSymbol(node);
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
      if (usesPoint && patterns.includes('point') && vectorKinds.size === 0)
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
        `The call of \`${fn.name}\` has ${args.length} argument(s), and the ` +
          `function has ${fn.parameters.length} parameter(s)`
      );
    let entry = state.functions.get(fn.key);
    if (entry === undefined) {
      if (state.typing.has(fn.key))
        return refuse(
          node,
          'limit',
          `The function \`${fn.name}\` calls itself, directly or through ` +
            `another function: the ${fragment} fragment has no recursion`
        );
      entry = typeFunction(node, fn);
    }
    const type = entry.type as Extract<FragmentType, { kind: 'function' }>;
    const conversions = args.map((a, i) => {
      const c = convert(a, type.parameters[i].type);
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
    return valueFacts(node, type.result, conversions);
  };

  const typeFunction = (
    call: Expression,
    fn: FragmentFunction
  ): { body: Expression; scope: FragmentScope<R>; type: FragmentType } => {
    // The function is emitted at the top level, so its scope is a child of
    // the root scope, not of the scope of the call.
    const scope = newScope<R>(state.root);
    state.functionScopes.add(scope);
    const outer = currentFunction;
    state.typing.add(fn.key);
    currentFunction = fn.key;
    try {
      const parameters = fn.parameters.map((name, i) => {
        const type = fn.parameterTypes[i];
        if (type === undefined)
          return refuse(
            call,
            'symbol',
            `The parameter \`${name}\` of \`${fn.name}\` has no type in the ` +
              `${fragment} fragment: declare a numeric type for it`,
            name
          );
        bind(
          fn.parameterSymbols?.[i] ?? call,
          scope,
          name,
          type,
          'parameter'
        );
        return { name, type };
      });
      const result = walker.value(fn.body, scope, {
        place: 'value',
        fn: fn.key,
      });
      if (result.type.kind === 'list')
        return refuse(
          fn.body,
          'signature',
          `The function \`${fn.name}\` returns a list, and a function of ` +
            `the ${fragment} fragment returns a scalar, a complex number, a ` +
            `point or a colour`
        );
      const entry = {
        body: fn.body,
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
    }
  };

  return walker;
}

//
// The rules that walk, shared by the definitions
//

/** The names of the index and the bounds of one index of a `Sum`, a
 * `Product` or a `Loop`: `Limits(k, a, b)` or `Element(k, Range(a, b))`. */
function indexOf(
  spec: Expression
): { name: string; symbol: Expression; lower: Expression; upper: Expression; step?: Expression } | undefined {
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
  const range = w.definition.counterRange;
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
        ? w.definition.constantValue?.(bound)
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
 * `ParallelLoop`, in the body of a user function only. */
function walkLoop(kind: 'loop' | 'parallel') {
  return <R>(
    node: Expression,
    scope: FragmentScope<R>,
    context: FragmentContext<R>,
    w: FragmentWalker<R>
  ): FragmentFacts<R> => {
    const head = node.operator;
    if (context.fn === undefined)
      return w.refuse(
        node,
        'place',
        `\`${head}\` is in the ${w.definition.name} fragment only in the ` +
          `body of a user function`
      );
    const ops = opsOf(node);
    const index = ops.length === 2 ? indexOf(ops[1]) : undefined;
    if (index === undefined || !isFunction(ops[1], 'Element'))
      return w.refuse(
        node,
        'signature',
        `\`${head}\` is in the ${w.definition.name} fragment only as a ` +
          `counted loop over an integer range`
      );
    indexBounds(node, index, scope, context, w);
    const inner = w.open(node, scope);
    w.bind(index.symbol, inner, index.name, { kind: 'integer' }, 'index');
    w.type(ops[0], inner, {
      place: 'statement',
      fn: context.fn,
      loop: { kind, scope: inner },
      parallel: kind === 'parallel' ? inner : context.parallel,
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

/** The component types of a value that a tuple of `n` names receives. */
function componentTypes<R>(
  facts: FragmentValueFacts<R>,
  n: number
): FragmentValueType[] | undefined {
  if (facts.type.kind === 'point' && facts.type.size === n)
    return Array.from({ length: n }, () => ({ kind: 'real' }));
  return undefined;
}

/** A `Declare` statement of a block, which `walkBlock` reads. */
function walkDeclare<R>(
  statement: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
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
      const t = declared === undefined ? undefined : w.definition.typeOfSymbol(name);
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
    }
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

/** `Block`, in the body of a user function only. First the names of the
 * `Declare` statements, then the statements in order. The value of the
 * block is the value of its last statement. */
export function walkBlock<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  if (context.fn === undefined)
    return w.refuse(
      node,
      'place',
      `A \`Block\` is in the ${w.definition.name} fragment only in the body ` +
        `of a user function, not at the root of the expression`
    );
  const inner = w.open(node, scope);
  const statements = opsOf(node);
  const names: string[] = [];
  for (const s of statements)
    if (isFunction(s, 'Declare'))
      for (const n of declaredNames(s) ?? [])
        names.push((n as Expression & { symbol: string }).symbol);
  w.collect(inner, names);
  let last: FragmentFacts<R> = { type: { kind: 'statement' } };
  statements.forEach((s, i) => {
    const place = i === statements.length - 1 ? context.place : 'statement';
    if (isFunction(s, 'Declare')) {
      walkDeclare(s, inner, { ...context, place: 'value' }, w);
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
 * value, both branches, of one type. As a statement, the `else` branch is
 * optional. */
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
  // A condition that the compiler folds to `True` or `False` selects its
  // branch at compile time: the other branch is not written.
  const decided = constantCondition(ops[0], w);
  if (decided !== undefined) {
    const branch = decided ? ops[1] : ops[2];
    if (branch !== undefined) return w.type(branch, scope, context);
    if (context.place === 'statement') return { type: { kind: 'statement' } };
  }
  if (context.place === 'statement') {
    for (const branch of ops.slice(1)) w.type(branch, scope, context);
    return { type: { kind: 'statement' } };
  }
  if (ops.length !== 3)
    return w.refuse(
      node,
      'signature',
      `An \`If\` that is a value needs both branches`
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
    return w.refuse(node, 'signature', `\`Which\` needs condition and value pairs`);
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
    const decided = constantCondition(ops[i], w);
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

/** `true` or `false` when the condition `node` is `True` or `False`, or
 * the compiler folds it to one of them; `undefined` otherwise. */
function constantCondition<R>(
  node: Expression,
  w: FragmentWalker<R>
): boolean | undefined {
  const value = isSymbol(node) ? node : w.definition.constantValue?.(node);
  if (isSymbol(value, 'True')) return true;
  if (isSymbol(value, 'False')) return false;
  return undefined;
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
      return w.refuse(node, 'signature', `\`At\` over a \`Range\` reads a list`);
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
    isNumber(index) ? index : (w.definition.constantValue?.(index) ?? index)
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
  for (const op of opsOf(node)) w.index(op, scope, { ...context, place: 'value' });
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
  const n = t.kind === 'point' ? t.size : t.kind === 'list' ? t.count : undefined;
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

/** `Assign`, `AddTo`, a tuple assignment: the value, then the check that
 * each target is a local of the function with that type. In a parallel
 * loop, a local bound outside the loop is written only by `AddTo`. */
export function walkAssign<R>(
  node: Expression,
  scope: FragmentScope<R>,
  context: FragmentContext<R>,
  w: FragmentWalker<R>
): FragmentFacts<R> {
  const head = node.operator;
  if (context.fn === undefined)
    return w.refuse(
      node,
      'place',
      `\`${head}\` is in the ${w.definition.name} fragment only in the body ` +
        `of a user function`
    );
  const ops = opsOf(node);
  if (ops.length !== 2)
    return w.refuse(node, 'signature', `\`${head}\` takes a name and a value`);
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
  const types =
    targets.length === 1
      ? [value.type]
      : componentTypes(value, targets.length);
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
        node,
        'signature',
        `\`${head}\` writes \`${name}\`, which is not a local of the function` +
          (found === undefined ? '' : ` (it is a ${found.role})`),
        name
      );
    // The innermost parallel loop, also when a counted loop inside it
    // encloses the statement.
    if (
      context.parallel !== undefined &&
      head !== 'AddTo' &&
      !isInside(scope, found.scope, context.parallel)
    )
      return w.refuse(
        node,
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
        : ({ type: from, representation: value.representation } as FragmentValueFacts<R>);
    if (
      local.kind === 'list' ||
      local.kind === 'statement' ||
      local.kind === 'range' ||
      local.kind === 'function' ||
      w.convert(facts, local) === undefined
    )
      return w.refuse(
        node,
        'signature',
        `\`${head}\` writes a value of the type ` +
          `\`${fragmentTypeToString(from)}\` to the local \`${name}\` of the ` +
          `type \`${fragmentTypeToString(local)}\``,
        name
      );
    // `AddTo` adds to a scalar local only (`s += e`).
    if (head === 'AddTo' && !isScalarNumeric(local))
      return w.refuse(
        node,
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
      `statement of a block in the body of a user function`
  );
}

export const walkCountedLoop = walkLoop('loop');
export const walkParallelLoop = walkLoop('parallel');

//
// The diagnostic (the design note, section 7)
//

/** The answer of `canCompile()`. */
export type CanCompileResult =
  | { ok: true }
  | { ok: false; diagnostic: CompileDiagnostic };

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
