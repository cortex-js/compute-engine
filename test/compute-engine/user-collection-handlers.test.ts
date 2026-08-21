import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

/**
 * Pins the JS extension route for collections: a `collection:` handler block
 * supplied by a caller through `ce.declare()`, on both an `OperatorDefinition`
 * (a function application that is a collection) and a `ValueDefinition` (a
 * symbol that is a collection).
 *
 * This is public surface — `OperatorDefinition.collection` and
 * `ValueDefinition.collection` in `types-definitions.ts` — but it was
 * previously exercised only by the built-in library, so nothing detected a
 * regression in the handler-block contract for external callers: the defaults
 * `defaultCollectionHandlers()` derives, the registration-time validation, and
 * the ability of library operators (`Length`, `At`, `Map`, `Sum`, …) to consume
 * a user-defined collection.
 */

/** The count a `MyColl(n)` / `NotAColl(n)` instance was applied to. */
function argOf(expr: BoxedExpression): number {
  // `op1` lives on the `FunctionInterface` narrowing, not on the bare
  // `Expression` type, so a handler that reads its operands must go through
  // the `isFunction()` guard.
  if (!isFunction(expr)) return NaN;
  const n = expr.op1.re;
  return Number.isFinite(n) ? n : NaN;
}

/** Iterate `1, 2, …, n` as boxed integers. */
function upTo(
  ce: ComputeEngine,
  n: number
): Iterator<BoxedExpression, undefined> {
  let i = 0;
  return {
    next: () =>
      i < n
        ? { value: ce.number(++i), done: false }
        : { value: undefined, done: true },
  };
}

/**
 * `MyColl(n)` enumerates `1..n`. It supplies only `iterator`, `count` and `at`
 * — everything else must be derived by `defaultCollectionHandlers()`.
 */
function declareMyColl(ce: ComputeEngine): void {
  ce.declare('MyColl', {
    signature: '(integer) -> list<integer>',
    collection: {
      iterator: (expr) => upTo(ce, argOf(expr)),
      count: (expr) => argOf(expr),
      at: (expr, index) => {
        if (typeof index !== 'number') return undefined;
        const n = argOf(expr);
        // `at(-1)` is the last element.
        const i = index < 0 ? n + index + 1 : index;
        if (i < 1 || i > n) return undefined;
        return ce.number(i);
      },
    },
  });
}

describe('user-supplied collection handlers on an OperatorDefinition', () => {
  const ce = new ComputeEngine();
  declareMyColl(ce);
  const coll = ce.function('MyColl', [ce.number(4)]);

  test('the instance reports as an indexed collection', () => {
    expect(coll.isCollection).toBe(true);
    expect(coll.isIndexedCollection).toBe(true);
  });

  test('the supplied count is used', () => {
    expect(coll.count).toBe(4);
  });

  test('emptiness and finiteness are DERIVED from count', () => {
    // Neither `isEmpty` nor `isFinite` was supplied; both are synthesized from
    // the `count` handler by `defaultCollectionHandlers()`.
    expect(coll.isEmptyCollection).toBe(false);
    expect(coll.isFiniteCollection).toBe(true);
    expect(ce.function('MyColl', [ce.number(0)]).isEmptyCollection).toBe(true);
  });

  test('the supplied `at` handler is used, negative indices included', () => {
    expect(coll.at(2)?.toString()).toBe('2');
    expect(coll.at(-1)?.toString()).toBe('4');
    expect(coll.at(9)).toBeUndefined();
  });

  test('`contains` falls back to the default membership walk', () => {
    // No `contains` handler was supplied: `collectionContains` walks the
    // iterator.
    expect(coll.contains(ce.number(3))).toBe(true);
    expect(coll.contains(ce.number(9))).toBe(false);
  });

  // The default `indexWhere` is installed only when an `at` handler is
  // present (indexing is what makes a position meaningful), but it finds the
  // position by streaming the iterator, not by probing `at`.
  test('`indexWhere` defaults to an iterator walk once `at` is supplied', () => {
    expect(coll.indexWhere((x) => x.re === 3)).toBe(3);
    expect(coll.indexWhere((x) => x.re === 99)).toBeUndefined();
  });

  test('`each()` walks the supplied iterator', () => {
    expect([...coll.each()].map((x) => x.toString())).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });

  test('a handler block without `isLazy` is EAGER', () => {
    // `isLazy` defaults to `false`: a collection is eager unless its
    // definition opts in.
    expect(coll.isLazyCollection).toBe(false);
  });
});

