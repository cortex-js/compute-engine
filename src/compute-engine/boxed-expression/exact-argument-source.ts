import type { Expression } from '../global-types.js';

/**
 * The written argument behind the activation of a user function's
 * parameter, for the exact re-read of a jump.
 *
 * `.N()` promises a correct result, and a function whose result jumps at a
 * point (`Floor`, `Round`, `Sign`, a comparison) reads the exact value of
 * an exact operand when the float of the operand is near the jump
 * (`exactRealValueOf`, `constraint-subject.ts`): the float of
 * `(25! − 1)/24!` is 25, and its floor is 24. Inside a user function the
 * operand is a parameter, bound to the approximation the caller computed,
 * and the exact value is that of the ARGUMENT the caller wrote. So the
 * application records that argument on the activation (`invoke` in
 * `function-utils.ts`, from `ApplyOptions.exactSources`), and the re-read
 * evaluates it, exactly, only when a jump needs it. The argument is
 * recorded only when it is pure and resolves the same from inside the
 * function (`exactArgumentSources`), so the re-read repeats no effect and
 * reads no parameter of the caller by name.
 *
 * A `WeakMap` keyed on the value half of the activation's definition, so
 * a discarded activation takes its entry with it. This module imports
 * nothing but a type, so every module that binds or reads can import it.
 */
const EXACT_ARGUMENT_SOURCES = new WeakMap<object, Expression>();

/** Record `source` as the written argument behind the activation `value`. */
export function setExactArgumentSource(
  value: object,
  source: Expression
): void {
  EXACT_ARGUMENT_SOURCES.set(value, source);
}

/** The written argument behind the activation `value`, or `undefined`. */
export function exactArgumentSourceOf(
  value: object | undefined
): Expression | undefined {
  return value === undefined ? undefined : EXACT_ARGUMENT_SOURCES.get(value);
}
