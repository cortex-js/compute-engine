import type { Type } from '../../common/type/types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import type { Expression, IComputeEngine, Scope } from '../global-types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import { functionResult, returnTypeText } from '../../common/type/utils.js';
import { isFunction, isSymbol } from './type-guards.js';
import { functionLiteralParameterType } from './function-literal.js';
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
    const scratch: Scope = { parent: home, bindings: new Map() };
    const typed = withScratchScope(ce, scratch, () =>
      ce._inScope(scratch, () =>
        ce.box(['Function', literal.ops[0].json, ...stamped])
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
  if (literal.has(name)) return true;
  const visit = (expr: Expression): boolean => {
    if (!isFunction(expr)) return false;
    const callee = calleeLiteral(expr);
    if (callee !== undefined && callsReach(callee, name, seen)) return true;
    return expr.ops.some((op) => visit(op));
  };
  return visit(literal);
}

/** The function literal of the user function that the application `expr`
 * calls, or `undefined`. */
function calleeLiteral(expr: Expression): Expression | undefined {
  const opDef = expr.operatorDefinition as
    { _lambdaLiteral?: Expression } | undefined;
  const literal = opDef?._lambdaLiteral ?? expr.valueDefinition?.value;
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

/**
 * The result type of a SELF-RECURSIVE function literal, verified under the
 * hypothesis that it is a list, or `undefined` when the hypothesis does not
 * apply or is refuted.
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
 * `set<T>`), and the caller keeps `derived`. Seeding a fixpoint iteration
 * with `never` was tried first and rejected: an operand typed `never` is read
 * as an absent value, and a conditional with such an arm is typed `never` as
 * a whole. Only a body that derives an abstract collection and names the
 * function, directly or through the functions it calls ({@link callsReach}),
 * is re-boxed; every other body pays nothing.
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
  // The cheap test first: most bodies derive no abstract collection, and
  // the walk of the call graph is then not needed.
  const hypothesis = listHypothesisOf(derived);
  if (hypothesis === undefined || !callsReach(literal, name)) return undefined;
  let result: Type | undefined;
  let homes: HomeScope[] = [];
  hypothesisPassDepth += 1;
  try {
    ({ result, homes } = withCandidate(hypothesis, () =>
      collectCalleeHomes(() =>
        resultUnderDeclaredParameters(ce, literal, skeleton, { rebox: true })
      )
    ));
  } finally {
    hypothesisPassDepth -= 1;
  }
  if (result === undefined || !isSubtype(result, hypothesis)) return undefined;
  return { result, homes };
}
