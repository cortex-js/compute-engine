/**
 * INVARIANTS OF THE TYPE-REDEFINITION RE-SETTLE SWEEP —
 * `resettleTypeConformances` in `engine-protocols.ts`.
 *
 * `protocol-type-redefinition.test.ts` pins what individual redefinitions DO.
 * This file pins what the sweep GUARANTEES, stated as the invariants written at
 * the top of the function, so a change that keeps every scenario there working
 * but breaks the guarantee in a shape nobody scripted is still caught:
 *
 *   I1 idempotence — a second sweep with nothing changed moves nothing;
 *   I2 announcement economy — `config` fires iff an edge's implementation-map
 *      identity or `pending` flag moved;
 *   I3 refusal soundness — no declared effect contract standing before the
 *      sweep is falsified by an edge the sweep re-activated;
 *   I4 inheritance consistency — a block-less edge is non-pending only when its
 *      own field backing covers the protocol or a non-pending unconditional
 *      supertype edge exists;
 *   I5 reasons — a pending edge the sweep moved says why; an unmoved edge keeps
 *      its reason; a widening reason exists only on an edge the current sweep
 *      refused;
 *   I6 instance pinning — read and write through a field-backed property give
 *      the same verdict on a stale receiver, and a layout-less receiver is
 *      exempt on both.
 *
 * Each test's comment names the code change that would break it. The final
 * block is a small deterministic STRESS: one script of protocol / type / alias
 * (re)declarations run in several orders, with I1, I2, I4 and I5 asserted after
 * every statement.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { resettleTypeConformances } from '../../src/compute-engine/engine-protocols';
import { isSubtype } from '../../src/common/type/subtype';
import type { ConformanceRecord } from '../../src/compute-engine/types-engine';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** Run an Epsil batch; diagnostics are deliberately not asserted here. */
function run(source: string, engine = ce): string {
  return String(executeEpsil(engine, source).value);
}

/** Every conformance edge of every protocol, with its record. */
function allEdges(
  engine = ce
): { protocol: string; edge: ConformanceRecord }[] {
  return Object.values(engine._protocolRegistry).flatMap((record) =>
    record.conformances.map((edge) => ({ protocol: record.name, edge }))
  );
}

/** A structural picture of the registry's settlement: per edge, the
 * implementation map's IDENTITY (compared by reference below), the pending
 * flag and the recorded reason. */
function settlement(engine = ce) {
  return allEdges(engine).map(({ protocol, edge }) => ({
    protocol,
    target: edge.targetKey,
    impl: edge.impl,
    pending: edge.pending,
    reason: edge._pendingReason,
  }));
}

/** I1 + I2 in one shot: run the sweep AGAIN on the current registry and assert
 * that no edge's implementation map (by identity), pending flag or reason
 * moved, and that no `config` event was emitted by the sweep itself.
 *
 * Breaks if: `settleFieldBacking` stops preserving map identity when nothing
 * changed; the widening refusal starts remembering state between sweeps; the
 * reason pass rewrites a reason it did not need to; or the final `netMoved`
 * guard compares anything but map identity and `pending`. */
function assertSecondSweepIsSilent(engine = ce): void {
  const before = settlement(engine);
  const events: string[] = [];
  const original = engine._noteStateEvent.bind(engine);
  const spy = jest
    .spyOn(engine, '_noteStateEvent')
    .mockImplementation((event: { kind: string }) => {
      events.push(event.kind);
      return original(event as never);
    });
  try {
    resettleTypeConformances(engine);
  } finally {
    spy.mockRestore();
  }
  const after = settlement(engine);
  expect(after.length).toBe(before.length);
  after.forEach((a, i) => {
    const b = before[i]!;
    expect(a.target).toBe(b.target);
    expect(a.impl).toBe(b.impl); // identity, not equality
    expect(a.pending).toBe(b.pending);
    expect(a.reason).toBe(b.reason);
  });
  expect(events.filter((k) => k === 'config')).toEqual([]);
}

/** I4: for every block-less edge that is NOT pending, either its own merged
 * map covers the protocol (all requirements answered by synthesized accessors)
 * or a non-pending, unconditional supertype edge of the same protocol exists.
 *
 * Breaks if: inheritance is computed before the widening refusal puts a source
 * back (an inheritor is left fulfilled by a pending source), or if
 * `refreshInheritedPending` grants inheritance from a conditional edge. */
