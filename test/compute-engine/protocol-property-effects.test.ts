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

  test('a store through a COMPUTED property lowers to the setter and is `state`', () => {
    // The receiver's type is settled at canonicalization here, so `q.age = 5`
    // is rewritten to `q = ProtocolProperty("Aged", "age", q, 5)`. The `scope`
    // is the rebinding the sugar performs; the `state` is the store the setter
    // does.
    const { ce } = run(COMPUTED);
    const store = ce.box([
      'Assign',
      ['Field', 'q', { str: 'age' }],
      5,
    ] as never);
    expect(store.json).toEqual([
      'Assign',
      'q',
      ['ProtocolProperty', "'Aged'", "'age'", 'q', 5],
    ]);
    expect(store.effects).toEqual(['scope', 'state']);
  });

  test('a value type can no longer reach the setter at all (B1)', () => {
    // The Appendix A rebinding sugar — `d.name = v` on a tuple, which rebinds
    // `d` through the protocol's setter rather than mutating anything — used to
    // lower to the same four-operand `ProtocolProperty` as a real store, and
    // was therefore labelled `state` by the shape-based rule above. That
    // over-label is now unreachable: the B1 mutability gate refuses the
    // conformance itself, so no value type has a settable property to assign
    // through. Pinned here because it is what licenses the rule to read a
    // four-operand set as a heap store with no further evidence.
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
    // That is safe only because every route which gives a symbol an object
    // type advances the callable axis the memo is stamped on. This pins it:
    // narrowing that selector must fail here rather than freeze a `scope`
    // label on this node, and on every ancestor that projected through it.
    const ce = new ComputeEngine();
    run('type P = object{age: integer}', ce);
    const stmt = ['Assign', ['Field', 'p', { str: 'age' }], 43];
    const node = ce.box(stmt as never);
    const block = ce.box(['Block', stmt] as never);
    expect(node.effects).toEqual(['scope']);
    expect(block.effects).toEqual(['scope']);

    run('let p = P(age: 1)', ce);

    // The SAME node objects, not fresh ones — a fresh box would miss the memo
    // and pass whatever the axis does.
    expect(node.effects).toEqual(['state']);
    expect(block.effects).toEqual(['state']);
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

  test('a verdict that consulted the REGISTRY re-derives when it changes', () => {
    // The unsound direction of staleness. `age` is not in `Q`'s layout, so the
    // store is recognised only because a protocol declares `age` a `readwrite`
    // property — and in the first batch no protocol does. Freezing that
    // negative verdict onto `f`'s arrow would leave a `pure`-eligible function
    // that mutates its caller's object once the conformance lands. The walk
    // records that it read the registry, so the definition installs a deriver
    // and re-runs the inference instead.
    const ce = new ComputeEngine();
    expect(
      run(
        `type Q = object{n: integer}
function f(x: Q) { x.age = 3 }
Type(f)`,
        ce
      ).value
    ).toBe('"(x: Q) -> number"');

    // A LATER batch declares the protocol and the conformance…
    run(
      `protocol Aged { readwrite age: integer }
type Q is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}`,
      ce
    );

    // …and `f`'s arrow now reports the store, without `f` being redefined.
    expect(run('Type(f)', ce).value).toBe('"(x: Q) state -> number"');
  });

  test('…and a `pure` annotation cannot outrun the declaration either', () => {
    // The same ordering, with the contract spelled: declaring the protocol
    // afterwards is refused rather than silently widening `f` past its
    // annotation.
    const { value, diagnostics } = run(`type Q = object{n: integer}
function f(x: Q) pure { x.age = 3 }
protocol Aged { readwrite age: integer }
type Q is Aged {
  get age(self: Self) -> integer { self.n }
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}`);
    expect(value).toContain('conformance-widens-declared-contract');
    expect(diagnostics.join('|')).toContain(
      '`f` declares `pure` but would infer `state`'
    );
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
    expect(String(set.evaluate())).toBe('P(age: 43)');
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
    expect(String(set.evaluate())).toBe('R(s: "z")');
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
