// Common-subexpression elimination: sessions, regions, harvests,
// loop-invariant hoisting and invariant prefixes.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  isOperatorDef,
  collectBinderNames,
  freeSymbolNames,
} from '../boxed-expression/utils.js';
import { isTupleShapedType } from '../collection-utils.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import { scopeForRebuild } from '../boxed-expression/binding-sites.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import { isSymbol, isFunction } from '../boxed-expression/type-guards.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import {
  functionLiteralParameterName,
  isDestructuringParameter,
  isRestParameter,
} from '../boxed-expression/function-literal.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { compileJetDerivative, jetDerivativeTarget } from './jet-derivative.js';
import { unrollFixedWidthCollections } from './fixed-width-unroll.js';
import type {
  CompileTarget,
  CseSession,
  InvariantPrefix,
  OperandCompiler,
  TargetSource,
} from './types.js';
import {
  candidateAt,
  descendantRegionAt,
  harvestCse,
  isCallerMapped,
  isCseAdmissible,
  lazyOperandRegions,
  type CseCandidate,
  type CseHarvest,
  type CseHarvestOptions,
} from './cse.js';
import { namingContext, tempVar } from './compiler-naming.js';
import type {
  EnclosingDefinition,
  LoopInvariantBinding,
} from './compiler-types.js';
import {
  provablyScalarArg,
  userFunctionLiteral,
  userFunctionParamsAreScalar,
} from './compile-assignment-checks.js';
import {
  cseRegionOf,
  cseTop,
  isContradictedScalarDeclaration,
  pushCseInstance,
  tailValueFor,
  withCseOperand,
  withCseRegion,
} from './compile-conditions.js';
import { EXPENSIVE_PREFIX_HEADS, NO_NAMES } from './compiler-tables.js';
import { core } from './compiler-core-hooks.js';
import { compileValueOperand } from './compile-statements.js';
import {
  _codeAliases,
  _codeOverrides,
  _prefixCallOverrides,
} from './compiler-mode.js';

/**
 * Generated local-function name for a user-defined function `id`. Prefixed to
 * avoid colliding with the vars object (`_.<name>`) and with target helpers;
 * non-identifier characters are folded to `_` so the emitted declaration is a
 * valid target identifier.
 *
 * A user function is emitted ONCE per compilation, under this one name:
 * how a wide parameter is shaped is a property of the compile MODE
 * (strict/auto: real, a complex-shaped argument to it is a `LaneMismatch`
 * decline that `auto` escalates; complex: complex, lifted at use), never
 * of the call site. (The per-call-site `_fn_b$z1` lane specializations
 * that preceded the compile modes were retired 2026-08-16.) `$` cannot
 * appear in a MathJSON symbol, so the `$c<n>` multi-clause helper names and
 * the `$…$e<n>` protocol helper names can never collide with a user
 * function's emitted name.
 */
/**
 * The emitted local name for `id` under `prefix` (`_fn_` for a user
 * function, `_val_` for a bound symbol value), allocated once per registry.
 *
 * The sanitizer that turns a symbol into an identifier is not injective —
 * `α` and `β` both become `_` — and the registry treats a name already in
 * `defs` as "emitted, reuse it", so without this allocation a second symbol
 * landing on an emitted name would silently read the first symbol's
 * definition. A name already handed out to a DIFFERENT id gets a numeric
 * suffix (`_fn___2`); the suffix is checked against the taken set too, so
 * every id maps to exactly one name and no two ids share one.
 */
export function registryLocalName(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  prefix: string,
  id: string
): string {
  const names = (registry.names ??= new Map());
  const key = prefix + id;
  const known = names.get(key);
  if (known !== undefined) return known;
  const taken = (registry.taken ??= new Set());
  // A name the compiled expression itself uses — a parameter, a binder
  // index, a symbol handed in through `vars` — is not available either:
  // a local declared under it would shadow it, or be declared twice in a
  // lambda whose parameter carries that name. The inventory is the one
  // the generated temporaries consult (`tempVar`).
  const owner = registry.valueRoot ?? registry.root;
  const used = owner === undefined ? undefined : namingContext(owner).usedNames;
  const raw = prefix + id.replace(/[^\w$]/g, '_');
  // Shader identifiers cannot contain dollar signs or consecutive
  // underscores. Normalize before collision allocation so distinct
  // function names and specialization keys still get distinct bindings.
  const shader =
    registry.root?.language === 'glsl' || registry.root?.language === 'wgsl';
  const base = shader ? raw.replace(/[$_]+/g, '_').replace(/_+$/, '') : raw;
  let name = base;
  for (let k = 2; taken.has(name) || used?.has(name) === true; k++)
    name = `${base}_${k}`;
  taken.add(name);
  names.set(key, name);
  return name;
}

export function userFunctionName(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  id: string
): string {
  return registryLocalName(registry, '_fn_', id);
}

export function isSinglePointArg(a: Expression): boolean {
  if (isFunction(a, 'Tuple')) return true;
  if (
    isFunction(a, 'PointList') &&
    a.nops > 0 &&
    a.ops.every((op) => op.type.matches('number'))
  )
    return true;
  return isTupleShapedType(a.type.type);
}

/** Does `h` resolve to a generic (polytype-signed) user function? Reads
 * the same declared-signature-first precedence as
 * `userFunctionParamsAreScalar`. */
export function userFunctionIsGeneric(
  engine: ComputeEngine,
  h: string,
  literal: Expression | undefined
): boolean {
  const def = engine.lookupDefinition(h);
  if (def !== undefined) {
    if (isOperatorDef(def)) {
      if (def.operator.signature?.isPolymorphic) return true;
    } else if ('value' in def && def.value?.type?.isPolymorphic) return true;
  }
  // A multi-clause function has no single literal (`userFunctionLiteral`
  // returns `undefined` for it): the definition lookup above is then the
  // only source of an answer, and a definition that does not settle it
  // means "not provably generic" rather than a literal to fall back on.
  const own = literal?.type?.type;
  return own !== undefined && isPolymorphicType(own);
}

/**
 * The body of the user function `h` with `args` SUBSTITUTED for its
 * parameters, or `undefined` when that substitution would not be sound.
 *
 * The soundness conditions are the ones listed on
 * {@link tryInlineUserFunctionCall}, minus the two the CALL SITE owns (the
 * callee already being compiled by reference, and the callee already being
 * inlined higher up): a single-statement pure non-generic literal, no direct
 * self-call, arguments that are pure and provably a scalar or a literal
 * point, no binder in the body that would capture the substitution, and a
 * declaration the body does not contradict.
 *
 * `enclosing` describes the definition whose body this call sits in, when
 * there is one (the definition-emission route). Its `scalarNames` name
 * symbols that hold a run-time SCALAR although their static type does not
 * say so, and so pass the argument test as if `provablyScalarArg` had
 * answered `true`; see {@link EnclosingDefinition} for why they qualify.
 * Its `localNames` are the names that definition BINDS: a free symbol of
 * the callee's body that collides with one of them would be CAPTURED by the
 * binding once the body lands inside the definition, and the whole
 * substitution is declined.
 *
 * The result is rewritten for `ce.angularUnit` — the callee's body comes
 * from the engine definition and has never been through the rewrite the
 * public `compile()` entries apply to the tree they are handed.
 *
 * Nothing is compiled here, and the result is not rewritten: the caller
 * decides what to do with the substituted body. Also read by the shader
 * targets' root inlining of repeated calls (`gpu-shared-calls.ts`).
 */
export function substitutedUserFunctionBody(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  enclosing?: EnclosingDefinition,
  admits?: (a: Expression) => boolean
): Expression | undefined {
  if (!target.userFunctions) return undefined;
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return undefined;
  if (userFunctionIsGeneric(engine, h, literal)) return undefined;
  const params = literal.ops.slice(1);
  if (params.length !== args.length) return undefined;
  const body = literal.ops[0];
  const statement =
    isFunction(body, 'Block') && body.nops === 1 ? body.op1 : body;
  if (isFunction(statement, 'Block') || statement.isPure !== true)
    return undefined;
  const mentionsHead = (x: Expression): boolean =>
    isFunction(x) && (x.operator === h || x.ops.some((op) => mentionsHead(op)));
  if (mentionsHead(statement)) return undefined;
  if (
    !args.every(
      (a) =>
        a.isPure === true &&
        (provablyScalarArg(a) ||
          (isSymbol(a) && enclosing?.scalarNames.has(a.symbol) === true) ||
          isSinglePointArg(a) ||
          admits?.(a) === true)
    )
  )
    return undefined;
  // A declaration the body contradicts — a scalar or boolean promise over
  // a collection-constructing body — fails closed at the DEFINITION
  // (`isContradictedScalarFunctionBody`, the wave-3/wave-6 rulings) and in
  // every scalar position. Inlining would route around that decline with
  // the body's real shape; the same contradiction, read off the call.
  if (isContradictedScalarDeclaration(engine.function(h, args)))
    return undefined;
  const substitution: Record<string, Expression> = {};
  for (const [i, p] of params.entries()) {
    const name = isSymbol(p)
      ? p.symbol
      : isFunction(p, 'Typed') && isSymbol(p.op1)
        ? p.op1.symbol
        : undefined;
    if (name === undefined) return undefined;
    substitution[name] = args[i];
  }
  // `subs` rewrites symbol OCCURRENCES, never a HEAD. A parameter that the
  // body CALLS — `q(g, t) := g(t) + g(t)^2` — would therefore keep the
  // engine-level function of that name in the substituted body and ignore
  // the argument altogether, silently compiling a different function. The
  // compiler has no lowering for a call of a bound parameter and fails
  // closed on it (user ruling 2026-08-14: fail closed now, direct
  // higher-order compilation is a possible future feature); declining here
  // is what lets that decline stand.
  const substitutedNames = new Set(Object.keys(substitution));
  const callsParameter = (x: Expression): boolean =>
    isFunction(x) &&
    (substitutedNames.has(x.operator) || x.ops.some(callsParameter));
  if (callsParameter(statement)) return undefined;
  // The callee's body is written against the ENGINE's symbols, and it is
  // about to land inside a definition that BINDS names of its own. A free
  // symbol of the body that collides with one of those names would be read
  // as the binding instead of the engine symbol, and the emitted definition
  // would compute something else. The test has to run on the body BEFORE
  // the substitution, because afterwards a parameter occurrence and an
  // argument occurrence of the same name are indistinguishable: with a
  // global `k := 100`, `V(t) := [t + k, …]` and `f(k, t) := Min(V(k))`, the
  // substituted body is `[k + k, …]` whose two `k` mean different things,
  // and the emitted `_fn_f` reads both as its own parameter. The callee's
  // own parameter names are exempt — those occurrences become the
  // arguments, which are already written in the enclosing scope and need no
  // check.
  //
  // Only the FREE occurrences of the body count (`freeSymbolNames`). A name
  // the body binds itself — the `p` of a `Map(p ↦ …, list)` — is read as
  // that inner binding wherever the binder reaches, and the enclosing
  // definition's `p` cannot capture it; `statement.symbols` would list it
  // all the same and refuse a substitution that is safe.
  if (enclosing !== undefined && enclosing.localNames.size > 0) {
    for (const sym of freeSymbolNames(statement))
      if (!substitutedNames.has(sym) && enclosing.localNames.has(sym))
        return undefined;
  }
  // `subs` replaces only the free occurrences of a parameter, but it is
  // not capture-avoiding: a free symbol of an argument that an inner
  // `Function`/`Block`/`Sum` binder binds is CAPTURED by that binder, and
  // the binder's index is not renamed. The substitution is refused when no
  // such capture can be ruled out: when a parameter name being substituted
  // is REBOUND by a binder in the body, or a free symbol of an argument is
  // bound by one.
  // This is the same condition `betaReduceLambda`
  // (`boxed-expression/utils.ts`) applies to a lambda application. Declining
  // on the mere PRESENCE of a binder is coarser and refuses bodies that are
  // safe: a body whose whole value is `Map(p ↦ …, list)` binds `p`, which
  // collides with nothing, and that decline is what kept the shader and
  // interval targets from compiling such a definition at all.
  const binders = collectBinderNames(statement);
  if (binders.size > 0) {
    for (const [name, arg] of Object.entries(substitution)) {
      if (binders.has(name)) return undefined;
      for (const s of arg.symbols) if (binders.has(s)) return undefined;
    }
  }
  // The callee's body has never been through `rewriteAngularUnit`: that
  // rewrite runs once, on the tree a public `compile()` entry was handed,
  // and this body comes from the engine definition instead. Without it a
  // `Sin` inside the substituted body is emitted as a radian `Math.sin`
  // while the engine interprets its argument in `ce.angularUnit`, so
  // `v(t) := [Sin(t), …]` inlined into `f(x) := Min(v(x))` compiled to a
  // different function than the interpreter runs in degree mode.
  //
  // The rewrite goes BEFORE the substitution, and that order is the only
  // correct one: `rewriteAngularUnit` is NOT idempotent — it scales a trig
  // ARGUMENT, so a second pass would produce `Sin(k·k·u)`. The arguments
  // were already rewritten as part of the enclosing tree, so rewriting the
  // body first and substituting them in afterwards scales each trig
  // argument exactly once.
  // On `interval-js` the factors of the angular unit are exact, as at the
  // compile entry of that target, so the scaled angle is an enclosure of
  // the true angle.
  const substituted = rewriteAngularUnit(statement, {
    exactFactors: target.language === 'interval-javascript',
  }).subs(substitution);
  // The substitution re-canonicalizes the body with the arguments in
  // place, and that can make it INVALID when an argument's static type
  // does not fit the body. Example: with `f(p) := Mod(p, 1) - 0.5` and a
  // definition `r(p) := l(f(p))` whose parameter `p` is inferred as a
  // point from an index read (`p[1]`), substituting the point-typed `p`
  // gives `Mod(p, 1) - 0.5`, a tuple minus a number, which is an
  // `incompatible-type` error (a tuple plus a scalar is refused, see
  // `docs/plans/2026-07-07-tuple-point-semantics.md`). The interpreter
  // binds the run-time value instead (a list, for which the expression is
  // valid), so the error is not the value of the call. The substitution
  // is declined and the call stays a call, compiled by reference.
  if (!substituted.isValid) return undefined;
  return substituted;
}

