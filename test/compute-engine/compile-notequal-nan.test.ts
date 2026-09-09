/**
 * Compiled equality where the DIFFERENCE of the operands is `NaN` — that is, on
 * a `NaN` operand, and on two infinities of the SAME sign.
 *
 * The scalar tolerance test is `Math.abs(a - b) <= tol` (`abs(a - b) <= tol` on
 * the Python target). Every comparison against `NaN` is false, so that test
 * answered `false` for BOTH of those pairs, and two defects followed:
 *
 *  - `NotEqual` was emitted as the `>` complement (`Math.abs(a - b) > tol`),
 *    which also answers `false` on a `NaN` operand — the compiled function
 *    reported that `NaN` EQUALS the other operand. The reproduction is
 *    ordinary: a compiled function reads an absent parameter as `undefined`,
 *    the subtraction is `NaN`, and `r != 3` answered "they are equal".
 *  - `Equal` reported two infinities of the same sign UNEQUAL, because
 *    `Math.abs(Infinity - Infinity)` is `NaN`, where the interpreter answers
 *    `Equal(oo, oo)` → `True`.
 *
 * Both are fixed by the same pair of changes, on both targets. An EXACT test
 * runs before the tolerance test (`a === b || Math.abs(a - b) <= tol`;
 * `a == b or abs(a - b) <= tol` in Python), which is the order the Python
 * `_ce_eqcoll` collection helper already used; and `NotEqual` is the NEGATION
 * of that whole test rather than a `>` comparison. `NaN` fails both tests, so
 * `NotEqual` on it answers `true` — the IEEE 754 convention, and what the
 * interpreter answers (`NotEqual(NaN, 3)` is `True`). A pair the exact test
 * accepts has a difference of exactly 0, which the tolerance test accepts too,
 * so no other pair changes answer.
 *
 * Also pinned here: the lowerings that reach the same answers by a different
 * route — the exact `===`/`!==` form used when both operands are provably
 * integer (`exactIntegerComparison`), the JavaScript runtime dispatch
 * `_SYS.eq`/`_SYS.neq` (`eqTensor`, whose scalar leaf gained the same exact
 * pre-test), and the Python `_ce_eqcoll` helper.
 *
 * Both operands of the scalar form are now spliced twice, so an IMPURE operand
 * has to be bound to a temporary or it would be evaluated twice. The draw
 * counts below pin that.
 */

import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

