import type { Type } from '../../common/type/types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import type { Expression, IComputeEngine, Scope } from '../global-types.js';
import { isSubtype, widen } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import {
  functionResult,
  openDepthScalarArms,
  returnTypeText,
} from '../../common/type/utils.js';
import { isFunction, isSymbol } from './type-guards.js';
import {
  functionLiteralParameterNames,
  functionLiteralParameterType,
} from './function-literal.js';
import { scopeChainDeclarationCount } from '../scope-declaration-count.js';
import { withScratchScope } from '../scratch-scopes.js';

/**
 * The scope the function literal `literal` was defined in: the parent of the
 * local scope of its body, which holds its parameters. `undefined` when the
 * body has no local scope, as for a literal built in structural form: its
 * home is then unknown, and no result under the declared parameter types is
 * computed for it (boxing it in the reader's scope would let that scope
 * decide what its free names mean).
 */
function homeScopeOf(literal: Expression) {
  if (!isFunction(literal, 'Function')) return undefined;
  return literal.ops[0].localScope?.parent ?? undefined;
}

/**
 * The result type of the function literal `literal` with the parameter types
 * of `declared` stamped on its parameters, scalars included, when `declared`
 * is a ground signature whose result is the placeholder `unknown`.
 * `undefined` when there is nothing to add: `declared` is not such a
 * signature, no parameter takes a declared type, or the result is still
 * `unknown`.
 *
 * The host that declares the parameter types promises them, so the result
 * the body has under them is the accurate return type to report:
 * `(real | signed_infinity | nan) -> unknown` assigned `t ↦ t + 1` reports
 * `-> nan | real | signed_infinity`, not the `-> number` the literal gives
 * with its parameter read as `unknown` (user decision 2026-09-26: the host
 * gives the types of what it constructs, CE gives narrow types for the
 * values it returns).
 *
 * The literal itself is not changed. It is stored without the scalar
 * parameter types, because stamping one re-canonicalizes the body and
 * changes how a tuple argument broadcasts through `x ↦ 2x`
 * (`ascribeDeclaredParameterTypes` in `engine-declarations.ts`). So this
 * result is computed when the signature is read, from the stored literal,
 * and never stored: it then follows a later change of a symbol the body
 * reads, and a checkpoint restore.
 *
 * A parameter is stamped with the rules of `ascribeDeclaredParameterTypes`,
 * scalars included: a plain symbol parameter whose declared type is not
 * `unknown` or `any`. An already typed parameter keeps its own type.
 *
 * A parameter declared `broadcastable<T>` (in the declaration, or in the
 * literal's own annotation) is stamped with `T`: the call maps the function
 * over a collection argument (to the cells when `T` cannot hold a list, one
 * rank down otherwise), so the body receives one `T` at each call, and the
 * signature result is the result for one element. With
 * `l: (broadcastable<tuple<number, number>>) -> unknown` and
 * `l := (A: broadcastable<tuple<number, number>>) ↦ √(A.x² + A.y²)`, the
 * result is `number`, not `broadcastable<number>`, which a call over a list
 * of points wrapped again (`list<broadcastable<number>>`). (ROADMAP CE-408,
 * Tycho row 436.) The literal's own signature is not changed: an overload
 * clause reads it, and an overload set binds a collection argument whole.
 */
export function resultUnderDeclaredParameters(
  ce: IComputeEngine,
  literal: Expression,
  declared: Type,
  options?: {
    /** Box the literal again even when no parameter takes a declared type.
     * The recursion fixpoint of `_deriveSignature`
     * (`boxed-operator-definition.ts`) needs a fresh boxing of the body on
     * every pass, since the stored literal's type is memoized and its
     * recursive call was typed under an earlier result. */
    rebox?: boolean;
  }
): Type | undefined {
  if (
    !isFunction(literal, 'Function') ||
    typeof declared !== 'object' ||
    declared.kind !== 'signature' ||
    declared.result !== 'unknown' ||
    isPolymorphicType(declared)
  )
    return undefined;
  const args = declared.args ?? [];
  const params = literal.ops.slice(1);
  if (params.length !== args.length) return undefined;
  let changed = false;
  const stamped = params.map((p, i): MathJsonExpression => {
    const t = args[i].type;
    // The element type of a `broadcastable<T>` parameter, declared or
    // annotated on the literal.
    const own = isFunction(p, 'Typed')
      ? functionLiteralParameterType(p)
      : undefined;
    const element =
      typeof t === 'object' && t.kind === 'broadcastable'
        ? t.elements
        : typeof own === 'object' && own.kind === 'broadcastable'
          ? own.elements
          : undefined;
    if (element !== undefined) {
      const name = isFunction(p, 'Typed') ? p.op1 : p;
      if (!isSymbol(name)) return p.json;
      changed = true;
      return [
        'Typed',
        name.json,
        `'${returnTypeText(element)}'`,
      ] as MathJsonExpression;
    }
    if (!isSymbol(p) || t === 'unknown' || t === 'any') return p.json;
    changed = true;
    return ['Typed', p.json, `'${returnTypeText(t)}'`] as MathJsonExpression;
  });
  if (!changed && options?.rebox !== true) return undefined;
  const home = homeScopeOf(literal);
  if (home === undefined) return undefined;
  let result: Type | undefined;
  try {
    // The literal is boxed again in the scope it was defined in, so its free
    // names resolve as they do in the stored literal, whatever scope the
    // signature is read from: read from inside another function's body, a
    // parameter of that function with the same name as a free name of this
    // one would otherwise capture it.
    //
    // It is boxed in a scope of its own, created under the home scope and
    // registered as scratch for the duration of the boxing
    // (`withScratchScope`). The scope starts empty, so every name that the
    // home scope chain declares resolves as it does from the home scope. What
    // the boxing declares lands in the local scope of the typed copy, which
    // is created under this scope: the parameters, every undeclared name the
    // body applies (`b` in `b(x, y)`), which the boxing declares as a
    // function, and every other undeclared free name the body reads, which
    // the boxing auto-declares. None of it lands in the home scope (before
    // this scope existed, the local scope of the typed copy was created under
    // the home scope, with the same effect). All of it is discarded with the
    // typed copy. Writing these bindings (declaring them, repairing them,
    // inferring their types) advances no engine-wide version that the memo
    // of this result, or of the signature of any other function, keys on
    // (`noteStateEvent` in `engine-configuration-lifecycle.ts`). No stored
    // definition can see them either, so declaring them does not re-derive
    // the definitions that wait on the same name
    // (`repairProvisionalDependents` in `provisional-application.ts`). Before
    // both, typing nested calls of functions declared `-> unknown` whose
    // bodies apply undeclared names took exponential time in the nesting
    // depth (Tycho item 336).
    //
    // The boxing runs with no shadowed-parameter frame
    // (`_withoutShadowedParameters`). A signature can be read while a `Block`
    // or a function literal is canonicalized, and the frame of that construct
    // lists the names it declares. The typed copy is not inside the
    // construct, and its result is memoized by the caller: a `Block` that
    // declares `b` and calls `f` otherwise made the free `b` of `f`'s body a
    // new local, and `f` of a real was typed `number` instead of `real`
    // (CE-542).
    const scratch: Scope = { parent: home, bindings: new Map() };
    const typed = withScratchScope(ce, scratch, () =>
      ce._inScope(scratch, () =>
        ce._withoutShadowedParameters(() =>
          ce.box(['Function', literal.ops[0].json, ...stamped])
        )
      )
    );
    result = functionResult(typed.type.type);
  } catch {
    return undefined;
  }
  return result === undefined || result === 'unknown' ? undefined : result;
}

