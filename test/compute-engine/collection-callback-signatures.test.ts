import { ComputeEngine } from '../../src/compute-engine';

/**
 * # Callback-parameter signatures on the collection operators
 *
 * Every collection operator that takes a callback declares that slot as the
 * bare `function` primitive (`predicate:`, `key:`, `mapping:`, `reducer:`,
 * `order:`, `generator:` — named uniformly, typed identically). No library
 * operator spells such a slot as a function SIGNATURE — that enumeration is
 * pinned empty in `effects-call-boundary.test.ts`.
 *
 * These tests pin WHY the rest stay on the primitive. Narrowing
 * `function` to a signature — e.g. `(unknown) any -> boolean` for a predicate
 * — is not a documentation-only change: a signature parameter is checked
 * contravariantly, so it newly rejects three operand classes that work today.
 * The eager operators here validate their arguments, so such a narrowing bites
 * immediately.
 *
 * The lazy operators used to defer validation entirely, which made any bound
 * on their slot inert. That carve-out is closed for the operand class it hurt
 * most — a PARAMETERLESS one (`Map(5, xs)`) is now rejected there too, see
 * below — while everything a `function` slot admits still reaches the handler.
 */

const XS = ['List', 1, 2, 3, 4] as const;

/**
 * Build a `<op>(source, callback)` call for the operator-table tests below.
 * `Map` is the one operator whose mapping function comes FIRST, ahead of its
 * one-or-more source collections; every other callback operator takes the
 * source first.
 */
const opCall = (op: string, source: any, callback: any): any[] =>
  op === 'Map' ? [op, callback, source] : [op, source, callback];

describe('a named library function is a valid callback operand', () => {
  // `IsPrime` has type `(number) -> boolean`. Contravariance means it is NOT a
  // subtype of `(unknown) any -> boolean` — `unknown` is not a subtype of
  // `number` — so declaring the predicate slot that way would reject this.
  it('`CountIf(xs, IsPrime)` counts', () => {
    const ce = new ComputeEngine();
    expect(
      ce.type('(number) -> boolean').matches('(unknown) any -> boolean')
    ).toBe(false);
    const e = ce.box(['CountIf', XS, 'IsPrime']);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('2');
  });

  it('`Find` / `IndexWhere` accept one too', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Find', XS, 'IsPrime']).evaluate().toString()).toBe('2');
    expect(ce.box(['IndexWhere', XS, 'IsPrime']).evaluate().toString()).toBe(
      '2'
    );
  });
});

describe('a `function`-typed symbol is a valid callback operand', () => {
  // The bare `function` primitive is not a subtype of ANY signature, so every
  // narrowing rejects this operand — including the maximally permissive one.
  it('a symbol declared `function` passes the slot', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'function');
    expect(ce.type('function').matches('(never) any -> boolean')).toBe(false);
    expect(ce.box(['CountIf', XS, 'p']).isValid).toBe(true);
    expect(ce.box(['Sort', XS, 'p']).isValid).toBe(true);
  });

  // `sortedIndices` documents this: "a statically-unknown arity (bare
  // `function`) is also treated as a comparator".
  it('`Sort` reads the operand arity, so an unknown arity must reach it', () => {
    const ce = new ComputeEngine();
    ce.declare('cmp', 'function');
    expect(ce.box(['Sort', XS, 'cmp']).isValid).toBe(true);
  });
});

describe('a callback whose result type is unknown is a valid operand', () => {
  it('`x ↦ g(x)` with an undeclared `g` passes the predicate slot', () => {
    const ce = new ComputeEngine();
    const cb = ce.box(['Function', ['g', 'x'], 'x']);
    expect(cb.type.toString()).toBe('(unknown) any -> unknown');
    expect(cb.type.matches('(unknown) any -> boolean')).toBe(false);
    expect(ce.box(['CountIf', XS, ['Function', ['g', 'x'], 'x']]).isValid).toBe(
      true
    );
  });
});

/**
 * A parameterless operand at a callback slot is rejected by the WHOLE family
 * (ruled 2026-08-09, ROADMAP "Contextual callback typing residue").
 *
 * This used to be a lazy/eager asymmetry: the eager operators validated their
 * operand against the declared `function` slot, while the lazy ones held
 * theirs and routed it through `canonicalFunctionLiteral`, whose shorthand
 * path LIFTED the value into the constant `() ↦ 5` — so `Sort(xs, 5)`
 * reported `incompatible-type` while `Map(5, xs)` answered `[5, 5, 5]`.
 * `canonicalCallbackOperand` now declines the parameterless lift, and both
 * halves report the same error.
 */
