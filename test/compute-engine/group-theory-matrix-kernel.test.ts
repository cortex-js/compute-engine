import {
  ExactMatrixField,
  ExactMatrixValue,
  ExactMatrixGroup,
  naturalLinearGroup,
  primeFieldMatrixGroupOrder,
  isNaturalLinearGroup,
  invariantRationalGroupLattice,
} from '../../src/compute-engine/group-theory/matrix';
import {
  GroupInputError,
  GroupLimitError,
  GroupWork,
} from '../../src/compute-engine/group-theory/finite-group';
import { PermutationStabilizerChain } from '../../src/compute-engine/group-theory/permutation/stabilizer-chain';
import { composePermutations } from '../../src/compute-engine/group-theory/permutation/values';

const ledger = () => new GroupWork(50_000_000);
const rational = new ExactMatrixField();
const matrix = (rows: bigint[][], prime = 0) =>
  ExactMatrixValue.fromRows(new ExactMatrixField(prime), rows, ledger());

describe('exact matrix values and domain boundaries', () => {
  test('normalizes rational input and copies its coefficient records', () => {
    const value = { numerator: 6n, denominator: -8n };
    const rows = [[value]];
    const result = ExactMatrixValue.fromRows(rational, rows, ledger());
    value.numerator = 100n;
    expect(result.rows).toEqual([[{ numerator: -3n, denominator: 4n }]]);
    expect(matrix([[2n]]).inverse(ledger()).rows[0][0]).toEqual({
      numerator: 1n,
      denominator: 2n,
    });
  });

  test('checks prime fields, denominators, dimensions, and coefficient bounds', () => {
    expect(() => new ExactMatrixField(9)).toThrow(GroupInputError);
    expect(() =>
      ExactMatrixValue.fromRows(
        new ExactMatrixField(3),
        [[{ numerator: 1n, denominator: 3n }]],
        ledger()
      )
    ).toThrow('matrix-denominator-zero-in-field');
    expect(() =>
      ExactMatrixValue.fromRows(rational, [[1n, 0n]], ledger())
    ).toThrow('invalid-exact-square-matrix');
    expect(() => matrix([[1n << 4096n]])).toThrow(GroupLimitError);
    expect(() =>
      matrix([[1n]], 2).multiply(matrix([[1n]], 3), ledger())
    ).toThrow('incompatible-matrix-domain');
    expect(() =>
      matrix([[1n]]).multiply(
        matrix([
          [1n, 0n],
          [0n, 1n],
        ]),
        ledger()
      )
    ).toThrow('incompatible-matrix-domain');
  });

  test('allows singular forms but rejects singular group generators and inverses', () => {
    const singular = matrix([
      [1n, 2n],
      [2n, 4n],
    ]);
    expect(singular.determinant(ledger()).numerator).toBe(0n);
    expect(() => singular.inverse(ledger())).toThrow('singular-matrix');
    expect(
      () => new ExactMatrixGroup(rational, 2, [singular], ledger())
    ).toThrow('singular-matrix-generator');
  });

  test.each([0, 2, 3, 5, 7])(
    'exact laws and right action over characteristic %s',
    (prime) => {
      const work = ledger();
      const a = matrix(
        [
          [1n, 1n],
          [0n, 1n],
        ],
        prime
      );
      const b = matrix(
        [
          [1n, 0n],
          [1n, 1n],
        ],
        prime
      );
      const identity = ExactMatrixValue.identity(a.field, 2, work);
      expect(a.multiply(a.inverse(work), work).rows).toEqual(identity.rows);
      expect(a.multiply(b, work).determinant(work)).toEqual(
        a.field.mul(a.determinant(work), b.determinant(work), work)
      );
      expect(a.multiply(b, work).act([2n, 3n], work)).toEqual(
        b.act(a.act([2n, 3n], work), work)
      );
      expect(a.multiply(b, work).transpose(work).rows).toEqual(
        b.transpose(work).multiply(a.transpose(work), work).rows
      );
      expect(a.power(-7n, work).multiply(a.power(7n, work), work).rows).toEqual(
        identity.rows
      );
    }
  );

  test('sparse vectors cannot silently omit a coordinate', () => {
    const vector = Array<bigint>(2);
    vector[1] = 1n;
    expect(() =>
      matrix([
        [1n, 0n],
        [0n, 1n],
      ]).act(vector, ledger())
    ).toThrow('invalid-exact-matrix-coefficient');
  });

  test('zero budgets and cancellation stop arithmetic, including transpose', () => {
    const a = matrix([
      [1n, 1n],
      [0n, 1n],
    ]);
    expect(() => a.transpose(new GroupWork(0))).toThrow(GroupLimitError);
    const cancelled = new Error('cancelled');
    expect(() =>
      a.power(
        1000n,
        new GroupWork(50_000, () => {
          throw cancelled;
        })
      )
    ).toThrow(cancelled);
  });
});