/**
 * The key of a memo of `resultUnderDeclaredParameters` for the function
 * literal `literal`: the engine versions and counts that move when the
 * result can change. The result depends on the types and values of the
 * symbols the body reads, resolved from the scope the literal was defined
 * in. So the key moves with:
 * - a value write (`_semanticVersion`);
 * - an assumption, a redefinition or a signature inference (`_worldVersion`);
 * - a retype of a symbol, a declaration that shadows a function, and any
 *   other change of a function (`_definitionVersion`). A narrowing of a
 *   symbol by a use
 *   (`inference-settled`) is not counted: it is frequent, and it can only
 *   leave a cached result wider than it could be, never wrong;
 * - a declaration in the literal's home scope or one of its ancestors
 *   (`scopeChainDeclarationCount`): assigning an undeclared `b` declares it
 *   in the global scope, and `x ↦ b + x` then reads it. The memo adds the
 *   declarations along the home scope chains of the declared functions the
 *   body calls, transitively (`collectCalleeHomes`);
 * - whether the assumptions are hidden (the low bit of `_cacheGeneration()`).
 * Each memo records this key AFTER its computation, so the events of the
 * computation itself are part of it.
 *
 * It is deliberately NOT the cache generation, the `any` axis, which every
 * declaration moves, in any scope. Computing the result boxes the function
 * literal, which declares its parameters in a scope of its own, so a
 * generation read BEFORE the computation never matched the one stored: the
 * memo never hit, every read re-boxed the body, and the body read the
 * signatures of the declared functions it calls, each re-boxed in turn. A
 * Tycho document with nested declared functions (a Voronoï pattern: `P`
 * calls `S` twice, `S` calls `H`, `V` calls `P` nine times) spent 75 s
 * registering its definitions, 1 s before. Reading the generation AFTER the
 * computation is not enough either: the boxing of an outer function (`V`)
 * declares its own parameters between two reads of an inner one (`P`), and
 * one document still took more than 200 s.
 *
 * Nor is it the `callable` axis, which a declaration of a parameter that may
 * hold a function (an `unknown` parameter) also moves. With `k` declared
 * `(unknown, T) -> unknown` and `w` declared `(T, unknown) -> unknown`,
 * re-boxing `k` moved the axis and invalidated `w`'s memo, and re-boxing `w`
 * invalidated `k`'s: typing `sin(cos(k(x,y) + w(x,y)))` took 10 s (Tycho's
 * `plasma-effect` document hit its 5 s budget and dropped a definition).
 */
export function declaredResultMemoKey(
  ce: IComputeEngine,
  literal: Expression
): string {
  // A literal with no home scope has no result under the declared
  // parameter types (`resultUnderDeclaredParameters`), so no scope's
  // declarations can change it.
  const home = homeScopeOf(literal);
  return `${ce._semanticVersion}:${ce._worldVersion}:${
    ce._definitionVersion
  }:${scopeChainDeclarationCount(home)}:${ce._cacheGeneration() & 1}`;
}