function assertInheritanceConsistent(engine = ce): void {
  for (const record of Object.values(engine._protocolRegistry)) {
    for (const edge of record.conformances) {
      if (edge._authored !== undefined || edge.pending) continue;
      const covers = (impl: typeof edge.impl): boolean => {
        if (impl === undefined) return false;
        for (const [name, m] of Object.entries(record.members)) {
          if (m.kind === 'function') {
            if (!(name in impl)) return false;
          } else {
            if (!(`__get__${name}` in impl)) return false;
            if (m.kind === 'readwrite' && !(`__set__${name}` in impl))
              return false;
          }
        }
        return true;
      };
      if (Object.keys(record.members).length === 0) continue; // semantic
      if (covers(edge.impl)) continue;
      const source = record.conformances.find(
        (other) =>
          other !== edge &&
          !other.pending &&
          other.where === undefined &&
          isSubtype(edge.target, other.target)
      );
      expect(source).toBeDefined();
    }
  }
}

/** I5 (the half that holds statelessly): a `conformance-widens-declared-
 * contract` reason may only sit on a PENDING edge, and no non-pending edge
 * carries any reason at all.
 *
 * Breaks if: the reason pass skips an edge the refusal did not re-issue, or
 * `noteEdgePendingReason` stops clearing on a fulfilled edge. */
function assertReasonsCoherent(engine = ce): void {
  for (const { edge } of allEdges(engine)) {
    if (!edge.pending) expect(edge._pendingReason).toBeUndefined();
  }
}

/** I3, observably: the contract and the world it describes, checked AGAINST
 * EACH OTHER.
 *
 * Reading `caller`'s own effects proves nothing — for a DECLARED contract that
 * getter returns the annotation verbatim, so it answers `pure` whether or not
 * the contract still holds, and every I3 assertion resting on it would pass
 * over a falsified one. What has to be compared is the annotation against the
 * DISPATCHER's derived union, which is the side a re-activation moves: while
 * `caller` declares `pure`, `f` must not have become `random`.
 *
 * `conformanceWideningViolations` is module-local to `engine-protocols.ts`, so
 * the dispatcher's derived effects are the closest observable stand-in — and
 * they are the input that function reads. */
function assertContractHolds(
  fn: string,
  dispatcher: string,
  engine = ce
): void {
  const contract = engine.lookupDefinition(fn);
  expect(contract).toBeDefined();
  // `undefined` is the empty set — pure. The test scenarios all declare `pure`,
  // so a contract that stopped saying so means the fixture drifted.
  expect(contract!.operator?.effects ?? []).toEqual([]);
  expect(contract!.operator?.effectsDeclared).toBe(true);

  const derived = engine.lookupDefinition(dispatcher);
  expect(derived).toBeDefined();
  // …and the union the contract is written over must still fit inside it.
  expect(derived!.operator?.effects ?? []).toEqual([]);
}

//
// ── I1 / I2 ────────────────────────────────────────────────────────────────
//

describe('I1/I2 — a second sweep with nothing changed is silent', () => {
  test('after a fresh field-backed conformance', () => {
    run(`protocol P { readonly a: integer }
type T = object{a: integer} is P`);
    assertSecondSweepIsSilent();
  });

  test('after a redefinition that moved an edge', () => {
    run(`protocol P { readonly a: integer }
type T = object{b: string} is P`);
    run(`type T = object{a: integer, b: string}`);
    assertSecondSweepIsSilent();
  });

  test('after a refused re-activation (the sweep lands where it began)', () => {
    run(`type alias W = integer
protocol S { function f(self: Self) -> integer }
type T = object{n: integer} is S { function f(self: Self) -> W { Random() } }`);
    run(`type alias W = string`); // pends the edge: `f` no longer matches
    run(`function caller(t: T) pure -> integer { f(t) }`); // accepted: f is pure now
    run(`type alias W = integer`); // would re-activate → refused
    const edge = ce._protocolRegistry['S']!.conformances[0]!;
    expect(edge.pending).toBe(true);
    expect(edge._pendingReason).toContain(
      'conformance-widens-declared-contract'
    );
    assertSecondSweepIsSilent();
  });
});

//
// ── I3 ─────────────────────────────────────────────────────────────────────
//