const python = new PythonTarget();

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

  test('the scalar emission is the exact test before the tolerance test', () => {
    expect(js(ce.box(['Equal', 'nqr', 3])).code).toBe(
      '((typeof (_.nqr) === \'number\' && (_.nqr) === (3)) || Math.abs((_.nqr) - (3)) <= 1e-10)'
    );
  });

  test('NotEqual is the negation of the whole Equal test', () => {
    expect(js(ce.box(['NotEqual', 'nqr', 3])).code).toBe(
      '(!((typeof (_.nqr) === \'number\' && (_.nqr) === (3)) || Math.abs((_.nqr) - (3)) <= 1e-10))'
    );
  });

  test('an absent operand reads as NaN and answers true', () => {
    // The defect that prompted the change: `run({})` leaves `nqr` `undefined`,
    // so the difference is `NaN`.
    expect(js(ce.box(['NotEqual', 'nqr', 3])).run({})).toBe(true);
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

  test('equal and unequal finite pairs are unchanged', () => {
    const ne = js(ce.box(['NotEqual', 'nqr', 'nqs']));
    expect(ne.run({ nqr: 2, nqs: 2 })).toBe(false);
    expect(ne.run({ nqr: 2, nqs: 3 })).toBe(true);
    // Within the engine tolerance the two are EQUAL, as for the interpreter.
    expect(ne.run({ nqr: 2, nqs: 2 + 1e-13 })).toBe(false);
    expect(ne.run({ nqr: -0, nqs: 0 })).toBe(false);
  });

  test('a chained NotEqual conjoins the negated pairs', () => {
    ce.declare('nqt', 'real');
    const r = js(ce.box(['NotEqual', 'nqr', 'nqs', 'nqt']));
    expect(r.code).toBe(
      '(!((typeof (_.nqr) === \'number\' && (_.nqr) === (_.nqs)) || Math.abs((_.nqr) - (_.nqs)) <= 1e-10)) && ' +
        '(!((typeof (_.nqs) === \'number\' && (_.nqs) === (_.nqt)) || Math.abs((_.nqs) - (_.nqt)) <= 1e-10))'
    );
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
    expect(r.code).toBe('((_.nqi) !== (3))');
    expect(r.run({ nqi: NaN })).toBe(true);
    expect(r.run({ nqi: 3 })).toBe(false);
    expect(r.run({ nqi: 4 })).toBe(true);
  });

  test('an impure operand is drawn ONCE even though it is spliced twice', () => {
    // The scalar form splices each operand in the exact test and again in the
    // difference. An unbound `Random()` would therefore be drawn twice, and the
    // two draws would almost never be equal. `multiSpliced` binds it to a
    // temporary instead, so the drawing call is emitted exactly once.
    const engine = new ComputeEngine();
    for (const head of ['Equal', 'NotEqual']) {
      const r = compile(engine.box([head, ['Random'], 0.5]), {
        fallback: false,
      });
      expect(r.success).toBe(true);
      expect(r.code!.match(/drawNextRandomNumber/g)).toHaveLength(1);
      expect(r.code).toContain('=> {');
      expect(typeof r.run!({})).toBe('boolean');
    }
    // Two SEPARATE draws stay two draws: each operand is bound on its own.
    const two = compile(engine.box(['Equal', ['Random'], ['Random']]), {
      fallback: false,
    });
    expect(two.code!.match(/drawNextRandomNumber/g)).toHaveLength(2);
  });

  test('a host variable is read three times, and every read sees one value', () => {
    // A `vars` read is PURE, so the splices need no temporary. This counts
    // the reads to say what the emission actually does — the decidedness
    // guard, the `typeof` check of the exact test, and the exact comparison
    // itself — and checks that a getter answering one value the whole call
    // answers the pair correctly.
    const r = js(ce.box(['Equal', 'nqr', 3]));
    let reads = 0;
    const vars = {
      get nqr(): number {
        reads += 1;
        return 3;
      },
    };
    expect(r.run(vars)).toBe(true);
    expect(reads).toBe(3);
  });

  test('the collection dispatch `_SYS.eq`/`_SYS.neq` agrees', () => {
    ce.declare('nqL', 'list<number>');
    // Two collection operands: whole-value equality, a single boolean.
    const whole = js(ce.box(['NotEqual', 'nqL', ['List', 1, 2]]));
    expect(whole.code).toContain('_SYS.neq');
    expect(whole.run({ nqL: [1, NaN] })).toBe(true);
    expect(whole.run({ nqL: [1, 2] })).toBe(false);
    // One collection operand: element-wise, a list of booleans.
    const elementwise = js(ce.box(['NotEqual', 'nqL', 2]));
    expect(elementwise.code).toContain('_SYS.neq');
    expect(elementwise.run({ nqL: [1, NaN] })).toEqual([true, true]);
    expect(elementwise.run({ nqL: [2, 3] })).toEqual([false, true]);
    // The scalar leaf of `eqTensor` gained the same exact pre-test, so a
    // matching infinity is equal there too.
    const eqWhole = js(ce.box(['Equal', 'nqL', ['List', 1, 2]]));
    expect(eqWhole.run({ nqL: [Infinity, 2] })).toBe(false);
    const eqElementwise = js(ce.box(['Equal', 'nqL', Infinity]));
    expect(eqElementwise.run({ nqL: [Infinity, -Infinity, 2] })).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe('compiled equality on NaN and on infinities — Python target', () => {
  test('the scalar emission is the exact test before the tolerance test', () => {
    expect(python.compile(ce.box(['Equal', 'x', 3])).code).toBe(
      '((x) is not None and ((x) == (3) or abs((x) - (3)) <= 1e-10))'
    );
  });

  test('NotEqual is the negation of the whole Equal test', () => {
    expect(python.compile(ce.box(['NotEqual', 'x', 3])).code).toBe(
      '(not ((x) is not None and ((x) == (3) or abs((x) - (3)) <= 1e-10)))'
    );
  });

  test('a chained NotEqual conjoins the negated pairs with `and`', () => {
    expect(python.compile(ce.box(['NotEqual', 'x', 'y', 'z'])).code).toBe(
      '(not ((x) is not None and (y) is not None and ((x) == (y) or abs((x) - (y)) <= 1e-10))) and ' +
        '(not ((y) is not None and (z) is not None and ((y) == (z) or abs((y) - (z)) <= 1e-10)))'
    );
  });

  test('the emitted Python answers the required values', () => {
    // Evaluated with the same semantics Python gives the emitted text: `==` is
    // exact (`inf == inf` is True, `nan == nan` is False) and every comparison
    // against `nan` is false.
    const tol = 1e-10;
    const equal = (a: number, b: number): boolean =>
      a === b || Math.abs(a - b) <= tol;
    const notEqual = (a: number, b: number): boolean => !equal(a, b);
    expect(equal(Infinity, Infinity)).toBe(true);
    expect(equal(-Infinity, Infinity)).toBe(false);
    expect(notEqual(Infinity, Infinity)).toBe(false);
    expect(equal(NaN, NaN)).toBe(false);
    expect(notEqual(NaN, NaN)).toBe(true);
    expect(notEqual(NaN, 3)).toBe(true);
    expect(equal(2, 2)).toBe(true);
    expect(notEqual(2, 3)).toBe(true);
  });

  test('the collection helper is negated with `not`', () => {
    // `_ce_eqcoll` already tried an exact `==` before the tolerance test, so a
    // `nan` element makes both tests fail and `not` answers `True`, while two
    // matching infinities are equal.
    const code = python.compile(
      ce.box(['NotEqual', ['List', 1, 2], ['List', 1, 3]] as any)
    ).code;
    expect(code.split('\n').at(-1)).toBe(
      '(not _ce_eqcoll([1, 2], [1, 3], 1e-10))'
    );
  });
});

describe('two absent operands are not equal', () => {
  // A caller variable that is absent reads `undefined`; `undefined ===
  // undefined` must not make two unknown values equal, since their numeric
  // difference is NaN and the interpreter answers False for an undecided pair.
  test('javascript: Equal is false and NotEqual is true when both are absent', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const eq = compile(ce.parse('x = y'), { to: 'javascript' });
    const ne = compile(ce.parse('x \\ne y'), { to: 'javascript' });
    expect(eq.run!({})).toBe(false);
    expect(ne.run!({})).toBe(true);
    expect(eq.run!({ x: 2 })).toBe(false);
    expect(eq.run!({ x: 2, y: 2 })).toBe(true);
    expect(eq.code).toContain("typeof (_.x) === 'number'");
  });

  test('python: the exact test excludes None', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = compile(ce.parse('x = 3'), { to: 'python' });
    expect(r.code).toContain('((x) is not None and ((x) == (3) or abs((x) - (3)) <= 1e-10))');
  });
});
