import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A user function used by name as a callback (`filter(1..5000, isEven)`) is
// applied to each element without boxing an application `isEven(n)` per
// element (user decision 2026-10-17, option B of the ROADMAP entry "A user
// function applied per element of a lazy collection costs about 100 µs per
// application"). The direct application keeps the decisions of the boxed
// call: argument validation, absent arguments, errors of the body, the
// recursion limit and effects. The expected values below are the values of
// the boxed route, measured before the change.
//

const DEFINITIONS = [
  'isEven(n) = n % 2 == 0',
  'add(a, b) = a + b',
  'function typed(x: integer) { x + 1 }',
  'function num(x: number) { x + 1 }',
  'function half(x) { x / 2 }',
  'function inv(x) { 1 / x }',
  'function fact(n) { if n <= 1 { 1 } else { n * fact(n - 1) } }',
  'function pair(n) { [n, n] }',
  'function upTo(n) { 1..n }',
  'function strlen(s) { length(s) }',
  'function both(a, b) { a * b }',
  'function loop(n) { loop(n + 1) }',
].join('\n');

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  executeEpsil(ce, DEFINITIONS, {
    parseLatex: (l: string) => ce.parse(l).json,
  });
  return ce;
}

function run(ce: ComputeEngine, program: string): string {
  const { value } = executeEpsil(ce, program, {
    parseLatex: (l: string) => ce.parse(l).json,
  });
  return value.toString();
}

describe('NAMED CALLBACK — DIRECT APPLICATION', () => {
  test('the application of a named callback is not boxed', () => {
    const ce = engine();
    const spy = jest.spyOn(ce, 'function');
    const result = ce
      .box(['Filter', ['Range', 1, 10], 'isEven'])
      .evaluate()
      .toString();
    expect(result).toBe('[2,4,6,8,10]');
    expect(spy.mock.calls.filter(([name]) => name === 'isEven')).toEqual([]);
    spy.mockRestore();
  });

  test.each<[string, string]>([
    ['filter(1..20, isEven)', '[2,4,6,8,10,12,14,16,18,20]'],
    ['count(filter(1..100, isEven))', '50'],
    ['reduce(1..10, add)', '55'],
    ['sum(map(fact, 1..8))', '46233'],
    ['take(map(fact, 1..1000), 3)', '[1,2,6]'],
    ['map(half, [1, 2, 3])', '[1/2,1,3/2]'],
    ['map(half, [1/3, 2^100])', '[1/6,633825300114114700748351602688]'],
    ['map(inv, [0, 1, 2])', '[~oo,1,1/2]'],
    ['map(pair, [1, 2])', '[[1,1],[2,2]]'],
    ['map(upTo, [2, 3])', '[[1,2],[1,2,3]]'],
    ['map(strlen, ["ab", "c"])', '[2,1]'],
    ['map(both, [1, 2], [3, 4])', '[3,8]'],
    ['map(half, [x, 2])', '[1/2 * x,1]'],
  ])('%s', (program, expected) => {
    expect(run(engine(), program)).toBe(expected);
  });

  test('an argument refused by an annotated parameter is the error of the boxed call', () => {
    expect(run(engine(), 'map(typed, [1, 2.5, 3])')).toBe(
      '[2,Error(ErrorCode("incompatible-type", "integer", "2.5"), 2.5),4]'
    );
  });

  test('an absent argument at a numeric parameter is NaN', () => {
    expect(run(engine(), 'map(num, [1, missing, 3])')).toBe('[2,NaN,4]');
  });

  test('an argument that the predicate cannot read is the error of the boxed call', () => {
    expect(run(engine(), 'filter([1, "a", 3], isEven)')).toBe(
      '[Error(ErrorCode("incompatible-type", "real", "string"), "a")]'
    );
  });

  test('an unbounded recursion stops at the recursion limit', () => {
    expect(run(engine(), 'map(loop, [1])')).toMatch(/recursion-depth-exceeded/);
  });

  test('a function with effects is applied once per element', () => {
    const ce = new ComputeEngine();
    const { value, diagnostics } = executeEpsil(
      ce,
      [
        'let calls = 0',
        'function tick(n) scope { calls = calls + 1; n }',
        'let total = sum(map(tick, [1, 2, 3]))',
        'calls',
      ].join('\n'),
      { parseLatex: (l: string) => ce.parse(l).json }
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(3);
  });

  test('a redefinition is seen by the next walk', () => {
    const ce = engine();
    expect(run(ce, 'filter(1..6, isEven)')).toBe('[2,4,6]');
    run(ce, 'isEven(n) = n % 3 == 0');
    expect(run(ce, 'filter(1..6, isEven)')).toBe('[3,6]');
  });
});
