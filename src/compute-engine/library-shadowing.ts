/**
 * Whether a user binding shadows a standard-library name.
 *
 * A user binding shadows a library name, whichever spelling the name has
 * (user decision 2026-09-27; `src/epsil/docs/naming.md`, "User names and
 * shadowing"): `function Square(x) { x + 100 }` makes `Square(3)` call that
 * function, and a parameter named `Sqrt` is the argument inside its body.
 * Code that treats a head by its NAME rather than by its definition — the
 * canonical short path that folds `Square(3)` to `9`, a compilation target's
 * built-in lowering of `Sin` to `Math.sin` — must ask this first, or it
 * answers the library operator's value instead of the user's.
 *
 * This function answers for the CURRENT scope, so it is the test to use
 * before the node exists (a canonical short path that runs before the call
 * is built). For a node that exists, use {@link isLibraryOperator}, which
 * reads the definition the node is bound to, and so answers for the scope
 * where the node was bound.
 *
 * A name the library does not define (no binding in the outermost, system,
 * scope) is never shadowed: a user function `Tick` shadows nothing. A
 * library name is shadowed when:
 *
 * - the definition the current scope resolves it to is not the one in the
 *   system scope, where the standard library is installed. This includes a
 *   definition of a library loaded with `ce.loadLibrary()`, which goes in
 *   the global scope;
 * - it is a parameter of a function body being canonicalized
 *   (`_isShadowedParameter`): the parameter is declared lazily, on its first
 *   reference, so the lookup can still find the library definition while the
 *   body is boxed;
 * - a caller-supplied library (the constructor's `libraries` option)
 *   defines it: such a library installs into the SAME system scope as the
 *   standard one, so the scope comparison cannot see it, and
 *   `_customLibraryOperators` records the names it replaced. Pass
 *   `customLibrary: false` to leave these out: a compilation target reads
 *   the custom definition's own lowering, so for the compiler a custom
 *   library is not a shadow.
 *
 * A definition installed by `ce.declare(name, patch, { extend: true })` from
 * the library definition is not a shadow when the patch, and every earlier
 * extension in its chain, kept the library's `evaluate`, `canonical`,
 * `compile` and `derivative`: the code that reads the library by name reads
 * exactly these parts, so it still gives the right answer
 * (`markLibraryExtension()`).
 *
 * For the same reason, a copy of the library definition is not a shadow
 * when it holds the library's own `evaluate`, `canonical`, `compile` and
 * `derivative` handlers, and the library's `lazy`, `broadcastable` and
 * `evaluateAsync` (`keepsLibraryOperator()`). A copy that replaces one of
 * the handlers is a shadow: the interpreter would compute something other
 * than the library rule. A copy that changes `lazy` or `broadcastable`
 * changes how the arguments are evaluated or compiled, and a copy with
 * another `evaluateAsync` computes another value under
 * `evaluateAsync()`, so these are shadows too. The same flags are required
 * of an extension. Only the definition of the same name in the system scope
 * is compared, so a copy declared under another name is never the library
 * operator.
 *
 * This module is a leaf: it takes the engine through the few members it
 * reads, so the boxing code and the compiler can both import it.
 */
export function shadowsLibraryName(
  ce: {
    lookupDefinition(name: string): unknown;
    readonly contextStack: ReadonlyArray<{
      readonly lexicalScope: {
        readonly bindings: { get(name: string): unknown };
      };
    }>;
    readonly _customLibraryOperators: ReadonlySet<string>;
    readonly _qualifiedHead?: { readonly name: string } | undefined;
    _isShadowedParameter(name: string): boolean;
  },
  name: string,
  options?: { customLibrary?: boolean }
): boolean {
  const library = ce.contextStack[0]?.lexicalScope.bindings.get(name);
  if (library === undefined) return false;
  if (options?.customLibrary !== false && ce._customLibraryOperators.has(name))
    return true;
  // While `ce._libraryCall()` boxes a call of `name`, the call is bound to
  // the library definition, so the tests of that boxing see no shadow
  // (`ce._qualifiedHead`). The boxing of an operand clears the field.
  if (ce._qualifiedHead?.name === name) return false;
  if (ce._isShadowedParameter(name)) return true;
  const current = ce.lookupDefinition(name);
  if (current === undefined) return false;
  return isShadowOf(current, library);
}

