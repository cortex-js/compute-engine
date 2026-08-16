import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Compiling protocol dispatch to JavaScript —
// `docs/plans/2026-08-12-protocol-compilation.md`; the governing ruling is
// `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A, "Static resolution and compiled
// code".
//
// Two tiers: a STATICALLY RESOLVED call compiles to a direct call of the
// winning implementation (no guards in the emitted code); a DYNAMIC call
// reifies the receiver's runtime representation into a guard chain,
// most-specific-first, throwing `protocol-implementation-missing` on
// fall-through (the multi-clause `no-matching-clause` convention — the
// interpreter's error VALUE has no compiled analog). Anything unprovable
// declines (fail closed, D6). Python/GPU/interval targets keep failing
// closed.
//
// Protocols are engine-global, so every block uses a fresh engine.
//

/** Run an Epsil program on a fresh engine. */
function engineFor(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  const diags = executeEpsil(ce, source).diagnostics;
  if (diags.length > 0)
    throw new Error(`fixture failed: ${JSON.stringify(diags[0].message)}`);
  return ce;
}

const DESCRIBABLE = `protocol Describable {
  function describe(self: Self) -> string
}`;

describe('tier A: static resolution', () => {
  test('a decided receiver compiles to a direct call, no guards', () => {
    const ce = engineFor(`${DESCRIBABLE}
type string is Describable {
  function describe(self: Self) -> string { "a string" }
}
type integer is Describable {
  function describe(self: Self) -> string { "an integer" }
}`);
    const result = compile(ce.box(['describe', 42] as any));
    expect(result.success).toBe(true);
    // A direct call to the integer edge's helper — no typeof chain.
    expect(result.code).toContain('$e1(42)');
    expect(result.code).not.toContain('typeof');
    expect(result.run?.()).toBe('an integer');
    // Interpreter agreement.
    expect(ce.box(['describe', 42] as any).evaluate().toString()).toBe(
      '"an integer"'
    );
  });

  test('strict-supertype domination: an integer receiver takes the integer impl over the real one', () => {
    const ce = engineFor(`${DESCRIBABLE}
type integer is Describable {
  function describe(self: Self) -> string { "int" }
}
type real is Describable {
  function describe(self: Self) -> string { "real" }
}`);
    const result = compile(ce.box(['describe', 7] as any));
    expect(result.success).toBe(true);
    expect(result.run?.()).toBe('int');
    expect(ce.box(['describe', 7] as any).evaluate().toString()).toBe('"int"');
  });

  test('equivalent targets in two protocols decline (ambiguity has no compiled analog)', () => {
    const ce = engineFor(`protocol Blue {
  function paint(self: Self) -> string
}
protocol Red {
  function paint(self: Self) -> string
}
type string is Blue {
  function paint(self: Self) -> string { "blue" }
}
type string is Red {
  function paint(self: Self) -> string { "red" }
}`);
    // The interpreter answers `protocol-call-ambiguous`; the compiler
    // declines rather than silently picking an arm.
    const result = compile(ce.box(['paint', { str: 'a' }] as any));
    expect(result.success).toBe(false);
    // The QUALIFIED forms name their protocol and stay compilable.
    const qualified = compile(
      ce.box([
        'ProtocolMember',
        { str: 'Red' },
        { str: 'paint' },
        { str: 'a' },
      ] as any)
    );
    expect(qualified.success).toBe(true);
    expect(qualified.run?.()).toBe('red');
  });

  test('an overlapping conditional conformance declines', () => {
    const ce = engineFor(`protocol Comparable {
  function compare(self: Self, other: Self) -> string
}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "strings" }
}
type list<T> is Comparable where T is Comparable {
  function compare(self: list<T>, other: list<T>) -> string {
    compare(self[1], other[1])
  }
}`);
    // A list receiver could only dispatch through the conditional edge —
    // whose runtime type-parameter binding the compiled tier cannot
    // replicate (v1). Fail closed.
    const viaList = compile(
      ce.box(['compare', ['List', { str: 'a' }], ['List', { str: 'b' }]] as any)
    );
    expect(viaList.success).toBe(false);
    // A STRING receiver is untouched by the conditional edge (no overlap):
    // static resolution still fires.
    const viaString = compile(
      ce.box(['compare', { str: 'a' }, { str: 'b' }] as any)
    );
    expect(viaString.success).toBe(true);
    expect(viaString.run?.()).toBe('strings');
  });

  test('a host (JS-callback) implementation declines', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('Hashable', {
      functions: { hash: '(self: Self) -> string' },
    });
    ce.declareProtocolImplementation('string', 'Hashable', {
      functions: { hash: () => 'H' },
    });
    // The host callback consumes BOXED expressions — it cannot run inside
    // compiled code. (The interpreter dispatches it fine.)
    const result = compile(ce.box(['hash', { str: 'q' }] as any));
    expect(result.success).toBe(false);
    expect(ce.box(['hash', { str: 'q' }] as any).evaluate().toString()).toBe(
      '"H"'
    );
  });
});

