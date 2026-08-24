import { ComputeEngine } from '../../src/compute-engine';
import { recordTypeProvenance } from '../../src/compute-engine/boxed-expression/type-provenance';
import { isValueDef } from '../../src/compute-engine/boxed-expression/utils';
import type {
  TypeProvenanceEntry,
  BoxedValueDefinition,
} from '../../src/compute-engine/global-types';

//
// Inference provenance (phase 1 of
// docs/TYPE-SYSTEM.md): every write of
// inference evidence onto a definition's type records WHAT was installed, by
// WHICH mechanism, and — for writes triggered by canonicalizing an
// expression — the expression that triggered it. The history lives on the
// definition (`_typeProvenance`), never on interned `Type` objects.
//

/** The provenance history of `symbol`'s value definition, as
 * `[kind, type, cause]` triples for compact assertions. */
function historyOf(
  ce: ComputeEngine,
  symbol: string
): [string, string, string | undefined][] {
  const def = ce.lookupDefinition(symbol);
  if (!def || !isValueDef(def)) return [];
  return (def.value._typeProvenance ?? []).map((e) => [
    e.kind,
    e.type.toString(),
    e.cause?.toString(),
  ]);
}

describe('INFERENCE PROVENANCE — auto-declared anchor', () => {
  test('boxing a free symbol records its creation, with the occurrence as cause', () => {
    const ce = new ComputeEngine();
    ce.box('v');
    expect(historyOf(ce, 'v')).toEqual([['auto-declared', 'unknown', 'v']]);
  });

  test('a user declaration records no entry (inferredType === false is the marker)', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'integer');
    expect(historyOf(ce, 'd')).toEqual([]);
  });
});

describe('INFERENCE PROVENANCE — inferred writes carry the enclosing operator as cause', () => {
  test('box route: narrowing from an arithmetic use', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.box(['Multiply', 'x', 'v']);
    expect(historyOf(ce, 'v')).toEqual([
      ['auto-declared', 'unknown', 'v'],
      ['inferred', 'number', 'x * v'],
    ]);
  });

  test('parse route: the same evidence records the same history', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.parse('x \\cdot v');
    const history = historyOf(ce, 'v');
    expect(history.map(([kind]) => kind)).toEqual([
      'auto-declared',
      'inferred',
    ]);
    expect(history[1][1]).toBe('number');
  });

  test('monotone use-narrowing appends one entry per actual change', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('g', '(integer) -> integer');
    ce.box(['Multiply', 'x', 'v']);
    ce.box(['g', 'v']);
    expect(historyOf(ce, 'v')).toEqual([
      ['auto-declared', 'unknown', 'v'],
      ['inferred', 'number', 'x * v'],
      ['inferred', 'integer', 'g(v)'],
    ]);
  });

  test('a no-op re-inference records nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.box(['Multiply', 'x', 'v']);
    ce.box(['Multiply', 'x', 'v']);
    ce.box(['Add', 'v', 1]);
    expect(historyOf(ce, 'v')).toHaveLength(2);
  });
});

describe('INFERENCE PROVENANCE — assumption writes', () => {
  test('an assumption-driven refinement records kind "assumed" with the proposition', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', 'q', 1]);
    ce.assume(ce.parse('q > 0'));
    const history = historyOf(ce, 'q');
    const assumed = history.filter(([kind]) => kind === 'assumed');
    expect(assumed).toHaveLength(1);
    // Since the §5.8 A2 change an inequality refines to the proven RANGE
    // type, and that is what the provenance row records.
    expect(assumed[0][1]).toBe('(real<0..>) & !0');
    // The cause is the (normalized) proposition the assumption installed.
    expect(assumed[0][2]).toBeDefined();
  });
});

