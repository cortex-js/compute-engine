// Emission of function definitions: multi-clause functions, parameter guards,
// definition bodies, builtin callbacks and the helpers preamble.

import { shadowsLibraryName } from '../library-shadowing.js';
import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { recordScalarParams as recordScalarParams__ } from './javascript-value-facts.js';
import { javascriptStatements } from './javascript-statements.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { isNonRealNumber } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { listRecursionPlan } from '../boxed-expression/recursive-list-builder.js';
import { multiClauseState, type FunctionClause } from '../multi-clause.js';
import { isMoreSpecific } from '../boxed-expression/overload.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  builtinCallbackArity,
  builtinOperatorDefinition,
  isHostOperatorCallback,
  operatorCallbackArity,
} from './builtin-callback.js';
import { assertValidCompileHelpers } from '../boxed-expression/compile-helpers-check.js';
import { isEngineCompileHandler } from './engine-compile-handlers.js';
import { possiblyCollectionTypedForCompile } from './compiler-type-facts.js';
import type { DeclineNote, UserFunctionLanes } from './compiler-types.js';
import {
  LOCAL_SCALAR,
  assertNoDestructuringParams,
  assertNoRestParams,
  complexDiscipline,
  withEnforcedParams,
} from './compile-declarations.js';
import {
  CONTROL_FLOW_HEADS,
  NAMED_LOWERING_HEADS,
  OVERRIDABLE_CONTROL_FLOW_HEADS,
} from './compiler-tables.js';
import { CompilerState } from './compiler-state.js';
import { core } from './compiler-core-hooks.js';
import {
  broadcastingWrapper,
  checkingShimTests,
  declaredParamType,
  jsClauseParamGuard,
  laneRequestParamType,
  literalDeclaredParamTypes,
} from './compile-callbacks.js';
import {
  definitionBodyExpr,
  mergeUsedNames,
  userFunctionName,
  withNestedCseHarvest,
} from './compile-cse.js';
import { tempVar, withBoundScope } from './compiler-naming.js';
import { collectUsedNames } from './compiler-names.js';
import {
  signatureParamType,
  userFunctionParamsAreScalar,
} from './compile-assignment-checks.js';
import { userFunctionSignature } from './compile-absence.js';
import {
  liftPromotionSuppression,
  restorePromotionSuppression,
} from './compiler-mode.js';
import { hideCheckedLocals } from './compile-locals.js';
import { branchComplexCoercion } from './compile-shapes.js';
import { isContradictedScalarFunctionBody } from './compile-conditions.js';

/** Whether the value of `e` may be a collection, by its type. */
export function mayBeCollectionValued(e: Expression): boolean {
  return (
    e.type.matches('collection<any>') || possiblyCollectionTypedForCompile(e)
  );
}

/** The lane records of the compilation that owns `registry`. */
export function userFunctionLanes(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>
): UserFunctionLanes {
  let lanes = _userFunctionLanes.get(registry);
  if (lanes === undefined) {
    lanes = {
      byName: new Map(),
      byNode: new WeakMap(),
      onAsk: new Set(),
      assumedReal: new Set(),
      assumedComplex: new Set(),
      assumedRealElements: new Set(),
      assumedComplexElements: new Set(),
      elementByName: new Map(),
    };
    _userFunctionLanes.set(registry, lanes);
  }
  return lanes;
}

/**
 * The lane records, per user-function registry. A registry lives for one
 * compilation, so its records do too.
 */
export const _userFunctionLanes = new WeakMap<
  NonNullable<CompileTarget<Expression>['userFunctions']>,
  UserFunctionLanes
>();

/**
 * Remove from `registry` the definitions that are not in `before`, with
 * their lane records. Used when the compilation that emitted them is
 * abandoned: they can call the definition whose compilation failed or is
 * redone, and the compiled code must not keep a call of a definition
 * that is never emitted.
 */
export function removeDefinitionsAddedSince(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  before: ReadonlySet<string>
): void {
  const lanes = userFunctionLanes(registry);
  for (const added of [...registry.defs.keys()]) {
    if (before.has(added)) continue;
    registry.defs.delete(added);
    registry.literals?.delete(added);
    registry.memoizable?.delete(added);
    // A hoisted constant list literal (`hoistConstantListLiteral`) is
    // found again by its text: without this, the next occurrence of the
    // literal would read a local whose declaration was removed here.
    registry.hoistable?.delete(added);
    if (registry.listLiterals !== undefined)
      for (const [text, name] of registry.listLiterals)
        if (name === added) registry.listLiterals.delete(text);
    lanes.byName.delete(added);
    lanes.elementByName.delete(added);
    lanes.onAsk.delete(added);
  }
}

/** Store the lane `lane` of the definition `name` of `id`, and check
 * `scalarComplex`, whether the scalar that the definition computes is
 * complex, against a recursive call read as real: see
 * `recordUserFunctionLane`. */
export function setUserFunctionLane(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  id: string,
  name: string,
  lane: boolean | undefined,
  scalarComplex: boolean = lane === true
): void {
  const lanes = userFunctionLanes(registry);
  // The first compilation read a recursive call as real, and the body is
  // complex. The emission of the definition catches this error and
  // compiles the body again with the recursive calls read as complex
  // (`emitWithRecursiveLaneRetry`).
  if (
    scalarComplex &&
    lanes.assumedReal.has(name) &&
    !lanes.assumedComplex.has(name)
  ) {
    const retry = new Error(`${id}: recompile with complex recursive calls`);
    retry.name = 'RecursiveLaneRetry';
    (retry as Error & { definition?: string }).definition = name;
    throw retry;
  }
  // A second compilation that read the recursive calls as complex must
  // produce a complex body. When it does not, the value of a recursive
  // call has no consistent lane. (Under `mode: 'complex'` a real value
  // read as complex is lifted where it is used, so there is no conflict.)
  if (!scalarComplex && lanes.assumedComplex.has(name) && !complexDiscipline())
    throw new Error(
      `Could not compile \`${id}\`: a recursive call of \`${id}\` in its body ` +
        `has a type that does not say whether it returns a real or a ` +
        `complex value, and neither reading gives a body with the same ` +
        `lane. Declare the signature of \`${id}\`, for example ` +
        `\`${id}: (real) -> complex\` or \`${id}: (real) -> real\`.`
    );
  lanes.byName.set(name, lane);
}

