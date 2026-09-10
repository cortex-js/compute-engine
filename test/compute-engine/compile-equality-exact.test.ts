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
 *  - two ABSENT operands are not equal (`undefined === undefined` would say
 *    otherwise), because the interpreter answers `Missing`, never `True`, for
 *    `Equal(Missing, Missing)` — the `typeof` guard survives only where BOTH
 *    operands may read `undefined`;
 *  - the piecewise NaN guard `(v === v) ? … : NaN` is NOT redundant: a
 *    `Which` whose condition compares a `NaN` answers `Missing` in the
 *    interpreter, so the compiled piecewise must answer `NaN`, not the
 *    else arm.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

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

  test('two free symbols keep the absence guard, no tolerance', () => {
    expect(js(ce, ['Equal', 'a', 'b']).code).toBe(
      "(typeof (_.a) === 'number' && (_.a) === (_.b))"
    );
    expect(js(ce, ['NotEqual', 'a', 'b']).code).toBe(
      "(!(typeof (_.a) === 'number' && (_.a) === (_.b)))"
    );
  });

  test('a literal or an arithmetic result on either side needs no guard', () => {
    expect(js(ce, ['Equal', 'a', 3]).code).toBe('((_.a) === (3))');
    expect(js(ce, ['NotEqual', 'a', 3]).code).toBe('((_.a) !== (3))');
    expect(js(ce, ['Equal', ['Add', 'a', 1], ['Multiply', 'b', 2]]).code).toBe(
      '((_.a + 1) === (2 * _.b))'
    );
    expect(js(ce, ['Equal', ['Floor', 'a'], ['Sign', 'b']]).code).toBe(
      '((Math.floor(_.a)) === (Math.sign(_.b)))'
    );
  });

  test('the chained form conjoins exact pairs', () => {
    expect(js(ce, ['Equal', 'a', 'b', 'c']).code).toBe(
      "((typeof (_.a) === 'number' && (_.a) === (_.b)) && (typeof (_.b) === 'number' && (_.b) === (_.c)))"
    );
  });

  test('no tolerance spelling survives anywhere', () => {
    for (const e of [
      ['Equal', 'a', 'b'],
      ['Equal', ['Add', 'a', 'b'], 0.3],
      ['Equal', ['Complex', 1, 2], 'a'],
      ['KroneckerDelta', 'a', 'b'],
      ['KroneckerDelta', 'a'],
    ]) {
      const { code } = js(ce, e);
      expect(code).not.toMatch(/1e-10|Math\.abs|_SYS\.cabs/);
    }
  });

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
    // Absent operands: never equal, whatever the other side.
    expect(eq.run({})).toBe(false);
    expect(neq.run({})).toBe(true);
    expect(eq.run({ a: 1 })).toBe(false);
    expect(js(ce, ['Equal', 'a', 3]).run({})).toBe(false);
  });

  test('a complex pair compares component-wise, exactly', () => {
    const r = js(ce, ['Equal', ['Complex', 1, 2], 'a']);
    expect(r.code).toBe(
      '((({ re: 1, im: 2 })).re === (_.a) && (({ re: 1, im: 2 })).im === 0)'
    );
    expect(r.run({ a: 1 })).toBe(false);
  });

  test('KroneckerDelta is exact', () => {
    const d = js(ce, ['KroneckerDelta', 'a', 'b']);
    expect(d.run({ a: 2, b: 2 })).toBe(1);
    expect(d.run({ a: 2, b: 2 + 1e-12 })).toBe(0);
    expect(d.run({ a: NaN, b: NaN })).toBe(0);
    expect(js(ce, ['KroneckerDelta', 'a']).run({ a: 1e-12 })).toBe(0);
  });

  test('KroneckerDelta of two ABSENT arguments is 0, not 1', () => {
    // An absent argument reads as `undefined`, and `undefined === undefined`
    // is true, so the bare variadic comparison would answer 1. The
    // interpreter never answers 1 for absent arguments, and `Equal` compiled
    // from the same engine answers false, so the delta answers 0.
    const d = js(ce, ['KroneckerDelta', 'a', 'b']);
    expect(d.run({})).toBe(0);
    expect(d.run({ a: 2 })).toBe(0);
    expect(d.run({ b: 2 })).toBe(0);
    expect(js(ce, ['Equal', 'a', 'b']).run({})).toBe(false);
    // Present arguments are unaffected.
    expect(d.run({ a: 2, b: 2 })).toBe(1);
    expect(js(ce, ['KroneckerDelta', 'a', 'b', 'c']).run({ a: 2, b: 2 })).toBe(
      0
    );
  });

  test('KroneckerDelta compares complex operands component-wise', () => {
    const c = new ComputeEngine();
    c.declare('z', 'complex');
    const d = js(c, ['KroneckerDelta', 'z', ['Complex', 1, 2]]);
    expect(d.run({ z: { re: 1, im: 2 } })).toBe(1);
    expect(d.run({ z: { re: 1, im: 3 } })).toBe(0);
    expect(d.run({})).toBe(0);
    const mixed = js(c, ['KroneckerDelta', 'z', 1]);
    expect(mixed.run({ z: { re: 1, im: 0 } })).toBe(1);
    expect(mixed.run({ z: { re: 1, im: 1 } })).toBe(0);
    expect(
      c.box(['KroneckerDelta', ['Complex', 1, 2], ['Complex', 1, 2]]).evaluate()
        .re
    ).toBe(1);
  });

  test('an impure operand is still drawn once', () => {
    const r = js(ce, ['Equal', ['Random'], ['Random']]);
    expect(r.code).toBe(
      '((_SYS.drawNextRandomNumber()) === (_SYS.drawNextRandomNumber()))'
    );
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
    // The left operand is absent: the comparison is false either way, but the
    // draw still happens.
    expect(r.run({ flag: true })).toBe(false);
    expect(draws).toBe(1);
    expect(r.run({ u: 0.5, flag: true })).toBe(false);
    expect(draws).toBe(2);
  });

  test('the piecewise NaN guard stays: a NaN condition answers NaN', () => {
    const c = new ComputeEngine();
    c.declare('P', 'list<number^5>');
    c.declare('k', 'integer');
    const r = compile(
      c.box(['Which', ['Equal', ['At', 'P', 'k'], 5], 1, 'True', 0]),
      { to: 'javascript', fallback: false }
    );
    if (!r.success) throw new Error(r.error?.message);
    expect(r.code).toBe(
      '((_tv1) => ((_tv1 === _tv1) ? ((((_tv1) === (5))) ? (1) : (0)) : NaN))(_SYS.atNumeric(_.P, _.k, "number"))'
    );
    expect(r.run({ P: [1, 2, 3, 4, 5], k: 5 })).toBe(1);
    expect(r.run({ P: [1, 2, 3, 4, 5], k: 2 })).toBe(0);
    // Out of range reads NaN: the interpreter answers `Missing`, not 0.
    expect(r.run({ P: [1, 2, 3, 4, 5], k: 7 })).toBeNaN();
    expect(
      c.box(['Which', ['Equal', 'NaN', 5], 1, 'True', 0]).evaluate().symbol
    ).toBe('Missing');
  });

  test('the collection helpers compare exactly', () => {
    const c = new ComputeEngine();
    c.declare('L', 'list<number>');
    c.declare('M', 'list<number>');
    const r = compile(c.box(['Equal', 'L', 3]), {
      to: 'javascript',
      fallback: false,
    });
    if (!r.success) throw new Error(r.error?.message);
    expect(r.code).toBe('_SYS.eq((_.L), (3))');
    expect(r.run({ L: [3, 3 + 1e-12, NaN, Infinity] })).toEqual([
      true,
      false,
      false,
      false,
    ]);
    const w = compile(c.box(['Equal', 'L', 'M']), {
      to: 'javascript',
      fallback: false,
    });
    if (!w.success) throw new Error(w.error?.message);
    expect(w.run({ L: [1, Infinity], M: [1, Infinity] })).toBe(true);
    expect(w.run({ L: [1, 2], M: [1, 2 + 1e-12] })).toBe(false);
    const n = compile(c.box(['NotEqual', 'L', 3]), {
      to: 'javascript',
      fallback: false,
    });
    if (!n.success) throw new Error(n.error?.message);
    expect(n.run({ L: [3, NaN] })).toEqual([false, true]);
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

  test('an absent scalar operand marks every position', () => {
    // This answered `[false, false, false]`, so a piecewise over it selected
    // its else arm where the interpreter has nothing to select.
    expect(js(ce, ['Equal', 'L', 't']).run({ L: [1, 2, 3] })).toEqual([
      NaN,
      NaN,
      NaN,
    ]);
    expect(js(ce, ['NotEqual', 'L', 't']).run({ L: [1, 2, 3] })).toEqual([
      NaN,
      NaN,
      NaN,
    ]);
  });

  test('a hole in the list marks only its own position', () => {
    expect(
      js(ce, ['Equal', 'L', 't']).run({ L: [1, undefined, 3], t: 1 })
    ).toEqual([true, NaN, false]);
    expect(
      js(ce, ['NotEqual', 'L', 't']).run({ L: [1, undefined, 3], t: 1 })
    ).toEqual([false, NaN, true]);
  });

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

  test('an element-wise piecewise answers absent, not its else arm', () => {
    const r = compile(ce.box(['Which', ['Equal', 'L', 't'], 1, 'True', 0]), {
      to: 'javascript',
      fallback: false,
    });
    if (!r.success) throw new Error(r.error?.message);
    // Answered `[0, 0, 0]` while the comparison answered a decided `false`.
    expect(r.run({ L: [1, 2, 3] })).toEqual([NaN, NaN, NaN]);
    expect(r.run({ L: [1, 2, 3], t: 2 })).toEqual([0, 1, 0]);
  });

  test('a marked cell combines three-valued with a connective', () => {
    // `And(Missing, True)` is `Missing` and `And(Missing, False)` is `False`:
    // a decided `false` absorbs an undecided cell. The element-wise connective
    // guard reads the marker because it tests absence as `x !== x`.
    const r = js(ce, ['And', ['Equal', 'L', 't'], ['Greater', 'L', 0]]);
    expect(r.run({ L: [1, 2, 3] })).toEqual([NaN, NaN, NaN]);
    expect(r.run({ L: [-1, -2, -3] })).toEqual([false, false, false]);
    expect(r.run({ L: [1, 2, 3], t: 2 })).toEqual([false, true, false]);
  });

  test('the scalar lowering still answers a genuine boolean', () => {
    const c = new ComputeEngine();
    c.declare('u', 'real');
    c.declare('v', 'real');
    // Not the marker: the scalar answer feeds the branch machinery, which is
    // written against a real boolean. A scalar piecewise answers `NaN` for an
    // absent operand through its own condition guard, ahead of this value.
    expect(js(c, ['Equal', 'u', 'v']).run({})).toBe(false);
    expect(js(c, ['NotEqual', 'u', 'v']).run({})).toBe(true);
  });
});

