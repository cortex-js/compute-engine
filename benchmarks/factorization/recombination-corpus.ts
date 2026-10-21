import type { FactoringCase } from './corpus.js';

function multiply(a: bigint[], b: bigint[]): bigint[] {
  const result = Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) result[i + j] += a[i] * b[j];
  while (result.length && result.at(-1) === 0n) result.pop();
  return result;
}

/** Independent prime squareclasses give an orbit of exactly 2^k signed sums. */
export function multiquadraticPolynomial(primes: readonly bigint[]): bigint[] {
  let f = [0n, 1n];
  for (const p of primes) {
    const a = Array<bigint>(f.length).fill(0n),
      b = [...a];
    for (let i = 0; i < f.length; i++) {
      let choose = 1n;
      for (let j = 0; j <= i; j++) {
        (j % 2 ? b : a)[i - j] +=
          f[i] * choose * p ** BigInt(Math.floor(j / 2));
        choose = (choose * BigInt(i - j)) / BigInt(j + 1);
      }
    }
    const aa = multiply(a, a),
      bb = multiply(b, b);
    f = aa.map((c, i) => c - p * (bb[i] ?? 0n));
  }
  return f;
}

function translate(f: bigint[], shift: bigint): bigint[] {
  let result: bigint[] = [];
  for (let i = f.length - 1; i >= 0; i--) {
    result = result.length ? multiply(result, [shift, 1n]) : [0n];
    result[0] += f[i];
  }
  return result;
}

export function recombinationCorpus(): FactoringCase[] {
  const cases: FactoringCase[] = [];
  const seen = new Set<string>();
  const add = (family: string, factors: bigint[][]) => {
    const coefficients = factors.reduce(multiply, [1n]);
    const key = coefficients.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    cases.push({
      id: `recombination-${String(cases.length).padStart(3, '0')}`,
      family,
      coefficients: coefficients.map((c) => [String(c), '1']),
      expected: {
        coefficient: ['1', '1'],
        factors: factors.map((g) => ({
          coefficients: g.map(String),
          multiplicity: 1,
        })),
      },
    });
  };
  const bases = [
    [2n, 3n, 5n, 7n, 11n, 13n],
    [2n, 3n, 5n, 7n, 11n, 17n],
    [2n, 3n, 5n, 7n, 13n, 17n],
    [3n, 5n, 7n, 11n, 13n, 17n],
  ];
  for (const primes of bases) {
    for (const count of [4, 5, 6])
      add('multiquadratic-irreducible', [
        multiquadraticPolynomial(primes.slice(0, count)),
      ]);
    const f = multiquadraticPolynomial(primes);
    for (const shift of [-2n, 1n])
      add('translated-multiquadratic', [translate(f, shift)]);
    add('multiquadratic-product', [
      multiquadraticPolynomial(primes.slice(0, 4)),
      translate(multiquadraticPolynomial(primes.slice(0, 5)), 1n),
    ]);
    add('equal-degree-multiquadratic-product', [
      multiquadraticPolynomial(primes.slice(0, 5)),
      translate(multiquadraticPolynomial(primes.slice(1, 6)), 1n),
    ]);
  }
  return cases;
}
