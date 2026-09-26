/**
 * JavaScript code generation for positional access and for counted ranges.
 *
 * Three shapes the Tycho code-generation audit of 2026-09-08 measured on a
 * corpus of imported Desmos documents:
 *
 * - a host that replaces the `At` lowering emits a ~200-character
 *   self-contained lambda per index site (211 sites, about 42 KB of the
 *   emitted JavaScript). `_SYS.atNoWrap` is that lambda as one runtime
 *   helper, so the site becomes a call. The first block below pins the two
 *   spellings to the SAME value on every index shape but one: the lambda is
 *   kept verbatim as the reference implementation. The exception is a
 *   complex `{ re, im }` index, which the helper reads through its real part
 *   as `_SYS.at` does (Tycho item 322) and the lambda does not.
 * - a counted range emits a five-statement prologue that computes its step,
 *   its element count and an array-length test at run time, even when the
 *   bounds are known.
 * - a positional read of a literal list at a literal index emits an array
 *   reference and a subscript, where the cell is a compile-time constant.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { ComputeEngineFunction } from '../../src/compute-engine/compilation/javascript-target';

/** Compile `expr` for JavaScript and return the emitted source. */
function code(expr: any, options: Record<string, unknown> = {}): string {
  const r = compile(expr, { to: 'javascript', ...options } as any);
  expect(r?.success).toBe(true);
  return r!.code!;
}

/** Compile `expr` for JavaScript and return the callable kernel. */
function kernel(expr: any, options: Record<string, unknown> = {}): any {
  const r = compile(expr, { to: 'javascript', ...options } as any);
  expect(r?.success).toBe(true);
  return r!.run!;
}

//
// J6a — `_SYS.atNoWrap` against the lambda it replaces
//

// The emitted lambda, verbatim, as it appears at each of the 211 sites. It is
// the reference implementation: `_SYS.atNoWrap` must answer the same value for
// every base and index shape.
const REFERENCE_INDEX_LAMBDA =
  `((_b,_i)=>{if(!Array.isArray(_b))return NaN;` +
  `const _h=_b.length===0||typeof _b[0]==="number"?NaN:undefined;` +
  `const g=k=>(Number.isInteger(k)&&k>=1&&k<=_b.length)` +
  `?_b[k-1]:_h;return Array.isArray(_i)?_i.map(g):g(_i);})` +
  `(_.b,_.i)`;

describe('J6a: _SYS.atNoWrap reproduces the per-site index lambda', () => {
  const ce = new ComputeEngine();
  // Both spellings run through the SAME kernel wrapper, so the result
  // convention (which maps an exactly-real total back to a plain number) is
  // applied identically to each and the comparison is of the helper alone.
  const reference = new ComputeEngineFunction(
    ce as any,
    REFERENCE_INDEX_LAMBDA
  );
  const helper = new ComputeEngineFunction(
    ce as any,
    '_SYS.atNoWrap(_.b, _.i)'
  );

  const same = (b: unknown, i: unknown): unknown => {
    const expected = (reference as any)({ b, i });
    expect((helper as any)({ b, i })).toEqual(expected);
    return expected;
  };

  test('an index in range reads the cell', () => {
    expect(same([10, 20, 30], 2)).toBe(20);
  });

  test('index 0 is out of band (the collection is 1-based)', () => {
    expect(same([10, 20, 30], 0)).toBeNaN();
  });

  test('a negative index does NOT count from the end', () => {
    expect(same([10, 20, 30], -1)).toBeNaN();
  });

  test('an index past the end is out of band', () => {
    expect(same([10, 20, 30], 4)).toBeNaN();
  });

  test('a non-integer index reads nothing', () => {
    expect(same([10, 20, 30], 1.5)).toBeNaN();
    expect(same([10, 20, 30], NaN)).toBeNaN();
    expect(same([10, 20, 30], { re: 1.5, im: 0 })).toBeNaN();
  });

  test('a base that is not an array reads nothing', () => {
    expect(same(5, 1)).toBeNaN();
    expect(same('abc', 1)).toBeNaN();
    expect(same(undefined, 1)).toBeNaN();
  });

  test('a list index gathers position by position', () => {
    expect(same([10, 20, 30], [1, 3])).toEqual([10, 30]);
    expect(same([10, 20, 30], [0, 2, -1, 7])).toEqual([NaN, 20, NaN, NaN]);
    expect(same([10, 20, 30], [])).toEqual([]);
  });

  test('an empty base reads nothing at any index', () => {
    expect(same([], 1)).toBeNaN();
    expect(same([], [1, 2])).toEqual([NaN, NaN]);
  });

  test('a non-numeric domain marks absence with the target null', () => {
    // The first cell decides the marker: a collection of rows is not a
    // numeric domain, so an out-of-band read is `undefined`, which the object
    // discharge (`Coalesce`, `IsMissing`) reads.
    expect(
      same(
        [
          [1, 2],
          [3, 4],
        ],
        9
      )
    ).toBeUndefined();
    expect(
      same(
        [
          [1, 2],
          [3, 4],
        ],
        1
      )
    ).toEqual([1, 2]);
  });
});

