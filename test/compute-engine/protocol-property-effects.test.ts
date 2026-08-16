/**
 * The `state` EFFECT of a write through a mutable object — Phase 2 of
 * `docs/plans/2026-08-13-mutable-objects-implementation-plan.md` ("a
 * `readwrite` requirement implies `state` on its setter"), whose normative
 * spec is `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Changing a field is an
 * effect".
 *
 * Two operators do the writing, and neither can state its effect on its
 * declared arrow, because each spells two different operations:
 *
 * - `Assign` spells a binding write (`x = 5`, `scope`) and a heap store
 *   (`p.age = 43`, `state`);
 * - `ProtocolProperty` spells a qualified READ with three operands and a
 *   setter INVOCATION with four.
 *
 * So the label is decided per call site, in two places that must agree: the
 * INFERENCE channel, which stamps a `Function` literal's arrow
 * (`boxed-expression/effects-inference.ts`), and the RUNTIME channel behind
 * `expr.effects` (`boxed-expression/effects-of.ts`). Every test below is
 * therefore run on the route where the distinction is observable — Epsil
 * source for the inference channel, raw MathJSON for the runtime channel, and
 * the host `declareProtocolImplementation()` API for a setter the engine did
 * not synthesize itself.
 *
 * Protocols are engine-global, so every fixture builds a fresh engine.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { inferFunctionLiteralEffects } from '../../src/compute-engine/boxed-expression/effects-inference';
import { isObject } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/types-expression';

/** Run an Epsil program on a fresh engine (or `ce`), returning the engine, the
 * final value as a string, and the diagnostic messages flattened to strings. */
function run(
  source: string,
  ce: ComputeEngine = new ComputeEngine()
): { ce: ComputeEngine; value: string; diagnostics: string[] } {
  const r = executeEpsil(ce, source);
  return {
    ce,
    value: String(r.value),
    diagnostics: r.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join('|') : String(d.message)
    ),
  };
}

/** An object type whose `age` field BACKS the `readwrite` property of `Aged`:
 * the engine synthesizes both accessors, and the setter is a slot store. */
const FIELD_BACKED = `protocol Aged { readwrite age: integer }
type P = object{age: integer} is Aged
let p = P(age: 42)`;

/** An object type whose `age` property is COMPUTED — it is not in the layout,
 * so the author writes accessors, and the setter stores into the `n` slot. */
const COMPUTED = `protocol Aged { readwrite age: integer }
type Q = object{n: integer} is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}
let q = Q(n: 1)`;

