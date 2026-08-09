import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/math-json/types.ts';

/** A boxed expression, as the engine hands it back. */
type BoxedExpr = ReturnType<ComputeEngine['box']>;

/**
 * Change 1 of `docs/plans/2026-08-09-lazy-collection-evaluate-design.md`:
 * `BoxedFunction.evaluate()` memoizes the fall-through evaluation of a lazy
 * collection VIEW, so re-evaluating an already-evaluated view is O(1) and an
 * `xs := Append(xs, v)` accumulator loop is O(n) instead of O(n²).
 *
 * The first half of this file pins the three regimes the plan names; the
 * second half pins the memo's behavior.
 */

//
// The three regimes, DERIVED from the runtime operator definitions
//
// The plan's inventory was regex-derived from the library source and is
// explicitly provisional ("the implementation must re-derive it
// programmatically … and pin it in a test so a future operator lands in a
// regime deliberately"). This is that re-derivation: it reads the same three
// facts the memo's own eligibility test reads — a `collection.isLazy`
// handler, the def-level `lazy` flag, and the presence of an `evaluate`
// handler — off the definitions the engine actually installs. A new
// collection operator therefore lands in one of the buckets below and fails
// this test until someone decides which one is right for it.
//

type Regime =
  /** `lazy: true` on the definition: `holdMap` returns the operands
   * unevaluated, so there is no repeat operand walk to eliminate. */
  | 'def-lazy'
  /** The memo's set: a lazy view with no def-level `lazy` and no `evaluate`
   * handler, which falls through to `_computeValue`'s generic step-4 walk on
   * every call. */
  | 'change-1'
  /** An `evaluate` handler that DECLINES past `MAX_SIZE_EAGER_COLLECTION`,
   * landing on the same rebuild. Still a distinct regime — the handler runs,
   * and below the threshold it materializes instead of rebuilding — but no
   * longer EXCLUDED from the memo: the plan's "over-threshold blowup"
   * follow-up extended the memo to the declined fall-through, since these
   * handlers are deterministic in their operands and would decline again
   * identically under an unchanged key. See the memo participation test
   * below. */
  | 'conditional-handler'
  /** Collection handlers, but no `isLazy` handler at all: never a lazy view,
   * so none of the above applies. */
  | 'not-a-lazy-view';

function collectionRegimes(): Map<string, Regime> {
  const ce = new ComputeEngine();
  // The standard library lives in the outermost lexical scope.
  let scope: any = (ce as any).context.lexicalScope;
  while (scope.parent) scope = scope.parent;

  const regimes = new Map<string, Regime>();
  for (const [name, binding] of scope.bindings as Map<string, any>) {
    const def = binding.operator;
    if (!def?.collection) continue;
    if (def.collection.isLazy === undefined)
      regimes.set(name, 'not-a-lazy-view');
    else if (def.lazy === true) regimes.set(name, 'def-lazy');
    else if (def.evaluate !== undefined)
      regimes.set(name, 'conditional-handler');
    else regimes.set(name, 'change-1');
  }
  return regimes;
}

function namesIn(regime: Regime): string[] {
  return [...collectionRegimes()]
    .filter(([_, r]) => r === regime)
    .map(([name]) => name)
    .sort();
}

