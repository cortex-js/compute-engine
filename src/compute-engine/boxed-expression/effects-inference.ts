import type { EffectSet, Type } from '../../common/type/types.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import { parseType } from '../../common/type/parse.js';
import { typeToString } from '../../common/type/serialize.js';
import { signatureArms } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  effectSetToString,
  normalizeEffectSet,
  unionEffectSets,
} from '../../common/type/effects.js';

import type {
  BoxedOperatorDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isFunction, isSymbol, sym } from './type-guards.js';
import {
  functionLiteralBody,
  functionLiteralParameters,
  functionLiteralReturnType,
} from './function-literal.js';

/**
 * # The `Function`-literal construction seam (`docs/EFFECTS-MODEL.md`, "Inference")
 *
 * Stage 2 requires ONE choke point: "The effect walk runs where a `Function`
 * literal's signature type is constructed. […] Stage 2 **must route them
 * through a single shared construction seam** that performs the walk, plus a
 * guard test that fails if a construction site bypasses it — a missed site
 * silently reintroduces the inline-callback gap."
 *
 * This module is that seam. Two exported entry points, and nothing else in the
 * engine may build a `Function` literal's arrow or re-implement the walk:
 *
 * - {@link functionLiteralSignatureType} — the literal's OWN arrow type,
 *   parameters + result + effect specifier. Every route (`ce.parse`, `ce.box`,
 *   `ce.function`, `ce._fn`, internal construction in `calculus.ts`,
 *   `collections.ts`, `match-dispatch.ts`, …) reaches it through the single
 *   `type()` computation in `boxed-function.ts`, because a construction site
 *   builds an *expression*: the arrow only ever materializes here.
 * - {@link inferFunctionLiteralEffects} — the walk itself, used by
 *   `boxed-operator-definition.ts` to stamp a user function's definition.
 *
 * The guard test is `test/compute-engine/effects-seam.test.ts`.
 */

/** The outcome of the static effect walk over a `Function` literal's body. */
export interface InferredLiteralEffects {
  /** The latent effect set of the literal's arrow. */
  effects: EffectSet | undefined;
  /** The peer runtime field (NOT an effect — the noise-floor convention). */
  readsRandomFrame: boolean;
  /** Frame participation the walk POSITIVELY observed, retained across the
   * `any` collapse. See `_inferredDraws` in `boxed-operator-definition.ts`. */
  draws: boolean;
  /** True when the walk applied a named head with no resolvable definition.
   * Such a walk contributed `{any}` and, per the v5 dependency-order ruling,
   * DISABLES the definition-annotation check: the annotation installs as a
   * trusted contract instead (no dependency tracking, no revalidation). */
  unresolvedHead: boolean;
}

/**
 * Raised when a definition's EXPLICIT effect annotation is violated by the
 * inference over its body (`inferred ⊄ declared`). The definition is not
 * installed; the `Assign` / `Declare` operator routes turn this into an
 * `incompatible-type` error value, the same channel as the call-boundary
 * check.
 */
export class EffectContractError extends Error {
  /** Identifies the class by STRING, not `instanceof`: a plugin bundle
   * re-bundles the engine, so a cross-bundle `instanceof` check fails (see the
   * cross-bundle identity hazard in CLAUDE.md). */
  readonly name = 'EffectContractError';

  constructor(
    readonly symbol: string,
    readonly declared: EffectSet | undefined,
    readonly inferred: EffectSet | undefined
  ) {
    super(
      `Operator Definition "${symbol}": the body infers the effects \`${describeEffects(inferred)}\`, which the declared effects \`${describeEffects(declared)}\` do not cover`
    );
  }
}

/** True when `e` is an {@link EffectContractError}, checked by name so the
 * test survives a host/plugin bundle boundary. */
export function isEffectContractError(e: unknown): e is EffectContractError {
  return (
    e instanceof Error &&
    (e as Error).name === 'EffectContractError' &&
    'declared' in e
  );
}

