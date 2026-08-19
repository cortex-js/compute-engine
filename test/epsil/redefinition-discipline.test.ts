import { ComputeEngine } from '../../src/compute-engine';
import { checkSource, parseSource } from '../../src/cli/check';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import type { ParsingDiagnostic } from '../../src/epsil/diagnostics';
import { typeToString } from '../../src/common/type/serialize';

//
// Redefinition rules for types, protocols, and function clauses.
//
// Redefinition means two different things depending on where it happens.
// Within one compilation unit (one Epsil program = one `executeEpsil` batch), a
// second `type`/`protocol` declaration of a name is a mistake and errors;
// across units it is the notebook gesture and keeps its per-construct
// replacement semantics. The boundary is the unit, not an engine mode.
//
// Two tiers detect the same condition by different means, because the static
// checker also runs with no batch at all (`epsil check` calls
// `staticDiagnostics` directly): a pass-local collector on the static tier, the
// batch stamp on the runtime tier. Both produce the same codes:
// `type-redefinition` / `protocol-redefinition` / `function-redefinition`.
//
// Function clauses follow the same rule when replacing a clause in the same
// unit; adding one at a distinct
// parameter list is untouched). Their static collector is keyed by parameter
// DOMAIN rather than by name, since one name legitimately carries many clauses
// — see "the discipline over function clauses" at the end of this file.
//

/** The diagnostic CODES of a diagnostic list, in order. */
function codes(diagnostics: readonly ParsingDiagnostic[]): string[] {
  return diagnostics.map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

/** The static pass on its own — the `epsil check` entry point's shape, run
 * against a caller-supplied engine so a test can also inspect what the pass
 * left behind. */
function staticCheck(ce: ComputeEngine, source: string): ParsingDiagnostic[] {
  const { ast, diagnostics } = parseSource(source, undefined, ce);
  expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  return staticDiagnostics(ce, ast!, source);
}

describe('REDEFINITION — static tier', () => {
  test('a second `type` declaration in one program errors, with both ranges', () => {
    const source = 'type Dup = integer\ntype Dup = string';
    const { diagnostics } = checkSource(source);
    expect(codes(diagnostics)).toEqual(['type-redefinition']);

    const [d] = diagnostics;
    expect(d.severity).toBe('error');
    expect(d.message).toEqual(['type-redefinition', 'Dup']);
    // The PRIMARY range is the second statement…
    expect(source.slice(d.range[0], d.range[1])).toBe('type Dup = string');
    // …and the note points at the first.
    expect(d.notes).toHaveLength(1);
    const note = d.notes![0];
    expect(note.message).toContain('first declared here');
    expect(source.slice(note.range![0], note.range![1])).toBe(
      'type Dup = integer'
    );
  });

  test('a second `protocol` declaration in one program errors', () => {
    const source = 'protocol P {}\nprotocol P {}';
    const { diagnostics } = checkSource(source);
    expect(codes(diagnostics)).toEqual(['protocol-redefinition']);
    expect(diagnostics[0].message).toEqual(['protocol-redefinition', 'P']);
    expect(diagnostics[0].notes?.[0].range).toEqual([0, 13]);
  });

  test('the SAME diagnostic arrives through the `executeEpsil` pre-pass', () => {
    // The static tier must fire on BOTH entry points: `checkSource` runs the
    // pass with no batch at all, `executeEpsil` runs it inside one.
    const ce = new ComputeEngine();
    const { diagnostics } = executeEpsil(
      ce,
      'type Dup = integer\ntype Dup = string\n1'
    );
    expect(
      diagnostics.filter((d) => codes([d])[0] === 'type-redefinition')
    ).toHaveLength(1);
  });

  test('one declaration of a name is never flagged', () => {
    expect(
      codes(checkSource('type Ok = integer\nprotocol Q {}\n1').diagnostics)
    ).toEqual([]);
  });

  test('`type X is P` — a bare conformance — is never flagged', () => {
    // It lowers to `DeclareConformance`, registers no type, and is outside the
    // discipline entirely: the gate is the AST HEAD, never the `type` keyword.
    const source = [
      'type point = tuple<x: number, y: number>',
      'protocol Marker {}',
      'type point is Marker',
      'type point is Marker',
    ].join('\n');
    expect(codes(checkSource(source).diagnostics)).toEqual([]);
  });

  test('a declaration in each of two SEPARATE programs is not a redefinition', () => {
    // The collector is pass-local: it never sees another unit's declarations.
    expect(codes(checkSource('type Solo = integer').diagnostics)).toEqual([]);
    expect(codes(checkSource('type Solo = string').diagnostics)).toEqual([]);
  });

  test('a statement REJECTED for another reason is not the recorded first declaration', () => {
    // `T` is already a HOST declaration, so neither `type T = …` statement
    // declares anything: both are refused by the `declaredByStatement` guard.
    // A collector that recorded names before the statement was validated would
    // make the FIRST (already-rejected) statement the "first declaration" and
    // report the second as a `type-redefinition` — a problem that does not
    // exist, and one the runtime tier does not report. The two tiers must
    // describe the same program the same way.
    const ce = new ComputeEngine();
    ce.declareType('T', 'boolean');
    const { diagnostics } = executeEpsil(
      ce,
      'type T = string\ntype T = number\n1'
    );
    expect(codes(diagnostics)).not.toContain('type-redefinition');
    // Both statements report the HOST conflict — the real problem, twice.
    const conflicts = diagnostics.filter((d) =>
      JSON.stringify(d.message).includes('already defined')
    );
    expect(conflicts).toHaveLength(2);
    // …and the host declaration is untouched.
    expect(typeToString(ce._typeRegistry['T'].def!)).toBe('boolean');
  });

  test('the protocol counterpart of the rejected-first-declaration rule', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('HostQ', {});
    const { diagnostics } = executeEpsil(
      ce,
      'protocol HostQ {}\nprotocol HostQ {}\n1'
    );
    expect(codes(diagnostics)).not.toContain('protocol-redefinition');
    const conflicts = diagnostics.filter((d) =>
      JSON.stringify(d.message).includes('already declared')
    );
    expect(conflicts).toHaveLength(2);
  });
});

