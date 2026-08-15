import type {
  EffectLabel,
  EffectSet,
  FunctionSignature,
  Type,
} from '../../common/type/types.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import { signatureArms, signatureEffects } from '../../common/type/utils.js';
import { isCallbackType } from '../../common/type/callback.js';
import { isSubtype, objectLayoutOfType } from '../../common/type/subtype.js';
import {
  effectSetToString,
  isCoFiniteEffects,
  normalizeEffectSet,
  subtractEffects,
  unionEffectSets,
} from '../../common/type/effects.js';

import type {
  BoxedOperatorDefinition,
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isFunction, isString, isSymbol, sym } from './type-guards.js';
import { effectiveDischarge } from './effects-of.js';
import { typeAcceptsValue } from './value-membership.js';
import {
  declaredTypeError,
  genericOverloadLiteralError,
} from './type-compatibility-error.js';
import { substituteDeclaredBounds } from './generic-instantiation.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import {
  functionLiteralBody,
  functionLiteralDeclaredEffects,
  functionLiteralDeclaredSignature,
  functionLiteralParameters,
  functionLiteralReturnMarker,
  functionLiteralReturnType,
  isScalarType,
  mentionsQuantifiedVariable,
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
  /** True when the walk POSITIVELY proved a world mutation: an unconfined
   * write or `Assume` in the body, or an application of a resolved callee /
   * annotated callback parameter whose effect set concretely contains
   * `scope`. Unlike the `scope` label in {@link effects}, this bit survives
   * the `any` collapse AND is never set by conservatism (an unresolved head's
   * `{any}` does not set it) — it is the trigger of the default-`!scope`
   * ceiling on bare-slot definitions (`docs/EFFECTS-MODEL.md`, "Scope is
   * opt-in"; ruled 2026-08-15). */
  escapingWrite: boolean;
  /** True when the walk consulted an effect set that is itself LAZILY DERIVED
   * from the conformance registry — see `WalkState.consultsRegistry`. A
   * definition stamped from such a walk installs a deriver of its own
   * (`_deriveEffects` in `boxed-operator-definition.ts`) instead of freezing
   * the value it saw. */
  consultsRegistry: boolean;
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
    readonly inferred: EffectSet | undefined,
    /** Where the violated contract was STATED, when the effects-axis
     * provenance history recorded it (a post-construction declaration —
     * `docs/plans/2026-08-13-effects-axis-provenance.md`). `undefined` for
     * a construction-stated contract, which records no entry. Used for
     * RENDERING only (the escape rule of the rollback-frame design): the
     * message and the Epsil diagnostic show its `toString()`, and no
     * consumer resolves bindings through it. */
    readonly declaredAt?: Expression,
    /** True when the violated bound is the IMPLICIT default rather than an
     * author-stated contract: a bare-slot definition whose body proved a
     * world mutation. Escaping writes are opt-in — the `scope` effect must
     * be declared (`docs/EFFECTS-MODEL.md`, "Scope is opt-in"; ruled
     * 2026-08-15). Changes only the rendering, not the channel. */
    readonly scopeDefault?: boolean
  ) {
    super(
      scopeDefault
        ? `Operator Definition "${symbol}": the body writes outside the function (an assignment to an outer variable, or an assumption), which requires declaring the \`scope\` effect — e.g. \`function ${symbol}(…) scope { … }\` or a \`(…) scope -> …\` signature. Inferred effects: \`${describeEffects(inferred)}\``
        : `Operator Definition "${symbol}": the body infers the effects \`${describeEffects(inferred)}\`, which the declared effects \`${describeEffects(declared)}\`` +
            (declaredAt === undefined
              ? ''
              : ` (declared at \`${declaredAt.toString()}\`)`) +
            ` do not cover`
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
  // The declaring site travels as the error's `where` STRING — the legacy
  // string-context slot of the sited-error shape, rendered by
  // `describeError` on the Epsil static route. Deliberately a string, not
  // an expression operand: the effects note only ever renders the site
  // (never resolves bindings through it), and the public `ce.error` `where`
  // parameter is string-typed. The diagnostic dedup key is site-less by the
  // phase-1 design, so deduplication is unchanged.
  return ce.error(
    [
      'incompatible-type',
      e.scopeDefault
        ? 'non-scope effects (writes outside a function require a declared `scope` effect)'
        : `${describeEffects(e.declared)} effects`,
      `${describeEffects(e.inferred)} effects`,
    ],
    e.declaredAt?.toString()
  );
}

/** The effect set spelled for a diagnostic; the empty set has no spelling. */
export function describeEffects(effects: EffectSet | undefined): string {
  return effects === undefined ? 'pure' : effectSetToString(effects);
}

/**
 * The effects attached to a signature type's arrow, if any — the compute-engine
 * layer's entry point for the question. ONE implementation lives in
 * `common/type/utils.ts` (the reader behind `BoxedType.effects`); this module
 * re-exports it so the two layers cannot drift. See that function for the
 * union / intersection / stated-empty rules.
 */
export { signatureEffects };

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
 * `t` with `effects` set on its TOP-LEVEL arrow — the counterpart of
 * {@link stripArrowEffects}, a no-op when `t` is not a signature.
 *
 * Used where an AUTHOR-STATED effect set (a `Function` literal's
 * full-signature return marker) must ride onto a signature otherwise derived
 * from the inference-produced literal type, so that the operator definition
 * records it as a contract rather than as its own inference.
 */
export function withArrowEffects(t: Type, effects: EffectSet): Type {
  if (typeof t === 'string' || t.kind !== 'signature') return t;
  return { ...t, effects };
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
/**
 * Refine `unknown` placeholder slots in a DECLARED ground signature with the
 * corresponding slots of the value's inferred signature, before the two are
 * compared.
 *
 * A declared `unknown` is a PLACEHOLDER, not a contract (ruled 2026-08-15):
 * per "The `unknown` type" in `doc/08-guide-types.md` it "can be replaced or
 * refined as more information becomes available" — and the definition that
 * follows the declaration IS that information. Without this, a placeholder
 * declaration was strictly MORE restrictive than no declaration: checking the
 * body-inferred lambda against `(unknown) -> unknown` requires, by parameter
 * contravariance, `unknown <: ⟨inferred param⟩`, which is false in the
 * lattice — so `declare('f', '(unknown) -> unknown')` followed by
 * `f(P) := √(P[1]²+P[2]²)` was refused while declaring nothing at all
 * worked.
 *
 * `any` slots are deliberately NOT refined: `any` is a CONTRACT — the
 * identity function is `(any) -> any`, a promise to accept every value — so a
 * body that cannot honor it is correctly refused (same ruling).
 *
 * Only top-level parameter and result slots of a plain fixed-arity ground
 * signature are refined; polymorphic declarations, optional/variadic
 * signatures, and non-signature types pass through untouched.
 *
 * Exported for the install routes in `engine-declarations.ts`, which refine
 * BEFORE their reconciliation pipeline (so parameter ascription, the
 * compatibility check, and the `paramsAreScalar` broadcast decision all see
 * the concrete signature) and persist the refined type onto the definition —
 * a check-time-only refinement here would accept the definition but leave the
 * stored `(unknown) -> …` signature driving call-site broadcasting, so
 * `l_P([3,4])` broadcast elementwise instead of passing the list whole.
 */
export function refineDeclaredPlaceholders(declared: Type, value: Type): Type {
  if (typeof declared !== 'object' || declared.kind !== 'signature')
    return declared;
  // A polymorphic declaration's slots are quantified variables with their own
  // machinery (§2.4 generic literals) — never placeholder-refined.
  if (isPolymorphicType(declared)) return declared;
  if (typeof value !== 'object' || value.kind !== 'signature') return declared;
  if ((declared.optArgs?.length ?? 0) > 0) return declared;
  if (declared.variadicArg !== undefined) return declared;
  const dArgs = declared.args ?? [];
  const vArgs = value.args ?? [];
  if (dArgs.length !== vArgs.length) return declared;

  let argsChanged = false;
  const args = dArgs.map((a, i) => {
    if (a.type !== 'unknown') return a;
    const v = vArgs[i]?.type;
    if (v === undefined || v === 'unknown') return a;
    argsChanged = true;
    return { ...a, type: v };
  });
  let resultChanged = false;
  let result = declared.result;
  if (result === 'unknown' && value.result !== 'unknown') {
    resultChanged = true;
    result = value.result;
  }
  if (!argsChanged && !resultChanged) return declared;
  // Replace only the slots that moved: a zero-arg signature spells its
  // parameter list as ABSENT (`args: undefined`), and fabricating an explicit
  // empty array changes the object shape the rest of the type machinery
  // canonicalized on.
  const refined = { ...declared, result };
  if (argsChanged) refined.args = args;
  return refined;
}

export function matchesDeclaredTypeAxes(
  ce: ComputeEngine,
  value: BoxedType,
  declared: BoxedType,
  effectsDeclared: boolean,
  valueExpr?: Expression,
  /** The symbol being declared/assigned, for the D7 diagnostic. */
  symbol?: string
): boolean {
  // A declared `unknown` slot is a placeholder the value refines, never a
  // constraint (see `refineDeclaredPlaceholders` above). Skipped for a
  // polymorphic declaration, whose slots are quantified variables with their
  // own machinery.
  if (!declared.isPolymorphic) {
    const refined = refineDeclaredPlaceholders(declared.type, value.type);
    if (refined !== declared.type) declared = ce.type(refined);
  }
  // Declaration compatibility uses SUBTYPE semantics. `BoxedType.matches` on
  // a polymorphic pattern is the D12 existential QUERY ("does SOME
  // instantiation fit?"), which would accept an instance-shaped ground value
  // against a generic declaration — but a declaration promises EVERY
  // instantiation (`Ground <: Poly` is false, D3), so a polymorphic declared
  // type is held to `isSubtype` here, never the existential probe.
  if (
    declared.isPolymorphic
      ? isSubtype(value.type, declared.type)
      : value.matches(declared)
  )
    return true;

  // A `Function` LITERAL under a GENERIC declaration is judged by the
  // generic-literals acceptance rule (§2.4 of
  // `docs/plans/2026-08-04-generic-function-literals-design.md`), NOT by
  // `Ground <: Poly` — which is false (D3) and would reject every generic
  // literal, as the retired D7 gate did. Under erasure (G1) the literal is an
  // untyped lambda with the polytype as its call-site contract, so the axes
  // that CAN be checked at the boundary are checked here and the rest is a
  // trusted ascription (G10).
  //
  // Gated on an actual `Function` LITERAL, as the routes in
  // `engine-declarations.ts` are: any other callable value (a symbol bound to
  // a ground function, say) has no body to speak of and falls through to the
  // ordinary `matches` path below, whose honest verdict is
  // `Ground <: Poly = false` — a plain `incompatible-type`.
  if (
    declared.isPolymorphic &&
    isFunction(valueExpr, 'Function') &&
    isCallableType(value.type)
  )
    return acceptsGenericFunctionLiteral(symbol ?? '', valueExpr, declared);

  // A concrete value inhabiting a value-component declared type (`z: 0` with
  // `z := 0`): the synthesized type (`finite_integer`) cannot witness
  // membership in the value type. See `value-membership.ts`.
  if (valueExpr !== undefined && typeAcceptsValue(valueExpr, declared.type))
    return true;
  if (effectsDeclared || signatureEffects(declared.type) !== undefined)
    return false;
  const stripped = ce.type(stripArrowEffects(value.type));
  return declared.isPolymorphic
    ? isSubtype(stripped.type, declared.type)
    : stripped.matches(declared);
}

/**
 * G11 (§2.4) — a function literal may implement a polymorphic declared type
 * only when that type is a SINGLE-ARM signature.
 *
 * Runs FIRST at every declaration-boundary site, ahead of the arity and
 * effects assertions: an overload set with a generic arm is not a shape one
 * erased body can implement at all, so a "wrong arity" diagnostic for it would
 * name the wrong problem.
 *
 * A no-op for a ground declared type and for a single generic signature.
 */
export function assertSingleArmPolytype(
  symbol: string,
  literal: Expression,
  declared: BoxedType
): void {
  if (!declared.isPolymorphic) return;
  const t = declared.type;
  if (typeof t === 'object' && t.kind === 'signature') return;
  throw genericOverloadLiteralError(symbol, literal.type, declared);
}

/**
 * `sig` reduced to its TYPE AXES — `typeParams`, argument types and result —
 * for the G9 α-equivalence comparison.
 *
 * Two axes are dropped. **Effects**, because they are governed solely by the
 * `inferred ⊆ declared` subset rule (§2.4 rule 2) and whole-signature
 * α-equality would penalize a literal for honestly stating a NARROWER set.
 * **Argument names**, because a marker's argument names are cosmetic — the
 * literal's operand names are the names of record (§2.3, the
 * `docs/EFFECTS-MODEL.md` mirror rule) — and the α-equivalence relation
 * compares dedup KEYS, which do spell names out (`(x: T) -> T`). Without this
 * a declaration written `(T) -> T where T` would refuse the E1 spelling of
 * its own implementation, whose sugar REQUIRES named arguments.
 *
 * `typeParams` is carried through (the rebuild invariant): the comparison is
 * α-equivalence, which needs the clause.
 */
function typeAxesOf(sig: FunctionSignature): Type {
  const t = stripArrowEffects(sig) as FunctionSignature;
  const anonymize = (a: { name?: string; type: Type }) => ({ type: a.type });
  return {
    ...t,
    ...(t.args !== undefined ? { args: t.args.map(anonymize) } : {}),
    ...(t.optArgs !== undefined ? { optArgs: t.optArgs.map(anonymize) } : {}),
    ...(t.variadicArg !== undefined
      ? { variadicArg: anonymize(t.variadicArg) }
      : {}),
  };
}

/**
 * The generic-literal ACCEPTANCE RULE (§2.4 of
 * `docs/plans/2026-08-04-generic-function-literals-design.md`), shared by every
 * declaration-boundary route.
 *
 * Rules 1 (arity, `assertFunctionLiteralArity`) and 2 (effects,
 * `assertDeclaredEffects`) are the SAME assertions a ground declared signature
 * runs — `signatureArms` and `signatureEffects` both read a clause-carrying
 * arrow — so the boundary sites in `engine-declarations.ts` already apply
 * them, unchanged, before the value definition is built and this check runs.
 * What is generic-specific is rule 0 (G11, {@link assertSingleArmPolytype}),
 * rule 3 and rule 4 below.
 *
 * Everything the erased body itself does — in particular whether it really
 * returns its argument's type — is a TRUSTED ascription (G10, ruled): under
 * erasure there is nothing to check it against.
 */
function acceptsGenericFunctionLiteral(
  symbol: string,
  literal: Expression,
  declared: BoxedType
): boolean {
  // Rule 0 — G11.
  assertSingleArmPolytype(symbol, literal, declared);
  const declaredSig = declared.type as FunctionSignature;

  // Rule 3 — own-contract agreement (G9). A literal that states its OWN
  // full-signature polytype (E1/E2/E4) must agree with the declaration on the
  // TYPE axes: `typeParams` modulo renaming, argument types, result. That is
  // exactly `isSubtype` between two polytypes (§5 rule 3 — α-equivalence).
  //
  // The EFFECTS axis is excluded — stripped from BOTH arrows first — and is
  // governed solely by the `inferred ⊆ declared` subset rule: a literal that
  // honestly states a NARROWER effect set (`pure` marker under a `random`
  // declaration) must not be penalized for being explicit where silence
  // passes. A plain (E3) literal carries no marker and always passes.
  const marker = functionLiteralDeclaredSignature(literal);
  if (marker !== undefined && (marker.typeParams?.length ?? 0) > 0) {
    if (!isSubtype(typeAxesOf(marker), typeAxesOf(declaredSig)))
      throw declaredTypeError(symbol, literal, declared);
  }

  // Rule 4 — ground annotations cover the domain (CONTRAVARIANT). A ground
  // implementation annotation sitting at a QUANTIFIED parameter position must
  // accept every instantiation the declaration admits, i.e.
  // `declaredBound <: annotation`. An unbounded variable is bounded by `any`,
  // so in practice only a wide `unknown`/`any` annotation passes — don't
  // annotate a quantified position. Ground annotations at GROUND positions
  // reconcile exactly as they do under a ground declaration.
  const args = declaredSig.args ?? [];
  const typeParams = declaredSig.typeParams;
  if (typeParams !== undefined && typeParams.length > 0) {
    // `substituteDeclaredBounds` leaves an UNBOUNDED variable alone; the
    // kind-level reading of one is `any`, so supply that bound explicitly.
    const bounded = typeParams.map((p) =>
      p.bound === undefined ? { ...p, bound: 'any' as Type } : p
    );
    const params = functionLiteralParameters(literal);
    for (let i = 0; i < params.length && i < args.length; i++) {
      const annotation = params[i].type;
      if (annotation === undefined) continue;
      const pattern = args[i].type;
      if (!mentionsQuantifiedVariable(pattern, declaredSig)) continue;
      if (!isSubtype(substituteDeclaredBounds(bounded, pattern), annotation))
        throw declaredTypeError(symbol, literal, declared);
    }
  }

  return true;
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
/**
 * The COLLECTION type inference gave a bare (unannotated) parameter, or
 * `undefined` to leave its arrow slot `unknown` as before.
 *
 * A parameter operand denotes the one binding the literal's body Block
 * declares for it (`bindParameterOperands`), so its `.type` is whatever the
 * body's uses inferred — `At(v, 1)` narrows `v` to `indexed_collection |
 * dictionary` through `At`'s signature. Surfacing that on the arrow is what
 * makes `paramsAreScalar` false, so a list argument is APPLIED to the lambda
 * instead of being broadcast element-wise over it (`h([3,4])` → `7`, not
 * `[h(3), h(4)]`).
 *
 * Deliberately narrow: the inferred type must EXCLUDE every scalar, so only a
 * parameter that cannot be a scalar is lifted. A parameter inferred `number`
 * (the overwhelmingly common case, `x ↦ 2x`) keeps an `unknown` slot so the
 * `broadcastable<T>` lift still fires; so does a function-typed one (a
 * higher-order callback slot), and — the trap — so does an INDEX parameter:
 * `At`'s index slot is `boolean | indexed_collection | number | string`
 * (a gather index may itself be a collection), so `(t) ↦ L[t] + 1` must keep
 * `t` unlifted even though one arm of that union is a collection.
 */
export function inferredCollectionParameterType(
  param: Expression | undefined
): Type | undefined {
  if (param === undefined || !isSymbol(param)) return undefined;
  const t = param.type.type;
  if (t === 'unknown' || t === 'any' || t === 'value' || t === 'nothing')
    return undefined;
  if (!excludesEveryScalar(t) || isSubtype(t, 'function')) return undefined;
  return t;
}

/** True when NO value of `t` is a scalar — every arm of a union has to be
 * collection-like. (`isScalarType` of a union is the dual "every arm is a
 * scalar", which is not the question here.) */
function excludesEveryScalar(t: Type): boolean {
  if (typeof t === 'object' && t.kind === 'union')
    return t.types.every((m) => excludesEveryScalar(m));
  return !isScalarType(t);
}

export function functionLiteralSignatureType(expr: Expression): Type {
  const ce = expr.engine;
  const body = functionLiteralBody(expr)!;
  const params = functionLiteralParameters(expr);

  // Result type: an explicit return-type ascription (the §4.2 marker) is
  // used verbatim, bypassing the widening rule. A Block's type is its last
  // statement's type, so `body.type` already surfaces the ascribed return.
  const ascribedReturn = functionLiteralReturnType(expr);
  // A FULL-SIGNATURE marker (`docs/EFFECTS-MODEL.md`, "Epsil surface") is the
  // trap here: `Typed`'s type handler surfaces the ascribed type verbatim, and
  // a Block's type is its last statement's, so `body.type` IS that whole
  // signature — meaningless as a body type. The last statement's OWN type
  // lives on the marker's first operand.
  const declaredSignature = functionLiteralDeclaredSignature(expr);
  const bodyTypeSource =
    declaredSignature === undefined
      ? body.type
      : functionLiteralReturnMarker(expr)!.op1.type;
  let bodyType: Type =
    declaredSignature !== undefined && ascribedReturn !== undefined
      ? ascribedReturn
      : bodyTypeSource.type;
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
    bodyTypeSource.matches('finite_number') &&
    !params.every(
      (p) => p.type !== undefined && isSubtype(p.type, 'finite_number')
    )
  )
    bodyType = 'number';

  // Parameter slots: an annotated param carries its declared type, named
  // (`x: integer`); a bare param stays `unknown` as today. The Type OBJECT is
  // carried through — never serialized and re-parsed: an annotation may name
  // a SCOPE-LOCAL type (resolved when the literal was canonicalized), and a
  // text round-trip here — possibly after that scope popped — either threw
  // `Unknown type` or silently dropped the annotation. Same hazard class as
  // the inferred-signature fix in `boxed-operator-definition.ts`.
  const paramOps = isFunction(expr, 'Function') ? expr.ops.slice(1) : [];
  const args =
    params.length > 0
      ? params.map((p, i) => {
          if (p.type !== undefined) return { name: p.name, type: p.type };
          const inferred = inferredCollectionParameterType(paramOps[i]);
          if (inferred !== undefined) return { name: p.name, type: inferred };
          return { type: 'unknown' as Type };
        })
      : undefined;

  // The effect specifier slot. An INFERRED empty set is written as an empty
  // slot, i.e. nothing at all — the author's `pure` spelling is a statement,
  // and inference states nothing (`inferFunctionLiteralEffects` collapses a
  // `[]` accumulated from an applied stated-pure callback).
  //
  // A full-signature marker STATES the arrow's effects, so they join the
  // inferred set: the union preserves a stated `[]` (`[] ∪ undefined = []`,
  // spelled ` pure`) and, where the contract holds (`inferred ⊆ declared`),
  // equals the declared set. Where it is violated the union is a sound
  // over-approximation and the violation surfaces at install time, through the
  // definition-annotation check.
  const declaredEffects = functionLiteralDeclaredEffects(expr);
  const inferredEffects = inferFunctionLiteralEffects(ce, expr).effects;
  const effects =
    declaredEffects === undefined
      ? inferredEffects
      : unionEffectSets(declaredEffects, inferredEffects);

  // A GENERIC marker (a `where` clause) is the literal's contract of record on
  // every TYPE axis: the clause, the argument types and the result are carried
  // VERBATIM. Under erasure the quantified parameter operands are bare symbols,
  // so the `args` assembled above would read `unknown` and the result would be
  // the body's ground type — both would silently drop the clause. Only the
  // EFFECTS axis is recomputed (`declared ∪ inferred`, above): the literal's own
  // arrow must stay a sound over-approximation even where the declared contract
  // is violated (`docs/EFFECTS-MODEL.md`). A closed polytype is a legal
  // `isPolymorphic` `BoxedType`.
  if (declaredSignature !== undefined && isGenericSignature(declaredSignature))
    return {
      ...declaredSignature,
      ...(effects !== undefined ? { effects } : {}),
    };

  return {
    kind: 'signature',
    ...(args !== undefined ? { args } : {}),
    ...(effects !== undefined ? { effects } : {}),
    result: bodyType,
  };
}

/** True when a full-signature marker carries a non-empty `where` clause. */
function isGenericSignature(t: FunctionSignature): boolean {
  return (t.typeParams?.length ?? 0) > 0;
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
  escapingWrite: boolean;
  /** True when the walk read an effect set that is lazily DERIVED from the
   * conformance registry — a protocol dispatcher's union over the registered
   * conforming implementations of a bare requirement, or a callee whose own
   * stamp is itself derived. A definition stamped by such a walk must
   * RE-DERIVE rather than freeze: the next conformance can widen the union
   * under it (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is
   * an effect"). */
  consultsRegistry: boolean;
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
 * - **Parameters are confined at entry.** A write to the literal's own
 *   parameter is call-local — the binding lives in the call frame and dies
 *   with the application; the caller's variable never changes (verified
 *   empirically: `f(x) := (x := x + 1; x)` returns 6 for `f(5)` and leaves
 *   the caller's `a := 5` untouched). Parameters therefore seed the
 *   dominance frontier. The closure-capture exclusion still applies: a
 *   parameter referenced by a nested literal is NOT confined, the same
 *   conservative rule as any captured binding.
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
    escapingWrite: false,
    consultsRegistry: false,
  };
  walkLiteral(ce, literal, state, options?.selfName, 0, new Set());
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
  depth: number,
  /** Names of the VALUE bindings whose stored literal this walk is currently
   * inside — the cycle stack of {@link Walker.applyNamed}'s stored-literal
   * expansion. A head already on it is a recursive call back into a literal
   * being walked, which is neutral for the same reason a self-call is: the
   * rest of that body is what classifies it. Without the stack, a
   * self-recursive value binding (`R := (i) ↦ … R(i-1) …`) would expand into
   * itself until the depth guard collapsed it to `any`, reporting a pure
   * recursive body impure. */
  expanding: Set<string>
): void {
  if (depth > MAX_LITERAL_DEPTH) {
    state.effects = 'any';
    return;
  }

  // A parameter shadows any same-named operator for the whole body, so
  // `f(Random) := Random` must not be read as a draw.
  const params = new Map<string, EffectSet | undefined | null>();
  // The parameters' DECLARED types, kept separately from their arrow effects
  // above so that a write through a parameter can be classified by what the
  // parameter is declared to be. A store into a mutable object's own field
  // (`x.id = …` where `x: M` and `M` is an `object<…>` layout declaring `id`)
  // is a heap mutation and must carry `state`; the declaration is the only
  // place that says so, since canonicalizing the receiver inside a literal
  // reports a parameter's type as `unknown`. Unannotated parameters get no
  // entry, which keeps them on the conservative `scope` path.
  const paramTypes = new Map<string, Type>();
  for (const p of functionLiteralParameters(literal)) {
    // `null` marks an UNANNOTATED parameter: optimistically pure, no
    // contribution. An annotated one contributes its declared arrow effects.
    params.set(p.name, p.type === undefined ? null : signatureEffects(p.type));
    if (p.type !== undefined) paramTypes.set(p.name, p.type);
  }

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
    paramTypes,
    captured,
    localLiterals,
    selfName,
    depth,
    expanding
  );
  // Parameters seed the confinement frontier: a parameter is bound on every
  // static path at entry, and a write to it is call-local (see "Parameters
  // are confined at entry" above). Captured parameters are still excluded by
  // the `captured` check in `scopeWrite`.
  walker.sequence([body], { declared: new Set(params.keys()) });
}

