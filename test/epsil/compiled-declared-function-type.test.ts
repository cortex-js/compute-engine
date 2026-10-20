import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// The interpreter checks each argument of a call against the declared type
// of its parameter: `g(1.5)` is an `incompatible-type` error when `g` is
// declared `(integer) -> integer` (by `let g: (integer) -> integer`, or by
// the annotation `function g(k: integer)`). The compiled code must not give
// a value there:
//
// - an argument that cannot be of the type fails the compilation;
// - an argument whose static type proves the type is not tested;
// - any other argument is tested at run time on the JavaScript target (the
//   call answers `NaN`, the value compiled code has where the interpreter
//   answers an error) and on the interval target (the call is `empty`);
// - a target with no test for the type refuses the call.
//
// The declared RESULT type is not checked, as before: it is a promise of
// the host.
//

type Value = unknown;

const compileProgram = (source: string, to = 'javascript') =>
  compile(new ComputeEngine().box(parseEpsil(source)[0] as never), {
    to,
    fallback: false,
  } as never) as unknown as {
    success: boolean;
    code: string;
    run: (vars?: Record<string, Value>) => Value;
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
const ASSIGNED = 'let g: (integer) -> integer\ng = (k) => k + 1\n';
const ANNOTATED = 'function g(k: integer) { k + 1 }\n';

describe.each([
  ['a `let` declaration then a definition', DECLARED],
  ['a `let` declaration then an assignment', ASSIGNED],
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
    // Only the compiled code writes the local, and each value that it
    // assigns is an integer (`assignmentsProveType`).
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

  test('a local with an assigned value that is not an integer is tested', () => {
    for (const source of [
      head + 'let n = 3\nn = 1.5\ng(n)',
      head + 'let n = 3\nfunction w() scope { n = 1.5 }\nw()\ng(n)',
      head + 'let n = 3\nfor k in 1..2 { n = n + 0.5 }\ng(n)',
      head + 'let n = x\ng(n)',
    ]) {
      const c = compileProgram(source);
      expect(c.code).toContain('Number.isInteger');
    }
    expect(interpret(head + 'let n = 3\nn = 1.5\ng(n)').errors).toBe(1);
    expect(js(head + 'let n = 3\nn = 1.5\ng(n)')).toBeNaN();
  });

  test('an input is tested at run time', () => {
    // The interpreter, given the value of the input.
    expect(interpret('let x = 1.5\n' + head + 'g(x)').errors).toBe(1);
    expect(interpret('let x = 2\n' + head + 'g(x)').value).toBe(3);
    const c = compileProgram(head + 'g(x)');
    expect(c.code).toContain('Number.isInteger');
    expect(c.run({ x: 1.5 })).toBeNaN();
    expect(c.run({ x: 2 })).toBe(3);
    expect(interval(head + 'g(x)', { x: 1.5 })).toEqual({ kind: 'empty' });
    expect(interval(head + 'g(x)', { x: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
  });

  test('a list argument is tested element by element', () => {
    const run = interpret('let xs = [1, 1.5]\n' + head + 'g(xs)');
    expect(run.errors).toBe(1);
    expect((run.value as Value[])[1]).toBe(2);
    expect(js(head + 'g(xs)', { xs: [1, 1.5] })).toEqual([2, NaN]);
    expect(js(head + 'g(xs)', { xs: [1, 2] })).toEqual([2, 3]);
  });

  test('a real parameter of an enclosing function is tested', () => {
    const source = head + 'function h(y: real) { g(y) }\nh(x)';
    expect(
      interpret('let x = 1.5\n' + head + 'function h(y: real) { g(y) }\nh(x)')
        .errors
    ).toBe(1);
    expect(js(source, { x: 1.5 })).toBeNaN();
    expect(js(source, { x: 4 })).toBe(5);
  });
});

describe('OTHER DECLARED PARAMETER TYPES', () => {
  test('a ranged integer type is tested with its bounds', () => {
    const head = 'let g: (integer<0..>) -> integer\nfunction g(k) { k + 1 }\n';
    expect(interpret('let x = -1\n' + head + 'g(x)').errors).toBe(1);
    expect(js(head + 'g(x)', { x: -1 })).toBeNaN();
    expect(js(head + 'g(x)', { x: 2.5 })).toBeNaN();
    expect(js(head + 'g(x)', { x: 4 })).toBe(5);
    expect(interval(head + 'g(x)', { x: -1 })).toEqual({ kind: 'empty' });
    // An interval argument is restricted to the values of the type:
    // `[-2.5, 3.5]` holds the admitted values 0, 1, 2 and 3. The function
    // has a value at these values only, so the result is `partial`.
    expect(interval(head + 'g(x)', { x: { lo: -2.5, hi: 3.5 } })).toEqual({
      kind: 'partial',
      value: { lo: 1, hi: 4 },
      domainClipped: 'both',
    });
    // An interval that the bounds hold whole is still `partial`: there is
    // no value between two integers.
    expect(interval(head + 'g(x)', { x: { lo: 1, hi: 3 } })).toEqual({
      kind: 'partial',
      value: { lo: 2, hi: 4 },
      domainClipped: 'both',
    });
  });

  test('a bounded real type is tested with its bounds', () => {
    const head = 'let g: (real<0..>) -> real\nfunction g(k) { k + 1 }\n';
    expect(interpret('let x = -0.5\n' + head + 'g(x)').errors).toBe(1);
    expect(js(head + 'g(x)', { x: -0.5 })).toBeNaN();
    expect(js(head + 'g(x)', { x: 0.5 })).toBe(1.5);
    expect(interval(head + 'g(x)', { x: -0.5 })).toEqual({ kind: 'empty' });
    // The function has a value on `[0, 2]` only: the result is `partial`.
    expect(interval(head + 'g(x)', { x: { lo: -1, hi: 2 } })).toEqual({
      kind: 'partial',
      value: { lo: 1, hi: 3 },
      domainClipped: 'both',
    });
    // An interval that the bounds hold whole has a value everywhere.
    expect(interval(head + 'g(x)', { x: { lo: 0.5, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: 1.5, hi: 3 },
    });
  });

  test('a clipped argument makes a constant result partial', () => {
    // The result does not read the argument, but the function has no value
    // on the part of the input box that the type excludes.
    const head = 'function g(x: real<0..>) { 1 }\n';
    expect(interval(head + 'g(x)', { x: { lo: -1, hi: 1 } })).toEqual({
      kind: 'partial',
      value: { lo: 1, hi: 1 },
      domainClipped: 'both',
    });
    expect(interval(head + 'g(x)', { x: { lo: 0.5, hi: 1 } })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 1 },
    });
  });

  test('a clipped argument makes each element of a list result partial', () => {
    const head = 'function g(x: real<0..>) { [x, 1] }\n';
    expect(interval(head + 'g(x)', { x: { lo: -1, hi: 1 } })).toEqual([
      { kind: 'partial', value: { lo: 0, hi: 1 }, domainClipped: 'both' },
      { kind: 'partial', value: { lo: 1, hi: 1 }, domainClipped: 'both' },
    ]);
  });

  // `real<0<..>` is x > 0 and `real<..<3>` is x < 3: the bound itself is not
  // a value of the type. Before 2026-10-19 the interpreter and the compiled
  // JavaScript test admitted it (`g(0)` gave a value).
  test.each([
    ['let g: (real<0<..>) -> real\nfunction g(k) { k + 1 }\n', 0, 0.5],
    ['function g(k: real<0<..>) { k + 1 }\n', 0, 0.5],
    ['let g: (real<..<3>) -> real\nfunction g(k) { k + 1 }\n', 3, 2.5],
  ])('an excluded bound is refused: %s', (head, bound, inside) => {
    expect(interpret(head + `g(${bound})`).errors).toBe(1);
    expect(interpret(`let x = ${bound}\n` + head + 'g(x)').errors).toBe(1);
    expect(interpret(head + `g(${inside})`).value).toBe(inside + 1);
    expect(js(head + 'g(x)', { x: bound })).toBeNaN();
    expect(js(head + 'g(x)', { x: inside })).toBe(inside + 1);
    expect(interval(head + 'g(x)', { x: bound })).toEqual({ kind: 'empty' });
    expect(interval(head + 'g(x)', { x: inside })).toEqual({
      kind: 'interval',
      value: { lo: inside + 1, hi: inside + 1 },
    });
  });

  test('an interval that reaches an excluded bound only at the bound is empty', () => {
    const head = 'let g: (real<0<..>) -> real\nfunction g(k) { k + 1 }\n';
    expect(interval(head + 'g(x)', { x: { lo: -1, hi: 0 } })).toEqual({
      kind: 'empty',
    });
    // A wider interval keeps the bound as its endpoint: a closed interval
    // that encloses every admitted value. The result is `partial`.
    expect(interval(head + 'g(x)', { x: { lo: -1, hi: 2 } })).toEqual({
      kind: 'partial',
      value: { lo: 1, hi: 3 },
      domainClipped: 'both',
    });
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

  test('a type with no run-time test is refused when an argument can break it', () => {
    const head = 'let g: (rational) -> real\nfunction g(k) { k + 1 }\n';
    expect(() => compileProgram(head + 'g(x)')).toThrow(
      /Could not compile a call of `g`.*`rational`.*no run-time test/
    );
    expect(compileProgram(head + 'g(x)', 'interval-js').success).toBe(false);
    // An argument whose type proves it still compiles.
    expect(js(head + 'g(1)')).toBe(2);
  });

  test('the declared result type is not checked', () => {
    // The body breaks the result type, and the interpreter gives the
    // value of the body.
    const source = 'let g: (real) -> integer\nfunction g(k) { k + 1 }\ng(1.5)';
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

  test('an undeclared input is tested at run time', () => {
    const ce = engine('(integer) -> integer');
    expect(build(ce, ['g', 'x'], 'javascript').run({ x: 1.5 })).toBeNaN();
    expect(build(ce, ['g', 'x'], 'javascript').run({ x: 2 })).toBe(3);
    expect(build(ce, ['g', 'x'], 'interval-js').run({ x: 1.5 })).toEqual({
      kind: 'empty',
    });
  });

  test('a target with no test refuses the call', () => {
    const ce = engine('(integer) -> integer');
    for (const to of ['glsl', 'wgsl', 'python'])
      expect(() => build(ce, ['g', 'x'], to)).toThrow(
        /Could not compile a call of `g`.*`integer`.*no run-time test/
      );
  });

  test('a declared argument that proves the type still compiles on a shader', () => {
    const ce = engine('(integer) -> integer');
    expect(build(ce, ['g', 'n'], 'glsl').success).toBe(true);
    expect(build(ce, ['g', 'n'], 'wgsl').success).toBe(true);
  });

  test('a real parameter is not tested on a shader, as before', () => {
    const ce = engine('(real) -> real');
    expect(build(ce, ['g', 'x'], 'glsl').success).toBe(true);
    expect(build(ce, ['g', 'x'], 'wgsl').success).toBe(true);
  });
});
