import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RationalNumberField } from '../../src/compute-engine/polynomial/number-field';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field';
import {
  characteristicPolynomial,
  coordinates,
  maximalOrder,
  minimalPolynomial,
  orderDiscriminant,
  orderIndex,
  realRootCount,
} from '../../src/compute-engine/numerics/number-field';
import {
  matchRoots,
  orderedRoots,
  refineRoot,
} from '../../src/compute-engine/numerics/ordered-polynomial-roots';

// The number-field kernel against Sage (fixtures/number-fields.sage.json): each field's
// discriminant, index, signature and ring of integers.

interface SageField {
  f: string[];
  discriminant: string;
  index: string;
  signature: [number, number];
  basis: string[][];
}

const sage: SageField[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'number-fields.sage.json'), 'utf8')
);

describe('number fields against Sage', () => {
  test.each(sage.map((f) => [f.f.join(' '), f] as const))(
    'Q[x]/(%s): discriminant, index, signature and basis',
    (_, field) => {
      const f = field.f.map(BigInt);
      const n = f.length - 1;
      // The field is a field: the engine certifies its polynomial irreducible.
      const K = RationalNumberField.create(f.map((c) => q(c)));
      const o = maximalOrder(K);
      expect(orderDiscriminant(o).toString()).toBe(field.discriminant);
      expect(orderIndex(o).toString()).toBe(field.index);
      const r1 = realRootCount(f);
      expect([r1, (n - r1) / 2]).toEqual(field.signature);
      // Sage's basis lies in our ring of integers.
      for (const b of field.basis) {
        const x = K.element(
          b.map((t) => {
            const [num, den = '1'] = t.split('/');
            return q(BigInt(num!), BigInt(den));
          })
        );
        expect(coordinates(o, x)).toBeDefined();
      }
    }
  );
});

test('characteristic and minimal polynomial of theta + 1 in Q(cbrt 2)', () => {
  const K = RationalNumberField.create([-2n, 0n, 0n, 1n].map((c) => q(c)));
  const x = K.add(K.generator, K.one);
  // (t − 1)³ − 2 = t³ − 3t² + 3t − 3
  expect(characteristicPolynomial(K, x).map((c) => c.numerator)).toEqual([
    -3n,
    3n,
    -3n,
    1n,
  ]);
  expect(minimalPolynomial(K, x)).toEqual([-3n, 3n, -3n, 1n]);
  // The characteristic polynomial of a rational is a power of its minimal one.
  expect(minimalPolynomial(K, K.element([q(2n)]))).toEqual([-2n, 1n]);
});

describe('the roots of a polynomial', () => {
  const show = (f: bigint[]) =>
    orderedRoots(f)?.map((z) => [
      Number(z.re.toFixed(6)),
      Number(z.im.toFixed(6)),
    ]);

  test('come real first and increasing, then complex by real part and imaginary part', () => {
    expect(show([1n, -3n, 0n, 1n])).toEqual([
      [-1.879385, 0],
      [0.347296, 0],
      [1.532089, 0],
    ]);
    expect(show([-2n, 0n, 0n, 1n])).toEqual([
      [1.259921, 0],
      [-0.629961, -1.091124],
      [-0.629961, 1.091124],
    ]);
    // Real parts equal in pairs: the lower imaginary part first.
    expect(show([1n, 0n, 0n, 0n, 1n])).toEqual([
      [-0.707107, -0.707107],
      [-0.707107, 0.707107],
      [0.707107, -0.707107],
      [0.707107, 0.707107],
    ]);
  });

  test('are declined for a repeated root, and refined to the digits asked', () => {
    expect(orderedRoots([1n, 2n, 1n])).toBeUndefined();
    expect(refineRoot([-2n, 0n, 0n, 1n], 1, 30)?.re).toBe(
      '125992104989487316476721060728e-29'
    );
  });

  test("Wilkinson's polynomial of degree 10 has the roots 1 to 10", () => {
    // ∏ (x − k), k = 1…10, constant term first.
    let f: bigint[] = [1n];
    for (let k = 1n; k <= 10n; k++) {
      const next: bigint[] = Array.from({ length: f.length + 1 }, () => 0n);
      f.forEach((c, i) => {
        next[i + 1]! += c;
        next[i]! -= k * c;
      });
      f = next;
    }
    expect(orderedRoots(f)?.map((z) => Math.round(z.re))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  test('roots whose real parts differ in the tenth digit are numbered by proof', () => {
    // (x² − 2a·x + 2a²)(x² − 2(a+1)·x + (a+1)² + 4a²): a ± a·i and (a+1) ± 2a·i.
    const a = 10000000001n;
    const mul = (p: bigint[], r: bigint[]) => {
      const out: bigint[] = Array.from(
        { length: p.length + r.length - 1 },
        () => 0n
      );
      p.forEach((c, i) => r.forEach((d, j) => (out[i + j]! += c * d)));
      return out;
    };
    const f = mul(
      [2n * a * a, -2n * a, 1n],
      [(a + 1n) * (a + 1n) + 4n * a * a, -2n * (a + 1n), 1n]
    );
    const roots = orderedRoots(f)!;
    expect(roots.map((z) => [z.re, z.im])).toEqual([
      [Number(a), -Number(a)],
      [Number(a), Number(a)],
      [Number(a) + 1, -2 * Number(a)],
      [Number(a) + 1, 2 * Number(a)],
    ]);
  });

  test('roots with one real part that is not a proved tie are declined', () => {
    // x⁴ + 5x² + 4: the pairs ±i and ±2i share the real part 0, which is proved.
    expect(orderedRoots([4n, 0n, 5n, 0n, 1n])?.map((z) => z.im)).toEqual([
      expect.closeTo(-2, 12),
      expect.closeTo(-1, 12),
      expect.closeTo(1, 12),
      expect.closeTo(2, 12),
    ]);
  });
});

describe('elements of a field are matched to the roots by proof', () => {
  // x⁴ − 2N²x² + N⁴ − 2: the roots ±√(N² ± √2) are real, and in pairs about 1.4e-5 apart,
  // a relative gap of 1e-10 that doubles can't tell from a tie.
  const N = 100000n;
  const m = [N ** 4n - 2n, 0n, -2n * N * N, 0n, 1n];
  const rational = (...c: bigint[]) =>
    c.map((numerator) => ({ numerator, denominator: 1n }));

  test('θ is the first root, and −θ the last', () => {
    expect(matchRoots(m, m, [rational(0n, 1n), rational(0n, -1n)])).toEqual([
      1, 4,
    ]);
  });

  test('an element that is not a root of the polynomial is not matched', () => {
    expect(matchRoots(m, m, [rational(1n, 1n)])).toBeUndefined();
  });

  test('a clear case: the cube roots of 2 in their splitting field', () => {
    // θ³ − 2 against itself: θ is root 1 at the real embedding.
    expect(
      matchRoots([-2n, 0n, 0n, 1n], [-2n, 0n, 0n, 1n], [rational(0n, 1n)])
    ).toEqual([1]);
  });
});