/** All symbol names occurring inside any nested `Function` literal of `expr`. */
function collectNestedLiteralSymbols(expr: Expression, out: Set<string>): void {
  if (isSymbol(expr)) return;
  if (!isFunction(expr)) return;
  if (expr.operator === 'Function') {
    collectSymbolsMasked(expr, new Set(), out);
    return;
  }
  for (const op of expr.ops) collectNestedLiteralSymbols(op, out);
}

/**
 * Collect symbol spellings, masking each `Function` literal's OWN parameter
 * names within its subtree: `(x) ↦ x` nested in a body whose enclosing
 * function also has an `x` parameter SHADOWS that parameter rather than
 * capturing it, and recording the spelling as captured wrongly un-confines
 * the enclosing body's writes to its own `x`. Deeper literals extend the
 * mask with their own parameters, subtree by subtree. Operator names are
 * still collected — harmless over-approximation for the membership checks
 * the `captured` set feeds.
 */
function collectSymbolsMasked(
  expr: Expression,
  mask: ReadonlySet<string>,
  out: Set<string>
): void {
  const name = sym(expr);
  if (name !== undefined) {
    if (!mask.has(name)) out.add(name);
    return;
  }
  if (!isFunction(expr)) return;
  out.add(expr.operator);
  if (expr.operator === 'Function') {
    const extended = new Set(mask);
    for (const p of functionLiteralParameters(expr)) extended.add(p.name);
    for (const op of expr.ops) collectSymbolsMasked(op, extended, out);
    return;
  }
  for (const op of expr.ops) collectSymbolsMasked(op, mask, out);
}

