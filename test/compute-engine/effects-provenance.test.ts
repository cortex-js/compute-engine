import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseSource } from '../../src/cli/check';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import {
  EffectContractError,
  effectContractErrorValue,
} from '../../src/compute-engine/boxed-expression/effects-inference';
import type { TypeProvenanceEntry } from '../../src/compute-engine/global-types';

//
// Effects-axis provenance and rollback —
// `docs/EFFECTS-MODEL.md` (revision 3) acceptance.
//
// Post-construction changes to a definition's effects CONTRACT state record
// `axis: 'effects'` entries in the shared `_typeProvenance` history; the
// history now SURVIVES redefinition (transferred by `updateDef` onto the
// half it constructs); and the contract-violation error names the declaring
// site when the history recorded one.
//

function historyOf(
  ce: ComputeEngine,
  name: string
): ReadonlyArray<[string, string, string | undefined]> {
  const def = ce.lookupDefinition(name) as
    | {
        operator?: { _typeProvenance?: TypeProvenanceEntry[] };
        value?: { _typeProvenance?: TypeProvenanceEntry[] };
      }
    | undefined;
  const half = def?.operator ?? def?.value;
  return (half?._typeProvenance ?? []).map((e) => [
    e.axis,
    e.kind,
    e.cause?.toString(),
  ]);
}

function effectsEntries(ce: ComputeEngine, name: string) {
  return historyOf(ce, name).filter(([axis]) => axis === 'effects');
}

describe('EFFECTS PROVENANCE — recording the contract state', () => {
  test('an effect-bearing signature declaration records a `declared` entry', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) pure -> number');
    expect(effectsEntries(ce, 'f')).toEqual([
      ['effects', 'declared', undefined],
    ]);
    // A declared function TYPE installs a VALUE definition (the symbol is
    // typed, not yet callable-bodied); the contract bit lives there.
    const def = ce.lookupDefinition('f') as {
      operator?: { effectsDeclared: boolean };
      value?: { effectsDeclared: boolean };
    };
    expect((def.operator ?? def.value)?.effectsDeclared).toBe(true);
  });

  test('the legacy `pure: true` sugar states no contract and records nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('g', {
      signature: '(number) -> number',
      pure: true,
    });
    expect(effectsEntries(ce, 'g')).toEqual([]);
  });

  test('a plain declaration or assignment with no effects movement records nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    expect(effectsEntries(ce, 'x')).toEqual([]);
    ce.assign('h', ce.parse('n \\mapsto n + 1')); // born pure, stays pure
    expect(effectsEntries(ce, 'h')).toEqual([]);
  });
});

describe('EFFECTS PROVENANCE — history survives redefinition', () => {
  test('a compatible reassignment transfers the history and appends nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) pure -> number');
    ce.assign('f', ce.parse('n \\mapsto n + 1'));
    // Same contract, same spelling: the entry rode the replacement, no new
    // one was appended.
    expect(effectsEntries(ce, 'f')).toEqual([
      ['effects', 'declared', undefined],
    ]);
  });

  test('the contract still throws after an intermediate reassignment', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) pure -> number');
    ce.assign('f', ce.parse('n \\mapsto n + 1'));
    expect(() =>
      ce.assign('f', ce.parse('n \\mapsto \\operatorname{RandomInteger}(1, n)'))
    ).toThrow(/declared effects `pure`/);
  });

  test('the TYPE axis rides the same transfer (new behavior, pinned)', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t)\\coloneq 2t').evaluate(); // auto-declare then redefine
    // The auto-declared anchor recorded on the pre-assignment value half is
    // visible on the post-assignment operator half.
    expect(historyOf(ce, 'g')).toContainEqual(['type', 'auto-declared', 'g']);
  });
});

