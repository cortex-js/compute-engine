/**
 * FIELD-BACKED PROPERTY SATISFACTION — `docs/TYPE_SYSTEM_ROADMAP.md`
 * Appendix B, "Objects and protocols".
 *
 * When an OBJECT type conforms to a protocol, a stored field satisfies a
 * property requirement of the same name with no `get`/`set` written:
 *
 * - `readwrite` when the field's type is EXACTLY the property's type. The
 *   exactness is the rule, not an oversight: the getter direction alone would
 *   admit a narrower field and the setter direction alone a wider one, so the
 *   only type satisfying both is the property's own.
 * - `readonly` when the field's type is the property's type or a SUBTYPE —
 *   only the getter direction exists, so the ordinary covariant rule applies.
 * - A name declared as both a stored field and an explicit accessor is
 *   `object-property-conflict`: a property is field-backed or computed, never
 *   both.
 *
 * Satisfaction is implemented by synthesizing the accessors into the
 * conformance edge, so the INTERPRETED consumers — dispatch selection, reads,
 * writes — find a handler where they already look. The synthesized setter
 * stores IN PLACE and returns the receiver, which is what keeps a write from
 * silently rebuilding the object and stranding every other reference to it.
 * The COMPILED tier declines instead: a synthesized accessor is a host
 * callback and the planner refuses host candidates, which is the right answer
 * until object field access itself is lowered (Phase 4).
 *
 * Computed properties — those an author does write `get`/`set` for — are
 * unchanged by this work and are pinned here rather than altered: the getter
 * runs on every access, and the setter receives the EVALUATED right-hand side
 * (the `ProtocolProperty` operator is not lazy, so its operands are evaluated
 * before the handler runs).
 *
 * All three routes are exercised — the Epsil statement route, the raw
 * MathJSON box route, and the host `declareProtocolImplementation()` API —
 * because each reaches the registration and the accessors by a different path.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isObject } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/types-expression';
import type { JSImplementation } from '../../src/compute-engine/types-engine';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** Run an Epsil program, asserting it ran cleanly, and return the final value
 * as a string. Diagnostics are asserted empty: a conformance test whose
 * program quietly reported a pending edge and then read a stale value would
 * otherwise pass for the wrong reason. */
function value(source: string, engine = ce): string {
  const { value, diagnostics } = executeEpsil(engine, source);
  expect(diagnostics).toEqual([]);
  return String(value);
}

/** Run an Epsil program WITHOUT asserting it ran cleanly — for the refusal
 * cases, where the diagnostic or the error value is the point. */
function result(source: string, engine = ce): string {
  return String(executeEpsil(engine, source).value);
}

/** The error codes of a program's diagnostics, in order. A runtime error
 * value raised by a statement rides as `["runtime-error", message, "",
 * code]`, so the code is the LAST element there and the first otherwise. */
function diagnosticCodes(source: string, engine = ce): string[] {
  const { diagnostics } = executeEpsil(engine, source);
  return diagnostics.map((d) => {
    const parts = Array.isArray(d.message) ? d.message : [d.message];
    return parts[0] === 'runtime-error'
      ? String(parts[parts.length - 1])
      : String(parts[0]);
  });
}

/** The object currently bound to `name`. */
function objectAt(name: string, engine = ce) {
  const o = engine.box(name).evaluate();
  if (!isObject(o)) throw new Error(`\`${name}\` is not an object: ${o}`);
  return o;
}

/** The raw host callback the engine synthesized under `implKey` on the one
 * conformance edge of `protocol` that carries it — the only way to drive a
 * synthesized accessor's own guards, which every ordinary route reaches only
 * after its caller has already checked the same thing. Reaches into the
 * registry deliberately: these handlers have no public surface. */
function fieldBackedHandler(
  protocol: string,
  implKey: string,
  engine = ce
): (...args: Expression[]) => unknown {
  const record = engine._protocolRegistry[protocol];
  const edge = record?.conformances.find(
    (c) => c.impl?.[implKey] !== undefined
  );
  const impl = edge?.impl?.[implKey];
  if (
    impl === undefined ||
    typeof (impl as JSImplementation).host !== 'function'
  )
    throw new Error(`no synthesized \`${implKey}\` on \`${protocol}\``);
  return (impl as JSImplementation).host;
}

