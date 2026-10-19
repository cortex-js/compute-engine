import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { factorial2 } from '../../src/compute-engine/numerics/numeric';
import { factorial2 as intervalFactorial2 } from '../../src/compute-engine/interval/elementary';

// For an odd n < 0, n!! = (-1)^((|n|-1)/2) / (|n|-2)!!. The product
// (|n|-2)!! overflows a double from |n| = 303, but its reciprocal is still a
// representable (subnormal) double down to about |n| = 315. The reference
// values below are computed exactly with bigints.

const ce = new ComputeEngine();

/** `n!!` for `n ≥ -1`, as an exact bigint. */
function exactFactorial2(n: number): bigint {
  let r = 1n;
  for (let k = BigInt(n); k > 1n; k -= 2n) r *= k;
  return r;
}

/** The exact value of `n!!` as a fraction `p/q` with `q > 0`. */
function exactValue(n: number): [bigint, bigint] {
  if (n >= 0) return [exactFactorial2(n), 1n];
  const m = -n;
  const sign = ((m - 1) / 2) % 2 === 0 ? 1n : -1n;
  return [sign, m === 1 ? 1n : exactFactorial2(m - 2)];
}

/** The double nearest to `p/q`, through a 40-digit decimal string. */
function nearestDouble(p: bigint, q: bigint): number {
  const negative = p < 0n;
  if (negative) p = -p;
  let e = 0;
  const target = 10n ** 40n;
  while (p / q < target) {
    p *= 10n;
    e -= 1;
  }
  const v = Number(`${p / q}e${e}`);
  return negative ? -v : v;
}

/** The sign of `x - p/q` for a finite double `x`, computed exactly. */
function compareExact(x: number, p: bigint, q: bigint): number {
  if (x === Infinity) return 1;
  if (x === -Infinity) return -1;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = bits >> 63n ? -1n : 1n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  let mantissa = bits & ((1n << 52n) - 1n);
  let e = -1074;
  if (biased !== 0) {
    mantissa |= 1n << 52n;
    e = biased - 1075;
  }
  let lhs = sign * mantissa * q;
  let rhs = p;
  if (e >= 0) lhs <<= BigInt(e);
  else rhs <<= BigInt(-e);
  return lhs > rhs ? 1 : lhs < rhs ? -1 : 0;
}

describe('Factorial2 at an odd negative integer whose value is subnormal', () => {
  test.each([-301, -303, -305, -311, -315])(
    'the machine kernel keeps the representable value of (%p)!!',
    (n) => {
      const [p, q] = exactValue(n);
      const want = nearestDouble(p, q);
      expect(want).not.toBe(0);
      const got = factorial2(n);
      // Within a few subnormal ulps of the true value, with the true sign.
      expect(Math.sign(got)).toBe(Math.sign(want));
      expect(Math.abs(got - want)).toBeLessThanOrEqual(
        Math.max(8 * Number.MIN_VALUE, Math.abs(want) * 1e-14)
      );
    }
  );

  test('(-303)!! is about -8.8516e-310, not -0', () => {
    expect(factorial2(-303)).toBeCloseTo(-8.8516293706596e-310, 320);
    expect(Object.is(factorial2(-303), -0)).toBe(false);
  });

  test('past the subnormal range the value underflows to a signed zero', () => {
    // -1/341!! and 1/343!! are below Number.MIN_VALUE / 2.
    expect(nearestDouble(...exactValue(-341))).toBe(0);
    expect(Object.is(factorial2(-341), 0)).toBe(true);
    expect(Object.is(factorial2(-343), -0)).toBe(true);
  });

  test('a huge odd negative integer ends quickly', () => {
    expect(Object.is(factorial2(-9007199254740991), -0)).toBe(true);
    expect(Object.is(factorial2(-9007199254740989), 0)).toBe(true);
  });

  test('the compiled JavaScript route gives the same value', () => {
    const f = compile(ce.parse('x!!'), {
      to: 'javascript',
      fallback: false,
    } as never);
    expect(f.success).toBe(true);
    const run = (x: number) => f.run!({ x } as never) as number;
    expect(run(-303)).toBe(factorial2(-303));
    expect(run(-303)).toBeLessThan(0);
    expect(run(-305)).toBeGreaterThan(0);
  });
});

describe('Factorial2 interval enclosure contains the true value', () => {
  const enclosure = (n: number) => {
    const r = intervalFactorial2({ lo: n, hi: n }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(r.kind).toBe('interval');
    return r.value;
  };

  test('at every odd negative integer down to -401', () => {
    const missed: number[] = [];
    for (let n = -1; n >= -401; n -= 2) {
      const [p, q] = exactValue(n);
      const { lo, hi } = enclosure(n);
      if (compareExact(lo, p, q) > 0 || compareExact(hi, p, q) < 0)
        missed.push(n);
    }
    expect(missed).toEqual([]);
  });

  test('at every integer from 0 to 320', () => {
    // The product rounds once per factor past 2^53, so the computed value
    // can be several ulps from the true one (8 ulps at most below 301).
    const missed: number[] = [];
    for (let n = 0; n <= 320; n++) {
      const [p, q] = exactValue(n);
      const { lo, hi } = enclosure(n);
      if (compareExact(lo, p, q) > 0 || compareExact(hi, p, q) < 0)
        missed.push(n);
    }
    expect(missed).toEqual([]);
  });

  test('an underflowed value is not certified as the exact point 0', () => {
    // -1/315!! underflows to -0 in the kernel; the true value is negative.
    const v = enclosure(-315);
    expect(v.lo).toBeLessThan(0);
    // 1/341!! is positive.
    const w = enclosure(-341);
    expect(w.hi).toBeGreaterThan(0);
  });

  test('an exact integer value stays an exact point', () => {
    expect(enclosure(5)).toEqual({ lo: 15, hi: 15 });
    expect(enclosure(-3)).toEqual({ lo: -1, hi: -1 });
  });

  test('the compiled interval-js route encloses (-303)!!', () => {
    const f = compile(ce.parse('x!!'), {
      to: 'interval-js',
      fallback: false,
    } as never);
    expect(f.success).toBe(true);
    const r = f.run!({ x: -303 } as never) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(r.kind).toBe('interval');
    const [p, q] = exactValue(-303);
    expect(compareExact(r.value.lo, p, q)).toBeLessThanOrEqual(0);
    expect(compareExact(r.value.hi, p, q)).toBeGreaterThanOrEqual(0);
  });
});
