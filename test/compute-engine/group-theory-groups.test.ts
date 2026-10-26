import {
  PermutationAction,
  PermutationValue,
  PermutationInputError,
  inversePermutation,
} from '../../src/compute-engine/group-theory/permutation/values';
import {
  PermutationGroupValue,
  enumeratePermutationGroup,
  PermutationClosureLimitError,
  type PermutationClosureLimits,
} from '../../src/compute-engine/group-theory/permutation/groups';

const p = new PermutationValue([2, 1]);
const q = new PermutationValue([1, 3, 2]);
const action = new PermutationAction(3);
const s3 = new PermutationGroupValue([p, q], action);
const enough = { maxElements: 100, maxProducts: 1000 };
const keys = (values: readonly PermutationValue[]) =>
  values.map((x) => x.images.join(',')).sort();

describe('generator-based permutation descriptors', () => {
  test('copies generators and preserves action, order and redundant generators', () => {
    const input = [q, p, p, new PermutationValue([])];
    const group = new PermutationGroupValue(input, action);
    input.pop();
    expect(group.generators).toHaveLength(4);
    expect(group.generators[0]).toBe(q);
    expect(group.action.degree).toBe(3);
    expect(Object.isFrozen(group)).toBe(true);
    expect(Object.isFrozen(group.generators)).toBe(true);
    expect(group.domain).toBe(p.domain);
  });
  test('requires an explicit valid action even for empty generators', () => {
    expect(
      () =>
        new PermutationGroupValue([], undefined as unknown as PermutationAction)
    ).toThrow('incompatible-permutation-domain');
    expect(
      new PermutationGroupValue([], new PermutationAction(0)).action.degree
    ).toBe(0);
    expect(
      () => new PermutationGroupValue([q], new PermutationAction(2))
    ).toThrow('permutation-outside-action');
  });
  test.each(
    [null, {}, [null], [p, {}], [p.toJSON()], new Array(1)].map((input) => ({
      input,
    }))
  )('rejects unvalidated generators $input', ({ input }) => {
    expect(() => new PermutationGroupValue(input, action)).toThrow(
      PermutationInputError
    );
  });
  test('checks generator count, retained image slots and receiving degree', () => {
    expect(
      () => new PermutationGroupValue([p], action, { maxGenerators: 0 })
    ).toThrow('permutation-generator-limit');
    expect(
      () => new PermutationGroupValue([p, q], action, { maxGeneratorImages: 4 })
    ).toThrow('permutation-generator-image-limit');
    expect(
      () => new PermutationGroupValue([], action, { maxDegree: 2 })
    ).toThrow('permutation-degree-limit');
    expect(
      () => new PermutationGroupValue([], action, { maxGenerators: -1 })
    ).toThrow('invalid-permutation-generator-limit');
    expect(() => new PermutationGroupValue(new Array(1025), action)).toThrow(
      'permutation-generator-limit'
    );
  });
  test('portable descriptors revalidate every generator and action', () => {
    const data = JSON.parse(JSON.stringify(s3));
    const copy = PermutationGroupValue.fromJSON(data);
    expect(copy.toJSON()).toEqual(s3.toJSON());
    expect(PermutationGroupValue.is(data)).toBe(false);
    expect(
      PermutationGroupValue.is(Object.create(PermutationGroupValue.prototype))
    ).toBe(false);
    expect(() =>
      PermutationGroupValue.fromJSON({ ...data, version: 2 })
    ).toThrow('invalid-permutation-group-descriptor');
    expect(() => PermutationGroupValue.fromJSON({ ...data, order: 6 })).toThrow(
      'invalid-permutation-group-descriptor'
    );
    expect(() =>
      PermutationGroupValue.fromJSON({
        ...data,
        action: new PermutationAction(2).toJSON(),
      })
    ).toThrow('permutation-outside-action');
    expect(() =>
      PermutationGroupValue.fromJSON({
        ...data,
        generators: [{ ...p.toJSON(), images: [1, 1] }],
      })
    ).toThrow('duplicate-permutation-image');
    expect(() =>
      PermutationGroupValue.fromJSON(data, { maxGenerators: 1 })
    ).toThrow('permutation-generator-limit');
    expect(() =>
      PermutationGroupValue.fromJSON(data, { maxGeneratorImages: 4 })
    ).toThrow('permutation-generator-image-limit');
    expect(() =>
      PermutationGroupValue.fromJSON({
        ...data,
        action: { ...data.action, domain: { kind: 'other', version: 1 } },
      })
    ).toThrow('incompatible-permutation-domain');
  });
});