class Walker {
  constructor(
    private ce: ComputeEngine,
    private state: WalkState,
    private params: Map<string, EffectSet | undefined | null>,
    /** The declared type of each ANNOTATED parameter; see the field-store
     * classification in {@link Walker.isFieldStore}. */
    private paramTypes: Map<string, Type>,
    private captured: Set<string>,
    private localLiterals: Map<string, Expression>,
    private selfName: string | undefined,
    private depth: number,
    /** See the parameter of the same name on {@link walkLiteral}. */
    private expanding: Set<string>
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
      if (isFunction(op, 'Declare') || isFunction(op, 'DefineFunction')) {
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
            this.depth + 1,
            this.expanding
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
      // `Assign(Field(base, "name"), v)` spells two different operations. When
      // `base` is a parameter declared to be a mutable object whose layout has
      // a `"name"` field, it is a HEAP STORE: it overwrites a field of the
      // record the caller handed in, so the mutation is observable to the
      // caller and the function is not pure ("Changing a field is an effect",
      // `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B). It gets no confinement
      // exemption — the confinement analysis proves that a write cannot
      // outlive the call, which is never true of a store into someone else's
      // record ("Confinement does not apply to `state`",
      // `docs/EFFECTS-MODEL.md`). Everything else — including the property
      // REBINDING sugar `p.name = v` on a value type, which rebinds the local
      // `p` rather than mutating a heap cell — stays on the `scope` path,
      // where `assignTargets` judges the write on the base symbol.
      if (this.isFieldStore(expr))
        this.state.effects = unionEffectSets(this.state.effects, ['state']);
      else this.scopeWrite(expr, ctx, /* confinable */ true);
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
      this.state.escapingWrite = true;
      for (const op of expr.ops) this.visit(op, ctx);
      return;
    }

    if (head === 'DefineFunction') {
      // A NESTED `DefineFunction` (Epsil's one-step inner definition,
      // `helper(x) = x + a` inside a body, lowers here) is BLOCK-LOCAL, so
      // it never contributes `scope` — categorically, exactly like the
      // `Declare` above. The definition binds in the block or call frame it
      // is written in and dies with it: after `function outer(n) { sq(m) =
      // m * m; sq(n) }` is defined and called, `sq` is still unresolved at
      // top level, and a same-named outer function is SHADOWED for the
      // duration of the frame rather than overwritten. The one-step and
      // two-step (`let sq; sq(m) = m * m`) forms are the same write.
      //
      // Not judged by a definition-visibility lookup: the verdict would flip
      // when the provisional-dependents cascade re-walks the body after a
      // runtime install has made a name visible. The generic operator path
      // is wrong too — it would union `DefineFunction`'s own declared
      // `{scope}`, which describes the TOP-LEVEL defining form.
      //
      // The literal operand is deliberately not visited: its body's effects
      // are latent until the helper is applied, and an application inside
      // this same body projects them through the `localLiterals` entry
      // `Walker.sequence` records for the statement.
      return;
    }

    this.applyNamed(head);
    this.projectOperands(head, expr.ops, 0);

    // DISCHARGE, mirroring the runtime channel (`effectsOf`, which applies
    // `subtractEffects(own, discharge)` at a held position of a `lazy`
    // definition). Without this the static walk stamps a literal's arrow with
    // labels the operator provably absorbs, so `(i) ↦ WithRandomSeed(42,
    // Random())` came out `random` — and every operator that reads a lambda's
    // LATENT set rather than the body directly inherited that: `Map` reported
    // impure for a body `Comprehension` reported pure.
    const def = operatorDefinitionOf(this.ce, head);
    const discharges = def?.lazy ? def.discharges : undefined;
    if (discharges === undefined) {
      for (const op of expr.ops) this.visit(op, ctx);
      return;
    }
    for (let i = 0; i < expr.ops.length; i++) {
      const op = expr.ops[i];
      // …and mirroring it on the ESCAPE carve-out too (Tycho item 142, ruled
      // 2026-08-02): a `random` discharge does not apply to a body that
      // provably escapes the frame as a lazy drawing view, because those draws
      // happen at materialization, outside the frame
      // (`docs/RANDOMNESS-MODEL.md` §6). Reading the shared
      // `effectiveDischarge` is what keeps the two channels in lockstep — the
      // item-132 disagreement was exactly this rule differing between them.
      const discharge = effectiveDischarge(discharges[i], op);
      if (discharge === undefined || discharge.length === 0) {
        this.visit(op, ctx);
        continue;
      }
      this.visitDischarged(op, ctx, discharge);
    }
  }

