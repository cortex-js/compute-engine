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
 * each standard library. The registry depends on no engine layer, so the bootstrap and compiler
 * can share it without a dependency cycle.
 */
const ENGINE_COMPILE_HANDLERS = new WeakSet<object>();

/** Record `handler` as a `compile` handler of a standard library. */
export function recordEngineCompileHandler(handler: unknown): void {
  if (typeof handler === 'function') ENGINE_COMPILE_HANDLERS.add(handler);
}

export { assertValidCompileHelpers } from '../../common/compile-helpers.js';

/** Whether `handler` is a `compile` handler of a standard library. */
export function isEngineCompileHandler(handler: unknown): boolean {
  return typeof handler === 'function' && ENGINE_COMPILE_HANDLERS.has(handler);
}
