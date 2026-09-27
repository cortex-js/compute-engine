import { ComputeEngine } from '../../src/compute-engine';

// A lazy collection view (`Join`, `Append`, `Reverse`, `Drop`, `Filter`, …)
// whose source is an EAGER collection operator (`Sort`, `Unique`, …) must
// report its finiteness. An eager operator has no collection handlers until it
// is evaluated, so its `isFiniteCollection` is `undefined`; a view that read
// that facet directly was not known to be finite, and `Sum`, which does not
// walk a collection of unknown finiteness, stayed unevaluated:
// `Sum(Join([3], Sort([2, 1])))` stayed symbolic while `Sum(Sort([2, 1]))`
// was 3. The views now read their source through `mapSource`
// (`library/collections.ts`), which evaluates an eager source.

const ce = new ComputeEngine();

const S = ['Sort', ['List', 2, 1]];

describe('a lazy view over an eager collection operator', () => {
  test.each([
    [['Sum', ['Join', ['List', 3], S]], 6],
    [['Sum', ['Join', ['List', 3], ['List', 2, 1]]], 6],
    [['Sum', S], 3],
    [['Length', ['Join', ['List', 3], S]], 3],
    [['Sum', ['Join', S, ['List', 3]]], 6],
    [['Sum', ['Append', S, 3]], 6],
    [['Sum', ['Join', ['List', 3], ['Unique', ['List', 2, 1, 2]]]], 6],
    [['Product', ['Join', ['List', 3], S]], 6],
    [['Sum', ['Reverse', S]], 3],
    [['Sum', ['Drop', S, 1]], 2],
    [['Sum', ['Rest', S]], 2],
    [['Sum', ['Most', S]], 1],
    [['Sum', ['Filter', S, ['Function', ['Greater', 'x', 0], 'x']]], 3],
  ] as [any, number][])('box route: %j', (json, expected) => {
    expect(ce.box(json).evaluate().json).toEqual(expected);
  });

  test('function route, pre-boxed operands', () => {
    const expr = ce.function('Sum', [
      ce.function('Join', [ce.box(['List', 3]), ce.box(S as any)]),
    ]);
    expect(expr.evaluate().json).toEqual(6);
  });

  test('parse route', () => {
    const expr = ce.parse(
      '\\sum \\operatorname{Join}([3], \\operatorname{Sort}([2,1]))'
    );
    expect(expr.json).toEqual(['Sum', ['Join', ['List', 3], S]]);
    expect(expr.evaluate().json).toEqual(6);
  });

  test('a view over an eager operator whose source is valueless stays symbolic', () => {
    const local = new ComputeEngine();
    local.declare('xs', 'list<integer>');
    const expr = local.box(['Sum', ['Join', ['List', 3], ['Sort', 'xs']]]);
    expect(expr.evaluate().json).toEqual([
      'Sum',
      ['Join', ['List', 3], ['Sort', 'xs']],
    ]);
  });

  // An absent operand makes the whole `Join` absent (user decision
  // 2026-09-26): unchanged by the finiteness fix.
  test('Join(Missing, [3]) stays absent', () => {
    const result = ce.box(['Join', 'Missing', ['List', 3]]).evaluate();
    expect(result.symbol).toBe('Missing');
  });

  // A finiteness query is a metadata read and must not evaluate an expensive
  // eager source: `Unique(Range(1, 100000))` tallies every element against
  // the distinct ones seen so far, and evaluating it to learn that `Reverse`
  // of it is finite took 46 seconds. An eager library operator over finite
  // collection operands is finite by construction, so the answer is derived
  // from the operands without the evaluation.
  test('the finiteness of a view over an expensive eager source is derived without evaluating it', () => {
    const start = Date.now();
    const view = ce.box(['Reverse', ['Unique', ['Range', 1, 100000]]]);
    expect(view.isFiniteCollection).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  // The guards of `eagerViewSource` (a pure library operator whose operands
  // are not unevaluated applications) keep a recursive list builder from
  // re-evaluating the rest of its recursion at every facet read. With
  // `F(n) = Join([n], Sort(F(n + 1)))` the `Sort` source holds the
  // unevaluated call `F(n + 1)`, so no facet read evaluates it; the builder
  // is evaluated once, top down, and answers in linear time.
  test('a recursive builder whose tail is under an eager operator evaluates once per level', () => {
    const engine = new ComputeEngine();
    engine.declare('F', '(number) -> list<number>');
    engine.assign(
      'F',
      engine.box([
        'Function',
        [
          'Which',
          ['Equal', 'n', 12],
          ['List', 'n'],
          'True',
          ['Join', ['List', 'n'], ['Sort', ['F', ['Add', 'n', 1]]]],
        ],
        'n',
      ])
    );
    const start = Date.now();
    const result = engine.box(['F', 0]).evaluate();
    expect(Array.from(result.each(), (x) => x.re)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
