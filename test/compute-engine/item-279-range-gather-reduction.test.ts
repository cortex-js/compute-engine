/**
 * JavaScript code generation for a reduction over a `Range`-indexed gather —
 * the `total(P[a...b])` spelling — and for the counted-range prologue of a
 * comprehension whose bounds are integer-typed.
 *
 * Three shapes the Tycho code-generation audit of 2026-09-09 measured:
 *
 * - `total(P[(m+n)...(m+n+4)])` allocated an index list, then the gathered
 *   slice, then folded the slice through a callback. The indexed spelling of
 *   the same sum — `Σ_{k=m}^{m+4} P[k]` — already compiled to a counted loop
 *   with no allocation, and the gather now reaches the same loop.
 * - the same reduction over a `list<number>` was wrapped in `_SYS.cplx` and
 *   folded with the shape-agnostic combiner, although a wide element type is
 *   real under every discipline but `complex`.
 * - a comprehension over `a...b` with both bounds integer-typed still clamped
 *   its element count with `Math.max(0, …)`, although a range with an omitted
 *   step counts up or down towards its stop and so cannot produce a negative
 *   count. The `Math.floor` stays: a declared type constrains what the engine
 *   may assign, not what a caller may put in the `vars` object, so an
 *   `integer`-typed bound can still arrive fractional.
 *
 * Every value assertion compares the compiled kernel against the interpreter
 * on the same input.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

const CELLS = [10, 20, 30, 40, 50];

/** An engine with `P` a five-cell list of numbers and `a`, `b` integers. */
function engine(elementType = 'number'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('P', `list<${elementType}^5>`);
  ce.declare('a', 'integer');
  ce.declare('b', 'integer');
  return ce;
}

/** Compile `tex` for JavaScript and return the emitted source. */
function code(ce: ComputeEngine, tex: string): string {
  const r = compile(ce.parse(tex), { to: 'javascript' } as any);
  expect(r?.success).toBe(true);
  return r!.code!;
}

/** Compile `tex` for JavaScript and return the callable kernel. */
function kernel(ce: ComputeEngine, tex: string): (vars: any) => any {
  const r = compile(ce.parse(tex), { to: 'javascript' } as any);
  expect(r?.success).toBe(true);
  return r!.run! as any;
}

/** What the INTERPRETER answers for `tex` with `a` and `b` bound. */
function interpreted(tex: string, a: number, b: number): number {
  const ce = engine();
  ce.assign('P', ce.box(['List', ...CELLS]) as any);
  ce.assign('a', ce.box(a) as any);
  ce.assign('b', ce.box(b) as any);
  const v = ce.parse(tex).evaluate().N();
  return v.re;
}

/**
 * Sample bounds: an ascending in-range slice, a descending one (the range
 * walks downward), a single element, a slice whose low end is out of range,
 * one whose high end is, one made only of out-of-range indices, and a
 * negative pair (which counts from the end).
 */
const SAMPLES: ReadonlyArray<[number, number]> = [
  [2, 4],
  [4, 2],
  [3, 3],
  [0, 2],
  [4, 7],
  [6, 8],
  [-2, -1],
];

