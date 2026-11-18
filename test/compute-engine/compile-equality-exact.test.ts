/**
 * Compiled `Equal`/`NotEqual` on numeric operands is EXACT — the IEEE 754
 * comparison, with no tolerance branch (compiled-equality ruling of
 * 2026-09-09, `docs/COMPILATION-MODEL.md` § Fail closed).
 *
 * The interpreter compares two numbers within `engine.tolerance`, so
 * `0.1 + 0.2 = 0.3` EVALUATES to `True`; the same expression COMPILES to
 * `false`. That divergence is the ruled carve-out, pinned here on purpose:
 * the compiled lanes serve plot kernels, where a tolerance test on every
 * per-sample comparison is not acceptable.
 *
 * What the exact form keeps from the earlier tolerance form:
 *  - matching infinities are equal; `NaN` equals nothing;
 *  - `NotEqual` is the negation of `Equal`, so it answers `true` on `NaN`;
 *  - two ABSENT operands are not tested: `undefined === undefined` is
 *    `true`, where the interpreter answers `Missing` for
 *    `Equal(Missing, Missing)`, and the value of a comparison with an absent
 *    operand is not specified in compiled code;
 *  - an `Equal`/`NotEqual` whose value is the result, and which reads a
 *    variable the caller leaves out of the vars object, answers `undefined`
 *    (no value), as the interpreter does (user decision 2026-10-30). The
 *    plain test runs first, then `((reads present) ? false : undefined)`;
 *    `NotEqual` uses `&&` with `true` in place of `false`;
 *  - the piecewise NaN guard `(v === v) ? … : NaN` is NOT redundant: a
 *    `Which` whose condition compares a `NaN` answers `Missing` in the
 *    interpreter, so the compiled piecewise must answer `NaN`, not the
 *    else arm.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('a', 'real');
  ce.declare('b', 'real');
  ce.declare('c', 'real');
  return ce;
}

function js(ce: ComputeEngine, expr: unknown) {
  const r = compile(ce.box(expr as any), { to: 'javascript', fallback: false });
  if (!r.success) throw new Error(r.error?.message ?? 'declined');
  return r;
}

describe('compiled Equal/NotEqual is exact (JavaScript)', () => {
  const ce = engine();

  test('values: the ruled divergence and the IEEE cases', () => {
    const eq = js(ce, ['Equal', 'a', 'b']);
    const neq = js(ce, ['NotEqual', 'a', 'b']);
    const sum = js(ce, ['Equal', ['Add', 'a', 'b'], 0.3]);
    // The interpreter answers `True` within tolerance; compiled is exact.
    expect(ce.box(['Equal', ['Add', 0.1, 0.2], 0.3]).evaluate().symbol).toBe(
      'True'
    );
    expect(sum.run({ a: 0.1, b: 0.2 })).toBe(false);
    expect(eq.run({ a: 0.5, b: 0.5 })).toBe(true);
    expect(eq.run({ a: Infinity, b: Infinity })).toBe(true);
    expect(eq.run({ a: Infinity, b: -Infinity })).toBe(false);
    expect(eq.run({ a: NaN, b: NaN })).toBe(false);
    expect(neq.run({ a: NaN, b: 1 })).toBe(true);
    expect(eq.run({ a: -0, b: 0 })).toBe(true);
  });

  test('the chained form is the And of exact pairs', () => {
    const r = js(ce, ['Equal', 'a', 'b', 'c']);
    expect(r.run({ a: 1, b: 2, c: 2 })).toBe(false);
    expect(r.run({ a: 1, b: 1, c: 1 })).toBe(true);
  });

  test('a complex pair compares component-wise, exactly', () => {
    expect(js(ce, ['Equal', ['Complex', 1, 2], 'a']).run({ a: 1 })).toBe(false);
  });

  test('a piecewise equality takes the arm the interpreter takes', () => {
    const c = new ComputeEngine();
    c.declare('P', 'list<number^5>');
    c.declare('k', 'integer');
    const r = js(c, ['Which', ['Equal', ['At', 'P', 'k'], 5], 1, 'True', 0]);
    expect(r.run({ P: [1, 2, 3, 4, 5], k: 5 })).toBe(1);
    expect(r.run({ P: [1, 2, 3, 4, 5], k: 2 })).toBe(0);
  });

  test('the element-wise comparison of a list is exact', () => {
    const c = new ComputeEngine();
    c.declare('L', 'list<number>');
    expect(js(c, ['Equal', 'L', 3]).run({ L: [3, 3 + 1e-12, NaN, Infinity] })).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(js(c, ['NotEqual', 'L', 3]).run({ L: [3, NaN] })).toEqual([
      false,
      true,
    ]);
  });

  test('the absence guard does not skip an impure operand', () => {
    // The guard tests the LEFT operand with `typeof` and joins it with `&&`,
    // so the right operand would not be evaluated at all when the left one
    // is absent. The interpreter evaluates both operands whatever they hold,
    // so a skipped draw would move every later draw of the sequence. Binding
    // the impure operand to a temporary evaluates it before the test.
    const c = new ComputeEngine();
    c.declare('u', 'real');
    c.declare('flag', 'boolean');
    const r = js(c, ['Equal', 'u', ['If', 'flag', ['Random'], 0]]);
    let draws = 0;
    const draw = (c as any)._random.bind(c);
    (c as any)._random = (): number => {
      draws++;
      return draw();
    };
    expect(r.run({ u: 0.5, flag: true })).toBe(false);
    expect(draws).toBe(1);
  });
});

/**
 * An ABSENT CELL makes an element-wise comparison UNDECIDED, and the compiled
 * runtime marks exactly that position instead of answering a decided `false`.
 *
 * The interpreter is the reference at every shape below, measured rather than
 * recalled: `Equal([1, 2, 3], Missing)` and `NotEqual([1, 2, 3], Missing)` are
 * `[Missing, Missing, Missing]`, and `Equal([1, Missing], 1)` is
 * `[True, Missing]`.
 *
 * The marker is `NaN`, which is how a real target renders `Missing` in a cell.
 * Two consumers already read it: the selection runtime consumes a position
 * whose condition cell is absent instead of offering it to a later clause, and
 * the element-wise connective guard tests absence as `x !== x`, so a marked
 * cell combines correctly with `And`/`Or` and a decided `false` still wins.
 *
 * A `NaN` OPERAND is not an absence — it is a number that equals nothing — so
 * it keeps answering a decided `false`/`true`.
 *
 * The SCALAR lowering is deliberately NOT three-valued: its answer stays a
 * genuine boolean, which the branch machinery depends on. Making it undecided
 * as well was measured and declined; the reasoning is in `ROADMAP.md`.
 */
