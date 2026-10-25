import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Compiled JavaScript `Digamma`, `Trigamma` and `PolyGamma` at a pole and at
// the order −1.
//
// The interpreter answers `~oo` at a pole (a non-positive integer argument).
// The compiled lane spells that pole `Infinity`, as a folded pole and the
// run-time `Gamma` already do, so the run-time value with a variable argument
// must be `Infinity` too, not the `NaN` of the shared numeric helper.
//
// `PolyGamma(-1, x)` is `LogGamma(x)` in the interpreter: real for x > 0,
// +∞ at a pole, complex for a negative non-integer x (which the real lane
// answers as `NaN`).
//

const ce = new ComputeEngine();

/** Run `[head, ...args]` compiled with every argument a run-time variable. */
function compiledAt(head: string, args: number[]): number {
  const vars = args.map((_, i) => `v${i}`);
  const fn = compile(ce.box([head, ...vars]));
  const env: Record<string, number> = {};
  vars.forEach((v, i) => (env[v] = args[i]));
  return fn.run!(env) as number;
}

/** The interpreter's numeric value, `Infinity` for `~oo`. */
function interpreted(head: string, args: number[]): number {
  return ce.box([head, ...args]).N().re;
}

describe('COMPILED POLYGAMMA AT A POLE', () => {
  const rows: [string, number[]][] = [
    ['Digamma', [-2]],
    ['Digamma', [0]],
    ['Trigamma', [-3]],
    ['PolyGamma', [2, -2]],
    ['PolyGamma', [3, 0]],
    ['PolyGamma', [-1, 0]],
  ];
  for (const [head, args] of rows) {
    it(`${head}(${args.join(', ')}) is Infinity on both routes`, () => {
      expect(interpreted(head, args)).toBe(Infinity);
      expect(compiledAt(head, args)).toBe(Infinity);
    });
  }
});

describe('COMPILED POLYGAMMA OF ORDER -1 IS LOGGAMMA', () => {
  it('matches the interpreter for a positive argument', () => {
    for (const x of [1, 2, 2.5, 10.25]) {
      expect(compiledAt('PolyGamma', [-1, x])).toBeCloseTo(
        interpreted('PolyGamma', [-1, x]),
        12
      );
    }
  });

  it('answers NaN on the real lane where LogGamma is complex', () => {
    expect(compiledAt('PolyGamma', [-1, -1.5])).toBeNaN();
  });

  it('keeps an ordinary point unchanged', () => {
    expect(compiledAt('Digamma', [2.5])).toBeCloseTo(
      interpreted('Digamma', [2.5]),
      12
    );
    expect(compiledAt('PolyGamma', [2, -1.5])).toBeCloseTo(
      interpreted('PolyGamma', [2, -1.5]),
      10
    );
  });
});