describe('REDEFINITION — runtime tier', () => {
  test('the evaluation route produces an error VALUE with the same code', () => {
    const ce = new ComputeEngine();
    const { value } = executeEpsil(ce, 'type Dup = integer\ntype Dup = string');
    expect(value.toString()).toContain('type-redefinition');
  });

  test('a protocol duplicate produces the protocol code', () => {
    const ce = new ComputeEngine();
    const { value } = executeEpsil(ce, 'protocol P {}\nprotocol P {}');
    expect(value.toString()).toContain('protocol-redefinition');
  });

  test('REJECT BEFORE MUTATE — the first declaration survives intact', () => {
    const ce = new ComputeEngine();
    // Unit 1 establishes the record; everything that mentions `M` captures
    // THIS object (records are replaced in place).
    executeEpsil(ce, 'type M = tuple<a: integer>');
    const record = ce._typeRegistry['M'];
    expect(typeToString(record.def!)).toBe('tuple<a: integer>');

    // Unit 2 re-declares it (legal, across units) and then declares it a
    // SECOND time within itself (illegal). The duplicate is refused before the
    // replacement path re-opens the record — had the check run later, the
    // captured record would be left with no definition at all.
    const { diagnostics } = executeEpsil(
      ce,
      'type M = tuple<a: integer>\ntype M = tuple<b: string>\n1'
    );
    expect(codes(diagnostics)).toContain('type-redefinition');

    expect(ce._typeRegistry['M']).toBe(record);
    expect(typeToString(record.def!)).toBe('tuple<a: integer>');
    // …and the capture still resolves the original definition.
    expect(typeToString(ce._typeResolver.resolve('M')!.def!)).toBe(
      'tuple<a: integer>'
    );
  });

  test('STATEMENT IDENTITY — one statement registering three times never flags', () => {
    // A single `type` statement registers up to three times per batch: the
    // static pre-pass canonicalizes it, then the evaluation loop canonicalizes
    // AND evaluates it. All three carry the same statement identity.
    const ce = new ComputeEngine();
    const { diagnostics, value } = executeEpsil(
      ce,
      'type S = tuple<a: integer>\nprotocol SP {}\n42'
    );
    expect(codes(diagnostics)).toEqual([]);
    expect(value.toString()).toBe('42');
    expect(ce._typeRegistry['S']).toBeDefined();
    expect(ce._protocolRegistry['SP']).toBeDefined();

    // The stamp is on the record the EVALUATION left behind — the last of the
    // three registrations. It has to be: the statement-route marker is
    // restored, never consumed, so every registration a statement makes
    // carries the stamp. Were the marker consumed by its first reader, the
    // evaluate registration would land unstamped and the immunity would rest
    // on nothing.
    expect(ce._typeRegistry['S']._declOrigin?.batch).toBeDefined();
    expect(ce._protocolRegistry['SP']._declOrigin?.batch).toBeDefined();
    expect(ce._typeRegistry['S']._declOrigin!.batch).toBe(
      ce._protocolRegistry['SP']._declOrigin!.batch
    );
  });

  test('the error message names WHERE the first declaration is', () => {
    // `firstRange` — the first declaring statement's name operand — is what
    // makes the runtime message as informative as the static tier's two-range
    // diagnostic, which the runtime path cannot produce (it has the registry,
    // not the source).
    const ce = new ComputeEngine();
    const source = 'type Dup = integer\ntype Dup = string';
    const { value } = executeEpsil(ce, source);
    expect(value.toString()).toContain('at characters 5-8');
    expect(source.slice(5, 8)).toBe('Dup');
  });

  test('…and degrades gracefully when the first declaration has no source', () => {
    // A hand-built MathJSON operand carries no `sourceOffsets`, so there is no
    // site to name. Driven with the batch id and the statement-route marker set
    // by hand — the only way to reach a stamped registration whose anchor came
    // from no source text (the precedent is `test/compute-engine/
    // protocols.test.ts`, which sets `_epsilBatchId` the same way).
    const ce = new ComputeEngine();
    ce._epsilBatchId = 99;
    ce._epsilDeclarationRoute = true;
    try {
      ce.box(['DeclareType', 'NoRange', "'integer'"]).evaluate();
      expect(
        ce._typeRegistry['NoRange']._declOrigin?.firstRange
      ).toBeUndefined();
      const value = ce.box(['DeclareType', 'NoRange', "'string'"]).evaluate();
      expect(value.toString()).toContain('type-redefinition');
      expect(value.toString()).toContain('already declared earlier');
      expect(value.toString()).not.toContain('characters');
    } finally {
      ce._epsilBatchId = undefined;
      ce._epsilDeclarationRoute = false;
    }
  });

  test('PROTOCOL reject before mutate — the first declaration survives intact', () => {
    // The protocol path does materially more than the type path on a
    // replacement: it revalidates every conformance against the new
    // requirements, re-syncs the member dispatchers, and rolls back on a
    // widening violation. None of that may run for a refused duplicate.
    const ce = new ComputeEngine();
    const declaration = [
      'protocol Shown {',
      '  function show(self: Self) -> string',
      '}',
    ].join('\n');
    executeEpsil(ce, declaration);
    const record = ce._protocolRegistry['Shown'];
    expect(Object.keys(record.members)).toEqual(['show']);

    const { diagnostics } = executeEpsil(
      ce,
      [
        declaration,
        'protocol Shown {',
        '  function render(self: Self) -> number',
        '}',
        '1',
      ].join('\n')
    );
    expect(codes(diagnostics)).toContain('protocol-redefinition');

    // The record is the SAME object, with its ORIGINAL requirement set…
    expect(ce._protocolRegistry['Shown']).toBe(record);
    expect(Object.keys(record.members)).toEqual(['show']);
    // …the capture resolves it unchanged…
    expect(Object.keys(ce._protocolRegistry['Shown'].members)).toEqual([
      'show',
    ]);
    // …and the dispatchers still describe the original protocol: `show` is
    // installed, and the refused declaration's `render` never was.
    expect(ce.lookupDefinition('show')).toBeDefined();
    expect(ce.lookupDefinition('render')).toBeUndefined();
  });
});

