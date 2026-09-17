/**
 * Collection VALUES on the interval-js compile target
 * (`docs/plans/2026-09-15-interval-js-collection-lowerings-handoff.md`).
 *
 * The interval target's value model is one interval per quantity, and a
 * collection is that many quantities: a JavaScript array of intervals
 * (`IntervalValue`). Before this work the array spelling existed only at a
 * comprehension root and in the operand position of an accessor; the census
 * of the Tycho corpus on 0.128.12 counted 233 interval-js declines, of which
 * the `List` (43), `Range` (23) and `Map` (7) classes are covered here.
 *
 * What is pinned:
 *
 * - the element-wise broadcast of a scalar kernel over a PROVABLY numeric
 *   list (`_IA.bcast`): a list-typed input, a helper returning a list, a
 *   literal, a `Map`; a scalar sibling is reused at every position, two lists
 *   zip, a length mismatch and an empty list answer the absence marker;
 * - collection values across a user-function boundary: a helper whose body
 *   is a list returns an array, a whole-bound call takes an array argument
 *   (`d(H(x, y), [x, y])`, the `0et6fx01id` witness), and a scalar-parameter
 *   helper is MAPPED over a provable list argument (`_IA.bcastFn`);
 * - a literal `Range` written out (`(1..4)[y]`, `x − (3..9)`) and a
 *   symbolic one built at run time (`_IA.range`), which answers `entire` for
 *   a wide bound;
 * - the reductions `Sum`/`Product`/`Max`/`Min` over a run-time array and over
 *   a range with a symbolic bound (the `mavxszbvzk` witness);
 * - the 2026-08-22 decisions that stay: no free-standing `List` lowering (a
 *   list of booleans declines everywhere, a contradicted scalar declaration
 *   declines in a scalar position), and the scalar kernels stay gated on any
 *   operand whose type does not PROVE a numeric list;
 * - the wide-bound guard of the indexed `Sum` loop: a bound whose endpoints
 *   floor to different integers answers `entire` instead of the point value
 *   the upper endpoint alone gave (measured `[6, 6]` for `Σ_{k=1}^{x} k`
 *   over `x ∈ [2.5, 3.5]`, whose hull is `[3, 6]`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('V', 'list<number>');
  ce.declare('W', 'list<number>');
  ce.declare('n', 'integer');
  ce.parse('f(x) := x^2').evaluate();
  ce.parse('d(a, b) := a[1] b[1] + a[2] b[2]').evaluate();
  ce.parse('H(x, y) := [x + y, x - y]').evaluate();
  ce.parse('P(x, y) := d(H(x, y), [x, y])').evaluate();
  // Q(x) = [k·x for k in 1..n], a list whose width the compiler cannot see.
  ce.assign(
    'Q',
    ce.box([
      'Function',
      ['Map', ['Function', ['Multiply', 'k', 'x'], 'k'], ['Range', 1, 'n']],
      'x',
    ])
  );
  return ce;
}

const pt = (v: number) => ({ lo: v, hi: v });

/** The bands of a result: `[lo, hi]` per interval, nested for arrays, the
 *  kind string for a band-less result (`entire`). */
function bands(v: any): any {
  if (Array.isArray(v)) return v.map(bands);
  if (v && typeof v === 'object' && 'kind' in v)
    return v.value === undefined ? v.kind : [v.value.lo, v.value.hi];
  return [v.lo, v.hi];
}

/** Every band encloses the corresponding interpreter value, with the
 *  enclosure at most `width` wide. */
function expectEncloses(got: any, want: any, width = 1e-9): void {
  if (Array.isArray(want)) {
    expect(Array.isArray(got)).toBe(true);
    expect(got.length).toBe(want.length);
    want.forEach((w, i) => expectEncloses(got[i], w, width));
    return;
  }
  // A scalar band is the pair `[lo, hi]` of numbers (`bands`).
  expect(Array.isArray(got) && got.length === 2).toBe(true);
  const [lo, hi] = got;
  expect(typeof lo).toBe('number');
  expect(lo).toBeLessThanOrEqual(want);
  expect(hi).toBeGreaterThanOrEqual(want);
  expect(hi - lo).toBeLessThanOrEqual(width);
}

function run(ce: ComputeEngine, latex: string, vars: Record<string, any>) {
  const r = compile(ce.parse(latex), { to: 'interval-js', fallback: false });
  expect(r.success).toBe(true);
  return { code: r.code, out: bands(r.run!(vars)) };
}

