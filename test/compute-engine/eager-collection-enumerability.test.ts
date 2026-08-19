import { ComputeEngine } from '../../src/compute-engine';

/**
 * # Eager collection producers: delivery and enumerability
 *
 * Implements `docs/COLLECTIONS-MODEL.md`.
 *
 * An EAGER collection operator (`Divisors`, `Characters`, … — no `collection`
 * handlers) produces its collection only as its `evaluate()` result. Two
 * coupled mechanisms make that class behave:
 *
 * 1. **Delivery** — `BoxedFunction.at()` has the same materialize-on-demand
 *    fallback `each()` always had (`_materializedAt`): pure sources only,
 *    evaluated once per generation, not per index. Without it, every wrapper
 *    that reads its source by index (`Take`, `Drop`, `Reverse`, `Rest`,
 *    `Slice`, `RotateLeft`) walked an eager source as EMPTY — wrong values on
 *    fully-ground input.
 * 2. **Predicate** — the `canEnumerate` operator-definition handler exposes
 *    the operator's own decline test so `isEnumerableCollection` answers
 *    without evaluating. `false` means evaluation would decline (wrappers
 *    stay inert); `true` is a hard promise reserved for complete
 *    preconditions; `undefined` resolves through the evaluate fallback,
 *    exactly as before adoption.
 */

const GT1 = ['Function', ['Greater', '_1', 1], '_1'] as const;
const IS_A = ['Function', ['Equal', '_1', { str: 'a' }], '_1'] as const;

function ce(): ComputeEngine {
  const engine = new ComputeEngine();
  engine.declare('s', 'string');
  engine.declare('xs', 'list<integer>');
  return engine;
}

describe('delivery: the at() materialize fallback (Defect A)', () => {
  // The indexed wrappers over a fully-ground eager source. Before the
  // fallback each of these walked empty: Filter answered [], Any "False" —
  // definite wrong values, while `.evaluate()` of the wrapper alone was
  // correct (its operands evaluate first, so the bug hid until something
  // iterated the un-evaluated form).
  it('Filter over Take/Drop/Reverse/Rest of Divisors(12)', () => {
    const e = ce();
    expect(
      e
        .box(['Filter', ['Take', ['Divisors', 12], 3], GT1])
        .evaluate()
        .toString()
    ).toBe('[2,3]');
    expect(
      e
        .box(['Filter', ['Drop', ['Divisors', 12], 4], GT1])
        .evaluate()
        .toString()
    ).toBe('[6,12]');
    expect(
      e
        .box(['Filter', ['Rest', ['PrimeFactors', 12]], GT1])
        .evaluate()
        .toString()
    ).toBe('[3]');
    expect(
      e
        .box(['Any', ['Reverse', ['Divisors', 12]], GT1])
        .evaluate()
        .toString()
    ).toBe('"True"');
  });

  it('reductions over an indexed wrapper', () => {
    expect(
      ce()
        .box(['Sum', ['Take', ['Divisors', 12], 3]])
        .evaluate()
        .toString()
    ).toBe('6');
  });

  it('string producers under an indexed wrapper', () => {
    expect(
      ce()
        .box(['Filter', ['Take', ['Characters', { str: 'aab' }], 2], IS_A])
        .evaluate()
        .toString()
    ).toBe('["a","a"]');
  });

  // Negative indices normalize on the DELEGATED call: the evaluated form is
  // a List with a real `count`.
  it('negative index over an eager source', () => {
    expect(
      ce()
        .box(['At', ['Divisors', 12], -1])
        .evaluate()
        .toString()
    ).toBe('12');
    expect(ce().box(['Divisors', 12]).at(-1)?.toString()).toBe('12');
  });

  it('a scalar-typed application does not materialize', () => {
    // `at()` is probed speculatively; a non-collection must answer undefined
    // without paying an evaluation.
    expect(ce().box(['Add', 'x', 1]).at(1)).toBeUndefined();
  });

  // IMPURE producers stay declined on the indexed route: a per-generation
  // re-evaluation would mix elements of different draws (see the ROADMAP
  // draw-coherence item). Pinned so a future "fix" doesn't silently ship
  // incoherent draw mixing.
  it('an impure eager source stays declined', () => {
    expect(
      ce()
        .box(['Take', ['RandomShuffle', ['List', 1, 2, 3]], 2])
        .at(1)
    ).toBeUndefined();
  });

  it('the evaluated form is computed once per walk, not per index', () => {
    const e = ce();
    const probe = e.box(['Divisors', 12]);
    const proto = Object.getPrototypeOf(probe);
    const original = proto.evaluate;
    let evaluations = 0;
    try {
      proto.evaluate = function (...args: unknown[]) {
        if (this.operator === 'Divisors') evaluations += 1;
        return original.apply(this, args);
      };
      const take = e.box(['Take', ['Divisors', 12], 3]);
      evaluations = 0;
      for (const _ of take.each()) {
        // takeIterator probes at(1), at(2), at(3), at(4) — one evaluation.
      }
      expect(evaluations).toBeLessThanOrEqual(1);
      // A second walk of the same instance serves from the cache.
      evaluations = 0;
      for (const _ of take.each()) {
        // cached
      }
      expect(evaluations).toBe(0);
    } finally {
      proto.evaluate = original;
    }
  });
});

