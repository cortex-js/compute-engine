import type { Expression } from '../global-types.js';
import type { CompilationOptions, CompileTarget } from './types.js';

/**
 * The check that `compile()` runs before it compiles with a target object
 * that the caller passes as the `target` option (the raw route), for a
 * target object made by a language target whose emitter relies on a typing
 * pass.
 *
 * The GLSL target types an expression with its fragment pass before the
 * emitter runs, and its lowerings do not check the operand shapes again:
 * `Arctan2(v, x)` with `v` a `vec3` and `x` a scalar is refused by the pass,
 * and the lowering alone writes `atan(v, x)`, which no shader compiler
 * accepts. The raw route does not go through the `compile()` of the language
 * target, so the target object made by `createTarget()` carries the pass,
 * and the raw route runs it first. The check throws a `CompileDeclineError`
 * when the pass refuses the expression, and lets every other error (a
 * cancellation, an invalid option) propagate.
 *
 * The check is an own property with a symbol key, not a field of the
 * public type `CompileTarget`. An object spread or `Object.assign()` copy of
 * the target object copies it with the lowerings that rely on it. A target
 * object that the caller builds has none.
 */
const RAW_TARGET_CHECK = Symbol('rawTargetCheck');

/** The check of the raw route: throws when the expression is refused. */
export type RawTargetCheck = (
  expr: Expression,
  options: CompilationOptions<Expression>
) => void;

/** Record the check of the raw route on the target object `target`. */
export function setRawTargetCheck(
  target: CompileTarget<Expression>,
  check: RawTargetCheck
): void {
  (target as { [RAW_TARGET_CHECK]?: RawTargetCheck })[RAW_TARGET_CHECK] =
    check;
}

/** The check of the raw route for `target`, or `undefined` when it has none. */
export function rawTargetCheck(
  target: CompileTarget<Expression>
): RawTargetCheck | undefined {
  return (target as { [RAW_TARGET_CHECK]?: RawTargetCheck })[
    RAW_TARGET_CHECK
  ];
}
