import { ComputeEngine } from '../../src/compute-engine';
import '../utils'; // For snapshot serializers

/**
 * An `If(cond, value)` whose VALUE is a collection is an ELEMENTWISE
 * restriction: it behaves as `[If(cond, v1), …, If(cond, vn)]` (Tycho
 * item 66). Previously only a list-valued CONDITION broadcast; a scalar
 * indeterminate condition produced a held restriction with no collection
 * interface, so `isCollection`/`count`/`each()` disagreed with `.type`.
 *
 * The restriction stays HELD over the evaluated collection, whatever its size,
 * and its collection handlers expose the restricted cells (user decision
 * 2026-09-25). It used to be copied into a `List` of restrictions at or below
 * `MAX_SIZE_EAGER_COLLECTION` (100): the copy forgot that its cells came from
 * one restriction, so it re-evaluated to `[Missing, Missing, …]` once the
 * condition failed, where the same expression evaluated fresh — and its
 * compiled code — answered the whole-list `Missing`.
 */
describe('When: collection-valued restriction', () => {
  const engine = () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    return ce;
  };

  describe('held and enumerable (any size)', () => {
    test('scalar indeterminate condition presents a list value elementwise', () => {
      const ce = engine();
      const r = ce
        .parse('\\mathrm{If}(0\\le t\\le 6, [1,2,3])', { strict: false })
        .evaluate();

      expect(r.operator).toEqual('If');
      expect(r.isCollection).toBe(true);
      expect(r.count).toEqual(3);
      expect(Array.from(r.each()).length).toEqual(3);
      // Each element carries the condition.
      expect(r.at(1)?.operator).toEqual('If');
      expect(r.at(1)?.op2.re).toEqual(1);
      expect(r.at(3)?.op2.re).toEqual(3);
    });

    test('a value that only becomes a collection when evaluated', () => {
      const ce = engine();
      // `[1,2,3]t` is a `Multiply` until evaluated.
      const r = ce
        .parse('\\mathrm{If}(0\\le t\\le 6, [1,2,3]t)', { strict: false })
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
      expect(r.at(1)?.op2.json).toEqual(['Tuple', 1, 2]);
    });

    test('a restricted point stays a point (Tuple is not broadcast over)', () => {
      const ce = engine();
      const r = ce
        .parse('\\mathrm{If}(0\\le t\\le 6, (1,2))', { strict: false })
        .evaluate();

      // A `Tuple` is a fixed-arity structure, not a list: it must not
      // degrade into `[If(c, 1), If(c, 2)]`.
      expect(r.operator).toEqual('If');
      expect(r.op2.json).toEqual(['Tuple', 1, 2]);
      expect(r.isCollection).toBe(false);
    });

    test('at 100 elements it is held like any other size', () => {
      const ce = engine();
      ce.assign(
        'L',
        ce.box(['List', ...Array.from({ length: 100 }, (_, i) => i + 1)])
      );
      const r = ce
        .parse('\\mathrm{If}(0\\le t\\le 6, L)', { strict: false })
        .evaluate();

      expect(r.operator).toEqual('If');
      expect(r.count).toEqual(100);
    });

    test('once the condition fails, the held form and a fresh evaluation agree', () => {
      const ce = engine();
      const e = ce.parse('\\mathrm{If}(0<t, [1,2,3])', { strict: false });
      const held = e.evaluate();
      expect(held.operator).toEqual('If');
      ce.assign('t', -1);
      // The copied form answered `[Missing, Missing, Missing]` here.
      expect(held.evaluate().symbol).toEqual('Missing');
      expect(e.evaluate().symbol).toEqual('Missing');
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
        .parse('\\mathrm{If}(0\\le t\\le 6, L)', { strict: false })
        .evaluate();
    };

    test('stays held (not materialized into a List)', () => {
      const r = big();
      expect(r.operator).toEqual('If');
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
      expect(r.at(1)?.operator).toEqual('If');
      expect(r.at(1)?.op2.re).toEqual(1);
      expect(r.at(-1)?.op2.re).toEqual(150);
      expect(r.at(75)?.op2.re).toEqual(75);
      expect(r.indexWhere((x) => x.op2.re === 42)).toEqual(42);
    });
  });

  describe('a scalar When is still a scalar', () => {
    test('When(5, cond) reports no collection interface', () => {
      const ce = engine();
      const r = ce
        .parse('\\mathrm{If}(0\\le t\\le 6, 5)', { strict: false })
        .evaluate();

      expect(r.operator).toEqual('If');
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

      expect(ev('\\mathrm{If}(1>0, 7)')).toEqual('7');
      // A masked number is `NaN` (user decision 2026-09-25).
      expect(ev('\\mathrm{If}(1<0, 7)')).toEqual('NaN');
      expect(ev('\\mathrm{If}(1>0, [1,2,3])')).toEqual('[1,2,3]');
      expect(ev('\\mathrm{If}(1<0, [1,2,3])')).toEqual('"Missing"');
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
  // so a Tuple-valued restriction reported `isCollection: false` but
  // `isIndexedCollection: true` — the same interface-vs-type contradiction
  // item 66 exists to fix.
  test('a Tuple-valued When is neither a collection nor an indexed collection', () => {
    const r = engine()
      .parse('\\mathrm{If}(0\\le t\\le 6, (1,2))', { strict: false })
      .evaluate();
    expect(r.isCollection).toBe(false);
    expect(r.isIndexedCollection).toBe(false);
    expect(r.op2.json).toEqual(['Tuple', 1, 2]);
  });

  // A held List-valued restriction `If(c, L)` presents its cells through the
  // collection handlers, so it is a collection, and an indexed one: the
  // broadcast machinery maps over it cell by cell
  // (`Sin(If(0 < t, [1,2,3]))` is `[NaN, NaN, NaN]` once `t = -1`).
  test('a List-valued restriction is an indexed collection', () => {
    const r = engine()
      .parse('\\mathrm{If}(0\\le t\\le 6, [1,2,3])', { strict: false })
      .evaluate();
    expect(r.operator).toBe('If');
    expect(r.isCollection).toBe(true);
    expect(r.isIndexedCollection).toBe(true);
    expect(r.count).toBe(3);
  });

  // A tuple-typed value is excluded BEFORE it is evaluated: evaluating it would
  // force components of a value the restriction keeps held, for a shape that
  // can never enter the distribution path.
  test('a Tuple-valued When keeps its held form', () => {
    const r = engine()
      .parse('\\mathrm{If}(0\\le t\\le 6, (1,2))', { strict: false })
      .evaluate();
    expect(r.operator).toEqual('If');
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