//
// Tycho item 322 — `_SYS.atNoWrap` reads a complex index through its real
// part, as `_SYS.at` does
//

describe('Tycho 322: _SYS.atNoWrap coerces a complex-lane index', () => {
  const ce = new ComputeEngine();
  const helper = new ComputeEngineFunction(
    ce as any,
    '_SYS.atNoWrap(_.b, _.i)'
  );
  const at = new ComputeEngineFunction(ce as any, '_SYS.at(_.b, _.i)');
  const read = (fn: any, b: unknown, i: unknown): unknown => fn({ b, i });

  test('a `{ re, im }` index reads its real part, as `_SYS.at` does', () => {
    for (const i of [
      { re: 2, im: 0 },
      { re: 1, im: 2 },
      { re: 3, im: -1 },
    ]) {
      expect(read(helper, [10, 20, 30], i)).toEqual(read(at, [10, 20, 30], i));
    }
    expect(read(helper, [10, 20, 30], { re: 2, im: 0 })).toBe(20);
  });

  test('the no-wrap rules still apply to the real part', () => {
    expect(read(helper, [10, 20, 30], { re: -1, im: 0 })).toBeNaN();
    expect(read(helper, [10, 20, 30], { re: 0, im: 0 })).toBeNaN();
    expect(read(helper, [10, 20, 30], { re: 4, im: 0 })).toBeNaN();
    expect(read(helper, [10, 20, 30], { re: 1.5, im: 0 })).toBeNaN();
    expect(read(helper, [10, 20, 30], { re: 'x', im: 0 })).toBeNaN();
  });

  test('a list index coerces each entry', () => {
    expect(
      read(helper, [10, 20, 30], [{ re: 2, im: 0 }, 1, { re: 7, im: 0 }])
    ).toEqual([20, 10, NaN]);
  });

  test('a host `At` lowering to `_SYS.atNoWrap` reads `[10,20,30][√K]`', () => {
    // The `\sqrt{K}` index compiles on the complex lane (`K` is not provably
    // non-negative), so the helper receives a `{ re, im }` object.
    const engine = new ComputeEngine();
    const atDef: any = (engine as any).lookupDefinition('At')?.operator;
    atDef.compile = (args: any[], c: (e: any) => string, context: any) =>
      context.language === 'javascript'
        ? `_SYS.atNoWrap(${c(args[0])},${c(args[1])})`
        : undefined;
    const expr = engine.parse(
      '\\left[10,20,30\\right]\\left[\\sqrt{K}\\right]'
    );
    const src = code(expr);
    expect(src).toContain('_SYS.atNoWrap(');
    expect(kernel(expr)({ K: 4 })).toBe(20);
    expect(kernel(expr)({ K: 9 })).toBe(30);
    expect(kernel(expr)({ K: 16 })).toBeNaN();
  });
});

