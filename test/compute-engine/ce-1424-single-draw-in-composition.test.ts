import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

/**
 * CE-1424: an evaluate handler that reads its operand as written, before
 * evaluation, must not evaluate that operand again when it is not pure.
 * `Tan(Arctan(u))` read `u` from the call and evaluated it a second time, and
 * `pow()` evaluated the terms of the raw exponent of `e^{n - Random()}` again,
 * so a seeded frame skipped one value of its sequence.
 */

const ce = new ComputeEngine();
ce.declare('n', 'integer');

const draws = (expr: MathJsonExpression, seed = 7): number[] =>
  (ce.box(['WithRandomSeed', seed, expr]).evaluate().N().json as readonly unknown[])
    .slice(1)
    .map((x) => Number(x));

describe('CE-1424: one draw for each Random() in a composition', () => {
  const [d1, d2] = draws(['List', ['Random'], ['Random']]);

  test('Tan(Arctan(Random())) is the first draw', () => {
    const [a, b] = draws(['List', ['Tan', ['Arctan', ['Random']]], ['Random']]);
    expect(a).toBeCloseTo(d1, 12);
    expect(b).toBe(d2);
  });

  test('Sin(Arcsin(Random())) under N() is the first draw', () => {
    const v = ce
      .box([
        'WithRandomSeed',
        7,
        ['List', ['Sin', ['Arcsin', ['Random']]], ['Random']],
      ])
      .N().json as readonly unknown[];
    expect(Number(v[1])).toBeCloseTo(d1, 12);
    expect(Number(v[2])).toBe(d2);
  });

  test('a pure operand still cancels exactly', () => {
    expect(ce.box(['Tan', ['Arctan', 'x']]).evaluate().json).toEqual('x');
  });

  test('e^{n - Random()} with n given by withValues draws once', () => {
    const e = ce.box([
      'WithRandomSeed',
      'n',
      ['Exp', ['Subtract', 'n', ['Random']]],
    ]);
    const viaValues = ce.withValues({ n: ce.number(0) }, () =>
      e.evaluate().N()
    );
    const viaSubs = e.subs({ n: 0 }).evaluate().N();
    expect(viaValues.re).toBeCloseTo(viaSubs.re, 12);
  });

  test('e^{1 + i·π} still reads the raw exponent', () => {
    expect(
      ce
        .box([
          'Power',
          'ExponentialE',
          ['Add', 1, ['Multiply', 'ImaginaryUnit', 'Pi']],
        ])
        .evaluate().json
    ).toEqual(['Negate', 'ExponentialE']);
  });
});
