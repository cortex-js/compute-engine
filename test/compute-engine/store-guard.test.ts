import { ComputeEngine } from '../../src/compute-engine';
import {
  beginStoreGuard,
  failClosedCounts,
} from '../../src/compute-engine/boxed-expression/store-guard';
import { noteUncachedHostCall } from '../../src/compute-engine/boxed-expression/host-handler-changes';
import {
  incompleteWalkCount,
  noteIncompleteWalk,
  takeBackIncompleteWalks,
} from '../../src/compute-engine/boxed-expression/incomplete-walks';

// A cache of evaluated values begins a store guard before its computation
// and stores the value only when the guard allows it
// (`src/compute-engine/boxed-expression/store-guard.ts`).

describe('THE STORE GUARD', () => {
  test('allows a store when no count moved', () => {
    const guard = beginStoreGuard();
    expect(guard.allowsStore()).toBe(true);
    expect(guard.movedOnly()).toBe(true);
  });

  test('refuses a store after host code ran, unless the site accepts it', () => {
    const guard = beginStoreGuard();
    noteUncachedHostCall();
    expect(guard.allowsStore()).toBe(false);
    expect(guard.moved('host')).toBe(true);
    expect(guard.moved('cycle')).toBe(false);
    expect(guard.movedOnly('host')).toBe(true);
    expect(guard.movedOnly('cycle')).toBe(false);
  });

  test('a count that moved and came back allows the store', () => {
    // A nested evaluation whose result is a value takes back the incomplete
    // walks that it recorded (`takeBackIncompleteWalks()`).
    const mark = incompleteWalkCount();
    const guard = beginStoreGuard();
    noteIncompleteWalk();
    expect(guard.allowsStore()).toBe(false);
    takeBackIncompleteWalks(mark);
    expect(guard.allowsStore()).toBe(true);
  });

  test('each count is compared separately', () => {
    const guard = beginStoreGuard();
    failClosedCounts.cellProvisional += 1;
    failClosedCounts.cellProvisional -= 1;
    expect(guard.allowsStore()).toBe(true);
    failClosedCounts.lazyValueProvisional += 1;
    expect(guard.allowsStore()).toBe(false);
    expect(guard.movedOnly('lazyValueProvisional')).toBe(true);
  });
});

describe('STORE GUARD AT THE CACHES OF EVALUATED VALUES', () => {
  test('the dictionary memo does not keep a value that host code computed', () => {
    // `d` is a pure dictionary whose value calls a host operator that does
    // not state its purity. Each path to `d` evaluates it, as in
    // `Tuple(d, d)`.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('h', {
      signature: '(number) -> number',
      evaluate: ([x], { engine }) => {
        calls += 1;
        return engine.number(x.re + calls);
      },
    });
    const d = ce.box(['Dictionary', ['KeyValuePair', "'a'", ['h', 2]]]);
    const outer = ce.box([
      'Dictionary',
      ['KeyValuePair', "'p'", d],
      ['KeyValuePair', "'q'", d],
    ]);
    expect(outer.evaluate().toString()).toBe(
      '{"p" -> {"a" -> 3}, "q" -> {"a" -> 4}}'
    );
    expect(calls).toBe(2);
    calls = 0;
    expect(ce.box(['Tuple', d, d]).evaluate().toString()).toBe(
      '({"a" -> 3}, {"a" -> 4})'
    );
    expect(calls).toBe(2);
  });

  test('a pure dictionary used twice is still evaluated once', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('p', {
      signature: '(number) -> number',
      pure: true,
      evaluate: ([x], { engine }) => {
        calls += 1;
        return engine.number(x.re + 1);
      },
    });
    const d = ce.box(['Dictionary', ['KeyValuePair', "'a'", ['p', 2]]]);
    ce.box([
      'Dictionary',
      ['KeyValuePair', "'p'", d],
      ['KeyValuePair', "'q'", d],
    ]).evaluate();
    expect(calls).toBe(1);
  });

  // CE-621.1
  test.each([
    ['Reverse', (s: unknown) => ['Reverse', s]],
    ['Take', (s: unknown) => ['Take', s, 1]],
  ])(
    'two concurrent evaluateAsync() of %s over host code do not share one walk',
    async (_name, shape) => {
      const ce = new ComputeEngine();
      let calls = 0;
      ce.declare('src', {
        signature: '() -> list<integer>',
        evaluate: (_ops, { engine }) => {
          calls += 1;
          return engine.function('List', [engine.number(calls)]);
        },
      });
      const node = ce.box(shape(['src']) as any);
      const [a, b] = await Promise.all([
        node.evaluateAsync(),
        node.evaluateAsync(),
      ]);
      expect(calls).toBe(2);
      expect([a.toString(), b.toString()].sort()).toEqual(['[1]', '[2]']);
    }
  );

  test('two concurrent evaluateAsync() of a pure view still agree', async () => {
    const ce = new ComputeEngine();
    const node = ce.box(['Reverse', ['List', 1, 2, 3]]);
    const [a, b] = await Promise.all([
      node.evaluateAsync(),
      node.evaluateAsync(),
    ]);
    expect(a.toString()).toBe('[3,2,1]');
    expect(b.toString()).toBe('[3,2,1]');
  });
});

