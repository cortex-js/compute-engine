import type { EffectLabel, Type } from '../../common/type/types.js';
import type { ComputedEffects } from '../../common/type/effects.js';
import {
  isCoFiniteEffects,
  sameEffectSet,
  subtractEffects,
  unionComputedEffects,
} from '../../common/type/effects.js';
import { functionResult, signatureArms } from '../../common/type/utils.js';
import { couldBeCollectionOperand } from '../collection-utils.js';
import { overloadArms, resolveOverload } from './overload.js';

import type {
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isFunction, sym } from './type-guards.js';
import { signatureEffects } from './effects-inference.js';

/**
 * # The runtime effect channel (`docs/EFFECTS-MODEL.md`, "Runtime counterpart")
 *
 * ONE expression-level computation implementing the projection rule
 *
 * ```
 * effects(op(a₁ … aₙ)) = ownEffects(op) ∪ ⋃ᵢ contribution(aᵢ)
 * ```
 *
 * where the **contribution** of an operand separates *producing* it from
 * *invoking/evaluating* it:
 *
 * - **eager, non-function**: its own effects (recurse);
 * - **eager, function-valued** (an inline literal, a symbol bound to a
 *   function — resolved through its CURRENT binding — or an opaque declared
 *   function): `effectsOf(aᵢ) ∪ (latent(aᵢ) − discharge(op, i))`. Production
 *   effects are never discharged: the draw behind `Use(MakeCallback())` fires
 *   when the operand is evaluated, whatever `Use` then does with the result.
 *   The latent half is gated by the `invokes` metadata: an `invokes: false`
 *   position only STORES the value, so `List(randomF)` is pure to build;
 * - **held, may-evaluate** (the default for `lazy` positions — a `Sum` body,
 *   the `WithRandomSeed` body): `effectsOf(aᵢ) − discharge(op, i)`;
 * - **held, quote/store** (`holdClass: 'quote'` — `Hold`): ∅. The effects
 *   resurface at forcing (`holdClass: 'release'` — `ReleaseHold`), which is
 *   itself an application: the projection strips one quote layer and recurses
 *   into the content there, resolving a symbol-bound held value through its
 *   binding like any callback.
 *
 * Two consumers are views of this channel: `isPure` (no impurity label — see
 * `boxed-function.ts`), and the pending-draw walk of `library/core.ts`, which
 * additionally keys on the two runtime frame fields.
 *
 * The computation is **write-free**: definitions are resolved by name (the
 * `isImpureHead` pattern of `library/map-broadcast-shape.ts`), nothing is bound
 * or canonicalized. Results are memoized on `BoxedFunction` behind a
 * `ce._generation` guard, which is what keeps "resolve through the current
 * binding" honest: reassigning a symbol bumps the generation and invalidates
 * the cached answer.
 */

/**
 * The effects of evaluating `expr` — the projection rule above.
 *
 * `undefined` is the empty set (pure); `'any'` is the top (unknown effects); a
 * `{ not: […] }` value is the internal co-finite form produced by discharging
 * from `'any'`.
 */
export function effectsOf(expr: Expression): ComputedEffects {
  // Only an application has effects: a number, a string, a dictionary — and a
  // SYMBOL — merely produce a value. Reading a symbol is not an effect ("Reads
  // of non-local scope are not an effect"), and a symbol bound to an effectful
  // function contributes at the application that invokes it, through the latent
  // half of the rule below.
  if (!isFunction(expr)) return undefined;
  // The memo lives on `BoxedFunction` (generation-guarded, like `type` and
  // `sgn`); a raw/unbound function expression may not have it.
  return expr._effectsOf?.() ?? applicationEffects(expr);
}

/**
 * The **public boundary** of the runtime effect channel: the value behind
 * `expr.effects`.
 *
 * Two internal distinctions are deliberately erased here, because neither is
 * something a consumer can act on:
 *
 * - a **co-finite** value ¬N — "provably lacks the labels in `N`, but carries
 *   unknown others" — maps to `'any'`. It is an internal computed form, never
 *   surface syntax and never serialized, and the honest public summary of it
 *   is "unknown effects": every consumer question a public caller can ask
 *   ("may I cache this?", "is this pure?") gets the same answer from `'any'`
 *   as from ¬N. (The one consumer that *does* profit from the precision — the
 *   seed-frame gate — reads the internal channel directly, and does so
 *   through `hasDeclaredEffectLabel`, for which ¬N and `'any'` already agree.)
 * - the **stated-pure `[]`** maps to `undefined`. This getter reports
 *   BEHAVIOR, not provenance: `[]` and `undefined` are the same set, and only
 *   a signature's serialization distinguishes them. Provenance lives on the
 *   type — `expr.type.effects`.
 */
