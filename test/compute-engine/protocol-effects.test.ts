import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';

//
// Phase 0a of the mutable-objects plan
// (`docs/TYPE-SYSTEM.md`),
// whose normative spec is `docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B,
// "Changing a field is an effect":
//
// - A protocol function requirement with a BARE effect specifier imposes no
//   bound. The dispatcher's effect set is the union of the DECLARED ceilings
//   of the requirements that spell one, plus — for the bare ones — the union
//   of the inferred effects of the registered conforming implementations. It
//   is therefore DERIVED, and widens as conformances register.
// - Everything cached off that union must recompute: a call expression's
//   purity, and the effect set of any user function whose body inference
//   consulted it.
//
// `DeclareProtocol` and `DeclareConformance` are LAZY operators, so every
// acceptance item below is exercised on each route where it is observable:
// the BOX route (`ce.box([...]).evaluate()`), the EPSIL statement route
// (`executeEpsil`), and the HOST API route (`ce.declareProtocol` /
// `ce.declareProtocolImplementation`). A suite that exercised only one route
// would miss the held-operand failure class entirely.
//
// The ceiling MATRIX and the widening guard's diagnostic text are pinned in
// `test/compute-engine/protocols.test.ts` and `test/epsil/protocols.test.ts`;
// what those two files do not cover — the derived union itself, its cache
// invalidation, and route parity for the two guards — is what lives here.
//
// Protocols are engine-global, so every test builds a fresh `ComputeEngine`.
//
// TRAP: a `DeclareConformance` registered on the BOX route stores its
// implementation literals UNBOUND, and dispatching THROUGH one later throws
// ("Function body must be a scoped Block expression"). That is pre-existing
// and orthogonal to effects, so the box-route tests below read effects,
// purity and types only — they never CALL a box-route-registered
// implementation. Epsil-route implementations are callable, and one test
// does call one.
//

const SPEAK_SIG = '(self: Self) -> string';

/** `["DeclareProtocol", "Speaker", {speak: function <sig>}]` — the box-route
 * spelling of `protocol Speaker { function speak… }`. */
const declareSpeaker = (sig: string = SPEAK_SIG): any => [
  'DeclareProtocol',
  'Speaker',
  [
    'Dictionary',
    ['KeyValuePair', 'speak', ['Pair', { str: 'function' }, { str: sig }]],
  ],
];

/** A `speak` implementation literal with a BARE effect marker and `body` for
 * a body — the shape the `implement` helper of `protocols.test.ts` builds. */
const speakImpl = (body: any): any => [
  'Function',
  ['Typed', body, { str: SPEAK_SIG }],
  ['Typed', 'self', { str: 'Self' }],
];

/** Returns `"hi"`; infers no effects. */
const PURE_IMPL = speakImpl({ str: 'hi' });

/** Calls `Random()`; infers `{random}`. Its own marker stays bare, so the
 * union it widens comes from the BODY walk, not from a declaration. */
const DRAWING_IMPL = speakImpl(['Block', ['Random'], { str: 'r' }]);

/** `type <target> is Speaker { <members> }` on the box route. */
const implement = (
  ce: ComputeEngine,
  target: string,
  members: Record<string, any>
) =>
  ce
    .box([
      'DeclareConformance',
      { str: target },
      ['List', 'Speaker'],
      [
        'Dictionary',
        ...Object.entries(members).map(([k, v]) => ['KeyValuePair', k, v]),
      ],
    ] as any)
    .evaluate();

/** The Epsil spellings of the same three statements. */
const EPSIL_PROTOCOL =
  'protocol Speaker {\n  function speak(self: Self) -> string\n}';
const EPSIL_PURE_CONFORMANCE =
  'type string is Speaker {\n  function speak(self: Self) -> string { "hi" }\n}';
const EPSIL_DRAWING_CONFORMANCE =
  'type number is Speaker {\n  function speak(self: Self) -> string { Random() }\n}';