/**
 * The `incompatible-type` error VALUE a violated definition-annotation
 * contract yields on the `Assign` / `Declare` operator routes — the same shape
 * and channel as the call-boundary type check
 * (`createTypeErrorExpression`). The JS `ce.assign` / `ce.declare` API keeps
 * the throw, matching every other registration-time conflict.
 */
export function effectContractErrorValue(
  ce: ComputeEngine,
  e: EffectContractError
): Expression {
  return ce.error([
    'incompatible-type',
    `${describeEffects(e.declared)} effects`,
    `${describeEffects(e.inferred)} effects`,
  ]);
}

/** The effect set spelled for a diagnostic; the empty set has no spelling. */
export function describeEffects(effects: EffectSet | undefined): string {
  return effects === undefined ? 'pure' : effectSetToString(effects);
}

/**
 * The effects attached to a signature type's arrow, if any. `undefined` means
 * the arrow states nothing; the stated-empty `[]` (an author-written `pure`)
 * is PRESERVED, since "states the empty set" is exactly what distinguishes a
 * purity contract from the inferred track.
 *
 * An INTERSECTION of signatures is the overload-set representation (see
 * `overloadArms` in `overload.ts` — matched here through `signatureArms`
 * rather than imported, which would close a cycle). The effects of an overload
 * set are the UNION of the arms' effects ("One source of truth"): an overload
 * with one effect-bearing arm is not a pure definition. A MIXED intersection is
 * not a callable overload set and contributes nothing.
 *
 * A UNION is the shape an EXTRACTION produces: `At(list<(…) random -> …>, i)`
 * types as `((…) random -> …) | missing`, and the element really may be that
 * arrow — so the effects of a union are the union of its members' effects, with
 * non-signature members (`missing`, `nothing`) contributing nothing. Reading
 * `undefined` there would under-approximate in the unsound direction: the
 * runtime channel would call `Apply(At(List(randomF), 1), 0)` pure while
 * evaluating it draws.
 */
export function signatureEffects(t: Type | undefined): EffectSet | undefined {
  if (t === undefined || typeof t === 'string') return undefined;
  if (t.kind === 'signature') return t.effects;
  if (t.kind === 'union') {
    let effects: EffectSet | undefined = undefined;
    for (const member of t.types as Type[])
      effects = unionEffectSets(effects, signatureEffects(member));
    return effects;
  }
  if (t.kind !== 'intersection') return undefined;
  const arms = signatureArms(t);
  if (arms === undefined) return undefined;
  let effects: EffectSet | undefined = undefined;
  for (const arm of arms) effects = unionEffectSets(effects, arm.effects);
  return effects;
}

/**
 * `t` with the TOP-LEVEL arrow's effect specifier removed.
 *
 * Used where an INFERRED literal type is fed back as a definition's
 * `signature:` (`assignValueAsOperatorDef`, for a literal carrying a
 * return-type ascription or an annotated parameter). Such a signature is
 * inference-produced, not author-stated: leaving the specifier on it would set
 * the `effectsDeclared` provenance bit and turn the engine's own inference into
 * a contract it then checks against itself. A return-type-only `Typed(body, T)`
 * ascription carries NO effect contract (`docs/EFFECTS-MODEL.md`, "Annotation
 * provenance"); the walk re-derives the effects and stamps them back.
 *
 * Nested arrows keep their effects — an annotated parameter's declared
 * `(real) random -> real` is the author's, and only the outer specifier is
 * inferred.
 */
export function stripArrowEffects(t: Type): Type {
  if (typeof t === 'string') return t;
  if (t.kind !== 'signature' || t.effects === undefined) return t;
  const next = { ...t };
  delete next.effects;
  return next;
}