/**
 * The error message when `head` names a library operator that a user
 * definition shadows (`shadowsLibraryName()`) and the compiler would lower
 * it as the library operator: the target maps it (`target.functions`,
 * `target.operators`), or the compiler lowers it by name in its own code
 * (`NAMED_LOWERING_HEADS`, such as `If`, `Loop`, `Sum` and `Block`).
 * `undefined` when the head can be compiled.
 *
 * A shadowing definition with its own `compile` handler is exempt when the
 * compiler consults that handler (`compileExpr`): for every head except
 * the control-flow heads, which only `OVERRIDABLE_CONTROL_FLOW_HEADS`
 * makes overridable. An unchanged copy of the library definition
 * (`keepsLibraryOperator()`) is not a shadow, so it compiles as the
 * library operator.
 */
export function shadowedLibraryLoweringError(
  engine: ComputeEngine,
  head: string,
  target: CompileTarget<Expression>
): string | undefined {
  if (
    !NAMED_LOWERING_HEADS.has(head) &&
    target.functions?.(head) === undefined &&
    target.operators?.(head) === undefined
  )
    return undefined;
  if (!shadowsLibraryName(engine, head, { customLibrary: false }))
    return undefined;
  const shadow = engine.lookupDefinition(head);
  const handlerConsulted =
    !CONTROL_FLOW_HEADS.has(head) || OVERRIDABLE_CONTROL_FLOW_HEADS.has(head);
  if (
    handlerConsulted &&
    isOperatorDef(shadow) &&
    shadow.operator.compile !== undefined
  )
    return undefined;
  return (
    `Could not compile \`${head}\`: a user definition shadows the library ` +
    `operator \`${head}\`, and the compiler lowers \`${head}\` as the ` +
    `library operator. The interpreter evaluates it instead.`
  );
}

/**
 * Compile the `Block` `block`, whose value is consumed whole as a
 * collection value (the compilation root on the interval target). The
 * last statement of the block is offered to
 * `target.compileCollectionValue` first, in the scope of the block, where
 * its block-local functions are known. A target with no ordinary lowering
 * for a collection literal (the interval target has none for `Tuple` or
 * `List`) can then compile a block whose value is a tuple:
 * `(h := (u: real) ↦ 2u; h((1, 2)))` is an array of enclosures. A last
 * statement that the target does not spell (a scalar) compiles the
 * ordinary way, so the code is then the same as `compile(block)`.
 */
export function compileCollectionValueBlock(
  block: Expression,
  target: CompileTarget<Expression>
): TargetSource {
  const previous = CompilerState._collectionValueBlock;
  CompilerState._collectionValueBlock = block;
  try {
    return core.compile(block, target);
  } finally {
    CompilerState._collectionValueBlock = previous;
  }
}

/**
 * A fresh `localFunctions` scope for a statement list: a MUTABLE copy of the
 * enclosing map, which `noteLocalFunction` fills in statement order as the
 * list is emitted. See `CompileTarget.localFunctions` for what the map is
 * for, and `compileBlock` for why it is filled progressively rather than up
 * front (a binding must not be resolvable before its own `let` has run).
 *
 * Returns `undefined` for a target that does not bind a function-valued
 * local as a value (`bindsLocalFunctions`: the GPU targets): there the
 * declaration and its assignment are separate statements with a declared
 * scalar type, so a function-valued local has no binding a call could
 * reach — those targets must keep failing closed rather than emit a call
 * to a name they never bound.
 */
/**
 * The parameter names a function literal EMITS, and the `var` hook that
 * resolves its parameters to them.
 *
 * Normally the two coincide — a parameter compiles to its own name. They
 * differ when a parameter would SHADOW the target's vars object
 * (`CompileTarget.varsObjectName`): the JavaScript family binds free
 * symbols through `_`, and `_` is also how an implicit lambda parameter is
 * spelled, so `_ => _ + k` emitted `((_) => _ + _.k)` — inside the arrow
 * `_` is the parameter, so `_.k` read a property off a number and the call
 * answered `NaN` behind `success: true`. Such a parameter is renamed to a
 * generated name that the literal's other parameters and the compilation's
 * used-name set do not claim; the body's reads follow through the returned
 * hook, so the rename is invisible to everything else.
 *
 * The rename is deliberately confined to the collision: every other literal
 * emits byte-identical source to before.
 */
export function lambdaParamBinding(
  params: ReadonlyArray<string>,
  body: Expression | undefined,
  target: CompileTarget<Expression>
): { emitted: string[]; varOf: (id: string) => TargetSource | undefined } {
  const keep = {
    emitted: [...params],
    varOf: (id: string) => (params.includes(id) ? id : target.var(id)),
  };

  // Which of this literal's parameters shadow something the target bakes
  // into the emitted source. Two sources, with DIFFERENT rename conditions:
  const shadowing = new Set<string>();

  // (1) A runtime helper namespace (`_SYS`, `_IA` —
  //     `CompileTarget.reservedEmittedNames`). Renamed UNCONDITIONALLY: no
  //     source spells a parameter this way, so the rename costs nothing and
  //     does not have to predict which helpers the body will emit. Left
  //     alone, a parameter named `_SYS` turned every `_SYS.…` lowering
  //     inside its body into `TypeError: _SYS.rangeIter is not a function`.
  for (const p of params)
    if (target.reservedEmittedNames?.has(p)) shadowing.add(p);

  // (2) The vars object (`_`). Renamed only when the body actually READS it:
  //     `_` is the ordinary spelling of an implicit parameter, so renaming
  //     it unconditionally would rewrite every `_ ↦ …` literal in every
  //     artifact — `((_) => (_ * _))` and its like — for no behavioural
  //     gain. `unknowns` is the same set the JavaScript target's `var` hook
  //     keys its `_.<id>` emission on, so it decides the collision
  //     precisely; the body's own parameters appear there (nothing binds
  //     them in the body expression alone) and are filtered out.
  const varsObject = target.varsObjectName;
  if (varsObject !== undefined && params.includes(varsObject)) {
    const prefix = `${varsObject}.`;
    const readsVarsObject = (body?.unknowns ?? []).some(
      (s) => !params.includes(s) && target.var(s)?.startsWith(prefix) === true
    );
    if (readsVarsObject) shadowing.add(varsObject);
  }

  if (shadowing.size === 0) return keep;

  const taken = (name: string): boolean =>
    params.includes(name) || target.naming?.usedNames.has(name) === true;
  const renamed = new Map<string, string>();
  const allocated = new Set<string>();
  let n = 0;
  for (const p of shadowing) {
    let fresh = '_p';
    while (taken(fresh) || allocated.has(fresh)) fresh = `_p${++n}`;
    allocated.add(fresh);
    target.naming?.usedNames.add(fresh);
    renamed.set(p, fresh);
  }

  return {
    emitted: params.map((p) => renamed.get(p) ?? p),
    varOf: (id) =>
      params.includes(id) ? (renamed.get(id) ?? id) : target.var(id),
  };
}