/**
 * How many nested calls one inlining may substitute. A definition that calls
 * a collection-valued helper several times copies that helper's body once
 * per call, so an unbounded chain would grow the emitted code
 * multiplicatively. The cap is generous for a hand-written chain of
 * definitions and stops a pathological one; when it runs out the remaining
 * calls stay by reference and compile — or decline — exactly as before.
 */
export const MAX_NESTED_INLINES = 64;

/**
 * `bodyType`, when given, narrows the substitution to a callee whose BODY
 * matches that type by its own typing — the root-entry form, where a call
 * is inlined so the fixed-width unroll can see the list it returns.
 * Without it, a scalar-valued helper whose declared result type is open
 * (`-> unknown`) is "not provably a scalar" and would be copied into every
 * call site of the root expression, where the definition-body route has
 * parameter evidence the root does not. Under `bodyType` every argument
 * must also be provably scalar by its type: the root has no parameter
 * evidence, and a call over an open-typed argument stays a call — by
 * reference it admits a list at run time through its broadcast dispatch,
 * while the substituted body would read the list as the point or number
 * the body was written for. A literal point argument passes: its shape is
 * in view.
 *
 * A head the caller overrode (`CompileTarget.unrollSkipHeads`) is left as
 * written, and so is everything under it: the caller's implementation
 * replaces the emission and receives the node's own operands.
 *
 * An expression can share a node between several parents, and a walk of
 * every path takes a time exponential in the depth (ROADMAP CE-584). A
 * node that the walk leaves unchanged is recorded in `budget.unchanged`,
 * for its `enclosing` record, and the walk does not visit it again. The
 * record is read and written only when `onPath` is empty: a smaller
 * `onPath` or a larger `budget.left` could let a call below the node be
 * substituted, and `budget.left` only decreases.
 */
export function inlineCollectionValuedCalls(
  engine: ComputeEngine,
  expr: Expression,
  target: CompileTarget<Expression>,
  onPath: Set<string>,
  budget: {
    left: number;
    unchanged?: Map<EnclosingDefinition | undefined, Set<Expression>>;
  },
  enclosing?: EnclosingDefinition,
  bodyType?: string
): Expression {
  if (!isFunction(expr)) return expr;
  if (onPath.size > 0)
    return inlineCollectionValuedCallsOnce(
      engine,
      expr,
      target,
      onPath,
      budget,
      enclosing,
      bodyType
    );
  budget.unchanged ??= new Map();
  let unchanged = budget.unchanged.get(enclosing);
  if (unchanged === undefined)
    budget.unchanged.set(enclosing, (unchanged = new Set()));
  if (unchanged.has(expr)) return expr;
  const result = inlineCollectionValuedCallsOnce(
    engine,
    expr,
    target,
    onPath,
    budget,
    enclosing,
    bodyType
  );
  if (result === expr) unchanged.add(expr);
  return result;
}

/** One step of {@link inlineCollectionValuedCalls}, which it calls for
 * each operand. */
export function inlineCollectionValuedCallsOnce(
  engine: ComputeEngine,
  expr: Expression,
  target: CompileTarget<Expression>,
  onPath: Set<string>,
  budget: { left: number },
  enclosing?: EnclosingDefinition,
  bodyType?: string
): Expression {
  if (!isFunction(expr)) return expr;
  if (target.unrollSkipHeads?.has(expr.operator) === true) return expr;
  const bound = boundVariableNames(expr);
  if (bound.length > 0) {
    // A node that BINDS names — a comprehension, a `Sum`, a `Block` with a
    // local — is descended with those names added to the enclosing local
    // names, so a callee body whose free symbol one of them would capture
    // is declined by `substitutedUserFunctionBody`, and a call of a bound
    // name is left a call. The rebuilt node keeps ITS OWN scope
    // (`scopeForRebuild`): a fresh scope would be parented at this site
    // while a binder nested inside goes on pointing at the original one.
    // When the scope cannot be reused the node is left as written. A
    // `Function` literal is opaque here as it is to the fixed-width
    // unroll: rebuilding one re-runs the literal canonicalization, which
    // declares the parameters into a scope of its own.
    if (expr.operator === 'Function' || expr.localScope === undefined)
      return expr;
    // A name this node binds anew shadows an enclosing parameter of the
    // same name, so it leaves the scalar evidence: the binding may hold a
    // collection where the parameter held a scalar. A name the enclosing
    // definition already binds (its own parameters, bound by the body
    // `Block`) keeps its evidence — and then nothing changes, so the
    // record is reused rather than rebuilt.
    const outerLocal = enclosing?.localNames ?? NO_NAMES;
    const fresh = bound.filter((n) => !outerLocal.has(n));
    const within: EnclosingDefinition =
      fresh.length === 0 && enclosing !== undefined
        ? enclosing
        : {
            scalarNames:
              enclosing === undefined
                ? NO_NAMES
                : new Set(
                    [...enclosing.scalarNames].filter((n) => !fresh.includes(n))
                  ),
            localNames: new Set([...outerLocal, ...fresh]),
          };
    const inner = expr.ops.map((op) =>
      inlineCollectionValuedCalls(
        engine,
        op,
        target,
        onPath,
        budget,
        within,
        bodyType
      )
    );
    if (inner.every((op, i) => op === expr.ops[i])) return expr;
    const scope = scopeForRebuild(
      expr.localScope,
      engine,
      expr.operator,
      inner
    );
    if (scope === undefined) return expr;
    return engine.function(expr.operator, inner, { scope });
  }
  const ops = expr.ops.map((op) =>
    inlineCollectionValuedCalls(
      engine,
      op,
      target,
      onPath,
      budget,
      enclosing,
      bodyType
    )
  );
  const node: Expression = ops.every((op, i) => op === expr.ops[i])
    ? expr
    : engine.function(expr.operator, ops);
  if (!isFunction(node)) return node;
  if (budget.left <= 0) return node;
  if (onPath.has(node.operator)) return node;
  // A definition whose emission is already in flight elsewhere in this
  // compilation stays a CALL. Substituting its body here would emit the same
  // definition a second time, in the middle of the emission that is already
  // producing it — the re-entrancy the top-level inlining refuses through
  // the same check (`registry.compiling`), and the mutual-recursion case it
  // exists for.
  const registry = target.userFunctions;
  if (
    registry !== undefined &&
    registry.compiling.has(userFunctionName(registry, node.operator))
  )
    return node;
  // A call of a name the enclosing definition BINDS is a call of that bound
  // value — `q(g, t) := g(t) + g(t)^2` calls its own first parameter — and
  // the engine-level definition of the same name describes a different
  // function. The compiler has no lowering for a call of a bound parameter
  // and fails closed on it; reading the engine here would silently compile
  // the wrong body instead.
  if (enclosing?.localNames.has(node.operator) === true) return node;
  if (provablyScalarArg(node)) return node;
  if (bodyType !== undefined) {
    const literal = userFunctionLiteral(engine, node.operator);
    if (literal === undefined || !literal.ops[0].type.matches(bodyType))
      return node;
    // A literal point is a shape the substitution reads exactly, as
    // `substitutedUserFunctionBody` admits it for a definition body.
    if (!node.ops.every((a) => provablyScalarArg(a) || isSinglePointArg(a)))
      return node;
  }
  const body = substitutedUserFunctionBody(
    engine,
    node.operator,
    node.ops,
    target,
    enclosing
  );
  if (body === undefined) return node;
  budget.left -= 1;
  // The generated code bakes this definition too, exactly as the outer
  // inlining bakes its own (`CompileTarget.symbolDeps`).
  target.symbolDeps?.add(node.operator);
  onPath.add(node.operator);
  try {
    return inlineCollectionValuedCalls(
      engine,
      body,
      target,
      onPath,
      budget,
      enclosing,
      bodyType
    );
  } finally {
    onPath.delete(node.operator);
  }
}

/**
 * The body of a definition about to be EMITTED, with every nested
 * user-function call whose value is not provably a scalar replaced by the
 * callee's substituted body ({@link inlineCollectionValuedCalls}).
 *
 * The call-site inliner does this to the body it substitutes, and the
 * definition route needs it for the same reason: a call is opaque to the
 * shape-reading lowerings and to the fixed-width unroll. A body such as
 * `PointX(V(x, y))`, whose collection comes from a nested call instead of a
 * literal `List`, was emitted as runtime broadcast closures over an array
 * (`_SYS.bcast`, `map`, `reduce`), while the same body written with the list
 * in place compiles to straight-line scalar arithmetic. Substituting `V`
 * exposes the list; the unroll pass that runs next produces the arithmetic.
 *
 * Only a call that is NOT provably a scalar is substituted, so a
 * scalar-valued helper stays a single shared definition instead of being
 * copied into each of its callers.
 *
 * A canonical function body is a `Block` that binds the parameters, and
 * `inlineCollectionValuedCalls` leaves a name-binding node untouched. Each
 * STATEMENT of such a `Block` is therefore substituted on its own and the
 * `Block` is rebuilt ONTO ITS OWN SCOPE — a fresh scope is parented at the
 * rebuilding site, so a binder nested in a statement would go on pointing at
 * the original scope while the rebuilt node advertises another one
 * (`docs/SCOPING-MODEL.md`). The names the `Block` itself declares join the
 * parameters in `enclosing.localNames` for that walk, so a callee body that
 * reads a global of the same name as a block-local declines instead of
 * being captured by it. When no statement changes the body is returned
 * unchanged, so a definition with no nested collection-valued call is not
 * rebuilt at all.
 *
 * `enclosing` carries the definition's own parameter names, twice over: as
 * `scalarNames` when they hold a run-time scalar, and as `localNames`
 * always. Without the first, almost nothing is substituted here — a nested
 * call inside a definition body is passed that body's parameters, whose
 * static type is usually `unknown`, and the argument test would decline
 * every one of them. The second keeps the substitution out of the names the
 * definition binds.
 */