describe('library operators consume a user-defined collection', () => {
  const ce = new ComputeEngine();
  declareMyColl(ce);

  test('Length', () => {
    expect(ce.box(['Length', ['MyColl', 4]]).evaluate().toString()).toBe('4');
  });

  test('Contains', () => {
    expect(ce.box(['Contains', ['MyColl', 4], 3]).evaluate().toString()).toBe(
      '"True"'
    );
    expect(ce.box(['Contains', ['MyColl', 4], 9]).evaluate().toString()).toBe(
      '"False"'
    );
  });

  test('At', () => {
    expect(ce.box(['At', ['MyColl', 4], 2]).evaluate().toString()).toBe('2');
  });

  test('Map', () => {
    // `Map` is callback-first.
    expect(
      ce
        .box(['Map', ['Function', ['Multiply', 2, 'x'], 'x'], ['MyColl', 3]])
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('Filter', () => {
    expect(
      ce
        .box(['Filter', ['MyColl', 5], ['Function', ['Greater', 'x', 2], 'x']])
        .evaluate()
        .toString()
    ).toBe('[3,4,5]');
  });

  test('Sum', () => {
    expect(ce.box(['Sum', ['MyColl', 4]]).evaluate().toString()).toBe('10');
  });
});

describe('route parity: function / box / parse', () => {
  const ce = new ComputeEngine();
  declareMyColl(ce);

  test.each([
    ['ce.function', () => ce.function('MyColl', [ce.number(4)])],
    ['ce.box', () => ce.box(['MyColl', 4])],
    ['ce.parse', () => ce.parse('\\mathrm{MyColl}(4)')],
  ])('%s reaches the handlers', (_label, make) => {
    const expr = make();
    expect(expr.isCollection).toBe(true);
    expect(expr.isIndexedCollection).toBe(true);
    expect(expr.count).toBe(4);
    expect(expr.at(2)?.toString()).toBe('2');
  });
});

describe('user-supplied collection handlers on a ValueDefinition', () => {
  const ce = new ComputeEngine();
  // Modelled on the set constants in `library/sets.ts` (`Integers`,
  // `EmptySet`): a constant symbol whose collection-ness comes entirely from
  // its handler block.
  ce.declare('MySet', {
    type: 'set<integer>',
    isConstant: true,
    collection: {
      iterator: () => upTo(ce, 3),
      count: () => 3,
      contains: (_collection, target) => [1, 2, 3].some((v) => target.is(v)),
    },
  });
  const set = ce.symbol('MySet');

  test('the symbol reports as a non-indexed collection', () => {
    expect(set.isCollection).toBe(true);
    // A `set` is not an indexed collection, and no `at` handler was supplied.
    expect(set.isIndexedCollection).toBe(false);
  });

  test('count, eagerness and iteration', () => {
    expect(set.count).toBe(3);
    expect(set.isLazyCollection).toBe(false);
    expect([...set.each()].map((x) => x.toString())).toEqual(['1', '2', '3']);
  });

  test('membership via Element and Contains', () => {
    expect(ce.box(['Element', 2, 'MySet']).evaluate().toString()).toBe(
      '"True"'
    );
    expect(ce.box(['Contains', 'MySet', 2]).evaluate().toString()).toBe(
      '"True"'
    );
    expect(ce.box(['Contains', 'MySet', 9]).evaluate().toString()).toBe(
      '"False"'
    );
  });
});

describe('the per-instance `isCollection` veto', () => {
  const ce = new ComputeEngine();
  ce.declare('NotAColl', {
    signature: '(integer) -> list<integer>',
    collection: {
      iterator: (expr) => upTo(ce, argOf(expr)),
      count: (expr) => argOf(expr),
      at: () => undefined,
      // Reports every instance as a scalar, as if there were no handlers.
      isCollection: () => false,
    },
  });

  test('a vetoed instance is neither a collection nor an indexed one', () => {
    const expr = ce.function('NotAColl', [ce.number(3)]);
    expect(expr.isCollection).toBe(false);
    expect(expr.isIndexedCollection).toBe(false);
    expect(expr.isLazyCollection).toBe(false);
  });
});

describe('registration-time validation of a handler block', () => {
  test('handlers on a non-collection result type throw', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('BadResult', {
        signature: '(integer) -> integer',
        collection: {
          iterator: (expr) => upTo(ce, argOf(expr)),
          count: (expr) => argOf(expr),
        },
      })
    ).toThrow(
      'Operator Definition "BadResult": a collection handler is defined, but the signature "(integer) -> integer" is not a collection type'
    );
  });

  test('`count` without `iterator` throws', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('BadNoIterator', {
        signature: '(integer) -> list<integer>',
        collection: { count: (expr: BoxedExpression) => argOf(expr) } as any,
      })
    ).toThrow(
      'A collection must have at least an "iterator" and a "count" handler'
    );
  });

  test('`indexWhere` without `at` throws', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('BadNoAt', {
        signature: '(integer) -> list<integer>',
        collection: {
          iterator: (expr: BoxedExpression) => upTo(ce, argOf(expr)),
          count: (expr: BoxedExpression) => argOf(expr),
          indexWhere: () => 1,
        } as any,
      })
    ).toThrow(
      'A collection with an "indexWhere" handler must also have an "at" handler'
    );
  });

  test('an indexed result type without `at` throws', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('BadIndexedNoAt', {
        signature: '(integer) -> list<integer>',
        collection: {
          iterator: (expr) => upTo(ce, argOf(expr)),
          count: (expr) => argOf(expr),
        },
      })
    ).toThrow(
      `Operator Definition "BadIndexedNoAt" returns an indexed collection, but the 'at' handler is missing`
    );
  });
});