describe('generated matrix groups and faithful actions', () => {
  test.each([
    [1, 5, false, 4n],
    [1, 5, true, 1n],
    [2, 2, false, 6n],
    [2, 3, false, 48n],
    [2, 3, true, 24n],
    [3, 2, false, 168n],
    [4, 2, false, 20160n],
  ] as const)(
    'GL/SL(%s,%s) special=%s has exact order %s',
    (dimension, prime, special, expected) => {
      const group = naturalLinearGroup(dimension, prime, special, ledger());
      expect(primeFieldMatrixGroupOrder(group, 1000, ledger())).toBe(expected);
      expect(isNaturalLinearGroup(group, special, 1000, ledger())).toBe(true);
      expect(group.generators.length).toBeLessThanOrEqual(2 * dimension);
    }
  );

  test('complete vector action respects products and identifies all group elements', () => {
    const group = naturalLinearGroup(2, 3, false, ledger());
    const action = group.action(false, 9, ledger());
    expect(action.faithful).toBe(true);
    const [a, b] = group.generators;
    const productGroup = new ExactMatrixGroup(
      group.field,
      2,
      [a.multiply(b, ledger())],
      ledger()
    );
    const productAction = productGroup.action(false, 9, ledger());
    expect(productAction.group.generators[0].images).toEqual(
      composePermutations(
        action.group.generators[0],
        action.group.generators[1]
      ).images
    );
    expect(group.enumerate(48, ledger())).toHaveLength(48);
    expect(() => group.enumerate(47, ledger())).toThrow(
      'matrix-group-element-limit'
    );
  });

  test('projective scalar kernels are never silently treated as faithful', () => {
    const scalar = matrix(
      [
        [2n, 0n],
        [0n, 2n],
      ],
      3
    );
    const group = new ExactMatrixGroup(scalar.field, 2, [scalar], ledger());
    const projective = group.action(true, 4, ledger());
    expect(projective.faithful).toBeUndefined();
    expect(projective.points).toHaveLength(4);
    expect(projective.group.generators[0].images).toEqual([]);
    expect(primeFieldMatrixGroupOrder(group, 9, ledger())).toBe(2n);
    expect(
      naturalLinearGroup(2, 2, false, ledger()).action(true, 3, ledger())
        .faithful
    ).toBe(true);
  });

  test('finite models inherit matrix associativity and preserve multiplication', () => {
    const group = naturalLinearGroup(2, 2, false, ledger());
    const model = group.finiteModel(6, ledger());
    expect(model.table.order).toBe(6);
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++)
        expect(
          model.indexOf(model.elements[i].multiply(model.elements[j], ledger()))
        ).toBe(model.table.rows[i][j]);
  });

  test('nested chain work is charged exactly once and respects an exact total budget', () => {
    const group = naturalLinearGroup(4, 2, false, ledger());
    const actionWork = ledger();
    const action = group.action(false, 16, actionWork);
    const chain = PermutationStabilizerChain.compute(action.group, {
      maxWork: 50_000_000,
    });
    const expectedWork = actionWork.used + chain.workUsed;
    const exact = new GroupWork(expectedWork);
    expect(primeFieldMatrixGroupOrder(group, 16, exact)).toBe(20160n);
    expect(exact.used).toBe(expectedWork);
    expect(() =>
      primeFieldMatrixGroupOrder(group, 16, new GroupWork(expectedWork - 1))
    ).toThrow(GroupLimitError);
  });

  test('point limits and cancellation cannot produce a guessed order', () => {
    const group = naturalLinearGroup(4, 2, false, ledger());
    expect(() => primeFieldMatrixGroupOrder(group, 15, ledger())).toThrow(
      'matrix-action-point-limit'
    );
    const cancelled = new Error('cancelled');
    let actionChecks = 0;
    group.action(
      false,
      16,
      new GroupWork(50_000_000, () => {
        actionChecks++;
      })
    );
    let checks = 0;
    expect(() =>
      primeFieldMatrixGroupOrder(
        group,
        16,
        new GroupWork(50_000_000, () => {
          if (++checks > actionChecks) throw cancelled;
        })
      )
    ).toThrow(cancelled);
  });

  test('trivial-group predicates still check cancellation', () => {
    const trivial = new ExactMatrixGroup(rational, 2, [], ledger());
    const cancelled = new Error('cancelled');
    const work = new GroupWork(50_000_000, () => {
      throw cancelled;
    });
    expect(() => trivial.isIntegral(work)).toThrow(cancelled);
    expect(() => trivial.isSubgroupSL(work)).toThrow(cancelled);
  });

  test('rational closure exhaustion makes no finite or infinite classification', () => {
    const unipotent = matrix([
      [1n, 1n],
      [0n, 1n],
    ]);
    const group = new ExactMatrixGroup(rational, 2, [unipotent], ledger());
    expect(() => group.enumerate(16, ledger())).toThrow(
      'matrix-group-element-limit'
    );
    expect(() => group.action(false, 16, ledger())).toThrow(
      'matrix-action-requires-finite-field'
    );
    expect(() => primeFieldMatrixGroupOrder(group, 16, ledger())).toThrow(
      'matrix-action-requires-finite-field'
    );
  });
});

