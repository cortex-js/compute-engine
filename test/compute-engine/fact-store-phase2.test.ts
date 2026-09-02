/**
 * An assumption is a FACT, a declaration is a CONTRACT, and facts never enter
 * contracts.
 *
 * `assume()` writes no type and installs no value on a definition. What a fact
 * proves is merged into the definition's DECLARED type by the type READ, so
 * retracting the fact — a `forget()`, a scope pop, a rolled-back transaction —
 * retracts what it proved, with nothing to rewind. These tests pin the read
 * side: what a fact contributes, which definition it contributes to, and what
 * survives each way of retracting it.
 *
 * The STORE's own mechanics (record lists, the overlay's lifetime, the index
 * cache key) are pinned by `fact-store-phase1.test.ts`.
 */

import { ComputeEngine } from '../../src/compute-engine';

import '../utils'; // For snapshot serializers

describe('what a fact contributes to the type', () => {
  test('an inequality against a literal proves a range, and forget() takes it back', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.parse('x > 4'))).toBe('ok');
    expect(ce.box('x').type.toString()).toBe('real<4<..>');

    ce.forget('x');
    // Nothing was written, so nothing has to be rewound: the declared type is
    // simply what is left once the fact is gone.
    expect(ce.box('x').type.toString()).toBe('real');
  });

  test('a disequality against a machine number excludes it', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    expect(ce.assume(ce.parse('y \\ne 2'))).toBe('ok');
    expect(ce.box('y').type.toString()).toBe('real & !2');
  });

  test('a disequality against a non-machine value excludes nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'real');
    expect(ce.assume(ce.parse('s \\ne \\sqrt2'))).toBe('ok');
    // A type can name a machine number and no other value, so `√2` stays a
    // fact and only a fact.
    expect(ce.box('s').type.toString()).toBe('real');
  });

  test('an equality proves the promoted tier of its value', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('z = 5'))).toBe('ok');
    expect(ce.box('z').type.toString()).toBe('integer');
    expect(ce.box('z').evaluate().json).toBe(5);

    ce.forget('z');
    // The binding the assumption introduced survives; what it proved does not.
    expect(ce.box('z').type.toString()).toBe('unknown');
    expect(ce.box('z').evaluate().json).toBe('z');
  });

  test('a membership proves the set element type', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.box(['Element', 'n', 'Integers']))).toBe('ok');
    expect(ce.box('n').type.toString()).toBe('integer');

    ce.forget('n');
    expect(ce.box('n').type.toString()).toBe('unknown');
  });

  test('a part-bound never proves the whole value is real', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.box(['Greater', ['Real', 's'], 1]))).toBe('ok');
    // The type is the carrier the use under `Real` infers into the fresh
    // symbol (`complex | infinity`); the fact itself adds no realness.
    expect(ce.box('s').type.toString()).toBe('complex | infinity');
    expect(ce.box('s').type.matches('real')).toBe(false);
  });

  test('a finite modulus bound proves the whole value is finite', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('|q| < 1'))).toBe('ok');
    expect(ce.box('q').type.toString()).toBe('complex');
    expect(ce.box('q').isFinite).toBe(true);
  });

  test('an inequality between two symbols proves nothing about either type', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    expect(ce.assume(ce.parse('a > b'))).toBe('ok');
    expect(ce.box('a').type.toString()).toBe('real');
    expect(ce.box('b').type.toString()).toBe('real');
  });

  test('the contributions of one definition are order-independent', () => {
    // Each bound is rounded outward and demoted BEFORE the intersection is
    // built, so the two orders reduce to the same node.
    const lowerFirst = new ComputeEngine();
    lowerFirst.declare('x', 'real');
    lowerFirst.assume(lowerFirst.parse('x > 1/3'));
    lowerFirst.assume(lowerFirst.parse('x < 5'));

    const upperFirst = new ComputeEngine();
    upperFirst.declare('x', 'real');
    upperFirst.assume(upperFirst.parse('x < 5'));
    upperFirst.assume(upperFirst.parse('x > 1/3'));

    expect(upperFirst.box('x').type.toString()).toBe(
      lowerFirst.box('x').type.toString()
    );
    // An exact bound the machine cannot represent is rounded OUTWARD, so the
    // range still admits every value the assumption admits.
    expect(lowerFirst.box('x').type.toString()).toBe(
      'real<0.33333333333333326..<5>'
    );
  });

  test('building the index is re-entrant: a fact may mention declared symbols', () => {
    // Deriving the contribution of `x ∈ Range(a, b)` reads the operands, and a
    // type read asks for the index. The index is built with the facts
    // suppressed, so the read answers from the declaration alone instead of
    // asking for the index that is being built.
    const ce = new ComputeEngine();
    ce.declare('a', 'integer');
    ce.declare('b', 'integer');
    expect(ce.assume(ce.box(['Element', 'x', ['Range', 'a', 'b']]))).toBe('ok');
    expect(ce.box('x').type.toString()).toBe('integer');
  });
});

