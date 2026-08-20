/**
 * The PROPERTY STORE — `p.age = 43`.
 *
 * Assignment through a field target is a store into a mutable object, and it
 * is legal on nothing else. Spec: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B,
 * "Assigning to a property" (the store and its `immutable-value-assignment`
 * refusal), "A store writes the evaluated value" (the RHS is evaluated at the
 * exact tier, once, at the store), "References, not copies" (a store through
 * one name is visible through every other), and ruling B8 (operands evaluate
 * left to right).
 *
 * The VALUE's contract — identity, equality, cycles — is pinned by
 * `object-core.test.ts`; the cache-invalidation consequences of a store by
 * `object-caching.test.ts`. This file is about the store operation itself:
 * which targets it accepts, what it writes, and what it refuses.
 *
 * Both surfaces are exercised. The Epsil route is how a user writes a store;
 * the box route is the raw `Assign(Field(…))` MathJSON the engine also has to
 * handle, and it takes a DIFFERENT path through the canonical handler (the
 * receiver's type is settled at canonicalization there, and deferred under
 * the Epsil pre-pass, which canonicalizes a whole program before any of it
 * runs).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isObject } from '../../src/compute-engine/boxed-expression/type-guards';
import { objectReadCount } from '../../src/compute-engine/boxed-expression/object-deps';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** Run an Epsil program, returning the final value as a string. Diagnostics
 * are asserted empty: a store test that silently reported a static error and
 * then checked an unchanged value would pass for the wrong reason. */
function value(source: string, engine = ce): string {
  const { value, diagnostics } = executeEpsil(engine, source);
  expect(diagnostics).toEqual([]);
  return String(value);
}

/** Run an Epsil program, returning the final value WITHOUT asserting that it
 * ran cleanly — for the refusal cases, where the point is the error. */
function result(source: string, engine = ce): string {
  return String(executeEpsil(engine, source).value);
}

/** The `ErrorCode` of an error value, or `undefined`. */
function errorCode(s: string): string | undefined {
  return /ErrorCode\("([^"]+)"/.exec(s)?.[1];
}

/** The object currently bound to `name`. */
function objectAt(name: string, engine = ce) {
  const o = engine.box(name).evaluate();
  if (!isObject(o)) throw new Error(`\`${name}\` is not an object: ${o}`);
  return o;
}

const PERSON = `type Person = object{name: string, age: integer}`;

describe('THE STORE — a field of an object can be assigned', () => {
  test('`p.age = 43` writes the field and the read sees it', () => {
    expect(
      value(`${PERSON}
let p = Person(name: "Alan", age: 42)
p.age = 43
p.age`)
    ).toBe('43');
  });

  test('the assignment EVALUATES to the stored value', () => {
    // `Assign` yields the value it wrote, so a store is usable in expression
    // position exactly as an ordinary assignment is.
    expect(
      value(`${PERSON}
let p = Person(name: "Alan", age: 42)
p.age = 43`)
    ).toBe('43');
  });

  test('the OTHER fields are untouched', () => {
    expect(
      value(`${PERSON}
let p = Person(name: "Alan", age: 42)
p.age = 43
p.name`)
    ).toBe('"Alan"');
  });

  test('`:=` takes the same route', () => {
    expect(
      value(`${PERSON}
let p = Person(name: "Alan", age: 42)
p.age := 43
p.age`)
    ).toBe('43');
  });

  test('the object is MUTATED, not replaced — the same instance answers', () => {
    // The distinction from the rebinding sugar this replaces: there, `p.x = v`
    // rebuilt the value and rebound the name, so the old instance was
    // untouched. Here there is one instance throughout, and its identity is
    // preserved across the store.
    const engine = new ComputeEngine();
    value(
      `${PERSON}
let p = Person(name: "Alan", age: 42)`,
      engine
    );
    const before = objectAt('p', engine);
    value('p.age = 43', engine);
    const after = objectAt('p', engine);
    expect(after).toBe(before);
    expect(after._version).toBe(1);
  });

  test('the box route stores too', () => {
    const engine = new ComputeEngine();
    value(
      `${PERSON}
let p = Person(name: "Alan", age: 42)`,
      engine
    );
    const assign = engine.box([
      'Assign',
      ['Field', 'p', { str: 'age' }],
      7,
    ] as any);
    expect(assign.evaluate().toString()).toBe('7');
    expect(engine.box('p.age' as never)).toBeDefined();
    expect(objectAt('p', engine)._field('age')?.toString()).toBe('7');
  });

  test('a store to a CONST binding still works — the binding is not written', () => {
    // `const d = …` freezes the NAME, not the object it refers to. Appendix B,
    // "References, not copies": a const binding to an object still allows the
    // object's fields to change, because the store writes the heap record and
    // never the binding.
    expect(
      value(`${PERSON}
const p = Person(name: "Alan", age: 42)
p.age = 43
p.age`)
    ).toBe('43');
  });
});

