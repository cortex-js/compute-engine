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
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
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

/** The compilation declines: with `fallback: false` it throws, with the
 *  diagnostic `code` when one is given. */
function declines(ce: ComputeEngine, expr: any, code?: string): void {
  const boxed = typeof expr === 'string' ? ce.parse(expr) : ce.box(expr);
  let diagnostic: { code: string } | undefined;
  try {
    compile(boxed, { to: 'interval-js', fallback: false });
  } catch (e) {
    diagnostic = compileDiagnosticOf(e);
  }
  expect(diagnostic).toBeDefined();
  if (code !== undefined) expect(diagnostic!.code).toBe(code);
}

describe('Interval target — element-wise broadcast over a provable numeric list', () => {
  test('a list-typed input beside a scalar', () => {
    const { out } = run(engine(), 'V + 1', { V: [1, 2, 3] });
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
    const { out } = run(engine(), '\\sin(V) + \\sin(V) + \\cos(V)', {
      V: [1, 2],
    });
    expectEncloses(out, [
      2 * Math.sin(1) + Math.cos(1),
      2 * Math.sin(2) + Math.cos(2),
    ]);
  });

  test('an empty list gives the empty list', () => {
    const ce = engine();
    const r = compile(ce.parse('V \\cdot W'), { to: 'interval-js' });
    expect(r.success).toBe(true);
    // Lists whose lengths differ at run time are an error that the static
    // type does not show: the value is unspecified, and is not checked here.
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

  test('a relation over a list is the list of its verdicts', () => {
    // The interpreter gives `[True, False]` for `[0, 2] < 1`.
    const r = compile(engine().parse('V < 1'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.run!({ V: [0, 2] })).toEqual(['true', 'false']);
  });
});

describe('Interval target — collection values across a user-function boundary', () => {
  test('a helper whose body is a list returns an array', () => {
    const { code, out } = run(engine(), '\\sin(H(x, y))', {
      x: pt(0.3),
      y: pt(0.7),
    });
    // `x` and `y` are declared `real`, so the call `H(x, y)` is a list of
    // two numbers at compile time, and the kernel applies to each element
    // of the inlined body. With `x` and `y` untyped, the call was
    // `_fn_H(_.x, _.y)` under a run-time broadcast (`_IA.bcast`).
    expect(code).toBe(
      '[_IA.sin(_IA.add(_.x, _.y)), _IA.sin(_IA.sub(_.x, _.y))]'
    );
    expectEncloses(out, [Math.sin(1), Math.sin(-0.4)]);
  });

  test('a scalar-parameter helper is mapped over a provable list argument', () => {
    const ce = engine();
    const { out } = run(ce, 'f(V)', { V: [1, 2, 3] });
    expectEncloses(out, [1, 4, 9]);
    // The interpreter zips zero elements into the empty list.
    const r = compile(ce.parse('f([])'), { to: 'interval-js' });
    expect(r.run!({})).toEqual([]);
  });

  test('a scalar-parameter helper over an unprovable list keeps the direct call', () => {
    // `x` is `unknown` here: the argument is not provably a collection, and
    // scalar curve plotting rides this target on exactly such calls.
    const ce = engine();
    const want = (v: number) => ce.parse('f(x)').subs({ x: v }).N().re;
    for (const v of [2, -0.5, 0])
      expectEncloses(run(ce, 'f(x)', { x: pt(v) }).out, want(v));
    const box = run(ce, 'f(x)', { x: { lo: 1, hi: 1.5 } }).out;
    for (const v of [1, 1.25, 1.5]) expectEncloses(box, want(v), 2);
  });

  test('a scalar-parameter helper over a set argument fails closed', () => {
    const ce = engine();
    ce.declare('S', 'set<number>');
    // A set is not an indexed collection: the shape of the call is not
    // settled, so the call declines.
    declines(ce, 'f(S)', 'outside-profile');
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
    const { out } = run(engine(), '(1..4)_{y}', { y: pt(3) });
    expectEncloses(out, 3);
  });

  test('arithmetic over a literal range is written out at the root', () => {
    const { out } = run(engine(), 'x - (3..9)', { x: pt(10) });
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

  test('a Map of a predicate is a list of verdicts, and its Sum declines', () => {
    // The interpreter gives `[False, False, False]` for n = 3.
    const mapped = compile(
      engine().box([
        'Map',
        ['Function', ['Less', 'k', 0], 'k'],
        ['Range', 1, 'n'],
      ]),
      { to: 'interval-js', fallback: false }
    );
    expect(mapped.run!({ n: pt(3) })).toEqual(['false', 'false', 'false']);
    declines(
      engine(),
      ['Sum', ['Map', ['Function', ['Less', 'k', 0], 'k'], ['Range', 1, 'n']]],
      'outside-profile'
    );
  });

  test('a range with a wide bound answers entire', () => {
    // n ∈ [3, 4] names two element counts; no array holds both.
    const { out } = run(engine(), '\\operatorname{total}((1..n)^2)', {
      n: { lo: 3, hi: 4 },
    });
    expect(out).toBe('entire');
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

  test('a symbol holding a lazy Map at the root', () => {
    const ce = engine();
    ce.assign('M', ce.parse('\\sin(10^4 \\cdot [1...3])').evaluate());
    const head = ce.box('M').value?.operator;
    expect(head === 'Map' || head === 'List').toBe(true);
    expectEncloses(
      run(ce, 'M', {}).out,
      [1, 2, 3].map((k) => Math.sin(1e4 * k)),
      1e-9
    );
  });
});

describe('Interval target — reductions over collection values', () => {
  test('Max/Min over a literal, a run-time array and the empty collection', () => {
    const ce = engine();
    expectEncloses(run(ce, '\\max([x, 2x, 1])', { x: pt(3) }).out, 6);
    expectEncloses(run(ce, '\\max(V)', { V: [1, 5, 2] }).out, 5);
    expectEncloses(run(ce, '\\min(V)', { V: [1, 5, 2] }).out, 1);
    // The interpreter's Max([]) is NaN: the absence marker here, which the
    // runner gives as `empty`.
    expect(run(ce, '\\max(V)', { V: [] }).out).toBe('empty');
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
    const { out } = run(engine(), '[x, 2x]', { x: pt(3) });
    expectEncloses(out, [3, 6]);
  });

  test('a list of booleans at the root is the list of its verdicts', () => {
    const r = compile(
      engine().box(['List', ['Less', 'x', 1], ['Less', 'x', 2]]),
      { to: 'interval-js', fallback: false }
    );
    // The interpreter gives `[False, True]` at x = 1.5.
    expect(r.run!({ x: pt(1.5) })).toEqual(['false', 'true']);
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

  // The type of a call of a block-local function declared `function` is
  // `any`, so the scalar kernels did not see that it returns an array.
  test('a call of a block-local function that returns a collection declines in a scalar position', () => {
    const literal = ['Function', ['Tuple', 'u', 2], 'u'];
    for (const use of [
      ['Add', ['f', 'x'], 1],
      ['Sin', ['f', 'x']],
    ])
      declines(
        engine(),
        ['Block', ['Declare', 'f', "'function'", literal], use],
        'outside-profile'
      );
  });

  // The check above sees only a call that is a DIRECT operand of a scalar
  // kernel. Through another function or a block local, the array reached a
  // kernel, which read it as NaN bounds behind `success: true`. The
  // interpreter gives an `incompatible-type` error for both shapes.
  test('a call of a block-local function that returns a collection declines when its value is not consumed whole', () => {
    const define = [
      ['Declare', 'f', "'function'", ['Function', ['Tuple', 'u', 2], 'u']],
    ];
    const SHAPES = [
      // Through the parameter of another block-local function.
      [
        'Block',
        ...define,
        ['Declare', 'g', "'function'", ['Function', ['Add', 'v', 1], 'v']],
        ['g', ['f', 'x']],
      ],
      // Through a block local.
      [
        'Block',
        ...define,
        ['Declare', 'w', "'unknown'", ['f', 'x']],
        ['Add', 'w', 1],
      ],
    ];
    for (const shape of SHAPES) {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      // Through the parameter of `g`, the argument `f(x)` has no settled
      // shape at a scalar parameter, and the call of `g` declines first.
      declines(ce, shape, 'outside-profile');
      expect(ce.box(shape as never).evaluate().toString()).toMatch(
        /incompatible-type/
      );
    }
  });

  test('a Block whose value is a list of booleans is the list of its verdicts', () => {
    const r = compile(
      engine().box([
        'Block',
        ['Declare', 'z', "'unknown'", 1],
        ['List', ['Less', 'x', 'z'], ['Less', 'x', 2]],
      ]),
      { to: 'interval-js', fallback: false }
    );
    // The interpreter gives `[False, True]` at x = 1.5.
    expect(r.run!({ x: pt(1.5) })).toEqual(['false', 'true']);
  });
});

describe('Interval target — the 2026-08-22 decisions that stay', () => {
  // A list body under a scalar declaration is refused when it is assigned.
  test('a contradicted scalar declaration is refused when it is assigned', () => {
    const ce = engine();
    ce.declare('s', '(number) -> number');
    expect(() =>
      ce.assign(
        's',
        ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
      )
    ).toThrow(/is not compatible with the type/);
  });

  // The body of `s` calls a helper `k` that is assigned after `s`, so the
  // assignment of `s` is accepted. The compiler sees that the body
  // constructs a list, and declines in each scalar position.
  test('a contradicted scalar declaration declines in a scalar position through a helper assigned later', () => {
    const ce = engine();
    ce.declare('s', '(number) -> number');
    ce.assign('s', ce.box(['Function', ['k', 't'], 't']));
    ce.assign(
      'k',
      ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
    );
    declines(ce, ['Add', ['s', 'u'], 1], 'outside-profile');
    declines(ce, ['Less', ['s', 'u'], 1], 'outside-profile');
    // Its bare call declines too: the declaration says it returns a scalar.
    declines(ce, ['s', 'u'], 'outside-profile');
  });

  test('a list-of-booleans helper declines in every position', () => {
    const ce = engine();
    ce.parse('b(t) := [t < 1, t < 2]').evaluate();
    declines(ce, ['Which', ['b', 'u'], 1, 'True', 2], 'outside-profile');
    declines(ce, ['b', 'u'], 'untyped-input');
    // Under the declaration `(number) -> boolean`, the list body is refused
    // when it is assigned.
    ce.declare('c', '(number) -> boolean');
    expect(() =>
      ce.assign(
        'c',
        ce.box(['Function', ['List', ['Less', 't', 1], ['Less', 't', 2]], 't'])
      )
    ).toThrow(/is not compatible with the type/);
    // Through a helper `ml` assigned after `cl`, the assignment of `cl` is
    // accepted, and its condition declines.
    ce.declare('cl', '(number) -> boolean');
    ce.assign('cl', ce.box(['Function', ['ml', 't'], 't']));
    ce.assign(
      'ml',
      ce.box(['Function', ['List', ['Less', 't', 1], ['Less', 't', 2]], 't'])
    );
    declines(ce, ['Which', ['cl', 'u'], 1, 'True', 2]);
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
// coordinates. The result feeds the same consumers as any collection value: an accessor,
// a reduction, the element-wise broadcast of a kernel, the root.
describe('Interval target — a coordinate accessor over a list of points', () => {
  const POINTS = [
    [1, 2],
    [3, 4],
  ];
  function pointEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
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

  test('a coordinate the type proves is not a number declines', () => {
    const ce = pointEngine();
    ce.declare('S', 'list<tuple<string, number>>');
    ce.declare('T', 'tuple<string, number>');
    declines(ce, ['PointX', 'S'], 'outside-profile');
    // The single point declines the same way.
    declines(ce, ['PointX', 'T'], 'outside-profile');
  });

  test('the coordinates feed an accessor, a reduction and a kernel', () => {
    const ce = pointEngine();
    const at = compile(ce.box(['At', ['PointY', 'PL'], 'k']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(at.success).toBe(true);
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

  test('a point-valued helper is read by the accessor', () => {
    const ce = pointEngine();
    // A helper whose body is a `PointList` of scalars (`U = (x, y)` in a
    // document) is one point; its body root is spelled as the array of its
    // coordinates, and the accessor reads one back.
    ce.parse('U(x, y) := \\operatorname{PointList}(x^2 - y^2, 2 x y)').evaluate();
    const r = compile(ce.parse('\\operatorname{PointY}(U(x, y))'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    // `x` and `y` are declared `real`, so the call is one point at compile
    // time, and the accessor reads its second coordinate from the inlined
    // body. With `x` and `y` untyped, the code was
    // `_IA.component(_fn_U(_.x, _.y), 1)`.
    expect(bands(r.run!({ x: pt(2), y: pt(3) }))).toEqual([12, 12]);
    ce.declare('L', 'list<number>');
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
    ce.declare('w', 'any');
    // The other operand is not provably a number, so the element-wise
    // lowering does not apply, and the kernel must not read a possible array.
    // `U` is declared with a union: the body of its member `list<number>`
    // declines, and the compilation declines with that reason.
    declines(ce, ['Add', 'U', 'w'], 'outside-profile');
    ce.declare('v', 'collection<any> | tuple');
    declines(ce, ['Add', ['PointY', 'v'], 'w'], 'outside-profile');
    // An operand declared `value` can be a number or a list, and declines
    // before the kernel, with the name of the symbol.
    ce.declare('z', 'value');
    declines(ce, ['Add', 'U', 'z'], 'outside-profile');
    // A union with an indexed-collection arm that is not a list of numbers
    // (`list<list<number>> | number`) declines: the body of its member
    // `list<list<number>>` declines, and the compilation with it.
    ce.declare('N', 'list<list<number>> | number');
    declines(ce, ['Add', 'N', 1], 'outside-profile');
    // A relation over the union or accessor shapes fails closed too: a list
    // of verdicts is not a value of this target, and a scalar kernel would
    // answer one `'maybe'` for an array.
    declines(ce, ['Less', 'U', 3], 'outside-profile');
    declines(ce, ['Less', ['PointY', 'v'], 3], 'outside-profile');
    // A POINT-or-point-list union is not a list of numbers: a point has no
    // interval reading (the 2026-08-22 decision).
    declines(ce, ['Add', 'c', 1], 'outside-profile');
  });
});

// A `PointList` whose components are list-typed SYMBOLS is a list of points:
// the interpreter and the JavaScript target zip the sources to the length of
// the SHORTEST one, and reuse a scalar component at every point. The interval
// target builds the same list. Every value is
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

  test('a scalar component is the same coordinate of every point', () => {
    const values = { L_1: [1, 2, 3] };
    agrees(['PointX', ['PointList', 'L_1', 0]], values);
    agrees(['PointY', ['PointList', 'L_1', 0]], values);
  });

  test('an untyped component fails closed', () => {
    // An input with no declared type (`x`) is refused, because the compiled
    // code cannot know whether it is a source or a slot.
    declines(zipEngine(), ['PointX', ['PointList', 'L_1', 'x']], 'untyped-input');
  });
});

// Point ARITHMETIC. A point is the array of its coordinate intervals, and the
// interpreter's arithmetic over points is coordinate-wise: point ± point,
// scalar × point, point / scalar, the negation of a point. A point beside a
// LIST is not a zip — the interpreter answers one point per element of the
// list — and the run-time value cannot tell a point from a list of two
// numbers, so the static types tell which arguments are points. The heads
// that read a point whole (`Abs`, the norm) and the elementary functions keep
// the scalar gate.
describe('Interval target — point arithmetic', () => {
  function pointEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
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
    const doubled = value(ce, ['Multiply', 2, 'P'], INPUTS);
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
    expect(shifted.out).toEqual([
      [1, 2],
      [7, 7],
    ]);
    const x = value(ce, ['PointX', ['Add', 'P', 'Q']], INPUTS);
    expect(x.out).toEqual([11, 11]);
  });

  test('the elementary functions map over a point, and Abs is its norm', () => {
    const ce = pointEngine();
    // The interpreter maps `Sin` and `Power` over the coordinates
    // (`(sin(1), sin(2))`, `(1, 4)`).
    expectEncloses(value(ce, ['Sin', 'P'], INPUTS).out, [
      Math.sin(1),
      Math.sin(2),
    ]);
    expect(value(ce, ['Power', 'P', 2], INPUTS).out).toEqual([
      [1, 1],
      [4, 4],
    ]);
    // `Abs` of a point is its norm, not a coordinate-wise absolute value.
    expectEncloses(value(ce, ['Abs', 'P'], { P: [3, 4] }).out, 5);
    // A point whose coordinate is proved not to be a number is no operand.
    ce.declare('S', 'tuple<string, number>');
    declines(ce, ['Negate', 'S'], 'static-type-error');
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
  /** A selection whose branches have different shapes (a number and a
   * list) declines with the code `unsettled-shape`. */
  function expectUnsettled(ce: ComputeEngine, expr: any) {
    declines(ce, expr, 'unsettled-shape');
  }

  test('a helper whose case arms are lists returns the selected list', () => {
    const ce = selectionEngine();
    expect(ce.box(['Z', 3]).evaluate().json).toEqual(['List', 3, 3]);
    expect(ce.box(['Z', -3]).evaluate().json).toEqual(['List', -3, -6]);
    // A collection-valued call is inlined at the compilation ROOT and as a
    // whole-bound argument (the rule every collection-valued call takes on
    // this target), so the selection appears at the call site.
    const z = run(ce, ['Z', 'x'], { x: pt(3) });
    expect(z.out).toEqual([
      [3, 3],
      [3, 3],
    ]);
    expect(run(ce, ['Z', 'x'], { x: pt(-3) }).out).toEqual([
      [-3, -3],
      [-6, -6],
    ]);
    // Undecided: the element-wise hull of the two arms, each over its part
    // of the box (`x` over `[0, 1]` and `2x` over `[−1, 0]` give `[−2, 1]`).
    expect(run(ce, ['Z', 'x'], { x: { lo: -1, hi: 1 } }).out).toEqual([
      [-1, 1],
      [-2, 1],
    ]);
  });

  test('a number in one arm and a list in the other', () => {
    const ce = selectionEngine();
    // `S(3)` is the number 0 and `S(-3)` is the list `[-3, -6]`: the shape
    // of the value is known only at run time, so the call declines
    // (ROADMAP CE-712.1, `unsettled-shape`), alone and under a dot product.
    expect(ce.box(['S', 3]).evaluate().json).toEqual(0);
    expect(ce.box(['S', -3]).evaluate().json).toEqual(['List', -3, -6]);
    expectUnsettled(ce, ['S', 'x']);
    expect(ce.parse('d(S(-3), [1, 1])').N().re).toBe(-9);
    expect(ce.parse('d(S(3), [1, 1])').N().operator).toBe('Error');
    expectUnsettled(ce, ['d', ['S', 'x'], ['List', 1, 1]]);
  });

  test('the selection at the root, and under a kernel', () => {
    const ce = selectionEngine();
    const root = run(
      ce,
      which(ce, ['List', 'x', 1], ['List', 1, 2]),
      { x: pt(3) }
    );
    expect(root.out).toEqual([
      [3, 3],
      [1, 1],
    ]);
    // A selection between a list and a number (the type
    // `integer | vector<2>`) has no settled shape: for `x = 3` the sum is
    // `[4, 2]`, for `x = -3` it is `2`. It declines (ROADMAP CE-712.1,
    // `unsettled-shape`).
    const plus = ['Add', which(ce, ['List', 'x', 1], 1), 1];
    ce.assign('x', 3);
    expect(ce.box(plus as any).evaluate().json).toEqual(['List', 4, 2]);
    ce.assign('x', -3);
    expect(ce.box(plus as any).evaluate().json).toEqual(2);
    expectUnsettled(ce, plus);
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
  });

  test('what keeps declining', () => {
    const ce = selectionEngine();
    // A list of verdicts is not a value of this target.
    declines(ce, which(ce, ['List', ['Less', 'x', 1], ['Less', 'x', 2]], 1), 'unsettled-shape');
    // A relation over the selection would be a list of verdicts too.
    declines(ce, ['Less', which(ce, ['List', 'x', 1], 1), 2], 'unsettled-shape');
    // The conditions stay scalar.
    declines(
      ce,
      ce.box([
        'Which',
        ['List', ['Less', 'x', 1], ['Less', 'x', 2]],
        ['List', 'x', 1],
        'True',
        1,
      ]),
      'outside-profile'
    );
    // A list condition and a list arm of different lengths are a static
    // error of the selection, `incompatible-dimensions` (the selection rule
    // of 2026-11-02, `docs/BROADCAST-MODEL.md`), so the compilation declines
    // on the invalid expression.
    declines(
      ce,
      ce.box(['Which', ['List', ['Less', 'x', 1]], ['List', 'x', 1], 'True', 1])
    );
  });
});
