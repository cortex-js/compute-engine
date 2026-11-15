/**
 * ROADMAP CE-35 made a component read of a tuple local type the parameter
 * it holds: in `g(s) = do { let q = (s, 0); take(q[1], 2) }`, the read
 * `q[1]` narrowed `s` to a list, and `g([1, 2, 3])` took the list whole.
 *
 * Since the user decision of 2026-11-14 a copy of a parameter into a local
 * (`let q = s`, `let q = (s, 0)`, `let (a, b) = (s, 0)`) is not a use of the
 * parameter: only a direct use decides whether a list argument is taken
 * whole. These programs are applied to each element of the list, and a
 * parameter declared `list` takes it whole.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

function run(source: string): { value: string; signature: string } {
  const ce = new ComputeEngine();
  const { value } = executeEpsil(ce, source);
  return { value: value.toString(), signature: ce.box('g').type.toString() };
}

describe('A COMPONENT READ OF A TUPLE LOCAL (CE-35)', () => {
  test.each([
    ['g(s) = do { let q = (s, 0); take(q[1], 2) }'],
    ['g(s) = do { let q = (0, s); take(q[2], 2) }'],
    ['g(s) = do { let q = (0, s); take(q[-1], 2) }'],
    ['g(s) = do { let (a, b) = (s, 0); take(a, 2) }'],
  ])('%s is applied to each element of a list', (definition) => {
    const { value, signature } = run(`${definition}\ng([1, 2, 3])`);
    expect(value).toMatch(/^\[Error\(ErrorCode\("incompatible-type"/);
    expect(signature.startsWith('(s: unknown) ->')).toBe(true);
  });

  test.each([
    ['g(s: list) = do { let q = (s, 0); take(q[1], 2) }'],
    ['g(s: list) = do { let (a, b) = (s, 0); take(a, 2) }'],
  ])('%s takes a list argument whole', (definition) => {
    const { value } = run(`${definition}\ng([1, 2, 3])`);
    expect(value).toBe('[1,2]');
  });

  test('a numeric use of the component maps over a list', () => {
    const { value } = run(
      'g(s) = do { let q = (s, 0); q[1] + 1 }\ng([1, 2, 3])'
    );
    expect(value).toBe('[2,3,4]');
  });
});