describe('the runtime channel: `expr.effects` of a store', () => {
  test('a store into an object LAYOUT field is `state`, not `scope`', () => {
    const { ce } = run(FIELD_BACKED);
    const store = ce.box([
      'Assign',
      ['Field', 'p', { str: 'age' }],
      43,
    ] as never);
    expect(store.effects).toEqual(['state']);
    expect(store.isPure).toBe(false);
  });

  test('a binding write on a plain symbol is still `scope`', () => {
    // The half of `Assign` that the declared arrow describes correctly. If
    // this ever picks up `state`, the per-call-site hook has stopped
    // discriminating and is labelling every assignment as a store.
    const { ce } = run(FIELD_BACKED);
    expect(ce.box(['Assign', 'zz', 5] as never).effects).toEqual(['scope']);
  });

  test('a `Field` target on a RECORD stays `scope` — records have no slots', () => {
    const { ce } = run(`type Badge = record{name: string}
let b = Badge(name: "a")`);
    const store = ce.box([
      'Assign',
      ['Field', 'b', { str: 'name' }],
      { str: 'z' },
    ] as never);
    expect(store.effects).toEqual(['scope']);
  });

  test('a four-operand `ProtocolProperty` — the setter invocation — is `state`', () => {
    const { ce } = run(FIELD_BACKED);
    const set = ce.box([
      'ProtocolProperty',
      { str: 'Aged' },
      { str: 'age' },
      'p',
      43,
    ] as never);
    expect(set.effects).toEqual(['state']);
    expect(set.isPure).toBe(false);
  });

  test('a three-operand `ProtocolProperty` — the qualified read — is pure', () => {
    // A field-backed getter is a slot load. A COMPUTED getter's own body
    // effects are not propagated either: only FUNCTION members get a
    // dispatcher whose effect set is derived from its conformers.
    const { ce } = run(FIELD_BACKED);
    const read = ce.box([
      'ProtocolProperty',
      { str: 'Aged' },
      { str: 'age' },
      'p',
    ] as never);
    expect(read.effects).toBeUndefined();
    expect(read.isPure).toBe(true);
  });

  test('a store through a COMPUTED property keeps its `Field` target and is `state`', () => {
    // Nothing is rewritten at canonicalization: which route serves `q.age = 5`
    // — the object's own slot or a protocol's `set` accessor — is settled at
    // evaluation, by the instance's pinned layout. The label does not depend on
    // that outcome: the receiver is an object, so the assignment is a heap
    // store either way and never a binding write, hence `state` alone.
    const { ce } = run(COMPUTED);
    const store = ce.box([
      'Assign',
      ['Field', 'q', { str: 'age' }],
      5,
    ] as never);
    expect(store.json).toEqual(['Assign', ['Field', 'q', "'age'"], 5]);
    expect(store.effects).toEqual(['state']);
  });

  test('a value type cannot reach a setter at all (B1)', () => {
    // What licenses the rule above to read a four-operand set as a heap store
    // with no further evidence: the B1 mutability gate refuses the conformance
    // itself, so no value type has a settable property to assign through.
    const { value } = run(`protocol Nameable { readwrite name: string }
type Person = tuple<n: string, age: integer>
type Person is Nameable {
  get name(self: Self) -> string { self.n }
  set name(self: Self, v: string) -> Person { Person(v, self.age) }
}`);
    expect(value).toContain('protocol-requires-object');
  });

  test("the right-hand side's OWN effects survive the store correction", () => {
    // The correction REPLACES `scope` with `state`, and it must do that to the
    // `Assign` definition's own contribution only. Applied to the total — which
    // already unions what the operands contribute — it would erase a
    // right-hand side's genuine binding write.
    const { ce } = run(`${FIELD_BACKED}
let counter = 0
function bump() scope -> integer { counter = counter + 1
  1 }`);
    const store = ce.box([
      'Assign',
      ['Field', 'p', { str: 'age' }],
      ['bump'],
    ] as never);
    expect(store.effects).toEqual(['scope', 'state']);
  });

  test('an `any`-effect right-hand side stays `any`', () => {
    // The other half of the same rule: subtracting `scope` from `'any'` yields
    // the internal co-finite ¬{scope}, which claims the expression provably
    // does NOT write a binding — a positive claim about an operand nobody has
    // looked inside. It must stay `'any'`.
    const { ce } = run(FIELD_BACKED);
    const store = ce.box([
      'Assign',
      ['Field', 'p', { str: 'age' }],
      ['someUndeclaredHead', 1],
    ] as never);
    expect(store.effects).toBe('any');
  });

  test('a node read BEFORE its receiver was typed re-reports afterwards', () => {
    // The store correction lives inside the `_effects` memo and consults
    // something the memo's key does not name — the receiver's declared type.
    // That is safe only because every route which gives a symbol a type
    // advances the callable axis the memo is stamped on. This pins it:
    // narrowing that selector must fail here rather than freeze the first
    // label on this node, and on every ancestor that projected through it.
    //
    // The observable change runs from `state` to `scope`, not the other way:
    // an UNDECIDED receiver is assumed to be a store (a `Field` target is never
    // a binding write, so the alternative is a runtime error), and it is
    // learning that `p` is a RECORD — decided, and not an object — that
    // demotes the node to the plain binding-write label.
    const ce = new ComputeEngine();
    run('type R = record{age: integer}', ce);
    const stmt = ['Assign', ['Field', 'p', { str: 'age' }], 43];
    const node = ce.box(stmt as never);
    const block = ce.box(['Block', stmt] as never);
    expect(node.effects).toEqual(['state']);
    expect(block.effects).toEqual(['state']);

    run('let p: R = {"age" -> 1}', ce);

    // The SAME node objects, not fresh ones — a fresh box would miss the memo
    // and pass whatever the axis does.
    expect(node.effects).toEqual(['scope']);
    expect(block.effects).toEqual(['scope']);
  });

  test('an authored SETTER’s own effects reach the UNQUALIFIED write site', () => {
    // `q.age = 5` keeps its `Field` target through canonicalization — nothing
    // rewrites it to `ProtocolProperty` any more — so this arm, not the
    // operator's, is where the accessor's body has to be accounted for. The
    // setter below writes an outer binding, which is `scope`; the store itself
    // is `state`. Losing the union would report the write as `state` alone and
    // hide the binding write from every caller.
    const { ce } = run(`let log = 0
protocol Aged { readwrite age: integer }
type Q = object{n: integer} is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { log = log + 1
    self.n = v
    self }
}
let q = Q(n: 1)`);
    const store = ce.box([
      'Assign',
      ['Field', 'q', { str: 'age' }],
      5,
    ] as never);
    expect(store.effects).toEqual(['scope', 'state']);
  });

  test('…and boxed AFTER the `let`, it still reports `state` — and why', () => {
    // The non-vacuous companion to the memo test above, and a warning about
    // reading too much into it. `let p: R = {"age" -> 1}` leaves the BINDING's
    // value type `unknown` — the dictionary literal does not narrow to `R` on
    // its own — so a statement boxed after it still finds nothing that decides
    // the receiver and takes the conservative `state`.
    //
    // The `scope` the test above observes is therefore not "records are always
    // `scope`": it is what the node reports once the type has actually been
    // settled, which the earlier boxing itself does by canonicalizing the
    // receiver. The carve-out for a decided non-object applies exactly when the
    // type IS settled.
    const ce = new ComputeEngine();
    run('type R = record{age: integer}', ce);
    run('let p: R = {"age" -> 1}', ce);
    const def = ce.lookupDefinition('p') as never as {
      value?: { type?: unknown };
    };
    expect(String(def.value?.type)).toBe('unknown');
    expect(
      ce.box(['Assign', ['Field', 'p', { str: 'age' }], 43] as never).effects
    ).toEqual(['state']);
  });

  test('a store through a UNION-typed receiver is `state`', () => {
    // `M | nothing` is not itself an object type, so an objecthood test that
    // did not look inside the union answered `false` and the write fell to the
    // `scope` path — where confinement exempted it, and
    // `function k(x: M | nothing) pure { x.id = "Z" }` was ACCEPTED and mutated
    // its caller's object. An arm that is an object is enough: the store either
    // writes that arm's slot or faults.
    const { value } = run(`type M = object{id: string}
function k(x: M | nothing) pure { x.id = "Z" }`);
    expect(value).toContain('incompatible-type');
    expect(value).toContain('state effects');
    expect(
      run(`type M = object{id: string}
function k2(x: M | nothing) { x.id = "Z" }
Type(k2)`).value
    ).toContain('state');
  });

  test('a QUALIFIED write inherits only the NAMED protocol’s setter effects', () => {
    // Two protocols declare `age`; only `Loud`'s setter writes an outer
    // binding. A write qualified with `Quiet` cannot reach `Loud`'s accessor —
    // dispatch is restricted to the protocol named — so it must not inherit
    // that `scope`.
    const { ce } = run(`let log = 0
protocol Quiet { readwrite age: integer }
protocol Loud { readwrite age: integer }
type Q = object{n: integer} is Quiet {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}
type L = object{n: integer} is Loud {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { log = log + 1
    self.n = v
    self }
}
let q = Q(n: 1)`);
    const qualified = ce.box([
      'ProtocolProperty',
      { str: 'Quiet' },
      { str: 'age' },
      'q',
      5,
    ] as never);
    expect(qualified.effects).toEqual(['state']);
    // The unqualified spelling names no protocol, so it keeps the union over
    // every protocol declaring `age` — `Loud`'s setter included.
    const unqualified = ce.box([
      'Assign',
      ['Field', 'q', { str: 'age' }],
      5,
    ] as never);
    expect(unqualified.effects).toEqual(['scope', 'state']);
  });

  test('a LAYOUT-owned name skips the accessor union entirely', () => {
    // The slot store wins the precedence and no accessor runs, so an unrelated
    // protocol's setter effects must not ride along. `age` IS `P`'s stored
    // field; `Loud` declares a property of the same name whose setter writes an
    // outer binding.
    const { ce } = run(`let log = 0
protocol Loud { readwrite age: integer }
type P = object{age: integer}
type L = object{n: integer} is Loud {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { log = log + 1
    self.n = v
    self }
}
let p = P(age: 1)`);
    expect(
      ce.box(['Assign', ['Field', 'p', { str: 'age' }], 5] as never).effects
    ).toEqual(['state']);
  });

  test('…and the object direction is unchanged: a typed object receiver is `state`', () => {
    const ce = new ComputeEngine();
    run('type P = object{age: integer}', ce);
    run('let p = P(age: 1)', ce);
    expect(
      ce.box(['Assign', ['Field', 'p', { str: 'age' }], 43] as never).effects
    ).toEqual(['state']);
  });

  test('a self-referential accessor terminates', () => {
    // Reading an accessor's effects reads its arrow, and computing that arrow
    // on a cold memo runs the effect walk over its body — whose qualified read
    // asks for this very property's accessor effects again. The in-flight guard
    // is what stops that; without it this test dies with `RangeError: Maximum
    // call stack size exceeded` rather than failing an assertion.
    //
    // Only the INVARIANT is asserted, not an exact set. The union over a cyclic
    // accessor is a fixed point, and a read that had to cut the cycle sees a
    // truncated one — here the setter's own `scope` write may or may not be in
    // it, depending on whether the arrow was already computed. That result is
    // returned but never memoized (see `protocolAccessorEffects`), so later
    // reads converge on the full union; what holds on EVERY read is that the
    // set is finite (never the `'any'` that would poison caching) and that the
    // set half still reports the store.
    const { ce } = run(`protocol A { readwrite age: integer }
type Q = object{n: integer} is A {
  get age(self: Self) -> integer { self.(A.age) }
  set age(self: Self, v: integer) -> Self { self.(A.age) = v
    self }
}
let q = Q(n: 1)`);
    const read = ce.box([
      'ProtocolProperty',
      { str: 'A' },
      { str: 'age' },
      'q',
    ] as never);
    expect(read.effects).not.toBe('any');
    const set = ce.box([
      'ProtocolProperty',
      { str: 'A' },
      { str: 'age' },
      'q',
      5,
    ] as never);
    expect(set.effects).not.toBe('any');
    expect(set.effects).toContain('state');
  });

  test('a NESTED receiver stores too: `o.child.age = 9` is `state`', () => {
    const { ce } = run(`type Inner = object{age: integer}
type Outer = object{child: Inner}
let o = Outer(child: Inner(age: 1))`);
    const store = ce.box([
      'Assign',
      ['Field', ['Field', 'o', { str: 'child' }], { str: 'age' }],
      9,
    ] as never);
    expect(store.effects).toEqual(['state']);
  });

  test('an INDEXED receiver stores too: `xs[1].age = 9` is `state`', () => {
    // `xs[1]` types `(Inner) | missing` — the absence marker rides with the
    // element type — so the receiver's type is a union rather than a layout.
    // The store either writes the element's slot or faults; neither is the
    // binding write `scope` describes.
    const { ce } = run(`type Inner = object{age: integer}
let xs = [Inner(age: 2)]`);
    const store = ce.box([
      'Assign',
      ['Field', ['At', 'xs', 1], { str: 'age' }],
      9,
    ] as never);
    expect(store.effects).toEqual(['state']);
  });

  test('…and those nested and indexed stores really do store', () => {
    // What licenses the label. `objectLayoutOwnsField()`
    // (`library/collections.ts`) DECLINES the union an indexed receiver types
    // as, deliberately — it decides a canonicalization precedence and a union
    // cannot settle one, so it defers to evaluation. The effect channel has no
    // such option, so the two part company on exactly this input; this is the
    // evidence that parting company in the `state` direction is the sound one.
    // A variable index is included because it is the case a static layout read
    // can say least about.
    expect(
      run(`type Inner = object{age: integer}
type Outer = object{child: Inner}
let o = Outer(child: Inner(age: 1))
o.child.age = 9
o.child.age`).value
    ).toBe('9');
    expect(
      run(`type Inner = object{age: integer}
let xs = [Inner(age: 2), Inner(age: 3)]
let i = 1
xs[i].age = 9
xs[1].age`).value
    ).toBe('9');
  });

  test("a computed GETTER's own body effects reach the call site", () => {
    // The read contributes no `state`, but it is not blind to what the accessor
    // does: the authored getter's arrow is stamped with its inferred latent set
    // when the implementation block is boxed, and the qualified read unions it
    // in.
    const { ce } = run(`protocol A { readonly age: integer }
type Q = object{n: integer} is A {
  get age(self: Self) -> integer { self.n + Random() }
}
let q = Q(n: 1)`);
    const read = ce.box([
      'ProtocolProperty',
      { str: 'A' },
      { str: 'age' },
      'q',
    ] as never);
    expect(read.effects).toEqual(['random']);
  });

  test("a computed SETTER's own body effects reach the call site", () => {
    const { ce } = run(`let log = 0
protocol A { readwrite age: integer }
type Q = object{n: integer} is A {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { log = v
    self }
}
let q = Q(n: 1)`);
    const set = ce.box([
      'ProtocolProperty',
      { str: 'A' },
      { str: 'age' },
      'q',
      9,
    ] as never);
    // `state` from the shape of the call, `scope` from the body's write to the
    // outer binding `log`.
    expect(set.effects).toEqual(['scope', 'state']);
  });
});

