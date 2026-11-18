import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * The JavaScript target instantiates a callback lambda ONCE and calls it per
 * element (`((_f) => (coll).map((_x) => _f(_x)))(lambda)`), but the lambda
 * BODY used to be emitted whole: a subexpression that mentions none of the
 * lambda's parameters was recomputed for every element. The expensive shape
 * is a call to a user-defined function of the enclosing parameters —
 * `Map((_) ↦ Which(_ = m(x, y), 1e9, True, _), d(x, y))`, where `m` reduces
 * a list `d` rebuilds, so a nine-element map ran `m` nine times.
 *
 * The hoist binds such a subexpression once, next to the lambda, and assigns
 * it on the FIRST call of the lambda — behind a flag, so an empty collection
 * evaluates it as few times as the interpreter does (never).
 *
 * The emitted source of the old hoist is no longer pinned: these tests
 * check that the compiled values agree with the interpreter.
 */

//
// The Tycho witness (Desmos state 62urmx2dcm): nine lattice points per cell,
// the squared distance to each, the minimum, then the SECOND minimum found by
// masking the first out with a `Map`.
//

const N = 16;
const n = 4;
const h = 1 / n;
const hash = (a: unknown) => [
  'Mod',
  ['Multiply', 10000, ['Sin', ['Multiply', 10000, a]]],
  1,
];
const jitter = (x: unknown, y: unknown, s: number) =>
  hash([
    'Add',
    ['Floor', ['Multiply', n, x]],
    ['Multiply', n, ['Floor', ['Multiply', n, y]]],
    s,
  ]);
const point = (x: unknown, y: unknown) => [
  'Add',
  [
    'Multiply',
    ['Divide', 1, n],
    ['PointList', ['Floor', ['Multiply', n, x]], ['Floor', ['Multiply', n, y]]],
  ],
  [
    'Multiply',
    ['Divide', 1, n],
    ['PointList', jitter(x, y, 0), jitter(x, y, 0.5)],
  ],
];
const OFFSETS: [number, number][] = [
  [-h, -h],
  [0, -h],
  [h, -h],
  [-h, 0],
  [0, 0],
  [h, 0],
  [-h, h],
  [0, h],
  [h, h],
];
const neighbours = (x: unknown, y: unknown) => [
  'List',
  ...OFFSETS.map(([dx, dy]) => point(['Add', x, dx], ['Add', y, dy])),
];

/** The by-REFERENCE chain: five named functions, each calling the last. */
function byReferenceEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  const def = (name: string, body: unknown) =>
    ce.box(['DefineFunction', name, ['Function', body, 'x', 'y']]).evaluate();
  def('V', neighbours('x', 'y'));
  def('d', [
    'Add',
    ['Square', ['Subtract', 'x', ['PointX', ['V', 'x', 'y']]]],
    ['Square', ['Subtract', 'y', ['PointY', ['V', 'x', 'y']]]],
  ]);
  def('m', ['Min', ['d', 'x', 'y']]);
  def('d2', [
    'Map',
    [
      'Function',
      ['Which', ['Equal', '_', ['m', 'x', 'y']], 1e9, 'True', '_'],
      '_',
    ],
    ['d', 'x', 'y'],
  ]);
  def('m2', ['Min', ['d2', 'x', 'y']]);
  return ce;
}

/** `(1/16)^2 - |m2(x, y) - m(x, y)|`, over the named functions. */
const byReferenceRow = (x: unknown, y: unknown) => [
  'Subtract',
  ['Power', ['Divide', 1, N], 2],
  ['Abs', ['Subtract', ['m2', x, y], ['m', x, y]]],
];

/** The same row with every definition INLINED — no named function at all. */
function inlinedRow(): unknown {
  const dIn = (x: unknown, y: unknown) => [
    'Add',
    ['Square', ['Subtract', x, ['PointX', neighbours(x, y)]]],
    ['Square', ['Subtract', y, ['PointY', neighbours(x, y)]]],
  ];
  const mIn = (x: unknown, y: unknown) => ['Min', dIn(x, y)];
  const d2In = (x: unknown, y: unknown) => [
    'Map',
    ['Function', ['Which', ['Equal', '_', mIn(x, y)], 1e9, 'True', '_'], '_'],
    dIn(x, y),
  ];
  return [
    'Subtract',
    ['Power', ['Divide', 1, N], 2],
    ['Abs', ['Subtract', ['Min', d2In('x', 'y')], mIn('x', 'y')]],
  ];
}

describe('callback lambda: loop-invariant hoist (JavaScript target)', () => {
  it("g: a callback with a GENERIC signature gives the interpreter's values", () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('L', 'list<number>');
    const result = compile(
      ce.box([
        'Map',
        [
          'Function',
          [
            'Typed',
            ['Add', '_', ['Sin', 'x']],
            { str: '(_: T) -> T where T: number' },
          ],
          '_',
        ],
        'L',
      ]),
      { to: 'javascript' } as any
    ) as any;
    expect(result.success).not.toBe(false);
    expect(result.run({ x: 0.5, L: [1, 2, 3] })).toEqual([
      1 + Math.sin(0.5),
      2 + Math.sin(0.5),
      3 + Math.sin(0.5),
    ]);
  });

  it('e: the compiled rows agree with the interpreter at 20 sample points', () => {
    const ce = byReferenceEngine();
    const byRef = compile(ce.box(byReferenceRow('x', 'y')), {
      to: 'javascript',
    } as any) as any;
    expect(byRef.success).not.toBe(false);

    const ceInline = new ComputeEngine();
    const inline = compile(ceInline.box(inlinedRow() as any), {
      to: 'javascript',
    } as any) as any;
    expect(inline.success).not.toBe(false);

    for (let i = 0; i < 20; i++) {
      const x = -0.83 + i * 0.0817;
      const y = 0.61 - i * 0.0713;
      // `.N()` and not `.evaluate()`: a transcendental of an EXACT argument
      // stays symbolic under `evaluate()` (the exactness contract), and at a
      // lattice-aligned sample the whole chain is exact.
      const expected = ce.box(byReferenceRow(x, y) as any).N().re;
      expect(typeof expected).toBe('number');
      expect(byRef.run({ x, y })).toBeCloseTo(expected, 9);
      expect(inline.run({ x, y })).toBeCloseTo(expected, 9);
    }
  });
});
