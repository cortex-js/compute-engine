import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Compiling protocol dispatch to JavaScript —
// `docs/COMPILATION-MODEL.md`; the governing ruling is
// `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A, "Static resolution and compiled
// code".
//
// Two tiers: a STATICALLY RESOLVED call compiles to a direct call of the
// winning implementation (no guards in the emitted code); a DYNAMIC call
// reifies the receiver's runtime representation into a guard chain,
// most-specific-first, throwing `protocol-implementation-missing` on
// fall-through (the multi-clause `no-matching-clause` convention — the
// interpreter's error VALUE has no compiled analog). Anything unprovable
// declines (fail closed, D6). GPU/interval targets keep failing
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
    expect(
      ce
        .box(['hash', { str: 'q' }] as any)
        .evaluate()
        .toString()
    ).toBe('"H"');
  });
});

describe('tier B: reified dynamic dispatch', () => {

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

describe('properties', () => {

  // A SETTABLE property, and therefore — by the same gate — an OBJECT
  // receiver. Objects have no compiled representation yet (Phase 4 of
  // `docs/TYPE-SYSTEM.md`), so every
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
      String(executeEpsil(ce, 'rename(Cell(n: "alice", age: 30), "bob")').value)
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
      ce
        .box(['relabel', { str: 'bob' }] as any)
        .evaluate()
        .toString()
    ).toBe('Cell(n: "bob", age: 1)');
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
    expect(String(result.error)).toContain('Could not compile');
    // The pipeline refuses the function value as an input of a type outside
    // its profile.
    expect(String(result.error)).toContain('the input bump of type');
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
    expect(String(result.error)).toContain('Could not compile');
    // The pipeline refuses the function value as an input of a type outside
    // its profile.
    expect(String(result.error)).toContain('the input bumpQualified of type');
  });

  test('a SET on a value receiver never reaches the compiler at all', () => {
    // It is refused where it is written: assignment through a `Field` target is
    // a store, a store needs a mutable object, and a tuple is not one — so the
    // function declaration is refused and no definition is installed.
    // Program evaluates its type/conformance statements before the function. (A `readonly` property is the only kind a value type can carry
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
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.arrayContaining(['immutable-value-assignment']) }),
    ]));
    expect(ce.lookupDefinition('retag')?.operator?.evaluate).toBeUndefined();
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