describe('a parameterless operand is rejected at every callback slot', () => {
  const eager = [
    'IndexWhere',
    'Find',
    'CountIf',
    'Position',
    'ChunkBy',
    'GroupBy',
  ];
  const lazy = [
    'Filter',
    'TakeWhile',
    'DropWhile',
    'FlatMap',
    'MaxBy',
    'MinBy',
  ];

  it.each([...eager, ...lazy])('%s rejects a non-function operand', (op) => {
    const ce = new ComputeEngine();
    expect(ce.box([op, XS, 5]).isValid).toBe(false);
  });

  // The diagnostic is the declared slot's, on both halves. The EAGER route
  // (`validateArguments`) names the honest INSTANTIATED arrow — strictly
  // more informative than the pre-Design-E erased `function`
  // (`docs/plans/2026-08-18-compatibility-admission-callbacks.md` §8) — with
  // the slot's own result (`boolean` for a predicate, `unknown` for a key).
  // The LAZY route's non-callable rejection (`canonicalCallbackOperand`'s
  // `reject()`) keeps the stable `function` expected type: "this operand is
  // not a function at all" needs no arrow detail.
  const EAGER_EXPECTED: Record<string, string> = {
    IndexWhere:
      'Error(ErrorCode("incompatible-type", "(finite_integer) any -> boolean", "finite_integer"), 5)',
    Find: 'Error(ErrorCode("incompatible-type", "(finite_integer) any -> boolean", "finite_integer"), 5)',
    CountIf:
      'Error(ErrorCode("incompatible-type", "(finite_integer) any -> boolean", "finite_integer"), 5)',
    Position:
      'Error(ErrorCode("incompatible-type", "(finite_integer) any -> boolean", "finite_integer"), 5)',
    ChunkBy:
      'Error(ErrorCode("incompatible-type", "(finite_integer) any -> unknown", "finite_integer"), 5)',
    GroupBy:
      'Error(ErrorCode("incompatible-type", "(finite_integer) any -> unknown", "finite_integer"), 5)',
  };
  it.each([...eager, ...lazy])('%s reports incompatible-type', (op) => {
    const ce = new ComputeEngine();
    expect(ce.box([op, XS, 5]).errors[0]?.toString()).toBe(
      EAGER_EXPECTED[op] ??
        'Error(ErrorCode("incompatible-type", "function", "finite_integer"), 5)'
    );
  });
});

/**
 * `Iterate`'s callback slot is the bare `function` PRIMITIVE, not a signature.
 * Its contract is parametric — `((integer, T) -> T, T?) -> list<T>`, the
 * accumulator type `T` being the callback's own RESULT type — and the
 * signature grammar has no type variables to relate the two. Every concrete
 * spelling therefore gets it wrong in one direction: `acc: any` rejects a
 * typed-accumulator callback, `acc: never` is uncallable. These tests pin the
 * primitive and the operand classes it must keep admitting.
 */