/** The operator half of a binding — where a dispatcher's effect set lives. */
const opDef = (ce: ComputeEngine, name: string) =>
  ce.lookupDefinition(name)!['operator'];

/** A fresh `speak("x")` call expression. Fresh matters where a test is about
 * a CACHE recomputing: two probes must not share a boxed node unless the test
 * is specifically about the shared one. */
const speakCall = (ce: ComputeEngine) => ce.box(['speak', { str: 'x' }] as any);

describe('Phase 0a: a BARE requirement is pure while its conformers are', () => {
  test('BOX ROUTE: the dispatcher of a bare requirement is pure, and a PURE conformer leaves it so', () => {
    const ce = new ComputeEngine();
    expect(ce.box(declareSpeaker()).evaluate().json).toBe('Nothing');

    // No specifier on the requirement, none on the dispatcher.
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');
    expect(opDef(ce, 'speak').effects).toBeUndefined();
    expect(opDef(ce, 'speak').pure).toBe(true);
    expect(speakCall(ce).isPure).toBe(true);

    expect(implement(ce, 'string', { speak: PURE_IMPL }).json).toBe('Nothing');

    expect(opDef(ce, 'speak').pure).toBe(true);
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');
    expect(speakCall(ce).isPure).toBe(true);
  });

  test('EPSIL ROUTE: the same, through `protocol` and `type … is …` statements', () => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, EPSIL_PROTOCOL).value.json).toBe('Nothing');
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');
    expect(speakCall(ce).isPure).toBe(true);

    expect(executeEpsil(ce, EPSIL_PURE_CONFORMANCE).value.json).toBe('Nothing');

    expect(opDef(ce, 'speak').effects).toBeUndefined();
    expect(opDef(ce, 'speak').pure).toBe(true);
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');
    expect(speakCall(ce).isPure).toBe(true);
    // Unlike a box-route implementation, an Epsil one is callable.
    expect(executeEpsil(ce, 'speak("x")').value.toString()).toBe('"hi"');
  });

  test('HOST ROUTE: a host CALLBACK conformer contributes the empty set', () => {
    // A host callback is trusted exactly as a host operator handler is: it
    // declares its own effects or none, and there is no body for the walk to
    // read. So a bare requirement served entirely by host implementations
    // stays pure, and calls through it stay pure.
    const ce = new ComputeEngine();
    ce.declareProtocol('Speaker', { functions: { speak: SPEAK_SIG } });
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');
    expect(speakCall(ce).isPure).toBe(true);

    const speak = (): string => 'hi';
    ce.declareProtocolImplementation('string', 'Speaker', {
      functions: { speak },
    });

    expect(opDef(ce, 'speak').effects).toBeUndefined();
    expect(opDef(ce, 'speak').pure).toBe(true);
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');
    expect(speakCall(ce).isPure).toBe(true);
    expect(speakCall(ce).evaluate().toString()).toBe('"hi"');
  });
});

