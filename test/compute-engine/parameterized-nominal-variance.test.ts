import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { groundSkeleton } from '../../src/common/type/instantiate';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import type { Type, TypeReference } from '../../src/common/type/types';

//
// Parameterized NOMINAL types — PHASE 1 (variance):
// `docs/plans/2026-08-06-parameterized-nominal-types-design.md` §4.
//
// Variance is VERIFIED, never inferred. Every parameter has a declared
// variance — the marker the author wrote, or `out` when none is spelled — and
// the position analysis checks it against the body. A body edit that would
// change the type's subtyping contract is therefore a loud error at the
// declaration, never a silent re-inference at the use sites (§4.4).
//

/** The message of a thrown type-layer failure. */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return '<no error>';
}

function stateOf(ce: ComputeEngine, name: string): string | undefined {
  return (ce._typeResolver.resolve(name) as TypeReference | undefined)
    ?._varianceState;
}

const TREE_BODY = 'tuple<value: T, children: list<tree<T>>>';

describe('VARIANCE — the §4.3 subtype rule', () => {
  test('`out` relates two applications covariantly', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', TREE_BODY, {
      typeParams: [{ name: 'T', variance: 'out' }],
    });
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
    expect(ce.type('tree<number>').matches('tree<integer>')).toBe(false);
  });

  // Unannotated MEANS `out` — treated as declared, and verified (§4.4). It is
  // the same relation, not a weaker one.
  test('…and so does the unannotated default', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', TREE_BODY, { typeParams: ['T'] });
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
    expect(ce.type('tree<number>').matches('tree<integer>')).toBe(false);
  });

  test('`in` reverses the relation', () => {
    const ce = new ComputeEngine();
    ce.declareType('sink', 'tuple<run: (T) -> nothing>', {
      typeParams: [{ name: 'T', variance: 'in' }],
    });
    expect(ce.type('sink<number>').matches('sink<integer>')).toBe(true);
    expect(ce.type('sink<integer>').matches('sink<number>')).toBe(false);
  });

  test('an explicit `inout` relates neither direction', () => {
    const ce = new ComputeEngine();
    ce.declareType('cell', 'tuple<v: T>', {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    expect(ce.type('cell<integer>').matches('cell<number>')).toBe(false);
    expect(ce.type('cell<number>').matches('cell<integer>')).toBe(false);
    expect(ce.type('cell<integer>').matches('cell<integer>')).toBe(true);
  });

  // The zero-parameter case is the pre-existing nominal rule, untouched.
  test('a non-parameterized nominal type still relates by name', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<number, number>');
    expect(ce.type('point').matches('point')).toBe(true);
  });

  // Two names never relate, whatever their variance.
  test('two different names never relate', () => {
    const ce = new ComputeEngine();
    ce.declareType('a', 'tuple<v: T>', { typeParams: ['T'] });
    ce.declareType('b', 'tuple<v: T>', { typeParams: ['T'] });
    expect(ce.type('a<integer>').matches('b<number>')).toBe(false);
  });

  test('each parameter of a multi-parameter type uses its own variance', () => {
    const ce = new ComputeEngine();
    ce.declareType('fn', 'tuple<run: (A) -> B>', {
      typeParams: [
        { name: 'A', variance: 'in' },
        { name: 'B', variance: 'out' },
      ],
    });
    expect(ce.type('fn<number, integer>').matches('fn<integer, number>')).toBe(
      true
    );
    expect(ce.type('fn<integer, number>').matches('fn<number, integer>')).toBe(
      false
    );
  });
});