  /**
   * Walk a held operand whose position DISCHARGES some labels, and merge back
   * only what survives the discharge.
   *
   * The accumulator is shared and mutable, so "what did this subtree add" is
   * not otherwise recoverable: swap in a fresh state for the sub-walk, subtract
   * there, then union. Only the EFFECT SET is filtered — `draws` /
   * `readsRandomFrame` are the randomness bookkeeping the pending-draw walk and
   * `RANDOMNESS-MODEL.md` key on (a seeded frame still draws, it just draws
   * reproducibly), and `unresolvedHead` is a resolution fact, not an effect.
   */
  private visitDischarged(
    op: Expression,
    ctx: WalkContext,
    discharge: readonly EffectLabel[]
  ): void {
    const outer = this.state;
    const inner: WalkState = {
      effects: undefined,
      readsRandomFrame: false,
      draws: false,
      unresolvedHead: false,
      escapingWrite: false,
      consultsRegistry: false,
    };
    this.state = inner;
    try {
      this.visit(op, ctx);
    } finally {
      this.state = outer;
    }
    const kept = subtractEffects(inner.effects, discharge);
    // `subtractEffects` works on the runtime `ComputedEffects` lattice, whose
    // co-finite form has no spelling in the inference walk's plain
    // `EffectSet`. A held body is never `'any'` here (the walk only ever
    // accumulates finite sets), so this is a narrowing, not a loss.
    if (kept !== undefined && kept !== 'any' && !isCoFiniteEffects(kept))
      outer.effects = unionEffectSets(outer.effects, kept);
    outer.readsRandomFrame ||= inner.readsRandomFrame;
    outer.draws ||= inner.draws;
    outer.unresolvedHead ||= inner.unresolvedHead;
    // A proven mutation survives a discharge of OTHER labels; a position that
    // discharges `scope` itself (none does today) would contain the write.
    outer.escapingWrite ||= inner.escapingWrite && !discharge.includes('scope');
    // Registry-dependence is a provenance fact about WHERE the sub-walk read
    // its numbers, not an effect: a discharge removes labels, never the need
    // to re-derive.
    outer.consultsRegistry ||= inner.consultsRegistry;
  }