/**
 * True when an operand `name(…)` that is not canonical yet (MathJSON, or a
 * raw boxed expression) is not a call of the library operator `name`, so a
 * rule that folds or splices a call of the library operator by its name must
 * read it as a leaf. This is {@link shadowsLibraryName}, and also true while
 * `ce._libraryCall()` boxes a call of the same name (`ce._qualifiedHead`):
 * that call is made only where a binding of the program shadows `name`, and
 * the raw operands of the call are written in that scope. In
 * `std::multiply(Multiply(2, 3), 4)` with a user function `Multiply`, the
 * inner call is a call of the user function, and is not spliced into the
 * product.
 */
export function shadowsLibraryNameInOperand(
  ce: Parameters<typeof shadowsLibraryName>[0],
  name: string
): boolean {
  return ce._qualifiedHead?.name === name || shadowsLibraryName(ce, name);
}

/**
 * True when `node` is a call of the library operator `name`: a library rule
 * (a canonical fold, a simplification rule, a derivative table, a compiled
 * lowering) is a fact about the library operator, and it applies to the node
 * only when this is true. `name` defaults to `node.operator`; when it is
 * given, a node with another operator answers false, so a test of
 * `node.operator === name` before the call is only a pre-filter.
 *
 * A canonical call denotes its definition (`operatorDefinition`), not its
 * name. So the node is a call of the library operator when its operator
 * definition is the operator definition of `name` in the system scope, where
 * the standard library is installed, or an extension or a copy of it that
 * keeps the library handlers (the cases where {@link isShadowOf} answers
 * false; see {@link shadowsLibraryName}). The binding of the node was
 * selected by the scope chain where the node was bound, so the answer is
 * correct for that scope, also when it is read in another scope: a call of
 * the library `Sqrt` made before a declaration of a user `Sqrt` is still a
 * library call after the declaration, and a call bound to the user `Sqrt`
 * is not a library call after the scope of the declaration is popped. The
 * scope-based {@link shadowsLibraryName} answers for the current scope, which
 * is wrong in both cases.
 *
 * The cost is one map read (the binding of `name` in the system scope, read
 * from `_evalContextStack`, not from `contextStack`, which copies the stack
 * on each read) and one comparison of objects in the usual case. A node bound
 * to a user definition also compares the handlers of the two definitions.
 *
 * The other cases:
 *
 * - a name that the system scope does not define as an operator: false;
 * - a name that a caller-supplied library (the constructor's `libraries`
 *   option) defined: false, unless `customLibrary: false`. Such a library
 *   installs into the same system scope, so the system-scope definition is
 *   the custom one, and a rule that knows the standard library operator must
 *   not apply to it. A compilation target reads the custom definition's own
 *   lowering, so it passes `customLibrary: false`, as it does for
 *   {@link shadowsLibraryName};
 * - a node bound to a value definition: false. A function made with
 *   `DefineFunction` or an Epsil `function Sqrt(x) { … }` is a variable
 *   whose value is a function literal, so a call of it is bound to a value
 *   definition and has no operator definition;
 * - a node with no definition (a non-canonical node, or a canonical node for
 *   which the lookup found no definition, such as a call of a parameter of a
 *   function literal whose body is being canonicalized): the answer of the
 *   scope-based guard, `!shadowsLibraryName(ce, name, options)`.
 *
 * A symbol node has the operator `Symbol`, so a symbol named `Sqrt` is not a
 * call of `Sqrt`.
 */