describe('REDEFINITION — stamp hygiene', () => {
  test('checking a program twice on one engine gives the identical result', () => {
    const ce = new ComputeEngine();
    const source = 'type H = tuple<a: integer>\nprotocol HP {}\n1';
    expect(codes(staticCheck(ce, source))).toEqual([]);
    expect(codes(staticCheck(ce, source))).toEqual([]);
    // The pre-pass rolls its registrations back, stamp included.
    expect(ce._typeRegistry['H']).toBeUndefined();
    expect(ce._protocolRegistry['HP']).toBeUndefined();
  });

  test('`epsil check` twice over the same source agrees', () => {
    const source = 'type Dup = integer\ntype Dup = string';
    const first = checkSource(source).diagnostics;
    const second = checkSource(source).diagnostics;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('CHECK THEN EXECUTE — a checked program still runs clean', () => {
    // The hazard the rollback schema exists for: a stamp left behind by the
    // pre-pass would make the evaluation loop's registration of that very
    // statement (a fresh boxing, hence a different statement identity) look
    // like a second declaration of the same unit.
    const ce = new ComputeEngine();
    const source = 'type H = tuple<a: integer>\nprotocol HP {}\n1';
    expect(codes(staticCheck(ce, source))).toEqual([]);
    expect(codes(executeEpsil(ce, source).diagnostics)).toEqual([]);
    // …and re-running it as a LATER unit is still the replacement gesture.
    expect(codes(executeEpsil(ce, source).diagnostics)).toEqual([]);
    expect(typeToString(ce._typeRegistry['H'].def!)).toBe('tuple<a: integer>');
  });
});

describe('REDEFINITION — sum sugar (the generated-name rule)', () => {
  test('a PARTIAL within-unit collision is ONE diagnostic, and nothing is registered', () => {
    const ce = new ComputeEngine();
    const { diagnostics } = executeEpsil(
      ce,
      [
        'type res = ok(v: number) | err(m: string)',
        'type res = ok(v: number) | oops(m: string)',
        '1',
      ].join('\n')
    );
    // ONE diagnostic, anchored on the statement — never one per colliding name
    // (`ok` and `res` both collide here).
    const redefinitions = diagnostics.filter(
      (d) => codes([d])[0] === 'type-redefinition'
    );
    expect(redefinitions).toHaveLength(1);
    expect(redefinitions[0].message).toEqual(['type-redefinition', 'res']);

    // ATOMIC: the rejected statement registered none of its N+1 names, and the
    // first statement's names are all intact.
    expect(ce._typeRegistry['oops']).toBeUndefined();
    expect(ce._typeRegistry['ok']).toBeDefined();
    expect(ce._typeRegistry['err']).toBeDefined();
    expect(ce._typeRegistry['res']._sumVariants?.map((v) => v.name)).toEqual([
      'ok',
      'err',
    ]);
  });

  test('a variant name reused by a DIFFERENT sum in one unit is the same one diagnostic', () => {
    const ce = new ComputeEngine();
    const { diagnostics } = executeEpsil(
      ce,
      [
        'type a = ok(v: number) | err(m: string)',
        'type b = ok(v: number) | nope(m: string)',
        '1',
      ].join('\n')
    );
    const redefinitions = diagnostics.filter(
      (d) => codes([d])[0] === 'type-redefinition'
    );
    expect(redefinitions).toHaveLength(1);
    expect(ce._typeRegistry['b']).toBeUndefined();
    expect(ce._typeRegistry['nope']).toBeUndefined();
  });

  test('ACROSS units a sum replaces wholesale, and a dropped variant survives', () => {
    const ce = new ComputeEngine();
    expect(
      codes(
        executeEpsil(ce, 'type res = ok(v: number) | err(m: string)')
          .diagnostics
      )
    ).toEqual([]);
    expect(
      codes(
        executeEpsil(ce, 'type res = ok(v: number) | oops(m: string)')
          .diagnostics
      )
    ).toEqual([]);

    expect(ce._typeRegistry['res']._sumVariants?.map((v) => v.name)).toEqual([
      'ok',
      'oops',
    ]);
    // A dropped variant keeps its shipped behaviour: it stays an ordinary
    // nominal type, only its MEMBERSHIP ended.
    expect(ce._typeRegistry['err']).toBeDefined();
    expect(ce._typeRegistry['err']._sumOf).toBeUndefined();
  });
});

describe('REDEFINITION — the route/origin matrix', () => {
  test('statement vs statement, SAME unit: error', () => {
    const ce = new ComputeEngine();
    expect(
      codes(
        executeEpsil(ce, 'type R = integer\ntype R = string\n1').diagnostics
      )
    ).toContain('type-redefinition');
  });

  test('statement vs statement, LATER unit: replaces (unchanged)', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type R = tuple<a: integer>');
    expect(
      codes(executeEpsil(ce, 'type R = tuple<b: string>').diagnostics)
    ).toEqual([]);
    expect(typeToString(ce._typeRegistry['R'].def!)).toBe('tuple<b: string>');

    executeEpsil(ce, 'protocol RP {}');
    expect(
      codes(executeEpsil(ce, 'protocol RP { readonly n: number }').diagnostics)
    ).toEqual([]);
    expect(Object.keys(ce._protocolRegistry['RP'].members)).toEqual(['n']);
  });

  test('BOX-ROUTE statement leaves no stamp, so a later statement replaces it', () => {
    const ce = new ComputeEngine();
    // A box-route `Declare*` is a statement without a compilation unit.
    ce.box(['DeclareType', 'B', "'integer'"]).evaluate();
    expect(ce._typeRegistry['B']._declOrigin).toBeUndefined();
    expect(
      codes(executeEpsil(ce, 'type B = tuple<a: integer>').diagnostics)
    ).toEqual([]);
    expect(typeToString(ce._typeRegistry['B'].def!)).toBe('tuple<a: integer>');
  });

  test('a RE-ENTRANT box-route declaration mid-batch is unstamped, and the program may still declare that name', () => {
    // The hazard: `ce._epsilBatchId` is ambient for the whole `executeEpsil`
    // extent, so a `ce.box(["DeclareType", …]).evaluate()` a host operator
    // performs re-entrantly goes through the very same `Declare*` handlers
    // with a batch live. Stamping on "a batch is set" would make that
    // registration a statement of the running program, and the program's own
    // declaration of the name would then falsely report `type-redefinition`.
    // Stamping keys on the statement ROUTE instead.
    const ce = new ComputeEngine();
    let stampSeenInsideHandler: unknown = 'the handler never ran';
    ce.declare('BoxDeclare', {
      signature: '() -> nothing',
      evaluate: () => {
        ce.box(['DeclareType', 'BT', "'integer'"]).evaluate();
        ce.box(['DeclareProtocol', 'BTP']).evaluate();
        stampSeenInsideHandler = ce._typeRegistry['BT']._declOrigin;
        return ce.Nothing;
      },
    });
    const { diagnostics, value } = executeEpsil(
      ce,
      'BoxDeclare()\ntype BT = tuple<a: integer>\nprotocol BTP {}\n1'
    );
    expect(stampSeenInsideHandler).toBeUndefined();
    expect(ce._protocolRegistry['BTP']).toBeDefined();
    // The outer program's declarations REPLACE the box-route records.
    expect(codes(diagnostics)).toEqual([]);
    expect(value.toString()).toBe('1');
    expect(typeToString(ce._typeRegistry['BT'].def!)).toBe('tuple<a: integer>');
  });

  test('Epsil statement vs BOX-ROUTE incoming: replaces, and the stamp is cleared', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type E1 = tuple<a: integer>');
    expect(ce._typeRegistry['E1']._declOrigin).toBeDefined();
    // A box-route `Declare*` is a statement of no compilation unit, so it is
    // not a same-unit collision — it replaces, and leaves the record unstamped
    // (an unstamped record is one no statement of the current unit owns).
    const value = ce.box(['DeclareType', 'E1', "'integer'"]).evaluate();
    expect(value.toString()).toBe('"Nothing"');
    expect(typeToString(ce._typeRegistry['E1'].def!)).toBe('integer');
    expect(ce._typeRegistry['E1']._declOrigin).toBeUndefined();
  });

  test('Epsil statement vs HOST API incoming: throws (unchanged)', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type E2 = tuple<a: integer>');
    expect(() => ce.declareType('E2', 'integer')).toThrow(/already defined/);
    expect(typeToString(ce._typeRegistry['E2'].def!)).toBe('tuple<a: integer>');

    executeEpsil(ce, 'protocol E2P {}');
    expect(() => ce.declareProtocol('E2P', {})).toThrow(/already declared/);
  });

  test('BOX-ROUTE vs box-route: replaces, both unstamped', () => {
    const ce = new ComputeEngine();
    ce.box(['DeclareType', 'BB', "'integer'"]).evaluate();
    const value = ce.box(['DeclareType', 'BB', "'string'"]).evaluate();
    expect(value.toString()).toBe('"Nothing"');
    expect(typeToString(ce._typeRegistry['BB'].def!)).toBe('string');
    expect(ce._typeRegistry['BB']._declOrigin).toBeUndefined();

    ce.box(['DeclareProtocol', 'BBP']).evaluate();
    const protocolValue = ce.box(['DeclareProtocol', 'BBP']).evaluate();
    expect(protocolValue.toString()).toBe('"Nothing"');
    expect(ce._protocolRegistry['BBP']._declOrigin).toBeUndefined();
  });

  test('HOST declaration vs box-route incoming: error (unchanged, not the new code)', () => {
    const ce = new ComputeEngine();
    ce.declareType('HB2', 'integer');
    const value = ce.box(['DeclareType', 'HB2', "'string'"]).evaluate();
    expect(value.toString()).toContain('invalid-type-declaration');
    expect(value.toString()).not.toContain('type-redefinition');
    expect(typeToString(ce._typeRegistry['HB2'].def!)).toBe('integer');

    ce.declareProtocol('HB2P', {});
    const protocolValue = ce.box(['DeclareProtocol', 'HB2P']).evaluate();
    expect(protocolValue.toString()).toContain('invalid-protocol-declaration');
    expect(protocolValue.toString()).not.toContain('protocol-redefinition');
  });

  test('HOST declaration vs statement: error (unchanged, not the new code)', () => {
    const ce = new ComputeEngine();
    ce.declareType('HostT', 'integer');
    const { diagnostics } = executeEpsil(ce, 'type HostT = string\n1');
    const reported = codes(diagnostics);
    expect(reported).not.toContain('type-redefinition');
    // The pre-existing `declaredByStatement` guard still refuses it.
    expect(JSON.stringify(diagnostics)).toContain('already defined');
    expect(typeToString(ce._typeRegistry['HostT'].def!)).toBe('integer');
  });

  test('the HOST API throws on redeclaration, and leaves no stamp', () => {
    const ce = new ComputeEngine();
    ce.declareType('HostU', 'integer');
    expect(() => ce.declareType('HostU', 'string')).toThrow(/already defined/);
    expect(ce._typeRegistry['HostU']._declOrigin).toBeUndefined();

    ce.declareProtocol('HostP', {});
    expect(() => ce.declareProtocol('HostP', {})).toThrow(/already declared/);
    expect(ce._protocolRegistry['HostP']._declOrigin).toBeUndefined();
  });

  test('the host API is a ROUTE: re-entrant mid-batch calls still throw, unstamped', () => {
    // `ce._epsilBatchId` is ambient engine state for the whole `executeEpsil`
    // extent, so "a batch is live" does not mean "the statement route". A host
    // `declareType()` called from an operator's evaluate handler is still the
    // host API.
    const ce = new ComputeEngine();
    let thrown: unknown;
    ce.declare('HostDeclare', {
      signature: '() -> nothing',
      evaluate: () => {
        ce.declareType('HB', 'integer');
        try {
          ce.declareType('HB', 'string');
        } catch (e) {
          thrown = e;
        }
        return ce.Nothing;
      },
    });
    executeEpsil(ce, 'HostDeclare()\n1');
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/already defined/);
    expect(ce._typeRegistry['HB']._declOrigin).toBeUndefined();
    expect(typeToString(ce._typeRegistry['HB'].def!)).toBe('integer');
  });
});