//
// Tycho item 324 — `Range` operands spliced into the element expression
//

describe('Tycho 324: a compiled Range with a compound step', () => {
  /** The compiled elements at `d = 500` against the interpreted ones. */
  function compare(json: any): { compiled: number[]; interpreted: number[] } {
    const ce = new ComputeEngine();
    ce.declare('d', 'real');
    const expr = ce.box(json);
    const compiled = kernel(expr)({ d: 500 }) as number[];
    const interpreted = [
      ...(expr.subs({ d: 500 } as any).evaluate() as any).each(),
    ].map((x: any) => x.re);
    return { compiled, interpreted };
  }

  test.each([
    ['literal end, literal step', ['Range', 1, 4, 0.5]],
    [
      'symbolic end, literal step',
      ['Range', 1, ['Subtract', 4, ['Divide', 3, 'd']], 0.5],
    ],
    ['literal end, symbolic step', ['Range', 1, 4, ['Divide', 3, 'd']]],
    [
      'symbolic end, symbolic step',
      ['Range', 1, ['Subtract', 4, ['Divide', 3, 'd']], ['Divide', 3, 'd']],
    ],
    ['symbolic end, no step', ['Range', 1, ['Divide', 'd', 100]]],
    ['symbolic start', ['Range', ['Divide', 'd', 100], 10]],
    ['Rational step', ['Range', 1, 4, ['Rational', 1, 2]]],
    ['Divide-literal step', ['Range', 1, 4, ['Divide', 3, 500]]],
    ['Negate step', ['Range', 4, 1, ['Negate', 0.5]]],
    ['Multiply step', ['Range', 1, 2000, ['Multiply', 2, 'd']]],
    ['Pi step', ['Range', 0, 10, 'Pi']],
    ['Sqrt step', ['Range', 0, 10, ['Sqrt', 2]]],
    ['step d/1000', ['Range', 0, 1, ['Divide', 'd', 1000]]],
    ['step a bare symbol', ['Range', 0, 2000, 'd']],
    // The element expression is `start + i * step`: a step that compiles to a
    // sum (`_.d + -498`) must be parenthesized there, or every element after
    // the first is shifted by the step's constant term.
    ['Subtract step', ['Range', 0, 10, ['Subtract', 'd', 498]]],
    [
      'Subtract start and step',
      ['Range', ['Subtract', 'd', 500], 10, ['Subtract', 'd', 498]],
    ],
    ['conditional step', ['Range', 0, 10, ['If', ['Greater', 'd', 0], 2, 3]]],
  ])('%s: the compiled list is the interpreted one', (_label, json) => {
    const { compiled, interpreted } = compare(json);
    expect(compiled).toHaveLength(interpreted.length);
    expect(compiled).toEqual(interpreted);
  });

  test('a compound step is parenthesized in the element expression', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'real');
    const src = code(ce.box(['Range', 0, 10, ['Subtract', 'd', 498]] as any));
    expect(src).toContain('i * (_.d + -498)');
  });

  test('a Range inside a seeded shuffle keeps the interpreted count', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'real');
    const expr = ce.box([
      'WithRandomSeed',
      7,
      ['RandomShuffle', ['Range', 1, 4, ['Divide', 3, 'd']]],
    ] as any);
    expect(kernel(expr)({ d: 500 })).toHaveLength(501);
  });
});

//
// A bound, step, count or position compiled on the complex lane is read
// through its real part, as the interpreter reads it (found with Tycho item
// 322: `\sqrt{K}` compiles to a `{ re, im }` object)
//

