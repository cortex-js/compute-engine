/**
 * `Smoothstep(e0, e1, x)`: t²(3 − 2t) with t = Clamp((x − e0)/(e1 − e0), 0,
 * 1), the formula of the GLSL built-in. The library definition is
 * in `library/arithmetic.ts`. With `e0 = e1` the built-in is undefined; the
 * interpreter and the `javascript` target give the step
 * function there (0 when `x < e0`, else 1).
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const evaluate = (latex: string): string =>
  ce.parse(latex).evaluate().toString();
const N = (latex: string): string => ce.parse(latex).N().toString();

describe('Smoothstep evaluates', () => {
  it('gives exact values for exact operands', () => {
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, -1)')).toBe('0');
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, \\frac12)')).toBe('1/2');
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, \\frac13)')).toBe('7/27');
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, 2)')).toBe('1');
    // t = 1/π stays exact.
    expect(evaluate('\\operatorname{Smoothstep}(0, \\pi, 1)')).toBe(
      '(3 - 2 / pi) / pi^2'
    );
  });

  it('gives a float under N', () => {
    expect(N('\\operatorname{Smoothstep}(0, 1, \\frac13)')).toBe(
      '0.259259259259259259259'
    );
    expect(N('\\operatorname{Smoothstep}(0, 1, 0.25)')).toBe('0.15625');
  });

  it('is the step function when the edges are equal', () => {
    expect(evaluate('\\operatorname{Smoothstep}(1, 1, 0.5)')).toBe('0');
    expect(evaluate('\\operatorname{Smoothstep}(1, 1, 1)')).toBe('1');
    expect(evaluate('\\operatorname{Smoothstep}(1, 1, 2)')).toBe('1');
  });

  it('falls from 1 to 0 when the edges are reversed', () => {
    // t = (1/2 − 2)/(0 − 2) = 3/4.
    expect(evaluate('\\operatorname{Smoothstep}(2, 0, \\frac12)')).toBe(
      '27/32'
    );
  });

  it('propagates NaN, clamps infinity, and stays symbolic on a free symbol', () => {
    expect(ce.box(['Smoothstep', 0, 1, 'NaN']).evaluate().isNaN).toBe(true);
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, \\infty)')).toBe('1');
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, y)')).toBe(
      'Smoothstep(0, 1, y)'
    );
  });

  it('broadcasts over a list', () => {
    expect(evaluate('\\operatorname{Smoothstep}(0, 1, [0.25, 0.5])')).toBe(
      '[0.15625,0.5]'
    );
  });
});

describe('Smoothstep at its edge cases', () => {
  const N = (e: unknown): number => ce.box(e as never).N().re as number;

  it('has no value when an infinite edge gives ∞/∞', () => {
    for (const e of [
      ['Smoothstep', 'NegativeInfinity', 'PositiveInfinity', 0],
      ['Smoothstep', 'NegativeInfinity', 1, 0],
    ]) {
      const b = ce.box(e as never);
      expect(b.evaluate().isNaN).toBe(true);
      // The type says so: a NaN-safe shader guard is not removed for it.
      expect(b.type.toString()).toBe('nan | real');
    }
    expect(ce.box(['Smoothstep', 0, 1, 0.5]).type.toString()).toBe('real');
  });

});