describe('the inference channel: a function body that stores', () => {
  test('a store into a LAYOUT field infers `state`', () => {
    expect(
      run(`${FIELD_BACKED}
function f(x: P) { x.age = 43 }
Type(f)`).value
    ).toBe('"(x: P) state -> number"');
  });

  test('…and annotating that function `pure` is REFUSED, as an error value', () => {
    // The refusal is the statement's VALUE, not a diagnostic: an effect
    // contract is checked when the definition is evaluated.
    const { value, diagnostics } = run(`${FIELD_BACKED}
function f(x: P) pure { x.age = 43 }`);
    expect(value).toContain('incompatible-type');
    expect(value).toContain('pure effects');
    expect(value).toContain('state effects');
    expect(diagnostics).toEqual([]);
  });

  test('a store through a COMPUTED property infers `state`', () => {
    // Inside an unentered `Function` literal the receiver's type is not
    // settled, so the lowering to `ProtocolProperty` DEFERS to evaluation and
    // the walk sees `Assign(Field(x, "age"), 3)` — the same shape as a layout
    // store, with a name the layout does not declare. It is recognised because
    // a protocol declares `age` a `readwrite` property.
    expect(
      run(`${COMPUTED}
function f(x: Q) { x.age = 3 }
Type(f)`).value
    ).toBe('"(x: Q) state -> number"');
  });

  test('…and annotating THAT function `pure` is refused too', () => {
    // Regression: this was accepted, and calling it mutated the caller's
    // object behind a `pure` contract.
    const { ce, value } = run(`${COMPUTED}
function f(x: Q) pure { x.age = 3 }`);
    expect(value).toContain('incompatible-type');
    expect(value).toContain('state effects');
    // The definition was refused, so the mutation never happens: `q` keeps the
    // `n` it was built with.
    expect(run('f(q)\nq.n', ce).value).toBe('1');
  });

  test('a NESTED and an INDEXED receiver both infer `state`', () => {
    // The chain is resolved structurally from the declared parameter types —
    // no canonicalization, which inside an unentered literal would report
    // `unknown` and decide nothing.
    expect(
      run(`type Inner = object{age: integer}
type Outer = object{child: Inner}
function f(o: Outer) { o.child.age = 9 }
Type(f)`).value
    ).toBe('"(o: Outer) state -> number"');
    expect(
      run(`type Inner = object{age: integer}
function f(xs: list<Inner>) { xs[1].age = 9 }
Type(f)`).value
    ).toBe('"(xs: list<Inner>) state -> number"');
  });

  test('an UNANNOTATED parameter is a store too — `pure` is refused', () => {
    // The soundness case. Nothing establishes what `x` is, and a `Field` target
    // is never a binding write, so the store is assumed: `k` cannot be `pure`.
    // Before this rule the annotation was ACCEPTED and calling `k` mutated the
    // caller's object behind it.
    const { value } = run(`type M = object{id: string}
function k(x) pure { x.id = "Z" }`);
    expect(value).toContain('incompatible-type');
    expect(value).toContain('state effects');
  });

  test('…and the BARE definition infers `state` and still works', () => {
    // The other half: the label must not make an ordinary mutating helper
    // unusable. `state` does not trip the default-`!scope` ceiling — which is
    // why `scope` was the wrong answer here — so the definition installs and
    // the call mutates.
    const { ce, value } = run(`type M = object{id: string}
function rename(x) { x.id = "X" }
Type(rename)`);
    expect(value).toBe('"(unknown) state -> string"');
    expect(run('let m = M(id: "a")\nrename(m)\nm.id', ce).value).toBe('"X"');
  });

  test('a body-local object aliased from OUTSIDE is a store', () => {
    // The confinement exemption is gone for a body-local whose value came from
    // elsewhere: `r` names the caller-visible object `g`, so writing through it
    // is observable and cannot be `pure`. (A local the body CONSTRUCTS is
    // already `state` from the construction alone — Appendix B makes a
    // constructor carry `state` — so nothing about that case changed.)
    expect(
      run(`type M = object{id: string}
let g = M(id: "a")
function touch() pure { let r = g
  r.id = "b" }`).value
    ).toContain('incompatible-type');
    expect(
      run(`type M = object{id: string}
function make() -> M { let r = M(id: "a")
  r.id = "b"
  r }
Type(make)`).value
    ).toBe('"() state -> M"');
  });

  test('a DECIDED non-object parameter is not a store', () => {
    // `r.a = 1` on a record is `immutable-value-assignment`: it changes
    // nothing, so it earns no `state`. The refusal is the statement's value.
    const { value } = run(`type R = record{a: integer}
function g(r: R) { r.a = 1 }`);
    expect(value).toContain('immutable-value-assignment');
  });

  test('the verdict does not depend on the conformance REGISTRY', () => {
    // `age` is not in `Q`'s layout, and in the first batch no protocol declares
    // it either — yet the store is recognised, because the receiver is an
    // object and an assignment through a `Field` target on an object is a heap
    // store or an error, never a binding write. That the answer needs no
    // registry reading is what makes it stale-proof: it cannot be frozen at a
    // moment when the conformance had not registered yet, which would leave a
    // `pure`-eligible function that mutates its caller's object once it does.
    const ce = new ComputeEngine();
    expect(
      run(
        `type Q = object{n: integer}
function f(x: Q) { x.age = 3 }
Type(f)`,
        ce
      ).value
    ).toBe('"(x: Q) state -> number"');

    // A LATER batch declares the protocol and the conformance; the arrow is
    // unchanged, because it never depended on them.
    run(
      `protocol Aged { readwrite age: integer }
type Q is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}`,
      ce
    );
    expect(run('Type(f)', ce).value).toBe('"(x: Q) state -> number"');
  });

  test('…so a `pure` annotation is refused at the definition, not later', () => {
    // The same ordering, with the contract spelled: `f` is refused where it is
    // written, rather than accepted and then caught by
    // `conformance-widens-declared-contract` when the protocol arrives.
    const { value } = run(`type Q = object{n: integer}
function f(x: Q) pure { x.age = 3 }`);
    expect(value).toContain('incompatible-type');
    expect(value).toContain('state effects');
  });

  test('a plain binding write in a body still infers `scope`', () => {
    // The control: nothing about the store rules may touch an ordinary
    // assignment to a name the body did not declare. The `scope` marker is
    // spelled because a BARE named definition refuses a proven escaping write
    // outright (the default-`!scope` ceiling) — what is being checked here is
    // that the inferred set the ceiling compares against is still `scope` and
    // has not acquired `state`.
    expect(
      run(`let g = 0
function f(x: integer) scope { g = x }
Type(f)`).value
    ).toBe('"(x: integer) scope -> integer"');
  });

  test('a body that only READS a property stays pure', () => {
    expect(
      run(`${FIELD_BACKED}
function f(x: P) -> integer { x.age }
Type(f)`).value
    ).toBe('"(x: P) -> integer"');
  });
});