describe('predicate: canEnumerate answers the facet without evaluating', () => {
  it.each([
    // Complete preconditions: ground → true, valueless symbol → false.
    ['Divisors(12)', ['Divisors', 12], true],
    ['Divisors(n) free symbol', ['Divisors', 'n'], false],
    ['Divisors(0) declines by ruling', ['Divisors', 0], false],
    ['PrimeFactors(360)', ['PrimeFactors', 360], true],
    ['PrimeFactors(n)', ['PrimeFactors', 'n'], false],
    ['FactorInteger(0) degenerate but defined', ['FactorInteger', 0], true],
    ['IntegerDigits(255, 16)', ['IntegerDigits', 255, 16], true],
    ['IntegerDigits(255, 1) bad base', ['IntegerDigits', 255, 1], false],
    ['IntegerDigits(n)', ['IntegerDigits', 'n'], false],
    ['Characters("ab")', ['Characters', { str: 'ab' }], true],
    ['Characters(s) valueless', ['Characters', 's'], false],
    ['GraphemeClusters(s)', ['GraphemeClusters', 's'], false],
    ['UnicodeScalars("ab")', ['UnicodeScalars', { str: 'ab' }], true],
    ['Utf8(s)', ['Utf8', 's'], false],
    ['Utf16("ab")', ['Utf16', { str: 'ab' }], true],
    [
      'StringSplit("a,b", ",")',
      ['StringSplit', { str: 'a,b' }, { str: ',' }],
      true,
    ],
    ['StringSplit(s, ",")', ['StringSplit', 's', { str: ',' }], false],
  ] as const)('%s → %s', (_label, expr, expected) => {
    expect(ce().box(expr as any).isEnumerableCollection).toBe(expected);
  });

  it('a symbol operand with a value reads the value, not the name', () => {
    const e = ce();
    e.assign('m', e.box(12));
    expect(e.box(['Divisors', 'm']).isEnumerableCollection).toBe(true);
    expect(
      e
        .box(['Filter', ['Take', ['Divisors', 'm'], 3], GT1])
        .evaluate()
        .toString()
    ).toBe('[2,3]');
  });

  // The operand seen by `canEnumerate` is the CANONICAL operand: a compound
  // whose value cannot be read cheaply is UNDECIDABLE, never false — the
  // evaluate fallback resolves it, and a later assignment is not contradicted.
  it('a well-typed compound operand is undefined, and resolves by evaluating', () => {
    const e = ce();
    e.declare('k', 'integer');
    const d = e.box(['Divisors', ['Add', 'k', 1]]);
    expect(d.isValid).toBe(true);
    expect(d.isEnumerableCollection).toBeUndefined();
    e.assign('k', e.box(11));
    expect(d.evaluate().toString()).toBe('[1,2,3,4,6,12]');
  });

  // Finite-source consumers: provable declines only — `true` would promise
  // `sortedIndices`/`tally` success, which is not cheaply decidable.
  it.each(['Sort', 'Ordering', 'Unique', 'Tally'])(
    '%s: false over a valueless source, undefined over a ground one',
    (op) => {
      const e = ce();
      expect(e.box([op, 'xs']).isEnumerableCollection).toBe(false);
      expect(
        e.box([op, ['List', 3, 1]]).isEnumerableCollection
      ).toBeUndefined();
    }
  );

  // The `undefined` tier is permanent by design: a producer whose success is
  // not cheaply decidable must never answer `true` — pinned so adoption
  // pressure doesn't drift it (see the contract in types-definitions.ts).
  it('Solve stays in the undefined tier', () => {
    const e = ce();
    const solve = [
      'Solve',
      ['Equal', ['Subtract', ['Square', 'x'], 1], 0],
      'x',
    ];
    expect(e.box(solve as any).isEnumerableCollection).toBeUndefined();
    // ...and the evaluate fallback still resolves it.
    expect(
      e
        .box(solve as any)
        .evaluate()
        .toString()
    ).toBe('[1,-1]');
  });
});

