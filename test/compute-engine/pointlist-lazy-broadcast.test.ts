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
    // `Map(x ↦ Tuple(x, 0), Set(…))` matches the transpose SHAPE but not its
    // contract (the source is not indexed) — the fast-path must decline so
    // the projection stays an indexed List, not the source Set.
    const ce = new ComputeEngine();
    const setElems = Array.from({ length: 150 }, (_, i) => i);
    const m = [
      'Map',
      ['Function', ['Tuple', 'x', 0], 'x'],
      ['Set', ...setElems],
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
    // Phase C representation unification: literal lists type honestly
    // (list<finite_…^dims>).
    expect(px.type.toString()).toBe('vector<integer^5>');
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

describe('Tycho item 54 — machine-precision Tuple ± scalar·Tuple', () => {
  // At machine precision, a component sum whose terms are all integer-valued
  // floats routes into `ExactNumericValue.sum`, whose integer fold read
  // `bignumRe` — undefined on `MachineNumericValue` → TypeError (reading
  // 'toFixed'). Killed composed lazy streams mid-drain and made `at()`
  // return undefined at the crashing indices.

  test('.N() of Tuple − scalar·Tuple with an integer-valued component', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    // z-component: 20 − 0.1·20 = 20 − 2, an integer+integer machine sum.
    const r = ce.parse('(-5,-5,20)-0.1(-5,-5,20)').N();
    expect(r.operator).toBe('Tuple');
    expect(r.ops!.map((o) => o.re)).toEqual([-4.5, -4.5, 18]);
  });

  test('composed transpose drains fully; at() works at exact-sum indices', () => {
    const ce = engineWithL(400);
    const diff = ce
      .box(['Subtract', PT_LIST, ['Multiply', 0.5, PT_LIST]])
      .N();
    expect(diff.operator).toBe('Map');
    expect(diff.count).toBe(401);
    // Element 2 (k=1): c = mod(1,11)−5 = −4; c − 0.5c = −2 — the
    // integer+integer machine sum that crashed mid-stream.
    expect(diff.at(2)?.ops?.map((o) => o.re)).toEqual([-2, -2, -2]);
    let n = 0;
    for (const el of diff.each()) {
      expect(el.operator).toBe('Tuple');
      if (++n >= 401) break;
    }
    expect(n).toBe(401);
  });
});

