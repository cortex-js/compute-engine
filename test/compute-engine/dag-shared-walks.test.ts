/**
 * Walks over an expression that SHARES its operands must be linear in the
 * number of distinct nodes, not in the size of the unfolded tree.
 *
 * A user function applied to its own previous result embeds that result once
 * per mention of the parameter, so four levels of a Desmos heightmap chain
 * (`detail(smooth(upSample(…)))`, evaluated while the sliders are valueless)
 * hold ~16 000 distinct nodes that unfold to over a million, and every walk
 * that descends each operand independently — the `Add` ordering key, the
 * free-variable scan, the binder rewrite — ran for minutes on one value
 * (Tycho's 687-state sweep stalled at that document, 2026-08-22).
 *
 * The fixture is a balanced tower `Max(e, e)` of depth 30: 31 distinct
 * nodes, 2^30 unfolded. A walk that unfolds it does not finish; a walk that
 * memoizes per node is instant. The sharing is asserted, so the fixture
 * cannot silently degrade into a tree that any walk handles. `Max` rather
 * than `Tuple`: its TYPE stays the flat `number`, where a tuple tower's type
 * nests once per level and the type-object walks (`hasFreeVariables`,
 * `couldBeNumericElement`) unfold that separately — a different walk, tracked
 * in `ROADMAP.md` ("Type-object walks unfold a shared nested tuple type").
 */
import { ComputeEngine } from '../../src/compute-engine';
import {
  lex,
  revlex,
} from '../../src/compute-engine/boxed-expression/polynomial-degree';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { effectsComputeCount } from '../../src/compute-engine/boxed-expression/boxed-function';

const ce = new ComputeEngine();

function sharedTower(depth: number) {
  let e = ce.box(['Add', 'x', 'y']);
  for (let i = 0; i < depth; i++) e = ce.function('Max', [e, e]);
  return e;
}

function assertShared(e: ReturnType<typeof sharedTower>) {
  let cur = e;
  let depth = 0;
  while (isFunction(cur) && cur.operator === 'Max') {
    expect(cur.ops[0]).toBe(cur.ops[1]);
    cur = cur.ops[0];
    depth++;
  }
  expect(depth).toBe(30);
}

describe('walks over a shared tower are linear in distinct nodes', () => {
  test('free variables and symbols', () => {
    const e = sharedTower(30);
    assertShared(e);
    expect(e.unknowns).toEqual(['x', 'y']);
    expect(e.freeVariables).toEqual(['x', 'y']);
    expect(e.symbols).toEqual(['x', 'y']);
  });

  test('the Add ordering key is bounded and ordering a sum terminates', () => {
    const e = sharedTower(30);
    assertShared(e);
    expect(revlex(e).length).toBeLessThanOrEqual(1024);
    // Ordering the terms of a sum keys each term: the tower must be keyed
    // once, not unfolded.
    const sum = ce.function('Add', [e, ce.symbol('z')]);
    expect(sum.operator).toBe('Add');
    expect(sum.nops).toBe(2);
  });

  test('a binder over the tower canonicalizes (the binder rewrite)', () => {
    // Declaring a `Sum` re-points occurrences of its index inside the body
    // (`rebindToBindings` → `rewriteWithBinders`), walking the whole body.
    const e = sharedTower(30);
    const sum = ce.box(['Sum', e, ['Limits', 'k', 1, 3]]);
    expect(sum.operator).toBe('Sum');
    assertShared(sum.op1 as ReturnType<typeof sharedTower>);
  });

  test('has() asks each node once', () => {
    const e = sharedTower(30);
    assertShared(e);
    // A miss must visit every node; a hit must still be found.
    expect(e.has('Nope')).toBe(false);
    expect(e.has('Add')).toBe(true);
    expect(e.has(['Nope', 'y'])).toBe(true);
  });

  test('the ordering tie-breaker (leaf count) is memoized', () => {
    // Two terms with the same operator, degree and ordering key fall through
    // to `order()`, which compares leaf counts — the count of the tower is
    // 2^31 − 1 leaves, and must come from one walk, not 2^30 of them.
    const e = sharedTower(30);
    const sum = ce.function('Add', [
      ce.function('Max', [e, 1]),
      ce.function('Max', [e, 2]),
    ]);
    expect(sum.operator).toBe('Add');
    expect(sum.nops).toBe(2);
  });

  test('the polynomial degree walks are memoized', () => {
    // `totalDegree`/`maxDegree` descend `Add`/`Multiply`/`Power`, and
    // `sortAddTerms` asks them of every term BEFORE the ordering key — so a
    // polynomial spine that shares its operands (`2e + 3e²`, nested) must be
    // walked once per node at each level's canonicalization.
    let p = ce.box(['Add', 'x', 'y']);
    for (let i = 0; i < 30; i++)
      p = ce.function('Add', [
        ce.function('Multiply', [2, p]),
        ce.function('Multiply', [3, ce.function('Power', [p, 2])]),
      ]);
    expect(p.operator).toBe('Add');
    // The spine really is shared: each level's two terms hold the SAME
    // previous level.
    let cur = p;
    let depth = 0;
    while (isFunction(cur, 'Add') && cur.nops === 2) {
      const [a, b] = cur.ops;
      if (!isFunction(a, 'Multiply') || !isFunction(b, 'Multiply')) break;
      const linear = isFunction(a.op2, 'Power') ? b : a;
      const square = linear === a ? b : a;
      expect(isFunction(square.op2, 'Power') && square.op2.op1).toBe(
        linear.op2
      );
      cur = linear.op2;
      depth++;
    }
    expect(depth).toBe(30);
  });

  test('applying a function literal whose body holds the tower', () => {
    // Application captures the literal's closures (`captureClosures`) and
    // substitutes its parameters (`rewriteWithBinders`), walking the body.
    const e = sharedTower(30);
    const r = ce.box(['Apply', ['Function', ['Hold', e], 't'], 1]).evaluate();
    expect(r.operator).toBe('Hold');
    assertShared(r.op1 as ReturnType<typeof sharedTower>);
  });

  test('the runtime effects projection over the tower is memoized, pure answer included', () => {
    // `effectsOf` memoizes per node on `_effectsOf` — but `undefined` is the
    // memo's ANSWER for a pure application (the empty effect set), and the
    // pre-fix `expr._effectsOf?.() ?? applicationEffects(expr)` fell through
    // on exactly that answer, recomputing every pure node's whole subtree on
    // every read: the tower unfolded exponentially (24 million recomputes in
    // one consumer document — Tycho item 225). The projection must finish,
    // and a repeated read must not recompute at all.
    const e = sharedTower(30);
    assertShared(e);
    expect(e.isPure).toBe(true);
    const before = effectsComputeCount();
    expect(e.isPure).toBe(true);
    expect(effectsComputeCount()).toBe(before);
  });

  test('the structural form of the tower is memoized and preserves sharing', () => {
    // `get structural` rebuilds through every operand's `structural`;
    // without a per-node memo a shared tree is rebuilt once per PATH —
    // exponential time AND allocation (the 4 GB heap abort of Tycho item
    // 225). With the memo, both mentions of a shared operand resolve to the
    // SAME rebuilt node, and a repeated read returns the identical object.
    const e = sharedTower(30);
    assertShared(e);
    const s = e.structural;
    expect(e.structural).toBe(s);
    // Sharing survives the rebuild: both operands of each level are one node.
    let cur = s;
    let depth = 0;
    while (isFunction(cur) && cur.operator === 'Max') {
      expect(cur.ops[0]).toBe(cur.ops[1]);
      cur = cur.ops[0];
      depth++;
    }
    expect(depth).toBe(30);
  });

  test('a lazy collection over the tower snapshots its dependencies once', () => {
    // `count`/`isFiniteCollection` of a `Map` are dependency-memoized facets:
    // the snapshot (`snapshotDeps`, `collectParameterDefs`) walks the
    // instance, including the source collection holding the tower.
    const e = sharedTower(30);
    const m = ce.box(['Map', ['Function', ['Add', 'k', 1], 'k'], ['List', e]]);
    expect(m.count).toBe(1);
    expect(m.isFiniteCollection).toBe(true);
  });
});

