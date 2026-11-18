/**
 * A quotient `π·u / d` as the operand of `sin`. Found in Tycho's
 * `exoplanet-transit` document (2026-10-26): `sin(2πs/P)` at `s = 2`,
 * `P = −2` is exactly 0 in the interpreter; compiled code gives the value
 * within the precision of a double (`Math.sin(2π·2/−2)` is `2.4·10⁻¹⁶`).
 * A comparison of that value with 0 can differ from the interpreter's: a
 * recorded limitation (`docs/COMPILATION-MODEL.md`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('a quotient with a factor π in the numerator is a multiple of π', () => {
  it('is zero at an integer number of half-turns, within the precision of a double', () => {
    const r = compile(ce.parse('\\sin\\left(\\frac{2\\pi s}{P}\\right)'), {
      to: 'javascript',
    } as never) as unknown as { run: (v: Record<string, number>) => number };
    expect(r.run({ s: 2, P: -2 })).toBeCloseTo(0, 14);
    expect(r.run({ s: 0.3, P: 1.7 })).toBeCloseTo(
      Math.sin((2 * Math.PI * 0.3) / 1.7),
      14
    );
  });
});
