import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// HOW MANY TIMES A LAZY COLLECTION RUNS ITS ELEMENT CALLBACK (2026-08-15).
//
// A lazy `Map`/`Filter` does not hold its elements; it recomputes each one
// when a consumer asks for it. How OFTEN it recomputes used to be invisible:
// with a pure callback, running it twice and running it once give the same
// answer, so an extra enumeration cost time and nothing else.
//
// Mutation changed that. A callback that writes to an enclosing variable — or
// to a mutable object — leaves a trace of every run, so the number of runs is
// now part of the observable result. Ruling B8 of the type-system roadmap
// (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "pinned everywhere operands
// evaluate") requires lazy materialization not to duplicate evaluations: one
// consumption of an N-element lazy collection runs the callback N times, not
// N+1 and not 2N.
//
// Several consumers used to break that. Each ran a PROBE enumeration before
// the real one — `enumerationDeclined()` pulling a first element to find out
// whether the iterator declines, `Length` asking `isEmptyCollection` before
// `count`, the `Missing`-datum gate (`aggregateAbsence`) flattening every
// collection operand before `Max`/`Min` folded the same elements again. The
// probe's answer is now read off the consumer's OWN walk instead
// (`enumerationDeclinedAfterWalk` in `library/collections.ts`), and the
// absence gate skips collections whose element type rules an absent datum out.
//
// These tests assert exact CALL COUNTS, never elapsed time: the count is the
// contract. Each also asserts the VALUE, so a "fix" that skips work by
// computing the wrong answer fails here too.
//

/**
 * Epsil preamble defining a counter `n` and two effectful callbacks that bump
 * it: `t1()` returns 1, `b1()` returns true. Multi-letter names throughout —
 * a bare `i` parses as the imaginary unit.
 */
const PRE = `let n = 0
function t1() scope -> integer { n = n + 1
  1 }
function b1() scope -> boolean { n = n + 1
  true }
`;

/**
 * Run `body` after the preamble on a FRESH engine and return the program's
 * value as a string. Bodies below end in a `(result, n)` tuple, so the value
 * carries both the computed answer and the number of callback runs.
 */
function run(body: string): string {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, PRE + body);
  const diagnostics = result.diagnostics ?? [];
  if (diagnostics.length > 0)
    throw new Error(
      `Epsil diagnostics: ${diagnostics
        .map((d) => JSON.stringify(d))
        .join('; ')}\n--- source ---\n${PRE + body}`
    );
  return result.value?.toString() ?? 'undefined';
}

describe('lazy collection: one consumption runs the callback once per element', () => {
  // `Sum` folds the collection. It used to call `enumerationDeclined()` first,
  // which pulled (and discarded) a first element: 6 runs for 5 elements.
  test('Sum over a lazy Map: 5 elements, 5 runs', () => {
    expect(run(`let s = Sum(Map((x) => x + t1(), [1, 2, 3, 4, 5]))\n(s, n)`)) //
      .toBe('(20, 5)');
  });

  // Over a `Filter` the old probe cost TWO extra runs, not one: it asked
  // `isEmptyCollection` (which walks to the first match) and then pulled a
  // first element.
  test('Sum over a lazy Filter: 3 elements, 3 runs', () => {
    expect(run(`let s = Sum(Filter([1, 2, 3], (x) => b1()))\n(s, n)`)) //
      .toBe('(6, 3)');
  });

  test('Product over a lazy Map: 3 elements, 3 runs', () => {
    expect(run(`let s = Product(Map((x) => x + t1(), [1, 2, 3]))\n(s, n)`)) //
      .toBe('(24, 3)');
  });

  // `Length(Filter(...))` must run the predicate once per SOURCE element (6),
  // because the count is not known without testing every one. It used to run
  // it 7 times: `isEmptyCollection` walked to the first match before `count`
  // walked to the end.
  test('Length of a lazy Filter: 6 source elements, 6 runs', () => {
    expect(
      run(`let s = Length(Filter([1, 2, 3, 4, 5, 6], (x) => b1()))\n(s, n)`)
    ).toBe('(6, 6)');
  });

  test('Reduce over a lazy Map: 3 elements, 3 runs', () => {
    expect(
      run(
        `let s = Reduce(Map((x) => x + t1(), [1, 2, 3]), (a, x) => a + x, 0)\n(s, n)`
      )
    ).toBe('(9, 3)');
  });

  // `Max`/`Min` were the worst case at 2N+1: the shared absent-datum gate
  // flattened the collection once, the decline probe pulled one element, and
  // the extremum fold walked it again.
  test('Max over a lazy Map: 3 elements, 3 runs', () => {
    expect(run(`let s = Max(Map((x) => x + t1(), [1, 2, 3]))\n(s, n)`)) //
      .toBe('(4, 3)');
  });

  test('Min over a lazy Map: 3 elements, 3 runs', () => {
    expect(run(`let s = Min(Map((x) => x + t1(), [1, 2, 3]))\n(s, n)`)) //
      .toBe('(2, 3)');
  });

  test('for-in over a lazy Filter: 3 elements, 3 runs', () => {
    expect(
      run(
        `let acc = 0\nfor xx in Filter([1, 2, 3], (x) => b1()) { acc = acc + 1 }\n(acc, n)`
      )
    ).toBe('(3, 3)');
  });
});

