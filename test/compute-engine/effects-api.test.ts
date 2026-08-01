import { ComputeEngine } from '../../src/compute-engine';
import { effectsOf } from '../../src/compute-engine/boxed-expression/effects-of';

/**
 * # The PUBLIC effects surface — `expr.effects` and `type.effects`
 *
 * Two getters, one per channel of `docs/EFFECTS-MODEL.md`:
 *
 * - `expr.effects` — the effects of **evaluating** the expression (the runtime
 *   channel, `effectsOf`). Shape: `undefined` (pure), `'any'` (unknown), or
 *   sorted labels. The internal co-finite form `{ not: [...] }` and the
 *   stated-pure `[]` are both ERASED at this boundary — this getter reports
 *   behavior, not provenance.
 * - `type.effects` — the **latent** set on the arrow: what fires if a value of
 *   that type is invoked. Here `[]` IS meaningful (a stated purity contract).
 *
 * The load-bearing distinction between them is producing vs. invoking
 * (`docs/EFFECTS-MODEL.md`, worked example 4). `effects-of.test.ts` pins the
 * channel itself; this file pins what the public API shows of it.
 */

describe('expr.effects — the runtime channel, publicly', () => {
  const ce = new ComputeEngine();

  it('is `undefined` for a pure expression', () => {
    expect(ce.parse('1 + x^2').effects).toBe(undefined);
    expect(ce.box(['Add', 1, ['Multiply', 2, 'x']]).effects).toBe(undefined);
  });

  it('reports a draw as `["random"]`, on the box and parse routes alike', () => {
    expect(ce.box(['Random']).effects).toEqual(['random']);
    expect(ce.parse('\\mathrm{Random}()').effects).toEqual(['random']);
  });

  it('reports a scope write as `["scope"]`', () => {
    expect(ce.box(['Assign', 'q', 1]).effects).toEqual(['scope']);
  });

  it('reports several labels, alphabetically sorted', () => {
    expect(ce.box(['Block', ['Assign', 'q', 1], ['Random']]).effects).toEqual([
      'random',
      'scope',
    ]);
  });

  it('is `undefined` for everything that is not an application', () => {
    expect(ce.number(5).effects).toBe(undefined);
    expect(ce.string('hello').effects).toBe(undefined);
    expect(ce.box('x').effects).toBe(undefined);
    expect(ce.box(['Dictionary', ['Tuple', "'a'", 1]]).effects).toBe(undefined);
  });

  it('resolves a callback through its current binding', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('rf', ce2.box(['Function', ['Random'], 'x']));
    const e = ce2.box(['Map', ['List', 1, 2, 3], 'rf']);
    expect(e.effects).toEqual(['random']);
    expect(e.isPure).toBe(false);

    // Rebinding to a pure body flips the answer (the generation guard).
    ce2.assign('rf', ce2.box(['Function', ['Multiply', 'x', 2], 'x']));
    expect(ce2.box(['Map', ['List', 1, 2, 3], 'rf']).effects).toBe(undefined);
  });
});

describe('producing vs. invoking — the bare-symbol pin', () => {
  // `docs/EFFECTS-MODEL.md`, worked example 4. Evaluating a symbol bound to an
  // effectful function merely PRODUCES that function value; nothing fires. The
  // latent set lives on the arrow, and surfaces only where something INVOKES
  // it. `isPure` is deliberately NOT extended to reflect a value's latent
  // effects — `List(rf)` purity and symbol-reference caching depend on this.
  const ce = new ComputeEngine();
  ce.assign('rf', ce.box(['Function', ['Random'], 'x']));

  it('a bare symbol bound to a drawing function has no effects and is pure', () => {
    expect(ce.box('rf').effects).toBe(undefined);
    expect(ce.box('rf').isPure).toBe(true);
  });

  it('its TYPE carries the latent draw — that is where an author looks', () => {
    expect(ce.box('rf').type.effects).toEqual(['random']);
  });

  it('a container that only stores the callback stays pure', () => {
    expect(ce.box(['List', 'rf']).effects).toBe(undefined);
    expect(ce.box(['List', 'rf']).isPure).toBe(true);
  });

  it('the effect surfaces at the application that invokes it', () => {
    expect(ce.box(['Map', ['List', 1, 2], 'rf']).effects).toEqual(['random']);
    expect(ce.box(['Apply', 'rf', 1]).effects).toEqual(['random']);
  });
});

describe('the public boundary erases the internal forms', () => {
  it('a co-finite value surfaces as `"any"`', () => {
    const ce = new ComputeEngine();
    ce.declare('opaqueImpure', {
      signature: '() -> number',
      pure: false,
      evaluate: () => ce.number(7),
    });
    const e = ce.box(['WithRandomSeed', 42, ['opaqueImpure']]);

    // Internally this is ¬{random}: provably not random, unknown otherwise.
    expect(effectsOf(e)).toEqual({ not: ['random'] });
    // Publicly it is `'any'` — "carries unknown effects" is the only claim a
    // consumer can act on, and it is the conservative one.
    expect(e.effects).toBe('any');
    expect(e.isPure).toBe(false);
  });

  it('a stated-pure `[]` surfaces as `undefined` — behavior, not provenance', () => {
    const ce = new ComputeEngine();
    ce.declare('statedPure', {
      signature: '() pure -> number',
      evaluate: () => ce.number(1),
    });
    const e = ce.box(['statedPure']);

    expect(effectsOf(e)).toEqual([]);
    expect(e.effects).toBe(undefined);
    // The provenance survives on the TYPE layer, where `[]` is the contract.
    expect(ce.lookupDefinition('statedPure')!.operator!.effects).toEqual([]);
  });

  it('an unknown head is `"any"`', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['UnknownHeadXyz', 1], { canonical: false }).effects).toBe(
      'any'
    );
  });
});

describe('BoxedType.effects — the latent set on an arrow', () => {
  const ce = new ComputeEngine();

  it('a labelled signature reports its labels, sorted', () => {
    expect(ce.type('(real) random -> real').effects).toEqual(['random']);
    expect(ce.type('(real) scope random -> real').effects).toEqual([
      'random',
      'scope',
    ]);
  });

  it('a STATED-pure signature reports `[]`, a bare one `undefined`', () => {
    // Here the two spellings differ: the type layer carries the provenance
    // that `expr.effects` erases.
    expect(ce.type('(real) pure -> real').effects).toEqual([]);
    expect(ce.type('(real) -> real').effects).toBe(undefined);
  });

  it('`any` is reported as-is', () => {
    expect(ce.type('(real) any -> real').effects).toBe('any');
  });

  it('an overload set reports the UNION of its arms', () => {
    expect(
      ce.type('((real) random -> real) & ((integer) scope -> integer)').effects
    ).toEqual(['random', 'scope']);
    // One effect-bearing arm is enough: the set is not pure.
    expect(
      ce.type('((real) random -> real) & ((integer) -> integer)').effects
    ).toEqual(['random']);
  });

  it('a union reports the union, with non-signature members contributing nothing', () => {
    // The shape an extraction produces: `At(list<callback>, i)`.
    expect(ce.type('((real) random -> real) | nothing').effects).toEqual([
      'random',
    ]);
  });

  it('a non-signature type has no effects', () => {
    expect(ce.type('number').effects).toBe(undefined);
    expect(ce.type('list<integer>').effects).toBe(undefined);
    expect(ce.type('unknown').effects).toBe(undefined);
  });
});