describe('`Iterate` declares the `function` primitive, not a signature', () => {
  /** The callback slot as actually DECLARED, so this can't drift. */
  function declaredCallbackSlot(ce: ComputeEngine, op: string): string {
    const def = ce.lookupDefinition(op) as any;
    const arm = def.operator.signature.type;
    return ce.type(arm.args[0].type).toString();
  }

  it('the declared callback slot is the `function` primitive', () => {
    const ce = new ComputeEngine();
    expect(declaredCallbackSlot(ce, 'Iterate')).toBe('function');
  });

  it('a typed-accumulator callback is admitted', () => {
    const ce = new ComputeEngine();
    // The shape no concrete bound could accept: `T` is `integer` here, but a
    // bound must spell the accumulator without knowing `T`.
    const cb = ce.type('(integer, integer) -> integer');
    expect(cb.matches('function')).toBe(true);
    expect(cb.matches('(index: integer, acc: any?) any -> any')).toBe(false);
    expect(
      ce.box([
        'Take',
        ['Iterate', ['Function', ['Add', 'acc', 1], 'i', 'acc'], 0],
        3,
      ]).isValid
    ).toBe(true);
  });

  it('a `function`-typed symbol is admitted', () => {
    const ce = new ComputeEngine();
    ce.declare('step', 'function');
    // The primitive is not a subtype of ANY signature, so this operand is
    // admitted only because the slot is the primitive too.
    expect(
      ce.type('function').matches('(index: integer, acc: any?) any -> any')
    ).toBe(false);
    expect(ce.box(['Take', ['Iterate', 'step', 0], 3]).isValid).toBe(true);
  });

  it('the unary shorthand still works', () => {
    const ce = new ComputeEngine();
    const cb = ce.box(['Function', ['Multiply', 2, '_'], '_']);
    expect(cb.type.toString()).toBe('(unknown) -> number');
    expect(cb.type.matches(declaredCallbackSlot(ce, 'Iterate'))).toBe(true);
    expect(
      ce
        .box([
          'Take',
          ['Iterate', ['Function', ['Multiply', 2, '_'], '_'], 1],
          4,
        ])
        .evaluate()
        .toString()
    ).toBe('[2,4,8,16]');
  });

  it('the primitive is effect-top: an effectful body is admitted', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Take',
      ['Iterate', ['Function', ['Random'], 'i', 'acc'], 0],
      2,
    ]);
    expect(e.isValid).toBe(true);
    expect([...e.evaluate().each()]).toHaveLength(2);
  });

  // The calling protocol the `description` documents, verified against the
  // `iterator`/`at` handlers: element k is `f(k, element(k-1))`, the index is
  // 1-based, and `element(0)` is the initial value.
  it('invokes `f(index, acc)` with a 1-based index and `initial` as element 0', () => {
    const ce = new ComputeEngine();
    // f(index, acc) = index
    expect(
      ce
        .box(['Take', ['Iterate', ['Function', 'i', 'i', 'acc'], 0], 5])
        .evaluate()
        .toString()
    ).toBe('[1,2,3,4,5]');
    // f(index, acc) = acc — so element 1 is the initial value
    expect(
      ce
        .box(['Take', ['Iterate', ['Function', 'acc', 'i', 'acc'], 99], 3])
        .evaluate()
        .toString()
    ).toBe('[99,99,99]');
  });
});

/**
 * # A VALUELESS source decides nothing
 *
 * ROADMAP cleanup (ruled 2026-08-09). `each()` yields an empty sequence for a
 * source it cannot see into — a symbol with no value, an application of an
 * unknown operator — which is indistinguishable from an empty collection's
 * walk. Six operators concluded from that walk anyway: `Filter`/`TakeWhile`
 * answered an empty collection, `Find` `Nothing`, `IndexWhere` `0`, `Any`
 * `False` and `All` `True`. The rest of the library (`Length`, `Total`,
 * `Sort`, `Map`, `CountIf`, `Position`, …) has always stayed inert on the same
 * input, and those answers were not merely conservative — assigning the symbol
 * afterwards contradicts them.
 */