describe('the lexicographic ordering key', () => {
  test('is the symbol sequence when it fits', () => {
    expect(lex(ce.box(['Multiply', 'x', ['Power', 'y', 2]]))).toBe('x y');
    expect(revlex(ce.box(['Multiply', 'x', ['Power', 'y', 2]]))).toBe('y x');
    // Numbers contribute nothing; constants are ignored.
    expect(lex(ce.box(['Add', 'a', 2, 'Pi', 'b']))).toBe('a b');
  });

  test('is a function of the unbounded key alone', () => {
    // `Mod(F, 2)` and `F` have the same unbounded key (a number contributes
    // nothing, and the trailing space it leaves is trimmed), so they must tie
    // whether or not `F`'s key had to be cut. An assembly that cut the key
    // one operand at a time lost a leading character on one side and ordered
    // `Floor(X) + Mod(Floor(X), 2)` differently from the unbounded key.
    const big = sharedTower(30);
    expect(lex(big).length).toBeLessThanOrEqual(1024);
    const floor = ce.function('Floor', [big]);
    const mod = ce.function('Mod', [floor, 2]);
    expect(lex(mod)).toBe(lex(floor));
    expect(revlex(mod)).toBe(revlex(floor));
    // And an operand with an empty key in the MIDDLE keeps its double space,
    // exactly as the unbounded join does.
    expect(lex(ce.function('Tuple', [ce.symbol('p'), 1, ce.symbol('q')]))).toBe(
      'p  q'
    );
  });

  test('keeps the trailing 1024 characters of a key that does not fit', () => {
    // 400 four-character names joined by spaces: 1999 characters.
    const names = Array.from(
      { length: 400 },
      (_, i) => `v${String(i).padStart(3, '0')}`
    );
    const full = names.join(' ');
    const e = ce.function(
      'Tuple',
      names.map((n) => ce.symbol(n))
    );
    const key = lex(e);
    expect(key.length).toBeLessThanOrEqual(1024);
    expect(full.endsWith(key)).toBe(true);
    // `revlex` reads the key last symbol first, so the bounded key starts
    // exactly where the unbounded one would.
    expect(revlex(e).startsWith(names.slice(-100).reverse().join(' '))).toBe(
      true
    );
  });
});

describe('shared-tree walks after a mutable object exists', () => {
  // LAST in this file on purpose: constructing one object flips the
  // process-wide, one-way `anyObjectExists` flag (`object-deps.ts`), which
  // arms the cache commit points' payload-containment scan. Everything
  // above this line exercises the no-object fast path; this block pins the
  // armed path. (Jest gives each test file its own module registry, so the
  // flag starts false for every file.)
  test('the structural memo stays linear once the containment scan is armed', () => {
    // The commit-time scan (`containsObject`, `object-walk.ts`) must visit
    // one node per DISTINCT node, not per path: unmemoized, each of the 31
    // per-node commits of the tower would walk its unfolded subtree —
    // exponential, the very cost the structural memo removes. This read
    // completing at all is the pin.
    ce.declareType('DagProbe', { kind: 'record', elements: {} });
    const o = ce._object('DagProbe', {});
    expect(o).toBeDefined();

    const e = sharedTower(30);
    assertShared(e);
    const s = e.structural;
    expect(e.structural).toBe(s);
  });
});
