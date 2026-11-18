/**
 * A WRITTEN absence symbol in a compiled expression (2026-09-22).
 *
 * `Missing` is a value, not an input the caller supplies. It used to fall
 * through to the compiler's free-symbol read, so a compiled
 * `IsMissing(Missing)` was `Number.isNaN(_.Missing)` with
 * `freeSymbols: ["Missing"]` and answered `false` against the interpreter's
 * `True`.
 *
 * The lowering is the target's OBJECT-domain null (`undefined` on JavaScript).
 * It cannot be the numeric marker, because a list cell
 * holding the numeric marker is a number that equals nothing, which the
 * whole-collection equality rule of 2026-09-21 must keep distinct from an
 * ABSENT cell. On a target with no object axis — the shader targets and the
 * interval target — the numeric marker is the only spelling there is, and it
 * is what a written absence symbol lowers to.
 *
 * `Undefined` was read as an absent value too until `Missing` became a
 * result only (`docs/ERROR-MODEL.md`, user decision of 2026-11-02): it is
 * now an ordinary symbol, and `Missing` is the one absent symbol.
 *
 * Where the interpreter gives `Missing` (`Median([1, Missing, 3])`), the
 * compiled code gives `NaN` (`docs/COMPILATION-MODEL.md`, "Caveats of
 * compiled code").
 *
 * See `docs/ERROR-MODEL.md` §3.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

/** Compile for the JavaScript target and run with no caller inputs. */
function js(expr: any) {
  const r = compile(ce.box(expr), { fallback: false })!;
  return r;
}

describe('an absent list cell stays distinct from a NaN cell', () => {
  // The whole-collection equality rule of 2026-09-21: an absent cell can stand
  // for any value, so a pair of collections holding one is UNDECIDED (the
  // compiled marker is `NaN`), while a `NaN` cell is a number that equals
  // nothing and decides the comparison `false`.

  test('Equal([1, NaN], [1, NaN]) is decidedly false', () => {
    const r = js(['Equal', ['List', 1, 'NaN'], ['List', 1, 'NaN']]);
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(false);
  });
});

describe('the targets with no object absence axis', () => {

  test('GLSL still declines to DISCHARGE absence', () => {
    // `fallback` is left at its default, so the decline is REPORTED rather
    // than thrown.
    const r = compile(ce.box(['IsMissing', 'Missing']), { to: 'glsl' } as any);
    expect(r.success).toBe(false);
  });
});