export function isLibraryOperator(
  node: {
    readonly operator: string;
    readonly operatorDefinition: object | undefined;
    readonly valueDefinition: unknown;
    readonly engine: Parameters<typeof shadowsLibraryName>[0] & {
      readonly _evalContextStack: ReadonlyArray<{
        readonly lexicalScope: {
          readonly bindings: { get(name: string): unknown };
        };
      }>;
    };
  },
  name?: string,
  options?: { customLibrary?: boolean }
): boolean {
  if (name === undefined) name = node.operator;
  else if (node.operator !== name) return false;
  const ce = node.engine;
  const library = ce._evalContextStack[0]?.lexicalScope.bindings.get(name) as
    { operator?: object } | undefined;
  const libraryOperator = library?.operator;
  if (libraryOperator === undefined) return false;
  if (
    options?.customLibrary !== false &&
    ce._customLibraryOperators.size > 0 &&
    ce._customLibraryOperators.has(name)
  )
    return false;
  const def = node.operatorDefinition;
  if (def !== undefined) return keepsLibraryDefinition(def, libraryOperator);
  if (node.valueDefinition !== undefined) return false;
  // A node with no definition while `ce._libraryCall()` boxes a call of
  // `name` is a raw operand of that call, written in the scope that shadows
  // `name` (`shadowsLibraryNameInOperand()`).
  if (ce._qualifiedHead?.name === name) return false;
  return !shadowsLibraryName(ce, name, options);
}

/**
 * True when `node.operator` is a name that the system scope defines as an
 * operator, and `node` is not a call of that library operator
 * ({@link isLibraryOperator}): the node is bound to a user definition of the
 * name, to a parameter or a local of that name, or the name is one that a
 * caller-supplied library defined (unless `customLibrary: false`).
 *
 * This is the test on a node that {@link shadowsLibraryName} makes on a
 * name: code that selects a call by its name, such as a table of
 * derivatives, asks it, and treats the call as a call of a user function
 * when it is true. A call of a name that the library does not define gives
 * false, as it does for {@link shadowsLibraryName}, so such a call is not
 * classified here. `!isLibraryOperator(node)` is true for it.
 */
export function shadowsLibraryOperator(
  node: Parameters<typeof isLibraryOperator>[0],
  options?: { customLibrary?: boolean }
): boolean {
  const library = node.engine._evalContextStack[0]?.lexicalScope.bindings.get(
    node.operator
  ) as { operator?: object } | undefined;
  if (library?.operator === undefined) return false;
  return !isLibraryOperator(node, node.operator, options);
}

/**
 * True when a library rule that builds its result BY NAME in the current
 * scope must not apply to the call `node`. Such a rule (an antiderivative, a
 * derivative table, a piecewise or a discrete integration rule) applies only
 * when both of these are true:
 *
 * - the call is bound to the library operator: a call bound to a user
 *   definition of a library name has another meaning
 *   ({@link shadowsLibraryOperator});
 * - a call head of that name built in the current scope is bound to the
 *   library definition. Otherwise the result that the rule builds is bound
 *   to the user definition. For example, with a user `Sin := t ↦ t + 100`
 *   declared in the current scope, the library rule for `∫ Sin(x)² dx`,
 *   where `Sin` is a call of the library operator boxed before the
 *   declaration, gives `x/2 − Sin(2x)/4`, and that `Sin` is the user
 *   function, so the result is false.
 *
 * The second test reads the scopes as the binding of a call head reads them:
 * `isApplicable` is that rule (`isApplicableDef()`, `function-utils.ts`,
 * which this leaf module cannot import), so a binding that cannot be applied
 * is skipped. A user value `Gamma := 1.4` does not block the rule for
 * `Gamma(x)`: a call `Gamma(…)` built in that scope still calls the library
 * operator. A parameter of a function body being canonicalized is a shadow
 * too (`_isShadowedParameter`), as for {@link shadowsLibraryName}. The scopes
 * are read from `_evalContextStack`, with one map read for each scope
 * ({@link hidesLibraryBindingInContext}), not from `contextStack`, which
 * copies the stack on each read: the test runs for each node of a
 * derivative or an integrand.
 *
 * The second test applies only to a name that the system scope defines as
 * an operator. A call of a name that the library does not define gives
 * false, as it does for {@link shadowsLibraryOperator}.
 */
export function libraryRuleBlocked(
  node: Parameters<typeof isLibraryOperator>[0],
  isApplicable: (def: never) => boolean,
  options?: { customLibrary?: boolean }
): boolean {
  if (shadowsLibraryOperator(node, options)) return true;
  const ce = node.engine;
  const library = ce._evalContextStack[0]?.lexicalScope.bindings.get(
    node.operator
  ) as { operator?: object } | undefined;
  if (library?.operator === undefined) return false;
  if (ce._isShadowedParameter(node.operator)) return true;
  return hidesLibraryBindingInContext(
    ce as unknown as Parameters<typeof hidesLibraryBindingInContext>[0],
    node.operator,
    library.operator,
    isApplicable
  );
}