/**
 * The declared-type compatibility check, judged **per axis**
 * (`docs/EFFECTS-MODEL.md`, "Annotation provenance").
 *
 * A declaration written as a full signature declares its **type axes** —
 * parameters and result — unconditionally. Its **effects axis** is judged by
 * its own provenance, exactly as `inferredType` gates the type axes:
 *
 * - `effectsDeclared === false` (a bare specifier slot): effects are on the
 *   INFERRED track. Every `Function` literal's arrow carries the effects its
 *   body walk inferred, so a `{scope}` closure assigned to a declaration
 *   written `(number) -> number` must still fit — the check retries with the
 *   value's inferred top-level specifier removed. (Those closures are shipped,
 *   pinned idioms: `scope.test.ts`'s recursive-with-outer-variable function,
 *   `lambda-capture.test.ts`'s mutable closure.)
 * - `effectsDeclared === true`, or ANY effect set on the declared arrow
 *   (including the stated-empty `[]` a `pure` keyword builds): the effect set
 *   is a CONTRACT and is checked covariantly here too, `inferred ⊆ declared`.
 *
 * Only the TOP-LEVEL specifier is inferred; a nested arrow (an annotated
 * parameter's `(real) random -> real`) is the author's and is never stripped.
 */
export function matchesDeclaredTypeAxes(
  ce: ComputeEngine,
  value: BoxedType,
  declared: BoxedType,
  effectsDeclared: boolean
): boolean {
  if (value.matches(declared)) return true;
  if (effectsDeclared || signatureEffects(declared.type) !== undefined)
    return false;
  return ce.type(stripArrowEffects(value.type)).matches(declared);
}

//
// ── The literal's own arrow ──────────────────────────────────────────────────
//

/**
 * Build the signature type of a `Function` literal — THE seam.
 *
 * Parameters + result type + the effect specifier produced by
 * {@link inferFunctionLiteralEffects} over the body. Called from exactly one
 * place, the `Function` case of `type()` in `boxed-function.ts`; every
 * construction route funnels through it because a construction site produces an
 * expression and the arrow is only ever materialized on `.type`.
 *
 * The literal's effects go on ITS OWN arrow — that is the Stage 2 boundary
 * rule: `makeCallback() := (() ↦ Random())` is itself pure, with result type
 * `() random -> …`.
 */
export function functionLiteralSignatureType(expr: Expression): Type {
  const ce = expr.engine;
  const body = functionLiteralBody(expr)!;
  const params = functionLiteralParameters(expr);

  // Result type: an explicit return-type ascription (the §4.2 marker) is
  // used verbatim, bypassing the widening rule. A Block's type is its last
  // statement's type, so `body.type` already surfaces the ascribed return.
  const ascribedReturn = functionLiteralReturnType(expr);
  let bodyType: Type | string = `${body.type}`;
  // The parameters of a bare function literal have unknown type, so a
  // finite-numeric body claim is unsound: the lambda may later be applied to
  // a non-finite argument — `(x ↦ x²)(∞) = +∞` — so widen a finite-numeric
  // result to the top numeric type `number`. (A nullary function has no such
  // parameter, so its exact body type is kept.) Suppress the widening only
  // when EVERY parameter type is provably finite (`finite_number`); in this
  // type system `integer`/`rational`/`real` all admit non-finite values, so
  // a param annotated `integer` still widens. A bare param (type undefined)
  // never suppresses widening.
  if (
    ascribedReturn === undefined &&
    params.length > 0 &&
    body.type.matches('finite_number') &&
    !params.every(
      (p) => p.type !== undefined && isSubtype(p.type, 'finite_number')
    )
  )
    bodyType = 'number';

  // Parameter slots: an annotated param emits its declared type, named
  // (`x: integer`); a bare param stays `unknown` as today.
  const paramSig = params
    .map((p) =>
      p.type !== undefined ? `${p.name}: ${typeToString(p.type)}` : 'unknown'
    )
    .join(', ');

  // The effect specifier slot. An INFERRED empty set is written as an empty
  // slot, i.e. nothing at all — the author's `pure` spelling is a statement,
  // and inference states nothing (`inferFunctionLiteralEffects` collapses a
  // `[]` accumulated from an applied stated-pure callback).
  const effects = inferFunctionLiteralEffects(ce, expr).effects;
  const specifier =
    effects === undefined ? '' : ` ${effectSetToString(effects)}`;

  return parseType(
    `(${paramSig})${specifier} -> ${bodyType}`,
    ce._typeResolver
  );
}

