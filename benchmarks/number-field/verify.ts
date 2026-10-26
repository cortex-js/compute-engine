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
/** Decode public MathJSON with independent rational/quotient arithmetic. */
export function decodePublicFactor(
  modulus: Element,
  expression: unknown
): Case['expected'] {
  type Polynomial = Element[];
  const one: Element = [['1', '1']];
  const integer = (x: any): bigint => {
    const s =
      typeof x === 'object' && x !== null && !Array.isArray(x) ? x.num : x;
    if (
      (typeof s === 'number' && Number.isSafeInteger(s)) ||
      (typeof s === 'string' && /^-?\d+$/.test(s))
    )
      return BigInt(s);
    throw new Error('Non-exact integer in public output');
  };
  const tidy = (p: Polynomial): Polynomial => {
    while (p.length && !p.at(-1)!.length) p.pop();
    return p;
  };
  const plus = (a: Polynomial, b: Polynomial): Polynomial =>
    tidy(
      Array.from({ length: Math.max(a.length, b.length) }, (_, i) =>
        sum(a[i] ?? [], b[i] ?? [])
      )
    );
  const times = (a: Polynomial, b: Polynomial): Polynomial => {
    if (!a.length || !b.length) return [];
    const r: Polynomial = Array.from(
      { length: a.length + b.length - 1 },
      () => []
    );
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++)
        r[i + j] = sum(r[i + j], product(a[i], b[j], modulus));
    return tidy(r);
  };
  const read = (e: any): Polynomial => {
    if (e === 'x') return [[], one];
    if (!Array.isArray(e)) return tidy([trim([q(integer(e))])]);
    const [op, ...args] = e;
    if (op === 'Rational')
      return tidy([trim([q(integer(args[0]), integer(args[1]))])]);
    if (op === 'AlgebraicGenerator') {
      if (args[0]?.[0] !== 'List') throw new Error('Invalid generator');
      const cs: Element = args[0].slice(1).map((a: any) => {
        const p = read(a);
        if (p.length !== 1 || p[0].length !== 1) {
          if (!p.length) return zero;
          throw new Error('Non-rational defining coefficient');
        }
        return p[0][0];
      });
      const normalized = (a: Element) =>
        a.map((v) => mul(v, q(BigInt(a.at(-1)![1]), BigInt(a.at(-1)![0]))));
      if (
        JSON.stringify(normalized(cs)) !== JSON.stringify(normalized(modulus))
      )
        throw new Error('Different output field');
      return [product([zero, ['1', '1']], one, modulus)];
    }
    if (op === 'Add') return args.map(read).reduce(plus, []);
    if (op === 'Multiply') return args.map(read).reduce(times, [one]);
    if (op === 'Negate') return times([[['-1', '1']]], read(args[0]));
    if (op === 'Subtract')
      return plus(read(args[0]), times([[['-1', '1']]], read(args[1])));
    if (op === 'Divide') {
      const d = read(args[1]);
      if (d.length !== 1 || d[0].length !== 1)
        throw new Error('Non-rational output denominator');
      return times(read(args[0]), [
        [q(BigInt(d[0][0][1]), BigInt(d[0][0][0]))],
      ]);
    }
    if (op === 'Power') {
      const n = integer(args[1]);
      if (n < 0n || n > 128n) throw new Error('Unsupported output power');
      let r: Polynomial = [one];
      const a = read(args[0]);
      for (let i = 0n; i < n; i++) r = times(r, a);
      return r;
    }
    throw new Error(`Unsupported public output: ${op}`);
  };
  let coefficient = one;
  const factors: Case['expected']['factors'] = [];
  const collect = (e: any, multiplicity = 1): void => {
    if (Array.isArray(e) && e[0] === 'Multiply') {
      for (const a of e.slice(1)) collect(a, multiplicity);
      return;
    }
    if (Array.isArray(e) && e[0] === 'Power') {
      const n = Number(integer(e[2]));
      if (n < 1 || n > 128) throw new Error('Invalid output multiplicity');
      collect(e[1], multiplicity * n);
      return;
    }
    const p = read(e);
    if (p.length <= 1) {
      for (let i = 0; i < multiplicity; i++)
        coefficient = product(coefficient, p[0] ?? [], modulus);
    } else factors.push({ coefficients: p, multiplicity });
  };
  collect(expression);
  return { coefficient, factors };
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