  /**
   * PROJECTION of a callback passed as an OPERAND of an applied head.
   *
   * Worked example 1, the headline case: "the literal `(xs) ↦ Map(f, xs)` has
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
   * gates the latent half of a contribution: a non-invoking position only
   * STORES or SELECTS the value, so `(g) ↦ List(g)` and `List(x ↦ Random())`
   * stay pure. The operator-level `invokesNone` is a cheap pre-gate; the
   * per-position `invokesAt` is what the loop consults, so an operator that
   * invokes at some positions and stores at others is handled exactly. An
   * unresolved head keeps the conservative default (`invokes: true`) — and has
   * already contributed `{any}` through {@link applyNamed}.
   *
   * (The `acceptsCallable` gate below stays position-INSENSITIVE by design —
   * see its own note: it answers "could an operand of this operator be a
   * callback at all", which is a different question from "does THIS position
   * invoke".)
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
    if (def !== undefined && def.invokesNone) return;

    for (let i = start; i < ops.length; i++) {
      if (def !== undefined && !def.invokesAt(i)) continue;
      const op = ops[i];

      // An inline literal in an invoking position: project its latent set.
      if (isFunction(op, 'Function')) {
        walkLiteral(
          this.ce,
          op,
          this.state,
          this.selfName,
          this.depth + 1,
          this.expanding
        );
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
      if (declared !== null) this.noteContributorEffects(declared);
      return;
    }

    // A local symbol bound to a literal earlier in the body: project the
    // literal's latent effects.
    const local = this.localLiterals.get(name);
    if (local !== undefined) {
      walkLiteral(
        this.ce,
        local,
        this.state,
        this.selfName,
        this.depth + 1,
        this.expanding
      );
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
      // A binding whose declared arrow STATES an effect set (including the
      // stated-pure empty one) is a trusted contract: union it and stop. When
      // the arrow is UNSTATED — which is what the `ce.declare(g, '(…) -> …')`
      // then `ce.assign(g, literal)` idiom leaves behind — the contract says
      // nothing about what `g` does, and the only account of it is the
      // `Function` literal the binding currently holds. Walking that literal
      // into this state propagates its effects, its `draws` /
      // `readsRandomFrame` bits and — the reason this branch exists — its
      // `consultsRegistry` bit, so a caller that reaches a protocol dispatcher
      // through a value-bound hop re-derives when a later conformance widens
      // the derived union, instead of freezing the (empty) set it first saw.
      // This mirrors the runtime channel's `valueBindingEffects`
      // (`effects-of.ts`), which likewise trusts a stated declared arrow and
      // otherwise consults the stored value; the two channels must not
      // disagree about the same head. (`docs/TYPE_SYSTEM_ROADMAP.md`,
      // Appendix B, "Changing a field is an effect".)
      //
      // A head already on the expansion stack is a recursive call back into a
      // literal this walk is inside; it is neutral, exactly as a self-call is,
      // and falls through to contribute nothing.
      if (t === undefined && !this.expanding.has(name)) {
        const stored = storedFunctionLiteral(this.ce, name);
        if (stored !== undefined) {
          this.expanding.add(name);
          try {
            walkLiteral(
              this.ce,
              stored,
              this.state,
              this.selfName,
              this.depth + 1,
              this.expanding
            );
          } finally {
            this.expanding.delete(name);
          }
          return;
        }
      }
      this.noteContributorEffects(t);
      return;
    }

    // The callee's effect set may be LAZILY DERIVED rather than fixed — a
    // protocol dispatcher unions the inferred effects of the conformers
    // registered right now, and a later conformance can widen it. Reading
    // `def.effects` below goes through the refreshing accessor, so the number
    // this walk uses is current; recording that the walk depended on it is
    // what lets the definition being stamped re-derive instead of freezing
    // (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is an
    // effect").
    if (def._deriveEffects !== undefined) this.state.consultsRegistry = true;

    if (def.readsRandomFrame === true) this.state.readsRandomFrame = true;
    // Read from the callee's DERIVED getter, so an explicit `random`, a
    // frame-protocol head, and a callee whose own inference saw a draw all
    // propagate — the same composition rule as the effect union. This is the
    // pending-draw obligation ("a surviving nested `WithRandomSeed` owes the
    // outer frame"), and it rides the `draws` BIT.
    if (def.drawsRandom === true) this.state.draws = true;
    // …and it rides ONLY that bit: "the runtime frame-protocol role is a
    // separate field, NOT THE ARROW" (`docs/EFFECTS-MODEL.md`, "Randomness
    // shapes"). Contributing `{random}` to the enclosing literal's arrow here
    // put the frame-protocol role on the arrow, which stamped
    // `(i) ↦ WithRandomSeed(42, Random())` as `random` while the runtime
    // channel called the same expression PURE — and every operator that reads
    // a lambda's LATENT set inherited the disagreement (`Map` impure where
    // `Comprehension`, which sees the body directly, was pure). The body's own
    // draw is removed by the position's DISCHARGE in `visit`, mirroring
    // `effectsOf`; nothing needs to be added in its place.
    this.noteContributorEffects(def.effects);
  }

  /**
   * Whether this `Assign` is a store into a mutable object's own layout field
   * — `Assign(Field(base, "name"), v)` where `base` is a bare symbol naming a
   * parameter whose DECLARED type resolves to an `object<…>` layout that
   * declares `"name"`.
   *
   * The declared type is the only usable evidence here: inside a `Function`
   * literal the body is not yet in a frame that binds the parameters, so
   * canonicalizing the receiver and reading its type reports `unknown` and
   * decides nothing. Everything the declaration does not positively establish
   * — a receiver that is not a bare symbol, a parameter with no annotation, a
   * type that is not an object layout, a field the layout does not declare —
   * answers `false` and takes the conservative `scope` path, which is also
   * what the property rebinding sugar on a value type needs.
   */
  private isFieldStore(expr: Expression & FunctionInterface): boolean {
    const target = expr.ops[0];
    if (!isFunction(target, 'Field')) return false;
    const base = sym(target.ops[0]);
    if (base === undefined) return false;
    const declared = this.paramTypes.get(base);
    if (declared === undefined) return false;
    const field = target.ops[1];
    if (!isString(field)) return false;
    return objectLayoutOfType(declared)?.elements[field.string] !== undefined;
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
    // NOTE (2026-08-15): an "implicit local declaration" exemption — treating
    // an `Assign` to a name with no visible outer binding as confined, since
    // evaluation creates a call-local binding — was tried here and REVERTED.
    // It is unsound for a literal that is walked standalone: a closure
    // writing a variable of its ENCLOSING literal (`makeCounter`'s
    // `count := count + 1`) sees the same "no visible binding" as a genuine
    // fresh temp, because the enclosing literal's lexical locals are not in
    // the definition registry — and the closure's arrow then claimed PURE
    // while every call returned a different value. Not provably confined ⇒
    // `scope` stays the rule; a fresh-temp body opts out with a `Declare`
    // (`let`) or a `scope` annotation.
    const confined =
      confinable &&
      targets.length > 0 &&
      targets.every(
        (name) =>
          name !== undefined &&
          ctx.declared.has(name) &&
          !this.captured.has(name)
      );
    if (!confined) {
      this.state.effects = unionEffectSets(this.state.effects, ['scope']);
      this.state.escapingWrite = true;
    }
  }