describe('the coupling: wrapped symbolic sources are inert, ground ones answer (Defect B)', () => {
  const OPS = ['Filter', 'TakeWhile', 'Map', 'Any', 'All', 'CountIf'];

  it.each(OPS)('%s over Take(Divisors(n), 2) stays inert', (op) => {
    expect(
      ce()
        .box([op, ['Take', ['Divisors', 'n'], 2], GT1])
        .evaluate().operator
    ).toBe(op);
  });

  it.each(OPS)('%s over Take(Characters(s), 2) stays inert', (op) => {
    expect(
      ce()
        .box([op, ['Take', ['Characters', 's'], 2], IS_A])
        .evaluate().operator
    ).toBe(op);
  });

  it('the same shapes over ground arguments still answer', () => {
    const e = ce();
    expect(
      e
        .box(['Any', ['Take', ['Divisors', 12], 2], GT1])
        .evaluate()
        .toString()
    ).toBe('"True"');
    expect(
      e
        .box(['CountIf', ['Take', ['Characters', { str: 'aab' }], 2], IS_A])
        .evaluate()
        .toString()
    ).toBe('2');
  });

  // The facet propagates through wrappers from the adopted leaf — no
  // evaluation anywhere on the chain.
  it('wrappers propagate the leaf verdict', () => {
    const e = ce();
    expect(e.box(['Take', ['Divisors', 'n'], 2]).isEnumerableCollection).toBe(
      false
    );
    expect(
      e.box(['Reverse', ['Take', ['Characters', 's'], 2]])
        .isEnumerableCollection
    ).toBe(false);
    expect(e.box(['Take', ['Divisors', 12], 2]).isEnumerableCollection).toBe(
      true
    );
  });

  // Coherence check on the complete-precondition adopters: everywhere
  // `canEnumerate` vouches `true`, evaluation must actually produce the
  // collection (the dev-mode console.assert in `_materializedAt` covers
  // unpinned inputs).
  it.each([
    ['Divisors', ['Divisors', 360]],
    ['PrimeFactors', ['PrimeFactors', 360]],
    ['FactorInteger', ['FactorInteger', -12]],
    ['IntegerDigits', ['IntegerDigits', 255, 16, 4]],
    ['Characters', ['Characters', { str: 'abc' }]],
    ['UnicodeScalars', ['UnicodeScalars', { str: 'abc' }]],
    ['Utf8', ['Utf8', { str: 'abc' }]],
    ['Utf16', ['Utf16', { str: 'abc' }]],
    ['GraphemeClusters', ['GraphemeClusters', { str: 'abc' }]],
    ['StringSplit', ['StringSplit', { str: 'a b' }]],
  ] as const)('%s: true is backed by a successful evaluation', (_op, expr) => {
    const e = ce();
    const boxed = e.box(expr as any);
    expect(boxed.isEnumerableCollection).toBe(true);
    expect(boxed.evaluate().isCollection).toBe(true);
  });
});