/**
 * True when the call nodes `a` and `b` are calls of the same operator: they
 * have the same operator name, and the same definition. Two calls named
 * `Sqrt`, one bound to the library operator and one bound to a user function
 * `Sqrt`, are calls of two operators. A copy or an extension of a definition
 * is another definition here: this compares the bindings of the two nodes,
 * not what they compute (for that, use {@link isLibraryOperator}).
 *
 * The definition of a call is its operator definition, or its value
 * definition when the head is bound to a variable: a function made with
 * `DefineFunction` or an Epsil `function` is a variable whose value is a
 * function literal, so its calls have no operator definition.
 *
 * When one of the nodes has no definition (a non-canonical node, or a node
 * for which the lookup found no definition), only the names are compared.
 * Such a node has no binding to compare, and a non-canonical node is read by
 * its name in the scope where it will be canonicalized, so the name is the
 * only identity it has.
 */
export function sameOperator(
  a: {
    readonly operator: string;
    readonly operatorDefinition: object | undefined;
    readonly valueDefinition: object | undefined;
  },
  b: {
    readonly operator: string;
    readonly operatorDefinition: object | undefined;
    readonly valueDefinition: object | undefined;
  }
): boolean {
  if (a.operator !== b.operator) return false;
  const defA = a.operatorDefinition ?? a.valueDefinition;
  const defB = b.operatorDefinition ?? b.valueDefinition;
  if (defA === undefined || defB === undefined) return true;
  return defA === defB;
}

/**
 * True when a node bound to the definition `def` of the name `name` must be
 * serialized with the `Module` qualifier: `["Module", name]` for a symbol,
 * `["Apply", ["Module", name], …operands]` for a call. `def` is the binding
 * of the node as a scope holds it (`{ value }` or `{ operator }`), or one
 * of its two parts (`baseDefinition`).
 *
 * This is the case when `def` is the definition of `name` in the system
 * scope (the standard library and the libraries of the constructor's
 * `libraries` option), and the name reads another definition where the
 * MathJSON is boxed again, and that definition is a shadow of the library
 * one (`isShadowOf()`: an extension or a copy that keeps the library
 * handlers is not). In a block where `Pi` is declared and assigned `3`, a
 * result built with the library `Pi` written as `"Pi"` would give `3` when
 * it is boxed again. Elsewhere, this is false and the bare name is written.
 *
 * Where the MathJSON is boxed again, the name is read first in the local
 * scopes of the scoped nodes (a `Function` literal, a `Block`) that enclose
 * the node in the serialized expression, innermost first, each one for its
 * own bindings only (`inSerializationScope()`): a serializer does not make
 * them current, and a parameter `Pi` binds the name in the body. Then it is
 * read in the scopes of the current scope chain, from the current scope to
 * the system scope: a function literal made at the top level and serialized
 * in a scope that declares `Pi` is boxed again in that scope.
 *
 * For a call node, pass `isApplicable`, the rule of the lookup that binds a
 * bare head (`isApplicableDef()`, `function-utils.ts`): a binding that cannot
 * be applied (a variable `N` declared `integer`) is skipped, so `["N", x]`
 * still calls the library operator there, and no qualifier is needed.
 *
 * The test is made for each node that the serializers write, and most of
 * these nodes are bound to the library, so the cheap parts come first. A
 * node with no definition, or with a definition that is not the one of the
 * system scope (one map read), answers false. Then each scope is read with
 * one map read, and the first binding of `name` found (that can be applied,
 * for a call) gives the answer. The scopes of the chain are read from
 * `_evalContextStack`, not from `contextStack`, which copies the stack on
 * each read.
 */
export function hidesLibraryBinding(
  ce: {
    readonly _evalContextStack: ReadonlyArray<{
      readonly lexicalScope: ScopeLike;
    }>;
  },
  name: string,
  def: unknown,
  isApplicable?: (def: never) => boolean
): boolean {
  return hides(ce, name, def, isApplicable, serializationFrame);
}