describe('a reduction over a Range-indexed gather is a counted loop', () => {
  test('`total(P[(m+n)...(m+n+4)])` allocates nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<number^225>');
    ce.declare('m', 'integer');
    ce.declare('n', 'integer');
    const src = code(ce, '\\operatorname{total}(P[(m+n)...(m+n+4)])');
    expect(src).not.toContain('Array.from');
    expect(src).not.toContain('.reduce');
    expect(src).not.toContain('_SYS.cplx');
    expect(src).toContain('for (let');
  });

  test.each(SAMPLES)(
    'total(P[%p...%p]) equals the interpreter',
    (a: number, b: number) => {
      const tex = '\\operatorname{total}(P[a...b])';
      const run = kernel(engine(), tex);
      expect(run({ P: CELLS, a, b })).toEqual(interpreted(tex, a, b));
    }
  );

  test.each(SAMPLES)(
    'mean(P[%p...%p]) equals the interpreter',
    (a: number, b: number) => {
      const tex = '\\operatorname{mean}(P[a...b])';
      const run = kernel(engine(), tex);
      expect(run({ P: CELLS, a, b })).toEqual(interpreted(tex, a, b));
    }
  );

  test.each(SAMPLES)(
    'max(P[%p...%p]) and min equal the interpreter',
    (a: number, b: number) => {
      for (const tex of ['\\max(P[a...b])', '\\min(P[a...b])']) {
        const run = kernel(engine(), tex);
        expect(run({ P: CELLS, a, b })).toEqual(interpreted(tex, a, b));
      }
    }
  );

  test.each(SAMPLES)(
    'length(P[%p...%p]) equals the interpreter',
    (a: number, b: number) => {
      const tex = '\\operatorname{length}(P[a...b])';
      const run = kernel(engine(), tex);
      expect(run({ P: CELLS, a, b })).toEqual(interpreted(tex, a, b));
    }
  );

  test('`Product` over the gather equals the interpreter', () => {
    const ce = engine();
    const expr = ce.box(['Product', ['At', 'P', ['Range', 'a', 'b']]] as any);
    const r = compile(expr, { to: 'javascript' } as any);
    expect(r?.success).toBe(true);
    expect(r!.code!).not.toContain('Array.from');
    expect(r!.run!({ P: CELLS, a: 2, b: 4 } as any)).toEqual(20 * 30 * 40);
    // An index past the end contributes the absence marker, which absorbs.
    expect(r!.run!({ P: CELLS, a: 4, b: 7 } as any)).toBeNaN();
  });

  test('a CLOSED source reads through `_SYS.at`, and still agrees', () => {
    // A literal list is computed by the engine itself, so the element read
    // needs none of the run-time element-shape checking `_SYS.atNumeric`
    // adds for a source handed in by the caller.
    const ce = new ComputeEngine();
    ce.declare('a', 'integer');
    ce.declare('b', 'integer');
    const tex = '\\operatorname{total}([10,20,30,40,50][a...b])';
    const src = code(ce, tex);
    expect(src).toContain('_SYS.at(');
    expect(src).not.toContain('Array.from');
    const run = kernel(ce, tex);
    for (const [a, b] of SAMPLES) {
      const ref = new ComputeEngine();
      ref.declare('a', 'integer');
      ref.declare('b', 'integer');
      ref.assign('a', ref.box(a) as any);
      ref.assign('b', ref.box(b) as any);
      expect(run({ a, b })).toEqual(ref.parse(tex).evaluate().N().re);
    }
  });

  test('a source that is not a list at run time answers NaN', () => {
    const run = kernel(engine(), '\\operatorname{total}(P[a...b])');
    expect(run({ P: 7, a: 1, b: 2 })).toBeNaN();
  });

  test('a bound that is not an integer at run time answers NaN', () => {
    // The declared type does not reach a caller's `vars` object, and the
    // interpreter refuses a gather whose index list holds a non-integer.
    const run = kernel(engine(), '\\operatorname{total}(P[a...b])');
    expect(run({ P: CELLS, a: 1.5, b: 3.5 })).toBeNaN();
    expect(run({ P: CELLS, a: 1, b: Infinity })).toBeNaN();
  });

  test('a `real`-typed bound keeps the materializing lowering', () => {
    // A fractional bound makes the range's indices fractional, which the
    // interpreter refuses for the whole read rather than per element — a
    // per-element walk cannot reproduce that.
    const ce = new ComputeEngine();
    ce.declare('P', 'list<number^5>');
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    expect(code(ce, '\\operatorname{total}(P[a...b])')).toContain('Array.from');
  });
});

