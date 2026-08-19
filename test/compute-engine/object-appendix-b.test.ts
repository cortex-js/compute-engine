/**
 * APPENDIX B's OWN EXAMPLES, verbatim.
 *
 * `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B ("Mutable objects") illustrates the
 * design with a handful of Epsil programs and states what each one produces.
 * This file runs those programs AS WRITTEN in the appendix and asserts the
 * documented result, so the specification text and the engine cannot drift
 * apart silently: a change to either shows up here. Each test names the
 * appendix section it comes from; the program text is copied from the
 * section, comments included, and should be updated only together with the
 * appendix.
 *
 * Which examples are pinned:
 *
 * - "The idea" / "Objects and protocols" — the `Person` birthday flow, in the
 *   appendix's full form: `Person` declared `is Identifiable { get fullName …
 *   function birthday … }`, with the four `readwrite` properties left to the
 *   stored fields of the same name. The implemented object and protocol model
 *   is in `docs/TYPE-SYSTEM.md`: field-backed satisfaction covers the
 *   properties no accessor is written for. What the flow demonstrates is the
 *   `const` binding, `birthday` storing into `self` and returning it, and the
 *   interpolated string reading the already-incremented `age` because its
 *   segments evaluate left to right.
 * - "Assigning to a property" — `MutableData` store, and the record refusal.
 * - "References, not copies" — aliasing through a second name and through a
 *   function argument.
 * - "Every construction makes a new object" and "Equality" — `==` on objects.
 * - "Cycles" — the `Buddy` loop.
 * - "The idea" — `const` protects the binding, not the contents.
 *
 * `object-core.test.ts`, `object-store.test.ts` and `object-caching.test.ts`
 * cover the mechanisms behind these; this file only asks whether the spec's
 * examples say what they claim.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** Run an Epsil program and return the final value as a string, asserting it
 * ran without diagnostics — an example that failed to parse would otherwise
 * be reported as "wrong value" instead of "does not run as written". */
function value(source: string): string {
  const { value, diagnostics } = executeEpsil(ce, source);
  expect(diagnostics).toEqual([]);
  return String(value);
}

/** Run an Epsil program and return the final value WITHOUT asserting on
 * diagnostics — for the examples whose documented outcome IS an error. */
function result(source: string): string {
  return String(executeEpsil(ce, source).value);
}

/** The `ErrorCode` of an error value, or `undefined`. */
function errorCode(s: string): string | undefined {
  return /ErrorCode\("([^"]+)"/.exec(s)?.[1];
}

const MUTABLE_DATA = `type MutableData = object{id: string, value: string}`;

describe('"The idea" — the motivating statement', () => {
  test('`p.age = p.age + 1` on a `const p` modifies the object, not the binding', () => {
    // The appendix opens with the `const p: Person = getUser(); p.age =
    // p.age + 1` example that Appendix A's rebinding sugar could not serve
    // (rebinding a `const` is an error). With objects the statement "does
    // what it looks like it does".
    expect(
      value(`type Person = object{
  firstName: string,
  lastName: string,
  age: integer,
  role: string
}
function getUser() state -> Person {
  Person(firstName: "Alan", lastName: "Turing", age: 42, role: "scientist")
}
const p: Person = getUser()
p.age = p.age + 1
p.age`)
    ).toBe('43');
  });
});

describe('"Objects and protocols" — the Person birthday flow', () => {
  // The appendix's own declarations, copied verbatim: the `Identifiable`
  // protocol, and `Person` conforming to it with a computed `get fullName`
  // and a `function birthday`. The four `readwrite` properties carry no
  // accessor — the stored fields of the same name and type satisfy them
  // (field-backed satisfaction, Phase 2 of
  // `docs/TYPE-SYSTEM.md`).
  const PERSON = `protocol Identifiable {
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
                 age: 42, role: "scientist")`;

  test('the constructor takes one NAMED argument per stored field, in any order', () => {
    expect(
      value(`type Person = object{
  firstName: string,
  lastName: string,
  age: integer,
  role: string
}
const p = Person(role: "scientist", age: 42,
                 lastName: "Turing", firstName: "Alan")
(p.firstName, p.lastName, p.age, p.role)`)
    ).toBe('("Alan", "Turing", 42, "scientist")');
  });

  test('`birthday(p)` changes the object and returns it', () => {
    expect(value(`${PERSON}\nbirthday(p).age`)).toBe('43');
    expect(value(`${PERSON}\nlet q = birthday(p)\n(q.age, p.age)`)).toBe(
      '(43, 43)'
    );
  });

  test('"Happy birthday, Alan Turing! You are 43." — the pieces evaluate left to right', () => {
    // `p.age` reads 43: `birthday(p)` in the first segment changed the
    // object before the second segment read it (ruling B8). The appendix's
    // line, verbatim.
    expect(
      value(
        `${PERSON}
"Happy birthday, \\(birthday(p).fullName)! You are \\(p.age)."`
      )
    ).toBe('"Happy birthday, Alan Turing! You are 43."');
  });
});

