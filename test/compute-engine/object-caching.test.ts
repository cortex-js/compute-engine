/**
 * The **per-object version dependency channel** and the B3 cache-exclusion
 * inventory — `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B ("A store writes the
 * evaluated value", "Every construction makes a new object" (ruling B3),
 * "Changing a field is an effect", "Lifetime" (ruling B12)) and
 * `docs/plans/2026-08-14-object-representation-decision.md`
 * ("Per-entry object-version dependencies", "Exclusion list").
 *
 * This file is B3's acceptance matrix in miniature. Its shape, per cache
 * family: evaluate something derived from a field (filling the cache), store a
 * new field value, re-evaluate, and assert the NEW value is served. The reason
 * that is not trivially true is pinned by `no engine axis moves on a store`
 * below: a field store advances none of the engine's four invalidation axes,
 * so every one of these caches would happily serve the stale value if the
 * object channel were not doing the work.
 *
 * The field READ itself (`p.age` → `BoxedObject._field`) is exercised here as
 * the channel's first consumer; the object VALUE's own contract lives in
 * `object-core.test.ts` and the declaration/constructor in
 * `object-declaration.test.ts`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression, ObjectInterface } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isObject } from '../../src/compute-engine/boxed-expression/type-guards';
import {
  cachedValue,
  cachedValueAsync,
} from '../../src/compute-engine/boxed-expression/cache';
import {
  snapshotMemoDeps,
  validElementMemo,
} from '../../src/compute-engine/boxed-expression/collection-element-memo';
import { containsObject } from '../../src/compute-engine/boxed-expression/object-walk';
import {
  accumulateObjectDeps,
  beginObjectDeps,
  endObjectDeps,
  mergeObjectDeps,
  objectDepCollectorDepth,
  objectDepsValid,
  recordObjectRead,
  type ObjectDeps,
} from '../../src/compute-engine/boxed-expression/object-deps';

let ce: ComputeEngine;

/** An object with its narrowing interface in hand: `_store`/`_field`/
 * `_version` are the mutable core these tests drive directly (the property
 * STORE syntax is a later work package). */
function obj(
  typeName: string,
  slots: Record<string, Expression>
): Expression & ObjectInterface {
  const o = ce._object(typeName, slots);
  if (!isObject(o)) throw new Error('expected an object');
  return o;
}

/** `p.age`, boxed. Built through `ce.box` rather than by parsing so the test
 * holds the object reference directly. */
function fieldOf(o: Expression, name: string): Expression {
  return ce.box(['Field', o, { str: name }]);
}

/** A `Person` with a mutable `age`. */
function person(age = 42): Expression & ObjectInterface {
  return obj('Person', { name: ce.string('Alan'), age: ce.number(age) });
}

beforeEach(() => {
  ce = new ComputeEngine();
  ce.declareType('Person', 'object{name: string, age: integer}');
  ce.declareType('Node', 'object{label: string, next: any}');
});

afterEach(() => {
  // A leaked collector would silently over-attribute every later
  // computation's reads to a dead entry — assert the stack unwound.
  expect(objectDepCollectorDepth()).toBe(0);
});

describe('FIELD READ — a pure load of the stored value', () => {
  test('reads a stored field on the box route', () => {
    const p = person();
    expect(fieldOf(p, 'age').evaluate().toString()).toBe('42');
    expect(fieldOf(p, 'name').evaluate().toString()).toBe('"Alan"');
  });

  test('reads a stored field on the parse (Epsil) route', () => {
    const { value, diagnostics } = executeEpsil(
      ce,
      `let p = Person(name: "Alan", age: 42)
       p.age`
    );
    expect(diagnostics).toEqual([]);
    expect(value?.toString()).toBe('42');
  });

  test('the static type of a field read is the declared field type', () => {
    const p = person();
    expect(fieldOf(p, 'age').type.toString()).toBe('integer');
    expect(fieldOf(p, 'name').type.toString()).toBe('string');
  });

  test('reads the CURRENT value, never a snapshot', () => {
    const p = person();
    const read = fieldOf(p, 'age');
    expect(read.evaluate().toString()).toBe('42');
    p._store('age', ce.number(43));
    expect(read.evaluate().toString()).toBe('43');
  });

  test('a field the layout does not declare is an error naming the available fields', () => {
    const p = person();
    const err = fieldOf(p, 'shoeSize').evaluate();
    const json = JSON.stringify(err.json);
    expect(json).toContain('unknown-field');
    expect(json).toContain('shoeSize');
    // The message names what IS there.
    expect(json).toContain('name, age');
  });

  test('a field read runs no user code: it carries no effect label', () => {
    const p = person();
    const read = fieldOf(p, 'age');
    expect(read.effects).toBeUndefined();
    expect(read.isPure).toBe(true);
  });

  test('a reference-valued field reads back the same instance', () => {
    const friend = person(7);
    const n = obj('Node', { label: ce.string('a'), next: friend });
    expect(fieldOf(n, 'next').evaluate()).toBe(friend);
  });
});