describe('a real list reduction stays out of the complex lane', () => {
  test('a wide element type folds with the real operator', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<number^5>');
    // The whole-list form, which does not take the counted loop, is where the
    // lane decision is visible on its own.
    expect(code(ce, '\\operatorname{total}(P)')).not.toContain('_SYS.cplx');
    expect(code(ce, '\\operatorname{total}(P)')).toContain('_a + _b');
  });

  test('a complex element type still folds in the complex lane', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', 'list<complex^5>');
    expect(code(ce, '\\operatorname{total}(Q)')).toContain('_SYS.cplx');
  });

  test('the wide-element fold equals the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<number^5>');
    const run = kernel(ce, '\\operatorname{total}(P)');
    const ref = new ComputeEngine();
    ref.declare('P', 'list<number^5>');
    ref.assign('P', ref.box(['List', ...CELLS]) as any);
    expect(run({ P: CELLS })).toEqual(
      ref.parse('\\operatorname{total}(P)').evaluate().N().re
    );
  });
});

describe('the counted-range prologue of an integer range', () => {
  /** A comprehension whose body reads a run-time argument, so the loop is
   *  emitted rather than folded away. */
  const TEX = '[k x \\operatorname{for} k=a...b]';

  test('integer bounds need no clamp; the floor stays because a run-time bound may be fractional', () => {
    const ce = engine();
    ce.declare('x', 'number');
    const src = code(ce, TEX);
    expect(src).not.toContain('Math.max(0');
    expect(src).toContain('Math.floor');
    expect(src).toContain('? 1 : -1');
  });

  test('a fractional bound supplied through `vars` stops where the interpreter stops', () => {
    // `a` and `b` are declared `integer`, but a declared type constrains what
    // the ENGINE may assign, not what a caller may put in the `vars` object.
    // Without the floor the count is 2.5, the loop runs three times and yields
    // the index 3, one step past the stop.
    const ce = engine();
    const run = kernel(ce, '[k^2 \\operatorname{for} k=a...b]');
    const ref = new ComputeEngine();
    const expected = Array.from(
      ref.parse('[k^2 \\operatorname{for} k=1...2.5]').evaluate().N().each(),
      (el) => el.re
    );
    expect(expected).toEqual([1, 4]);
    expect(run({ a: 1, b: 2.5 })).toEqual(expected);
  });

  test('a `real` bound keeps both', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    ce.declare('x', 'number');
    const src = code(ce, TEX);
    expect(src).toContain('Math.floor');
    expect(src).toContain('Math.max(0');
  });

  test('the comprehension equals the interpreter, both directions', () => {
    const ce = engine();
    ce.declare('x', 'number');
    const run = kernel(ce, TEX);
    for (const [a, b] of [
      [1, 4],
      [4, 1],
      [3, 3],
    ]) {
      const ref = engine();
      ref.declare('x', 'number');
      ref.assign('a', ref.box(a) as any);
      ref.assign('b', ref.box(b) as any);
      ref.assign('x', ref.box(2) as any);
      // A comprehension evaluates to a LAZY collection, so its elements are
      // read by walking it rather than from its MathJSON.
      const expected = Array.from(
        ref.parse(TEX).evaluate().N().each(),
        (el) => el.re
      );
      expect(run({ a, b, x: 2 })).toEqual(expected);
    }
  });
});

