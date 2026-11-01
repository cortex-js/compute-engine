/**
 * The compile targets that offer the `'bigint'` compile mode. Only the
 * built-in JavaScript target offers it: its emitters are the only ones that
 * can compute integers as JavaScript `bigint` values.
 *
 * The guarantee: a target offers `'bigint'` only when its `operators`,
 * `functions`, `constant` and `number` emitters and its `supportedModes`
 * array are the same objects that the built-in JavaScript target put on a
 * target it created and registered here. The JavaScript target registers a
 * target that it creates with its own emitters only: a target made by
 * `createTarget()` with none of these fields given in the options, and the
 * target of its own `compile()` when the caller gives no `operators` and no
 * `functions` option. A copy of a registered target made with object spread
 * keeps the same objects, so it offers `'bigint'` when it replaces none of
 * these fields; it does not offer the mode when it replaces one of them. The
 * other fields of a target are not compared. A custom target cannot register
 * itself, because this module is not exported from the package.
 *
 * The record is keyed by the `operators` function, which the JavaScript
 * target creates again for each target, and which a spread copy keeps.
 *
 * This module imports nothing, so the option validator
 * (`engine-extension-contracts.ts`) and the compiler (`compile-lanes.ts`)
 * can both import it without an import cycle.
 */

/** The fields of a target that the registry compares. */
type BigintModeEmitters = {
  supportedModes?: readonly string[];
  operators?: unknown;
  functions?: unknown;
  constant?: unknown;
  number?: unknown;
};

const BUILT_IN_BIGINT_TARGETS = new WeakMap<object, BigintModeEmitters>();

/**
 * Registers `target`, made by the built-in JavaScript target with its own
 * emitters, as a target that offers `'bigint'`.
 */
export function registerBuiltInBigintTarget(target: BigintModeEmitters): void {
  if (typeof target.operators !== 'function') return;
  BUILT_IN_BIGINT_TARGETS.set(target.operators, {
    supportedModes: target.supportedModes,
    operators: target.operators,
    functions: target.functions,
    constant: target.constant,
    number: target.number,
  });
}

/**
 * Whether `target` offers `'bigint'`: its `supportedModes` lists the mode,
 * and its `supportedModes`, `operators`, `functions`, `constant` and
 * `number` are the objects of a registered built-in target
 * (`registerBuiltInBigintTarget`).
 */
export function offersBigintMode(target: BigintModeEmitters): boolean {
  if (typeof target.operators !== 'function') return false;
  const builtIn = BUILT_IN_BIGINT_TARGETS.get(target.operators);
  return (
    builtIn !== undefined &&
    target.supportedModes !== undefined &&
    target.supportedModes.includes('bigint') &&
    target.supportedModes === builtIn.supportedModes &&
    target.functions === builtIn.functions &&
    target.constant === builtIn.constant &&
    target.number === builtIn.number
  );
}