/**
 * The home scopes of the declared functions whose signatures were read while
 * the result of another one was derived under its declared parameter types.
 *
 * The derived result of `f` depends on the signatures of the functions its
 * body calls, and the result of such a callee `g` depends on the
 * declarations in `g`'s home scope chain, which need not be `f`'s: a scalar
 * declared later in the scope `g` was defined in changes `g`'s result, while
 * no counter in `f`'s key moves. Every other change a callee's result
 * depends on moves an engine-wide counter that `f`'s key already reads. So
 * `f`'s memo also records the home scopes of the callees it read, and of
 * THEIR callees (`collectCalleeHomes`), and keys on the declarations counted
 * along those chains (`calleeHomesDeclarationCount`). The check is a sum of
 * counts; re-reading each callee's signature instead made a Tycho document
 * five times slower to register.
 *
 * A read of a signature that is itself being derived further up the stack
 * (a recursive or mutually recursive call) records nothing: the guard in
 * `_deriveSignature` answers it with the DECLARED signature, which does not
 * depend on any scope, so there is nothing to record. That stays true only
 * while the guard's answer is the declared signature.
 */

/** A scope, as far as the declaration counts need it. */
export type HomeScope = { parent: unknown };
const homeFrames: Set<HomeScope>[] = [];

/** Run `f`, and collect the home scopes of the declared functions whose
 * signatures it reads (`noteCalleeHomes`). */
export function collectCalleeHomes<T>(f: () => T): {
  result: T;
  homes: HomeScope[];
} {
  const frame = new Set<HomeScope>();
  homeFrames.push(frame);
  try {
    const result = f();
    return { result, homes: [...frame] };
  } finally {
    homeFrames.pop();
  }
}

/** Record that the signature of a declared function was read: its own home
 * scope (the scope its literal was defined in) and the home scopes its own
 * derived result depends on. Nothing is recorded outside a collection. */
export function noteCalleeHomes(
  literal: Expression,
  dependencies: readonly HomeScope[]
): void {
  const frame = homeFrames[homeFrames.length - 1];
  if (frame === undefined) return;
  const home = homeScopeOf(literal);
  if (home !== undefined) frame.add(home);
  for (const h of dependencies) frame.add(h);
}

/** The declarations counted along the scope chains of `homes`. The counts
 * only increase, so the sum changes whenever one of them does. */
export function calleeHomesDeclarationCount(
  homes: readonly HomeScope[]
): number {
  let total = 0;
  for (const h of homes) total += scopeChainDeclarationCount(h);
  return total;
}

/** `t` with its result replaced by `result`, when `t` is a signature. */
export function withSignatureResult(t: Type, result: Type): Type {
  return typeof t === 'object' && t.kind === 'signature' ? { ...t, result } : t;
}

/**
 * The list hypothesis for the result of a self-recursive function: `t` with
 * every abstract `collection<T>` (and the bare `collection`) replaced by the
 * `list` of the same elements, at the top level and in the arms of a union.
 * `undefined` when `t` holds no abstract collection, so there is nothing to
 * hypothesize.
 *
 * A `broadcastable<T>` of a number type `T` is replaced by `T`. The
 * recursive call `fact(n − 1)` of `fact := n ↦ If(n ≤ 1, 1, n·fact(n − 1))`
 * reads the result of the function while its body is typed, and the first
 * reading of an undeclared name is a function whose result may be a
 * collection, so the product was typed `broadcastable<number>` and so was
 * the function. Under the hypothesis `number`, the body is typed `number`,
 * which bears it out: a call over a list argument maps the function over
 * the elements, so one call gives one number. The same literal assigned to
 * a name declared `(unknown) -> unknown` derives `-> number` (CE-454).
 */
function listHypothesisOf(t: Type): Type | undefined {
  if (t === 'collection') return 'list';
  if (typeof t !== 'object') return undefined;
  if (t.kind === 'collection') return { kind: 'list', elements: t.elements };
  if (t.kind === 'broadcastable' && isSubtype(t.elements, 'number'))
    return t.elements;
  // The open form `T | list<T | list<any>> | tuple` of a number type `T`
  // (`openTriggerBroadcastType`, `broadcast-lift-type.ts`) is replaced by
  // `T` for the same reason: it is the type of `n·fact(n − 1)` when the
  // recursive call reads as `unknown`.
  const open = openDepthScalarArms(t);
  if (open !== undefined && isSubtype(open, 'number')) return open;
  if (t.kind === 'union') {
    let changed = false;
    const types = t.types.map((arm) => {
      const h = listHypothesisOf(arm);
      if (h === undefined) return arm;
      changed = true;
      return h;
    });
    return changed ? { kind: 'union', types } : undefined;
  }
  return undefined;
}

/**
 * True when `literal` names `name`, directly or through the function
 * literals of the user functions its body calls, transitively: the function
 * named `name` is then recursive, alone (`F` calls `F`) or with others (`F`
 * calls `G`, and `G` calls `F`). A callee is read from the definition its
 * call is bound to, so a parameter or a local of the same name is not
 * followed. Each literal is read once.
 */
function callsReach(
  literal: Expression,
  name: string,
  seen: Set<Expression> = new Set()
): boolean {
  if (seen.has(literal)) return false;
  seen.add(literal);
  if (namesFunction(literal, name)) return true;
  const visit = (expr: Expression): boolean => {
    if (!isFunction(expr)) return false;
    const callee = calleeLiteral(expr);
    if (callee !== undefined && callsReach(callee, name, seen)) return true;
    return expr.ops.some((op) => visit(op));
  };
  return visit(literal);
}

/** True when `expr` names `name`, as a head or as a symbol, outside the
 * function literals in it that bind a parameter of that name. A parameter
 * `p` of a function that the function `p` calls is not a call of `p`: with
 * `p_rand := p ↦ …` called by `p`, `p` was read as recursive. */
