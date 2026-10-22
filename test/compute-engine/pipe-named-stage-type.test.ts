/**
 * The static type of a `Pipe` whose stage is the name of a library operator
 * (`16 |> Sqrt`, `xs |> Sort`). `x |> f` is `f(x)`, so the pipe is typed as
 * that call. `Pipe` is `lazy`, so the stage arrives unbound and its own type
 * is `unknown`: before, every such pipe was typed `unknown`, and the Epsil
 * static check could not see `let s: string = 16 |> sqrt`.
 *
 * A user name (`x |> f`) is not typed: the held name can only be looked up
 * where the type is read, and a function parameter with the same name is
 * the function the pipe calls (`pipeNamedStageType`, `library/core.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { executeEpsil } from '../../src/epsil/execute-epsil';

function check(
  ce: ComputeEngine,
  json: any,
  expected: string
): { static: string; value: string } {
  const pipe = ce.box(json);
  const value = pipe.evaluate();
  // Every value the pipe takes is in its static type.
  expect(isSubtype(value.type.type, pipe.type.type)).toBe(true);
  expect(pipe.type.toString()).toBe(expected);
  return { static: pipe.type.toString(), value: value.toString() };
}

describe('a pipe whose stage is an operator name', () => {
  test('is typed as the call of that operator', () => {
    const ce = new ComputeEngine();
    check(ce, ['Pipe', 16, 'Sqrt'], 'real');
    check(ce, ['Pipe', 'x', 'Sin'], 'number');
    check(ce, ['Pipe', "'ab'", 'Length'], 'integer');
    check(ce, ['Pipe', ['List', 3, 1, 2], 'Sort'], 'list<integer>');
  });

  test('gets the broadcast lift of the operator', () => {
    const ce = new ComputeEngine();
    const { value } = check(ce, ['Pipe', ['List', 1, 4, 9], 'Sqrt'], 'vector<3>');
    expect(value).toBe('[1,2,3]');
  });

  test('a chain reads the type of the inner pipe', () => {
    const ce = new ComputeEngine();
    check(ce, ['Pipe', ['Pipe', 16, 'Sqrt'], 'Sqrt'], 'complex');
  });

  test('an opaque or undefined stage stays `unknown`', () => {
    const ce = new ComputeEngine();
    check(ce, ['Pipe', 3, 'Hold'], 'unknown');
    check(ce, ['Pipe', 3, 'notDefinedHere'], 'unknown');
  });
});

describe('a pipe whose stage is a user name', () => {
  // The stage is held unbound, so its name could only be looked up where the
  // type is read. A function parameter with the same name is the function
  // the pipe calls, so a user name is not typed (`resolvesToSystemBinding`).
  test('is not typed', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^2'));
    check(ce, ['Pipe', 3, 'f'], 'unknown');
    // `[1, 2] |> f` maps the function over the list.
    const { value } = check(ce, ['Pipe', ['List', 1, 2], 'f'], 'unknown');
    expect(value).toBe('[1,4]');
  });

  test('a parameter that has the name of a global is not typed by the global', () => {
    // `G := F ↦ (3 |> F)` with a global `F: (number) -> string`: `G(Sqrt)`
    // calls the parameter, and its value is `√3`, not a string.
    const ce = new ComputeEngine();
    ce.declare('F', {
      signature: '(number) -> string',
      evaluate: () => ce.string('s'),
    });
    ce.assign('G', ce.box(['Function', ['Pipe', 3, 'F'], 'F']));
    const call = ce.box(['G', 'Sqrt']);
    expect(isSubtype(call.evaluate().type.type, call.type.type)).toBe(true);
    expect(call.type.toString()).not.toBe('string');
  });
});

describe('the type read is pure', () => {
  test('a re-derivation advances no cache axis', () => {
    const ce = new ComputeEngine();
    ce.declare('L1', 'list<integer>');
    const pipe = ce.box(['Pipe', 'L1', 'Sort']);
    expect(pipe.type.toString()).toBe('list<integer>');
    let drift = 0;
    for (let i = 0; i < 5; i++) {
      ce.declare(`z${i}`, 'number');
      const before = ce._anyVersion;
      pipe.type;
      drift += ce._anyVersion - before;
    }
    expect(drift).toBe(0);
  });
});

describe('the Epsil static check', () => {
  const run = (source: string) => {
    const r = executeEpsil(new ComputeEngine(), source);
    return {
      value: r.value.toString(),
      diagnostics: r.diagnostics.map((d) =>
        Array.isArray(d.message) ? d.message.join(' ') : String(d.message)
      ),
    };
  };

  test('reports a declaration the piped call cannot satisfy', () => {
    const r = run('let s: string = 16 |> sqrt\ns');
    expect(r.diagnostics.join('\n')).toMatch(
      /static-type-error The value "Pipe\(16, sqrt\)" of type "real" is not compatible with the declared type "string"/
    );
  });

  test('accepts a declaration the piped call satisfies', () => {
    expect(run('let r: number = 16 |> sqrt\nr')).toEqual({
      value: '4',
      diagnostics: [],
    });
    expect(
      run('let g = (x) => x + 1\nlet n: integer = 3 |> g\nn')
    ).toEqual({ value: '4', diagnostics: [] });
  });
});