describe('VARIANCE — the position analysis (§4.2)', () => {
  // The coinductive fixed point: assume the declared variance, check the body
  // under that assumption, accept if the assumption survives. `out ∘ out = out`
  // at the recursive occurrence.
  test('the recursive fixed point accepts `out T`', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('tree', TREE_BODY, {
        typeParams: [{ name: 'T', variance: 'out' }],
      })
    ).not.toThrow();
    expect(stateOf(ce, 'tree')).toBe('verified');
  });

  // `tree<T>` at `+` composed with an `in` parameter is `T` at `−`, so a
  // recursive covariant body cannot ALSO be declared contravariant.
  test('the recursive occurrence composes with the assumed variance', () => {
    const ce = new ComputeEngine();
    expect(
      messageOf(() =>
        ce.declareType('rec', 'tuple<v: T, next: list<rec<T>>>', {
          typeParams: [{ name: 'T', variance: 'in' }],
        })
      )
    ).toContain('variance-violation');
  });

  test('a signature ARGUMENT flips the polarity', () => {
    const ce = new ComputeEngine();
    expect(
      messageOf(() =>
        ce.declareType('h', 'tuple<run: (T) -> nothing>', {
          typeParams: [{ name: 'T', variance: 'out' }],
        })
      )
    ).toContain('variance-violation');
    // …and a signature RESULT does not.
    expect(() =>
      ce.declareType('g', 'tuple<make: () -> T>', {
        typeParams: [{ name: 'T', variance: 'out' }],
      })
    ).not.toThrow();
  });

  test('a doubly-flipped occurrence is covariant again', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('cb', 'tuple<run: ((T) -> nothing) -> nothing>', {
        typeParams: [{ name: 'T', variance: 'out' }],
      })
    ).not.toThrow();
  });

  test('a negation flips the polarity', () => {
    const ce = new ComputeEngine();
    expect(
      messageOf(() =>
        ce.declareType('neg', 'tuple<v: !T>', {
          typeParams: [{ name: 'T', variance: 'out' }],
        })
      )
    ).toContain('variance-violation');
  });

  test('collections and dictionaries keep the polarity', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('bag', 'tuple<a: list<T>, b: set<T>, c: dictionary<T>>', {
        typeParams: [{ name: 'T', variance: 'out' }],
      })
    ).not.toThrow();
  });

  // An `inout` annotation verifies against ANY body — invariance promises
  // nothing, so it is always sound, just less permissive (§4.4). That is what
  // makes it the universally available opt-out the diagnostics can suggest.
  test('`inout` verifies against any body', () => {
    const ce = new ComputeEngine();
    for (const [name, body] of [
      ['a', 'tuple<v: T>'],
      ['b', 'tuple<run: (T) -> nothing>'],
      ['c', 'tuple<log: list<T>, run: (T) -> nothing>'],
    ])
      expect(() =>
        ce.declareType(name, body, {
          typeParams: [{ name: 'T', variance: 'inout' }],
        })
      ).not.toThrow();
  });

  // §10: the violation fires on the ANNOTATED form and on the unannotated one,
  // because absence of a marker DECLARES `out` rather than inferring it.
  test('`type h<out T> = tuple<run: (T) -> nothing>` is a violation', () => {
    const ce = new ComputeEngine();
    expect(
      messageOf(() =>
        ce.declareType('h', 'tuple<run: (T) -> nothing>', {
          typeParams: [{ name: 'T', variance: 'out' }],
        })
      )
    ).toContain('variance-violation');
  });

  test('…and so is the UNANNOTATED `type h<T> = tuple<run: (T) -> nothing>`', () => {
    const ce = new ComputeEngine();
    expect(
      messageOf(() =>
        ce.declareType('h', 'tuple<run: (T) -> nothing>', {
          typeParams: ['T'],
        })
      )
    ).toContain('variance-violation');
  });

  // A violating declaration leaves NEITHER namespace touched — in particular it
  // never mints (Hook A precedes the mint block).
  test('a violating declaration declares nothing', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('h', 'tuple<run: (T) -> nothing>', { typeParams: ['T'] })
    ).toThrow();
    expect(ce._typeResolver.resolve('h')).toBeUndefined();
    expect(ce.box('h').operatorDefinition).toBeUndefined();
  });

  // The unused-parameter answer now comes from the same walk (§4.2) — the code
  // is SHARED with the alias rule (N8), not twinned.
  test('a phantom parameter is still the unused-parameter diagnostic', () => {
    const ce = new ComputeEngine();
    expect(
      messageOf(() => ce.declareType('ph', 'integer', { typeParams: ['T'] }))
    ).toContain('generic-alias-unused-parameter');
  });

  // A generic ALIAS is transparent: it has no declaration-level variance, so it
  // goes nowhere near this pass.
  test('a generic alias is not variance-checked', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('Sink', 'tuple<run: (T) -> nothing>', {
        alias: true,
        typeParams: ['T'],
      })
    ).not.toThrow();
    expect(stateOf(ce, 'Sink')).toBeUndefined();
  });
});

