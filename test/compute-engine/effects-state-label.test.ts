import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The `state` effect label — Phase 0b of
// `docs/plans/2026-08-13-mutable-objects-implementation-plan.md`
// (spec: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Changing a field is an
// effect", and its "Changes to shipped documents" items 6-8).
//
// The label is INERT: the type system parses, serializes, and bounds it,
// and inference treats it as an ordinary label, but no evaluator emits it
// until the object phases land. These tests pin exactly that plumbing.
//

describe('`state` round-trips in the specifier slot', () => {
  const roundTrip = (s: string): string => typeToString(parseType(s));

  test('alone', () => {
    expect(roundTrip('(integer) state -> nothing')).toBe(
      '(integer) state -> nothing'
    );
  });

  test('alphabetical canonical order among labels', () => {
    // Parsing accepts any order; serialization is canonical.
    expect(roundTrip('(integer) state random -> integer')).toBe(
      '(integer) random state -> integer'
    );
    expect(roundTrip('(integer) scope state -> integer')).toBe(
      '(integer) scope state -> integer'
    );
  });

  test('exclusive with `any` and `pure`, like every label', () => {
    expect(() => parseType('(integer) any state -> integer')).toThrow();
    expect(() => parseType('(integer) pure state -> integer')).toThrow();
    expect(() => parseType('(integer) state state -> integer')).toThrow();
  });

  test('an unknown label still fails closed', () => {
    expect(() => parseType('(integer) mutate -> integer')).toThrow();
  });
});

describe('`state` is an ordinary label to inference and contracts', () => {
  test('a declared `state` contract over a pure body installs (over-declaring weakens, and is allowed)', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function touch(x: integer) state -> integer { x + 1 }'
    );
    expect(r.diagnostics).toEqual([]);
    const def = ce.lookupDefinition('touch');
    expect(def && 'operator' in def && def.operator.effectsDeclared).toBe(true);
    expect(def && 'operator' in def && def.operator.effects).toEqual(['state']);
    // The impurity axis: a state-declared definition is not pure.
    expect(def && 'operator' in def && def.operator.pure).toBe(false);
  });

  test('the declared set serializes back — the contract survives a round trip', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function touch(x: integer) state -> integer { x }');
    expect(ce.symbol('touch').type.toString()).toContain(' state -> ');
  });

  test('a caller of a state-declared function infers `state` (latent propagation)', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function touch(x: integer) state -> integer { x }');
    const r = executeEpsil(ce, 'function twice(x: integer) { touch(touch(x)) }');
    expect(r.diagnostics).toEqual([]);
    const def = ce.lookupDefinition('twice');
    expect(def && 'operator' in def && def.operator.effects).toEqual(['state']);
  });

  test('…and a `pure` contract on such a caller is rejected at install', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function touch(x: integer) state -> integer { x }');
    const r = executeEpsil(
      ce,
      'function clean(x: integer) pure -> integer { touch(x) }'
    );
    const all = [
      ...r.diagnostics.map((d: any) => d?.message ?? String(d)),
      ...(r as any).values?.map?.((v: any) => v?.toString?.() ?? '') ?? [],
      (r as any).value?.toString?.() ?? '',
    ].join('\n');
    expect(all).toContain('state');
  });
});

// The conformance target is an OBJECT type throughout: the B1 mutability gate
// (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Which types can conform") makes a
// protocol whose requirement DECLARES `state` conformable only by object types
// — declaring the effect is one of the gate's two switches, which is what keeps
// the assertion coherent: it restricts the conformer pool to exactly the types
// that can discharge it. The last test here pins the refusal for a value type.
describe('`state` participates in the 0a protocol ceilings', () => {
  const declareTouchable = (ce: ComputeEngine): void => {
    ce.declareProtocol('Touchable', {
      functions: { touch: '(self: Self) state -> string' },
    });
    ce.declareType('Cell', 'object{v: string}');
  };

  const implWith = (marker: string): unknown => [
    'Function',
    ['Typed', { str: 'body' }, { str: `(self: Self) ${marker} -> string` }],
    ['Typed', 'self', { str: 'Self' }],
  ];

  const implement = (ce: ComputeEngine, impl: unknown, target = 'Cell') =>
    ce
      .box([
        'DeclareConformance',
        { str: target },
        ['List', 'Touchable'],
        ['Dictionary', ['KeyValuePair', 'touch', impl]],
      ] as any)
      .evaluate();

  test('the dispatcher carries the declared `state` ceiling', () => {
    const ce = new ComputeEngine();
    declareTouchable(ce);
    expect(ce.symbol('touch').type.toString()).toBe(
      '(self: any) state -> unknown'
    );
  });

  test('an implementation declaring `state` is accepted at the ceiling', () => {
    const ce = new ComputeEngine();
    declareTouchable(ce);
    expect(implement(ce, implWith('state')).json).toBe('Nothing');
  });

  test('a purer implementation is accepted', () => {
    const ce = new ComputeEngine();
    declareTouchable(ce);
    expect(implement(ce, implWith('pure')).json).toBe('Nothing');
  });

  test('an implementation exceeding the ceiling is rejected, naming the exceeded label and the fix site', () => {
    const ce = new ComputeEngine();
    declareTouchable(ce);
    const r = implement(ce, implWith('random state')).toString();
    expect(r).toContain('protocol-signature-mismatch');
    expect(r).toContain('random');
    expect(r).toContain('Touchable.touch');
  });

  test('a VALUE type cannot conform at all — the B1 mutability gate', () => {
    // The declared `state` is the gate's second switch (the first is a
    // `readwrite` property): a protocol that says `state` is thereby
    // object-only, so the effect can never be promised on behalf of a type
    // that has no state to change.
    const ce = new ComputeEngine();
    declareTouchable(ce);
    const r = implement(ce, implWith('state'), 'string').toString();
    expect(r).toContain('protocol-requires-object');
    expect(r).toContain('declares the `state` effect on `touch`');
    expect(ce._protocolRegistry.Touchable.conformances).toEqual([]);
  });
});
