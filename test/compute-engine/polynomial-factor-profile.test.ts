import { factorRationalPolynomial } from '../../src/compute-engine/polynomial/factor-rational';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field';

test('phase profiling is opt-in and preserves results and counted work', () => {
  const input = [2n, 0n, 3n, 0n, 1n].map((n) => q(n));
  const plain = factorRationalPolynomial(input);
  const profiled = factorRationalPolynomial(input, { profile: true });
  expect(plain.statistics.phases).toBeUndefined();
  expect(profiled.factors).toEqual(plain.factors);
  expect(profiled.statistics.operations).toBe(plain.statistics.operations);
  expect(
    Object.values(profiled.statistics.phases!).reduce(
      (s, p) => s + p.operations,
      0
    )
  ).toBe(profiled.statistics.operations);
});

test('phase accounting retains work on resource exhaustion and zero input', () => {
  for (const input of [[], [2n, 0n, 3n, 0n, 1n].map((n) => q(n))]) {
    const result = factorRationalPolynomial(input, {
      profile: true,
      maxOperations: 1,
    });
    expect(
      Object.values(result.statistics.phases!).reduce(
        (s, p) => s + p.operations,
        0
      )
    ).toBe(result.statistics.operations);
  }
});

test('invalid runtime strategy values are rejected rather than silently selecting an algorithm', () => {
  const input = [2n, 0n, 3n, 0n, 1n].map((n) => q(n));
  for (const option of ['lifting', 'recombination'])
    expect(() =>
      factorRationalPolynomial(input, JSON.parse(`{"${option}":"unknown"}`))
    ).toThrow('strategy');
});
