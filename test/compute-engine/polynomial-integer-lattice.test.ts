import {
  reduceIntegerLattice,
  isReducedIntegerLattice,
  integerRowBasis,
  integerGramSchmidt,
} from '../../src/compute-engine/polynomial/integer-lattice';
import {
  PolynomialWork,
  rationalField as Q,
  rationalCoefficient as q,
  type RationalCoefficient,
} from '../../src/compute-engine/polynomial/exact-field';

test('integer projection removes dependencies without saturating the row lattice', () => {
  const input = [
    [6n, 0n, 6n],
    [4n, 0n, 4n],
    [0n, 3n, 3n],
    [2n, 3n, 5n],
    [0n, 0n, 0n],
  ];
  expect(integerRowBasis(input, new PolynomialWork())).toEqual([
    [2n, 0n, 2n],
    [0n, 3n, 3n],
  ]);
  expect(
    integerRowBasis(
      [
        [2n, 0n],
        [0n, 2n],
        [2n, 2n],
      ],
      new PolynomialWork()
    )
  ).toEqual([
    [2n, 0n],
    [0n, 2n],
  ]);
  expect(integerRowBasis([[0n, 0n]], new PolynomialWork())).toEqual([]);
  expect(() => integerRowBasis(input, new PolynomialWork(0))).toThrow(
    'operation-limit'
  );
});

test('truncated knapsack reduction retains exact transformations and certified norms', () => {
  const input = Array.from({ length: 7 }, (_, i) =>
    Array.from({ length: 7 }, (_, j) =>
      j === 6
        ? i === 6
          ? 2n ** 32n
          : BigInt(7919 * (i + 1))
        : i === j
          ? 1n
          : 0n
    )
  );
  const result = reduceIntegerLattice(input, new PolynomialWork());
  expect(
    result.transformation.map((row) =>
      input[0].map((_, j) =>
        row.reduce((sum, c, i) => sum + c * input[i][j], 0n)
      )
    )
  ).toEqual(result.basis);
  expect(result.squaredNorms).toEqual(
    integerGramSchmidt(result.basis, new PolynomialWork()).norms
  );
  expect(() => reduceIntegerLattice(input, new PolynomialWork(0))).toThrow(
    'operation-limit'
  );
});

// Independent determinant expansion is deliberately limited to small tests.
const determinant = (a: bigint[][]): bigint =>
  a.length === 1
    ? a[0][0]
    : a[0].reduce(
        (s, c, j) =>
          s +
          (j % 2 ? -c : c) *
            determinant(a.slice(1).map((r) => r.filter((_, k) => k !== j))),
        0n
      );

test.each([
  [
    [1n, 1n, 1n],
    [-1n, 0n, 2n],
    [3n, 5n, 6n],
  ],
  [
    [1n, 0n, 2n ** 100n],
    [0n, 1n, 2n ** 100n + 1n],
  ],
  [
    [100n, 1n],
    [1n, 0n],
  ],
  [
    [-17n, 4n, 2n],
    [5n, -13n, 6n],
    [9n, 2n, -11n],
  ],
])(
  'LLL preserves the lattice and satisfies exact inequalities: %j',
  (...rows) => {
    const input = rows as bigint[][];
    const copy = input.map((r) => [...r]);
    const result = reduceIntegerLattice(input);
    const reconstructed = result.transformation.map((r) =>
      input[0].map((_, j) => r.reduce((s, c, i) => s + c * input[i][j], 0n))
    );
    expect(reconstructed).toEqual(result.basis);
    expect([1n, -1n]).toContain(determinant(result.transformation));
    expect(isReducedIntegerLattice(result.basis)).toBe(true);
    // Independent orthogonal-vector construction checks the norms used by
    // recombination's short-vector containment proof, not just LLL inequalities.
    const orthogonal: RationalCoefficient[][] = [];
    const dot = (a: RationalCoefficient[], b: RationalCoefficient[]) =>
      a.reduce((s, c, i) => Q.add(s, Q.mul(c, b[i])), Q.zero);
    const norms = result.basis.map((row) => {
      let v = row.map((c) => q(c));
      for (const u of orthogonal) {
        const mu = Q.mul(dot(v, u), Q.inv(dot(u, u)));
        v = v.map((c, i) => Q.add(c, Q.neg(Q.mul(mu, u[i]))));
      }
      orthogonal.push(v);
      return dot(v, v);
    });
    expect(result.squaredNorms).toEqual(norms);
    expect(input).toEqual(copy);
  }
);

test('generated unimodular shears preserve full-rank lattices', () => {
  for (let seed = 1n; seed <= 20n; seed++) {
    const basis = [
      [1n, seed, 0n],
      [0n, 1n, seed + 1n],
      [seed, seed * seed, 1n],
    ];
    const result = reduceIntegerLattice(basis);
    expect(isReducedIntegerLattice(result.basis)).toBe(true);
    expect([1n, -1n]).toContain(determinant(result.transformation));
    expect(
      result.transformation.map((r) =>
        basis[0].map((_, j) => r.reduce((s, c, i) => s + c * basis[i][j], 0n))
      )
    ).toEqual(result.basis);
  }
});

test('rejects malformed/dependent bases and obeys caller work/cancellation limits', () => {
  for (const input of [
    [],
    [[1n], [2n]],
    [
      [1n, 2n],
      [2n, 4n],
    ],
    [[1n, 2n], [1n]],
  ])
    expect(() => reduceIntegerLattice(input)).toThrow();
  expect(() =>
    reduceIntegerLattice(
      [
        [1n, 2n],
        [3n, 4n],
      ],
      new PolynomialWork(0)
    )
  ).toThrow('operation-limit');
  expect(() =>
    reduceIntegerLattice(
      [[1n]],
      new PolynomialWork(100, () => {
        throw Error('cancelled');
      })
    )
  ).toThrow('cancelled');
  expect(
    isReducedIntegerLattice([
      [1n, 0n],
      [10n, 1n],
    ])
  ).toBe(false);
});

test('preconditioning remains exactly certified on larger and ill-conditioned bases', () => {
  for (const bits of [12n, 120n, 1100n]) {
    const n = 7;
    const input = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) =>
        j === i ? 1n : j === n ? (1n << bits) + BigInt(i * i + 1) : 0n
      )
    );
    const result = reduceIntegerLattice(input, new PolynomialWork(2_000_000));
    expect(isReducedIntegerLattice(result.basis)).toBe(true);
    expect(
      result.transformation.map((row) =>
        input[0].map((_, j) => row.reduce((s, c, i) => s + c * input[i][j], 0n))
      )
    ).toEqual(result.basis);
    // Bareiss determinant checks unimodularity without a factorial expansion.
    const a = result.transformation.map((r) => [...r]);
    let previous = 1n,
      sign = 1n;
    for (let k = 0; k < n - 1; k++) {
      const pivotRow = a.findIndex((r, i) => i >= k && r[k] !== 0n);
      expect(pivotRow).toBeGreaterThanOrEqual(k);
      if (pivotRow !== k) {
        [a[k], a[pivotRow]] = [a[pivotRow], a[k]];
        sign = -sign;
      }
      const pivot = a[k][k];
      for (let i = k + 1; i < n; i++)
        for (let j = k + 1; j < n; j++)
          a[i][j] = (a[i][j] * pivot - a[i][k] * a[k][j]) / previous;
      for (let i = k + 1; i < n; i++) a[i][k] = 0n;
      previous = pivot;
    }
    expect([1n, -1n]).toContain(sign * a[n - 1][n - 1]);
  }
});