describe('Phase 0a: the union WIDENS on the first drawing conformance', () => {
  test('BOX ROUTE: the dispatcher gains `random`', () => {
    const ce = new ComputeEngine();
    ce.box(declareSpeaker()).evaluate();
    implement(ce, 'string', { speak: PURE_IMPL });
    expect(opDef(ce, 'speak').pure).toBe(true);

    expect(implement(ce, 'number', { speak: DRAWING_IMPL }).json).toBe(
      'Nothing'
    );

    expect(opDef(ce, 'speak').effects).toEqual(['random']);
    expect(opDef(ce, 'speak').pure).toBe(false);
    expect(opDef(ce, 'speak').drawsRandom).toBe(true);
    expect(speakCall(ce).isPure).toBe(false);
  });

  test('BOX ROUTE: a call expression boxed BEFORE the registration recomputes its purity', () => {
    // The cache-invalidation acceptance: the union is memoized on the
    // conformance-registry version, and registering a conformer advances it,
    // so a node that already answered `true` must answer `false` afterwards.
    const ce = new ComputeEngine();
    ce.box(declareSpeaker()).evaluate();
    implement(ce, 'string', { speak: PURE_IMPL });

    const call = speakCall(ce);
    expect(call.isPure).toBe(true);

    implement(ce, 'number', { speak: DRAWING_IMPL });

    expect(call.isPure).toBe(false);
  });

  test('BOX ROUTE: a user function defined BEFORE the registration re-derives', () => {
    // A lambda-backed definition whose body inference consulted a derived
    // union does not FREEZE what it saw: it keeps a deriver that re-runs the
    // walk (`consultsRegistry` in `effects-inference.ts`). Otherwise `g` would
    // still claim to be pure after the conformance made it draw.
    const ce = new ComputeEngine();
    ce.box(declareSpeaker()).evaluate();
    implement(ce, 'string', { speak: PURE_IMPL });

    ce.assign(
      'g',
      ce.box(['Function', ['Block', ['speak', { str: 'x' }]]] as any)
    );
    expect(opDef(ce, 'g').effects).toBeUndefined();
    expect(opDef(ce, 'g').pure).toBe(true);
    expect(ce.symbol('g').type.toString()).toBe('() -> string');

    implement(ce, 'number', { speak: DRAWING_IMPL });

    expect(opDef(ce, 'g').effects).toEqual(['random']);
    expect(opDef(ce, 'g').pure).toBe(false);
    expect(opDef(ce, 'g').drawsRandom).toBe(true);
    expect(ce.symbol('g').type.toString()).toBe('() random -> string');
    expect(ce.box(['g'] as any).isPure).toBe(false);
  });

  test('EPSIL ROUTE: the dispatcher gains `random`, and a call boxed before recomputes', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, EPSIL_PROTOCOL);
    executeEpsil(ce, EPSIL_PURE_CONFORMANCE);

    const call = speakCall(ce);
    expect(call.isPure).toBe(true);

    expect(executeEpsil(ce, EPSIL_DRAWING_CONFORMANCE).value.json).toBe(
      'Nothing'
    );

    expect(opDef(ce, 'speak').effects).toEqual(['random']);
    expect(opDef(ce, 'speak').pure).toBe(false);
    expect(opDef(ce, 'speak').drawsRandom).toBe(true);
    expect(call.isPure).toBe(false);
    expect(speakCall(ce).isPure).toBe(false);
  });

  test('EPSIL ROUTE: a function defined BEFORE the registration re-derives', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, EPSIL_PROTOCOL);
    executeEpsil(ce, EPSIL_PURE_CONFORMANCE);
    expect(executeEpsil(ce, 'function g() { speak("x") }').value.json).toBe(
      'Nothing'
    );
    expect(opDef(ce, 'g').effects).toBeUndefined();
    expect(opDef(ce, 'g').drawsRandom).toBe(false);

    executeEpsil(ce, EPSIL_DRAWING_CONFORMANCE);

    expect(opDef(ce, 'g').effects).toEqual(['random']);
    expect(opDef(ce, 'g').pure).toBe(false);
    // `drawsRandom` rides with the re-derivation, not with the install-time
    // walk — the random-frame machinery reads it.
    expect(opDef(ce, 'g').drawsRandom).toBe(true);
  });
});