describe('REDEFINITION — nested runs are separate units', () => {
  /** Install an operator that re-enters the interpreter with `inner`. */
  function withReentry(ce: ComputeEngine, inner: string): ParsingDiagnostic[] {
    const innerDiagnostics: ParsingDiagnostic[] = [];
    ce.declare('Reenter', {
      signature: '() -> nothing',
      evaluate: () => {
        innerDiagnostics.push(...executeEpsil(ce, inner).diagnostics);
        return ce.Nothing;
      },
    });
    return innerDiagnostics;
  }

  test('an inner run is exempt from the outer unit, and the outer continues', () => {
    const ce = new ComputeEngine();
    withReentry(ce, 'type Inner = tuple<b: string>');
    const { diagnostics, value } = executeEpsil(
      ce,
      'type Inner = tuple<a: integer>\nReenter()\n7'
    );
    // The inner declaration is a DIFFERENT program: not a collision, so it
    // replaces — and the outer program runs to completion.
    expect(codes(diagnostics)).toEqual([]);
    expect(value.toString()).toBe('7');
    expect(typeToString(ce._typeRegistry['Inner'].def!)).toBe(
      'tuple<b: string>'
    );
  });

  test('the outer unit is intact after an inner run FAILS', () => {
    const ce = new ComputeEngine();
    const inner = withReentry(
      ce,
      'type Nested = integer\ntype Nested = string\n1'
    );
    const { diagnostics, value } = executeEpsil(
      ce,
      'type Outer = tuple<a: integer>\nReenter()\ntype Outer2 = tuple<b: string>\n7'
    );
    expect(codes(inner)).toContain('type-redefinition');
    // The inner failure is the inner unit's; the outer one is unaffected and
    // its own later declaration still lands.
    expect(codes(diagnostics)).toEqual([]);
    expect(value.toString()).toBe('7');
    expect(typeToString(ce._typeRegistry['Outer'].def!)).toBe(
      'tuple<a: integer>'
    );
    expect(typeToString(ce._typeRegistry['Outer2'].def!)).toBe(
      'tuple<b: string>'
    );
    // The inner unit's rejected duplicate left the first inner declaration.
    expect(typeToString(ce._typeRegistry['Nested'].def!)).toBe('integer');
  });
});

