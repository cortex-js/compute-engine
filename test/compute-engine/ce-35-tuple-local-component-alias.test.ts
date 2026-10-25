/**
 * ROADMAP CE-35: a component read of a tuple local did not type the
 * parameter it holds.
 *
 * `g(s) = do { let q = (s, 0); take(q[1], 2) }` applied to `[1, 2, 3]` gave
 * element-wise `incompatible-type` errors: the read `q[1]` did not say that
 * `s` is a list, so `s` kept a scalar parameter type and the call mapped
 * over its argument. A destructuring `let (a, b) = (s, 0)` already made `a`
 * an alias of `s`. The `let` now remembers the tuple literal, and a read of
 * the local at a literal index narrows the symbol at that position
 * (`narrowTupleInitializerComponent`, `library/collections.ts`).
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
    // A negative index counts from the end.
    ['g(s) = do { let q = (0, s); take(q[-1], 2) }'],
    // The destructuring form, for reference.
    ['g(s) = do { let (a, b) = (s, 0); take(a, 2) }'],
  ])('%s binds a list argument whole', (definition) => {
    const { value, signature } = run(`${definition}\ng([1, 2, 3])`);
    expect(value).toBe('[1,2]');
    expect(signature.startsWith('(indexed_collection<any>) ->')).toBe(true);
  });

  test('a numeric use of the component keeps a scalar parameter', () => {
    const { value, signature } = run(
      'g(s) = do { let q = (s, 0); q[1] + 1 }\ng([1, 2, 3])'
    );
    expect(value).toBe('[2,3,4]');
    expect(signature).toBe('(unknown) -> number');
  });

  test('an assignment to the local before the read ends the alias', () => {
    const { signature } = run(
      'g(s) = do { let q = (s, 0); q = (1, 2); take(q[1], 2) }'
    );
    expect(signature.startsWith('(unknown) ->')).toBe(true);
  });
});
