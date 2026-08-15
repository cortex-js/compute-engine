import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

//
// Protocol PROPERTIES — phase 4 of `docs/plans/2026-08-12-protocols-design.md`
// (rulings P18, P2, P6) and `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A,
// "Properties".
//
// A property rides the `Field` operator: `person.name` resolves through the
// conformance registry when the ordinary field routes (a record body, a
// named-tuple body, a dictionary) have nothing to say. Selection is P1's — the
// most specific non-pending conformance whose implementation carries
// `__get__<name>`, inheritance included — and several applicable protocols are
// `protocol-property-ambiguous`.
//
// Assignment is REBINDING SUGAR (P2): `p.name = v` ⇝ `p = «set name»(p, v)`.
// A qualified read (`p.(Nameable.name)`, P6) lowers to the `ProtocolProperty`
// operator, the field-grammar amendment to D16.
//
// Protocols are engine-global, so every block uses a fresh engine.
//

/** A `Person` nominal conforming to a `readwrite name` protocol. */
const PERSON = `protocol Nameable {
  readwrite name: string
}
type Person = tuple<n: string, age: integer>
type Person is Nameable {
  get name(self: Self) -> string { self.n }
  set name(self: Self, v: string) -> Person { Person(v, self.age) }
}`;

/** Run an Epsil program on `ce`, returning the diagnostic codes. */
function run(ce: ComputeEngine, source: string): string[] {
  return executeEpsil(ce, source).diagnostics.map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

/** The value of the last statement, as a string. */
function value(ce: ComputeEngine, source: string): string {
  return String(executeEpsil(ce, source).value);
}

/** A fresh engine with `source` executed on it (no diagnostics expected). */
function engineFor(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  expect(run(ce, source)).toEqual([]);
  return ce;
}

/** The `ErrorCode` of an error value, or `undefined`. */
function errorCode(s: string): string | undefined {
  return /ErrorCode\("([^"]+)"/.exec(s)?.[1];
}

describe('P18: reading a property', () => {
  test('a NOMINAL target: `type:` and `evaluate:` both answer', () => {
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    const field = ce.box(['Field', 'p', { str: 'name' }] as any);
    expect(field.type.toString()).toBe('string');
    expect(field.evaluate().toString()).toBe('"Bob"');
  });

  test('a BUILTIN target conforms just as well', () => {
    const ce = engineFor(`protocol Tagged { readonly tag: string }
type string is Tagged {
  get tag(self: Self) -> string { "s" }
}`);
    expect(value(ce, '"hi".tag')).toBe('"s"');
    expect(
      ce.box(['Field', { str: 'hi' }, { str: 'tag' }] as any).type.toString()
    ).toBe('string');
  });

  test('an INHERITED getter: the supertype implementation applies', () => {
    // `integer` has no implementation of its own; `number`'s applies through
    // subtyping, exactly as it does for a dispatched function member.
    const ce = engineFor(`protocol Sized { readonly size: integer }
type number is Sized {
  get size(self: Self) -> integer { 1 }
}
type integer is Sized
let n = 3`);
    expect(value(ce, 'n.size')).toBe('1');
  });

  test('the MOST SPECIFIC conformance wins', () => {
    const ce = engineFor(`protocol Sized { readonly size: integer }
type number is Sized {
  get size(self: Self) -> integer { 1 }
}
type integer is Sized {
  get size(self: Self) -> integer { 2 }
}
let n = 3
let x = 3.5`);
    expect(value(ce, 'n.size')).toBe('2');
    expect(value(ce, 'x.size')).toBe('1');
  });

  test('an ORDINARY field is untouched by the protocol branch', () => {
    // The nominal's own named-tuple field still resolves through the type
    // definition — the property branch only runs when that comes up empty.
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    expect(value(ce, 'p.age')).toBe('42');
    expect(value(ce, 'p.n')).toBe('"Bob"');
  });

  test('a name NO protocol declares keeps `unknown-field`', () => {
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    expect(errorCode(value(ce, 'p.zz'))).toBe('unknown-field');
  });

  test('SEVERAL applicable protocols are `protocol-property-ambiguous`', () => {
    const ce = engineFor(`protocol Nameable { readonly name: string }
protocol Titled { readonly name: string }
type string is Nameable { get name(self: Self) -> string { "a" } }
type string is Titled { get name(self: Self) -> string { "b" } }`);
    const r = value(ce, '"x".name');
    expect(errorCode(r)).toBe('protocol-property-ambiguous');
    expect(r).toContain('Nameable');
    expect(r).toContain('Titled');
  });

  test('a PENDING conformance is not a candidate', () => {
    const ce = new ComputeEngine();
    run(
      ce,
      `protocol Tagged { readonly tag: string }
type string is Tagged`
    );
    // The edge exists but carries no implementation, so the read falls back
    // to the ordinary non-field-bearing verdict.
    expect(errorCode(value(ce, '"x".tag'))).toBe('incompatible-type');
  });

  test('an UNKNOWN-typed receiver stays symbolic', () => {
    const ce = engineFor(`protocol Tagged { readonly tag: string }
type string is Tagged { get tag(self: Self) -> string { "s" } }`);
    ce.declare('opaque', { type: 'unknown' });
    expect(
      ce.box(['Field', 'opaque', { str: 'tag' }] as any).evaluate().operator
    ).toBe('Field');
  });
});