describe('ASSIGNMENT NARROWING — a refining value narrows a use-inferred type (ruled 2026-08-13)', () => {
  test('the inferred type no longer depends on site order', () => {
    // Use first, then assign: the assignment refines `number` → `integer`,
    // landing exactly where the reverse order lands.
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.box(['Multiply', 'x', 'v']);
    expect(ce.box('v').type.toString()).toBe('number');
    ce.assign('v', 5);
    expect(ce.box('v').type.toString()).toBe('integer');
    // Control: assign first, then use — same landing type.
    const ce2 = new ComputeEngine();
    ce2.declare('x', 'number');
    ce2.assign('v', 5);
    ce2.box(['Multiply', 'x', 'v']);
    expect(ce2.box('v').type.toString()).toBe('integer');
  });

  test('widening from a wider value still works (direction rules intact)', () => {
    const ce = new ComputeEngine();
    ce.assign('v', 5);
    expect(ce.box('v').type.toString()).toBe('integer');
    ce.assign('v', 2.5);
    expect(ce.box('v').type.toString()).toBe('real');
  });

  test('a DECLARED type is never narrowed by an assignment', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'number');
    ce.assign('d', 5);
    expect(ce.box('d').type.toString()).toBe('number');
  });

  test('an unknown incumbent takes the declaration promotion, so the settled type does not depend on a prior auto-declare', () => {
    // Boxing the witness auto-declares `y_r` with type `unknown` (its uses —
    // a bare `List` sibling, a binder-body occurrence — record no type
    // evidence). The assignment must then land exactly where it lands on a
    // fresh symbol: promoted `integer`, not the value's raw
    // `finite_integer`. Observed by the Tycho team's order-matrix probe at
    // their 0.106.0 adoption: box-first orderings settled on
    // `finite_integer` while assign-first settled on `integer`.
    const J = [
      'List',
      [
        'Integrate',
        ['Function', ['Block', ['n', 'x', 'y_r']], 'x'],
        ['Limits', 'x', -10, 10],
      ],
      'y_r',
    ] as const;
    const ce = new ComputeEngine();
    ce.box(J as any);
    expect(ce.box('y_r').type.toString()).toBe('unknown');
    ce.assign('y_r', 5);
    expect(ce.box('y_r').type.toString()).toBe('integer');
    // Control: assign-first lands on the same type.
    const ce2 = new ComputeEngine();
    ce2.assign('y_r', 5);
    ce2.box(J as any);
    expect(ce2.box('y_r').type.toString()).toBe('integer');
  });

  test('an assignment-derived incumbent stays widen-only', () => {
    // No use ever informed `vasg`'s type — only assignments did. Narrowing
    // it would make the type oscillate as the assigned values alternate.
    const ce = new ComputeEngine();
    ce.assign('vasg', 2.5);
    expect(ce.box('vasg').type.toString()).toBe('real');
    ce.assign('vasg', 5);
    expect(ce.box('vasg').type.toString()).toBe('real');
  });

  test('the promoted type is never installed when it escapes a recorded use', () => {
    // `gfin(wfin)` infers `wfin: finite_real`. Assigning 5 refines it, but
    // the promotion to `integer` would leave the incumbent's `finite_real`
    // constraint, so the value's raw type — the literal type `5` — is
    // adopted instead.
    const ce = new ComputeEngine();
    ce.declare('gfin', '(finite_real) -> real');
    ce.box(['gfin', 'wfin']);
    expect(ce.box('wfin').type.toString()).toBe('finite_real');
    ce.assign('wfin', 5);
    expect(ce.box('wfin').type.toString()).toBe('5');
    expect(ce.type('finite_integer').matches('finite_real')).toBe(true);
  });

  test('the narrow records a value-derived provenance entry with the value as cause', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.box(['Multiply', 'x', 'v']);
    ce.assign('v', 5);
    const history = historyOf(ce, 'v');
    expect(history[history.length - 1]).toEqual([
      'value-derived',
      'integer',
      '5',
    ]);
  });
});

describe('INFERENCE PROVENANCE — the boxing epoch', () => {
  test('entries from different top-level boxings carry different epochs; same boxing, same epoch', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.box(['Multiply', 'x', 'v']); // creates v, infers number — one pass
    ce.box(['Add', 'v', 'w']); // creates w — a later pass
    const epochsOf = (s: string) => {
      const def = ce.lookupDefinition(s);
      if (!def || !isValueDef(def)) return [];
      return (def.value._typeProvenance ?? []).map((e) => e.epoch);
    };
    const vEpochs = epochsOf('v');
    const wEpochs = epochsOf('w');
    // Both of v's entries (creation + inference) come from the same pass…
    expect(new Set(vEpochs).size).toBe(1);
    expect(vEpochs[0]).toBeDefined();
    // …and w's pass is a different, later one: `entry.epoch` answers "was
    // this entry recorded by the pass running now?" in O(1), the query the
    // first-boxing binding-divergence fix (Tycho item 178) consults on its
    // auto-declare decision path.
    expect(new Set(wEpochs).size).toBe(1);
    expect(wEpochs[0]).toBeGreaterThan(vEpochs[0]!);
  });
});