describe('VARIANCE — diagnostic content (§4.4)', () => {
  const EVENTS = 'tuple<log: list<T>, notify: (T) -> nothing>';

  function eventsMessage(variance?: 'out'): string {
    const ce = new ComputeEngine();
    return messageOf(() =>
      ce.declareType('events', EVENTS, {
        typeParams: variance === undefined ? ['T'] : [{ name: 'T', variance }],
      })
    );
  }

  test('it names the offending occurrence BY PATH', () => {
    const m = eventsMessage();
    // The COMPOSED path, not just the field: the parameter's contravariance
    // comes from its position inside `notify`'s signature, and the path says
    // so. A bare `notify` would also match a message that lost the descent.
    expect(m).toContain('notify.(arg 1)');
    expect(m).toContain('`log`');
  });

  test('it attributes the violated `out` to the DEFAULT', () => {
    expect(eventsMessage()).toContain(
      '`out` is the default when no marker is written'
    );
  });

  test('…and to the MARKER when one was written', () => {
    const m = eventsMessage('out');
    expect(m).toContain('is declared `out`');
    expect(m).not.toContain('is the default when no marker is written');
  });

  // The remedy set is exactly the markers that would verify: the join (here
  // `inout`), plus the always-sound `inout` when it is not already the join.
  // `in` is NEVER offered — `log: list<T>` would fail it the same way.
  test('it suggests exactly `inout`, never `in`', () => {
    const m = eventsMessage();
    expect(m).toContain('declare it `inout`');
    expect(m).not.toMatch(/declare it `in`/);
    expect(m).not.toMatch(/<in T>/);
  });

  // A body whose occurrences are ALL input positions under a mistaken `out`
  // joins to `in`, so `in` IS in the remedy set (alongside the always-sound
  // `inout`).
  test('a pure-input body suggests `in`', () => {
    const ce = new ComputeEngine();
    const m = messageOf(() =>
      ce.declareType('h', 'tuple<run: (T) -> nothing>', { typeParams: ['T'] })
    );
    expect(m).toContain('declare it `in`');
    expect(m).toContain('declare it `inout`');
    expect(m).toContain('<in T>');
  });

  test('the structural alternative is listed LAST', () => {
    const m = eventsMessage();
    const lines = m.split('\n').filter((l) => l.trimStart().startsWith('•'));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[lines.length - 1]).toContain('split it off');
  });

  test('the code heads the message', () => {
    expect(eventsMessage().startsWith('variance-violation:')).toBe(true);
  });

  // The parse of the body has already returned when verification runs, so the
  // message is not swallowed by `parseType`'s "Failed to parse type" wrapper.
  test('the message is not wrapped by the type parser', () => {
    expect(eventsMessage()).not.toContain('Failed to parse type');
  });
});

