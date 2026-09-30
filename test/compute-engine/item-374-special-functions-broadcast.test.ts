import { ComputeEngine } from '../../src/compute-engine';

//
// The special functions thread over a list operand, as `Zeta`, `LerchPhi`
// and the elliptic integrals already did (#374): each element of the result
// is the head applied to the matching element, and a scalar call is
// unchanged.
//

const ce = new ComputeEngine();

const i = (im: number) => ['Complex', 0, im];

// [head, operands before the list, the list's elements, operands after it]
const cases: [string, unknown[], unknown[], unknown[]][] = [
  ['PolyLog', [2], [0.1, 0.2, ['Rational', 1, 3]], []],
  ['Hypergeometric2F1', [1, 2, 3], [0.1, 0.2], []],
  ['Hypergeometric1F1', [1, 2], [0.1, 0.2], []],
  ['AppellF1', [1, 1, 1, 2], [0.1, 0.2], [0.1]],
  ['JacobiTheta', [3], [0.1, 0.2], [i(1)]],
  ['DedekindEta', [], [i(1), i(2)], []],
  ['EisensteinE', [4], [i(1), i(2)], []],
];

describe('SPECIAL FUNCTIONS OVER A LIST', () => {
  for (const [head, before, elements, after] of cases) {
    test(`${head} over a list is the list of ${head} at each element`, () => {
      const over = ce.box([
        head,
        ...before,
        ['List', ...elements],
        ...after,
      ] as any);
      expect(over.isValid).toBe(true);
      const each = elements.map(
        (x) => ce.box([head, ...before, x, ...after] as any).N().json
      );
      expect(over.N().json).toEqual(['List', ...each]);
    });
  }

  test('PolyLog(2, [x, y]) threads symbolically', () => {
    expect(ce.box(['PolyLog', 2, ['List', 'x', 'y']]).evaluate().json).toEqual([
      'List',
      ['PolyLog', 2, 'x'],
      ['PolyLog', 2, 'y'],
    ]);
  });

  test('PolyLog(2, 1/2) on its own is unchanged', () => {
    expect(ce.box(['PolyLog', 2, ['Rational', 1, 2]]).N().re).toBeCloseTo(
      0.5822405264650125,
      15
    );
  });
});
