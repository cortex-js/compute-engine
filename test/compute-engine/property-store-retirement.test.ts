import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Retiring Appendix A's property REBINDING sugar.
//
// `p.name = v` used to be sugar for `p = «set name»(p, v)`: the setter built a
// new value and the assignment REBOUND the variable, which is the only meaning
// available in a language whose values are all immutable. With mutable objects
// in the language (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B) the assignment is a
// STORE instead: it runs the property's `set` accessor against the object the
// receiver refers to, every alias of that object sees the change, and the
// statement evaluates to the value assigned. It is legal on objects and on
// nothing else — a value receiver is `immutable-value-assignment`.
//
// What this file pins is the part that is easy to get half-right: the two
// TIMINGS. A whole Epsil batch is canonicalized before any of it runs, so `p`
// is routinely still untyped at `p.name = v` and the target's verdict is
// deferred to evaluation; run the same program across two batches and the type
// is settled at canonicalization instead. The Phase-1D aliasing defect was
// exactly those two routes disagreeing, so every refusal and every store is
// checked on both.
//
// Protocols are engine-global, so every block uses a fresh engine.
//

/** A `readwrite` property on an OBJECT — the only receiver a settable property
 * admits (Appendix B, "Which types can conform"). `name` is COMPUTED: the
 * stored field is `n`, so the hand-written accessors are what run rather than
 * the accessors the engine synthesizes for a same-named field. */
const PERSON = `protocol Nameable {
  readwrite name: string
}
type Person = object{n: string, age: integer}
type Person is Nameable {
  get name(self: Self) -> string { self.n }
  set name(self: Self, v: string) -> Self {
    self.n = v
    self
  }
}`;

/** A `readonly` property on a VALUE type. A value type can carry no other kind
 * of property: the mutability gate refuses a `readwrite` one. */
const TAGGED_TUPLE = `protocol Tagged { readonly tag: string }
type Pt = tuple<x: integer>
type Pt is Tagged { get tag(self: Self) -> string { "t" } }`;

/** Run `source` on a fresh engine, or on `ce`. Returns the value of the last
 * statement and the diagnostics. */
function run(
  source: string,
  ce = new ComputeEngine()
): { value: string; diagnostics: string[]; ce: ComputeEngine } {
  const r = executeEpsil(ce, source);
  return {
    value: String(r.value),
    diagnostics: r.diagnostics.map((d) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    ),
    ce,
  };
}

/** The `ErrorCode` of an error value, or `undefined`. */
function errorCode(s: string): string | undefined {
  return /ErrorCode\("([^"]+)"/.exec(s)?.[1];
}

describe('a VALUE receiver is refused on BOTH timings', () => {
  test('ONE batch — the target is untyped at canonicalization, refused at evaluation', () => {
    const { value, diagnostics } = run(`${TAGGED_TUPLE}
let q = Pt(1)
q.tag = "z"`);
    expect(diagnostics).toEqual([]);
    expect(errorCode(value)).toBe('immutable-value-assignment');
  });

  test('TWO batches — the target is typed at canonicalization, refused there', () => {
    const { ce } = run(`${TAGGED_TUPLE}
let q = Pt(1)`);
    expect(errorCode(run('q.tag = "z"', ce).value)).toBe(
      'immutable-value-assignment'
    );
  });

  test('the message names both ways out', () => {
    const { ce } = run(`${TAGGED_TUPLE}
let q = Pt(1)`);
    const message = run('q.tag = "z"', ce).value;
    expect(message).toContain('is not an object type');
    expect(message).toContain('Build an updated copy');
    expect(message).toContain('object{…}');
  });

  test('…and the QUALIFIED spelling agrees', () => {
    // `q.(Tagged.tag) = v` writes through the protocol view. It must not report
    // `protocol-property-readonly-set`: the property being read-only is beside
    // the point when nothing about `q` can be written at all.
    const { ce } = run(`${TAGGED_TUPLE}
let q = Pt(1)`);
    expect(errorCode(run('q.(Tagged.tag) = "z"', ce).value)).toBe(
      'immutable-value-assignment'
    );
  });

  test('the receiver is not rebound, and nothing is silently swallowed', () => {
    const { ce } = run(`${TAGGED_TUPLE}
let q = Pt(1)`);
    run('q.tag = "z"', ce);
    expect(run('q', ce).value).toBe('Pt(1)');
  });
});

