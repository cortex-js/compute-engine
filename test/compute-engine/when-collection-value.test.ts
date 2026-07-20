import { ComputeEngine } from '../../src/compute-engine';
import '../utils'; // For snapshot serializers

/**
 * A `When(value, cond)` whose VALUE is a collection is an ELEMENTWISE
 * restriction: it behaves as `[When(v1, cond), …, When(vn, cond)]` (Tycho
 * item 66). Previously only a list-valued CONDITION broadcast; a scalar
 * indeterminate condition produced a held `When` with no collection
 * interface, so `isCollection`/`count`/`each()` disagreed with `.type`.
 *
 * The distribution is HYBRID-lazy (mirroring `PointList`): at or below
 * `MAX_SIZE_EAGER_COLLECTION` (100) it materializes into a `List`; past the
 * threshold the `When` stays held but its collection handlers expose the
 * elements lazily.
 */
describe('When: collection-valued restriction', () => {
  const engine = () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    return ce;
  };

  describe('eager distribution (<= 100 elements)', () => {
    test('scalar indeterminate condition distributes over a list value', () => {
      const ce = engine();
      const r = ce
        .parse('\\mathrm{When}([1,2,3], 0\\le t\\le 6)', { strict: false })
        .evaluate();

      expect(r.operator).toEqual('List');
      expect(r.isCollection).toBe(true);
      expect(r.count).toEqual(3);
      expect(Array.from(r.each()).length).toEqual(3);
      // Each element carries the condition.
      expect(r.at(1)?.operator).toEqual('When');
      expect(r.at(1)?.op1.re).toEqual(1);
      expect(r.at(3)?.op1.re).toEqual(3);
    });

    test('a value that only becomes a collection when evaluated', () => {
      const ce = engine();
      // `[1,2,3]t` is a `Multiply` until evaluated.
      const r = ce
        .parse('\\mathrm{When}([1,2,3]t, 0\\le t\\le 6)', { strict: false })
        .evaluate();

      expect(r.isCollection).toBe(true);
      expect(r.count).toEqual(3);
      expect(Array.from(r.each()).length).toEqual(3);
    });

    test('Add of two restricted point lists is an enumerable collection', () => {
      const ce = engine();
      ce.assign('P', ce.parse('[(1,2),(3,4),(5,6)]'));
      const r = ce
        .parse('t P\\{0\\le t\\le 1\\} + (1-t) P\\{0\\le t\\le 1\\}', {
          strict: false,
        })
        .evaluate();

      expect(r.isCollection).toBe(true);
      expect(r.count).toEqual(3);
      expect(Array.from(r.each()).length).toEqual(3);
      // t·P + (1-t)·P = P: the points are preserved, still restricted.
      expect(r.at(1)?.op1.json).toEqual(['Tuple', 1, 2]);
    });

    test('a restricted point stays a point (Tuple is not broadcast over)', () => {
      const ce = engine();
      const r = ce
        .parse('\\mathrm{When}((1,2), 0\\le t\\le 6)', { strict: false })
        .evaluate();

      // A `Tuple` is a fixed-arity structure, not a list: it must not
      // degrade into `[When(1, c), When(2, c)]`.
      expect(r.operator).toEqual('When');
      expect(r.op1.json).toEqual(['Tuple', 1, 2]);
      expect(r.isCollection).toBe(false);
    });

    test('exactly at the eager threshold (100) it distributes', () => {
      const ce = engine();
      ce.assign(
        'L',
        ce.box(['List', ...Array.from({ length: 100 }, (_, i) => i + 1)])
      );
      const r = ce
        .parse('\\mathrm{When}(L, 0\\le t\\le 6)', { strict: false })
        .evaluate();

      expect(r.operator).toEqual('List');
      expect(r.count).toEqual(100);
    });
  });

  describe('lazy but enumerable (> 100 elements)', () => {
    const big = () => {
      const ce = engine();
      ce.assign(
        'L',
        ce.box(['List', ...Array.from({ length: 150 }, (_, i) => i + 1)])
      );
      return ce
        .parse('\\mathrm{When}(L, 0\\le t\\le 6)', { strict: false })
        .evaluate();
    };

    test('stays held (not materialized into a List)', () => {
      const r = big();
      expect(r.operator).toEqual('When');
      expect(r.isLazyCollection).toBe(true);
    });

    test('is fully enumerable', () => {
      const r = big();
      expect(r.isCollection).toBe(true);
      expect(r.count).toEqual(150);
      expect(r.isFiniteCollection).toBe(true);
      expect(r.isEmptyCollection).toBe(false);
      expect(Array.from(r.each()).length).toEqual(150);
    });

    test('indexed access carries the condition', () => {
      const r = big();
      expect(r.at(1)?.operator).toEqual('When');
      expect(r.at(1)?.op1.re).toEqual(1);
      expect(r.at(-1)?.op1.re).toEqual(150);
      expect(r.at(75)?.op1.re).toEqual(75);
      expect(r.indexWhere((x) => x.op1.re === 42)).toEqual(42);
    });
  });

  describe('a scalar When is still a scalar', () => {
    test('When(5, cond) reports no collection interface', () => {
      const ce = engine();
      const r = ce
        .parse('\\mathrm{When}(5, 0\\le t\\le 6)', { strict: false })
        .evaluate();

      expect(r.operator).toEqual('When');
      expect(r.isCollection).toBe(false);
      expect(r.isIndexedCollection).toBe(false);
      expect(r.isLazyCollection).toBe(false);
      expect(r.contains(ce.number(5))).toBeUndefined();
      expect(r.count).toBeUndefined();
      expect(Array.from(r.each()).length).toEqual(0);
    });

    test('guard semantics are unchanged', () => {
      const ce = engine();
      const ev = (s: string) =>
        ce.parse(s, { strict: false }).evaluate().toString();

      expect(ev('\\mathrm{When}(7, 1>0)')).toEqual('7');
      expect(ev('\\mathrm{When}(7, 1<0)')).toEqual('"Undefined"');
      expect(ev('\\mathrm{When}([1,2,3], 1>0)')).toEqual('[1,2,3]');
      expect(ev('\\mathrm{When}([1,2,3], 1<0)')).toEqual('"Undefined"');
    });
  });
});

