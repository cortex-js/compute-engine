/**
 * `Dot`'s type handler (`innerProductType`, `library/linear-algebra.ts`) types
 * the inner product as the sum of the component-wise products. It used to
 * BUILD that sum — one `Multiply(aᵢ, bᵢ)` per component plus an `Add` over them
 * — and read the resulting expression's type, which canonicalized n+1 fresh
 * applications on every read that a generation change had un-cached (~44 µs for
 * a three-component `Dot`, against ~0.05 µs for a cached read). It now runs
 * `Multiply`'s type handler over the component expressions directly and joins
 * the products with the numeric tail of `addType`, so a type read allocates no
 * expression and canonicalizes nothing.
 *
 * This file pins both halves: that a type read builds nothing and advances no
 * cache axis, and the exact tier the derivation reports for each shape of
 * operand. The type rows are exact-string pins because the tier is the
 * contract — a consumer's `real`-declared slot accepts `finite_real` and
 * rejects `number`.
 */

import { ComputeEngine } from '../../src/compute-engine';

describe('a Dot type read builds nothing', () => {
  test('no expression is constructed during a cold read', () => {
    const ce = new ComputeEngine();
    ce.declare('ar', 'real');
    const dot = ce.box(['Dot', ['Tuple', 'ar', 2], ['Tuple', 3, 4]]);
    const engine = ce as unknown as {
      function: (...args: unknown[]) => unknown;
    };
    const original = engine.function.bind(ce);
    let calls = 0;
    engine.function = (...args: unknown[]) => {
      calls += 1;
      return original(...args);
    };
    try {
      dot.type;
    } finally {
      engine.function = original;
    }
    // The derivation reads types and joins them; building even one `Multiply`
    // here would canonicalize, and canonicalization is what made a re-read cost
    // three orders of magnitude more than a cached one.
    expect(calls).toBe(0);
  });

  /** Components that are undeclared symbols are the case where a construction
   * could declare or infer during the read. */
  test('first and repeated reads leave the generation untouched', () => {
    const ce = new ComputeEngine();
    const dot = ce.box(['Dot', ['Tuple', 'uu', 'vv'], ['Tuple', 1, 2]]);

    const before = ce._anyVersion;
    dot.type;
    // ZERO, not "small": every advance retires the `_type`/`_sgn` cache of
    // every expression in the engine.
    expect(ce._anyVersion - before).toBe(0);

    const warm = ce._anyVersion;
    for (let i = 0; i < 10; i++) dot.type;
    expect(ce._anyVersion - warm).toBe(0);
  });

  test('an undeclared component symbol keeps its type', () => {
    const ce = new ComputeEngine();
    const dot = ce.box(['Dot', ['Tuple', 'uu', 'vv'], ['Tuple', 1, 2]]);
    dot.type;
    expect(ce.box('uu').type.toString()).toBe('unknown');
  });
});