describe('REFERENCES, NOT COPIES — a store is visible through every alias', () => {
  test('two names for one object see each other‘s stores', () => {
    expect(
      value(`type MutableData = object{id: string, value: string}
let d = MutableData(id: "1234", value: "foo")
let e = d
d.id = "0000"
e.id`)
    ).toBe('"0000"');
  });

  test('a function receives the object itself and can modify it', () => {
    expect(
      value(`type MutableData = object{id: string, value: string}
let d = MutableData(id: "1234", value: "foo")
function rename(x: MutableData) { x.id = "XXXX" }
rename(d)
d.id`)
    ).toBe('"XXXX"');
  });

  test('a store through a LIST element reaches the same object', () => {
    // The target does not have to be a variable: any expression that evaluates
    // to an object can be stored into.
    expect(
      value(`type P = object{name: string}
let a = P(name: "x")
let xs = [a, P(name: "y")]
xs[1].name = "z"
a.name`)
    ).toBe('"z"');
  });

  test('a store through a CHAIN of references reaches the inner object', () => {
    expect(
      value(`type Inner = object{n: integer}
type Outer = object{inner: Inner}
let inner = Inner(n: 1)
let outer = Outer(inner: inner)
outer.inner.n = 9
inner.n`)
    ).toBe('9');
  });
});

