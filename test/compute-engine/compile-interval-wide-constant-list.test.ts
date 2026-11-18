/**
 * Arithmetic over a WIDE constant list of numbers on `interval-js`.
 *
 * The fixed-width pass (`compilation/fixed-width-unroll.ts`) writes a list of
 * number literals out one term per element on this target, because the
 * target has no other lowering for a short list. Before, it did so at any
 * width: `Sin(x + 4·L)` over 2,000 numbers was a 60,876-character body, and
 * an n-ary reduction over 2,000 terms (`Max`, `Min`, `Sum`, `Reduce`)
 * overflowed the stack of the code generator. The pass now writes out at
 * most 100 elements (`MAX_UNROLLED_CONSTANT_LIST_WIDTH`) and leaves a wider
 * list to the target, which binds it once as a table (`_IA.points([…])`) and
 * broadcasts over it at run time.
 *
 * `Reduce(L, Add)` over a list that is not written out had no lowering on
 * this target, so the target now has one for the library combiners `Add`,
 * `Multiply`, `Max` and `Min` (`compileIntervalReduce`), which is what keeps
 * `Reduce((M − x·L)², Add)` compiling past the limit.
 *
 * ROADMAP CE-333.1. Every enclosure is checked against the interpreter.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('k', 'integer');

const numbers = (n: number, f: (i: number) => number) => [
  'List',
  ...Array.from({ length: n }, (_, i) => f(i)),
];
const L = (n: number) => numbers(n, (i) => 1 + i / 7);
const M = (n: number) => numbers(n, (i) => 2 - i / 11);

const SHAPES: Record<string, (n: number) => unknown> = {
  'Sin(x + 4L)': (n) => ['Sin', ['Add', 'x', ['Multiply', 4, L(n)]]],
  'Max(x + 4L)': (n) => ['Max', ['Add', 'x', ['Multiply', 4, L(n)]]],
  'Min(x + L)': (n) => ['Min', ['Add', 'x', L(n)]],
  'Sum((M - xL)^2)': (n) => [
    'Sum',
    ['Power', ['Subtract', M(n), ['Multiply', 'x', L(n)]], 2],
  ],
  'At(x + 4L, k)': (n) => ['At', ['Add', 'x', ['Multiply', 4, L(n)]], 'k'],
  'xL + M': (n) => ['Add', ['Multiply', 'x', L(n)], M(n)],
};

type Cell = { kind: string; value: { lo: number; hi: number } };

function intervalCompile(json: unknown) {
  const r = compile(ce.box(json as never), {
    to: 'interval-js',
    fallback: false,
  });
  expect(r.success).toBe(true);
  return r;
}

/** The code of the decline that `compile(json, options)` throws. */
function declineCode(c: ComputeEngine, json: unknown, options = {}) {
  try {
    compile(c.box(json as never), {
      to: 'interval-js',
      fallback: false,
      ...options,
    } as never);
  } catch (e) {
    return compileDiagnosticOf(e).code;
  }
  return 'no decline';
}

/** The interpreter's numbers for `json` at `x` (and `k = 3`). */
function interpreted(json: unknown, x: number): number[] {
  const v = ce
    .box(json as never)
    .subs({ x: ce.number(x), k: ce.number(3) })
    .N();
  // A list result of `.N()` can be a lazy collection (a `Map`), so it is
  // read through its elements rather than its operands.
  if (v.isCollection) return Array.from(v.each()).map((c) => c.re);
  return [v.re];
}

/** Every cell of the compiled result at each sample point `x` contains the
 * interpreter's value. */
function expectEncloses(
  json: unknown,
  run: (v: object) => unknown,
  samples = [0.25, -1.5, 2]
) {
  for (const x of samples) {
    const got = run({ x: { lo: x, hi: x }, k: { lo: 3, hi: 3 } }) as
      | Cell
      | Cell[];
    const cells = Array.isArray(got) ? got : [got];
    const want = interpreted(json, x);
    expect(cells).toHaveLength(want.length);
    cells.forEach((cell, i) => {
      const tol = 1e-9 * Math.max(1, Math.abs(want[i]));
      expect(cell.value.lo).toBeLessThanOrEqual(want[i] + tol);
      expect(cell.value.hi).toBeGreaterThanOrEqual(want[i] - tol);
    });
  }
}

describe('a constant list wider than 100 numbers on interval-js', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    test(`${name} over 150 numbers is one table, not 150 terms`, () => {
      const json = shape(150);
      const r = intervalCompile(json);
      expectEncloses(json, r.run!);
    });
  }

  test('the reductions over 2,000 numbers compile (they overflowed the stack)', () => {
    for (const name of [
      'Max(x + 4L)',
      'Min(x + L)',
      'Sum((M - xL)^2)',
    ]) {
      const json = SHAPES[name](2000);
      const r = intervalCompile(json);
      expect(r.code.length).toBeLessThan(1000);
      expectEncloses(json, r.run!);
    }
  });

  test('100 numbers are still written out one term per element', () => {
    const json = SHAPES['Sin(x + 4L)'](100);
    expectEncloses(json, intervalCompile(json).run!);
  });

  test('101 numbers are one table', () => {
    const r = intervalCompile(SHAPES['Sin(x + 4L)'](101));
    expect(r.code.match(/_IA\.sin\(/g)).toHaveLength(1);
  });
});

describe('Reduce over a list that is not written out, on interval-js', () => {
  const square = (n: number) => [
    'Power',
    ['Subtract', M(n), ['Multiply', 'x', L(n)]],
    2,
  ];

  test('a list of unknown width declines: Reduce of an empty list is Nothing', () => {
    ce.declare('V', 'list<number>');
    expect(declineCode(ce, ['Reduce', ['Power', 'V', 2], 'Add'])).toBe(
      'outside-profile'
    );
  });

  test('a declared width declines: a value in `vars` can be empty', () => {
    ce.declare('W', 'list<number^3>');
    expect(declineCode(ce, ['Reduce', ['Power', 'W', 2], 'Add'])).toBe(
      'outside-profile'
    );
  });

  test('a definition that shadows the combiner declines', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('x', 'real');
    ce2.declare('Max', {
      signature: '(number, number) -> number',
      evaluate: ([a]) => a,
    });
    expect(declineCode(ce2, ['Reduce', square(150), 'Max'])).toBe(
      'outside-profile'
    );
  });

  test('an initial value encloses the interpreter, a custom combiner declines', () => {
    const json = ['Reduce', square(150), 'Add', 1];
    expectEncloses(json, intervalCompile(json).run!);
    expect(
      declineCode(ce, [
        'Reduce',
        square(150),
        ['Function', ['Add', 'a', ['Multiply', 2, 'b']], 'a', 'b'],
      ])
    ).toBe('outside-profile');
  });
});
