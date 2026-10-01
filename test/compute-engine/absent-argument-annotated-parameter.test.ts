/**
 * An absent argument at a parameter of a function literal (user decisions of
 * 2026-09-30).
 *
 * 1. At evaluation, an absent value (`Missing`) at a parameter ANNOTATED
 *    with a type that has no `missing` member is an `incompatible-type`
 *    error. A numeric annotation (`number`, `integer`, `real`) reads the
 *    absent value as `NaN`, the absence marker of a numeric domain, and
 *    accepts `NaN`. At a bare parameter the body runs with the absent
 *    value. Before,
 *    a function whose parameters were all numeric or collections answered
 *    the absence marker (`NaN`, `Missing`) without running, and the type of
 *    the call gained a `missing` member.
 * 2. At boxing, the engine admits an argument typed `missing | T` at a
 *    parameter annotated `T`: its value is usually present.
 * 3. The Epsil static pre-pass is stricter: it reports such an argument,
 *    because an Epsil author can write the absent case out (`??`,
 *    `isMissing`, a parameter annotated `T | missing`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import {
  executeEpsil,
  parseEpsil,
  resolveLibraryNames,
} from '../../src/epsil';

/** A `first(filter(…))` that finds nothing (`> 9`) or the point (`> 0`). */
const ABSENT = 'first(filter([(1, 2)], c => c[1] > 9))';
const PRESENT = 'first(filter([(1, 2)], c => c[1] > 0))';

function box(src: string) {
  const [program, diagnostics] = parseEpsil(src);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const ce = new ComputeEngine();
  const expr: any = ce.box(resolveLibraryNames(program, src, ce));
  return { ce, expr, call: expr.ops[expr.ops.length - 1] };
}

function run(src: string): { value: string; diagnostics: string[] } {
  const result: any = executeEpsil(new ComputeEngine(), src);
  return {
    value: String(result.value ?? result.result),
    diagnostics: (result.diagnostics ?? []).map((d: any) => String(d.message)),
  };
}

function compiled(expr: any): unknown {
  const result = compile(expr, { to: 'javascript' });
  if (!result.success) throw new Error(result.error);
  return result.run({});
}