describe('a stored field satisfies a property requirement', () => {
  test('SAME type satisfies `readwrite`, with no implementation block at all', () => {
    expect(
      value(`protocol Nameable { readwrite name: string }
type P = object{name: string} is Nameable
let p = P(name: "Bob")
p.(Nameable.name)`)
    ).toBe('"Bob"');
  });

  test('a NARROWER field does NOT satisfy `readwrite` — the exact-type rule', () => {
    // `finite_integer` is a strict subtype of `integer`. The getter direction
    // would be happy with it; the setter direction would not, since the
    // property promises that any `integer` may be written. The edge therefore
    // stays PENDING, and dispatch reports the missing implementation.
    const source = `protocol Aged { readwrite age: integer }
type Q = object{age: finite_integer} is Aged
let q = Q(age: 5)
q.(Aged.age)`;
    expect(diagnosticCodes(source)).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(result(source, new ComputeEngine())).toContain(
      'protocol-implementation-missing'
    );
  });

  test('a WIDER field does NOT satisfy `readwrite` either', () => {
    // The mirror image: `number` is a strict supertype of `integer`. The
    // setter direction would accept it; the getter direction would not, since
    // the property promises that a read yields an `integer`.
    const source = `protocol Aged { readwrite age: integer }
type R = object{age: number} is Aged
let r = R(age: 5)
r.(Aged.age)`;
    expect(diagnosticCodes(source)).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(result(source, new ComputeEngine())).toContain(
      'protocol-implementation-missing'
    );
  });

  test('a SUBTYPE field satisfies `readonly`', () => {
    expect(
      value(`protocol Aged { readonly age: number }
type S = object{age: integer} is Aged
let s = S(age: 5)
s.(Aged.age)`)
    ).toBe('5');
  });

  test('a WIDER field does NOT satisfy `readonly` — the covariant direction only', () => {
    // The mirror of the test above. `readonly` relaxes the `readwrite` rule in
    // ONE direction: the field may be narrower than the property, never wider,
    // because a read still has to deliver what the property promises.
    const source = `protocol Aged { readonly age: integer }
type S = object{age: number} is Aged
let s = S(age: 5)
s.(Aged.age)`;
    expect(diagnosticCodes(source)).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(result(source, new ComputeEngine())).toContain(
      'protocol-implementation-missing'
    );
  });

  test('a fully field-backed conformance raises no end-of-batch pending warning', () => {
    const source = `protocol Identity { readwrite id: string
  readonly tag: string }
type U = object{id: string, tag: string} is Identity
let u = U(id: "a", tag: "b")
(u.(Identity.id), u.(Identity.tag))`;
    const { diagnostics } = executeEpsil(ce, source);
    expect(diagnostics).toEqual([]);
    expect(value(source, new ComputeEngine())).toBe('("a", "b")');
  });

  test('a RECORD type is refused outright by the mutability gate', () => {
    // Appendix B states the field-backing rule for OBJECT types, and the B1
    // mutability gate is why no other kind of type ever gets that far: a
    // record's fields are not slots a setter could write, so a protocol with a
    // `readwrite` property cannot be conformed to by one at all. This is the
    // Badge example from Appendix B, "Which types can conform", verbatim.
    expect(
      result(`protocol Identifiable { readwrite id: string }
type Badge = record{id: string} is Identifiable`)
    ).toBe(
      'Error(ErrorCode("protocol-requires-object", "the `Identifiable` ' +
        'protocol has settable properties. `Badge` is a record, and records ' +
        'are immutable; declare `Badge` as an object type to conform."))'
    );
  });

  test('a READONLY-only protocol still gets no field backing on a record', () => {
    // With nothing settable the gate does not fire, so the original question
    // is still asked — and answered the same way: a record's fields are not
    // slots, so nothing is synthesized and the conformance stays pending.
    expect(
      diagnosticCodes(`protocol Nameable { readonly name: string }
type Badge = record{name: string} is Nameable`)
    ).toEqual(['protocol-implementation-pending']);
  });
});