export function addDeclaredComplexParams(
  h: string,
  literal: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  frames: { complex: Map<string, boolean>; vector: Map<string, number> }
): void {
  // The `{ re, im }` representation is a JavaScript convention, and BOTH
  // call-site coercions bail on any other language — so the body-side lane
  // must too, or a target that never wraps its arguments (interval-javascript
  // reaches this same arrow emission) would compile the body against an
  // object it is never handed.
  if (target.language !== 'javascript') return;
  const engine = literal.engine as unknown as ComputeEngine;
  literal.ops.slice(1).forEach((p, i) => {
    const name = functionLiteralParameterName(p);
    if (!name) return;
    const pt = laneRequestParamType(engine, h, i);
    if (pt === undefined) return;
    // A parameter the signature declares REAL is real in the body. The
    // stored literal does not carry the declared type of a scalar
    // parameter (its parameter types `unknown`), so without this entry
    // `mode: 'complex'` read the parameter as wide, hence complex, and
    // lifted it: `f: (real) -> matrix<real>`, `f := t ↦ [[t, 1], [2, 3]]`
    // emitted `[[_SYS.cplx(t), 1], [2, 3]]`, while a parent read the call
    // with the real lane of its declared type. The argument of a call is
    // real too: a use of a symbol as the argument narrows the symbol to
    // `real`, and the compiled function checks at entry that its value is
    // not a `{re, im}` object.
    if (isSubtype(pt, 'real')) {
      frames.complex.set(name, false);
      return;
    }
    if (!isNonRealNumber(pt)) return;
    frames.complex.set(name, true);
    frames.vector.set(name, LOCAL_SCALAR);
  });
}

/**
 * If `s` names an eta-expandable BUILT-IN operator, synthesize the wrapper
 * `(p₁ … pₙ) ↦ s(p₁ … pₙ)`, emit it once into `target.userFunctions.defs`
 * and return that shared local name — so a built-in operator name used as a
 * higher-order operand (`Map(Sin, xs)`, `CountIf(xs, IsPrime)`) is a real
 * function VALUE rather than a dangling `_.Sin`.
 *
 * Eligibility (both halves in `builtin-callback.ts`, shared with the CSE
 * admission test): the name resolves to the engine-authored system-scope
 * definition by object identity, and its signature has a FIXED arity
 * (`n ≥ 1` required parameters, no optional or variadic tail). Everything
 * else — a user definition shadowing the name, a variadic operator like
 * `Add`, an optional-tail one like `Ln` or `Random` — answers `undefined`
 * and leaves the caller's previous behavior untouched.
 *
 * The wrapper BODY is an ordinary application, so a caller `functions` /
 * `operators` override of that operator applies inside it — the same
 * semantics an inline `x ↦ Sin(x)` callback has.
 *
 * Parameter names are drawn from the compilation's temp-name counter
 * (`_tv1`, …), which already skips every name the artifact uses, so the
 * synthesized wrapper can capture nothing.
 *
 * What the caller receives is the BROADCAST-AWARE name where the built-in
 * is element-wise (`builtinCallbackValueRef`), because the synthesized body
 * is written for scalars only.
 *
 * `hostArity` is the arity of an operator that the host declared, for
 * `ensureHostOperatorCallbackEmitted()`: it replaces the eligibility check
 * of a built-in.
 */
export function ensureBuiltinCallbackEmitted(
  engine: ComputeEngine,
  s: string,
  target: CompileTarget<Expression>,
  hostArity?: number
): string | undefined {
  const registry = target.userFunctions;
  if (!registry) return undefined;

  // Already emitted (a repeated reference): share the one definition, and
  // in particular do NOT draw fresh temp names for it.
  const name = userFunctionName(registry, s);
  if (registry.defs.has(name))
    return builtinCallbackValueRef(engine, s, name, target);

  const arity = hostArity ?? builtinCallbackArity(engine, s);
  if (arity === undefined) return undefined;

  const params: Expression[] = [];
  for (let i = 0; i < arity; i++) params.push(engine.symbol(tempVar(target)));
  const literal = engine.function('Function', [
    engine.function(s, params),
    ...params,
  ]);
  // A built-in whose canonicalization refuses symbolic arguments would
  // yield an error body: fail closed rather than emit it.
  if (!isFunction(literal, 'Function') || !literal.isValid) return undefined;

  const emitted = core.emitFunctionLiteralDefinition(
    s,
    literal,
    target,
    registry
  );
  if (emitted === undefined) return undefined;
  return builtinCallbackValueRef(engine, s, emitted, target);
}

