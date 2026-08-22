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
  TaggedOperatorDefinition,
  TaggedValueDefinition,
} from '../global-types';

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
