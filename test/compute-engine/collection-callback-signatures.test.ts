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
 * most — a PARAMETERLESS one (`Map(xs, 5)`) is now rejected there too, see
 * below — while everything a `function` slot admits still reaches the handler.
 */

const XS = ['List', 1, 2, 3, 4] as const;

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
 * reported `incompatible-type` while `Map(xs, 5)` answered `[5, 5, 5]`.
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

  it.each([...eager, ...lazy])(
    '%s rejects a non-function operand',
    (op) => {
      const ce = new ComputeEngine();
      expect(ce.box([op, XS, 5]).isValid).toBe(false);
    }
  );

  // The diagnostic is the declared slot's, identical on both halves — the
  // eager one from `validateArguments`, the lazy one from the operand the
  // canonical handler replaced with it.
  it.each([...eager, ...lazy])('%s reports incompatible-type', (op) => {
    const ce = new ComputeEngine();
    expect(
      ce.box([op, XS, 5]).errors[0]?.toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "function", "finite_integer"))'
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
    expect(ce.box([op, 'xs', P]).evaluate().operator).toBe(op);
  });

  it.each(OPS)('%s stays inert on an UNDECLARED source', (op) => {
    const ce = new ComputeEngine();
    expect(ce.box([op, 'zz', P]).evaluate().operator).toBe(op);
  });

  it.each(OPS)('%s stays inert on an unknown application', (op) => {
    const ce = new ComputeEngine();
    expect(ce.box([op, ['f', 'x'], P]).evaluate().operator).toBe(op);
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
    expect(ce.box(['Filter', ['List'], P]).evaluate().toString()).toBe('[]');
    expect(ce.box(['Any', ['List'], P]).evaluate().toString()).toBe('"False"');
    expect(ce.box(['All', ['List'], P]).evaluate().toString()).toBe('"True"');
    expect(ce.box(['Find', ['List'], P]).evaluate().toString()).toBe(
      '"Nothing"'
    );
    expect(ce.box(['IndexWhere', ['List'], P]).evaluate().toString()).toBe('0');
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
