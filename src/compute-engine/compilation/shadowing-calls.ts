import type { Expression, FunctionInterface } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { withCallableBinding } from '../boxed-expression/binders.js';
import { withScratchScope } from '../scratch-scopes.js';

/**
 * Compile a call of a user function that shadows a library operator as a
 * call of that user function.
 *
 * A document can define a function with the name of a library operator:
 * Desmos has no built-in Gamma function, so a Desmos document defines
 * `Gamma(x) := (x - 1)!`. The interpreter calls this user function. Many
 * parts of the compiler read a head by its NAME and apply the semantics of
 * the library operator: the target lowering tables (`Gamma` →
 * `_SYS.gamma`), the angular-unit rewrite (`Sin(x)` → `Sin(x·π/180)` in
 * degree mode), the sign proofs (`Exp(x) > 0`), the scalar facts (`Floor`
 * of a number is a number), the recurrences of the forward-mode derivative
 * (`Sin`), the lazy streams (`Rest`). For a call of the user function, each
 * of these gives the value of the library operator, not the value of the
 * user function.
 *
 * So, before a target compiles `expr`, each call (and each reference in a
 * value position, such as `Map(Gamma, xs)`) that is BOUND to such a user
 * function is renamed to a private name, and the private name is declared
 * with a copy of the user function, in a scope that exists only while the
 * target compiles. The by-name parts of the compiler then do not recognize
 * the call, and the compiler compiles it as it compiles a call of a user
 * function with any other name (`G(x)`).
 *
 * The decision reads the definition that each node is BOUND to, not the
 * definition that its name has in the current scope. A node bound to the
 * definition in the system scope (the standard library, or a library given
 * to the engine constructor) is not renamed. A node that was bound to the
 * library operator before a user definition shadowed the name is not renamed
 * either: the compiler then declines it, because the name is shadowed in the
 * current scope (`shadowedLibraryLoweringError()`, `base-compiler.ts`).
 *
 * The body of a renamed function is renamed too, so a recursive call
 * (`Gamma(x) := (x - 1)·Gamma(x - 1)`) calls the private copy. A user
 * function with another name whose body calls a renamed function (`G(t) :=
 * 2·Gamma(t)`) gets a copy as well, declared under its own name in the same
 * scope: the compiler reads its body from the definition of its name, and
 * that body must call the private copy. A user function that reaches no
 * shadowing call is not copied, so an expression without such a call is
 * compiled unchanged.
 *
 * Only a PLAIN user function is copied: a function literal, with no
 * `compile` handler, no stated `derivative`, not `lazy`, not
 * `broadcastable`, and no declared effects. The copy holds only the type and
 * the literal, so it would lose any of these. An operator definition must
 * also have the contract of such a copy, field by field (an explicit
 * `missingBehavior`, a `canonical` or `sgn` handler, `idempotent`, …:
 * `copiesFaithfully()`). A function that is not plain keeps its own route
 * (its `compile` handler, or the decline).
 *
 * Not renamed either:
 *
 * - a name in the `vars`, `functions` or `operators` option of the caller:
 *   the caller gives its own value or implementation for it;
 * - a head in `KEPT_HEADS`: the canonical forms and the compiler itself
 *   build nodes of these heads (an `Add` for `x + 1`, the `Multiply` of the
 *   angular-unit rewrite, the `Block` of a statement list), and bind them by
 *   name in the current scope. A rename of the user's own nodes cannot reach
 *   those nodes, so a user definition of such a name keeps the decline of
 *   `shadowedLibraryLoweringError()`;
 * - a multi-clause function: it has no single function literal to copy. It
 *   keeps the decline too.
 *
 * The temporary declarations are made in scratch scopes
 * (`withScratchScope()`), and each one is made with its value, so no value
 * is written to a definition. The declaration of a PRIVATE name is of a new
 * name that shadows nothing outside the computation, so it changes no cache
 * version of the engine. A copy kept under its own name (`G`, which calls
 * a renamed `Gamma`) shadows the user's `G`, which existing expressions can
 * read by name: its declarations keep their advance of the `any` and
 * `callable` axes, and the pop of a scope that holds one is not clean. The
 * renamed calls are built while valueless declarations of the copies exist
 * in a nested scope; the compiler resolves a call by its name, so it reads
 * the final declaration. A rebuilt node that is not renamed keeps its own
 * binding (`withCallableBinding()`) and its form.
 *
 * A decline message names the original function, not the private name.
 */