describe('an absent value at an annotated parameter', () => {
  test.each([
    [
      'a point parameter',
      'function f(p: tuple<number, number>) { p[1] + 1 }',
      `f(${ABSENT})`,
      '"tuple<number, number>"',
    ],
    [
      'a list parameter',
      'function f(xs: list<number>) { length(xs) }',
      'f(first(filter([[1, 2]], c => c[1] > 9)))',
      '"list<number>"',
    ],
    [
      'a string parameter',
      'function f(s: string) { length(s) }',
      'f(first(filter(["a"], c => c == "z")))',
      '"string"',
    ],
  ])('%s answers an incompatible-type error', (_label, fn, call, expected) => {
    const src = `${fn}\n${call}`;
    const error = `Error(ErrorCode("incompatible-type", ${expected}, "missing"), "Missing")`;
    // Whole program boxed and evaluated (the route a compile request takes).
    expect(box(src).expr.evaluate().toString()).toBe(error);
    // Statement by statement (the interpreter).
    expect(run(src).value).toBe(error);
  });

  test('a present value is computed', () => {
    const src = `function f(p: tuple<number, number>) { p[1] + 1 }\nf(${PRESENT})`;
    expect(box(src).expr.evaluate().toString()).toBe('2');
    expect(run(src).value).toBe('2');
  });

  test('a restricted point whose condition fails is an absent value', () => {
    const src =
      'function f(p: tuple<number, number>) { p[1] + 1 }\nlet a = -1\nf(When((1, 2), a > 0))';
    expect(run(src).value).toContain('incompatible-type');
  });

  test('a NaN at a number parameter is a number: the body runs', () => {
    expect(run('function f(v: number) { v + 1 }\nf(NaN)').value).toBe('NaN');
  });

  // `nan` is not a member of `integer` or `real`, but a user function accepts
  // `NaN` at every numeric parameter (user decision 2026-09-30), and an
  // absent value there is read as `NaN`.
  test.each(['integer', 'real'])(
    'an absent value at a parameter annotated %s is read as NaN',
    (type) => {
      const src = `function f(v: ${type}) { v + 1 }\nf(Missing)`;
      expect(run(src)).toEqual({ value: 'NaN', diagnostics: [] });
      expect(box(src).call.isValid).toBe(true);
    }
  );

  test.each([
    ['a literal NaN', 'NaN'],
    ['a read that finds no number', 'first(filter([1, 2], c => c > 9))'],
    ['a restricted number whose condition fails', 'When(3.5, 1 > 2)'],
  ])('%s is accepted at an integer and a real parameter', (_label, arg) => {
    // The argument is a `NaN` value, not `Missing`: the case tests the
    // acceptance of `NaN`, not the reading of an absent value as `NaN`.
    expect(run(arg).value).toBe('NaN');
    for (const type of ['integer', 'real']) {
      const src = `function f(v: ${type}) { v + 1 }\nf(${arg})`;
      expect(run(src)).toEqual({ value: 'NaN', diagnostics: [] });
      expect(box(src).expr.evaluate().toString()).toBe('NaN');
    }
  });

  test('an exact indeterminate form is accepted and keeps its name', () => {
    const src = 'function f(v: integer) { v + 1 }\nf(0/0)';
    expect(run(src)).toEqual({ value: 'Indeterminate', diagnostics: [] });
  });

  test('NaN is accepted at a numeric variadic parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(integer, integer*) -> unknown' });
    ce.assign(
      'g',
      ce.box(['Function', ['Add', 'a', 1], 'a', ['Spread', 'rest']])
    );
    expect(ce.box(['g', 1, 'NaN', 2]).isValid).toBe(true);
    expect(ce.box(['g', 1, 1.5, 2]).isValid).toBe(false);
  });

  test('the same function declared on the engine accepts NaN too', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(integer) -> unknown' });
    ce.assign('f', ce.box(['Function', ['Add', 'v', 1], 'v']));
    const call = ce.box(['f', 'NaN']);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('NaN');
  });

  test('a number that is not NaN is still checked', () => {
    const src = 'function f(v: integer) { v + 1 }\nf(1.5)';
    expect(box(src).call.isValid).toBe(false);
    expect(run(src).value).toContain('incompatible-type');
  });

  test('an argument typed `missing` alone is refused at boxing', () => {
    const { call } = box(
      'function f(p: tuple<number, number>) { p[1] + 1 }\nf(Missing)'
    );
    expect(call.isValid).toBe(false);
  });

  // A numeric domain absorbs absence as `NaN` (`docs/ERROR-MODEL.md` §3), and
  // `NaN` is a member of `number`. The pre-pass reports nothing either.
  test('an absent value at a number parameter is read as NaN', () => {
    expect(run('function f(v: number) { v + 1 }\nf(Missing)')).toEqual({
      value: 'NaN',
      diagnostics: [],
    });
    expect(
      run('function f(v: number) { isMissing(v) }\nf(Missing)').value
    ).toBe('"True"');
  });
});

describe('an absent value at a parameter with no annotation', () => {
  test('the body runs with the absent value, all parameters bare', () => {
    const src = `function f(p) { p[1] + 1 }\nf(${ABSENT})`;
    expect(box(src).expr.evaluate().toString()).toBe('NaN');
    expect(run(src)).toEqual({ value: 'NaN', diagnostics: [] });
  });

  // The definition is assigned twice, when it is canonicalized and when it
  // is evaluated. The second assignment must not stamp the INFERRED type of
  // the bare parameter `p` on the stored literal, or the application
  // enforces it as an annotation (`engine-declarations.ts`).
  test('the body runs with the absent value, another parameter annotated', () => {
    const src = `function f(p, n: number) { p[1] + n }\nf(${ABSENT}, 1)`;
    expect(box(src).expr.evaluate().toString()).toBe('NaN');
    expect(run(src)).toEqual({ value: 'NaN', diagnostics: [] });
  });
});