describe('a valued definition takes its type from its value', () => {
  test('a fact about an assigned symbol does not narrow its type', () => {
    const ce = new ComputeEngine();
    ce.assign('v', 5);
    expect(ce.assume(ce.parse('v > 3'))).toBe('ok');
    // The value is the contract here; the assumption is CHECKED against it and
    // never retypes it.
    expect(ce.box('v').type.toString()).toBe('integer');
  });

  test('a fact refuted by the assigned value is a contradiction', () => {
    const ce = new ComputeEngine();
    ce.assign('v', 5);
    expect(ce.assume(ce.parse('v > 10'))).toBe('contradiction');
  });

  test('a fact in force refuses an assignment that refutes it', () => {
    const ce = new ComputeEngine();
    ce.assign('u', 5);
    expect(ce.assume(ce.parse('u > 3'))).toBe('ok');
    expect(() => ce.assign('u', 1)).toThrow();
    expect(ce.box('u').evaluate().json).toBe(5);
    // A conforming value is accepted…
    ce.assign('u', 7);
    expect(ce.box('u').evaluate().json).toBe(7);
    // …and the refusal lifts with the fact, which a DECLARED range would not.
    ce.forget('u');
    ce.assign('u', 1);
    expect(ce.box('u').evaluate().json).toBe(1);
  });

  test('a declared symbol under a fact refuses the same assignment', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'real');
    expect(ce.assume(ce.parse('v > 3'))).toBe('ok');
    expect(() => ce.assign('v', 1)).toThrow();
  });
});

describe('a fact refuses a value its type contribution lets past', () => {
  test('an assumed equality refuses a different assigned value', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('x = 5'))).toBe('ok');
    // `x = 5` contributes only the promoted TIER `integer`, which 7 inhabits,
    // so the type check has nothing to object to: the fact itself refuses the
    // assignment.
    expect(() => ce.assign('x', 7)).toThrow(/assumption in force/);
    expect(ce.box('x').evaluate().json).toBe(5);
    // The value the fact states is accepted.
    ce.assign('x', 5);
    expect(ce.box('x').evaluate().json).toBe(5);
  });

  test('a value refuted through another symbol contradicts', () => {
    const ce = new ComputeEngine();
    // `x > y` proves no type for either symbol, so nothing here is caught by a
    // type: the staged value of each symbol is put back into the facts.
    expect(
      ce.assume(
        ce.box([
          'And',
          ['Greater', 'x', 'y'],
          ['Equal', 'y', 5],
          ['Equal', 'x', 1],
        ])
      )
    ).toBe('contradiction');
    expect(ce.box('x').value).toBeUndefined();
    expect(ce.box('y').value).toBeUndefined();
  });
});

describe('an invalid predicate is never stored as a fact', () => {
  test('a part-bound on a string subject is a contradiction', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'string');
    // `Re(s)` does not type-check, so the normalized predicate reduces to the
    // `incompatible-type` error itself. That is a refutation, and an error
    // expression must never reach the store as a fact key.
    const failed: unknown[][] = [];
    const assertSpy = jest
      .spyOn(console, 'assert')
      .mockImplementation((condition?: boolean, ...rest: unknown[]) => {
        if (!condition) failed.push(rest);
      });
    try {
      expect(ce.assume(ce.box(['Greater', ['Real', 's'], 1]))).toBe(
        'contradiction'
      );
    } finally {
      assertSpy.mockRestore();
    }
    expect(failed).toEqual([]);
    expect(ce.context.assumptions.size).toBe(0);
    expect(ce.box('s').type.toString()).toBe('string');
  });
});

describe('the identity rule — a fact is about a DEFINITION', () => {
  test('a re-declaration in an inner scope does not inherit the outer facts', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assume(ce.parse('x > 3'));
    const outer = ce.box('x');

    ce.pushScope();
    ce.declare('x', 'string');
    // Direction 1: the inner definition is not what the outer fact is about,
    // so nothing is merged into it — a name-keyed merge would answer `never`.
    expect(ce.box('x').type.toString()).toBe('string');
    // Direction 2: a HELD reference to the outer definition still reads the
    // fact, even from inside the scope that shadows the name.
    expect(outer.type.toString()).toBe('real<3<..>');
    // @fixme The SIGN channel is still keyed by NAME, so it answers from the
    // enclosing scope's fact about a value the shadowing `x` is not. Folding
    // it onto the definition is the next round
    // (`docs/plans/2026-08-29-assumptions-as-facts-type.md` §6 Q1); this pin
    // records the divergence rather than endorsing it.
    expect(ce.box('x').isPositive).toBe(true);
    ce.popScope();

    expect(ce.box('x').type.toString()).toBe('real<3<..>');
  });

  test('two definitions of one name each keep their own facts', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assume(ce.parse('x > 3'));
    const outer = ce.box('x');

    ce.pushScope();
    ce.declare('x', 'integer');
    expect(ce.assume(ce.parse('x < 10'))).toBe('ok');
    expect(ce.box('x').type.toString()).toBe('integer<..9>');
    expect(outer.type.toString()).toBe('real<3<..>');

    // Re-asserting the enclosing scope's bound is NOT redundant here: the
    // inherited record is about the OTHER definition, and this one has no
    // lower bound until the assertion is recorded against it.
    expect(ce.assume(ce.parse('x > 3'))).toBe('ok');
    expect(ce.box('x').type.toString()).toBe('integer<4..9>');
    ce.popScope();
  });

  test('re-asserting a bound about the SAME definition is still a tautology', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.parse('x > 3'))).toBe('ok');
    expect(ce.assume(ce.parse('x > 1'))).toBe('tautology');
  });
});

