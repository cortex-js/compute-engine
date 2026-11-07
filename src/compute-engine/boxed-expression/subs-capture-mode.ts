import type {
  CanonicalOptions,
  Expression,
  Substitution,
} from '../global-types.js';

/**
 * What `subs()` (`BoxedFunction.subs()`, `boxed-function.ts`) does at a
 * binder that would capture a free name of a replacement:
 *
 * - `'rename'` (the default): the binder renames each such bound name to a
 *   fresh name first. When a correct rename cannot be decided before the
 *   node runs (`renameCapturingBinder()`, `function-utils.ts`), the
 *   replacement is inserted as it is, and the binder captures the name;
 * - `'decline'`: as `'rename'`, but when the rename cannot be decided the
 *   substitution throws `SUBS_CAPTURE`, and `subsIfCaptureFree()` gives
 *   `undefined`;
 * - `'insert'`: the binder is never renamed, and the replacement is inserted
 *   as it is. A rule replacement and a rule condition are instantiated in
 *   this mode (`subsWithCapture()`, called by `rules.ts` and by the
 *   Fungrim rules and guards of `fungrim/loader.ts`): a rule rewrites
 *   structure, so a bound name that the replacement of a rule writes binds
 *   the names of the values of the wildcards, as the rule says.
 *
 * `subsIfCaptureFree()` and `subsWithCapture()` set the mode for the
 * duration of one call, and the substitution walk of that call reads it. The
 * canonical rebuild of a function node at the end of its substitution runs
 * in the default mode (`inDefaultSubsCaptureMode()`): a `subs()` call that
 * a canonical handler makes there with its own substitution is not a part of
 * the caller's request, so it renames, and a capture there does not make the
 * caller decline. The other canonical boxing steps of the walk (the boxing
 * of a replacement, the value of `D` or `Series` at a point, the rebuild
 * of an integrand) run in the mode of the caller.
 */
export type SubsCaptureMode = 'rename' | 'decline' | 'insert';

let mode: SubsCaptureMode = 'rename';

/** The current mode of `subs()` at a capturing binder (see
 * `SubsCaptureMode`). */
export function subsCaptureMode(): SubsCaptureMode {
  return mode;
}

/** The value of `fn()`, computed in the default `'rename'` mode. `subs()`
 * (`boxed-function.ts`) boxes a rebuilt node with it. */
export function inDefaultSubsCaptureMode<T>(fn: () => T): T {
  if (mode === 'rename') return fn();
  const saved = mode;
  mode = 'rename';
  try {
    return fn();
  } finally {
    mode = saved;
  }
}

/** Thrown by `subs()` in the `'decline'` mode, and caught only by
 * `subsIfCaptureFree()`. Not an `Error`: it is control flow. */
export const SUBS_CAPTURE = { subsCapture: true };

/**
 * `expr.subs(sub, options)`, or `undefined` when a binder of `expr` would
 * capture a free name of a replacement and cannot be renamed before `expr`
 * runs (`renameCapturingBinder()`, `function-utils.ts`): the target of an
 * `Assign` of a held `Block`, or a local that only a `Declare` in a branch
 * of an `If` declares. An internal caller that must not give a captured
 * result uses this function, and declines on `undefined`.
 */
export function subsIfCaptureFree(
  expr: Expression,
  sub: Substitution,
  options?: { canonical?: CanonicalOptions }
): Expression | undefined {
  const saved = mode;
  mode = 'decline';
  try {
    return expr.subs(sub, options);
  } catch (e) {
    if (e === SUBS_CAPTURE) return undefined;
    throw e;
  } finally {
    mode = saved;
  }
}

/**
 * `expr.subs(sub, options)` with no rename of a binder: a replacement that
 * contains a name that a binder of `expr` binds is inserted as it is, and
 * the binder captures the name. Used to instantiate the replacement and the
 * condition of a rule (`rules.ts`, and the Fungrim rules and guards of
 * `fungrim/loader.ts`), which rewrite structure.
 */
export function subsWithCapture(
  expr: Expression,
  sub: Substitution,
  options?: { canonical?: CanonicalOptions }
): Expression {
  const saved = mode;
  mode = 'insert';
  try {
    return expr.subs(sub, options);
  } finally {
    mode = saved;
  }
}