describe('`readonly` constrains the PROTOCOL view, not the object', () => {
  // OPEN RULING, recorded in `ROADMAP.md` under "`readonly` in a protocol does
  // not stop a holder of the OBJECT from writing the field". Declaring a
  // property `readonly` says what the PROTOCOL promises about it; the object's
  // own field is a slot either way, and a holder of the object writes it
  // without `Named` being consulted. Both halves are pinned so that whichever
  // way the question is ruled — a layout-level `const` field modifier, or
  // requiring a non-writable field to satisfy `readonly` — the change shows up
  // here rather than passing silently.
  const NAMED = `protocol Named { readonly name: string }
type P = object{name: string} is Named
let p = P(name: "Ada")
`;

  test('a direct field write STORES, even though the property is `readonly`', () => {
    expect(value(`${NAMED}p.name = "Grace"\np.name`)).toBe('"Grace"');
  });

  test('the protocol VIEW of the same write is refused', () => {
    // `["ProtocolProperty", protocol, name, receiver, value]` is the setter
    // INVOCATION — the four-operand shape. This is the route that consults the
    // requirement's kind, and the only one that reports the `readonly`.
    executeEpsil(ce, NAMED);
    const written = ce
      .box([
        'ProtocolProperty',
        { str: 'Named' },
        { str: 'name' },
        'p',
        { str: 'Grace' },
      ] as never)
      .evaluate();
    expect(String(written)).toContain('protocol-property-readonly-set');
    // …and the object is untouched, so the two routes really do disagree.
    expect(
      String(ce.box(['Field', 'p', { str: 'name' }] as never).evaluate())
    ).toBe('"Ada"');
  });
});

describe('`object-property-conflict` — field and accessor for one name', () => {
  const CONFLICT_PREFIX = `protocol Nameable { readwrite name: string }
type T = object{name: string}
`;

  test('a `get` accessor beside a stored field is refused (statement route)', () => {
    // The statement is the last one of the program, so its refusal is the
    // program's VALUE; with a statement after it, the same refusal rides as a
    // `runtime-error` diagnostic instead. Both spellings are pinned, since
    // which one a caller sees is an artefact of where the statement sits.
    const block = `type T is Nameable {
  get name(self: Self) -> string { self.name }
  set name(self: Self, v: string) -> T { self }
}`;
    expect(result(`${CONFLICT_PREFIX}${block}`)).toContain(
      '`name` is a stored field of `T` and also has an explicit `get` accessor in this implementation of `Nameable`'
    );
    expect(
      diagnosticCodes(`${CONFLICT_PREFIX}${block}\n1`, new ComputeEngine())
    ).toEqual(['object-property-conflict']);
  });

  test('a `set`-only accessor beside a stored field is refused too', () => {
    const block = `type T is Nameable {
  set name(self: Self, v: string) -> T { self }
}`;
    expect(result(`${CONFLICT_PREFIX}${block}`)).toContain(
      'explicit `set` accessor'
    );
    expect(
      diagnosticCodes(`${CONFLICT_PREFIX}${block}\n1`, new ComputeEngine())
    ).toEqual(['object-property-conflict']);
  });

  test('the host route THROWS on the same conflict', () => {
    executeEpsil(
      ce,
      `protocol Nameable { readwrite name: string }
type H = object{name: string}`
    );
    expect(() =>
      ce.declareProtocolImplementation('H', 'Nameable', {
        getters: { name: (self) => (isObject(self) ? self._field('name') : 0) },
        setters: { name: (self) => self },
      })
    ).toThrow(/object-property-conflict/);
  });

  test('a COMPUTED property — accessors and no field of that name — is fine', () => {
    // The legal shape of the same picture: `label` is not in the layout, so
    // there is nothing for the accessors to conflict with.
    expect(
      value(`protocol Labelled { readwrite label: string }
type C = object{n: integer} is Labelled {
  get label(self: Self) -> string { "n=\\(self.n)" }
  set label(self: Self, v: string) -> C { self.n = 0
    self }
}
let c = C(n: 7)
c.(Labelled.label)`)
    ).toBe('"n=7"');
  });
});