describe('an OBJECT receiver stores, on BOTH timings', () => {
  test('ONE batch: the store runs and the assignment answers the value', () => {
    const { value, diagnostics } = run(`${PERSON}
let p = Person(n: "Bob", age: 42)
p.name = "Ada"`);
    expect(diagnostics).toEqual([]);
    expect(value).toBe('"Ada"');
  });

  test('TWO batches: same answer', () => {
    const { ce } = run(`${PERSON}
let p = Person(n: "Bob", age: 42)`);
    expect(run('p.name = "Ada"', ce).value).toBe('"Ada"');
    expect(run('p', ce).value).toBe('Person(n: "Ada", age: 42)');
  });

  test('the object is mutated IN PLACE — every alias sees it', () => {
    expect(
      run(`${PERSON}
let p = Person(n: "Bob", age: 42)
let alias = p
let xs = [p]
p.name = "Ada"
(alias.name, xs[1].name)`).value
    ).toBe('("Ada", "Ada")');
  });

  test('the setter receives the EVALUATED value', () => {
    // The right-hand side is evaluated before the handler runs, exactly as a
    // stored field's is (Appendix B, "A store writes the evaluated value"), so
    // the accessor never sees an unevaluated expression: the slot it writes
    // holds `21`, not `k + 1`.
    const { value } = run(`protocol Scored { readwrite score: integer }
type Player = object{pts: integer}
type Player is Scored {
  get score(self: Self) -> integer { self.pts }
  set score(self: Self, v: integer) -> Self { self.pts = v
    self }
}
let p = Player(pts: 1)
let k = 20
p.score = k + 1
p.pts`);
    expect(value).toBe('21');
  });

  test('a computed setter that STORES NOTHING leaves the object alone', () => {
    // The handler's result is discarded, so a setter that rebuilds instead of
    // storing changes nothing — the behaviour the retired sugar supplied by
    // rebinding the variable to that result.
    expect(
      run(`protocol Nameable { readwrite name: string }
type Person = object{n: string}
type Person is Nameable {
  get name(self: Self) -> string { self.n }
  set name(self: Self, v: string) -> Person { Person(n: v) }
}
let p = Person(n: "Bob")
p.name = "Ada"
p.n`).value
    ).toBe('"Bob"');
  });
});

describe('a single-letter receiver is not folded into a library constant', () => {
  test('`e.name = v` and `i.name = v` store, and are not refused statically', () => {
    // `Assign` keeps its left operand RAW so that a single-letter target is not
    // canonicalized into the library constant of that name (`e` → Euler's
    // number, `i` → the imaginary unit). The static refusal has to honour the
    // same rule: it reads a bare-symbol receiver off its definition, and defers
    // when that definition is a CONSTANT — which is what `e` still resolves to
    // while the write is being canonicalized and the user's `let e = …` has not
    // run yet. Refusing there reported `immutable-value-assignment` about
    // Euler's number for a binding that holds an object by the time the write
    // runs.
    for (const name of ['e', 'i', 'd']) {
      expect(
        run(`${PERSON}
let ${name} = Person(n: "Bob", age: 42)
${name}.name = "Ada"
${name}.name`).value
      ).toBe('"Ada"');
    }
  });

  test('…on the box route too, where the binding does not exist yet', () => {
    // The shape that forces the question: the assignment is canonicalized
    // BEFORE the binding exists, so the name resolves to the constant.
    for (const name of ['e', 'i']) {
      const { ce } = run(PERSON);
      const assign = ce.box([
        'Assign',
        ['Field', name, { str: 'name' }],
        { str: 'Ada' },
      ] as never);
      expect(assign.toString()).toBe(`Assign(Field(${name}, "name"), "Ada")`);
      run(`let ${name} = Person(n: "Bob", age: 42)`, ce);
      expect(assign.evaluate().toString()).toBe('"Ada"');
    }
  });

  test('a store into a genuine constant is still refused, at evaluation', () => {
    // What deferring costs: the refusal moves from canonicalization to
    // evaluation. It is the same refusal.
    const { ce } = run(PERSON);
    expect(
      errorCode(
        ce
          .box(['Assign', ['Field', 'Pi', { str: 'name' }], { str: 'x' }] as never)
          .evaluate()
          .toString()
      )
    ).toBe('immutable-value-assignment');
  });
});

