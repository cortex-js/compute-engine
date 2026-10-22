import type { Case, Element, Rational } from './corpus.js';

// Deliberately independent of CE's field and polynomial implementations.
const gcd = (a: bigint, b: bigint): bigint =>
  b ? gcd(b, a % b) : a < 0n ? -a : a;
const q = (n: bigint, d = 1n): Rational => {
  if (!d) throw new Error('Zero denominator');
  const g = gcd(n, d) * (d < 0n ? -1n : 1n);
  return [String(n / g), String(d / g)];
};
const add = (a: Rational, b: Rational) =>
  q(
    BigInt(a[0]) * BigInt(b[1]) + BigInt(b[0]) * BigInt(a[1]),
    BigInt(a[1]) * BigInt(b[1])
  );
const mul = (a: Rational, b: Rational) =>
  q(BigInt(a[0]) * BigInt(b[0]), BigInt(a[1]) * BigInt(b[1]));
const zero: Rational = ['0', '1'];
const trim = (a: Element): Element => {
  while (a.length && a.at(-1)![0] === '0') a.pop();
  return a;
};
const sum = (a: Element, b: Element) =>
  trim(
    Array.from({ length: Math.max(a.length, b.length) }, (_, i) =>
      add(a[i] ?? zero, b[i] ?? zero)
    )
  );
function product(a: Element, b: Element, m: Element): Element {
  if (!a.length || !b.length) return [];
  const r = Array.from({ length: a.length + b.length - 1 }, () => zero);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      r[i + j] = add(r[i + j], mul(a[i], b[j]));
  const n = m.length - 1;
  for (let i = r.length - 1; i >= n; i--) {
    const c = mul(r[i], q(-BigInt(m[n][1]), BigInt(m[n][0])));
    for (let j = 0; j < n; j++) r[i - n + j] = add(r[i - n + j], mul(c, m[j]));
  }
  return trim(r.slice(0, n));
}
export function verify(c: Case, r: Case['expected']): void {
  const canonical = (e: Element): Element =>
    trim(e.map(([n, d]) => q(BigInt(n), BigInt(d))));
  const signature = (factors: Case['expected']['factors']) =>
    factors
      .map((f) =>
        JSON.stringify([f.coefficients.map(canonical), f.multiplicity])
      )
      .sort()
      .join(';');
  if (
    signature(r.factors) !== signature(c.expected.factors) ||
    JSON.stringify(canonical(r.coefficient)) !==
      JSON.stringify(c.expected.coefficient)
  )
    throw new Error('Factor or scalar mismatch');
  let p = [canonical(r.coefficient)];
  for (const f of r.factors) {
    if (!Number.isSafeInteger(f.multiplicity) || f.multiplicity < 1)
      throw new Error('Invalid multiplicity');
    for (let k = 0; k < f.multiplicity; k++) {
      const next = Array.from(
        { length: p.length + f.coefficients.length - 1 },
        (): Element => []
      );
      for (let i = 0; i < p.length; i++)
        for (let j = 0; j < f.coefficients.length; j++)
          next[i + j] = sum(
            next[i + j],
            product(p[i], f.coefficients[j], c.modulus)
          );
      p = next;
    }
  }
  if (JSON.stringify(p) !== JSON.stringify(c.coefficients))
    throw new Error('Reconstruction mismatch');
}