describe("PRECEDENCE — the object's own layout beats a protocol property", () => {
  // An object's stored fields belong to the object. When a `readwrite`
  // protocol happens to declare a property of the same name, the STORE still
  // wins: the slot is written directly rather than through an accessor that may
  // do anything at all with the value it is handed.
  //
  // The rule this pins — a name the layout declares is a store, any other name
  // goes to the protocol route — is the DISPATCH-level statement of what
  // `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B ("Objects and protocols", the
  // three field-backed-satisfaction rules) says about declarations: a stored
  // field satisfies a `readwrite` requirement on its own, a computed property
  // has accessors and NO stored field, and a name is "field-backed or
  // computed, never both".
  //
  // The fixture below is the LEGAL way for a name to be both a stored field
  // and a protocol property: field-backed satisfaction. `P` writes no
  // accessors at all, and the engine synthesizes them from the stored `name`,
  // so both routes could claim `p.name = v`. The two tests that follow pin
  // that the STORE route wins in both timing shapes — receiver typed at
  // canonicalization, and receiver untyped so the decision is remade at
  // evaluation — which is what this block is about. They do not exercise the
  // synthesized setter; that handler, and the fact that it agrees (an
  // in-place store into the one object), is covered by
  // `protocol-field-backed.test.ts`. Writing the accessors out BESIDE the
  // stored field, which this fixture used to do, is now refused at
  // declaration; that refusal is pinned by the last test of this block.
  const OVERLAP = `protocol Nameable { readwrite name: string }
type P = object{name: string} is Nameable
let p = P(name: "Bob")
let q = p`;

  test('the store wins when the receiver is TYPED at canonicalization', () => {
    // Two batches, so `p` is already typed when `p.name = …` canonicalizes —
    // the shape in which the protocol lowering used to fire.
    const engine = new ComputeEngine();
    value(OVERLAP, engine);
    const before = objectAt('p', engine);
    value('p.name = "Steve"', engine);
    expect(value('p.name', engine)).toBe('"Steve"');
    expect(value('q.name', engine)).toBe('"Steve"');
    // …and it is the SAME object throughout, not a setter-built replacement.
    expect(objectAt('p', engine)).toBe(before);
    expect(before._version).toBe(1);
  });

  test('…and when it is UNTYPED, so both routes agree', () => {
    // One batch: the Epsil pre-pass canonicalizes before anything runs, so the
    // receiver is untyped and the decision is remade at evaluation. Route
    // parity is the point — the same program must not depend on which.
    const engine = new ComputeEngine();
    value(`${OVERLAP}\np.name = "Steve"`, engine);
    expect(value('p.name', engine)).toBe('"Steve"');
    expect(value('q.name', engine)).toBe('"Steve"');
  });

  test('writing accessors BESIDE the stored field is `object-property-conflict`', () => {
    // The shape this block's fixture used to have, before field-backed
    // satisfaction made it unnecessary and Appendix B's conflict rule made it
    // illegal: a name is field-backed or computed, never both. Refused at
    // declaration, so the ambiguity never reaches dispatch at all.
    const engine = new ComputeEngine();
    expect(
      result(
        `protocol Nameable { readwrite name: string }
type P = object{name: string}
type P is Nameable {
  get name(self: Self) -> string { self.name }
  set name(self: Self, v: string) -> P { P(name: v) }
}`,
        engine
      )
    ).toContain('object-property-conflict');
  });

  test('a COMPUTED protocol property on an object reaches its setter', () => {
    // The other side of the precedence rule, and a regression test. A
    // conforming object may answer a name that is NOT one of its stored
    // fields — Appendix B's "computed" property: accessors, no backing field.
    // The store route must DECLINE such a name rather than reporting
    // `unknown-field`, so the protocol's `set` accessor runs.
    //
    // Boxed before `p` exists, so the receiver is untyped at canonicalization
    // and the assignment defers to evaluation — the route where a real receiver
    // is in hand. The `Field` READ handler has always consulted the protocol
    // route before erroring; the store now matches it.
    const engine = new ComputeEngine();
    const assign = engine.box([
      'Assign',
      ['Field', 'p', { str: 'label' }],
      { str: 'Steve' },
    ] as never);
    expect(assign.toString()).toBe('Assign(Field(p, "label"), "Steve")');
    value(
      `protocol Labelled { readwrite label: string }
type P = object{n: string}
type P is Labelled {
  get label(self: Self) -> string { self.n }
  set label(self: Self, v: string) -> P { self.n = v
    self }
}
let p = P(n: "Bob")`,
      engine
    );
    expect(assign.evaluate().toString()).toBe('"Steve"');
    expect(value('p.label', engine)).toBe('"Steve"');
  });

  test('a name NEITHER the layout nor any protocol declares is `unknown-field`', () => {
    // …and the refusal for an object receiver names the fields it DOES have,
    // rather than claiming the object is immutable — which is what the
    // catch-all refusal would otherwise say once the store route learned to
    // decline an unknown name.
    const engine = new ComputeEngine();
    const assign = engine.box([
      'Assign',
      ['Field', 'p', { str: 'nope' }],
      1,
    ] as never);
    value(
      `type P = object{n: string}
let p = P(n: "Bob")`,
      engine
    );
    const r = assign.evaluate().toString();
    expect(errorCode(r)).toBe('unknown-field');
    expect(r).toContain('n');
  });

  test('a protocol property that is NOT a stored field reaches its setter', () => {
    // The precedence rule is narrow: it claims only names the receiver's own
    // layout declares. `name` is a COMPUTED property — no slot of `Person`
    // carries it — so the layout has nothing to say and the protocol's `set`
    // accessor answers.
    //
    // The receiver is an OBJECT type because the B1 mutability gate
    // (Appendix B, "Which types can conform") admits only object types to a
    // protocol with a `readwrite` property. A setter that REBUILDS instead of
    // storing changes nothing: its result is discarded, so `r` keeps the name
    // it was built with — pinned below, because that is what the retired
    // rebinding sugar used to make work.
    const engine = new ComputeEngine();
    const conformance = (setterBody: string) => `protocol Nameable { readwrite name: string }
type Person = object{n: string, age: integer}
type Person is Nameable {
  get name(self: Self) -> string { self.n }
  set name(self: Self, v: string) -> Person { ${setterBody} }
}
let r = Person(n: "Bob", age: 42)`;
    value(conformance('self.n = v\n    self'), engine);
    expect(value('r.name = "Steve"', engine)).toBe('"Steve"');
    expect(value('r', engine)).toBe('Person(n: "Steve", age: 42)');

    const rebuilding = new ComputeEngine();
    value(conformance('Person(n: v, age: self.age)'), rebuilding);
    expect(value('r.name = "Steve"', rebuilding)).toBe('"Steve"');
    expect(value('r', rebuilding)).toBe('Person(n: "Bob", age: 42)');
  });
});