describe('route parity', () => {
  test('Epsil source: the store runs and the object is mutated', () => {
    const { value, diagnostics } = run(`${FIELD_BACKED}
p.age = 43
p.age`);
    expect(diagnostics).toEqual([]);
    expect(value).toBe('43');
  });

  test('parse route: the Epsil statement `p.age = 43` boxes to a `state` store', () => {
    // The route the box test above does NOT cover: an `Assign(Field(…))` built
    // by the Epsil parser, whose operands carry source offsets and are boxed
    // from raw MathJSON rather than handed over already boxed.
    const { ce } = run(FIELD_BACKED);
    const [ast] = parseEpsil('p.age = 43');
    const store = ce.box(ast as never);
    expect(store.effects).toEqual(['state']);
  });

  test('box route: the four-operand `ProtocolProperty` both labels and stores', () => {
    const { ce } = run(FIELD_BACKED);
    const set = ce.box([
      'ProtocolProperty',
      { str: 'Aged' },
      { str: 'age' },
      'p',
      43,
    ] as never);
    expect(set.effects).toEqual(['state']);
    // A store evaluates to the value assigned, not to the receiver.
    expect(String(set.evaluate())).toBe('43');
    expect(run('p.age', ce).value).toBe('43');
  });

  test('host route: a `setters` implementation on an object type is `state`', () => {
    // The host channel registers plain JS callbacks, so nothing about the
    // implementation is inspectable — which is precisely why the label comes
    // from the SHAPE of the call (four operands ⇒ a set) rather than from what
    // the handler turns out to do.
    const ce = new ComputeEngine();
    run(
      `protocol Tagged { readwrite tag: string }
type R = object{s: string}`,
      ce
    );
    ce.declareProtocolImplementation('R', 'Tagged', {
      getters: {
        tag: (self: Expression) =>
          isObject(self) ? self._field('s') : undefined,
      },
      setters: {
        tag: (self: Expression, v: Expression) => {
          if (!isObject(self)) return undefined;
          self._store('s', v);
          return self;
        },
      },
    } as never);
    run('let r = R(s: "a")', ce);
    const set = ce.box([
      'ProtocolProperty',
      { str: 'Tagged' },
      { str: 'tag' },
      'r',
      { str: 'z' },
    ] as never);
    expect(set.effects).toEqual(['state']);
    expect(String(set.evaluate())).toBe('"z"');
    const read = ce.box([
      'ProtocolProperty',
      { str: 'Tagged' },
      { str: 'tag' },
      'r',
    ] as never);
    expect(read.effects).toBeUndefined();
    expect(String(read.evaluate())).toBe('"z"');
  });
});

