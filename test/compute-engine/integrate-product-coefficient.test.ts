import { ComputeEngine } from '../../src/compute-engine';
import { differentiate } from '../../src/compute-engine/symbolic/derivative';

/**
 * The integration rules bind the coefficient of the variable in a linear
 * argument to one wildcard (`_a·_x + __b`). A coefficient that is a product
 * of two or more constant factors (`2·π·x`, `a·b·x`) is one operand of the
 * flattened product with the variable, not one factor, so the rules did not
 * match it: `∫ tan(2πx) dx` and `∫ sin²(πx/180) dx` stayed unevaluated while
 * `∫ tan(πx) dx` and `∫ sin²(x/180) dx` did not. The product is now
 * collapsed into one symbol for the match and substituted back.
 */

const ce = new ComputeEngine();

const CASES: [string, any][] = [
  ['tan(2πx)', ['Tan', ['Multiply', 2, 'Pi', 'x']]],
  ['sin²(2πx)', ['Power', ['Sin', ['Multiply', 2, 'Pi', 'x']], 2]],
  [
    'sin²(πx/180)',
    ['Power', ['Sin', ['Multiply', ['Divide', 'Pi', 180], 'x']], 2],
  ],
  [
    'cos²(3πx + 1)',
    ['Power', ['Cos', ['Add', ['Multiply', 3, 'Pi', 'x'], 1]], 2],
  ],
  ['|2πx + 1|', ['Abs', ['Add', ['Multiply', 2, 'Pi', 'x'], 1]]],
];

describe('A product coefficient of the variable matches the integration rules', () => {
  test.each(CASES)('∫ %s dx differentiates back', (_label, body) => {
    const F = ce.box(['Integrate', body, 'x']).evaluate();
    expect(F.has('Integrate')).toBe(false);
    const dF = differentiate(F, 'x');
    expect(dF).toBeDefined();
    for (const x of [0.13, 0.41, 0.77]) {
      const residual = dF!.sub(ce.box(body)).subs({ x }).N();
      expect(residual.re).toBeCloseTo(0, 9);
    }
  });

  test('a symbolic product coefficient', () => {
    const F = ce
      .box([
        'Integrate',
        ['Power', ['Sin', ['Multiply', 'a', 'b', 'x']], 2],
        'x',
      ])
      .evaluate();
    expect(F.has('Integrate')).toBe(false);
    // x/2 − sin(2abx)/(4ab)
    const expected = ce.box([
      'Subtract',
      ['Divide', 'x', 2],
      [
        'Divide',
        ['Sin', ['Multiply', 2, 'a', 'b', 'x']],
        ['Multiply', 4, 'a', 'b'],
      ],
    ]);
    expect(F.sub(expected).simplify().isSame(0)).toBe(true);
  });

  test('the coefficient symbol does not stay declared', () => {
    const fresh = new ComputeEngine();
    fresh
      .box(['Integrate', ['Tan', ['Multiply', 2, 'Pi', 'x']], 'x'])
      .evaluate();
    expect(fresh.lookupDefinition('INTEGRALCOEF1')).toBeUndefined();
  });

  test('a user symbol named like the placeholder is not touched', () => {
    const fresh = new ComputeEngine();
    fresh.declare('INTEGRALCOEF1', 'real');
    const body = [
      'Power',
      ['Sin', ['Add', ['Multiply', 2, 'Pi', 'x'], 'INTEGRALCOEF1']],
      2,
    ];
    const F = fresh.box(['Integrate', body, 'x']).evaluate();
    expect(F.has('Integrate')).toBe(false);
    expect(F.has('INTEGRALCOEF1')).toBe(true);
    const dF = differentiate(F, 'x')!;
    for (const x of [0.13, 0.41])
      expect(
        dF.sub(fresh.box(body)).subs({ x, INTEGRALCOEF1: 0.7 }).N().re
      ).toBeCloseTo(0, 9);
  });

  test('a non-real product coefficient is not collapsed for the Abs rule', () => {
    // The rule u·|u|/(2a) for |a·x + b| holds for a real u only, so a
    // coefficient with a non-real factor keeps its product form, which the
    // rule's real check declines: the integral stays unevaluated rather
    // than wrong.
    for (const coefficient of [
      ['Multiply', 2, 'ImaginaryUnit', 'x'],
      ['Multiply', 'a', 'ImaginaryUnit', 'x'],
    ]) {
      const F = ce
        .box(['Integrate', ['Abs', ['Add', coefficient, 1]], 'x'])
        .evaluate();
      expect(F.has('Integrate')).toBe(true);
    }
  });
});
