import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A leaf of a destructuring `let` whose initializer is a tuple literal
// takes the component at its position: in `let (a, b) = (s, 0)`, `a` holds
// the value of the parameter `s`. A use of `a` as a list (`take(a, 2)`)
// then types `s` as a collection, as `let a = s` does, so a call with a list
// argument binds the list whole instead of applying the function to each
// element (`recordPatternAliases`, the `Declare` canonical handler in
// src/compute-engine/library/core.ts).
//

function run(source: string): { value: string; signature: string } {
  const ce = new ComputeEngine();
  const { value } = executeEpsil(ce, source);
  return { value: value.toString(), signature: ce.box('g').type.toString() };
}

describe('A DESTRUCTURED PARAMETER IS AN ALIAS OF THE PARAMETER', () => {
  test.each([
    ['g(s) = do { let (a, b) = (s, 0); take(a, 2) }'],
    ['g(s) = do { let (a, (b, c)) = (0, (1, s)); take(c, 2) }'],
    // The same function with a plain alias, for reference.
    ['g(s) = do { let a = s; take(a, 2) }'],
  ])('%s binds a list argument whole', (definition) => {
    const { value, signature } = run(`${definition}\ng([1, 2, 3])`);
    expect(value).toBe('[1,2]');
    expect(signature.startsWith('(indexed_collection<any>) ->')).toBe(true);
  });

  test('an infinite lazy argument is bound whole', () => {
    const { value } = run(
      'let t = 1..oo\ng(s) = do { let (t, u) = (s, 0); take(t, 2) }\ng(map(x => x * 2, t))'
    );
    expect(value).toBe('[2,4]');
  });

  test('a parameter the body does not use as a list still broadcasts', () => {
    // A use as a tuple component says nothing about the parameter, so the
    // function keeps the default of an unannotated parameter: a list
    // argument is applied element by element.
    const { value } = run('g(s) = do { let (a, b) = (s, 0); 1 }\ng([1, 2, 3])');
    expect(value).toBe('[1,1,1]');
  });
});