describe('an accessor body’s own effects ARE propagated', () => {
  /** The stored implementation literal for `key` on the single conformance
   * edge of the `Aged` protocol. */
  function storedAccessor(ce: ComputeEngine, key: string): Expression {
    const registry = (
      ce as unknown as {
        _protocolRegistry: Record<
          string,
          { conformances: { impl?: Record<string, Expression> }[] }
        >;
      }
    )._protocolRegistry;
    return registry['Aged']!.conformances[0]!.impl![key]!;
  }

  test('an authored `set` block that stores infers `state` of its own', () => {
    // The receiver of a stored implementation literal is written `Self`, a
    // substitution token no type resolver knows. Until the substitution was
    // applied to the STORED literal (it used to happen per dispatch), the
    // effect walk saw that parameter typed `unknown` and could not tell that
    // `self.n = v` is a store, so the setter reported no effects at all — and
    // a `pure` annotation on it would not have been refused by body evidence.
    const { ce } = run(COMPUTED);
    expect(
      inferFunctionLiteralEffects(ce as never, storedAccessor(ce, '__set__age'))
        .effects
    ).toEqual(['state']);
  });

  test('the stored setter’s ARROW carries `state`', () => {
    // `protocolAccessorEffects()` in `effects-of.ts` reads the effects off this
    // arrow, so the substitution has to reach the stored literal's own type,
    // not just a walk run over it.
    const { ce } = run(COMPUTED);
    const setter = storedAccessor(ce, '__set__age');
    expect(String(setter.type)).toContain('state');
    expect(String(setter.type)).toContain('self: Q');
  });

  test('a non-storing `get` block still infers nothing', () => {
    // The other side of the same coin: substituting `Self` must not invent
    // effects for a body that has none.
    const { ce } = run(COMPUTED);
    expect(
      inferFunctionLiteralEffects(ce as never, storedAccessor(ce, '__get__age'))
        .effects
    ).toBeUndefined();
  });
});