/**
 * True when a node bound to the definition `def` of the name `name`, the
 * definition of the system scope, would be bound to another definition if
 * it were boxed by name in the current scope chain. This is
 * {@link hidesLibraryBinding} without the scopes of the serialized nodes:
 * it is the test for a rebuild of the node by name in the current scope
 * (`BoxedFunction._withLibraryBinding()`).
 */
export function hidesLibraryBindingInContext(
  ce: {
    readonly _evalContextStack: ReadonlyArray<{
      readonly lexicalScope: ScopeLike;
    }>;
  },
  name: string,
  def: unknown,
  isApplicable?: (def: never) => boolean
): boolean {
  return hides(ce, name, def, isApplicable, undefined);
}

function hides(
  ce: {
    readonly _evalContextStack: ReadonlyArray<{
      readonly lexicalScope: ScopeLike;
    }>;
  },
  name: string,
  def: unknown,
  isApplicable: ((def: never) => boolean) | undefined,
  frame: SerializationFrame | undefined
): boolean {
  if (def === undefined || def === null) return false;
  const stack = ce._evalContextStack;
  const system = stack[0]?.lexicalScope;
  const library = system?.bindings.get(name) as
    { value?: unknown; operator?: unknown } | undefined;
  if (library === undefined) return false;
  if (library !== def && library.value !== def && library.operator !== def)
    return false;
  for (let f = frame; f !== undefined; f = f.parent) {
    const found = f.scope.bindings.get(name);
    if (found !== undefined && (!isApplicable || isApplicable(found as never)))
      return isShadowOf(found, library);
  }
  for (
    let scope: ScopeLike | null = stack[stack.length - 1].lexicalScope;
    scope && scope !== system;
    scope = scope.parent
  ) {
    const found = scope.bindings.get(name);
    if (found !== undefined && (!isApplicable || isApplicable(found as never)))
      return isShadowOf(found, library);
  }
  return false;
}

/**
 * The local scopes of the scoped nodes whose operands are being serialized,
 * as a linked list from the innermost one (`inSerializationScope()`). A
 * frame is made once for each pair of a parent frame and a scope, and kept
 * while its scope lives, so the same nesting gives the same frame object,
 * which a cache of serialized nodes can use as a key
 * (`currentSerializationFrame()`).
 */
type SerializationFrame = {
  readonly scope: ScopeLike;
  readonly parent: SerializationFrame | undefined;
  readonly children: WeakMap<ScopeLike, SerializationFrame>;
};

/** The frames whose parent is no frame (the outermost scoped nodes). */
const OUTERMOST_FRAMES = new WeakMap<ScopeLike, SerializationFrame>();

/** The innermost frame, or `undefined` outside a scoped node. */
let serializationFrame: SerializationFrame | undefined;

/**
 * The current frame of the scopes of the serialized nodes, or `undefined`
 * outside a scoped node: the same object for the same nesting of scopes. A
 * cache of the serialized form of a node keys on it, because the qualifier
 * of a node depends on these scopes (`boxedInCurrentScope()`,
 * `compiler-core.ts`).
 */
export function currentSerializationFrame(): object | undefined {
  return serializationFrame;
}

/**
 * Run `serialize`, which serializes the operands of a scoped node (a
 * `Function` literal, a `Block`), with `scope`, the local scope of the node,
 * as the innermost scope where {@link hidesLibraryBinding} reads a name. A
 * serializer does not push the scope of a node that it writes, so without
 * this a local of the node (a parameter `Pi`) would not hide the library
 * definition, and a library `Pi` in the body would be written as the bare
 * name, which reads the parameter when the MathJSON is boxed again. With
 * `scope` undefined (a node with no local scope), `serialize` runs with the
 * scopes unchanged.
 */
export function inSerializationScope<T>(
  scope: ScopeLike | undefined,
  serialize: () => T
): T {
  if (scope === undefined) return serialize();
  const saved = serializationFrame;
  const siblings = saved?.children ?? OUTERMOST_FRAMES;
  let frame = siblings.get(scope);
  if (frame === undefined) {
    frame = { scope, parent: saved, children: new WeakMap() };
    siblings.set(scope, frame);
  }
  serializationFrame = frame;
  try {
    return serialize();
  } finally {
    serializationFrame = saved;
  }
}

