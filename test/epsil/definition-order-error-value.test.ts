import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// With `a(x, y) = x + y`, the body of `g(t) = 2a(t)` is a type error: `a(t)`
// is a partial application, a function, and `2a(t)` multiplies a number by
// it. The error is an error VALUE in either order of the two definitions.
// When `a` comes first, the definition of `g` evaluates to the error. When
// `g` comes first, the definition of `a` rebuilds the body of `g`, and the
// definition of `a` evaluates to the error of the rebuilt body. It was a
// thrown "Invalid function", which the program reported as a runtime error
// with that message and no error code.

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

/** The `runtime-error` diagnostics of `source`: `[description, code]`. */
function runtimeErrors(source: string): [unknown, unknown][] {
  return run(source)
    .diagnostics.filter(
      (d) => Array.isArray(d.message) && d.message[0] === 'runtime-error'
    )
    .map((d) => [d.message[1], d.message[3]]);
}

const TYPE_ERROR = 'expected `number`, got `(unknown) -> number` at `a(t)`';

describe('A TYPE ERROR OF A BODY IS AN ERROR VALUE IN EITHER DEFINITION ORDER', () => {
  test('the callee first: the definition of the caller is the error', () => {
    expect(runtimeErrors('a(x, y) = x + y\ng(t) = 2a(t)\n0')).toEqual([
      [TYPE_ERROR, 'incompatible-type'],
    ]);
  });

  test('the caller first: the definition of the callee is the error', () => {
    expect(runtimeErrors('g(t) = 2a(t)\na(x, y) = x + y\n0')).toEqual([
      [TYPE_ERROR, 'incompatible-type'],
    ]);
  });

  test('the error is the value of the definition of the callee', () => {
    const { value } = run('g(t) = 2a(t)\na(x, y) = x + y');
    expect(value.operator).toBe('Error');
    expect(JSON.stringify(value.json)).toContain('incompatible-type');
  });
});
