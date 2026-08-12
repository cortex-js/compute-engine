import { ComputeEngine } from '../../src/compute-engine';

/**
 * # Eager collection producers: delivery and enumerability
 *
 * Implements `docs/plans/2026-08-11-eager-collection-enumerability.md`.
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