describe('a caller-mapped `At` or `Range` keeps the materializing lowering', () => {
  // The counted loop reads the source array element by element, so it emits
  // neither the `At` application nor the `Range` one. A caller that re-maps
  // either name through the `functions` option supplies its own lowering,
  // which is free to answer something a positional walk cannot reproduce, so
  // the fast path has to decline and let the materializing lowering call both
  // mappings.
  function mapped(
    expr: unknown,
    functions: Record<string, string>
  ): { code: string; run: (vars: any) => any } {
    const ce = engine();
    const r = compile(ce.box(expr as any), {
      to: 'javascript',
      fallback: false,
      functions,
    } as any);
    expect(r?.success).toBe(true);
    return { code: r!.code!, run: r!.run! as any };
  }

  /** An `At` mapping that ignores its index list and answers one cell. */
  const AT_ONE_CELL = '((_p, _i) => [42])';
  /** A `Range` mapping that ignores its bounds and answers positions 1..3. */
  const RANGE_FIRST_THREE = '((_a, _b) => [1, 2, 3])';

  test('an `At` mapping decides the length, not the bounds', () => {
    const r = mapped(['Length', ['At', 'P', ['Range', 'a', 'b']]], {
      At: AT_ONE_CELL,
    });
    expect(r.code).not.toContain('for (let');
    // The counted loop answers `|b − a| + 1`, which is 3 here. The mapping
    // answers a one-element list whatever the bounds are.
    expect(r.run({ P: CELLS, a: 2, b: 4 })).toBe(1);
  });

  test('an `At` mapping decides the sum', () => {
    const r = mapped(['Sum', ['At', 'P', ['Range', 'a', 'b']]], {
      At: AT_ONE_CELL,
    });
    expect(r.code).not.toContain('for (let');
    expect(r.run({ P: CELLS, a: 2, b: 4 })).toBe(42);
  });

  test('a `Range` mapping decides which positions are read', () => {
    const r = mapped(['Sum', ['At', 'P', ['Range', 'a', 'b']]], {
      Range: RANGE_FIRST_THREE,
    });
    expect(r.code).not.toContain('for (let');
    expect(r.run({ P: CELLS, a: 2, b: 4 })).toBe(10 + 20 + 30);
  });

  test('with no mapping the counted loop is still taken', () => {
    const ce = engine();
    const r = compile(
      ce.box(['Sum', ['At', 'P', ['Range', 'a', 'b']]] as any),
      {
        to: 'javascript',
        fallback: false,
      } as any
    );
    expect(r?.success).toBe(true);
    expect(r!.code!).toContain('for (let');
    expect(r!.run!({ P: CELLS, a: 2, b: 4 } as any)).toBe(20 + 30 + 40);
  });
});

describe('the counted loop compiles each of its operands once', () => {
  test('a bound is handed to `BaseCompiler.compile` exactly once', () => {
    // The statement sink runs the body it is given more than once — once to
    // register the source text, again when that text is re-emitted at a
    // statement position — and `BaseCompiler.compile` is not a pure function
    // of its argument: it mints temporaries and advances the
    // common-subexpression bookkeeping. An operand compiled inside the body
    // would therefore have an occurrence consumed by a text that is then
    // discarded. The loop compiles its source and its two bounds before the
    // body and closes over the finished strings.
    const ce = engine();
    ce.declare('x', 'real');
    const original = BaseCompiler.compile;
    let floors = 0;
    const spy = jest.spyOn(BaseCompiler, 'compile').mockImplementation(((
      e: any,
      t: any
    ) => {
      if (e?.operator === 'Floor') floors++;
      return original.call(BaseCompiler, e, t);
    }) as any);
    try {
      const r = compile(
        ce.box([
          'Sum',
          ['At', 'P', ['Range', ['Floor', 'x'], ['Add', ['Floor', 'x'], 2]]],
        ] as any),
        { to: 'javascript', fallback: false } as any
      );
      expect(r?.success).toBe(true);
      // One compile for the low bound, one for the `Floor` inside the high
      // bound. Two builds of the body would make it four.
      expect(floors).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  test('a shared subterm in the bounds runs and equals the interpreter', () => {
    const ce = engine();
    ce.declare('x', 'real');
    const bound = ['Floor', ['Add', ['Sin', 'x'], ['Cos', 'x'], 4]];
    const expr = ['Sum', ['At', 'P', ['Range', bound, ['Add', bound, 1]]]];
    const r = compile(ce.box(expr as any), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r?.success).toBe(true);
    const ref = engine();
    ref.declare('x', 'real');
    ref.assign('P', ref.box(['List', ...CELLS]) as any);
    ref.assign('x', ref.box(0.3) as any);
    expect(r!.run!({ P: CELLS, x: 0.3 } as any)).toEqual(
      ref
        .box(expr as any)
        .evaluate()
        .N().re
    );
  });
});
