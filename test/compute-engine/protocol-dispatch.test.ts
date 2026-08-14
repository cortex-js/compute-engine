import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Protocol DISPATCH — phase 3 of `docs/plans/2026-08-12-protocols-design.md`
// (rulings P1, P13, P14, P16, P20, P29) and `docs/TYPE_SYSTEM_ROADMAP.md`
// Appendix A, "Dispatching".
//
// A protocol's FUNCTION members become callable by their bare name: each name
// gets ONE global operator definition — the dispatcher — whose `evaluate`
// selects the most specific conformance implementation for the RUNTIME type of
// the first argument, and whose `canonical`/`type` handlers bind `Self` to its
// STATIC type. The qualified form `Comparable.compare(x, y)` parses as
// `Apply(Field(Comparable, "compare"), x, y)` and reaches the same dispatch
// restricted to one protocol.
//
// Protocols are engine-global, so every block below uses a fresh engine.
//

const COMPARABLE = `protocol Comparable {
  function compare(self: Self, other: Self) -> string
}`;

/** Run an Epsil program on `ce`, returning the diagnostic codes. */
function run(ce: ComputeEngine, source: string): string[] {
  return executeEpsil(ce, source).diagnostics.map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

/** A fresh engine with `source` executed on it. */
function engineFor(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  run(ce, source);
  return ce;
}

/** The evaluated bare call `member(args…)`, as a string. */
function call(ce: ComputeEngine, member: string, ...args: unknown[]): string {
  return ce
    .box([member, ...args] as any)
    .evaluate()
    .toString();
}

/** The evaluated QUALIFIED call `Protocol.member(args…)` — the shape the Epsil
 * parser produces, pinned by the Field matrix below. */
function qualified(
  ce: ComputeEngine,
  protocol: string,
  member: string,
  ...args: unknown[]
): string {
  return ce
    .box(['Apply', ['Field', protocol, { str: member }], ...args] as any)
    .evaluate()
    .toString();
}

/** The `ErrorCode` of an error value, or `undefined`. */
function errorCode(s: string): string | undefined {
  return /ErrorCode\("([^"]+)"/.exec(s)?.[1];
}

describe('P13: dispatcher installation', () => {
  test('a function member becomes callable by its bare name', () => {
    const ce = engineFor(COMPARABLE);
    expect(ce.lookupDefinition('compare')).toBeDefined();
    expect(ce.operatorInfo('compare')).toBeDefined();
  });

  test('a PROPERTY member installs no dispatcher (properties are phase 4)', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Named', { readonly: { label: 'string' } });
    expect(ce.lookupDefinition('label')).toBeUndefined();
  });

  test('the host route installs the dispatcher too', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', {
      functions: { compare: '(self: Self, other: Self) -> string' },
    });
    expect(ce.lookupDefinition('compare')).toBeDefined();
  });

  test('a name that is already a BUILTIN is left alone', () => {
    // `Length` keeps meaning the builtin; only the qualified form reaches the
    // protocol (Appendix A pipeline step 1 — the established meaning wins).
    const ce = new ComputeEngine();
    ce.declareProtocol('Sized', {
      functions: { Length: '(self: Self) -> integer' },
    });
    expect(call(ce, 'Length', ['List', 1, 2, 3])).toBe('3');
  });

  test('a protocol REPLACEMENT removes the dispatchers it orphans', () => {
    const ce = engineFor(COMPARABLE);
    expect(ce.lookupDefinition('compare')).toBeDefined();
    run(
      ce,
      `protocol Comparable {
  function ranked(self: Self, other: Self) -> string
}`
    );
    expect(ce.lookupDefinition('compare')).toBeUndefined();
    expect(ce.lookupDefinition('ranked')).toBeDefined();
  });

  test('the Epsil static pre-pass installs no dispatcher on the engine', () => {
    // The pre-pass runs in a surrogate frame that is popped afterwards — the
    // same isolation a pre-pass MINTED CONSTRUCTOR gets. That, plus the
    // protocol-registry rollback, is what makes the pre-pass a transaction.
    const ce = new ComputeEngine();
    const source = `${COMPARABLE}\nlet z = compare("a", "b")`;
    const [ast] = parseEpsil(source);
    expect(staticDiagnostics(ce, ast, source)).toEqual([]);
    expect(ce._protocolRegistry.Comparable).toBeUndefined();
    expect(ce.lookupDefinition('compare')).toBeUndefined();
  });

  test('the pre-pass never mutates a dispatcher the program installed', () => {
    const ce = engineFor(COMPARABLE);
    const source = `protocol Comparable {
  function ranked(self: Self, other: Self) -> string
}`;
    const [ast] = parseEpsil(source);
    staticDiagnostics(ce, ast, source);
    expect(ce.lookupDefinition('compare')).toBeDefined();
    expect(ce.lookupDefinition('ranked')).toBeUndefined();
    expect(Object.keys(ce._protocolRegistry.Comparable.members)).toEqual([
      'compare',
    ]);
  });
});