describe('a complex-lane count or bound reads its real part', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  const L = [10, 20, 30, 40];

  test.each([
    ['\\operatorname{Take}(L, \\sqrt{K})', [10, 20]],
    ['\\operatorname{Drop}(L, \\sqrt{K})', [30, 40]],
    ['\\operatorname{Slice}(L, 1, \\sqrt{K})', [10, 20]],
    ['\\operatorname{Repeat}(1, \\sqrt{K})', [1, 1]],
    ['\\operatorname{Range}(1, \\sqrt{K})', [1, 2]],
    ['\\operatorname{Range}(1, 5, \\sqrt{K})', [1, 3, 5]],
    [
      '\\operatorname{Take}(\\operatorname{Range}(1, \\infty), \\sqrt{K})',
      [1, 2],
    ],
    ['[i \\text{ for } i = [1...\\sqrt{K}]]', [1, 2]],
  ])('%s', (latex, expected) => {
    const expr = ce.parse(latex);
    expect(code(expr)).toContain('_SYS.realPart(');
    expect(kernel(expr)({ K: 4, L })).toEqual(expected);
    // The interpreter agrees.
    const interpreted = expr
      .subs({ K: 4, L: ce.box(['List', ...L] as any) } as any)
      .evaluate();
    expect([...(interpreted as any).each()].map((x: any) => x.re)).toEqual(
      expected
    );
  });

  test('RandomChoice draws a complex-lane count of elements', () => {
    const expr = ce.parse('\\operatorname{RandomChoice}(L, \\sqrt{K})');
    expect(kernel(expr)({ K: 4, L })).toHaveLength(2);
  });
});

//
// J6b — the counted-range prologue
//

/** A comprehension over `range` whose body depends on a run-time argument, so
 *  the whole expression cannot be folded away before the loop is emitted. */
function comprehension(ce: ComputeEngine, range: any): any {
  if (ce.box('x').valueDefinition === undefined) ce.declare('x', 'number');
  return ce.box([
    'Comprehension',
    ['Multiply', 'k', 'x'],
    ['Element', 'k', range],
  ] as any);
}

describe('J6b: the counted-range prologue', () => {
  test('an omitted step is ±1, so the count needs no zero-step arm', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'number');
    const src = code(comprehension(ce, ['Range', 1, ['Multiply', 'N', 'N']]));
    expect(src).not.toContain('=== 0 ? 0 :');
    expect(src).toContain('? 1 : -1');
    const run = kernel(comprehension(ce, ['Range', 1, ['Multiply', 'N', 'N']]));
    expect(run({ N: 2, x: 3 })).toEqual([3, 6, 9, 12]);
  });

  test('an explicit non-zero literal step needs no zero-step arm either', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'number');
    const range = ['Range', 1, ['Multiply', 'N', 'N'], 2];
    expect(code(comprehension(ce, range))).not.toContain('=== 0 ? 0 :');
    expect(kernel(comprehension(ce, range))({ N: 3, x: 1 })).toEqual([
      1, 3, 5, 7, 9,
    ]);
  });

  test('a step that could be zero at run time keeps the test', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'number');
    ce.declare('s', 'number');
    const range = ['Range', 1, ['Multiply', 'N', 'N'], 's'];
    // The zero-step test is inside `_SYS.rangeCount`.
    expect(code(comprehension(ce, range))).toContain('_SYS.rangeCount(');
    // A zero step is the empty range, as in the interpreter.
    expect(kernel(comprehension(ce, range))({ N: 3, s: 0, x: 1 })).toEqual([]);
    expect(kernel(comprehension(ce, range))({ N: 2, s: 1, x: 1 })).toEqual([
      1, 2, 3, 4,
    ]);
  });

  test('a literal zero step keeps the test and yields the empty range', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'number');
    const range = ['Range', 1, 'N', 0];
    // The zero-step test is inside `_SYS.rangeCount`.
    expect(code(comprehension(ce, range))).toContain('_SYS.rangeCount(');
    expect(kernel(comprehension(ce, range))({ N: 5, x: 1 })).toEqual([]);
  });

  test('bounds that COMPILE to literals fold the whole prologue away', () => {
    const ce = new ComputeEngine();
    ce.assign('W', 5);
    // `W` is not a literal in the tree, so the pre-compile test cannot see the
    // constant; its compiled bound is `25`.
    const src = code(comprehension(ce, ['Range', 1, ['Square', 'W']]));
    expect(src).not.toContain('4294967295');
    expect(src).toContain('_tv1 < 25');
    expect(
      kernel(comprehension(ce, ['Range', 1, ['Square', 'W']]))({ x: 2 })
    ).toHaveLength(25);
  });

  test('a folded descending range keeps its direction', () => {
    const ce = new ComputeEngine();
    ce.assign('W', 6);
    const expr = comprehension(ce, ['Range', 10, 'W']);
    expect(code(expr)).not.toContain('4294967295');
    expect(kernel(expr)({ x: 2 })).toEqual([20, 18, 16, 14, 12]);
  });

  test('a folded range with an explicit step keeps its stride', () => {
    const ce = new ComputeEngine();
    ce.assign('W', 9);
    const expr = comprehension(ce, ['Range', 1, 'W', 2]);
    expect(code(expr)).not.toContain('4294967295');
    expect(kernel(expr)({ x: 2 })).toEqual([2, 6, 10, 14, 18]);
  });
});