describe('P18: HOST-declared getters and setters', () => {
  function hostEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareProtocol('Nameable', { readwrite: { name: 'string' } });
    ce.declareType('Person', 'tuple<n: string, age: integer>');
    ce.declareProtocolImplementation('Person', 'Nameable', {
      getters: { name: (self: any) => self.ops[0] },
      setters: {
        name: (self: any, v: any) => ce.function('Person', [v, self.ops[1]]),
      },
    });
    return ce;
  }

  test('a host getter answers `person.name`', () => {
    const ce = hostEngine();
    ce.assign('p', ce.function('Person', [ce.string('Bob'), ce.number(42)]));
    expect(value(ce, 'p.name')).toBe('"Bob"');
    expect(ce.box(['Field', 'p', { str: 'name' }] as any).type.toString()).toBe(
      'string'
    );
  });

  test('a host setter drives the rebinding sugar', () => {
    const ce = hostEngine();
    ce.assign('p', ce.function('Person', [ce.string('Bob'), ce.number(42)]));
    expect(value(ce, 'p.name = "Steve"\np.name')).toBe('"Steve"');
  });
});

describe('P2: assignment is rebinding sugar', () => {
  test('`p.name = v` rebinds `p` — the whole value changes', () => {
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    expect(run(ce, 'p.name = "Steve"')).toEqual([]);
    // The REBINDING is what is observable: `p` itself is a new value.
    expect(value(ce, 'p')).toBe('Person("Steve", 42)');
    expect(value(ce, 'p.name')).toBe('"Steve"');
    expect(value(ce, 'p.age')).toBe('42');
  });

  test('…in ONE batch too (the pre-pass defers the untyped target)', () => {
    // The Epsil static pre-pass canonicalizes the whole batch before anything
    // runs, so `p` is still untyped at `p.name = …`: the `Field` target is
    // kept raw and resolved again from `evaluate`. No spurious diagnostic.
    const ce = new ComputeEngine();
    const source = `${PERSON}
let p = Person("Bob", 42)
p.name = "Steve"
p.name`;
    expect(run(ce, source)).toEqual([]);
    expect(value(new ComputeEngine(), source)).toBe('"Steve"');
  });

  test('`:=` takes the same route', () => {
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    expect(run(ce, 'p.name := "Ada"')).toEqual([]);
    expect(value(ce, 'p')).toBe('Person("Ada", 42)');
  });

  test('a READONLY property is `protocol-property-readonly-set`', () => {
    const ce = engineFor(`protocol Tagged { readonly tag: string }
type string is Tagged { get tag(self: Self) -> string { "s" } }
let x = "hi"`);
    expect(errorCode(value(ce, 'x.tag = "z"'))).toBe(
      'protocol-property-readonly-set'
    );
  });

  test('a NON-variable root is `property-assignment-target-invalid`', () => {
    const ce = engineFor(`protocol Tagged { readwrite tag: string }
type string is Tagged {
  get tag(self: Self) -> string { "s" }
  set tag(self: Self, v: string) -> string { v }
}
let xs = ["a", "b"]`);
    expect(errorCode(value(ce, 'xs[1].tag = "z"'))).toBe(
      'property-assignment-target-invalid'
    );
  });

  test('a NON-protocol field assignment is `immutable-value-assignment`', () => {
    // `Field`/`At` assignment is otherwise rejected (the immutable value
    // model); only the protocol-property case is claimed here.
    //
    // The CODE changed with the property store (`docs/TYPE_SYSTEM_ROADMAP.md`
    // Appendix B, "Assigning to a property" and its "Changes to Appendix A"
    // item 1): a field assignment is now a store, so the refusal names what is
    // actually wrong — the target is immutable — instead of reporting that a
    // `Field` is not a `symbol`, which described the old rebinding lowering
    // rather than anything the author wrote.
    const ce = new ComputeEngine();
    expect(errorCode(value(ce, 'let d = {"a" -> 1}\nd.a = 2'))).toBe(
      'immutable-value-assignment'
    );
    expect(
      errorCode(
        value(ce, 'type Pt = tuple<x: integer>\nlet q = Pt(1)\nq.x = 2')
      )
    ).toBe('immutable-value-assignment');
  });

  test('the box route rewrites the same way', () => {
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    expect(
      ce
        .box(['Assign', ['Field', 'p', { str: 'name' }], { str: 'Zed' }] as any)
        .evaluate()
        .toString()
    ).toBe('Person("Zed", 42)');
    expect(ce.box('p').evaluate().toString()).toBe('Person("Zed", 42)');
  });
});

