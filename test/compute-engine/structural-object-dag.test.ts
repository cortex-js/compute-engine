/**
 * The structural form of a DAG-shared tree that CONTAINS a mutable object.
 *
 * `get structural` rebuilds by recursing into every operand's `structural`,
 * so a tree whose operands are shared is rebuilt once per PATH unless each
 * node's answer is memoized — exponential time and allocation (Tycho item
 * 225). The per-node memo that removes that cost commits through
 * `cachedValue`, whose commit rule refuses any payload that transitively
 * holds a mutable object: an entry holding an object reference would keep it
 * alive (ruling B12) and could hand back contents the entry's version stamps
 * never validated (rulings B22/B3). So an object anywhere in the tree turns
 * every node's persistent memo off and the exponential shape comes back.
 *
 * The fallback pinned here is a TRANSIENT map owned by the outermost
 * `structural` read and dropped before it returns: it retains nothing and
 * validates nothing, so both rulings hold, while one read still costs one
 * rebuild per DISTINCT node. The sibling suite `dag-shared-walks.test.ts`
 * pins the object-free path, where the persistent memo serves.
 *
 * The fixture is the same balanced tower `Max(e, e)` that suite uses — `Max`
 * because its type stays the flat `number` where a tuple tower's type nests
 * once per level — over a leaf `(o, y)` holding the object.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression, ObjectInterface } from '../../src/compute-engine';
import {
  isFunction,
  isObject,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { structuralComputeCount } from '../../src/compute-engine/boxed-expression/boxed-function';

const ce = new ComputeEngine();
ce.declareType('Probe', 'object{n: integer}');

function probe(n: number): Expression & ObjectInterface {
  const o = ce._object('Probe', { n: ce.number(n) });
  if (!isObject(o)) throw new Error('expected an object');
  return o;
}

/** A balanced tower `Max(e, e)` of the given depth over `leaf`: `depth + 1`
 * distinct nodes, `2 ** depth` unfolded. */
function sharedTower(depth: number, leaf: Expression): Expression {
  let e = leaf;
  for (let i = 0; i < depth; i++) e = ce.function('Max', [e, e]);
  return e;
}

/** A tower over a leaf that holds a mutable object. */
function objectTower(depth: number, o: Expression): Expression {
  return sharedTower(depth, ce.function('Tuple', [o, ce.symbol('y')]));
}

/** Both operands of every `Max` level are ONE node, all the way down. */
function assertShared(e: Expression, depth: number): void {
  let cur = e;
  let d = 0;
  while (isFunction(cur, 'Max')) {
    expect(cur.ops[0]).toBe(cur.ops[1]);
    cur = cur.ops[0];
    d++;
  }
  expect(d).toBe(depth);
}

describe('the structural form of an object-holding shared tree', () => {
  test('is the correct form, and preserves the sharing', () => {
    const o = probe(1);
    const e = objectTower(3, o);
    assertShared(e, 3);

    const s = e.structural;
    expect(s.isStructural).toBe(true);
    expect(s.operator).toBe('Max');
    // The rebuild reproduces the tree, object included.
    expect(s.toString()).toBe(
      'max(max(max((Probe(n: 1), y), (Probe(n: 1), y)), max((Probe(n: 1), y), (Probe(n: 1), y))), max(max((Probe(n: 1), y), (Probe(n: 1), y)), max((Probe(n: 1), y), (Probe(n: 1), y))))'
    );
    // The two mentions of a shared operand resolve to the SAME rebuilt node,
    // and the object itself is carried by reference rather than copied.
    assertShared(s, 3);
    let leaf: Expression = s;
    while (isFunction(leaf, 'Max')) leaf = leaf.ops[0];
    expect(isFunction(leaf, 'Tuple')).toBe(true);
    expect((leaf as Expression).op1).toBe(o);
  });

  test('costs one rebuild per distinct node, not one per path', () => {
    // Unmemoized, a depth-`d` tower costs `2 ** d` rebuilds — at depth 30 the
    // read does not finish at all. The law pinned here is exact: `d` `Max`
    // nodes plus the one `Tuple` leaf (the object is a leaf whose structural
    // form is itself, and costs no rebuild).
    const o = probe(1);
    for (const depth of [4, 8, 16, 30]) {
      const e = objectTower(depth, o);
      const before = structuralComputeCount();
      const s = e.structural;
      expect(structuralComputeCount() - before).toBe(depth + 1);
      assertShared(s, depth);
    }
  });

  test('a second read works, and retains nothing from the first', () => {
    // The transient map dies with the top-level read (ruling B12: a cache
    // must not keep an object alive), and the persistent memo refused the
    // payload — so the second read is a fresh rebuild of every node, and the
    // node it returns is a NEW one.
    const o = probe(1);
    const e = objectTower(6, o);

    const first = e.structural;
    const before = structuralComputeCount();
    const second = e.structural;
    expect(structuralComputeCount() - before).toBe(7);
    expect(second).not.toBe(first);
    expect(second.toString()).toBe(first.toString());

    // And the fresh read reflects a store made in between, which a wrongly
    // retained cache would mask.
    o._store('n', ce.number(7));
    const third = e.structural;
    expect(third).not.toBe(second);
    expect(third.toString()).toContain('Probe(n: 7)');
    expect(third.toString()).not.toContain('Probe(n: 1)');
  });

  test('an object-free tree still commits to the persistent memo', () => {
    // The transient path is a FALLBACK: where the commit rule has no
    // objection, the per-node memo still serves, so a repeated read costs
    // nothing and returns the identical object. (Objects exist in this
    // session by now, so the commit-time containment scan is armed —
    // `dag-shared-walks.test.ts` pins that scan's own cost.)
    const e = sharedTower(30, ce.box(['Add', 'x', 'y']));
    const before = structuralComputeCount();
    const s = e.structural;
    expect(structuralComputeCount() - before).toBe(31);
    const between = structuralComputeCount();
    expect(e.structural).toBe(s);
    expect(structuralComputeCount()).toBe(between);
    assertShared(s, 30);
  });
});