function namesFunction(expr: Expression, name: string): boolean {
  if (isSymbol(expr)) return expr.symbol === name;
  if (!isFunction(expr)) return false;
  if (
    expr.operator === 'Function' &&
    expr.ops
      .slice(1)
      .some((param) => functionLiteralParameterNames(param).includes(name))
  )
    return false;
  if (expr.operator === name) return true;
  return expr.ops.some((op) => namesFunction(op, name));
}

/** The function literal of the user function that the application `expr`
 * calls, or `undefined`. */
function calleeLiteral(expr: Expression): Expression | undefined {
  const opDef = expr.operatorDefinition as
    { _lambdaLiteral?: Expression } | undefined;
  let literal = opDef?._lambdaLiteral ?? expr.valueDefinition?.value;
  // A call bound when its head was not yet assigned keeps the value
  // definition declared then (a forward reference), which holds no literal:
  // `hb(x − 1)` in the body of `ha` when `ha` was assigned before `hb`. The
  // current definition of the head is read instead.
  if (
    literal === undefined &&
    expr.valueDefinition !== undefined &&
    isFunction(expr)
  ) {
    const current = expr.engine.lookupDefinition(expr.operator);
    if (current !== undefined)
      literal =
        'operator' in current
          ? (current.operator as { _lambdaLiteral?: Expression })._lambdaLiteral
          : current.value.value;
  }
  return literal !== undefined && isFunction(literal, 'Function')
    ? literal
    : undefined;
}

/** A signature derivation in flight (`_deriveSignature` of an operator or a
 * value definition). `tainted` becomes true when the derivation read the
 * provisional signature of a definition whose own derivation was running
 * below it on the stack: the result then depends on an answer that is not
 * final, and must not be memoized. */
export type SignatureDerivationFrame = { owner: object; tainted: boolean };

/** The signature derivations in flight, in this process, innermost last (a
 * derivation is a dynamic extent of the host call stack). */
const derivationStack: SignatureDerivationFrame[] = [];

/** Push a frame for a signature derivation of `owner`. The caller pops it
 * with {@link endSignatureDerivation}, in a `finally`. */
export function beginSignatureDerivation(
  owner: object
): SignatureDerivationFrame {
  const frame = { owner, tainted: false };
  derivationStack.push(frame);
  return frame;
}

export function endSignatureDerivation(frame: SignatureDerivationFrame): void {
  const i = derivationStack.lastIndexOf(frame);
  if (i >= 0) derivationStack.splice(i, 1);
}

/**
 * Record a re-entrant read of the signature of `owner` while its derivation
 * runs: the read answers a provisional signature (the recorded one, or the
 * candidate of a list-hypothesis pass). Every derivation that started after
 * the one of `owner` made that read, directly or through the derivation of
 * a callee, so its result depends on the provisional answer and it is
 * marked as tainted. The derivation of `owner` itself is not: a read of its
 * own signature is the recursion that its derivation handles.
 *
 * Without this, in a mutually recursive pair (`F` calls `G`, `G` calls `F`),
 * the signature of `G` derived inside the derivation of `F` read `F` as
 * `-> unknown`, was memoized, and stayed `-> unknown` after `F` settled.
 */
export function noteReentrantSignatureRead(owner: object): void {
  let i = derivationStack.length - 1;
  while (i >= 0 && derivationStack[i].owner !== owner) i -= 1;
  if (i < 0) return;
  for (let j = i + 1; j < derivationStack.length; j++)
    derivationStack[j].tainted = true;
}

/** The number of list-hypothesis passes in flight, in this process (a pass
 * is a dynamic extent of the host call stack, as the object-dependency
 * collectors are). Read by {@link inListHypothesisPass}. */
let hypothesisPassDepth = 0;

/**
 * True while a list-hypothesis pass runs ({@link verifiedListHypothesis}).
 * A signature derived inside the pass may have read the hypothesis through
 * a mutual recursion (`F` calls `G`, `G` calls `F`, and `G`'s signature is
 * derived while `F`'s pass re-boxes `F`'s body), so no signature memo may be
 * written then: a memo written under a hypothesis that is then refuted would
 * serve a result no derivation stands behind. Each `_deriveSignature` reads
 * this before it stores its memo.
 */
export function inListHypothesisPass(): boolean {
  return hypothesisPassDepth > 0;
}

/** The candidate results of the function literals that
 * {@link verifiedListHypothesis} is verifying, in this process: the
 * function being verified and the other functions of its cycle of calls.
 * Read by {@link provisionalRecursionResult}. */
const provisionalResults = new Map<Expression, Type>();

/**
 * The candidate result of the function literal `literal` while
 * {@link verifiedListHypothesis} runs a pass for a cycle of calls that holds
 * it, or `undefined`. A call of that function in the body is then typed by
 * the candidate, and not by a walk of the stored literal's body
 * (`callResultType`, `call-result-type.ts`). That walk reads the types
 * cached on the stored literal, which were computed from an earlier
 * signature, so the pass would not test the candidate: with
 * `m := n ↦ Map(x ↦ If(x < 1, 0, m(x − 1)), [n])`, each pass nested the
 * result one level deeper than the one before it. For a function of the
 * cycle other than the one verified (`hb` when `ha` calls `hb` and `hb`
 * calls `ha`), the stored signature was derived before the cycle was
 * complete, so it does not hold the values either.
 */
export function provisionalRecursionResult(
  literal: Expression
): Type | undefined {
  return provisionalResults.get(literal);
}

