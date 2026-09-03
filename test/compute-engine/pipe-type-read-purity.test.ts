/**
 * Reading the type of a `Pipe` whose stage is a shorthand-lambda literal
 * (`xs |> _^2`) used to canonicalize that stage, and the declarations the
 * canonicalization needed advanced the engine's `any` cache axis — the axis
 * `BoxedFunction.type` keys its memo on. Every advance retires the
 * `_type`/`_sgn` memo of every expression in the engine, so a type read that
 * advances the axis invalidates the caches the enclosing walk is filling.
 *
 * `Pipe`'s `type` handler is now on the descriptor shape
 * (operand descriptors): it reads the operands' structure and types and
 * canonicalizes nothing at all, so a re-derivation now advances NO axis. That
 * is what the drift pin below records — it was 2 per read before the scratch
 * registration of `canonicalWithFreshPlaceholders`, 1 after it (the literal's
 * own parameter, declared into a scope the canonical stage kept), and 0 now
 * that no declaration happens on the type path.
 *
 * The assertions are STRUCTURAL — a generation delta, an exact derived type, a
 * bracket back at its resting state — never a wall-clock threshold.
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

  test('a re-derivation advances no axis at all', () => {
    // An unrelated declaration between reads retires the memo, so each read
    // re-derives — which is where the stage's canonicalization used to churn
    // the axis. Measured over 10 such re-reads: 20 advances when the
    // placeholder declarations still counted, 10 once they were registered as
    // scratch (the literal's own parameter alone), and 0 now that the
    // descriptor-shape handler canonicalizes nothing.
    const { ce, pipe } = pipeOverDeclaredList();
    pipe.type;

    let drift = 0;
    for (let i = 0; i < 10; i++) {
      ce.declare(`z${i}`, 'number');
      const before = ce._anyVersion;
      pipe.type;
      drift += ce._anyVersion - before;
    }
    // Exactly zero, not "at most": a non-zero drift would mean the type path
    // had started declaring something again, which is what the descriptor
    // handler shape exists to prevent.
    expect(drift).toBe(0);
  });
});

describe('the derived type is unchanged', () => {
  // Exactly these tiers: measured before the rewrite.
  test('a shorthand stage over a declared list maps element-wise', () => {
    const { pipe } = pipeOverDeclaredList();
    // `_²` cells carry the even-power non-negative range (ranged-results
    // round).
    expect(pipe.type.toString()).toBe('list<integer<0..>>');
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
    expect(withUnderscore.type.toString()).toBe('list<integer<0..>^3>');

    const withNumberedPlaceholder = ce.box([
      'Pipe',
      ['List', 1, 2, 3],
      ['Function', ['Power', '_1', 2]],
    ]);
    expect(withNumberedPlaceholder.type.toString()).toBe(
      'list<integer<0..>^3>'
    );
  });

  test('a placeholder inside a nested Map stage', () => {
    const ce = new ComputeEngine();
    const pipe = ce.box([
      'Pipe',
      ['List', 1, 2, 3],
      ['Function', ['Map', ['Function', ['Power', 'k', 2], 'k'], '_1']],
    ]);
    // The mapping body is an inner `Map` over the piped ELEMENT, which is an
    // integer rather than a collection. The pipe reports exactly what the
    // equivalent explicit `Map` reports for the same shape — that equivalence
    // is what the implicit-map typing is defined by — so this row moves
    // whenever the inner head's own answer moves.
    expect(pipe.type.toString()).toBe('vector<integer^3>');
    expect(pipe.type.toString()).toBe(
      ce
        .box([
          'Map',
          ['Function', ['Map', ['Function', ['Power', 'k', 2], 'k'], '_1'], '_1'],
          ['List', 1, 2, 3],
        ])
        .type.toString()
    );
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

  // The descriptor-shape handler declares nothing, so this exercises the
  // bracket only through the routes that still canonicalize (evaluation).
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

describe('an implicit-map pipe types every stage body as a mapped collection', () => {
  const ce = new ComputeEngine();
  ce.declare('xs', 'list<integer>');
  test('a constant body', () => {
    expect(ce.box(['Pipe', 'xs', ['Function', 0, 'x']]).type.toString()).toMatch(/^list</);
  });
  test('a tuple body equals the explicit Map', () => {
    expect(
      ce.box(['Pipe', 'xs', ['Function', ['Tuple', 'x', 'x'], 'x']]).type.toString()
    ).toBe(
      ce.box(['Map', ['Function', ['Tuple', 'x', 'x'], 'x'], 'xs']).type.toString()
    );
  });
});