export function inlineCollectionValuedCallsInDefinitionBody(
  body: Expression,
  target: CompileTarget<Expression>,
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  enclosing: EnclosingDefinition
): Expression {
  const engine = body.engine as unknown as ComputeEngine;
  // The substitution reads the registry off the target to see which
  // definitions are already being emitted (the re-entrancy guard that stops
  // a mutually recursive pair). The caller may hold the registry separately
  // from the target it passes, so make sure the two agree.
  const inlineTarget: CompileTarget<Expression> =
    target.userFunctions === registry
      ? target
      : { ...target, userFunctions: registry };
  // One budget for the whole body, so a `Block` of several statements is
  // capped in total rather than once per statement.
  const budget = { left: MAX_NESTED_INLINES };
  const substitute = (
    expr: Expression,
    within: EnclosingDefinition
  ): Expression =>
    inlineCollectionValuedCalls(
      engine,
      expr,
      inlineTarget,
      new Set<string>(),
      budget,
      within
    );
  if (isFunction(body, 'Block')) {
    // A `Block` declares names of its own beside the parameters — a local
    // the body assigns to and then reads. Those names shadow the engine
    // exactly as a parameter does, so they join `localNames`: a callee body
    // whose free symbol collides with one of them is declined
    // (`substitutedUserFunctionBody`). They are NOT scalar evidence — only
    // a parameter is covered by the promise `userFunctionParamsAreScalar`
    // reads — so `scalarNames` is carried through unchanged.
    const declared = boundVariableNames(body);
    const within: EnclosingDefinition = declared.every((n) =>
      enclosing.localNames.has(n)
    )
      ? enclosing
      : {
          scalarNames: enclosing.scalarNames,
          localNames: new Set([...enclosing.localNames, ...declared]),
        };
    const ops = body.ops.map((op) => substitute(op, within));
    if (ops.every((op, i) => op === body.ops[i])) return body;
    const scope = scopeForRebuild(body.localScope, engine, 'Block', ops);
    return scope === undefined
      ? engine.function('Block', ops)
      : engine.function('Block', ops, { scope });
  }
  return substitute(body, enclosing);
}

/**
 * The {@link EnclosingDefinition} record for the function literal about to
 * be emitted: its parameter names, and which of them hold a run-time scalar.
 *
 * The scalar half reads `userFunctionParamsAreScalar` — the same reading of
 * the same property that the call sites use to choose their emission, so the
 * two cannot disagree about which functions broadcast a collection argument
 * rather than binding it whole. `h` is the id under which the definition is
 * emitted; a synthesized emission that names no engine symbol passes
 * `undefined`, which reads as "no scalar promise" and leaves the
 * substitution to the static argument test alone.
 */
export function enclosingDefinitionOf(
  engine: ComputeEngine,
  h: string | undefined,
  literal: Expression & FunctionInterface
): EnclosingDefinition {
  const localNames = new Set<string>();
  for (const p of literal.ops.slice(1)) {
    const name = functionLiteralParameterName(p);
    if (name) localNames.add(name);
  }
  const scalar = h !== undefined && userFunctionParamsAreScalar(engine, h);
  return {
    scalarNames: scalar ? localNames : NO_NAMES,
    localNames,
  };
}

/**
 * Prepare a function literal's body for emission as a preamble definition:
 * the parameter names, the angular-unit-rewritten body, and the body's
 * compile target.
 *
 * The body compiles with the parameters shadowing the target's `var`
 * resolution (matching the `Function`-literal handler), so a parameter
 * compiles to its bare name rather than a folded value or `_.<name>`.
 * The angular-unit rewrite is applied per emitted body: the entry points
 * rewrite only the TOP-LEVEL expression tree, and this literal comes from
 * the engine definition — without the rewrite here, a degree-mode compile
 * of `t ↦ f(t)` emitted radian-based trig inside `f`'s definition while
 * `t ↦ sin(t)` correctly scaled.
 *
 * The body target chains to the ROOT target — the one the registry was
 * installed on — NOT the requesting one. An emitted definition is a
 * module-level (preamble) function, so it must see only the compilation's
 * own var/fold rules plus its own parameters. Chaining through the
 * requester leaked that caller's bindings into this body: emitting `g`
 * (whose body reads a global `z`) from inside `f(z) := g(1)` resolved `z`
 * to `f`'s parameter. The registry, naming context and capture set are
 * shared objects, so they survive the switch.
 *
 * The body is emitted into the artifact, so its symbols join the
 * compilation's collision inventory UNCONDITIONALLY — a `_tv1` in a
 * definition body must not be shadowed by a generated temp even when CSE
 * is off (the nested harvest merges the same names, but only when a
 * session is enabled).
 */
/**
 * The body of `literal` as an emitted DEFINITION compiles it: canonical,
 * angular-unit rewritten, nested collection-valued calls substituted and
 * fixed-width collections unrolled. Shared by the emission
 * (`prepareUserFunctionBody`) and the invariant-prefix analysis
 * (`invariantPrefixes`), so the analysis reads the same tree the emission
 * compiles.
 *
 * These are the same two target-independent rewrites the public compile
 * entries apply, so an emitted definition gets the fixed-width unroll its
 * inlined counterpart gets (`fixed-width-unroll.ts`). The entry hooks
 * never see this body — it comes from the engine definition — so the
 * heads the caller overrode are read from the target
 * (`CompileTarget.unrollSkipHeads`).
 *
 * The nested collection-valued calls are substituted FIRST: the unroll
 * reads the width of a collection off a literal `List`, and a call that
 * returns one hides that width
 * (`inlineCollectionValuedCallsInDefinitionBody`).
 */
export function definitionBodyExpr(
  literal: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  h?: string
): Expression {
  return unrollFixedWidthCollections(
    inlineCollectionValuedCallsInDefinitionBody(
      // Exact factors on `interval-js`, as at the compile entry of that
      // target.
      rewriteAngularUnit(literal.ops[0].canonical, {
        exactFactors: target.language === 'interval-javascript',
      }),
      target,
      registry,
      enclosingDefinitionOf(
        literal.engine as unknown as ComputeEngine,
        h,
        literal
      )
    ),
    {
      skipHeads: target.unrollSkipHeads,
      overridesHead: target.overridesHead,
      iterationBudget: target.iterationBudget,
      readsLiveSource: target.cse?.harvestOptions?.isStringVar,
      minWidth: target.unrollMinWidth,
      unrollConstantLists: target.unrollConstantLists,
      typedPointLists: target.unrollTypedPointLists,
      unrollComprehensions: target.unrollComprehensions,
    }
  );
}

/**
 * The function literal an `Apply(Derivative(f, n), x)` would be lowered
 * from through forward-mode automatic differentiation, or `undefined` when
 * that lowering does not claim this application.
 *
 * The reference analysis needs the same answer the emitter reaches, and
 * reaches it the same way: the jet emitter is run (it costs one walk of the
 * body) and its decline is this function's decline. `compile` is the
 * analysis walk's own throwaway operand compiler.
 */
export function jetDerivativeLowering(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  complexMode: boolean
): (Expression & FunctionInterface) | undefined {
  const claim = jetDerivativeTarget(
    args,
    (id) => userFunctionLiteral(engine, id),
    complexMode
  );
  if (claim === undefined) return undefined;
  let counter = 0;
  const code = compileJetDerivative(
    claim.literal,
    claim.order,
    args[1],
    compile,
    () => `_tvProbe${++counter}`,
    core.isComplexValued
  );
  if (code === undefined) return undefined;
  return isFunction(claim.literal, 'Function') ? claim.literal : undefined;
}

// ---------------------------------------------------------------------------
// Common-subexpression elimination — emission side (§6 of
// `docs/plans/2026-07-28-compile-cse-design.md`). The ANALYSIS side is
// `cse.ts`; the dependency direction is base-compiler → cse.
// ---------------------------------------------------------------------------

/**
 * A CSE temporary: `_cse1`, `_cse2`, … drawn from the SAME naming-context
 * counter as `tempVar()`, skipping any name the compilation already uses
 * (§6.3 — neither prefix is reserved, collisions are prevented).
 */
export function cseTempVar(target: CompileTarget<Expression>): string {
  const naming = namingContext(target);
  let name: string;
  do {
    name = `_cse${++naming.counter}`;
  } while (naming.usedNames.has(name));
  return name;
}

/**
 * Open the CSE session of a **root compilation boundary** (§4.2): harvest
 * `expr` — which must already be the post-`rewriteAngularUnit` tree the
 * emitters will walk — and stamp the session on `target`, merging the
 * harvest's symbol inventory into the naming context (§4.1).
 *
 * The session is stamped `enabled: false` — every CSE hook then short-circuits
 * and emission is byte-identical to the pre-CSE one — when the caller passed
 * `cse: false`, or when the target cannot bind temporaries in expression
 * or statement position (neither `cseBind` nor `cseMaterialize`).
 *
 * `isOverriddenOperator` / `isStringVar` are the G1b provenance predicates
 * (§5.2). They must be built from the caller's RAW options, before those are
 * merged into the target's resolver closures — a closure cannot tell a
 * built-in entry from a caller-supplied one.
 */
export function openCseSession(
  expr: Expression,
  target: CompileTarget<Expression>,
  options: {
    enabled?: boolean;
    isOverriddenOperator?: (name: string) => boolean;
    isPureOverriddenOperator?: (name: string) => boolean;
    isStringVar?: (name: string) => boolean;
    isVarsKey?: (name: string) => boolean;
  } = {}
): void {
  const harvestOptions: CseHarvestOptions = {
    isOverriddenOperator: options.isOverriddenOperator,
    isPureOverriddenOperator: options.isPureOverriddenOperator,
    isStringVar: options.isStringVar,
    isVarsKey: options.isVarsKey,
    // A target may decline the symbol-square exemption (the Python target
    // does — see `CompileTarget.shareSymbolSquares`). Carried on the
    // session so nested harvests of user-function bodies apply it too.
    shareSymbolSquares: target.shareSymbolSquares,
    // Likewise the expression reading of a block's last `If`
    // (`CompileTarget.valueTailSelections`).
    valueTailSelections: target.valueTailSelections,
    // A target's own admission thresholds (`CompileTarget.cseMinSize`,
    // `cseMinScore`), carried on the session for the same reason.
    minSize: target.cseMinSize,
    minScore: target.cseMinScore,
    // PURE user-function applications are admitted at the root too (item 120
    // follow-up): a repeated `f(x+1)` at the root is the same redundant call
    // as one inside a definition body. Admission validates the resolved
    // callee's BODY transitively (`isAdmissibleUserFnCallee`), and G1
    // (`node.isPure`) independently keeps a drawing/writing call inert.
    admitPureUserFunctions: true,
  };
  // A disabled session still records the predicates. They describe the
  // CALLER's inputs — which names were re-mapped, which are string-valued
  // `vars` — not the CSE transform, and an emitter that needs that fact for
  // a decision of its own (`isEmissionSkippable`) must not have its answer
  // change because sharing was turned off. Every transform that DOES share
  // an emission checks `enabled` for itself.
  if (
    options.enabled === false ||
    (typeof target.cseBind !== 'function' &&
      typeof target.cseMaterialize !== 'function')
  ) {
    target.cse = { enabled: false, harvestOptions, instances: [] };
    return;
  }
  const harvest = harvestCse(expr, harvestOptions);
  mergeUsedNames(target, harvest.usedNames);
  target.cse = { enabled: true, harvest, harvestOptions, instances: [] };
}

/** Add a harvest's symbol inventory to the compilation's collision
 * inventory, in place (a harvest runs at every boundary AND per emitted
 * user-function body — copying each time is pure churn). */
export function mergeUsedNames(
  target: CompileTarget<Expression>,
  names: ReadonlySet<string>
): void {
  const merged = namingContext(target).usedNames;
  for (const n of names) merged.add(n);
}

/** The static harvest of the tree currently being emitted. See
 * `cseRegionOf` for why the narrowing is explicit. */