describe('an author who expects absence says so', () => {
  test('a parameter annotated `T | missing` receives the absent value', () => {
    const fn =
      'function f(p: tuple<number, number> | missing) { if isMissing(p) { -1 } else { p[1] + 1 } }';
    expect(run(`${fn}\nf(${ABSENT})`)).toEqual({ value: '-1', diagnostics: [] });
    expect(run(`${fn}\nf(${PRESENT})`)).toEqual({ value: '2', diagnostics: [] });
  });

  test('`??` removes the absent case from the argument', () => {
    const src = `function f(p: tuple<number, number>) { p[1] + 1 }\nf(${ABSENT} ?? (0, 0))`;
    expect(run(src)).toEqual({ value: '1', diagnostics: [] });
  });
});

describe('the engine admits an argument that may be absent', () => {
  test('the call is valid, and its type has no `missing` member', () => {
    const { call } = box(
      `function f(p: tuple<number, number>) { p[1] + 1 }\nf(${PRESENT})`
    );
    expect(call.op1.type.toString()).toBe('missing | tuple<integer, integer>');
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('number');
  });

  test('also when another parameter of the function is bare', () => {
    const { call } = box(
      `function f(q, xs: list<number>) { length(xs) }\nf(1, first(filter([[1, 2]], c => c[1] > 0)))`
    );
    expect(call.isValid).toBe(true);
  });

  // The `missing` member of the call's type made the JavaScript target
  // decline `Length` over the result ("operand is not an indexed
  // collection"), while the interpreter computed the value.
  test('a list built through such a call compiles', () => {
    const { expr } = box(
      [
        'function g(r: tuple<number, number, number>, acc: list<tuple<number, number, number, number>>) { [...acc, (r[1], 2, 3, 4)] }',
        'let C = first(filter([(1.5, 2, 3)], c => c[1] > 0))',
        'let circles = [(2, 0.5, 0, 1)]',
        'for k in [1, 2] { circles = g(C, circles) }',
        'length(circles)',
      ].join('\n')
    );
    expect(compiled(expr)).toBe(3);
    expect(expr.evaluate().toString()).toBe('3');
  });
});