describe('VARIANCE — forward references and mutual recursion (ruling C)', () => {
  // `type forest<T>` inside a body is the forward-reference spelling: a use of
  // a not-yet-declared name installs the promise.
  const TREE_FWD = 'tuple<value: T, children: type forest<T>>';

  test('the unannotated tree/forest pair is accepted, tree first', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('tree', TREE_FWD, { typeParams: ['T'] })
    ).not.toThrow();
    expect(() =>
      ce.declareType('forest', 'list<tree<T>>', { typeParams: ['T'] })
    ).not.toThrow();
    expect(stateOf(ce, 'tree')).toBe('verified');
    expect(stateOf(ce, 'forest')).toBe('verified');
  });

  test('…and in the other order', () => {
    const ce = new ComputeEngine();
    ce.declareType('forest', 'list<type tree<T>>', { typeParams: ['T'] });
    ce.declareType('tree', 'tuple<value: T, children: forest<T>>', {
      typeParams: ['T'],
    });
    expect(stateOf(ce, 'tree')).toBe('verified');
    expect(stateOf(ce, 'forest')).toBe('verified');
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
  });

  // In the window between a provisional acceptance and fulfilment, a judgment
  // that would consult the unverified variance is answered as `inout` — sound
  // under whatever variance fulfilment reveals, so nothing recorded in the
  // window ever needs invalidating.
  test('a window judgment is answered as `inout`, and succeeds after fulfilment', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', TREE_FWD, { typeParams: ['T'] });
    expect(stateOf(ce, 'tree')).toBe('deferred');
    expect(
      (ce._typeResolver.resolve('tree') as TypeReference)._varianceBlockedOn
    ).toEqual(['forest']);
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(false);
    expect(ce.type('tree<integer>').matches('tree<integer>')).toBe(true);

    ce.declareType('forest', 'list<tree<T>>', { typeParams: ['T'] });
    expect(stateOf(ce, 'tree')).toBe('verified');
    expect(
      (ce._typeResolver.resolve('tree') as TypeReference)._varianceBlockedOn
    ).toBeUndefined();
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
  });

  // The fulfilment makes the provisionally-accepted `tree` unsound: `forest` is
  // contravariant, so `children: forest<T>` puts `T` in an input position. The
  // message is ATTRIBUTED to `tree` and names the trigger; the REJECTED
  // statement is the fulfilment, which rolls back atomically.
  test('a fulfilment that makes the original unsound is attributed to it', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', TREE_FWD, { typeParams: ['T'] });
    const m = messageOf(() =>
      ce.declareType('forest', 'tuple<run: (T) -> nothing>', {
        typeParams: [{ name: 'T', variance: 'in' }],
      })
    );
    expect(m).toContain('variance-violation');
    expect(m).toContain('parameter `T` of `tree`');
    expect(m).toContain('surfaced when `forest` was declared');

    // The fulfilment is the failing OPERATION: it rolled back, leaving the
    // promise open and `tree` still provisional.
    expect(() => ce.type('forest<integer>')).toThrow();
    expect(stateOf(ce, 'tree')).toBe('deferred');
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(false);

    // …and a well-formed fulfilment still closes the group afterwards.
    ce.declareType('forest', 'list<tree<T>>', { typeParams: ['T'] });
    expect(stateOf(ce, 'tree')).toBe('verified');
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
  });

  test('a mutually recursive pair is verified as a group at the LAST fulfilment', () => {
    const ce = new ComputeEngine();
    ce.declareType('aa', 'tuple<v: T, next: type bb<T>>', {
      typeParams: ['T'],
    });
    expect(stateOf(ce, 'aa')).toBe('deferred');
    ce.declareType('bb', 'tuple<w: T, back: list<aa<T>>>', {
      typeParams: ['T'],
    });
    expect(stateOf(ce, 'aa')).toBe('verified');
    expect(stateOf(ce, 'bb')).toBe('verified');
    expect(ce.type('aa<integer>').matches('aa<number>')).toBe(true);
    expect(ce.type('bb<integer>').matches('bb<number>')).toBe(true);
  });

  // A never-fulfilled promise means the verification simply never completes —
  // harmless, because the type is uninhabitable for the same reason.
  test('a never-fulfilled reference leaves the declaration provisional', () => {
    const ce = new ComputeEngine();
    ce.declareType('waiting', 'tuple<v: T, x: type never_comes<T>>', {
      typeParams: ['T'],
    });
    expect(stateOf(ce, 'waiting')).toBe('deferred');
    expect(ce.type('waiting<integer>').matches('waiting<number>')).toBe(false);
  });
});