export function cseHarvestOf(
  target: CompileTarget<Expression>
): CseHarvest | undefined {
  return target.cse?.harvest as CseHarvest | undefined;
}

/**
 * Compile `fn` under a fresh instance of the innermost region, so that every
 * temporary `fn` binds is emitted by `cseBind` around `fn`'s OWN result
 * instead of by the enclosing instance. A lowering that emits a guarded fast
 * path followed by the generic lowering of the same node uses this for the
 * generic branch: its temporaries (an array-valued intermediate, say) then
 * run only when the guard takes that branch, never before the fast path,
 * while the branch still shares repeated work with itself. Temporaries an
 * enclosing instance has ALREADY bound stay in scope and are reused. With
 * CSE inactive `fn` compiles as is.
 */
export function withCseLocalInstance(
  target: CompileTarget<Expression>,
  fn: () => TargetSource
): TargetSource {
  const top = cseTop(target);
  if (top === undefined) return fn();
  return withCseRegion(target, cseRegionOf(top), fn);
}

/**
 * The statement-list flavor of {@link withCseOperand}: pushes the region of
 * edge `(parent, opIndex)` for the duration of `fn` without wrapping its
 * result. Only for INERT regions (a `Block`/`Loop` statement list, §5.1(c)),
 * which bind nothing — the statements' own value expressions are separate,
 * bindable child regions.
 */
export function withCseScope<T>(
  parent: Expression | undefined,
  opIndex: number,
  target: CompileTarget<Expression>,
  fn: () => T
): T {
  const top = cseTop(target);
  if (top === undefined || parent === undefined) return fn();
  const region = descendantRegionAt(cseRegionOf(top), parent, opIndex);
  if (region === undefined) return fn();
  const instance = pushCseInstance(target, region);
  let result: T;
  try {
    result = fn();
  } finally {
    target.cse!.instances.pop();
  }
  // Fail CLOSED (D6) on the normal path: an inert region has no wrapper to
  // emit the bindings with, so a temporary accumulated here would be
  // DROPPED — the body would reference a name nothing defines. A
  // `console.assert` is stripped from the production build, so this is a
  // throw. (The exception path is left alone: it must not mask the original
  // error.)
  if (instance.bindings.length > 0)
    throw new Error(
      'Internal: a statement-list CSE region bound a temporary, which has ' +
        'no wrapper to emit it.'
    );
  return result;
}

/** Compile operand `opIndex` of `parent` (§5.1's `compileOp`). */
export function compileOp(
  parent: Expression | undefined,
  opIndex: number,
  target: CompileTarget<Expression>,
  prec = 0,
  operand?: Expression
): TargetSource {
  const expr = operand ?? operandAt(parent, opIndex);
  return withCseOperand(parent, opIndex, target, () =>
    core.compile(expr, target, prec)
  );
}

/** {@link compileOp} through the multi-statement-block guard
 * (`compileValueOperand`). */
export function compileOpValue(
  parent: Expression | undefined,
  opIndex: number,
  target: CompileTarget<Expression>,
  prec = 0,
  operand?: Expression
): TargetSource {
  const expr = operand ?? operandAt(parent, opIndex);
  // A lazily-evaluated operand (the right side of `And`/`Or`, a `Coalesce`
  // fallback) must not hoist statements ahead of the construct that may
  // skip it: the target's `lazyOperand` hook compiles it with hoisting
  // refused. A conditional arm reaches here through that same guard and is
  // detected once.
  const lazy =
    target.lazyOperand !== undefined &&
    isFunction(parent) &&
    lazyOperandRegions(parent).some((site) => site.index === opIndex);
  // An edge that is not lazy and has no region of its own compiles its
  // operand directly, as `withCseOperand` would: without the two frames
  // of the callback, each level of a nested expression uses less stack
  // (ROADMAP CE-320.2).
  if (!lazy) {
    const top = cseTop(target);
    if (
      top === undefined ||
      parent === undefined ||
      descendantRegionAt(cseRegionOf(top), parent, opIndex) === undefined
    )
      return compileValueOperand(expr, target, prec);
  }
  return withCseOperand(parent, opIndex, target, () =>
    lazy
      ? target.lazyOperand!(
          parent!.operator,
          () => compileValueOperand(expr, target, prec),
          target
        )
      : compileValueOperand(expr, target, prec)
  );
}

export function operandAt(
  parent: Expression | undefined,
  opIndex: number
): Expression | undefined {
  if (parent === undefined || !isFunction(parent) || opIndex < 0)
    return undefined;
  return parent.ops[opIndex];
}

/**
 * Compile the ROOT expression of a compilation as the harvest's root region
 * (§6.1), so top-level candidates bind around the whole emitted expression.
 * Falls back to a plain compile when CSE is inactive.
 */
export function compileCseRoot(
  expr: Expression | undefined,
  target: CompileTarget<Expression>,
  prec = 0,
  /** What to emit inside the root region. Defaults to compiling `expr`; the
   * `Function`-literal route passes a callback that descends to the lambda
   * BODY region (the root region holds only the `Function` node itself). */
  fn?: () => TargetSource
): TargetSource {
  // The root is a tail position: a `Return` there gives its value
  // (`tailValueFor`).
  const root = expr === undefined ? expr : tailValueFor(expr, target);
  const emit = fn ?? (() => core.compile(root, target, prec));
  const session = target.cse;
  if (
    session === undefined ||
    !session.enabled ||
    session.harvest === undefined
  )
    return emit();
  return withCseRegion(target, cseHarvestOf(target)!.root, emit);
}

/**
 * Emit, once and up front, the subexpressions of `expr` whose value is the
 * same in every repetition of `expr` that `emit` produces, then run `emit`
 * with each of them replaced by a reference to its binding.
 *
 * This is what a binder needs and ordinary CSE cannot give it. An UNROLLED
 * `Sum` compiles the same body nodes once per index value, and each of
 * those compilations pushes a fresh CSE region instance (deliberately — a
 * node-keyed reuse across instances would emit the first index's temporary
 * for every later index). A LOOP-form `Sum` or a `Comprehension` compiles
 * the body once, but the emitted loop RUNS it once per iteration, and a CSE
 * temporary bound at the body region's top is re-evaluated on every
 * iteration with it. Subexpressions that mention none of the loop's own
 * names are the exception: their value cannot differ between repetitions,
 * so one binding, emitted before the loop, serves them all.
 *
 * `varyingNames` are the names whose binding differs from one repetition to
 * the next (the unrolled or looped indices). A subexpression that mentions
 * one of them anywhere is not invariant. Neither is one that mentions a
 * symbol `expr` ASSIGNS anywhere (`Assign`/`Declare`): the assignment runs
 * inside the loop, so a read of that symbol can change between iterations
 * even though the reading node is itself pure.
 *
 * Two kinds of subexpression are hoisted, both chosen because their
 * duplication is expensive: a COLLECTION-valued subexpression, whose
 * emission materializes the whole collection (a `Range` lowers to an
 * `Array.from` plus one `.map()` per element-wise step, so re-emitting it
 * multiplies the source size AND re-runs the construction at run time); and
 * a scalar-valued application that CONSUMES a collection operand — a
 * reduction such as `Min(P)`, `Max(P)` or `Length(P)` — whose run-time cost
 * is a pass over the whole collection. A loop body that reads `Min(P)` at
 * every iteration otherwise runs a full pass over `P` per iteration, so
 * the loop is quadratic in the length of `P` (Tycho item 248: a 10 000
 * element histogram row took 25 s). A scalar subexpression that consumes
 * no collection lowers to a few tokens that the target language's own
 * compiler folds better than this pass could, and hoisting it would churn
 * emission for no measurable gain.
 *
 * Hoisting changes how many TIMES a subexpression is evaluated, so a
 * candidate has to clear the same bar as a CSE candidate: `isPure` plus the
 * emission-purity gate (`isCseAdmissible`), and it must sit in an operand
 * position that is evaluated unconditionally — a hoist out of a `Which` arm
 * or a short-circuited operand would evaluate it even when the arm does not
 * run, so `lazyOperandRegions` positions are never entered. Neither is a
 * binder's own body: the names it binds do not exist at the point the
 * bindings are emitted.
 *
 * Returns the bindings in DEPENDENCY order — a binding whose right-hand
 * side references an earlier binding comes after it — together with
 * `emit`'s result; `emit` receives the same list, so a caller that places
 * the bindings inside the code it emits can do so. Each binding carries the
 * representative NODE it was compiled from as well as its name and code, so
 * a target whose declarations are typed (the shader languages) can ask the
 * node for its static type. The caller emits them
 * where its own construct declares locals, in the returned order, and must
 * emit them ALL: a binding whose name the emitted code references but
 * nothing declares is not valid source. A caller whose loop may run ZERO
 * times must also make sure the bindings are not evaluated in that case
 * (an early return before them, or a first-iteration initialization): the
 * loop body never ran them, so evaluating them anyway could raise an error
 * the unhoisted code never raised.
 *
 * `accept` lets a caller refuse a class it could not declare — a shader
 * local needs a static type, and a value that has none must keep emitting
 * inline. Refusing costs the optimization and nothing else.
 */
export function hoistLoopInvariants<T>(
  expr: Expression,
  varyingNames: ReadonlyArray<string>,
  target: CompileTarget<Expression>,
  emit: (bindings: ReadonlyArray<LoopInvariantBinding>) => T,
  accept?: (node: Expression, code: string) => boolean
): { bindings: Array<LoopInvariantBinding>; result: T } {
  const { classes, prefixCalls } = loopInvariantHoistCandidates(
    expr,
    new Set(varyingNames),
    target
  );
  if (classes.length === 0) return { bindings: [], result: emit([]) };

  const bindings: Array<LoopInvariantBinding> = [];
  const installed: Expression[] = [];
  try {
    for (const nodes of classes) {
      // Compiled under the ENCLOSING target, never a repetition's: the node
      // mentions none of the varying names, so the only thing a repetition's
      // target changes for it is the mapping of names it does not use.
      //
      // Compiling it OUT of its operand position can decline where the
      // position would not have — an emitter is free to fold or reshape an
      // operand instead of compiling it, so the operand's own lowering may
      // never be reached. That is not this pass's decline to raise: dropping
      // the candidate leaves the repetitions emitting it exactly as they did
      // before, and if their emission does reach the same lowering it raises
      // the decline itself.
      // Compiling the representative can leave state behind that only the
      // BINDING makes sense of: statements pushed into the target's
      // statement-hoisting sink (`CompileTarget.hoist`, how a shader target
      // lowers a nested loop) and an advanced temporary-name counter. When
      // the class is then thrown away, those statements declare a value
      // nothing reads while the occurrences compile the subtree again — and
      // emit the same statements a second time. Snapshot both and roll them
      // back on a discard, the way `_codeOverrides` are unwound below.
      const naming = namingContext(target);
      const sink = target.hoist?.stmts;
      const sinkLength = sink?.length ?? 0;
      const counterBefore = naming.counter;
      const discardCompiled = (): void => {
        if (sink !== undefined && sink.length > sinkLength)
          sink.length = sinkLength;
        naming.counter = counterBefore;
      };
      let code: TargetSource;
      try {
        code = core.compile(nodes[0], target);
      } catch (e) {
        discardCompiled();
        // A caller's cancellation propagates (the `finally` below removes
        // the overrides installed so far); any other error drops the
        // candidate.
        throwIfCallerCancellation(e, nodes[0].engine._deadlineFrame);
        continue;
      }
      // Code that is ALREADY a bare name needs no binding of its own: the
      // value sits in a local the enclosing emission declared (a hoisted
      // loop's accumulator, a temporary bound above), and that local is in
      // scope wherever this pass places its bindings. Point the occurrences
      // straight at it instead of declaring `const t2 = t1;`. Nothing is
      // rolled back here: the occurrences emit that very name, so the
      // statements the compilation pushed into the sink are the ones that
      // give the name its value and must stay — this is how a nested loop
      // is lifted out of the loop that contains it.
      if (/^[A-Za-z_$][\w$]*$/.test(code)) {
        for (const node of nodes) {
          _codeOverrides.set(node, code);
          installed.push(node);
        }
        continue;
      }
      // A caller that cannot DECLARE every value declines here — a shader
      // local needs a static type, and a class whose value has none would
      // leave the body referencing a name nothing declares. A declined class
      // is simply not hoisted: its occurrences emit inline, exactly as they
      // did before this pass ran. The compiled code is dropped whole here,
      // so whatever it pushed into the statement sink goes with it.
      if (accept !== undefined && !accept(nodes[0], code)) {
        discardCompiled();
        continue;
      }
      const name = tempVar(target);
      bindings.push([name, code, nodes[0]]);
      // Every node of the structural class emits as the one name: the class
      // members are distinct node objects with the same structure, and the
      // pass never descends into a lambda or a binder, so they all sit in
      // the same scope and denote the same value.
      for (const node of nodes) {
        _codeOverrides.set(node, name);
        installed.push(node);
      }
    }
    return { bindings, result: emit(bindings) };
  } finally {
    for (const node of installed) _codeOverrides.delete(node);
    for (const call of prefixCalls) _prefixCallOverrides.delete(call);
  }
}

