/**
 * The two tag guards over a `BoxedDefinition` — is it a VALUE binding, is it
 * an OPERATOR binding. A leaf module on purpose: they are needed by modules
 * that `utils.ts` (transitively, through `boxed-operator-definition.ts` and
 * `function-utils.ts`) depends on, and keeping them here is what lets
 * `collection-element-memo.ts` — which `function-utils.ts` imports for the
 * pure-application memo — use them without closing a cycle through
 * `utils.ts`. `utils.ts` re-exports both, so every existing import site is
 * unchanged.
 */
import type {
  BoxedDefinition,
  BoxedOperatorDefinition,
  TaggedOperatorDefinition,
  TaggedValueDefinition,
} from '../global-types';
import { DEFAULT_COMPLEXITY } from './constants.js';

export function isValueDef(
  def: BoxedDefinition | undefined
): def is TaggedValueDefinition {
  return def !== undefined && 'value' in def;
}

export function isOperatorDef(
  def: BoxedDefinition | undefined
): def is TaggedOperatorDefinition {
  return def !== undefined && 'operator' in def;
}

/** An inferred, unassigned binding is a guess that external facts may replace.
 * Explicit declarations, including an unknown local binding, shadow the
 * external environment. */
export function isInferredDefinition(
  def: BoxedDefinition | undefined
): boolean {
  return (
    isValueDef(def) &&
    def.value.inferredType &&
    def.value.storedValue === undefined
  );
}

/**
 * True when an operator definition can be replaced by a second declaration of
 * its name: its signature is inferred, and it holds nothing that an author
 * gave. This is the case of a host that declared a name with only
 * `{ signature, inferredSignature: true }` to mark it as an operator before it
 * gives a definition.
 *
 * An inferred signature alone is not sufficient. An operator that the author
 * declared without a `signature` also has an inferred signature, and so does a
 * function literal given to `ce.assign()`. So the definition must also have no
 * handler (each function-valued field of an operator definition), and each
 * flag and each documentation field must have its default value: for example,
 * `ce.declare('f', { lazy: true })` is a definition, not a shell, and a second
 * `ce.declare('f', …)` must not replace it.
 *
 * A flag has a default value, so a declaration that gives exactly the default
 * (`{ lazy: false }`, the default complexity) cannot be told from one that
 * gives none. Such a declaration is replaceable.
 */
export function isReplaceableOperatorShell(
  def: BoxedOperatorDefinition
): boolean {
  return (
    def.inferredSignature &&
    def.complexity === DEFAULT_COMPLEXITY &&
    def.type === undefined &&
    def.sgn === undefined &&
    // The definition class stores the `even` handler of the declaration,
    // but the `BoxedOperatorDefinition` interface does not list it.
    (def as { even?: unknown }).even === undefined &&
    def.canonical === undefined &&
    def.evaluate === undefined &&
    def.evaluateAsync === undefined &&
    def.evalDimension === undefined &&
    def.derivative === undefined &&
    def.compile === undefined &&
    def.eq === undefined &&
    def.neq === undefined &&
    def.collection === undefined &&
    def.canEnumerate === undefined &&
    def.elementCount === undefined &&
    def.inferOperandTypes === undefined &&
    def.definedWhen === undefined &&
    def.requires === undefined &&
    def.commutativeOrder === undefined &&
    isDefaultOperatorFlags(def)
  );
}

/**
 * True when each flag and each documentation field of an operator definition
 * has the value that `_BoxedOperatorDefinition` gives it when the declaration
 * does not state it.
 */
function isDefaultOperatorFlags(def: BoxedOperatorDefinition): boolean {
  // Some fields that the definition class stores are not listed by the
  // `BoxedOperatorDefinition` interface.
  const d = def as BoxedOperatorDefinition & {
    keywords?: unknown;
    examples?: unknown;
    url?: unknown;
    broadcastExemptions?: ReadonlyArray<unknown>;
    missingStrip?: unknown;
    frameProtocol?: unknown;
    invokes?: unknown;
    discharges?: unknown;
    holdClass?: unknown;
    readsRandomFrame?: unknown;
    inspectsErrors?: unknown;
    selectsOperands?: unknown;
    evaluatesOperands?: unknown;
    namedArgumentsRequired?: unknown;
    commutativeMatch?: unknown;
  };
  return (
    // Documentation fields
    d.description === undefined &&
    d.keywords === undefined &&
    d.examples === undefined &&
    d.url === undefined &&
    d.wikidata === undefined &&
    // Evaluation and binding flags
    !d.lazy &&
    !d.scoped &&
    d.bindingSites === undefined &&
    !d.inspectsErrors &&
    !d.selectsOperands &&
    !d.evaluatesOperands &&
    !d.namedArgumentsRequired &&
    // Broadcast and threading flags
    !d.broadcastable &&
    (d.broadcastExemptions === undefined ||
      d.broadcastExemptions.length === 0) &&
    d.threadsConditionals === false &&
    // Error-model flags
    d.missingBehavior === undefined &&
    (d.missingStrip === undefined || d.missingStrip === 'all') &&
    d.nanBehavior === undefined &&
    d.partiality === undefined &&
    // Algebraic flags. `commutativeMatch` defaults to `commutative`, so it is
    // false when neither flag is set.
    !d.associative &&
    !d.commutative &&
    !d.commutativeMatch &&
    !d.idempotent &&
    !d.involution &&
    // Effect flags. `pure: false` sets the effect set to `'any'` without
    // setting `effectsDeclared`, so the effect set is also checked.
    !d.effectsDeclared &&
    d.effects === undefined &&
    d.frameProtocol === undefined &&
    (d.invokes === undefined || d.invokes === true) &&
    d.discharges === undefined &&
    (d.holdClass === undefined || d.holdClass === 'evaluate') &&
    !d.readsRandomFrame
  );
}