describe('lazy collection regimes', () => {
  test('def-lazy views', () => {
    // The plan names nine (`Map`, `Filter`, `Scan`, `Differences`,
    // `TakeWhile`, `DropWhile`, `FlatMap`, `Tabulate`, `Dedup`) — the ones
    // defined in `library/collections.ts`. The runtime set adds the four
    // def-lazy views declared elsewhere or as literals; they are def-lazy for
    // the same reason and equally out of the memo's scope.
    expect(namesIn('def-lazy')).toEqual([
      'Comprehension',
      'Dedup',
      'Differences',
      'DropWhile',
      'Filter',
      'FlatMap',
      'List',
      'Map',
      'Scan',
      'Set',
      'Tabulate',
      'TakeWhile',
      'When',
    ]);
  });

  test('Change 1 set — memoized lazy views', () => {
    // The plan names sixteen; re-derivation adds three the regex missed:
    // `Permutations` and `Combinations` (`library/combinatorics.ts`, both
    // genuine lazy views that the memo now covers) and `Tuple`, whose
    // `isLazy` handler exists but answers `false` for every instance — its
    // membership here is inert (see the instance check below).
    expect(namesIn('change-1')).toEqual([
      'Append',
      'Combinations',
      'Cycle',
      'Drop',
      'Fill',
      'Iterate',
      'Join',
      'Linspace',
      'Most',
      'Permutations',
      'Range',
      'Rest',
      'Reverse',
      'RotateLeft',
      'RotateRight',
      'Slice',
      'Take',
      'Tuple',
      'Zip',
    ]);
  });

  test('conditional-handler views', () => {
    // The plan names four (`Insert`, `DeleteAt`, `ReplaceAt`, `ChunkBy`);
    // `Partition`, `Repeat` and `SlidingWindow` have the same shape. They all
    // now participate in the memo (see 'conditional-handler views are
    // memoized …' below); the regime stays distinct because the handler is
    // what decides between materializing and falling through.
    expect(namesIn('conditional-handler')).toEqual([
      'ChunkBy',
      'DeleteAt',
      'Insert',
      'Partition',
      'Repeat',
      'ReplaceAt',
      'SlidingWindow',
    ]);
  });

  test('collection operators that are never lazy views', () => {
    expect(namesIn('not-a-lazy-view')).toEqual([
      'CartesianProduct',
      'Complement',
      'Intersection',
      'Interval',
      'PowerSet',
      'SetMinus',
      'SymmetricDifference',
      'Union',
    ]);
  });

  test('every collection operator lands in exactly one regime', () => {
    const regimes = collectionRegimes();
    expect(regimes.size).toBe(47);
    for (const [name, regime] of regimes)
      expect([name, regime]).toEqual([
        name,
        expect.stringMatching(
          /^(def-lazy|change-1|conditional-handler|not-a-lazy-view)$/
        ),
      ]);
  });

  // A representative instance of every `change-1` operator, so the def-level
  // classification is checked against what the memo's eligibility test
  // actually sees at runtime.
  const CHANGE_1_INSTANCES: Record<string, Expression> = {
    Append: ['Append', ['List', 1, 2], 3],
    Combinations: ['Combinations', ['List', 1, 2, 3], 2],
    Cycle: ['Cycle', ['List', 1, 2, 3]],
    Drop: ['Drop', ['List', 1, 2, 3], 1],
    Fill: ['Fill', ['Function', ['Add', '_', '_2']], ['Tuple', 3, 3]],
    Iterate: ['Iterate', ['Function', ['Multiply', '_', 2]], 1],
    Join: ['Join', ['List', 1, 2], ['List', 3, 4]],
    Linspace: ['Linspace', 1, 10, 5],
    Most: ['Most', ['List', 1, 2, 3]],
    Permutations: ['Permutations', ['List', 1, 2, 3]],
    Range: ['Range', 1, 10],
    Rest: ['Rest', ['List', 1, 2, 3]],
    Reverse: ['Reverse', ['List', 1, 2, 3]],
    RotateLeft: ['RotateLeft', ['List', 1, 2, 3], 1],
    RotateRight: ['RotateRight', ['List', 1, 2, 3], 1],
    Slice: ['Slice', ['List', 1, 2, 3], 1, 2],
    Take: ['Take', ['List', 1, 2, 3], 2],
    Tuple: ['Tuple', 1, 2, 3],
    Zip: ['Zip', ['List', 1, 2], ['List', 3, 4]],
  };

  test('every Change 1 operator has a representative instance', () => {
    expect(Object.keys(CHANGE_1_INSTANCES).sort()).toEqual(namesIn('change-1'));
  });

  test.each(Object.entries(CHANGE_1_INSTANCES))(
    '%s: a constant instance evaluates once and is then memoized',
    (name, expr) => {
      const ce = new ComputeEngine();
      const e = ce.box(expr);
      expect(e.isCanonical).toBe(true);
      if (name === 'Tuple') {
        // `Tuple`'s `isLazy` handler answers `false`: an inert member of the
        // def-level set, and correctly NOT memoized.
        expect(e.isLazyCollection).toBe(false);
        expect(e.evaluate()).not.toBe(e.evaluate());
        return;
      }
      if (name === 'Iterate') {
        // Excluded for RETENTION: an `elementMemo` operator whose instance is
        // infinite. See the dedicated test below.
        expect(e.isLazyCollection).toBe(true);
        expect(e.evaluate()).not.toBe(e.evaluate());
        return;
      }
      expect(e.isLazyCollection).toBe(true);
      expect(e.evaluate()).toBe(e.evaluate());
    }
  );
});