describe('P6: the qualified property form `p.(P.name)`', () => {
  test('it parses to `ProtocolProperty`', () => {
    const [expr, diags] = parseEpsil('p.(Nameable.name)');
    expect(diags ?? []).toEqual([]);
    expect(JSON.stringify(expr)).toContain('ProtocolProperty');
  });

  test('it round-trips through the serializer', () => {
    const [expr] = parseEpsil('p.(Nameable.name)');
    expect(serializeEpsil(expr as any)).toBe('p.(Nameable.name)');
    const [again] = parseEpsil(serializeEpsil(expr as any));
    expect(JSON.stringify(again)).toBe(JSON.stringify(expr));
  });

  test('a chained base is parenthesized on the way back out', () => {
    const [expr] = parseEpsil('xs[1].(P.n)');
    expect(serializeEpsil(expr as any)).toBe('xs[1].(P.n)');
  });

  test('it DISAMBIGUATES two protocols sharing a property name', () => {
    const ce = engineFor(`protocol Nameable { readonly name: string }
protocol Titled { readonly name: string }
type string is Nameable { get name(self: Self) -> string { "plain" } }
type string is Titled { get name(self: Self) -> string { "titled" } }
let x = "z"`);
    expect(errorCode(value(ce, 'x.name'))).toBe('protocol-property-ambiguous');
    expect(value(ce, 'x.(Nameable.name)')).toBe('"plain"');
    expect(value(ce, 'x.(Titled.name)')).toBe('"titled"');
  });

  test('the box route reaches the same dispatch', () => {
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    const expr = ce.box([
      'ProtocolProperty',
      { str: 'Nameable' },
      { str: 'name' },
      'p',
    ] as any);
    expect(expr.type.toString()).toBe('string');
    expect(expr.evaluate().toString()).toBe('"Bob"');
  });

  test('an unknown protocol is `protocol-unknown`', () => {
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    expect(errorCode(value(ce, 'p.(Nowhere.name)'))).toBe('protocol-unknown');
  });

  test('a member of the wrong KIND is `unknown-field`', () => {
    const ce = engineFor(`protocol Comparable {
  function compare(self: Self, other: Self) -> string
}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "=" }
}
let x = "z"`);
    expect(errorCode(value(ce, 'x.(Comparable.compare)'))).toBe(
      'unknown-field'
    );
  });

  test('qualified ASSIGNMENT is `property-assignment-target-invalid`', () => {
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    expect(errorCode(value(ce, 'p.(Nameable.name) = "x"'))).toBe(
      'property-assignment-target-invalid'
    );
    expect(errorCode(value(ce, 'p.(Nameable.name) := "x"'))).toBe(
      'property-assignment-target-invalid'
    );
  });

  test('anything but SYMBOL `.` SYMBOL keeps the bad-field-name recovery', () => {
    for (const source of ['p.(P)', 'p.()', 'p.(1.2)', 'p.(P.)']) {
      const [, diags] = parseEpsil(source);
      expect((diags ?? []).map((d) => d.message[0])).toContain(
        'symbol-expected'
      );
    }
  });

  test('the UNQUALIFIED field grammar is unchanged', () => {
    const [expr, diags] = parseEpsil('a.b.c');
    expect(diags ?? []).toEqual([]);
    expect(serializeEpsil(expr as any)).toBe('a.b.c');
  });
});

