/**
 * SAME-STATEMENT RE-REGISTRATION IS A NO-OP — linear-posture R1,
 * `docs/CHECKPOINT-MODEL.md` (finding F2/R1).
 *
 * One Epsil `Declare*` statement registers its declarations two or three times
 * per batch: the static pre-pass canonicalizes it (and rolls its registrations
 * back), then the evaluation loop canonicalizes it and evaluates it —
 * `ce.box(stmt).evaluate()`, statement by statement, so those last two run
 * back-to-back with nothing in between. Every one of those registrations used
 * to take the full REPLACE path: re-parsing the body, re-opening the record in
 * place, and sweeping every conformance edge in the engine
 * (`resettleTypeConformances`, ~75 µs per authored edge, ×(N+1) for a sum
 * type) to rebuild — from the same source text against an unchanged registry —
 * exactly the state the record already held.
 *
 * The registries now recognize that case from the declaration-origin stamp
 * (batch + statement identity, with the source range as the cross-boxing
 * fallback) and return early. Two things have to stay true for that to be
 * safe, and this file pins both:
 *
 * - The no-op fires ONLY for the same statement of the same batch. A second
 *   statement of the same batch is still a redefinition ERROR, and a later
 *   batch still REPLACES (the notebook pattern).
 * - The UNSTAMPED routes — the raw MathJSON box route and the host
 *   `ce.declareType()` API — never match the predicate, so they keep their
 *   replace/idempotent semantics. That is a hard product constraint: the Tycho
 *   consumer re-asserts its declarations over the box route on a timer.
 *
 * The witness for "the no-op fired" at the unit level is OBJECT IDENTITY of
 * the registry record's `def`: the replace path re-parses the body into a
 * fresh type object, so an unchanged `def` reference can only mean the
 * registration returned before reaching it.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseSource } from '../../src/cli/check';
import {
  isSameStatementReRegistration,
  RedefinitionError,
} from '../../src/compute-engine/declaration-origin';
import {
  declareType,
  declareSumType,
} from '../../src/compute-engine/engine-declarations';
import { declareProtocolImpl } from '../../src/compute-engine/engine-protocols';
import { isObject } from '../../src/compute-engine/boxed-expression/type-guards';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** Run an Epsil program and return its final value as a string. */
function result(source: string, engine = ce): string {
  return String(executeEpsil(engine, source).value);
}

/** The error code of one diagnostic. A diagnostic the redefinition discipline
 * mints reports its code as the FIRST message part; one wrapped by a reporting
 * tier — `runtime-error` from the statement route, `static-type-error` from
 * the static pass — names the tier there and carries the code LAST. */
function codeOf(message: unknown): string {
  const parts = (Array.isArray(message) ? message : [message]).map(String);
  return parts[0] === 'runtime-error' || parts[0] === 'static-type-error'
    ? parts[parts.length - 1]!
    : parts[0]!;
}

/** The error codes of a program's diagnostics, in order. */
function diagnosticCodes(source: string, engine = ce): string[] {
  return executeEpsil(engine, source).diagnostics.map((d) => codeOf(d.message));
}

//
// ── A. The predicate ─────────────────────────────────────────────────────────
//