//
// Change 1 — the memo's behavior
//

// NO wall-clock assertion here. The mechanism Change 1 owns — iteration k−1's
// result staying a memo hit across the loop's own `Assign` — is pinned
// deterministically by the identity test below, and a timing ratio on top of
// it only added CI flake. Performance ownership for the accumulator shape is
// the benchmarks harness (`benchmarks/`), not this suite.

describe('lazy collection evaluate memo', () => {
  test('each iteration re-uses the previous result', () => {
    // The decisive, DETERMINISTIC probe, in the real loop shape: the `Assign`
    // between two iterations bumps `ce._generation`, so a memo keyed only on
    // the generation would be invalidated by the loop's own writes and
    // iteration k's walk would re-walk the whole chain. What makes the loop
    // sub-quadratic is that iteration k−1's RESULT is still a memo hit after
    // the assign — which is what evaluating it to itself means.
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List']));
    let previous: ReturnType<typeof ce.box> | undefined = undefined;
    for (let i = 0; i < 20; i++) {
      if (previous) expect(previous.evaluate()).toBe(previous);
      const r = ce
        .function('Append', [ce.symbol('xs'), ce.number(i)])
        .evaluate();
      ce.assign('xs', r);
      previous = r;
    }
    expect(previous!.count).toBe(20);
  });

  test('an evaluated view survives an unrelated Assign', () => {
    // The deterministic half of the test above: `Assign` bumps
    // `ce._generation`, so a memo keyed only on the generation would be
    // invalidated by the accumulator's own writes and never hit. A constant,
    // pure view gets a generation-INDEPENDENT entry instead.
    const ce = new ComputeEngine();
    const e = ce.box(['Append', ['List', 1, 2], 3]);
    const r = e.evaluate();
    ce.assign('unrelated', ce.number(1));
    expect(e.evaluate()).toBe(r);
    expect(r.evaluate()).toBe(r);
  });

  test('a symbol operand resolves, and re-resolves after reassignment', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.number(5));
    const e = ce.box(['Append', ['List', 1, 2], 'y']);
    expect(e.evaluate().at(3)?.re).toBe(5);
    // The generation key must not serve the stale 5.
    ce.assign('y', ce.number(7));
    expect(e.evaluate().at(3)?.re).toBe(7);
  });

  test('an impure operand re-draws on every evaluate', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Append', ['List', 1, 2], ['Random']]);
    expect(e.isPure).toBe(false);
    // A memo hit would return the identical object.
    expect(e.evaluate()).not.toBe(e.evaluate());
    const draws = new Set(
      [1, 2, 3, 4, 5].map(() => e.evaluate().at(3)?.re ?? 0)
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  test('a self-referential binding memoizes neither direction', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'collection');
    ce.box(['Assign', 'xs', ['Append', 'xs', 1]]).evaluate();

    // The cycle guard answers this one PROVISIONALLY (fail-closed), and the
    // answer depends on the route: through the symbol the inner dereference
    // is already in flight, evaluated directly it is not. Freezing either as
    // the node's value would make the result depend on which route ran first,
    // so nothing is memoized — each evaluate rebuilds.
    const node = ce.symbol('xs').evaluate();
    expect(node.toString()).toBe('[1]');
    expect(ce.symbol('xs').evaluate().toString()).toBe('[1]');

    const value = (ce.symbol('xs') as any).valueDefinition.value;
    expect(value.operator).toBe('Append');
    expect(value.evaluate()).not.toBe(value.evaluate());
  });

  test('non-default options are unaffected', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Append', ['List', 1, 2], 3]);
    // Prime the memo first: an explicit `materialization` must not read it.
    expect(e.evaluate().isLazyCollection).toBe(true);
    const materialized = e.evaluate({ materialization: true });
    expect(materialized.isLazyCollection).toBe(false);
    expect(materialized.toString()).toBe('[1,2,3]');
    expect(e.N().toString()).toBe('[1,2,3]');
    // …and the memoized default result is unchanged by either.
    expect(e.evaluate().isLazyCollection).toBe(true);
  });

  test('a constant view re-evaluates after a precision change', () => {
    // "Constant" means no VALUE write can make the entry stale — not that
    // nothing can. `ce.precision` runs `_reset()`, which purges the engine's
    // caches precisely because stored numeric content is now stale, and bumps
    // `_semanticEpoch`; the memo's epoch axis is what makes the same node
    // follow.
    const ce = new ComputeEngine();
    ce.precision = 20;
    const e = ce.box(['Append', ['List', 1], ['N', ['Divide', 1, 3]]]);
    const low = e.evaluate().at(2)!.toString();
    expect(low).toBe('0.33333333333333333333');

    ce.precision = 60;
    const high = ce
      .box(['Append', ['List', 1], ['N', ['Divide', 1, 3]]])
      .evaluate()
      .at(2)!
      .toString();
    expect(high.length).toBeGreaterThan(low.length);
    // The already-memoized node must not keep serving the 20-digit value.
    expect(e.evaluate().at(2)!.toString()).toBe(high);
  });

  test('a memoized view re-resolves inside a re-pushed populated scope', () => {
    // Re-pushing an already-populated scope bumps NO generation (only
    // `popScope` bumps), so `ce._generation` alone does not characterize the
    // resolution environment: the memo also stamps the ambient lexical scope.
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2]));
    ce.pushScope();
    ce.declare('xs', { type: 'collection', value: ce.box(['List', 7]) });
    const saved = (ce as any).context.lexicalScope;
    ce.popScope();

    const e = ce.box(['Append', 'xs', 9]);
    expect(e.evaluate().toString()).toBe('[1,2,9]');

    ce.pushScope(saved);
    try {
      expect(e.evaluate().toString()).toBe('[7,9]');
      // …and it agrees with a node boxed inside the scope.
      expect(ce.box(['Append', 'xs', 9]).evaluate().toString()).toBe('[7,9]');
    } finally {
      ce.popScope();
    }
    expect(e.evaluate().toString()).toBe('[1,2,9]');
  });

  test('an infinite elementMemo view is not memoized (retention)', () => {
    // A memo entry pins the view forever, and an `elementMemo` operator's
    // instance carries an element cache that grows with the deepest access
    // ever made — unbounded for an infinite collection. `Iterate` (the only
    // `elementMemo` operator in the Change 1 set, and always infinite:
    // `count: () => Infinity`) is therefore excluded in both directions.
    const ce = new ComputeEngine();
    const e = ce.box(['Iterate', ['Function', ['Multiply', '_', 2]], 1]);
    expect(e.isLazyCollection).toBe(true);
    expect(e.isFiniteCollection).toBe(false);
    expect(e.evaluate()).not.toBe(e.evaluate());
    // Not primed as its own result either.
    const r = e.evaluate();
    expect(r.evaluate()).not.toBe(r);
    expect([1, 2, 3, 4].map((i) => r.at(i)!.toString())).toEqual([
      '2',
      '4',
      '8',
      '16',
    ]);
  });

  test('a pure constant view evaluates to the same object twice', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Append', ['List', 1, 2], 3]);
    const first = e.evaluate();
    expect(e.evaluate()).toBe(first);
    // The result is self-primed: evaluating it is the identity, which is what
    // keeps the accumulator O(n).
    expect(first.evaluate()).toBe(first);
  });
});