describe('tier B: reified dynamic dispatch', () => {
  test('an unknown receiver compiles to a guard chain agreeing with the interpreter', () => {
    const ce = engineFor(`${DESCRIBABLE}
type string is Describable {
  function describe(self: Self) -> string { "a string" }
}
type integer is Describable {
  function describe(self: Self) -> string { "an integer" }
}`);
    const result = compile(ce.box(['describe', 'x'] as any));
    expect(result.success).toBe(true);
    expect(result.unsupported).toEqual([]);
    expect(result.run?.({ x: 'hello' })).toBe('a string');
    expect(result.run?.({ x: 5 })).toBe('an integer');
    // A receiver no conformance covers throws where the interpreter yields
    // the `protocol-implementation-missing` error value.
    expect(() => result.run?.({ x: true })).toThrow(
      'protocol-implementation-missing: describe'
    );
  });

  test('comparable machine-type targets linearize most-specific-first', () => {
    const ce = engineFor(`${DESCRIBABLE}
type real is Describable {
  function describe(self: Self) -> string { "real" }
}
type integer is Describable {
  function describe(self: Self) -> string { "int" }
}`);
    const result = compile(ce.box(['describe', 'x'] as any));
    expect(result.success).toBe(true);
    // integer (registered SECOND) must be tested first — it is the more
    // specific target.
    expect(result.run?.({ x: 3 })).toBe('int');
    expect(result.run?.({ x: 3.5 })).toBe('real');
    expect(ce.box(['describe', 3] as any).evaluate().toString()).toBe('"int"');
    expect(ce.box(['describe', 3.5] as any).evaluate().toString()).toBe(
      '"real"'
    );
  });

  test('tagged sum variants dispatch on the reified tag', () => {
    const ce = engineFor(`protocol Area {
  function area(self: Self) -> number
}
type shape = circle(r: number) | square(s: number)
type circle is Area {
  function area(self: Self) -> number { 3 * self.r^2 }
}
type square is Area {
  function area(self: Self) -> number { self.s^2 }
}
function totalArea(x: shape, y: shape) -> number { area(x) + area(y) }`);
    const result = compile(ce.box('totalArea'));
    expect(result.success).toBe(true);
    const fn = result.run?.();
    // `circle`/`square` collide on their payload representation, so the sum
    // is TAGGED — compiled values are `{_tag, _ops}` objects and the guard
    // chain tests `?._tag`.
    expect(
      fn({ _tag: 'circle', _ops: [2] }, { _tag: 'square', _ops: [4] })
    ).toBe(28);
    // Interpreter agreement.
    expect(
      ce
        .box(['totalArea', ['circle', 2], ['square', 4]] as any)
        .evaluate()
        .toString()
    ).toBe('28');
  });

  test('an erased sum variant colliding with a primitive target declines', () => {
    // A single POSITIONAL payload erases to the bare type: `boxed("a")` IS
    // the JS string at runtime — indistinguishable from a `string`
    // conformance target. The interpreter separates them nominally; the
    // compiled guard chain cannot, so the call declines.
    const ce = engineFor(`${DESCRIBABLE}
type wrapper = boxed(string) | empty
type boxed is Describable {
  function describe(self: Self) -> string { "boxed" }
}
type string is Describable {
  function describe(self: Self) -> string { "plain" }
}`);
    const result = compile(ce.box(['describe', 'x'] as any));
    expect(result.success).toBe(false);
  });

  test('incomparable overlapping collection targets decline (P29 parity)', () => {
    const ce = engineFor(`${DESCRIBABLE}
type list<integer> is Describable {
  function describe(self: Self) -> string { "ints" }
}
type list<string> is Describable {
  function describe(self: Self) -> string { "strings" }
}`);
    // Both admit `list<never>` (the empty list) — the interpreter's runtime
    // answer there is `protocol-call-ambiguous`, and `Array.isArray` cannot
    // tell the two apart anyway. Decline.
    const result = compile(ce.box(['describe', 'x'] as any));
    expect(result.success).toBe(false);
  });

  test('a pending conformance is not a candidate', () => {
    // A conformance DECLARED with no implementation: `conformsTo` counts it,
    // dispatch does not. With no other edge there is nothing to compile.
    // (The P3 end-of-batch `protocol-implementation-pending` WARNING is the
    // expected diagnostic here, so this fixture skips `engineFor`'s
    // zero-diagnostics check.)
    const ce = new ComputeEngine();
    const diags = executeEpsil(
      ce,
      `${DESCRIBABLE}
type string is Describable`
    ).diagnostics.map((d) => String(d.message[0]));
    expect(diags).toEqual(['protocol-implementation-pending']);
    const result = compile(ce.box(['describe', { str: 'a' }] as any));
    expect(result.success).toBe(false);
  });
});

