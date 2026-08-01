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
 * immediately; the lazy ones defer validation entirely and the bound would be
 * inert (a landmine for the day the lazy carve-out closes).
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
 * The lazy/eager asymmetry: a `function` slot is only enforced on the operators
 * that do NOT hold their operands. This is the same carve-out that would leave
 * any bound on a lazy operator's held slot inert.
 */
describe('the `function` slot enforces only on the eager operators', () => {
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

  it.each(eager)('%s rejects a non-function operand', (op) => {
    const ce = new ComputeEngine();
    expect(ce.box([op, XS, 5]).isValid).toBe(false);
  });

  it.each(lazy)('%s holds its operand, so the slot is inert', (op) => {
    const ce = new ComputeEngine();
    expect(ce.box([op, XS, 5]).isValid).toBe(true);
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
