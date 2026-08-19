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
  test('a cascade that changes the inferred effects records the rebuilt literal as cause', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t)\\coloneq 2a(t)').evaluate(); // frozen as product, pure
    ce.parse('a(t)\\coloneq \\operatorname{RandomInteger}(1, t)').evaluate();
    const entries = effectsEntries(ce, 'g');
    expect(entries).toHaveLength(1);
    expect(entries[0][1]).toBe('inferred');
    expect(entries[0][2]).toContain('2a(t)'); // the REBUILT literal, not an ambient cause
  });

  test('a cascade with no effects movement records nothing', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t)\\coloneq 2a(t)').evaluate();
    ce.parse('a(t)\\coloneq t^2').evaluate(); // pure → pure
    expect(effectsEntries(ce, 'g')).toEqual([]);
  });

  test('an enclosing rollback frame leaves the pre-frame history byte-identical', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t)\\coloneq 2a(t)').evaluate();
    const before = historyOf(ce, 'g');
    ce._withBoxingPassWindow(() =>
      ce._withRolledBackInference(() => {
        ce.parse(
          'a(t)\\coloneq \\operatorname{RandomInteger}(1, t)'
        ).evaluate();
        expect(effectsEntries(ce, 'g')).toHaveLength(1);
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