describe('route parity', () => {
  const SOURCE = `protocol Comparable {
  function compare(self: Self, other: Self) -> string
}
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "proto" }
}`;

  test('bare, ProtocolMember and Apply(Field(…)) routes all compile and agree', () => {
    const ce = engineFor(SOURCE);
    const bare = compile(ce.box(['compare', { str: 'a' }, { str: 'b' }] as any));
    const qualified = compile(
      ce.box([
        'ProtocolMember',
        { str: 'Comparable' },
        { str: 'compare' },
        { str: 'a' },
        { str: 'b' },
      ] as any)
    );
    // `Comparable.compare(x, y)` canonicalizes and STAYS
    // `Apply(Field(Comparable, "compare"), x, y)` — the shape the Epsil
    // parser produces.
    const applied = compile(
      ce.box([
        'Apply',
        ['Field', 'Comparable', { str: 'compare' }],
        { str: 'a' },
        { str: 'b' },
      ] as any)
    );
    for (const r of [bare, qualified, applied]) {
      expect(r.success).toBe(true);
      expect(r.run?.()).toBe('proto');
    }
  });

  test('the parse route agrees with the box route', () => {
    const ce = engineFor(SOURCE);
    const parsed = executeEpsil(ce, `Comparable.compare("a", "b")`);
    expect(parsed.diagnostics).toEqual([]);
    const expr = ce.box([
      'Apply',
      ['Field', 'Comparable', { str: 'compare' }],
      { str: 'a' },
      { str: 'b' },
    ] as any);
    expect(expr.evaluate().toString()).toBe('"proto"');
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    expect(compiled.run?.()).toBe('proto');
  });

  test('a recursive implementation (the impl body calls the dispatcher) compiles', () => {
    const ce = engineFor(`protocol Nested {
  function depth(self: Self) -> number
}
type tree = leaf | node(child: tree)
type leaf is Nested {
  function depth(self: Self) -> number { 0 }
}
type node is Nested {
  function depth(self: Self) -> number { 1 + depth(self.child) }
}`);
    const result = compile(ce.box(['depth', 'x'] as any));
    expect(result.success).toBe(true);
    // leaf is nullary and node wraps a tree: representations collide with
    // nothing… but the sum is tagged iff its variants collide — here `leaf`
    // erases to null and `node` to its payload; either policy must simply
    // AGREE between constructor and guard. Build values via the interpreter
    // convention: probe through the interpreter for agreement instead.
    expect(
      ce.box(['depth', ['node', ['node', ['leaf']]]] as any)
        .evaluate()
        .toString()
    ).toBe('2');
  });
});

