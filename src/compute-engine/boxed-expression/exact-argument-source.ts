import type { Expression, Scope } from '../global-types.js';
import { activationValuesOf } from './ambient-chain.js';

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
 * Recorded on the call frame, for the static definition of the parameter:
 * the frame is the activation that holds the value of the parameter in the
 * call (`activationRecordOf()`, `ambient-chain.ts`), so a discarded frame
 * takes its entry with it.
 */
const EXACT_ARGUMENT_SOURCES = new WeakMap<Scope, Map<object, Expression>>();

/** Record `source` as the written argument behind the parameter `def` in
 * the call frame `frame`. */
export function setExactArgumentSource(
  frame: Scope,
  def: object,
  source: Expression
): void {
  let sources = EXACT_ARGUMENT_SOURCES.get(frame);
  if (sources === undefined)
    EXACT_ARGUMENT_SOURCES.set(frame, (sources = new Map()));
  sources.set(def, source);
}

/** The written argument behind the parameter `def` in the call frame that
 * the scope `from` is in, or `undefined`. */
export function exactArgumentSourceOf(
  def: object | undefined,
  from: Scope | null | undefined
): Expression | undefined {
  if (def === undefined) return undefined;
  for (let s = from; s != null; s = s.parent)
    if (activationValuesOf(s)?.has(def))
      return EXACT_ARGUMENT_SOURCES.get(s)?.get(def);
  return undefined;
}
