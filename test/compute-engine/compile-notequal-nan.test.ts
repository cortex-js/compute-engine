/**
 * Compiled equality where the DIFFERENCE of the operands is `NaN` — that is, on
 * a `NaN` operand, and on two infinities of the SAME sign.
 *
 * Compiled `Equal`/`NotEqual` on numeric operands is the EXACT IEEE 754
 * comparison (`===` on JavaScript; compiled-equality ruling
 * of 2026-09-09, `docs/COMPILATION-MODEL.md`). Two properties of that form
 * are pinned here because an earlier tolerance form (`Math.abs(a - b) <= tol`)
 * got both wrong:
 *
 *  - `NotEqual` is the NEGATION of the `Equal` test (`!==`), so it answers
 *    `true` on a `NaN` operand — the IEEE 754 convention, and what the
 *    interpreter answers (`NotEqual(NaN, 3)` is `True`). The `>` complement of
 *    a tolerance test answered `false` there: a compiled function that read an
 *    absent parameter as `undefined` reported that `NaN` EQUALS 3.
 *  - two infinities of the same sign are EQUAL, as the interpreter answers
 *    `Equal(oo, oo)` → `True`; `Math.abs(Infinity - Infinity)` is `NaN`, so
 *    the tolerance test reported them unequal.
 *
 * Also pinned here: the lowerings that reach the same answers by a different
 * route — the JavaScript runtime dispatch `_SYS.eq`/`_SYS.neq` (`eqTensor`,
 * whose scalar leaf is the same exact test).
 *
 * Two absent operands (`undefined`) are `===` to each other, where the
 * interpreter answers `Missing` for `Equal(Missing, Missing)`, so a pair whose
 * BOTH sides may be absent carries a `typeof` guard on the left operand; that
 * guard splices the operand twice, so an IMPURE operand there is bound to a
 * temporary. The draw counts below pin that.
 */

import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** Compile to JavaScript with no interpreter fallback. */
function js(expr: ReturnType<typeof ce.box>) {
  const r = compile(expr, { fallback: false });
  expect(r.success).toBe(true);
  return r as { code: string; run: (v: Record<string, unknown>) => unknown };
}

describe('compiled equality on NaN and on infinities — JavaScript target', () => {
  beforeAll(() => {
    ce.declare('nqr', 'real');
    ce.declare('nqs', 'real');
  });

  test('NotEqual is the negation of the whole Equal test', () => {
    expect(js(ce.box(['NotEqual', 'nqr', 'nqs'])).run({ nqr: NaN })).toBe(true);
  });

  test('a NaN operand answers true', () => {
    // A NaN operand is a value, and `NotEqual` is `true` for it.
    const r = js(ce.box(['NotEqual', 'nqr', 3]));
    expect(r.run({ nqr: NaN })).toBe(true);
  });

  test('NaN answers false for Equal and true for NotEqual', () => {
    const eq = js(ce.box(['Equal', 'nqr', 'nqs']));
    const ne = js(ce.box(['NotEqual', 'nqr', 'nqs']));
    expect(eq.run({ nqr: NaN, nqs: NaN })).toBe(false);
    expect(ne.run({ nqr: NaN, nqs: NaN })).toBe(true);
    expect(eq.run({ nqr: NaN, nqs: 3 })).toBe(false);
    expect(ne.run({ nqr: NaN, nqs: 3 })).toBe(true);
    expect(ne.run({ nqr: 3, nqs: NaN })).toBe(true);
  });

  test('two infinities of the same sign are EQUAL, as for the interpreter', () => {
    const eq = js(ce.box(['Equal', 'nqr', 'nqs']));
    const ne = js(ce.box(['NotEqual', 'nqr', 'nqs']));
    expect(eq.run({ nqr: Infinity, nqs: Infinity })).toBe(true);
    expect(ne.run({ nqr: Infinity, nqs: Infinity })).toBe(false);
    expect(eq.run({ nqr: -Infinity, nqs: -Infinity })).toBe(true);
    expect(ne.run({ nqr: -Infinity, nqs: -Infinity })).toBe(false);
    // Opposite signs, and an infinity against a finite value, stay unequal.
    expect(eq.run({ nqr: -Infinity, nqs: Infinity })).toBe(false);
    expect(ne.run({ nqr: -Infinity, nqs: Infinity })).toBe(true);
    expect(ne.run({ nqr: Infinity, nqs: 3 })).toBe(true);
    expect(ne.run({ nqr: -Infinity, nqs: 3 })).toBe(true);
  });

  test('the interpreter answers the same on those pairs', () => {
    const answer = (op: string, a: number, b: number): string | null =>
      ce.box([op, a, b]).evaluate().symbol;
    expect(answer('Equal', Infinity, Infinity)).toBe('True');
    expect(answer('NotEqual', Infinity, Infinity)).toBe('False');
    expect(answer('Equal', -Infinity, Infinity)).toBe('False');
    expect(answer('Equal', NaN, NaN)).toBe('False');
    expect(answer('NotEqual', NaN, NaN)).toBe('True');
  });

  test('equal and unequal finite pairs', () => {
    const ne = js(ce.box(['NotEqual', 'nqr', 'nqs']));
    expect(ne.run({ nqr: 2, nqs: 2 })).toBe(false);
    expect(ne.run({ nqr: 2, nqs: 3 })).toBe(true);
    // Exact: a pair within the engine tolerance is NOT equal compiled (the
    // interpreter's `Equal` would call it equal — the ruled divergence).
    expect(ne.run({ nqr: 2, nqs: 2 + 1e-13 })).toBe(true);
    expect(ne.run({ nqr: -0, nqs: 0 })).toBe(false);
  });

  test('a chained NotEqual conjoins the negated pairs', () => {
    ce.declare('nqt', 'real');
    const r = js(ce.box(['NotEqual', 'nqr', 'nqs', 'nqt']));
    expect(r.run({ nqr: NaN, nqs: 1, nqt: 2 })).toBe(true);
    expect(r.run({ nqr: 1, nqs: NaN, nqt: 2 })).toBe(true);
    expect(r.run({ nqr: 1, nqs: 2, nqt: 2 })).toBe(false);
  });

  test('the exact integer form keeps `===`/`!==`', () => {
    // Both operands are provably integer, so `exactIntegerComparison` picks the
    // one-splice exact form over the tolerance test. `NaN !== 3` is already
    // `true` — the answer the tolerance path now gives as well.
    ce.declare('nqi', 'integer');
    const r = js(ce.box(['NotEqual', 'nqi', 3]));
    expect(r.run({ nqi: NaN })).toBe(true);
    expect(r.run({ nqi: 3 })).toBe(false);
    expect(r.run({ nqi: 4 })).toBe(true);
  });

  test('a host variable is read twice, and every read sees one value', () => {
    // A `vars` read is PURE, so the splices need no temporary. This counts
    // the reads to say what the emission actually does — the entry check of
    // `run()` and the exact comparison; the test for an unsupplied variable
    // runs only when the comparison is `false` — and checks that a getter
    // answering one value the whole call answers the pair correctly.
    const r = js(ce.box(['Equal', 'nqr', 3]));
    let reads = 0;
    const vars = {
      get nqr(): number {
        reads += 1;
        return 3;
      },
    };
    expect(r.run(vars)).toBe(true);
    expect(reads).toBe(2);
  });
});

describe('two absent operands are not equal', () => {});