describe('an absent cell makes an element-wise comparison undecided', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<number>');
  ce.declare('t', 'number');

  test('a fully bound pair and a NaN cell are unchanged', () => {
    expect(js(ce, ['Equal', 'L', 't']).run({ L: [1, 2, 3], t: 2 })).toEqual([
      false,
      true,
      false,
    ]);
    // `NaN` is a number that equals nothing: decided, not absent.
    expect(js(ce, ['Equal', 'L', 't']).run({ L: [1, NaN, 3], t: NaN })).toEqual(
      [false, false, false]
    );
    expect(
      js(ce, ['NotEqual', 'L', 't']).run({ L: [1, NaN, 3], t: NaN })
    ).toEqual([true, true, true]);
  });

  test('a connective over the element-wise comparison', () => {
    // The compiled value of a connective over a marked (absent) cell is not
    // specified (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the
    // bullet "Everything computed from an absent value, except at a
    // discharge"; R4 of `docs/plans/2026-11-01-absent-value-contract.md`):
    // only the bound pair is checked.
    const r = js(ce, ['And', ['Equal', 'L', 't'], ['Greater', 'L', 0]]);
    expect(r.run({ L: [1, 2, 3], t: 2 })).toEqual([false, true, false]);
  });

  test('the scalar lowering answers the boolean absence marker', () => {
    const c = new ComputeEngine();
    c.declare('u', 'real');
    c.declare('v', 'real');
    // Not the numeric marker (`NaN`) of an element-wise cell: a scalar
    // comparison is a boolean result, whose absence marker is `undefined`.
    // A scalar piecewise tests its condition's operands itself, and compiles
    // the comparison inside that test, with no test of its own.
    expect(js(c, ['Equal', 'u', 'v']).run({ u: 1, v: 1 })).toBe(true);
  });
});