describe('P1: dynamic dispatch on the first argument', () => {
  const NUMBER_AND_INTEGER = `protocol Describable {
  function describe(self: Self) -> string
}
type number is Describable {
  function describe(self: Self) -> string { "number" }
}
type integer is Describable {
  function describe(self: Self) -> string { "integer" }
}`;

  test('the MOST SPECIFIC conformance wins', () => {
    const ce = engineFor(NUMBER_AND_INTEGER);
    expect(call(ce, 'describe', 3)).toBe('"integer"');
    expect(call(ce, 'describe', 3.5)).toBe('"number"');
  });

  test('the bare call dispatches through the Epsil parse route too', () => {
    const ce = new ComputeEngine();
    expect(
      run(
        ce,
        `${NUMBER_AND_INTEGER}\nlet a = describe(3)\nlet b = describe(3.5)`
      )
    ).toEqual([]);
    expect(ce.box('a').evaluate().toString()).toBe('"integer"');
    expect(ce.box('b').evaluate().toString()).toBe('"number"');
  });

  test('INHERITED dispatch: an implementation on `number` serves an `integer` value', () => {
    // The `integer` edge carries no implementation of its own — it is complete
    // by inheritance (phase 2). Selection considers impl-carrying edges only,
    // and inheritance falls out of subtyping.
    const ce = engineFor(`protocol Describable {
  function describe(self: Self) -> string
}
type number is Describable {
  function describe(self: Self) -> string { "number" }
}
type integer is Describable`);
    expect(call(ce, 'describe', 3)).toBe('"number"');
  });

  test('no implementation applies: a runtime error VALUE', () => {
    const ce = engineFor(`protocol Describable {
  function describe(self: Self) -> string
}
type string is Describable {
  function describe(self: Self) -> string { "string" }
}`);
    expect(errorCode(call(ce, 'describe', 3))).toBe(
      'protocol-implementation-missing'
    );
  });

  test('dispatch through a PENDING conformance is the same runtime error', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Comparable', {
      functions: { compare: '(self: Self, other: Self) -> string' },
    });
    ce.box([
      'DeclareConformance',
      { str: 'string' },
      ['List', 'Comparable'],
    ] as any).evaluate();
    expect(errorCode(call(ce, 'compare', { str: 'a' }, { str: 'b' }))).toBe(
      'protocol-implementation-missing'
    );
  });

  test('a SYMBOLIC receiver leaves the application symbolic', () => {
    const ce = engineFor(`protocol Describable {
  function describe(self: Self) -> string
}
type string is Describable {
  function describe(self: Self) -> string { "string" }
}`);
    expect(call(ce, 'describe', 'x')).toBe('describe(x)');
  });
});

describe('P29: ambiguity is decided per call site', () => {
  const TWO_PROTOCOLS = `protocol Comparable {
  function compare(self: Self, other: Self) -> string
}
protocol Comparator {
  function compare(self: Self, other: Self) -> string
}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "able" }
}
type string is Comparator {
  function compare(self: Self, other: Self) -> string { "ator" }
}`;

  test('two protocols sharing a member name: ONE dispatcher, ambiguous bare call', () => {
    const ce = engineFor(TWO_PROTOCOLS);
    const bare = call(ce, 'compare', { str: 'a' }, { str: 'b' });
    expect(errorCode(bare)).toBe('protocol-call-ambiguous');
    expect(bare).toContain('Comparable(string)');
    expect(bare).toContain('Comparator(string)');
  });

  test('…and the qualified call resolves it, either way', () => {
    const ce = engineFor(TWO_PROTOCOLS);
    expect(
      qualified(ce, 'Comparable', 'compare', { str: 'a' }, { str: 'b' })
    ).toBe('"able"');
    expect(
      qualified(ce, 'Comparator', 'compare', { str: 'a' }, { str: 'b' })
    ).toBe('"ator"');
  });

  test('an EMPTY collection ties two incomparable targets (P29)', () => {
    // `list<string>` and `list<integer>` are accepted at conformance time
    // (their only shared value is the empty collection, P29) and the tie is
    // resolved HERE, at dispatch.
    const ce = engineFor(`protocol Sizer {
  function sizeOf(self: Self) -> string
}
type list<string> is Sizer {
  function sizeOf(self: Self) -> string { "strings" }
}
type list<integer> is Sizer {
  function sizeOf(self: Self) -> string { "integers" }
}`);
    expect(errorCode(call(ce, 'sizeOf', ['List']))).toBe(
      'protocol-call-ambiguous'
    );
    // A non-empty list decides.
    expect(call(ce, 'sizeOf', ['List', { str: 'a' }])).toBe('"strings"');
    expect(call(ce, 'sizeOf', ['List', 1])).toBe('"integers"');
  });
});

