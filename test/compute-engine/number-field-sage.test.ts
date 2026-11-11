import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RationalNumberField } from '../../src/compute-engine/polynomial/number-field';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field';
import {
  coordinates,
  element,
  maximalOrder,
  norm,
  orderDiscriminant,
  orderIndex,
  realRootCount,
  trace,
} from '../../src/compute-engine/numerics/number-field';
import {
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

const gcdOf = (a: bigint, b: bigint): bigint =>
  b === 0n ? (a < 0n ? -a : a) : gcdOf(b, a % b);

describe('number fields against Sage', () => {
  test.each(sage.map((f) => [f.f.join(' '), f] as const))(
    'Q[x]/(%s): discriminant, index, signature and basis',
    (_, field) => {
      const f = field.f.map(BigInt);
      const n = f.length - 1;
      // The field is a field: the engine certifies its polynomial irreducible.
      expect(() =>
        RationalNumberField.create(f.map((c) => q(c)))
      ).not.toThrow();
      const o = maximalOrder(f);
      expect(orderDiscriminant(o).toString()).toBe(field.discriminant);
      expect(orderIndex(o).toString()).toBe(field.index);
      const r1 = realRootCount(f);
      expect([r1, (n - r1) / 2]).toEqual(field.signature);
      // Sage's basis lies in our ring of integers.
      for (const b of field.basis) {
        const cs = b.map((t) => {
          const [num, den = '1'] = t.split('/');
          return { num: BigInt(num!), den: BigInt(den) };
        });
        const den = cs.reduce((l, c) => (l * c.den) / gcdOf(l, c.den), 1n);
        const x = element(
          cs.map((c) => (c.num * den) / c.den),
          den
        );
        expect(coordinates(o, x)).toBeDefined();
      }
    }
  );
});

test('norm and trace of theta + 1 in Q(cbrt 2)', () => {
  const f = [-2n, 0n, 0n, 1n];
  const x = element([1n, 1n, 0n]);
  expect(norm(f, x)).toEqual({ num: 3n, den: 1n });
  expect(trace(f, x)).toEqual({ num: 3n, den: 1n });
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
    const [root] = orderedRoots([-2n, 0n, 0n, 1n])!;
    expect(refineRoot([-2n, 0n, 0n, 1n], root!, 30)?.re).toBe(
      '125992104989487316476721060728e-29'
    );
  });
});