/**
 * The options an emission-purity check (`isCseAdmissible`,
 * `isCallerMapped`) must run under at this point of `target`'s compilation,
 * or `undefined` when no such check may be made at all.
 *
 * The gate needs the compilation's provenance predicates — which operator
 * names the caller re-mapped through `functions`/`operators`, which symbols
 * are backed by string-valued `vars`. They are recorded by the compilation
 * boundary that opens the CSE session, whether or not sharing is enabled
 * there; a target that never opened one has no way to tell a live-source
 * splice from an ordinary emission, so a caller that gets `undefined` must
 * fail closed rather than check against empty predicates.
 *
 * Every admission lookup inside the gate (a user-function callee, a named
 * callback) is engine-GLOBAL, so a name an enclosing binder or parameter has
 * rebound would be validated against the wrong definition. The names in
 * scope here are exactly the ones the emission tracks as bound, plus
 * `varying` — the names whose binding differs between the repetitions the
 * caller is about to emit.
 */
export function cseAdmission(
  target: CompileTarget<Expression>,
  varying: ReadonlySet<string>
): CseHarvestOptions | undefined {
  const options = target.cse?.harvestOptions as CseHarvestOptions | undefined;
  if (options === undefined) return undefined;
  return {
    ...options,
    shadowedNames: new Set([
      ...(options.shadowedNames ?? []),
      ...(target.boundVars ?? []),
      ...varying,
    ]),
  };
}

/**
 * Whether the emission of every tree in `nodes` may be SKIPPED at run time
 * — under a guard that short-circuits it — without the skip being
 * observable other than through the value it saves computing.
 *
 * An emission is skippable when nothing in it is caller-supplied source
 * whose effects are unknown: a `functions`/`operators` entry, a symbol
 * backed by a string-valued `vars` entry, or an operator carrying a
 * caller-supplied `compile` handler splices code this compiler never sees,
 * which is free to count its own calls, log, or mutate shared state — so
 * running it fewer times is a change of behavior, not an optimization. That
 * is the same provenance question `isCseAdmissible` answers for collapsing
 * several emissions into one, and it is asked here in the same form,
 * including its transitive check of a user-defined callee's body.
 *
 * Stated as one rule: an emission may be skipped when nothing in it has
 * observable effects. Three oracles answer that, one per spelling — a
 * `functions` entry through `entryIsPure` (declared on the entry, or
 * inferred from its source: `function-purity.ts`), an operator carrying a
 * caller `compile` handler through the `pure`/`effects` declared on its
 * definition, and everything else through `node.isPure`. The three are
 * read PER NODE, with each oracle's answer standing in for the head it
 * vouches for (`Harvester.isEffectFreeUnderOracles` in `cse.ts`): a
 * signature-only declaration implemented through `functions` projects
 * unknown effects onto every application above it, so `node.isPure` alone
 * would refuse `sq(n·x) + 1` and `wrap(t) := sq(t) + 1` while admitting the
 * bare `sq(n·x)`. A spelling with no oracle — an `operators` entry, a
 * string-valued `vars` symbol — is refused, because nothing can vouch for
 * it.
 *
 * Purity buys SKIPPING and nothing else. A caller-supplied implementation
 * stays opaque to every pass that would rewrite what is inside it, however
 * pure it is, because the emitter receives its operands as text.
 *
 * `varyingNames` are the names bound differently across the repetitions
 * being emitted (an unrolled binder's indices); they must not resolve
 * globally inside the gate. Fails closed — returns `false` — when the
 * compilation recorded no provenance predicates to check against.
 */
export function isEmissionSkippable(
  nodes: ReadonlyArray<Expression>,
  varyingNames: ReadonlyArray<string>,
  target: CompileTarget<Expression>
): boolean {
  const base = cseAdmission(target, new Set(varyingNames));
  if (base === undefined) return false;
  // A caller-supplied implementation established to be pure is skippable
  // even though it stays opaque to CSE: the two questions differ. CSE asks
  // whether a pass may rewrite or bind subexpressions INSIDE the emission,
  // and the answer is no regardless of purity, because the emitter receives
  // its operands as text. Skipping asks only whether not running it at all
  // is observable, which purity answers. Setting the relaxation HERE, on a
  // copy of the stored options, rather than in the options the compilation
  // records, keeps CSE proper on exactly the behavior it had.
  const admission: CseHarvestOptions = { ...base, skippabilityQuery: true };
  return nodes.every((node) => isCseAdmissible(node, admission));
}

/**
 * The subexpressions of `expr` that {@link hoistLoopInvariants} may bind,
 * grouped into STRUCTURAL classes (nodes that are `isSame`, so one binding
 * serves every member) and ordered so that a class contained in another
 * class's right-hand side comes first.
 *
 * A candidate mentions none of `varying`, is pure, and is admissible to
 * emit once; it is either collection-valued, or a scalar-valued application
 * with a collection-valued operand (a reduction). A collection-valued
 * candidate is MAXIMAL: it is never descended into, because binding both a
 * node and a subexpression of it would emit the inner one twice, once on
 * its own and once inside the outer binding's right-hand side. A reduction
 * IS descended into first, so that a collection-valued operand it shares
 * with other candidates (`Min(L)`, `Max(L)` and `At(L, j)` over the same
 * list-valued `L`) is bound once and the reduction's right-hand side
 * references that binding — which is why the classes come out in
 * dependency order: an operand's class is recorded before its consumer's.
 */