//
// The conditional-handler regime — the plan's "over-threshold blowup"
// follow-up (docs/plans/2026-08-09-lazy-collection-evaluate-design.md,
// "Affected operator set" / "Sequencing" item 5)
//
// Two independent defects, both fixed:
//
// 1. The SHAPE QUERIES were doubly recursive. `Insert`/`DeleteAt`/`ReplaceAt`
//    read `op1.count` once for their index-range guard
//    (`insertPosition`/`targetPosition`) and once more for the facet's own
//    arithmetic — cost(d) = 2·cost(d−1) on a chained view, i.e. 2^depth.
//    Measured before: `.count` on a depth-16 chain over a 110-element base,
//    7.8 ms, doubling per level; after: 0.01 ms, flat.
// 2. The memo EXCLUDED these operators (they have an `evaluate` handler), so
//    the declined fall-through rebuilt the whole chain on every call. They
//    now participate: the handlers are deterministic in their operands, so
//    under an unchanged (generation, epoch, scope) key a re-run declines —
//    or materializes — identically.
//
describe('conditional-handler views participate in the memo', () => {
  // One representative OVER-threshold instance per operator (source count
  // 200 > MAX_SIZE_EAGER_COLLECTION = 100, so every `evaluate` handler
  // declines and the node lands on the generic rebuild). `Repeat`'s lazy
  // shape is the 1-ary infinite one — the 2-ary form's `isLazy` handler
  // answers `false` and it never reaches the memo at all.
  const CONDITIONAL_INSTANCES: Record<string, Expression> = {
    ChunkBy: [
      'ChunkBy',
      ['Range', 1, 200],
      ['Function', ['Floor', ['Divide', '_', 10]]],
    ],
    DeleteAt: ['DeleteAt', ['Range', 1, 200], 1],
    Insert: ['Insert', ['Range', 1, 200], 1, 0],
    Partition: ['Partition', ['Range', 1, 200], 3],
    Repeat: ['Repeat', 5],
    ReplaceAt: ['ReplaceAt', ['Range', 1, 200], 1, 0],
    SlidingWindow: ['SlidingWindow', ['Range', 1, 200], 3],
  };

  test('every conditional-handler operator has a representative instance', () => {
    expect(Object.keys(CONDITIONAL_INSTANCES).sort()).toEqual(
      namesIn('conditional-handler')
    );
  });

  test.each(Object.entries(CONDITIONAL_INSTANCES))(
    '%s: an over-threshold instance is memoized',
    (_name, expr) => {
      const ce = new ComputeEngine();
      const e = ce.box(expr);
      expect(e.isCanonical).toBe(true);
      expect(e.isLazyCollection).toBe(true);
      expect(e.evaluate()).toBe(e.evaluate());
    }
  );

  test('a below-threshold instance still materializes eagerly', () => {
    // The handler ACCEPTS here, and the memo is consulted before it runs —
    // sound under the same key, and it must not change what the handler
    // produces.
    const ce = new ComputeEngine();
    const e = ce.box(['Insert', ['List', 1, 2], 1, 9]);
    const r = e.evaluate();
    expect(r.operator).toBe('List');
    expect(r.toString()).toBe('[9,1,2]');
    expect(e.evaluate()).toBe(r);
  });
});