  /**
   * Union a RESOLVED contributor's effect set into the walk, marking the
   * proven-mutation bit when the set concretely contains `scope`. The `any`
   * set deliberately does NOT mark it: `any` is conservatism (an unresolved
   * or collapsed account), and the default-`!scope` ceiling must never fire
   * on conservatism — only on a positively established world mutation.
   */
  private noteContributorEffects(set: EffectSet | undefined): void {
    this.state.effects = unionEffectSets(this.state.effects, set);
    if (Array.isArray(set) && set.includes('scope'))
      this.state.escapingWrite = true;
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
 * Only a position DECLARED callable (a `callback<S>` slot, the bare `function`
 * primitive, an explicit arrow parameter) says "this operand is a callback".
 *
 * A `callback<S>` counts, per Design D §4 clause 1: the constructor is the
 * primitive `function` for every admission and subtyping question, and this is
 * one of them.
 */
function isCallableType(t: Type): boolean {
  if (typeof t === 'string') return t === 'function';
  if (isCallbackType(t)) return true;
  if (t.kind === 'signature') return true;
  if (t.kind === 'union' || t.kind === 'intersection')
    return (t.types as Type[]).some(isCallableType);
  return false;
}

/**
 * Whether `def` takes a callback in ANY parameter position — see
 * {@link isCallableType}; any arm of an overload set suffices.
 *
 * Deliberately position-INSENSITIVE, as a simplification rather than out of
 * necessity: no operand-order mismatch forces it, and a per-position variant —
 * testing the declared parameter an operand's index resolves to — is perfectly
 * feasible if a case ever calls for it. The question this gate answers is only "could an
 * operand of this operator be a callback at all" — enough to keep the
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
  // A `Field`-target write — `Assign(Field(p, "name"), v)`, the property
  // rebinding sugar `p.name = v` — is judged on its BASE symbol: the
  // property SET on a tuple-backed nominal type returns a new value that
  // REBINDS the base (the setter contract `set name(self, v) -> Person`;
  // the evaluate route's `property.kind === 'rebind'` ends in
  // `ce.assign(base, newValue)`), so mutating `q.name` on a `let q` is
  // exactly as confined as `q := …` itself. ONLY `Field` gets this:
  // `Assign(Subscript(L, i), v)` is a SEQUENCE DEFINITION (`L_0 := 1`
  // registers a base case in the engine-wide pending-sequence state — see
  // the Subscript branch of `Assign`'s evaluate in `library/core.ts`),
  // never a local rebind, and an `At` target has no assignment semantics
  // at all today — both stay on the unresolvable-target fallback below.
  // A mutable-object STORE reuses the `Assign(Field(…))` spelling with heap
  // semantics, and it does not reach this branch: `Walker.isFieldStore`
  // recognizes it from the receiver's declared parameter type and contributes
  // `state` without consulting the confinement frontier at all, because heap
  // stores get no confinement exemption (`docs/EFFECTS-MODEL.md`,
  // "Confinement does not apply to `state`"). Any OTHER caller of
  // `assignTargets` on a `Field` target inherits the rebinding reading above,
  // so a new one must make the same distinction.
  if (isFunction(target, 'Field')) {
    const base = sym(target.ops[0]);
    if (base !== undefined) return [base];
  }
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

/**
 * The `Function` literal a value binding currently HOLDS, when it holds one —
 * the body behind the `ce.declare(name, { type: '(…) -> …' })` +
 * `ce.assign(name, literal)` idiom, whose declared arrow states no effects.
 *
 * Reading the binding's value is gated on the declared type possibly denoting
 * something callable ({@link bindingCouldHoldFunction}): the value slot is a
 * lazy getter that materializes a dynamic value on first read, and an ordinary
 * `x: number` binding must never be materialized by an effect walk.
 */
function storedFunctionLiteral(
  ce: ComputeEngine,
  name: string
): Expression | undefined {
  const def = ce.lookupDefinition(name);
  if (def === undefined || !('value' in def)) return undefined;
  if (!bindingCouldHoldFunction(def.value.type?.type as Type | undefined))
    return undefined;
  const value = def.value.value;
  if (value === undefined || !isFunction(value, 'Function')) return undefined;
  return value;
}

/**
 * Whether a value binding's DECLARED type leaves room for the binding to hold a
 * function — the gate on reading the (lazy) value slot in
 * {@link storedFunctionLiteral}.
 *
 * Deliberately GENEROUS, and deliberately different from {@link isCallableType}
 * next door: an absent, `unknown` or `any` declared type counts, because a
 * binding assigned a literal before any type was declared reads that way. It
 * mirrors `couldBeCallable` in `effects-of.ts`, which gates the runtime
 * channel's read of the very same slot — the two gates decide which bindings
 * are worth consulting, and must not disagree. Being generous here only ever
 * costs a value read that answers "not a literal"; being narrow would silently
 * drop a stored literal's effects.
 */
function bindingCouldHoldFunction(t: Type | undefined): boolean {
  if (t === undefined) return true;
  if (typeof t === 'string')
    return t === 'unknown' || t === 'any' || t === 'function' || t === 'symbol';
  return (
    t.kind === 'signature' ||
    t.kind === 'callback' ||
    t.kind === 'intersection' ||
    t.kind === 'union' ||
    t.kind === 'reference'
  );
}
