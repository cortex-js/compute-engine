/**
 * CE-1704: `MoebiusMu`, `PrimeNu`, `PrimeOmega`, `Totient`, `NthPrime` and
 * `PrimePi` compile on JavaScript with the interpreter's values. They
 * declined, and a curve with one of them fell back to the interpreter (a
 * Möbius inversion of a sum over the zeros of zeta, in Tycho).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

/** The compiled value at `a`, and the interpreter's value of the operator
 * applied to the literal `a` (`NaN` for an unevaluated call). */
function both(op: string, a: number, type = 'integer'): [number, number] {
  const f = compile(ce.box([op, 'n'] as never), {
    to: 'javascript',
    fallback: false,
    inputs: { n: type },
  } as never) as unknown as { run: (v: object) => number };
  const interpreted = ce.box([op, a] as never).evaluate().re;
  return [f.run({ n: a }), interpreted];
}

describe('number-theory functions compile with the interpreter values', () => {
  const integers = [-30, -12, -1, 0, 1, 2, 4, 12, 30, 97, 360, 1001, 65536];
  test.each(['MoebiusMu', 'PrimeNu', 'PrimeOmega', 'Totient'])('%s', (op) => {
    for (const a of integers) {
      const [compiled, interpreted] = both(op, a);
      if (Number.isNaN(interpreted)) expect(compiled).toBeNaN();
      else expect(compiled).toBe(interpreted);
    }
  });

  test('NthPrime', () => {
    for (const a of [-1, 0, 1, 2, 5, 6, 100, 1000, 5000]) {
      const [compiled, interpreted] = both('NthPrime', a);
      if (Number.isNaN(interpreted)) expect(compiled).toBeNaN();
      else expect(compiled).toBe(interpreted);
    }
  });

  test('PrimePi of a real', () => {
    for (const a of [-3, 0, 1.5, 2, 2.9, 10, 10.5, 1000, 123456.7]) {
      const [compiled, interpreted] = both('PrimePi', a, 'real');
      expect(compiled).toBe(interpreted);
    }
  });

  test('beyond the safe integer range, or the bound of the sieve, it throws', () => {
    const mu = compile(ce.box(['MoebiusMu', 'n'] as never), {
      to: 'javascript',
      fallback: false,
      inputs: { n: 'integer' },
    } as never) as unknown as { run: (v: object) => number };
    expect(() => mu.run({ n: 2 ** 60 })).toThrow(/safe integer/);
    const pi = compile(ce.box(['PrimePi', 'n'] as never), {
      to: 'javascript',
      fallback: false,
      inputs: { n: 'real' },
    } as never) as unknown as { run: (v: object) => number };
    expect(() => pi.run({ n: 1e9 })).toThrow(/bound of compiled code/);
  });

  test('a call that would throw is not run by an empty sum', () => {
    // The rows are `may-fail`: the call is not moved out of the loop, which
    // runs zero times for `n = 0`, so the sum is 0 as in the interpreter.
    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('n', 'integer');
    const f = compile(
      local.box([
        'Sum',
        ['Multiply', 'k', ['PrimePi', 'x']],
        ['Limits', 'k', 1, 'n'],
      ] as never),
      { to: 'javascript', fallback: false } as never
    ) as unknown as { run: (v: object) => number };
    expect(f.run({ x: 1e9, n: 0 })).toBe(0);
    expect(f.run({ x: 10, n: 2 })).toBe(12);
  });

  test('a Möbius sum with a variable upper limit compiles', () => {
    const local = new ComputeEngine();
    local.declare('x', 'real');
    const sum = local.box([
      'Sum',
      ['Divide', ['MoebiusMu', 'm'], 'm'],
      ['Limits', 'm', 1, ['Floor', ['Divide', ['Ln', 'x'], ['Ln', 2]]]],
    ] as never);
    const f = compile(sum, {
      to: 'javascript',
      fallback: false,
    } as never) as unknown as { run: (v: object) => number };
    // ⌊log₂ 10⌋ = 3: μ(1)/1 + μ(2)/2 + μ(3)/3 = 1 − 1/2 − 1/3.
    expect(f.run({ x: 10 })).toBeCloseTo(1 / 6, 14);
  });
});
