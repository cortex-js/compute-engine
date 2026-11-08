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
 * read the emitted JavaScript, and compare each value with the interpreter.
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

function source(r: { preamble?: string; code?: string }): string {
  return `${r.preamble ?? ''}${r.code ?? ''}`;
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

  test.each(witnesses)('%s is written out', (_name, expr) => {
    const r = js(expr);
    expect(r.success).toBe(true);
    const code = source(r);
    expect(code).not.toContain('.map(');
    expect(code).not.toContain('.reduce(');
    expect(code).toMatch(/^(\(\(\) => \{.*return )?Math\.(min|max)\(/);
    expectInterpreterValues(expr, r);
  });

  test('the nested witness compiles to two levels of n-ary calls', () => {
    const r = js(witnesses[2][1]);
    expect(r.code).toBe(
      'Math.min(Math.max(_.x + 1, _.x + 3), Math.max(_.x + 2, _.x + 6))'
    );
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

describe('CE-1019: the cases that keep the fold', () => {
  test('an impure body', () => {
    const r = js(
      ['Max', ['Map', lambda(['Add', 'k', ['Random']], 'k'), ['List', 1, 2, 3]]],
      { constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(source(r)).toContain('.map(');
  });

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
    expect(source(r)).toContain('.map(');
    expectInterpreterValues(expr, r);
  });

  test('a body whose value is a list', () => {
    // `Min` flattens the mapped lists. The rule writes out only a body whose
    // value is a number, so this `Map` keeps its lowering.
    const expr: MathJsonExpression = [
      'Min',
      ['Map', lambda(['List', 'k', 'x'], 'k'), ['List', 1, 2, 3]],
    ];
    const r = js(expr);
    expect(r.success).toBe(true);
    expect(source(r)).toContain('.map(');
    expectInterpreterValues(expr, r);
  });

  test('a Min that the caller supplies', () => {
    const r = js(
      [
        'Min',
        ['Map', lambda(['Add', 'k', 'x'], 'k'), ['List', 1, 2, 3]],
      ],
      { functions: { Min: 'customMin' } }
    );
    expect(r.success).not.toBe(false);
    expect(source(r)).toContain('customMin');
    expect(source(r)).not.toContain('Math.min(');
  });

  test('an operator that the caller supplies inside the lambda', () => {
    // The caller writes `Add` as `*`. The substitution would build
    // `x + 0` again in canonical form, as `x`, and lose the caller's
    // operator: the minimum at x = 2 would be 2, not `min(2·0, 2·1, 2·2)`.
    const r = js(
      ['Min', ['Map', lambda(['Add', 'x', 'k'], 'k'), ['List', 0, 1, 2]]],
      { operators: { Add: ['*', 11] } }
    );
    expect(r.success).toBe(true);
    expect(source(r)).toContain('.map(');
    expect(r.run({ x: 2 })).toBe(0);
  });
});