describe('Phase 0a: the serialized dispatcher signature snapshots the union', () => {
  // The parameter TYPE is erased to `any` (it depends on `Self`, known only
  // per call site) and the result to `unknown`; the parameter NAME survives.
  // See the "Appendix A Effects" block of `protocol-dispatch.test.ts` for the
  // shape. What Phase 0a adds is the effect slot: written from the union as
  // it stands at the moment the signature is READ.
  test('BOX ROUTE: bare arrow before, `random` arrow after', () => {
    const ce = new ComputeEngine();
    ce.box(declareSpeaker()).evaluate();
    implement(ce, 'string', { speak: PURE_IMPL });
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');
    expect(opDef(ce, 'speak').signature.toString()).toBe(
      '(self: any) -> unknown'
    );

    implement(ce, 'number', { speak: DRAWING_IMPL });

    expect(ce.symbol('speak').type.toString()).toBe(
      '(self: any) random -> unknown'
    );
    expect(opDef(ce, 'speak').signature.toString()).toBe(
      '(self: any) random -> unknown'
    );
  });

  test('EPSIL ROUTE: bare arrow before, `random` arrow after', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, EPSIL_PROTOCOL);
    executeEpsil(ce, EPSIL_PURE_CONFORMANCE);
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');

    executeEpsil(ce, EPSIL_DRAWING_CONFORMANCE);

    expect(ce.symbol('speak').type.toString()).toBe(
      '(self: any) random -> unknown'
    );
  });
});

describe('Phase 0a: an explicit ceiling, on the box route end to end', () => {
  // The ceiling MATRIX (declared-marker vs body, and the full diagnostic
  // text) is pinned in `protocols.test.ts` — whose engines declare the
  // protocol through the HOST API — and in `test/epsil/protocols.test.ts`.
  // Missing from both: a protocol whose ceiling arrives through the LAZY
  // `DeclareProtocol` operator, whose requirement dictionary is a held
  // operand. This is that probe.
  test('a `pure` ceiling declared by box-route `DeclareProtocol` rejects a drawing body', () => {
    const ce = new ComputeEngine();
    ce.box(declareSpeaker('(self: Self) pure -> string')).evaluate();
    // A spelled `pure` is a real (and the strongest) ceiling, and unlike a
    // bare specifier it is STATIC: the dispatcher carries it before any
    // conformer exists.
    expect(ce.symbol('speak').type.toString()).toBe(
      '(self: any) pure -> unknown'
    );

    const message = implement(ce, 'string', {
      speak: DRAWING_IMPL,
    }).toString();
    expect(message).toContain('protocol-signature-mismatch');
    expect(message).toContain('the body of `speak` infers the effects `random`');
    expect(message).toContain("the requirement's ceiling on `Speaker.speak`");

    // …and a conforming implementation still registers.
    expect(implement(ce, 'string', { speak: PURE_IMPL }).json).toBe('Nothing');
  });
});

describe('Phase 0a: the widening guard, on the box route', () => {
  // `protocols.test.ts` pins the diagnostic's wording and its multiple-
  // dependent case on the EPSIL route. What that leaves untested is the same
  // guard reached through the lazy `DeclareConformance` operator's box route,
  // including the ROLLBACK of a registration the guard undid.
  test('a drawing conformance that falsifies a declared `pure` contract is rejected and rolled back', () => {
    const ce = new ComputeEngine();
    ce.box(declareSpeaker()).evaluate();
    expect(implement(ce, 'string', { speak: PURE_IMPL }).json).toBe('Nothing');

    // A declared-`pure` dependent, installed without leaving the host/box
    // routes: the annotation rides on the literal's `Typed` marker.
    ce.assign(
      'h',
      ce.box([
        'Function',
        [
          'Typed',
          ['Block', ['speak', { str: 'x' }]],
          { str: '() pure -> unknown' },
        ],
      ] as any)
    );
    expect(opDef(ce, 'h').effectsDeclared).toBe(true);

    const message = implement(ce, 'number', {
      speak: DRAWING_IMPL,
    }).toString();
    expect(message).toContain('conformance-widens-declared-contract');
    expect(message).toContain('`h` declares `pure` but would infer `random`');

    // The registration is UNDONE: the edge is gone…
    expect(
      ce._protocolRegistry.Speaker.conformances.map((c) => c.targetKey)
    ).toEqual(['string']);
    // …the derived union is pure again, memo and all…
    expect(opDef(ce, 'speak').pure).toBe(true);
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');
    expect(speakCall(ce).isPure).toBe(true);
    // …the dependent's contract still holds…
    expect(opDef(ce, 'h').effects).toEqual([]);
    // …and a later PURE conformance is still accepted.
    expect(implement(ce, 'boolean', { speak: PURE_IMPL }).json).toBe('Nothing');
    expect(
      ce._protocolRegistry.Speaker.conformances.map((c) => c.targetKey)
    ).toEqual(['string', 'boolean']);
    expect(opDef(ce, 'speak').pure).toBe(true);
  });
});

