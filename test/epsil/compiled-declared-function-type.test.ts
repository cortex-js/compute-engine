import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// The interpreter checks each argument of a call against the declared type
// of its parameter: `g(1.5)` is an `incompatible-type` error when `g` is
// declared `(integer) -> integer` (by `let g: (integer) -> integer = …`, or
// by the annotation `function g(k: integer)`). The compiled code must not give
// a value there:
//
// - an argument that cannot be of the type fails the compilation;
// - any other argument is not tested: compiled code assumes that the value
//   holds the parameter type (rule R5 of
//   `docs/plans/2026-10-31-static-shape-compilation.md`). A value outside
//   the type gives an unspecified result: the interpreter gives an error
//   that the static type of the call does not show.
//
// The declared RESULT type is not checked, as before: it is a promise of
// the host.
//

type Value = unknown;

const compileProgram = (source: string, to = 'javascript') => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('xs', 'list<real>');
  return compile(ce.box(parseEpsil(source)[0] as never), {
    to,
    fallback: false,
  } as never) as unknown as {
    success: boolean;
    code: string;
    run: (vars?: Record<string, Value>) => Value;
  };
};

function interpret(source: string): { value: Value; errors: number } {
  const { value } = executeEpsil(new ComputeEngine(), source);
  const json = value.json;
  // The number of `incompatible-type` errors in the value.
  return {
    value: json,
    errors: JSON.stringify(json).split("'incompatible-type'").length - 1,
  };
}
const ASSIGNED = 'let g: (integer) -> integer = (k) => k + 1\n';
const ANNOTATED = 'function g(k: integer) { k + 1 }\n';

describe.each([
  ['a `let` declaration with a function value', ASSIGNED],
  ['a parameter annotation', ANNOTATED],
])('A CALL OF A FUNCTION DECLARED (integer) -> integer: %s', (_, head) => {
  test('an argument that cannot be an integer is refused', () => {
    expect(interpret(head + 'g(1.5)').errors).toBe(1);
    expect(() => compileProgram(head + 'g(1.5)')).toThrow(
      /Could not compile|incompatible-type/
    );
    expect(() => compileProgram(head + 'g(1.5)', 'interval-js')).toThrow(
      /Could not compile/
    );
  });
});

describe('OTHER DECLARED PARAMETER TYPES', () => {
  // `real<0<..>` is x > 0 and `real<..<3>` is x < 3: the bound itself is not
  // a value of the type. Before 2026-10-19 the interpreter admitted it
  // (`g(0)` gave a value).
  test.each([
    ['let g: (real<0<..>) -> real = (k) => k + 1\n', 0, 0.5],
    ['function g(k: real<0<..>) { k + 1 }\n', 0, 0.5],
    ['let g: (real<..<3>) -> real = (k) => k + 1\n', 3, 2.5],
  ])('an excluded bound is refused: %s', (head, bound, inside) => {
    expect(interpret(head + `g(${bound})`).errors).toBe(1);
    expect(interpret(`let x = ${bound}\n` + head + 'g(x)').errors).toBe(1);
    expect(interpret(head + `g(${inside})`).value).toBe(inside + 1);
  });

  test('an excluded bound is refused by the interpreter on every route', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(real<0<..>) -> any');
    ce.assign('g', ce.box(['Function', 5, 'k']));
    expect(ce.box(['g', 0]).evaluate().operator).toBe('Error');
    expect(ce.box(['g', 0]).N().operator).toBe('Error');
    expect(ce.box(['g', 0.5]).evaluate().toString()).toBe('5');
    ce.assign('x', 0);
    expect(ce.box(['g', 'x']).evaluate().operator).toBe('Error');
  });
});

describe('A FUNCTION DECLARED IN THE ENGINE', () => {
  const engine = (type: string) => {
    const ce = new ComputeEngine();
    ce.declare('g', type);
    ce.assign('g', ce.box(['Function', ['Add', 'k', 1], 'k']));
    ce.declare('n', 'integer');
    return ce;
  };
  const build = (ce: ComputeEngine, expr: unknown, to: string) =>
    compile(ce.box(expr as never), {
      to,
      fallback: false,
    } as never) as unknown as {
      success: boolean;
      run: (vars?: Record<string, Value>) => Value;
    };

  test('an undeclared input has the type inferred from the call', () => {
    // The engine infers the type `integer` for the free `x` from the call
    // `g(x)`. The static type is the contract (rules R1 and R5 of
    // `docs/plans/2026-10-31-static-shape-compilation.md`): the host
    // supplies an integer, and the call is not tested. A value outside
    // the type (`1.5`) gives an unspecified result.
    const ce = engine('(integer) -> integer');
    expect(build(ce, ['g', 'x'], 'javascript').run({ x: 2 })).toBe(3);
    expect(build(ce, ['g', 'x'], 'interval-js').run({ x: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
    for (const to of ['glsl'])
      expect(build(ce, ['g', 'x'], to).success).toBe(true);
  });

  test('a declared argument that proves the type still compiles on a shader', () => {
    const ce = engine('(integer) -> integer');
    expect(build(ce, ['g', 'n'], 'glsl').success).toBe(true);
  });

  test('a real parameter is not tested on a shader, as before', () => {
    const ce = engine('(real) -> real');
    expect(build(ce, ['g', 'x'], 'glsl').success).toBe(true);
  });
});
