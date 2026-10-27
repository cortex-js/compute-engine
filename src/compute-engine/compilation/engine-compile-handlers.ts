/**
 * The `compile` handlers that the standard libraries install on their
 * operator definitions. The code such a handler writes is the engine's own,
 * and it calls only the helpers of the compiled-code runtime, so it can run
 * on a worker of the kernel pool.
 *
 * Any other handler is caller code, even when the caller attaches it in place
 * to a built-in definition (`ce.lookupDefinition('At').operator.compile = …`).
 * Its output is not shippable unless its definition declares
 * `compileShippable: true` (see `OperatorDefinition.compileShippable`). The
 * definition that holds a handler does not tell the two apart, because an
 * in-place attachment changes the built-in definition itself. The function
 * does: the standard library tables are module data, so a handler of the
 * engine is the same function object in every engine.
 *
 * Filled by `loadLibraryDefinitions()` (`engine-library-bootstrap.ts`) for
 * each standard library. This module imports nothing, so that both the
 * bootstrap and the compiler can read it without a dependency cycle.
 */
const ENGINE_COMPILE_HANDLERS = new WeakSet<object>();

/** Record `handler` as a `compile` handler of a standard library. */
export function recordEngineCompileHandler(handler: unknown): void {
  if (typeof handler === 'function') ENGINE_COMPILE_HANDLERS.add(handler);
}

/**
 * Throw when `value` is not a map from a name to a function whose source the
 * engine can copy into compiled code, as `const <name> = (<source>);` (see
 * `OperatorDefinition.compileHelpers`). `owner` begins each message (for
 * example `Operator Definition "Wrap"`) and `key` names the field. Called
 * when a definition is declared, and again when the helpers are added to a
 * compilation, because a field assigned in place on a definition is not
 * checked at declaration.
 */
export function assertValidCompileHelpers(
  owner: string,
  value: unknown,
  key = 'compileHelpers'
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(
      `${owner}: the "${key}" key must be an object that maps a name to a function`
    );
  for (const [helper, fn] of Object.entries(value)) {
    const where = `${owner}: the helper "${helper}" of "${key}"`;
    // A reserved word (`class`, `new`) has the form of an identifier, and
    // only the declaration test finds it. A name of a global (`Math`,
    // `Array`, `NaN`) would hide that global from the compiled code, which
    // calls several of them.
    let validName = /^[A-Za-z$][\w$]*$/.test(helper) && !(helper in globalThis);
    if (validName) {
      try {
        new Function(`"use strict"; const ${helper} = 0;`);
      } catch {
        validName = false;
      }
    }
    if (!validName)
      throw new Error(
        `${where} has an invalid name: use a JavaScript identifier that does not start with "_" and is not the name of a global`
      );
    if (typeof fn !== 'function')
      throw new Error(`${where} is not a function`);
    // The engine copies the source of the helper into the compiled code, so
    // the source must be a function expression on its own. A built-in or a
    // bound function has no source (`function f() { [native code] }`), and a
    // method written in the shorthand form (`{ f(x) { … } }.f`) has a source
    // that is not an expression.
    const source = fn.toString();
    let valid = !/\{\s*\[native code\]\s*\}\s*$/.test(source);
    if (valid) {
      try {
        new Function(`return (${source});`);
      } catch {
        valid = false;
      }
    }
    if (!valid)
      throw new Error(
        `${where} has no source that the engine can copy into the compiled code: give an arrow function or a function expression, not a built-in, a bound function or a method`
      );
  }
}

/** Whether `handler` is a `compile` handler of a standard library. */
export function isEngineCompileHandler(handler: unknown): boolean {
  return (
    typeof handler === 'function' && ENGINE_COMPILE_HANDLERS.has(handler)
  );
}