describe('Tycho item 222 — PointList over UNKNOWN-length views', () => {
  // A point list built from views whose LENGTH is not yet known — a `Map` over
  // `Range(0, n)` with the slider `n` still unassigned — used to evaluate to an
  // inert `PointList` head: no collection capability, no point count, and an
  // arity-less `list<tuple>` type. The consumer could not assign it, and every
  // expression downstream of it went symbolic.
  //
  // Such a component cannot be zipped EAGERLY (there is no length to iterate
  // to), but it can be zipped lazily, exactly as `view · (1, 0)` already was:
  // the transpose is the variadic `Map` view, which pairs positionally and
  // resolves to an ordinary finite point list as soon as `n` binds.

  /** An engine with `A` = the unknown-length view `Map(_ ↦ _/n, Range(0, n))`,
   * `n` declared but unassigned. */
  function viewEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    ce.assign(
      'A',
      ce
        .box(['Map', ['Function', ['Divide', '_', 'n'], '_'], ['Range', 0, 'n']])
        .evaluate()
    );
    return ce;
  }

  /** The upper semicircle's x-coordinate view: `−√(1 − A²)`. */
  const X_VIEW = ['Negate', ['Sqrt', ['Subtract', 1, ['Power', 'A', 2]]]];

  const drain = (e: any): string[] => [...e.each()].map((x: any) => x.toString());

  test('two unknown-length views transpose to a lazy point VIEW', () => {
    const ce = viewEngine();
    const r = ce.box(['PointList', X_VIEW, 'A']).evaluate();
    expect(r.operator).toBe('Map');
    expect(r.isCollection).toBe(true);
    expect(r.isIndexedCollection).toBe(true);
    // The length is genuinely unknown until `n` binds — not zero, not one.
    expect(r.count).toBe(undefined);
    // The same shape `view · (1, 0)` produces, which is what the consumer
    // accepts: an indexed collection of points.
    expect(r.type.matches('indexed_collection<tuple<number, number>>')).toBe(
      true
    );
  });

  test('the STORED lazy view resolves once `n` binds, matching a fresh evaluation', () => {
    const ce = viewEngine();
    const stored = ce.box(['PointList', X_VIEW, 'A']).evaluate();
    ce.assign('n', 4);
    // `at`/`each`/`count` all see the now-known length.
    expect(stored.count).toBe(5);
    expect(stored.at(1)?.toString()).toBe('(-1, 0)');
    expect(stored.at(2)?.toString()).toBe('(-sqrt(15)/4, 1/4)');
    const fromStored = drain(stored);
    expect(fromStored).toHaveLength(5);
    // Re-evaluating the stored form, and evaluating the expression fresh in an
    // engine where `n` was bound BEFORE the transpose (the eager route), agree
    // element for element.
    expect(drain(stored.evaluate())).toEqual(fromStored);
    const eager = viewEngine();
    eager.assign('n', 4);
    const fresh = eager.box(['PointList', X_VIEW, 'A']).evaluate();
    expect(fresh.operator).toBe('List'); // eager at this size
    expect(drain(fresh)).toEqual(fromStored);
  });

  test('a SCALAR component is spliced whole into every point', () => {
    const ce = viewEngine();
    const r = ce.box(['PointList', -6, 'A']).evaluate();
    expect(r.operator).toBe('Map');
    expect(r.isCollection).toBe(true);
    expect(r.count).toBe(undefined);
    ce.assign('n', 4);
    expect(drain(r)).toEqual([
      '(-6, 0)',
      '(-6, 1/4)',
      '(-6, 1/2)',
      '(-6, 3/4)',
      '(-6, 1)',
    ]);
  });

  test('a KNOWN-FINITE component mixed with an unknown one zips to the shortest', () => {
    // Both collection components become `Map` sources — the variadic `Map`
    // zips to the shortest source, which is the ratified `PointList` pairing
    // contract (item 52), so the 5-element view pairs with only 3 points.
    const ce = viewEngine();
    const r = ce.box(['PointList', ['List', 1, 2, 3], 'A']).evaluate();
    expect(r.operator).toBe('Map');
    expect(r.isCollection).toBe(true);
    expect(r.count).toBe(undefined);
    ce.assign('n', 4);
    expect(r.count).toBe(3);
    expect(drain(r)).toEqual(['(1, 0)', '(2, 1/4)', '(3, 1/2)']);
  });

  test('a NON-INDEXED component (a Set) still fails closed', () => {
    // A Set has no positional order, so there is no i-th element to pair the
    // other components with: staying inert is better than a silently wrong
    // pairing or a degraded plain point.
    const ce = viewEngine();
    const r = ce.box(['PointList', ['Set', 1, 2, 3], 'A']).evaluate();
    expect(r.operator).toBe('PointList');
    expect(r.isCollection).toBe(false);
  });

  test('a provably INFINITE component still fails closed (compile-route parity)', () => {
    // An unknown length RESOLVES; an infinite one never does, and the compile
    // route declines a statically infinite source outright — so both routes
    // keep refusing to produce a value for this shape.
    const ce = viewEngine();
    for (const src of [
      ['Range', 1, 'PositiveInfinity'],
      ['Cycle', ['List', 1, 2]],
    ]) {
      const r = ce.box(['PointList', 1, src]).evaluate();
      expect(r.operator).toBe('PointList');
      expect(r.isCollection).toBe(false);
    }
  });

  test('PointX/PointY project the lazy view lazily, and correctly once bound', () => {
    const ce = viewEngine();
    const pl = ['PointList', X_VIEW, 'A'];
    const px = ce.box(['PointX', pl]).evaluate();
    const py = ce.box(['PointY', pl]).evaluate();
    for (const p of [px, py]) {
      expect(p.operator).toBe('Map');
      expect(p.isCollection).toBe(true);
      expect(p.count).toBe(undefined);
    }
    // The source-projection fast-path (`projectLazyPointList`) deliberately
    // declines here: it requires every source to have the SAME KNOWN count,
    // since projecting one source of a ragged zip would yield extra elements.
    // The generic lazy projection `Map(p ↦ At(p, k), ⟨view⟩)` is the answer.
    ce.assign('n', 4);
    expect(drain(py)).toEqual(['0', '1/4', '1/2', '3/4', '1']);
    expect(px.at(1)?.toString()).toBe('-1');
    expect(px.at(2)?.toString()).toBe('-sqrt(15)/4');
  });

  test('the transpose TYPE carries the point arity, unknown lengths and all', () => {
    const ce = viewEngine();
    // One coordinate per component, whatever the source lengths are. The
    // arity-less `list<tuple>` this used to answer could not tell a list of
    // 2-D points from a list of 3-D ones. (The first slot's tier follows the
    // view component's own scalar claim — `number` since the
    // 2026-08-22 shape-gate change that stopped branding possibly-collection
    // operands `number`.)
    expect(ce.box(['PointList', X_VIEW, 'A']).type.toString()).toBe(
      'list<tuple<number, number>>'
    );
    const finite = new ComputeEngine();
    finite.declare('L', 'list<integer>');
    expect(finite.box(['PointList', -6, 'L', 'L']).type.toString()).toBe(
      'list<tuple<integer, integer, integer>>'
    );
  });

  test('.N() floats the view elements, and x.N() agrees with x.evaluate().N()', () => {
    // The exactness contract has to survive the lazification: `lazyBroadcastMap`
    // wraps the mapping body in `N(…)` only when the transpose is BUILT under
    // `.N()`, and the `Map` re-wrap is what carries the request into a view
    // that was evaluated exactly first.
    const exact = ['(-1, 0)', '(-sqrt(15)/4, 1/4)'];
    const floated = (e: any): string[] => drain(e).slice(0, 2);
    const a = viewEngine();
    const direct = a.box(['PointList', X_VIEW, 'A']).N();
    a.assign('n', 4);
    const b = viewEngine();
    const composed = b.box(['PointList', X_VIEW, 'A']).evaluate().N();
    b.assign('n', 4);
    expect(direct.operator).toBe('Map');
    expect(floated(direct)).toHaveLength(2); // not a vacuous empty drain
    expect(floated(direct)).toEqual(floated(composed));
    expect(floated(direct)).not.toEqual(exact);
    expect((direct.at(2)?.op1 as any).isExact).toBe(false);
    const c = viewEngine();
    const exactly = c.box(['PointList', X_VIEW, 'A']).evaluate();
    c.assign('n', 4);
    expect(drain(exactly).slice(0, 2)).toEqual(exact);
  });

  test('route parity: the box route is the product route; `(a, b)` stays a Tuple', () => {
    // `PointList` is an IMPORTER-emitted head: default parsing never produces
    // it from `(a, b)` — that stays inert `Tuple` data — so the box route is
    // the one the consumer actually uses. The explicit `\operatorname` spelling
    // reaches the same transpose, which is what makes this a route-parity
    // probe rather than a second implementation.
    const ce = viewEngine();
    expect(ce.parse('(A, A)').evaluate().operator).toBe('Tuple');
    const parsed = ce.parse('\\operatorname{PointList}(A, A)').evaluate();
    expect(parsed.operator).toBe('Map');
    expect(parsed.isCollection).toBe(true);
    ce.assign('n', 4);
    expect(drain(parsed)).toEqual(
      drain(ce.box(['PointList', 'A', 'A']).evaluate())
    );
  });
});
