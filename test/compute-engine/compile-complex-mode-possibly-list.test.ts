import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * The `complex` compile mode and an operand that may be a number or a list
 * and may hold a complex value (ROADMAP CE-215.2): `b: broadcastable<number>`,
 * `u: number | list<number>`. The mode declined such an operand, where the
 * default mode compiles it. The scalar and the cells now take their lane from
 * the same evidence, and the code dispatches on the shape of the value when
 * it runs: a number, a `{re, im}` object, or an array of either. Each value
 * is compared with the interpreter.
 */

type Complex = { re: number; im: number };
type Value = number | Complex | Value[];

function literal(v: Value): unknown {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return ['List', ...v.map(literal)];
  return ['Complex', v.re, v.im];
}

/** The interpreter's value as a compiled value: a number when the imaginary
 * part is zero, `{re, im}` otherwise, arrays for lists, booleans. */
function plain(e: any): unknown {
  if (e.symbol === 'True') return true;
  if (e.symbol === 'False') return false;
  if (e.operator === 'List') return e.ops.map(plain);
  return e.im === 0 ? e.re : { re: e.re, im: e.im };
}

function closeTo(actual: unknown, expected: unknown): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    const a = actual as unknown[];
    expect(a.length).toBe(expected.length);
    expected.forEach((x, i) => closeTo(a[i], x));
    return;
  }
  if (typeof expected === 'boolean') {
    expect(actual).toBe(expected);
    return;
  }
  const e =
    typeof expected === 'number'
      ? { re: expected, im: 0 }
      : (expected as Complex);
  const a =
    typeof actual === 'number' ? { re: actual, im: 0 } : (actual as Complex);
  expect(a.re).toBeCloseTo(e.re, 12);
  expect(a.im).toBeCloseTo(e.im, 12);
}

const CASES: Array<[string, string, unknown, Value[]]> = [
  [
    'broadcastable<number>',
    '2b + 1',
    ['Add', ['Multiply', 2, 'b'], 1],
    [3, [1, { re: 0, im: 1 }], { re: 1, im: 2 }],
  ],
  [
    'broadcastable<number>',
    '2b = 4',
    ['Equal', ['Multiply', 2, 'b'], 4],
    [2, [2, 3], { re: 2, im: 1 }],
  ],
  [
    'number | list<number>',
    'b + 1',
    ['Add', 'b', 1],
    [3, [1, 2], { re: 1, im: 1 }, [1, { re: 0, im: 1 }]],
  ],
  [
    'number | list<number>',
    'sin(b)',
    ['Sin', 'b'],
    [3, [1, 2], { re: 1, im: 1 }, [1, { re: 0, im: 1 }]],
  ],
  [
    'broadcastable<number>',
    'b^2',
    ['Power', 'b', 2],
    [
      3,
      [1, 2],
      { re: 1, im: 1 },
      [
        [1, 2],
        [3, { re: 0, im: 1 }],
      ],
    ],
  ],
];

describe('CE-215.2: the complex mode compiles a possibly-list operand', () => {
  test.each(CASES)('%s: %s', (type, _label, json, values) => {
    const ce = new ComputeEngine();
    ce.declare('b', type);
    const r = compile(ce.box(json as any), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    } as any) as any;
    expect(r.success).toBe(true);
    for (const b of values) {
      const text = JSON.stringify(json)
        .split('"b"')
        .join(JSON.stringify(literal(b)));
      const expected = plain(ce.box(JSON.parse(text)).N());
      closeTo(r.run({ b }), expected);
    }
  });

  test('Sum(Rest(p)) + 1 over tensor<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    const r = compile(ce.box(['Add', ['Sum', ['Rest', 'p']], 1]), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    } as any) as any;
    expect(r.success).toBe(true);
    expect(
      r.run({
        p: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      })
    ).toEqual([9, 11]);
  });
});
