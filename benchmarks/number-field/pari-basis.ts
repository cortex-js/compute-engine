import type { Element, Rational } from './corpus.js';

const gcd = (a: bigint, b: bigint): bigint =>
  b ? gcd(b, a % b) : a < 0n ? -a : a;
const rational = (n: bigint, d: bigint): Rational => {
  if (!d) throw new Error('Zero denominator');
  const g = gcd(n, d) * (d < 0n ? -1n : 1n);
  return [String(n / g), String(d / g)];
};

/**
 * nfinit may replace a nonmonic/nonintegral defining polynomial and generator.
 * Supply our own monic integral model beta=D*alpha so both coordinate maps are
 * explicit. No assumption about PARI's automatically chosen generator is needed.
 */
export function pariBasis(modulus: Rational[]) {
  if (modulus.length < 2)
    throw new Error('Nonconstant defining polynomial required');
  const [n, d] = modulus.at(-1)!;
  if (!BigInt(n)) throw new Error('Zero leading coefficient');
  const monic = modulus.map(([a, b]) =>
    rational(BigInt(a) * BigInt(d), BigInt(b) * BigInt(n))
  );
  const scale = monic.reduce(
    (s, [, den]) => (s / gcd(s, BigInt(den))) * BigInt(den),
    1n
  );
  return {
    modulus: monic.map(([a, b], i) =>
      rational(BigInt(a) * scale ** BigInt(monic.length - 1 - i), BigInt(b))
    ),
    toPari: (e: Element): Element =>
      e.map(([a, b], i) => rational(BigInt(a), BigInt(b) * scale ** BigInt(i))),
    fromPari: (e: Element): Element =>
      e.map(([a, b], i) => rational(BigInt(a) * scale ** BigInt(i), BigInt(b))),
  };
}