describe('conditional-handler accumulator loops', () => {
  /** A list literal of `n` integers, 0..n−1. */
  function list(ce: ComputeEngine, n: number) {
    return ce.function(
      'List',
      Array.from({ length: n }, (_, i) => ce.number(i))
    );
  }

  test('an Insert accumulator past the eager threshold re-uses the previous result', () => {
    // The `SetAt`-sugar workload the plan named as blocked. NO wall-clock
    // assertion (the suite dropped those as CI-flaky): the mechanism is
    // pinned deterministically, exactly as the `Append` accumulator above —
    // iteration k−1's RESULT must still be a memo hit after the loop's own
    // `Assign` bumped `ce._generation`, which is what evaluating it to
    // ITSELF means. Before the fix this loop was not merely quadratic but
    // exponential (≈2× per iteration past 100 elements): 40 iterations over
    // a 90-element base took 214 s.
    // The base is already OVER the threshold, so every iteration takes the
    // declined fall-through (starting at 100 would make the first iteration
    // materialize into a `List`, which is def-lazy and deliberately outside
    // the memo).
    const ce = new ComputeEngine();
    ce.assign('xs', list(ce, 110));
    let previous: BoxedExpr | undefined = undefined;
    for (let i = 0; i < 30; i++) {
      if (previous) {
        expect(previous.operator).toBe('Insert');
        expect(previous.evaluate()).toBe(previous);
      }
      const r = ce
        .function('Insert', [ce.symbol('xs'), ce.number(1), ce.number(i)])
        .evaluate();
      ce.assign('xs', r);
      previous = r;
    }
    expect(previous!.count).toBe(140);
    // …and the accumulated view still enumerates correctly: the 30 inserts
    // all landed at position 1, newest first, ahead of the original 0..109.
    expect([1, 2, 30, 31, 140].map((i) => previous!.at(i)!.re)).toEqual([
      29, 28, 0, 0, 109,
    ]);
  });

  test('a ReplaceAt accumulator past the eager threshold re-uses the previous result', () => {
    // The other `SetAt` shape: an indexed UPDATE loop, which never grows the
    // collection past the threshold it was already over.
    const ce = new ComputeEngine();
    ce.assign('xs', list(ce, 110));
    let previous: BoxedExpr | undefined = undefined;
    for (let i = 0; i < 30; i++) {
      if (previous) expect(previous.evaluate()).toBe(previous);
      const r = ce
        .function('ReplaceAt', [
          ce.symbol('xs'),
          ce.number(i + 1),
          ce.number(1000 + i),
        ])
        .evaluate();
      ce.assign('xs', r);
      previous = r;
    }
    expect(previous!.operator).toBe('ReplaceAt');
    expect(previous!.count).toBe(110);
    expect([1, 15, 30, 31, 110].map((i) => previous!.at(i)!.re)).toEqual([
      1000, 1014, 1029, 30, 109,
    ]);
  });
});