describe('THE RECEIVER IS EVALUATED EXACTLY ONCE', () => {
  test('…including on the path where every route refuses', () => {
    // A receiver is an arbitrary expression and may carry effects. The refusal
    // path needs its TYPE to phrase `immutable-value-assignment`, and used to
    // re-evaluate it to get one — firing the receiver's effects a second time
    // to produce an error message.
    const engine = new ComputeEngine();
    let calls = 0;
    engine.declare('Recv', {
      signature: '() -> unknown',
      evaluate: () => {
        calls += 1;
        return engine.number(3);
      },
    } as never);
    // Boxed directly: an `unknown` result type defers past canonicalization, so
    // the refusal is made at evaluation, where the receiver is a real value.
    const assign = engine.box([
      'Assign',
      ['Field', ['Recv'], { str: 'zz' }],
      5,
    ] as never);
    expect(errorCode(assign.evaluate().toString())).toBe(
      'immutable-value-assignment'
    );
    expect(calls).toBe(1);
  });
});

describe('A STORE WRITES THE EVALUATED VALUE', () => {
  test('the RHS is evaluated before it is stored', () => {
    expect(
      value(`type P = object{n: integer}
let p = P(n: 0)
p.n = 2 + 3
p.n`)
    ).toBe('5');
  });

  test('read-modify-write reads the current value', () => {
    expect(
      value(`${PERSON}
let p = Person(name: "Alan", age: 42)
p.age = p.age + 1
p.age`)
    ).toBe('43');
  });

  test('the stored value is EXACT — evaluated, never numericized', () => {
    // `evaluate()`, not `.N()`: the exactness contract applies to a store
    // exactly as it does to an ordinary assignment.
    expect(
      value(`type P = object{v: number}
let p = P(v: 0)
p.v = Sqrt(2)
p.v`)
    ).toBe('sqrt(2)');
  });

  test('the RHS is evaluated exactly ONCE, at the store', () => {
    // "RHS effects fire once, at the store, and are never re-fired by later
    // reads." A counter incremented by the RHS makes a second evaluation
    // visible; reading the field afterwards must not move it either.
    const engine = new ComputeEngine();
    expect(
      value(
        `type P = object{n: integer}
let p = P(n: 0)
let calls = 0
function bump() scope -> integer { calls = calls + 1
  7 }
p.n = bump()
calls`,
        engine
      )
    ).toBe('1');
    expect(value('p.n\np.n\ncalls', engine)).toBe('1');
  });

  test('an identical-node store is a total no-op — no version bump', () => {
    // The suppression is IDENTITY-only by ruling (the decision note's
    // `_store` paragraph: `value === current ⇒ return`, mirroring the value
    // setter in `boxed-value-definition.ts`). `p.n = p.n` reads the stored
    // node and hands the very same node back, so nothing is written.
    const engine = new ComputeEngine();
    value(
      `type P = object{n: integer}
let p = P(n: 1)`,
      engine
    );
    const p = objectAt('p', engine);
    expect(p._version).toBe(0);
    value('p.n = p.n', engine);
    expect(p._version).toBe(0);
    value('p.n = 2', engine);
    expect(p._version).toBe(1);
  });

  test('an equal NUMBER or STRING literal does not bump — the guard reaches past identity', () => {
    // Identity alone was too narrow to be useful. The elision was licensed by
    // the claim that equal small integers share one boxed node engine-wide,
    // which holds for a host-built `ce.number(1)` but NOT for a literal that
    // came through the parser: it carries its own source offsets and is a
    // distinct instance. So `p.n = 1` over a stored `1` used to bump the
    // version and invalidate every cache entry that had read the field,
    // although no reader could observe a difference.
    //
    // Widened to value equality for NUMBER and STRING literals only. Not for
    // operands in general: `isSame` would be sound anywhere, but it walks
    // structure, and that walk would be paid on every store — including the
    // ones that genuinely change something — in exactly the store-heavy loops
    // objects exist for.
    const engine = new ComputeEngine();
    value(
      `type P = object{n: integer}
let p = P(n: 1)`,
      engine
    );
    const p = objectAt('p', engine);
    value('p.n = 1', engine);
    expect(p._version).toBe(0);
    // A store that DOES change the value still bumps.
    value('p.n = 2', engine);
    expect(p._version).toBe(1);

    const s = new ComputeEngine();
    value(
      `type S = object{t: string}
let q = S(t: "a")`,
      s
    );
    const q = objectAt('q', s);
    value('q.t = "a"', s);
    expect(q._version).toBe(0);
    value('q.t = "b"', s);
    expect(q._version).toBe(1);
  });

  test('a same-valued number reached by EVALUATION is suppressed too', () => {
    // It is the operand arriving at `_store` that decides, not the syntax
    // that produced it: `2 + 3` folds to a number literal equal to the stored
    // 5, so the store is redundant and elided.
    const engine = new ComputeEngine();
    value(
      `type P = object{n: integer}
let p = P(n: 5)`,
      engine
    );
    const p = objectAt('p', engine);
    value('p.n = 2 + 3', engine);
    expect(p._version).toBe(0);

    // The HOST route, whose literals are the interned ones, suppresses too.
    const q = engine._object('P', { n: engine.number(5) });
    if (!isObject(q)) throw new Error('expected an object');
    q._store('n', engine.number(5));
    expect(q._version).toBe(0);
  });

  test('an equal value of a DIFFERENT type still bumps', () => {
    // `isSame` is a value equivalence that spans representations: the exact
    // rational 1/2 and the float 0.5 are `isSame`, as are the one-cluster
    // string "a" and the character 'a'. Suppressing on value alone would drop
    // a store that changes `isExact`, the MathJSON, or the operand's type —
    // all observable — so the guard requires the types to agree as well.
    const engine = new ComputeEngine();
    value(
      `type P = object{n: number}
let p = P(n: 1/2)`,
      engine
    );
    const p = objectAt('p', engine);
    value('p.n = 0.5', engine);
    expect(p._version).toBe(1);
    expect(value('p.n', engine)?.toString()).toBe('0.5');
  });

  test('a NON-LITERAL operand keeps the identity-only guard', () => {
    // The widening is confined to numbers and strings. Two structurally equal
    // but distinct function expressions are NOT elided — deciding that would
    // cost a structural walk on every store, which is the price the ruling
    // declined to pay.
    const engine = new ComputeEngine();
    const q = engine._object('Q', { f: engine.parse('x + 1') });
    if (!isObject(q)) throw new Error('expected an object');
    const equalButDistinct = engine.parse('x + 1');
    expect(q._store('f', equalButDistinct)).toBeUndefined();
    expect(q._version).toBe(1);
  });
});

