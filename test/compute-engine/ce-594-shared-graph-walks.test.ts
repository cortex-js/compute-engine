/**
 * CE-594.1: the walks over an expression that a function literal holds
 * read each node once, not once per path.
 *
 * `Max(e, e)` nested 30 deep has 31 distinct nodes and 2^30 paths. A walk
 * that follows every path does not finish (or runs out of memory), while a
 * walk that reads each node once takes a few milliseconds. Each test
 * therefore measures its time: a jest time limit cannot stop a synchronous
 * test, and a slow walk would otherwise pass after minutes. The limit of
 * 2 s is far above the expected time, so a loaded machine does not fail it.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const DEPTH = 30;

/** `Max(t, t)` nested `depth` deep over `leaf`. */
function tower(ce: ComputeEngine, leaf: Expression, depth = DEPTH): Expression {
  let t = leaf;
  for (let i = 0; i < depth; i++) t = ce.function('Max', [t, t]);
  return t;
}

function timed<T>(f: () => T): [T, number] {
  const start = performance.now();
  const value = f();
  return [value, performance.now() - start];
}

describe('CE-594.1: shared subexpressions in function literals', () => {
  test('a user function whose body calls another user function in a shared tower is typed in linear time', () => {
    // The recursion check of a user function (`callsReach()`) walks the
    // body and the bodies of the functions it calls.
    const ce = new ComputeEngine();
    ce.assign(
      'g',
      ce.function('Function', [ce.box(['Add', 'u', 1]), ce.symbol('u')])
    );
    const x = ce.symbol('x');
    const body = tower(ce, ce.function('g', [x]));
    ce.assign('h', ce.function('Function', [body, x]));
    const [type, ms] = timed(() => ce.box(['h', 2]).type.toString());
    expect(type).toBe('number');
    expect(ms).toBeLessThan(2000);
  });

  test('assigning a function literal that holds a shared tower takes linear time and memory', () => {
    // `ce.assign` looks for the name of the function in its own literal
    // (a recursive definition). It serialized the literal to MathJSON, which
    // writes out every path, and ran out of memory at depth 30.
    const ce = new ComputeEngine();
    const x = ce.symbol('x');
    const literal = ce.function('Function', [
      tower(ce, ce.box(['Add', 'x', 'y'])),
      x,
    ]);
    const [, ms] = timed(() => ce.assign('f', literal));
    expect(ms).toBeLessThan(2000);
  });

  test('a recursive definition is still found through a shared tower', () => {
    // The name search that replaced the MathJSON serialization must still
    // see a self-call deep in the tower. The depth is small: assigning a
    // recursive literal re-boxes it, and canonicalization still turns the
    // shared tower into a tree (CE-594), so this test does not measure time.
    const ce = new ComputeEngine();
    const n = ce.symbol('n');
    const leaf = ce.function('If', [
      ce.function('Less', [n, ce.number(1)]),
      ce.number(0),
      ce.function('r', [ce.function('Subtract', [n, ce.number(1)])]),
    ]);
    ce.assign('r', ce.function('Function', [tower(ce, leaf, 4), n]));
    expect(ce.box(['r', 3]).evaluate().toString()).toBe('0');
  });
});

describe('CE-594.1: the name search of a recursive literal', () => {
  test('a self-call only inside a dictionary value is found', () => {
    // A dictionary has no operands: its values are read explicitly. The
    // assignment must see `f` in `{a: f(n - 1)}` and declare `f` first, so
    // that the call binds to the new definition.
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'If',
          ['Less', 'n', 1],
          ['Dictionary', ['KeyValuePair', "'a'", 0]],
          ['Dictionary', ['KeyValuePair', "'a'", ['f', ['Subtract', 'n', 1]]]],
        ],
        'n',
      ])
    );
    expect(ce.box(['f', 2]).evaluate().toString()).toBe(
      '{"a" -> {"a" -> {"a" -> 0}}}'
    );
  });
});
