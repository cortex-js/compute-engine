import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

// The roots of the equation `s` in `x`, as MathJSON strings, or `null` when
// the equation is not solved.
function roots(s: string): string[] | null {
  return (
    ce
      .parse(s)
      .solve('x')
      ?.map((r) => JSON.stringify(r.json)) ?? null
  );
}

// Each root of `s`, put back in the equation, gives the same numeric value on
// the two sides.
function checkRoots(s: string): number {
  const eq = ce.parse(s);
  const solutions = eq.solve('x') as ReadonlyArray<Expression> | null;
  expect(solutions).not.toBeNull();
  if (!('op1' in eq) || !('op2' in eq)) throw new Error('not an equation');
  const [lhs, rhs] = [eq.op1 as Expression, eq.op2 as Expression];
  for (const root of solutions!) {
    const value = root.N();
    const left = lhs.subs({ x: value }).N();
    const right = rhs.subs({ x: value }).N();
    expect(Math.abs(left.re - right.re)).toBeLessThan(1e-12);
    expect(Math.abs(left.im - right.im)).toBeLessThan(1e-12);
  }
  return solutions!.length;
}

// A float exponent is not a polynomial degree, but an integer-valued float
// exponent has a parity: `(-2.0)^{2.0}` evaluates to `4`. Thus `x^{2.0} = 4`
// has the two roots `±2.0`, as `x^2 = 4` has the roots `±2`. The roots are
// floats, because the exponent is a float.
describe('Solve reads the parity of an integer-valued float exponent', () => {
  test('an even float exponent gives two roots', () => {
    expect(roots('x^{2.0} = 4')).toEqual(['{"num":"2.0"}', '{"num":"-2.0"}']);
    expect(roots('2x^{2.0} = 8')).toEqual(['{"num":"2.0"}', '{"num":"-2.0"}']);
    expect(roots('x^{4.0} = 16')).toEqual(['{"num":"2.0"}', '{"num":"-2.0"}']);
    expect(checkRoots('x^{2.0} = 4')).toBe(2);
    expect(checkRoots('x^{4.0} = 16')).toBe(2);
  });

  test('an odd float exponent gives the real root', () => {
    expect(roots('x^{3.0} = -8')).toEqual(['{"num":"-2.0"}']);
    expect(checkRoots('x^{3.0} = -8')).toBe(1);
  });

  test('a float exponent that is not an integer gives one root', () => {
    expect(roots('x^{2.5} = 4')).toEqual(['{"num":"1.74110112659224827827"}']);
  });

  test('the exact exponents are unchanged', () => {
    expect(roots('x^{2} = 4')).toEqual(['2', '-2']);
    expect(
      ce
        .parse('x^{3} = -8')
        .solve('x')
        ?.map((r) => r.toString())
    ).toEqual(['-2', '1 + sqrt(3)i', '1 - sqrt(3)i']);
    expect(roots('x^{-2} = 4')).toEqual([
      '["Rational",1,2]',
      '["Rational",-1,2]',
    ]);
    expect(roots('(x+1)^{2} = 4')).toEqual(['1', '-3']);
  });
});

// Before, the general power template matched only a positive float exponent
// on the unknown itself: these equations gave no solution.
describe('Solve with a negative float exponent or a compound base', () => {
  test('a negative float exponent', () => {
    expect(roots('x^{-0.5} = 4')).toEqual(['0.0625']);
    expect(roots('x^{-2.0} = 4')).toEqual(['0.5', '-0.5']);
    expect(roots('x^{-1.0} = 4')).toEqual(['0.25']);
    expect(roots('x^{-3.0} = -8')).toEqual(['-0.5']);
    expect(roots('x^{-2.5} = 4')).toEqual([
      '{"num":"0.574349177498517503399"}',
    ]);
    for (const s of [
      'x^{-0.5} = 4',
      'x^{-2.0} = 4',
      'x^{-2.5} = 4',
      'x^{-3.0} = -8',
    ])
      checkRoots(s);
  });

  test('a compound base', () => {
    expect(roots('(x+1)^{2.0} = 4')).toEqual([
      '{"num":"1.0"}',
      '{"num":"-3.0"}',
    ]);
    expect(roots('(x+1)^{2.5} = 4')).toEqual([
      '{"num":"0.74110112659224827827"}',
    ]);
    expect(roots('(2x+1)^{2.0} = 9')).toEqual([
      '{"num":"1.0"}',
      '{"num":"-2.0"}',
    ]);
    expect(checkRoots('(x+1)^{2.0} = 4')).toBe(2);
    expect(checkRoots('(x+1)^{2.5} = 4')).toBe(1);
    expect(checkRoots('(2x+1)^{2.0} = 9')).toBe(2);
    expect(checkRoots('(x-1)^{3.0} = -8')).toBe(1);
  });

  test('a compound base with a negative float exponent', () => {
    expect(checkRoots('(x+1)^{-2.0} = 4')).toBe(2);
    expect(checkRoots('(x+1)^{-0.5} = 2')).toBe(1);
    expect(checkRoots('3(x-2)^{-1.5} + 1 = 7')).toBe(1);
  });

  // The constant is compared with 0 exactly, not within the engine
  // tolerance: before, `10^{-30}` and `1/10^{12}` counted as 0 and the
  // equations were not solved.
  test('a small exact constant is not 0', () => {
    for (const [s, expected, rhs] of [
      ['x^{-0.5} = 10^{-30}', 1e60, 1e-30],
      ['x^{-0.5} = \\frac{1}{10^{12}}', 1e24, 1e-12],
    ] as const) {
      const eq = ce.parse(s);
      const solutions = eq.solve('x') as ReadonlyArray<Expression> | null;
      expect(solutions).not.toBeNull();
      expect(solutions!.length).toBe(1);
      const root = solutions![0].N().re;
      expect(Math.abs(root / expected - 1)).toBeLessThan(1e-12);
      // The root put back in the equation gives the right side.
      const lhs = (eq as Expression & { op1: Expression }).op1;
      const value = lhs.subs({ x: solutions![0] }).N().re;
      expect(Math.abs(value / rhs - 1)).toBeLessThan(1e-12);
    }
  });

  test('a candidate that is not a root is removed', () => {
    // `x^{0.5} = -1/4` gives the candidate `0.0625`, and `0.0625^{-0.5}`
    // is `4`, not `-4`.
    expect(roots('x^{-0.5} = -4')).toBeNull();
  });

  test('a real unknown keeps only the real roots', () => {
    const engine = new ComputeEngine();
    engine.declare('y', 'real');
    expect(
      engine
        .parse('(y^2+1)^{2.0} = 4')
        .solve('y')
        ?.map((r) => JSON.stringify(r.json))
    ).toEqual(['{"num":"1.0"}', '{"num":"-1.0"}']);
  });
});
