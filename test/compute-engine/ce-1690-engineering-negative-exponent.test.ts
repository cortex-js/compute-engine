/**
 * CE-1690: in engineering notation, a number whose exponent is -4 or less
 * and not a multiple of 3 was printed with the exponent moved up instead of
 * down: `0.000012` was `120.0\cdot10^{-3}` (0.12), not `12.0\cdot10^{-6}`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const engineering = (x: number | string): string =>
  ce
    .number(x)
    .toLatex({ notation: 'engineering', avoidExponentsInRange: null });

describe('engineering notation', () => {
  test('the witness', () => {
    expect(engineering(0.000012)).toBe('12.0\\cdot10^{-6}');
  });

  // Each exponent from -8 to 8, for a machine number and a decimal string:
  // the exponent is a multiple of 3 and the LaTeX reads back as the number.
  const cases: [number, string][] = [];
  for (let e = -8; e <= 8; e++) cases.push([e, `1.25e${e}`]);
  test.each(cases)('exponent %i', (_, spelling) => {
    for (const x of [Number(spelling), spelling]) {
      const latex = engineering(x);
      const exponent = latex.match(/10\^\{(-?\d+)\}/)?.[1];
      if (exponent !== undefined)
        expect(Math.abs(Number(exponent)) % 3).toBe(0);
      expect(ce.parse(latex).N().re).toBeCloseTo(Number(spelling), 15);
    }
  });
});