describe('EFFECTS PROVENANCE — the violation names its declaring site', () => {
  test('a recorded cause renders in the JS error message', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) pure -> number');
    // The declare API records the entry with no cause (nothing to point at);
    // seed one, standing in for a route that has the site expression in
    // hand — the lookup/rendering path is what this pins.
    const def = ce.lookupDefinition('f') as {
      operator?: { _typeProvenance?: TypeProvenanceEntry[] };
      value?: { _typeProvenance?: TypeProvenanceEntry[] };
    };
    const entry = (def.operator ?? def.value)!._typeProvenance!.find(
      (e) => e.axis === 'effects'
    )!;
    entry.cause = ce.expr(['f', 'n'], { form: 'raw' });
    let message = '';
    try {
      ce.assign(
        'f',
        ce.parse('n \\mapsto \\operatorname{RandomInteger}(1, n)')
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('declared at');
    expect(message).toContain('f(n)');
  });

  test('a genuinely-caused `declared` entry: assigning a literal that states its own contract', () => {
    // The one route today that records a `declared` entry WITH a real cause:
    // assigning a `Function` literal whose `Typed` marker states effects
    // (`(integer) pure -> integer`). The W1 hook sees `effectsDeclared`
    // false→true on the installed half and records the literal itself as
    // the site. (Reachability note, recorded in the design doc: the entries
    // that GATE violations — symbol-declared contracts — record no cause
    // today, because `ce.declare` has no expression in hand and the
    // declared-signature reconciliation ascribes the declaration OVER a
    // literal's own annotation. So reachable violations currently render
    // siteless; this test pins that the recording half of the chain is
    // real, and the seeded-cause test above pins the rendering half.)
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ['Typed', ['Add', 'n', 1], { str: '(integer) pure -> integer' }],
      'n',
    ]);
    ce.assign('f', literal);
    const entries = effectsEntries(ce, 'f');
    expect(entries).toHaveLength(1);
    expect(entries[0][1]).toBe('declared');
    expect(entries[0][2]).toContain('n + 1'); // the literal, a real site
  });

  test('a construction-stated contract stays siteless', () => {
    const ce = new ComputeEngine();
    const e = new EffectContractError('f', undefined, 'any');
    expect(e.message).not.toContain('declared at');
    // The Epsil error value carries no `where` operand either.
    const value = effectContractErrorValue(ce, e);
    expect(value.ops).toHaveLength(1); // just the ErrorCode
  });

  test('the Epsil error value carries the site as its where slot', () => {
    const ce = new ComputeEngine();
    const site = ce.expr(['f', 'n'], { form: 'raw' });
    const e = new EffectContractError('f', undefined, 'any', site);
    const value = effectContractErrorValue(ce, e);
    // ["Error", ErrorCode, where] — the phase-1 sited shape, string form.
    expect(value.ops).toHaveLength(2);
    expect(value.ops[1].toString()).toContain('f(n)');
  });
});

describe('EFFECTS PROVENANCE — the re-derivation cascade (W2)', () => {
  // `g(t) := 2a(t)` applies `a` before `a` has a definition: `g` is installed
  // with the effects `any` of a call to an unknown function (one entry), and
  // is re-derived when `a` gains a definition.
  test('a cascade that changes the inferred effects records the rebuilt literal as cause', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t)\\coloneq 2a(t)').evaluate();
    expect(effectsEntries(ce, 'g')).toHaveLength(1);
    ce.parse('a(t)\\coloneq t^2').evaluate(); // any → pure
    const entries = effectsEntries(ce, 'g');
    expect(entries).toHaveLength(2);
    expect(entries[1][1]).toBe('inferred');
    expect(entries[1][2]).toContain('2a(t)'); // the REBUILT literal, not an ambient cause
  });

  test('a cascade with no effects movement records nothing', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t)\\coloneq 2a(t)').evaluate();
    const entries = effectsEntries(ce, 'g');
    // A call to an unknown function already has the effects `any`, so a
    // random `a` moves nothing.
    ce.parse('a(t)\\coloneq \\operatorname{RandomInteger}(1, t)').evaluate(); // any → any
    expect(effectsEntries(ce, 'g')).toEqual(entries);
  });

  test('an enclosing rollback frame leaves the pre-frame history byte-identical', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t)\\coloneq 2a(t)').evaluate();
    const before = historyOf(ce, 'g');
    ce._withBoxingPassWindow(() =>
      ce._withRolledBackInference(() => {
        ce.parse('a(t)\\coloneq t^2').evaluate(); // any → pure
        expect(effectsEntries(ce, 'g')).toHaveLength(2);
      })
    );
    expect(historyOf(ce, 'g')).toEqual(before);
  });
});