describe('THE PREMISE — a store moves no engine invalidation axis', () => {
  // A store DOES report an `object-store` state event (every state write in
  // the engine goes through that one choke point), and the event's row in
  // `axisMaskOf` advances nothing — ruled 2026-08-15, and pinned row-by-row
  // in `state-events.test.ts`. This is what everything below depends on: if
  // the row ever widened, every test in this file would still pass while
  // proving nothing, because the coarse bump would be doing the invalidating.
  test('no engine axis moves on a store', () => {
    const p = person();
    const e = ce as unknown as {
      _anyVersion: number;
      _semanticVersion: number;
      _worldVersion: number;
      _callableVersion: number;
    };
    const before = [
      e._anyVersion,
      e._semanticVersion,
      e._worldVersion,
      e._callableVersion,
    ];
    p._store('age', ce.number(99));
    expect([
      e._anyVersion,
      e._semanticVersion,
      e._worldVersion,
      e._callableVersion,
    ]).toEqual(before);
    // …and the per-object counter is what did move.
    expect(p._version).toBe(1);
  });
});

describe('THE COLLECTOR PROTOCOL', () => {
  test('a read with no collector open records nothing and costs nothing', () => {
    const p = person();
    expect(objectDepCollectorDepth()).toBe(0);
    expect(fieldOf(p, 'age').evaluate().toString()).toBe('42');
  });

  test('a read reports to EVERY collector on the stack, not just the innermost', () => {
    const p = person();
    beginObjectDeps(); // outer
    beginObjectDeps(); // inner
    p._field('age');
    const inner = endObjectDeps();
    const outer = endObjectDeps();
    expect(inner).toHaveLength(1);
    expect(outer).toHaveLength(1);
    expect(inner![0][0].deref()).toBe(p);
    expect(outer![0][0].deref()).toBe(p);
  });

  test('duplicate reads of one object coalesce to the LOWEST version seen', () => {
    const p = person();
    beginObjectDeps();
    p._field('age'); // version 0
    p._store('age', ce.number(1)); // -> version 1
    p._field('age'); // version 1
    const deps = endObjectDeps()!;
    expect(deps).toHaveLength(1);
    expect(deps[0][1]).toBe(0);
    // …and that lowest version is what invalidates: the entry is already
    // stale, because the store happened after the first read.
    expect(objectDepsValid(deps)).toBe(false);
  });

  test('a computation that reads nothing yields `undefined`, not an empty array', () => {
    beginObjectDeps();
    expect(endObjectDeps()).toBeUndefined();
  });

  test('validation requires both a live reference and a matching version', () => {
    const p = person();
    beginObjectDeps();
    p._field('age');
    const deps = endObjectDeps()!;
    expect(objectDepsValid(deps)).toBe(true);
    p._store('age', ce.number(43));
    expect(objectDepsValid(deps)).toBe(false);
  });

  test('an identity-only no-op store does not invalidate', () => {
    const p = person();
    const same = p._field('age')!;
    beginObjectDeps();
    p._field('age');
    const deps = endObjectDeps()!;
    p._store('age', same);
    expect(p._version).toBe(0);
    expect(objectDepsValid(deps)).toBe(true);
  });

  test('a dead WeakRef invalidates conservatively', () => {
    // The environment gives no reliable way to force collection of a
    // specific object inside a test, so the dead-reference BRANCH is driven
    // directly with a reference that answers `undefined` from `deref()` —
    // exactly what a collected object's `WeakRef` answers.
    const dead = {
      deref: () => undefined,
    } as unknown as WeakRef<ObjectInterface>;
    expect(objectDepsValid([[dead, 0]])).toBe(false);
    // …and it keeps invalidating when merged outward, rather than being
    // silently dropped for having nothing to compare against.
    beginObjectDeps();
    mergeObjectDeps([[dead, 0]]);
    const inherited = endObjectDeps()!;
    expect(objectDepsValid(inherited)).toBe(false);
  });

  test('a hit MERGES its dependencies into every enclosing collector', () => {
    const p = person();
    // Stand in for a cache entry validated and served inside two nested
    // computations: the hit itself reads nothing.
    beginObjectDeps();
    p._field('age');
    const entry = endObjectDeps()!;

    beginObjectDeps(); // outer computation
    beginObjectDeps(); // inner computation, which "hits"
    mergeObjectDeps(entry);
    const inner = endObjectDeps();
    const outer = endObjectDeps();
    expect(inner).toHaveLength(1);
    expect(outer).toHaveLength(1);
    expect(outer![0][0].deref()).toBe(p);
  });

  test('accumulation across pieces of one chopped-up computation coalesces', () => {
    const p = person();
    let acc: ObjectDeps | undefined;
    beginObjectDeps();
    p._field('age');
    acc = accumulateObjectDeps(acc, endObjectDeps());
    beginObjectDeps();
    p._field('name');
    acc = accumulateObjectDeps(acc, endObjectDeps());
    expect(acc).toHaveLength(1);
    expect(acc![0][1]).toBe(0);
  });

  test('the stack unwinds even when the computation throws', () => {
    const depth = objectDepCollectorDepth();
    expect(() => {
      beginObjectDeps();
      try {
        throw new Error('boom');
      } finally {
        endObjectDeps();
      }
    }).toThrow('boom');
    expect(objectDepCollectorDepth()).toBe(depth);
  });

  test('recordObjectRead is a no-op with an empty stack', () => {
    const p = person();
    recordObjectRead(p, p._version);
    expect(objectDepCollectorDepth()).toBe(0);
  });
});