describe('a valueless source leaves every operator inert', () => {
  const P = ['Function', ['Greater', '_1', 2], '_1'] as const;

  /** `xs` declared with a collection type but never assigned. */
  function engineWithValuelessXs(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer>');
    return ce;
  }

  const OPS = [
    'Filter',
    'TakeWhile',
    'DropWhile',
    'Map',
    'CountIf',
    'Find',
    'IndexWhere',
    'Position',
    'Any',
    'All',
    'FlatMap',
  ];

  it.each(OPS)('%s stays inert on a declared-but-unassigned source', (op) => {
    const ce = engineWithValuelessXs();
    expect(ce.box(opCall(op, 'xs', P)).evaluate().operator).toBe(op);
  });

  it.each(OPS)('%s stays inert on an UNDECLARED source', (op) => {
    const ce = new ComputeEngine();
    expect(ce.box(opCall(op, 'zz', P)).evaluate().operator).toBe(op);
  });

  it.each(OPS)('%s stays inert on an unknown application', (op) => {
    const ce = new ComputeEngine();
    expect(ce.box(opCall(op, ['f', 'x'], P)).evaluate().operator).toBe(op);
  });

  // What the inert answers used to assert, and why they were wrong: the same
  // expressions answer differently once the source has a value.
  it('the answers a value would give are not the ones inertness replaced', () => {
    const ce = engineWithValuelessXs();
    ce.assign('xs', ce.box(['List', 1, 5]));
    expect(ce.box(['Any', 'xs', P]).evaluate().toString()).toBe('"True"');
    expect(ce.box(['Filter', 'xs', P]).evaluate().toString()).toBe('[5]');
    expect(ce.box(['IndexWhere', 'xs', P]).evaluate().toString()).toBe('2');
  });

  // The guard reads whether the source can be ENUMERATED, not whether it is
  // already a collection: an EAGER collection operator has no collection
  // handlers until it is evaluated, but `each()` materializes it.
  it('an eager collection operator is still a valid source', () => {
    const ce = new ComputeEngine();
    const isA = ['Function', ['Equal', '_1', { str: 'a' }], '_1'];
    const chars = ['Characters', { str: 'aab' }];
    expect(ce.box(['Filter', chars, isA]).evaluate().toString()).toBe(
      '["a","a"]'
    );
    expect(ce.box(['TakeWhile', chars, isA]).evaluate().toString()).toBe(
      '["a","a"]'
    );
    expect(ce.box(['Any', chars, isA]).evaluate().toString()).toBe('"True"');
  });

  // A genuinely EMPTY collection still gets the definite answers.
  it('an empty collection is not inert', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Filter', ['List'], P])
        .evaluate()
        .toString()
    ).toBe('[]');
    expect(
      ce
        .box(['Any', ['List'], P])
        .evaluate()
        .toString()
    ).toBe('"False"');
    expect(
      ce
        .box(['All', ['List'], P])
        .evaluate()
        .toString()
    ).toBe('"True"');
    expect(
      ce
        .box(['Find', ['List'], P])
        .evaluate()
        .toString()
    ).toBe('"Nothing"');
    expect(
      ce
        .box(['IndexWhere', ['List'], P])
        .evaluate()
        .toString()
    ).toBe('0');
  });
});

/**
 * # The predicate error names the operator that consumed it
 *
 * ROADMAP cleanup: `Filter`'s message was copied verbatim into each sibling,
 * so `CountIf(xs, x ↦ y)` threw an error naming *Filter* — an operator the
 * user never wrote.
 */
describe('a malformed predicate is reported by its own operator', () => {
  const BAD = ['Function', 'y', '_1'] as const;

  it.each(['CountIf', 'Find', 'IndexWhere', 'Position'])(
    '%s names itself',
    (op) => {
      const ce = new ComputeEngine();
      expect(() => ce.box([op, XS, BAD]).evaluate()).toThrow(
        `${op} predicate must return`
      );
    }
  );
});

/**
 * # `isEnumerableCollection`: empty vs. cannot-be-walked
 *
 * `each()` yields nothing for two unrelated reasons — the collection is EMPTY,
 * or its elements have no computable value (`Range(a, b)` over free variables,
 * a valueless symbol, a wrapper over either). The walk alone cannot tell them
 * apart, and the facets that could (`count`, `isEmptyCollection`) are not
 * cheap: reading them from a wrapper re-enters the wrapper's own emptiness
 * handler, which is exponential in the chain depth (2^(d+1) − 2 calls,
 * measured over a depth-d `Filter` chain), so the operators fell back to
 * EVALUATING the source to decide.
 *
 * `isEnumerableCollection` answers the question directly and structurally: a
 * wrapper reads only its source's enumerability, never its own emptiness.
 */