describe('lazy collection: a consumer that needs fewer elements runs fewer', () => {
  // A short-circuiting consumer must STOP at the first decisive element.
  test('Any stops at the first true: 1 run', () => {
    expect(run(`let s = Any(Map((x) => b1(), [1, 2, 3]))\n(s, n)`)) //
      .toBe('("True", 1)');
  });

  // `All` has no early exit here — every element is true, so all 3 are tested.
  test('All tests every element until one fails: 3 runs', () => {
    expect(run(`let s = All(Map((x) => b1(), [1, 2, 3]))\n(s, n)`)) //
      .toBe('("True", 3)');
  });

  // Indexing materializes ONE element, not the prefix and not the whole
  // collection.
  test('indexing a lazy Map materializes one element: 1 run', () => {
    expect(run(`let s = Map((x) => x + t1(), [1, 2, 3])\nlet v = s[2]\n(v, n)`)) //
      .toBe('(3, 1)');
  });

  // `Length` of a `Map` is the source's length: known without running the
  // callback at all. Same for `Take`, which is lazy in its own right.
  test('Length of a lazy Map needs no element: 0 runs', () => {
    expect(run(`let s = Length(Map((x) => x + t1(), [1, 2, 3]))\n(s, n)`)) //
      .toBe('(3, 0)');
  });

  test('Take of a lazy Map is itself lazy: 0 runs', () => {
    expect(
      run(
        `let s = Take(Map((x) => x + t1(), [1, 2, 3, 4, 5]), 2)\n(Length(s), n)`
      )
    ).toBe('(2, 0)');
  });

  // Summing a TAKE runs the callback only for the elements taken.
  test('Sum of Take(2) over a 5-element lazy Map: 2 runs', () => {
    expect(
      run(`let s = Sum(Take(Map((x) => x + t1(), [1, 2, 3, 4, 5]), 2))\n(s, n)`)
    ).toBe('(5, 2)');
  });
});

describe('lazy collection: an EFFECTFUL callback is re-run per consumption', () => {
  //
  // DELIBERATE, and distinct from everything above. The guarantee is one run
  // per element per CONSUMPTION, not one run per element ever: a lazy
  // collection is a RECIPE, and consuming it again re-runs the recipe. Two
  // separate gates in the element memo
  // (`boxed-expression/collection-element-memo.ts`) keep it that way here, and
  // they are not the same gate:
  //
  // - Reading ONE element commits only a PARTIAL prefix, and partial entries
  //   are refused for an impure instance, because a later complete walk would
  //   re-draw and replace the prefix — two reads of the same element of the
  //   same instance would then disagree.
  // - The complete walk a `Sum` performs is committable for an impure
  //   instance in principle, but this instance is refused a step earlier: the
  //   dependency snapshot bails on the counter `n`, an unbound symbol it
  //   cannot key an invalidation stamp to, so no entry is ever written.
  //   (`CE_DEBUG_DEPS=1` prints `[deps] ineligible: unbound symbol 'n'`.)
  //
  // Pinned so a future memo change that started caching impure elements is a
  // visible decision rather than a silent one.
  //
  test('reading the same element twice runs the callback twice', () => {
    expect(
      run(
        `let s = Map((x) => x + t1(), [1, 2, 3])\nlet a = s[1]\nlet b = s[1]\n(a + b, n)`
      )
    ).toBe('(4, 2)');
  });

  test('summing the same lazy Map twice runs each element twice', () => {
    expect(
      run(
        `let s = Map((x) => x + t1(), [1, 2, 3])\nlet a = Sum(s)\nlet b = Sum(s)\n(a + b, n)`
      )
    ).toBe('(18, 6)');
  });
});