describe('the synthesized accessors', () => {
  test('a qualified READ answers the field', () => {
    expect(
      value(`protocol Nameable { readwrite name: string }
type P = object{name: string} is Nameable
let p = P(name: "Ada")
p.(Nameable.name)`)
    ).toBe('"Ada"');
  });

  test('a WRITE through the box route mutates in place', () => {
    executeEpsil(
      ce,
      `protocol Aged { readwrite age: integer }
type P = object{age: integer} is Aged
let p = P(age: 42)
let q = p`
    );
    const before = objectAt('p');
    expect(before._version).toBe(0);

    const written = ce
      .box([
        'ProtocolProperty',
        { str: 'Aged' },
        { str: 'age' },
        'p',
        43,
      ] as never)
      .evaluate();

    // The setter hands back the RECEIVER, not a rebuilt copy…
    expect(written).toBe(before);
    // …so the alias sees the new value, and the version counter moved.
    expect(value('p.age')).toBe('43');
    expect(value('q.age')).toBe('43');
    expect(before._version).toBe(1);
  });

  const AGED = `protocol Aged { readwrite age: integer }
type P = object{age: integer} is Aged
let p = P(age: 42)`;

  test("a write of the wrong type is refused by the PROPERTY's type check, before the setter runs", () => {
    // `ProtocolProperty`'s set half checks the value against the property's
    // declared type at `Self` = the receiver and never reaches the handler.
    // The synthesized setter's own check is a second line of defence and is
    // driven directly by the test below.
    executeEpsil(ce, AGED);
    const written = ce
      .box([
        'ProtocolProperty',
        { str: 'Aged' },
        { str: 'age' },
        'p',
        { str: 'oops' },
      ] as never)
      .evaluate();
    expect(written.toString()).toContain('incompatible-type');
    expect(value('p.age')).toBe('42');
  });

  test("the synthesized setter re-checks the value against the FIELD's pinned type", () => {
    // Driven through the stored handler itself, which is the only way to reach
    // this check: every route into it passes the property-type check first,
    // and for a `readwrite` requirement the property type and the field type
    // are the same by construction. The guard exists for the case where the
    // two drift apart — an instance keeps the layout it was built with while
    // the registry moves on — so the handler must not trust its caller.
    executeEpsil(ce, AGED);
    const setter = fieldBackedHandler('Aged', '__set__age');
    const refused = setter(objectAt('p'), ce.string('oops'));
    expect(String(refused)).toContain('incompatible-type');
    expect(value('p.age')).toBe('42');
  });

  test('the synthesized getter is a slot load; a non-object receiver stays symbolic', () => {
    // A DECLARED but unassigned binding has the object type statically — a
    // decided type, so resolution commits to the field-backed edge — while its
    // value is still the symbol. Reading it must stay symbolic rather than
    // answer `Nothing` behind a `string` claim.
    expect(
      value(`protocol Nameable { readwrite name: string }
type P = object{name: string} is Nameable
let q: P
q.(Nameable.name)`)
    ).toBe('ProtocolProperty("Nameable", "name", q)');
  });

  test('…and a write onto a non-object receiver stays symbolic too', () => {
    executeEpsil(
      ce,
      `protocol Nameable { readwrite name: string }
type P = object{name: string} is Nameable
let q: P`
    );
    const written = ce.box([
      'ProtocolProperty',
      { str: 'Nameable' },
      { str: 'name' },
      'q',
      { str: 'Ada' },
    ] as never);
    expect(written.evaluate().toString()).toBe(written.toString());
  });

  test('a store through the layout name is seen through an alias, same object', () => {
    executeEpsil(
      ce,
      `protocol Aged { readwrite age: integer }
type P = object{age: integer} is Aged
let p = P(age: 1)
let q = p`
    );
    const before = objectAt('p');
    expect(value('p.age = 9\nq.age')).toBe('9');
    expect(objectAt('q')).toBe(before);
  });

  test('a host implementation may supply the FUNCTION members and leave the properties to the fields', () => {
    executeEpsil(
      ce,
      `protocol Greet { readwrite name: string
  function hello(self: Self) -> string }
type G = object{name: string}`
    );
    ce.declareProtocolImplementation('G', 'Greet', {
      functions: {
        hello: (self) =>
          isObject(self) ? `hi ${self._field('name')!.string}` : '',
      },
    });
    expect(value('let g = G(name: "Ada")\n(hello(g), g.(Greet.name))')).toBe(
      '("hi Ada", "Ada")'
    );
  });
});