describe('conditional-handler shape queries are linear in depth', () => {
  /** A canonical, UNEVALUATED `Insert` chain of the given depth over a
   * `base`-element list literal. */
  function insertChain(ce: ComputeEngine, base: number, depth: number) {
    let xs = ce.function(
      'List',
      Array.from({ length: base }, (_, i) => ce.number(i))
    );
    for (let i = 0; i < depth; i++)
      xs = ce.function('Insert', [xs, ce.number(1), ce.number(100 + i)]);
    return xs;
  }

  /**
   * Run `f` with `count` instrumented on the boxed-function prototype,
   * returning how many times it was read. The budget is what makes the
   * blowup FAIL rather than hang: the doubling is synchronous, so a jest
   * timeout can never interrupt it — at depth 30 the old code needs 2^30
   * source walks and simply never returns. Throwing at the budget aborts on
   * the first few thousand reads instead.
   */
  function countingReads(sample: BoxedExpr, f: () => void): number {
    const proto = Object.getPrototypeOf(sample);
    const desc = Object.getOwnPropertyDescriptor(proto, 'count')!;
    const BUDGET = 2000;
    let reads = 0;
    Object.defineProperty(proto, 'count', {
      ...desc,
      get(this: unknown) {
        if (++reads > BUDGET)
          throw new Error(
            `shape query blew up: over ${BUDGET} source \`count\` reads`
          );
        return desc.get!.call(this);
      },
    });
    try {
      f();
    } finally {
      Object.defineProperty(proto, 'count', desc);
    }
    return reads;
  }

  test('count / isFiniteCollection on a depth-30 chain are O(depth)', () => {
    const ce = new ComputeEngine();
    const chain = insertChain(ce, 110, 30);

    // ONE source `count` read per level (31 for count, 30 for the facets that
    // bottom out at the list literal) — not 2^30. The bound is deliberately
    // loose: what it separates is linear from exponential, not 31 from 40.
    expect(countingReads(chain, () => expect(chain.count).toBe(140))).toBeLessThan(200);
    expect(
      countingReads(chain, () => expect(chain.isFiniteCollection).toBe(true))
    ).toBeLessThan(200);
    expect(
      countingReads(chain, () => expect(chain.isEmptyCollection).toBe(false))
    ).toBeLessThan(200);
    expect(countingReads(chain, () => expect(chain.at(1)!.re).toBe(129))).toBeLessThan(200);

    // The evaluated view answers the same. (Evaluation itself is O(depth²) —
    // each level runs its own shape queries — which the memo then collapses
    // to O(1) on re-evaluation; that is the accumulator test above.)
    const r = chain.evaluate();
    expect(r.operator).toBe('Insert');
    expect(r.count).toBe(140);
    expect(r.isFiniteCollection).toBe(true);
  });
});

