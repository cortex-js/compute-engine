import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// The static type of a `Match` is the join of the types of its case bodies.
// The bodies are raw, so a body that is not a literal makes the `Match`
// `unknown` (CE-1731).

function run(source: string): { value: unknown; type: string } {
  const r = executeEpsil(new ComputeEngine(), source);
  expect(r.diagnostics).toEqual([]);
  return { value: r.value?.json, type: r.value?.type.toString() ?? '' };
}

describe('the static type of a Match', () => {
  test('a recursive function whose base case is not a literal', () => {
    expect(
      run(
        'function fac(n) { match n { == 0 => n + 1; _ => n * fac(n - 1) } }\nfac(3)'
      ).value
    ).toBe(6);
  });

  test('a recursive function whose base case is a literal', () => {
    expect(
      run(
        'function fac(n) { match n { == 0 => 1; _ => n * fac(n - 1) } }\nfac(5)'
      ).value
    ).toBe(120);
  });

  test('a case that is not a literal makes the result unknown', () => {
    const half =
      'function half(s: string, t: real) { match s { == "a" => t / 2; _ => 0 } }\n';
    expect(run(half + 'half').type).toBe('(s: string, t: real) -> unknown');
    expect(run(half + 'half("a", 3)').value).toEqual(['Rational', 3, 2]);
  });

  test('cases that are all literals give the join of their types', () => {
    expect(
      run('function k(n) { match n { == 0 => 1; _ => "a" } }\nk').type
    ).toBe('(n: unknown) -> integer | string');
  });

  test('without a case that takes every value, the result is unknown', () => {
    // The value at `n = 3` is `Error("match-no-case", 3)`.
    expect(
      run('function g(n) { match n { == 0 => 1; == 1 => 2 } }\ng').type
    ).toBe('(n: unknown) -> unknown');
    expect(
      run('function g(n) { match n { == 0 => 1; _ if n > 5 => 2 } }\ng').type
    ).toBe('(n: unknown) -> unknown');
    expect(run('function g(n) { match n { == 0 => 1; m => 2 } }\ng').type).toBe(
      '(n: unknown) -> integer'
    );
  });

  test('a call of a function whose result is unknown is not typed nothing', () => {
    // The walk of the body at the call typed each case `nothing`.
    expect(
      run('function f(n) { match n { _ => n * 2 } }\nf(3) + 1').value
    ).toBe(7);
  });
});