/**
 * The local scope of the scoped node (a `Function` literal, a `Block`) whose
 * structural form is the key. A structural form has no local scope of its
 * own, and the serializers write the structural form of a node, so the
 * reading scope of its operands (`inSerializationScope()`) is read here.
 */
const STRUCTURAL_SCOPES = new WeakMap<object, ScopeLike>();

/** Record that `structural` is the structural form of a node whose local
 * scope is `scope`. */
export function noteStructuralScope(
  structural: object,
  scope: ScopeLike
): void {
  STRUCTURAL_SCOPES.set(structural, scope);
}

/** The local scope of the node whose structural form is `structural`, if
 * {@link noteStructuralScope} recorded one. */
export function structuralScope(structural: object): ScopeLike | undefined {
  return STRUCTURAL_SCOPES.get(structural);
}

/**
 * The symbol nodes that the canonical form of `["Module", name]` made in a
 * scope where a local definition shadows `name`. Each one is bound to the
 * library definition of its name on purpose, and a repair that points the
 * occurrences of a name at a local binding (`rebindToBindings()`,
 * `binders.ts`) leaves it alone.
 */
const QUALIFIED_NAMES = new WeakSet<object>();

/** Mark `symbol` as a qualified name: see {@link isQualifiedName}. */
export function markQualifiedName(symbol: object): void {
  QUALIFIED_NAMES.add(symbol);
}

/**
 * True when `symbol` is the canonical form of a `["Module", name]` made in a
 * scope where a local definition shadows the name (`markQualifiedName()`).
 */
export function isQualifiedName(symbol: object): boolean {
  return QUALIFIED_NAMES.has(symbol);
}

/**
 * The calls that `ce._libraryCall()` made (the canonical form of a qualified
 * call `std::floor(x)`), bound to the library definition of their name, and
 * the structural forms of these calls. The canonical form of such a node is
 * the library call again, also where a binding of the program hides the
 * library definition. The canonical form of every other call is rebuilt by
 * its name in the current scope.
 */
const LIBRARY_CALLS = new WeakSet<object>();

/** Mark `call` as a library call: see {@link isLibraryCall}. */
export function markLibraryCall(call: object): void {
  LIBRARY_CALLS.add(call);
}

/**
 * True when `call` was made by `ce._libraryCall()`, or is the structural
 * form of such a call (`markLibraryCall()`).
 */
export function isLibraryCall(call: object): boolean {
  return LIBRARY_CALLS.has(call);
}

/**
 * True when a call of `name` bound to `def` in the scope chain that starts
 * at `scope` is bound to the library definition of `name` (the definition
 * of the system scope) where a binding of the program hides it: a scope of
 * the chain binds `name` to another definition that can be applied
 * (`isApplicable`) and that is not an extension or a copy of the library
 * definition (`isShadowOf()`). A scope that holds the library definition
 * itself is skipped: it is a scope that `withBorrowedBinding()` pushed for a
 * rebuild that keeps the library binding of a call. `BoxedFunction._bind()`
 * marks such a call (`markLibraryCall()`), so a rebuild of a qualified call
 * by `subs()` or `evaluate()` in the scope that hides the name is a library
 * call too.
 */
export function boundToHiddenLibrary(
  ce: {
    readonly _evalContextStack: ReadonlyArray<{
      readonly lexicalScope: ScopeLike;
    }>;
  },
  name: string,
  def: unknown,
  scope: ScopeLike,
  isApplicable: (def: never) => boolean
): boolean {
  const system = ce._evalContextStack[0]?.lexicalScope;
  if (def === undefined || system?.bindings.get(name) !== def) return false;
  for (let s: ScopeLike | null = scope; s && s !== system; s = s.parent) {
    const found = s.bindings.get(name);
    if (found === undefined || found === def || !isApplicable(found as never))
      continue;
    return isShadowOf(found, def);
  }
  return false;
}

/** The parts of a lexical scope that {@link hidesLibraryBinding} reads. */
type ScopeLike = {
  readonly parent: ScopeLike | null;
  readonly bindings: {
    get(name: string): unknown;
    has(name: string): boolean;
  };
};