export function publicEffects(
  effects: ComputedEffects
): ReadonlyArray<EffectLabel> | 'any' | undefined {
  if (effects === undefined) return undefined;
  if (effects === 'any') return 'any';
  if (isCoFiniteEffects(effects)) return 'any';
  return effects.length === 0 ? undefined : effects;
}

/** Nesting limit for quote-forcing positions — see the cycle note in
 * {@link applicationEffects}. Far above any real `ReleaseHold` nesting. */
const MAX_RELEASE_DEPTH = 16;

let releaseDepth = 0;

/**
 * The projection rule for one application. Public for the memo in
 * `boxed-function.ts`; every other consumer calls {@link effectsOf}.
 */
export function applicationEffects(expr: Expression): ComputedEffects {
  if (!isFunction(expr)) return undefined;

  // ── Literals are inference boundaries ───────────────────────────────────
  // Building a `Function` literal is pure: its effects live on its OWN arrow
  // (its latent set, stamped by the construction seam in
  // `effects-inference.ts`) and are contributed by whatever APPLIES it. Same
  // rule as the static walk, which also stops at `Function`.
  if (expr.operator === 'Function') return undefined;

  const def = operatorDefinitionOf(expr);
  if (def === undefined) {
    // No OPERATOR definition — but the head may still be bound to a function
    // VALUE: `ce.declare('fib', { type: '(number) -> number' })` followed by
    // `ce.assign('fib', body)` leaves a value definition, and the documented
    // declare-then-assign idiom would otherwise report `{any}` forever, even
    // for a provably pure body. Resolve through the CURRENT binding, exactly as
    // an operand position does, and project the operands with the DEFAULT
    // metadata a plain function value has (eager, invoking, discharging
    // nothing).
    const own = valueHeadEffects(expr);
    // A head that resolves to nothing callable stays `{any}`: conservative on
    // every axis EXCEPT frames, where `any` never pins (see the `any` ruling
    // under "Labels and lattice"). `hasDeclaredEffectLabel` is what enforces
    // that asymmetry for the walk.
    if (own === NOT_CALLABLE) return 'any';
    let effects: ComputedEffects = own;
    for (const op of expr.ops) {
      if (effects === 'any') return 'any';
      effects = unionComputedEffects(effects, effectsOf(op));
      effects = unionComputedEffects(effects, latentEffectsOf(op));
    }
    return effects;
  }

  // `ownEffects(op)`: the definition's effect set — the RESOLVED ARM's when the
  // definition is an overload set. For the writer operators (`Assign`,
  // `Declare`, `Assume`) that is `{scope}`, contributed UNCONDITIONALLY —
  // confinement analysis is inference-only, and the runtime channel stays a
  // sound over-approximation ("Scope writes", v5 finding 3).
  let effects: ComputedEffects = ownEffects(expr.engine, expr.ops, def);

  // A quote/store position is never evaluated by the operator, so nothing
  // beneath it contributes: `effectsOf(Hold(Random()))` is ∅.
  if (def.holdClass === 'quote') return effects;

  // A forcing position evaluates the content of a quote: strip one quote layer
  // and recurse into it — this is where the effects `Hold` deferred resurface.
  if (def.holdClass === 'release') {
    // Following a BINDING is the one step of this walk that can cycle
    // (`h := Hold(ReleaseHold(h))`). Structural recursion into operands cannot.
    // Fail conservative — unknown effects — rather than overflow the stack.
    if (releaseDepth >= MAX_RELEASE_DEPTH) return 'any';
    releaseDepth += 1;
    try {
      for (const op of expr.ops)
        effects = unionComputedEffects(effects, effectsOf(releasedContent(op)));
    } finally {
      releaseDepth -= 1;
    }
    return effects;
  }

  const ops = expr.ops;
  for (let i = 0; i < ops.length; i++) {
    // `'any'` absorbs under union and a later position can only add, so the
    // answer cannot change once the top is reached.
    if (effects === 'any') return 'any';

    const op = ops[i];
    const discharge = def.discharges?.[i];

    // The operand's OWN effects. Eager: producing the operand is never
    // dischargeable — the draw behind `Use(MakeCallback())` fires when the
    // operand is evaluated, whatever `Use` does with the result. Held
    // (may-evaluate): the evaluation happens UNDER the operator, so the
    // operator may discharge it.
    const own = effectsOf(op);
    effects = unionComputedEffects(
      effects,
      def.lazy ? subtractEffects(own, discharge) : own
    );

    // The LATENT half: what fires if the operator invokes a function-valued
    // operand. Held-ness is orthogonal — `Map` is `lazy` yet invokes its
    // callback per element — so this applies to both classes, and is always
    // subject to the position's discharge.
    if (!def.invokes) continue;
    effects = unionComputedEffects(
      effects,
      subtractEffects(latentEffectsOf(op), discharge)
    );
  }

  return effects;
}

