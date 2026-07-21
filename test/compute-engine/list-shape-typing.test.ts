import { ComputeEngine } from '../../src/compute-engine';

/**
 * Phase A of the tensor-unification design: honest, shape-derived typing of
 * literal `List` nodes (§D3 of
 * docs/plans/2026-07-20-tensor-unification-design.md).
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
  test('[1,2,3] → vector<3> (packed-dtype BoxedTensor fast path, Phase A interim)', () => {
    // ce.box literals take the BoxedTensor packed-numeric path (raw JS
    // leaves): cell stays `number` until Phase C unifies representations.
    // Plain Lists (broadcast results) get the honest widened cell type from
    // the List type handler — see the evaluated-broadcast test below.
    expect(typeOf(['List', 1, 2, 3])).toBe('vector<3>');
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

  test('[[1,2],[3.5,4.5]] → matrix<2x2> (packed-dtype fast path, Phase A interim)', () => {
    const boxed = ce.box(['List', ['List', 1, 2], ['List', 3.5, 4.5]]);
    expect(boxed.type.toString()).toBe('matrix<2x2>');
  });

  test('[[x,y],[z,w]] undeclared symbols → matrix<2x2> (fold at every leaf)', () => {
    const t = typeOf(['List', ['List', 'x', 'y'], ['List', 'z', 'w']]);
    expect(t).toBe('matrix<2x2>');
    // matrix<2x2> is the surface form of list<number^2x2>
    expect(ce.box(['List', ['List', 'x', 'y'], ['List', 'z', 'w']]).type.matches(
      'list<number^(2x2)>'
    )).toBe(true);
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
    expect(ce.box(['List', 'SpeedOfLight', 'PlanckConstant']).type.matches(
      'vector<2>'
    )).toBe(false);
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
    expect(boxed.type.toString()).toBe('list<any>');
  });
});

describe('Phase A — degenerate lists keep prior (no-claim) behavior', () => {
  test('[] → list<nothing>', () => {
    expect(typeOf(['List'])).toBe('list<nothing>');
  });

  test('ragged [[1,2],[3]] → no shape claim', () => {
    const boxed = ce.box(['List', ['List', 1, 2], ['List', 3]]);
    expect(boxed.type.matches('matrix<2x2>')).toBe(false);
    // Mixed row dimensions surface as a list of differently-shaped vectors.
    expect(boxed.type.toString()).toBe('list<vector<1> | vector<2>>');
  });

  test('mixed-depth [1,[2]] → no shape claim', () => {
    const boxed = ce.box(['List', 1, ['List', 2]]);
    expect(boxed.type.matches('vector<2>')).toBe(false);
    expect(boxed.type.toString()).toBe('list<finite_integer | vector<1>>');
  });

  test('[[],[]] empty inner levels → no shape claim', () => {
    const boxed = ce.box(['List', ['List'], ['List']]);
    expect(boxed.type.matches('matrix<2x0>')).toBe(false);
    expect(boxed.type.toString()).toBe('list<list<nothing>>');
  });
});