describe('CHANGING A FIELD IS AN EFFECT', () => {
  test('a function whose body stores infers `state`', () => {
    // Appendix B, "Changing a field is an effect": a store is observable to
    // the caller beyond the return value, so it carries `state`. It gets no
    // confinement exemption — the write lands in a record the caller handed
    // in, so it escapes however local the parameter looks.
    const engine = new ComputeEngine();
    value(
      `type M = object{id: string}
function rename(x: M) { x.id = "XXXX" }`,
      engine
    );
    const def = engine.lookupDefinition('rename') as never as {
      operator?: { effects?: unknown };
    };
    expect(def.operator?.effects).toEqual(['state']);
  });

  test('annotating a storing function `pure` is refused', () => {
    // The contract check is what makes the label worth having: a `pure`
    // promise on a body that mutates its argument is a false contract, and
    // purity is what licenses caching and constant folding downstream.
    const engine = new ComputeEngine();
    value('type M = object{id: string}', engine);
    expect(
      errorCode(
        result('function k(x: M) pure -> nothing { x.id = "Z" }', engine)
      )
    ).toBe('incompatible-type');
  });

  test('a computed property SET on an object is EXACTLY `state` — no `scope`', () => {
    // The canary for the blunt fix that was tried and rejected (denying the
    // confinement exemption to every `Field` target broke six shipped tests):
    // a property store writes no binding at all, so `scope` must NOT appear.
    //
    // `state` DOES appear, and is correct: the B1 mutability gate makes the
    // receiver an object type, and a property SET on an object is a heap store
    // whatever the selected setter does — the rule `Walker.isFieldStore` in
    // `effects-inference.ts` applies unconditionally. (The setter below rebuilds
    // rather than storing, so the write in fact changes nothing; the verdict
    // deliberately does not consult the registry to find that out, because an
    // inference walk runs before, and independently of, conformance
    // registration.)
    const engine = new ComputeEngine();
    value(
      `protocol Nameable { readwrite name: string }
type Person = object{n: string, age: integer}
type Person is Nameable {
  get name(self: Self) -> string { self.n }
  set name(self: Self, v: string) -> Person { Person(n: v, age: self.age) }
}
function relabel(p: Person) -> Person { p.name = "Zed"
  p }`,
      engine
    );
    const def = engine.lookupDefinition('relabel') as never as {
      operator?: { effects?: unknown };
    };
    expect(def.operator?.effects).toEqual(['state']);
  });
});