/**
 * # Adoption round 2 (2026-08-11): the remaining eager producers
 *
 * Three parallel adoption passes over linear-algebra, collections/sets and
 * statistics/complex/number-theory/arithmetic — 31 more operators. Recipes
 * per the same rulings: `true` only for complete preconditions, decline-only
 * where success is not cheaply decidable, IMPURE producers never `true`.
 */
describe('adoption round 2', () => {
  it.each([
    // Complete preconditions (true-capable).
    [
      'Shape([[1,2],[3,4]])',
      ['Shape', ['List', ['List', 1, 2], ['List', 3, 4]]],
      true,
    ],
    ['Shape(5) — a tuple for every value', ['Shape', 5], true],
    ['Keys(dict)', ['Keys', ['Dictionary', ['Tuple', { str: 'a' }, 1]]], true],
    [
      'Values(dict)',
      ['Values', ['Dictionary', ['Tuple', { str: 'a' }, 1]]],
      true,
    ],
    ['Keys(xs) — not a dictionary', ['Keys', 'xs'], false],
    ['AbsArg(3)', ['AbsArg', 3], true],
    ['AbsArg(z) valueless', ['AbsArg', 'z'], false],
    ['ComplexRoots(1, 4)', ['ComplexRoots', 1, 4], true],
    ['ComplexRoots(z, 4)', ['ComplexRoots', 'z', 4], false],
    ['ExtendedGCD(12, 18)', ['ExtendedGCD', 12, 18], true],
    ['ExtendedGCD(n, 18)', ['ExtendedGCD', 'n', 18], false],
    ['PlusMinus(1, 2)', ['PlusMinus', 1, 2], true],
    // Decline-only: false on a provable decline, undefined on ground input.
    ['Eigenvalues(M) valueless', ['Eigenvalues', 'M'], false],
    [
      'Eigenvalues(ground) — never true',
      ['Eigenvalues', ['List', ['List', 2, 0], ['List', 0, 3]]],
      undefined,
    ],
    ['Chunk(xs, 2) valueless', ['Chunk', 'xs', 2], false],
    ['Chunk([1,2,3], 0) bad size', ['Chunk', ['List', 1, 2, 3], 0], false],
    [
      'GroupBy(xs, f)',
      ['GroupBy', 'xs', ['Function', ['Greater', '_1', 0], '_1']],
      false,
    ],
    [
      'ListFrom(Range(1,+oo)) infinite',
      ['ListFrom', ['Range', 1, { sym: 'PositiveInfinity' }]],
      false,
    ],
    ['DictionaryFrom(xs)', ['DictionaryFrom', 'xs'], false],
    ['BinCounts(xs, 3)', ['BinCounts', 'xs', 3], false],
    ['Histogram(xs, 3)', ['Histogram', 'xs', 3], false],
    // Impure: decline-only from the domain facet, never true.
    ['RandomShuffle(xs)', ['RandomShuffle', 'xs'], false],
    [
      'RandomShuffle([1,2]) — never true',
      ['RandomShuffle', ['List', 1, 2]],
      undefined,
    ],
    ['RandomChoice(xs, 2)', ['RandomChoice', 'xs', 2], false],
    ['RandomSample(xs, 2)', ['RandomSample', 'xs', 2], false],
  ] as const)('%s → %s', (_label, expr, expected) => {
    const e = ce();
    e.declare('z', 'number');
    e.declare('n', 'integer');
    e.declare('M', 'matrix');
    expect(e.box(expr as any).isEnumerableCollection).toBe(expected);
  });

  // The Flatten scalar carve-out: `Flatten(5)` succeeds (→ `[5]`), and a
  // scalar's facet is `false` — the plain decline-only recipe would wrongly
  // inert it, so `Flatten` answers `undefined` for a number operand.
  it('Flatten does not decline a scalar operand', () => {
    const e = ce();
    expect(e.box(['Flatten', 5]).isEnumerableCollection).toBeUndefined();
    expect(e.box(['Flatten', 5]).evaluate().toString()).toBe('[5]');
    e.declare('M', 'matrix');
    expect(e.box(['Flatten', 'M']).isEnumerableCollection).toBe(false);
  });

  it('wrapped decline-only leaves are inert; ground ones answer', () => {
    const e = ce();
    e.declare('M', 'matrix');
    const P = ['Function', ['Greater', '_1', 1], '_1'];
    expect(e.box(['Take', ['Eigenvalues', 'M'], 1]).evaluate().operator).toBe(
      'Take'
    );
    expect(
      e
        .box([
          'Filter',
          ['Take', ['Flatten', ['List', ['List', 1, 2], ['List', 3, 4]]], 3],
          P,
        ])
        .evaluate()
        .toString()
    ).toBe('[2,3]');
    expect(
      e
        .box(['Take', ['ExtendedGCD', 12, 18], 2])
        .evaluate()
        .toString()
    ).toBe('[6,-1]');
  });

  // The impure predicates consume nothing: reading the facet must not draw.
  it('an impure producer answers its facet with zero draws', () => {
    const e = ce();
    const probe = e.box(['RandomShuffle', ['List', 1, 2, 3]]);
    const proto = Object.getPrototypeOf(probe);
    const original = proto.evaluate;
    let evaluations = 0;
    try {
      proto.evaluate = function (...args: unknown[]) {
        evaluations += 1;
        return original.apply(this, args);
      };
      void probe.isEnumerableCollection;
      void e.box(['RandomChoice', ['List', 1, 2], 2]).isEnumerableCollection;
      void e.box(['RandomSample', ['List', 1, 2], 2]).isEnumerableCollection;
      expect(evaluations).toBe(0);
    } finally {
      proto.evaluate = original;
    }
  });
});

