/**
 * How many cached computations (`cachedValue`) and type-handler calls are
 * running, and what to do when the last one ends.
 *
 * Some state changes must advance a cache axis, but must not do it while a
 * cached answer is being computed: each computation on the stack would see
 * its own inputs change under it, and the nested reads would compute again
 * and again. A value-type inference (a use of a symbol narrows its type) is
 * such a change: it happens while the type of the using expression is
 * computed. `runWhenIdle` delays such an advance until no computation is
 * running, and runs it at once when none is. The outermost entry is then
 * stored under a generation that is already past, so it is computed once
 * more at its next read, which is correct: part of it was computed before
 * the change.
 */
let _computing = 0;
const _whenIdle: (() => void)[] = [];

/** Run `fn` now if no cached computation is running, else when the last one
 * ends. See `_computing`. */
export function runWhenIdle(fn: () => void): void {
  if (_computing === 0) fn();
  else _whenIdle.push(fn);
}

/** Count `fn` as a running computation for `runWhenIdle`. */
export function asComputation<T>(fn: () => T): T {
  _computing += 1;
  try {
    return fn();
  } finally {
    _computing -= 1;
    if (_computing === 0 && _whenIdle.length > 0) {
      // Each callback runs even when an earlier one throws: a callback lost
      // here would leave its engine waiting for an advance that never
      // comes. The first error is thrown after all have run.
      const pending = _whenIdle.splice(0);
      let error: unknown = undefined;
      let failed = false;
      for (const f of pending) {
        try {
          f();
        } catch (e) {
          if (!failed) error = e;
          failed = true;
        }
      }
      if (failed) throw error;
    }
  }
}