describe('the Epsil static pre-pass reports an argument that may be absent', () => {
  const F = 'function f(p: tuple<number, number>) { p[1] + 1 }';

  test('a `first(filter(…))` at an annotated parameter is reported', () => {
    const { value, diagnostics } = run(`${F}\nf(${PRESENT})`);
    // The program still runs: the pre-pass is a linter.
    expect(value).toBe('2');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(
      'expected `tuple<number, number>`, got `missing | tuple<integer, integer>`'
    );
  });

  test('through a variable and a loop over tuples', () => {
    const { diagnostics } = run(
      `${F}\nlet C = ${PRESENT}\nlet s = 0\nfor gap in [(C, C)] { s = s + f(gap[2]) }\ns`
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('at `gap[2]`');
  });

  // A function literal bound with `let` is checked as a `function`
  // definition is: the pre-pass keeps the literal with the name it pins.
  test('a function literal bound with `let` is checked the same way', () => {
    const G = 'let g = (p: tuple<number, number>) => p[1] + 1';
    expect(run(`${G}\ng(${PRESENT})`).diagnostics).toHaveLength(1);
    expect(
      run(`${G}\nlet C = ${PRESENT}\ng(C)`).diagnostics[0]
    ).toContain('at `C`');
    // Its bare parameter is not checked.
    expect(
      run(`let g = (p, n: number) => p[1] + n\ng(${PRESENT}, 1)`).diagnostics
    ).toEqual([]);
  });

  test.each([
    // The first element of a list literal that has one cannot be absent.
    ['the first element of a list literal', `${F}\nf(first([(1, 2), (3, 4)]))`],
    ['an argument with `??`', `${F}\nf(${PRESENT} ?? (0, 0))`],
    ['a bare parameter', `function f(p) { p[1] + 1 }\nf(${PRESENT})`],
    [
      'a bare parameter beside an annotated one',
      `function f(p, n: number) { p[1] + n }\nf(${PRESENT}, 1)`,
    ],
    [
      'a parameter annotated `T | missing`',
      `function f(p: tuple<number, number> | missing) { 1 }\nf(${PRESENT})`,
    ],
  ])('%s is not reported', (_label, src) => {
    expect(run(src).diagnostics).toEqual([]);
  });
});

describe('a value typed `never` is no assignment evidence', () => {
  // Inside the loop, a first read of the call's type, taken before the types
  // of the loop settled, was `never`. `never` matches every type, so the
  // assignment widening recorded `integer`, `circles` was typed
  // `integer | list<…>`, and the JavaScript target declined `Length`.
  test('a list reassigned in a loop over tuples keeps its list type', () => {
    const { expr } = box(
      [
        'function g(r: tuple<number, number, number>, depth: integer, acc: list<tuple<number, number, number, number>>) { [...acc, (r[1], 2, 3, depth)] }',
        'const A = (2, 0.5, 0)',
        'let C = first(filter([(1.5, 2, 3)], c => c[1] > 0))',
        'let circles = [(2, 0.5, 0, 1)]',
        'for gap in [(A, C), (A, C)] { circles = g(gap[1], 2, circles) }',
        'length(circles)',
      ].join('\n')
    );
    const last = expr.ops[expr.ops.length - 1];
    expect(last.op1.type.toString()).toBe(
      'list<tuple<number, number, number, number>>'
    );
    expect(compiled(expr)).toBe(3);
  });
});

describe('a block-local function called with a list of points', () => {
  // The interpreter applies the function to each point. The JavaScript
  // target emitted an ordinary call for a function declared in the compiled
  // program: the list was passed whole and the answer was the string "1,21".
  test('an annotated point parameter: the compiled call maps over the points', () => {
    const src =
      'function f(p: tuple<number, number>, k: number) { p[1] + k }\nf(xs, 10)';
    const [program] = parseEpsil(src);
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<tuple<number, number>>');
    const expr = ce.box(resolveLibraryNames(program, src, ce));
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(
      result.run!({
        xs: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([11, 13]);
  });

  test('an absent point gives an absent cell on both routes', () => {
    const src = `function f(p: tuple<number, number>) { p[1] + 1 }\nf([(1, 2), ${ABSENT}])`;
    const { expr } = box(src);
    expect(expr.evaluate().toString()).toBe('[2,"Missing"]');
    expect(compiled(expr)).toEqual([2, undefined]);
  });

  // The type of a bare parameter is inferred from the body, which is then
  // compiled for one point; the interpreter binds the list whole and maps
  // inside the body, at the call of `h`.
  test('a bare parameter inferred as one point fails closed', () => {
    const src =
      'function h(q: tuple<number, number>) { q[1] + 1 }\nconst g = (p) => h(p)\ng(xs)';
    const [program] = parseEpsil(src);
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<tuple<number, number>>');
    const expr = ce.box(resolveLibraryNames(program, src, ce));
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('at a parameter with no annotation');
  });
});

// A declaration whose parameter admits `missing` is how a host accepts an
// absent argument. A function literal with a BARE parameter accepts an absent
// value (the body runs with it), so it implements that declaration. Before
// 2026-09-30 the bare parameter's placeholder type `unknown`, which excludes
// `missing`, made the assignment throw "not compatible".
describe('A BARE PARAMETER UNDER A DECLARED `T | missing` PARAMETER', () => {
  test('the assignment is accepted and the body sees the absent value', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(string | missing) -> unknown' } as any);
    expect(() =>
      ce.assign('f', ce.box(['Function', ['IsMissing', 's'], 's']))
    ).not.toThrow();
    expect(ce.box(['f', 'Missing']).evaluate().symbol).toBe('True');
    expect(ce.box(['f', "'a'"]).evaluate().symbol).toBe('False');
  });

  test('a numeric slot with a missing member', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { signature: '(integer | missing) -> unknown' } as any);
    expect(() =>
      ce.assign('k', ce.box(['Function', ['Add', 's', 1], 's']))
    ).not.toThrow();
    expect(ce.box(['k', 2]).evaluate().toString()).toBe('3');
  });

  test('a declared slot without missing is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('h', { signature: '(string) -> boolean' } as any);
    expect(() =>
      ce.assign('h', ce.box(['Function', ['IsMissing', 's'], 's']))
    ).not.toThrow();
  });

  test('a concrete slot of the literal is still checked', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(string | missing) -> unknown' } as any);
    expect(() =>
      ce.assign(
        'g',
        ce.box(['Function', ['IsMissing', 's'], ['Element', 's', 'integer']])
      )
    ).toThrow();
  });
});