describe('P1: the static half', () => {
  const STRING_ONLY = `${COMPARABLE}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "proto" }
}`;

  test('`Self` binds to ops[0] and argument 2 is checked against it', () => {
    // Appendix A's example: `compare("a", 3)` is an `incompatible-type` on
    // ARGUMENT 2 — not a join of `Self` across the arguments.
    const ce = engineFor(STRING_ONLY);
    const expr = ce.box(['compare', { str: 'a' }, 3] as any);
    expect(expr.toString()).toBe(
      'compare("a", Error(ErrorCode("incompatible-type", "string", "finite_integer"), 3))'
    );
    expect(expr.type.toString()).toBe('error');
  });

  test('a well-typed call carries the requirement RESULT at `Self` = ops[0]', () => {
    const ce = engineFor(STRING_ONLY);
    expect(
      ce.box(['compare', { str: 'a' }, { str: 'b' }] as any).type.toString()
    ).toBe('string');
  });

  test('an INDETERMINATE receiver checks nothing statically', () => {
    const ce = engineFor(STRING_ONLY);
    const expr = ce.box(['compare', 'x', 3] as any);
    expect(expr.toString()).toBe('compare(x, 3)');
    expect(expr.isValid).toBe(true);
  });

  test('arity is checked', () => {
    const ce = engineFor(STRING_ONLY);
    expect(ce.box(['compare', { str: 'a' }] as any).isValid).toBe(false);
  });

  test('a receiver that conforms to NOTHING is the STATIC missing diagnostic', () => {
    // Appendix A "Dispatching": "if the first argument's static type neither
    // conforms nor has any conforming subtype, the call is a static
    // diagnostic". Reported through the same convention the `Self` mismatch
    // uses — the offending argument (here the RECEIVER) carries the error.
    const ce = engineFor(STRING_ONLY);
    const expr = ce.box(['compare', 3, 4] as any);
    expect(errorCode(expr.toString())).toBe('protocol-implementation-missing');
    expect(expr.type.toString()).toBe('error');
  });

  test('a supertype receiver with a conforming SUBTYPE is NOT refuted', () => {
    // `number` does not conform, but `integer` — one of its subtypes — does,
    // so the call is left to the runtime.
    const ce = engineFor(`protocol Describable {
  function describe(self: Self) -> string
}
type integer is Describable {
  function describe(self: Self) -> string { "int" }
}`);
    ce.declare('n', 'number');
    const expr = ce.box(['describe', 'n'] as any);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toBe('describe(n)');
  });

  test('an INAPPLICABLE protocol does not widen the result type', () => {
    // Two protocols share the member name; only one has a conformance the
    // receiver could satisfy, so the result is ITS result, not the join.
    const ce = engineFor(`protocol Alpha {
  function tag(self: Self) -> string
}
protocol Beta {
  function tag(self: Self) -> integer
}
type string is Alpha {
  function tag(self: Self) -> string { "s" }
}
type integer is Beta {
  function tag(self: Self) -> integer { 1 }
}`);
    expect(ce.box(['tag', { str: 'a' }] as any).type.toString()).toBe('string');
    expect(ce.box(['tag', 3] as any).type.toString()).toBe('integer');
  });

  test('…and an INAPPLICABLE protocol no longer suppresses the `Self` check', () => {
    // `Beta.pair`'s second parameter is not `Self`, so before applicability
    // filtering the two requirements "disagreed" on position 2 and the check
    // was skipped — even though only `Alpha` can apply to a `string`.
    const ce = engineFor(`protocol Alpha {
  function pair(self: Self, other: Self) -> string
}
protocol Beta {
  function pair(self: Self, other: integer) -> string
}
type string is Alpha {
  function pair(self: Self, other: Self) -> string { "s" }
}
type integer is Beta {
  function pair(self: Self, other: integer) -> string { "b" }
}`);
    expect(ce.box(['pair', { str: 'a' }, 3] as any).toString()).toBe(
      'pair("a", Error(ErrorCode("incompatible-type", "string", "finite_integer"), 3))'
    );
  });

  test('a member NO protocol has conformed to yet stays quiet', () => {
    // An entirely unconformed member refutes nothing: conformance is monotone
    // and arrives in a later batch (Appendix A's notebook posture). This is
    // what keeps `Quartile([…])` free of a static diagnostic in the P20 block.
    const ce = engineFor(COMPARABLE);
    const expr = ce.box(['compare', 3, 4] as any);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toBe('compare(3, 4)');
  });

  test('a UNION receiver is decided dynamically, not refuted', () => {
    // Appendix A: "a union only some arms of which conform" → checked
    // dynamically. `isSubtype(string | integer, string)` is false for EVERY
    // candidate target, so a settled-type gate that admitted unions reported a
    // spurious `protocol-implementation-missing`.
    const ce = engineFor(STRING_ONLY);
    ce.declare('u', 'string|integer');
    const expr = ce.box(['compare', 'u', { str: 'b' }] as any);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toBe('compare(u, "b")');
    // …and the DYNAMIC half stays symbolic too, rather than erroring.
    expect(expr.evaluate().toString()).toBe('compare(u, "b")');
  });

  test('…and dispatch resolves once the union receiver takes a value', () => {
    const ce = engineFor(STRING_ONLY);
    ce.declare('u', 'string|integer');
    ce.assign('u', ce.string('a'));
    expect(
      ce
        .box(['compare', 'u', { str: 'b' }] as any)
        .evaluate()
        .toString()
    ).toBe('"proto"');
  });

  test('a `Self`-returning requirement resolves the result at the call site', () => {
    const ce = engineFor(`protocol Copyable {
  function copy(self: Self) -> Self
}
type string is Copyable {
  function copy(self: Self) -> Self { self }
}`);
    expect(ce.box(['copy', { str: 'a' }] as any).type.toString()).toBe(
      'string'
    );
    expect(call(ce, 'copy', { str: 'a' })).toBe('"a"');
  });
});

