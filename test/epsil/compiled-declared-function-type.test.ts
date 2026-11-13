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

const js = (source: string, vars: Record<string, Value> = {}) =>
  compileProgram(source).run(vars);

const interval = (source: string, vars: Record<string, Value> = {}) =>
  compileProgram(source, 'interval-js').run(vars);

const DECLARED = 'let g: (integer) -> integer\nfunction g(k) { k + 1 }\n';
const ASSIGNED = 'let g: (integer) -> integer = (k) => k + 1\n';
const ANNOTATED = 'function g(k: integer) { k + 1 }\n';

describe('A `let` DECLARATION THEN A DEFINITION', () => {
  test('a program compiled as one block declares `g` twice', () => {
    // At the top level of a program, the declaration gives the signature of
    // the function. The compiled program is one block, where the function
    // statement declares the local `g` a second time.
    expect(interpret(DECLARED + 'g(1)').value).toBe(2);
    expect(() => compileProgram(DECLARED + 'g(1)')).toThrow(
      /variable-redeclaration/
    );
  });
});

describe.each([
  ['a `let` declaration with a function value', ASSIGNED],
  ['a parameter annotation', ANNOTATED],
])('A CALL OF A FUNCTION DECLARED (integer) -> integer: %s', (_, head) => {
  test('an argument that cannot be an integer is refused', () => {
    expect(interpret(head + 'g(1.5)').errors).toBe(1);
    expect(() => compileProgram(head + 'g(1.5)')).toThrow(
      /Could not compile|incompatible-type/
    );
    expect(compileProgram(head + 'g(1.5)', 'interval-js').success).toBe(false);
  });

  test('an integer literal compiles as before, without a test', () => {
    expect(interpret(head + 'g(1)').value).toBe(2);
    const c = compileProgram(head + 'g(1)');
    expect(c.run()).toBe(2);
    expect(c.code).not.toContain('Number.isInteger');
    expect(interval(head + 'g(1)')).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });

  test('a local declared integer is not tested', () => {
    const source = head + 'let n: integer = 3\ng(n)';
    expect(interpret(source).value).toBe(4);
    const c = compileProgram(source);
    expect(c.run()).toBe(4);
    expect(c.code).not.toContain('Number.isInteger');
  });

  test('a local whose assigned values are integers is not tested', () => {
    // The static type of the local is `integer`, which is the contract
    // (rule R1 of `docs/plans/2026-10-31-static-shape-compilation.md`).
    for (const [source, value] of [
      [head + 'let n = 3\ng(n)', 4],
      [head + 'let n = 3\nn = 5\ng(n)', 6],
      [head + 'let n = 3\nlet m = n\ng(m)', 4],
    ] as const) {
      expect(interpret(source).value).toBe(value);
      const c = compileProgram(source);
      expect(c.run()).toBe(value);
      expect(c.code).not.toContain('Number.isInteger');
    }
  });

  test('a local with an assigned value that is not an integer is not tested', () => {
    // The static type of `n` is real, which holds integers: the call
    // compiles with no test. The interpreter gives an error for `1.5`,
    // which the static type of the call does not show, so the compiled
    // value is unspecified there.
    for (const source of [
      head + 'let n = 3\nn = 1.5\ng(n)',
      head + 'let n = 3\nfor k in 1..2 { n = n + 0.5 }\ng(n)',
    ])
      expect(compileProgram(source).success).toBe(true);
    expect(js(head + 'let n = x\ng(n)', { x: 2 })).toBe(3);
    // A function that the code calls and that assigns a name outside it
    // declines with the `unsettled-shape` decline.
    expect(() =>
      compileProgram(
        head + 'let n = 3\nfunction w() scope { n = 1.5 }\nw()\ng(n)'
      )
    ).toThrow(
      /a function \(stored, returned, or a user function that the code calls\) assigns a name of an enclosing scope/
    );
    expect(interpret(head + 'let n = 3\nn = 1.5\ng(n)').errors).toBe(1);
  });

  test('a real input is not tested', () => {
    // The interpreter, given the value of the input.
    expect(interpret('let x = 1.5\n' + head + 'g(x)').errors).toBe(1);
    expect(interpret('let x = 2\n' + head + 'g(x)').value).toBe(3);
    expect(js(head + 'g(x)', { x: 2 })).toBe(3);
    expect(interval(head + 'g(x)', { x: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
  });

  test('a list of reals is not tested', () => {
    const run = interpret('let xs = [1, 1.5]\n' + head + 'g(xs)');
    expect(run.errors).toBe(1);
    expect((run.value as Value[])[1]).toBe(2);
    expect(js(head + 'g(xs)', { xs: [1, 2] })).toEqual([2, 3]);
  });

  test('a real parameter of an enclosing function is not tested', () => {
    const source = head + 'function h(y: real) { g(y) }\nh(x)';
    expect(
      interpret('let x = 1.5\n' + head + 'function h(y: real) { g(y) }\nh(x)')
        .errors
    ).toBe(1);
    expect(js(source, { x: 2 })).toBe(3);
  });
});

describe('OTHER DECLARED PARAMETER TYPES', () => {
  test('a ranged integer type is not tested', () => {
    const head = 'let g: (integer<0..>) -> integer = (k) => k + 1\n';
    expect(interpret('let x = -1\n' + head + 'g(x)').errors).toBe(1);
    expect(js(head + 'g(x)', { x: 1 })).toBe(2);
    expect(interval(head + 'g(x)', { x: 1 })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });

  test('a bounded real type is not tested', () => {
    const head = 'let g: (real<0..>) -> real = (k) => k + 1\n';
    expect(interpret('let x = -0.5\n' + head + 'g(x)').errors).toBe(1);
    expect(js(head + 'g(x)', { x: 0.5 })).toBe(1.5);
    expect(interval(head + 'g(x)', { x: 0.5 })).toEqual({
      kind: 'interval',
      value: { lo: 1.5, hi: 1.5 },
    });
  });

  test('an annotated bounded real parameter is not tested', () => {
    const head = 'function g(x: real<0..>) { 1 }\n';
    expect(compileProgram(head + 'g(x)', 'interval-js').success).toBe(true);
  });

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
    // The compiled call is not tested: a value of the type gives the
    // interpreter's value.
    expect(js(head + 'g(x)', { x: inside })).toBe(inside + 1);
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

  test('a rational parameter is not tested', () => {
    const head = 'let g: (rational) -> real = (k) => k + 1\n';
    expect(js(head + 'g(x)', { x: 0.5 })).toBe(1.5);
    expect(compileProgram(head + 'g(x)', 'interval-js').success).toBe(true);
    expect(js(head + 'g(1)')).toBe(2);
  });

  test('the declared result type is not checked', () => {
    // The body breaks the result type, and the interpreter gives the
    // value of the body.
    const source = 'let g: (real) -> integer = (k) => k + 1\ng(1.5)';
    expect(interpret(source).value).toBe(2.5);
    expect(js(source)).toBe(2.5);
    expect(interval(source)).toEqual({
      kind: 'interval',
      value: { lo: 2.5, hi: 2.5 },
    });
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