describe('I3 — a re-activation never falsifies a standing contract', () => {
  test('two edges that EACH falsify one contract are BOTH refused, independently', () => {
    // Not a joint cause, and none is constructible: a contract breaks when the
    // union over the non-pending conformers escapes a FIXED declared ceiling,
    // and a union cannot escape a ceiling both of its parts respect. So each of
    // these introduces on its own against the all-undone baseline, and each is
    // put back on its own account.
    //
    // Breaks if the refusal decides by violation COUNT rather than by the
    // baseline-relative SET, or if it stops walking the edges one at a time.
    run(`type alias W = integer
protocol S { function f(self: Self) -> integer }
type T = object{n: integer} is S { function f(self: Self) -> W { Random() } }
type U = object{m: integer} is S { function f(self: Self) -> W { Random() } }`);
    run(`type alias W = string`);
    run(`function caller(t: T) pure -> integer { f(t) }`);
    run(`type alias W = integer`);
    const edges = ce._protocolRegistry['S']!.conformances;
    // BOTH, exactly — not "at least one", which would pass on a refusal that
    // let a falsifying edge through.
    expect(edges.filter((e) => e.pending)).toHaveLength(2);
    assertContractHolds('caller', 'f');
    for (const e of edges)
      expect(e._pendingReason).toContain(
        'conformance-widens-declared-contract'
      );
    assertSecondSweepIsSilent();
  });

  test('an innocent edge on ANOTHER protocol re-activated by the same statement is kept', () => {
    // Breaks if the refusal reverts the whole re-activated set instead of
    // keeping the edges that introduce nothing.
    run(`type alias W = integer
protocol S { function f(self: Self) -> integer }
protocol V { function h(self: Self) -> integer }
type T = object{n: integer} is S { function f(self: Self) -> W { Random() } }
type X = object{k: integer} is V { function h(self: Self) -> W { 1 } }`);
    run(`type alias W = string`);
    run(`function caller(t: T) pure -> integer { f(t) }`);
    run(`type alias W = integer`);
    expect(ce._protocolRegistry['V']!.conformances[0]!.pending).toBe(false);
    expect(ce._protocolRegistry['S']!.conformances[0]!.pending).toBe(true);
    assertContractHolds('caller', 'f');
    expect(run(`h(X(k: 1))`)).toBe('1');
  });

  test('a contract that PRE-DATES the sweep is nobody’s fault: nothing is refused for it', () => {
    // A standing violation cannot be constructed from Epsil source (every
    // registration route refuses a widening at declaration time), so this
    // pins the weaker observable half: an effectful re-activation with NO
    // contract over it goes through, and the sweep stays silent afterwards.
    run(`type alias W = integer
protocol S { function f(self: Self) -> integer }
type T = object{n: integer} is S { function f(self: Self) -> W { Random() } }`);
    run(`type alias W = string`);
    run(`type alias W = integer`);
    expect(ce._protocolRegistry['S']!.conformances[0]!.pending).toBe(false);
    assertSecondSweepIsSilent();
  });
});

//
// ── I4 ─────────────────────────────────────────────────────────────────────
//

describe('I3 — the refusal does not depend on an incidental version bump', () => {
  test('a DIRECT sweep call, with the memos warm, still refuses', () => {
    // The refusal reads declared contracts, and that derivation reads a
    // dispatcher's effect union through memos stamped on the conformance and
    // callable versions. Step 1 mutates `pending` in place; if it announces
    // nothing, step 2 measures the world as step 1 FOUND it and waves the
    // re-activation through. Going through `declareType` hides this — it churns
    // a version incidentally — so the sweep is called DIRECTLY here, with the
    // memo deliberately warmed first, which is the shape that caught it.
    executeEpsil(
      ce,
      `protocol S { readonly label: string
  function f(self: Self) -> integer }
type T = object{n: integer} is S { get label(self: Self) -> string { "L" }
  function f(self: Self) -> integer { Random() } }`
    );
    executeEpsil(ce, `type T = object{n: integer, label: string}`);
    executeEpsil(ce, `function caller(t: T) pure -> integer { f(t) }`);
    const edge = ce._protocolRegistry['S']!.conformances[0]!;
    expect(edge.pending).toBe(true);

    // Warm the dispatcher/contract memos at the CURRENT version, edge pending.
    expect(ce.lookupDefinition('f')!.operator?.effects ?? []).toEqual([]);

    // Undo the collision in the type registry only — no `declareType`, so
    // neither version moves — then sweep.
    const before = ce._conformanceVersion;
    const callableBefore = ce._callableVersion;
    ce._typeRegistry['T']!.def = {
      kind: 'object',
      elements: { n: 'integer' },
    };
    expect(ce._conformanceVersion).toBe(before);
    expect(ce._callableVersion).toBe(callableBefore);

    resettleTypeConformances(ce);

    expect(edge.pending).toBe(true);
    expect(edge._pendingReason).toContain(
      'conformance-widens-declared-contract'
    );
    assertContractHolds('caller', 'f');
  });
});