//
// ── The walk ─────────────────────────────────────────────────────────────────
//

/** Mutable accumulator of the walk. */
interface WalkState {
  effects: EffectSet | undefined;
  readsRandomFrame: boolean;
  draws: boolean;
  unresolvedHead: boolean;
}

/** Per-branch context: the confinement frontier and the local literal bindings. */
interface WalkContext {
  /** Symbols provably `Declare`d on EVERY static path to this point, within
   * the literal. The dominance approximation — see {@link isConfinedTarget}. */
  declared: Set<string>;
}

/**
 * Infer the effect set of a `Function` literal from its body.
 *
 * The normative rules (`docs/EFFECTS-MODEL.md`, "Inference" and "Scope writes"):
 *
 * - **Literals are inference boundaries.** A nested `Function` literal's
 *   effects go on its own arrow; the enclosing body adds them only where it
 *   APPLIES (or projects) the literal. Merely producing or storing a callback
 *   contributes ∅. Applications recognized statically: an immediately-applied
 *   literal (`Apply(Function(…), …)`) and a head that is a local symbol bound
 *   to a literal by a `Declare`/`Assign` earlier in the body.
 * - **Applied parameters (ruling (c)).** An ANNOTATED function parameter
 *   contributes its declared arrow effects where the body applies it. An
 *   UNANNOTATED parameter (declared `unknown`) is treated pure — deliberate
 *   residual optimism, closable by annotation.
 * - **Dependency order (v5 ruling).** An UNRESOLVED named head contributes
 *   `{any}` and sets {@link InferredLiteralEffects.unresolvedHead}. A
 *   self-call is neutral: the definition under construction is the literal
 *   itself, not an unknown.
 * - **Confinement (dominance).** An `Assign` contributes no `scope` iff every
 *   static path from the literal's entry to it passes through a `Declare` of
 *   that symbol WITHIN the literal, and the symbol is not referenced by any
 *   nested `Function` literal (closure capture ⇒ escaping). `Assume` is never
 *   confined. Not provably confined ⇒ `scope`. Inference-only: the runtime
 *   `effectsOf` accounting stays conservative.
 *
 * `Hold` is NOT skipped: `Hold(Random())` marks the literal as drawing even
 * though nothing draws until `Release`. That is the conservative direction and
 * keeps the walk a plain structural scan.
 *
 * The literal may arrive in `'raw'` form, so its nodes can be UNBOUND and
 * `operatorDefinition` `undefined` throughout — the lookup by name is the
 * load-bearing path, not a fallback.
 */
export function inferFunctionLiteralEffects(
  ce: ComputeEngine,
  literal: Expression,
  options?: { selfName?: string }
): InferredLiteralEffects {
  const state: WalkState = {
    effects: undefined,
    readsRandomFrame: false,
    draws: false,
    unresolvedHead: false,
  };
  walkLiteral(ce, literal, state, options?.selfName, 0);
  // Inference produces an UNSTATED set: an empty result is the bare arrow,
  // never the author's `pure`. The walk can accumulate a stated `[]` from an
  // applied `(…) pure -> …` callback, so collapse it here — the one place the
  // inference/stated split is decided (`normalizeEffectSet` vs
  // `normalizeStatedEffectSet`, `common/type/effects.ts`).
  state.effects = normalizeEffectSet(state.effects);
  return state;
}

/** Depth guard: a pathological self-referential literal must not recurse
 * forever through the applied-callback resolution. */
const MAX_LITERAL_DEPTH = 8;

