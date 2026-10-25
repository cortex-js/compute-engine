import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil';
import { compiledMapDoubles } from '../../src/compute-engine/library/collections';
import {
  _mapAutoCompileStats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/map-auto-compile-stats';

// ROADMAP CE-432: `Sum(Map(f, xs))`, when the auto-compilation compiles `f`
// (`map-auto-compile.ts`), is summed on the doubles of the elements
// (`compiledMapTotal` in src/compute-engine/library/arithmetic.ts), without
// boxing each element. The sum must be the one the element-by-element fold
// gives: the first element, then `add()` of each later element in order.

/** The engine and the `Map` of an Epsil expression `map(…)`. */
function mapOf(source: string, machine = true): BoxedExpression {
  const ce = new ComputeEngine();
  if (machine) ce.precision = 'machine';
  return executeEpsil(ce, source).value;
}

/** The sum that the fold gives for `map`: each element as the walk of the
 * `Map` gives it, added in order with `add()`. */
function foldSum(map: BoxedExpression): BoxedExpression {
  let acc: BoxedExpression | undefined;
  for (const x of map.each()) acc = acc === undefined ? x : acc.add(x);
  return acc!;
}

const expectSameNumber = (a: BoxedExpression, b: BoxedExpression) => {
  expect(Object.is(a.re, b.re)).toBe(true);
  expect(a.im).toBe(b.im);
  expect(a.isExact).toBe(b.isExact);
};

describe('CE-432: the sum of a compiled Map', () => {
  // The last column says whether the fast path takes the sum. When it
  // declines, the walk computes the sum, which must be the fold too.
  test.each([
    ['floats', 'map(x => N(sin(x) + x^2), 1..2000)', true],
    ['integer floats under N', 'map(x => N(x^2), 1..2000)', true],
    ['cancellation', 'map(x => N(x - x), [0.5, -0.5])', true],
    ['a slow decay', 'map(x => N(sin(x) / x), 1..20000)', true],
    ['a spine of two levels', 'map(x => N(2^x + 0.5), 1..60)', false],
    // `Floor` of an exact input is computed by the interpreter.
    ['a jump function', 'map(x => N(floor(x / 2)), 1..500)', false],
    // `1.5e16` is an integer past the safe range: the interpreter computes it.
    [
      'an integer past the safe range',
      'map(x => N(x * 1.5), [0.1, 0.2, 0.30000000000000004, 1e16, -1e16, 3])',
      false,
    ],
  ])('%s: the sum of the fold', (_, source, fast) => {
    const map = mapOf(source);
    expect(compiledMapDoubles(map) !== undefined).toBe(fast);
    const sum = map.engine.function('Sum', [map]).evaluate();
    expectSameNumber(sum, foldSum(map));
  });

  test.each([
    ['a complex element', 'map(x => N(sqrt(x)), [-4, 1, 4, 9])'],
    ['a pole', 'map(x => N(1/x), 0..10)'],
    ['a text element', 'map(x => N(x^2), [1, 2, "a"])'],
  ])('%s: the fast path declines', (_, source) => {
    expect(compiledMapDoubles(mapOf(source))).toBeUndefined();
  });

  test('a set source: the sum reads the deduplicated elements', () => {
    // `x^2` maps -1 and 1 to the same element of the set.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const map = ce.box([
      'Map',
      ['Function', ['N', ['Power', 'x', 2]], 'x'],
      ['Set', -1, 1, 2],
    ] as never);
    expect(compiledMapDoubles(map)).toBeUndefined();
    expect(ce.function('Sum', [map]).evaluate().re).toBe(5);
  });

  test('an impure body declines: the walk reads the element memo', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const map = executeEpsil(
      ce,
      'let m = map(x => N(x + random()), 1..100)\nm'
    ).value;
    expect(compiledMapDoubles(map)).toBeUndefined();
    // Two sums of one instance read the same draws.
    const a = executeEpsil(ce, 'sum(m)').value;
    const b = executeEpsil(ce, 'sum(m)').value;
    expect(a.re).toBe(b.re);
  });

  test('under N, an exact integer sum stays exact, as in the fold', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const map = ce.box([
      'Map',
      ['Function', ['Multiply', 2, 'x'], 'x'],
      ['Range', 1, 2000],
    ] as never);
    const n = ce
      .function('Sum', [map])
      .evaluate({ numericApproximation: true });
    ce.jit = 'off';
    const walked = ce
      .function('Sum', [ce.box(map.json as never)])
      .evaluate({ numericApproximation: true });
    expectSameNumber(n, walked);
  });

  test('an abort stops the asynchronous sum of a compiled Map', async () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const controller = new AbortController();
    setTimeout(() => controller.abort('stop'), 30);
    _resetMapAutoCompileStats();
    await expect(
      executeEpsilAsync(ce, 'sum(map(x => N(sin(x) + x^2), 1..5000000))', {
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'CancellationError', cause: 'stop' });
    // The abort stopped the reading of the elements before the end: fewer
    // elements were computed than the source holds. (A bound on the time
    // depended on the load of the machine.)
    expect(_mapAutoCompileStats.compiledHits).toBeLessThan(5_000_000);
  }, 30_000);

  test('a sum past the safe integers declines and stays exact', () => {
    // The exact sum of the cubes is past 2^53: the fold keeps it exact.
    const { value } = executeEpsil(
      new ComputeEngine(),
      'sum(map(x => x^3, 1..100000))'
    );
    expect(value.isExact).toBe(true);
    expect(value.toString()).toBe('250005000025e+8');
  });

  test('the default precision does not compile the marked tier', () => {
    expect(
      compiledMapDoubles(mapOf('map(x => N(sin(x)), 1..10)', false))
    ).toBeUndefined();
  });

  test('a symbol that holds the Map', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const r = executeEpsil(ce, 'let ys = map(x => N(x / 3), 1..999)\nsum(ys)');
    const map = ce.box('ys').evaluate();
    expectSameNumber(r.value, foldSum(map));
  });

  test('under N, the sum is a float', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const r = executeEpsil(ce, 'N(sum(map(x => N(x^2), 1..300)))');
    expect(r.value.isExact).toBe(false);
    expect(r.value.re).toBe(9045050);
  });

  test('the asynchronous route gives the same sum', async () => {
    const source = 'sum(map(x => N(cos(x) * exp(-x / 1000)), 1..5000))';
    const one = new ComputeEngine();
    one.precision = 'machine';
    const two = new ComputeEngine();
    two.precision = 'machine';
    const sync = executeEpsil(one, source).value;
    const async_ = (await executeEpsilAsync(two, source)).value;
    expectSameNumber(async_, sync);
  });
});