describe('a scoped assumption needs no shadow binding', () => {
  test('an inner assumption about an outer symbol is dropped by the pop', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    ce.pushScope();
    expect(ce.assume(ce.parse('u > 3'))).toBe('ok');
    expect(ce.box('u').type.toString()).toBe('real<3<..>');
    ce.popScope();
    // No shadow binding was ever declared; the inner scope's fact map went
    // with the scope.
    expect(ce.box('u').type.toString()).toBe('real');
  });

  test('an inner assumed VALUE is dropped by the pop', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    ce.pushScope();
    ce.assume(ce.parse('u = 5'));
    expect(ce.box('u').evaluate().json).toBe(5);
    ce.popScope();
    expect(ce.box('u').value).toBeUndefined();
  });
});

describe('the transaction', () => {
  test('a contradictory conjunction leaves no residue', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    expect(
      ce.assume(ce.box(['And', ['Greater', 'p', 0], ['Less', 'p', -5]]))
    ).toBe('contradiction');
    // The undo log put the first conjunct back.
    expect(ce.box('p').type.toString()).toBe('real');
    expect(ce.box('p').isPositive).toBe(undefined);
    expect(ce.context.assumptions.size).toBe(0);
  });

  test('a consistent conjunction applies every conjunct', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    expect(
      ce.assume(ce.box(['And', ['Greater', 'a', 0], ['Less', 'b', 10]]))
    ).toBe('ok');
    expect(ce.box('a').type.toString()).toBe('real<0<..>');
    expect(ce.box('b').type.toString()).toBe('real<..<10>');
  });

  test('two assumed values for one symbol contradict', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.box(['And', ['Equal', 'x', 1], ['Equal', 'x', 2]]))).toBe(
      'contradiction'
    );
    expect(ce.box('x').value).toBeUndefined();
  });

  test('a second, incompatible assumed value keeps the first', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('x = 1'))).toBe('ok');
    expect(ce.assume(ce.parse('x = 2'))).toBe('contradiction');
    expect(ce.box('x').evaluate().json).toBe(1);
  });

  test('an assumed value refuted by a fact contradicts', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.parse('x > 3'))).toBe('ok');
    expect(ce.assume(ce.parse('x = 1'))).toBe('contradiction');
    expect(ce.box('x').value).toBeUndefined();
  });

  test('an assumed value outside a declared range contradicts', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'integer<0..3>');
    expect(ce.assume(ce.parse('w = 5'))).toBe('contradiction');
    expect(ce.box('w').value).toBeUndefined();
  });

  test('an unsupported conjunct keeps the conjuncts applied before it', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.box(['And', ['Greater', 'x', 3], ['Foo', 'x']]))).toBe(
      'not-a-predicate'
    );
    expect(ce.box('x').type.toString()).toBe('real<3<..>');
  });

  test('the four empty-type shapes are all contradictions', () => {
    // Decided on the REDUCED node: three of the four read as inhabited before
    // reduction.
    const singleton = new ComputeEngine();
    singleton.declare('a', 'real<3..3>');
    expect(singleton.assume(singleton.parse('a \\ne 3'))).toBe('contradiction');

    const openBoth = new ComputeEngine();
    openBoth.declare('b', 'real');
    openBoth.assume(openBoth.parse('b > 3'));
    expect(openBoth.assume(openBoth.parse('b < 3'))).toBe('contradiction');

    const touching = new ComputeEngine();
    touching.declare('c', 'real');
    touching.assume(touching.parse('c > 3'));
    expect(touching.assume(touching.parse('c \\le 3'))).toBe('contradiction');

    const noInteger = new ComputeEngine();
    noInteger.declare('d', 'integer');
    expect(noInteger.assume(noInteger.parse('0.2 < d < 0.8'))).toBe(
      'contradiction'
    );
    expect(noInteger.box('d').type.toString()).toBe('integer');
  });
});