describe('EVALUATION ORDER — the receiver, then the value (B8)', () => {
  test('the receiver expression is evaluated before the RHS', () => {
    // Both sides record their order in a shared log. Appendix B pins
    // left-to-right wherever operands evaluate, and a store is no exception:
    // `xs[i]` resolves before the value it will hold is computed.
    const engine = new ComputeEngine();
    expect(
      value(
        `type P = object{n: integer}
let log = 0
function receiver() scope state -> P { log = log * 10 + 1
  P(n: 0) }
function val() scope -> integer { log = log * 10 + 2
  1 }
receiver().n = val()
log`,
        engine
      )
    ).toBe('12');
  });
});

describe('REFUSALS — what cannot be stored into', () => {
  test('a RECORD target is `immutable-value-assignment`', () => {
    const r = result(`type Pt = tuple<x: integer>
let q = Pt(1)
q.x = 2`);
    expect(errorCode(r)).toBe('immutable-value-assignment');
    // The message names both ways out, because which one is right depends on
    // what the author meant.
    expect(r).toContain('not an object type');
    expect(r).toContain('object{…}');
  });

  test('a DICTIONARY target is refused the same way', () => {
    expect(
      errorCode(
        result(`let d = {"a" -> 1}
d.a = 2`)
      )
    ).toBe('immutable-value-assignment');
  });

  test('a SCALAR target is refused the same way', () => {
    expect(
      errorCode(
        result(`let n = 3
n.x = 2`)
      )
    ).toBe('immutable-value-assignment');
  });

  test('a field the LAYOUT does not carry is `unknown-field`, naming the ones it has', () => {
    // An object's field list is fixed at declaration, so a name it does not
    // carry is a defect and not an out-of-band write: no field is created.
    const r = result(`${PERSON}
let p = Person(name: "Alan", age: 42)
p.height = 3`);
    expect(errorCode(r)).toBe('unknown-field');
    expect(r).toContain('name, age');
  });

  test('a value that does not fit the DECLARED field type is refused', () => {
    const engine = new ComputeEngine();
    value(
      `${PERSON}
let p = Person(name: "Alan", age: 42)`,
      engine
    );
    expect(errorCode(result('p.age = "old"', engine))).toBe(
      'incompatible-type'
    );
    // …and the refusal leaves the field alone: a rejected store writes nothing.
    expect(value('p.age', engine)).toBe('42');
    expect(objectAt('p', engine)._version).toBe(0);
  });

  test('a REFUSED store does not evaluate the RHS', () => {
    // The refusals above are decided from the target alone, so an effectful
    // RHS must not fire: there is no store for its effects to belong to.
    const engine = new ComputeEngine();
    expect(
      result(
        `let calls = 0
function bump() scope -> integer { calls = calls + 1
  1 }
let n = 3
n.x = bump()`,
        engine
      )
    ).toContain('immutable-value-assignment');
    expect(value('calls', engine)).toBe('0');
  });

  test('a receiver that itself failed propagates ITS error, not an immutability one', () => {
    // Reporting "not an object type" for a receiver whose own initializer
    // failed would name the wrong defect and bury the real one.
    const r = result(`${PERSON}
let p = Person(name: "Alan")
p.age = 1`);
    expect(errorCode(r)).not.toBe('immutable-value-assignment');
  });
});