export function loopInvariantHoistCandidates(
  expr: Expression,
  varying: ReadonlySet<string>,
  target: CompileTarget<Expression>
): { classes: Expression[][]; prefixCalls: Expression[] } {
  // Calls rewritten to an invariant-prefix variant at this site
  // (`_prefixCallOverrides`); the caller removes the entries when its
  // emission is done.
  const prefixCalls: Expression[] = [];
  const none = { classes: [], prefixCalls };
  // Hoisting replaces many emissions of a subexpression with one binding
  // referenced by name — the CSE transform, applied where CSE's own
  // node-keyed reuse cannot reach. `cse: false` turns that sharing off here
  // as it does everywhere else.
  if (target.cse?.enabled !== true) return none;

  const admission = cseAdmission(target, varying);
  if (admission === undefined) return none;

  // A symbol assigned anywhere in the repeated code changes between
  // repetitions, exactly as a loop index does (the same rule the CSE
  // harvest applies through a region's `assignedNames`). A destructuring
  // target (`Declare(Tuple(a, b), …)`) writes every leaf symbol of the
  // pattern.
  const assigned = assignedNamesIn(expr);

  const mentionsVarying = (node: Expression): boolean => {
    if (isSymbol(node))
      return varying.has(node.symbol) || assigned.has(node.symbol);
    if (!isFunction(node)) return false;
    return node.ops.some(mentionsVarying);
  };

  const isCollectionShaped = (node: Expression): boolean =>
    node.type.matches('collection<any>');

  // Structural classes, in dependency order. `byHash` finds the class a
  // node belongs to without an `isSame` against every class.
  const classes: Expression[][] = [];
  const byHash = new Map<number, Expression[][]>();
  /** Add `node` to the structural class it belongs to, creating that class
   * in `into` when it is the first member seen. */
  const record = (node: Expression, into: Expression[][] = classes): void => {
    const bucket = byHash.get(node.hash);
    if (bucket !== undefined)
      for (const cls of bucket)
        if (cls[0].isSame(node)) {
          cls.push(node);
          return;
        }
    const cls = [node];
    into.push(cls);
    if (bucket === undefined) byHash.set(node.hash, [cls]);
    else bucket.push(cls);
  };

  const seen = new Set<Expression>();

  /**
   * May a maximal invariant SCALAR application be recorded WHOLE, or does
   * its subtree hold something one of the other rules owns?
   *
   * Recording a node whole compiles its right-hand side from its operands
   * and never descends into it, so anything inside it that another rule
   * would have handled is lost. Two things qualify, and skipping either
   * costs more than the scalar binding saves:
   *
   * - A COLLECTION-valued node. The collection rules bind the collection
   *   first and let every reduction over it read that binding; a scalar
   *   recorded above them rebuilds the collection once per reduction
   *   instead (`Min(L)·Max(L)` built `L` twice).
   * - A node an ENCLOSING CSE instance has already bound. Inside the loop
   *   it emits as that temporary, but this right-hand side is compiled
   *   while that instance is the INNERMOST one, and `availableCseBinding`
   *   deliberately does not look at the innermost instance (its own
   *   candidates go through the occurrence state machine instead). So the
   *   structure would be emitted a second time, next to the temporary that
   *   already holds it.
   *
   * Answering `false` simply descends, which is what lets the collection
   * rule and the already-bound check at the top of `visit` see the node.
   * Memoized per node object: engine and instance state do not change while
   * this pass runs.
   */
  const wholeMemo = new Map<Expression, boolean>();
  const scalarHoistIsWhole = (node: Expression): boolean => {
    const cached = wholeMemo.get(node);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (isCollectionShaped(node)) result = false;
    else if (
      target.cse !== undefined &&
      availableCseBinding(target.cse, node, true) !== undefined
    )
      result = false;
    else result = !isFunction(node) || node.ops.every(scalarHoistIsWhole);
    wholeMemo.set(node, result);
    return result;
  };

  const visit = (node: Expression): void => {
    if (seen.has(node)) return;
    seen.add(node);

    // Two kinds of node the traversal must treat as OPAQUE — neither
    // bindable itself, nor descended into — because the emission does not
    // walk their subtree either, so nothing below them can ever reference a
    // binding this pass mints.
    //
    // A node that already carries a code override emits as that NAME: its
    // operands are not compiled at this site at all. The traversal reaches
    // one when the same tree is walked twice — a multi-index binder walks
    // its body once per clause level — and descending would discover an
    // operand of an already-hoisted node as a fresh candidate, emitting a
    // `const` binding that nothing ever references. (An override is also
    // what the D2/D6 runtime real-operand rule installs on a maybe-complex
    // operand; the `isComplexValued` clause below keeps this pass from
    // installing one over it and dropping its real guard.)
    //
    // A caller-mapped node — an operator re-mapped through
    // `functions`/`operators`, or one carrying a caller-supplied `compile`
    // handler — emits through source this compiler never sees, which may
    // evaluate an operand's text lazily, repeatedly, or not at all, and may
    // hand a mutable array to user code. Hoisting from under it changes
    // evaluation count and timing, and can share one JS array where each
    // repetition built a fresh one. This is the harvest's own `underMapped`
    // rule, which stops CSE candidates at the same boundary.
    if (_codeOverrides.has(node)) return;
    if (isCallerMapped(node, admission)) return;

    // Only an APPLICATION is worth a binding: a bare symbol or a literal is
    // one read wherever it appears.
    if (!isFunction(node)) return;

    // A node an ENCLOSING region instance has already bound as a CSE
    // temporary emits as that name (`availableCseBinding`), operands
    // uncompiled: neither it nor anything below it needs a binding here,
    // and a reduction hoisted from under it would be evaluated and never
    // read.
    if (
      target.cse !== undefined &&
      availableCseBinding(target.cse, node, true) !== undefined
    )
      return;

    const invariant =
      !mentionsVarying(node) &&
      node.isPure === true &&
      !core.isComplexValued(node) &&
      isCseAdmissible(node, admission);

    if (invariant && isCollectionShaped(node)) {
      record(node);
      return;
    }
    // A binder's operands are written in terms of the names the binder
    // introduces, which are out of scope where the bindings are emitted —
    // so a binder is never descended into. An invariant binder that LOOPS
    // (a `Sum` over an indexing set, an integral over its limits, a fold
    // over a collection) is bound whole: it runs its own loop on every
    // repetition otherwise, and it mentions none of the names the
    // repetitions vary.
    if (node.operator === 'Function') return;
    if (node.operatorDefinition?.scoped) {
      if (
        invariant &&
        node.ops.some(
          (op) =>
            isCollectionShaped(op) ||
            isFunction(op, 'Limits') ||
            isFunction(op, 'Element')
        )
      )
        record(node);
      return;
    }
    // A target that asks for it (`hoistScalarInvariants`, the interval
    // target) binds every MAXIMAL invariant scalar application as well: the
    // node is recorded whole and not descended into, so the largest
    // index-free subtree is the one computed once. A binder or a lambda
    // never reaches here (returned above), and a node in a conditional
    // position is reached only by the `attach` pass below. A reduction over
    // a collection operand is left to the descend-then-record rule at the
    // end, so the operand is bound before it and shared with any other
    // consumer of the same collection.
    if (
      invariant &&
      target.hoistScalarInvariants === true &&
      scalarHoistIsWhole(node)
    ) {
      record(node);
      return;
    }
    // A VARYING call of a user function whose body has an invariant
    // prefix — a subexpression of the body that reads only parameters this
    // call passes the same argument to on every repetition
    // (`invariantPrefixes`): each such prefix, with this call's arguments
    // substituted for the callee's parameters, is a synthesized invariant
    // of the repetition. It is recorded as an ordinary class — compiled,
    // bound and given a code override like any other — and the call is
    // rewritten to the callee's variant that takes the bound values as
    // extra parameters (`_prefixCallOverrides`, read by
    // `tryCompileUserFunction`). The call's own arguments still compile
    // per repetition, so the rewrite is a recipe keyed on the node, not a
    // code string. The variant is emitted by the target's own definition
    // lowering where it has one (the shader targets receive the prefix
    // values as extra typed parameters), else as a JavaScript arrow
    // definition.
    if (
      !invariant &&
      (target.language === 'javascript' ||
        target.language === 'interval-javascript' ||
        target.language === 'glsl' ||
        target.language === 'wgsl') &&
      !_prefixCallOverrides.has(node)
    ) {
      const synthesized = synthesizeInvariantPrefixes(
        node,
        varying,
        assigned,
        admission,
        target
      );
      if (synthesized !== undefined) {
        for (const value of synthesized.values) record(value);
        _prefixCallOverrides.set(node, synthesized);
        prefixCalls.push(node);
      }
    }
    const lazy = lazyOperandRegions(node);
    for (let i = 0; i < node.ops.length; i++)
      if (!lazy.some((site) => site.index === i)) visit(node.ops[i]);
    // A reduction: recorded AFTER its operands so a shared collection
    // operand is bound first and this right-hand side references it.
    if (invariant && node.ops.some(isCollectionShaped)) record(node);
  };

  visit(expr);
  if (classes.length === 0) return { classes, prefixCalls };

  // A maximal invariant node is recorded WHOLE and never descended into, so
  // a subexpression that two of those nodes share — or that one of them
  // evaluates twice — is emitted once inside each binding that contains it.
  // Ask the CSE harvest which subexpressions of `expr` repeat, and give
  // each repeated INVARIANT one a binding of its own, placed ahead of the
  // bindings that contain it. Without this a shader's hoisted block
  // recomputed `fract(x)` six times and one `sin(dot(…))` hash twice — a
  // heat-map kernel, pinned in
  // `test/compute-engine/item-280-cse-shared-subterms.test.ts`.
  //
  // The harvest is what decides whether a subexpression repeats often
  // enough to be worth a binding, so this pass inherits the CSE size and
  // benefit thresholds unchanged. It reaches only the candidates of the
  // harvest's ROOT region: a candidate of an inner region sits behind a
  // condition or inside a nested binder, where a binding emitted before
  // the loop would be evaluated when the original was not.
  const shared: Expression[][] = [];
  const members = new Set<Expression>();
  for (const cls of classes) for (const node of cls) members.add(node);
  const containsMemberMemo = new Map<Expression, boolean>();
  const containsMember = (node: Expression): boolean => {
    const cached = containsMemberMemo.get(node);
    if (cached !== undefined) return cached;
    const result =
      members.has(node) || (isFunction(node) && node.ops.some(containsMember));
    containsMemberMemo.set(node, result);
    return result;
  };
  // Smallest first, so a shared subexpression of another shared one is
  // bound before it and referenced by name inside it.
  const candidates = [...harvestCse(expr, admission).root.candidates].sort(
    (a, b) => a.size - b.size || a.id - b.id
  );
  for (const candidate of candidates) {
    const node = candidate.representative;
    // The exclusions `visit` applies to a node it might record, plus one:
    // a candidate that CONTAINS a node an existing class already binds
    // would be compiled before that class installs its name, emitting the
    // enclosed structure a second time. The harvest has already applied
    // the purity and emission-purity gates (`isPure`, `isCseAdmissible`),
    // so only the rules it knows nothing about are restated here.
    if (mentionsVarying(node)) continue;
    if (node.operator === 'Function') continue;
    if (core.isComplexValued(node)) continue;
    if (isCallerMapped(node, admission)) continue;
    if (
      target.cse !== undefined &&
      availableCseBinding(target.cse, node, true) !== undefined
    )
      continue;
    if (containsMember(node)) continue;
    for (const occurrence of candidate.nodes)
      if (
        !_codeOverrides.has(occurrence) &&
        // An occurrence an existing class already binds must not be
        // recorded again: `record` finds that class by structure and would
        // push the very same node into it a second time. The test above
        // reads the REPRESENTATIVE only, and two occurrences of one
        // structure need not have been recorded alike — `visit` skips a
        // lazy operand region, so one occurrence can be a member while the
        // representative is not.
        !members.has(occurrence)
      )
        record(occurrence, shared);
  }

  // Second pass: a node in a CONDITIONALLY evaluated position (a `Which`
  // arm, a short-circuited `And` operand) that has the same structure as a
  // recorded class joins that class. The binding is computed
  // unconditionally either way — a member in an unconditional position
  // already forced it — so referencing it from the arm evaluates nothing
  // new, and the arm stops recomputing what the binding already holds
  // (`Min(P)` in both halves of `a ≤ x ∧ x < b`, where only the first half
  // is unconditional). The pass reads the whole tree except lambdas and
  // binders (their names may rebind a symbol) and the opaque nodes above;
  // a node that joins a class is not descended into, since it emits as the
  // class's name.
  const attach = (node: Expression): void => {
    if (!isFunction(node)) return;
    if (_codeOverrides.has(node)) return;
    if (isCallerMapped(node, admission)) return;
    const bucket = byHash.get(node.hash);
    if (bucket !== undefined)
      for (const cls of bucket)
        if (cls[0].isSame(node)) {
          if (!cls.includes(node)) cls.push(node);
          return;
        }
    if (node.operator === 'Function' || node.operatorDefinition?.scoped) return;
    for (const op of node.ops) attach(op);
  };
  attach(expr);
  return { classes: [...shared, ...classes], prefixCalls };
}

/**
 * The names `expr` ASSIGNS anywhere (`Assign`/`Declare`). A destructuring
 * target (`Declare(Tuple(a, b), …)`) writes every leaf symbol of the
 * pattern. A read of such a name can change between two evaluations of
 * the code around it even though the reading node is itself pure.
 */
export function assignedNamesIn(expr: Expression): Set<string> {
  const assigned = new Set<string>();
  const recordTarget = (t: Expression | undefined): void => {
    if (t === undefined) return;
    if (isSymbol(t)) assigned.add(t.symbol);
    else if (isFunction(t, 'Tuple'))
      for (const leaf of t.ops) recordTarget(leaf);
  };
  const collect = (node: Expression): void => {
    if (!isFunction(node)) return;
    if (node.operator === 'Assign' || node.operator === 'Declare')
      recordTarget(node.ops[0]);
    for (const op of node.ops) collect(op);
  };
  collect(expr);
  return assigned;
}

/**
 * The INVARIANT PREFIXES of user function `h`: the subexpressions of its
 * body that a call site can evaluate once and hand to the body, when the
 * site calls `h` repeatedly with the same arguments at the parameters the
 * subexpression reads (`CompileTarget.userFunctions.prefixes`).
 *
 * A definition body is compiled once and called from every repetition of
 * a loop, so a subexpression of it that depends on one parameter only is
 * evaluated again on every call even when the call passes that parameter
 * the same value each time — an exoplanet transit kernel called
 * `S(r_i, t)` forty times per sample, and each call recomputed a
 * transcendental `m(t)` that never changed (Tycho code-generation audit of
 * 0.128.9, records 178–183). Ordinary CSE cannot reach it: the repeated
 * evaluation is inside the callee, and the callee's own harvest sees one
 * call.
 *
 * A prefix is a MAXIMAL subexpression of the body that:
 *  - is an application reading a strict, non-empty subset of the
 *    parameters (a subexpression that reads every parameter varies with
 *    the call; one that reads none is a constant the callee's own
 *    emission already folds or binds), and reads no parameter its
 *    expensive parts do not read (`m(t)·r` is not a prefix; `m(t)` is —
 *    the product is computed per call, and a site where only `r` varies
 *    still hoists `m(t)`);
 *  - reads no name the body assigns, and contains no binder or lambda
 *    (their bound names would be captured by the substitution at the call
 *    site);
 *  - is pure and admissible to evaluate once (`isPure`,
 *    `isCseAdmissible`), and not complex-valued — the same bar a hoisted
 *    loop invariant clears;
 *  - is expensive: it contains a user-function call or a transcendental
 *    (`EXPENSIVE_PREFIX_HEADS`);
 *  - is evaluated on every call: it sits in no lazily evaluated operand
 *    position (`lazyOperandRegions`) — a call site evaluates every prefix
 *    unconditionally, and evaluating what a conditional arm would have
 *    skipped is what the loop-invariant hoist refuses to do as well.
 *
 * MAXIMAL, with two cuts. A candidate that contains an expensive unit the
 * body evaluates elsewhere too (`m(t)² · … / m(t)`) is not recorded whole,
 * because the call site would then evaluate that unit once for the
 * candidate and once for the other occurrence; the walk descends into such
 * a candidate instead, and the shared unit becomes the prefix — one extra
 * parameter read by both occurrences. And a candidate is cut back to the
 * parameters its expensive units read (the first bullet above): the cheap
 * arithmetic around them is computed per call.
 *
 * Returns the empty list for a function whose call sites cannot take a
 * variant: a generic function, a multi-clause set, a function with a
 * rest or destructuring parameter, one parameter or fewer, a body that
 * assigns a parameter, a parameter that binds a collection or point whole
 * (`userFunctionParamsAreScalar`), or a function whose definition is
 * currently being compiled (a recursive reference). Computed once per
 * function and compilation.
 */
export function invariantPrefixes(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>
): ReadonlyArray<InvariantPrefix<Expression>> {
  const registry = target.userFunctions;
  if (!registry) return [];
  const cached = registry.prefixes?.get(h);
  if (cached !== undefined) return cached;
  const prefixes = computeInvariantPrefixes(engine, h, target, registry);
  (registry.prefixes ??= new Map()).set(h, prefixes);
  return prefixes;
}