describe('P41: a BAKED protocol re-resolves when it no longer applies', () => {
  // P2's sugar resolves the winning protocol at CANONICALIZATION and bakes its
  // name into `ProtocolProperty(P, name, p, v)`, while the receiver is read
  // again at every evaluation. Re-running the same canonical `Assign` after its
  // root was rebound to a type conforming through a DIFFERENT protocol must
  // dispatch to that one instead of reporting a missing implementation.
  const TWO_PROTOCOLS = `protocol Plain { readwrite name: string }
protocol Fancy { readwrite name: string }
type string is Plain {
  get name(self: Self) -> string { "s" }
  set name(self: Self, v: string) -> string { v }
}
type integer is Fancy {
  get name(self: Self) -> string { "i" }
  set name(self: Self, v: string) -> integer { 99 }
}
let x = "a"`;

  test('the write follows the receiver, not the baked name', () => {
    const ce = engineFor(TWO_PROTOCOLS);
    const assign = ce.box([
      'Assign',
      ['Field', 'x', { str: 'name' }],
      { str: 'z' },
    ] as any);
    expect(assign.toString()).toBe(
      'Assign(x, ProtocolProperty("Plain", "name", x, "z"))'
    );
    expect(assign.evaluate().toString()).toBe('"z"');

    // …now `x` holds an integer, which conforms through `Fancy`.
    ce.assign('x', ce.number(7));
    expect(assign.evaluate().toString()).toBe('99');
    expect(ce.box('x').evaluate().toString()).toBe('99');
  });

  test('a receiver no protocol answers for keeps the missing-implementation error', () => {
    const ce = engineFor(TWO_PROTOCOLS);
    const assign = ce.box([
      'Assign',
      ['Field', 'x', { str: 'name' }],
      { str: 'z' },
    ] as any);
    expect(assign.evaluate().toString()).toBe('"z"');
    ce.assign('x', ce.box(['List', 1, 2] as any));
    expect(errorCode(assign.evaluate().toString())).toBe(
      'protocol-implementation-missing'
    );
  });
});

describe('P25 amendment: a `set` handler’s result rebinds the receiver', () => {
  const person = (setter: string) => `protocol Nameable {
  readwrite name: string
}
type Person = tuple<n: string, age: integer>
type Person is Nameable {
  get name(self: Self) -> string { self.n }
  ${setter}
}
let p = Person("Bob", 42)`;

  test('an ANNOTATED result that is not the receiver is refused at registration', () => {
    const ce = new ComputeEngine();
    expect(
      run(
        ce,
        `protocol Nameable {
  readwrite name: string
}
type Person = tuple<n: string, age: integer>`
      )
    ).toEqual([]);
    const result = executeEpsil(
      ce,
      `type Person is Nameable {
  get name(self: Self) -> string { self.n }
  set name(self: Self, v: string) -> string { v }
}`
    );
    expect(errorCode(result.value.toString())).toBe(
      'protocol-signature-mismatch'
    );
    expect(result.value.toString()).toContain('rebinds the receiver');
    expect(ce._protocolRegistry.Nameable.conformances).toEqual([]);
  });

  test('an annotated result that FITS the receiver is accepted', () => {
    const ce = engineFor(
      person(
        'set name(self: Self, v: string) -> Person { Person(v, self.age) }'
      )
    );
    expect(value(ce, 'p.name = "Ada"')).toBe('Person("Ada", 42)');
  });

  test('an UNANNOTATED handler stays trusted at registration (P28)', () => {
    // …and is caught at the write instead: the value it returns is checked
    // before the receiver is rebound.
    const ce = engineFor(person('set name(self: Self, v: string) { v }'));
    expect(errorCode(value(ce, 'p.name = "Ada"'))).toBe('incompatible-type');
    // The refused write left the binding alone.
    expect(value(ce, 'p')).toBe('Person("Bob", 42)');
  });
});