/**
 * If `s` names an operator that the host declared (`isHostOperatorCallback`)
 * and that the compiled code can apply — its definition has a `compile`
 * handler, or the target has a lowering for `s` (the `functions` option of
 * `compile()`) — synthesize the wrapper `(p₁ … pₙ) ↦ s(p₁ … pₙ)` as
 * `ensureBuiltinCallbackEmitted()` does, and return its shared local name.
 * The body is an application of `s`, so it compiles through that lowering.
 *
 * `undefined` when there is no such lowering, when the signature has no
 * fixed arity (`operatorCallbackArity()`), or when `s` shadows a library
 * name that the compiler would lower as the library operator
 * (`shadowedLibraryLoweringError()`): the lowering of the target is then
 * the library one, which does not compute what the shadow computes.
 */
export function ensureHostOperatorCallbackEmitted(
  engine: ComputeEngine,
  s: string,
  target: CompileTarget<Expression>
): string | undefined {
  const def = engine.lookupDefinition(s);
  if (!isOperatorDef(def)) return undefined;
  if (def.operator.compile === undefined && target.functions?.(s) === undefined)
    return undefined;
  if (shadowedLibraryLoweringError(engine, s, target)) return undefined;
  const arity = operatorCallbackArity(def.operator);
  if (arity === undefined) return undefined;
  return ensureBuiltinCallbackEmitted(engine, s, target, arity);
}

/**
 * The name under which the eta-expanded built-in `s` is handed to a consumer
 * of a function VALUE: the broadcast-aware wrapper when the operator is
 * element-wise, and the plain `name` otherwise.
 *
 * The synthesized body applies the operator to SCALARS — `(_tv1) =>
 * Math.sin(_tv1)` — while the consumers of a function value hand the callee
 * whatever element they hold. An element that is itself a collection was
 * therefore passed straight into a scalar kernel: `Map(Sin, xs)` over
 * `[[1, 2], [], [3]]` answered `[NaN, 0, 0.141…]` behind `success: true`,
 * because `Math.sin` coerces an array through `Number`. The interpreter
 * applies the operator's own broadcast to such an element, so
 * `Sin([1, 2])` is `[sin 1, sin 2]`.
 *
 * The runtime helper is `_SYS.bcast`, the OPERATOR broadcast, not the
 * `_SYS.bcastFn` a user function gets. The two answer alike today; the
 * names stay apart so the emitter keeps saying which form it lowers.
 *
 * Only an element-wise operator is wrapped. A built-in that consumes its
 * argument WHOLE — `Length`, `Sum`, `Min` over a list — is not broadcast by
 * the interpreter either, and keeps the bare name so a collection element
 * still reaches its kernel intact.
 *
 * An operator that the host declared (`isHostOperatorCallback`,
 * `ensureHostOperatorCallbackEmitted()`) follows the same rule, with the
 * `broadcastable` flag and the arity of its own definition: the
 * interpreter broadcasts it as it broadcasts a built-in, and its `compile`
 * handler or its lowering is written for scalars too.
 */
export function builtinCallbackValueRef(
  engine: ComputeEngine,
  s: string,
  name: string,
  target: CompileTarget<Expression>
): string {
  // The `{ re, im }` convention and the `_SYS` runtime are JavaScript ones,
  // so a target with its own definition lowering emits the bare name.
  if (target.language !== 'javascript') return name;
  const registry = target.userFunctions;
  if (!registry) return name;
  let opDef = builtinOperatorDefinition(engine, s);
  if (opDef === undefined && isHostOperatorCallback(engine, s)) {
    const def = engine.lookupDefinition(s);
    if (isOperatorDef(def)) opDef = def.operator;
  }
  if (opDef?.broadcastable !== true) return name;
  const arity = operatorCallbackArity(opDef);
  if (arity === undefined) return name;

  const bcastName = `${name}$b`;
  if (!registry.defs.has(bcastName))
    registry.defs.set(
      bcastName,
      `const ${bcastName} = ${broadcastingWrapper(
        name,
        arity,
        target,
        'bcast'
      )};`
    );
  return bcastName;
}

/**
 * Emit `h` as a LOOP over the step of its list-building recursion, when
 * `listRecursionPlan` recognizes the definition — `F(n) = Which(n = K,
 * [g(n)], True, Join([g(n)], F(n + 1)))` and its relatives (any step,
 * several numeric parameters, several guards, different base lists) — and
 * return the emitted name. The natively recursive arrow overflows the
 * JavaScript call stack near 5,000 levels (a catchable `RangeError`); the
 * loop builds a 10,000-element list in milliseconds. The interpreter runs
 * the same plan (`evaluateListRecursion`, `boxed-expression/recursive-
 * list-builder.ts`), and the run-time loop (`_SYS.listRecursion`) caps its
 * iterations at `engine.iterationLimit` exactly as the interpreter does,
 * so a definition with no reachable base case reports the iteration-limit
 * error on both routes.
 *
 * The step is the same `Which` with each arm returning `Tuple(0, list)`
 * or `Tuple(1, prefix, Tuple(nextArgs))` and no self-call. It compiles as
 * the body of a synthetic literal over the ORIGINAL parameters through the
 * ordinary definition-body preparation, so every lowering the recursive
 * body would have received (nested call inlining, angular-unit rewrite,
 * parameter binding and renaming) applies to it unchanged. The synthetic
 * literal is built with `_fn`, not `engine.function`: its pieces are the
 * literal's own canonical nodes, bound in the literal's scope, and a
 * canonicalization would rebind the parameter symbols in a fresh scope.
 * The compiler binds parameters from the parameter list
 * (`prepareUserFunctionBody`), never from the block's scope, and the plan
 * admits no statement that declares a local, so the missing block scope
 * is never read.
 *
 * Returns `undefined`, and the caller emits the ordinary recursive arrow,
 * when:
 *  - the target is not plain JavaScript (the shader targets forbid
 *    recursion and fail closed; Python has no definition lowering);
 *  - the caller overrides `Which`, `Tuple`, `Join`, `ListJoin` or `List`
 *    (`target.unrollSkipHeads`): the step is built from `Tuple` control
 *    records and drops the body's `Join`, so an override of those heads
 *    would replace the records or lose the caller's implementation;
 *  - a parameter is declared complex: a call site coerces a complex
 *    argument to its `{re, im}` object, and the loop hands the next
 *    arguments to the step without a call site in between;
 *  - a guard is not a scalar boolean: a collection-typed guard selects
 *    elementwise (`_SYS.select`), whose result is an array of control
 *    records the loop cannot read as one.
 *
 * A parameter declared `real` or `integer` (or another type with a
 * run-time test, `checkedParameterType`) is tested at each step, as the
 * recursive call tests it through the checking shim (`checkingShimName`).
 * The first step is tested too, also when the call site did not test the
 * argument because its static type proves the parameter type: the step
 * cannot tell the first arguments from the next ones. For an argument
 * that has its static type the test passes, so the first step gives the
 * value the call gives without it. An argument that breaks its own
 * static type (a `run()` value `Infinity` for a symbol declared `real`,
 * which the interpreter refuses to assign) gives `NaN` where the
 * recursive arrow ran the body. The step receives the real projection of
 * each tested argument, and a step whose arguments fail a test gives
 * `NaN`, the value the shim gives (`NaN` itself passes the test of a
 * numeric parameter, `jsParameterGuard`). The runtime loop then gives
 * `undefined` for the whole call, at the first step and at a later one:
 * the value compiled code has for a list with no value, where the
 * interpreter answers the `incompatible-type` error.
 *
 * Returns `'declined-variant'` when the requested emission is an
 * invariant-prefix VARIANT of a recognized recursion: no variant is
 * emitted, so the call site falls back to the ordinary call and reaches
 * the loop definition. The prefix is then computed once per step inside
 * the loop, which is what the loop does anyway; the recursive arrow the
 * variant would have carried is the form that overflows.
 */