/**
 * The **latent-only** half of the projection for one application:
 * `ownEffects(op)` plus the latent effects of the function-valued operands this
 * operator may invoke — WITHOUT recursing into the operands' own effects.
 *
 * This is what the pending-draw walk (`library/core.ts`) keys on: that walk has
 * its own recursion, with the exception structure of `RANDOMNESS-MODEL.md` §2
 * and §6 (a lazy view in value position draws at materialization and is NOT a
 * pending draw), so it must ask each node what THAT node does, not what its
 * whole subtree does.
 */
export function shallowApplicationEffects(expr: Expression): ComputedEffects {
  if (!isFunction(expr)) return undefined;
  if (expr.operator === 'Function') return undefined;
  const def = operatorDefinitionOf(expr);
  if (def === undefined) {
    // A function-VALUE head (the declare-then-assign idiom): its arrow is what
    // this node does — so a value-def head bound to a drawing function pins the
    // seed frame, exactly as the operator-definition route does.
    const own = valueHeadEffects(expr);
    if (own === NOT_CALLABLE) return 'any';
    let effects: ComputedEffects = own;
    for (const op of expr.ops) {
      if (effects === 'any') return 'any';
      effects = unionComputedEffects(effects, latentEffectsOf(op));
    }
    return effects;
  }

  let effects: ComputedEffects = ownEffects(expr.engine, expr.ops, def);
  if (def.holdClass === 'quote' || !def.invokes) return effects;

  const ops = expr.ops;
  for (let i = 0; i < ops.length; i++) {
    if (effects === 'any') return 'any';
    effects = unionComputedEffects(
      effects,
      subtractEffects(latentEffectsOf(ops[i]), def.discharges?.[i])
    );
  }
  return effects;
}

/**
 * `ownEffects(op)` for one application (`docs/EFFECTS-MODEL.md`, "Overloads").
 *
 * For a plain signature this is just the definition's effect set. For an
 * **overload set** the per-application effects are the **resolved arm's**: the
 * same write-free resolver used for typing is invoked here, with the same
 * admission policies, and the selection is RECOMPUTED — never stored (nothing
 * on `BoxedFunction` remembers an arm). When resolution does not succeed the
 * answer falls back to the definition-wide union, which is what the derived
 * getters report for a consumer with no application in hand.
 *
 * The arm is used only when the definition's effect set IS the union over the
 * arms — i.e. it came from the arrows. A definition whose effects were stated
 * some other way (the `effects:` field, or the legacy `pure: false` sugar
 * translating to `{any}`) has a set the arms do not carry, and an arm's empty
 * specifier must not be allowed to erase it.
 */
function ownEffects(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  def: BoxedOperatorDefinition
): ComputedEffects {
  const arms = overloadArms(def.signature.type);
  if (arms === undefined) return def.effects;
  if (!sameEffectSet(signatureEffects(def.signature.type), def.effects))
    return def.effects;
  const { selected } = resolveOverload(ce, ops, arms, {
    lazy: def.lazy,
    threadable: def.broadcastable,
    couldBeCollection: couldBeCollectionOperand,
    stripMissing: (i) => def.stripsMissingAt(i),
  });
  return selected === undefined ? def.effects : selected.effects;
}

/**
 * The content a FORCING position will evaluate: the operand with one quote
 * layer stripped. A symbol resolves through its CURRENT binding — a symbol
 * whose value is a `Hold` is the shape `ReleaseHold(h)` is written for.
 * Anything else is returned unchanged: `ReleaseHold` of a non-quote operand
 * evaluates that operand.
 */
function releasedContent(op: Expression): Expression {
  const name = sym(op);
  if (name !== undefined) {
    const def = op.engine.lookupDefinition(name);
    const value = def !== undefined && 'value' in def ? def.value.value : undefined;
    if (value !== undefined && isQuote(value)) return value.ops[0] ?? op;
    return op;
  }
  if (isQuote(op)) return op.ops[0] ?? op;
  return op;
}

/** True when `expr` is an application of a quoting operator (`Hold`) —
 * derived from the definition flag, never from the operator name. */