describe('EFFECTS PROVENANCE — the typed-`let` upgrade (W3)', () => {
  test('an explicit effect specifier records the `declared` transition', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, ['q + 1', 'let q: (number) pure -> number'].join('\n'));
    const entries = effectsEntries(ce, 'q');
    expect(entries).toHaveLength(1);
    expect(entries[0][1]).toBe('declared');
  });

  test('a bare typed `let` records no effects entry', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, ['r + 1', 'let r: number'].join('\n'));
    expect(effectsEntries(ce, 'r')).toEqual([]);
  });

  test('cross-pass: CHECKING the same W3 program twice leaves no residue', () => {
    // The design's rollback-completeness argument for W3 is that the upgrade
    // only ever reaches bindings the checking pass itself created
    // (current-scope-only lookup), so the pass frame removes them wholesale.
    // Pinned as the design demands: two STATIC CHECKS (no evaluation) of the
    // same program on one engine agree, and nothing leaks between them.
    const ce = new ComputeEngine();
    const program = ['s + 1', 'let s: (number) pure -> number'].join('\n');
    // `parseSource` itself auto-declares `s` (parse-time, OUTSIDE the
    // checking frames — not part of the pass's containment contract), so
    // the pinned invariant is that the CHECKS add nothing to it: same
    // binding, same type, no effects entries, and identical diagnostics on
    // a second pass.
    const { ast } = parseSource(program, undefined, ce);
    const defAfterParse = ce.lookupDefinition('s');
    const typeAfterParse = historyOf(ce, 's');
    const first = staticDiagnostics(ce, ast!, program);
    const second = staticDiagnostics(ce, ast!, program);
    expect(second).toEqual(first);
    expect(ce.lookupDefinition('s')).toBe(defAfterParse);
    expect(historyOf(ce, 's')).toEqual(typeAfterParse);
    expect(effectsEntries(ce, 's')).toEqual([]);
  });
});

describe('EFFECTS PROVENANCE — rollback and the cap', () => {
  test('`effectsDeclared` rides the value-definition slot tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'number');
    const def = ce.lookupDefinition('v') as {
      value: {
        effectsDeclared: boolean;
        _typeSlotSnapshot(): unknown;
        _restoreTypeSlots(s: unknown): void;
      };
    };
    const snapshot = def.value._typeSlotSnapshot();
    def.value.effectsDeclared = true;
    def.value._restoreTypeSlots(snapshot);
    expect(def.value.effectsDeclared).toBe(false);
  });

  test('the 8-entry cap stays axis-blind (oldest anchored, second-oldest evicted)', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'unknown');
    const def = ce.lookupDefinition('w') as {
      value: { _typeProvenance?: TypeProvenanceEntry[] };
    };
    def.value._typeProvenance = Array.from({ length: 8 }, (_, i) => ({
      type: ce.type('integer'),
      kind: 'inferred' as const,
      axis: i === 1 ? ('effects' as const) : ('type' as const),
      cause: ce.box(i),
    }));
    // A 9th append (any axis) displaces index 1 — here the effects entry —
    // exactly as the axis-blind phase-1 policy says.
    ce.box(['Add', 'w', 1]);
    const history = def.value._typeProvenance!;
    expect(history).toHaveLength(8);
    expect(history[0].cause?.toString()).toBe('0');
    expect(history[1].axis).toBe('type');
    expect(history[1].cause?.toString()).toBe('2');
  });
});