describe('VARIANCE — the operator route unblocks (Phase 0 deviation)', () => {
  // The ground skeleton of `tree<T>` is `tree<any>`, and admission asks
  // `tree<integer> <: tree<any>`. Under Phase 0's invariant reading that was
  // false, so a `(tree<T>) -> T where T` operator declined the operand and
  // its result fell back to `unknown`. The declared `out` unblocks it.
  test('a quantified operand type solves `T` through an application', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', TREE_BODY, {
      typeParams: [{ name: 'T', variance: 'out' }],
    });
    ce.declare('t', ce.type('tree<integer>'));
    ce.declare('rootOf', ce.type('(tree<T>) -> T where T'));
    expect(ce.box(['rootOf', 't']).type.toString()).toBe('integer');
  });

  // An INVARIANT parameter used to fall out here too: the pre-solve gate read
  // the parameter at its DISJOINTNESS skeleton (`cell<any>`), which under
  // §4.3's invariant rule admits no other application, so the position was
  // skipped and `T` fell back to `unknown`. Admission and disjointness are now
  // separate readings (`admissionSkeleton`): every application of the same
  // declaration is admitted, `T` solves from the argument, and the post-solve
  // gate re-checks the operand against the INSTANTIATED `cell<integer>`.
  test('an INVARIANT parameter is admitted at the ADMISSION skeleton', () => {
    const ce = new ComputeEngine();
    ce.declareType('cell', 'tuple<v: T>', {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    ce.declare('c', ce.type('cell<integer>'));
    ce.declare('peek', ce.type('(cell<T>) -> T where T'));
    expect(ce.box(['peek', 'c']).type.toString()).toBe('integer');
  });

  // The skeleton composes each argument with the referenced parameter's
  // declared variance. `inout` passes the polarity through UNCHANGED rather
  // than flipping it: neither reading is admitted by an invariant argument, so
  // the choice is settled by §5's other requirement — the skeleton must never
  // let disjointness be derived from the type variable alone, and `never` is
  // provably disjoint from everything while `any` is disjoint from nothing.
  test('the ground skeleton composes with the declared variance', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', TREE_BODY, {
      typeParams: [{ name: 'T', variance: 'out' }],
    });
    ce.declareType('sink', 'tuple<run: (T) -> nothing>', {
      typeParams: [{ name: 'T', variance: 'in' }],
    });
    ce.declareType('cell', 'tuple<v: T>', {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    const open = (s: string): Type =>
      parseType(s, ce._typeResolver, [{ name: 'T' }]);
    expect(typeToString(groundSkeleton(open('tree<T>')))).toBe('tree<any>');
    expect(typeToString(groundSkeleton(open('sink<T>')))).toBe('sink<never>');
    expect(typeToString(groundSkeleton(open('cell<T>')))).toBe('cell<any>');
  });
});

describe('VARIANCE — Epsil route parity', () => {
  function run(source: string): ReturnType<typeof executeEpsil> {
    return executeEpsil(new ComputeEngine(), source);
  }

  test('a variance marker on the statement route relates two applications', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `type tree<out T> = ${TREE_BODY}\nlet a = 1\na`
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
  });

  test('the unannotated statement form is `out` too', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, `type tree<T> = ${TREE_BODY}\nlet a = 1\na`);
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
  });

  test('a violation on the statement route is an error value', () => {
    const r = run('type h<out T> = tuple<run: (T) -> nothing>');
    expect(r.value.operator).toBe('Error');
    expect(r.value.toString()).toContain('variance-violation');
  });

  test('…and so is the unannotated one, with the same prescriptive message', () => {
    const r = run(
      'type events<T> = tuple<log: list<T>, notify: (T) -> nothing>'
    );
    expect(r.value.operator).toBe('Error');
    const s = r.value.toString();
    expect(s).toContain('variance-violation');
    expect(s).toContain('notify');
    expect(s).toContain('`out` is the default when no marker is written');
  });

  test('an `inout` marker parses and is honored', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type cell<inout T> = tuple<v: T>\nlet a = 1\na'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('cell<integer>').matches('cell<number>')).toBe(false);
  });

  test('an `in` marker parses and reverses the relation', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type sink<in T> = tuple<run: (T) -> nothing>\nlet a = 1\na'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('sink<number>').matches('sink<integer>')).toBe(true);
  });
});