/**
 * The result type of a SELF-RECURSIVE function literal, verified under the
 * hypothesis that it is a list or by a fixpoint iteration (see the comments
 * in the body), or `undefined` when the function is not recursive or the
 * verified result is the same type as `derived`.
 *
 * The recursive call reads the declared result, `unknown`, while the body is
 * typed, and an `unknown` operand of `Join` or `Append` says nothing about
 * what it holds, so `Join([n], F(n + 1, K))` was typed `collection<number>`
 * (an operand that may hold a set) although the recursive call returns the
 * function's own result (row 338 of the Tycho ledger,
 * `tycho/docs/COMPUTE_ENGINE.md`). The hypothesis replaces every abstract
 * `collection<T>` of `derived` (the result the plain derivation gave) by
 * `list<T>`, and the body is boxed once more with the recursive call reading
 * it: `withCandidate` runs its thunk with the definition answering the
 * hypothesis to a re-entrant signature read. The pass answers `result`, and
 * the hypothesis is accepted when `result` is a subtype of it: the body's
 * type equation `T = f(T)` is monotone in `T`, so a `T` with `f(T) <: T` lies
 * above the least fixpoint, which is the function's true result, and so does
 * `f(T)`, which is the tighter of the two and is what is returned. A base
 * clause that builds a set refutes the hypothesis (the pass answers
 * `set<T>`), and the fixpoint iteration below gives the result. Seeding a
 * fixpoint iteration with `never` was tried first and rejected: an operand
 * typed `never` is read as an absent value, and a conditional with such an
 * arm is typed `never` as a whole. Only a body that names the function,
 * directly or through the functions it calls ({@link callsReach}), is
 * re-boxed; every other body pays only that walk.
 */