/**
 * True when the definition `current` of a name is not the library
 * definition `library` of the same name, and is not an extension or a copy
 * of it that keeps the library handlers (see {@link shadowsLibraryName}).
 */
export function isShadowOf(current: unknown, library: unknown): boolean {
  if (current === library) return false;
  const operator = (current as { operator?: object }).operator;
  const libraryOperator = (library as { operator?: object }).operator;
  if (operator === undefined || libraryOperator === undefined) return true;
  return !keepsLibraryDefinition(operator, libraryOperator);
}

/**
 * True when the operator definition `operator` is the library operator
 * definition `libraryOperator`, or an extension of it
 * (`markLibraryExtension()`) that keeps the library flags, or a copy of it
 * that keeps the library handlers and flags (`keepsLibraryOperator()`).
 */
function keepsLibraryDefinition(
  operator: object,
  libraryOperator: object
): boolean {
  if (operator === libraryOperator) return true;
  if (LIBRARY_EXTENSIONS.get(operator) === libraryOperator)
    return keepsLibraryFlags(operator, libraryOperator);
  return keepsLibraryOperator(operator, libraryOperator);
}

/**
 * The standard-library names that a binding of `scope` shadows: a
 * function parameter or a local of a block named `Sin`, `Ln`, …
 *
 * {@link shadowedLibraryNames} cannot find these names: the scope of a
 * function body or of a block is not in the current scope chain while the
 * expression is simplified, only while it is evaluated. So the caller reads
 * the local scope of each scoped expression that it enters.
 */
export function libraryNamesShadowedIn(
  ce: {
    readonly contextStack: ReadonlyArray<{
      readonly lexicalScope: {
        readonly bindings: { get(name: string): unknown };
      };
    }>;
  },
  scope: { readonly bindings: { entries(): Iterable<[string, unknown]> } }
): string[] {
  const system = ce.contextStack[0]?.lexicalScope;
  if (system === undefined) return [];
  const result: string[] = [];
  for (const [name, def] of scope.bindings.entries()) {
    const library = system.bindings.get(name);
    if (library !== undefined && isShadowOf(def, library)) result.push(name);
  }
  return result;
}

/**
 * True when the symbol `sym` has a library name but does not denote the
 * library value: a user declaration gave the name another value
 * (`ce.declare('Pi', { value: 3 })`, `let Pi = 3`).
 *
 * Code that recognizes a constant by its name (`π` in `sin(π) = 0`, the
 * angle of `e^{iπ}`) must ask this first. A bound symbol is compared by its
 * definition: it denotes the library value only when it is bound to the
 * definition in the system scope, where the standard library is installed.
 * A symbol that is not bound (a structural expression) is compared by the
 * definition that its name resolves to in the current scope
 * (`shadowsLibraryName()`).
 */
export function isShadowedSymbol(sym: {
  readonly symbol: string;
  readonly valueDefinition: unknown;
  readonly engine: Parameters<typeof shadowsLibraryName>[0];
}): boolean {
  const library = sym.engine.contextStack[0]?.lexicalScope.bindings.get(
    sym.symbol
  );
  if (library === undefined) return false;
  const def = sym.valueDefinition;
  if (def !== undefined) return (library as { value?: unknown }).value !== def;
  return shadowsLibraryName(sym.engine, sym.symbol);
}

/**
 * The standard-library names that a user binding shadows
 * (`shadowsLibraryName()`) in the current scope chain, and the names that a
 * caller-supplied library replaced. The set is empty in the usual case,
 * where the user defines no function with a library name.
 *
 * The search reads only the bindings of the scopes between the current
 * scope and the system scope, and the system scope holds the whole standard
 * library. So the cost is in proportion to the number of user names, not to
 * the size of the library. A function parameter is not included: it is
 * declared in the scope of its function body, which is not in the current
 * scope chain.
 */