// §10 "Construction at a widened type" — the test the original N6 deferral
// failed, so it must exist before Phase 2 closes. `tree(1, [])` constructs a
// `tree<finite_integer>`; the annotation `tree<number>` is reachable only
// through the §4.3 subtype rule, so it works exactly when the parameter is
// covariant — which the v3 default makes the common case. Under an explicit
// `inout` this is ruling (c): the documented limitation, not a bug.
describe('§10 — construction at a widened type', () => {
  test('accepted under an explicit `out` parameter', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', TREE_BODY, {
      typeParams: [{ name: 'T', variance: 'out' }],
    });
    const t = ce.box(['tree', 1, ['List']]);
    expect(t.type.toString()).toBe('tree<finite_integer>');
    expect(t.type.matches('tree<number>')).toBe(true);
  });

  test('accepted under the unannotated default — the same thing', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', TREE_BODY, { typeParams: ['T'] });
    expect(ce.box(['tree', 1, ['List']]).type.matches('tree<number>')).toBe(
      true
    );
  });

  test('the Epsil spelling `let t: tree<number> = tree(1, [])` executes cleanly', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `type tree<T> = ${TREE_BODY}\nlet t: tree<number> = tree(1, [])\nt`
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value.operator).not.toBe('Error');
  });

  test('rejected under an explicit `inout` parameter — ruling (c)', () => {
    const ce = new ComputeEngine();
    // An `inout` annotation verifies against ANY body (§4.4), including this
    // covariant one; it just relates nothing but the exact argument type.
    ce.declareType('tree', TREE_BODY, {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    const t = ce.box(['tree', 1, ['List']]);
    expect(t.type.matches('tree<number>')).toBe(false);
    expect(t.type.matches('tree<finite_integer>')).toBe(true);
  });

  // The Epsil route says the same thing, as a DIAGNOSTIC rather than a
  // subtype verdict: ruling (c) is a documented limitation, so it has to be
  // legible at the surface the user writes. The construction itself succeeds
  // (`tree(1, [])` is a `tree<finite_integer>`); it is the widened ANNOTATION
  // that fails.
  test('the Epsil spelling reports ruling (c) as an incompatible-type', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `type tree<inout T> = ${TREE_BODY}\nlet t: tree<number> = tree(1, [])\nt`
    );
    const messages = r.diagnostics.map((d) => d.message.toString());
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('expected `');
    expect(messages[0]).toContain('tree<number>');
    expect(messages[0]).toContain('tree<finite_integer>');
  });
});