describe('Phase 0a: a VALUE-bound intermediate propagates the derived union', () => {
  // The `ce.declare(name, { type: '(…) -> …' })` + `ce.assign(name, literal)`
  // idiom leaves a VALUE binding, not an operator definition, and its declared
  // arrow states no effects. The static walk over a caller's body must
  // therefore consult the literal the binding HOLDS — otherwise the hop is a
  // hole: the callee's effects and, worse, its dependence on the derived
  // dispatcher union are both dropped, and every consumer downstream of the
  // hop freezes the (empty) set it first saw. This mirrors the runtime
  // channel, which already unions the stored value's arrow
  // (`valueBindingEffects`, `effects-of.ts`).

  /** `g := (x) ↦ speak(x)` as a VALUE binding with a bare declared arrow. */
  const declareValueBoundG = (ce: ComputeEngine) => {
    ce.declare('g', { type: '(string) -> string' });
    ce.assign('g', ce.box(['Function', ['speak', 'x'], 'x'] as any));
    // The premise of the whole block: `g` is a value binding, so nothing
    // reaches it through `operator`.
    expect('operator' in ce.lookupDefinition('g')!).toBe(false);
  };

  test('the widening guard sees a declared-`pure` contract through the value hop', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, EPSIL_PROTOCOL);
    expect(executeEpsil(ce, EPSIL_PURE_CONFORMANCE).value.json).toBe('Nothing');
    declareValueBoundG(ce);

    // `f` declares `pure` and reaches the dispatcher ONLY through `g`. Every
    // conformer is pure right now, so it installs cleanly.
    expect(
      executeEpsil(ce, 'function f(x: string) pure -> string { g(x) }').value
        .json
    ).toBe('Nothing');
    expect(opDef(ce, 'f').effectsDeclared).toBe(true);
    expect(opDef(ce, 'f').effects).toEqual([]);

    // A drawing conformer would falsify that contract — through two hops.
    const message = executeEpsil(
      ce,
      EPSIL_DRAWING_CONFORMANCE
    ).value.toString();
    expect(message).toContain('conformance-widens-declared-contract');
    expect(message).toContain('`f` declares `pure` but would infer `random`');

    // …and the registration is rolled back, so the world is as it was…
    expect(
      ce._protocolRegistry.Speaker.conformances.map((c) => c.targetKey)
    ).toEqual(['string']);
    expect(opDef(ce, 'speak').pure).toBe(true);
    expect(opDef(ce, 'f').effects).toEqual([]);
    // …including its willingness to accept a further PURE conformance.
    expect(
      executeEpsil(
        ce,
        'type boolean is Speaker {\n  function speak(self: Self) -> string { "b" }\n}'
      ).value.json
    ).toBe('Nothing');
    expect(
      ce._protocolRegistry.Speaker.conformances.map((c) => c.targetKey)
    ).toEqual(['string', 'boolean']);
  });

  test('an UNCONTRACTED caller through the value hop re-derives when the union widens', () => {
    // No annotation anywhere: this is the `consultsRegistry` half. The walk
    // over `h`'s body reaches the dispatcher through `g`'s stored literal, so
    // `h`'s definition installs a deriver instead of freezing the empty set.
    const ce = new ComputeEngine();
    executeEpsil(ce, EPSIL_PROTOCOL);
    executeEpsil(ce, EPSIL_PURE_CONFORMANCE);
    declareValueBoundG(ce);

    expect(
      executeEpsil(ce, 'function h(x: string) -> string { g(x) }').value.json
    ).toBe('Nothing');
    expect(opDef(ce, 'h').effectsDeclared).toBeFalsy();
    expect(opDef(ce, 'h').effects).toBeUndefined();

    expect(executeEpsil(ce, EPSIL_DRAWING_CONFORMANCE).value.json).toBe(
      'Nothing'
    );

    expect(opDef(ce, 'speak').effects).toEqual(['random']);
    expect(opDef(ce, 'h').effects).toEqual(['random']);
  });

  test('a STATED declared arrow stays a trusted contract — the stored literal is not consulted', () => {
    // The negative control. A binding whose arrow SPELLS its effects is a
    // contract, and the contract is what a caller reads: neither a pure
    // literal behind a `pure` arrow (no widening) nor a pure literal behind a
    // `random` arrow (which still contributes `random`) lets the stored body
    // override what was stated.
    const ce = new ComputeEngine();
    executeEpsil(ce, EPSIL_PROTOCOL);
    executeEpsil(ce, EPSIL_PURE_CONFORMANCE);

    ce.declare('cb', { type: '(string) pure -> string' });
    ce.assign('cb', ce.box(['Function', 'x', 'x'] as any));
    expect(
      executeEpsil(ce, 'function p(x: string) -> string { cb(x) }').value.json
    ).toBe('Nothing');
    expect(opDef(ce, 'p').effects).toBeUndefined();

    ce.declare('rb', { type: '(string) random -> string' });
    ce.assign('rb', ce.box(['Function', { str: 'hi' }, 'x'] as any));
    expect(
      executeEpsil(ce, 'function q(x: string) -> string { rb(x) }').value.json
    ).toBe('Nothing');
    expect(opDef(ce, 'q').effects).toEqual(['random']);
  });
});

