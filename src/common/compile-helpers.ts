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
    if (typeof fn !== 'function') throw new Error(`${where} is not a function`);
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
