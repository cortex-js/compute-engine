/**
 * CROSS-BATCH REDEFINITION OF A CONFORMING OBJECT TYPE —
 * `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Objects and protocols".
 *
 * Appendix B says layouts never migrate, and that a replacement re-runs
 * conformance checking against the fixed layout. Work package 2A implemented
 * that for a replaced PROTOCOL only. This file pins the TYPE half: re-running
 * `type T = object{…}` in a later cell — which the notebook pattern allows —
 * re-settles every conformance edge, exactly as `declareProtocolImpl` does for
 * its own.
 *
 * The two populations that a redefinition creates are the whole subject:
 *
 * - The REGISTRY is what conformance is settled against, so an accessor the
 *   engine synthesized for a stored field the new layout dropped is stripped,
 *   the edge goes pending, and the end-of-batch warning says why.
 * - An object INSTANCE pins the layout it was constructed with, so an object
 *   built before the redefinition keeps every stored field it had — `p.a` and
 *   `p.a = v` still work — while the qualified protocol read `p.(P.a)` follows
 *   the conformance, which is what moved.
 *
 * The read and write paths therefore re-check the PINNED layout rather than
 * trusting the edge. Without that check, an instance built after a retyping
 * redefinition answered a requirement declared `integer` with the string its
 * new field holds, and an instance built before an ADDED requirement answered
 * it symbolically instead of refusing.
 *
 * Both registration routes are exercised — the Epsil statement route and the
 * raw MathJSON box route (`DeclareType` / `DeclareProtocol` /
 * `DeclareConformance`) — because a re-declaration reaches `declareType` by a
 * different path on each, and only the Epsil route runs the static pre-pass
 * whose registrations must roll back.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseSource } from '../../src/cli/check';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import { protocolAccessorEffects } from '../../src/compute-engine/boxed-expression/effects-of';
import { isObject } from '../../src/compute-engine/boxed-expression/type-guards';
import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/types-expression';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** Run an Epsil program and return the final value as a string. Diagnostics
 * are NOT asserted empty here: most programs in this file leave a deliberate
 * `protocol-implementation-pending` warning behind, which is the point. */
function result(source: string, engine = ce): string {
  return String(executeEpsil(engine, source).value);
}

/** The error codes of a program's diagnostics, in order. A runtime error value
 * raised by a statement rides as `["runtime-error", message, "", code]`, so the
 * code is the LAST element there and the first otherwise. */
function diagnosticCodes(source: string, engine = ce): string[] {
  return executeEpsil(engine, source).diagnostics.map((d) => {
    const parts = Array.isArray(d.message) ? d.message : [d.message];
    return parts[0] === 'runtime-error'
      ? String(parts[parts.length - 1])
      : String(parts[0]);
  });
}

/** The full message array of the single diagnostic a program produced. */
function onlyDiagnostic(source: string, engine = ce): string[] {
  const { diagnostics } = executeEpsil(engine, source);
  expect(diagnostics).toHaveLength(1);
  const m = diagnostics[0]!.message;
  return (Array.isArray(m) ? m : [m]).map(String);
}

/** One line per conformance edge of `protocol`: the target key, whether the
 * edge is pending, and the keys of its merged implementation map. Reaches into
 * the registry deliberately — "the synthesized accessor was stripped" has no
 * public surface, and reading it through dispatch would conflate the two
 * questions this file has to keep apart. */
function edges(protocol: string, engine = ce): string[] {
  return (engine._protocolRegistry[protocol]?.conformances ?? []).map(
    (c) =>
      `${c.targetKey} pending=${c.pending} impl=[${Object.keys(c.impl ?? {})
        .sort()
        .join(',')}]`
  );
}

/** The recorded reason the one edge of `protocol` is pending. */
function pendingReason(protocol: string, engine = ce): string | undefined {
  return engine._protocolRegistry[protocol]?.conformances[0]?._pendingReason;
}

//
// ── The Epsil statement route ────────────────────────────────────────────────
//