describe('Appendix A "Effects": the dispatcher carries the REQUIREMENT effect', () => {
  test('a single protocol contributes its own effect', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Logger', {
      functions: { log: '(self: Self) console -> nothing' },
    });
    // The parameter TYPE is erased to `any` (it depends on `Self`); the
    // parameter NAME survives, so a named call can be permuted into
    // declaration order (`sharedParameterName`, named-arguments design §5).
    expect(ce.symbol('log').type.toString()).toBe(
      '(self: any) console -> unknown'
    );
  });

  test('protocols sharing a name contribute the JOIN of their effects', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Logger', {
      functions: { emit: '(self: Self) console -> nothing' },
    });
    ce.declareProtocol('Tracer', {
      functions: { emit: '(self: Self) time -> nothing' },
    });
    // Both requirements name the position `self`, so the shared name survives
    // the merge; a position the protocols disagreed on would print as `any`.
    expect(ce.symbol('emit').type.toString()).toBe(
      '(self: any) console time -> unknown'
    );
  });

  test('protocols that DISAGREE on a parameter name leave it unnamed', () => {
    // One dispatcher serves every protocol declaring the name, so it can only
    // carry a parameter name the requirements agree on. Here they do not, and
    // the position stays positional-only.
    const ce = new ComputeEngine();
    ce.declareProtocol('Left', {
      functions: { pick: '(self: Self, a: number) -> number' },
    });
    ce.declareProtocol('Right', {
      functions: { pick: '(self: Self, b: number) -> number' },
    });
    expect(ce.symbol('pick').type.toString()).toBe(
      '(self: any, any) -> unknown'
    );
  });

  test('a pure requirement leaves the dispatcher pure', () => {
    const ce = engineFor(COMPARABLE);
    expect(ce.symbol('compare').type.toString()).toBe(
      '(self: any, other: any) -> unknown'
    );
  });
});

describe('Appendix A pipeline step 1: a user definition shadows the member', () => {
  const SHADOWED = `${COMPARABLE}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "proto" }
}
function compare(a, b) { "user" }`;

  test('the user function wins the BARE call', () => {
    const ce = engineFor(SHADOWED);
    expect(call(ce, 'compare', { str: 'a' }, { str: 'b' })).toBe('"user"');
  });

  test('…and the QUALIFIED call still reaches the protocol', () => {
    const ce = engineFor(SHADOWED);
    expect(
      qualified(ce, 'Comparable', 'compare', { str: 'a' }, { str: 'b' })
    ).toBe('"proto"');
  });

  test('the definition is accepted, not rejected as an opaque operator', () => {
    const ce = new ComputeEngine();
    expect(run(ce, SHADOWED)).toEqual([]);
  });

  test('a member name declared BEFORE the protocol is not taken over', () => {
    const ce = new ComputeEngine();
    expect(
      run(
        ce,
        `function compare(a, b) { "user" }\n${COMPARABLE}\ntype string is Comparable {
  function compare(self: Self, other: Self) -> string { "proto" }
}`
      )
    ).toEqual([]);
    expect(call(ce, 'compare', { str: 'a' }, { str: 'b' })).toBe('"user"');
    expect(
      qualified(ce, 'Comparable', 'compare', { str: 'a' }, { str: 'b' })
    ).toBe('"proto"');
  });

  test('an INNER-scope definition shadows the dispatcher, and only inside', () => {
    // A dispatcher lives in the GLOBAL scope, and `ce.assign` — which the
    // single-clause install delegates to — resolves through the whole scope
    // chain and mutates in place. Without the same-scope/inherited split a
    // `function compare(…)` inside a block replaced the global dispatcher
    // PERMANENTLY: the block's own call and every later top-level call both
    // saw the user function.
    const ce = new ComputeEngine();
    expect(
      run(
        ce,
        `${COMPARABLE}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "proto" }
}
let inner = do { function compare(a, b) { "user" }; compare("a", "b") }
let outer = compare("a", "b")`
      )
    ).toEqual([]);
    expect(ce.box('inner').evaluate().toString()).toBe('"user"');
    expect(ce.box('outer').evaluate().toString()).toBe('"proto"');
    // The GLOBAL binding is still the dispatcher, so a call made AFTER the
    // block reaches the protocol implementation.
    expect(call(ce, 'compare', { str: 'a' }, { str: 'b' })).toBe('"proto"');
  });
});