describe('conditional-handler chains enumerate like their eager equivalents', () => {
  /** Apply the same index script to a plain JS array. */
  function applyJs(xs: number[], script: [string, number, number?][]): number[] {
    const out = [...xs];
    for (const [op, index, value] of script) {
      const i0 = index > 0 ? index - 1 : out.length + index + (op === 'Insert' ? 1 : 0);
      if (op === 'Insert') out.splice(i0, 0, value!);
      else if (op === 'DeleteAt') out.splice(i0, 1);
      else out[i0] = value!;
    }
    return out;
  }

  /** Apply the same index script to a Compute Engine list. */
  function applyCe(ce: ComputeEngine, n: number, script: [string, number, number?][]) {
    let xs = ce.function(
      'List',
      Array.from({ length: n }, (_, i) => ce.number(i))
    );
    for (const [op, index, value] of script)
      xs = ce
        .function(
          op,
          value === undefined
            ? [xs, ce.number(index)]
            : [xs, ce.number(index), ce.number(value)]
        )
        .evaluate();
    return xs;
  }

  const SCRIPT: [string, number, number?][] = [
    ['Insert', 1, 900],
    ['ReplaceAt', 3, 901],
    ['DeleteAt', 2],
    ['Insert', -1, 902],
    ['ReplaceAt', -2, 903],
    ['DeleteAt', -1],
    ['Insert', 5, 904],
  ];

  test.each([
    // Below the eager threshold every step MATERIALIZES (the handler
    // accepts); above it every step DECLINES and stacks another lazy view.
    ['below the threshold (materialized)', 30, 'List'],
    ['above the threshold (lazy chain)', 130, 'Insert'],
  ])('%s', (_label, n, expectedOperator) => {
    const ce = new ComputeEngine();
    const result = applyCe(ce, n as number, SCRIPT);
    expect(result.operator).toBe(expectedOperator);
    const expected = applyJs(
      Array.from({ length: n as number }, (_, i) => i),
      SCRIPT
    );
    expect(result.count).toBe(expected.length);
    expect([...result.each()].map((x) => x.re)).toEqual(expected);
  });
});

describe('conditional-handler memo staleness gates', () => {
  function bigList(ce: ComputeEngine, n = 120) {
    return ce.function(
      'List',
      Array.from({ length: n }, (_, i) => ce.number(i))
    );
  }

  test('a symbol operand re-resolves after reassignment', () => {
    // A non-constant node gets the generation-GATED entry, so the assign
    // below must miss it. The source is over the threshold, so this is the
    // declined fall-through, not the eager handler.
    const ce = new ComputeEngine();
    ce.assign('y', ce.number(5));
    const e = ce.function('Insert', [bigList(ce), ce.number(1), ce.symbol('y')]);
    expect(e.evaluate().operator).toBe('Insert');
    expect(e.evaluate().at(1)?.re).toBe(5);
    ce.assign('y', ce.number(7));
    expect(e.evaluate().at(1)?.re).toBe(7);
  });

  test('a constant view re-evaluates after a precision change', () => {
    // The epoch axis: "constant" means no VALUE write can make the entry
    // stale, not that nothing can — `ce.precision` runs `_reset()` because
    // stored numeric content is now stale.
    const ce = new ComputeEngine();
    ce.precision = 20;
    const third = () => ce.box(['N', ['Divide', 1, 3]]);
    const e = ce.function('Insert', [bigList(ce), ce.number(1), third()]);
    const low = e.evaluate().at(1)!.toString();
    expect(low).toBe('0.33333333333333333333');

    ce.precision = 60;
    const high = ce
      .function('Insert', [bigList(ce), ce.number(1), third()])
      .evaluate()
      .at(1)!
      .toString();
    expect(high.length).toBeGreaterThan(low.length);
    expect(e.evaluate().at(1)!.toString()).toBe(high);
  });

  test('a self-referential binding memoizes neither direction', () => {
    // The settled-only gate: the cycle guard answers this PROVISIONALLY and
    // route-dependently, so freezing either answer would make the result
    // depend on which route ran first.
    const ce = new ComputeEngine();
    ce.declare('xs', 'collection');
    ce.box(['Assign', 'xs', ['Insert', 'xs', 1, 1]]).evaluate();

    const value = (ce.symbol('xs') as any).valueDefinition.value;
    expect(value.operator).toBe('Insert');
    expect(value.evaluate()).not.toBe(value.evaluate());
  });

  test('a memoized view re-resolves inside a re-pushed populated scope', () => {
    // The ambient-scope axis, on the declined path.
    const ce = new ComputeEngine();
    ce.assign('xs', bigList(ce, 120));
    ce.pushScope();
    ce.declare('xs', { type: 'collection', value: bigList(ce, 130) });
    const saved = (ce as any).context.lexicalScope;
    ce.popScope();

    const e = ce.function('Insert', [
      ce.symbol('xs'),
      ce.number(1),
      ce.number(9),
    ]);
    expect(e.evaluate().count).toBe(121);

    ce.pushScope(saved);
    try {
      expect(e.evaluate().count).toBe(131);
    } finally {
      ce.popScope();
    }
    expect(e.evaluate().count).toBe(121);
  });
});