// Review follow-ups on the item-66 work.
describe('When collection predicate is consistent (review follow-up)', () => {
  const engine = () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    return ce;
  };

  // `isIndexedCollection` inspected only the `at` handler and the result type,
  // so a Tuple-valued `When` reported `isCollection: false` but
  // `isIndexedCollection: true` — the same interface-vs-type contradiction
  // item 66 exists to fix.
  test('a Tuple-valued When is neither a collection nor an indexed collection', () => {
    const r = engine()
      .parse('\\mathrm{When}((1,2), 0\\le t\\le 6)', { strict: false })
      .evaluate();
    expect(r.isCollection).toBe(false);
    expect(r.isIndexedCollection).toBe(false);
    expect(r.op1.json).toEqual(['Tuple', 1, 2]);
  });

  test('a List-valued When is both', () => {
    const r = engine()
      .parse('\\mathrm{When}([1,2,3], 0\\le t\\le 6)', { strict: false })
      .evaluate();
    expect(r.isCollection).toBe(true);
    expect(r.isIndexedCollection).toBe(true);
  });

  // A tuple-typed value is excluded BEFORE it is evaluated: evaluating it would
  // force components of a value the restriction keeps held, for a shape that
  // can never enter the distribution path.
  test('a Tuple-valued When keeps its held form', () => {
    const r = engine()
      .parse('\\mathrm{When}((1,2), 0\\le t\\le 6)', { strict: false })
      .evaluate();
    expect(r.operator).toEqual('When');
    expect(r.count).toBeUndefined();
    expect(Array.from(r.each()).length).toEqual(0);
  });

  test('an opted-out collection cannot expose lazy or membership handlers', () => {
    const ce = new ComputeEngine({
      libraries: [
        'core',
        {
          name: 'collection-opt-out-test',
          requires: ['core'],
          definitions: {
            OptOutCollection: {
              signature: '() -> integer',
              collection: {
                isCollection: () => false,
                isLazy: () => true,
                contains: () => true,
                count: () => 3,
                isEmpty: () => false,
                isFinite: () => true,
                subsetOf: () => true,
                indexWhere: () => 1,
                at: () => ce.One,
                iterator: () => [ce.One, ce.One, ce.One][Symbol.iterator](),
              },
            },
          },
        },
      ],
    });
    const r = ce.box(['OptOutCollection']);

    expect(r.isCollection).toBe(false);
    expect(r.isIndexedCollection).toBe(false);
    expect(r.isLazyCollection).toBe(false);
    expect(r.contains(ce.One)).toBeUndefined();
    expect(r.count).toBeUndefined();
    expect(r.isEmptyCollection).toBeUndefined();
    expect(r.isFiniteCollection).toBeUndefined();
    expect(Array.from(r.each()).length).toBe(0);
    expect(r.at(1)).toBeUndefined();
    expect(r.get('key')).toBeUndefined();
    expect(r.indexWhere(() => true)).toBeUndefined();
    expect(r.subsetOf(ce.box(['List', 1]), false)).toBe(false);
  });
});
