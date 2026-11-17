import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// CE-1389. A destructuring of a value that has a tuple type but did not
// evaluate to a tuple (`svd` of an exact matrix stays `SVD(…)` until `N`)
// is the error `unevaluated-tuple`, not the type error "expected `tuple`,
// got `tuple<…>`".
//

function run(source: string): ReturnType<typeof executeEpsil> {
  return executeEpsil(new ComputeEngine(), source);
}

describe('CE-1389: destructuring a value that did not evaluate to a tuple', () => {
  test('a `let` of an unevaluated `svd` names the value and `N`', () => {
    const { diagnostics } = run('let (U, S, V) = svd([[1, 2], [3, 4]])\nU');
    expect(diagnostics.map((d) => d.message[0])).toEqual(['runtime-error']);
    expect(diagnostics[0].message[3]).toBe('unevaluated-tuple');
    expect(diagnostics[0].message[1]).toBe(
      '`SVD([[1,2],[3,4]])` did not evaluate to a tuple, so it cannot be destructured; if `SVD` needs numeric input, write `N(…)`'
    );
  });

  test('a symbol with no value gets no `N` hint', () => {
    const { diagnostics } = run('let p: tuple<real, real>\nlet (a, b) = p\na');
    const error = diagnostics.find((d) => d.message[0] === 'runtime-error')!;
    expect(error.message[3]).toBe('unevaluated-tuple');
    expect(error.message[1]).toBe(
      '`p` did not evaluate to a tuple, so it cannot be destructured'
    );
  });

  test('an arity that the type shows to be wrong is the arity error', () => {
    const { diagnostics } = run('let (U, S) = svd([[1, 2], [3, 4]])\nU');
    expect(diagnostics[0].message[3]).toBe('incompatible-type');
    expect(diagnostics[0].message[1]).toContain(
      'expected `tuple<unknown, unknown>`'
    );
  });

  test('a `for` pattern and a `let` in a function give the same error', () => {
    const loop = run(
      'let n = 0\nfor (U, S, V) in [svd([[1, 2], [3, 4]])] { n = n + 1 }\nn'
    );
    expect(loop.diagnostics[0].message[3]).toBe('unevaluated-tuple');
    expect(loop.value.re).toBe(0);

    const { value } = run(
      'function f(m) {\n  let (U, S, V) = svd(m)\n  U\n}\nf([[1, 2], [3, 4]])'
    );
    expect(value.operator).toBe('Error');
    expect(value.toString()).toContain('unevaluated-tuple');
  });

  test('with `N`, the destructuring binds the three matrices', () => {
    const { value, diagnostics } = run(
      'let (U, S, V) = N(svd([[1, 2], [3, 4]]))\nS'
    );
    expect(diagnostics).toEqual([]);
    expect(value.operator).toBe('List');
  });

  test('a value whose type is not a tuple type is still a type error', () => {
    const { diagnostics } = run('let (a, b) = 5\na');
    expect(diagnostics[0].message[3]).toBe('incompatible-type');
  });

  test('the engine route gives the error code with the value as its site', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Declare',
        ['Tuple', 'U', 'S', 'V'],
        [
          'Dictionary',
          [
            'KeyValuePair',
            { sym: 'value' },
            ['SVD', ['List', ['List', 1, 2], ['List', 3, 4]]],
          ],
        ],
      ] as any)
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('unevaluated-tuple');
    expect(r.toString()).toContain('SVD');
  });
});
