import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A leaf of a destructuring `let` whose initializer is a tuple literal
// takes the component at its position: in `let (a, b) = (s, 0)`, `a` holds
// the value of the parameter `s`. A copy of a parameter into a local is not
// a use of the parameter (user decision 2026-11-14): a use of `a` as a list
// (`take(a, 2)`) says nothing about `s`, as `let a = s` does not, so a call
// with a list argument is applied to each element. A parameter declared
// `list` takes it whole.
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
    // The same function with a plain copy, for reference.
    ['g(s) = do { let a = s; take(a, 2) }'],
  ])('%s is applied to each element of a list', (definition) => {
    const { value, signature } = run(`${definition}\ng([1, 2, 3])`);
    expect(value).toMatch(/^\[Error\(ErrorCode\("incompatible-type"/);
    expect(signature.startsWith('(s: unknown) ->')).toBe(true);
  });

  test.each([
    ['g(s: list) = do { let (a, b) = (s, 0); take(a, 2) }'],
    ['g(s: list) = do { let (a, (b, c)) = (0, (1, s)); take(c, 2) }'],
  ])('%s binds a list argument whole', (definition) => {
    const { value } = run(`${definition}\ng([1, 2, 3])`);
    expect(value).toBe('[1,2]');
  });

  test('an infinite lazy argument is bound whole by a declared parameter', () => {
    const { value } = run(
      'let t = 1..oo\ng(s: list) = do { let (t, u) = (s, 0); take(t, 2) }\ng(map(x => x * 2, t))'
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