describe('invariant forms and rational lattices', () => {
  test.each([0, 2, 3])(
    'bilinear forms satisfy g B g^T = B in characteristic %s',
    (prime) => {
      const swap = matrix(
        [
          [0n, 1n],
          [1n, 0n],
        ],
        prime
      );
      const group = new ExactMatrixGroup(swap.field, 2, [swap], ledger());
      const forms = group.invariantBilinearForms(ledger());
      expect(forms).toHaveLength(2);
      for (const form of forms)
        expect(
          swap
            .multiply(form, ledger())
            .multiply(swap.transpose(ledger()), ledger()).rows
        ).toEqual(form.rows);
    }
  );

  test.each([2, 3])(
    'quadratic forms are invariant without dividing by two over F%s',
    (prime) => {
      const transvection = matrix(
        [
          [1n, 1n],
          [0n, 1n],
        ],
        prime
      );
      const group = new ExactMatrixGroup(
        transvection.field,
        2,
        [transvection],
        ledger()
      );
      const forms = group.invariantQuadraticForms(ledger());
      expect(forms).toHaveLength(prime === 2 ? 2 : 1);
      const work = ledger();
      const field = transvection.field;
      const evaluate = (
        form: ExactMatrixValue,
        vector: ReturnType<ExactMatrixValue['act']>
      ) => {
        let value = field.normalize(0n, work);
        for (let i = 0; i < 2; i++)
          for (let j = i; j < 2; j++)
            value = field.add(
              value,
              field.mul(
                form.rows[i][j],
                field.mul(vector[i], vector[j], work),
                work
              ),
              work
            );
        return value;
      };
      for (let x = 0; x < prime; x++)
        for (let y = 0; y < prime; y++) {
          const vector = [BigInt(x), BigInt(y)].map((v) =>
            field.normalize(v, work)
          );
          for (const form of forms)
            expect(evaluate(form, transvection.act(vector, work))).toEqual(
              evaluate(form, vector)
            );
        }
    }
  );

  test('finite rational groups preserve the returned full lattice', () => {
    const generator = ExactMatrixValue.fromRows(
      rational,
      [
        [0n, 2n],
        [{ numerator: 1n, denominator: 2n }, 0n],
      ],
      ledger()
    );
    const group = new ExactMatrixGroup(rational, 2, [generator], ledger());
    expect(group.isIntegral(ledger())).toBe(false);
    const work = ledger();
    const basis = invariantRationalGroupLattice(group, 2, work);
    const integralGenerator = basis
      .multiply(generator, ledger())
      .multiply(basis.inverse(ledger()), ledger());
    expect(
      new ExactMatrixGroup(
        rational,
        2,
        [integralGenerator],
        ledger()
      ).isIntegral(ledger())
    ).toBe(true);
    expect(
      invariantRationalGroupLattice(group, 2, new GroupWork(work.used)).rows
    ).toEqual(basis.rows);
    expect(() =>
      invariantRationalGroupLattice(group, 2, new GroupWork(work.used - 1))
    ).toThrow(GroupLimitError);
  });

  test('lattice construction rejects finite-field input and incomplete rational closure', () => {
    expect(() =>
      invariantRationalGroupLattice(
        naturalLinearGroup(2, 2, false, ledger()),
        6,
        ledger()
      )
    ).toThrow('lattice-requires-rational-matrix-group');
    const infinite = new ExactMatrixGroup(
      rational,
      1,
      [matrix([[2n]])],
      ledger()
    );
    expect(() => invariantRationalGroupLattice(infinite, 8, ledger())).toThrow(
      'matrix-group-element-limit'
    );
  });
});