function declines(ce: ComputeEngine, expr: any, pattern?: RegExp): void {
  const boxed = typeof expr === 'string' ? ce.parse(expr) : ce.box(expr);
  const r = compile(boxed, { to: 'interval-js', fallback: false });
  expect(r.success).toBe(false);
  if (pattern !== undefined) expect(r.error).toMatch(pattern);
}

describe('Interval target — element-wise broadcast over a provable numeric list', () => {
  test('a list-typed input beside a scalar', () => {
    const { code, out } = run(engine(), 'V + 1', { V: [1, 2, 3] });
    expect(code).toBe(
      '_IA.bcast((_tv1, _tv2) => _IA.add(_tv1, _tv2), _.V, _k1)'
    );
    expectEncloses(out, [2, 3, 4]);
  });

  test('two lists zip, a kernel nests inside a kernel', () => {
    const { out } = run(engine(), '\\sin(V) \\cdot W', {
      V: [1, 2],
      W: [10, 20],
    });
    expectEncloses(out, [10 * Math.sin(1), 20 * Math.sin(2)]);
  });

  test('a repeated list subexpression is bound once and the value is right', () => {
    // The CSE temporary holds the ARRAY the broadcast produced; the closure
    // reads its parameters, never a temporary bound outside it.
    const { code, out } = run(engine(), '\\sin(V) + \\sin(V) + \\cos(V)', {
      V: [1, 2],
    });
    expect(code).toContain('const _cse');
    expectEncloses(out, [
      2 * Math.sin(1) + Math.cos(1),
      2 * Math.sin(2) + Math.cos(2),
    ]);
  });

  test('a length mismatch and an empty list answer the absence marker', () => {
    const ce = engine();
    const r = compile(ce.parse('V \\cdot W'), { to: 'interval-js' });
    expect(r.success).toBe(true);
    // The interpreter reports `incompatible-dimensions` at every point.
    const mismatch: any = r.run!({ V: [1, 2, 3], W: [1, 2] });
    expect(Number.isNaN(mismatch.lo)).toBe(true);
    // The empty case follows the JavaScript target's `bcast` (`Nothing`, as
    // the interpreter answers a unary head over `[]`; `[] · []` evaluates to
    // `[]` there — the split is an open roadmap entry).
    const empty: any = r.run!({ V: [], W: [] });
    expect(Number.isNaN(empty.lo)).toBe(true);
  });

  test('a literal list of lists broadcasts to its leaves', () => {
    const { out } = run(engine(), '\\sin([[x, 1], [2, x]])', { x: pt(3) });
    expectEncloses(out, [
      [Math.sin(3), Math.sin(1)],
      [Math.sin(2), Math.sin(3)],
    ]);
  });

  test('a unary head over a literal range', () => {
    const { out } = run(engine(), '\\sin(3..5)', {});
    expectEncloses(out, [Math.sin(3), Math.sin(4), Math.sin(5)]);
  });

  test('an operand whose type does not prove a list keeps the gate', () => {
    const ce = engine();
    // A scalar-or-list union and a `broadcastable<number>` beside a list: a
    // sibling is reused at every position only when provably a number, and
    // neither is — nor is either a provable list.
    ce.declare('u', 'number | list<number>');
    ce.declare('w', 'broadcastable<number>');
    declines(ce, 'V + u', /Add: cannot compile/);
    declines(ce, 'V + w', /Add: cannot compile/);
    // Alone, each keeps the scalar lowering a wide operand always had.
    expect(run(ce, '\\sin(w)', { w: pt(1) }).code).toBe('_IA.sin(_.w)');
    // A point is consumed whole, never mapped over.
    ce.declare('p', 'tuple<number, number>');
    declines(ce, '\\sin(p)', /Sin: cannot compile/);
  });

  test('the relations keep the gate: a list of verdicts is not a result', () => {
    declines(engine(), 'V < 1', /Less: cannot compile/);
  });
});