describe('Phase 0a: the Epsil static pre-pass does not leak the derived union', () => {
  test('checking a program that adds a DRAWING conformance leaves the real dispatcher pure', () => {
    // The pre-pass REGISTERS into the live protocol registry — so that later
    // statements of the same program check against the declarations earlier
    // ones make — and rolls the registrations back on the way out. A union
    // derived while those registrations stood must not survive the rollback,
    // which is why the restore advances the conformance version the memo is
    // stamped on.
    const ce = new ComputeEngine();
    executeEpsil(ce, EPSIL_PROTOCOL);
    executeEpsil(ce, EPSIL_PURE_CONFORMANCE);
    // Read (and thereby MEMOIZE) the union before the pass.
    expect(opDef(ce, 'speak').pure).toBe(true);

    // The program both widens the union and — through `probe`'s body — forces
    // it to be read while the pre-pass's registration stands.
    const source = `${EPSIL_DRAWING_CONFORMANCE}\nfunction probe() { speak("x") }`;
    const [ast] = parseEpsil(source);
    expect(staticDiagnostics(ce, ast, source)).toEqual([]);

    // The real world is untouched: the edge never landed…
    expect(
      ce._protocolRegistry.Speaker.conformances.map((c) => c.targetKey)
    ).toEqual(['string']);
    expect(ce.lookupDefinition('probe')).toBeUndefined();
    // …and neither did the union it would have widened.
    expect(opDef(ce, 'speak').effects).toBeUndefined();
    expect(opDef(ce, 'speak').pure).toBe(true);
    expect(ce.symbol('speak').type.toString()).toBe('(self: any) -> unknown');
    expect(speakCall(ce).isPure).toBe(true);

    // The memo is invalidated, not merely stale-but-right: running the same
    // conformance for REAL still widens.
    expect(executeEpsil(ce, EPSIL_DRAWING_CONFORMANCE).value.json).toBe(
      'Nothing'
    );
    expect(opDef(ce, 'speak').effects).toEqual(['random']);
  });
});