describe('a redefinition RE-SETTLES the conformance edges of the type', () => {
  test('adding the missing field fulfils an edge that was pending', () => {
    // The edge is registered before the layout can satisfy it, so it starts
    // pending and every batch re-warns (P3). The redefinition that adds the
    // field is what clears it — before this work package nothing re-settled,
    // so the warning repeated forever and the read stayed an error.
    expect(
      diagnosticCodes(`protocol Proto { readonly a: integer }
type T = object{b: string} is Proto`)
    ).toEqual(['protocol-implementation-pending']);
    expect(edges('Proto')).toEqual(['T pending=true impl=[]']);

    expect(diagnosticCodes(`type T = object{a: integer, b: string}`)).toEqual(
      []
    );
    expect(edges('Proto')).toEqual(['T pending=false impl=[__get__a]']);
    expect(result(`let q = T(a: 3, b: "y")\nq.(Proto.a)`)).toBe('3');
  });

  test('dropping a required field strips the synthesized accessor', () => {
    expect(
      result(`protocol Proto { readwrite a: integer }
type T = object{a: integer, b: string} is Proto
let p = T(a: 1, b: "x")
p.(Proto.a)`)
    ).toBe('1');
    expect(edges('Proto')).toEqual([
      'T pending=false impl=[__get__a,__set__a]',
    ]);

    expect(diagnosticCodes(`type T = object{b: string}`)).toEqual([
      'protocol-implementation-pending',
    ]);
    // Both halves are gone: `settleFieldBacking` rebuilds the merged map from
    // the author's block (there is none) and the new layout, so nothing of the
    // old settlement survives.
    expect(edges('Proto')).toEqual(['T pending=true impl=[]']);
  });

  test('a NEW instance refuses the read and the write — it does not stay symbolic', () => {
    executeEpsil(
      ce,
      `protocol Proto { readwrite a: integer }
type T = object{a: integer, b: string} is Proto`
    );
    executeEpsil(ce, `type T = object{b: string}`);

    // Silently symbolic was the shipped defect: `q.(Proto.a)` evaluated to the
    // unevaluated application, so a notebook cell showed the call back to the
    // author instead of reporting that the conformance had lapsed.
    expect(result(`let q = T(b: "y")\nq.(Proto.a)`)).toContain(
      'protocol-implementation-missing'
    );
    expect(result(`q.(Proto.a) = 5`)).toContain(
      'protocol-implementation-missing'
    );
  });

  test('an OLD instance keeps its stored field, for reading AND writing', () => {
    // "Layouts never migrate": the object pinned `object{a: integer, b:
    // string}` at construction, and the redefinition of the registry record
    // cannot reach it. The FIELD spellings therefore keep working…
    expect(
      result(`protocol Proto { readwrite a: integer }
type T = object{a: integer, b: string} is Proto
let p = T(a: 1, b: "x")
p.a`)
    ).toBe('1');
    executeEpsil(ce, `type T = object{b: string}`);
    expect(result(`p.a`)).toBe('1');
    expect(result(`p.a = 9\np.a`)).toBe('9');
    // …while the PROTOCOL spelling follows the conformance, which is what the
    // redefinition moved. The two answers are not in conflict: `p` still has
    // the field, and `T` no longer conforms.
    expect(result(`p.(Proto.a)`)).toContain('protocol-implementation-missing');
  });

  test('RETYPING a field does not leave a differently-typed value behind a typed requirement', () => {
    // The soundness case. Before the fix the edge stayed fulfilled, so
    // `q.(Proto.a)` was statically `integer` and evaluated to `"s"`.
    executeEpsil(
      ce,
      `protocol Proto { readonly a: integer }
type T = object{a: integer} is Proto
let p = T(a: 1)`
    );
    expect(diagnosticCodes(`type T = object{a: string}`)).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(edges('Proto')).toEqual(['T pending=true impl=[]']);

    executeEpsil(ce, `let q = T(a: "s")`);
    const read = ce.box(['ProtocolProperty', "'Proto'", "'a'", 'q'] as never);
    expect(read.type.toString()).not.toBe('integer');
    expect(String(read.evaluate())).toContain(
      'protocol-implementation-missing'
    );
  });

  test('an OLD instance cannot answer a requirement added AFTER it was built', () => {
    // Here the conformance is in perfect order — the edge is fulfilled and the
    // registry layout carries `c`. What cannot answer is this one object, whose
    // pinned layout predates the field. Refused rather than answered with
    // `Nothing`, and rather than left symbolic.
    executeEpsil(
      ce,
      `protocol Proto { readwrite a: integer }
type T = object{a: integer} is Proto
let p = T(a: 1)`
    );
    executeEpsil(ce, `type T = object{a: integer, c: integer}`);
    executeEpsil(
      ce,
      `protocol Proto { readwrite a: integer
  readwrite c: integer }`
    );
    expect(edges('Proto')).toEqual([
      'T pending=false impl=[__get__a,__get__c,__set__a,__set__c]',
    ]);

    expect(result(`p.(Proto.c)`)).toContain('protocol-implementation-missing');
    expect(result(`p.(Proto.c) = 3`)).toContain(
      'protocol-implementation-missing'
    );
    // An instance built from the CURRENT declaration answers both.
    expect(result(`let q = T(a: 1, c: 2)\nq.(Proto.c)`)).toBe('2');
    expect(result(`q.(Proto.c) = 8`)).toBe('8');
  });

  test('a redefinition that adds a field beside an AUTHORED accessor is `object-property-conflict`', () => {
    // A property is field-backed or computed, never both. The conflict did not
    // exist when the block was written; the redefinition created it, so it is
    // the redefinition that has to report it.
    expect(
      result(`protocol P { readonly label: string }
type Q = object{n: integer} is P { get label(self: Self) -> string { "computed" } }
let q = Q(n: 1)
q.(P.label)`)
    ).toBe('"computed"');

    expect(
      diagnosticCodes(`type Q = object{n: integer, label: string}`)
    ).toEqual(['protocol-implementation-pending']);
    expect(pendingReason('P')).toContain('object-property-conflict');
    expect(pendingReason('P')).toContain(
      'is a stored field of `Q` and also has an explicit `get` accessor'
    );
    // The author's accessor is NOT thrown away — the block is still theirs, and
    // the edge is pending until they resolve the conflict.
    expect(edges('P')).toEqual(['Q pending=true impl=[__get__label]']);
    // Neither spelling now answers through the protocol, so the two cannot
    // disagree: before the fix `q.(P.label)` said "computed" while a body
    // reading the stored field said "stored".
    expect(result(`let r = Q(n: 1, label: "stored")\nr.(P.label)`)).toContain(
      'protocol-implementation-missing'
    );
    expect(result(`q.(P.label)`)).toContain('protocol-implementation-missing');
  });

  test('object → record re-applies the B1 mutability gate', () => {
    // The gate refuses a `readwrite` protocol on a value type at REGISTRATION.
    // A redefinition can make an already-registered edge one the gate would
    // refuse; conformance is monotone, so the edge survives — left pending,
    // with the gate's own wording as the reason.
    expect(
      result(`protocol M { readwrite v: integer }
type W = object{v: integer} is M
let w = W(v: 1)
w.(M.v)`)
    ).toBe('1');

    expect(diagnosticCodes(`type W = record{v: integer}`)).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(edges('M')).toEqual(['W pending=true impl=[]']);
    expect(pendingReason('M')).toBe(
      'the `M` protocol has settable properties. `W` is a record, and records are immutable; declare `W` as an object type to conform.'
    );
    // The object built while `W` was an object type is untouched — it is still
    // an object, and its own fields are still readable and writable.
    expect(result(`w.v`)).toBe('1');
    expect(result(`w.v = 7\nw.v`)).toBe('7');
  });

  test('the end-of-batch warning carries the reason', () => {
    executeEpsil(
      ce,
      `protocol Proto { readonly a: integer }
type T = object{a: integer} is Proto`
    );
    expect(onlyDiagnostic(`type T = object{b: string}`)).toEqual([
      'protocol-implementation-pending',
      'T',
      'Proto',
      "the layout of `T` does not satisfy `get a` — write the accessor, or give `T` a stored field of the property's own type",
    ]);
  });

  test('the ORDINARY pending edge carries no reason — the warning already says it all', () => {
    // A conformance declared in one cell and implemented in the next is the P3
    // notebook pattern, not a re-settlement. Its warning must not grow a gloss.
    expect(
      onlyDiagnostic(`protocol Named { function name(self: Self) -> string }
type string is Named`)
    ).toEqual(['protocol-implementation-pending', 'string', 'Named', '']);
  });
});