function isQuote(expr: Expression): expr is Expression & { ops: Expression[] } {
  return isFunction(expr) && operatorDefinitionOf(expr)?.holdClass === 'quote';
}

/** The head, or operand, resolves to nothing callable — the caller decides what
 * that means: `{any}` in head position (an unknown operator), and no latent
 * contribution at all in operand position (a bare value is not invoked). */
const NOT_CALLABLE = Symbol('not-callable');

/** Callable, but its arrow is UNSTATED and no value implements it — so nothing
 * has said what it does. The two positions answer this differently, which is
 * the polarity the model already commits to:
 *
 * - **operand**: the declared bare arrow IS the bound the operator will invoke
 *   against, and an opaque declaration is trusted there (`Map(xs, opaquePure)`
 *   is pure — the residual trust class of any opaque host declaration, pinned
 *   by `effects-contracts.test.ts`). Contribution: nothing;
 * - **head**: evaluating an application of something with no implementation is
 *   not a contract at all — a bare arrow is the INFERRED track — so there is
 *   nothing to be optimistic about and the answer is `'any'`. That is the
 *   pre-value-binding answer for this sub-case, and it keeps the channel from
 *   over-claiming purity to caching consumers. (`'any'` never pins a seed
 *   frame, so no frame behavior rides on this.) */
const UNIMPLEMENTED = Symbol('unimplemented');

/**
 * The arrow effects of a name bound to a function VALUE rather than to an
 * operator — the `ce.declare(name, { type: '(…) -> …' })` +
 * `ce.assign(name, body)` idiom, and the `{ signature: … }` spelling of it.
 *
 * Both arrows are read and UNIONED, because they can disagree: the binding's
 * declared arrow is the author's contract, while the stored value's arrow is
 * what the construction seam inferred from the body it currently holds.
 * Assigning a drawing body to a pure-declared binding leaves the declared arrow
 * pure (the definition-annotation check does not run on this route), and
 * reporting that body pure would silently release a seed frame. Taking the
 * union keeps the answer honest in the only direction that matters, and keeps
 * head position and operand position in agreement.
 *
 * `NOT_CALLABLE` when the name denotes no arrow at all — an undeclared name, or
 * a binding holding a plain value. Write-free: the stored value is consulted
 * only when the declared type could be callable, so an ordinary `x: number`
 * binding is never materialized.
 */
function valueBindingEffects(
  def: BoxedValueDefinition
): ComputedEffects | typeof NOT_CALLABLE | typeof UNIMPLEMENTED {
  const declared = def.type?.type;
  const declaredCallable = hasSignatureArm(declared);

  // 1. A STATED contract is trusted — implemented or not. `signatureEffects`
  //    distinguishes the two tracks by itself: a STATED set is a set (possibly
  //    the empty one, the `pure` slot), an UNSTATED arrow reads `undefined`.
  //    This is the declared-contract half of the model's polarity — optimistic
  //    in declared contracts, conservative in runtime accounting.
  if (declaredCallable) {
    const stated = signatureEffects(declared);
    if (stated !== undefined) return stated;
  }

  // 2. An actual function VALUE: its own arrow, which the construction seam
  //    stamped from the body it currently holds. It supersedes an unstated
  //    declared arrow — assigning a drawing body to a bare-arrow binding leaves
  //    that arrow pure (the definition-annotation check does not run on this
  //    route), and reporting the body pure would silently release a seed frame.
  //    The stored value is consulted only when the declared type could be
  //    callable, so an ordinary `x: number` binding is never materialized.
  if (couldBeCallable(declared)) {
    const valueType = def.value?.type?.type;
    if (hasSignatureArm(valueType)) return signatureEffects(valueType);
  }

  // 3. Declared callable, but UNSTATED and UNIMPLEMENTED: nothing has told us
  //    what it does. Position-dependent — see {@link UNIMPLEMENTED}.
  if (declaredCallable) return UNIMPLEMENTED;

  return NOT_CALLABLE;
}

/**
 * True when `t` denotes something callable whose arrow effects
 * {@link signatureEffects} can read — kept in LOCKSTEP with that reader, which
 * is what makes the gate safe to short-circuit on:
 *
 * - a signature;
 * - a UNION with at least one signature member (`((real) random -> real) |
 *   nothing` — the shape an `At` over a list of callbacks produces). The reader
 *   unions across members and non-signature ones contribute nothing, so a
 *   mixed union is callable, not opaque;
 * - an INTERSECTION, which is the overload-set representation, only when every
 *   member is a signature (`signatureArms`' own rule) — a mixed intersection is
 *   not a callable overload set and the reader declines it too.
 */