export function shadowedLibraryNames(ce: {
  lookupDefinition(name: string): unknown;
  readonly context: {
    readonly lexicalScope: {
      readonly parent: unknown;
      readonly bindings: { keys(): Iterable<string> };
    };
  };
  readonly contextStack: ReadonlyArray<{
    readonly lexicalScope: {
      readonly bindings: { get(name: string): unknown };
    };
  }>;
  readonly _customLibraryOperators: ReadonlySet<string>;
  _isShadowedParameter(name: string): boolean;
}): ReadonlySet<string> {
  const system = ce.contextStack[0]?.lexicalScope;
  if (system === undefined) return new Set();
  const result = new Set(ce._customLibraryOperators);
  type ScopeLike = typeof ce.context.lexicalScope;
  let scope = ce.context.lexicalScope as ScopeLike | null;
  while (scope && scope !== (system as unknown)) {
    for (const name of scope.bindings.keys())
      if (!result.has(name) && shadowsLibraryName(ce, name)) result.add(name);
    scope = scope.parent as ScopeLike | null;
  }
  return result;
}

/**
 * The handlers of an operator definition that the code which reads the
 * library operator by name depends on: the canonical folds, the derivative
 * rules and the compiled lowering give the library result, so they are
 * correct for a definition only when it computes what the library computes.
 */
const LIBRARY_HANDLERS = [
  'evaluate',
  'canonical',
  'compile',
  'derivative',
] as const;

/**
 * True when the operator definition `operator` holds the same `evaluate`,
 * `canonical`, `compile` and `derivative` handlers as the library operator
 * definition `libraryOperator` (the same function objects, or both absent),
 * and the same `lazy`, `broadcastable` and `evaluateAsync`
 * (`keepsLibraryFlags()`). This is the case of a copy of the library
 * definition, `ce.declare('Sqrt', { ...ce.lookupDefinition('Sqrt').operator
 * })`, and of a copy that changes only other fields, such as `description`
 * (user decision 2026-10-01). Such a copy is not a shadow.
 *
 * The handlers are compared by object identity. A copy built from the
 * definitions of another engine bundle (a plugin bundle re-bundles the
 * engine code, so its library handlers are other function objects) is a
 * user definition.
 */
export function keepsLibraryOperator(
  operator: object,
  libraryOperator: object
): boolean {
  const current = operator as Record<string, unknown>;
  const library = libraryOperator as Record<string, unknown>;
  return (
    LIBRARY_HANDLERS.every((key) => current[key] === library[key]) &&
    keepsLibraryFlags(operator, libraryOperator)
  );
}

/**
 * True when `operator` has the same `lazy` and `broadcastable` flags as the
 * library operator definition `libraryOperator`, and the same
 * `evaluateAsync` handler (the same function object, or both absent).
 * `lazy` decides whether the arguments are evaluated before the handler
 * sees them, `broadcastable` whether the operator is applied element by
 * element to a collection argument (by the interpreter and by the compiled
 * code), and `evaluateAsync` computes the value under `evaluateAsync()`. A
 * definition that changes one of these does not compute what the library
 * operator computes. The flags are compared as booleans, the values the
 * boxed definition reports (an absent flag is `false`).
 */
function keepsLibraryFlags(operator: object, libraryOperator: object): boolean {
  const current = operator as Record<string, unknown>;
  const library = libraryOperator as Record<string, unknown>;
  return (
    !!current.lazy === !!library.lazy &&
    !!current.broadcastable === !!library.broadcastable &&
    current.evaluateAsync === library.evaluateAsync
  );
}

/**
 * For an operator definition built by `ce.declare(name, patch,
 * { extend: true })`, the system-scope (library) operator definition that it
 * extends, directly or through earlier extensions. Only an extension that
 * kept the library's `evaluate`, `canonical`, `compile` and `derivative` is
 * recorded. A weak map, so that a definition that is no longer bound can be
 * collected, and so that no field is added to the definition object (a spread
 * of the definition does not copy the mark).
 */
const LIBRARY_EXTENSIONS = new WeakMap<object, object>();

/** Record that `extension` extends the library operator definition
 * `libraryOperator` (see {@link shadowsLibraryName}). */
export function markLibraryExtension(
  extension: object,
  libraryOperator: object
): void {
  LIBRARY_EXTENSIONS.set(extension, libraryOperator);
}

/** The library operator definition that `operator` extends, if it is an
 * extension recorded by {@link markLibraryExtension}. */
export function extendedLibraryOperator(operator: object): object | undefined {
  return LIBRARY_EXTENSIONS.get(operator);
}