//
// J7 — a literal index into a literal list
//

describe('J7: a constant index into an assigned literal list folds', () => {
  /** `\sum_{i=1}^{n} [P_i = k]` — the Game-of-Life seed count. */
  function seedCount(ce: ComputeEngine, n: number): any {
    return ce.box([
      'Sum',
      ['Boole', ['Equal', ['At', 'P', 'i'], 'k']],
      ['Limits', 'i', 1, n],
    ] as any);
  }

  test('the unrolled sum reads no array at run time', () => {
    const ce = new ComputeEngine();
    const cells = [9543, 9544, 9545, 9601, 9660];
    ce.assign('P', ['List', ...cells] as any);
    ce.declare('k', 'number');
    const expr = seedCount(ce, cells.length);
    const src = code(expr);
    // No preamble local holding the list, and no subscript of one.
    expect(src).not.toContain('_val_P');
    expect(src).not.toContain('- 1] ??');
    for (const cell of cells) expect(src).toContain(String(cell));
    // The compiled kernel agrees with the interpreter, term for term.
    const run = kernel(expr);
    for (const k of [9543, 9601, 9660, 7, 0]) {
      expect(run({ k })).toEqual(expr.subs({ k } as any).N().re);
    }
  });

  test('a single constant read folds to the cell', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ['List', 10, -20, 2.5] as any);
    expect(code(ce.box(['At', 'P', 2] as any))).toBe('-20');
    expect(code(ce.box(['At', 'P', 3] as any))).toBe('2.5');
  });

  test('a constant index past the end folds to the absence marker', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ['List', 10, 20, 30] as any);
    ce.declare('x', 'number');
    // Inside a sum the read cannot fold before the unroll, so this exercises
    // the lowering rather than the whole-subtree fold.
    const expr = ce.box([
      'Sum',
      ['Multiply', ['At', 'P', 'i'], 'x'],
      ['Limits', 'i', 1, 5],
    ] as any);
    expect(code(expr)).toContain('NaN');
    expect(kernel(expr)({ x: 1 })).toBeNaN();
    expect(expr.subs({ x: 1 } as any).N().re).toBeNaN();
  });

  test('a caller-mapped collection still reads the run-time array', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ['List', 10, 20, 30] as any);
    const expr = ce.box(['At', 'P', 2] as any);
    const src = code(expr, { vars: { P: '_.P' } });
    expect(src).not.toBe('20');
    expect(src).toContain('_.P');
    const run = kernel(expr, { vars: { P: '_.P' } });
    expect(run({ P: [1, 2, 3] })).toBe(2);
  });

  test('the folded cell is recorded in the capture set', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ['List', 10, 20, 30] as any);
    const deps = new Set<string>();
    const src = code(ce.box(['At', 'P', 2] as any), { symbolDeps: deps });
    expect(src).toBe('20');
    // The value is baked into the source, so a cache keyed on the capture set
    // must know that this kernel depends on `P`.
    expect([...deps]).toContain('P');
  });
});
