/**
 * Regression tests for Tycho item 52: scalar×tuple/list numeric evaluation
 * over broadcast lists ground at ~150 µs/element — ~100–1000× slower than the
 * equivalent `Map` — and the result arrived UNREDUCED (an inert
 * `Multiply(scalar, ⟨collection⟩)`).
 *
 * Three coordinated changes, all hybrid-lazy (small collections ≤
 * `MAX_SIZE_EAGER_COLLECTION` are byte-identical to the previous eager
 * shapes):
 *
 * 1. `PointList` past the eager threshold transposes to the lazy `Map` form
 *    instead of materializing n `Tuple`s per consumer.
 * 2. `PointX`/`PointY`/`PointZ` project lazily — and project straight to the
 *    source collection when the operand is the lazy transpose form
 *    (`PointX(PointList(a, b, c))` ≡ `a` for equal-length components).
 * 3. `addN`/`mulN` re-dispatch their broadcast branches after numeric operand
 *    evaluation, so collection-ness that only emerges through evaluation
 *    (`Mod(L, 11)` over a list `L` → a lazy `Map`) composes lazily instead of
 *    leaving an inert `Multiply`/`Add`.
 *
 * The shapes below use >100 elements so the lazy arms are exercised; the
 * minimized grind (probes E–H) is from the item-52 filing (corpus state
 * gpphvdn2mi, plan row B22).
 */

import { ComputeEngine } from '../../src/compute-engine';

function engineWithL(n: number): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.assign('L', ce.box(['Range', 0, n]).evaluate());
  return ce;
}

const MOD_LIST = ['Add', ['Mod', 'L', 11], -5];
const PT_LIST = ['PointList', MOD_LIST, MOD_LIST, MOD_LIST];