describe('CACHE FAMILY — the lazy-collection evaluate memo', () => {
  /** `Append(1..n, p.age)` — a lazy collection VIEW whose evaluated value is
   * derived from a field. `Append`'s definition is not itself `lazy`, which
   * is what makes the instance memoizable in `BoxedFunction._value`; the
   * def-lazy views (`Map`, `Filter`, …) are excluded from that memo by
   * `_isMemoizableLazyCollection` and so cannot exercise it. */
  function appendField(p: Expression, n = 3): Expression {
    return ce.box(['Append', ['Range', 1, n], ['Field', p, { str: 'age' }]]);
  }

  test('the memo really is populated, and it records object dependencies', () => {
    const p = person();
    const xs = appendField(p);
    xs.evaluate();
    const slot = (
      xs as unknown as { _value: { value: unknown; objectDeps?: ObjectDeps } }
    )._value;
    expect(slot.value).not.toBeNull();
    expect(slot.objectDeps).toHaveLength(1);
    expect(slot.objectDeps![0][0].deref()).toBe(p);
  });

  test('a store invalidates a memoized field-derived collection', () => {
    const p = person();
    const xs = appendField(p);
    expect(xs.evaluate().toString()).toBe('[1,2,3,42]');
    p._store('age', ce.number(100));
    expect(xs.evaluate().toString()).toBe('[1,2,3,100]');
  });

  test('a store to an UNRELATED object does not invalidate', () => {
    const p = person();
    const other = person(1);
    const xs = appendField(p);
    expect(xs.evaluate().toString()).toBe('[1,2,3,42]');
    const slot = (xs as unknown as { _value: { value: unknown } })._value;
    const served = slot.value;
    other._store('age', ce.number(2));
    expect(xs.evaluate().toString()).toBe('[1,2,3,42]');
    // The same entry was served, not a recompute that happened to agree.
    expect((xs as unknown as { _value: { value: unknown } })._value.value).toBe(
      served
    );
  });

  test('NESTED: an outer entry that HIT an inner one is invalidated too', () => {
    // The outer node is built and evaluated only AFTER the inner one is
    // memoized, so the outer computation consumes a HIT. This is the
    // integration form of the composition rule; the sharp form — an outer
    // entry whose ONLY dependency source is the merge, with no possibility of
    // an incidental direct read — is the `cachedValue` nested test below,
    // which is the one that fails if `mergeObjectDeps` stops working.
    const p = person();
    const inner = appendField(p);
    expect(inner.evaluate().toString()).toBe('[1,2,3,42]');

    const outer = ce.box(['Append', inner, ce.number(999)]);
    expect(outer.evaluate().toString()).toBe('[1,2,3,42,999]');
    const outerSlot = (
      outer as unknown as { _value: { objectDeps?: ObjectDeps } }
    )._value;
    expect(outerSlot.objectDeps).toHaveLength(1);
    expect(outerSlot.objectDeps![0][0].deref()).toBe(p);

    p._store('age', ce.number(0));
    expect(inner.evaluate().toString()).toBe('[1,2,3,0]');
    expect(outer.evaluate().toString()).toBe('[1,2,3,0,999]');
  });

  test('a payload containing an object is refused rather than memoized', () => {
    const a = person(1);
    const b = person(2);
    // `Drop(List(a, b), 1)` is a memoizable lazy view whose evaluated value
    // HOLDS an object. Memoizing it would keep `b` alive for as long as this
    // node lives (ruling B12).
    const xs = ce.box(['Drop', ['List', a, b], ce.number(1)]);
    expect(xs.evaluate().at(1)).toBe(b);
    const slot = (xs as unknown as { _value: { value: unknown } })._value;
    expect(slot.value).toBeNull();
  });
});

