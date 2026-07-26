import { ComputeEngine } from '../../src/compute-engine';

//
// Regression: INDIRECT reference cycles between symbol values.
//
// `BoxedSymbol._value` only guards DIRECT self-reference (`a := a + 1`, and
// the degenerate `a := a`). In a cycle such as `a := b` with `b := a` each
// binding is individually well-formed — only the pair is cyclic — so every
// query that resolves a symbol's value and delegates to it used to recurse
// forever and die with `RangeError: Maximum call stack size exceeded`.
//
// The guard (`src/compute-engine/boxed-expression/cycle-guard.ts`) makes such
// a query FAIL CLOSED: `false`/`undefined`/no value, never a throw, and never
// a cycle silently resolved to a definite answer.
//

/** The cycle shapes that used to overflow the stack. */
const CYCLES: [string, (ce: ComputeEngine) => void][] = [
  [
    'a := b, b := a',
    (ce) => {
      ce.assign('a', ce.parse('b'));
      ce.assign('b', ce.parse('a'));
    },
  ],
  [
    'a := Take(b, 2), b := Drop(a, 1)',
    (ce) => {
      ce.assign('a', ce.box(['Take', 'b', 2]));
      ce.assign('b', ce.box(['Drop', 'a', 1]));
    },
  ],
  [
    'a := Append(b, 1), b := a',
    (ce) => {
      ce.assign('a', ce.box(['Append', 'b', 1]));
      ce.assign('b', ce.parse('a'));
    },
  ],
  [
    'a := b, b := c, c := a',
    (ce) => {
      ce.assign('a', ce.parse('b'));
      ce.assign('b', ce.parse('c'));
      ce.assign('c', ce.parse('a'));
    },
  ],
];

describe('indirect symbol reference cycles do not overflow the stack', () => {
  for (const [name, setup] of CYCLES) {
    describe(name, () => {
      const ce = new ComputeEngine();
      setup(ce);
      const a = ce.box('a');

      test('collection-shape queries fail closed', () => {
        // `isFiniteCollection` is the getter the defect was reported against.
        expect(() => a.isFiniteCollection).not.toThrow();
        expect([undefined, false]).toContain(a.isFiniteCollection);

        expect(() => a.isCollection).not.toThrow();
        expect(() => a.isIndexedCollection).not.toThrow();
        expect(() => a.isLazyCollection).not.toThrow();

        expect(() => a.isEmptyCollection).not.toThrow();
        expect([undefined, false]).toContain(a.isEmptyCollection);

        expect(() => a.count).not.toThrow();
        expect(a.count).toBeUndefined();
      });

      test('element access fails closed', () => {
        expect(() => a.at(1)).not.toThrow();
        expect(() => a.at(-1)).not.toThrow();
        expect(() => a.get(ce.box(1))).not.toThrow();
        expect(() => a.indexWhere(() => true)).not.toThrow();
        expect(() => a.contains(ce.box(1))).not.toThrow();
        expect(() => a.subsetOf(ce.box(['List', 1]), false)).not.toThrow();
      });

      test('enumeration terminates', () => {
        expect(() => [...a.each()]).not.toThrow();
        // Not merely terminating: the guard must not INVENT elements. A cycle
        // yields at most one element per binding it traverses before closing,
        // never a run of `MAX_CYCLE_DEPTH` repetitions.
        expect([...a.each()].length).toBeLessThanOrEqual(2);
      });

      test('evaluation stays symbolic', () => {
        expect(() => a.evaluate()).not.toThrow();
        expect(() => a.N()).not.toThrow();
        expect(() => a.simplify()).not.toThrow();
        expect(() => a.toString()).not.toThrow();
      });

      test('comparisons fail closed', () => {
        expect(() => a.isSame(1)).not.toThrow();
        expect(a.isSame(1)).toBe(false);
        expect(() => a.isSame(ce.box('b'))).not.toThrow();
        expect(() => a.is(1)).not.toThrow();
        expect(a.is(1)).toBe(false);
        expect(() => a.isEqual(1)).not.toThrow();
        expect(a.isEqual(1)).not.toBe(true);
      });

      test('scalar predicates fail closed', () => {
        expect(() => a.sgn).not.toThrow();
        expect(a.sgn).toBeUndefined();
        expect(() => a.isNaN).not.toThrow();
        expect(() => a.isFinite).not.toThrow();
        expect(() => a.isInfinity).not.toThrow();
        expect(() => a.isOdd).not.toThrow();
        expect(() => a.isEven).not.toThrow();
        expect(() => a.re).not.toThrow();
        expect(a.re).toBeNaN();
        expect(() => a.im).not.toThrow();
        expect(() => a.bignumRe).not.toThrow();
        expect(() => a.bignumIm).not.toThrow();
      });

      test('the guard is released after each query', () => {
        // A guarded query must not poison the binding: asking twice gives the
        // same answer both times.
        expect(a.isFiniteCollection).toEqual(a.isFiniteCollection);
        expect(a.count).toEqual(a.count);
        expect(a.isSame(1)).toEqual(a.isSame(1));
        expect(a.N().toString()).toEqual(a.N().toString());
      });
    });
  }
});

