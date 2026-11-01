/**
 * The identifiers that the JavaScript targets (`javascript` and
 * `interval-javascript`) must not emit as the name of a binding: a function
 * parameter, a block local, a loop index or an integration variable. The
 * targets add them to `CompileTarget.reservedEmittedNames`, and a binding with
 * one of these names is emitted under a fresh name: `lambdaParamBinding()` in
 * `compile-definitions.ts` for a function parameter, `spellReservedLocals()`
 * in `compile-locals.ts` for a local, `reservedNameSpelling()` in
 * `compile-loops.ts` for a loop index or an integration variable.
 *
 * Three groups:
 * - The reserved words of JavaScript, and the words that strict-mode code
 *   reserves (`let`, `static`, `yield`, ...). A module is always strict, so
 *   `(let) => 2 * let` is a syntax error in a module. `await` is reserved in
 *   a module and in an `async` function.
 * - `eval` and `arguments`. Strict-mode code refuses them as the name of a
 *   binding: `(arguments) => 2 * arguments` is a syntax error ("Unexpected
 *   eval or arguments in strict mode").
 * - The global names that the emitted code reads (`Math.sin`, `undefined`,
 *   `Number.isSafeInteger`, ...). A binding with one of these names hides
 *   the global for the code in its scope: a parameter named `Math` made the
 *   lowering `Math.sin(x)` throw "Math.sin is not a function".
 *
 * A free symbol does not need this list: the emitted code reads it as a
 * property of the vars object (`_.arguments`), and a reserved word is a
 * valid property name.
 */
export const JAVASCRIPT_RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set([
  // Reserved words
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  // Reserved in strict-mode code
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  // Reserved in a module and in an `async` function
  'await',
  // Not allowed as the name of a binding in strict-mode code
  'eval',
  'arguments',
  // Global names that the emitted code reads
  'undefined',
  'NaN',
  'Infinity',
  'globalThis',
  'Math',
  'Number',
  'BigInt',
  'Boolean',
  'String',
  'Symbol',
  'Object',
  'Array',
  'Map',
  'Set',
  'JSON',
  'Intl',
  'Date',
  'Error',
  'TypeError',
  'RangeError',
  'ArrayBuffer',
  'Float64Array',
  'Int32Array',
  'Uint8Array',
  'BigInt64Array',
  'isFinite',
  'isNaN',
  'parseFloat',
  'console',
]);
