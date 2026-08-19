import { ComputeEngine } from '../../src/compute-engine';

/**
 * Phase A of the tensor-unification design: honest, shape-derived typing of
 * literal `List` nodes (§D3 of
 * docs/COLLECTIONS-MODEL.md).
 *
 * A shape claim (`vector<n>`/`matrix<…>`/`list<C^dims>`) is emitted only for a
 * shape-regular list over atomic cells with a union-free global cell type; the
 * numeric-lift clause keeps numeric and folded-symbol lists reporting
 * `vector`/`matrix` byte-for-byte. Non-numeric, heterogeneous, list-typed, or
 * `value`-typed cells no longer mistype as `vector<n>`.
 *
 * Note: symbols here are used in numeric contexts only, so lowercase is fine;
 * `L` (declared `list<number>`) is declared in its own fresh engine to avoid
 * cross-test type pollution.
 */

const ce = new ComputeEngine();

function typeOf(expr: any): string {
  return ce.box(expr).type.toString();
}

describe('Phase A — honest List shape typing (§D3 normative table)', () => {
  // Phase C representation unification: literal lists type honestly
  // (list<finite_…^dims>).
  test('[1,2,3] → vector<finite_integer^3> (honest literal-list typing)', () => {
    // Phase C: every List is a plain canonical List; its cell type is the
    // honest global-widened element type reported from the List type handler.
    expect(typeOf(['List', 1, 2, 3])).toBe('vector<finite_integer^3>');
  });

  test('evaluated broadcast result: honest shaped type, subtype of declared', () => {
    const expr = ce.box(['Sqrt', ['List', 4, 9]]);
    const evaluated = expr.evaluate();
    // Plain-List path: honest widened cells with dimensions…
    expect(evaluated.type.toString()).toMatch(/\^2>$/);
    // …and the broadcast-typing contract holds: evaluated ⊆ declared.
    expect(evaluated.type.matches(expr.type.type)).toBe(true);
  });

  test('[x,y] undeclared symbols → vector<2> (unchanged fold)', () => {
    expect(typeOf(['List', 'x', 'y'])).toBe('vector<2>');
  });

  test('[Rgb,Rgb] → list<color^2> (Tycho item 69)', () => {
    expect(typeOf(['List', ['Rgb', 1, 0, 0], ['Rgb', 0, 1, 0]])).toBe(
      'list<color^2>'
    );
  });

  test('[[1,2],[3.5,4.5]] → matrix<finite_real^(2x2)> (honest global widening)', () => {
    const boxed = ce.box(['List', ['List', 1, 2], ['List', 3.5, 4.5]]);
    expect(boxed.type.toString()).toBe('matrix<finite_real^(2x2)>');
  });

  test('[[x,y],[z,w]] undeclared symbols → matrix<2x2> (fold at every leaf)', () => {
    const t = typeOf(['List', ['List', 'x', 'y'], ['List', 'z', 'w']]);
    expect(t).toBe('matrix<2x2>');
    // matrix<2x2> is the surface form of list<number^2x2>
    expect(
      ce
        .box(['List', ['List', 'x', 'y'], ['List', 'z', 'w']])
        .type.matches('list<number^(2x2)>')
    ).toBe(true);
  });

  test('[x,Rgb] → unshaped honest union (union-free clause blocks shape)', () => {
    const boxed = ce.box(['List', 'x', ['Rgb', 1, 0, 0]]);
    // No shape claim: not a vector<2>.
    expect(boxed.type.matches('vector<2>')).toBe(false);
    // The ANALYZED cell widening is preserved — the bare symbol `x` folds
    // to `number`, so the honest element type is the union, unshaped. (The
    // raw-widen fallback would absorb the unknown and unsoundly claim
    // `list<color>`.)
    expect(boxed.type.toString()).toBe('list<color | number>');
  });

  test('["hot", NaN] mixed literal cells → unshaped union (union-free clause)', () => {
    // Same clause as `[x,Rgb]`, reached with plain literal cells and no
    // symbol fold: a mixed string/number list carries NO dimension, so it is
    // not a tensor. Pinned because a dimensioned `list` type IS the tensor
    // claim (`isTensor` is exactly `dimensions !== undefined`) — the
    // dimensionless type here is normative, not an omission.
    const boxed = ce.box(['List', { str: 'hot' }, NaN]);
    expect(boxed.type.toString()).toBe('list<number | string>');
    expect(boxed.type.matches('vector<2>')).toBe(false);
    expect(boxed.type.matches('list<number | string^2>')).toBe(false);
  });

  test('union element with a numeric arm still admits to numeric ops (COULD-semantics)', () => {
    // Pins the union-arm clause of `couldBeNumericElement`
    // (collection-utils.ts): `Add` over a list whose element type is a
    // union with a could-be-numeric arm validates (stays symbolic — inert,
    // not an incompatible-type error).
    const e = ce.box(['Add', ['List', 'x', ['Rgb', 1, 0, 0]], 1]);
    expect(e.isValid).toBe(true);
  });

  test('[SpeedOfLight, PlanckConstant] (value-typed) → list<value>, no shape', () => {
    // Precondition: these physics constants type `value`.
    expect(ce.symbol('SpeedOfLight').type.toString()).toBe('value');
    const t = typeOf(['List', 'SpeedOfLight', 'PlanckConstant']);
    expect(t).toBe('list<value>');
    expect(
      ce
        .box(['List', 'SpeedOfLight', 'PlanckConstant'])
        .type.matches('vector<2>')
    ).toBe(false);
  });

  test('[L,L] with L: list<number> → list<list<number>>, no shape', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<number>');
    const boxed = ce2.box(['List', 'L', 'L']);
    expect(boxed.type.toString()).toBe('list<list<number>>');
    expect(boxed.type.matches('vector<2>')).toBe(false);
  });

  test('[h(x)] undeclared application → no fold, no shape', () => {
    const boxed = ce.box(['List', ['h', 'x']]);
    // Application typed unknown/any is never folded and blocks the claim.
    expect(boxed.type.matches('vector<1>')).toBe(false);
    // `h` is undeclared, so it types as the bare `function` type, whose result
    // is genuinely not known: `unknown`. (This read `list<any>` until
    // `functionResult('function')` was corrected from `any` to `unknown` —
    // `any` asserted "could be anything" as a positive fact, and contradicted
    // the `(any*) -> unknown` signature the same module synthesized for
    // `function`.) §D3 treats `unknown`/`any` as interchangeable for the fold
    // and the shape claim, and every subtyping answer is identical for
    // `list<unknown>` and `list<any>` — only the rendering changed.
    expect(boxed.type.toString()).toBe('list<unknown>');
  });
});