describe('the cycle guard does not affect well-formed bindings', () => {
  test('an ordinary list-valued symbol still answers every query', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 10, 20, 30]));
    const L = ce.box('L');

    expect(L.isCollection).toBe(true);
    expect(L.isIndexedCollection).toBe(true);
    expect(L.isFiniteCollection).toBe(true);
    expect(L.isEmptyCollection).toBe(false);
    expect(L.count).toBe(3);
    expect(L.at(1)?.json).toEqual(10);
    // A negative index makes `at` consult its own `isFiniteCollection` and
    // `count`: a guard keyed on the binding ALONE (rather than on the binding
    // AND the query kind) would break this.
    expect(L.at(-1)?.json).toEqual(30);
    expect([...L.each()].map((x) => x.json)).toEqual([10, 20, 30]);
    expect(L.contains(ce.box(20))).toBe(true);
    expect(L.indexWhere((x) => x.is(20))).toBe(2);
  });

  test('nested enumeration of the same symbol is not a cycle', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    const pairs: number[] = [];
    for (const x of ce.box('L').each())
      for (const y of ce.box('L').each())
        pairs.push((x.re as number) * 10 + (y.re as number));
    expect(pairs).toEqual([11, 12, 13, 21, 22, 23, 31, 32, 33]);
  });

  test('a chain of non-cyclic bindings still resolves', () => {
    const ce = new ComputeEngine();
    ce.assign('u', ce.box(5));
    ce.assign('v', ce.parse('u'));
    ce.assign('w', ce.parse('v'));
    expect(ce.box('w').N().json).toEqual(5);
    expect(ce.box('w').isSame(5)).toBe(true);
    expect(ce.box('w').sgn).toEqual('positive');
  });

  test('a direct self-reference is still handled', () => {
    const ce = new ComputeEngine();
    ce.assign('s', ce.parse('s+1'));
    expect(() => ce.box('s').N()).not.toThrow();
    expect(() => ce.box('s').isFiniteCollection).not.toThrow();
  });
});

describe('an indirect cycle behaves like the direct self-reference it mirrors', () => {
  // `d := Append(d, 1)` has always evaluated to `[1]`: the guarded inner
  // reference contributes nothing and the enclosing expression is evaluated
  // with what remains. An INDIRECT cycle takes one more hop before the guard
  // fires, so it produces one more element — but it must stay in that family
  // rather than unwinding to some arbitrary depth.
  test('Append cycle materializes a bounded list, not an invented one', () => {
    const direct = new ComputeEngine();
    direct.assign('d', direct.box(['Append', 'd', 1]));
    expect(direct.box('d').evaluate().toString()).toBe('[1]');

    const indirect = new ComputeEngine();
    indirect.assign('a', indirect.box(['Append', 'b', 1]));
    indirect.assign('b', indirect.parse('a'));
    expect(indirect.box('a').evaluate().toString()).toBe('[1,1]');
  });
});