describe('a re-settlement may not falsify a declared effect contract', () => {
  test('RE-ACTIVATING an edge that would widen a dispatcher is refused, and says why', () => {
    // The union behind a bare requirement's dispatcher skips PENDING edges, so
    // an implementation that draws `random` contributes nothing while its edge
    // is pending and everything once it is fulfilled again. A function accepted
    // as `pure` in between would then be declaring something false — which is
    // exactly what the three registration routes refuse, and what this one has
    // to refuse too.
    executeEpsil(
      ce,
      `protocol S { readonly label: string
  function f(self: Self) -> integer }
type T = object{n: integer} is S { get label(self: Self) -> string { "L" }
  function f(self: Self) -> integer { Random() } }`
    );
    const dispatcher = () => ce.lookupDefinition('f')!['operator']!;
    expect(dispatcher().effects).toEqual(['random']);

    // The redefinition collides the stored field with the authored accessor,
    // so the edge goes pending and `f` becomes pure…
    executeEpsil(ce, `type T = object{n: integer, label: string}`);
    expect(dispatcher().pure).toBe(true);
    // …and a caller may now legitimately declare itself `pure`. (The batch
    // still carries the edge's own pending warning, which is not this
    // statement's verdict — what matters is that the declaration was accepted.)
    expect(
      result(`function caller(t: T) pure -> integer { f(t) }`)
    ).not.toMatch(/^Error\(/);
    expect(ce.lookupDefinition('caller')!['operator']!.pure).toBe(true);

    // Undoing the collision would re-activate the edge and make `f` effectful
    // again. The TYPE declaration stands — it is complete and correct, and the
    // sweep runs after it — but the re-activation is rolled back, so `caller`
    // keeps telling the truth.
    executeEpsil(ce, `type T = object{n: integer}`);
    expect(dispatcher().pure).toBe(true);
    expect(dispatcher().effects).toBeUndefined();
    expect(edges('S')).toEqual(['T pending=true impl=[__get__label,f]']);
    // The type itself did take effect: `label` is no longer a stored field.
    expect(String(ce.box('T').type)).not.toContain('label');
    expect(pendingReason('S')).toContain(
      'conformance-widens-declared-contract'
    );
    expect(pendingReason('S')).toContain('`caller` declares `pure`');
  });

  test('the refusal is EDGE-WISE: an unrelated de-activation in the same statement stands', () => {
    // One redefinition can move two edges in opposite directions. Rolling the
    // whole protocol registry back to refuse the re-activation would also undo
    // the DE-activation, leaving `Q` fulfilled by an accessor synthesized for a
    // field the new layout no longer declares — and no pending warning to say
    // so. Only the re-activated edge is reverted.
    executeEpsil(
      ce,
      `protocol Q { readonly a: integer }
protocol S { readonly label: string
  function f(self: Self) -> integer }
type T = object{a: integer, n: integer} is Q
type T is S { get label(self: Self) -> string { "L" }
  function f(self: Self) -> integer { Random() } }`
    );
    expect(edges('Q')).toEqual(['T pending=false impl=[__get__a]']);
    expect(edges('S')).toEqual(['T pending=false impl=[__get__label,f]']);

    // Collide `S` so it goes pending, then take a `pure` contract through it.
    executeEpsil(ce, `type T = object{a: integer, n: integer, label: string}`);
    expect(edges('S')).toEqual(['T pending=true impl=[__get__label,f]']);
    expect(
      result(`function caller(t: T) pure -> integer { f(t) }`)
    ).not.toMatch(/^Error\(/);

    // This one redefinition drops `a` (de-activating `Q`) AND drops `label`
    // (which would re-activate `S`).
    executeEpsil(ce, `type T = object{n: integer}`);
    expect(edges('Q')).toEqual(['T pending=true impl=[]']);
    expect(edges('S')).toEqual(['T pending=true impl=[__get__label,f]']);
    // Each edge says its own thing, and BOTH warnings fire.
    const codes = executeEpsil(ce, `1 + 1`).diagnostics.map((d) =>
      (Array.isArray(d.message) ? d.message : [d.message]).map(String)
    );
    expect(codes).toHaveLength(2);
    // `[code, targetKey, protocol, reason]` — both edges target `T`, so the
    // protocol at index 2 is what tells them apart.
    expect(codes.find((m) => m[2] === 'Q')![3]).toContain('the layout of `T`');
    expect(codes.find((m) => m[2] === 'S')![3]).toContain(
      'conformance-widens-declared-contract'
    );
  });

  test('an effectful re-activation with NO contract over it goes through', () => {
    // The contrast case: same shape, but no declared contract stands to be
    // falsified, so the edge re-activates normally.
    executeEpsil(
      ce,
      `protocol S { readonly label: string
  function f(self: Self) -> integer }
type T = object{n: integer} is S { get label(self: Self) -> string { "L" }
  function f(self: Self) -> integer { Random() } }`
    );
    executeEpsil(ce, `type T = object{n: integer, label: string}`);
    expect(edges('S')).toEqual(['T pending=true impl=[__get__label,f]']);

    expect(result(`type T = object{n: integer}`)).not.toMatch(/^Error\(/);
    expect(edges('S')).toEqual(['T pending=false impl=[__get__label,f]']);
    expect(ce.lookupDefinition('f')!['operator']!.effects).toEqual(['random']);
  });
});

describe('a pinned layout is SHALLOW, so the stored value is the last check', () => {
  test('re-declaring a transparent ALIAS a field is typed through is caught', () => {
    // Pinning copies the object body one level deep and SHARES the field types
    // (`detachDefinitionBody`), so a field typed `A` still holds the very same
    // alias reference the registry does — re-declaring `A` moves the pinned
    // layout with it. Both the layout comparison and its identity fast path
    // therefore pass, and without the value check the read would hand back a
    // string through a property that now promises `integer`.
    executeEpsil(
      ce,
      `type alias A = string
protocol P { readonly a: A }
type T = object{a: A} is P
let p = T(a: "s")`
    );
    expect(result(`p.(P.a)`)).toBe('"s"');

    executeEpsil(ce, `type alias A = integer`);
    // The edge is still fulfilled — the registry's layout does satisfy the
    // requirement — so nothing here is pending. It is this INSTANCE that cannot
    // answer, and the refusal names what it is holding.
    expect(edges('P')).toEqual(['T pending=false impl=[__get__a]']);
    const refused = result(`p.(P.a)`);
    expect(refused).toContain('protocol-implementation-missing');
    expect(refused).toContain('holds `string`');

    // Two controls: an instance built under the new alias reads fine, and the
    // old object keeps its own field, which is what "layouts never migrate"
    // promises.
    expect(result(`let q = T(a: 5)\nq.(P.a)`)).toBe('5');
    // PINS RULED BEHAVIOUR (2026-08-16). A re-declared alias retypes values
    // already stored through it, and the plain field read follows the alias:
    // `p.a` is declared `A` — now `integer` — and answers the string the slot
    // holds. An alias is a spelling, not a box. The PROTOCOL route is the
    // exception, because a conformance promises what a read delivers. The same
    // ruling covers `let x: A = "s"` followed by `type alias A = integer`; see
    // the shallow-pin entry of `ROADMAP.md`.
    expect(result(`p.a`)).toBe('"s"');
  });

  test('a SYMBOLIC stored value is not evidence of a redefinition', () => {
    // A stored field may legitimately hold an unevaluated expression, which
    // types `unknown`. Comparing that against the requirement would refuse a
    // perfectly ordinary object and blame a redefinition that never happened —
    // so an undecided value type passes, the same posture the requirement takes
    // when it does not parse at the receiver.
    executeEpsil(
      ce,
      `protocol P { readonly a: number }
type T = object{a: number} is P
let p = T(a: sqrt(2))`
    );
    expect(result(`p.a`)).toBe('sqrt(2)');
    expect(result(`p.(P.a)`)).toBe('sqrt(2)');
  });

  test('a WRITE is judged on the value being STORED, not the one being replaced', () => {
    // The stored-value check is a READ-path question: a read has to deliver
    // what the property promises. A write's contract question is about the
    // right-hand side, which the setter has already checked — judging the value
    // being overwritten would refuse a store that fixes the very problem.
    executeEpsil(
      ce,
      `type alias A = string
protocol P { readwrite a: A }
type T = object{a: A} is P
let p = T(a: "s")`
    );
    executeEpsil(ce, `type alias A = integer`);
    // The read is refused — the slot holds a string…
    expect(result(`p.(P.a)`)).toContain('protocol-implementation-missing');
    // …and writing an `integer` into it is exactly the fix, so it goes through.
    expect(result(`p.(P.a) = 5`)).toBe('5');
    expect(result(`p.(P.a)`)).toBe('5');
  });
});

describe('a refused re-activation is precise and sticky', () => {
  /** A protocol with an effectful function member and a property an authored
   * accessor answers, plus a conforming object type — the shape whose edge a
   * redefinition can collide (pending) and un-collide (re-activating). */
  const collidable = (protocol: string, type: string, member: string) =>
    `protocol ${protocol} { readonly label: string
  function ${member}(self: Self) -> integer }
type ${type} = object{n: integer} is ${protocol} { get label(self: Self) -> string { "L" }
  function ${member}(self: Self) -> integer { Random() } }`;

  test('only the edge that actually widens is refused', () => {
    // ONE type conforming to TWO protocols, and ONE redefinition that
    // re-activates BOTH edges — which is what it takes for the choice to
    // matter, since each `type` statement runs its own sweep. Only `S` is
    // called through by a `pure` contract. The violation walk is global and
    // attributes nothing to an edge, so refusing the whole batch would punish
    // `W` for `S`'s widening.
    executeEpsil(
      ce,
      `protocol S { readonly label: string
  function f(self: Self) -> integer }
protocol W { readonly tag: string
  function g(self: Self) -> integer }
type T = object{n: integer} is S { get label(self: Self) -> string { "L" }
  function f(self: Self) -> integer { Random() } }
type T is W { get tag(self: Self) -> string { "G" }
  function g(self: Self) -> integer { 1 } }`
    );
    executeEpsil(ce, `type T = object{n: integer, label: string, tag: string}`);
    expect(edges('S')).toEqual(['T pending=true impl=[__get__label,f]']);
    expect(edges('W')).toEqual(['T pending=true impl=[__get__tag,g]']);
    expect(
      result(`function caller(t: T) pure -> integer { f(t) }`)
    ).not.toMatch(/^Error\(/);

    executeEpsil(ce, `type T = object{n: integer}`);
    expect(edges('S')).toEqual(['T pending=true impl=[__get__label,f]']);
    expect(pendingReason('S')).toContain(
      'conformance-widens-declared-contract'
    );
    // `W` has no contract standing over it, so its re-activation went through.
    expect(edges('W')).toEqual(['T pending=false impl=[__get__tag,g]']);
    expect(pendingReason('W')).toBeUndefined();
  });

  test('two edges that EACH falsify the same contract are refused independently', () => {
    // Both are measured against the baseline with every re-activation undone,
    // so each is seen to falsify `caller` on its own and each is put back on
    // its own account. There is no joint cause to find here — and none is
    // constructible: a contract breaks when the union over the non-pending
    // conformers escapes a FIXED ceiling, and a union cannot escape a ceiling
    // that both of its parts respect.
    executeEpsil(
      ce,
      `type alias W = integer
protocol S { function f(self: Self) -> integer }
type T = object{n: integer} is S { function f(self: Self) -> W { Random() } }
type U = object{m: integer} is S { function f(self: Self) -> W { Random() } }`
    );
    // Re-declaring the alias both blocks declare their result through pends
    // both edges at once.
    executeEpsil(ce, `type alias W = string`);
    expect(edges('S')).toEqual([
      'T pending=true impl=[f]',
      'U pending=true impl=[f]',
    ]);
    expect(
      result(`function caller(t: T) pure -> integer { f(t) }`)
    ).not.toMatch(/^Error\(/);

    // …and putting it back would re-activate both.
    executeEpsil(ce, `type alias W = integer`);
    expect(edges('S')).toEqual([
      'T pending=true impl=[f]',
      'U pending=true impl=[f]',
    ]);
    expect(ce.lookupDefinition('f')!['operator']!.effects).toBeUndefined();
    expect(ce.lookupDefinition('caller')!['operator']!.pure).toBe(true);
    // BOTH — exactly two — are refused, and each is told what it exceeded on
    // its own rather than blamed for the pair.
    const record = ce._protocolRegistry['S']!;
    const refused = record.conformances.filter((c) =>
      c._pendingReason?.startsWith('conformance-widens-declared-contract:')
    );
    expect(refused).toHaveLength(2);
    for (const edge of refused)
      expect(edge._pendingReason).toContain('`caller` declares `pure`');
  });

  test('an innocent edge re-activated by the same declaration is kept', () => {
    // Two culprits on `S`, plus one on `V` with no contract over it — all three
    // re-activated by the same alias re-declaration. The edges are handed back
    // one at a time from the all-undone baseline, so `V` introduces nothing and
    // stays, while the two that do are put back. Nothing is refused for a
    // neighbour's sake.
    executeEpsil(
      ce,
      `type alias W = integer
protocol S { function f(self: Self) -> integer }
protocol V { function v(self: Self) -> integer }
type T = object{n: integer} is S { function f(self: Self) -> W { Random() } }
type U = object{m: integer} is S { function f(self: Self) -> W { Random() } }
type X = object{k: integer} is V { function v(self: Self) -> W { 1 } }`
    );
    executeEpsil(ce, `type alias W = string`);
    expect(edges('S')).toEqual([
      'T pending=true impl=[f]',
      'U pending=true impl=[f]',
    ]);
    expect(edges('V')).toEqual(['X pending=true impl=[v]']);
    expect(
      result(`function caller(t: T) pure -> integer { f(t) }`)
    ).not.toMatch(/^Error\(/);

    executeEpsil(ce, `type alias W = integer`);
    // The two joint culprits are refused…
    expect(edges('S')).toEqual([
      'T pending=true impl=[f]',
      'U pending=true impl=[f]',
    ]);
    // …and the innocent one is not.
    expect(edges('V')).toEqual(['X pending=false impl=[v]']);
    expect(pendingReason('V')).toBeUndefined();
  });

  test('a PURE re-activation is never a widening', () => {
    // The plain case, and the one the baseline exists to protect: a
    // re-activation with no contract standing over it goes through untouched.
    //
    // The baseline it is measured against — the violations that stand with
    // every re-activation undone — is DEFENSIVE. Reaching it needs an engine
    // already carrying a falsified contract when the sweep begins, and every
    // route that could install one refuses at declaration time (the three
    // conformance-registration routes, and `declareProtocolImpl`), so no test
    // here constructs that state. The comparison is kept because it costs one
    // walk and is the difference between blaming the right edge and blaming
    // whichever edge the loop reached first.
    executeEpsil(
      ce,
      `protocol S { readonly label: string
  function f(self: Self) -> integer }
type T = object{n: integer} is S { get label(self: Self) -> string { "L" }
  function f(self: Self) -> integer { 1 } }`
    );
    executeEpsil(ce, `type T = object{n: integer, label: string}`);
    expect(edges('S')).toEqual(['T pending=true impl=[__get__label,f]']);

    // Nothing here widens: `f` is pure. The re-activation goes through.
    executeEpsil(ce, `type T = object{n: integer}`);
    expect(edges('S')).toEqual(['T pending=false impl=[__get__label,f]']);
    expect(pendingReason('S')).toBeUndefined();
  });

  test('an INHERITOR of a refused edge loses its implementation too, and says so', () => {
    // The refusal reverts a source edge that `refreshInheritedPending` had
    // already handed to a block-less subtype earlier in the same sweep. Left
    // alone, the subtype keeps `pending=false` with an empty map: every call
    // through it a missing implementation, and no warning to say so.
    executeEpsil(
      ce,
      `type alias W = integer
protocol S { function f(self: Self) -> integer }
type object is S { function f(self: Self) -> W { Random() } }
type Sub = object{n: integer} is S`
    );
    expect(edges('S')).toEqual([
      'object pending=false impl=[f]',
      'Sub pending=false impl=[]',
    ]);

    executeEpsil(ce, `type alias W = string`);
    expect(
      result(`function caller(s: Sub) pure -> integer { f(s) }`)
    ).not.toMatch(/^Error\(/);

    // Re-activating the source is refused; the inheritor must go back with it.
    const { diagnostics } = executeEpsil(ce, `type alias W = integer`);
    expect(edges('S')).toEqual([
      'object pending=true impl=[f]',
      'Sub pending=true impl=[]',
    ]);
    // BOTH warnings fire, and the inheritor names the source it lost.
    const messages = diagnostics.map((d) =>
      (Array.isArray(d.message) ? d.message : [d.message]).map(String)
    );
    expect(messages).toHaveLength(2);
    expect(messages.find((m) => m[1] === 'object')![3]).toContain(
      'conformance-widens-declared-contract'
    );
    expect(messages.find((m) => m[1] === 'Sub')![3]).toContain(
      'the implementation inherited from `object` no longer applies'
    );
  });

  test('a READONLY property whose field is NARROWER is not over-refused', () => {
    // The fast path uses the pinned field type as a pre-filter only. Under
    // `readonly` the field may be strictly narrower than the property, so a
    // value the field no longer admits can still be one the PROPERTY admits —
    // and the verdict has to come from the property.
    executeEpsil(
      ce,
      `type alias A = number
protocol P { readonly a: number }
type T = object{a: A} is P
let p = T(a: 1.5)`
    );
    expect(result(`p.(P.a)`)).toBe('1.5');

    // `A` narrows to `integer`; `1.5` is no longer an `A`, but the property
    // still says `number`, which admits it.
    executeEpsil(ce, `type alias A = integer`);
    expect(result(`p.(P.a)`)).toBe('1.5');
  });

  test('the refusal is RE-DERIVED, and announces nothing when it lands where it began', () => {
    /** `config` events emitted on `engine` while `body` runs. */
    const configEvents = (engine: ComputeEngine, body: () => void): number => {
      const target = engine as unknown as {
        _noteStateEvent: (e: { kind: string }) => void;
      };
      const original = target._noteStateEvent.bind(target);
      let n = 0;
      target._noteStateEvent = (e) => {
        if (e.kind === 'config') n += 1;
        original(e);
      };
      try {
        body();
      } finally {
        target._noteStateEvent = original;
      }
      return n;
    };
    /** The same program, with `f` effectful (so the re-activation is refused)
     * or pure (so there is nothing to refuse). The two engines differ in
     * exactly one thing, which is what makes the comparison scope to the
     * sweep — a redefinition emits `config` for the TYPE half either way. */
    const engineWith = (body: string): ComputeEngine => {
      const engine = new ComputeEngine();
      executeEpsil(
        engine,
        `protocol S { readonly label: string
  function f(self: Self) -> integer }
type T = object{n: integer} is S { get label(self: Self) -> string { "L" }
  function f(self: Self) -> integer { ${body} } }`
      );
      executeEpsil(engine, `type T = object{n: integer, label: string}`);
      executeEpsil(engine, `function caller(t: T) pure -> integer { f(t) }`);
      executeEpsil(engine, `type T = object{n: integer}`);
      executeEpsil(engine, `type Unrelated = object{z: integer}`);
      return engine;
    };

    const refusing = engineWith('Random()');
    const control = engineWith('1');
    // The refused edge is the only difference…
    expect(
      refusing._protocolRegistry['S']!.conformances[0]!._pendingReason
    ).toContain('conformance-widens-declared-contract');
    expect(
      control._protocolRegistry['S']!.conformances[0]!._pendingReason
    ).toBeUndefined();

    // …and re-running an unrelated redefinition costs the refusing engine no
    // more `config` events than the control: the sweep re-derives the refusal,
    // lands where it began, and announces nothing.
    const redeclare = (engine: ComputeEngine) => () => {
      executeEpsil(engine, `type Unrelated = object{z: string}`);
    };
    expect(configEvents(refusing, redeclare(refusing))).toBe(
      configEvents(control, redeclare(control))
    );

    // …and the edge is still refused, with its reason re-issued.
    expect(edges('S', refusing)).toEqual([
      'T pending=true impl=[__get__label,f]',
    ]);
    expect(
      refusing._protocolRegistry['S']!.conformances[0]!._pendingReason
    ).toContain('conformance-widens-declared-contract');
  });

  test('a refused edge that later goes pending on its OWN merits drops the stale reason', () => {
    // The refusal describes a fulfilment that was on offer. Once the edge is
    // uncovered for a reason of its own, that description is stale — and the
    // edge is not in `moved` (neither its map nor its flag changed), so the
    // recompute is triggered by the reason itself: a widening reason this sweep
    // did not re-issue is stale by construction.
    executeEpsil(ce, collidable('S', 'T', 'f'));
    executeEpsil(ce, `type T = object{n: integer, label: string}`);
    executeEpsil(ce, `function caller(t: T) pure -> integer { f(t) }`);
    executeEpsil(ce, `type T = object{n: integer}`);
    expect(pendingReason('S')).toContain(
      'conformance-widens-declared-contract'
    );

    // Re-adding the field collides the authored accessor again: pending for its
    // own reason now, and the refusal — which is only true while a sweep is
    // issuing it — no longer describes anything.
    executeEpsil(ce, `type T = object{n: integer, label: string}`);
    expect(pendingReason('S')).toContain('object-property-conflict');
    expect(pendingReason('S')).not.toContain(
      'conformance-widens-declared-contract'
    );
  });

  test("a REPLACED protocol retires the refusal — the requirements are the author's edit", () => {
    executeEpsil(ce, collidable('S', 'T', 'f'));
    executeEpsil(ce, `type T = object{n: integer, label: string}`);
    executeEpsil(ce, `function caller(t: T) pure -> integer { f(t) }`);
    executeEpsil(ce, `type T = object{n: integer}`);
    expect(pendingReason('S')).toContain(
      'conformance-widens-declared-contract'
    );

    // A replacement that adds a member the block does not implement leaves the
    // edge pending for coverage — so nothing widens and it is accepted — and
    // the stamp goes with the requirement set it described.
    expect(
      result(`protocol S { readonly label: string
  function f(self: Self) -> integer
  function h(self: Self) -> integer }`)
    ).not.toMatch(/^Error\(/);
    expect(pendingReason('S')).toContain('protocol-implementation-missing');
  });

  test('installing a block clears the refusal — the author has answered it', () => {
    executeEpsil(ce, collidable('S', 'T', 'f'));
    executeEpsil(ce, `type T = object{n: integer, label: string}`);
    executeEpsil(ce, `function caller(t: T) pure -> integer { f(t) }`);
    executeEpsil(ce, `type T = object{n: integer}`);
    expect(edges('S')).toEqual(['T pending=true impl=[__get__label,f]']);

    // A pure implementation of `f` is no longer a widening, so the edge is free
    // to be fulfilled again.
    executeEpsil(
      ce,
      `type T is S { get label(self: Self) -> string { "L" }
  function f(self: Self) -> integer { 1 } }`
    );
    expect(edges('S')).toEqual(['T pending=false impl=[__get__label,f]']);
    expect(pendingReason('S')).toBeUndefined();
  });
});

describe('the pending REASON is only given where it is true', () => {
  test('a FRESH conformance on an object target carries no reason', () => {
    // The P3 notebook pattern: declared in one cell, implemented in the next.
    // Nothing has moved under the author, so the warning's own wording ("has no
    // implementation yet; provide one with …") is the whole story — and the
    // layout gloss would be actively wrong advice.
    expect(
      onlyDiagnostic(`protocol P { function g(self: Self) -> integer }
type T = object{n: integer} is P`)
    ).toEqual(['protocol-implementation-pending', 'T', 'P', '']);
  });

  test('a FUNCTION member is never described as a layout problem', () => {
    // The edge below genuinely MOVES across the redefinition — its map gains
    // `__get__a` — so the reason is recomputed for it, and the only requirement
    // still uncovered is the FUNCTION member. A stored field can never satisfy
    // one, so pointing at the layout would send the author after a field that
    // could not possibly help.
    executeEpsil(
      ce,
      `protocol P { readonly a: integer
  function g(self: Self) -> integer }
type T = object{n: integer} is P`
    );
    expect(edges('P')).toEqual(['T pending=true impl=[]']);

    expect(onlyDiagnostic(`type T = object{a: integer, n: integer}`)).toEqual([
      'protocol-implementation-pending',
      'T',
      'P',
      '',
    ]);
    // …and it did move: the property is field-backed now.
    expect(edges('P')).toEqual(['T pending=true impl=[__get__a]']);
  });

  test('a FRESH conformance whose PROPERTY the layout does not answer carries no reason either', () => {
    // The non-vacuous pin for the `resettled` flag. Everything here would draw
    // the layout gloss on shape alone — an object target, a property
    // requirement, an uncovered one — and the only thing that withholds it is
    // that nothing has been RE-settled: the author declared the conformance a
    // moment ago and has not written the block yet.
    expect(
      onlyDiagnostic(`protocol P { readonly a: integer }
type T = object{n: integer} is P`)
    ).toEqual(['protocol-implementation-pending', 'T', 'P', '']);
  });

  test('…and an UNRELATED type being redefined does not gloss it', () => {
    // The sweep walks every protocol in the registry, not just the redefined
    // type's, so a fresh pending edge on an object type must survive somebody
    // else's redefinition unglossed — and that redefinition must not be
    // reported as having changed anything about this edge.
    executeEpsil(
      ce,
      `protocol P { readonly a: integer }
type T = object{n: integer} is P
type Other = object{z: integer}`
    );
    const before = ce._conformanceVersion;
    executeEpsil(ce, `type Other = object{z: string}`);
    expect(onlyDiagnostic(`1 + 1`)).toEqual([
      'protocol-implementation-pending',
      'T',
      'P',
      '',
    ]);
    // A diagnostic-only delta must not cold the memos either — and there was
    // not even one here.
    expect(ce._conformanceVersion).toBe(before);
  });

  test('an edge that LOST an inherited implementation says so, and names the source', () => {
    // A block-less edge is pending here for neither of the usual two reasons:
    // its own fields answer nothing it needs, and no author ever owed it a
    // block. It had an implementation — borrowed from the supertype edge — and
    // the redefinition invalidated THAT. "No implementation yet" would be wrong
    // twice: there was one, and the thing to fix is not on this edge.
    executeEpsil(
      ce,
      `type alias W = integer
protocol P { function f(self: Self) -> integer }
type object is P { function f(self: Self) -> W { 1 } }
type F = object{n: integer} is P`
    );
    expect(edges('P')).toEqual([
      'object pending=false impl=[f]',
      'F pending=false impl=[]',
    ]);

    // Re-declaring the alias the supertype's block declares its result through
    // makes that block stop matching the requirement.
    executeEpsil(ce, `type alias W = string`);
    const record = ce._protocolRegistry['P']!;
    const source = record.conformances[0]!;
    const inheritor = record.conformances[1]!;
    expect(source.pending).toBe(true);
    expect(source._pendingReason).toContain('protocol-signature-mismatch');
    expect(inheritor.pending).toBe(true);
    expect(inheritor._pendingReason).toContain(
      'the implementation inherited from `object` no longer applies'
    );
    // …and it quotes the source's own reason, so the author reads the whole
    // story from the edge that is actually broken.
    expect(inheritor._pendingReason).toContain('protocol-signature-mismatch');
  });

  test('a re-settled PROPERTY gap does carry the layout reason', () => {
    // The case the reason exists for, kept beside the two above so the boundary
    // is visible: same protocol, same target, but the requirement that went
    // uncovered is a property and the layout is what dropped it.
    executeEpsil(
      ce,
      `protocol P { readonly a: integer }
type T = object{a: integer} is P`
    );
    expect(onlyDiagnostic(`type T = object{b: string}`)[3]).toContain(
      'the layout of `T` does not satisfy `get a`'
    );
  });
});

describe('a stale receiver gets the SAME verdict reading and writing', () => {
  test('a pinned field that no longer satisfies the requirement refuses both', () => {
    // The edge is fulfilled — the REGISTRY's layout satisfies the requirement —
    // so nothing is pending. What cannot answer is this one instance, whose
    // pinned `a` is `number` where the property demands exactly `integer`.
    // Refusing the read and accepting the write would let the object drift
    // further from the type it claims to be.
    executeEpsil(
      ce,
      `protocol P { readwrite a: integer }
type T = object{a: number} is P
let p = T(a: 1)`
    );
    executeEpsil(ce, `type T = object{a: integer}`);
    expect(edges('P')).toEqual(['T pending=false impl=[__get__a,__set__a]']);

    const read = result(`p.(P.a)`);
    const write = result(`p.(P.a) = 3`);
    expect(read).toContain('protocol-implementation-missing');
    expect(write).toBe(read);
    // The refused write stored nothing.
    expect(result(`p.a`)).toBe('1');
  });

  test('a refused WRITE costs the right-hand side nothing', () => {
    // The pinned-layout verdict depends only on the receiver and the
    // requirement, so it belongs with the other value-independent refusals —
    // ahead of the right-hand side. `Assign` promises that a write it refuses
    // never fires the RHS, and a stale receiver must not be the exception.
    executeEpsil(
      ce,
      `type Ctr = object{n: integer}
let c = Ctr(n: 0)
function bump() -> integer { c.n = c.n + 1
  7 }
protocol P { readwrite a: integer }
type T = object{a: number} is P
let p = T(a: 1)`
    );
    executeEpsil(ce, `type T = object{a: integer}`);

    expect(result(`p.(P.a) = bump()`)).toContain(
      'protocol-implementation-missing'
    );
    expect(result(`c.n`)).toBe('0');
    expect(result(`p.a`)).toBe('1');

    // Positive control: a receiver built from the current declaration fires the
    // right-hand side exactly once and stores it.
    expect(result(`let q = T(a: 5)\nq.(P.a) = bump()`)).toBe('7');
    expect(result(`c.n`)).toBe('1');
    expect(result(`q.a`)).toBe('7');
  });

  test('two differently-pinned stale instances each get their OWN verdict', () => {
    // The requirement is re-parsed with `Self` bound to the RECEIVER and the
    // result memoized, so the memo key has to identify the receiver's layout
    // and not merely its name — two instances of `T` pinned before and after a
    // redeclaration are both spelled `T`.
    //
    // Today this is a GUARD rather than a regression pin, and the reason is
    // worth recording: two pinned references to one nominal name are mutually
    // subtypes (`isSubtype` compares nominal references by name, not by body),
    // so substituting `Self` is layout-insensitive and a name-only key happens
    // to give the same answer. What is pinned here is the contract — each stale
    // instance is judged on its own layout — which is what would break first if
    // nominal subtyping ever started comparing bodies.
    executeEpsil(
      ce,
      `protocol Linked { readonly peer: list<Self> }
type T = object{peer: list<T>, x: integer} is Linked
let a = T(peer: [], x: 1)`
    );
    executeEpsil(ce, `type T = object{peer: list<T>, y: integer}`);
    executeEpsil(ce, `let b = T(peer: [], y: 2)`);
    // A third declaration puts BOTH instances on the slow path: neither one's
    // pinned `peer` is the type object the registry now holds.
    executeEpsil(ce, `type T = object{peer: list<T>, z: integer}`);
    expect(result(`a.(Linked.peer)`)).toBe('[]');
    expect(result(`b.(Linked.peer)`)).toBe('[]');
  });

  test('a receiver with no introspectable layout is not told to rebuild it', () => {
    // The `expected === undefined` refusal in the synthesized setter means "the
    // layout names its fields and this is not one of them". A receiver typed
    // bare `object` names no fields at all, so the same absence says nothing,
    // and a message pointing at "the current declaration of `object`" would
    // name a declaration that does not exist.
    //
    // This pins a BACKSTOP: no ordinary route reaches it. `pinnedLayoutRefusal`
    // now exempts a layout-less receiver first, and in any case resolution
    // finds no candidate for a receiver whose type the registry does not know,
    // so every real read and write declines before the handler is invoked. The
    // handler is driven directly here because that is the only way in — and it
    // has to hold on its own, since a host may call it.
    executeEpsil(
      ce,
      `protocol Named { readwrite name: string }
type Box = object{name: string} is Named
let b = Box(name: "a")`
    );
    const setter = ce._protocolRegistry['Named']!.conformances[0]!.impl![
      '__set__name'
    ] as { host: (...args: Expression[]) => unknown };
    // An object of a type the registry does not know carries an unresolved
    // nominal reference, so it has no layout to consult at all. Built directly:
    // every ordinary route resolves a declared type first, which is exactly why
    // this arm needs its own probe.
    const ghost = ce._object('Ghost', [['name', ce.string('a')]]);
    expect(isObject(ghost) && ghost._fieldType('name')).toBeUndefined();

    const stored = String(setter.host(ghost, ce.string('z')));
    expect(stored).not.toContain('protocol-implementation-missing');
    expect(stored).not.toContain('declaration of `Ghost`');
    expect(isObject(ghost) && String(ghost._field('name'))).toBe('"z"');

    // The GETTER mirrors it: the same absence, the same reading of it, so a
    // layout-less receiver reads its slot rather than declining.
    const getter = ce._protocolRegistry['Named']!.conformances[0]!.impl![
      '__get__name'
    ] as { host: (...args: Expression[]) => unknown };
    expect(String(getter.host(ghost))).toBe('"z"');

    // The contrast, and the arm the guard actually exists for: a receiver whose
    // layout DOES name its fields and lacks the one being written. `b` was
    // built before `Box` gained `nickname`, so its own layout has no such slot
    // and the setter refuses rather than minting one.
    executeEpsil(ce, `type Box = object{name: string, nickname: string}`);
    executeEpsil(
      ce,
      `protocol Named { readwrite name: string
  readwrite nickname: string }`
    );
    const nicknameSetter = ce._protocolRegistry['Named']!.conformances[0]!
      .impl!['__set__nickname'] as {
      host: (...args: Expression[]) => unknown;
    };
    const refused = String(
      nicknameSetter.host(ce.box('b').evaluate(), ce.string('q'))
    );
    expect(refused).toContain('protocol-implementation-missing');
    expect(refused).toContain('Rebuild it from the current declaration of');
  });

  test('an ADDED requirement refuses the READ and the WRITE on an instance that predates it', () => {
    // The conformance is in force — the registry's layout carries `c` — so both
    // qualified spellings resolve and both refuse. This is the one case the
    // CHANGELOG says the UNQUALIFIED spelling reports too, so it is asserted
    // here rather than left to the prose.
    executeEpsil(
      ce,
      `protocol P { readwrite a: integer }
type T = object{a: integer} is P
let p = T(a: 1)`
    );
    executeEpsil(ce, `type T = object{a: integer, c: integer}`);
    executeEpsil(
      ce,
      `protocol P { readwrite a: integer
  readwrite c: integer }`
    );
    expect(edges('P')).toEqual([
      'T pending=false impl=[__get__a,__get__c,__set__a,__set__c]',
    ]);
    expect(result(`p.(P.c)`)).toContain('protocol-implementation-missing');
    expect(result(`p.(P.c) = 3`)).toContain('protocol-implementation-missing');
    // The unqualified read of the same property, on the same instance.
    expect(result(`p.c`)).toContain('protocol-implementation-missing');
  });

  test('the UNQUALIFIED read stays `unknown-field` when the edge is PENDING', () => {
    // The other half of the CHANGELOG claim, and the reason the unqualified
    // path was left alone: resolution skips pending edges, so no conformance
    // answers for the name and the object's own field list is the better
    // message. The same wording covers the ordinary declare-then-implement
    // case, which has nothing to do with redefinition — which is why teaching
    // this path about pending edges would have been the worse trade.
    executeEpsil(
      ce,
      `protocol P { readonly a: integer }
type T = object{a: integer, b: string} is P
let old = T(a: 1, b: "x")`
    );
    executeEpsil(ce, `type T = object{b: string}`);
    expect(edges('P')).toEqual(['T pending=true impl=[]']);

    expect(result(`let fresh = T(b: "y")\nfresh.a`)).toContain('unknown-field');
    // The OLD instance still has the slot, so the plain field read answers it.
    expect(result(`old.a`)).toBe('1');
    // …while the QUALIFIED spelling reports the conformance that lapsed.
    expect(result(`fresh.(P.a)`)).toContain('protocol-implementation-missing');
  });
});

//
// ── The raw MathJSON box route ───────────────────────────────────────────────
//

describe('the box route re-settles identically', () => {
  /** `type <name> = <body>` on the box route. */
  const declareType = (name: string, body: string, engine = ce) =>
    engine
      .box(['DeclareType', { str: name }, { str: body }] as never)
      .evaluate();

  /** `protocol <name> { <kind> <member>: <type> }` on the box route. */
  const declareProtocol = (
    name: string,
    member: string,
    kind: string,
    type: string,
    engine = ce
  ) =>
    engine
      .box([
        'DeclareProtocol',
        { str: name },
        [
          'Dictionary',
          [
            'KeyValuePair',
            { str: member },
            ['Pair', { str: kind }, { str: type }],
          ],
        ],
      ] as never)
      .evaluate();

  /** `type <target> is <protocol>`, with no implementation block. */
  const declareConformance = (target: string, protocol: string, engine = ce) =>
    engine
      .box(['DeclareConformance', { str: target }, ['List', protocol]] as never)
      .evaluate();

  /** `<type>(<name>: <value>, …)` — the named-argument constructor call. */
  const construct = (type: string, fields: Record<string, unknown>) =>
    ce
      .box([
        type,
        ...Object.entries(fields).map(([k, v]) => [
          'NamedArgument',
          { str: k },
          typeof v === 'string' ? { str: v } : v,
        ]),
      ] as MathJsonExpression)
      .evaluate();

  test('a `DeclareType` replacement re-settles the edges of the redefined type', () => {
    declareProtocol('Proto', 'a', 'readonly', 'integer');
    declareType('T', 'object{a: integer, b: string}');
    declareConformance('T', 'Proto');
    expect(edges('Proto')).toEqual(['T pending=false impl=[__get__a]']);

    const p = construct('T', { a: 1, b: 'x' });
    expect(
      String(
        ce
          .box(['ProtocolProperty', { str: 'Proto' }, { str: 'a' }, p] as never)
          .evaluate()
      )
    ).toBe('1');

    declareType('T', 'object{b: string}');
    expect(edges('Proto')).toEqual(['T pending=true impl=[]']);

    const q = construct('T', { b: 'y' });
    expect(
      String(
        ce
          .box(['ProtocolProperty', { str: 'Proto' }, { str: 'a' }, q] as never)
          .evaluate()
      )
    ).toContain('protocol-implementation-missing');
    // The instance built BEFORE the redefinition keeps its slot, and the
    // qualified read follows the conformance for it too.
    expect(isObject(p) && String(p._field('a'))).toBe('1');
    expect(
      String(
        ce
          .box(['ProtocolProperty', { str: 'Proto' }, { str: 'a' }, p] as never)
          .evaluate()
      )
    ).toContain('protocol-implementation-missing');
  });

  test('a `DeclareType` replacement that adds the field fulfils a pending edge', () => {
    declareProtocol('Proto', 'a', 'readonly', 'integer');
    declareType('T', 'object{b: string}');
    declareConformance('T', 'Proto');
    expect(edges('Proto')).toEqual(['T pending=true impl=[]']);

    declareType('T', 'object{a: integer, b: string}');
    expect(edges('Proto')).toEqual(['T pending=false impl=[__get__a]']);
  });
});

//
// ── Rollback ─────────────────────────────────────────────────────────────────
//

describe('a re-settlement rolls back with the declaration that caused it', () => {
  test('the Epsil static pre-pass leaves no re-settled edge behind', () => {
    // The pre-pass registers `type` statements so LATER statements of the same
    // program check against them, then discards the registrations. A program
    // that is only CHECKED must not have moved any conformance edge — which is
    // why `staticDiagnostics` takes the protocol rollback point beside the
    // type one.
    executeEpsil(
      ce,
      `protocol Proto { readonly a: integer }
type T = object{a: integer} is Proto`
    );
    const before = edges('Proto');
    expect(before).toEqual(['T pending=false impl=[__get__a]']);

    const source = `type T = object{b: string}\n1 + "x"`;
    const { ast } = parseSource(source, undefined, ce);
    staticDiagnostics(ce, ast!, source);

    expect(edges('Proto')).toEqual(before);
    expect(pendingReason('Proto')).toBeUndefined();

    // POSITIVE CONTROL. Without it this test also passes when nothing
    // re-settles at all, which is the state it exists to rule out: the SAME
    // source, actually executed, must move the edge the checked run left alone.
    executeEpsil(ce, source);
    expect(edges('Proto')).toEqual(['T pending=true impl=[]']);
  });

  test('a FAILED sum-type declaration restores the edges its earlier arms re-settled', () => {
    // `declareSumType` is N+1 declarations applied atomically. Each variant
    // goes through `declareType`, so a variant that REPLACES a previously
    // declared record re-settles that record's conformance edges — and an arm
    // that throws afterwards has to undo those too, not only the type records.
    // Driven on the box route because the Epsil sugar's payloads are records
    // and only an object payload can make a re-settlement visible.
    ce.box([
      'DeclareProtocol',
      { str: 'Proto' },
      [
        'Dictionary',
        [
          'KeyValuePair',
          { str: 'a' },
          ['Pair', { str: 'readonly' }, { str: 'integer' }],
        ],
      ],
    ] as never).evaluate();
    ce.box([
      'DeclareSumType',
      { str: 'S' },
      ['Tuple', { str: 'Va' }, { str: 'record{n: integer}' }],
      ['Tuple', { str: 'Vb' }, { str: 'nothing' }],
    ] as never).evaluate();
    ce.box([
      'DeclareConformance',
      { str: 'Va' },
      ['List', 'Proto'],
      [
        'Dictionary',
        [
          'KeyValuePair',
          { str: '__get__a' },
          [
            'Function',
            ['Typed', 42, { str: 'integer' }],
            ['Typed', 'self', { str: 'Self' }],
          ],
        ],
      ],
    ] as never).evaluate();
    expect(edges('Proto')).toEqual(['Va pending=false impl=[__get__a]']);

    // The first arm redeclares `Va` as an OBJECT with a stored `a` — which
    // makes the authored `get a` an `object-property-conflict` and the edge
    // pending. The second arm then fails: a variant may not take a protocol's
    // name.
    const refused = ce
      .box([
        'DeclareSumType',
        { str: 'S' },
        ['Tuple', { str: 'Va' }, { str: 'object{a: integer}' }],
        ['Tuple', { str: 'Proto' }, { str: 'nothing' }],
      ] as never)
      .evaluate();
    expect(String(refused)).toContain('already a protocol');

    expect(edges('Proto')).toEqual(['Va pending=false impl=[__get__a]']);
    expect(pendingReason('Proto')).toBeUndefined();
  });
});

//
// ── Cache invalidation ───────────────────────────────────────────────────────
//

describe('a re-settlement invalidates what was memoized against it', () => {
  test('`_conformanceVersion` advances on a re-settling redefinition, and NOT otherwise', () => {
    // The two halves belong in one test, against one engine: separately, the
    // no-bump half also passes when nothing re-settles at all. Together they
    // pin the bump as CONDITIONAL — the moving redefinition proves the sweep is
    // live on this engine, and the still one then proves it withheld the bump.
    //
    // Conditional for the same reason the registry rollback thunk's bump is:
    // the version keys memoized dispatcher and accessor effects, and colding
    // them on every re-run `type` statement would be the invalidation
    // anti-pattern, not the fix.
    executeEpsil(
      ce,
      `protocol Proto { readonly a: integer }
type T = object{a: integer} is Proto`
    );

    // MOVES a verdict: the field the accessor stood for is gone.
    const beforeMoving = ce._conformanceVersion;
    executeEpsil(ce, `type T = object{b: string}`);
    expect(edges('Proto')).toEqual(['T pending=true impl=[]']);
    expect(ce._conformanceVersion).toBeGreaterThan(beforeMoving);

    // Restores it, which moves a verdict again — and leaves the engine with a
    // fulfilled edge for the still redefinition below to leave alone.
    executeEpsil(ce, `type T = object{a: integer}`);
    expect(edges('Proto')).toEqual(['T pending=false impl=[__get__a]']);

    // MOVES NOTHING: an unrelated field is added, so the edge stays fulfilled
    // by the very same accessor and no version axis may advance.
    const beforeStill = ce._conformanceVersion;
    executeEpsil(ce, `type T = object{a: integer, b: string}`);
    expect(edges('Proto')).toEqual(['T pending=false impl=[__get__a]']);
    expect(ce._conformanceVersion).toBe(beforeStill);
  });

  test('the memoized accessor-effect union re-derives', () => {
    // `protocolAccessorEffects` caches on `_conformanceVersion`, and a PENDING
    // edge contributes nothing to the union (it is not a dispatch candidate).
    // A redefinition that makes the only effectful conformer pending must
    // therefore narrow the union — served from the memo it would not.
    executeEpsil(
      ce,
      `protocol P { readonly a: integer }
type T = object{n: integer} is P { get a(self: Self) -> integer { Random() } }`
    );
    expect(protocolAccessorEffects(ce, 'a', 'get')).toEqual(['random']);

    executeEpsil(ce, `type T = object{n: integer, a: integer}`);
    expect(protocolAccessorEffects(ce, 'a', 'get')).toBeUndefined();
  });

  test("a dispatcher's derived effects re-derive", () => {
    // A bare requirement's dispatcher unions what its conformers do
    // (`derivedDispatcherEffects`, memoized on the same version). The
    // redefinition makes the only conformer's edge pending — the added `label`
    // field collides with the block's `get label` — so the whole edge, function
    // member included, stops contributing and the dispatcher is pure again.
    executeEpsil(
      ce,
      `protocol S { readonly label: string
  function f(self: Self) -> integer }
type T = object{n: integer} is S { get label(self: Self) -> string { "L" }
  function f(self: Self) -> integer { Random() } }`
    );
    const dispatcher = () => ce.lookupDefinition('f')!['operator']!;
    expect(dispatcher().pure).toBe(false);
    expect(dispatcher().effects).toEqual(['random']);

    executeEpsil(ce, `type T = object{n: integer, label: string}`);
    expect(dispatcher().pure).toBe(true);
    expect(dispatcher().effects).toBeUndefined();
  });
});