// ── Finding 1 (adversarial review, 2026-08-06): variance laundering ─────────
//
// A reference whose declaration is merely KNOWN is not enough to compose with:
// a parameterized nominal still waiting on an unfulfilled forward reference has
// only an ASSUMED variance, and fulfilment may still reject it. A dependent
// that composed with the assumption would be granted a subtyping relation the
// blocked declaration never earned — permanently, if the fulfilment fails.
describe('VARIANCE — deferral propagates through the window (ruling C)', () => {
  /** `b` is blocked on the unfulfilled `later`; `c` merely mentions `b`. */
  function blockedPair(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('b', 'tuple<v: T, ghosts: list<type later<T>>>', {
      typeParams: ['T'],
    });
    ce.declareType('c', 'tuple<x: b<T>>', { typeParams: ['T'] });
    return ce;
  }

  test('a dependent of a blocked declaration is blocked too', () => {
    const ce = blockedPair();
    expect(stateOf(ce, 'b')).toBe('deferred');
    expect(stateOf(ce, 'c')).toBe('deferred');
  });

  test('…so it grants no relation its blocked reference does not have', () => {
    const ce = blockedPair();
    expect(ce.type('b<integer>').matches('b<number>')).toBe(false);
    expect(ce.type('c<integer>').matches('c<number>')).toBe(false);
  });

  test('fulfilment settles the whole chain, in one pass', () => {
    const ce = blockedPair();
    ce.declareType('later', 'list<T>', { typeParams: ['T'] });
    expect(stateOf(ce, 'b')).toBe('verified');
    expect(stateOf(ce, 'c')).toBe('verified');
    expect(ce.type('b<integer>').matches('b<number>')).toBe(true);
    expect(ce.type('c<integer>').matches('c<number>')).toBe(true);
  });

  // The laundering repro: a fulfilment that REJECTS `b` must leave `c`
  // provisional too. Before the fix `c` had already flipped to `verified` and
  // stayed there, granting `c<integer> <: c<number>` forever.
  test('a REJECTED fulfilment leaves both provisional', () => {
    const ce = blockedPair();
    expect(() =>
      ce.declareType('later', 'tuple<run: (T) -> nothing>', {
        typeParams: ['T'],
      })
    ).toThrow(/variance-violation/);
    expect(stateOf(ce, 'b')).toBe('deferred');
    expect(stateOf(ce, 'c')).toBe('deferred');
    expect(ce.type('c<integer>').matches('c<number>')).toBe(false);
  });

  // The counterweight: a declaration unverified only because its GROUP is
  // still being checked is not waiting on anything that can fail on its own —
  // the group check IS the coinductive assumption (§4.2) — so it must not
  // deadlock the fixpoint.
  test('a mutually recursive pair still settles at the last fulfilment', () => {
    const ce = new ComputeEngine();
    ce.declareType('aa', 'tuple<v: T, f: type bb<T>>', { typeParams: ['T'] });
    expect(stateOf(ce, 'aa')).toBe('deferred');
    ce.declareType('bb', 'list<aa<T>>', { typeParams: ['T'] });
    expect(stateOf(ce, 'aa')).toBe('verified');
    expect(stateOf(ce, 'bb')).toBe('verified');
    expect(ce.type('aa<integer>').matches('aa<number>')).toBe(true);
    expect(ce.type('bb<integer>').matches('bb<number>')).toBe(true);
  });

  test('a 3-cycle settles too (a → b → c → a)', () => {
    const ce = new ComputeEngine();
    ce.declareType('c1', 'tuple<v: T, n: type c2<T>>', { typeParams: ['T'] });
    ce.declareType('c2', 'tuple<n: type c3<T>>', { typeParams: ['T'] });
    expect(stateOf(ce, 'c1')).toBe('deferred');
    expect(stateOf(ce, 'c2')).toBe('deferred');
    ce.declareType('c3', 'tuple<n: c1<T>>', { typeParams: ['T'] });
    expect(stateOf(ce, 'c1')).toBe('verified');
    expect(stateOf(ce, 'c2')).toBe('verified');
    expect(stateOf(ce, 'c3')).toBe('verified');
    expect(ce.type('c1<integer>').matches('c1<number>')).toBe(true);
    expect(ce.type('c3<integer>').matches('c3<number>')).toBe(true);
  });

  // A deferred declaration is still INHABITABLE: the window is read as
  // `inout`, and finding 2's admission/disjointness split is what keeps an
  // invariant reading from making the constructor unusable.
  test('a value of a blocked type constructs, and nests', () => {
    const ce = blockedPair();
    const inner = ce.box(['b', 1, ['List']]);
    expect(inner.isValid).toBe(true);
    expect(inner.type.toString()).toBe('b<finite_integer>');
    const outer = ce.box(['c', inner]);
    expect(outer.isValid).toBe(true);
    expect(outer.type.toString()).toBe('c<finite_integer>');
  });
});