describe('THE STATE EVENT — a store reports, and advances nothing', () => {
  test('a store reports an `object-store` event', () => {
    const engine = new ComputeEngine();
    const seen: string[] = [];
    const original = engine._noteStateEvent.bind(engine);
    (engine as unknown as { _noteStateEvent: unknown })._noteStateEvent = (e: {
      kind: string;
    }) => {
      seen.push(e.kind);
      return original(e as never);
    };
    value(
      `type P = object{n: integer}
let p = P(n: 1)`,
      engine
    );
    seen.length = 0;
    objectAt('p', engine)._store('n', engine.number(2));
    expect(seen).toEqual(['object-store']);
  });

  test('a SUPPRESSED (identical-node) store reports nothing at all', () => {
    // The no-op guard is total: no version bump AND no event, so a loop that
    // rewrites the same value costs nothing anywhere.
    const engine = new ComputeEngine();
    const seen: string[] = [];
    const original = engine._noteStateEvent.bind(engine);
    (engine as unknown as { _noteStateEvent: unknown })._noteStateEvent = (e: {
      kind: string;
    }) => {
      seen.push(e.kind);
      return original(e as never);
    };
    value(
      `type P = object{n: integer}
let p = P(n: 1)`,
      engine
    );
    const p = objectAt('p', engine);
    const same = p._field('n')!;
    seen.length = 0;
    p._store('n', same);
    expect(seen).toEqual([]);
  });

  test('a store-heavy loop leaves the engine axes exactly where it found them', () => {
    // The acceptance criterion for the zero-mask ruling: objects exist for
    // store-heavy workloads, and a per-store axis bump would cold every
    // generation-keyed cache in the engine on every iteration. A thousand
    // stores must be invisible to the axes.
    const engine = new ComputeEngine();
    value(
      `type Acc = object{total: integer}
let a = Acc(total: 0)`,
      engine
    );
    const a = objectAt('a', engine);
    const axes = engine as unknown as {
      _anyVersion: number;
      _semanticVersion: number;
      _worldVersion: number;
      _callableVersion: number;
    };
    const before = [
      axes._anyVersion,
      axes._semanticVersion,
      axes._worldVersion,
      axes._callableVersion,
    ];
    for (let i = 1; i <= 1000; i++) a._store('total', engine.number(i));
    expect([
      axes._anyVersion,
      axes._semanticVersion,
      axes._worldVersion,
      axes._callableVersion,
    ]).toEqual(before);
    // Non-vacuity: the stores really happened, and the per-object counter —
    // the channel that DOES carry the consequence — moved once per store.
    expect(a._version).toBe(1000);
    expect(a._field('total')?.toString()).toBe('1000');
  });
});