export function withShadowingCallsRenamed<T>(
  expr: Expression,
  options: {
    readonly vars?: Readonly<Record<string, unknown>>;
    readonly functions?: Readonly<Record<string, unknown>>;
    readonly operators?: unknown;
    readonly symbolDeps?: Set<string>;
  },
  compile: (expr: Expression) => T
): T {
  const ce = expr.engine;
  const system = ce.contextStack[0]?.lexicalScope.bindings;
  if (system === undefined) return compile(expr);
  const callerNames = new Set([
    ...Object.keys(options.vars ?? {}),
    ...Object.keys(options.functions ?? {}),
    ...(typeof options.operators === 'object' && options.operators !== null
      ? Object.keys(options.operators)
      : []),
  ]);
  // The `operators` option can also be a function that answers, for a name,
  // the caller's lowering of it. A name that it answers for is the caller's
  // too: it is not renamed, and a private name is never one of them.
  const operatorsCallback =
    typeof options.operators === 'function'
      ? (options.operators as (name: string) => unknown)
      : undefined;
  const isCallerName = (name: string): boolean =>
    callerNames.has(name) || operatorsCallback?.(name) !== undefined;

  // The user functions reached from `expr`, keyed by the definition that a
  // node is bound to.
  type UserFunction = {
    name: string;
    literal: Expression & FunctionInterface;
    definition: object;
    /** The definition is an operator definition, not a value definition. */
    isOperator: boolean;
    /** The definition is plain (see above) and is not the system binding
     * of its name: a copy of it computes what it computes. */
    copyable: boolean;
    /** A copyable user function with the name of a library operator. */
    shadows: boolean;
    calls: Set<UserFunction>;
    privateName?: string;
  };
  const functions = new Map<object, UserFunction>();
  // Every name that `expr` and the bodies it reaches use: a private name
  // must not be one of them.
  const usedNames = new Set<string>(callerNames);

  /** The user function that the node `e` is bound to, or `undefined`. */
  const boundFunction = (e: Expression): UserFunction | undefined => {
    const name = isSymbol(e)
      ? e.symbol
      : isFunction(e)
        ? e.operator
        : undefined;
    if (name === undefined || isCallerName(name)) return undefined;
    // The binding that the compiler reads for a call (`compileExpr()`): the
    // value definition when it holds a function literal, otherwise the
    // operator definition. A node can have both: a function assigned with
    // `ce.assign()` is held by an operator definition, and the node also has
    // a value definition with no value.
    const valueDefinition = isFunction(e.valueDefinition?.value, 'Function')
      ? e.valueDefinition
      : undefined;
    const definition: object | undefined =
      valueDefinition ?? e.operatorDefinition;
    if (definition === undefined) return undefined;
    let fn = functions.get(definition);
    if (fn !== undefined) return fn;
    const literal = plainLiteral(definition, valueDefinition !== undefined);
    const anyLiteral =
      literal ??
      (valueDefinition !== undefined
        ? valueDefinition.value
        : (definition as { _lambdaLiteral?: Expression })._lambdaLiteral);
    if (anyLiteral === undefined || !isFunction(anyLiteral, 'Function'))
      return undefined;
    const library = system.get(name) as
      { operator?: object; value?: object } | undefined;
    const isSystemBinding =
      library !== undefined &&
      (library.operator ?? library.value) === definition;
    // Whether a copy computes what the definition computes is decided below,
    // and only when the expression has a shadowing call: for an operator
    // definition, it costs a probe declaration (`copiesFaithfully()`).
    const copyable = literal !== undefined && !isSystemBinding;
    fn = {
      name,
      literal: anyLiteral,
      definition,
      isOperator: valueDefinition === undefined,
      copyable,
      shadows: copyable && library !== undefined && !KEPT_HEADS.has(name),
      calls: new Set(),
    };
    functions.set(definition, fn);
    visit(anyLiteral, fn);
    return fn;
  };

  // An expression can share a subtree in several places (a DAG), so each
  // node is read once for each owner: without this, the walk takes a time
  // exponential in the depth of the sharing.
  const visited = new Map<UserFunction | undefined, Set<Expression>>();

  /** Record the user functions that `e` reaches, as calls of `owner`. */
  const visit = (e: Expression, owner: UserFunction | undefined): void => {
    let seen = visited.get(owner);
    if (seen === undefined) visited.set(owner, (seen = new Set()));
    if (seen.has(e)) return;
    seen.add(e);
    if (isSymbol(e)) usedNames.add(e.symbol);
    else if (isFunction(e)) usedNames.add(e.operator);
    const fn = boundFunction(e);
    if (fn !== undefined && owner !== undefined) owner.calls.add(fn);
    if (isFunction(e)) for (const op of e.ops) visit(op, owner);
  };

  visit(expr, undefined);
  if (![...functions.values()].some((fn) => fn.shadows)) return compile(expr);

  // An operator definition is copied as `{ signature, evaluate }`. A field
  // of its contract that such a copy does not reproduce (an explicit
  // `missingBehavior`, a `canonical` or `sgn` handler, `idempotent`, …)
  // would be lost, and the copy would compute something else: such a
  // function is not copied, and keeps its own route.
  for (const fn of functions.values())
    if (fn.copyable && fn.isOperator && !copiesFaithfully(ce, fn.definition)) {
      fn.copyable = false;
      fn.shadows = false;
    }
  if (![...functions.values()].some((fn) => fn.shadows)) return compile(expr);

  // A user function needs a copy when it shadows a library name, or when it
  // is copyable and its body reaches one that does. A function that is not
  // copyable keeps its own definition and its own route.
  const renamed = new Set<UserFunction>(
    [...functions.values()].filter((fn) => fn.shadows)
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const fn of functions.values()) {
      if (renamed.has(fn) || !fn.copyable) continue;
      if ([...fn.calls].some((callee) => renamed.has(callee))) {
        renamed.add(fn);
        grew = true;
      }
    }
  }

  // A function that shadows a library name gets a private name. Another
  // function keeps its own name, declared again in the temporary scope, so
  // the compiled code names it as before. A name that two copies would
  // share (two user functions of one name, from different scopes) is made
  // private too.
  const taken = new Set<string>();
  const originalNames = new Map<string, string>();
  const depsBefore = new Set(options.symbolDeps ?? []);
  // The search for a private name is bounded: a caller's `operators`
  // function can answer for every name. When no name is free, nothing is
  // renamed, and the compiler takes its own route for the expression (it
  // declines a call of a user function with a library name).
  const isFree = (candidate: string): boolean =>
    !taken.has(candidate) &&
    !usedNames.has(candidate) &&
    !isCallerName(candidate) &&
    ce.lookupDefinition(candidate) === undefined;
  const privateNameFor = (name: string): string | undefined => {
    for (const suffix of ['User', 'Copy'])
      for (let k = 1; k <= 64; k++) {
        const candidate = `${name}${suffix}${k === 1 ? '' : k}`;
        if (isFree(candidate)) return candidate;
      }
    return undefined;
  };
  for (const fn of renamed) {
    const candidate =
      !fn.shadows && !taken.has(fn.name) ? fn.name : privateNameFor(fn.name);
    if (candidate === undefined) return compile(expr);
    taken.add(candidate);
    fn.privateName = candidate;
    if (candidate !== fn.name) originalNames.set(candidate, fn.name);
  }

  // A shared subtree is renamed once, and its copies stay shared.
  const renamedNodes = new Map<Expression, Expression>();
  const rename = (e: Expression): Expression => {
    const known = renamedNodes.get(e);
    if (known !== undefined) return known;
    const result = renameNode(e);
    renamedNodes.set(e, result);
    return result;
  };
  const renameNode = (e: Expression): Expression => {
    const fn = boundFunction(e);
    const privateName =
      fn !== undefined && renamed.has(fn) ? fn.privateName : undefined;
    if (isSymbol(e))
      return privateName !== undefined ? ce.symbol(privateName) : e;
    if (!isFunction(e)) return e;
    let changed = false;
    const ops = e.ops.map((op) => {
      const result = rename(op);
      if (result !== op) changed = true;
      return result;
    });
    if (privateName === undefined && !changed) return e;
    // The rebuilt node keeps the form of the node. It does not keep the
    // local scope of a scoped node (a function literal, a `Sum`): the body
    // of a scoped node is bound again in its scope, and the original scope
    // resolves the names through the original definitions, so a call of a
    // copied function in the body would be bound to the original function
    // again. The rebuilt scoped node gets a new scope under the temporary
    // one, as in `rewriteAngularUnit()`.
    const form = e.isCanonical
      ? 'canonical'
      : e.isStructural
        ? 'structural'
        : 'raw';
    if (privateName !== undefined)
      return ce.function(privateName, ops, { form });
    return withCallableBinding(e, () => ce.function(e.operator, ops, { form }));
  };

  // Two scratch scopes, the second inside the first. The outer one holds
  // valueless declarations of the copies while the renamed trees are built,
  // so that a renamed call has the declared type of its function. The inner
  // one holds the copies with their values, and the target compiles in it:
  // the compiler resolves a call by its name, so it reads the copy. The
  // outer scope stays on the stack until the compilation ends, so that the
  // renamed calls stay bound to declarations that are in scope.
  //
  // Both scopes are registered as scratch scopes while the declarations are
  // made, and only then: a declaration that the compilation makes keeps its
  // ordinary effect. The outer one is still registered while the copies are
  // declared. A PRIVATE name then shadows only the valueless declaration of
  // the outer scope, a scratch binding that no expression outside this
  // computation can read: each declaration of a private name advances no
  // cache version of the engine (the `binding-repair` case of
  // `axisMaskOf()`, `engine-configuration-lifecycle.ts`), and when all the
  // copies have private names, the pops of the two scopes are clean and
  // advance nothing either. A copy kept under its own name shadows the
  // user's function outside the computation: its declarations keep their
  // advance, and the pops are not clean.
  ce.pushScope();
  let innerScopePushed = false;
  try {
    let renamedExpr = expr;
    withScratchScope(ce, ce.context.lexicalScope, () => {
      for (const fn of renamed)
        declareCopy(
          ce,
          fn.privateName!,
          fn.definition,
          fn.isOperator,
          fn.literal,
          undefined
        );
      const copies: [UserFunction, Expression][] = [...renamed].map((fn) => [
        fn,
        rename(fn.literal),
      ]);
      renamedExpr = rename(expr);
      ce.pushScope();
      innerScopePushed = true;
      withScratchScope(ce, ce.context.lexicalScope, () => {
        for (const [fn, literal] of copies)
          declareCopy(
            ce,
            fn.privateName!,
            fn.definition,
            fn.isOperator,
            literal,
            literal
          );
      });
    });
    try {
      return compile(renamedExpr);
    } catch (e) {
      // Name the user's function in the message, not its private copy.
      if (e instanceof Error)
        for (const [privateName, name] of originalNames)
          e.message = e.message.replace(
            new RegExp(`\\b${privateName}\\b`, 'g'),
            name
          );
      throw e;
    }
  } finally {
    // The compilation records each user function that the compiled code
    // holds in the caller's `symbolDeps` set. A private name names no
    // definition once the temporary scopes are popped, so a consumer that
    // watches these names for a change (the compiled `Map` of
    // `map-auto-compile.ts`) would not see a change of the user's
    // function, and would keep a stale result. Record the user's name
    // instead. An entry that the caller put in the set is kept.
    const deps = options.symbolDeps;
    if (deps !== undefined)
      for (const [privateName, name] of originalNames)
        if (deps.has(privateName) && !depsBefore.has(privateName)) {
          deps.delete(privateName);
          deps.add(name);
        }
    if (innerScopePushed) ce.popScope();
    ce.popScope();
  }
}

