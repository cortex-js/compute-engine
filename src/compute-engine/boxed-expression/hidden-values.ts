/**
 * The value definitions whose value is hidden for the extent of a call (the
 * value shield, `withValueShield()` in `utils.ts`). A read of the value of
 * a hidden definition finds no value; its type is not changed, and nothing
 * is written on the definition, so a shield can run inside a type
 * derivation. The innermost call is on top. A definition belongs to one
 * engine, so one stack serves every engine.
 */
const hidden: ReadonlyArray<object>[] = [];

/** True when the value of the definition `def` is hidden. */
export function valueIsHidden(def: object): boolean {
  if (hidden.length === 0) return false;
  for (let i = hidden.length - 1; i >= 0; i--)
    if (hidden[i].includes(def)) return true;
  return false;
}

/** The record of the innermost call of `withHiddenValues()`, `undefined`
 * outside one: a result that a value read made is kept with it. */
export function hiddenValuesKey(): object | undefined {
  return hidden.length === 0 ? undefined : hidden[hidden.length - 1];
}

/** Run `fn` with the values of the definitions `defs` hidden. */
export function withHiddenValues<T>(
  defs: ReadonlyArray<object>,
  fn: () => T
): T {
  hidden.push(defs);
  try {
    return fn();
  } finally {
    hidden.pop();
  }
}