describe('a stored field beats an accessor inherited from a SUPERTYPE edge', () => {
  /** `object` — a legal conformance target — implemented with WRITTEN
   * accessors that answer something the stored field never would, so which of
   * the two ran is visible in the value. */
  function conformBareObject(engine: ComputeEngine): void {
    executeEpsil(
      engine,
      `protocol Nameable { readwrite name: string
  function greet(self: Self) -> string }`
    );
    engine.declareProtocolImplementation('object', 'Nameable', {
      getters: { name: () => 'FROM THE SUPERTYPE' },
      setters: { name: (self) => self },
      functions: { greet: () => 'greeted by the supertype' },
    });
  }

  test('the field answers the property, while the function member is still inherited', () => {
    // Both edges carry `__get__name` once field backing is settled, and
    // `Widget` is the more specific target, so ordinary "most specific
    // implementation wins" selection prefers the field load. `greet` is on the
    // `object` edge only, so it is inherited — the subtype edge does not have
    // to reimplement what its fields cannot answer.
    conformBareObject(ce);
    expect(
      value(`type Widget = object{name: string} is Nameable
let w = Widget(name: "own")
(w.(Nameable.name), greet(w))`)
    ).toBe('("own", "greeted by the supertype")');
  });

  test('an object type with no such stored field still gets the written accessor', () => {
    // The other side of the same selection. `Blob` declares no `name` field,
    // so nothing is synthesized on its edge and the property is answered by
    // the `object` edge it inherits from. (A receiver ANNOTATED `object` does
    // not test this: dispatch reads the runtime type, and an evaluated object
    // carries its own nominal type whatever the annotation said.)
    conformBareObject(ce);
    expect(
      value(`type Blob = object{other: integer} is Nameable
let b = Blob(other: 1)
b.(Nameable.name)`)
    ).toBe('"FROM THE SUPERTYPE"');
  });

  test("an author's EMPTY block claims the edge: no second implementation", () => {
    // An empty `is Nameable { }` block is not the same as no block. It claims
    // the edge, so a host implementation of the same pair is refused rather
    // than silently landing on it — which is only decidable because the
    // authored block is stored, not derived from the merged map (once field
    // backing installs its accessors the two look identical).
    //
    // The other consequence of claiming the edge — that it does not inherit a
    // supertype's implementation — has no witness through this route: an
    // authored block that does not cover the requirements is refused outright
    // (`protocol-implementation-missing`) rather than registered as pending,
    // so an empty block can only exist on an edge its own fields complete,
    // and there is then nothing left to inherit. `PropertyOnly` below is such
    // an edge.
    executeEpsil(ce, `protocol PropertyOnly { readwrite name: string }`);
    expect(
      diagnosticCodes(`type Gadget = object{name: string} is PropertyOnly { }`)
    ).toEqual([]);
    expect(value('let g = Gadget(name: "own")\ng.(PropertyOnly.name)')).toBe(
      '"own"'
    );
    expect(() =>
      ce.declareProtocolImplementation('Gadget', 'PropertyOnly', {
        getters: { name: () => 'host' },
        setters: { name: (self) => self },
      })
    ).toThrow(/protocol-implementation-duplicate/);
  });

  test('a BLOCK-LESS edge does inherit, and is replaceable by a host implementation', () => {
    // The contrast case for the test above: with no block written, the edge
    // inherits `greet` from the `object` edge, and a host implementation may
    // still claim it because no author has.
    conformBareObject(ce);
    expect(
      value(`type Gizmo = object{name: string} is Nameable
let z = Gizmo(name: "own")
(z.(Nameable.name), greet(z))`)
    ).toBe('("own", "greeted by the supertype")');
    expect(() =>
      ce.declareProtocolImplementation('Gizmo', 'Nameable', {
        functions: { greet: () => 'host' },
      })
    ).not.toThrow();
    expect(value('greet(z)')).toBe('"host"');
    // …and the property is STILL field-backed after the host block landed.
    expect(value('z.(Nameable.name)')).toBe('"own"');
  });
});

describe('re-settling an unchanged edge leaves its map alone', () => {
  test('a later conformance registration does not rebuild a settled map', () => {
    // Every conformance registration re-settles every block-less edge of the
    // protocol. The registry's rollback thunk compares implementation maps BY
    // REFERENCE to decide whether it restored anything, so handing back a
    // fresh-but-equal map on each pass would report a registry change that did
    // not happen — a spurious `config` state event, invalidating caches that
    // are still valid. Both the map and the individual accessors must survive.
    executeEpsil(
      ce,
      `protocol Nameable { readwrite name: string }
type P = object{name: string} is Nameable`
    );
    const edge = ce._protocolRegistry['Nameable']!.conformances.find(
      (c) => c.targetKey === 'P'
    )!;
    const impl = edge.impl;
    const getter = impl!['__get__name'];
    expect(getter).toBeDefined();

    executeEpsil(ce, `type Q = object{name: string} is Nameable`);
    expect(edge.impl).toBe(impl);
    expect(edge.impl!['__get__name']).toBe(getter);

    executeEpsil(ce, `type R = object{name: string} is Nameable`);
    expect(edge.impl).toBe(impl);
  });
});