describe('P14: qualified calls through `Field`', () => {
  const ce = () =>
    engineFor(`${COMPARABLE}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "proto" }
}`);

  test('`Comparable.compare` parses as Apply(Field(…), …)', () => {
    const [ast] = parseEpsil('Comparable.compare(x, y)');
    expect(JSON.parse(JSON.stringify(ast))).toMatchObject({
      fn: [
        'Apply',
        { fn: ['Field', { sym: 'Comparable' }, { str: 'compare' }] },
        { sym: 'x' },
        { sym: 'y' },
      ],
    });
  });

  test('`Field` on a protocol symbol is a FUNCTION VALUE', () => {
    const v = ce()
      .box(['Field', 'Comparable', { str: 'compare' }] as any)
      .evaluate();
    expect(v.toString()).toBe(
      '("self", "other") |-> ProtocolMember("Comparable", "compare", "self", "other")'
    );
  });

  test('its static type is the requirement signature', () => {
    expect(
      ce()
        .box(['Field', 'Comparable', { str: 'compare' }] as any)
        .type.toString()
    ).toBe('(self: Self, other: Self) -> string');
  });

  test('an UNKNOWN member takes the existing `unknown-field` path', () => {
    const e = ce();
    expect(
      errorCode(
        e
          .box(['Field', 'Comparable', { str: 'nope' }] as any)
          .evaluate()
          .toString()
      )
    ).toBe('unknown-field');
    expect(
      e.box(['Field', 'Comparable', { str: 'nope' }] as any).type.toString()
    ).toBe('error');
  });

  test('a PROPERTY member is not callable yet (phase 4)', () => {
    const e = new ComputeEngine();
    e.declareProtocol('Named', { readonly: { label: 'string' } });
    expect(
      errorCode(
        e
          .box(['Field', 'Named', { str: 'label' }] as any)
          .evaluate()
          .toString()
      )
    ).toBe('unknown-field');
  });

  test('the qualified call evaluates through the Epsil parse route', () => {
    const e = new ComputeEngine();
    expect(
      run(
        e,
        `${COMPARABLE}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "proto" }
}
let q = Comparable.compare("a", "b")`
      )
    ).toEqual([]);
    expect(e.box('q').evaluate().toString()).toBe('"proto"');
  });

  test('a bare protocol symbol stays an ordinary undeclared symbol', () => {
    // `DeclareProtocol` declares NO value: the `Field` branch is keyed off the
    // registry, not off a binding.
    const e = ce();
    const bare = e.box('Comparable');
    expect(bare.symbol).toBe('Comparable');
    expect(bare.type.toString()).toBe('unknown');
    expect(bare.evaluate().symbol).toBe('Comparable');
  });

  test('a dispatcher call works inside a SHORTHAND lambda body', () => {
    // `Self` at an indeterminate receiver substitutes as an alias
    // `TypeReference` whose def is `unknown` — a wrapper that PRINTS like the
    // primitive but defeated every primitive-keyed acceptance gate: the
    // shorthand `negated(_) * 10` typed its dispatcher call as that
    // reference, `checkNumericArgs`' "primitive unknown → infer later" gate
    // missed it, and the multiplication rejected the operand with
    // `incompatible-type number/unknown` while the identical shape through a
    // plain declared function worked. `unwrapIndeterminateSelf`
    // (engine-protocols.ts) reduces the top-level wrapper to the primitive.
    const e = new ComputeEngine();
    run(
      e,
      `protocol Negatable { function negated(self: Self) -> Self }
type number is Negatable { function negated(self) -> number { -self } }
const r = Map(negated(_) * 10, [1, 2, 3])`
    );
    expect(e.box('r').evaluate().toString()).toBe('[-10,-20,-30]');
    // An undecided receiver still DEFERS — symbolic, not an error.
    const e2 = new ComputeEngine();
    run(
      e2,
      `protocol Negatable { function negated(self: Self) -> Self }
type number is Negatable { function negated(self) -> number { -self } }
let u
const s = negated(u) * 10`
    );
    expect(e2.box('s').evaluate().toString()).toBe('10negated(u)');
  });

  test('a qualified member works as a CALLBACK (`Map(P.m, xs)`)', () => {
    // `Map` holds its callback raw, and `canonicalFunctionLiteral`'s
    // shorthand path used to read the `Field(Comparable, "compare")`
    // expression as a lambda BODY — turning its free symbol into the
    // parameter, so every element was bound to the protocol-name slot and
    // mapped through `Field(element, "m")`, an absence marker per element.
    // The qualified member is a function VALUE (`isQualifiedProtocolMember`,
    // function-utils.ts): the callback stays intact and applies through
    // `Apply`, which evaluates the `Field` to the dispatching literal.
    const e = new ComputeEngine();
    run(
      e,
      `protocol Negatable { function negated(self: Self) -> Self }
type number is Negatable { function negated(self) -> number { -self } }
const r = Map(Negatable.negated, [1, 2, 3])`
    );
    expect(e.box('r').evaluate().toString()).toBe('[-1,-2,-3]');
    // A base symbol SHADOWED by a valued binding is not a protocol
    // reference: the callback is an ordinary (non-function) field read and
    // reports incompatible-type rather than silently dispatching.
    const shadowed = new ComputeEngine();
    run(
      shadowed,
      `protocol Negatable { function negated(self: Self) -> Self }
type number is Negatable { function negated(self) -> number { -self } }
const Negatable = 5
const r = Map(Negatable.negated, [1, 2])`
    );
    expect(shadowed.box('r').evaluate().toString()).toContain(
      'incompatible-type'
    );
  });

  test('a QUALIFIED call is validated statically too', () => {
    // `ProtocolMember` had no `canonical` handler, so a qualified call reached
    // the implementation with neither an arity nor a `Self`-position check.
    // The checks are the dispatcher's, restricted to the named protocol.
    const e = ce();
    const member = (...args: any[]) =>
      e.box([
        'ProtocolMember',
        { str: 'Comparable' },
        { str: 'compare' },
        ...args,
      ] as any);

    // Arity: a missing argument is padded with the `missing` marker…
    const short = member({ str: 'a' });
    expect(short.isValid).toBe(false);
    expect(short.toString()).toContain('Error("missing")');
    // …and a surplus one is `unexpected-argument`.
    const long = member({ str: 'a' }, { str: 'b' }, { str: 'c' });
    expect(long.isValid).toBe(false);
    expect(long.toString()).toContain('unexpected-argument');

    // `Self` binds to argument 1 and argument 2 is checked against it — the
    // qualified spelling of Appendix A's `compare("a", 3)`.
    const mismatch = member({ str: 'a' }, 3);
    expect(mismatch.toString()).toBe(
      'ProtocolMember("Comparable", "compare", "a", Error(ErrorCode("incompatible-type", "string", "finite_integer"), 3))'
    );
    expect(mismatch.type.toString()).toBe('error');

    // A well-typed qualified call is untouched and still dispatches.
    expect(member({ str: 'a' }, { str: 'b' }).evaluate().toString()).toBe(
      '"proto"'
    );
  });

  test('the `Field` function VALUE survives the canonical check', () => {
    // The wrapper literal's body is `ProtocolMember(P, m, self, other)` over
    // the PARAMETER symbols: their types are `unknown`, so the receiver is
    // undecided and nothing is checked.
    expect(
      ce()
        .box(['Field', 'Comparable', { str: 'compare' }] as any)
        .evaluate()
        .toString()
    ).toBe(
      '("self", "other") |-> ProtocolMember("Comparable", "compare", "self", "other")'
    );
  });

  test('`ProtocolMember` names an unknown protocol → an error value', () => {
    const e = ce();
    expect(
      errorCode(
        e
          .box([
            'ProtocolMember',
            { str: 'Nope' },
            { str: 'compare' },
            1,
          ] as any)
          .evaluate()
          .toString()
      )
    ).toBe('protocol-unknown');
  });
});

