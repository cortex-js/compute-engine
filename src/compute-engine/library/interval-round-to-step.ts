/**
 * The `interval-js` code of a rounding function with a step. It is shared by
 * the operator table of the `interval-js` target
 * (`compilation/interval-javascript-target.ts`) and by the compiled form of
 * the value kind `enclosure` (`enclosure-compile.ts`), which must emit the
 * same kernel for the same form. It is in `library/` because `library/`
 * must not import from `compilation/`.
 */

import type { Expression } from '../global-types.js';
import { asRational } from '../boxed-expression/numerics.js';

/**
 * The interval code of `Floor`, `Ceil`, `Truncate` or `Round` (`round` is
 * the `_IA` function, and `extra` its further arguments: the tie rule of
 * `Round`), with or without a step. The step form `Floor(x, step)` is
 * `round(x / k) · k` with `k = |step|`: the division and the product are
 * the outward-rounded interval operations, so an enclosure that the
 * division widens across a jump answers `singular`, as the one-argument
 * form does. The step is spliced twice, so an impure step (a draw from the
 * `Random` family) fails closed.
 */
export function intervalRoundToStep(
  round: 'floor' | 'ceil' | 'trunc' | 'round',
  args: ReadonlyArray<Expression | null>,
  compile: (expr: Expression) => string,
  extra = ''
): string {
  const [x, step] = args;
  if (x === null || x === undefined)
    throw new Error(`Could not compile \`${round}\`: no argument`);
  if (step === null || step === undefined)
    return `_IA.${round}(${compile(x)}${extra})`;
  if (step.isPure === false)
    throw new Error(
      `Could not compile \`${round}\`: the interval target requires a pure step`
    );
  // An exact step `1/m` or `m`, with `m` a safe integer (`10^-2` is
  // `1/100`), scales through the exact point `m`: `1/100` has no double, and
  // dividing by an enclosure of it would widen a tie (`Round(0.125, 1/100)`)
  // across its jump, while `0.125·100` is the exact point `12.5`.
  const r = asRational(step);
  if (r !== undefined) {
    const [p, q] = [Math.abs(Number(r[0])), Number(r[1])];
    if (p === 1 && Number.isSafeInteger(q) && q > 0)
      return `_IA.div(_IA.${round}(_IA.mul(${compile(x)}, _IA.point(${q}))${extra}), _IA.point(${q}))`;
    if (q === 1 && Number.isSafeInteger(p) && p > 0)
      return `_IA.mul(_IA.${round}(_IA.div(${compile(x)}, _IA.point(${p}))${extra}), _IA.point(${p}))`;
  }
  const k = `_IA.abs(${compile(step)})`;
  return `_IA.mul(_IA.${round}(_IA.div(${compile(x)}, ${k})${extra}), ${k})`;
}