describe('I4 — inheritance is consistent after every sweep', () => {
  test('an inheritor of a REFUSED source goes pending with it', () => {
    // Breaks if inheritance is computed before the refusal (the inheritor is
    // granted from a source that is then put back).
    run(`type alias W = integer
protocol P { function f(self: Self) -> integer }
type object is P { function f(self: Self) -> W { Random() } }
type F = object{n: integer} is P`);
    run(`type alias W = string`);
    run(`function caller(t: F) pure -> integer { f(t) }`);
    run(`type alias W = integer`);
    const [objEdge, fEdge] = ce._protocolRegistry['P']!.conformances;
    expect(objEdge!.pending).toBe(true);
    expect(fEdge!.pending).toBe(true);
    expect(fEdge!._pendingReason).toContain('inherited');
    assertInheritanceConsistent();
    assertContractHolds('caller', 'f');
  });

  test('a fulfilled inheritor stays fulfilled across an unrelated redefinition', () => {
    run(`protocol P { function f(self: Self) -> integer }
type object is P { function f(self: Self) -> integer { 1 } }
type F = object{n: integer} is P
type Other = object{z: integer}`);
    run(`type Other = object{z: integer, y: integer}`);
    expect(ce._protocolRegistry['P']!.conformances[1]!.pending).toBe(false);
    assertInheritanceConsistent();
    assertSecondSweepIsSilent();
  });
});

//
// ── I5 ─────────────────────────────────────────────────────────────────────
//

describe('I5 — reasons describe THIS sweep, and only pending edges carry one', () => {
  test('a refused edge that later pends on its OWN merits drops the widening reason', () => {
    // Breaks if the reason pass only recomputes for edges whose map/flag moved.
    run(`type alias W = integer
protocol S { function f(self: Self) -> integer }
type T = object{n: integer} is S { function f(self: Self) -> W { Random() } }`);
    run(`type alias W = string`);
    run(`function caller(t: T) pure -> integer { f(t) }`);
    run(`type alias W = integer`); // refused
    expect(
      ce._protocolRegistry['S']!.conformances[0]!._pendingReason
    ).toContain('conformance-widens-declared-contract');
    run(`type alias W = string`); // pending on its own merits again
    const reason = ce._protocolRegistry['S']!.conformances[0]!._pendingReason;
    expect(reason ?? '').not.toContain('conformance-widens-declared-contract');
    assertReasonsCoherent();
  });

  test('an unmoved edge keeps its reason across an unrelated redefinition', () => {
    run(`protocol P { readonly a: integer }
type T = object{a: integer} is P`);
    run(`type T = object{b: string}`); // moved: layout reason
    const before = ce._protocolRegistry['P']!.conformances[0]!._pendingReason;
    expect(before).toContain('layout');
    run(`type Unrelated = object{z: integer}`);
    run(`type Unrelated = object{z: integer, y: integer}`);
    expect(ce._protocolRegistry['P']!.conformances[0]!._pendingReason).toBe(
      before
    );
    assertReasonsCoherent();
  });
});

//
// ── I6 ─────────────────────────────────────────────────────────────────────
//

describe('I6 — read and write agree on a stale receiver', () => {
  test('a receiver whose pinned field no longer satisfies refuses BOTH', () => {
    run(`protocol P { readwrite a: integer }
type T = object{a: number} is P
let p = T(a: 1)`);
    run(`type T = object{a: integer}`); // re-settles: field-backed now
    const read = run(`p.(P.a)`);
    const write = run(`p.(P.a) = 3`);
    expect(read).toContain('protocol-implementation-missing');
    expect(write).toContain('protocol-implementation-missing');
    expect(run(`p.a`)).toBe('1'); // the slot itself is untouched
  });
});

//
// ── STRESS: one script, several orders ─────────────────────────────────────
//

describe('stress — invariants hold after every statement, in every order', () => {
  const declarations = [
    `type alias W = integer`,
    `protocol S { function f(self: Self) -> integer }`,
    `protocol Q { readonly a: integer }`,
    `type T = object{a: integer, n: integer} is S { function f(self: Self) -> W { Random() } }`,
    `type T is Q`,
    `type F = object{a: integer} is Q`,
    `type object is S { function f(self: Self) -> integer { 1 } }`,
  ];
  const perturbations = [
    `type alias W = string`,
    `type T = object{n: integer}`,
    `type alias W = integer`,
    `type T = object{a: integer, n: integer}`,
    `type F = object{a: number}`,
    `type F = object{a: integer}`,
    `type Unrelated = object{z: integer}`,
  ];
  // Fixed seeds: three deterministic permutations of the perturbations.
  const orders = [
    [0, 1, 2, 3, 4, 5, 6],
    [6, 4, 0, 5, 1, 2, 3],
    [1, 0, 3, 2, 6, 5, 4],
  ];

  for (const [i, order] of orders.entries()) {
    test(`order #${i}: I1, I2, I4, I5 hold after each statement`, () => {
      run(declarations.join('\n'));
      assertInheritanceConsistent();
      assertReasonsCoherent();
      assertSecondSweepIsSilent();
      for (const k of order) {
        run(perturbations[k]!);
        assertInheritanceConsistent();
        assertReasonsCoherent();
        assertSecondSweepIsSilent();
      }
    });
  }
});
