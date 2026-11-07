/**
 * CE-325: a call of a user function declares its parameters, and each
 * declaration makes the type cache of the expressions in the body out of
 * date. Each test of the type of an application in the body therefore derives
 * that type again, at each call. Four tests that ran at each call now read a
 * cheaper fact first, when that fact decides the answer:
 *
 * - `isDictionary()` answers for a dictionary node without its type: the
 *   type of such a node always matches `dictionary<any>`. `let m = n * 2` is
 *   `Declare(m, {value: n * 2})`, and `Declare` tests its last operand.
 * - The broadcast after evaluation tests for an indexed collection operand
 *   before it reads the broadcast exemptions of the operator, which read the
 *   type of each operand.
 * - A comparison of two operands evaluates both whatever their shape, so it
 *   tests their shape only for the near-tie test of `.N()`.
 * - The tuple broadcast tests for a collection before it tests for a tuple.
 *
 * The values must not change. These tests hold the results of the cases where
 * the cheaper fact does not decide, so the type is still read.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isDictionary } from '../../src/compute-engine/boxed-expression/utils';

function run(source: string): string {
  const result = executeEpsil(new ComputeEngine(), source);
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual(
    []
  );
  return result.value!.toString();
}

describe('CE-325: a dictionary node is a dictionary without its type', () => {
  const ce = new ComputeEngine();
  const literals: unknown[] = [
    ['Dictionary'],
    ['Dictionary', ['KeyValuePair', "'a'", 1]],
    ['Dictionary', ['KeyValuePair', "'a b'", 1]],
    ['Dictionary', ['KeyValuePair', "'a'", ['Error', "'x'"]]],
    ['Dictionary', ['KeyValuePair', "'a b'", ['Error', "'x'"]]],
    ['Dictionary', ['KeyValuePair', "'a'", 'Missing']],
    ['Dictionary', ['KeyValuePair', "'a'", 'Nothing']],
    ['Dictionary', ['KeyValuePair', "'value'", ['Multiply', 'n', 2]]],
    { dict: { a: 1, b: 'x' } },
    { dict: {} },
  ];
  test.each(literals.map((x) => [JSON.stringify(x), x]))(
    '%s: the answer agrees with the type',
    (_, json) => {
      const d = ce.box(json as any);
      expect(isDictionary(d)).toBe(d.type.matches('dictionary<any>'));
      expect(isDictionary(d)).toBe(true);
    }
  );

  test('a block local in a function body', () => {
    expect(
      run('f(n) = do { let m = n * 2; m % 3 == 0 }\nlistFrom(filter(1..10, f))')
    ).toBe('[3,6,9]');
    expect(
      run('f(n) = do { let m: integer = n + 1; m }\nmap(f, [1, 2, 3])')
    ).toBe('[2,3,4]');
  });

  test('a declaration with attributes', () => {
    expect(
      ce
        .box([
          'Block',
          [
            'Declare',
            'z',
            [
              'Dictionary',
              ['KeyValuePair', "'type'", "'integer'"],
              ['KeyValuePair', "'value'", 7],
            ],
          ],
          'z',
        ])
        .evaluate()
        .toString()
    ).toBe('7');
  });
});

describe('CE-325: a comparison in a function body', () => {
  test('an operand that becomes a list broadcasts', () => {
    expect(run('f(n) = 1..n > 1\nf(3)')).toBe('["False","True","True"]');
  });
  test('two lists compare whole', () => {
    expect(run('f(n) = 1..n == [1, 2, 3]\nf(3)')).toBe('"True"');
    expect(run('f(n) = [n, n] == [n, n]\nf(3)')).toBe('"True"');
  });
  test('a chain over a list broadcasts', () => {
    expect(run('f(n) = 0 < 1..n < 3\nf(3)')).toBe('["True","True","False"]');
  });
  test('a chain of scalars', () => {
    expect(run('f(n) = 0 < n < 3\nlistFrom(filter(-2..5, f))')).toBe('[1,2]');
  });
  test('a string compares whole', () => {
    expect(run('f(s) = s < "m"\n(f("a"), f("z"))')).toBe('("True", "False")');
    expect(run('w(c) = c == " "\n(w(" "), w("a"))')).toBe('("True", "False")');
  });
  test('under N(), a list operand of a pair', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Less', ['List', 1, 2], 1.5]).N().toString()).toBe(
      '["True","False"]'
    );
    expect(ce.box(['Less', 0, ['List', 1, 5], 3]).N().toString()).toBe(
      '["True","False"]'
    );
  });
});

describe('CE-325: a conjunction and a tuple in a function body', () => {
  test('a conjunction of scalar comparisons', () => {
    expect(run('f(n) = n > 1 && n < 4\nlistFrom(filter(1..6, f))')).toBe(
      '[2,3]'
    );
  });
  test('a conjunction over a list is element-wise', () => {
    expect(run('f(n) = 1..n > 1 && true\nf(3)')).toBe(
      '["False","True","True"]'
    );
  });
  test('a function of a tuple is component-wise', () => {
    expect(run('p(n) = (n, n + 1)\nf(n) = sin(p(n))\nf(0)')).toBe(
      '(0, sin(1))'
    );
  });
});
