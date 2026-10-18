import { ComputeEngine } from '../../src/compute-engine';

// An exact complex argument whose real part is next to a branch point
// (`1 + 10⁻³⁰ + 10⁻⁴⁰⁰i` for `Arcoth`): the double of the real part is 1,
// and at machine precision the big-decimal route read it as 1 and answered
// the value at the branch point (460.86, where the value is 34.89). The
// real part is now read from the exact literal with the added digits, as a
// real argument is (`exactComplexRealPart`, `boxed-expression/trigonometry.ts`),
// and the kernel declines when a double does not hold the distance: the
// expression stays unevaluated at every precision, as it did at the default
// precision.
describe('an inverse hyperbolic function at an exact complex argument next to a branch point', () => {
  const z = [
    'Add',
    1,
    ['Power', 10, -30],
    ['Multiply', ['Power', 10, -400], ['Complex', 0, 1]],
  ];

  test('declines at machine precision, as at the default precision', () => {
    for (const precision of ['machine', 21] as const) {
      const ce = new ComputeEngine();
      ce.precision = precision;
      expect(ce.box(['Arcoth', z]).N().operator).toBe('Arcoth');
      expect(ce.box(['Arsech', z]).N().operator).toBe('Arsech');
    }
  });

  test('a distance far below the imaginary part does not change the value: answered', () => {
    // The value at `1 + 10⁻⁴⁰⁰i`: the offset is negligible, and the real
    // part is read at the working precision, as before.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    for (const e of [420, 500, 2010]) {
      const w = [
        'Add',
        1,
        ['Power', 10, -e],
        ['Multiply', ['Power', 10, -400], ['Complex', 0, 1]],
      ];
      const v = ce.box(['Arcoth', w]).N();
      expect(v.re).toBeCloseTo(460.8635921890891, 10);
      expect(v.im).toBeCloseTo(-0.7853981633974483, 12);
    }
  });

  test('a real argument past the digit limit stays unevaluated, not the pole', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(
      ce.box(['Arcoth', ['Add', 1, ['Power', 10, -2010]]]).N().operator
    ).toBe('Arcoth');
  });

  test('a real argument next to the branch point is still answered', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(
      ce.box(['Arcoth', ['Add', 1, ['Power', 10, -30]]]).N().re
    ).toBeCloseTo(34.88534998519066, 12);
  });

  test('a complex argument away from the branch point is still answered', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const w = ['Add', 2, ['Multiply', ['Power', 10, -400], ['Complex', 0, 1]]];
    expect(ce.box(['Arcoth', w]).N().re).toBeCloseTo(0.5493061443340548, 14);
  });
});
