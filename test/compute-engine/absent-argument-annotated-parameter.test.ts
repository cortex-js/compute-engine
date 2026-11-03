/**
 * An absent argument at a parameter of a function literal (user decisions of
 * 2026-09-30).
 *
 * 1. At evaluation, an absent value (`Missing`) at a parameter ANNOTATED
 *    with a type that has no `missing` member is an `incompatible-type`
 *    error. At a numeric annotation (`number`, `integer`, `real`) the call
 *    gives `Missing` without running the body, and the parameter accepts
 *    `NaN`. At a bare parameter the body runs with the absent value.
 *    Before,
 *    a function whose parameters were all numeric or collections answered
 *    the absence marker (`NaN`, `Missing`) without running, and the type of
 *    the call gained a `missing` member.
 * 2. At boxing, the engine admits an argument that may be absent at a
 *    parameter annotated `T`: its value is usually present.
 *
 * Since `Missing` is a result only (`docs/ERROR-MODEL.md`, user decision of
 * 2026-11-02): a parameter annotation or a signature cannot name `missing`,
 * the Epsil pre-pass no longer reports an argument that may be absent, and a
 * read out of range in a list of points is a `NaN` point, which is a member
 * of `tuple<number, number>`.
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
  test('a point that is not found is a NaN point: the body runs', () => {
    const src = `function f(p: tuple<number, number>) { p[1] + 1 }\nf(${ABSENT})`;
    expect(box(src).expr.evaluate().toString()).toBe('NaN');
    expect(run(src).value).toBe('NaN');
  });

  test.each([
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

  // A call with `Missing` at a point parameter gives `Missing` without
  // running the body, as at a numeric parameter.
  test('a restricted point whose condition fails is a NaN point', () => {
    // A false restriction of a point is the point of `NaN` coordinates
    // (user decision 2026-11-03): the body runs with it, as with `NaN` at a
    // number parameter.
    const src =
      'function f(p: tuple<number, number>) { p[1] + 1 }\nlet a = -1\nf(If(a > 0, (1, 2)))';
    expect(run(src).value).toBe('NaN');
  });

  test('a NaN at a number parameter is a number: the body runs', () => {
    expect(run('function f(v: number) { v + 1 }\nf(NaN)').value).toBe('NaN');
  });

  // `nan` is not a member of `integer` or `real`, but a user function accepts
  // `NaN` at every numeric parameter (user decision 2026-09-30). An absent
  // value there makes the call give `Missing` without running the body.
  test.each(['integer', 'real'])(
    'an absent value at a parameter annotated %s gives Missing',
    (type) => {
      const src = `function f(v: ${type}) { v + 1 }\nf(Missing)`;
      expect(run(src)).toEqual({ value: '"Missing"', diagnostics: [] });
      expect(box(src).call.isValid).toBe(true);
    }
  );

  test.each([
    ['a literal NaN', 'NaN'],
    ['a read that finds no number', 'first(filter([1, 2], c => c > 9))'],
    ['a restricted number whose condition fails', 'If(1 > 2, 3.5)'],
  ])('%s is accepted at an integer and a real parameter', (_label, arg) => {
    // The argument is a `NaN` value, not `Missing`: the case tests the
    // acceptance of `NaN`, not a call over an absent value.
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

  test('a call whose type is nan is accepted before it is evaluated', () => {
    // A function application reports `isNaN` only once it is evaluated, so
    // `f(g())` was refused at boxing where `f(NaN)` was accepted.
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '() -> nan' });
    ce.assign('g', ce.box(['Function', 'NaN']));
    ce.declare('f', { signature: '(integer) -> unknown' });
    ce.assign('f', ce.box(['Function', ['Add', 'v', 1], 'v']));
    const call = ce.box(['f', ['g']]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('NaN');
    // A call whose type is not `nan` is still checked.
    ce.declare('s', { signature: '() -> string' });
    expect(ce.box(['f', ['s']]).isValid).toBe(false);
  });

  test('a number that is not NaN is still checked', () => {
    const src = 'function f(v: integer) { v + 1 }\nf(1.5)';
    expect(box(src).call.isValid).toBe(false);
    expect(run(src).value).toContain('incompatible-type');
  });

  test('an argument typed `missing` alone at a point parameter gives Missing', () => {
    const src = 'function f(p: tuple<number, number>) { p[1] + 1 }\nf(Missing)';
    expect(box(src).call.isValid).toBe(true);
    expect(run(src).value).toBe('"Missing"');
  });

  // A call with `Missing` at a numeric parameter gives `Missing` without
  // running the body, also when the body would test the parameter. The
  // pre-pass reports nothing.
  test('an absent value at a number parameter gives Missing', () => {
    expect(run('function f(v: number) { v + 1 }\nf(Missing)')).toEqual({
      value: '"Missing"',
      diagnostics: [],
    });
    expect(
      run('function f(v: number) { isMissing(v) }\nf(Missing)').value
    ).toBe('"Missing"');
  });
});

// On the MathJSON routes, as on the Epsil route, a call with an absent
// argument at a numeric parameter gives `Missing` without running the body
// (`docs/ERROR-MODEL.md`, "`Missing` is a result only"). Before 2026-10-17
// the literal `Missing` was refused at boxing with `incompatible-type` on
// these routes; from 2026-10-17 to 2026-11-02 the absent argument was read
// as `NaN`.
describe('an absent argument at a numeric parameter on the MathJSON routes', () => {
  test('a function literal applied directly', () => {
    const ce = new ComputeEngine();
    for (const [body, type] of [
      ['x', 'number'],
      [['Add', 'x', 1], 'integer'],
    ] as const) {
      const call = ce.box([
        'Apply',
        ['Function', body as any, ['Typed', 'x', `'${type}'`]],
        'Missing',
      ]);
      expect(call.isValid).toBe(true);
      expect(call.evaluate().toString()).toBe('"Missing"');
    }
  });

  test('a function with a declared signature', async () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(number) -> unknown' });
    ce.assign('g', ce.box(['Function', 'x', 'x']));
    const call = ce.box(['g', 'Missing']);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('"Missing"');
    expect((await call.evaluateAsync()).toString()).toBe('"Missing"');
    // Each element of a list is mapped the same way.
    expect(ce.box(['g', ['List', 1, 'Missing']]).evaluate().toString()).toBe(
      '[1,"Missing"]'
    );
  });

  test('the Epsil route answers the same', () => {
    expect(run('function g(x: number) { x }\ng(Missing)').value).toBe(
      '"Missing"'
    );
  });

  test('a non-numeric parameter still refuses the literal `Missing`', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Apply', ['Function', 'x', ['Typed', 'x', "'string'"]], 'Missing'])
        .isValid
    ).toBe(false);
    ce.declare('t', { signature: '(string) -> unknown' });
    ce.assign('t', ce.box(['Function', 'x', 'x']));
    expect(ce.box(['t', 'Missing']).isValid).toBe(false);
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
  test('a parameter annotation cannot name `missing`', () => {
    const fn = 'function f(p: tuple<number, number> | missing) { 1 }';
    const { diagnostics } = run(`${fn}\nf(${PRESENT})`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('type-annotation-error');
  });

  test('`??` removes the absent case from the argument', () => {
    const src =
      'function f(xs: list<number>) { length(xs) }\nf(first(filter([[1, 2]], c => c[1] > 9)) ?? [0])';
    expect(run(src)).toEqual({ value: '1', diagnostics: [] });
  });
});

describe('the engine admits an argument that may be absent', () => {
  test('the call is valid, and its type has no `missing` member', () => {
    const { call } = box(
      `function f(p: tuple<number, number>) { p[1] + 1 }\nf(${PRESENT})`
    );
    expect(call.op1.type.toString()).toBe('tuple<integer, integer>');
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

// The Epsil static pre-pass does not report an argument that may be absent:
// a type does not show that a read may be absent (`docs/ERROR-MODEL.md`,
// "`Missing` is a result only").
describe('the Epsil static pre-pass does not report an argument that may be absent', () => {
  const F = 'function f(p: tuple<number, number>) { p[1] + 1 }';

  test.each([
    ['a `first(filter(…))` at an annotated parameter', `${F}\nf(${PRESENT})`],
    [
      'a variable in a loop over tuples',
      `${F}\nlet C = ${PRESENT}\nlet s = 0\nfor gap in [(C, C)] { s = s + f(gap[2]) }\ns`,
    ],
    [
      'a function literal bound with `let`',
      `let g = (p: tuple<number, number>) => p[1] + 1\ng(${PRESENT})`,
    ],
  ])('%s', (_label, src) => {
    expect(run(src).diagnostics).toEqual([]);
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
      'list<tuple<integer, real, integer, integer>>'
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

  test('a point that is not found is a NaN point: NaN on both routes', () => {
    const src = `function f(p: tuple<number, number>) { p[1] + 1 }\nf([(1, 2), ${ABSENT}])`;
    const { expr } = box(src);
    expect(expr.evaluate().toString()).toBe('[2,NaN]');
    expect(compiled(expr)).toEqual([2, NaN]);
  });

  // The type of a bare parameter is inferred from the body as one point; the
  // interpreter binds the list whole and maps inside the body, at the call
  // of `h`. The compiled call is written with the body of `g`, so the call
  // of `h` maps over the list as well (CE-238). It declined before.
  test('a bare parameter inferred as one point receives the list whole', () => {
    const src =
      'function h(q: tuple<number, number>) { q[1] + 1 }\nconst g = (p) => h(p)\ng(xs)';
    const [program] = parseEpsil(src);
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<tuple<number, number>>');
    const expr = ce.box(resolveLibraryNames(program, src, ce));
    const result = compile(expr, { to: 'javascript', fallback: false });
    expect(result.success).toBe(true);
    const xs = [
      [1, 2],
      [3, 4],
    ];
    expect(result.run!({ xs })).toEqual([2, 4]);
    ce.assign('xs', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    expect(expr.evaluate().toString()).toBe('[2,4]');
  });
});

// A signature cannot name `missing` at a parameter (`docs/ERROR-MODEL.md`,
// "`Missing` is a result only"). A function literal with a bare parameter
// still implements a signature whose parameter does not name it.
describe('A BARE PARAMETER UNDER A DECLARED PARAMETER', () => {
  test('a signature with a `missing` parameter is refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('f', { signature: '(string | missing) -> unknown' } as any)
    ).toThrow(/cannot be declared/);
  });

  test('a declared slot without missing is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('h', { signature: '(string) -> boolean' } as any);
    expect(() =>
      ce.assign('h', ce.box(['Function', ['IsMissing', 's'], 's']))
    ).not.toThrow();
  });
});

// An absent argument at an annotated parameter whose type is not numeric and
// has no `missing` member is an `incompatible-type` error in the
// interpreter. In compiled code, a function applied to an absent argument
// has no specified value (`docs/COMPILATION-MODEL.md`, "Caveats of compiled
// code"), so the compiled call does not test the argument. The tests below
// pin the values for present arguments.
describe('THE COMPILED CALL OF AN ANNOTATED PARAMETER WITH AN ABSENT ARGUMENT', () => {
  const compileRun = (src: string) => {
    const { expr } = box(src);
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(true);
    return () => result.run({});
  };

  /** Compile `src` with its inputs declared with `types`. */
  const compileWith = (src: string, types: Record<string, string>) => {
    const [program] = parseEpsil(src);
    const ce = new ComputeEngine();
    for (const [name, type] of Object.entries(types)) ce.declare(name, type);
    const result = compile(ce.box(resolveLibraryNames(program, src, ce)), {
      to: 'javascript',
    });
    expect(result.success).toBe(true);
    return result.run!;
  };

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

  // A body that does not compute with the parameter answered `undefined`,
  // the compiled absent value, before 2026-10-16. The interpreter gives
  // `Missing` for a call with an absent argument at a numeric parameter;
  // compiled code gives `NaN` there, as the caveats of compiled code allow
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
  test.each([
    ['a direct call', 'function f(x: number) { x }\nf(Missing)'],
    [
      'a function literal bound with `const`',
      'const f = (x: number) => x\nf(Missing)',
    ],
  ])('%s with an absent argument: Missing, compiled NaN', (_label, src) => {
    expect(box(src).expr.evaluate().toString()).toBe('"Missing"');
    for (const constantFold of [true, false]) {
      const result = compile(box(src).expr, {
        to: 'javascript',
        constantFold,
      } as any);
      expect(result.success).toBe(true);
      expect(result.run({})).toBeNaN();
    }
  });

  // The function is a value given to `map`, which calls it with each element
  // as it is: the call over the absent element gives `Missing`.
  test('a function value given to `map` maps an absent element to Missing', () => {
    expect(
      executeEpsil(
        new ComputeEngine(),
        'function f(x: number) { x }\nmap(f, [1, Missing])'
      ).value?.toString()
    ).toBe('[1,"Missing"]');
  });

  // A callback literal with a numeric parameter, given a list with an absent
  // element, maps the absent element to `Missing` in the interpreter, and a
  // sum over that list is `Missing`. A declared input cannot name `missing`,
  // so the compiled code is not checked with an absent element.
  test.each([
    ['map((x: number) => x, xs)', '["Missing",1,2]'],
    ['map((x: integer) => x + 1, xs)', '["Missing",2,3]'],
    ['filter(xs, (x: number) => x > 1)', '[2]'],
    ['sum(map((x: number) => x, xs))', '"Missing"'],
  ])('the callback route %s over an absent element', (src, expected) => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 'Missing', 1, 2]));
    const value = (executeEpsil(ce, src) as any).value;
    expect(value.toString()).toBe(expected);
  });

  // A parameter annotated `complex` maps an absent element to `Missing` in
  // the interpreter.
  test('a complex parameter maps an absent element to Missing', () => {
    const src = 'map((z: complex) => 2 * z, xs)';
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 'Missing', ['Complex', 1, 2], 3]));
    expect((executeEpsil(ce, src) as any).value.toString()).toBe(
      '["Missing",(2 + 4i),6]'
    );
  });

  // The compiled value of a user function body over an absent argument is
  // not specified (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code",
  // the bullet "Everything computed from an absent value, except at a
  // discharge"; R4 of `docs/plans/2026-11-01-absent-value-contract.md`):
  // only the call with a present argument is checked.
  test('a function declared on the engine compiles a call with a present argument', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'number');
    ce.declare('g', { signature: '(number) -> unknown' });
    ce.assign('g', ce.box(['Function', 'x', ['Typed', 'x', "'number'"]]));
    const result = compile(ce.box(['g', 'y']), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.run({ y: 3 })).toBe(3);
  });

  test('a function literal applied directly computes a present argument', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'real');
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
    expect(result.run({ v: 0 })).toBe(2);
  });

  test('a call mapped over a list of points passes the other arguments', () => {
    const fn =
      'function f(p: tuple<number, number>, s: string) { p[1] + length(s) }';
    expect(
      compileRun(
        `${fn}\nf([(1, 2), (3, 4)], first(filter(["ab"], c => c == "ab")))`
      )()
    ).toEqual([3, 5]);
  });

  // The interpreter maps the function over the list.
  test.each([
    ['a list', 'list<string>', ['a', 'b'], [1, 1]],
    [
      'a nested list',
      'list<list<string>>',
      [['a'], ['b', 'c']],
      [[1], [1, 1]],
    ],
  ])(
    'a list of present elements at a scalar parameter is mapped (%s)',
    (_label, type, present, expected) => {
      const run = compileWith('function f(s: string) { 1 }\nf(xs)', {
        xs: type,
      });
      expect(run({ xs: present })).toEqual(expected);
    }
  );

  test('a function literal applied to such a list maps over it', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<string>');
    const result = compile(
      ce.box([
        'Apply',
        ['Function', 1, ['Typed', 's', "'string'"]],
        'xs',
      ]),
      { to: 'javascript' }
    );
    expect(result.success).toBe(true);
    expect(result.run!({ xs: ['a', 'b'] })).toEqual([1, 1]);
  });
});

