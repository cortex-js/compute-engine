import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * CE-1019 (Tycho ledger row 475, the Voronoi diagram of the Desmos state
 * `62urmx2dcm`): `Min(Map(f, L))` and `Max(Map(f, L))`, where the width of
 * `L` is known at compile time, compile on every target to the n-ary
 * `Min(f(e1), …, f(eN))` or `Max(f(e1), …, f(eN))`.
 *
 * The JavaScript target built the mapped list at run time,
 * `((_f) => L.map((_x) => _f(_x)))(f)`, and folded it with a `reduce`. That
 * cost 2.5 to 6 times the written-out form per call. The rule is
 * `unrollMappedExtremum()` in `compilation/fixed-width-unroll.ts`. The tests
 * compare each compiled value with the interpreter.
 */

const ce = new ComputeEngine();
ce.declare('x', 'real');

const NUMBERS = Array.from({ length: 24 }, (_, i) => ((i * 7) % 13) - 5);

function lambda(body: MathJsonExpression, p: string): MathJsonExpression {
  return ['Function', body, p];
}

function js(expr: MathJsonExpression, options: object = {}): any {
  return compile(ce.box(expr), {
    to: 'javascript',
    fallback: false,
    ...options,
  } as any);
}

/** The compiled value agrees with the interpreter at a few points. */
function expectInterpreterValues(expr: MathJsonExpression, r: any): void {
  const boxed = ce.box(expr);
  for (const x of [-2.5, 0, 0.7, 3]) {
    const expected = boxed.subs({ x }).N().re;
    expect(r.run({ x })).toBeCloseTo(expected, 12);
  }
}

describe('CE-1019: a Min or a Max of a Map over a list of known width', () => {
  const witnesses: [string, MathJsonExpression][] = [
    [
      'a list built by arithmetic over a narrow literal list',
      [
        'Min',
        [
          'Map',
          lambda(['Power', 'k', 2], 'k'),
          ['Add', 'x', ['List', 0, 4, 2]],
        ],
      ],
    ],
    [
      'a list of 24 number literals (the Voronoi distance)',
      [
        'Min',
        [
          'Map',
          lambda(
            [
              'Add',
              ['Power', ['Subtract', 'x', 'k'], 2],
              ['Power', ['Multiply', 2, 'k'], 2],
            ],
            'k'
          ),
          ['List', ...NUMBERS],
        ],
      ],
    ],
    [
      'a Max of a Map inside the lambda',
      [
        'Min',
        [
          'Map',
          lambda(
            [
              'Max',
              [
                'Map',
                lambda(['Add', ['Multiply', 'j', 'k'], 'x'], 'j'),
                ['List', 1, 3],
              ],
            ],
            'k'
          ),
          ['List', 1, 2],
        ],
      ],
    ],
    [
      'a Max over a literal Range',
      [
        'Max',
        [
          'Map',
          lambda(['Sin', ['Multiply', 'k', 'x']], 'k'),
          ['Range', 1, 6],
        ],
      ],
    ],
  ];

  test.each(witnesses)('%s gives the value of the interpreter', (_name, expr) => {
    const r = js(expr);
    expect(r.success).toBe(true);
    expectInterpreterValues(expr, r);
  });

  test('the interval target holds the value of the interpreter', () => {
    for (const [, expr] of witnesses) {
      const r: any = compile(ce.box(expr), {
        to: 'interval-js',
        fallback: false,
      } as any);
      expect(r.success).toBe(true);
      const boxed = ce.box(expr);
      for (const x of [-2.5, 0, 0.7, 3]) {
        const expected = boxed.subs({ x }).N().re;
        const result = r.run({ x });
        expect(result.kind).toBe('interval');
        expect(result.value.lo).toBeLessThanOrEqual(expected + 1e-12);
        expect(result.value.hi).toBeGreaterThanOrEqual(expected - 1e-12);
      }
    }
  });
});

describe('CE-1019: a list wider than the written-out form', () => {

  test('a list wider than 64 elements', () => {
    const expr: MathJsonExpression = [
      'Min',
      [
        'Map',
        lambda(['Power', ['Subtract', 'x', 'k'], 2], 'k'),
        ['List', ...Array.from({ length: 65 }, (_, i) => i)],
      ],
    ];
    const r = js(expr);
    expect(r.success).toBe(true);
    expectInterpreterValues(expr, r);
  });
});