describe('isSameStatementReRegistration', () => {
  test('the SAME anchor object in the same batch is the same statement', () => {
    // The primary test: the `Declare*` handlers thread the raw name operand
    // from the canonical handler into the evaluate handler, so those two
    // registrations of one statement carry the identical anchor. A predicate
    // that missed this would leave the evaluate-pass registration on the full
    // replace path, which is the cost R1 removes.
    const anchor = {};
    expect(
      isSameStatementReRegistration(
        { batch: 1, statementId: anchor },
        { batch: 1, statementId: anchor }
      )
    ).toBe(true);
  });

  test('DIFFERENT anchors with the same source range are the same statement', () => {
    // The static pre-pass and the evaluation loop box the statement from the
    // original MathJSON independently, producing different operand objects for
    // one written statement. The source range is what identifies them: within
    // one compilation unit two distinct statements always occupy distinct
    // offsets. Without this arm the pre-pass's registration and the
    // evaluation-loop one would look like two different statements.
    expect(
      isSameStatementReRegistration(
        { batch: 1, statementId: {}, firstRange: [5, 9] },
        { batch: 1, statementId: {}, firstRange: [5, 9] }
      )
    ).toBe(true);
  });

  test('different ranges in the same batch are DIFFERENT statements', () => {
    // The discipline's whole subject: two `type` statements declaring one name
    // in one program. If this returned true the second would be silently
    // skipped instead of refused.
    expect(
      isSameStatementReRegistration(
        { batch: 1, statementId: {}, firstRange: [5, 9] },
        { batch: 1, statementId: {}, firstRange: [30, 34] }
      )
    ).toBe(false);
  });

  test('a different BATCH is never a re-registration', () => {
    // The notebook pattern: re-running a cell must REPLACE, sweeps included.
    // Even the identical anchor object (a host re-using one) is a new unit.
    const anchor = {};
    expect(
      isSameStatementReRegistration(
        { batch: 1, statementId: anchor },
        { batch: 2, statementId: anchor }
      )
    ).toBe(false);
  });

  test('an UNSTAMPED side on either end is never a re-registration', () => {
    // The box route and the host `ce.declareType()` API leave records
    // unstamped and pass no origin. Both directions must decline, or those
    // routes would stop being re-runnable — the Tycho consumer re-asserts its
    // declarations over the box route on a timer.
    const stamped = { batch: 1, statementId: {} };
    expect(isSameStatementReRegistration(undefined, stamped)).toBe(false);
    expect(isSameStatementReRegistration(stamped, undefined)).toBe(false);
    expect(isSameStatementReRegistration(undefined, undefined)).toBe(false);
  });
});

//
// ── B. `declareType`, driven directly ────────────────────────────────────────
//

describe('declareType skips a same-statement re-registration', () => {
  /** A registration on the Epsil statement route, stamped with `origin`. */
  const declare = (
    name: string,
    body: string,
    origin?: { batch: number; statementId: unknown }
  ) => declareType(ce, name, body, { fromStatement: true, origin });

  test('the second registration leaves the `def` object untouched', () => {
    // The no-op's witness. The replace path re-parses the body into a FRESH
    // type object and re-opens the record around it (and runs the conformance
    // sweep on the way out); an unchanged `def` reference can only mean the
    // registration returned early.
    const origin = { batch: 1, statementId: {} };
    declare('U', 'object{a: integer}', origin);
    const d1 = ce._typeRegistry['U']!.def;
    expect(d1).toBeDefined();

    declare('U', 'object{a: integer}', origin);
    expect(ce._typeRegistry['U']!.def).toBe(d1);
  });

  test('a DIFFERENT statement of the same batch is still refused', () => {
    // The discipline the fast path sits directly behind: it is checked after
    // `checkSameUnitRedefinition`, so a same-batch duplicate must still throw
    // rather than be absorbed as a re-registration. (No ranges here, so
    // identity alone decides — the hand-built-operand case.)
    declare('U', 'object{a: integer}', { batch: 1, statementId: {} });
    let thrown: unknown;
    try {
      declare('U', 'object{a: integer}', { batch: 1, statementId: {} });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RedefinitionError);
    expect((thrown as RedefinitionError).code).toBe('type-redefinition');
  });

  test('a LATER batch still REPLACES, identical body and all', () => {
    // The notebook gesture. Re-running a cell has to re-run the registration
    // for real — the conformance edges of the type are re-settled against the
    // new record — so the `def` object must change even when the body is
    // character-for-character the same.
    declare('U', 'object{a: integer}', { batch: 1, statementId: {} });
    const d1 = ce._typeRegistry['U']!.def;

    declare('U', 'object{a: integer}', { batch: 2, statementId: {} });
    expect(ce._typeRegistry['U']!.def).not.toBe(d1);
  });

  test('an UNSTAMPED registration still replaces, and clears the stamp', () => {
    // The box route and the host API. They carry no origin, so the predicate
    // declines and the full replace path runs — the product constraint that a
    // consumer may re-assert a declaration at any time and get a real
    // re-registration. The record is left unstamped too, so a LATER statement
    // of any batch is free to replace it rather than colliding with a stale
    // stamp from whichever batch happened to declare it first.
    declare('U', 'object{a: integer}', { batch: 1, statementId: {} });
    const d1 = ce._typeRegistry['U']!.def;

    declare('U', 'object{a: integer}');
    expect(ce._typeRegistry['U']!.def).not.toBe(d1);
    expect(ce._typeRegistry['U']!._declOrigin).toBeUndefined();
  });
});

