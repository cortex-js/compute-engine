import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * CE-122. With a protocol `Comparator` that declares `compare` and no
 * protocol `Comparable`, `Comparable.compare("a", "b")` is the dot-call
 * `compare(Comparable, "a", "b")`, which has one argument too many. The error
 * was the arity error of that call ("unexpected argument"), which does not say
 * that `Comparable` is not a protocol. It is now a `protocol-unknown` error.
 */

const PROTOCOL = `protocol Comparator { function compare(a: Self, b: Self) -> integer }
type string is Comparator { function compare(a, b) -> integer { -1 } }`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  executeEpsil(ce, PROTOCOL);
  return ce;
}

describe('CE-122: a qualified call on a name that is not a protocol', () => {
  test('the Epsil route gives a protocol-unknown error value', () => {
    const ce = engine();
    const result = executeEpsil(ce, 'Comparable.compare("a", "b")');
    const value = result.value!;
    expect(value.operator).toBe('Error');
    expect(JSON.stringify(value.json)).toContain('protocol-unknown');
    expect(value.toString()).toContain('`Comparable` is not a protocol');
  });

  test('the raw engine route gives the same error value', () => {
    const ce = engine();
    const expr = ce.box([
      'MemberCall',
      'Comparable',
      { str: 'compare' },
      { str: 'a' },
      { str: 'b' },
    ]);
    const value = expr.evaluate();
    expect(value.operator).toBe('Error');
    expect(JSON.stringify(value.json)).toContain('protocol-unknown');
  });

  test('the qualified call on the declared protocol still works', () => {
    const ce = engine();
    expect(executeEpsil(ce, 'Comparator.compare("a", "b")').value?.json).toBe(
      -1
    );
  });

  test('a dot-call on a parameter keeps the arity error', () => {
    const ce = engine();
    const result = executeEpsil(
      ce,
      'function g(a, b, c) { a.compare(b, c) }\ng("p", "q", "r")'
    );
    const text = JSON.stringify(result.diagnostics);
    expect(text).toContain('unexpected-argument');
    expect(text).not.toContain('protocol-unknown');
  });
});
