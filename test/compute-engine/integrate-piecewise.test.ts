import { ComputeEngine } from '../../src/compute-engine';
import type { ExpressionInput } from '../../src/compute-engine/global-types';

function integrate(
  body: ExpressionInput,
  lower: ExpressionInput = 0,
  upper: ExpressionInput = 1,
  ce = new ComputeEngine()
) {
  return ce.box(['Integrate', body, ['Limits', 'x', lower, upper]]).evaluate();
}

describe('FINITE REAL PIECEWISE INTEGRALS', () => {
  test.each([
    [['Min', 'x', ['Subtract', 1, 'x']], 0, 1, 1 / 4],
    [['Max', 'x', ['Subtract', 1, 'x']], 0, 1, 3 / 4],
    [['Min', 'x', ['Negate', 'x'], 1], -1, 1, -1],
    [['Floor', 'x'], 0, 3, 3],
    [['Ceil', 'x'], 0, 3, 6],
    [['Fract', 'x'], 0, 3, 3 / 2],
    [['Floor', 'x'], -1.5, 1.5, -1.5],
    [['Ceil', 'x'], -1.5, 1.5, 1.5],
    [['Fract', 'x'], -1.5, 1.5, 1.5],
    [['Floor', ['Subtract', 1, ['Multiply', 2, 'x']]], 0, 1, -1 / 2],
    [['Floor', ['Add', ['Multiply', 2, 'x'], ['Rational', 1, 2]]], 0, 1, 1],
    [['Multiply', 'x', ['Floor', 'x']], 0, 3, 13 / 2],
    [['Floor', 'x'], 3, 0, -3],
    [['Max', 'x', 0], 1, -1, -1 / 2],
  ] as [ExpressionInput, number, number, number][])(
    '%j on [%s, %s]',
    (body, a, b, expected) => {
      const result = integrate(body, a, b);
      expect(result.has('Integrate')).toBe(false);
      expect(result.N().re).toBeCloseTo(expected, 12);
    }
  );

  test('exact results and exact rational boundaries', () => {
    expect(integrate(['Min', 'x', ['Subtract', 1, 'x']]).json).toEqual([
      'Rational',
      1,
      4,
    ]);
    expect(
      integrate(['Floor', 'x'], ['Rational', -3, 2], ['Rational', 3, 2]).json
    ).toEqual(['Rational', -3, 2]);
  });

  test('If resolves open cells, including reversed bounds', () => {
    const f: ExpressionInput = ['If', ['Less', 'x', 0], ['Negate', 'x'], 'x'];
    expect(integrate(f, -1, 1).json).toBe(1);
    expect(integrate(f, 1, -1).json).toBe(-1);
  });

  test('Which keeps first-true ordering for overlapping conditions', () => {
    const f: ExpressionInput = [
      'Which',
      ['Less', 'x', 1],
      2,
      ['Less', 'x', 2],
      5,
      'True',
      9,
    ];
    expect(integrate(f, 0, 3).json).toBe(16);
  });

  test('Boolean combinations of affine conditions', () => {
    const f: ExpressionInput = [
      'If',
      ['And', ['GreaterEqual', 'x', 0], ['Less', 'x', 1]],
      'x',
      0,
    ];
    expect(integrate(f, -2, 2).json).toEqual(['Rational', 1, 2]);
    expect(
      integrate(['If', ['Not', ['Equal', 'x', 0]], 1, 100], -1, 1).json
    ).toBe(2);
  });

  test('isolated exceptional values do not change the integral', () => {
    expect(integrate(['If', ['Equal', 'x', 0], 999, 1], -1, 1).json).toBe(2);
    expect(
      integrate(['Which', ['Less', 'x', 0], -1, ['Greater', 'x', 0], 1], -1, 1)
        .json
    ).toBe(0);
  });

  test('missing branches on an open interval remain unevaluated', () => {
    expect(
      integrate(['Which', ['Less', 'x', 0], 1], -1, 1).has('Integrate')
    ).toBe(true);
    expect(integrate(['If', ['Less', 'x', 0], 1], -1, 1).has('Integrate')).toBe(
      true
    );
  });

  test('nested selectors and weighted pieces', () => {
    const f: ExpressionInput = [
      'Multiply',
      'x',
      ['If', ['Less', 'x', 1], ['If', ['Less', 'x', 0], -1, 1], 2],
    ];
    expect(integrate(f, -1, 2).json).toBe(4);
  });

  test('LaTeX cases use the same branch semantics', () => {
    const ce = new ComputeEngine();
    const result = ce.parse(
      '\\int_{-1}^{1} \\begin{cases} x & x>0 \\\\ -x & \\text{otherwise} \\end{cases} \\, dx'
    );
    expect(result.isValid).toBe(true);
    expect(result.evaluate().json).toBe(1);
  });

  test('affine absolute values and signs share the partition', () => {
    expect(
      integrate(['Multiply', ['Floor', 'x'], ['Abs', 'x']], -1, 1).json
    ).toEqual(['Rational', -1, 2]);
    expect(
      integrate(['Multiply', ['Ceil', 'x'], ['Sign', 'x']], -1, 1).json
    ).toBe(1);
  });

  test('random branch boundaries are not sampled to construct a partition', () => {
    expect(
      integrate(['If', ['Less', 'x', ['Random']], 1, 2]).has('Integrate')
    ).toBe(true);
  });

  test('a pole in an active branch is not hidden by splitting', () => {
    const f: ExpressionInput = ['If', ['Less', 'x', 0], 0, ['Power', 'x', -2]];
    expect(integrate(f, -1, 1).isInfinity).toBe(true);
  });

  test('an inactive singular branch is not integrated', () => {
    expect(
      integrate(['If', ['Less', 'x', 0], ['Power', 'x', -2], 1], 0, 1).json
    ).toBe(1);
  });

  test('unknown root positions and unsupported root families remain unevaluated', () => {
    expect(integrate(['If', ['Less', 'x', 'a'], 1, 2]).has('Integrate')).toBe(
      true
    );
    expect(
      integrate(['If', ['Less', ['Sin', ['Square', 'x']], 0], 1, 2]).has(
        'Integrate'
      )
    ).toBe(true);
    expect(
      integrate(['Floor', ['Sin', ['Divide', 1, 'x']]], 0, 2).has('Integrate')
    ).toBe(true);
  });

  test.each([
    [['If', ['Less', ['Square', 'x'], 2], 1, 0], -2, 2, 2 * Math.sqrt(2)],
    [['Max', ['Square', 'x'], 'x'], -1, 2, 19 / 6],
    [['Min', ['Square', 'x'], 'x'], -1, 2, 4 / 3],
    [['If', ['Greater', ['Square', 'x'], 0], 1, 99], -1, 1, 2],
    [['If', ['Less', ['Add', ['Square', 'x'], 1], 0], 1, 2], -1, 1, 4],
    [['Floor', ['Square', 'x']], 0, 2, 5 - Math.sqrt(2) - Math.sqrt(3)],
    [['Ceil', ['Square', 'x']], 0, 2, 7 - Math.sqrt(2) - Math.sqrt(3)],
    [['Fract', ['Square', 'x']], 0, 2, Math.sqrt(2) + Math.sqrt(3) - 7 / 3],
    [
      ['Floor', ['Square', 'x']],
      -2,
      2,
      10 - 2 * Math.sqrt(2) - 2 * Math.sqrt(3),
    ],
    [['Floor', ['Subtract', 2, ['Square', 'x']]], -1, 1, 2],
    [['If', ['Greater', ['Divide', 1, 'x'], 0], 1, 2], -1, 1, 3],
    [['If', ['Less', ['Sqrt', 'x'], 1], 1, 2], 0, 4, 7],
    [['If', ['Less', ['Exp', 'x'], 2], 1, 0], 0, 2, Math.log(2)],
    [['If', ['Less', ['Ln', 'x'], 1], 1, 0], 1, 4, Math.E - 1],
  ] as [ExpressionInput, number, number, number][])(
    'nonlinear switches: %j on [%s, %s]',
    (body, a, b, expected) => {
      const result = integrate(body, a, b);
      expect(result.has('Integrate')).toBe(false);
      expect(result.N().re).toBeCloseTo(expected, 10);
    }
  );

  test('irrational switch positions remain exact', () => {
    const ce = new ComputeEngine();
    const result = integrate(
      ['If', ['Less', ['Square', 'x'], 2], 1, 0],
      -2,
      2,
      ce
    );
    expect(result.isSame(ce.box(['Multiply', 2, ['Sqrt', 2]]).evaluate())).toBe(
      true
    );
  });

  test('a sum of cells with different radical bounds stays exact', () => {
    // The cells of ⌊x²⌋ on [0, 3] end at √2, √3, √5, √6, √7 and 2√2. Their
    // integrals must add as exact numbers, not as machine floats.
    const ce = new ComputeEngine();
    const result = integrate(['Floor', ['Square', 'x']], 0, 3, ce);
    expect(result.toString()).toBe(
      '21 - 3sqrt(2) - sqrt(7) - sqrt(6) - sqrt(5) - sqrt(3)'
    );
    expect(result.N().re).toBeCloseTo(
      21 -
        3 * Math.sqrt(2) -
        Math.sqrt(3) -
        Math.sqrt(5) -
        Math.sqrt(6) -
        Math.sqrt(7),
      10
    );
  });

  test('periodic sine switches include every period and retain Pi', () => {
    const result = integrate(['If', ['Greater', ['Sin', 'x'], 0], 1, 0], 0, [
      'Multiply',
      4,
      'Pi',
    ]);
    expect(result.has('Integrate')).toBe(false);
    expect(result.has('Pi')).toBe(true);
    expect(result.N().re).toBeCloseTo(2 * Math.PI, 10);
  });

  test('tangent switches include poles, not only zeros', () => {
    const result = integrate(['If', ['Greater', ['Tan', 'x'], 0], 1, 2], 0, [
      'Multiply',
      2,
      'Pi',
    ]);
    expect(result.has('Integrate')).toBe(false);
    expect(result.N().re).toBeCloseTo(3 * Math.PI, 10);
  });

  test('periodic switches respect the engine angular unit', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    expect(
      integrate(['If', ['Greater', ['Sin', 'x'], 0], 1, 0], 0, 360, ce).json
    ).toBe(180);
  });

  test('a user-defined Sin is not classified using sine root families', () => {
    const ce = new ComputeEngine();
    ce.declare('Sin', {
      signature: '(number) -> number',
      evaluate: ([t], { engine }) => t.add(engine.One),
    });
    expect(
      integrate(['If', ['Greater', ['Sin', 'x'], 0], 1, 0], -2, 2, ce).has(
        'Integrate'
      )
    ).toBe(true);
  });

  test('shifted periodic roots and tangent contacts are all included', () => {
    const result = integrate(
      ['If', ['Greater', ['Sin', 'x'], ['Rational', 1, 2]], 1, 0],
      0,
      ['Multiply', 4, 'Pi']
    );
    expect(result.has('Integrate')).toBe(false);
    expect(result.N().re).toBeCloseTo((4 * Math.PI) / 3, 10);
    expect(
      integrate(
        ['If', ['LessEqual', ['Square', ['Subtract', 'x', 1]], 0], 99, 1],
        0,
        2
      ).json
    ).toBe(2);
  });

  test('nonlinear floor partitions include interior extrema', () => {
    expect(
      integrate(['Floor', ['Subtract', 2, ['Square', 'x']]], -2, 2).N().re
    ).toBeCloseTo(-6 + 2 * Math.sqrt(2) + 2 * Math.sqrt(3), 10);
    const wave = integrate(['Floor', ['Multiply', 2, ['Sin', 'x']]], 0, [
      'Multiply',
      2,
      'Pi',
    ]);
    expect(wave.has('Integrate')).toBe(false);
    expect(wave.N().re).toBeCloseTo(-Math.PI, 10);
  });

  test('nearby polynomial crossings are kept distinct', () => {
    const epsilon: ExpressionInput = ['Rational', 1, 1000000000000];
    const f: ExpressionInput = [
      'Multiply',
      ['Subtract', 'x', 1],
      ['Subtract', 'x', ['Add', 1, epsilon]],
    ];
    expect(integrate(['If', ['Less', f, 0], 1, 0], 0, 2).json).toEqual(epsilon);
  });

  test('exact irrational and transcendental constants retain tiny cells', () => {
    const ce = new ComputeEngine({ precision: 15 });
    const epsilon: ExpressionInput = ['Power', 10, -30];
    for (const center of [['Sqrt', 2], 'Pi', ['Ln', 2]] as ExpressionInput[]) {
      const f: ExpressionInput = [
        'Which',
        ['Less', 'x', center],
        0,
        ['Less', 'x', ['Add', center, epsilon]],
        1,
        'True',
        0,
      ];
      const result = integrate(f, 0, 4, ce);
      expect(result.isSame(ce.box(epsilon).evaluate())).toBe(true);
    }
    expect(ce.precision).toBe(15);
  });

  test('real-domain holes and unbounded nonlinear integer levels are not hidden', () => {
    expect(
      integrate(
        ['If', ['Greater', ['Ln', ['Square', 'x']], 0], 1, 0],
        -2,
        2
      ).has('Integrate')
    ).toBe(false);
    expect(integrate(['Floor', ['Tan', 'x']], 0, 'Pi').has('Integrate')).toBe(
      true
    );
    expect(
      integrate(['Floor', ['Divide', 1, ['Square', 'x']]], -1, 1).has(
        'Integrate'
      )
    ).toBe(true);
  });

  test('non-real condition regions and incomplete root sets stay unevaluated', () => {
    expect(
      integrate(['If', ['Less', ['Sqrt', 'x'], 1], 1, 2], -1, 1).has(
        'Integrate'
      )
    ).toBe(true);
    const partial: ExpressionInput = [
      'Multiply',
      ['Subtract', 'x', 1],
      ['Add', 'x', ['Exp', 'x']],
    ];
    expect(
      integrate(['If', ['Greater', partial, 0], 1, 0], -2, 2).has('Integrate')
    ).toBe(true);
  });

  test('unbounded and excessive integer-cell partitions stay unevaluated', () => {
    expect(
      integrate(['Floor', 'x'], 0, 'PositiveInfinity').has('Integrate')
    ).toBe(true);
    expect(integrate(['Fract', 'x'], 0, 1000000).has('Integrate')).toBe(true);
    expect(integrate(['Floor', ['Divide', 1, 'x']]).has('Integrate')).toBe(
      true
    );
  });

  test('an assigned outer variable does not replace the bound variable', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 10);
    expect(integrate(['Max', 'x', 0], -1, 1, ce).json).toEqual([
      'Rational',
      1,
      2,
    ]);
    expect(ce.box('x').evaluate().json).toBe(10);
  });

  test('tiny distinct cuts are not merged by a numerical tolerance', () => {
    const epsilon: ExpressionInput = ['Rational', 1, 1000000000000];
    const f: ExpressionInput = [
      'Which',
      ['Less', 'x', 0],
      0,
      ['Less', 'x', epsilon],
      1,
      'True',
      0,
    ];
    expect(integrate(f, -1, 1).json).toEqual(epsilon);
  });

  test('rounding at integer endpoints does not create a spurious cell', () => {
    expect(integrate(['Floor', ['Negate', 'x']], 0, 1).json).toBe(-1);
    expect(integrate(['Ceil', ['Negate', 'x']], 0, 1).json).toBe(0);
    expect(integrate(['Fract', ['Negate', 'x']], 0, 1).json).toEqual([
      'Rational',
      1,
      2,
    ]);
  });

  test('open branches are evaluated even when their endpoints select another value', () => {
    const f: ExpressionInput = [
      'If',
      ['Or', ['Equal', 'x', 0], ['Equal', 'x', 1]],
      99,
      'x',
    ];
    expect(integrate(f).json).toEqual(['Rational', 1, 2]);
  });

  test('a pole at a branch boundary diverges with the correct orientation', () => {
    const f: ExpressionInput = [
      'Which',
      ['Less', 'x', 1],
      ['Power', ['Subtract', 'x', 1], -2],
      'True',
      0,
    ];
    expect(integrate(f, 0, 2).json).toBe('PositiveInfinity');
    expect(integrate(f, 2, 0).json).toBe('NegativeInfinity');
  });

  test('smooth cells are sent through the registered integration provider', () => {
    const ce = new ComputeEngine();
    const visited: string[] = [];
    ce._integrationProvider = (f) => {
      visited.push(f.operator);
      if (f.operator === 'Sin') return ce.box(['Negate', ['Cos', 'x']]);
      if (f.operator === 'Cos') return ce.box(['Sin', 'x']);
      return null;
    };
    const value = integrate(
      ['If', ['Less', 'x', 0], ['Sin', 'x'], ['Cos', 'x']],
      -1,
      1,
      ce
    );
    expect(visited).toEqual(['Sin', 'Cos']);
    expect(value.N().re).toBeCloseTo(Math.cos(1) - 1 + Math.sin(1), 12);
  });

  test('nested integration binds its own variable', () => {
    const inner: ExpressionInput = [
      'Integrate',
      ['Max', 'x', 0],
      ['Limits', 'x', -1, 1],
    ];
    expect(integrate(['Multiply', 'x', inner]).json).toEqual([
      'Rational',
      1,
      4,
    ]);
  });
});
