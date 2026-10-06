import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The result type of an overloaded call on an untyped parameter. An untyped
// parameter refutes no arm of an overload set, so the call can take any of
// the remaining arms at run time, and its result type is the join of their
// results (`resolvedArm` in `src/compute-engine/boxed-expression/
// boxed-function.ts`). Before, the result type was read off one arm: `slice`
// on an untyped parameter was typed as a list, and a string consumer refused
// the call before the program ran.
//

function run(source: string): ReturnType<typeof executeEpsil> {
  return executeEpsil(new ComputeEngine(), source);
}

describe('EPSIL — overloaded result type on an untyped parameter', () => {
  test('a string consumer accepts a slice of an untyped parameter', () => {
    const { value, diagnostics } = run(
      'firstTwo(s) = characters(slice(s, 1, 2))\nfirstTwo("abc")'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('["a","b"]');
  });

  test('the same function applied to a list slices the list', () => {
    const { value, diagnostics } = run(
      'firstTwo(s) = slice(s, 1, 2)\nfirstTwo([7, 8, 9])'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[7,8]');
  });
});

describe('EPSIL — a length call on an untyped parameter', () => {
  test('does not change how a later lambda over the parameter is typed', () => {
    // `length(xs)` narrows `xs` to `collection`. Before, the later
    // `first(xs)` then retyped `xs` as `matrix` (the fresh-matrix repair in
    // `validate.ts`), so `p` was a row and the comparison lambda was refused.
    const { value, diagnostics } = run(
      [
        'smaller(xs) = do {',
        '  let n = length(xs)',
        '  let p = first(xs)',
        '  listFrom(filter(xs, x => x < p))',
        '}',
        'smaller([3, 1, 2])',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[1,2]');
  });
});

describe('EPSIL — overloaded result type on a parameter narrowed by length', () => {
  // `length(s)` narrows the untyped `s` to `collection`. A collection can be
  // a string, so `slice` and `take` on it are typed `list<…> | string`, and a
  // string consumer accepts them.
  test('slices of a string parameter', () => {
    const { value, diagnostics } = run(
      [
        'slices(s, n) = map(i => map(c => numberFrom(String(c)), characters(slice(s, i, i + n - 1))), 1..(length(s) - n + 1))',
        'slices("49142", 3)',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[[4,9,1],[9,1,4],[1,4,2]]');
  });

  test('characters of a take after a length', () => {
    const { value, diagnostics } = run(
      'f(s) = do { let n = length(s); characters(take(s, 2)) }\nf("abc")'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('["a","b"]');
  });
});