describe('host implementations dispatch too', () => {
  test('a JS callback is invoked with the boxed operands and its result boxed', () => {
    const ce = new ComputeEngine();
    const seen: string[] = [];
    ce.declareProtocol('Hashable', {
      functions: { hash: '(self: Self) -> string' },
    });
    ce.declareProtocolImplementation('string', 'Hashable', {
      functions: {
        hash: (self) => {
          seen.push(self.toString());
          return `H:${(self as { string?: string }).string}`;
        },
      },
    });
    const r = ce.box(['hash', { str: 'abc' }] as any).evaluate();
    expect(r.toString()).toBe('"H:abc"');
    expect(r.type.toString()).toBe('string');
    expect(seen).toEqual(['"abc"']);
  });

  test('…and through the qualified form', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {
      functions: { hash: '(self: Self) -> string' },
    });
    ce.declareProtocolImplementation('string', 'Hashable', {
      functions: { hash: () => 'H' },
    });
    expect(qualified(ce, 'Hashable', 'hash', { str: 'q' })).toBe('"H"');
  });
});

describe('P20: a protocol call raises no `unknown-function` warning', () => {
  const PROGRAM = `${COMPARABLE}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "proto" }
}`;

  test('the bare form', () => {
    const ce = new ComputeEngine();
    expect(run(ce, `${PROGRAM}\nlet z = compare("a", "b")`)).toEqual([]);
  });

  test('the qualified form', () => {
    const ce = new ComputeEngine();
    expect(run(ce, `${PROGRAM}\nlet z = Comparable.compare("a", "b")`)).toEqual(
      []
    );
  });

  test('the dispatcher SILENCES a did-you-mean the same name would draw', () => {
    // `Quartile` is a near-miss of the built-in `Quartiles` and normally
    // draws an `unknown-function` warning. Declaring a protocol member of
    // that name makes it a real definition, so `ce.operatorInfo()` finds it
    // and the advisory pass needs no change of its own (P20).
    expect(run(new ComputeEngine(), 'Quartile([1, 2, 3, 4, 5])')).toEqual([
      'unknown-function',
    ]);
    const ce = new ComputeEngine();
    expect(
      run(
        ce,
        `protocol Quartiled {
  function Quartile(self: Self) -> integer
}
Quartile([1, 2, 3, 4, 5])`
      )
    ).toEqual([]);
  });
});