describe('declareSumType skips a same-statement re-registration', () => {
  const variants = [
    { name: 'va', payload: 'integer' },
    { name: 'vb', payload: 'string' },
  ];

  test('the second registration leaves the union, variants and variant LIST untouched', () => {
    // Two witnesses, one per no-op tier. The `def` references (union and
    // variant) prove the inner per-name `declareType` registrations returned
    // early — the replace path re-parses each body into a fresh type object.
    // The `_sumVariants` ARRAY identity proves the SUM-level fast path fired:
    // a full sum run rebuilds that array (`variants.map(…)`) after the union
    // fulfilment, even when every inner `declareType` no-ops, so an unchanged
    // array reference can only mean `declareSumType` itself returned early.
    const origin = { batch: 1, statementId: {} };
    declareSumType(ce, 's', variants, { fromStatement: true, origin });
    const union = ce._typeRegistry['s']!.def;
    const variant = ce._typeRegistry['va']!.def;
    const variantList = ce._typeRegistry['s']!._sumVariants;
    expect(union).toBeDefined();
    expect(variant).toBeDefined();
    expect(variantList).toBeDefined();

    declareSumType(ce, 's', variants, { fromStatement: true, origin });
    expect(ce._typeRegistry['s']!.def).toBe(union);
    expect(ce._typeRegistry['va']!.def).toBe(variant);
    expect(ce._typeRegistry['s']!._sumVariants).toBe(variantList);
  });

  test('a LATER batch still REPLACES the whole variant set', () => {
    // The notebook gesture for sums: a later batch must re-declare for real,
    // so the union's `def` is rebuilt.
    declareSumType(ce, 's', variants, {
      fromStatement: true,
      origin: { batch: 1, statementId: {} },
    });
    const union = ce._typeRegistry['s']!.def;

    declareSumType(ce, 's', variants, {
      fromStatement: true,
      origin: { batch: 2, statementId: {} },
    });
    expect(ce._typeRegistry['s']!.def).not.toBe(union);
  });
});

describe('declareProtocolImpl skips a same-statement re-registration', () => {
  const members = { functions: { m: '(self: Self) -> integer' } };

  test('the second registration leaves the `members` object untouched', () => {
    // The protocol no-op's witness: the replacement branch builds a FRESH
    // validated-members object and assigns it (`existing.members =
    // validated`) before revalidating every conformance edge and re-syncing
    // the dispatchers — an unchanged `members` reference can only mean the
    // registration returned early.
    const origin = { batch: 1, statementId: {} };
    declareProtocolImpl(ce, 'Pr', members, { fromStatement: true, origin });
    const m1 = ce._protocolRegistry['Pr']!.members;
    expect(m1).toBeDefined();

    declareProtocolImpl(ce, 'Pr', members, { fromStatement: true, origin });
    expect(ce._protocolRegistry['Pr']!.members).toBe(m1);
  });

  test('a LATER batch still REPLACES the requirement set', () => {
    // A notebook re-run with an edited `protocol` statement must revalidate
    // for real, so the validated-members object is rebuilt.
    declareProtocolImpl(ce, 'Pr', members, {
      fromStatement: true,
      origin: { batch: 1, statementId: {} },
    });
    const m1 = ce._protocolRegistry['Pr']!.members;

    declareProtocolImpl(ce, 'Pr', members, {
      fromStatement: true,
      origin: { batch: 2, statementId: {} },
    });
    expect(ce._protocolRegistry['Pr']!.members).not.toBe(m1);
  });
});

//
// ── C. The Epsil statement route ─────────────────────────────────────────────
//