describe('"Assigning to a property"', () => {
  test('a record target is `immutable-value-assignment`, naming both ways out', () => {
    // The appendix's `Data` is a record type. A `record{…}` definition
    // auto-declares no constructor (`src/epsil/docs/types.md`, "Constructor
    // functions"), so the example builds one — the appendix carries the same
    // line.
    const r = result(`type Data = record{id: string, value: string}
function Data(id: string, value: string) { {id -> id, value -> value} }
let d = Data(id: "1234", value: "foo")
d.id = "456"`);
    expect(errorCode(r)).toBe('immutable-value-assignment');
    expect(r).toContain('Build an updated copy');
    expect(r).toContain('object{…}');
  });

  test('an object target is stored into', () => {
    expect(
      value(`${MUTABLE_DATA}
let d = MutableData(id: "1234", value: "foo")
d.id = "456"   // ok — the object now has id "456"
d.id`)
    ).toBe('"456"');
  });
});

describe('"References, not copies"', () => {
  test('binding to another name does not copy', () => {
    expect(
      value(`${MUTABLE_DATA}
const d = MutableData(id: "1234", value: "foo")
const e = d
d.id = "0000"
e.id`)
    ).toBe('"0000"');
  });

  test('a function receives the object itself, not a copy', () => {
    expect(
      value(`${MUTABLE_DATA}
const d = MutableData(id: "1234", value: "foo")
function rename(x: MutableData) {
  x.id = "XXXX"
}
rename(d)
d.id`)
    ).toBe('"XXXX"');
  });
});

describe('"Every construction makes a new object" and "Equality"', () => {
  test('two constructions with identical arguments are not `==`', () => {
    expect(
      value(`${MUTABLE_DATA}
MutableData(id: "1", value: "x") == MutableData(id: "1", value: "x")`)
    ).toBe('"False"');
  });

  test('`==` is reference identity, and it always decides', () => {
    expect(
      value(`${MUTABLE_DATA}
let a = MutableData(id: "1", value: "x")
let b = MutableData(id: "1", value: "x")
let c = a
(a == b, a == c)`)
    ).toBe('("False", "True")');
  });

  test('…and stays reference identity after the contents diverge', () => {
    expect(
      value(`${MUTABLE_DATA}
let a = MutableData(id: "1", value: "x")
let c = a
c.id = "2"
(a == c, a.id)`)
    ).toBe('("True", "2")');
  });
});

describe('"Cycles"', () => {
  const BUDDY = `type Buddy = object{name: string, friend: type Buddy | missing}
let alice = Buddy(name: "Alice", friend: Missing)
let bob = Buddy(name: "Bob", friend: alice)
alice.friend = bob
// alice's friend is bob, and bob's friend is alice — a cycle`;

  test('the two objects refer to each other', () => {
    expect(
      value(`${BUDDY}
(alice.friend.name, bob.friend.name, alice.friend.friend.name)`)
    ).toBe('("Bob", "Alice", "Alice")');
  });

  test('printing a cyclic object terminates, marking the revisit', () => {
    // "Every part of the engine that walks a value recursively — printing,
    // serializing … — must now be prepared to meet a value it has already
    // visited, or it will loop forever."
    const s = value(`${BUDDY}\nalice`);
    expect(s).toContain('Buddy(name: "Alice"');
    expect(s).toContain('Buddy(name: "Bob"');
    expect(s).toContain('Buddy(...)');
  });
});

describe('`const` protects the binding, not the contents', () => {
  test('a field of a `const`-bound object can be stored into', () => {
    expect(
      value(`${MUTABLE_DATA}
const d = MutableData(id: "1234", value: "foo")
d.value = "bar"
d.value`)
    ).toBe('"bar"');
  });

  test('…but the `const` binding itself cannot be rebound', () => {
    const r = executeEpsil(
      ce,
      `${MUTABLE_DATA}
const d = MutableData(id: "1234", value: "foo")
d = MutableData(id: "5678", value: "bar")
d.id`
    );
    // Rebinding a `const` is refused; the object `d` names is untouched.
    expect(String(r.value)).toBe('"1234"');
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });
});
