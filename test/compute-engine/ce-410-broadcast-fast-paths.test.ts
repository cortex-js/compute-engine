import { ComputeEngine, compile } from '../../src/compute-engine';
import { SYS_HELPERS } from '../../src/compute-engine/compilation/javascript-runtime';
import { createJavaScriptRuntime } from '../../src/runtime';
import { broadcastNumbersSlice } from '../../src/compute-engine/compilation/broadcast';

// ROADMAP CE-410 (Tycho row 432): a cheap `broadcast()` kernel ran about 25
// times slower than the same arithmetic written in JavaScript. Three changes
// made it faster, and each must give the values it gave before:
//
// - Each compiled function has its own `_SYS.atNumeric` with a fast case
//   (`ownAtNumeric`, javascript-runtime.ts). For every argument it gives the
//   value of the shared `SYS_HELPERS.atNumeric`, or throws the same error.
// - The cell loop of `broadcast()` is made for each compiled body
//   (`cellLoopFor`, broadcast.ts). For each cell it writes the value that
//   `run()` gives for that cell, converted as before.
// - An `And`/`Or` whose operands are comparisons that need no decidedness test
//   compiles to a plain conditional, not to the three-valued closures
//   (`kleeneConnective`, base-compiler.ts). A comparison with a NaN operand
//   keeps its IEEE value (`false`).

const ce = new ComputeEngine();
ce.declare('F', 'list<number>');
ce.declare('i', 'integer');
ce.declare('x', 'real');
ce.declare('y', 'real');