describe('a WRITE checks the value against the property’s type', () => {
  // The setter used to be invoked with whatever the assignment carried. An
  // Epsil handler catches a mistyped value on its own parameter, but a HOST
  // callback is trusted with whatever it is handed (P10), so the check belongs
  // to the write — on BOTH routes to it.
  /** A `Person` whose accessors are host callbacks that record their calls. */
  function hostEngine(): [ComputeEngine, unknown[][]] {
    const ce = new ComputeEngine();
    const invoked: unknown[][] = [];
    ce.declareProtocol('Nameable', { readwrite: { name: 'string' } });
    ce.declareType('Person', 'tuple<n: string, age: integer>');
    ce.declareProtocolImplementation('Person', 'Nameable', {
      getters: { name: (self: any) => self.ops[0] },
      setters: {
        name: (...args: any[]) => {
          invoked.push(args);
          return ce.function('Person', [args[1], args[0].ops[1]]);
        },
      },
    });
    ce.assign('p', ce.function('Person', [ce.string('Bob'), ce.number(42)]));
    return [ce, invoked];
  }

  test('the rebinding sugar refuses it, and the handler is not invoked', () => {
    const [ce, invoked] = hostEngine();
    expect(errorCode(value(ce, 'p.name = 42'))).toBe('incompatible-type');
    expect(invoked).toHaveLength(0);
    // The refused write left the binding alone…
    expect(value(ce, 'p')).toBe('Person("Bob", 42)');
    // …and a well-typed one still reaches the handler.
    expect(value(ce, 'p.name = "Ada"')).toBe('Person("Ada", 42)');
    expect(invoked).toHaveLength(1);
  });

  test('the `ProtocolProperty` write operator checks it too', () => {
    // The canonical sugar is not the only route to the setter: the operator's
    // own evaluate half is reached by the box route, and by a canonical program
    // whose receiver changed type under it (P41).
    const [ce, invoked] = hostEngine();
    const write = (v: unknown) =>
      ce
        .box([
          'ProtocolProperty',
          { str: 'Nameable' },
          { str: 'name' },
          'p',
          v,
        ] as any)
        .evaluate()
        .toString();
    expect(errorCode(write(42))).toBe('incompatible-type');
    expect(invoked).toHaveLength(0);
    expect(write({ str: 'Zed' })).toBe('Person("Zed", 42)');
    expect(invoked).toHaveLength(1);
  });

  test('an EPSIL setter refuses it as well', () => {
    const ce = engineFor(`${PERSON}\nlet p = Person("Bob", 42)`);
    expect(errorCode(value(ce, 'p.name = 42'))).toBe('incompatible-type');
    expect(value(ce, 'p')).toBe('Person("Bob", 42)');
    expect(value(ce, 'p.name = "Steve"')).toBe('Person("Steve", 42)');
  });
});

describe('a DEFERRED write checks the EVALUATED value, not the raw RHS', () => {
  const SCORED = `protocol Scored {
  readwrite score: integer
}
type Person = tuple<n: string, age: integer>
type Person is Scored {
  get score(self: Self) -> integer { self.age }
  set score(self: Self, v: integer) -> Self { Person(self.n, v) }
}`;

  test('a loop-body SET whose value reads the loop index takes effect', () => {
    // Regression: the deferred `Assign(Field(…))` route ran the value-fit
    // check on the RAW RHS, and `10 * i` statically types `finite_number` —
    // wider than the `integer` property — so the write was refused, and the
    // refusal error was discarded in statement position: a silent no-op
    // (each iteration read back the ORIGINAL `age`, answering 3), while the
    // compiled tier performed the write and answered 60.
    const ce = engineFor(`${SCORED}
function f() -> integer {
  let acc = 0
  for i in 1..3 {
    let q: Person = Person("bob", 1)
    q.score = 10 * i
    acc = acc + q.score
  }
  acc
}`);
    expect(value(ce, 'f()')).toBe('60');
  });

  test('a genuinely mistyped value is still refused on the deferred route', () => {
    // The check now sees the CONCRETE value, so a real mismatch is still an
    // `incompatible-type` refusal that leaves the binding alone. Boxed
    // BEFORE `d` exists, so the `Field` LHS survives canonicalization (the
    // deferral) and the check runs at evaluation.
    const ce = engineFor(SCORED);
    const assign = ce.box([
      'Assign',
      ['Field', 'd', { str: 'score' }],
      { str: 'nope' },
    ] as any);
    expect(assign.toString()).toBe('Assign(Field(d, "score"), "nope")');
    expect(run(ce, 'let d = Person("bob", 1)')).toEqual([]);
    expect(errorCode(assign.evaluate().toString())).toBe('incompatible-type');
    expect(value(ce, 'd')).toBe('Person("bob", 1)');
  });
});

describe('P38: a DEFERRED target that is not a protocol property after all', () => {
  test('it produces the field-assignment refusal, not silence', () => {
    // `d` is undeclared when the assignment canonicalizes, so the `Field` LHS
    // survives (the deferral) — by the time it evaluates, `d` is an ordinary
    // record that conforms to nothing.
    //
    // What matters here is that the refusal is REPORTED rather than swallowed
    // by evaluating the `Field` and returning nothing. Its code became
    // `immutable-value-assignment` with the property store: every route has
    // declined, so the target is an immutable value being stored into
    // (Appendix B, "Assigning to a property").
    const ce = engineFor(`protocol Tagged { readwrite tag: string }
type string is Tagged {
  get tag(self: Self) -> string { "s" }
  set tag(self: Self, v: string) -> string { v }
}`);
    const assign = ce.box(['Assign', ['Field', 'd', { str: 'tag' }], 5] as any);
    expect(assign.toString()).toBe('Assign(Field(d, "tag"), 5)');

    expect(run(ce, 'let d = {"tag" -> 1}')).toEqual([]);
    const result = assign.evaluate();
    expect(result.operator).toBe('Error');
    expect(errorCode(result.toString())).toBe('immutable-value-assignment');
  });
});