describe('Phase A — degenerate lists keep prior (no-claim) behavior', () => {
  // Phase C representation unification: literal lists type honestly
  // (list<finite_…^dims>).
  // The empty list's element type is the BOTTOM type: its elements are drawn
  // from the empty set. `widen()` over zero operands returns `never`, so `[]`
  // is `list<never>` and — by covariance, since `never <: X` — a member of
  // every list type. This read `list<nothing>` until 2026-07-26; `nothing` is
  // the unit type of the value `Nothing`, not the bottom type, so the empty
  // list was a member of NO list type (`[] <: list<integer>` was false).
  test('[] → list<never>, and is assignable to any list type', () => {
    expect(typeOf(['List'])).toBe('list<never>');
    expect(ce.box(['List']).type.matches('list<integer>')).toBe(true);
    expect(ce.box(['List']).type.matches('list<string>')).toBe(true);
  });

  test('ragged [[1,2],[3]] → no shape claim', () => {
    const boxed = ce.box(['List', ['List', 1, 2], ['List', 3]]);
    expect(boxed.type.matches('matrix<2x2>')).toBe(false);
    // Mixed row dimensions surface as a list of differently-shaped vectors.
    expect(boxed.type.toString()).toBe(
      'list<vector<finite_integer^1> | vector<finite_integer^2>>'
    );
  });

  test('mixed-depth [1,[2]] → no shape claim', () => {
    const boxed = ce.box(['List', 1, ['List', 2]]);
    expect(boxed.type.matches('vector<2>')).toBe(false);
    expect(boxed.type.toString()).toBe(
      'list<finite_integer | vector<finite_integer^1>>'
    );
  });

  test('[[],[]] empty inner levels → no shape claim', () => {
    const boxed = ce.box(['List', ['List'], ['List']]);
    expect(boxed.type.matches('matrix<2x0>')).toBe(false);
    expect(boxed.type.toString()).toBe('list<list<never>>');
  });
});