describe('dispatch through a member that stores into a field', () => {
  test('the member returns the SAME object, and the field reads the new value', () => {
    const PROGRAM = `protocol Aged { readwrite age: integer
  function birthday(self: Self) -> Self }
type P = object{age: integer} is Aged {
  function birthday(self: P) -> P { self.age = self.age + 1
    self }
}
let p = P(age: 42)
`;
    executeEpsil(ce, PROGRAM);
    const before = objectAt('p');
    expect(value('let q = birthday(p)\n(q.age, p.age)')).toBe('(43, 43)');
    expect(objectAt('q')).toBe(before);
  });
});

describe('computed properties are unchanged (pins, not new behavior)', () => {
  test('the getter runs on EVERY access', () => {
    // The field the getter reads is mutated between the two reads, so a
    // getter that had been evaluated once and cached would answer "n=1"
    // twice.
    expect(
      value(`protocol Labelled { readonly label: string }
type P = object{n: integer} is Labelled {
  get label(self: Self) -> string { "n=\\(self.n)" }
}
let p = P(n: 1)
let a = p.(Labelled.label)
p.n = 2
let b = p.(Labelled.label)
(a, b)`)
    ).toBe('("n=1", "n=2")');
  });

  const COUNTED = `let calls = 0
function once() scope -> string { calls = calls + 1
  "x" }
protocol Labelled { readwrite label: string }
type P = object{seen: string} is Labelled {
  get label(self: Self) -> string { self.seen }
  set label(self: Self, v: string) -> P { self.seen = v
    self }
}
let p = P(seen: "-")
`;

  test('the setter receives the EVALUATED value, computed exactly once (parse route)', () => {
    expect(value(`${COUNTED}p.label = once()\n(p.seen, calls)`)).toBe(
      '("x", 1)'
    );
  });

  test('…and on the box route', () => {
    executeEpsil(ce, COUNTED);
    const written = ce
      .box([
        'ProtocolProperty',
        { str: 'Labelled' },
        { str: 'label' },
        'p',
        ['Apply', 'once'],
      ] as never)
      .evaluate();
    expect(written).toBe(objectAt('p'));
    expect(value('(p.seen, calls)')).toBe('("x", 1)');
  });
});

describe('protocol replacement re-settles field backing', () => {
  test('a retyped property makes the edge pending again, and restoring it heals', () => {
    // Cross-BATCH redeclaration is the notebook pattern and is allowed (a
    // second declaration within one batch is refused). What matters here is
    // that no accessor synthesized against the old requirement survives the
    // replacement: the edge is re-derived against the type's fixed layout,
    // which never migrates.
    expect(
      value(`protocol Aged { readwrite age: integer }
type P = object{age: integer} is Aged
let p = P(age: 42)
p.(Aged.age)`)
    ).toBe('42');

    expect(diagnosticCodes('protocol Aged { readwrite age: string }')).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(result('p.(Aged.age)')).toContain('protocol-implementation-missing');

    expect(diagnosticCodes('protocol Aged { readwrite age: integer }')).toEqual(
      []
    );
    expect(value('p.(Aged.age)')).toBe('42');
  });
});

describe("Appendix B's `Person` example, verbatim", () => {
  test('"Happy birthday, Alan Turing! You are 43."', () => {
    // Copied from `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Objects and
    // protocols" — the protocol, the conforming object type with its computed
    // `get fullName` and its `function birthday`, and the using program. The
    // four `readwrite` properties carry no accessor: the stored fields answer
    // them. `p.age` reads 43 because `birthday(p)` in the first interpolation
    // segment changed the object before the second segment read it.
    expect(
      value(`protocol Identifiable {
  readwrite firstName: string
  readwrite lastName: string
  readonly fullName: string
  readwrite age: integer
  readwrite role: string
  function birthday(self: Self) -> Self
}
type Person = object{
  firstName: string,
  lastName: string,
  age: integer,
  role: string
} is Identifiable {
  // fullName is not a stored field: it is computed on demand.
  get fullName(self: Person) -> string {
    "\\(self.firstName) \\(self.lastName)"
  }
  function birthday(self: Person) -> Person {
    self.age = self.age + 1
    self   // the protocol promises that birthday returns Self
  }
}
const p = Person(firstName: "Alan", lastName: "Turing",
                 age: 42, role: "scientist")
"Happy birthday, \\(birthday(p).fullName)! You are \\(p.age)."`)
    ).toBe('"Happy birthday, Alan Turing! You are 43."');
  });
});