export function emitListRecursionLoop(
  h: string,
  name: string,
  literal: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  variant: boolean
): string | 'declined-variant' | undefined {
  if (target.language !== 'javascript') return undefined;
  const overridden = target.unrollSkipHeads;
  if (
    overridden !== undefined &&
    ['Which', 'Tuple', 'Join', 'ListJoin', 'List'].some((head) =>
      overridden.has(head)
    )
  )
    return undefined;
  const plan = listRecursionPlan(literal);
  if (plan === undefined) return undefined;
  if (variant) return 'declined-variant';
  const frames = {
    complex: new Map<string, boolean>(),
    vector: new Map<string, number>(),
  };
  addDeclaredComplexParams(h, literal, target, frames);
  // A parameter declared real has an entry too, with the value `false`.
  if ([...frames.complex.values()].some((complex) => complex)) return undefined;
  const step = plan.step;
  if (!isFunction(step, 'Which')) return undefined;
  for (let i = 0; i < step.nops; i += 2)
    if (!step.ops[i].type.matches('boolean')) return undefined;
  const engine = literal.engine as unknown as ComputeEngine;
  const stepLiteral = engine._fn('Function', [
    engine._fn('Block', [step]),
    ...literal.ops.slice(1),
  ]);
  if (!isFunction(stepLiteral, 'Function') || !stepLiteral.isValid)
    return undefined;
  const prepared = prepareUserFunctionBody(stepLiteral, target, registry, h);
  recordScalarParams(h, literal, prepared.bodyTarget);
  const stepBody = core.withLocalShapeFrame(
    frames.complex,
    frames.vector,
    () =>
      withEnforcedParams(literal, () =>
        withNestedCseHarvest(
          prepared.bodyExpr,
          prepared.bodyTarget,
          prepared.params,
          () => core.compile(prepared.bodyExpr, prepared.bodyTarget)
        )
      ),
    true
  );
  const statements = javascriptStatements(prepared.bodyTarget);
  const params = prepared.params.join(', ');
  const stepArrow = statements?.has(stepBody)
    ? `(${params}) => { ${statements.functionBody(stepBody)} }`
    : `(${params}) => ${stepBody}`;
  const {
    params: tested,
    passed,
    tests,
  } = checkingShimTests(engine, h, prepared.params.length, target);
  const stepName = `${name}$s`;
  const checkedStep =
    tests.length === 0
      ? stepArrow
      : `(${tested.join(', ')}) => (${tests.join(' && ')}) ? ` +
        `${stepName}(${passed.join(', ')}) : NaN`;
  (registry.literals ??= new Map()).set(name, literal);
  registry.defs.set(
    name,
    (tests.length === 0 ? '' : `const ${stepName} = ${stepArrow};\n`) +
      `const ${name} = (${params}) => _SYS.listRecursion(` +
      `${JSON.stringify(h)}, [${params}], ${checkedStep});`
  );
  return name;
}

export function prepareUserFunctionBody(
  literal: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  h?: string
): {
  params: string[];
  bodyExpr: Expression;
  bodyTarget: CompileTarget<Expression>;
} {
  assertNoDestructuringParams(literal.ops.slice(1));
  assertNoRestParams(literal.ops.slice(1));
  const declared = literal.ops
    .slice(1)
    .map((x) => functionLiteralParameterName(x) || '_');
  const bodyExpr = definitionBodyExpr(literal, target, registry, h);
  const root = registry.root ?? target;
  // The SAME parameter-shadowing rule as the inline lambda lowering, through
  // the same helper. This site builds the identical `(params) => body` shape
  // for the emitted-definition route (`f(x) := …`, and each clause of a
  // multi-clause set), so without it an engine-defined function with a `_`
  // parameter stayed silently wrong — `f := _ ↦ _ + k` called with `k = 10`
  // computed NaN — while the inline route had been fixed. Note the fallback
  // name above is `_` itself, so a parameter that yields no name defaults
  // INTO the colliding spelling rather than merely being allowed to use it.
  const binding = lambdaParamBinding(declared, bodyExpr, root);
  const params = binding.emitted;
  const bodyTarget: CompileTarget<Expression> = {
    ...root,
    var: binding.varOf,
    // The literal's OWN parameter names — what the body expression binds,
    // whatever they are emitted as.
    ...withBoundScope(root, declared),
    // The parameters' DECLARED types, for the lowerings that read a raw
    // (never-bound) symbol — the bare-`Field` protocol property GET tier,
    // whose receiver types `unknown` in the canonical body because nothing
    // has bound the parameter yet. Fresh per
    // definition (module-level semantics: the requester's map must not
    // leak in), replacing whatever the spread copied from `root`.
    declaredVarTypes: literalDeclaredParamTypes(literal),
  };
  mergeUsedNames(target, collectUsedNames(bodyExpr));
  bodyTarget.checkDefinitionBody?.(bodyExpr, bodyTarget, true);
  return { params, bodyExpr, bodyTarget };
}