/**
 * The fields of an operator definition that make its contract: the flags
 * and the handlers other than `evaluate`. A copy of a user function declared
 * as `{ signature, evaluate }` must have the same value for each of them.
 */
const CONTRACT_FIELDS = [
  'lazy',
  'scoped',
  'broadcastable',
  'broadcastExemptions',
  'threadsConditionals',
  'inspectsErrors',
  'selectsOperands',
  'evaluatesOperands',
  'namedArgumentsRequired',
  'missingBehavior',
  'missingStrip',
  'nanBehavior',
  'partiality',
  'definedWhen',
  'requires',
  'associative',
  'commutative',
  'commutativeOrder',
  'commutativeMatch',
  'idempotent',
  'involution',
  'pure',
  'effectsDeclared',
  'frameProtocol',
  'invokes',
  'discharges',
  'holdClass',
  'drawsRandom',
  'readsRandomFrame',
  'complexity',
  'type',
  'sgn',
  'eq',
  'neq',
  'canEnumerate',
  'elementCount',
  'inferOperandTypes',
  'canonical',
  'evaluateAsync',
  'evalDimension',
  'derivative',
  'compile',
] as const;

/**
 * True when a copy of the operator definition `definition`, declared as
 * `{ signature, evaluate }` the way `declareCopy()` declares it, has the same
 * contract (`CONTRACT_FIELDS`): a handler is present in both or absent in
 * both, and every other field has the same value.
 *
 * The copy is compared with a probe: the same declaration, of a new name,
 * in a scratch scope that is popped at once. This does not require a list
 * of the default value of each field. A new name in a scratch scope changes
 * no cache version of the engine (`axisMaskOf()`).
 */