describe('the inner-product type table', () => {
  // Exactly these tiers: measured before the rewrite, and unchanged by it.
  const ladderRows: [string, unknown, string][] = [
    [
      'integer tuples',
      ['Dot', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      'finite_integer',
    ],
    [
      'integer lists',
      ['Dot', ['List', 1, 2], ['List', 3, 4]],
      'finite_integer',
    ],
    [
      'mixed tuple and list',
      ['Dot', ['Tuple', 1, 2], ['List', 3, 4]],
      'finite_integer',
    ],
    [
      'real components',
      ['Dot', ['Tuple', 1.5, 2.5], ['Tuple', 3.5, 4.5]],
      'finite_real',
    ],
    [
      'imaginary component',
      ['Dot', ['Tuple', 'ImaginaryUnit', 2], ['Tuple', 3, 4]],
      'finite_complex',
    ],
    [
      'complex component',
      ['Dot', ['Tuple', ['Complex', 1, 2], 2], ['Tuple', 3, 4]],
      'finite_complex',
    ],
  ];

  for (const [name, json, expected] of ladderRows)
    test(name, () => {
      expect(new ComputeEngine().box(json as never).type.toString()).toBe(
        expected
      );
    });

  test('an infinite component', () => {
    // `non_finite_number`, not `number`: exactly one term is provably ±∞ and
    // every term is real, so the sum is provably ±∞ too. Two infinite terms
    // could cancel to NaN, and a non-real companion could give `~oo`; both of
    // those report `number` instead.
    const dot = new ComputeEngine().box([
      'Dot',
      ['Tuple', 'PositiveInfinity', 2],
      ['Tuple', 3, 4],
    ]);
    expect(dot.type.toString()).toBe('non_finite_number');
  });

  test('a NaN component', () => {
    // The top numeric type is the only one that admits NaN, so no finite tier
    // can be claimed once a term is provably NaN.
    const dot = new ComputeEngine().box([
      'Dot',
      ['Tuple', 'NaN', 2],
      ['Tuple', 3, 4],
    ]);
    expect(dot.type.toString()).toBe('number');
  });

  test('unequal lengths', () => {
    // There is no inner product to type — the mismatch is
    // `incompatible-dimensions`, reported by the evaluate handler — so the
    // derivation declines and the operator's declared result type stands.
    const dot = new ComputeEngine().box([
      'Dot',
      ['Tuple', 1, 2],
      ['Tuple', 3, 4, 5],
    ]);
    expect(dot.type.toString()).toBe('number');
  });

  test('undeclared component symbols', () => {
    // `value`, not a numeric tier: an `unknown` component may hold anything,
    // including a collection, in which case the product broadcasts instead of
    // staying scalar. The answer comes from `Dot`'s own operand gate
    // (`isNumericTuple`, or a non-matrix `vector` type), which declines before
    // any component is read; the same gate covers a boolean, a string, a
    // nested tuple and a collection-typed component.
    const dot = new ComputeEngine().box([
      'Dot',
      ['Tuple', 'uu', 'vv'],
      ['Tuple', 1, 2],
    ]);
    expect(dot.type.toString()).toBe('value');
  });

  test('non-numeric components of every other shape', () => {
    const ce = new ComputeEngine();
    ce.declare('LL', 'list<integer>');
    const shapes: unknown[] = [
      ['Dot', ['Tuple', 'True', 2], ['Tuple', 3, 4]],
      ['Dot', ['Tuple', "'a'", 2], ['Tuple', 3, 4]],
      ['Dot', ['Tuple', ['Tuple', 1, 2], 3], ['Tuple', ['Tuple', 4, 5], 6]],
      ['Dot', ['Tuple', 'LL', 2], ['Tuple', 3, 4]],
    ];
    for (const json of shapes)
      expect(ce.box(json as never).type.toString()).toBe('value');
  });

  test('a one-component inner product keeps the product tier', () => {
    // `imaginary`, not `finite_complex`: the imaginary closure of the sum rule
    // exists because two imaginary parts can cancel to 0, which is real; a
    // single term has nothing to cancel against, so the product's own tier
    // stands — the same single-argument shortcut `addType` takes.
    const ce = new ComputeEngine();
    ce.declare('w', 'imaginary');
    expect(ce.box(['Dot', ['Tuple', 'w'], ['Tuple', 2]]).type.toString()).toBe(
      'imaginary'
    );
  });

  test('exact cancellation is not a type fact', () => {
    // `finite_complex`, where the constructed form reported `finite_integer`:
    // canonicalization folded `z·1 + z·(−1)` to `0`. A derivation from the
    // component types sees two `finite_complex` products and cannot know they
    // are opposites — recognizing that would re-implement `Add`'s term
    // combining inside a type read, which is the construction this rewrite
    // removes. Strictly wider, accepted under the 2026-08-22 ruling.
    const ce = new ComputeEngine();
    ce.declare('z', 'finite_complex');
    expect(
      ce.box(['Dot', ['Tuple', 'z', 'z'], ['Tuple', 1, -1]]).type.toString()
    ).toBe('finite_complex');
  });

  test('a rational component', () => {
    // `finite_real`, where the constructed form reported `finite_rational`:
    // canonicalization folded `1/2 · 3` to the rational literal `3/2` and the
    // sum inherited its tier, while `Multiply`'s ladder reaches its real arm
    // first and never claims a rational product. Strictly wider, so every slot
    // that accepted the old answer accepts this one (user-ruled 2026-08-22).
    const dot = new ComputeEngine().box([
      'Dot',
      ['List', ['Rational', 1, 2], 2],
      ['List', 3, 4],
    ]);
    expect(dot.type.toString()).toBe('finite_real');
  });

  test('components declared `number`', () => {
    const ce = new ComputeEngine();
    ce.declare('an', 'number');
    ce.declare('bn', 'number');
    const dot = ce.box(['Dot', ['Tuple', 'an', 'bn'], ['Tuple', 'an', 'bn']]);
    expect(dot.type.toString()).toBe('finite_number');
  });

  test('components declared `real`, against a literal vector', () => {
    // `finite_real`, where the constructed form reported `real` (which admits
    // ±∞). The old answer was an artifact of canonicalization: `Multiply(a, 1)`
    // folded to `a`, so the sum inherited the symbol's declared type verbatim.
    // The derivation now applies the generic-finite-point convention the rest
    // of the engine uses — a bare `real` symbol of unknown finiteness is read
    // as a finite real, which is already what `Multiply(a, b)` reports for two
    // such symbols. Narrower than before, and ruled correct on 2026-08-22.
    const ce = new ComputeEngine();
    ce.declare('ar', 'real');
    ce.declare('br', 'real');
    const dot = ce.box(['Dot', ['Tuple', 'ar', 'br'], ['Tuple', 1, 2]]);
    expect(dot.type.toString()).toBe('finite_real');
  });

  test('components declared `integer`, against a literal vector', () => {
    // The same fold and the same ruling, one tier down: `integer` (which
    // admits ±∞) came from `Multiply(a, 1)` folding to `a`; the ladder reads
    // the symbol as a generic finite integer.
    const ce = new ComputeEngine();
    ce.declare('ai', 'integer');
    ce.declare('bi', 'integer');
    const dot = ce.box(['Dot', ['Tuple', 'ai', 'bi'], ['Tuple', 1, 2]]);
    expect(dot.type.toString()).toBe('finite_integer');
  });

  test('components declared `real` on both sides', () => {
    // Unchanged by the rewrite: with symbols on both sides there was no
    // multiplication by a literal to fold, so the constructed form already
    // reported the ladder's answer.
    const ce = new ComputeEngine();
    ce.declare('sx', 'real');
    const dot = ce.box(['Dot', ['Tuple', 'sx', 'sx'], ['Tuple', 'sx', 'sx']]);
    expect(dot.type.toString()).toBe('finite_real');
  });

  test('a declared vector symbol has no components to read', () => {
    // `rank1Components` declines (a symbol has a type but no operands), so the
    // handler falls back to the operator's declared `number` result.
    const ce = new ComputeEngine();
    ce.declare('V1', 'vector<3>');
    ce.declare('V2', 'vector<3>');
    expect(ce.box(['Dot', 'V1', 'V2']).type.toString()).toBe('number');
  });
});