describe('compilation', () => {
  // Since `docs/plans/2026-08-12-protocol-compilation.md` a compilable
  // dispatch COMPILES on the JS target (this pin previously recorded the
  // fail-closed posture): a single string-target conformance reifies to a
  // `typeof` guard chain, and a receiver no conformance covers THROWS where
  // the interpreter yields the `protocol-implementation-missing` error value
  // (the multi-clause `no-matching-clause` convention).
  test('a bare dispatch with an unknown receiver compiles to a guard chain', () => {
    const ce = engineFor(`${COMPARABLE}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "proto" }
}`);
    const result = compile(ce.box(['compare', 'x', 'y'] as any));
    expect(result.success).toBe(true);
    expect(result.unsupported).not.toContain('compare');
    expect(result.run?.({ x: 'a', y: 'b' })).toBe('proto');
    expect(() => result.run?.({ x: 1, y: 2 })).toThrow(
      'protocol-implementation-missing: compare'
    );
  });

  // A protocol with NO conformance at all has nothing to dispatch to: the
  // compiler still declines (fail closed, D6) — deliberately re-pinned.
  test('a qualified dispatch with no conformance declines', () => {
    const ce = engineFor(COMPARABLE);
    const result = compile(
      ce.box([
        'ProtocolMember',
        { str: 'Comparable' },
        { str: 'compare' },
        'x',
        'y',
      ] as any)
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe('');
    expect(result.unsupported).toContain('ProtocolMember');
  });
});

describe('P16: dispatcher lifecycle events', () => {
  const advanced = (ce: ComputeEngine, f: () => void) => {
    const a0 = ce._anyVersion;
    const s0 = ce._semanticVersion;
    const w0 = ce._worldVersion;
    f();
    return {
      any: ce._anyVersion > a0,
      semantic: ce._semanticVersion > s0,
      world: ce._worldVersion > w0,
    };
  };

  test('installing a dispatcher advances all three axes', () => {
    const ce = new ComputeEngine();
    expect(
      advanced(ce, () =>
        ce.declareProtocol('Comparable', {
          functions: { compare: '(self: Self, other: Self) -> string' },
        })
      )
    ).toEqual({ any: true, semantic: true, world: true });
  });

  test('removing an orphaned dispatcher advances them too', () => {
    const ce = engineFor(COMPARABLE);
    expect(
      advanced(ce, () =>
        run(
          ce,
          `protocol Comparable {
  function ranked(self: Self, other: Self) -> string
}`
        )
      )
    ).toEqual({ any: true, semantic: true, world: true });
  });
});

describe('P1: the SELECTED requirement’s arity is enforced at dispatch', () => {
  // `checkMemberArguments` can only check arity when every CANDIDATE agrees on
  // one — with two protocols sharing a member name at different arities, and a
  // receiver whose static type does not decide which applies, it lets the call
  // through to run time. Dispatch then names one requirement, so its arity is
  // exact; without the check a short call came back a PARTIAL APPLICATION and a
  // long one hit `apply`'s generic "Too many arguments".
  const TWO_ARITIES = `protocol Pairwise {
  function tally(self: Self, other: Self) -> string
}
protocol Triple {
  function tally(self: Self, x: Self, y: Self) -> string
}
type string is Pairwise {
  function tally(self: Self, other: Self) -> string { "pair" }
}
type integer is Triple {
  function tally(self: Self, x: Self, y: Self) -> string { "triple" }
}
let u: any = "a"`;

  /** The value of the last statement of an Epsil program, as a string. */
  const value = (ce: ComputeEngine, source: string): string =>
    String(executeEpsil(ce, source).value);

  test('an UNDECIDED receiver still dispatches at the right arity', () => {
    const ce = engineFor(TWO_ARITIES);
    expect(value(ce, 'tally(u, "b")')).toBe('"pair"');
  });

  test('too FEW arguments is an error, not a partial application', () => {
    const ce = engineFor(TWO_ARITIES);
    const result = value(ce, 'tally(u)');
    expect(errorCode(result)).toBe('protocol-signature-mismatch');
    expect(result).toContain('takes 2 arguments; it was called with 1');
  });

  test('too MANY arguments names the protocol requirement', () => {
    const ce = engineFor(TWO_ARITIES);
    const result = value(ce, 'tally(u, "b", "c")');
    expect(errorCode(result)).toBe('protocol-signature-mismatch');
    expect(result).toContain('`Pairwise.tally`');
  });
});

describe('P1: an ORDINARY parameter is checked too, not only `Self`', () => {
  // The static half used to check the positions spelled `Self` and nothing
  // else, so `(self: Self, count: integer)` accepted a string `count` — and the
  // implementation (a trusted host callback, in particular) was called with it.
  const COUNTER = `protocol Counter {
  function step(self: Self, count: integer) -> string
}
type string is Counter {
  function step(self: Self, count: integer) -> string { self }
}`;

  test('the BARE call names the offending argument', () => {
    const ce = engineFor(COUNTER);
    const expr = ce.box(['step', { str: 'a' }, { str: 'b' }] as any);
    expect(expr.toString()).toBe(
      'step("a", Error(ErrorCode("incompatible-type", "integer", "string"), "b"))'
    );
    expect(expr.type.toString()).toBe('error');
    // …and a well-typed one is untouched.
    expect(call(ce, 'step', { str: 'a' }, 2)).toBe('"a"');
  });

  test('the QUALIFIED call checks it the same way', () => {
    const ce = engineFor(COUNTER);
    expect(
      ce
        .box([
          'ProtocolMember',
          { str: 'Counter' },
          { str: 'step' },
          { str: 'a' },
          { str: 'b' },
        ] as any)
        .toString()
    ).toBe(
      'ProtocolMember("Counter", "step", "a", Error(ErrorCode("incompatible-type", "integer", "string"), "b"))'
    );
  });

  test('a position the CANDIDATES disagree on is checked against their JOIN', () => {
    // Two protocols share the member name and both could apply to a `string`
    // receiver, so a value fitting EITHER declaration must be admitted — the
    // same widening the result type uses.
    const ce = engineFor(`protocol Alpha {
  function tag(self: Self, k: integer) -> string
}
protocol Beta {
  function tag(self: Self, k: string) -> string
}
type string is Alpha {
  function tag(self: Self, k: integer) -> string { "a" }
}
type string is Beta {
  function tag(self: Self, k: string) -> string { "b" }
}`);
    expect(ce.box(['tag', { str: 'x' }, 1] as any).isValid).toBe(true);
    expect(ce.box(['tag', { str: 'x' }, { str: 'k' }] as any).isValid).toBe(
      true
    );
    // …and something in NEITHER declaration is still refused.
    expect(
      errorCode(ce.box(['tag', { str: 'x' }, true] as any).toString())
    ).toBe('incompatible-type');
  });

  test('a RUNTIME-resolved receiver checks the arguments before invoking', () => {
    // The receiver is undecided at canonicalization, so the static half checked
    // nothing: the SELECTED requirement is the only contract left, and a host
    // implementation must not be handed an argument outside it.
    const ce = new ComputeEngine();
    const invoked: unknown[][] = [];
    ce.declareProtocol('Counter', {
      functions: { step: '(self: Self, count: integer) -> string' },
    });
    ce.declareProtocolImplementation('string', 'Counter', {
      functions: {
        step: (...args: unknown[]) => {
          invoked.push(args);
          return 'called';
        },
      },
    });
    ce.declare('u', 'string|integer');
    ce.assign('u', ce.string('a'));

    const bad = ce.box(['step', 'u', { str: 'b' }] as any);
    expect(bad.toString()).toBe('step(u, "b")'); // nothing static to say
    expect(errorCode(bad.evaluate().toString())).toBe('incompatible-type');
    expect(invoked).toHaveLength(0);

    // …and the well-typed call still reaches the host handler.
    expect(
      ce
        .box(['step', 'u', 2] as any)
        .evaluate()
        .toString()
    ).toBe('"called"');
    expect(invoked).toHaveLength(1);
  });
});