describe('complete bounded closure', () => {
  test('S3 gives the six independently listed permutations', () => {
    const result = enumeratePermutationGroup(s3, {
      maxElements: 6,
      maxProducts: 12,
    });
    expect(keys(result)).toEqual(
      ['', '2,1', '1,3,2', '3,1,2', '2,3,1', '3,2,1'].sort()
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(result[0].images).toEqual([]);
    expect(keys(enumeratePermutationGroup(s3, enough))).toEqual(keys(result));
  });
  test.each([
    { name: 'C4', generators: [[2, 3, 4, 1]], size: 4 },
    {
      name: 'V4',
      generators: [
        [2, 1, 4, 3],
        [3, 4, 1, 2],
      ],
      size: 4,
    },
    {
      name: 'D8',
      generators: [
        [2, 3, 4, 1],
        [1, 4, 3, 2],
      ],
      size: 8,
    },
    {
      name: 'A4',
      generators: [
        [2, 3, 1],
        [2, 4, 3, 1],
      ],
      size: 12,
    },
    {
      name: 'S4',
      generators: [
        [2, 3, 4, 1],
        [2, 1],
      ],
      size: 24,
    },
  ])(
    '$name has the expected size and is closed under inverses',
    ({ generators, size }) => {
      const group = new PermutationGroupValue(
        generators.map((x) => new PermutationValue(x)),
        new PermutationAction(4)
      );
      const result = enumeratePermutationGroup(group, enough);
      expect(result).toHaveLength(size);
      const members = new Set(keys(result));
      for (const element of result)
        expect(members.has(inversePermutation(element).images.join(','))).toBe(
          true
        );
    }
  );
  test('empty generators yield identity on both empty and nonempty actions', () => {
    for (const degree of [0, 5]) {
      const group = new PermutationGroupValue(
        [],
        new PermutationAction(degree)
      );
      expect(
        keys(
          enumeratePermutationGroup(group, {
            maxElements: 1,
            maxProducts: 0,
            maxStoredImages: 0,
            maxImageWork: 0,
          })
        )
      ).toEqual(['']);
      expect(group.action.degree).toBe(degree);
    }
  });
  test('identities and redundant generators do not consume extra element capacity', () => {
    const trivial = new PermutationGroupValue(
      [new PermutationValue([])],
      action
    );
    expect(
      keys(
        enumeratePermutationGroup(trivial, { maxElements: 1, maxProducts: 1 })
      )
    ).toEqual(['']);
    const redundant = new PermutationGroupValue(
      [p, p, q, new PermutationValue([])],
      action
    );
    expect(
      keys(
        enumeratePermutationGroup(redundant, {
          maxElements: 6,
          maxProducts: 24,
        })
      )
    ).toEqual(keys(enumeratePermutationGroup(s3, enough)));
  });
  test('different descriptors can generate the same subgroup', () => {
    const other = new PermutationGroupValue([q, p], action);
    expect(other.toJSON()).not.toEqual(s3.toJSON());
    expect(keys(enumeratePermutationGroup(other, enough))).toEqual(
      keys(enumeratePermutationGroup(s3, enough))
    );
  });
  test.each([
    { limits: { maxElements: 5, maxProducts: 12 }, code: 'element' },
    { limits: { maxElements: 6, maxProducts: 11 }, code: 'product' },
    {
      limits: { maxElements: 6, maxProducts: 12, maxImageWork: 0 },
      code: 'image-work',
    },
    {
      limits: { maxElements: 6, maxProducts: 12, maxStoredImages: 1 },
      code: 'storage',
    },
  ])('exhaustion of $code returns no partial success', ({ limits, code }) => {
    let caught: unknown;
    try {
      enumeratePermutationGroup(s3, limits);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PermutationClosureLimitError);
    expect((caught as PermutationClosureLimitError).code).toBe(
      `permutation-closure-${code}-limit`
    );
    expect(caught).not.toHaveProperty('elements');
    expect(enumeratePermutationGroup(s3, enough)).toHaveLength(6);
  });
  test('exact work and storage boundaries allow duplicate products at capacity', () => {
    const c2 = new PermutationGroupValue([p], action);
    expect(
      enumeratePermutationGroup(c2, {
        maxElements: 2,
        maxProducts: 2,
        maxImageWork: 4,
        maxStoredImages: 2,
      })
    ).toHaveLength(2);
    expect(() =>
      enumeratePermutationGroup(c2, {
        maxElements: 2,
        maxProducts: 2,
        maxImageWork: 3,
      })
    ).toThrow('permutation-closure-image-work-limit');
  });
  test.each(
    [
      {},
      { maxElements: 0, maxProducts: 1 },
      { maxElements: 10001, maxProducts: 1 },
      { maxElements: 6, maxProducts: -1 },
      { maxElements: 6, maxProducts: Infinity },
      { maxElements: 6, maxProducts: 12, maxStoredImages: -1 },
      { maxElements: 6, maxProducts: 12, maxImageWork: 0.5 },
    ].map((limits) => ({ limits }))
  )('rejects invalid bounds $limits', ({ limits }) => {
    expect(() =>
      enumeratePermutationGroup(s3, limits as PermutationClosureLimits)
    ).toThrow(PermutationInputError);
  });
  test('rechecks limits on branded inputs and rejects forged groups', () => {
    expect(() =>
      enumeratePermutationGroup(s3, enough, { maxGenerators: 1 })
    ).toThrow('permutation-generator-limit');
    expect(() =>
      enumeratePermutationGroup(
        { generators: [p], action } as unknown as PermutationGroupValue,
        enough
      )
    ).toThrow('invalid-permutation-group');
  });
  test('cancellation during a search propagates and leaves the descriptor reusable', () => {
    let checks = 0;
    const cancelled = new Error('cancelled');
    expect(() =>
      enumeratePermutationGroup(s3, enough, {
        check: () => {
          if (++checks === 25) throw cancelled;
        },
      })
    ).toThrow(cancelled);
    expect(checks).toBe(25);
    expect(enumeratePermutationGroup(s3, enough)).toHaveLength(6);
  });
});