describe('CACHE FAMILY — the collection element memo', () => {
  test('an instance that can reach an object is INELIGIBLE — the primary disposition', () => {
    // Work package 1A's eligibility arm, re-pinned here because it is this
    // family's primary answer: the dependency walk refuses an instance that
    // reaches an object, whether the object sits in the tree…
    const p = person();
    const inTree = ce.box([
      'Map',
      ['Function', ['Add', '_', ['Field', p, { str: 'age' }]], '_'],
      ['Range', 1, 3],
    ]);
    expect(snapshotMemoDeps(inTree)).toBeUndefined();

    // …or is reached through a symbol's stored value, which the walk follows.
    ce.assign('q', p);
    const throughSymbol = ce.box([
      'Map',
      ['Function', ['Add', '_', ['Field', 'q', { str: 'age' }]], '_'],
      ['Range', 1, 3],
    ]);
    expect(snapshotMemoDeps(throughSymbol)).toBeUndefined();
    expect(validElementMemo(throughSymbol)).toBeUndefined();
  });

  test('elements are recomputed after a store, so no stale element is served', () => {
    const p = person();
    const xs = ce.box([
      'Map',
      ['Function', ['Add', '_', ['Field', p, { str: 'age' }]], '_'],
      ['Range', 1, 3],
    ]);
    expect(xs.at(1)?.toString()).toBe('43');
    p._store('age', ce.number(0));
    expect(xs.at(1)?.toString()).toBe('1');
  });

  test('an element that IS an object is never memoized', () => {
    const friend = person(7);
    const n = obj('Node', { label: ce.string('a'), next: friend });
    const xs = ce.box([
      'Map',
      ['Function', ['Field', n, { str: 'next' }], '_'],
      ['Range', 1, 2],
    ]);
    expect(xs.evaluate().at(1)).toBe(friend);
    expect(validElementMemo(xs)).toBeUndefined();
    const other = person(9);
    n._store('next', other);
    expect(xs.evaluate().at(1)).toBe(other);
  });
});

describe('CACHE FAMILY — the collection facet memo (count/isEmpty/isFinite)', () => {
  test('a field-derived facet is recomputed after a store', () => {
    const p = person();
    // `Take(1..∞, p.age)` — a collection whose LENGTH comes from a field.
    const xs = ce.box(['Take', ['Range', 1, 10], ['Field', p, { str: 'age' }]]);
    expect(xs.count).toBe(10);
    p._store('age', ce.number(3));
    expect(xs.count).toBe(3);
  });

  test('an instance that can reach an object is INELIGIBLE for the facet memo too', () => {
    // The facet memo shares the element memo's dependency machinery, so it
    // inherits the same primary exclusion.
    const p = person();
    const xs = ce.box(['Take', ['Range', 1, 10], ['Field', p, { str: 'age' }]]);
    expect(xs.count).toBe(10);
    expect(
      (xs as unknown as { _facetMemo: unknown })._facetMemo
    ).toBeUndefined();
  });
});