function walkLiteral(
  ce: ComputeEngine,
  literal: Expression,
  state: WalkState,
  selfName: string | undefined,
  depth: number
): void {
  if (depth > MAX_LITERAL_DEPTH) {
    state.effects = 'any';
    return;
  }

  // A parameter shadows any same-named operator for the whole body, so
  // `f(Random) := Random` must not be read as a draw.
  const params = new Map<string, EffectSet | undefined | null>();
  for (const p of functionLiteralParameters(literal))
    // `null` marks an UNANNOTATED parameter: optimistically pure, no
    // contribution. An annotated one contributes its declared arrow effects.
    params.set(p.name, p.type === undefined ? null : signatureEffects(p.type));

  const body = functionLiteralBody(literal);
  if (body === undefined) return;

  // Closure capture: a symbol referenced by ANY nested literal escapes, so a
  // write to it can outlive this application and is never confined.
  const captured = new Set<string>();
  collectNestedLiteralSymbols(body, captured);

  // Local symbols bound to a `Function` literal by a `Declare`/`Assign` in the
  // body: applying one of them projects the literal's latent effects.
  const localLiterals = new Map<string, Expression>();

  const walker = new Walker(
    ce,
    state,
    params,
    captured,
    localLiterals,
    selfName,
    depth
  );
  walker.sequence([body], { declared: new Set() });
}

/** All symbol names occurring inside any nested `Function` literal of `expr`. */
function collectNestedLiteralSymbols(expr: Expression, out: Set<string>): void {
  if (isSymbol(expr)) return;
  if (!isFunction(expr)) return;
  if (expr.operator === 'Function') {
    collectSymbols(expr, out);
    return;
  }
  for (const op of expr.ops) collectNestedLiteralSymbols(op, out);
}

function collectSymbols(expr: Expression, out: Set<string>): void {
  const name = sym(expr);
  if (name !== undefined) {
    out.add(name);
    return;
  }
  if (!isFunction(expr)) return;
  out.add(expr.operator);
  for (const op of expr.ops) collectSymbols(op, out);
}

class Walker {
  constructor(
    private ce: ComputeEngine,
    private state: WalkState,
    private params: Map<string, EffectSet | undefined | null>,
    private captured: Set<string>,
    private localLiterals: Map<string, Expression>,
    private selfName: string | undefined,
    private depth: number
  ) {}

  /** Straight-line dominance: a `Declare(n, …)` statement dominates the
   * statements that FOLLOW it in the same sequence, and nothing else. The
   * frontier is copied per sequence, so a `Declare` inside a nested `Block`
   * (or inside an `If` arm) does not leak to the enclosing sequence — the
   * `Block(If(flag, Declare(n, 0)), Assign(n, 5))` case, which must NOT be
   * confined. */
  sequence(ops: readonly Expression[], ctx: WalkContext): void {
    const declared = new Set(ctx.declared);
    for (const op of ops) {
      this.visit(op, { declared });
      if (isFunction(op, 'Declare')) {
        for (const name of assignTargets(op)) {
          if (name === undefined) continue;
          declared.add(name);
        }
        this.recordLocalLiteral(op, 1);
      } else if (isFunction(op, 'Assign')) this.recordLocalLiteral(op, 1);
    }
  }

  /** Remember `name := (…) ↦ …` so a later application of `name` inside the
   * same body projects the literal's latent effects. */
  private recordLocalLiteral(expr: Expression, valueIndex: number): void {
    if (!isFunction(expr)) return;
    const name = sym(expr.ops[0]);
    if (name === undefined) return;
    // `Declare(n, type, value)` puts the value third; `Assign(n, value)`
    // second. Scan the remaining operands for a literal.
    for (const op of expr.ops.slice(valueIndex))
      if (isFunction(op, 'Function')) {
        this.localLiterals.set(name, op);
        return;
      }
  }

