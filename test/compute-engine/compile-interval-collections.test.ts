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
import { IntervalArithmetic } from '../../src/compute-engine/interval/index';

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
      '_IA.bcast((_tv1) => _IA.add(_tv1, _k1), _.V)'
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

  test('a length mismatch answers the absence marker, an empty list the empty list', () => {
    const ce = engine();
    const r = compile(ce.parse('V \\cdot W'), { to: 'interval-js' });
    expect(r.success).toBe(true);
    // The interpreter reports `incompatible-dimensions` at every point.
    const mismatch: any = r.run!({ V: [1, 2, 3], W: [1, 2] });
    expect(Number.isNaN(mismatch.lo)).toBe(true);
    // A broadcast over a lone empty operand answers the EMPTY LIST, as it
    // does in the interpreter (`[] · []` evaluates to `[]`).
    expect(r.run!({ V: [], W: [] })).toEqual([]);
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
    // A `broadcastable<number>` — a number or a collection of numbers — is
    // admitted beside a list: every value it stands for has an interval
    // reading, and the run-time broadcast zips an array or reuses a scalar.
    ce.declare('w', 'broadcastable<number>');
    expect(run(ce, 'V + w', { V: [1, 2], w: pt(10) }).out).toEqual([
      [11, 11],
      [12, 12],
    ]);
    expect(run(ce, 'V + w', { V: [1, 2], w: [10, 20] }).out).toEqual([
      [11, 11],
      [22, 22],
    ]);
    // Alone, it broadcasts too: an array at run time is mapped, a scalar is
    // applied to directly.
    expect(run(ce, '\\sin(w)', { w: pt(1) }).code).toBe(
      '_IA.bcast((_tv1) => _IA.sin(_tv1), _.w)'
    );
    expectEncloses(run(ce, '\\sin(w)', { w: [1, 2] }).out, [
      Math.sin(1),
      Math.sin(2),
    ]);
    // A number literal beside such an operand stays in the closure body, so
    // the handler keeps its literal-dependent kernel: the exponent `2/3`
    // selects `powRational`, which encloses a negative base (`powInterval`
    // over a symbolic exponent answers `empty` there), and a literal `Round`
    // precision is accepted.
    const cbrt = compile(ce.box(['Power', 'w', ['Rational', 2, 3]]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(cbrt.success).toBe(true);
    expect(cbrt.code).toBe(
      '_IA.bcast((_tv1) => _IA.powRational(_tv1, 2, 3), _.w)'
    );
    expect(bands(cbrt.run!({ w: pt(-8) }))).toEqual([4, 4]);
    expect(bands(cbrt.run!({ w: [pt(-8), pt(8)] }))).toEqual([
      [4, 4],
      [4, 4],
    ]);
    expect(
      compile(ce.box(['Round', 'w', 2]), { to: 'interval-js', fallback: false })
        .success
    ).toBe(true);
    // A number-or-list union is admitted the same way.
    ce.declare('u', 'number | list<number>');
    expect(run(ce, 'V + u', { V: [1, 2], u: pt(10) }).out).toEqual([
      [11, 11],
      [12, 12],
    ]);
    expect(run(ce, 'V + u', { V: [1, 2], u: [10, 20] }).out).toEqual([
      [11, 11],
      [22, 22],
    ]);
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
    // The call returns `broadcastable<number>` (its body reads wide
    // parameters), so the kernel over it broadcasts: the scalar the call
    // answers at run time is applied to directly.
    expect(code).toBe('_IA.bcast((_tv1) => _IA.sin(_tv1), _fn_P(_.x, _.y))');
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
    // The four-element array is a constant of the artifact (`_k5`), bound
    // once after its elements rather than built at the read on every call.
    expect(code).toBe('_IA.at(_k5, _.y)');
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
    // A collection beside a scalar is the same reduction, as in the
    // interpreter: the collection is flattened into the operand list. This
    // shape was gated until the scalar operands were folded with the
    // reduction of the collection.
    expectEncloses(run(ce, '\\max(1, V)', { V: [1, 5, 2] }).out, 5);
    expectEncloses(run(ce, '\\max(7, V)', { V: [1, 5, 2] }).out, 7);
    // An empty collection beside a scalar contributes nothing.
    expectEncloses(run(ce, '\\max(1, V)', { V: [] }).out, 1);
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

// A coordinate accessor (`PointX`/`PointY`/`PointZ`) over a LIST of points
// broadcasts the coordinate over the list, as the interpreter and the
// JavaScript target do, and answers a collection value: the array of the
// coordinates. Over a point-OR-point-list union (the parameter a helper reads
// with `PointX(v)`), the run-time `_IA.pointComponent` decides at the value.
// The result feeds the same consumers as any collection value: an accessor,
// a reduction, the element-wise broadcast of a kernel, the root.
describe('Interval target — a coordinate accessor over a list of points', () => {
  const POINTS = [
    [1, 2],
    [3, 4],
  ];
  function pointEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('PL', 'list<tuple<number, number>>');
    ce.declare('c', 'tuple<number, number> | list<tuple<number, number>>');
    ce.declare('R', 'list<list<number>>');
    ce.declare('k', 'integer');
    ce.declare('U', 'list<number> | number');
    return ce;
  }

  test('a declared list of points answers the array of coordinates', () => {
    const ce = pointEngine();
    const r = compile(ce.box(['PointY', 'PL']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('_IA.pointComponent(_.PL, 1, true, true)');
    expect(bands(r.run!({ PL: POINTS }))).toEqual([
      [2, 2],
      [4, 4],
    ]);
    // An interval-valued coordinate keeps its band.
    expect(
      bands(r.run!({ PL: [[1, { lo: 0, hi: 1 }], [3, 4]] }))
    ).toEqual([
      [0, 1],
      [4, 4],
    ]);
    // Zero points have zero coordinates.
    expect(r.run!({ PL: [] })).toEqual([]);
    // A list of numeric coordinate ROWS is a list of points too.
    expect(
      bands(compile(ce.box(['PointX', 'R']), { to: 'interval-js' }).run!({
        R: POINTS,
      }))
    ).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });

  test('a point-or-point-list union is decided at the value', () => {
    const ce = pointEngine();
    const r = compile(ce.box(['PointY', 'c']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('_IA.pointComponent(_.c, 1)');
    expect(bands(r.run!({ c: POINTS }))).toEqual([
      [2, 2],
      [4, 4],
    ]);
    expect(bands(r.run!({ c: [1, 2] }))).toEqual([2, 2]);
    expect(r.run!({ c: [] })).toEqual([]);
    // A value that is not a point at all answers the absence marker.
    const absent = r.run!({ c: pt(1) }) as { lo: number };
    expect(Number.isNaN(absent.lo)).toBe(true);
  });

  test('a third coordinate over two-component points is absent as a whole', () => {
    const ce = pointEngine();
    // The canonical `PointZ` rejects a DECLARED 2-D list; a union whose arity
    // the type does not settle reaches the run-time helper, which answers the
    // interpreter's whole-application error as one absence marker, never one
    // marker per point.
    const r = compile(ce.box(['PointZ', 'c']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    const absent = r.run!({ c: POINTS }) as { lo: number };
    expect(Array.isArray(absent)).toBe(false);
    expect(Number.isNaN(absent.lo)).toBe(true);
    expect(
      bands(
        r.run!({
          c: [
            [1, 2, 3],
            [4, 5, 6],
          ],
        })
      )
    ).toEqual([
      [3, 3],
      [6, 6],
    ]);
  });

  test('a coordinate the type proves is not a number declines', () => {
    const ce = pointEngine();
    ce.declare('S', 'list<tuple<string, number>>');
    ce.declare('T', 'tuple<string, number>');
    declines(ce, ['PointX', 'S'], /coordinate is not a number/);
    // The single point is refused one step earlier, by the object-domain
    // absence gate: the accessor's own type is `missing | string`.
    declines(ce, ['PointX', 'T'], /object-domain absent/);
    // The numeric coordinate of the same points compiles, and the proven
    // list-of-points reading is stated to the helper: a point whose first
    // coordinate is text would otherwise fail its row test at run time.
    const numeric = compile(ce.box(['PointY', 'S']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(numeric.success).toBe(true);
    expect(numeric.code).toBe('_IA.pointComponent(_.S, 1, true, true)');
    expect(
      bands(
        numeric.run!({
          S: [
            ['a', 2],
            ['b', 4],
          ],
        })
      )
    ).toEqual([
      [2, 2],
      [4, 4],
    ]);
  });

  test('the coordinates feed an accessor, a reduction and a kernel', () => {
    const ce = pointEngine();
    const at = compile(ce.box(['At', ['PointY', 'PL'], 'k']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(at.success).toBe(true);
    expect(at.code).toBe('_IA.at(_IA.pointComponent(_.PL, 1, true, true), _.k)');
    expect(bands(at.run!({ PL: POINTS, k: pt(2) }))).toEqual([4, 4]);

    const length = compile(ce.box(['Length', ['PointX', 'PL']]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(length.success).toBe(true);
    expect(bands(length.run!({ PL: POINTS }))).toEqual([2, 2]);

    const sum = compile(ce.box(['Sum', ['PointY', 'PL']]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(sum.success).toBe(true);
    expectEncloses(bands(sum.run!({ PL: POINTS })), 6);

    // A kernel over the coordinates is the element-wise broadcast.
    const plus = compile(ce.box(['Add', ['PointY', 'PL'], 1]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(plus.success).toBe(true);
    expect(plus.code).toBe(
      '_IA.bcast((_tv1) => _IA.add(_tv1, _k1), _IA.pointComponent(_.PL, 1, true, true))'
    );
    expect(bands(plus.run!({ PL: POINTS }))).toEqual([
      [3, 3],
      [5, 5],
    ]);
    const sine = compile(ce.box(['Sin', ['PointX', 'PL']]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(sine.success).toBe(true);
    expectEncloses(bands(sine.run!({ PL: POINTS })), [
      Math.sin(1),
      Math.sin(3),
    ]);
  });

  test('a number-or-number-list union broadcasts and reduces at the value', () => {
    const ce = pointEngine();
    // `PointY(c)` over the union types `list<number> | missing | number`, and
    // so does a declared `U`. Before this lowering the kernel was emitted on
    // the union directly (`_IA.add(_.U, …)`), which answered NaN bounds for
    // an array behind `success: true`.
    const plus = compile(ce.parse('U + 1'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(plus.success).toBe(true);
    expect(plus.code).toBe(
      '_IA.bcast((_tv1) => _IA.add(_tv1, _k1), _.U)'
    );
    expect(bands(plus.run!({ U: [1, 2] }))).toEqual([
      [2, 2],
      [3, 3],
    ]);
    expect(bands(plus.run!({ U: pt(1) }))).toEqual([2, 2]);

    const shifted = compile(ce.parse('\\operatorname{PointY}(c) + x'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(shifted.success).toBe(true);
    expect(bands(shifted.run!({ c: POINTS, x: { lo: 0, hi: 1 } }))).toEqual([
      [2, 3],
      [4, 5],
    ]);
    expect(bands(shifted.run!({ c: [1, 2], x: { lo: 0, hi: 1 } }))).toEqual([
      2, 3,
    ]);

    const max = compile(ce.box(['Max', ['PointY', 'c']]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(max.success).toBe(true);
    expect(bands(max.run!({ c: POINTS }))).toEqual([4, 4]);
    expect(bands(max.run!({ c: [1, 2] }))).toEqual([2, 2]);
    const sum = compile(ce.box(['Sum', 'U']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(sum.success).toBe(true);
    expectEncloses(bands(sum.run!({ U: [1, 2] })), 3);
    expectEncloses(bands(sum.run!({ U: pt(5) })), 5);
  });

  test('a helper reading a coordinate of its parameter maps over a list', () => {
    const ce = pointEngine();
    // The parameter a helper reads with `PointY(v)` types
    // `collection<any> | tuple`, and the accessor over it types `unknown`;
    // the lowering decides at the value and the kernel broadcasts over it.
    ce.parse('g(v) := \\operatorname{PointY}(v) + 1').evaluate();
    const r = compile(ce.box(['g', 'PL']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.preamble).toContain(
      '_IA.bcast((_tv1) => _IA.add(_tv1, _k1), _IA.pointComponent(v, 1))'
    );
    expect(bands(r.run!({ PL: POINTS }))).toEqual([
      [3, 3],
      [5, 5],
    ]);
    const single = compile(ce.box(['g', ['Tuple', 1, 2]]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(single.success).toBe(true);
    expect(bands(single.run!({}))).toEqual([3, 3]);

    // The call returns `broadcastable<number>`: a number or a collection of
    // numbers. A kernel over it broadcasts, an accessor and a reduction read
    // it at the value; each used to read the array as a scalar (NaN bounds
    // behind `success: true`) or decline.
    const above = compile(ce.box(['Add', ['g', 'PL'], 1]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(above.success).toBe(true);
    expect(bands(above.run!({ PL: POINTS }))).toEqual([
      [4, 4],
      [6, 6],
    ]);
    const second = compile(ce.box(['At', ['g', 'PL'], 2]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(second.success).toBe(true);
    expect(bands(second.run!({ PL: POINTS }))).toEqual([5, 5]);
    const count = compile(ce.box(['Length', ['g', 'PL']]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(count.success).toBe(true);
    expect(bands(count.run!({ PL: POINTS }))).toEqual([2, 2]);
    const largest = compile(ce.box(['Max', ['g', 'PL']]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(largest.success).toBe(true);
    expect(bands(largest.run!({ PL: POINTS }))).toEqual([5, 5]);

    // A helper whose body squares a coordinate, called with a list of points:
    // the kernels inside the body broadcast over the coordinate arrays.
    ce.declare('a', 'real');
    ce.parse('f(P) := a P.x^2 + P.y^2').evaluate();
    const quad = compile(ce.box(['f', 'PL']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(quad.success).toBe(true);
    expectEncloses(bands(quad.run!({ a: pt(2), PL: POINTS })), [6, 34]);
    expectEncloses(bands(quad.run!({ a: pt(2), PL: [1, 2] })), 6);
  });

  test('a point-valued helper is read by the accessor', () => {
    const ce = pointEngine();
    // A helper whose body is a `PointList` of scalars (`U = (x, y)` in a
    // document) is one point; its body root is spelled as the array of its
    // coordinates, and the accessor reads one back. With a list argument the
    // call is mapped (`_IA.bcastFn`) and the accessor broadcasts.
    ce.parse('U(x, y) := \\operatorname{PointList}(x^2 - y^2, 2 x y)').evaluate();
    const r = compile(ce.parse('\\operatorname{PointY}(U(x, y))'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('_IA.component(_fn_U(_.x, _.y), 1)');
    expect(r.preamble).toContain(
      'const _fn_U = (x, y) => [_IA.sub(_IA.square(x), _IA.square(y)), _IA.mul(_IA.scale(_k1, x), y)]'
    );
    expect(bands(r.run!({ x: pt(2), y: pt(3) }))).toEqual([12, 12]);
    ce.declare('L', 'list<number>');
    const mapped = compile(ce.box(['PointY', ['U', 'L', 1]]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(mapped.success).toBe(true);
    expect(mapped.code).toBe(
      '_IA.pointComponent(_IA.bcastFn((_tv1, _tv2) => _fn_U(_tv1, _tv2), _.L, _k2), 1, true, true)'
    );
    expect(bands(mapped.run!({ L: [1, 2] }))).toEqual([
      [2, 2],
      [4, 4],
    ]);
    // A `PointList` with a broadcasting component is a LIST of points, built
    // at run time; the scalar component is the same coordinate of every
    // point.
    const zipped = compile(ce.box(['PointY', ['PointList', 'L', 1]]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(zipped.success).toBe(true);
    expect(bands(zipped.run!({ L: [1, 2] }))).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  test('a union that the broadcast does not admit fails closed at the kernel', () => {
    const ce = pointEngine();
    ce.declare('w', 'value');
    // The other operand is not provably a number, so the element-wise
    // lowering does not apply, and the kernel must not read a possible array.
    declines(ce, ['Add', 'U', 'w'], /may be a collection at run time/);
    ce.declare('v', 'collection<any> | tuple');
    declines(ce, ['Add', ['PointY', 'v'], 'w'], /may be a collection at run time/);
    // A union with an indexed-collection arm that is not a list of numbers
    // (`list<list<number>> | number`) is refused by the same gate.
    ce.declare('N', 'list<list<number>> | number');
    declines(ce, ['Add', 'N', 1], /may be a collection at run time/);
    // A relation over the union or accessor shapes fails closed too: a list
    // of verdicts is not a value of this target, and a scalar kernel would
    // answer one `'maybe'` for an array.
    declines(ce, ['Less', 'U', 3], /may be a collection at run time/);
    declines(ce, ['Less', ['PointY', 'v'], 3], /may be a collection at run time/);
    // A head that does not broadcast on this target — a relation — keeps its
    // scalar lowering over a `broadcastable<number>` operand: the implicit
    // plot of a helper returning that type is a scalar comparison at run time.
    ce.parse('d(a, b) := a[1] b[1] + a[2] b[2]').evaluate();
    ce.parse('P(x, y) := d([x, y], [x, y])').evaluate();
    expect(ce.box('P').type.toString()).toContain('broadcastable<number>');
    const plot = compile(ce.parse('P(x, y) < 1'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(plot.success).toBe(true);
    expect(plot.code).toBe('_IA.less(_fn_P(_.x, _.y), _k1)');
    expect(plot.run!({ x: pt(0.5), y: pt(0.5) })).toBe('true');
    // A POINT-or-point-list union is not a list of numbers: a point has no
    // interval reading (the 2026-08-22 decision).
    declines(ce, ['Add', 'c', 1]);
  });
});

// A `PointList` whose components are list-typed SYMBOLS is a list of points:
// the interpreter and the JavaScript target zip the sources to the length of
// the SHORTEST one, and reuse a scalar component at every point. The interval
// target builds the same list at run time (`_IA.pointList`). Every value is
// compared with the interpreter's, evaluated on a separate engine so that no
// symbol of the compiling engine holds a value (a symbol with a value is
// folded into the code at compile time).
describe('Interval target — a PointList of list-typed symbols', () => {
  function zipEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('L_1', 'list<real>');
    ce.declare('L_2', 'list<real>');
    ce.declare('A', 'list<real>');
    ce.declare('B', 'list<real> | real');
    return ce;
  }

  /** The interpreter's numeric value of `expr` with `values` substituted. */
  function interpreted(
    expr: any,
    values: Record<string, number | number[]>
  ): any {
    const ce = zipEngine();
    const subs: Record<string, any> = {};
    for (const [k, v] of Object.entries(values))
      subs[k] = ce.box(Array.isArray(v) ? ['List', ...v] : v);
    const value = (
      typeof expr === 'string' ? ce.parse(expr) : ce.box(expr)
    )
      .subs(subs)
      .N();
    return value.isCollection
      ? [...value.each()].map((x) => x.re)
      : value.re;
  }

  /** Compile on interval-js, run with `values`, and check the result
   *  encloses the interpreter's value. */
  function agrees(
    expr: any,
    values: Record<string, number | number[]>
  ): string {
    const ce = zipEngine();
    const boxed = typeof expr === 'string' ? ce.parse(expr) : ce.box(expr);
    const r = compile(boxed, { to: 'interval-js', fallback: false });
    expect(r.success).toBe(true);
    const vars: Record<string, any> = {};
    for (const [k, v] of Object.entries(values))
      vars[k] = Array.isArray(v) ? v : pt(v);
    expectEncloses(bands(r.run!(vars)), interpreted(expr, values));
    return r.code;
  }

  const PX = ['PointX', ['PointList', 'L_1', 'L_2']];
  const PY = ['PointY', ['PointList', 'L_1', 'L_2']];

  test('sources of equal length', () => {
    const values = { L_1: [1, 2, 3], L_2: [4, 5, 6] };
    expect(agrees(PX, values)).toBe(
      "_IA.pointComponent(_IA.pointList('ll', _.L_1, _.L_2), 0, true, true)"
    );
    agrees(PY, values);
    agrees(['Min', PX], values);
  });

  test('sources of different lengths are truncated to the shortest', () => {
    const values = { L_1: [1, 2, 3], L_2: [4, 5] };
    expect(interpreted(PX, values)).toEqual([1, 2]);
    agrees(PX, values);
    agrees(PY, values);
    agrees(['Max', PX], values);
    // Zero points have zero coordinates.
    agrees(PX, { L_1: [], L_2: [4, 5] });
  });

  test('a scalar component is the same coordinate of every point', () => {
    const values = { L_1: [1, 2, 3] };
    agrees(['PointX', ['PointList', 'L_1', 0]], values);
    agrees(['PointY', ['PointList', 'L_1', 0]], values);
  });

  test('the sum of two point lists', () => {
    // The spelling of the Tycho document D-274: a list of points plus a
    // scaled list of unit vectors. `A` has the length of the `L_k`, as the
    // interpreter requires of two lists added element by element.
    const expr = [
      'Min',
      [
        'PointX',
        [
          'Add',
          ['PointList', 'L_1', 'L_2'],
          [
            'Multiply',
            ['Rational', 1, 20],
            ['PointList', ['Cos', 'A'], ['Sin', 'A']],
          ],
        ],
      ],
    ];
    agrees(expr, { L_1: [1, 2, 3], L_2: [4, 5, 6], A: [0.1, 0.2, 0.3] });
    // Sources of different lengths inside one `PointList` are truncated
    // before the sum.
    agrees(expr, { L_1: [1, 2, 3], L_2: [4, 5], A: [0.1, 0.2] });
  });

  test('the Voronoi field of a point list', () => {
    const P = ['PointList', 'L_1', 'L_2'];
    const field = [
      'Sin',
      [
        'Multiply',
        120,
        [
          'Sqrt',
          [
            'Min',
            [
              'Add',
              ['Power', ['Subtract', 'x', ['PointX', P]], 2],
              ['Power', ['Subtract', 'y', ['PointY', P]], 2],
            ],
          ],
        ],
      ],
    ];
    agrees(field, { L_1: [0.1, 0.5, 0.9], L_2: [0.2, 0.8], x: 0.3, y: 0.7 });
    agrees(field, { L_1: [0.1, 0.5], L_2: [0.2, 0.8], x: 0.45, y: 0.1 });
  });

  test('the parse route', () => {
    const latex =
      '\\min(\\operatorname{PointX}(\\operatorname{PointList}(L_1, L_2)))';
    expect(agrees(latex, { L_1: [3, 1, 2], L_2: [4, 5] })).toContain(
      "_IA.pointList('ll', _.L_1, _.L_2)"
    );
  });

  test('a source that is not an array at run time', () => {
    // The run-time helper throws the JavaScript target's error, which the
    // compiled function reports as `entire` ("cannot bound this").
    expect(() => IntervalArithmetic.pointList('ll', 3, [1])).toThrow(
      /PointList: source component 1 is not an array at run time/
    );
    const ce = zipEngine();
    const r = compile(ce.box(PX), { to: 'interval-js', fallback: false });
    expect(r.run!({ L_1: pt(3), L_2: [1] })).toEqual({ kind: 'entire' });
  });

  test('a component with no stated role fails closed', () => {
    // A number-or-list component (`B`) and an untyped one (`x`) may be a
    // source or a slot at run time; the JavaScript target decides at the
    // value, this target declines.
    declines(zipEngine(), ['PointX', ['PointList', 'L_1', 'B']], /PointList/);
    declines(zipEngine(), ['PointX', ['PointList', 'L_1', 'x']], /PointList/);
  });
});

// Point ARITHMETIC. A point is the array of its coordinate intervals, and the
// interpreter's arithmetic over points is coordinate-wise: point ± point,
// scalar × point, point / scalar, the negation of a point. A point beside a
// LIST is not a zip — the interpreter answers one point per element of the
// list — and the run-time value cannot tell a point from a list of two
// numbers, so the lowering is `_IA.bcastPoint`, which is told which arguments
// are point-valued (`'p'`) and which are number-valued (`'s'`). The heads
// that read a point whole (`Abs`, the norm) and the elementary functions keep
// the scalar gate.
describe('Interval target — point arithmetic', () => {
  function pointEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number>');
    ce.declare('Q', 'tuple<number, number>');
    ce.declare('s', 'number');
    ce.declare('V', 'list<number>');
    ce.declare('w', 'broadcastable<number>');
    ce.declare('LP', 'list<tuple<number, number>>');
    ce.declare('c', 'tuple<number, number> | list<tuple<number, number>>');
    return ce;
  }
  const INPUTS = {
    P: [1, 2],
    Q: [10, 20],
    s: pt(4),
    V: [1, 2, 3],
    w: pt(2),
    LP: [
      [1, 2],
      [3, 4],
    ],
    c: [5, 6],
  };
  function value(ce: ComputeEngine, expr: any, vars: Record<string, any>) {
    const r = compile(ce.box(expr), { to: 'interval-js', fallback: false });
    expect(r.success).toBe(true);
    return { code: r.code, out: bands(r.run!(vars)) };
  }

  test('point ± point, scalar × point, point / scalar, negation', () => {
    const ce = pointEngine();
    const sum = value(ce, ['Add', 'P', 'Q'], INPUTS);
    expect(sum.code).toBe(
      "_IA.bcastPoint((_tv1, _tv2) => _IA.add(_tv1, _tv2), 'pp', _.P, _.Q)"
    );
    expect(sum.out).toEqual([
      [11, 11],
      [22, 22],
    ]);
    expect(value(ce, ['Subtract', 'P', 'Q'], INPUTS).out).toEqual([
      [-9, -9],
      [-18, -18],
    ]);
    expect(value(ce, ['Multiply', 's', 'P'], INPUTS).out).toEqual([
      [4, 4],
      [8, 8],
    ]);
    // A number literal stays in the closure body.
    const doubled = value(ce, ['Multiply', 2, 'P'], INPUTS);
    expect(doubled.code).toBe(
      "_IA.bcastPoint((_tv1) => _IA.scale(_k1, _tv1), 'p', _.P)"
    );
    expect(doubled.out).toEqual([
      [2, 2],
      [4, 4],
    ]);
    expect(value(ce, ['Divide', 'P', 's'], INPUTS).out).toEqual([
      [0.25, 0.25],
      [0.5, 0.5],
    ]);
    expect(value(ce, ['Negate', 'P'], INPUTS).out).toEqual([
      [-1, -1],
      [-2, -2],
    ]);
  });

  test('a literal point operand, and a coordinate read back', () => {
    const ce = pointEngine();
    const shifted = value(ce, ['Add', 'P', ['Tuple', 'x', 'y']], {
      ...INPUTS,
      x: { lo: 0, hi: 1 },
      y: pt(5),
    });
    expect(shifted.code).toBe(
      "_IA.bcastPoint((_tv1, _tv2) => _IA.add(_tv1, _tv2), 'pp', _.P, [_.x, _.y])"
    );
    expect(shifted.out).toEqual([
      [1, 2],
      [7, 7],
    ]);
    const x = value(ce, ['PointX', ['Add', 'P', 'Q']], INPUTS);
    expect(x.code).toBe(
      "_IA.component(_IA.bcastPoint((_tv1, _tv2) => _IA.add(_tv1, _tv2), 'pp', _.P, _.Q), 0)"
    );
    expect(x.out).toEqual([11, 11]);
  });

  test('a list of numbers times a point is one point per element', () => {
    const ce = pointEngine();
    // The interpreter: `[1, 2]·(10, 20)` is `[(10, 20), (20, 40)]` — for a
    // two-element list too, which a plain zip would read as one point.
    expect(
      ce.box(['Multiply', ['List', 1, 2], ['Tuple', 10, 20]]).evaluate().json
    ).toEqual(['List', ['Tuple', 10, 20], ['Tuple', 20, 40]]);
    const scaled = value(ce, ['Multiply', 'V', 'Q'], { ...INPUTS, V: [1, 2] });
    expect(scaled.code).toBe(
      "_IA.bcastPoint((_tv1, _tv2) => _IA.mul(_tv1, _tv2), 'ps', _.Q, _.V)"
    );
    expect(scaled.out).toEqual([
      [
        [10, 10],
        [20, 20],
      ],
      [
        [20, 20],
        [40, 40],
      ],
    ]);
    // A `broadcastable<number>` beside a point is decided at the value.
    expect(value(ce, ['Multiply', 'w', 'P'], INPUTS).out).toEqual([
      [2, 2],
      [4, 4],
    ]);
    expect(
      value(ce, ['Multiply', 'w', 'P'], { ...INPUTS, w: [1, 3] }).out
    ).toEqual([
      [
        [1, 1],
        [2, 2],
      ],
      [
        [3, 3],
        [6, 6],
      ],
    ]);
  });

  test('a list of points, and a point-or-point-list union, are point-valued', () => {
    const ce = pointEngine();
    // The interpreter: a list of points plus a point adds the point to every
    // element; two lists of points zip; a list of numbers times a list of
    // points zips too.
    expect(
      ce
        .box([
          'Add',
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
          ['Tuple', 1, 2],
        ])
        .evaluate().json
    ).toEqual(['List', ['Tuple', 2, 4], ['Tuple', 4, 6]]);
    expect(value(ce, ['Add', 'LP', 'P'], INPUTS).out).toEqual([
      [
        [2, 2],
        [4, 4],
      ],
      [
        [4, 4],
        [6, 6],
      ],
    ]);
    expect(value(ce, ['Add', 'LP', 'LP'], INPUTS).out).toEqual([
      [
        [2, 2],
        [4, 4],
      ],
      [
        [6, 6],
        [8, 8],
      ],
    ]);
    expect(
      value(ce, ['Multiply', 'V', 'LP'], { ...INPUTS, V: [1, 2] }).out
    ).toEqual([
      [
        [1, 1],
        [2, 2],
      ],
      [
        [6, 6],
        [8, 8],
      ],
    ]);
    // The union is one point or a list of them, decided at the value.
    expect(value(ce, ['Add', 'c', 'P'], INPUTS).out).toEqual([
      [6, 6],
      [8, 8],
    ]);
    expect(
      value(ce, ['Add', 'c', 'P'], {
        ...INPUTS,
        c: [
          [5, 6],
          [7, 8],
        ],
      }).out
    ).toEqual([
      [
        [6, 6],
        [8, 8],
      ],
      [
        [8, 8],
        [10, 10],
      ],
    ]);
    // A list of LISTS of points descends level by level, and the point keeps
    // its identity at every level.
    ce.declare('M', 'list<list<tuple<number, number>>>');
    expect(
      value(ce, ['Add', 'M', 'P'], {
        ...INPUTS,
        M: [
          [
            [1, 2],
            [3, 4],
          ],
        ],
        P: [10, 20],
      }).out
    ).toEqual([
      [
        [
          [11, 11],
          [22, 22],
        ],
        [
          [13, 13],
          [24, 24],
        ],
      ],
    ]);
    // Zero points are the empty list, not one point with no coordinates.
    const none = value(ce, ['Add', 'LP', 'P'], { ...INPUTS, LP: [] });
    expect(none.code).toBe(
      "_IA.bcastPoint((_tv1, _tv2) => _IA.add(_tv1, _tv2), 'qp', _.LP, _.P)"
    );
    expect(none.out).toEqual([]);
    // Lists of different lengths have no value.
    const absent = compile(ce.box(['Multiply', 'V', 'LP']), {
      to: 'interval-js',
      fallback: false,
    }).run!(INPUTS) as { lo: number };
    expect(Number.isNaN(absent.lo)).toBe(true);
    // The coordinates of the result are read back as a list.
    expect(value(ce, ['PointX', ['Add', 'LP', 'P']], INPUTS).out).toEqual([
      [2, 2],
      [4, 4],
    ]);
  });

  test('the run-time kinds: one point, a point or a list of points, a number', () => {
    const add = (a: unknown, b: unknown) =>
      IntervalArithmetic.add(a as never, b as never);
    // `'p'` is exactly one point and is never inspected: a coordinate that is
    // itself an array (the value of a `broadcastable<number>` coordinate) is
    // zipped like any nested array, and the point is not read as a list.
    expect(
      bands(
        IntervalArithmetic.bcastPoint(add, 'pp', [[1, 2], pt(5)], [pt(1), pt(2)])
      )
    ).toEqual([
      [
        [2, 2],
        [3, 3],
      ],
      [7, 7],
    ]);
    // `'q'` is decided at the value; an empty list beside a non-empty one has
    // no value.
    const absent = IntervalArithmetic.bcastPoint(add, 'qq', [], [[1, 2]]) as {
      lo: number;
    };
    expect(Number.isNaN(absent.lo)).toBe(true);
  });

  test('the heads that are not point arithmetic keep the gate', () => {
    const ce = pointEngine();
    // The elementary functions: the 2026-09-15 decision "a point is consumed
    // whole, never mapped over" stands for them.
    declines(ce, ['Sin', 'P'], /Sin: cannot compile/);
    declines(ce, ['Power', 'P', 2], /Power: cannot compile/);
    // `Abs` of a point is its norm, not a coordinate-wise absolute value.
    declines(ce, ['Abs', 'P']);
    // A point whose coordinate is proved not to be a number is no operand.
    ce.declare('S', 'tuple<string, number>');
    declines(ce, ['Negate', 'S']);
  });

  test('a point-valued helper with a DECLARED return type', () => {
    const ce = pointEngine();
    // A document host declares every function before assigning it, so the
    // call of a point-valued helper inlines to its body under a return-type
    // ascription, `Typed((p, q), 'tuple<number, number>')`. The ascription is
    // transparent: the point under it is spelled as the array of its
    // coordinates wherever a point is consumed.
    ce.declare('U', { signature: '(any, any) -> tuple<number, number>' });
    ce.assign('U', ce.parse('(p, q) \\mapsto (p, q)'));
    ce.parse('l(V) := \\sqrt{V.x^2 + V.y^2}').evaluate();
    for (const [latex, want] of [
      ['\\operatorname{PointY}(U(x, y))', 0.2],
      ['l(U(x, y))', Math.hypot(0.3, 0.2)],
      ['l(U(x, y) - (1, 2))', Math.hypot(0.7, 1.8)],
    ] as const) {
      const r = compile(ce.parse(latex), {
        to: 'interval-js',
        fallback: false,
      });
      expect(r.success).toBe(true);
      expectEncloses(bands(r.run!({ x: pt(0.3), y: pt(0.2) })), want);
    }
    // A CONTRADICTED scalar declaration is not read through: its list body
    // keeps declining (the 2026-08-22 decision).
    ce.declare('g', '(number) -> number');
    ce.assign(
      'g',
      ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
    );
    declines(ce, ['g', 'u'], /List/);
  });

  test('a helper chain that rotates, translates and measures a point', () => {
    const ce = pointEngine();
    // The shape of the Tycho census documents `hpr2q4kles` and `mqm2eamst1`:
    // helpers that build points with arithmetic and read them back by
    // coordinate, under a scalar root.
    for (const d of [
      'U(x, y) := (x, y)',
      'C(D, d) := (\\frac{D-d}{2}, 0)',
      'r(V, a) := V.x\\cdot(\\cos(a), \\sin(a)) + V.y\\cdot(-\\sin(a), \\cos(a))',
      'l(V) := \\sqrt{V.x^2 + V.y^2}',
      'K(a) := \\frac{(a.x, -a.y)}{a.x^2 + a.y^2}',
      'M(a, b) := (a.x\\cdot b.x - a.y\\cdot b.y, a.x\\cdot b.y + a.y\\cdot b.x)',
    ])
      ce.parse(d).evaluate();
    for (const latex of [
      'l(r(U(x, y), 0.7) - C(3, 1))',
      'l(M(U(1, 2), K(U(x, y)))) - 1',
    ]) {
      const e = ce.parse(latex);
      const r = compile(e, { to: 'interval-js', fallback: false });
      expect(r.success).toBe(true);
      const want = e.subs({ x: 0.3, y: 0.2 }).N().re;
      expect(Number.isFinite(want)).toBe(true);
      expectEncloses(bands(r.run!({ x: pt(0.3), y: pt(0.2) })), want);
    }
  });
});

// A `Which` whose arms are lists — or a list in one arm and a number in
// another — at a position that consumes the value whole: the body root of a
// helper, an argument the callee binds whole, an accessor or reducer operand,
// the compilation root. The arms take the collection spelling, the conditions
// stay scalar, and the run-time hull of an undecided condition is
// element-wise over two lists and the absence marker over a list against a
// number (no one value encloses both). A scalar position is unchanged: a
// kernel is handed the selection through the element-wise broadcast when its
// type admits a list, and a list of verdicts, or a relation over the
// selection, keeps declining. The witness is the Tycho document
// `sgtdqnj2ox`, whose helper `H(x, y) := {B(x, y) > 0: 0, h(⌊x⌋, ⌊y⌋)·2 − 1}`
// answers a number or a list, read by a dot product and a norm.
describe('Interval target — a selection among list values', () => {
  const which = (ce: ComputeEngine, ...arms: any[]) =>
    ce.box(['Which', ['Greater', 'x', 0], arms[0], 'True', arms[1]]);
  function selectionEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('A', 'list<number>');
    ce.parse('l(P) := \\sqrt{P[1]^2 + P[2]^2}').evaluate();
    ce.parse('d(a, b) := a[1] b[1] + a[2] b[2]').evaluate();
    // Z(x) is [x, x] for positive x and [x, 2x] otherwise; S(x) is 0 for
    // positive x and [x, 2x] otherwise — the `sgtdqnj2ox` shape.
    ce.assign(
      'Z',
      ce.box([
        'Function',
        which(ce, ['List', 'x', 'x'], ['List', 'x', ['Multiply', 2, 'x']]),
        'x',
      ])
    );
    ce.assign(
      'S',
      ce.box([
        'Function',
        which(ce, 0, ['List', 'x', ['Multiply', 2, 'x']]),
        'x',
      ])
    );
    return ce;
  }
  function run(ce: ComputeEngine, expr: any, vars: Record<string, any>) {
    const r = compile(
      typeof expr === 'string' ? ce.parse(expr) : ce.box(expr),
      { to: 'interval-js', fallback: false }
    );
    expect(r.success).toBe(true);
    return { code: r.code, preamble: r.preamble, out: bands(r.run!(vars)) };
  }

  test('a helper whose case arms are lists returns the selected list', () => {
    const ce = selectionEngine();
    expect(ce.box(['Z', 3]).evaluate().json).toEqual(['List', 3, 3]);
    expect(ce.box(['Z', -3]).evaluate().json).toEqual(['List', -3, -6]);
    // A collection-valued call is inlined at the compilation ROOT and as a
    // whole-bound argument (the rule every collection-valued call takes on
    // this target), so the selection appears at the call site.
    const z = run(ce, ['Z', 'x'], { x: pt(3) });
    expect(z.code).toBe(
      "((_tv1 = _IA.less(_k1, _.x)) === 'true' ? _IA.res([_.x, _.x]) : _tv1 === 'false' ? _IA.res([_.x, _IA.scale(_k2, _.x)]) : _IA.hull([_.x, _.x], [_.x, _IA.scale(_k2, _.x)]))"
    );
    expect(z.out).toEqual([
      [3, 3],
      [3, 3],
    ]);
    expect(run(ce, ['Z', 'x'], { x: pt(-3) }).out).toEqual([
      [-3, -3],
      [-6, -6],
    ]);
    // Undecided: the element-wise hull of the two lists (`2x` over
    // `[−1, 1]` is `[−2, 2]`).
    expect(run(ce, ['Z', 'x'], { x: { lo: -1, hi: 1 } }).out).toEqual([
      [-1, 1],
      [-2, 2],
    ]);
    // Consumed whole by a norm and a dot product.
    const norm = run(ce, 'l(Z(x))', { x: pt(3) });
    expect(norm.code).toBe(
      "_fn_l(((_tv1 = _IA.less(_k3, _.x)) === 'true' ? _IA.res([_.x, _.x]) : _tv1 === 'false' ? _IA.res([_.x, _IA.scale(_k2, _.x)]) : _IA.hull([_.x, _.x], [_.x, _IA.scale(_k2, _.x)])))"
    );
    expectEncloses(norm.out, Math.hypot(3, 3));
    expectEncloses(
      run(ce, ['d', ['Z', 'x'], ['List', 1, 1]], { x: pt(-3) }).out,
      -9
    );
  });

  test('a number in one arm and a list in the other', () => {
    const ce = selectionEngine();
    expect(run(ce, ['S', 'x'], { x: pt(3) }).out).toEqual([0, 0]);
    expect(run(ce, ['S', 'x'], { x: pt(-3) }).out).toEqual([
      [-3, -3],
      [-6, -6],
    ]);
    // Undecided across the two domains: no one value encloses both.
    const straddle = compile(ce.box(['S', 'x']), {
      to: 'interval-js',
      fallback: false,
    }).run!({ x: { lo: -1, hi: 1 } }) as { lo: number };
    expect(Number.isNaN(straddle.lo)).toBe(true);
    // The dot product over the list arm is the interpreter's value; over the
    // number arm the interpreter answers an error (`0[1]` is not a value),
    // and this target answers the absence marker for the indexing of a
    // scalar — no value either way.
    expect(ce.parse('d(S(-3), [1, 1])').N().re).toBe(-9);
    expectEncloses(
      run(ce, ['d', ['S', 'x'], ['List', 1, 1]], { x: pt(-3) }).out,
      -9
    );
    expect(ce.parse('d(S(3), [1, 1])').N().operator).toBe('Error');
    const scalarArm = compile(ce.box(['d', ['S', 'x'], ['List', 1, 1]]), {
      to: 'interval-js',
      fallback: false,
    }).run!({ x: pt(3) }) as { value: { lo: number } };
    expect(Number.isNaN(scalarArm.value.lo)).toBe(true);
  });

  test('the selection at the root, and under a kernel', () => {
    const ce = selectionEngine();
    const root = run(
      ce,
      which(ce, ['List', 'x', 1], ['List', 1, 2]),
      { x: pt(3) }
    );
    expect(root.code).toBe(
      "((_tv1 = _IA.less(_k1, _.x)) === 'true' ? _IA.res([_.x, _k2]) : _tv1 === 'false' ? _IA.res(_k4) : _IA.hull([_.x, _k2], _k4))"
    );
    expect(root.out).toEqual([
      [3, 3],
      [1, 1],
    ]);
    // A kernel over the selection broadcasts over whichever arm is taken:
    // the type `integer | vector<2>` is a number or a list of numbers.
    const plus = run(ce, ['Add', which(ce, ['List', 'x', 1], 1), 1], {
      x: pt(3),
    });
    expect(plus.code).toBe(
      "_IA.bcast((_tv1) => _IA.add(_tv1, _k1), ((_tv2 = _IA.less(_k2, _.x)) === 'true' ? _IA.res([_.x, _k1]) : _tv2 === 'false' ? _IA.res(_k1) : _IA.hull([_.x, _k1], _k1)))"
    );
    expect(plus.out).toEqual([
      [4, 4],
      [2, 2],
    ]);
    expect(
      run(ce, ['Add', which(ce, ['List', 'x', 1], 1), 1], { x: pt(-3) }).out
    ).toEqual([2, 2]);
    expect(
      run(ce, ['Add', which(ce, ['List', 'x', 1], 'A'), 1], {
        x: pt(-3),
        A: [pt(5), pt(6)],
      }).out
    ).toEqual([
      [6, 6],
      [7, 7],
    ]);
  });

  test('an unreachable clause is not compiled, and an override is honored', () => {
    const ce = selectionEngine();
    // The clauses after an unconditional one are never reached; an
    // unsupported head there must not fail the expression (`Zeta` has no
    // interval lowering).
    const unreachable = run(
      ce,
      ce.box(['Which', 'True', ['List', 'x', 1], 'True', ['List', ['Zeta', 'x'], 1]]),
      { x: pt(3) }
    );
    expect(unreachable.out).toEqual([
      [3, 3],
      [1, 1],
    ]);
    // A caller-supplied `Which` implementation keeps its ordinary dispatch,
    // which compiles the arms as the override's operands: the selection
    // spelling is not taken, and a list arm then declines as it does at
    // every ordinary position of this target.
    const custom = compile(which(ce, ['List', 'x', 1], ['List', 1, 2]), {
      to: 'interval-js',
      fallback: false,
      functions: { Which: () => '_IA.point(42)' },
    });
    expect(custom.success).toBe(false);
    expect(custom.error).toMatch(/List/);
  });

  test('what keeps declining', () => {
    const ce = selectionEngine();
    // A list of verdicts is not a value of this target.
    declines(ce, which(ce, ['List', ['Less', 'x', 1], ['Less', 'x', 2]], 1), /List/);
    // A relation over the selection would be a list of verdicts too.
    declines(ce, ['Less', which(ce, ['List', 'x', 1], 1), 2], /List/);
    // The conditions stay scalar.
    declines(
      ce,
      ce.box(['Which', ['List', ['Less', 'x', 1]], ['List', 'x', 1], 'True', 1]),
      /branch condition is a collection/
    );
  });
});