function hasSignatureArm(t: Type | undefined): boolean {
  if (t === undefined || typeof t === 'string') return false;
  if (t.kind === 'signature') return true;
  if (t.kind === 'union') return (t.types as Type[]).some(hasSignatureArm);
  if (t.kind === 'intersection') return signatureArms(t) !== undefined;
  return false;
}

/** {@link valueBindingEffects} for the HEAD of an application whose name has no
 * operator definition. An unimplemented declaration answers `'any'` here — see
 * {@link UNIMPLEMENTED} for why the two positions differ. */
function valueHeadEffects(
  expr: Expression & { operator: string }
): ComputedEffects | typeof NOT_CALLABLE {
  const def = expr.engine.lookupDefinition(expr.operator);
  if (def === undefined || !('value' in def)) return NOT_CALLABLE;
  const effects = valueBindingEffects(def.value);
  return effects === UNIMPLEMENTED ? 'any' : effects;
}

/**
 * The **latent** effects of an operand: the effects on the arrow of the
 * function value it denotes — what fires if the operator invokes it.
 * `undefined` when the operand is not (known to be) function-valued.
 *
 * A symbol resolves through its CURRENT binding, which is the point of the
 * runtime channel: `Map(xs, f)` is `{random}` exactly while `f` is bound to a
 * drawing function. An undeclared symbol contributes nothing — the same
 * optimism the inference applies to an unannotated parameter, and the shipped
 * `isPure` behavior for a bare symbol operand.
 */
function latentEffectsOf(op: Expression): ComputedEffects {
  // An inline literal: its own arrow, stamped by the construction seam.
  if (isFunction(op, 'Function')) return signatureEffects(op.type.type);

  const name = sym(op);
  if (name !== undefined) {
    const def = op.engine.lookupDefinition(name);
    if (def === undefined) return undefined;
    if ('operator' in def) return def.operator.effects;
    // A value binding: a stored literal, or an opaque function declared with a
    // full signature (`Declare(f, "(real) random -> real")`). Nothing callable
    // contributes no latent set — a bare value operand is not invoked — and an
    // unimplemented declaration is trusted at its bare arrow here (see
    // {@link UNIMPLEMENTED}).
    const effects = valueBindingEffects(def.value);
    return effects === NOT_CALLABLE || effects === UNIMPLEMENTED
      ? undefined
      : effects;
  }

  // A number, a string, a boolean, a dictionary — nothing callable.
  if (!isFunction(op)) return undefined;

  // An application PRODUCING a callback (`Map(xs, makeCallback())`): its result
  // type carries the produced arrow. Reading `.type` may force a full type
  // computation of the operand's subtree, so gate it on the (free) declared
  // result type: an operator whose result cannot be callable never needs it.
  const def = operatorDefinitionOf(op);
  if (def === undefined) return undefined;
  if (!couldBeCallable(functionResult(def.signature.type))) return undefined;
  return signatureEffects(op.type.type);
}

/** Whether a declared result type could denote a callable value. Deliberately
 * generous — `unknown` is the result type of most user functions — and only
 * ever used to skip a type computation that could not change the answer. */
function couldBeCallable(t: Type | undefined): boolean {
  if (t === undefined) return false;
  if (typeof t === 'string')
    return t === 'unknown' || t === 'any' || t === 'function' || t === 'symbol';
  return (
    t.kind === 'signature' ||
    t.kind === 'intersection' ||
    t.kind === 'union' ||
    t.kind === 'reference'
  );
}

/**
 * The operator definition of an application — WITHOUT binding it: the bound
 * definition when there is one, else a by-name lookup (the `isImpureHead`
 * pattern). The by-name path is load-bearing, not a fallback: on the box and
 * parse routes a held operand arrives UNBOUND, so `operatorDefinition` is
 * `undefined` throughout such a subtree.
 */
export function operatorDefinitionOf(
  expr: Expression
): BoxedOperatorDefinition | undefined {
  if (!isFunction(expr)) return undefined;
  const bound = expr.operatorDefinition;
  if (bound !== undefined) return bound;
  return lookupOperatorDefinition(expr.engine, expr.operator);
}

/** The operator definition bound to `name`, or `undefined` when `name` is
 * undeclared or holds a value rather than an operator. */
function lookupOperatorDefinition(
  ce: ComputeEngine,
  name: string
): BoxedOperatorDefinition | undefined {
  const def = ce.lookupDefinition(name);
  return def && 'operator' in def ? def.operator : undefined;
}