describe('CACHE FAMILY — cachedValue (_type, _sgn, _eagerSource)', () => {
  test('a THROWN computation commits neither value nor dependencies', () => {
    const slot: { value: number | null; generation: number | undefined } = {
      value: 7,
      generation: 1,
    };
    expect(() =>
      cachedValue(
        slot,
        2,
        () => {
          throw new Error('nope');
        },
        undefined,
        ce
      )
    ).toThrow('nope');
    // The entry is exactly as it was: the failed attempt did not stamp
    // generation 2 onto generation 1's value.
    expect(slot.generation).toBe(1);
    expect(slot.value).toBe(7);
  });

  test('a payload containing an object is refused rather than stored', () => {
    const p = person();
    const slot: { value: Expression | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    const out = cachedValue(slot, 1, () => p as Expression, undefined, ce);
    expect(out).toBe(p);
    expect(slot.value).toBeNull();
    // …and nested one level down, inside a container.
    const wrapped = ce.function('List', [p]);
    const out2 = cachedValue(slot, 1, () => wrapped, undefined, ce);
    expect(out2).toBe(wrapped);
    expect(slot.value).toBeNull();
  });

  test('NESTED: an outer entry whose only read was an inner HIT still invalidates', () => {
    // The sharp form of the hit-merge rule, with every source of dependency
    // under the test's control: the inner entry is filled FIRST, so when the
    // outer computation runs it hits and performs no field read at all. The
    // only way the outer entry can learn it depends on `p` is the merge.
    const p = person();
    const inner: { value: number | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    const outer: { value: number | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    let innerRuns = 0;
    let outerRuns = 0;
    const readInner = (): number => {
      innerRuns += 1;
      p._field('age');
      return innerRuns;
    };
    const computeOuter = (): number => {
      outerRuns += 1;
      return cachedValue(inner, 1, readInner, undefined, ce) * 10;
    };

    // 1. Fill the INNER entry on its own.
    expect(cachedValue(inner, 1, readInner, undefined, ce)).toBe(1);
    // 2. Now run the outer one: its inner call is a pure hit.
    expect(cachedValue(outer, 1, computeOuter, undefined, ce)).toBe(10);
    expect(innerRuns).toBe(1);
    expect(outerRuns).toBe(1);
    // 3. A repeat is served from the outer entry.
    expect(cachedValue(outer, 1, computeOuter, undefined, ce)).toBe(10);
    expect(outerRuns).toBe(1);
    // 4. A store to the object only the INNER computation ever read must
    //    invalidate the OUTER entry too.
    p._store('age', ce.number(43));
    expect(cachedValue(outer, 1, computeOuter, undefined, ce)).toBe(20);
    expect(outerRuns).toBe(2);
    expect(innerRuns).toBe(2);
  });

  test('a RE-ENTRANT read is answered PROVISIONALLY and freezes nothing', () => {
    // The key IS stamped for the duration of the computation, on purpose: a
    // re-entrant read is answered from the entry's previous value rather than
    // recursing. What must not happen — and used to — is that the computation
    // consuming that answer goes on to commit, freezing a previous
    // generation's value under the new key.
    const p = person();
    const slot: { value: number | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    let runs = 0;
    const readAge = (): number => {
      runs += 1;
      p._field('age');
      return runs;
    };

    expect(cachedValue(slot, 1, readAge, undefined, ce)).toBe(1);

    // A new generation, with nothing about `p` changed: the entry is stale by
    // KEY only, which is what makes it servable to a re-entrant read.
    let seen: number | undefined;
    const outerPass = (): number => {
      seen = cachedValue(slot, 2, readAge, undefined, ce); // re-entrant read of this very slot
      return readAge();
    };
    expect(cachedValue(slot, 2, outerPass, undefined, ce)).toBe(2);
    expect(seen).toBe(1); // the previous value, served provisionally

    // …and nothing was frozen: the entry is back at its own key, holding its
    // own value. It is kept rather than emptied because it is what the NEXT
    // re-entrant read has to be answered with.
    expect(slot.value).toBe(1);
    expect(slot.generation).toBe(1);

    // The dependency channel still governs that surviving entry: a store to
    // the object it read invalidates it.
    p._store('age', ce.number(43));
    expect(cachedValue(slot, 1, readAge, undefined, ce)).toBe(3);
  });

  test('a computation that consumed a provisional answer commits nothing — not even an OUTER one', () => {
    // The dependency hole in its sharpest form. The outer computation reads no
    // field itself, and the inner one reads none on its outermost pass either
    // — it delegates to a re-entrant read of its own slot. Every dependency
    // the outer entry could possibly learn about would have to travel through
    // that read, and a provisional answer performs no reads, so committing the
    // outer entry would freeze a dependency-free 0 forever.
    const p = person();
    const inner: { value: number | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    const outer: { value: number | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    const ageOf = (): number => p._field('age')?.re ?? NaN;

    // Prime `inner` at an OLDER generation, so a re-entrant read of it has a
    // previous value to be answered with.
    expect(cachedValue(inner, 1, () => 0)).toBe(0);

    let pass = 0;
    const computeInner = (): number => {
      pass += 1;
      if (pass === 1) return cachedValue(inner, 2, computeInner, undefined, ce);
      return ageOf();
    };
    const computeOuter = (): number =>
      cachedValue(inner, 2, computeInner, undefined, ce);

    expect(cachedValue(outer, 2, computeOuter, undefined, ce)).toBe(0); // provisional
    expect(outer.value).toBeNull(); // …and not frozen
    // Nor did the entry that was re-entered move: still the primed value, at
    // its own key, so the new key it was asked for was never stamped over it.
    expect(inner.value).toBe(0);
    expect(inner.generation).toBe(1);

    // The proof that the dependency-free 0 never became an entry: a store the
    // outer computation could not have recorded still changes what it returns.
    p._store('age', ce.number(43));
    expect(cachedValue(outer, 2, computeOuter, undefined, ce)).toBe(43);
  });

  test('a hit is refused once a recorded object version has moved', () => {
    const p = person();
    const slot: { value: number | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    let computes = 0;
    const read = (): number => {
      computes += 1;
      p._field('age');
      return computes;
    };
    expect(cachedValue(slot, 1, read, undefined, ce)).toBe(1);
    expect(cachedValue(slot, 1, read, undefined, ce)).toBe(1); // hit
    p._store('age', ce.number(43));
    expect(cachedValue(slot, 1, read, undefined, ce)).toBe(2); // invalidated by the store
  });
});

describe('CACHE FAMILY — cachedValueAsync (no dependencies, but the other two rules)', () => {
  // This helper records no object-version dependencies — an `await` breaks the
  // collector's dynamic extent, and it has no callers — but the payload rule
  // and the commit-on-settle rule do not depend on the collector and apply in
  // full.
  test('a REJECTED promise commits nothing', async () => {
    const slot: { value: number | null; generation: number | undefined } = {
      value: 7,
      generation: 1,
    };
    await expect(
      cachedValueAsync(slot, 2, async () => {
        throw new Error('nope');
      })
    ).rejects.toThrow('nope');
    expect(slot.generation).toBe(1);
    expect(slot.value).toBe(7);
  });

  test('a payload containing an object is refused rather than stored', async () => {
    const p = person();
    const slot: { value: Expression | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    const out = await cachedValueAsync(slot, 1, async () => p as Expression);
    expect(out).toBe(p);
    expect(slot.value).toBeNull();
    // …and nested one level down, inside a container.
    const wrapped = ce.function('List', [p]);
    const out2 = await cachedValueAsync(slot, 1, async () => wrapped);
    expect(out2).toBe(wrapped);
    expect(slot.value).toBeNull();
  });

  test('a fulfilled non-object payload is memoized', async () => {
    const slot: { value: number | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    let runs = 0;
    const fn = async (): Promise<number> => {
      runs += 1;
      return runs;
    };
    expect(await cachedValueAsync(slot, 1, fn)).toBe(1);
    expect(await cachedValueAsync(slot, 1, fn)).toBe(1);
    expect(runs).toBe(1);
  });
});

describe('RULING — isConstant is TRUE, and the granularity that follows', () => {
  test('an object value is constant: it denotes a fixed reference', () => {
    const p = person();
    expect(p.isConstant).toBe(true);
    p._store('age', ce.number(1));
    expect(p.isConstant).toBe(true);
  });

  test('a REFERENCE-valued result depends on the HOLDER only, and survives a store to the referent', () => {
    // Per-object granularity: a cached `n.next` depends only on `n`'s
    // counter, because the result is a reference and stays the right
    // reference whatever the friend's own fields do.
    const friend = person(7);
    const n = obj('Node', { label: ce.string('a'), next: friend });

    beginObjectDeps();
    expect(n._field('next')).toBe(friend);
    const deps = endObjectDeps()!;
    expect(deps).toHaveLength(1);
    expect(deps[0][0].deref()).toBe(n);

    friend._store('age', ce.number(8));
    expect(objectDepsValid(deps)).toBe(true);
    // …while a store to the HOLDER, which can change which reference this is,
    // does invalidate it.
    n._store('next', person(9));
    expect(objectDepsValid(deps)).toBe(false);
  });

  test('a CONTENTS-derived result depends on BOTH objects read through', () => {
    const friend = person(7);
    const n = obj('Node', { label: ce.string('a'), next: friend });

    beginObjectDeps();
    const held = n._field('next') as Expression & ObjectInterface;
    held._field('age');
    const deps = endObjectDeps()!;
    expect(deps).toHaveLength(2);

    friend._store('age', ce.number(0));
    expect(objectDepsValid(deps)).toBe(false);
  });

  test('end to end: a memoized value derived through two objects is invalidated by the inner store', () => {
    const friend = person(7);
    const n = obj('Node', { label: ce.string('a'), next: friend });
    const xs = ce.box([
      'Append',
      ['Range', 1, 3],
      ['Field', ['Field', n, { str: 'next' }], { str: 'age' }],
    ]);
    expect(xs.evaluate().toString()).toBe('[1,2,3,7]');
    const slot = (
      xs as unknown as { _value: { value: unknown; objectDeps?: ObjectDeps } }
    )._value;
    expect(slot.value).not.toBeNull();
    expect(slot.objectDeps).toHaveLength(2);
    friend._store('age', ce.number(0));
    expect(xs.evaluate().toString()).toBe('[1,2,3,0]');
  });

  test('the constructor APPLICATION is impure and is never folded', () => {
    // The other half of the ruling: `isConstant: true` is safe precisely
    // because construction is separately prevented from being folded.
    const call = ce.box([
      'Person',
      ['NamedArgument', { str: 'name' }, { str: 'Alan' }],
      ['NamedArgument', { str: 'age' }, 42],
    ]);
    expect(call.isPure).toBe(false);
    expect(call.evaluate()).not.toBe(call.evaluate());
  });
});

describe('RULING B12 — no engine-global cache retains an object', () => {
  test('EngineCacheStore holds no object', () => {
    // The one engine-global STRONG value retainer. Nothing routed through it
    // is built from a user value, so the assertion is adversarial rather
    // than a guard: it walks whatever is actually in the store.
    const p = person();
    // Force the named caches that exist to be built.
    ce.box(['Add', 'x', 'x']).simplify();
    ce.box(['Sin', ['Divide', 'Pi', 4]]).evaluate();
    void p;

    const store = (ce as unknown as { _cacheStore: { _entries: object } })
      ._cacheStore;
    const entries = (store as unknown as { _entries: Record<string, unknown> })
      ._entries;
    const seen = new Set<unknown>();
    const walk = (x: unknown): boolean => {
      if (x === null || x === undefined) return false;
      if (typeof x !== 'object') return false;
      if (seen.has(x)) return false;
      seen.add(x);
      if (containsObject(x as Expression)) return true;
      if (Array.isArray(x)) return x.some(walk);
      if (x instanceof Map) return [...x.values()].some(walk);
      return Object.values(x as Record<string, unknown>).some(walk);
    };
    expect(walk(entries)).toBe(false);
  });
});