/**
 * Record, for the body about to compile under `bodyTarget`, which of `h`'s
 * parameters hold a run-time SCALAR. A call that passes such a parameter on
 * then compiles as a direct call instead of a runtime broadcast dispatch.
 * (The Tycho code-generation audit of 2026-09-08 measured 297 broadcast
 * dispatches inside function bodies.)
 *
 * The condition is a property of the FUNCTION, not of one parameter: every
 * parameter of `h` must be scalar in the sense `userFunctionParamsAreScalar`
 * reads — no parameter binds a collection, a tuple or a point whole. When
 * that holds, EVERY parameter of `h` holds a run-time scalar, and all of
 * them are recorded, whether the author annotated the parameter, the engine
 * inferred a scalar type for it, or the type stayed `unknown` (user rulings
 * 2026-09-08 and 2026-09-09).
 *
 * The reason is that the body never chooses what reaches it — its call
 * sites do, and they are all broadcast-aware. A call whose argument is not
 * provably a scalar is dispatched element-wise (`_SYS.bcastFn`) or guarded
 * by `Array.isArray`, so the body runs once per element with a scalar
 * bound; a function REFERENCED AS A VALUE is handed out through a
 * broadcasting or guarding wrapper for the same reason. The only call form
 * that passes an argument straight through is the one an explicit caller
 * declaration already exempts, and a caller that hands that form a list has
 * broken its own declared contract. The body's own arithmetic already
 * assumes this: `f(x) := x * x` computes a product, not a Hadamard product
 * it wrote itself.
 *
 * A definition with a parameter that binds its argument whole — the
 * collection parameter of `k(L) := Sum(L)` — makes
 * `userFunctionParamsAreScalar` false and records nothing, because such a
 * call site emits a bare direct call and may hand a list to a scalar
 * sibling parameter.
 */
export function recordScalarParams(
  h: string,
  literal: Expression & FunctionInterface,
  bodyTarget: CompileTarget<Expression>
): void {
  if (bodyTarget.language !== 'javascript') return;
  const engine = literal.engine as unknown as ComputeEngine;
  if (!userFunctionParamsAreScalar(engine, h)) return;
  const signature = userFunctionSignature(engine, h);
  const names = new Set<string>();
  literal.ops.slice(1).forEach((p, i) => {
    const name = functionLiteralParameterName(p);
    if (!name) return;
    const t = declaredParamType(p) ?? signatureParamType(signature, i);
    // Two parameter types are left out. `never` admits no value at all. A
    // FUNCTION type is a higher-order callback slot, which
    // `paramsAreScalar` exempts from its scalar test rather than proves
    // scalar — its value is a function, and nothing downstream should read
    // it as a number.
    if (t === 'never') return;
    if (t !== undefined && isSubtype(t, 'function')) return;
    names.add(name);
  });
  recordScalarParams__(bodyTarget, names);
}

/**
 * Emit a **multi-clause** user function (function-polymorphism design §8)
 * as a guard chain: one helper definition per clause plus a variadic
 * dispatcher that tests the clauses in the **deterministic linearization**
 * — more specific first, declaration order breaking ties, the same total
 * order the runtime selector induces — and throws `no-matching-clause`
 * (D7) when every clause refuses.
 *
 * v1 is JavaScript-only: the interval target shares this emission path but
 * its runtime values are intervals (an `=== 0` guard is meaningless
 * there), and lowering targets (the shader languages) cannot express the
 * variadic dispatcher. A clause with any guard the target cannot express
 * declines the WHOLE function — `undefined`, never a partial compilation
 * (partial dispatch would silently change tie behavior). Declining
 * surfaces the caller's standard fail-closed diagnostic and falls back to
 * interpreted dispatch.
 */