export function computeInvariantPrefixes(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>,
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>
): ReadonlyArray<InvariantPrefix<Expression>> {
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return [];
  if (userFunctionIsGeneric(engine, h, literal)) return [];
  if (!userFunctionParamsAreScalar(engine, h)) return [];
  if (registry.compiling.has(userFunctionName(registry, h))) return [];
  const params = literal.ops.slice(1);
  if (params.length < 2) return [];
  if (params.some((p) => isRestParameter(p) || isDestructuringParameter(p)))
    return [];
  const names: string[] = [];
  for (const p of params) {
    const name = functionLiteralParameterName(p);
    if (name === undefined) return [];
    names.push(name);
  }
  const paramSet = new Set(names);
  // A body that assigns a parameter reads it at more than one value; the
  // substitution at the call site would read the argument only.
  const writesParameter = (node: Expression): boolean =>
    isFunction(node) &&
    ((node.operator === 'Assign' &&
      node.op1.symbols.some((s) => paramSet.has(s))) ||
      node.ops.some(writesParameter));
  if (writesParameter(literal.op1)) return [];
  // A self-recursive body would call the ordinary definition from inside
  // the variant, so both would be emitted and the recursion would gain
  // nothing; such a function keeps its ordinary call.
  const callsItself = (node: Expression): boolean =>
    isFunction(node) && (node.operator === h || node.ops.some(callsItself));
  if (callsItself(literal.op1)) return [];

  const root = registry.root ?? target;
  const admission = cseAdmission(root, paramSet);
  if (admission === undefined) return [];

  const bodyExpr = definitionBodyExpr(literal, target, registry, h);
  const assigned = assignedNamesIn(bodyExpr);

  /** The parameters `node` reads, memoized per node object. */
  const readsMemo = new Map<Expression, ReadonlySet<string>>();
  const reads = (node: Expression): ReadonlySet<string> => {
    const cached = readsMemo.get(node);
    if (cached !== undefined) return cached;
    const result = new Set<string>();
    if (isSymbol(node)) {
      if (paramSet.has(node.symbol)) result.add(node.symbol);
    } else if (isFunction(node))
      for (const op of node.ops) for (const s of reads(op)) result.add(s);
    readsMemo.set(node, result);
    return result;
  };
  const mentionsLocal = (node: Expression): boolean =>
    node.symbols.some((s) => assigned.has(s));
  const containsBinder = (node: Expression): boolean =>
    isFunction(node) &&
    (node.operator === 'Function' ||
      node.operatorDefinition?.scoped ||
      node.ops.some(containsBinder));
  // A canonical function body is a `Block` (a scoped operator: it binds
  // the parameters and its own locals), so the walk enters a `Block` —
  // the names a block assigns are excluded through `assigned` — and stops
  // at every other binder and at a lambda.
  const isOpaqueBinder = (node: Expression & FunctionInterface): boolean =>
    node.operator === 'Function' ||
    (node.operator !== 'Block' && Boolean(node.operatorDefinition?.scoped));
  const isUserCall = (node: Expression): boolean =>
    isFunction(node) &&
    !paramSet.has(node.operator) &&
    userFunctionLiteral(engine, node.operator) !== undefined;
  const isExpensive = (node: Expression): boolean =>
    isFunction(node) &&
    (EXPENSIVE_PREFIX_HEADS.has(node.operator) || isUserCall(node));
  const containsExpensive = (node: Expression): boolean =>
    isFunction(node) && (isExpensive(node) || node.ops.some(containsExpensive));
  /** The parameters the expensive units inside `node` (itself included)
   * read, memoized per node object. */
  const unitReadsMemo = new Map<Expression, ReadonlySet<string>>();
  const unitReads = (node: Expression): ReadonlySet<string> => {
    const cached = unitReadsMemo.get(node);
    if (cached !== undefined) return cached;
    const result = new Set<string>();
    if (isExpensive(node)) for (const s of reads(node)) result.add(s);
    else if (isFunction(node))
      for (const op of node.ops) for (const s of unitReads(op)) result.add(s);
    unitReadsMemo.set(node, result);
    return result;
  };
  /** Does `node` have the shape of a prefix, expense aside? */
  const shapeMemo = new Map<Expression, boolean>();
  const hasPrefixShape = (node: Expression): boolean => {
    const cached = shapeMemo.get(node);
    if (cached !== undefined) return cached;
    let result = false;
    if (isFunction(node)) {
      const r = reads(node);
      result =
        r.size > 0 &&
        r.size < paramSet.size &&
        !mentionsLocal(node) &&
        !containsBinder(node) &&
        node.isPure === true &&
        !core.isComplexValued(node) &&
        isCseAdmissible(node, admission);
    }
    shapeMemo.set(node, result);
    return result;
  };

  // Structural classes, as `loopInvariantHoistCandidates` keeps them.
  const byHash = new Map<number, Expression[][]>();
  const classOf = (node: Expression): Expression[] | undefined => {
    const bucket = byHash.get(node.hash);
    if (bucket !== undefined)
      for (const cls of bucket) if (cls[0].isSame(node)) return cls;
    return undefined;
  };
  const record = (node: Expression, into?: Expression[][]): Expression[] => {
    const found = classOf(node);
    if (found !== undefined) {
      found.push(node);
      return found;
    }
    const cls = [node];
    into?.push(cls);
    const bucket = byHash.get(node.hash);
    if (bucket === undefined) byHash.set(node.hash, [cls]);
    else bucket.push(cls);
    return cls;
  };

  // First pass: how often does each prefix-shaped expensive UNIT occur in
  // an unconditionally evaluated position of the body? A unit that occurs
  // more than once must become a prefix of its own rather than be
  // evaluated inside a larger prefix — see the exception above.
  const unitCount = new Map<Expression[], number>();
  const countUnits = (node: Expression): void => {
    if (!isFunction(node)) return;
    if (isOpaqueBinder(node)) return;
    if (isExpensive(node) && hasPrefixShape(node)) {
      const cls = record(node);
      unitCount.set(cls, (unitCount.get(cls) ?? 0) + 1);
    }
    const lazy = lazyOperandRegions(node);
    for (let i = 0; i < node.ops.length; i++)
      if (!lazy.some((site) => site.index === i)) countUnits(node.ops[i]);
  };
  countUnits(bodyExpr);
  /** Every prefix-shaped expensive unit strictly inside `node` occurs
   * once in the body. */
  const occursOnce = (unit: Expression): boolean => {
    const cls = classOf(unit);
    return cls !== undefined && unitCount.get(cls) === 1;
  };
  const innerUnitsSingle = (node: Expression): boolean =>
    !isFunction(node) ||
    node.ops.every(
      (op) =>
        (!isExpensive(op) || !hasPrefixShape(op) || occursOnce(op)) &&
        innerUnitsSingle(op)
    );

  // Second pass: the maximal prefixes, in body order. A prefix reads no
  // parameter its expensive units do not read: the cheap arithmetic
  // around them must not widen the parameter set, or a site where only
  // that added parameter varies would lose the hoist (`m(t)·r` reads
  // `r`; the prefix is `m(t)`, and the product is computed per call).
  const prefixes: Expression[][] = [];
  const visit = (node: Expression): void => {
    if (!isFunction(node)) return;
    if (isOpaqueBinder(node)) return;
    if (
      hasPrefixShape(node) &&
      containsExpensive(node) &&
      unitReads(node).size === reads(node).size &&
      innerUnitsSingle(node)
    ) {
      const cls = classOf(node);
      if (cls !== undefined && prefixes.includes(cls)) cls.push(node);
      else if (cls !== undefined) prefixes.push(cls);
      else record(node, prefixes);
      return;
    }
    const lazy = lazyOperandRegions(node);
    for (let i = 0; i < node.ops.length; i++)
      if (!lazy.some((site) => site.index === i)) visit(node.ops[i]);
  };
  visit(bodyExpr);
  return prefixes.map((cls) => ({
    expr: cls[0],
    params: names.filter((n) => reads(cls[0]).has(n)),
  }));
}

/**
 * The invariant prefixes of the callee that the user-function call `node`
 * can hoist at a repetition site, with the call's arguments substituted
 * for the callee's parameters: the recipe `hoistLoopInvariants` installs
 * as the call's `_prefixCallOverrides` entry. `undefined` when the call
 * hoists nothing.
 *
 * A prefix is hoistable at this call when every argument at a parameter
 * it reads is invariant across the repetitions (`varying`, `assigned` are
 * the site's own varying and assigned names), pure and admissible to
 * evaluate once, not complex-valued, and free of binders (the
 * substitution is not capture-avoiding); and when no OTHER symbol the
 * prefix reads — a global of the callee's body — is bound at the call
 * site, where the substituted expression is compiled: a site-bound name
 * would capture it. The substituted expression must pass the same
 * invariance bar itself.
 */
export function synthesizeInvariantPrefixes(
  node: Expression & FunctionInterface,
  varying: ReadonlySet<string>,
  assigned: ReadonlySet<string>,
  admission: CseHarvestOptions,
  target: CompileTarget<Expression>
):
  | { prefixes: ReadonlyArray<number>; values: ReadonlyArray<Expression> }
  | undefined {
  const h = node.operator;
  if (target.boundVars?.has(h)) return undefined;
  const engine = node.engine as unknown as ComputeEngine;
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return undefined;
  const prefixes = invariantPrefixes(engine, h, target);
  if (prefixes.length === 0) return undefined;
  const paramNames = literal.ops
    .slice(1)
    .map((p) => functionLiteralParameterName(p));
  if (node.nops !== paramNames.length) return undefined;
  const argOf = new Map<string, Expression>();
  paramNames.forEach((p, i) => {
    if (p !== undefined) argOf.set(p, node.ops[i]);
  });
  const siteBound = (s: string): boolean =>
    varying.has(s) || assigned.has(s) || target.boundVars?.has(s) === true;
  const mentionsSiteVarying = (e: Expression): boolean =>
    e.symbols.some((s) => varying.has(s) || assigned.has(s));
  const containsBinder = (e: Expression): boolean =>
    isFunction(e) &&
    (e.operator === 'Function' ||
      e.operatorDefinition?.scoped ||
      e.ops.some(containsBinder));
  const invariantHere = (e: Expression): boolean =>
    !mentionsSiteVarying(e) &&
    e.isPure === true &&
    !containsBinder(e) &&
    !core.isComplexValued(e) &&
    isCseAdmissible(e, admission);

  const chosen: number[] = [];
  const values: Expression[] = [];
  prefixes.forEach((prefix, index) => {
    const args = prefix.params.map((p) => argOf.get(p));
    if (args.some((a) => a === undefined || !invariantHere(a))) return;
    if (
      prefix.expr.symbols.some(
        (s) => !prefix.params.includes(s) && siteBound(s)
      )
    )
      return;
    const substitution: Record<string, Expression> = {};
    prefix.params.forEach((p, j) => {
      substitution[p] = args[j]!;
    });
    const value = prefix.expr.subs(substitution);
    if (!isFunction(value) || !invariantHere(value)) return;
    chosen.push(index);
    values.push(value);
  });
  if (chosen.length === 0) return undefined;
  return { prefixes: chosen, values };
}

/**
 * Compile an emission-time tree that is NOT part of the root harvest — a
 * user-defined function's definition body (§5.4) — under its own nested
 * harvest scope: own regions and candidates, same session and naming
 * counter (so temps never collide across the artifact), and the same G1b
 * provenance predicates the boundary recorded.
 *
 * `shadowedNames` are the emitted definition's PARAMETER names. They are
 * bound by the definition, not by anything inside the body tree, so the
 * harvester's own binder prepass cannot see them — yet the harvest's
 * admission lookups are engine-global, so without them a parameter that
 * happens to share a global's name would be validated against that global.
 */