describe('a transaction gives up the bindings it introduced', () => {
  // The proposition is boxed RAW in each of these: canonicalizing it is what
  // binds its free symbols, so it has to reach `assume()` still uncanonical
  // for the transaction to know which bindings are its own to give up. A
  // caller who canonicalizes first (`ce.assume(ce.parse('p > 0'))`) has made
  // the bindings itself and keeps them.
  test('a contradictory conjunction gives up the symbol it introduced', () => {
    const ce = new ComputeEngine();
    expect(
      ce.assume(
        ce.expr(['And', ['Greater', 'p', 0], ['Less', 'p', -5]], {
          form: 'raw',
        })
      )
    ).toBe('contradiction');
    expect(ce.lookupDefinition('p')).toBeUndefined();
  });

  test('a rejected conjunct gives up only the bindings it introduced', () => {
    const ce = new ComputeEngine();
    expect(
      ce.assume(
        ce.expr(['And', ['Greater', 'x', 3], ['Foo', 'y']], { form: 'raw' })
      )
    ).toBe('not-a-predicate');
    // The conjuncts applied before the rejected one stand, binding included…
    expect(ce.box('x').type.toString()).toBe('real<3<..>');
    // …and the rejected conjunct takes its own binding with it.
    expect(ce.lookupDefinition('y')).toBeUndefined();
  });

  test('a symbol declared before the assumption is never given up', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    expect(
      ce.assume(
        ce.expr(['And', ['Greater', 'p', 0], ['Less', 'p', -5]], {
          form: 'raw',
        })
      )
    ).toBe('contradiction');
    expect(ce.lookupDefinition('p')).toBeDefined();
    expect(ce.box('p').type.toString()).toBe('real');
  });
});

describe('the recording-time value shield', () => {
  test('a predicate about an assigned symbol is recorded about the SYMBOL', () => {
    const ce = new ComputeEngine();
    ce.assign('w', 5);
    // Without the shield this folds to `5 > 0` and answers `'tautology'`,
    // recording nothing.
    expect(ce.assume(ce.parse('w > 0'))).toBe('ok');
    expect(ce.parse('|w|').simplify().json).toBe('w');
    // The assigned value is untouched by the recording.
    expect(ce.parse('w').evaluate().json).toBe(5);
  });

  test('a predicate with no symbol at all is still a tautology', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('5 > 0'))).toBe('tautology');
  });

  test('a predicate refuted by the assigned value records nothing', () => {
    const ce = new ComputeEngine();
    ce.assign('w', -2);
    expect(ce.assume(ce.parse('w > 0'))).toBe('contradiction');
    expect(ce.context.assumptions.size).toBe(0);
    expect(ce.parse('|w|').simplify().json).toEqual(['Abs', 'w']);
  });

  test('re-asserting an assumed equality is a tautology, not a second record', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.box(['Equal', 'one', 1]))).toBe('ok');
    // The shield hides the value the FIRST assertion put in the overlay, so
    // the second reaches the store rather than folding to `1 = 1`. There it
    // meets the assertion already recorded about this same definition and
    // states nothing new.
    expect(ce.assume(ce.box(['Equal', 'one', 1]))).toBe('tautology');
    expect(ce.box('one').evaluate().json).toBe(1);
    // One key, one record: a repetition does not grow the store.
    const records = [...ce.context.assumptions.entries()].map(
      ([, list]) => list.length
    );
    expect(records).toEqual([1]);
  });
});

describe('checkpoint and restore', () => {
  test('restoring past an assumption leaves the type as it was', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const cp = ce.checkpoint();
    ce.assume(ce.parse('x > 3'));
    expect(ce.box('x').type.toString()).toBe('real<3<..>');
    ce.restore(cp);
    expect(ce.box('x').type.toString()).toBe('real');
  });

  test('restoring past an assumed value leaves a later assignment alone', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.assume(ce.parse('x = 5'));
    ce.restore(cp);
    ce.assign('x', 7);
    // The assigned value is STORED on the definition, so a no-argument
    // forget() — which drops the whole overlay — cannot reach it.
    ce.forget();
    expect(ce.box('x').evaluate().json).toBe(7);
  });
});

describe('the effective type heals', () => {
  test('reading the type, then forgetting, then reading again', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'real');
    ce.assume(ce.parse('m > 3'));
    // The first read fills the memo…
    expect(ce.box('m').type.toString()).toBe('real<3<..>');
    expect(ce.box('m').type.toString()).toBe('real<3<..>');
    ce.forget('m');
    // …which is keyed on the fact index, so retracting the fact retires it.
    expect(ce.box('m').type.toString()).toBe('real');
    ce.assume(ce.parse('m < 0'));
    expect(ce.box('m').type.toString()).toBe('real<..<0>');
  });
});