describe('compiled Equal/NotEqual is exact (Python)', () => {
  const ce = engine();
  const py = new PythonTarget();
  const code = (e: unknown): string => {
    const r = py.compile(ce.box(e as any));
    if (!r.success) throw new Error(r.error?.message ?? 'declined');
    return r.code;
  };

  test('scalar pairs', () => {
    expect(code(['Equal', 'a', 'b'])).toBe('((a) is not None and (a) == (b))');
    expect(code(['NotEqual', 'a', 'b'])).toBe(
      '(not ((a) is not None and (a) == (b)))'
    );
    expect(code(['Equal', 'a', 3])).toBe('((a) == (3))');
    expect(code(['NotEqual', 'a', 3])).toBe('((a) != (3))');
    expect(code(['Equal', ['Add', 'a', 1], ['Multiply', 'b', 2]])).toBe(
      '((a + 1) == (2 * b))'
    );
    expect(code(['KroneckerDelta', 'a', 'b'])).toBe(
      '(lambda *_v: 1 if _v[0] is not None and all(_x == _v[0] for _x in _v) else 0)(a, b)'
    );
    expect(code(['KroneckerDelta', 'a'])).toBe('(1 if a == 0 else 0)');
  });

  test('KroneckerDelta carries the same absence test as the Equal pair', () => {
    // An absent argument reads as `None`, and `None == None` is true, so the
    // bare comparison would answer 1 where the interpreter never does. The
    // test is the one the scalar `Equal` pair already carries, applied to the
    // argument every other argument is compared against.
    expect(code(['KroneckerDelta', 'a', 'b'])).toContain('_v[0] is not None');
    expect(code(['Equal', 'a', 'b'])).toContain('is not None');
    // A single argument compares to 0, which `None` already fails.
    expect(code(['KroneckerDelta', 'a'])).not.toContain('is not None');
  });

  test('the collection helper carries no tolerance', () => {
    const c = new ComputeEngine();
    c.declare('L', 'list<number>');
    c.declare('M', 'list<number>');
    const r = py.compile(c.box(['Equal', 'L', 'M']));
    if (!r.success) throw new Error(r.error?.message);
    expect(r.code).toContain('_ce_eqcoll(L, M)');
    expect(r.code).toContain('def _ce_eqcoll(_a, _b):');
    expect(r.code).not.toMatch(/_tol|abs\(/);
  });
});