describe('INFERENCE PROVENANCE — the history cap', () => {
  test('the oldest entry survives; the second-oldest is dropped', () => {
    const ce = new ComputeEngine();
    const target: { _typeProvenance: TypeProvenanceEntry[] | undefined } = {
      _typeProvenance: undefined,
    };
    const entry = (i: number): TypeProvenanceEntry => ({
      type: ce.type('integer'),
      kind: 'inferred',
      axis: 'type',
      cause: ce.box(i),
    });
    for (let i = 0; i < 12; i++) recordTypeProvenance(ce, target, entry(i));
    const list = target._typeProvenance!;
    expect(list).toHaveLength(8);
    // Entry 0 — the creation/first-evidence anchor — is retained…
    expect(list[0].cause?.toString()).toBe('0');
    // …and the tail is the most recent writes.
    expect(list[list.length - 1].cause?.toString()).toBe('11');
  });
});

describe('ASSIGNMENT TO A DECLARED `unknown` — the placeholder takes the value’s type', () => {
  // `unknown` is a placeholder that refines per use, not a contract (`any` is
  // the contract spelling). So `ce.declare('u', 'unknown')` withholds type
  // evidence rather than supplying it, and an assignment is the first
  // evidence there is — the assignment path treats it exactly as it treats an
  // auto-declare's `unknown`. Before this, the whole type-update block was
  // gated on `inferredType`, which an EXPLICIT `unknown` declaration does not
  // set, so the declaration suppressed inference instead of deferring it.

  test('the settled type matches the no-declaration route exactly', () => {
    const declared = new ComputeEngine();
    declared.declare('u', 'unknown');
    declared.assign('u', 5);
    const bare = new ComputeEngine();
    bare.assign('u', 5);
    // `integer`, not the value's raw `finite_integer`: the same literal
    // promotion a fresh `u := 5` declaration applies.
    expect(declared.box('u').type.toString()).toBe('integer');
    expect(declared.box('u').type.toString()).toBe(
      bare.box('u').type.toString()
    );
  });

  test('the type is MARKED inferred, so later evidence still refines it', () => {
    // The marker is what keeps the settled type a guess rather than a
    // contract: without it the next assignment would be held to `integer`.
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    ce.assign('u', 5);
    const def = ce.lookupDefinition('u')!;
    expect(isValueDef(def) && def.value.inferredType).toBe(true);
    ce.assign('u', 2.5);
    expect(ce.box('u').type.toString()).toBe('real');
  });

  test('a use no longer has to supply the type — and supplies a worse one', () => {
    // The concrete cost of the old behaviour: with the assignment inert, the
    // type came from the USE instead, and a use knows less than the value
    // does — `u + 1` yields `number` where the value proves `integer`.
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    ce.assign('u', 5);
    ce.parse('u + 1');
    expect(ce.box('u').type.toString()).toBe('integer');
    // Control: with no value to type from, the use is still what decides.
    const ce2 = new ComputeEngine();
    ce2.declare('u', 'unknown');
    ce2.parse('u + 1');
    expect(ce2.box('u').type.toString()).toBe('number');
  });

  test('the move is recorded as value-derived', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    ce.assign('u', 5);
    expect(historyOf(ce, 'u')).toEqual([['value-derived', 'integer', '5']]);
  });

  test('a CONTRACT is untouched — `any` and a concrete type both hold', () => {
    // The whole change turns on `unknown` being a placeholder. `any` is the
    // contract spelling of "anything goes" and must NOT take the value's
    // type; a concrete declared type keeps rejecting values that do not fit.
    const ce = new ComputeEngine();
    ce.declare('a_c', 'any');
    ce.assign('a_c', 5);
    expect(ce.box('a_c').type.toString()).toBe('any');
    const def = ce.lookupDefinition('a_c')!;
    expect(isValueDef(def) && def.value.inferredType).toBe(false);

    ce.declare('n_c', 'number');
    ce.assign('n_c', 5);
    expect(ce.box('n_c').type.toString()).toBe('number');

    ce.declare('i_c', 'integer');
    expect(() => ce.assign('i_c', 2.5)).toThrow();
  });

  test('a non-numeric value settles the placeholder too', () => {
    const ce = new ComputeEngine();
    ce.declare('s_u', 'unknown');
    ce.assign('s_u', ce.string('hi'));
    expect(ce.box('s_u').type.toString()).toBe('string');
  });
});

describe('INFERENCE PROVENANCE — parameter bindings', () => {
  test('a function-literal parameter records creation and body-use inference', () => {
    const ce = new ComputeEngine();
    const fn = ce.box(['Function', ['Add', 'n', 1], 'n']);
    // The parameter operand of the canonical literal is bound to the
    // body-scope definition the auto-declare created.
    const param = fn.ops![1];
    const def = param.valueDefinition as BoxedValueDefinition | undefined;
    const kinds = (def?._typeProvenance ?? []).map((e) => e.kind);
    expect(kinds[0]).toBe('auto-declared');
  });
});
