import { ComputeEngine } from '../../src/compute-engine';

//
// A hyperbolic function of a FLOAT operand `i·y` whose real part is exactly
// 0 is the circular function of the real float `y`: `sinh(iy) = i·sin y`,
// `cosh(iy) = cos y`, `tanh(iy) = i·tan y`, `csch(iy) = −i·csc y`,
// `sech(iy) = sec y`, `coth(iy) = −i·cot y`
// (`hyperbolicOfImaginaryFloat`,
// `src/compute-engine/boxed-expression/trigonometry.ts`). So both give the
// same value at the same float, with the same rules for a value that is
// only rounding at a zero or at a pole. Before, the complex kernel in
// doubles gave `NaN` for `Tanh(iπ·0.5).N()` and `1.6·10¹⁶` for
// `Sech(iπ·0.5).N()`, where `Tan(π·0.5).N()` and `Sec(π·0.5).N()` are `~oo`.
//

const PAIRS: [string, string, '1' | 'i' | '-i'][] = [
  ['Sinh', 'Sin', 'i'],
  ['Cosh', 'Cos', '1'],
  ['Tanh', 'Tan', 'i'],
  ['Csch', 'Csc', '-i'],
  ['Sech', 'Sec', '1'],
  ['Coth', 'Cot', '-i'],
];

const MULTIPLIERS = [0.5, 1.0, 0.25, 0.3, 1.5, 2.5, -0.5, 7.0];

describe.each(['machine', 21, 50] as const)('precision %s', (precision) => {
  // The engine is made when the tests of the block run: setting the
  // precision of an engine sets the global precision of the big decimals,
  // so an engine made when the blocks are collected would compute with the
  // precision of the last block.
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.precision = precision;
  });

  test('the poles of Tanh and Sech at iπ·0.5 are ~oo', () => {
    for (const h of ['Tanh', 'Sech'])
      expect(
        ce
          .box([h, ['Multiply', 'ImaginaryUnit', 'Pi', 0.5]])
          .N()
          .toString()
      ).toBe('~oo');
    expect(
      ce
        .box(['Tanh', ['Multiply', 'ImaginaryUnit', 'Pi', 0.5]])
        .evaluate()
        .toString()
    ).toBe('~oo');
  });

  test.each(PAIRS)('%s(iπu) and %s(πu) agree', (h, c, factor) => {
    for (const u of MULTIPLIERS) {
      const hv = ce.box([h, ['Multiply', 'ImaginaryUnit', 'Pi', u]]).N();
      const cv = ce.box([c, ['Multiply', 'Pi', u]]).N();
      const label = `${h}(iπ·${u}) = ${hv}, ${c}(π·${u}) = ${cv}`;
      if (cv.toString() === '~oo' || hv.toString() === '~oo') {
        expect([label, hv.toString()]).toEqual([label, cv.toString()]);
        continue;
      }
      const re = (hv as any).bignumRe?.toString() ?? String(hv.re);
      const im = (hv as any).bignumIm?.toString() ?? String(hv.im);
      const value = (cv as any).bignumRe?.toString() ?? String(cv.re);
      const negated = (cv as any).bignumRe?.neg().toString() ?? String(-cv.re);
      if (factor === '1') expect([label, re, im]).toEqual([label, value, '0']);
      else
        expect([label, re, im]).toEqual([
          label,
          '0',
          factor === 'i' ? value : negated,
        ]);
    }
  });
});

describe('the rule does not apply to other operands', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
  });
  test('a complex float with a nonzero real part uses the complex kernel', () => {
    expect(ce.parse('\\cosh(1+2.0i)').N().toString()).toBe(
      '(-0.64214812471552 + 1.0686074213827783i)'
    );
  });
  test('an exact multiple of iπ is reduced exactly', () => {
    expect(
      ce
        .box(['Tanh', ['Multiply', 'ImaginaryUnit', 'Pi', ['Rational', 1, 2]]])
        .N()
        .toString()
    ).toBe('~oo');
    expect(
      ce
        .box(['Sinh', ['Multiply', 'ImaginaryUnit', 'Pi']])
        .N()
        .toString()
    ).toBe('0');
  });
  test('a real float is unchanged', () => {
    expect(ce.box(['Tanh', 0.5]).N().toString()).toBe(
      '0.462117157260009758502'
    );
  });
});