/**
 * # Follow-up fixes (2026-08-11, post-sweep)
 *
 * Three items closed after the adoption sweep: the `Quartiles` crash, the
 * `ListFrom`-family inertness ruling, and the `Dot` facet.
 */
describe('post-sweep fixes', () => {
  describe('Quartiles/InterquartileRange no longer crash', () => {
    // `bigMedian` of an empty half threw a TypeError (`sorted[-1].add`):
    // reachable from a fully-GROUND single inexact datum, and from any
    // symbolic datum reaching the numeric path.
    it('a single inexact datum computes instead of throwing', () => {
      const e = ce();
      expect(e.box(['Quartiles', 2.5]).evaluate().toString()).toBe(
        '(NaN, 2.5, NaN)'
      );
      expect(
        e
          .box(['InterquartileRange', ['List', 2.5]])
          .evaluate()
          .toString()
      ).toBe('NaN');
    });

    // Symbolic data stays INERT — not `(…, NaN, …)`, which a later
    // assignment contradicts.
    it('symbolic data leaves the operators inert', () => {
      const e = ce();
      e.declare('z', 'number');
      expect(e.box(['Quartiles', 'z']).evaluate().operator).toBe('Quartiles');
      expect(e.box(['InterquartileRange', 'z']).evaluate().operator).toBe(
        'InterquartileRange'
      );
      expect(
        e.box(['Quartiles', ['List', 1, 2], 'z']).evaluate().operator
      ).toBe('Quartiles');
      e.assign('z', e.box(3));
      expect(
        e
          .box(['Quartiles', ['List', 1, 2], 'z'])
          .evaluate()
          .toString()
      ).toBe('(1, 2, 3)');
    });

    // A NaN LITERAL is a number, not symbolic data: it takes the documented
    // absent-datum path (§3.C — an absent datum poisons the whole tuple),
    // not the inertness guard.
    it('a NaN literal still takes the absence path', () => {
      expect(
        ce()
          .box(['Quartiles', ['List', 1, 2], { sym: 'NaN' }])
          .evaluate()
          .toString()
      ).toBe('(NaN, NaN, NaN)');
    });

    it('Quartiles has its decline-only canEnumerate', () => {
      const e = ce();
      e.declare('z', 'number');
      expect(e.box(['Quartiles', 'z']).isEnumerableCollection).toBe(false);
      expect(
        e.box(['Quartiles', ['List', 1, 2, 3, 4, 5]]).isEnumerableCollection
      ).toBeUndefined();
      expect(
        e
          .box(['Take', ['Quartiles', ['List', 1, 2, 3, 4, 5]], 2])
          .evaluate()
          .toString()
      ).toBe('[3/2,3]');
    });
  });

  // USER-RULED 2026-08-11: a collection-TYPED operand that is not a
  // collection right now (a valueless symbol, an unevaluated eager producer)
  // is UNRESOLVED, not a scalar datum — the `*From` conversions stay inert
  // instead of wrapping it (`ListFrom(xs)` answered `["xs"]`).
  describe('the *From family is inert on an unresolved collection operand', () => {
    it.each(['ListFrom', 'SetFrom', 'TupleFrom'])(
      '%s(xs) stays inert for a valueless xs',
      (op) => {
        const e = ce();
        expect(e.box([op, 'xs']).evaluate().operator).toBe(op);
        expect(e.box([op, 'xs']).isEnumerableCollection).toBe(false);
      }
    );

    it('a genuine scalar still contributes itself', () => {
      const e = ce();
      expect(e.box(['ListFrom', 5]).evaluate().toString()).toBe('[5]');
      expect(
        e
          .box(['ListFrom', 5, ['List', 1, 2]])
          .evaluate()
          .toString()
      ).toBe('[5,1,2]');
    });

    it('an unevaluated eager producer operand is unresolved, not scalar', () => {
      const e = ce();
      expect(e.box(['ListFrom', ['Divisors', 'n']]).evaluate().operator).toBe(
        'ListFrom'
      );
      expect(
        e
          .box(['ListFrom', ['Divisors', 12]])
          .evaluate()
          .toString()
      ).toBe('[1,2,3,4,6,12]');
    });

    it('the inert form resolves after assignment', () => {
      const e = ce();
      e.assign('xs', e.box(['List', 1, 5]));
      expect(e.box(['ListFrom', 'xs']).evaluate().toString()).toBe('[1,5]');
    });
  });

  // `Dot` types its result as the wide `value` for matrix operands, which
  // the facet's type fallthrough misread as a definite `false` while
  // `Dot(m1, m2)` evaluates to a matrix. Sharpened scalar result → `false`
  // (nothing to walk); matrix-ish → from the operands, never `true`.
  describe('Dot facet', () => {
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    it('matrix·matrix is undecided, not false', () => {
      const e = ce();
      expect(e.box(['Dot', m, m]).isEnumerableCollection).toBeUndefined();
      expect(e.box(['Dot', m, m]).evaluate().toString()).toBe(
        '[[7,10],[15,22]]'
      );
    });
    it('vector·vector is false (a number has nothing to walk)', () => {
      const e = ce();
      const d = e.box(['Dot', ['List', 1, 2], ['List', 3, 4]]);
      expect(d.isEnumerableCollection).toBe(false);
      expect(d.evaluate().toString()).toBe('11');
    });
    it('valueless operands are a provable decline', () => {
      const e = ce();
      e.declare('M', 'matrix');
      expect(e.box(['Dot', 'M', 'M']).isEnumerableCollection).toBe(false);
    });
  });
});