describe('Tycho item 52 — lazy PointList transpose and projections', () => {
  test('a scalar×lazy-broadcast product reduces to the lazy Map form (was inert)', () => {
    const ce = engineWithL(400);
    const r = ce.box(['Multiply', 0.2, ['Mod', 'L', 11]]).N();
    expect(r.operator).toBe('Map');
    expect(r.count).toBe(401);
    expect(r.at(2)?.re).toBeCloseTo(0.2, 12);
  });

  test('probe E: PointX over a large PointList projects lazily to the component', () => {
    const ce = engineWithL(400);
    const r = ce.box(['PointX', PT_LIST]).N();
    expect(r.operator).toBe('Map');
    expect(r.count).toBe(401);
    // mod(0,11)-5 = -5, mod(6,11)-5 = 1
    expect(r.at(1)?.re).toBe(-5);
    expect(r.at(7)?.re).toBe(1);
  });

  test('probe F: scalar × Tuple of projections stays lazy, with correct values', () => {
    const ce = engineWithL(400);
    const tup = [
      'Tuple',
      ['Negate', ['PointY', PT_LIST]],
      ['PointZ', PT_LIST],
      ['PointX', PT_LIST],
    ];
    const r = ce.box(['Multiply', 0.2, tup]).N();
    expect(r.operator).toBe('Tuple');
    expect(r.ops!.map((o) => o.operator)).toEqual(['Map', 'Map', 'Map']);
    // Component 1 is 0.2·(−(mod(k,11)−5)): elements 1..3 → 1, 0.8, 0.6
    expect(r.ops![0].at(1)?.re).toBeCloseTo(1, 12);
    expect(r.ops![0].at(2)?.re).toBeCloseTo(0.8, 12);
    expect(r.ops![0].at(3)?.re).toBeCloseTo(0.6, 12);
  });

  test('probe G: the subs route is equivalent to the literal-scalar route', () => {
    const ce = engineWithL(400);
    const tup = [
      'Tuple',
      ['Negate', ['PointY', PT_LIST]],
      ['PointZ', PT_LIST],
      ['PointX', PT_LIST],
    ];
    const r = ce
      .box(['Multiply', 's', tup])
      .subs({ s: 0.2 })
      .N();
    expect(r.operator).toBe('Tuple');
    expect(r.ops![0].at(1)?.re).toBeCloseTo(1, 12);
  });

  test('probe H: the full B22 arg0 composes lazily with correct elements', () => {
    const ce = engineWithL(400);
    const tup = [
      'Tuple',
      ['Negate', ['PointY', PT_LIST]],
      ['PointZ', PT_LIST],
      ['PointX', PT_LIST],
    ];
    const arg0 = [
      'Add',
      ['Multiply', ['Rational', -1, 2], 's', tup],
      [
        'Tuple',
        ['PointX', PT_LIST],
        ['PointY', PT_LIST],
        ['PointZ', PT_LIST],
      ],
    ];
    const r = ce.box(arg0).subs({ s: 0.2 }).N();
    expect(r.operator).toBe('Tuple');
    expect(r.ops!.map((o) => o.operator)).toEqual(['Map', 'Map', 'Map']);
    // Component 1, element 1: −0.1·(−(−5)) + (−5) = −5.5; element 12 starts
    // the second mod cycle → −5.5 again.
    expect(r.ops![0].at(1)?.re).toBeCloseTo(-5.5, 12);
    expect(r.ops![0].at(12)?.re).toBeCloseTo(-5.5, 12);
    // Fully drainable via each().
    let count = 0;
    for (const el of r.ops![0].each()) {
      expect(el.N().isNumberLiteral).toBe(true);
      count++;
      if (count > 3) break;
    }
  });

  test('small PointList keeps the eager List<Tuple> shape (consumer contract)', () => {
    const ce = new ComputeEngine();
    ce.assign('n', ce.box(['List', 1, 2, 3]).evaluate());
    const r = ce.box(['PointList', -6, 'n']).evaluate();
    expect(r.json).toEqual([
      'List',
      ['Tuple', -6, 1],
      ['Tuple', -6, 2],
      ['Tuple', -6, 3],
    ]);
  });

  test('projection over a RAGGED lazy transpose falls back to transpose semantics', () => {
    // Components of unequal length zip to the shortest — projecting the
    // longer component directly would yield extra elements, so the
    // projection fast-path must NOT fire.
    const ce = new ComputeEngine();
    const a = Array.from({ length: 150 }, (_, i) => i);
    const b = Array.from({ length: 120 }, (_, i) => 10 * i);
    const pl = ['PointList', ['List', ...a], ['List', ...b]];
    const r = ce.box(['PointX', pl]).evaluate();
    expect(r.count).toBe(120); // zip-to-shortest, not 150
    expect(r.at(1)?.re).toBe(0);
    expect(r.at(120)?.re).toBe(119);
  });

  test('projection of a pre-evaluated EXACT point list floats under .N() (review finding)', () => {
    // The fast-path returns the source collection — which is the EXACT
    // collection when the PointList was evaluated exactly first. `.N()` must
    // still float the elements (x.N() ≡ x.evaluate().N() parity).
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['Range', 1, 300]).evaluate());
    const pl = ce.box(['PointList', ['Divide', 'L', 3], 'L', 'L']).evaluate();
    const px = ce.box(['PointX', pl]).N();
    const el = px.at(2);
    expect(el?.re).toBeCloseTo(2 / 3, 12);
    expect((el as any).isExact).toBe(false); // a float, not the exact 2/3
  });

  test('a user-authored Map over a non-indexed Set keeps the generic projection (review finding)', () => {
    // `Map(Set(…), x ↦ Tuple(x, 0))` matches the transpose SHAPE but not its
    // contract (the source is not indexed) — the fast-path must decline so
    // the projection stays an indexed List, not the source Set.
    const ce = new ComputeEngine();
    const setElems = Array.from({ length: 150 }, (_, i) => i);
    const m = [
      'Map',
      ['Set', ...setElems],
      ['Function', ['Tuple', 'x', 0], 'x'],
    ];
    const px = ce.box(['PointX', m]).evaluate();
    expect(px.operator).not.toBe('Set');
    expect(px.isIndexedCollection).toBe(true);
    expect(px.count).toBe(150);
  });

  test('a small eager projection is tensor-canonicalized (review finding)', () => {
    // The eager branch must keep full `List` canonicalization so a numeric
    // coordinate list types as a vector (tensor-only consumers rely on it).
    const ce = new ComputeEngine();
    const ys = Array.from({ length: 5 }, (_, i) => i);
    const px = ce
      .box(['PointX', ['PointList', ['List', ...ys], 7]])
      .evaluate();
    expect(px.type.toString()).toBe('vector<5>');
  });

  test('projection of a SCALAR slot broadcasts (no fast-path shape change)', () => {
    // The x-slot is a scalar: the projected coordinate list is n copies of
    // it, not the scalar itself.
    const ce = new ComputeEngine();
    const ys = Array.from({ length: 150 }, (_, i) => i);
    const r = ce.box(['PointX', ['PointList', -6, ['List', ...ys]]]).evaluate();
    expect(r.count).toBe(150);
    expect(r.at(1)?.re).toBe(-6);
    expect(r.at(150)?.re).toBe(-6);
  });
});