describe('LAYOUT PINNING — a store type-checks against the instance', () => {
  test('the field type comes from the PINNED layout, not the registry', () => {
    // A `type` re-run replaces the registry record IN PLACE. An instance built
    // before it keeps its own layout, so a store into it is checked against
    // the type the field actually has — not against whatever the name means
    // now. Two batches, because a redeclaration WITHIN one program is refused
    // by the redefinition discipline; across notebook cells it is the ordinary
    // way a type evolves, and it is exactly the case pinning exists for.
    const engine = new ComputeEngine();
    expect(
      executeEpsil(engine, 'type P = object{v: integer}\nlet a = P(v: 1)')
        .diagnostics
    ).toEqual([]);
    expect(
      executeEpsil(engine, 'type P = object{v: string}\nlet b = P(v: "s")')
        .diagnostics
    ).toEqual([]);

    expect(objectAt('a', engine)._fieldType('v')).toBe('integer');
    expect(objectAt('b', engine)._fieldType('v')).toBe('string');

    // …and the STORE follows the pin: `a` still holds an integer field, so a
    // string is refused even though `P` now names a string-valued layout.
    expect(errorCode(result('a.v = "nope"', engine))).toBe('incompatible-type');
    expect(value('a.v = 2\na.v', engine)).toBe('2');
    expect(value('b.v = "t"\nb.v', engine)).toBe('"t"');
  });

  test('`_fieldType` is `undefined` for a name the layout does not carry', () => {
    const engine = new ComputeEngine();
    engine.declareType('P', 'object{v: integer}');
    const p = engine._object('P', { v: engine.number(1) });
    if (!isObject(p)) throw new Error('expected an object');
    expect(p._fieldType('nope')).toBeUndefined();
  });

  test('reading the field TYPE is not a field READ — it records no dependency', () => {
    // The layout is fixed at construction; only the slots change. A cache
    // entry that asked what type `v` is has not thereby become sensitive to
    // what `v` holds.
    const engine = new ComputeEngine();
    engine.declareType('P', 'object{v: integer}');
    const p = engine._object('P', { v: engine.number(1) });
    if (!isObject(p)) throw new Error('expected an object');
    const before = objectReadCount();
    p._fieldType('v');
    expect(objectReadCount()).toBe(before);
    // Non-vacuity: an actual field read DOES move the counter.
    p._field('v');
    expect(objectReadCount()).toBe(before + 1);
  });
});

describe('STALENESS — a store invalidates what read the field', () => {
  test('a value derived from a field is recomputed after a store', () => {
    // The end-to-end statement of ruling B3 on the user-facing surface: no
    // cache may serve a field-derived value across a store. The per-cache
    // adversarial matrix lives in `object-caching.test.ts`; this is the
    // property store driving it.
    const engine = new ComputeEngine();
    expect(
      value(
        `${PERSON}
let p = Person(name: "Alan", age: 42)
function describe_() -> integer { p.age * 2 }
describe_()`,
        engine
      )
    ).toBe('84');
    expect(value('p.age = 50\ndescribe_()', engine)).toBe('100');
  });

  test('a collection built from a field is rebuilt after a store', () => {
    const engine = new ComputeEngine();
    expect(
      value(
        `type P = object{n: integer}
let p = P(n: 2)
function xs() -> list<integer> { Map((i) => i * p.n, 1..3) }
Last(xs())`,
        engine
      )
    ).toBe('6');
    expect(value('p.n = 10\nLast(xs())', engine)).toBe('30');
  });
});