describe('Interval target — collection values across a user-function boundary', () => {
  test('a helper whose body is a list returns an array', () => {
    const { code, out } = run(engine(), '\\sin(H(x, y))', {
      x: pt(0.3),
      y: pt(0.7),
    });
    expect(code).toBe('_IA.bcast((_tv1) => _IA.sin(_tv1), _fn_H(_.x, _.y))');
    expectEncloses(out, [Math.sin(1), Math.sin(-0.4)]);
  });

  test('a whole-bound call takes an array argument (audit 0et6fx01id)', () => {
    // d(a, b) infers collection parameters from a[1]; H returns a list; the
    // literal [x, y] is an array argument. sin(P(x, y)) is a scalar.
    const ce = engine();
    const { code, out } = run(ce, '\\sin(P(x, y))', { x: pt(0.3), y: pt(0.7) });
    expect(code).toBe('_IA.sin(_fn_P(_.x, _.y))');
    const want = ce.parse('\\sin(P(x, y))').subs({ x: 0.3, y: 0.7 }).N().re;
    expectEncloses(out, want);
  });

  test('a scalar-parameter helper is mapped over a provable list argument', () => {
    const ce = engine();
    const { code, out } = run(ce, 'f(V)', { V: [1, 2, 3] });
    expect(code).toBe('_IA.bcastFn((_tv1) => _fn_f(_tv1), _.V)');
    expectEncloses(out, [1, 4, 9]);
    // The interpreter zips zero elements into the empty list.
    const r = compile(ce.parse('f([])'), { to: 'interval-js' });
    expect(r.run!({})).toEqual([]);
  });

  test('a scalar-parameter helper over an unprovable list keeps the direct call', () => {
    // `x` is `unknown` here: the argument is not provably a collection, and
    // scalar curve plotting rides this target on exactly such calls.
    const { code } = run(engine(), 'f(x)', { x: pt(2) });
    expect(code).toBe('_fn_f(_.x)');
  });

  test('a scalar-parameter helper over a set argument fails closed', () => {
    const ce = engine();
    ce.declare('S', 'set<number>');
    declines(ce, 'f(S)', /handed to a scalar parameter/);
  });

  test('a Map-bodied helper of unknown width (a comprehension over 1..n)', () => {
    const ce = engine();
    const vars = { x: pt(2), n: pt(3) };
    expectEncloses(run(ce, '\\sin(Q(x))', vars).out, [
      Math.sin(2),
      Math.sin(4),
      Math.sin(6),
    ]);
    expectEncloses(run(ce, '\\operatorname{total}(Q(x))', vars).out, 12);
    expectEncloses(run(ce, '\\operatorname{length}(Q(x))', vars).out, 3);
    expectEncloses(run(ce, 'Q(x)[2]', vars).out, 4);
  });
});

describe('Interval target — literal and symbolic ranges', () => {
  test('a literal range is an accessor operand (audit n7uhaaoq1q)', () => {
    const { code, out } = run(engine(), '(1..4)_{y}', { y: pt(3) });
    expect(code).toBe('_IA.at([_k1, _k2, _k3, _k4], _.y)');
    expectEncloses(out, 3);
  });

  test('arithmetic over a literal range is written out at the root', () => {
    const { code, out } = run(engine(), 'x - (3..9)', { x: pt(10) });
    expect(code).toBe(
      '[_IA.add(_.x, _k1), _IA.add(_.x, _k2), _IA.add(_.x, _k3), ' +
        '_IA.add(_.x, _k4), _IA.add(_.x, _k5), _IA.add(_.x, _k6), ' +
        '_IA.add(_.x, _k7)]'
    );
    expectEncloses(out, [7, 6, 5, 4, 3, 2, 1]);
  });

  test('a symbolic range is built at run time', () => {
    const ce = engine();
    expectEncloses(run(ce, '(1..n)[2]', { n: pt(4) }).out, 2);
    expectEncloses(
      run(ce, '\\operatorname{length}(1..n)', { n: pt(4) }).out,
      4
    );
    expectEncloses(
      run(ce, '\\operatorname{total}(1..n)', { n: pt(4) }).out,
      10
    );
  });

  test('a range with a wide bound answers entire through every consumer', () => {
    // `_IA.range` answers `entire` for a bound that is not a point interval;
    // an accessor, a `Map` and a reduction over it must pass that through
    // rather than read the non-array as "no collection" (the absence marker
    // would let a plotter exclude a region that has a value).
    const ce = engine();
    const wide = { n: { lo: 2, hi: 3 } };
    expect(run(ce, '\\operatorname{length}(1..n)', wide).out).toBe('entire');
    expect(run(ce, '(1..n)[1]', wide).out).toBe('entire');
    expect(run(ce, '\\operatorname{total}(1..n)', wide).out).toBe('entire');
    const mapped = compile(
      ce.box(['Map', ['Function', ['Square', 'k'], 'k'], ['Range', 1, 'n']]),
      { to: 'interval-js', fallback: false }
    );
    expect(mapped.success).toBe(true);
    expect(bands(mapped.run!(wide))).toBe('entire');
  });

  test('a Map whose callback has no interval reading declines', () => {
    // A predicate body would map to a list of verdicts, which is not a value
    // of this target.
    declines(engine(), [
      'Map',
      ['Function', ['Less', 'k', 0], 'k'],
      ['Range', 1, 'n'],
    ]);
    declines(engine(), [
      'Sum',
      ['Map', ['Function', ['Less', 'k', 0], 'k'], ['Range', 1, 'n']],
    ]);
  });

  test('a range with a wide bound answers entire', () => {
    // n ∈ [3, 4] names two element counts; no array holds both.
    const { out } = run(engine(), '\\operatorname{total}((1..n)^2)', {
      n: { lo: 3, hi: 4 },
    });
    expect(out).toBe('entire');
  });

  test('the descending and real-bound conventions of Range', () => {
    const ce = engine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    // Range(3, 1) is [3, 2, 1]; Range(1.5, 4) is [1.5, 2.5, 3.5].
    expectEncloses(run(ce, '(a..b)[1]', { a: pt(3), b: pt(1) }).out, 3);
    expectEncloses(
      run(ce, '\\operatorname{total}(a..b)', { a: pt(1.5), b: pt(4) }).out,
      7.5
    );
  });
});