  visit(expr: Expression, ctx: WalkContext): void {
    // Saturated: nothing further can change the answer.
    if (
      this.state.effects === 'any' &&
      this.state.readsRandomFrame &&
      this.state.draws &&
      this.state.unresolvedHead
    )
      return;
    if (!isFunction(expr)) return;

    const head = expr.operator;

    // ── Literals are inference boundaries ────────────────────────────────
    // Producing or storing a nested literal contributes ∅; its effects live on
    // its own arrow.
    if (head === 'Function') return;

    // A sequence: `Block` is the only straight-line construct the confinement
    // analysis reasons about.
    if (head === 'Block') {
      this.sequence(expr.ops, ctx);
      return;
    }

    // ── Applications ─────────────────────────────────────────────────────
    if (head === 'Apply') {
      const callee = expr.ops[0];
      if (callee !== undefined) {
        // An immediately-applied literal: its latent effects DO flow into the
        // enclosing body.
        if (isFunction(callee, 'Function'))
          walkLiteral(
            this.ce,
            callee,
            this.state,
            this.selfName,
            this.depth + 1
          );
        else this.applyNamed(sym(callee));
      }
      // The callee is handled above; the remaining operands are ordinary
      // invoking positions (`Apply(hof, callback)`).
      this.projectOperands(head, expr.ops, 1);
      for (const op of expr.ops.slice(1)) this.visit(op, ctx);
      return;
    }

    if (head === 'Assign') {
      this.scopeWrite(expr, ctx, /* confinable */ true);
      for (const op of expr.ops.slice(1)) this.visit(op, ctx);
      return;
    }

    if (head === 'Declare') {
      // A `Declare` inside the literal introduces a binding in a scope the
      // literal itself owns — it cannot write through to an outer binding, so
      // it never contributes `scope`.
      for (const op of expr.ops.slice(1)) this.visit(op, ctx);
      return;
    }

    if (head === 'Assume') {
      // Never confined: an assumption targets the ambient assumption store.
      this.state.effects = unionEffectSets(this.state.effects, ['scope']);
      for (const op of expr.ops) this.visit(op, ctx);
      return;
    }

    this.applyNamed(head);
    this.projectOperands(head, expr.ops, 0);

    for (const op of expr.ops) this.visit(op, ctx);
  }

  /**
   * PROJECTION of a callback passed as an OPERAND of an applied head.
   *
   * Worked example 1, the headline case: "the literal `(xs) ↦ Map(xs, f)` has
   * type `(list) random -> list` — the application's effects, stamped onto the
   * enclosing literal's own arrow by the static walk". The body adds a
   * callback's effects where it "APPLIES (or **projects**)" it, and handing `f`
   * to `Map` is projection. `applyNamed` covers the direct application
   * (`f(x)`); this covers the operand position, for all three kinds of function
   * value:
   *
   * - an **inline literal** — its latent set, walked here. This does NOT
   *   reopen "literals are inference boundaries": producing or STORING a
   *   literal still contributes ∅ (the `Function`, `Assign` and `Declare`
   *   branches of {@link visit} never reach this method); only an invoking
   *   position projects.
   * - an **annotated parameter** — its declared arrow effects. An UNANNOTATED
   *   one contributes nothing (ruling (c) optimism, unchanged).
   * - a **named symbol** resolving to a function value — its binding's arrow,
   *   a construction-time SNAPSHOT: signatures are constants, so a later
   *   reassignment does not re-stamp this arrow (the runtime `effectsOf`
   *   channel is the honest party there). An UNRESOLVED name contributes
   *   `{any}` per the dependency-order ruling — but only under a head that
   *   DECLARES a callback parameter ({@link acceptsCallable}), so an ordinary
   *   free symbol (`(x) ↦ x + freeVar`) stays optimistic rather than
   *   collapsing every literal with a free variable to the top.
   *
   * Gated throughout on the head's `invokes` metadata, exactly as `effectsOf`
   * gates the latent half of a contribution: an `invokes: false` operator only
   * STORES the value, so `(g) ↦ List(g)` and `List(x ↦ Random())` stay pure.
   * An unresolved head keeps the conservative default (`invokes: true`) — and
   * has already contributed `{any}` through {@link applyNamed}.
   *
   * @param start First operand index to consider — 1 for `Apply`, whose callee
   * is handled by {@link visit} itself.
   */
  private projectOperands(
    head: string,
    ops: readonly Expression[],
    start: number
  ): void {
    const def = operatorDefinitionOf(this.ce, head);
    if (def !== undefined && def.invokes === false) return;

    for (let i = start; i < ops.length; i++) {
      const op = ops[i];

      // An inline literal in an invoking position: project its latent set.
      if (isFunction(op, 'Function')) {
        walkLiteral(this.ce, op, this.state, this.selfName, this.depth + 1);
        continue;
      }

      const name = sym(op);
      if (name === undefined) continue;

      // `applyNamed` already encodes every resolution rule — parameter
      // shadowing, local literals, the neutral self-reference, operator
      // definitions (with the `draws` / `readsRandomFrame` bits), value
      // bindings, and the unresolved-`{any}` case. Reuse it rather than
      // reimplement it; the guard below is only about WHICH names may reach
      // its unresolved arm.
      if (
        this.params.has(name) ||
        this.localLiterals.has(name) ||
        name === this.selfName ||
        this.isFunctionValued(name) ||
        acceptsCallable(def)
      )
        this.applyNamed(name);
    }
  }