describe('a refused write costs the RIGHT-HAND SIDE nothing', () => {
  // A refusal that does not depend on the value must not fire the value's
  // effects. Both spellings run their value-independent refusals first — for
  // the qualified one that means `Assign` keeps its wrapper through
  // canonicalization rather than folding into the four-operand
  // `ProtocolProperty`, which is not lazy and would evaluate its operands
  // before it could refuse.
  const COUNTER = `let calls = 0
function bump() scope -> string { calls = calls + 1
  "z" }`;

  const READONLY = `protocol Named { readonly name: string }
type Box = object{v: string}
type Box is Named { get name(self: Self) -> string { self.v } }
${COUNTER}
let b = Box(v: "a")`;

  const VALUE = `protocol Tagged { readonly tag: string }
type Pt = tuple<x: integer>
type Pt is Tagged { get tag(self: Self) -> string { "t" } }
${COUNTER}
let q = Pt(1)`;

  test.each([
    ['unqualified, readonly', READONLY, 'b.name = bump()', 'protocol-property-readonly-set'],
    ['qualified, readonly', READONLY, 'b.(Named.name) = bump()', 'protocol-property-readonly-set'],
    ['unqualified, value receiver', VALUE, 'q.tag = bump()', 'immutable-value-assignment'],
    ['qualified, value receiver', VALUE, 'q.(Tagged.tag) = bump()', 'immutable-value-assignment'],
  ])('%s: refused, and `bump()` never runs', (_label, setup, write, code) => {
    const { ce } = run(setup);
    expect(errorCode(run(write, ce).value)).toBe(code);
    expect(run('calls', ce).value).toBe('0');
  });

  test('a well-typed qualified write still reaches the setter', () => {
    // The control: refusing early must not refuse everything.
    const { ce } = run(`${PERSON}
${COUNTER}
let p = Person(n: "Bob", age: 42)`);
    expect(run('p.(Nameable.name) = bump()', ce).value).toBe('"z"');
    expect(run('calls', ce).value).toBe('1');
    expect(run('p.n', ce).value).toBe('"z"');
  });
});

describe('a receiver whose VALUE is not an object yet stays symbolic', () => {
  // A declared-but-unassigned binding is typed by its annotation, and a nominal
  // object type is a DECIDED type — so resolution commits, but there is no
  // object to store into. Running an authored setter against a symbol and then
  // answering as if the store had happened would be a lie; so would calling the
  // target immutable, since its type is an object type. Stay symbolic, exactly
  // as a property READ does for the same receiver.
  const AGED = `protocol Aged { readwrite age: integer }
type Q = object{n: integer} is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}
let q: Q`;

  test('the QUALIFIED write stays symbolic', () => {
    const { ce } = run(AGED);
    expect(run('q.(Aged.age) = 5', ce).value).toBe(
      'ProtocolProperty("Aged", "age", q, 5)'
    );
  });

  test('the UNQUALIFIED write stays symbolic', () => {
    const { ce } = run(AGED);
    expect(run('q.age = 5', ce).value).toBe('Assign(Field(q, "age"), 5)');
  });
});

describe('a READONLY property on an object', () => {
  test('a COMPUTED one refuses the write on both timings', () => {
    const READONLY = `protocol Named { readonly name: string }
type Box = object{v: string}
type Box is Named { get name(self: Self) -> string { self.v } }`;

    expect(
      errorCode(
        run(`${READONLY}
let b = Box(v: "a")
b.name = "z"`).value
      )
    ).toBe('protocol-property-readonly-set');

    const { ce } = run(`${READONLY}
let b = Box(v: "a")`);
    expect(errorCode(run('b.name = "z"', ce).value)).toBe(
      'protocol-property-readonly-set'
    );
  });
});