/** The value of `f()`, or the message of the error it throws. */
const outcome = (f: () => unknown): unknown => {
  try {
    return { value: f() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

/** The number `broadcast()` writes for a value `run()` gives. */
const numberOf = (r: unknown): number => {
  if (typeof r === 'number') return r;
  if (typeof r === 'boolean') return r ? 1 : 0;
  if (
    typeof r === 'object' &&
    r !== null &&
    typeof (r as { re?: unknown }).re === 'number' &&
    (r as { im?: unknown }).im === 0
  )
    return (r as { re: number }).re;
  return NaN;
};

const expectSame = (a: ArrayLike<number>, b: ArrayLike<number>): void => {
  expect(a.length).toBe(b.length);
  for (let n = 0; n < a.length; n++)
    if (!Object.is(a[n], b[n]))
      throw new Error(`value ${n}: ${a[n]} and ${b[n]}`);
};

describe('CE-410: the atNumeric of each compiled function', () => {
  const sparse: unknown[] = [1, 2, 3];
  delete sparse[1];
  const bases: [string, unknown][] = [
    ['a list of numbers', [10, 20, 30]],
    ['a list of doubles', [0.5, -1.25, NaN, Infinity]],
    [
      'a list with other elements',
      [1, 'a', undefined, null, [1, 2], { re: 1, im: 2 }, true],
    ],
    ['a list with a hole', sparse],
    ['an empty list', []],
    ['a typed array', new Float64Array([1, 2, 3])],
    ['a string', 'abc'],
    ['a number', 5],
    ['undefined', undefined],
    ['null', null],
    ['an object with index keys', { 0: 1, 1: 2, length: 2 }],
    ['an object made from Array.prototype', Object.create(Array.prototype)],
    ['a subclass of Array', class extends Array {}.from([1, 2, 3])],
  ];
  const indexes: unknown[] = [
    1,
    2,
    3,
    4,
    7,
    0,
    -0,
    -1,
    -3,
    -4,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    true,
    undefined,
    { re: 2, im: 0 },
    [1, 3],
    [1, 9],
    [true, false, true],
    [],
  ];

  test('a compiled function has its own copy', () => {
    const r = compile(ce.parse('F_{i+1}'));
    const sys = (r.run as unknown as { SYS: typeof SYS_HELPERS }).SYS;
    expect(sys.atNumeric).not.toBe(SYS_HELPERS.atNumeric);
  });

  test.each(bases)('%s: the same value as the shared helper', (_, base) => {
    const own = (
      compile(ce.parse('F_{i+1}')).run as unknown as {
        SYS: typeof SYS_HELPERS;
      }
    ).SYS.atNumeric;
    for (const i of indexes) {
      const expected = outcome(() =>
        SYS_HELPERS.atNumeric(base, i as number, 'number')
      );
      // Twice, so that the second read runs after the full form has been
      // called through this copy.
      expect(outcome(() => own(base, i as number, 'number'))).toEqual(expected);
      expect(outcome(() => own(base, i as number, 'number'))).toEqual(expected);
    }
  });

  test('the one documented difference: an object with Array as constructor and an own length', () => {
    // `ownAtNumeric` reads it as an array; the shared helper gives NaN.
    const fake = Object.create(Array.prototype) as Record<number, number>;
    fake[0] = 7;
    Object.defineProperty(fake, 'length', { value: 1 });
    const own = (
      compile(ce.parse('F_{i+1}')).run as unknown as {
        SYS: typeof SYS_HELPERS;
      }
    ).SYS.atNumeric;
    expect(own(fake, 1, 'number')).toBe(7);
    expect(SYS_HELPERS.atNumeric(fake, 1, 'number')).toBeNaN();
  });

  test('a stored kernel loaded by a runtime has its own copy too', () => {
    const r = compile(ce.parse('F_{i+1}'));
    const runtime = createJavaScriptRuntime({});
    const batch = runtime.loadBroadcast(r as never);
    const out = batch(
      { i: new Float64Array([0, 1, 2, 3, -5]), F: [1, 2, 3] },
      { shared: ['F'] }
    );
    // Index 4 is out of range; index -4 is too (three elements).
    expectSame(out, [1, 2, 3, NaN, NaN]);
  });
});

describe('CE-410: the cell loop of each compiled body', () => {
  const kernel = compile(
    ce.box([
      'Block',
      ['Declare', 'v0', 'real'],
      ['Assign', 'v0', ['At', 'F', ['Add', 'i', 1]]],
      ['Declare', 'v1', 'real'],
      ['Assign', 'v1', ['At', 'F', ['Subtract', 'i', 2]]],
      ['Tuple', 'v0', 'v1', ['If', ['LessEqual', 'v0', 'v1'], 1, 0]],
    ])
  );

  /** Each cell of `kernel` through `run()`, converted as `broadcast()` does. */
  const expected = (cells: number[], F: unknown[]): number[] =>
    cells.flatMap((i) => {
      const r = outcome(() => kernel.run!({ i, F } as never));
      if (!('value' in (r as object))) return [NaN, NaN, NaN];
      const v = (r as { value: unknown }).value;
      if (!Array.isArray(v)) return [NaN, NaN, NaN];
      return [0, 1, 2].map((k) => numberOf(v[k]));
    });

  test('the kernel compiles and reads F with atNumeric', () => {
    expect(kernel.success).toBe(true);
    expect(kernel.code).toContain('_SYS.atNumeric');
  });

  test('indexes in range, out of range, zero and negative (wrap-around)', () => {
    // i + 1 runs past the end on the last cells; i - 2 is zero at i = 2 and
    // negative (counted from the end) below.
    const F = [0.5, -1, 2, NaN, 4, -3];
    const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8, 20, -9];
    const out = kernel.broadcast!(
      { i: new Float64Array(cells), F },
      { shared: ['F'] }
    );
    expectSame(out, expected(cells, F));
    // Spot values: cell 0 reads F[1] = 0.5 and F[-2] = 4 (wrap-around).
    expect(Array.from(out.slice(0, 3))).toEqual([0.5, 4, 1]);
    // Cell 2: i - 2 = 0 is out of range: NaN, and NaN <= x is false.
    expect(Array.from(out.slice(6, 9))).toEqual([2, NaN, 0]);
  });

  test('a list element that is not a number', () => {
    const F = [1, 'a', null, [1, 2], { re: 3, im: 0 }, true, undefined];
    const cells = [0, 1, 2, 3, 4, 5, 6];
    const out = kernel.broadcast!(
      { i: new Float64Array(cells), F: F as number[] },
      { shared: ['F'] }
    );
    expectSame(out, expected(cells, F));
  });

  test('the same values after a read out of range (full form called first)', () => {
    const F = [3, 1, 4, 1, 5, 9, 2, 6];
    const cells = Array.from({ length: 300 }, (_, c) => (c % 13) - 3);
    const first = kernel.broadcast!(
      { i: new Float64Array(cells), F },
      { shared: ['F'] }
    );
    expectSame(first, expected(cells, F));
    const again = kernel.broadcast!(
      { i: new Float64Array(cells), F },
      { shared: ['F'] }
    );
    expectSame(again, first);
  });

  test('outputs past the end of a tuple, booleans and complex values', () => {
    const r = compile(ce.parse('(x > 0, \\sqrt{x})'));
    const xs = [4, -4, 0, NaN, 2.25];
    const out = r.broadcast!({ x: new Float64Array(xs) }, { outputs: 3 });
    const want = xs.flatMap((x) => {
      const v = r.run!({ x } as never) as unknown[];
      return [numberOf(v[0]), numberOf(v[1]), NaN];
    });
    expectSame(out, want);
  });

  test('a grid layout with a scalar input', () => {
    const r = compile(ce.parse('(x + y, x \\cdot y)'));
    const xs = [1, 2, 3];
    const ys = [10, 20];
    const out = r.broadcast!(
      { x: new Float64Array(xs), y: new Float64Array(ys) },
      { layout: 'grid' }
    );
    const want: number[] = [];
    for (const y of ys) for (const x of xs) want.push(x + y, x * y);
    expectSame(out, want);
    const scalar = r.broadcast!({ x: new Float64Array(xs), y: 5 });
    expectSame(scalar, [6, 5, 7, 10, 8, 15]);
  });

  test('a slice stops at a multiple of 64 cells when `stop` answers true', () => {
    const r = compile(ce.parse('2x'));
    const n = 1000;
    const xs = new Float64Array(n).map((_, c) => c);
    const out = new Float64Array(n);
    let calls = 0;
    const written = broadcastNumbersSlice(
      (vars) => (r.run as unknown as (v: unknown) => unknown)(vars),
      undefined,
      { x: xs },
      undefined,
      out,
      { from: 100, to: n, stop: () => ++calls > 3 }
    );
    // Checked before cells 100, 164, 228 and 292: the fourth call stops.
    expect(written).toBe(192);
    expect(out[0]).toBe(200);
    expect(out[191]).toBe(2 * 291);
    expect(out[192]).toBe(0);
  });
});

describe('CE-410: a connective of decided comparisons', () => {
  const decided = compile(
    ce.box([
      'Block',
      ['Declare', 'v0', 'real'],
      ['Assign', 'v0', ['At', 'F', ['Add', 'i', 1]]],
      [
        'Tuple',
        ['If', ['And', ['LessEqual', 'v0', 0], ['Greater', 'v0', -1]], 1, 0],
        ['If', ['Or', ['Less', 'v0', -1], ['Greater', 'v0', 1]], 1, 0],
        [
          'If',
          ['Not', ['And', ['LessEqual', 'v0', 0], ['Greater', 'v0', -1]]],
          1,
          0,
        ],
      ],
    ])
  );

  test('compiles to a plain conditional', () => {
    expect(decided.success).toBe(true);
    expect(decided.code).not.toContain('_CND');
    expect(decided.code).not.toContain('=== undefined');
  });

  test('the same values as the interpreter, NaN included', () => {
    const F = [-0.5, 0, 0.5, -1, -2, 2, NaN, Infinity, -Infinity];
    for (let i = 0; i < F.length; i++) {
      const got = decided.run!({ i, F } as never) as number[];
      // The interpreter, with the value read in place of `v0`.
      const v = ce.number(F[i]);
      const inside = ['And', ['LessEqual', v, 0], ['Greater', v, -1]];
      const want = [
        ['If', inside, 1, 0],
        ['If', ['Or', ['Less', v, -1], ['Greater', v, 1]], 1, 0],
        ['If', ['Not', inside], 1, 0],
      ].map((e) => ce.box(e as never).evaluate().re);
      expect(got).toEqual(want);
    }
  });

  test('a comparison with a NaN operand is false, as before', () => {
    const r = compile(
      ce.box([
        'Block',
        ['Declare', 'v0', 'real'],
        ['Assign', 'v0', ['At', 'F', ['Add', 'i', 1]]],
        ['If', ['Or', ['LessEqual', 'v0', 0], ['Greater', 'v0', 0]], 1, 0],
      ])
    );
    expect(r.code).not.toContain('_CND');
    expect(r.run!({ i: 0, F: [NaN] } as never)).toBe(0);
    expect(r.run!({ i: 0, F: [3] } as never)).toBe(1);
  });

  test('a comparison of a free variable stays three-valued', () => {
    // `x` and `y` may be absent: the condition is undecided, and `If` takes
    // no branch (NaN).
    const s = compile(
      ce.box(['If', ['And', ['Less', 'x', 0], ['Less', 'y', 0]], 1, 2])
    );
    expect(s.code).toContain('_CND');
    expect(s.run!({ x: -1, y: -1 } as never)).toBe(1);
    expect(s.run!({ x: 1 } as never)).toBe(2);
    expect(s.run!({ x: -1 } as never)).toBeNaN();
  });
});