describe('the absent-datum gate still fires after the extra walk was removed', () => {
  //
  // `Max`/`Min` no longer flatten their collection operands to look for a
  // `Missing` or `NaN` element when the element TYPE rules one out. These pin
  // the cases where the type does NOT rule it out, so the gate must still walk
  // and still answer `NaN`.
  //
  const ce = new ComputeEngine();

  test('Max of a list containing Missing is NaN', () => {
    expect(
      ce
        .box(['Max', ['List', 1, 'Missing', 3]])
        .evaluate()
        .toString()
    ) //
      .toBe('NaN');
  });

  test('Max of a list containing NaN is NaN', () => {
    expect(
      ce
        .box(['Max', ['List', 1, 'NaN', 3]])
        .evaluate()
        .toString()
    ) //
      .toBe('NaN');
  });

  test('Max of an empty collection is NaN', () => {
    expect(
      ce
        .box(['Max', ['List']])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });

  test('Max of a filter with no matches is NaN', () => {
    expect(
      ce
        .box([
          'Max',
          ['Filter', ['List', 1, 2, 3], ['Function', ['Greater', 'x', 9], 'x']],
        ])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });

  test('Max of an ordinary list is its maximum', () => {
    expect(
      ce
        .box(['Max', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('3');
  });

  test('Max of a Range is its last element', () => {
    expect(
      ce
        .box(['Max', ['Range', 1, 5]])
        .evaluate()
        .toString()
    ).toBe('5');
  });
});

describe('a collection that DECLINES to enumerate still keeps consumers inert', () => {
  //
  // The decline verdict moved from a probe BEFORE the walk to a reading of the
  // walk itself, so the cases it protects need pinning: a collection that
  // reports a size but whose elements have no computable value (a `Linspace`
  // with a symbolic endpoint) must leave its consumer symbolic. Folding it
  // would silently answer the fold's initial value — `Sum` → 0 — which is
  // indistinguishable from a correct sum over an empty collection.
  //
  const ce = new ComputeEngine();
  const DECLINED = ['Linspace', 'a', 1, 3];

  test('Sum of an enumeration-declined collection stays symbolic', () => {
    expect(ce.box(['Sum', DECLINED]).evaluate().operator).toBe('Sum');
  });

  test('Reduce over an enumeration-declined collection stays symbolic', () => {
    expect(ce.box(['Reduce', DECLINED, 'Add', 0]).evaluate().operator).toBe(
      'Reduce'
    );
  });

  test('GCD of an enumeration-declined collection stays symbolic', () => {
    expect(ce.box(['GCD', DECLINED]).evaluate().operator).toBe('GCD');
  });

  // A genuinely EMPTY collection is not "declined" and still folds away.
  test('Sum of an empty collection is 0', () => {
    expect(
      ce
        .box(['Sum', ['List']])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('Sum of a filter with no matches is 0', () => {
    expect(
      ce
        .box([
          'Sum',
          ['Filter', ['List', 1, 2, 3], ['Function', ['Greater', 'x', 9], 'x']],
        ])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('Length of an empty collection is 0', () => {
    expect(
      ce
        .box(['Length', ['List']])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('Length of an infinite collection stays symbolic', () => {
    expect(ce.box(['Length', ['Repeat', 5]]).evaluate().operator) //
      .toBe('Length');
  });
});

describe('a DECLINED enumeration is not an EMPTY one', () => {
  //
  // The absent-datum gate (`library/missing-data.ts`) used to judge a
  // collection empty whenever walking it produced nothing. But a collection
  // can report a definite size and still decline to enumerate:
  // `Linspace(a, 1, 3)` HAS three elements — with a symbolic endpoint none of
  // them has a computable value. Reading that as empty fired the gate and made
  // `Max(Linspace(a, 1, 3))` answer `NaN`, a wrong VALUE, while the very same
  // shape stayed symbolic everywhere else (`Sum(Linspace(a, 1, 3))`,
  // `Max(Range(a, 3))`).
  //
  // A declined operand is now UNDECIDABLE to the gate, which passes it to the
  // operator's own handler to keep symbolic. A genuinely empty collection
  // reports `isEmptyCollection === true`, is not "declined", and still gives
  // `NaN` — that distinction is what these tests hold apart.
  //
  const ce = new ComputeEngine();
  /** Three elements, none of them computable: declined, NOT empty. */
  const DECLINED = ['Linspace', 'a', 1, 3];

  test('Max of a declined collection stays symbolic', () => {
    expect(ce.box(['Max', DECLINED]).evaluate().operator).toBe('Max');
  });

  test('Min of a declined collection stays symbolic', () => {
    expect(ce.box(['Min', DECLINED]).evaluate().operator).toBe('Min');
  });

  test('Max of a symbolic-bound Range stays symbolic (unchanged)', () => {
    expect(ce.box(['Max', ['Range', 'a', 3]]).evaluate().operator).toBe('Max');
  });

  test('Mean of a declined collection stays symbolic', () => {
    expect(ce.box(['Mean', DECLINED]).evaluate().operator).toBe('Mean');
  });

  test('Median of a declined collection stays symbolic', () => {
    expect(ce.box(['Median', DECLINED]).evaluate().operator).toBe('Median');
  });

  test('Max over a lazy Map of a declined collection stays symbolic', () => {
    expect(
      ce
        .box(['Max', ['Map', ['Function', ['Add', 'x', 1], 'x'], DECLINED]])
        .evaluate().operator
    ).toBe('Max');
  });

  // The absence rule itself is untouched: these are absent or empty, not
  // declined, and must still answer NaN.
  test('Max of an empty collection is still NaN', () => {
    expect(
      ce
        .box(['Max', ['List']])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });

  test('Max of a Missing operand is still NaN', () => {
    expect(ce.box(['Max', 'Missing']).evaluate().toString()).toBe('NaN');
  });

  test('Mean of an empty collection is still NaN', () => {
    expect(
      ce
        .box(['Mean', ['List']])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });

  test('Mean of ordinary data is unchanged', () => {
    expect(
      ce
        .box(['Mean', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('2');
  });

  // A declined operand alongside a scalar: the scalar supplies data, so the
  // gate never fired here even before, and the result is unchanged.
  test('Min of a declined collection and a scalar is unchanged', () => {
    expect(
      ce
        .box(['Min', ['Map', ['Function', ['Add', 'x', 1], 'x'], DECLINED], 5])
        .evaluate().operator
    ).toBe('Min');
  });
});

describe('Linspace extrema come from BOTH endpoints', () => {
  //
  // `Linspace(start, end, count)` spreads its elements from one endpoint to the
  // other inclusive, and the run may DESCEND. `Max`/`Min` took a fixed operand
  // — `end` for the maximum, `start` for the minimum — which is only right for
  // an ascending run: `Linspace(5, 1, 3)` is [5, 3, 1], and the engine answered
  // `Max` = 1 and `Min` = 5, both of them the wrong end. The extremum is now
  // taken over the two endpoints, which also makes a symbolic endpoint
  // (unorderable) decline instead of guessing.
  //
  const ce = new ComputeEngine();
  const maxOf = (mj: unknown) => ce.box(['Max', mj]).evaluate().toString();
  const minOf = (mj: unknown) => ce.box(['Min', mj]).evaluate().toString();

  test('ascending Linspace [1, 2, 3]', () => {
    expect(maxOf(['Linspace', 1, 3, 3])).toBe('3');
    expect(minOf(['Linspace', 1, 3, 3])).toBe('1');
  });

  test('descending Linspace [5, 3, 1]', () => {
    expect(maxOf(['Linspace', 5, 1, 3])).toBe('5');
    expect(minOf(['Linspace', 5, 1, 3])).toBe('1');
  });

  test('one-operand Linspace runs from 1', () => {
    expect(maxOf(['Linspace', 5])).toBe('5');
    expect(minOf(['Linspace', 5])).toBe('1');
  });

  // The COUNT decides which endpoints are actually sampled. A single-sample
  // Linspace sits at `start` and never reaches `end`, so both extrema are
  // `start` — reading them off the two endpoints answered `end` for the
  // maximum of a collection whose only element is `start`.
  test('single-sample Linspace is just its start', () => {
    expect(maxOf(['Linspace', 1, 5, 1])).toBe('1');
    expect(minOf(['Linspace', 1, 5, 1])).toBe('1');
    expect(maxOf(['Linspace', 5, 1, 1])).toBe('5');
    expect(minOf(['Linspace', 5, 1, 1])).toBe('5');
  });

  // No samples at all: an empty collection, absent by the aggregate rule.
  test('zero-sample Linspace is NaN', () => {
    expect(maxOf(['Linspace', 1, 5, 0])).toBe('NaN');
    expect(minOf(['Linspace', 1, 5, 0])).toBe('NaN');
  });

  // A count that is not statically known leaves the sample set unknown, so
  // neither endpoint can be claimed as the extremum.
  test('symbolic-count Linspace stays symbolic', () => {
    expect(ce.box(['Max', ['Linspace', 1, 5, 'm']]).evaluate().operator) //
      .toBe('Max');
    expect(ce.box(['Min', ['Linspace', 1, 5, 'm']]).evaluate().operator) //
      .toBe('Min');
  });
});

describe('an aggregate walks its lazy operand exactly once', () => {
  //
  // The statistics family used to enumerate the same operand two or three
  // times per evaluation: the absent-datum gate walked it, then the
  // symbolic-datum check walked it, then the exact/float data extraction
  // walked it again. `Mean(Map(f, xs))` ran `f` twice per element on top of the
  // gate's walk. The family now collects its data ONCE (`collectData`) and
  // shares that array across every path.
  //
  test('Mean over a lazy Map: 3 elements, 3 runs', () => {
    expect(run(`let s = Mean(Map((x) => x + t1(), [1, 2, 3]))\n(s, n)`)) //
      .toBe('(3, 3)');
  });

  test('Median over a lazy Map: 3 elements, 3 runs', () => {
    expect(run(`let s = Median(Map((x) => x + t1(), [1, 2, 3]))\n(s, n)`)) //
      .toBe('(3, 3)');
  });

  test('Variance over a lazy Map: 3 elements, 3 runs', () => {
    expect(run(`let s = Variance(Map((x) => x + t1(), [1, 2, 3]))\n(s, n)`)) //
      .toBe('(1, 3)');
  });

  // `Max`/`Min` over a lazy Filter were N+1: the absent-datum gate skipped its
  // own walk (the element type rules an absent datum out) but then asked
  // `isEmptyCollection` to decide the empty-input case, and `Filter.isEmpty`
  // enumerates its source up to the first match. The gate now declines that
  // question and the extremum fold, which walks the data anyway, owns it.
  test('Max over a lazy Filter: 3 elements, 3 runs', () => {
    expect(run(`let s = Max(Filter([1, 2, 3], (x) => b1()))\n(s, n)`)) //
      .toBe('(3, 3)');
  });

  test('Min over a lazy Filter: 3 elements, 3 runs', () => {
    expect(run(`let s = Min(Filter([1, 2, 3], (x) => b1()))\n(s, n)`)) //
      .toBe('(1, 3)');
  });

  // A `number`-typed element CAN be a NaN, so the gate does not skip its walk
  // here — it enumerates and short-circuits on the absent datum it finds. One
  // walk, three runs; pinned so the skip's type test is not widened to
  // `number` (which would let a real absent datum through).
  test('an aggregate over number-typed elements still walks once', () => {
    expect(run(`let s = Max(Map((x) => x + t1(), [1, 2, NaN]))\n(s, n)`)) //
      .toBe('(NaN, 3)');
    expect(run(`let s = Mean(Map((x) => x + t1(), [1, 2, NaN]))\n(s, n)`)) //
      .toBe('(NaN, 3)');
  });
});