describe('properties', () => {
  // A READONLY property on a value type: the B1 mutability gate
  // (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Which types can conform")
  // admits any type to a protocol with no settable member, so the compiled
  // GET tier is exercised on the erased tuple representation it targets.
  const PERSON = `protocol Nameable {
  readonly name: string
}
type Person = tuple<n: string, age: integer>
type Person is Nameable {
  get name(self: Self) -> string { self.n }
}`;

  // A SETTABLE property, and therefore — by the same gate — an OBJECT
  // receiver. Objects have no compiled representation yet (Phase 4 of
  // `docs/plans/2026-08-13-mutable-objects-implementation-plan.md`), so every
  // compiled SET below declines. The SET lowering in `base-compiler.ts` is
  // reachable again once objects compile; the interpreted behaviour it
  // mirrors is pinned in `protocol-properties.test.ts`.
  const CELL = `protocol Renameable {
  readwrite name: string
}
type Cell = object{n: string, age: integer}
type Cell is Renameable {
  get name(self: Self) -> string { self.n }
  set name(self: Self, v: string) -> Self {
    self.n = v
    self
  }
}`;

  test('a property GET on a decided receiver compiles to a direct getter call', () => {
    const ce = engineFor(`${PERSON}
function readName(p: Person) -> string { p.name }`);
    const result = compile(ce.box('readName'));
    expect(result.success).toBe(true);
    expect(result.run?.()(['alice', 30])).toBe('alice');
    expect(
      ce
        .box(['Field', ['Person', { str: 'alice' }, 30], { str: 'name' }] as any)
        .evaluate()
        .toString()
    ).toBe('"alice"');
  });

  test('a property SET declines: its receiver is an object, which has no compiled form yet', () => {
    // The interpreter performs the write (`protocol-properties.test.ts`); the
    // compiled tier fails closed, which is the D6 posture for a receiver whose
    // representation it cannot emit.
    const ce = engineFor(`${CELL}
function rename(p: Cell, v: string) -> Cell {
  p.name = v
  p
}`);
    expect(compile(ce.box('rename')).success).toBe(false);
    expect(
      String(
        executeEpsil(ce, 'rename(Cell(n: "alice", age: 30), "bob")').value
      )
    ).toBe('Cell(n: "bob", age: 30)');
  });

  test('a SET on a TYPED BLOCK LOCAL declines for the same reason', () => {
    const ce = engineFor(`${CELL}
function relabel(v: string) -> Cell {
  let q: Cell = Cell(n: "seed", age: 1)
  q.name = v
  q
}`);
    expect(compile(ce.box('relabel')).success).toBe(false);
    expect(
      ce.box(['relabel', { str: 'bob' }] as any).evaluate().toString()
    ).toBe('Cell(n: "bob", age: 1)');
  });

  test('an UNDECIDED receiver fails closed (P46: it could be a dictionary at runtime)', () => {
    // A guard chain over the conformance targets would throw on a record
    // value whose `name` is an ordinary key the interpreter would update, so
    // property access is STATIC-TIER ONLY: the receiver's type has to be
    // decided at compile time.
    //
    // Pinned on a READONLY property of a value type, because that is the only
    // property shape where the two halves still differ. The decided receiver
    // must COMPILE — without that half the test would pass with the
    // undecided-receiver logic deleted, since a `readwrite` property's
    // receiver is now necessarily an object (the B1 gate) and every compiled
    // property SET declines for that reason alone. The SET counterpart of this
    // pin is therefore uncovered until objects compile; see the B1 entry in
    // `ROADMAP.md`, which schedules the compiler re-point as Phase 4 work.
    const ce = engineFor(`${PERSON}
function readName(p: Person) -> string { p.name }
function readAny(p) -> unknown { p.name }`);
    expect(compile(ce.box('readName')).success).toBe(true);
    expect(compile(ce.box('readAny')).success).toBe(false);
  });

  test('a property SET fails closed, not silently', () => {
    // A property store writes a mutable object, and objects have no compiled
    // representation yet, so there is nothing to lower to. Before this tier the
    // compiler emitted the silent no-op `_ = v`, leaving the target at its old
    // value behind `success: true`.
    //
    // The receiver is an OBJECT with no `age` slot, so the assignment survives
    // canonicalization as `Assign(Field(p, "age"), 1)` — the shape the lowering
    // has to refuse — and reaches the compiler.
    const ce = engineFor(`protocol Aged {
  readwrite age: integer
}
type P = object{n: integer}
type P is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}
function bump(p: P) -> integer {
  p.age = 1
  p.age
}`);
    const result = compile(ce.box('bump'));
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Fail closed (D6)');
    expect(String(result.error)).toContain(
      'objects have no compiled representation'
    );
  });

  test('the QUALIFIED spelling of the same store fails closed too', () => {
    // `p.(Aged.age) = v` canonicalizes to a four-operand `ProtocolProperty`,
    // which is a store and not a call. Lowering it as a call — the dispatch
    // planner's default for that head — would both bypass the refusal above and
    // evaluate to the SETTER's result where the interpreter evaluates to the
    // value assigned: a silent divergence behind `success: true`.
    const ce = engineFor(`protocol Aged {
  readwrite age: integer
}
type P = object{n: integer}
type P is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}
function bumpQualified(p: P) -> integer {
  p.(Aged.age) = 1
  p.age
}`);
    const result = compile(ce.box('bumpQualified'));
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('Fail closed (D6)');
    expect(String(result.error)).toContain(
      'objects have no compiled representation'
    );
  });

  test('a SET on a value receiver never reaches the compiler at all', () => {
    // It is refused where it is written: assignment through a `Field` target is
    // a store, a store needs a mutable object, and a tuple is not one — so the
    // whole `function` statement evaluates to that error and no definition is
    // installed. (A `readonly` property is the only kind a value type can carry
    // at all, after the B1 mutability gate.)
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      `protocol Tagged {
  readonly tag: string
}
type Person = tuple<n: string, age: integer>
type Person is Tagged {
  get tag(self: Self) -> string { self.n }
}
function retag(p: Person, v: string) -> Person {
  p.tag = v
  p
}`
    );
    expect(String(result.value)).toContain('immutable-value-assignment');
  });

  test('a typed local declared in a LOOP BODY resolves the static tier', () => {
    // A loop body rides `compileLoopBody`, not `compileBlock` — the
    // declared-type merge (`statementListDeclaredVarTypes`) has to run on that
    // path too, or the dispatch below fails closed. The member is a FUNCTION
    // rather than a settable property because the B1 mutability gate would
    // make a `readwrite` one object-only, and objects do not compile yet; the
    // mechanism under test — reading a loop-body local's DECLARED type — is
    // the same either way. The interpreted `readwrite` counterpart, whose
    // deferred write used to refuse `10 * i` against the RAW RHS's static type
    // and silently drop it, is pinned in `protocol-properties.test.ts`.
    //
    // What this conversion does NOT preserve: the compiled SET lowering the
    // original guarded is now uncovered on every compiled path, because the
    // gate leaves object types as its only legal receivers and those have no
    // compiled representation. The B1 entry in `ROADMAP.md` records that
    // under "One consequence has NO migration" and schedules the re-point
    // with Phase 4.
    const ce = engineFor(`protocol Scored {
  function score(self: Self) -> integer
}
type Person = tuple<n: string, age: integer>
type Person is Scored {
  function score(self: Self) -> integer { self.age }
}
function tally() -> integer {
  let acc = 0
  for i in 1..3 {
    let q: Person = Person("bob", 10 * i)
    acc = acc + score(q)
  }
  acc
}`);
    const result = compile(ce.box('tally'));
    expect(result.success).toBe(true);
    expect(result.unsupported ?? []).toEqual([]);
    // Statically resolved: no runtime guard chain over the conformers.
    expect(result.code ?? '').not.toContain('typeof');
    expect(result.run?.()()).toBe(60);
    expect(ce.box(['tally'] as any).evaluate().toString()).toBe('60');
  });

  test('an ordinary record field does not go through the protocol tier', () => {
    const ce = engineFor(`protocol Nameable {
  readwrite name: string
}`);
    // A record with a `name` key: dictionary keys beat protocol properties
    // (P46). The ordinary Field lowering compiles it; no protocol helper is
    // emitted.
    const expr = ce.box([
      'Field',
      ['Tuple', { str: 'x' }],
      { str: 'name' },
    ] as any);
    const result = compile(expr);
    // Whatever the ordinary route decides, the protocol tier must not have
    // emitted a getter helper.
    expect(result.code ?? '').not.toContain('__get__');
  });
});

describe('cross-target fail-closed pins', () => {
  test('python declines and reports the member unsupported', () => {
    const ce = engineFor(`${DESCRIBABLE}
type string is Describable {
  function describe(self: Self) -> string { "a string" }
}`);
    const result = compile(ce.box(['describe', 'x'] as any), {
      to: 'python',
    });
    expect(result.success).toBe(false);
    expect(result.unsupported).toContain('describe');
  });
});