describe('EFFECTS PROVENANCE — a redefinition does not change the previous operator definition', () => {
  // A `function` statement that replaces a lone clause installs a new
  // operator definition with the effect contract of the new literal. The
  // previous operator definition ends unchanged, whether the install
  // succeeds or is refused: another binding can still hold it (the Epsil
  // static check declares one that holds the definition of an earlier
  // program).

  function operatorOf(ce: ComputeEngine, name: string) {
    const def = ce.lookupDefinition(name) as
      | { operator?: { effectsDeclared: boolean; signature: unknown } }
      | undefined;
    if (def?.operator === undefined) throw new Error('expected an operator');
    return def.operator;
  }

  test('a static check of a redefinition leaves the earlier `pure` function as it was', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function h(x: integer) pure -> integer { x }');
    const op = operatorOf(ce, 'h');
    expect(op.effectsDeclared).toBe(true);
    expect(String(op.signature)).toBe('(x: integer) pure -> integer');

    // The static check declares, in its own scope, a binding that holds the
    // operator definition of the earlier program, then installs the
    // redefinition over it.
    const program = 'function h(x: integer) -> integer { x }';
    const { ast } = parseSource(program, undefined, ce);
    expect(staticDiagnostics(ce, ast!, program)).toEqual([]);

    expect(operatorOf(ce, 'h')).toBe(op);
    expect(op.effectsDeclared).toBe(true);
    expect(String(op.signature)).toBe('(x: integer) pure -> integer');
  });

  test('a redefinition that states no effects installs a definition with no declared effects', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function h(x: integer) pure -> integer { x }');
    const before = operatorOf(ce, 'h');

    executeEpsil(ce, 'function h(x: integer) -> integer { x }');
    const after = operatorOf(ce, 'h');
    expect(after).not.toBe(before);
    expect(after.effectsDeclared).toBe(false);
    expect(String(after.signature)).not.toContain('pure');
    // The previous definition keeps its own contract.
    expect(before.effectsDeclared).toBe(true);
  });

  test('a refused redefinition leaves the definition in force as it was', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function g(x: integer) -> integer { x }');
    const op = operatorOf(ce, 'g');
    expect(op.effectsDeclared).toBe(false);

    // The redefinition states `pure`, but its body draws a random number,
    // so the run time refuses it (`incompatible-type`, `pure effects`
    // against `random effects`) and `g` keeps its definition. The static
    // check that runs before the program shares the operator definition of
    // `g` and must not change it either.
    const r = executeEpsil(
      ce,
      'function g(x: integer) pure -> integer { Random(Range(1, x)) }'
    );
    expect(r.value.toString()).toContain('incompatible-type');
    expect(operatorOf(ce, 'g')).toBe(op);
    expect(op.effectsDeclared).toBe(false);
    expect(String(op.signature)).toBe('(x: integer) -> integer');
  });

  test('a refused redefinition leaves an earlier `pure` definition as it was', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function g(x: integer) pure -> integer { x }');
    const op = operatorOf(ce, 'g');
    const history = effectsEntries(ce, 'g');

    const r = executeEpsil(
      ce,
      'function g(x: integer) pure -> integer { Random(Range(1, x)) }'
    );
    expect(r.value.toString()).toContain('incompatible-type');
    expect(operatorOf(ce, 'g')).toBe(op);
    expect(op.effectsDeclared).toBe(true);
    expect(String(op.signature)).toBe('(x: integer) pure -> integer');
    expect(effectsEntries(ce, 'g')).toEqual(history);
  });

  test('a redefinition that adds `pure` installs a `pure` contract', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function g(x: integer) -> integer { x }');
    const before = operatorOf(ce, 'g');
    expect(effectsEntries(ce, 'g')).toEqual([]);

    const r = executeEpsil(ce, 'function g(x: integer) pure -> integer { x }');
    expect(r.value.toString()).not.toContain('Error');
    const after = operatorOf(ce, 'g');
    expect(after).not.toBe(before);
    expect(after.effectsDeclared).toBe(true);
    expect(String(after.signature)).toBe('(x: integer) pure -> integer');
    expect(before.effectsDeclared).toBe(false);
    expect(String(before.signature)).toBe('(x: integer) -> integer');
    // One entry: the contract starts with this redefinition. The previous
    // definition declared nothing.
    expect(effectsEntries(ce, 'g')).toEqual([
      ['effects', 'declared', expect.any(String)],
    ]);
  });

  test('a redefinition that removes `pure` records the end of the contract', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function g(x: integer) pure -> integer { x }');
    expect(effectsEntries(ce, 'g').map(([, kind]) => kind)).toEqual([
      'declared',
    ]);

    executeEpsil(ce, 'function g(x: integer) -> integer { x }');
    // The second entry is `declared`: the previous definition declared
    // `pure`, and the end of a contract is recorded as `declared`.
    expect(effectsEntries(ce, 'g').map(([, kind]) => kind)).toEqual([
      'declared',
      'declared',
    ]);
    expect(operatorOf(ce, 'g').effectsDeclared).toBe(false);
  });

  test.each([
    ['no effects', 'function g(x: integer) -> integer { x }'],
    ['`pure`', 'function g(x: integer) pure -> integer { x }'],
  ])(
    'a redefinition can add `random` to a function with %s',
    (_, first) => {
      const ce = new ComputeEngine();
      executeEpsil(ce, first);
      const before = operatorOf(ce, 'g');
      const beforeState = [before.effectsDeclared, String(before.signature)];

      const r = executeEpsil(
        ce,
        'function g(x: integer) random -> integer { 7 }'
      );
      expect(r.value.toString()).not.toContain('Error');
      const after = operatorOf(ce, 'g');
      expect(after).not.toBe(before);
      expect(after.effectsDeclared).toBe(true);
      expect(String(after.signature)).toBe('(x: integer) random -> integer');
      expect(executeEpsil(ce, 'g(3)').value.toString()).toBe('7');
      expect([before.effectsDeclared, String(before.signature)]).toEqual(
        beforeState
      );
    }
  );
});