function copiesFaithfully(
  ce: Expression['engine'],
  definition: object
): boolean {
  const original = definition as Record<string, unknown> & {
    signature?: { toString(): string };
    _lambdaLiteral?: Expression;
  };
  if (original.signature === undefined || original._lambdaLiteral === undefined)
    return false;
  const signature = original.signature.toString();
  const literal = original._lambdaLiteral;
  ce.pushScope();
  try {
    return withScratchScope(ce, ce.context.lexicalScope, () => {
      let name: string | undefined;
      for (let k = 1; k <= 64 && name === undefined; k++) {
        const candidate = `CopyProbe${k}`;
        if (ce.lookupDefinition(candidate) === undefined) name = candidate;
      }
      if (name === undefined) return false;
      try {
        ce.declare(name, { signature, evaluate: literal });
      } catch {
        return false;
      }
      const probe = (
        ce.lookupDefinition(name) as
          { operator?: Record<string, unknown> } | undefined
      )?.operator;
      if (probe === undefined) return false;
      return CONTRACT_FIELDS.every((field) =>
        sameContractField(original[field], probe[field])
      );
    });
  } finally {
    ce.popScope();
  }
}

/** Two values of a field of `CONTRACT_FIELDS` are the same: two handlers
 * (functions) are the same when both are present, other values when their
 * JSON forms are equal. */