describe('Interval target — a symbol holding a lazy Map or Range value', () => {
  test('a list built by evaluating arithmetic over a range (audit lrpzqnemhy)', () => {
    // `R = mod(10⁴ sin(10⁴ · [0...100]), 1)` evaluates to a lazy `Map` over
    // the range, not to a written-out list; the accessor, the length and a
    // helper reading `R[…]` must reach it through the collection spelling.
    const ce = engine();
    ce.assign(
      'R',
      ce
        .parse(
          '\\operatorname{mod}(10^4 \\cdot \\sin(10^4 \\cdot [0...100]), 1)'
        )
        .evaluate()
    );
    expect(ce.box('R').value?.operator).toBe('Map');
    const want = (k: number) => (((1e4 * Math.sin(1e4 * (k - 1))) % 1) + 1) % 1;
    expectEncloses(run(ce, 'R[3]', {}).out, want(3), 1e-6);
    expectEncloses(run(ce, '\\operatorname{length}(R)', {}).out, 101);
    ce.parse(
      'S(x, k) := \\sum_{n=-k}^{k} \\frac{\\sin(\\pi(x \\bmod 1 - n)) R[n + x + 50]}{\\pi(x \\bmod 1 - n)}'
    ).evaluate();
    const r = compile(ce.parse('S(5x, 3)'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_fn_S(');
    // The row itself is `NaN` in the interpreter at every point (the `n = 0`
    // term is `sin(0)/0` for an integer `5x`, and the index `n + 5x + 50` is
    // not an integer otherwise), so only the run is checked, not its value.
    const got: any = r.run!({ x: pt(0.2) });
    expect(got === undefined).toBe(false);
  });

  test('a symbol holding an evaluated symbolic range', () => {
    const ce = engine();
    ce.assign('I', ce.parse('1..n').evaluate());
    expect(ce.box('I').value?.operator).toBe('Range');
    expectEncloses(run(ce, '\\operatorname{length}(I)', { n: pt(4) }).out, 4);
    expectEncloses(run(ce, '\\operatorname{total}(I)', { n: pt(4) }).out, 10);
    // The bare symbol at the ROOT is the array of the range.
    expectEncloses(run(ce, 'I', { n: pt(3) }).out, [1, 2, 3]);
  });

  test('a symbol holding a lazy Map at the root, and an overridden head', () => {
    const ce = engine();
    ce.assign('M', ce.parse('\\sin(10^4 \\cdot [1...3])').evaluate());
    const head = ce.box('M').value?.operator;
    expect(head === 'Map' || head === 'List').toBe(true);
    expectEncloses(
      run(ce, 'M', {}).out,
      [1, 2, 3].map((k) => Math.sin(1e4 * k)),
      1e-9
    );
    // A caller who overrode `Range` keeps that implementation: the
    // look-through must not fold `Length(I)` past it.
    ce.assign('I', ce.parse('1..n').evaluate());
    const r = compile(ce.parse('\\operatorname{length}(I)'), {
      to: 'interval-js',
      fallback: false,
      functions: { Range: '_IA.range' },
    });
    expect(r.success ? r.code : '').not.toBe('_IA.point(3)');
  });
});

describe('Interval target — reductions over collection values', () => {
  test('Max/Min over a literal, a run-time array and the empty collection', () => {
    const ce = engine();
    expectEncloses(run(ce, '\\max([x, 2x, 1])', { x: pt(3) }).out, 6);
    expectEncloses(run(ce, '\\max(V)', { V: [1, 5, 2] }).out, 5);
    expectEncloses(run(ce, '\\min(V)', { V: [1, 5, 2] }).out, 1);
    // The interpreter's Max([]) is NaN: the absence marker here.
    const empty = run(ce, '\\max(V)', { V: [] }).out;
    expect(Number.isNaN(empty[0])).toBe(true);
    // A collection beside a scalar is not the reduce form; it stays gated.
    declines(ce, '\\max(1, V)', /Max: cannot compile/);
  });

  test('a reduction over a range with a symbolic bound (audit mavxszbvzk)', () => {
    const ce = engine();
    const latex = '2^{-(\\lfloor \\lb(\\max(x,1)) \\rfloor .. 0)}';
    // x = 8: the range is 3..0 = [3, 2, 1, 0], the powers 1/8, 1/4, 1/2, 1.
    const total = run(ce, `\\operatorname{total}(${latex})`, { x: pt(8) });
    expect(total.code).toContain('_IA.range(');
    expectEncloses(total.out, 1.875);
    expectEncloses(run(ce, `\\min(${latex})`, { x: pt(8) }).out, 0.125);
    expectEncloses(run(ce, `\\max(${latex})`, { x: pt(8) }).out, 1);
    // A cell straddling a power of two makes the bound wide: entire.
    expect(
      run(ce, `\\operatorname{total}(${latex})`, { x: { lo: 7, hi: 9 } }).out
    ).toBe('entire');
  });

  test('a Map over a symbolic range under a reduction', () => {
    const ce = engine();
    const r = compile(
      ce.box([
        'Sum',
        ['Map', ['Function', ['Square', 'k'], 'k'], ['Range', 1, 'n']],
      ]),
      { to: 'interval-js', fallback: false }
    );
    expect(r.success).toBe(true);
    expectEncloses(bands(r.run!({ n: pt(3) })), 14);
  });
});

describe('Interval target — collection-valued roots', () => {
  test('a list of numbers at the root is an array', () => {
    const { code, out } = run(engine(), '[x, 2x]', { x: pt(3) });
    expect(code).toBe('[_.x, _IA.scale(_k1, _.x)]');
    expectEncloses(out, [3, 6]);
  });

  test('a list of booleans at the root still declines', () => {
    declines(engine(), ['List', ['Less', 'x', 1], ['Less', 'x', 2]], /List/);
  });

  test('a Map at the root is an array', () => {
    const ce = engine();
    const r = compile(
      ce.box(['Map', ['Function', ['Multiply', 'k', 2], 'k'], 'V']),
      { to: 'interval-js', fallback: false }
    );
    expect(r.success).toBe(true);
    expectEncloses(bands(r.run!({ V: [1, 2] })), [2, 4]);
  });
});

describe('Interval target — the 2026-08-22 decisions that stay', () => {
  test('a contradicted scalar declaration declines in a scalar position', () => {
    const ce = engine();
    ce.declare('s', '(number) -> number');
    ce.assign(
      's',
      ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
    );
    declines(ce, ['Add', ['s', 'u'], 1], /contradicted/);
    declines(ce, ['Less', ['s', 'u'], 1], /contradicted/);
    // Its bare call gets no array spelling for its body either.
    declines(ce, ['s', 'u'], /List/);
  });

  test('a list-of-booleans helper declines in every position', () => {
    const ce = engine();
    ce.parse('b(t) := [t < 1, t < 2]').evaluate();
    declines(ce, ['Which', ['b', 'u'], 1, 'True', 2]);
    declines(ce, ['b', 'u'], /List/);
    ce.declare('c', '(number) -> boolean');
    ce.assign(
      'c',
      ce.box(['Function', ['List', ['Less', 't', 1], ['Less', 't', 2]], 't'])
    );
    declines(ce, ['Which', ['c', 'u'], 1, 'True', 2]);
  });
});

describe('Interval target — the indexed Sum loop over a wide bound', () => {
  test('a bound whose endpoints floor apart answers entire', () => {
    const ce = engine();
    const r = compile(ce.parse('\\sum_{k=1}^{x} k'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    // The sum is 3 below x = 3 and 6 from there on: no single point encloses
    // both, and the loop cannot run twice.
    expect(bands(r.run!({ x: { lo: 2.5, hi: 3.5 } }))).toBe('entire');
    // A bound whose endpoints floor to one integer runs the loop.
    expectEncloses(bands(r.run!({ x: { lo: 3, hi: 3.9 } })), 6);
    expectEncloses(bands(r.run!({ x: pt(3) })), 6);
  });
});