  /** Whether `name` currently resolves to something callable — an operator
   * definition, or a value binding whose type is an arrow. A binding that is
   * not callable (`k := 5`) contributes nothing from an operand position. */
  private isFunctionValued(name: string): boolean {
    const def = this.ce.lookupDefinition(name);
    if (def === undefined) return false;
    if ('operator' in def) return true;
    const t = def.value.type?.type as Type | undefined;
    return t !== undefined && isCallableType(t);
  }

  /** Contribution of applying the named head `name`. */
  private applyNamed(name: string | undefined): void {
    if (name === undefined) return;

    // A parameter shadows any same-named operator.
    if (this.params.has(name)) {
      const declared = this.params.get(name);
      // `null` = unannotated: optimistically pure (ruling (c)).
      if (declared !== null)
        this.state.effects = unionEffectSets(this.state.effects, declared);
      return;
    }

    // A local symbol bound to a literal earlier in the body: project the
    // literal's latent effects.
    const local = this.localLiterals.get(name);
    if (local !== undefined) {
      walkLiteral(this.ce, local, this.state, this.selfName, this.depth + 1);
      return;
    }

    // A self-call is neutral: the definition under construction is this very
    // literal, and the rest of the body is what classifies it.
    if (name === this.selfName) return;

    const def = operatorDefinitionOf(this.ce, name);
    if (def === undefined) {
      const t = valueSignatureOf(this.ce, name);
      if (t === 'undeclared') {
        // Dependency order, ruled (v5): an unresolved named head infers
        // `{any}` — sound; the cost is caching for forward references. An
        // explicit annotation over such a walk installs as a TRUSTED contract.
        this.state.effects = 'any';
        this.state.unresolvedHead = true;
        return;
      }
      this.state.effects = unionEffectSets(this.state.effects, t);
      return;
    }

    if (def.readsRandomFrame === true) this.state.readsRandomFrame = true;
    // Read from the callee's DERIVED getter, so an explicit `random`, a
    // frame-protocol head, and a callee whose own inference saw a draw all
    // propagate — the same composition rule as the effect union.
    if (def.drawsRandom === true) this.state.draws = true;
    // A head that participates in the seed frame through a FRAME PROTOCOL
    // rather than through its own effect set (`WithRandomSeed`) still makes
    // this body owe the outer frame. Its effect set is the placeholder `any` —
    // standing in for its HELD body — so `{random}` is contributed in its
    // place; unioning the placeholder would DEFEAT the propagation.
    if (def.frameProtocol === 'seed')
      this.state.effects = unionEffectSets(this.state.effects, ['random']);
    else this.state.effects = unionEffectSets(this.state.effects, def.effects);
  }

  /** An `Assign`: `{scope}` unless provably confined. */
  private scopeWrite(
    expr: Expression,
    ctx: WalkContext,
    confinable: boolean
  ): void {
    const targets = assignTargets(expr);
    // Destructuring / compound targets are judged per target symbol; any
    // target the analysis cannot resolve ⇒ `scope`.
    const confined =
      confinable &&
      targets.length > 0 &&
      targets.every(
        (name) =>
          name !== undefined &&
          ctx.declared.has(name) &&
          !this.captured.has(name)
      );
    if (!confined)
      this.state.effects = unionEffectSets(this.state.effects, ['scope']);
  }
}