function sameContractField(a: unknown, b: unknown): boolean {
  if (typeof a === 'function' || typeof b === 'function')
    return typeof a === 'function' && typeof b === 'function';
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * The function literal of a PLAIN user function definition (see
 * `withShadowingCallsRenamed()`), or `undefined`.
 */
function plainLiteral(
  definition: object,
  isValueDefinition: boolean
): (Expression & FunctionInterface) | undefined {
  const d = definition as {
    value?: Expression;
    _lambdaLiteral?: Expression;
    compile?: unknown;
    derivative?: unknown;
    lazy?: boolean;
    broadcastable?: boolean;
    effectsDeclared?: boolean;
  };
  if (d.effectsDeclared === true) return undefined;
  const literal = isValueDefinition ? d.value : d._lambdaLiteral;
  if (literal === undefined || !isFunction(literal, 'Function'))
    return undefined;
  if (
    !isValueDefinition &&
    (d.compile !== undefined ||
      d.derivative !== undefined ||
      d.lazy === true ||
      d.broadcastable === true)
  )
    return undefined;
  return literal;
}

/**
 * Declare `name` in the current scope with the type of the user function
 * definition `definition`, and with the value `value` when it is given. The
 * type is `function` when the type of the definition cannot be declared
 * again.
 *
 * A declaration with no value (the declaration that the renamed calls are
 * built against) must still give each call the type that a call of the
 * user function has. When the definition declares no signature (`declare(
 * name, 'function')`), a call of the user function has the result type of
 * its function literal, so the declaration uses the type of the literal
 * `literal`: with the bare type `function`, the call was typed `unknown`,
 * and the compiler read it as a value that can be a list.
 *
 * The declaration is of the same kind as the definition: an operator
 * definition (`f(x) := …`, or `ce.assign` of a function literal) is copied
 * as an operator definition, with the copy as its `evaluate` handler. A call
 * is bound both to a value definition and to an operator definition of its
 * name; a value declaration of a copy kept under the original name left the
 * calls bound to the original operator definition, and the compiler then
 * declined them, because that definition is not the one in scope.
 */
function declareCopy(
  ce: Expression['engine'],
  name: string,
  definition: object,
  isOperator: boolean,
  literal: Expression,
  value: Expression | undefined
): void {
  const d = definition as {
    type?: { toString(): string };
    signature?: { toString(): string };
  };
  let type = (isOperator ? d.signature : d.type)?.toString() ?? 'function';
  if (value === undefined && !type.includes('->'))
    type = literal.type.toString();
  const declaration = (t: string) =>
    isOperator
      ? value === undefined
        ? { signature: t }
        : { signature: t, evaluate: value }
      : value === undefined
        ? { type: t }
        : { type: t, value };
  try {
    ce.declare(name, declaration(type));
  } catch {
    ce.declare(name, declaration('function'));
  }
}

/**
 * The heads that a user function is not renamed for (see
 * `withShadowingCallsRenamed()`): the control-flow and structural heads,
 * and the operators that the canonical forms and the compiler build by name.
 */
const KEPT_HEADS: ReadonlySet<string> = new Set([
  'Sequence',
  'Sum',
  'Product',
  'Function',
  'Declare',
  'Assign',
  'Return',
  'Break',
  'Continue',
  'Loop',
  'Comprehension',
  'If',
  'Which',
  'When',
  'Match',
  'Block',
  'Apply',
  'Typed',
  'Spread',
  'IsMissing',
  'Coalesce',
  'AssertPresent',
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Equal',
  'NotEqual',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'And',
  'Or',
  'Not',
  'Xor',
  'Nand',
  'Nor',
  'Implies',
  'Equivalent',
]);