export function verifiedListHypothesis(
  ce: IComputeEngine,
  literal: Expression,
  skeleton: Type,
  name: string,
  derived: Type | undefined,
  withCandidate: <T>(candidate: Type, thunk: () => T) => T
): { result: Type; homes: HomeScope[] } | undefined {
  if (
    typeof skeleton !== 'object' ||
    skeleton.kind !== 'signature' ||
    skeleton.result !== 'unknown' ||
    derived === undefined
  )
    return undefined;
  // A result that is already a placeholder or the top type holds every
  // value: there is nothing to verify.
  if (derived === 'unknown' || derived === 'any') return undefined;
  if (!callsReach(literal, name)) return undefined;
  // The other functions of the cycle of calls (`hb` when `ha` calls `hb`
  // and `hb` calls `ha`). Their calls read candidates too, which the
  // iteration below verifies with the candidate of this function.
  const members = cycleMembers(literal, name);
  // A numeric derived result is kept, with no pass, when no nested function
  // literal calls a function of the cycle. The recursive call can then reach
  // the result only as the value of a branch of a conditional, which is the
  // value of a base case, or as the operand of an operation, which the plain
  // derivation types `number` too (CE-447). The values of the result are
  // then numbers of the derived type.
  if (
    isSubtype(derived, 'number') &&
    !nestedLiteralCallsCycle(literal, [literal, ...members])
  )
    return undefined;
  // A verification inside a pass of another verification is bounded: each
  // level boxes the bodies again, and a result derived in a pass is not
  // kept (`inListHypothesisPass`).
  if (hypothesisPassDepth >= MAX_NESTED_VERIFICATIONS) return undefined;
  // The candidates of the functions of the cycle other than this one.
  const memberCandidates = new Map<Expression, Type>(
    members.map((g) => [g, 'unknown'])
  );
  // One pass: the body boxed again, with a recursive call reading
  // `candidate` as the function's result and a call of another function of
  // the cycle reading its candidate.
  const pass = (
    candidate: Type
  ): { result: Type | undefined; homes: HomeScope[] } => {
    const saved = new Map(provisionalResults);
    provisionalResults.set(literal, candidate);
    for (const [g, t] of memberCandidates) provisionalResults.set(g, t);
    try {
      return withCandidate(candidate, () =>
        collectCalleeHomes(() =>
          resultUnderDeclaredParameters(ce, literal, skeleton, { rebox: true })
        )
      );
    } finally {
      provisionalResults.clear();
      for (const [g, t] of saved) provisionalResults.set(g, t);
    }
  };
  // The results of the other functions of the cycle under the same
  // candidates. A function whose result cannot be derived is `any`: an
  // `unknown` candidate would be dropped by a join (see below).
  const memberResults = (candidate: Type): Map<Expression, Type> => {
    const saved = new Map(provisionalResults);
    provisionalResults.set(literal, candidate);
    for (const [g, t] of memberCandidates) provisionalResults.set(g, t);
    try {
      // This function answers a read of its signature with the candidate,
      // as in a pass.
      return withCandidate(candidate, () => {
        const out = new Map<Expression, Type>();
        for (const g of members)
          out.set(
            g,
            resultUnderDeclaredParameters(ce, g, unknownSkeletonOf(g), {
              rebox: true,
            }) ?? 'any'
          );
        return out;
      });
    } finally {
      provisionalResults.clear();
      for (const [g, t] of saved) provisionalResults.set(g, t);
    }
  };
  /** True when every other function of the cycle verifies its candidate
   * under `candidate`; otherwise the candidates of the others are widened
   * to the join with their results. */
  const membersSettle = (candidate: Type): boolean => {
    if (members.length === 0) return true;
    let settled = true;
    for (const [g, t] of memberResults(candidate)) {
      const c = memberCandidates.get(g)!;
      // Every type is a subtype of `unknown`, so the first candidate of a
      // function, `unknown`, is never verified: it is replaced by the
      // function's result.
      if (c !== 'unknown' && isSubtype(t, c)) continue;
      settled = false;
      memberCandidates.set(g, c === 'unknown' ? t : widen(c, t));
    }
    return settled;
  };
  hypothesisPassDepth += 1;
  try {
    // The pass under a list hypothesis `h`. The other functions of the
    // cycle read their results under `h`, with the same hypothesis applied,
    // and must verify them too. The result is `undefined` when the
    // hypothesis is refuted.
    const tryHypothesis = (
      h: Type
    ): { result: Type; homes: HomeScope[] } | undefined => {
      for (const [g, t] of members.length > 0 ? memberResults(h) : [])
        memberCandidates.set(g, listHypothesisOf(t) ?? t);
      const settled = membersSettle(h);
      const r = pass(h);
      for (const g of members) memberCandidates.set(g, 'unknown');
      return settled && r.result !== undefined && isSubtype(r.result, h)
        ? { result: r.result, homes: r.homes }
        : undefined;
    };
    // A call of another function of the cycle whose stored result is
    // `unknown` gives elements of type `any` to `Join` (`G` assigned before
    // `F`, with `F := (n, K) ↦ Which(…, join([n], G(n + 1, K)))` and
    // `G := (n, K) ↦ F(n, K)`). So the hypothesis is `list<any>`, which the
    // pass verifies at once, and the result is less precise than the
    // `list<number>` that the other orders of assignment give. So, for a
    // type `t` with elements `any`, a pass first runs with the result read
    // as the same collection with elements `never` (`list<never>`, the type
    // of an empty list), and the other functions of the cycle read their
    // results under that seed too. That pass gives the elements that the
    // bodies add (`list<number>`): one step of an iteration that starts
    // below the result. The seed is not `never` itself, which an operand
    // reads as an absent value, and not `list<unknown>`: the element join of
    // `Join` keeps an `unknown` arm, so that pass gave `list<unknown>`
    // again. The result of the pass is only a proposal, since the seed does
    // not hold the values of a call. It is accepted only when the bodies
    // verify it as a hypothesis, as any other candidate (`tryHypothesis`),
    // so a result that does not hold every value is never stored. A
    // proposal that names `unknown` is not tried: every type is a subtype
    // of `unknown`, so the check would accept it with no evidence. The
    // result is `undefined` when there is no seed or the proposal is
    // refuted. (CE-38 in `ROADMAP.md`.)
    const tryProposalBelow = (
      t: Type
    ): { result: Type; homes: HomeScope[] } | undefined => {
      const seed = emptyElementSeedOf(t);
      if (seed === undefined) return undefined;
      for (const [g, r] of members.length > 0 ? memberResults(seed) : [])
        memberCandidates.set(g, r);
      const proposed = pass(seed).result;
      for (const g of members) memberCandidates.set(g, 'unknown');
      if (proposed === undefined || mentionsUnknown(proposed)) return undefined;
      return tryHypothesis(proposed);
    };
    const hypothesis = listHypothesisOf(derived);
    if (hypothesis !== undefined) {
      const r = tryProposalBelow(hypothesis) ?? tryHypothesis(hypothesis);
      if (r !== undefined) return r;
    }
    // The plain derivation read the recursive call as `unknown`, and the
    // join of an `unknown` arm with a type is that type (`widen`). So the
    // derived result can leave out what the recursive call returns: the
    // callback of `m := n ↦ Map(x ↦ If(x < 1, 0, m(x − 1)), [n])` was typed
    // `integer` and the function `-> list<number>`, but `m(1)` is `[[0]]`
    // (CE-479). The plain derivation also reads types cached on the stored
    // literal, which were computed from the signature of an earlier read,
    // so it can give a different result on each read.
    //
    // So the result is computed again by a fixpoint iteration that reads
    // only fresh passes. The first candidate is the result of a pass with
    // the recursive call read as `unknown`. When the pass under a candidate
    // gives a subtype of the candidate, and every other function of the
    // cycle gives a subtype of its own candidate, that pass's result is
    // returned (see above for why it holds every value). Otherwise each
    // candidate is widened to the join of the two and the passes run again,
    // at most `RECURSION_PASS_LIMIT` times.
    const answer = (r: { result: Type; homes: HomeScope[] }) =>
      // A result equal to the derived one leaves the derived result as it
      // is written (bare `set` stays `set`, not `set<any>`).
      isSubtype(r.result, derived) && isSubtype(derived, r.result)
        ? undefined
        : r;
    // The derived result is kept when the pass under it gives it back: it
    // is then a fixpoint. A pass that gives a subtype of it is not enough to
    // keep it, since the next read would derive the deeper result of that
    // pass: the result of `m` would get one level deeper on each read.
    // A numeric derived result is also kept when the pass gives a number.
    // In a pass, a recursive call over a parameter typed `unknown` is typed
    // `number`, so `r := n ↦ If(n = 0, 1, r(n − 1))` gives `-> number` in
    // each pass, where the derived result is the type of the base case,
    // `-> integer` (CE-447). The other functions of a cycle have no
    // derived result to read, so this applies only to a function that calls
    // itself alone.
    if (members.length === 0) {
      const again = pass(derived).result;
      if (
        again !== undefined &&
        ((isSubtype(again, derived) && isSubtype(derived, again)) ||
          (isSubtype(derived, 'number') && isSubtype(again, 'number')))
      )
        return undefined;
    }
    // The iteration below reads only fresh passes, so its result depends on
    // the bodies and on the engine state, not on the derived result: it is
    // kept in a memo (`fixpointMemo`). Without it, each read of the
    // signature of a pair of functions declared `-> unknown` that call each
    // other from a `Map` callback ran the iteration again, since their
    // derived results differ from one read to the next.
    const memoKey = [literal, ...members]
      .map((l) => declaredResultMemoKey(ce, l))
      .concat(typeToString(skeleton))
      .join('|');
    const cached = fixpointMemo.get(literal);
    if (cached !== undefined && cached.key === memoKey)
      return cached.value === undefined ? undefined : answer(cached.value);
    const iterate = (): { result: Type; homes: HomeScope[] } | undefined => {
      // When the pass with the recursive call read as `unknown` gives no
      // result, the body cannot be boxed again and the caller keeps the
      // derived result.
      const first = pass('unknown').result;
      if (first === undefined) return undefined;
      let candidate: Type = first;
      // The list hypothesis of that first result is tried first, as for the
      // derived result above.
      const seeded = listHypothesisOf(candidate);
      if (seeded !== undefined) {
        const r = tryHypothesis(seeded);
        if (r !== undefined) return r;
      }
      // A first result with elements `any` is tried from below first, as
      // for the derived result above.
      {
        const r = tryProposalBelow(candidate);
        if (r !== undefined) return r;
      }
      for (let i = 0; i < RECURSION_PASS_LIMIT; i++) {
        const settled = membersSettle(candidate);
        const r = pass(candidate);
        // The body read with this candidate is typed `unknown`.
        if (r.result === undefined)
          return { result: 'unknown', homes: r.homes };
        if (settled && isSubtype(r.result, candidate))
          return { result: r.result, homes: r.homes };
        if (!isSubtype(r.result, candidate))
          candidate = widen(candidate, r.result);
      }
      // No finite type was found: the result of `m` above is nested one level
      // deeper for each level of recursion. Each candidate is replaced by a
      // bare type above it: first the bare type of each arm of a union
      // (`integer | list<…>` gives `integer | list`), then each type of
      // `RECURSION_FALLBACK_TYPES` that holds it, from the narrowest to the
      // widest (`list` admits lists of any contents). The first set of
      // candidates that the bodies verify gives the result. When none does,
      // the result is `unknown`, which holds every value.
      const options = (t: Type): Type[] => {
        const out: Type[] = [];
        const arms = bareArmsOf(t);
        if (arms !== undefined) out.push(arms);
        for (const top of RECURSION_FALLBACK_TYPES)
          if (isSubtype(t, top)) out.push(top);
        return out;
      };
      const own = options(candidate);
      const others = new Map(
        [...memberCandidates].map(([g, t]) => [g, options(t)] as const)
      );
      let homes: HomeScope[] = [];
      for (let j = 0; j < own.length; j++) {
        for (const [g, list] of others) {
          // A function of the cycle with no bare type above its candidate
          // reads `any`.
          memberCandidates.set(g, list[Math.min(j, list.length - 1)] ?? 'any');
        }
        const settled = membersSettle(own[j]);
        const r = pass(own[j]);
        homes = r.homes;
        if (settled && r.result !== undefined && isSubtype(r.result, own[j]))
          return { result: r.result, homes: r.homes };
      }
      return { result: 'unknown', homes };
    };
    const value = iterate();
    // Not stored inside a pass of another verification, whose candidates
    // are not final, nor while an inference rollback frame is open (see
    // the memo of `_deriveSignature`, `boxed-operator-definition.ts`).
    if (hypothesisPassDepth === 1 && ce._rollbackFrames.length === 0)
      fixpointMemo.set(literal, { key: memoKey, value });
    return value === undefined ? undefined : answer(value);
  } finally {
    hypothesisPassDepth -= 1;
  }
}