export function tryEmitMultiClauseFunction(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>,
  decline?: DeclineNote
): string | undefined {
  const registry = target.userFunctions;
  if (!registry) return undefined;

  const state = multiClauseState(engine.lookupDefinition(h));
  if (state === undefined) return undefined; // genuinely unknown operator

  if (target.language !== 'javascript' || registry.lowering) {
    // Fail closed on non-JS targets (§8).
    if (decline)
      decline.reason =
        'a multi-clause function compiles to a guard chain, which only ' +
        'the JavaScript target emits';
    return undefined;
  }

  const name = userFunctionName(registry, h);
  if (registry.defs.has(name) || registry.compiling.has(name)) return name;

  // ── Plan the chain BEFORE emitting anything (whole-function decline) ──
  const clauses = state.clauses;
  type ClausePlan = {
    clause: FunctionClause;
    literal: Expression & FunctionInterface;
    arity: number;
    /** Per-parameter guard sources over `a`, `null` = no test needed. */
    guards: (string | null)[];
  };
  const plans: ClausePlan[] = [];
  for (const clause of clauses) {
    const sig = clause.signature;
    // Optional/variadic clauses have no v1 guard spelling.
    if ((sig.optArgs?.length ?? 0) > 0 || sig.variadicArg !== undefined) {
      if (decline)
        decline.reason =
          'a clause with an optional or variadic parameter has no guard ' +
          'spelling';
      return undefined;
    }
    if (!isFunction(clause.literal, 'Function')) {
      if (decline)
        decline.reason = 'a clause body is not a plain function literal';
      return undefined;
    }
    const arity = sig.args?.length ?? 0;
    if (clause.literal.ops.length - 1 !== arity) {
      if (decline)
        decline.reason =
          'a clause literal takes a different number of parameters than ' +
          'its signature declares';
      return undefined;
    }
    const guards: (string | null)[] = [];
    for (let i = 0; i < arity; i++) {
      const g = jsClauseParamGuard(sig.args![i].type, `_$n[${i}]`);
      if (g === undefined) {
        if (decline)
          decline.reason =
            `no faithful JavaScript guard for a clause parameter typed ` +
            `'${typeToString(sig.args![i].type)}'`;
        return undefined;
      }
      guards.push(g);
    }
    plans.push({ clause, literal: clause.literal, arity, guards });
  }

  // ── Deterministic linearization (§8): stable insertion, more specific
  // first. Clauses of different arity are separated by the arity guard,
  // and `isMoreSpecific` reports incomparable for them, so their relative
  // (declaration) order is preserved. ──
  const order: number[] = [];
  for (let i = 0; i < plans.length; i++) {
    let at = order.length;
    for (let k = 0; k < order.length; k++) {
      const j = order[k];
      if (
        plans[j].arity === plans[i].arity &&
        isMoreSpecific(
          plans[i].clause.signature,
          plans[j].clause.signature,
          plans[i].arity
        )
      ) {
        at = k;
        break;
      }
    }
    order.splice(at, 0, i);
  }

  // The generated code bakes this function's current clause set: record it
  // in the capture set (see `CompileTarget.symbolDeps`).
  target.symbolDeps?.add(h);

  // The definitions stored while this one compiles may call it by name
  // (a re-entrant reference, see below); when its emission fails they
  // are removed, so that no definition keeps a call of a name that is
  // never emitted.
  const definedBefore = new Set(registry.defs.keys());
  registry.compiling.add(name);
  // The clause helpers are shared by every call site: they compile with the
  // promotion of the compile mode (see `withPromotionUnsuppressed`).
  const suppressed = liftPromotionSuppression();
  // The helpers are emitted at module level (`hideCheckedLocals`).
  const checkedLocals = hideCheckedLocals();
  try {
    // One helper per clause, in declaration order. `$` cannot appear in a
    // MathJSON symbol, so `_fn_f$c1` can never collide with the emitted
    // name of another user function (`userFunctionName` sanitizes to
    // `[\w$]` but user symbols never contain `$`).
    const helperNames = plans.map((_, i) => `${name}$c${i + 1}`);
    // The clause bodies are the ARMS of one dispatcher: if any of them is
    // complex-valued, every provably-real one must be coerced to the
    // `{ re, im }` convention or the caller reads `.re` off a plain number
    // (Tycho item 60, here across clauses instead of `Which` arms).
    const coerce = branchComplexCoercion(
      plans.map((p) => p.literal.ops[0]),
      target
    );
    // The lane of the dispatcher's value (`userCallLane`): complex when the
    // clause bodies are coerced to the complex convention, real when no
    // clause body is complex, and no lane when a clause body may be a
    // collection. Recorded after the clause bodies compiled, so that a
    // recursive call in them is checked (`setUserFunctionLane`).
    const lane = plans.some((p) => mayBeCollectionValued(p.literal.ops[0]))
      ? undefined
      : coerce !== undefined;
    for (let i = 0; i < plans.length; i++) {
      const { params, bodyExpr, bodyTarget } = prepareUserFunctionBody(
        plans[i].literal,
        target,
        registry,
        h
      );
      // Each clause body gets the same scalar-parameter standing the
      // single-clause route records: `userFunctionParamsAreScalar` reads
      // the clause set as one intersection signature, and a clause with a
      // collection parameter makes it false for every clause.
      recordScalarParams(h, plans[i].literal, bodyTarget);
      // A recursive clause body references `h` while `name` is in
      // `compiling`, so the self-call emits `name` — bound by the time any
      // call runs, since every def executes in the preamble first.
      const compiled = withEnforcedParams(plans[i].literal, () =>
        withNestedCseHarvest(bodyExpr, bodyTarget, params, () =>
          compileDefinitionBody(bodyExpr, bodyTarget)
        )
      );
      const body = coerce ? coerce(bodyExpr, compiled) : compiled;
      registry.defs.set(
        helperNames[i],
        `const ${helperNames[i]} = (${params.join(', ')}) => ${body};`
      );
    }

    // The guards test the NORMALIZED arguments `_$n`: a `{re, im: 0}`
    // object — the shape a `complex`-typed free symbol is lifted to at
    // `run()` entry (D3), or that a caller hands over directly — IS the
    // real number `re`, and must dispatch as the interpreter dispatches
    // that real (`S(0)` selects the value clause; a `real`-typed clause
    // parameter admits it). Each helper receives its arguments in the
    // shape ITS clause body was compiled for: the normalized value for a
    // parameter not declared complex (that body reads a number), the
    // `_SYS.cplx`-lifted raw value for one that is.
    const branches = order.map((i) => {
      const { arity, guards, clause } = plans[i];
      const tests = [
        `_$a.length === ${arity}`,
        ...guards.filter((g): g is string => g !== null),
      ];
      // A clause parameter DECLARED a non-real number type is consumed by
      // its body through complex slots (the body is compiled with the
      // parameter typed complex), so the dispatcher hands it a `{re, im}`:
      // a plain number that passed the `complex` guard — a real IS a
      // complex — is lifted here, PER CLAUSE, after dispatch has been
      // decided on the raw argument (lifting before dispatch would change
      // which clause a real argument selects). Without this,
      // `S(0) -> complex {0}; S(z: complex) -> complex {z + 1}` called as
      // `S(2)` read `.re` off the number `2` (`{re: null}` behind
      // `success: true`; ROADMAP "A MULTI-CLAUSE function with a declared
      // `complex` parameter compiles silently wrong", 2026-08-16).
      const args = Array.from({ length: arity }, (_, k) => {
        const pt = clause.signature.args?.[k]?.type;
        return pt !== undefined && isNonRealNumber(pt)
          ? `_SYS.cplx(_$a[${k}])`
          : `_$n[${k}]`;
      });
      return `if (${tests.join(' && ')}) return ${helperNames[i]}(${args.join(', ')});`;
    });
    registry.defs.set(
      name,
      `const ${name} = (..._$a) => { const _$n = _$a.map(_SYS.creal); ${branches.join(' ')} throw new Error(${JSON.stringify(`no-matching-clause: ${h}`)}); };`
    );
    setUserFunctionLane(registry, h, name, lane);
  } catch (e) {
    removeDefinitionsAddedSince(registry, definedBefore);
    throw e;
  } finally {
    registry.compiling.delete(name);
    restorePromotionSuppression(suppressed);
    CompilerState._checkedLocals = checkedLocals;
  }
  return name;
}

