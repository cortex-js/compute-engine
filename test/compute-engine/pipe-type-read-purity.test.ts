/**
 * Reading the type of a `Pipe` whose stage is a shorthand-lambda literal
 * (`xs |> _^2`) canonicalizes that stage, and the placeholder declarations the
 * canonicalization needs used to advance the engine's `any` cache axis — the
 * axis `BoxedFunction.type` keys its memo on. Every advance retires the
 * `_type`/`_sgn` memo of every expression in the engine, so a type read that
 * advances the axis invalidates the caches the enclosing walk is filling.
 * `canonicalWithFreshPlaceholders` now registers its throwaway placeholder
 * scope in `ce._scratchDeclarationScopes` while it pre-declares into it, which
 * zero-masks exactly those declarations (`axisMaskOf`,
 * `engine-configuration-lifecycle.ts`).
 *
 * The assertions are STRUCTURAL — a generation delta, an exact derived type, a
 * bracket back at its resting state — never a wall-clock threshold.
 *
 * One advance per re-derivation REMAINS, and is pinned as such rather than
 * driven to zero: canonicalizing the literal declares its own parameter into
 * the literal's `block.localScope`, a scope the canonical stage captures and
 * that therefore outlives the type read. A declaration aimed at a scope that
 * outlives the computation must keep its axis advance, or stale `_type`/`_sgn`
 * answers survive engine-wide.
 */

import { ComputeEngine } from '../../src/compute-engine';

/** `Pipe(L, (_) ↦ _^2)` over a declared list, built through `ce.box` so the
 * operands arrive HELD and unbound, exactly as the lazy `Pipe` contract
 * delivers them to the type handler. */
function pipeOverDeclaredList(): {
  ce: ComputeEngine;
  pipe: ReturnType<ComputeEngine['box']>;
} {
  const ce = new ComputeEngine();
  ce.declare('L1', 'list<integer>');
  return { ce, pipe: ce.box(['Pipe', 'L1', ['Function', ['Power', '_', 2]]]) };
}

describe('a Pipe type read does not re-derive on every read', () => {
  test('repeated reads of the same pipe advance no cache axis', () => {
    const { ce, pipe } = pipeOverDeclaredList();
    pipe.type; // Warm it: the first read legitimately declares and binds.

    const before = ce._anyVersion;
    for (let i = 0; i < 10; i++) pipe.type;
    expect(ce._anyVersion - before).toBe(0);
  });

  test('a re-derivation costs at most one axis advance', () => {
    // An unrelated declaration between reads retires the memo, so each read
    // re-derives — which is where the placeholder declarations used to double
    // the churn. Measured over 10 such re-reads: 20 advances before the fix
    // (the placeholder `_` plus the literal's own parameter), 10 after (the
    // parameter alone, which must keep advancing: its scope outlives the read).
    const { ce, pipe } = pipeOverDeclaredList();
    pipe.type;

    let drift = 0;
    for (let i = 0; i < 10; i++) {
      ce.declare(`z${i}`, 'number');
      const before = ce._anyVersion;
      pipe.type;
      drift += ce._anyVersion - before;
    }
    // Exactly one advance per re-derivation, not "at most": the remaining
    // advance is the literal's own parameter declared into a scope the
    // canonical literal keeps, and the user ruled (2026-08-22) that it must
    // keep advancing. A drift of 0 here would mean an over-broad scratch
    // exemption that leaves stale `_type`/`_sgn` memos engine-wide — the
    // unsound case this pin exists to reject as much as the 2-per-read one.
    expect(drift).toBe(10);
  });
});

describe('the derived type is unchanged', () => {
  // Exactly these tiers: measured before the rewrite.
  test('a shorthand stage over a declared list maps element-wise', () => {
    const { pipe } = pipeOverDeclaredList();
    // `_²` cells carry the even-power non-negative range (ranged-results
    // round).
    expect(pipe.type.toString()).toBe('list<finite_integer<0..>>');
  });

  test('a shorthand stage over a literal list keeps the literal shape', () => {
    const ce = new ComputeEngine();
    const withUnderscore = ce.box([
      'Pipe',
      ['List', 1, 2, 3],
      ['Function', ['Power', '_', 2]],
    ]);
    // The ranged cell keeps the dimensioned shape; only the `vector<…>`
    // spelling gives way (that alias prints for plain numeric cells only).
    expect(withUnderscore.type.toString()).toBe('list<finite_integer<0..>^3>');

    const withNumberedPlaceholder = ce.box([
      'Pipe',
      ['List', 1, 2, 3],
      ['Function', ['Power', '_1', 2]],
    ]);
    expect(withNumberedPlaceholder.type.toString()).toBe(
      'list<finite_integer<0..>^3>'
    );
  });

  test('a placeholder inside a nested Map stage', () => {
    const ce = new ComputeEngine();
    const pipe = ce.box([
      'Pipe',
      ['List', 1, 2, 3],
      ['Function', ['Map', ['Function', ['Power', 'k', 2], 'k'], '_1']],
    ]);
    expect(pipe.type.toString()).toBe('list<collection<number>^3>');
  });
});

describe('the placeholder scope registration is balanced', () => {
  test('nothing stays registered after a type read', () => {
    const { ce, pipe } = pipeOverDeclaredList();
    expect(ce._scratchDeclarationScopes).toHaveLength(0);
    pipe.type;
    // A leaked registration would exempt every later declaration aimed at that
    // scope object from advancing any cache axis — a worse failure than the
    // churn this fix removes.
    expect(ce._scratchDeclarationScopes).toHaveLength(0);
  });

  test('a throw while declaring the placeholders leaves nothing registered', () => {
    const { ce, pipe } = pipeOverDeclaredList();
    const engine = ce as unknown as {
      _declareSymbolValue: (...args: unknown[]) => unknown;
    };
    const original = engine._declareSymbolValue;
    // The placeholder pre-declaration is the only work inside the bracket, so
    // making it throw is what exercises the `finally` that unwinds it.
    engine._declareSymbolValue = () => {
      throw new Error('declaration failure');
    };
    try {
      pipe.type;
    } catch {
      // Whether the throw is swallowed by the type handler or escapes to here
      // is not this test's subject; the bracket's resting state is.
    } finally {
      engine._declareSymbolValue = original;
    }
    expect(ce._scratchDeclarationScopes).toHaveLength(0);
  });
});