describe('A JOINED ASYNCHRONOUS WALK READS THE MEMO IN ITS OWN CONTEXT', () => {
  // Two evaluations started in a scope where `b` is local share one walk.
  // The second one reads the memo when the walk ends, in its own evaluation
  // context: the scope where it started, not the scope current when the
  // walk ended (the global scope, where `b` is 100).
  test.each([
    ['Reverse', ['Reverse', ['List', 1, 'b']], '[2,1]', '[100,1]'],
    ['Take', ['Take', ['List', 1, 'b', 3], 2], '[1,2]', '[1,100]'],
  ])('%s', async (_name, json, scoped, global) => {
    const ce = new ComputeEngine();
    ce.declare('b', { value: 100 } as any);
    const e = ce.box(json as any);
    ce.pushScope();
    ce.declare('b', { value: 2 } as any);
    const p1 = e.evaluateAsync();
    const p2 = e.evaluateAsync();
    ce.popScope();
    const p3 = e.evaluateAsync();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.toString()).toBe(scoped);
    expect(r2.toString()).toBe(scoped);
    expect(r3.toString()).toBe(global);
  });
});

// Caches that define a result keep one set of random draws for one
// instance (`docs/RANDOMNESS-MODEL.md` §6): a second read of the same
// instance gives the same draws. A value that reads a host operator declared
// `pure: false` (`q`) through a symbol, or a host operator that states
// `pure: true` and reads such a symbol (`w`), is kept in these caches. This
// is the behaviour today; the design of ROADMAP CE-657 decides whether it
// stays, and these tests change with it.
describe('ONE SET OF DRAWS FOR ONE INSTANCE', () => {
  function setup() {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('q', {
      signature: '() -> integer',
      pure: false,
      evaluate: (_ops, { engine }) => engine.number(++calls),
    });
    ce.assign('r', ce.box(['q']));
    ce.declare('w', {
      signature: '(integer) -> integer',
      pure: true,
      evaluate: ([x], { engine }) =>
        engine.number(x.re + engine.box('r').evaluate().re),
    });
    return { ce, calls: () => calls };
  }

  test('a sequence keeps one value for each term', () => {
    // The memo of the terms defines the result: `A_5` and `A_6` are read
    // from the same draws.
    const { ce, calls } = setup();
    ce.declareSequence('A', {
      variable: 'n',
      base: { 0: 0 },
      recurrence: 'A_{n-1} + r',
    });
    const a5 = ce.parse('A_{5}').evaluate();
    expect(ce.parse('A_{5}').evaluate().isSame(a5)).toBe(true);
    const a6 = ce.parse('A_{6}').evaluate();
    expect(a6.re - a5.re).toBe(6);
    expect(calls()).toBe(6);
  });

  test('the element memo: two reads of one element give the same draw', () => {
    const { ce, calls } = setup();
    const node = ce.box([
      'Map',
      ['Function', ['w', 'k'], 'k'],
      ['List', 1, 2, 3],
    ]);
    const a = node.at(1)!.toString();
    expect(node.at(1)!.toString()).toBe(a);
    expect(calls()).toBe(1);
  });

  test('the facet memo: a second count is read from the memo', () => {
    const { ce } = setup();
    const node = ce.box([
      'Filter',
      ['List', 1, 2, 3],
      ['Function', ['Greater', ['w', 'k'], 4], 'k'],
    ]);
    const first = node.count;
    ce._cacheStats.reset();
    ce._cacheStats.enabled = true;
    let second: number | undefined;
    try {
      second = node.count;
    } finally {
      ce._cacheStats.enabled = false;
    }
    expect(second).toBe(first);
    expect(ce._cacheStats.snapshot().caches.collectionFacet.hit).toBe(1);
  });

  test('the at() cell of an eager producer: two reads give the same draw', () => {
    const { ce, calls } = setup();
    // `[1, 2] + r` is pure (`isPure` does not read `r`): its evaluation is
    // kept for the `at()` reads of the instance.
    const node = ce.box(['Add', ['List', 1, 2], 'r']);
    const a = node.at(1)!.toString();
    expect(node.at(1)!.toString()).toBe(a);
    expect(calls()).toBe(1);
  });

  test('a seeded evaluation gives the same draws at each evaluation', () => {
    const ce = new ComputeEngine();
    ce.assign('r', ce.box(['Random']));
    const node = ce.box([
      'WithRandomSeed',
      3,
      ['List', ['Reverse', ['List', 1, 'r']], ['Reverse', ['List', 1, 'r']]],
    ]);
    const a = node.evaluate().toString();
    expect(node.evaluate().toString()).toBe(a);
  });
});