describe('isEnumerableCollection separates empty from unwalkable', () => {
  const P = ['Function', ['Greater', '_1', 0], '_1'] as const;

  function ce(): ComputeEngine {
    const engine = new ComputeEngine();
    engine.declare('xs', 'list<integer>');
    return engine;
  }

  it('an empty collection is enumerable; a symbolic-bound one is not', () => {
    const e = ce();
    // Both walk to nothing — only the facet tells them apart.
    expect([...e.box(['List']).each()]).toHaveLength(0);
    expect([...e.box(['Range', 'a', 'b']).each()]).toHaveLength(0);

    expect(e.box(['List']).isEnumerableCollection).toBe(true);
    expect(e.box(['List']).isEmptyCollection).toBe(true);
    expect(e.box(['Range', 'a', 'b']).isEnumerableCollection).toBe(false);
    expect(e.box(['Range', 'a', 'b']).isEmptyCollection).toBe(undefined);
  });

  it.each([
    ['a populated list', ['List', 1, 2, 3], true],
    ['an empty list', ['List'], true],
    ['a numeric Range', ['Range', 1, 5], true],
    ['a symbolic Range', ['Range', 'a', 'b'], false],
    ['a symbolic Linspace', ['Linspace', 'a', 1, 3], false],
    ['a symbolic Repeat count', ['Repeat', 3, 'n'], false],
    ['a symbolic Tabulate count', ['Tabulate', P, 'n'], false],
    ['a valueless symbol', 'xs', false],
    ['an undeclared symbol', 'zz', false],
    ['an unknown application', ['f', 'x'], false],
    ['a scalar', 5, false],
  ] as const)('%s reports %s', (_label, expr, expected) => {
    expect(ce().box(expr as any).isEnumerableCollection).toBe(expected);
  });

  // The case that stays undecided even after adoption: a DECLINE-ONLY
  // `canEnumerate` (here `ContinuedFraction`, whose rational/float branches
  // can decline mid-computation) never answers `true`, so a ground argument
  // is honestly `undefined` — the caller pays for the evaluation, and the
  // walk is what tells empty from unwalkable. (A permanently UNADOPTED
  // producer such as `Solve` behaves the same — pinned in
  // `eager-collection-enumerability.test.ts`.)
  it('a decline-only producer is undecided on ground input, not true', () => {
    const cf = ce().box(['ContinuedFraction', ['Rational', 43, 19]]);
    expect(cf.isCollection).toBe(false);
    expect(cf.isEnumerableCollection).toBe(undefined);
    expect([...cf.each()].length).toBeGreaterThan(0);
  });

  it('a decline-only producer answers false only for a provable decline', () => {
    const e = ce();
    // Ground argument: undecided (success not cheaply provable) — resolves by
    // evaluating. Valueless symbol: provable decline, definite false.
    expect(
      e.box(['ContinuedFraction', ['Rational', 43, 19]]).isEnumerableCollection
    ).toBe(undefined);
    expect(e.box(['ContinuedFraction', 'x']).isEnumerableCollection).toBe(
      false
    );
    expect(
      [...e.box(['ContinuedFraction', ['Rational', 43, 19]]).each()].length
    ).toBeGreaterThan(0);
    expect([...e.box(['ContinuedFraction', 'x']).each()]).toHaveLength(0);
  });

  // An ADOPTED eager operator answers from its `canEnumerate` precondition —
  // no evaluation, both directions.
  it('an adopted eager operator answers definitively', () => {
    const e = ce();
    e.declare('s', 'string');
    expect(e.box(['Characters', { str: 'ab' }]).isEnumerableCollection).toBe(
      true
    );
    expect(e.box(['Characters', 's']).isEnumerableCollection).toBe(false);
  });

  /**
   * The evaluation `isEnumerableSource` falls back to is for ATTRIBUTION, not
   * for enablement: `each()` materializes an eager source by itself, so
   * dropping it still answers `Filter(Characters("aab"), p)` correctly. What
   * it decides is the OTHER half — an eager source whose argument is symbolic
   * walks to nothing, and without the evaluation that empty walk reads as an
   * empty collection (probed 2026-08-10: `Filter(Characters(s), p)` → `[]`,
   * `Any(Divisors(n), p)` → `False`).
   */
  describe('an eager operator over a symbolic argument stays inert', () => {
    const GT1 = ['Function', ['Greater', '_1', 1], '_1'] as const;

    it.each([
      ['Divisors', ['Divisors', 'n'], ['Divisors', 12], '[2,3,4,6,12]'],
      ['PrimeFactors', ['PrimeFactors', 'n'], ['PrimeFactors', 12], '[2,3]'],
    ] as const)('Filter over %s', (_op, symbolic, ground, expected) => {
      const e = ce();
      expect(e.box(['Filter', symbolic, GT1] as any).evaluate().operator).toBe(
        'Filter'
      );
      // ...while the ground argument still gets a definite answer.
      expect(
        e
          .box(['Filter', ground, GT1] as any)
          .evaluate()
          .toString()
      ).toBe(expected);
    });

    it.each(['Any', 'All', 'CountIf', 'Find', 'IndexWhere', 'Position'])(
      '%s over Divisors(n)',
      (op) => {
        expect(
          ce()
            .box([op, ['Divisors', 'n'], GT1] as any)
            .evaluate().operator
        ).toBe(op);
      }
    );

    it('Characters of a valueless string symbol', () => {
      const e = ce();
      e.declare('s', 'string');
      const isA = ['Function', ['Equal', '_1', { str: 'a' }], '_1'];
      expect(
        e.box(['Filter', ['Characters', 's'], isA]).evaluate().operator
      ).toBe('Filter');
      expect(e.box(['Any', ['Characters', 's'], isA]).evaluate().operator).toBe(
        'Any'
      );
      // The same expressions over a REACHABLE string answer definitively.
      expect(
        e
          .box(['Filter', ['Characters', { str: 'aab' }], isA])
          .evaluate()
          .toString()
      ).toBe('["a","a"]');
      expect(
        e
          .box(['Any', ['Characters', { str: 'aab' }], isA])
          .evaluate()
          .toString()
      ).toBe('"True"');
    });
  });

  it('propagates through a chain of wrappers', () => {
    const e = ce();
    for (const wrapped of [
      ['Take', 'xs', 2],
      ['Reverse', ['Take', 'xs', 2]],
      ['Filter', ['Reverse', ['Take', 'xs', 2]], P],
      ['Map', P, ['Cycle', ['Range', 'a', 'b']]],
      ['Zip', ['List', 1, 2], ['Range', 'a', 'b']],
      ['Union', ['Range', 'a', 'b'], ['List', 1]],
    ]) {
      const boxed = e.box(wrapped as any);
      // The wrapper HAS collection handlers — this is exactly the case a
      // `isCollection` guard reads as walkable.
      expect(boxed.isCollection).toBe(true);
      expect(boxed.isEnumerableCollection).toBe(false);
    }
  });

  it('a wrapper over a valued source stays enumerable', () => {
    const e = ce();
    e.assign('xs', e.box(['List', 1, 5]));
    expect(e.box(['Take', 'xs', 2]).isEnumerableCollection).toBe(true);
    expect(e.box(['Filter', ['Reverse', 'xs'], P]).isEnumerableCollection).toBe(
      true
    );
  });

  // Every operator that builds its elements from a source collection
  // propagates, not only the list wrappers.
  it.each([
    ['Partition', ['Partition', 'xs', 2], ['Partition', ['List', 1, 2, 3], 2]],
    ['Permutations', ['Permutations', 'xs'], ['Permutations', ['List', 1, 2]]],
    [
      'Combinations',
      ['Combinations', 'xs', 2],
      ['Combinations', ['List', 1, 2], 2],
    ],
    ['PowerSet', ['PowerSet', 'ss'], ['PowerSet', ['Set', 1, 2]]],
    [
      'CartesianProduct',
      ['CartesianProduct', 'ss', ['Set', 2]],
      ['CartesianProduct', ['Set', 1], ['Set', 2]],
    ],
    [
      'Comprehension',
      ['Comprehension', ['Multiply', 'x', 2], ['Element', 'x', 'xs']],
      ['Comprehension', ['Multiply', 'x', 2], ['Element', 'x', ['List', 1, 2]]],
    ],
  ] as const)('%s propagates from its source', (_op, unknown, known) => {
    const e = ce();
    e.declare('ss', 'set<integer>');
    expect(e.box(unknown as any).isEnumerableCollection).toBe(false);
    expect(e.box(known as any).isEnumerableCollection).toBe(true);
  });

  // A DECLARED handler owns all three states: a dependent comprehension binds
  // its index per iteration, so its clause domains cannot be judged
  // structurally — the handler says `undefined` and that must not collapse to
  // the `true` default reserved for operators with no handler at all.
  it('a declared handler can answer `undefined`', () => {
    const dependent = ce().box([
      'Comprehension',
      ['Add', 'x', 'y'],
      ['Element', 'x', ['List', 1, 2]],
      ['Element', 'y', ['Range', 1, 'x']],
    ]);
    expect(dependent.isEnumerableCollection).toBe(undefined);
    // ...and the caller still gets the right answer, by evaluating.
    expect(dependent.evaluate().toString()).toBe('[2,3,4]');
  });

  // Independent of size: `Linspace(a, 1, 3)` knows it has three elements and
  // can compute none of them.
  it('is independent of `count`', () => {
    const linspace = ce().box(['Linspace', 'a', 1, 3]);
    expect(linspace.count).toBe(3);
    expect(linspace.isEmptyCollection).toBe(false);
    expect(linspace.isEnumerableCollection).toBe(false);
    expect([...linspace.each()]).toHaveLength(0);
  });

  // The wrapper hole this facet was added to close: the operators that
  // conclude from a walk were guarded by `isCollection`, which a wrapper
  // answers `true` — so `Filter(Take(xs, 2), p)` answered `[]` for a valueless
  // `xs` while `Filter(xs, p)` (guarded directly) stayed inert.
  describe('a WRAPPED valueless source leaves the operators inert', () => {
    const OPS = [
      'Filter',
      'TakeWhile',
      'DropWhile',
      'Map',
      'CountIf',
      'Find',
      'IndexWhere',
      'Position',
      'Any',
      'All',
      'FlatMap',
    ];

    it.each(OPS)('%s over Take(xs, 2)', (op) => {
      expect(
        ce()
          .box(opCall(op, ['Take', 'xs', 2], P))
          .evaluate().operator
      ).toBe(op);
    });

    it.each(OPS)('%s over Reverse(xs)', (op) => {
      expect(
        ce()
          .box(opCall(op, ['Reverse', 'xs'], P))
          .evaluate().operator
      ).toBe(op);
    });

    it.each(OPS)('%s over a symbolic Range', (op) => {
      expect(
        ce()
          .box(opCall(op, ['Range', 'a', 'b'], P))
          .evaluate().operator
      ).toBe(op);
    });
  });

  // The cost class this facet exists to avoid. Reading the emptiness facets
  // from a wrapper was measured at exactly 2^(d+1) − 2 calls; the facet's own
  // propagation is one call per level.
  it('is not exponential in the wrapper depth', () => {
    const e = ce();
    const proto = Object.getPrototypeOf(e.box(['Filter', ['List', 1], P]));
    const original = Object.getOwnPropertyDescriptor(
      proto,
      'isEnumerableCollection'
    )!;
    let calls = 0;
    const counts: number[] = [];
    try {
      Object.defineProperty(proto, 'isEnumerableCollection', {
        get() {
          calls += 1;
          return original.get!.call(this);
        },
        configurable: true,
      });
      for (const depth of [2, 4, 6, 8]) {
        let expr: any = ['List', 1, 2, 3];
        for (let i = 0; i < depth; i++) expr = ['Filter', expr, P];
        const boxed = e.box(expr);
        calls = 0;
        void boxed.isEmptyCollection;
        counts.push(calls);
      }
    } finally {
      Object.defineProperty(proto, 'isEnumerableCollection', original);
    }
    // Assert the COMPLEXITY CLASS, not the exact counts: an extra defensive
    // read inside the propagation is a legitimate change, an exponential
    // blow-up is not. Measured 2026-08-10: [3, 10, 21, 36] = d(d+1)/2, against
    // 2^(d+1) − 2 = [6, 30, 126, 510] for the emptiness-facet shape this
    // replaced. The bound below (2× the measured quadratic) separates the two
    // decisively from depth 4 on.
    const depths = [2, 4, 6, 8];
    counts.forEach((n, i) => {
      const d = depths[i];
      expect(n).toBeLessThanOrEqual(d * (d + 1));
    });
    // Sanity: the walk did happen (a facet that is never consulted would also
    // satisfy the bound above).
    expect(counts[0]).toBeGreaterThan(0);
  });

  // Cases found by the 2026-08-10 dual review, each verified against the
  // engine before it was fixed.
  describe('review regressions', () => {
    // An ALIAS must not change the answer. A symbol with a value relays that
    // value's verdict verbatim; only the ABSENCE of a value is a definite
    // `false`. Collapsing the value's `undefined` reported a symbol bound to
    // an eager collection as unwalkable.
    it('a symbol bound to an eager collection answers like the value', () => {
      const e = ce();
      e.assign('ys', e.box(['Characters', { str: 'aab' }]));
      const isA = ['Function', ['Equal', '_1', { str: 'a' }], '_1'];
      // The value's own verdict, relayed verbatim — `true` since `Characters`
      // adopted `canEnumerate` (it was `undefined` before adoption; the pin
      // is that it is never collapsed to `false`).
      expect(e.box('ys').isEnumerableCollection).toBe(
        e.box(['Characters', { str: 'aab' }]).isEnumerableCollection
      );
      expect(e.box(['Filter', 'ys', isA]).evaluate().toString()).toBe(
        '["a","a"]'
      );
    });

    // A dependent clause cannot be judged, but the INDEPENDENT clauses before
    // it can — and a `false` from one of those decides the comprehension.
    it('a dependent comprehension over a valueless base clause is inert', () => {
      const e = ce();
      const c = [
        'Comprehension',
        ['Add', 'x', 'y'],
        ['Element', 'x', 'xs'],
        ['Element', 'y', ['Range', 1, 'x']],
      ];
      expect(e.box(c as any).isEnumerableCollection).toBe(false);
      expect(e.box(['Any', c, P] as any).evaluate().operator).toBe('Any');
      expect(e.box(['CountIf', c, P] as any).evaluate().operator).toBe(
        'CountIf'
      );
      // A dependent comprehension over a REACHABLE base still evaluates.
      expect(
        e
          .box([
            'Comprehension',
            ['Add', 'x', 'y'],
            ['Element', 'x', ['List', 1, 2]],
            ['Element', 'y', ['Range', 1, 'x']],
          ])
          .evaluate()
          .toString()
      ).toBe('[2,3,4]');
    });

    // The multi-source `Map` advances its sources in lockstep, so ANY
    // unwalkable source stops the walk — reading only `op1` reported `true`.
    it('the variadic Map consults every source', () => {
      const e = ce();
      const f = ['Function', ['Add', '_1', '_2'], '_1', '_2'];
      const m = ['Map', f, ['List', 1, 2], 'xs'];
      expect(e.box(m as any).isEnumerableCollection).toBe(false);
      expect(e.box(['Any', m, P] as any).evaluate().operator).toBe('Any');
    });

    // `count` is a second route to the same wrong answer: these handlers gate
    // on `isFiniteCollection`, which `Take(xs, 2)` satisfies (capped at 2)
    // while having nothing to walk.
    it.each([
      ['Filter', ['Length', ['Filter', ['Take', 'xs', 2], P]], 'Length'],
      ['TakeWhile', ['Length', ['TakeWhile', ['Take', 'xs', 2], P]], 'Length'],
      ['DropWhile', ['Length', ['DropWhile', ['Take', 'xs', 2], P]], 'Length'],
      ['Dedup', ['Length', ['Dedup', ['Take', 'xs', 2]]], 'Length'],
      ['Count', ['Count', ['Take', 'xs', 2], 3], 'Count'],
      ['Ordering', ['Ordering', ['Take', 'xs', 2]], 'Ordering'],
    ] as const)(
      '%s does not count an unwalkable source as 0',
      (_op, expr, head) => {
        expect(
          ce()
            .box(expr as any)
            .evaluate().operator
        ).toBe(head);
      }
    );

    it('the same expressions over a valued source still count', () => {
      const e = ce();
      e.assign('xs', e.box(['List', 3, -1, 4]));
      expect(
        e
          .box(['Length', ['Filter', ['Take', 'xs', 2], P]])
          .evaluate()
          .toString()
      ).toBe('1');
      expect(
        e
          .box(['Count', ['Take', 'xs', 2], 3])
          .evaluate()
          .toString()
      ).toBe('1');
    });

    // A non-positive bound makes `Take` empty whatever its source is, so the
    // definite answer stays available.
    it('Take with a non-positive bound is enumerable', () => {
      const e = ce();
      expect(e.box(['Take', 'xs', 0]).isEnumerableCollection).toBe(true);
      expect(
        e
          .box(['Any', ['Take', 'xs', 0], P])
          .evaluate()
          .toString()
      ).toBe('"False"');
      expect(
        e
          .box(['All', ['Take', 'xs', 0], P])
          .evaluate()
          .toString()
      ).toBe('"True"');
      // A positive bound still propagates from the source.
      expect(e.box(['Take', 'xs', 2]).isEnumerableCollection).toBe(false);
    });
  });
});