describe('the Epsil route still declares, redeclares and refuses', () => {
  test('a FRESH object type declares and is constructible', () => {
    // The base case R1 makes free: a fresh `type` statement's two
    // canonicalization passes install rather than replace, and the evaluate
    // pass is now recognized as a no-op, so no conformance sweep runs at all.
    // What must not change is the outcome.
    expect(diagnosticCodes(`type pt = object{x: integer, y: integer}`)).toEqual(
      []
    );
    expect(result(`p = pt(x: 1, y: 2)\np.x`)).toBe('1');
  });

  test('a NOTEBOOK re-run in a later batch replaces the layout', () => {
    // Cross-batch replacement is what the fast path must not swallow: the
    // second cell's stamp carries a different batch, so it takes the full
    // replace path and the new field becomes constructible.
    expect(diagnosticCodes(`type t = object{a: integer}`)).toEqual([]);
    expect(diagnosticCodes(`type t = object{a: integer, b: integer}`)).toEqual(
      []
    );
    expect(result(`let q = t(a: 1, b: 2)\nq.b`)).toBe('2');
  });

  test('TWO `type` statements in ONE program are a `type-redefinition`', () => {
    // The within-unit discipline, on the route the fast path actually runs on.
    // The two statements sit at different source offsets, so the range
    // fallback separates them even though neither shares an anchor with the
    // other's boxings.
    expect(
      diagnosticCodes(`type dup = object{a: integer}
type dup = object{b: string}`)
    ).toEqual(['type-redefinition']);
  });

  test('TWO `protocol` statements in ONE program are a `protocol-redefinition`', () => {
    // The protocol registry's own copy of the discipline, sitting directly in
    // front of `declareProtocolImpl`'s fast path.
    expect(
      diagnosticCodes(`protocol Dup { }
protocol Dup { }`)
    ).toEqual(['protocol-redefinition']);
  });

  test('a FRESH sum type declares, constructs and matches', () => {
    // `declareSumType` is N+1 `declareType` calls applied atomically, so its
    // own sum-level fast path has to prove the WHOLE statement completed
    // before skipping. A premature skip would leave variants half-declared and
    // the constructor or the match arm unresolvable.
    expect(
      diagnosticCodes(`type shape = circle(r: number) | square(s: number)`)
    ).toEqual([]);
    expect(
      result(`c = circle(2.5)
match c {
  circle(r) => r
  square(s) => s
}`)
    ).toBe('2.5');
  });

  test('a sum type re-run with an ADDED variant replaces across batches', () => {
    // The sum-level notebook gesture. The added variant only exists if the
    // later batch took the replace path through all N+1 registrations.
    expect(
      diagnosticCodes(`type shape = circle(r: number) | square(s: number)`)
    ).toEqual([]);
    expect(
      diagnosticCodes(
        `type shape = circle(r: number) | square(s: number) | tri(t: number)`
      )
    ).toEqual([]);
    expect(
      result(`let d = tri(3)
match d {
  circle(r) => r
  square(s) => s
  tri(t) => t
}`)
    ).toBe('3');
  });

  test('a conformance BLOCK declared and called in one program, then re-run', () => {
    // The conformance fast path keys on the {batch, block} stamp, so the
    // in-program call exercises the skip (the canonical and evaluate passes of
    // one `type T is P { … }` statement pass the same block operand) and the
    // re-run exercises the cross-batch replace behind it.
    const program = `protocol P { function m(self: Self) -> integer }
type T = object{a: integer} is P { function m(self: Self) -> integer { self.a } }
let t = T(a: 7)
P.m(t)`;
    expect(result(program)).toBe('7');
    expect(result(program)).toBe('7');
  });

  test('TWO implementation blocks for one pair in ONE program are refused', () => {
    // The duplicate rule the fast path shares a stamp with: same batch, same
    // (type, protocol) pair, DIFFERENT block objects. Absorbing this as a
    // re-registration would let the second block silently replace the first.
    expect(
      diagnosticCodes(`protocol P { function m(self: Self) -> integer }
type T = object{a: integer}
type T is P { function m(self: Self) -> integer { self.a } }
type T is P { function m(self: Self) -> integer { self.a + 1 } }`)
    ).toEqual(['protocol-implementation-duplicate']);
  });
});