describe('BROADCAST ARM 1 — a handler that owns its collection typing is not re-wrapped', () => {
  // `Negate` is on the `handlerOwnsCollectionTyping` allowlist: its type
  // handler passes the operand's type through, so its result is ALREADY the
  // whole broadcast collection. The arm-1 wrapper assumes a SCALAR per-element
  // `sigResult` and peels one rank off before re-shaping, which turned an
  // honest `matrix<E^(2x2)>` into the mixed-encoding
  // `list<vector<E^2>^(2x2)>`. The pre-existing `deferToHandler` gate only
  // dropped the `isFixedShapeCollection` disjunct — enough for a matrix-TYPED
  // SYMBOL (`-M → matrix`), but a matrix LITERAL still entered
  // `broadcastingOps` through `isFiniteIndexedCollection` and got re-wrapped.
  // Rank 1 round-tripped by luck, which is why this only ever showed at
  // rank ≥ 2.
  const M22 = ['List', ['List', 1, 2], ['List', 3, 4]] as any;

  test('a matrix LITERAL keeps the dimensioned matrix encoding', () => {
    const e = ce.box(['Negate', M22]);
    expect(e.type.toString()).toBe('matrix<finite_integer^(2x2)>');
    // The declared type is exactly what the value evaluates to — the mixed
    // encoding was a strictly worse claim about the same value.
    expect(e.evaluate().type.toString()).toBe('matrix<finite_integer^(2x2)>');
    expect(e.evaluate().toString()).toBe('[[-1,-2],[-3,-4]]');
  });

  test('rank 3 too — the re-wrap nested a matrix inside a rank-3 shape', () => {
    const e = ce.box(['Negate', ['List', M22, M22]]);
    expect(e.type.toString()).toBe('list<finite_integer^(2x2x2)>');
    expect(e.evaluate().type.toString()).toBe('list<finite_integer^(2x2x2)>');
  });

  test('a matrix-TYPED symbol and rank 1 are unchanged', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('MM', 'matrix<integer^(2x2)>');
    expect(ce2.box(['Negate', 'MM']).type.toString()).toBe(
      'matrix<integer^(2x2)>'
    );
    expect(ce.box(['Negate', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['Negate', 5]).type.toString()).toBe('finite_integer');
  });

  test('a SHAPELESS handler result still goes through the wrapper', () => {
    // `Range(1,5)` is `indexed_collection<integer>` — no statically-provable
    // dimensions — so the wrapper's upgrade to the definite `list<integer>` is
    // real information, not a mangling. Short-circuiting here would LOSE
    // precision, so `staticCollectionDims` gates the short circuit.
    expect(ce.box(['Negate', ['Range', 1, 5]]).type.toString()).toBe(
      'list<integer>'
    );
  });

  test('GROUND-PATH REGRESSION — a non-allowlisted broadcastable is untouched', () => {
    // `Sin`/`Sqrt` compute a SCALAR per-element result, so the wrapper is what
    // builds their shape and must keep running. These are the reference
    // answers the allowlisted handlers now agree with.
    expect(ce.box(['Sin', M22]).type.toString()).toBe('matrix<2x2>');
    expect(ce.box(['Sqrt', M22]).type.toString()).toBe('matrix<2x2>');
    expect(ce.box(['Sin', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<3>'
    );
  });

  test('a polytype broadcastable takes the WRAPPER answer on mixed ranks', () => {
    // D10 RE-RULED (2026-08-04): the echo short-circuit that used to hand the
    // dominant operand's type back verbatim is retired — a lift-admitted
    // operand now binds its ELEMENT, so the wrapper builds every answer. With
    // operands of DIFFERENT ranks the wrapper declines to invent a shape and
    // answers the plain `list<E>`, which is exactly what the GROUND
    // broadcastable answers for the same call (§4.5 parity). Less precise
    // than the retired short-circuit, still sound: both orders pin
    // evaluated ⊆ declared.
    const eng = new ComputeEngine();
    eng.declare('pg57', {
      signature: '(T, U) -> T where T: number, U: number',
      broadcastable: true,
      evaluate: (ops) => ops[0],
    } as any);
    const low = eng.box(['pg57', ['List', 10, 20], M22]);
    expect(low.type.toString()).toBe('list<finite_integer>');
    expect(low.evaluate().type.matches(low.type.toString())).toBe(true);
    const dom = eng.box(['pg57', M22, ['List', 10, 20]]);
    expect(dom.type.toString()).toBe('list<finite_integer>');
    expect(dom.evaluate().type.matches(dom.type.toString())).toBe(true);
    // The ground counterpart, for the parity claim above.
    eng.declare('gg57', {
      signature: '(number, number) -> number',
      broadcastable: true,
      evaluate: (ops) => ops[0],
    } as any);
    expect(eng.box(['gg57', M22, ['List', 10, 20]]).type.toString()).toBe(
      'list<number>'
    );
  });

  test('a UNION-typed operand also takes the wrapper answer', () => {
    // Same re-ruling: a declared `list<integer> | matrix<integer>` operand at
    // `(T) -> T where T` binds `T` to the union's ELEMENT (`integer` on
    // both arms), and the wrapper — unable to prove a rank across the arms —
    // answers `list<integer>`. Again the ground reading, and again sound.
    const eng = new ComputeEngine();
    eng.declare('lu57', 'list<integer> | matrix<integer>');
    eng.declare('echoU57', {
      signature: '(T) -> T where T',
      broadcastable: true,
      evaluate: (ops) => ops[0],
    } as any);
    const e = eng.box(['echoU57', 'lu57']);
    expect(e.type.toString()).toBe('list<integer>');
    expect(e.evaluate().type.matches(e.type.toString())).toBe(true);
    // `Remainder(M, 7)` no longer widens to a union at all: element-binding
    // joins the matrix LEAF with the scalar, so the wrapper gives the clean
    // matrix (was `list<finite_integer | vector<finite_integer^2>^(2x2)>`).
    expect(ce.box(['Remainder', M22, 7]).type.toString()).toBe(
      'matrix<finite_integer^(2x2)>'
    );
  });
});