/**
 * `t` with each list or collection whose elements are `any` replaced by the
 * same collection with elements `never`, at the top level and in the arms
 * of a union: `list<any>` gives `list<never>`. `undefined` when `t` has no
 * such collection. The seed of a proposal pass of
 * {@link verifiedListHypothesis}.
 */
function emptyElementSeedOf(t: Type): Type | undefined {
  if (typeof t !== 'object') return undefined;
  if ((t.kind === 'list' || t.kind === 'collection') && t.elements === 'any')
    return { ...t, elements: 'never' };
  if (t.kind === 'union') {
    let changed = false;
    const types = t.types.map((arm) => {
      const s = emptyElementSeedOf(arm);
      if (s === undefined) return arm;
      changed = true;
      return s;
    });
    return changed ? { kind: 'union', types } : undefined;
  }
  return undefined;
}

/** True when the primitive type `unknown` is a part of the type `t`, at
 * any depth: an arm of a union, an element, a field, a slot, a parameter or
 * the result of a signature, or the definition of an alias. A type that
 * holds it is not tried as a hypothesis, since every type is a subtype of
 * `unknown`. A record key, an alias name or a value type whose text is
 * "unknown" is not the primitive type. `seen` holds the aliases that are
 * being read, so a recursive alias is read once. */
function mentionsUnknown(t: Type, seen: Set<Type> = new Set()): boolean {
  if (typeof t === 'string') return t === 'unknown';
  const any = (types: readonly Type[]) =>
    types.some((x) => mentionsUnknown(x, seen));
  switch (t.kind) {
    case 'union':
    case 'intersection':
      return any(t.types);
    case 'negation':
      return mentionsUnknown(t.type, seen);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return mentionsUnknown(t.elements, seen);
    case 'dictionary':
      return mentionsUnknown(t.values, seen);
    case 'record':
    case 'object':
      return any(Object.values(t.elements));
    case 'tuple':
      return any(t.elements.map((x) => x.type));
    case 'signature':
      return (
        any((t.args ?? []).map((x) => x.type)) ||
        any((t.optArgs ?? []).map((x) => x.type)) ||
        (t.variadicArg !== undefined &&
          mentionsUnknown(t.variadicArg.type, seen)) ||
        mentionsUnknown(t.result, seen)
      );
    case 'reference':
      if (!t.alias || t.def === undefined || seen.has(t)) return false;
      seen.add(t);
      return mentionsUnknown(t.def, seen);
    default:
      return false;
  }
}