// The compiled call checks the argument where the interpreter answers an
// `incompatible-type` error: an annotated parameter whose type is not
// numeric and has no `missing` member, given an argument whose static type
// admits an absent value. Compiled code has no error value, so the run stops
// with a `TypeError` that names the parameter (`_SYS.present`). Before
// 2026-10-01 the point parameter answered `NaN`, the list parameter threw
// from inside the body, and the string parameter failed to compile at run
// time.
describe('THE COMPILED CALL OF AN ANNOTATED PARAMETER WITH AN ABSENT ARGUMENT', () => {
  const compileRun = (src: string) => {
    const { expr } = box(src);
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(true);
    return () => result.run({});
  };

  test.each([
    ['p', 'tuple<number, number>', 'function f(p: tuple<number, number>) { p[1] + 1 }', `f(${ABSENT})`],
    ['xs', 'list<number>', 'function f(xs: list<number>) { length(xs) }', 'f(first(filter([[1, 2]], c => c[1] > 9)))'],
    ['s', 'string', 'function f(s: string) { length(s) }', 'f(first(filter(["a"], c => c == "z")))'],
  ])('a parameter annotated %s %s stops the run', (name, type, fn, call) => {
    expect(compileRun(`${fn}\n${call}`)).toThrow(
      new TypeError(
        `f: the argument of the parameter '${name}' is absent, and the parameter is annotated '${type}'`
      )
    );
  });

  test('a present value is computed', () => {
    const run = compileRun(
      `function f(p: tuple<number, number>) { p[1] + 1 }\nf(${PRESENT})`
    );
    expect(run()).toBe(2);
  });

  test('a numeric parameter reads the absent value as NaN', () => {
    const run = compileRun(
      'function f(x: number) { x + 1 }\nf(first(filter([1], c => c > 9)))'
    );
    expect(run()).toBeNaN();
  });

  test('a parameter that admits missing, and a bare parameter, receive it', () => {
    expect(
      compileRun(
        `function f(p: tuple<number, number> | missing) { isMissing(p) }\nf(${ABSENT})`
      )()
    ).toBe(true);
    expect(compileRun(`function f(p) { p }\nf(${ABSENT})`)()).toBeUndefined();
  });

  test('a function literal applied directly checks its argument', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Apply',
      [
        'Function',
        ['Add', ['At', 'p', 1], 1],
        ['Typed', 'p', "'tuple<number, number>'"],
      ],
      [
        'First',
        [
          'Filter',
          ['List', ['Tuple', 1, 2]],
          ['Function', ['Less', 'v', ['At', 'c', 1]], 'c'],
        ],
      ],
    ]);
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(() => result.run({ v: 9 })).toThrow(TypeError);
    expect(result.run({ v: 0 })).toBe(2);
  });

  test('a call mapped over a list of points checks the other arguments', () => {
    const fn =
      'function f(p: tuple<number, number>, s: string) { p[1] + length(s) }';
    expect(
      compileRun(
        `${fn}\nf([(1, 2), (3, 4)], first(filter(["a"], c => c == "z")))`
      )
    ).toThrow(
      new TypeError(
        "f: the argument of the parameter 's' is absent, and the parameter is annotated 'string'"
      )
    );
    expect(
      compileRun(
        `${fn}\nf([(1, 2), (3, 4)], first(filter(["ab"], c => c == "ab")))`
      )()
    ).toEqual([3, 5]);
  });
});