//
// ── C (box route) ────────────────────────────────────────────────────────────
//

describe('the box route stays idempotent', () => {
  test('`DeclareType` twice on one engine declares a working type', () => {
    // The hard product constraint. Box-route registrations are UNSTAMPED, so
    // the fast path never applies to them and the second `DeclareType` takes
    // the full replace path — no throw, no error value, and the type is still
    // constructible afterwards.
    const declare = () =>
      ce
        .box(['DeclareType', { str: 'bx' }, { str: 'object{a: integer}' }])
        .evaluate();
    expect(String(declare())).not.toContain('Error');
    expect(String(declare())).not.toContain('Error');
    expect(ce._typeRegistry['bx']!._declOrigin).toBeUndefined();

    const instance = ce
      .box(['bx', ['NamedArgument', { str: 'a' }, 5]])
      .evaluate();
    expect(isObject(instance) && String(instance._field('a'))).toBe('5');
  });
});

//
// ── D. What the conformance no-op must leave installed ───────────────────────
//

describe('the conformance no-op leaves the edge INSTALLED', () => {
  test('the edge is fulfilled and carries the block after the batch', () => {
    // A skip that fired too early — before the block was grounded, validated
    // and merged — would leave the edge `pending` with an empty map, and every
    // call through it a missing implementation with no diagnostic to say so.
    // The edge's state after the batch is the observable; the identity of the
    // conformance object across the canonical and evaluate passes is not.
    executeEpsil(
      ce,
      `protocol P { function m(self: Self) -> integer }
type T = object{a: integer} is P { function m(self: Self) -> integer { self.a } }`
    );
    const edge = ce._protocolRegistry['P']!.conformances[0]!;
    expect(edge.pending).toBe(false);
    expect(Object.keys(edge.impl ?? {})).toEqual(['m']);
  });
});

describe('declareConformance skips a same-block statement-route re-registration', () => {
  test('the evaluate pass keeps the installed `impl`; a re-entrant re-evaluation replaces it', () => {
    // The conformance no-op's witness, driven through the real handlers. The
    // full path grounds the block into a FRESH implementation map and assigns
    // it (`existing.impl = impl`), so an unchanged `impl` reference across the
    // evaluate pass can only mean the registration returned early. The third
    // registration is the CONTROL for the statement-route gate: the same
    // boxed statement re-evaluated with the route marker DOWN — a re-entrant
    // box-route call arriving under the same ambient batch with the same
    // block object — must take the full replacement path, so `impl` is
    // rebuilt. A regression in either direction (the no-op not firing, or the
    // gate widening to ambient-batch-only) fails one of the two assertions.
    executeEpsil(
      ce,
      `protocol P { function m(self: Self) -> integer }
type T = object{a: integer}`
    );
    const source = 'type T is P { function m(self: Self) -> integer { 1 } }';
    const { ast } = parseSource(source, undefined, ce);
    const stmtJson =
      Array.isArray(ast) && ast[0] === 'Block' ? (ast as unknown[])[1] : ast;

    // Simulate the statement route: a live batch and the declaration-route
    // marker, exactly what `execute-epsil.ts` raises around the statement.
    ce._epsilBatchId = 500;
    ce._epsilDeclarationRoute = true;
    const stmt = ce.box(stmtJson as Parameters<typeof ce.box>[0]);
    const edge = () => ce._protocolRegistry['P']!.conformances[0]!;
    const m1 = edge().impl;
    expect(m1).toBeDefined();
    expect(edge().pending).toBe(false);

    stmt.evaluate(); // The statement route's own re-registration: a no-op.
    expect(edge().impl).toBe(m1);

    ce._epsilDeclarationRoute = false;
    stmt.evaluate(); // Re-entrant box-route re-evaluation: full replacement.
    expect(edge().impl).not.toBe(m1);
    expect(edge().pending).toBe(false);

    ce._epsilBatchId = undefined;
  });
});