/** The function literals, other than `literal`, of the user functions that
 * `literal` calls, directly or transitively, and that call the function
 * named `name` in turn ({@link callsReach}): the other functions of its
 * cycle of calls. */
function cycleMembers(literal: Expression, name: string): Expression[] {
  const seen = new Set<Expression>([literal]);
  const out: Expression[] = [];
  const visit = (expr: Expression): void => {
    if (!isFunction(expr)) return;
    const callee = calleeLiteral(expr);
    if (callee !== undefined && !seen.has(callee)) {
      seen.add(callee);
      if (callsReach(callee, name)) out.push(callee);
      visit(callee);
    }
    for (const op of expr.ops) visit(op);
  };
  visit(literal);
  return out;
}

/** The definitions bound to the calls, in `literal` and in the literals of
 * the functions it calls transitively, of the functions of the cycle of
 * calls of the function named `name` ({@link cycleMembers}), other than
 * that function. Each is the `operatorDefinition` of a call. */
export function cycleMemberDefinitions(
  literal: Expression,
  name: string
): unknown[] {
  const members = new Set(cycleMembers(literal, name));
  const out: unknown[] = [];
  const seen = new Set<Expression>([literal]);
  const visit = (expr: Expression): void => {
    if (!isFunction(expr)) return;
    const callee = calleeLiteral(expr);
    if (callee !== undefined && !seen.has(callee)) {
      seen.add(callee);
      if (members.has(callee)) {
        // A call boxed before its head had a value is bound to the value
        // definition made then (a forward reference), which has no
        // signature to refine: the definition that the head holds now is
        // read instead, as in `calleeLiteral`.
        const current = expr.engine.lookupDefinition(expr.operator);
        const def =
          expr.operatorDefinition ??
          (current !== undefined && 'operator' in current
            ? current.operator
            : undefined);
        if (def !== undefined) out.push(def);
      }
      visit(callee);
    }
    for (const op of expr.ops) visit(op);
  };
  visit(literal);
  return out;
}

/** True when a function literal nested in `literal`, or in one of the
 * literals of `cycle`, calls a function whose literal is in `cycle`, or
 * passes such a function by name. */
function nestedLiteralCallsCycle(
  literal: Expression,
  cycle: readonly Expression[]
): boolean {
  const inCycle = (expr: Expression): boolean => {
    const callee = calleeLiteral(expr);
    if (callee !== undefined && cycle.includes(callee)) return true;
    if (isFunction(expr)) return expr.ops.some(inCycle);
    return false;
  };
  const visit = (expr: Expression, nested: boolean): boolean => {
    if (!isFunction(expr)) return nested && inCycle(expr);
    if (nested && inCycle(expr)) return true;
    const inner = nested || (expr.operator === 'Function' && expr !== literal);
    return expr.ops.some((op) => visit(op, inner));
  };
  return [literal, ...cycle].some((l) =>
    isFunction(l, 'Function') ? visit(l.ops[0], false) : false
  );
}

/** A signature for the function literal `literal` with every parameter and
 * the result typed `unknown`, for {@link resultUnderDeclaredParameters}. */
function unknownSkeletonOf(literal: Expression): Type {
  const params = isFunction(literal, 'Function') ? literal.ops.slice(1) : [];
  return {
    kind: 'signature',
    args: params.map(() => ({ type: 'unknown' as Type })),
    result: 'unknown',
  };
}

/** `t` with each arm of a union replaced by the first type of
 * `RECURSION_FALLBACK_TYPES` that holds it, or `undefined` when `t` is not
 * a union or an arm has no such type. */
function bareArmsOf(t: Type): Type | undefined {
  if (typeof t !== 'object' || t.kind !== 'union') return undefined;
  const types: Type[] = [];
  for (const arm of t.types) {
    const top = RECURSION_FALLBACK_TYPES.find((x) => isSubtype(arm, x));
    if (top === undefined) return undefined;
    if (!types.includes(top)) types.push(top);
  }
  return types.length === 1 ? types[0] : { kind: 'union', types };
}

/** The results of the fixpoint iterations of {@link verifiedListHypothesis},
 * by function literal, with the key of the engine state they were computed
 * in. */
const fixpointMemo = new WeakMap<
  Expression,
  { key: string; value: { result: Type; homes: HomeScope[] } | undefined }
>();

/** The number of verifications ({@link verifiedListHypothesis}) that can
 * run inside one another. A pass types a call of a function of the cycle
 * by its candidate (`provisionalRecursionResult`), so a verification inside
 * a pass would only re-check a result that the pass does not read. With
 * more than one level, a pair of functions declared `-> unknown` that call
 * each other from a `Map` callback took more than 10 s to type one call. */
const MAX_NESTED_VERIFICATIONS = 1;

/** The number of passes of {@link verifiedListHypothesis} that widen the
 * candidate result before it uses a bare type. */
const RECURSION_PASS_LIMIT = 3;

/** The bare types {@link verifiedListHypothesis} tries, in this order, when
 * the widened candidates do not reach a fixpoint. */
const RECURSION_FALLBACK_TYPES: Type[] = [
  'integer',
  'real',
  'number',
  'list',
  'collection',
];