export function withNestedCseHarvest(
  expr: Expression,
  target: CompileTarget<Expression>,
  shadowedNames: ReadonlyArray<string>,
  fn: () => TargetSource
): TargetSource {
  const session = target.cse;
  if (session === undefined || !session.enabled) return fn();
  const outer = session.harvest;
  // Definition bodies admit PURE user-function applications as candidates
  // (item 120): a repeated self-call in a recursive body —
  // `R(i-1,x,y) + 0.5·S(x,y,R(i-1,x,y))` — makes the compiled recursion
  // exponential (2^depth calls), and binding it once per level collapses
  // that to linear. Root harvests admit them too (see `openCseSession`), so
  // both routes now pass the flag; it is restated here because a nested
  // harvest may inherit options from a caller-built session.
  const nested = harvestCse(expr, {
    ...(session.harvestOptions ?? {}),
    admitPureUserFunctions: true,
    shadowedNames: new Set([
      ...(session.harvestOptions?.shadowedNames ?? []),
      ...shadowedNames,
    ]),
  });
  mergeUsedNames(target, nested.usedNames);
  session.harvest = nested;
  // The body is emitted as a module-level definition, outside every
  // wrapper the enclosing instances will emit, so their temporaries are
  // out of its scope (`CseSession.availabilityFloor`).
  const outerFloor = session.availabilityFloor;
  session.availabilityFloor = session.instances.length;
  try {
    return withCseRegion(target, nested.root, fn);
  } finally {
    session.harvest = outer;
    session.availabilityFloor = outerFloor;
  }
}

/**
 * Compile `fn`, which emits `expr`, under a CSE harvest of `expr` of its
 * own: `expr` shares its repeated nodes with itself, and reads no
 * temporary that an enclosing instance bound (`withNestedCseHarvest`). For
 * a target handler that compiles a node with
 * other values for its symbols than the code around it: the interval
 * target compiles a conditional arm with its symbols clamped to where the
 * arm can be selected, and a temporary of the code around the arm holds a
 * value over the inputs that are not clamped. With CSE inactive `fn`
 * compiles as is.
 *
 * The names that the scope of `target` binds (`boundVars`, and the
 * function-valued locals of an enclosing block: `localFunctions`,
 * `lexicalFunctions`, `reboundFunctions`) are shadowed in the harvest, as
 * `cseAdmission` does for a loop body. A call of such a name calls the
 * local binding, but the harvest looks a callee up in the engine: with a
 * block-local `f` and a pure engine-level `f`, it would decide about the
 * engine-level `f` and could merge two calls of the local one.
 */
export function withOwnCseHarvest(
  expr: Expression,
  target: CompileTarget<Expression>,
  fn: () => TargetSource
): TargetSource {
  const shadowed = [
    ...(target.boundVars ?? []),
    ...(target.localFunctions?.keys() ?? []),
    ...(target.lexicalFunctions?.keys() ?? []),
    ...(target.reboundFunctions?.keys() ?? []),
  ];
  return withNestedCseHarvest(expr, target, shadowed, fn);
}

/**
 * Compile `fn` with no node-keyed code in effect: no entry of
 * `_codeOverrides`, `_codeAliases` or `_prefixCallOverrides` installed by
 * the code around it. Such an entry gives the code of a node as the name
 * of a value computed outside `fn`: a loop-invariant binding of an
 * enclosing `Sum` (`hoistLoopInvariants`), a temporary of a run-time
 * guard. For a target handler that compiles a node with other values for
 * its symbols than the code around it, or at another place: the interval
 * target compiles a conditional arm with its symbols clamped to where the
 * arm can be selected, and the arms nested in it as local functions
 * defined outside the binders around them. A value computed outside is
 * then over the inputs that are not clamped, or is a name that is not in
 * scope where the function is defined. The entries that `fn` installs
 * itself apply as usual, and the entries of the code around it are in
 * effect again when `fn` returns.
 */
export function withoutNodeCodeOverrides<T>(fn: () => T): T {
  const maps = [_codeOverrides, _codeAliases, _prefixCallOverrides] as Map<
    Expression,
    unknown
  >[];
  const saved = maps.map((map) => [...map]);
  for (const map of maps) map.clear();
  try {
    return fn();
  } finally {
    maps.forEach((map, i) => {
      for (const [node, value] of saved[i]) map.set(node, value);
    });
  }
}

/**
 * Compile `fn` under a fresh instance of the innermost region that cannot
 * read a temporary that an enclosing instance bound
 * (`CseSession.availabilityFloor`). Temporaries that `fn` binds are emitted
 * by `cseBind` around `fn`'s own result, and are not read after it.
 *
 * For a value compiled with a different promotion than the code around it
 * (`withPromotionSuppressed`): the same structure inside and outside the
 * value can have different lanes there, so a temporary bound on one side
 * must not be read on the other side. With CSE inactive `fn` compiles as
 * is.
 */
export function withCseIsolatedInstance(
  target: CompileTarget<Expression>,
  fn: () => TargetSource
): TargetSource {
  const top = cseTop(target);
  if (top === undefined) return fn();
  const session = target.cse!;
  const outerFloor = session.availabilityFloor;
  session.availabilityFloor = session.instances.length;
  try {
    return withCseRegion(target, cseRegionOf(top), fn);
  } finally {
    session.availabilityFloor = outerFloor;
  }
}

/**
 * Compile `fn` under a BLIND instance — one that resolves no candidate — so
 * a construct the CSE wiring deliberately does not describe (`Match`, fully
 * inert in Phase 1) emits exactly the pre-CSE source, and no enclosing
 * region's candidate can leak into it through a shared node object.
 */
export function withCseBlind(
  target: CompileTarget<Expression>,
  fn: () => TargetSource
): TargetSource {
  if (cseTop(target) === undefined) return fn();
  return withCseRegion(target, undefined, fn);
}

/**
 * The `compile` callback handed to a `CompiledFunction` handler. A handler
 * lowering a construct with conditionally-evaluated operand positions passes
 * the operand index for those positions (`OperandCompiler`), and the
 * dispatcher — which is the only place that knows the parent node — turns it
 * into the matching region instance. Handlers that omit the index compile
 * exactly as before.
 */
export function operandCompiler(
  parent: Expression | undefined,
  target: CompileTarget<Expression>
): OperandCompiler<Expression> {
  return (expr, opIndex) =>
    opIndex === undefined
      ? compileValueOperand(expr, target)
      : compileOpValue(parent, opIndex, target, 0, expr);
}

/**
 * The name of a temporary already bound, by an instance ENCLOSING the
 * innermost one, for a node with the same structure as `expr`, or
 * `undefined` when there is none that may be used here.
 *
 * Candidates are attributed to their innermost region, so the same
 * structure occurring at the root and again inside a binder body or a
 * conditional arm is two candidates, and the inner one is bound (or
 * inlined) again where the outer one's temporary is already in scope. The
 * reuse is what the region rules cannot give and is sound on its own terms:
 * the outer binding is evaluated whether or not the inner position runs
 * (its own occurrence forced it), so the inner reference changes no
 * evaluation count and no selection laziness; and every instance on the
 * stack has its wrapper around the code being emitted now, so the name is
 * in scope — except across a user-defined function's body, which is emitted
 * as a module-level definition (`CseSession.availabilityFloor`).
 *
 * The one thing that can make the same STRUCTURE denote a different VALUE
 * is a name rebound between the two positions: a nested `Sum` reusing the
 * index name of the outer one, a lambda parameter shadowing an outer
 * symbol. Each region records the names its site binds (`boundNames`), so
 * the walk from the innermost instance outward accumulates them and refuses
 * a temporary whose structure mentions one. An instance with no region — a
 * blind instance, pushed where emission entered a binding scope the wiring
 * does not describe — or one whose binder declares no binding sites
 * (`opaque-scope`) binds names the walk cannot see, so it is a barrier:
 * nothing bound below it is reused. A symbol ASSIGNED anywhere below a
 * binding's region needs no check here: the harvest already refused the
 * candidate at that region (`assignedNames`).
 *
 * The innermost instance is excluded by default: its own candidates go
 * through the occurrence state machine in `compileWithCse`. The hoist
 * pass asks with `includeTop`, because it runs BEFORE the loop body's
 * instance is pushed and wants to know whether a body node will emit as a
 * name the current instance already holds.
 */
export function availableCseBinding(
  session: CseSession,
  expr: Expression,
  includeTop = false
): string | undefined {
  const instances = session.instances;
  const floor = session.availabilityFloor ?? 0;
  const outermost = includeTop ? instances.length - 1 : instances.length - 2;
  let quick = false;
  for (let i = outermost; i >= floor; i--)
    if (instances[i].names.size > 0) {
      quick = true;
      break;
    }
  if (!quick) return undefined;

  const hash = expr.hash;
  const rebound = new Set<string>();
  for (let i = outermost; i >= floor; i--) {
    if (i < instances.length - 1) {
      // `instances[i + 1]` is strictly inside the instance examined now:
      // its site's names are rebound for everything the inner one emits.
      const inner = cseRegionOf(instances[i + 1]);
      if (inner === undefined) return undefined;
      // An `opaque-scope` region is a `scoped` operator's operand where the
      // harvest found no binding site: either the definition declares no
      // site selector at all — its bound names are unknown, a barrier — or
      // the selector answered with no site for this node
      // (`Sum(collection)`, no `Limits`), which binds nothing.
      if (inner.kind === 'opaque-scope') {
        const site = inner.site?.node;
        if (
          !isFunction(site) ||
          site.operatorDefinition?.bindingSites === undefined
        )
          return undefined;
      }
      for (const name of inner.boundNames) rebound.add(name);
    }

    const outer = instances[i];
    if (outer.names.size === 0) continue;
    for (const [candidate, name] of outer.names) {
      if (outer.state.get(candidate) !== 'bound') continue;
      const representative = (candidate as CseCandidate).representative;
      if (representative.hash !== hash || !representative.isSame(expr))
        continue;
      // A rebound name inside `expr` makes every enclosing binding of this
      // structure the wrong value, so stop rather than look further out.
      if (rebound.size > 0 && mentionsAnySymbol(expr, rebound))
        return undefined;
      return name;
    }
  }
  return undefined;
}

/** Whether any symbol of `names` occurs anywhere in `expr` — including
 * inside its own binders and lambdas, which over-approximates: a symbol a
 * nested binder of `expr` rebinds itself also counts, and the only effect
 * is a lost reuse. */
export function mentionsAnySymbol(
  expr: Expression,
  names: ReadonlySet<string>
): boolean {
  if (isSymbol(expr)) return names.has(expr.symbol);
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) => mentionsAnySymbol(op, names));
}

/** Preserve an existing or planned shared value when fusing its consumer. */
export function hasSharedExpression(
  expr: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (_codeOverrides.has(expr)) return true;
  const session = target.cse;
  if (!session?.enabled) return false;
  if (availableCseBinding(session, expr) !== undefined) return true;
  return session.instances
    .slice(session.availabilityFloor ?? 0)
    .some((instance) => candidateAt(cseRegionOf(instance), expr) !== undefined);
}

/**
 * A target-owned fold of a function node's emitted code
 * (`CompileTarget.foldEmittedConstant`): the interval target evaluates a
 * closed constant subtree's code with its own library at compile time, so
 * the largest constant subtree folds bottom-up (each level sees its
 * operands already folded). Applied to what `compile()` returns — after
 * the CSE walk, where a shared node comes back as its temporary's name,
 * which the hook declines — and to the right-hand side of a CSE binding,
 * which that walk compiles itself. A symbol or literal is left alone: the
 * hook is for applications, whose code is what a run-time call would
 * evaluate.
 */
export function foldEmitted(
  expr: Expression,
  target: CompileTarget<Expression>,
  code: TargetSource
): TargetSource {
  if (target.foldEmittedConstant === undefined || !isFunction(expr))
    return code;
  return target.foldEmittedConstant(expr, code) ?? code;
}

/**
 * Inline or wrap expression in IIFE based on complexity
 */
export function inlineExpression(
  target: CompileTarget<Expression>,
  body: string,
  x: string
): string {
  // Check if `x` is a simple value (like a number or a simple symbol)
  const isSimple = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(x) || /^[0-9]+$/.test(x);

  // Inline the body if `x` is simple
  if (isSimple) return body.split('${x}').join(x);

  // Bind `x` to a temporary once when it is a complex expression, so that
  // it is computed once: an operand that draws a random number must draw
  // only one, and each use in `body` must read that same draw.
  const t = tempVar(target);
  return `(() => { const ${t} = ${x}; return ${body.split('${x}').join(t)}; })()`;
}