//
// FUNCTION CLAUSES — the borderline the discipline's v1 left silent, closed by
// user ruling 2026-08-14.
//
// Only a REPLACEMENT is refused: a clause whose parameter domain coincides with
// one already defined in this program, which would silently discard it. Clause
// ADDITION at a distinct parameter list is the whole point of multi-clause
// functions and is never affected. Across units it stays last-wins, and the
// host routes (`ce.parse`/`ce.evaluate`/`ce.declare`) are unstamped, so the
// rule never reaches them.
//
describe('the discipline over function clauses', () => {
  /** The error codes an Epsil run reports, from either tier. */
  function runCodes(ce: ComputeEngine, source: string): string[] {
    const { diagnostics } = executeEpsil(ce, source);
    return diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => JSON.stringify(d.message));
  }

  describe('clause ADDITION is untouched', () => {
    test('the fibonacci idiom accumulates across three statements', () => {
      const ce = new ComputeEngine();
      const { diagnostics, value } = executeEpsil(
        ce,
        'f(0)=1\nf(1)=1\nf(n)=f(n-1)+f(n-2)\nf(10)'
      );
      expect(diagnostics).toEqual([]);
      expect(value.toString()).toBe('89');
    });

    test('clauses of different ARITY are different clauses', () => {
      const ce = new ComputeEngine();
      const { diagnostics, value } = executeEpsil(
        ce,
        'h(0)=1\nh(n)=n\nh(a,b)=a+b\nh(3,4)'
      );
      expect(diagnostics).toEqual([]);
      expect(value.toString()).toBe('7');
    });

    test('distinct literal patterns dispatch, and the catch-all still lands', () => {
      const ce = new ComputeEngine();
      const { diagnostics, value } = executeEpsil(
        ce,
        'mode("fast")=1\nmode("slow")=2\nmode(s: string)=0\nmode("slow")'
      );
      expect(diagnostics).toEqual([]);
      expect(value.toString()).toBe('2');
    });
  });

  describe('clause REPLACEMENT within one program is refused', () => {
    test('the same parameter list twice', () => {
      const ce = new ComputeEngine();
      expect(runCodes(ce, 'g(n)=1\ng(n)=2\ng(5)').join()).toContain(
        'function-redefinition'
      );
    });

    test('renaming the parameter does not make it a different clause', () => {
      // Dispatch keys on the parameter DOMAIN, not on parameter names, so
      // `g(m)` would overwrite `g(n)` just as silently.
      const ce = new ComputeEngine();
      expect(runCodes(ce, 'g(n)=1\ng(m)=2\ng(5)').join()).toContain(
        'function-redefinition'
      );
    });

    test('a duplicated LITERAL clause', () => {
      const ce = new ComputeEngine();
      expect(runCodes(ce, 'k(0)=1\nk(0)=2\nk(0)').join()).toContain(
        'function-redefinition'
      );
    });

    test('the refusal names the function and points at the first definition', () => {
      const ce = new ComputeEngine();
      const { diagnostics } = executeEpsil(ce, 'g(n)=1\ng(n)=2\ng(5)');
      // The human-readable half of the runtime-tier error value.
      const message = diagnostics
        .flatMap((d) => (Array.isArray(d.message) ? d.message : [d.message]))
        .map(String)
        .join(' ');
      expect(message).toContain('A clause of "g"');
      expect(message).toContain('already defined');
      // The first definition's site, so the report points at both ends.
      expect(message).toMatch(/at characters \d+-\d+/);
    });
  });

  describe('ACROSS units it stays last-wins (the notebook gesture)', () => {
    test('a re-run clause replaces, with no diagnostic', () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'q(n)=1');
      const edited = executeEpsil(ce, 'q(n)=n+100');
      expect(edited.diagnostics).toEqual([]);
      expect(executeEpsil(ce, 'q(5)').value.toString()).toBe('105');
    });

    test('a re-run replaces only its OWN clause, leaving the others', () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'w(0)=1\nw(n)=n+1');
      const edited = executeEpsil(ce, 'w(0)=999');
      expect(edited.diagnostics).toEqual([]);
      expect(executeEpsil(ce, 'w(0)').value.toString()).toBe('999');
      expect(executeEpsil(ce, 'w(5)').value.toString()).toBe('6');
    });

    test('a clause ADDED by a later program still appends', () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'p(0)=1');
      const added = executeEpsil(ce, 'p(n)=n+100');
      expect(added.diagnostics).toEqual([]);
      expect(executeEpsil(ce, 'p(0)').value.toString()).toBe('1');
      expect(executeEpsil(ce, 'p(5)').value.toString()).toBe('105');
    });
  });

  describe('the STATIC tier reports it before anything runs', () => {
    // `epsil check` never evaluates, so the runtime tier's batch stamp cannot
    // reach it (`checkSource` runs with no batch at all). The static tier is a
    // pass-local collector of the clauses the unit defines, keyed by parameter
    // DOMAIN — computed from the canonicalized literal, because an unannotated
    // parameter has no type in the source to read.
    test('`epsil check` flags a duplicated clause', () => {
      const source = 'g(n) = 1\ng(n) = 2\ng(5)';
      const { diagnostics } = checkSource(source);
      expect(codes(diagnostics)).toEqual(['function-redefinition']);

      const [d] = diagnostics;
      expect(d.message).toEqual(['function-redefinition', 'g']);
      // The PRIMARY range is the second definition…
      expect(source.slice(d.range[0], d.range[1])).toBe('g(n) = 2');
      // …and the note points at the first.
      expect(d.notes).toHaveLength(1);
      expect(d.notes![0].message).toContain('first defined here');
      expect(source.slice(d.notes![0].range![0], d.notes![0].range![1])).toBe(
        'g(n) = 1'
      );
    });

    test('renaming the parameter is still the same clause statically', () => {
      // The domain test is TYPE-level, not syntactic — which is why this tier
      // needs the canonicalized literal rather than the raw AST.
      expect(
        codes(checkSource('g(n) = 1\ng(m) = 2\ng(5)').diagnostics)
      ).toEqual(['function-redefinition']);
    });

    test('an annotated duplicate, and a distinct annotation that is not one', () => {
      expect(
        codes(checkSource('p(n: integer)=1\np(m: integer)=2\np(1)').diagnostics)
      ).toEqual(['function-redefinition']);
      expect(
        codes(checkSource('p(n: integer)=1\np(s: string)=2\np(1)').diagnostics)
      ).toEqual([]);
    });

    test('clause ADDITION passes the static tier clean', () => {
      expect(
        codes(
          checkSource('f(0)=1\nf(1)=1\nf(n)=f(n-1)+f(n-2)\nf(10)').diagnostics
        )
      ).toEqual([]);
      expect(
        codes(checkSource('h(0)=1\nh(n)=n\nh(a,b)=a+b\nh(3,4)').diagnostics)
      ).toEqual([]);
      expect(
        codes(
          checkSource(
            'mode("fast")=1\nmode("slow")=2\nmode(s: string)=0\nmode("slow")'
          ).diagnostics
        )
      ).toEqual([]);
    });

    test('the collector is pass-local: two separate programs are not a redefinition', () => {
      expect(codes(checkSource('q(n) = 1').diagnostics)).toEqual([]);
      expect(codes(checkSource('q(n) = 2').diagnostics)).toEqual([]);
    });

    test('three definitions of one clause report twice, both against the first', () => {
      const source = 'g(n)=1\ng(n)=2\ng(n)=3\ng(5)';
      const { diagnostics } = checkSource(source);
      expect(codes(diagnostics)).toEqual([
        'function-redefinition',
        'function-redefinition',
      ]);
      // A refused clause never becomes a "first definition", so both reports
      // point at the one statement that did define the clause.
      for (const d of diagnostics)
        expect(source.slice(d.notes![0].range![0], d.notes![0].range![1])).toBe(
          'g(n)=1'
        );
    });

    test('a GENERIC function is left to the single-clause rule', () => {
      // Rule G2 refuses a second clause on a generic definition as
      // `generic-clause-unsupported`; the static tier must not pre-empt it with
      // a redefinition report naming a different problem.
      const source =
        'function id<T>(x: T) -> T { x }\nfunction id<T>(y: T) -> T { y }\nid(1)';
      expect(codes(checkSource(source).diagnostics)).toEqual([]);
    });

    test('the SAME diagnostic arrives through the `executeEpsil` pre-pass', () => {
      const ce = new ComputeEngine();
      const { diagnostics } = executeEpsil(ce, 'g(n)=1\ng(n)=2\ng(5)');
      expect(
        diagnostics.filter((d) => codes([d])[0] === 'function-redefinition')
      ).toHaveLength(1);
    });

    test('the static pass leaves no residue: a second check reports the same', () => {
      const ce = new ComputeEngine();
      const source = 'g(n)=1\ng(n)=2\ng(5)';
      expect(codes(staticCheck(ce, source))).toEqual(['function-redefinition']);
      expect(codes(staticCheck(ce, source))).toEqual(['function-redefinition']);
    });
  });

  describe('provenance does not outlive the clause it describes', () => {
    // All three regressions below were found by the dual code review of this
    // change. Their common cause: the side-channels that describe a LONE clause
    // are keyed on the definition RECORD, which is mutated in place and so
    // survives events that discard the clause itself.
    test('an ASSIGNMENT between two clauses is not a redefinition', () => {
      // Assignment full-replaces (D6), so the clause defined afterwards is the
      // first clause of a fresh binding. Reporting it as a redefinition of the
      // pre-assignment clause both cited a statement whose clause was gone AND
      // refused to install the new one — the program answered 42.
      const ce = new ComputeEngine();
      const { value, diagnostics } = executeEpsil(
        ce,
        'f(n) = 1\nf = (x => 42)\nf(m) = 2\nf(0)'
      );
      expect(diagnostics).toEqual([]);
      expect(value.toString()).toBe('2');
      // Both tiers agree: `epsil check` must not report it either.
      expect(
        codes(
          checkSource('f(n) = 1\nf = (x => 42)\nf(m) = 2\nf(0)').diagnostics
        )
      ).toEqual([]);
    });

    test('a clause defined after an assignment still installs', () => {
      const ce = new ComputeEngine();
      const { value, diagnostics } = executeEpsil(
        ce,
        'g(n) = 1\ng = x => 2\ng(n) = 3\ng(9)'
      );
      expect(diagnostics).toEqual([]);
      expect(value.toString()).toBe('3');
    });

    test('a refused duplicate does not disable the static tier for later units', () => {
      // The canonicalization-time "install skipped" marker is sticky for the
      // life of the definition record, and the static collector consults it. A
      // redefinition refusal must NOT set it: the earlier clause is still
      // installed and valid, so there is no divergence to protect against.
      // Marking made one duplicate poison the name forever — the next cell
      // silently lost the diagnostic it was promised.
      const ce = new ComputeEngine();
      executeEpsil(ce, 'g(n)=1\ng(m)=2');
      const later = executeEpsil(ce, 'g(a)=10\ng(b)=20\ng(1)');
      expect(codes(later.diagnostics)).toContain('function-redefinition');
    });
  });

  describe('the host route is exempt', () => {
    test('a box-route definition replaces freely, with no batch to collide in', () => {
      const ce = new ComputeEngine();
      const clause = (body: unknown, param: unknown) =>
        ['Function', body, param] as never;
      ce.box(['DefineFunction', 'z', clause(1, 'n')] as never).evaluate();
      ce.box([
        'DefineFunction',
        'z',
        clause(['Add', 'n', 100], 'n'),
      ] as never).evaluate();
      expect(
        ce
          .box(['z', 5] as never)
          .evaluate()
          .toString()
      ).toBe('105');
    });
  });
});