/**
 * Whether `t` denotes a callable value: the bare `function` primitive, an
 * arrow, or a union/intersection containing one.
 *
 * Deliberately NARROWER than the runtime channel's `couldBeCallable`: `unknown`
 * and `any` are excluded. This predicate arms the unresolved-operand `{any}`
 * rule, and most user-function parameters are typed `unknown` — admitting them
 * would collapse every literal that passes a free symbol to an ordinary head.
 * Only a position DECLARED callable (`Map`'s `function`, an explicit arrow
 * parameter) says "this operand is a callback".
 */
function isCallableType(t: Type): boolean {
  if (typeof t === 'string') return t === 'function';
  if (t.kind === 'signature') return true;
  if (t.kind === 'union' || t.kind === 'intersection')
    return (t.types as Type[]).some(isCallableType);
  return false;
}

/**
 * Whether `def` takes a callback in ANY parameter position — see
 * {@link isCallableType}; any arm of an overload set suffices.
 *
 * Deliberately position-INSENSITIVE. An operand's index need not line up with
 * the declared parameter it satisfies: `Map`'s signature is
 * `(function, collection+) -> indexed_collection` while the boxed form is
 * `Map(collection, function)`, so an index-keyed test would read `collection`
 * for the callback and miss it. The question this gate answers is only "could
 * an operand of this operator be a callback at all" — enough to keep the
 * unresolved-operand `{any}` rule off `Add`, `Total` and every other
 * callback-free operator, which is what it exists for.
 */
function acceptsCallable(def: BoxedOperatorDefinition | undefined): boolean {
  if (def === undefined) return false;
  const t = def.signature.type;
  if (typeof t === 'string') return false;
  const arms =
    t.kind === 'signature'
      ? [t]
      : t.kind === 'intersection'
        ? (signatureArms(t) ?? [])
        : [];
  for (const arm of arms) {
    const params = [
      ...(arm.args ?? []),
      ...(arm.optArgs ?? []),
      ...(arm.variadicArg ? [arm.variadicArg] : []),
    ];
    if (params.some((p) => isCallableType(p.type))) return true;
  }
  return false;
}

/**
 * The target symbols of an `Assign`/`Declare` first operand. A destructuring
 * `Tuple`/`List` yields one entry per component; `undefined` marks a component
 * the analysis cannot resolve to a symbol (e.g. `Assign(At(v, 1), …)`), which
 * forces the conservative `scope`.
 */
function assignTargets(expr: Expression): (string | undefined)[] {
  if (!isFunction(expr)) return [undefined];
  const target = expr.ops[0];
  if (target === undefined) return [undefined];
  const name = sym(target);
  if (name !== undefined) return [name];
  if (
    isFunction(target, 'Tuple') ||
    isFunction(target, 'List') ||
    isFunction(target, 'Delimiter') ||
    isFunction(target, 'Sequence')
  )
    return target.ops.map((op) => sym(op));
  return [undefined];
}

/** The operator definition bound to `name`, or `undefined` when `name` is
 * undeclared or holds a value rather than an operator. */
function operatorDefinitionOf(
  ce: ComputeEngine,
  name: string
): BoxedOperatorDefinition | undefined {
  const def = ce.lookupDefinition(name);
  return def && 'operator' in def ? def.operator : undefined;
}

/**
 * A head bound to a VALUE rather than to an operator: a function literal stored
 * under a declared signature (`Declare(f, "(…) -> …", (x) ↦ …)`) is the common
 * shape. Returns its arrow effects, or the sentinel `'undeclared'` when the
 * name has no binding at all — the dependency-order case.
 */
function valueSignatureOf(
  ce: ComputeEngine,
  name: string
): EffectSet | undefined | 'undeclared' {
  const def = ce.lookupDefinition(name);
  if (def === undefined) return 'undeclared';
  if (!('value' in def)) return undefined;
  const t = def.value.type?.type;
  return signatureEffects(t as Type | undefined);
}