/**
 * Concatenate the user-defined function definitions accumulated in
 * `target.userFunctions` (see `tryCompileUserFunction`) into a preamble
 * fragment, in dependency order. Empty string when there are none.
 */
/**
 * Compile the body of an emitted user-function definition (the arrow form
 * every non-shader target uses).
 *
 * A target that spells collection values only in consuming positions
 * (`CompileTarget.compileCollectionValue`) gets the body offered to that
 * spelling first: the body ROOT of a helper is such a position, since the
 * helper's value is what its callers consume whole — `H(x, y) := [x + y,
 * x − y]` returns an array, which `d(H(x, y), …)` indexes. The offer is
 * withheld from a declaration CONTRADICTED by its body
 * (`isContradictedScalarFunctionBody`): a helper declared `-> boolean`
 * whose body is a list would otherwise return an array into every scalar
 * position that trusts the declaration, which is the 2026-08-12 ruling
 * this compiler enforces at the consuming positions. A body the target
 * does not spell — a scalar, a list the target cannot represent — compiles
 * through the ordinary lowering, as before.
 */
export function compileDefinitionBody(
  bodyExpr: Expression,
  bodyTarget: CompileTarget<Expression>
): TargetSource {
  const spell = bodyTarget.compileCollectionValue;
  if (spell !== undefined && !isContradictedScalarFunctionBody(bodyExpr)) {
    const code = spell(bodyExpr, bodyTarget);
    if (code !== undefined) return code;
    // A body with more than one statement: its value is the last
    // statement, which is offered to the same spelling in the scope of
    // the block (`compileCollectionValueBlock`).
    if (isFunction(bodyExpr, 'Block'))
      return compileCollectionValueBlock(bodyExpr, bodyTarget);
  }
  return core.compile(bodyExpr, bodyTarget);
}

/**
 * Record that the `compile` handler of `def`, the definition of the
 * operator `name`, wrote part of the code of the compilation in progress.
 *
 * A handler of a standard library writes the engine's own code, and
 * nothing is recorded (`isEngineCompileHandler()`). Any other handler is
 * caller code that may call a function of this thread: unless its
 * definition sets `compileShippable`, the root target is marked
 * `hostNames`, so the result is not shippable and `broadcastAsync()` keeps
 * it on this thread. The root target, not `target`: a nested target is a
 * copy, and the result reads the flag on the root. The flag is not reset
 * when a compilation that ran the handler is abandoned and its
 * definitions are removed (`removeDefinitionsAddedSince()`): the result
 * can then be marked not shippable with no caller code left in it. That
 * only keeps the result on this thread, which is always correct.
 *
 * Each helper of the definition (`compileHelpers`) becomes a definition
 * of the preamble (`addCompileHelpers()`), so that the code carries it to
 * a worker and to a stored result.
 */
export function recordCallerHandlerCode(
  name: string,
  def: {
    compile?: unknown;
    compileShippable?: boolean;
    compileHelpers?: Readonly<Record<string, (...args: never[]) => unknown>>;
  },
  target: CompileTarget<Expression>
): void {
  if (isEngineCompileHandler(def.compile)) return;
  const root = target.userFunctions?.root ?? target;
  if (def.compileShippable !== true) root.hostNames = true;
  if (def.compileHelpers !== undefined)
    addCompileHelpers(name, def.compileHelpers, target);
}

/**
 * Define each helper of `helpers` in the preamble of the compilation in
 * progress, as `const <name> = (<source>);`, on the two JavaScript
 * targets (a helper is JavaScript; another target ignores it). `owner`
 * names the operator or the kind type whose code calls the helpers, for
 * the error messages. A helper reads nothing outside its body, so it is
 * evaluated once per compiled artifact (`hoistable`). Used for the
 * `compileHelpers` of an operator definition and the `helpers` of a kind
 * compile contract.
 *
 * A new helper goes FIRST in the definitions, which are emitted in their
 * order: a definition emitted earlier can call it, and a hoisted constant
 * (`const _val_a = …`) calls it while the preamble is evaluated, which
 * throws a `ReferenceError` when the `const` of the helper comes later.
 * The kind helpers are added after the whole body is compiled, so this
 * order matters for them.
 */
export function addCompileHelpers(
  owner: string,
  helpers: Readonly<Record<string, (...args: never[]) => unknown>>,
  target: CompileTarget<Expression>
): void {
  const language = target.language ?? 'javascript';
  if (language !== 'javascript' && language !== 'interval-javascript') return;
  const registry = target.userFunctions;
  if (registry === undefined)
    throw new Error(
      `Could not compile \`${owner}\`: its code calls helper functions, and this compilation has no preamble to define them in`
    );
  // A field assigned in place on a definition was not checked when the
  // definition was declared.
  assertValidCompileHelpers(`Could not compile \`${owner}\``, helpers);
  for (const [helper, fn] of Object.entries(helpers)) {
    const code = `const ${helper} = (${fn.toString()});`;
    const existing = registry.defs.get(helper);
    if (existing === undefined) {
      const later = [...registry.defs];
      registry.defs.clear();
      registry.defs.set(helper, code);
      for (const [name, text] of later) registry.defs.set(name, text);
      (registry.hoistable ??= new Set()).add(helper);
    } else if (existing !== code)
      throw new Error(
        `Could not compile \`${owner}\`: two definitions give the compile helper \`${helper}\` with different source, or the name is already used by the compiled code`
      );
  }
}

export function userFunctionsPreamble(
  target: CompileTarget<Expression>
): string {
  const defs = target.userFunctions?.defs;
  if (!defs || defs.size === 0) return '';
  return [...defs.values()].join('\n') + '\n';
}
