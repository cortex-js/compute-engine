import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/free-functions';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Four places where the compiled JavaScript route and the interpreter
 * disagreed, now aligned:
 *
 * - `Gamma` of a maybe-complex operand compiles to the complex kernel
 *   (`_SYS.cgamma`), as `Sin` does; it answered `NaN` for every argument.
 * - `Dot` of a tuple of tuples declines to compile: the interpreter reads
 *   `((1, 2), (3, 4))` as one point with nested coordinates and leaves the
 *   product unevaluated, while the matrix product answered `[17, 39]`.
 * - A call of a user function checks the declared parameter types at run
 *   time where the argument's static type does not prove them, and a
 *   function value handed to `Map` checks them per element: the interpreter
 *   answers an `incompatible-type` error at the element, compiled code `NaN`.
 *   Under `.N()`, `Map(h, L)` with a bare symbol callback checks them too.
 * - A parameter that reaches a whole-collection operator through an
 *   element-wise operator or a local alias binds a list whole on both
 *   routes (`mean(xs^2)` over `[1, 2, 3]` is `14/3`, not `[1, 4, 9]`), and
 *   so does a parameter declared `collection<any> | number`.
 */

const run = (
  ce: ComputeEngine,
  expr: unknown,
  args?: Record<string, unknown>
) => {
  const c = compile(expr as any, { engine: ce } as any) as any;
  if (!c.success) return 'declined';
  return JSON.stringify(c.run(args));
};

describe('COMPILED GAMMA OF A MAYBE-COMPLEX OPERAND', () => {
  const ce = new ComputeEngine();
  ce.declare('t', 'real');
  ce.declare('z', 'complex');

  test('Gamma(i·t) at t = 5 is the value the interpreter gives', () => {
    const c = compile(ce.box(['Gamma', ['Multiply', 'ImaginaryUnit', 't']]), {
      engine: ce,
    } as any) as any;
    expect(c.success).toBe(true);
    const v = c.run({ t: 5 });
    const expected = ce.box(['Gamma', ['Complex', 0, 5]]).N();
    expect(v.re).toBeCloseTo(expected.re, 12);
    expect(v.im).toBeCloseTo(expected.im, 12);
  });

  test('a complex-typed operand takes the complex kernel', () => {
    const c = compile(ce.box(['Gamma', 'z']), { engine: ce } as any) as any;
    expect(String(c.code)).toContain('_SYS.cgamma');
    const v = c.run({ z: { re: 1, im: 1 } });
    const expected = ce.box(['Gamma', ['Complex', 1, 1]]).N();
    expect(v.re).toBeCloseTo(expected.re, 12);
    expect(v.im).toBeCloseTo(expected.im, 12);
  });

  test('a real operand keeps the real kernel', () => {
    const c = compile(ce.box(['Gamma', 't']), { engine: ce } as any) as any;
    expect(String(c.code)).toBe('_SYS.gamma(_.t)');
    expect(c.run({ t: 4.5 })).toBeCloseTo(11.631728396567448, 10);
  });
});

describe('DOT OF A TUPLE OF TUPLES', () => {
  const ce = new ComputeEngine();
  const nested = [
    'Dot',
    ['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ['Tuple', 5, 6],
  ];

  test('stays unevaluated in the interpreter', () => {
    expect(ce.box(nested as any).evaluate().operator).toBe('Dot');
  });

  test('declines to compile on the JavaScript and Python targets', () => {
    expect(run(ce, ce.box(nested as any))).toBe('declined');
    const py = compile(ce.box(nested as any), {
      engine: ce,
      to: 'python',
    } as any) as any;
    expect(py.success).toBe(false);
  });

  test('a symbol holding a tuple of tuples declines too', () => {
    ce.declare('q', 'tuple<tuple<real, real>, tuple<real, real>>');
    expect(
      run(ce, ce.box(['Dot', 'q', ['Tuple', 5, 6]]), {
        q: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toBe('declined');
    ce.assign('pt', ce.box(['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    expect(run(ce, ce.box(['Dot', 'pt', ['Tuple', 5, 6]]))).toBe('declined');
  });

  test('a matrix and a point still compile', () => {
    expect(
      run(
        ce,
        ce.box([
          'Dot',
          ['List', ['List', 1, 2], ['List', 3, 4]],
          ['List', 5, 6],
        ])
      )
    ).toBe('[17,39]');
    expect(run(ce, ce.box(['Dot', ['Tuple', 1, 2], ['Tuple', 5, 6]]))).toBe(
      '17'
    );
  });
});

describe('DECLARED PARAMETER TYPES IN COMPILED CALLS AND CALLBACKS', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');
  ce.declare('n', 'integer');
  ce.declare('L', 'list<number>');
  ce.declare('h', {
    type: '(x: integer) -> integer',
    value: ce.parse('x \\mapsto 2x'),
  } as any);
  ce.declare('p', {
    type: '(x: real) -> real',
    value: ce.parse('x \\mapsto x + 1'),
  } as any);

  test('a direct call with a real argument at an integer parameter is checked', () => {
    const c = compile(ce.box(['h', 'y']), { engine: ce } as any) as any;
    // The call goes through the checking shim, emitted once in the preamble.
    expect(String(c.code)).toBe('_fn_h$t(_.y)');
    expect(String(c.preamble)).toContain('Number.isInteger(_SYS.creal(_$0))');
    expect(c.run({ y: 3 })).toBe(6);
    expect(c.run({ y: 2.5 })).toBeNaN();
  });

  test('an argument whose static type proves the parameter needs no check', () => {
    expect(
      String((compile(ce.box(['h', 'n']), { engine: ce } as any) as any).code)
    ).toBe('_fn_h(_.n)');
    expect(
      String((compile(ce.box(['p', 'y']), { engine: ce } as any) as any).code)
    ).toBe('_fn_p(_.y)');
  });

  // The evaluated `Map` is a lazy collection: its printed form lists the
  // elements.
  const elements = (v: ReturnType<ComputeEngine['box']>) =>
    v.toString().replace(/\s/g, '');

  test('a lambda callback: the interpreter errors at the element, compiled code answers NaN', () => {
    const m = ce.box(['Map', ['Function', ['h', 'k'], 'k'], ['List', 1, 2.5]]);
    expect(elements(m.evaluate())).toMatch(/^\[2,Error\(/);
    expect(run(ce, m)).toBe('[2,null]');
  });

  test('a bare-symbol callback is checked on every route', () => {
    const m = ce.box(['Map', 'h', ['List', 1, 2.5]]);
    expect(elements(m.evaluate())).toMatch(/^\[2,Error\(/);
    expect(elements(m.N())).toMatch(/^\[2,Error\(/);
    expect(run(ce, m)).toBe('[2,null]');
    expect(run(ce, ce.box(['Map', 'h', 'L']), { L: [1, 2.5] })).toBe(
      '[2,null]'
    );
    expect(run(ce, ce.box(['Map', 'h', 'L']), { L: [1, 2, 3] })).toBe(
      '[2,4,6]'
    );
  });

  test('a list argument is still broadcast, and checked per element', () => {
    expect(run(ce, ce.box(['h', ['List', 1, 2, 3]]))).toBe('[2,4,6]');
    expect(
      run(ce, ce.box(['Map', 'h', ['List', ['List', 1, 2], ['List', 3, 4]]]))
    ).toBe('[[2,4],[6,8]]');
  });

  test('a list argument of a direct call is checked per element', () => {
    expect(run(ce, ce.box(['h', 'L']), { L: [1, 2.5] })).toBe('[2,null]');
  });

  test('a value the complex lane carries is checked on its real projection', () => {
    // `√y` compiles on the complex lane (`y` has no proven sign), so the
    // shim receives `{re: 2, im: 0}` at `y = 4`; the test reads its real
    // part, and the body receives the projection.
    expect(run(ce, ce.box(['p', ['Sqrt', 'y']]), { y: 4 })).toBe('3');
    expect(run(ce, ce.box(['h', ['Sqrt', 'y']]), { y: 4 })).toBe('4');
    expect(run(ce, ce.box(['h', ['Sqrt', 'y']]), { y: 2 })).toBe('null');
    expect(run(ce, ce.box(['h', ['Sqrt', 'y']]), { y: -4 })).toBe('null');
  });
});

describe('A PARAMETER THAT REACHES A WHOLE-COLLECTION OPERATOR INDIRECTLY', () => {
  const ce = new ComputeEngine();
  ce.declare('v', 'list<number>');
  const both = (def: string, name: string): [string, string] => {
    const r = executeEpsil(ce, `${def}\n${name}([1, 2, 3])`);
    return [r.value.toString(), run(ce, ce.box([name, 'v']), { v: [1, 2, 3] })];
  };

  test.each([
    [
      'through an element-wise operator',
      'function a2(xs) { mean(xs^2) }',
      'a2',
      '14/3',
      '4.666666666666667',
    ],
    [
      'through a sum of squares',
      'function a4(xs) { sum(xs^2) }',
      'a4',
      '14',
      '14',
    ],
    [
      'through a local alias',
      'function a5(xs) { let ys = xs; mean(ys) }',
      'a5',
      '2',
      '2',
    ],
    [
      'through an alias of an element-wise result',
      'function a5b(xs) { let ys = xs^2; sum(ys) }',
      'a5b',
      '14',
      '14',
    ],
    ['Max of the parameter', 'function a3(xs) { max(xs) }', 'a3', '3', '3'],
    ['Max of the squares', 'function a8(xs) { max(xs^2) }', 'a8', '9', '9'],
    [
      'Product of the parameter',
      'function a6(xs) { product(xs) }',
      'a6',
      '6',
      '6',
    ],
    ['GCD of the parameter', 'function a12(xs) { gcd(xs) }', 'a12', '1', '1'],
    [
      'a declared union, through an element-wise operator',
      'function b4(xs: collection<any> | number) { mean(xs^2) }',
      'b4',
      '14/3',
      '4.666666666666667',
    ],
    [
      'a declared union, through a sum',
      'function b5(xs: collection<any> | number) { sum(xs^2) }',
      'b5',
      '14',
      '14',
    ],
  ])('%s', (_label, def, name, interp, compiled) => {
    expect(both(def, name)).toEqual([interp, compiled]);
  });

  test('a scalar argument still gives the scalar value', () => {
    const r = executeEpsil(ce, 'function a9(xs) { mean(xs^2) }\na9(3)');
    expect(r.value.toString()).toBe('9');
  });

  test('a body with no whole-collection operator still maps over a list', () => {
    expect(both('function a10(xs) { xs^2 + 1 }', 'a10')).toEqual([
      '[2,5,10]',
      '[2,5,10]',
    ]);
    expect(both('function a11(t) { (cos(t), sin(t)) }', 'a11')[0]).toBe(
      '[(cos(1), sin(1)),(cos(2), sin(2)),(cos(3), sin(3))]'
    );
  });

  test('Norm of an untyped parameter is still applied per element', () => {
    expect(both('function a7(v) { norm(v) }', 'a7')).toEqual([
      '[1,2,3]',
      '[1,2,3]',
    ]);
  });

  test('a local overwritten after the alias no longer holds the parameter', () => {
    expect(
      executeEpsil(
        ce,
        'function o(xs) { let ys = xs; ys = 0; mean(ys) }\no([1, 2, 3])'
      ).value.toString()
    ).toBe('[0,0,0]');
  });

  test("an index of a Sum with the parameter's name is not the parameter", () => {
    const k = ce.box([
      'Function',
      ['Add', 'x', ['Sum', ['Max', 'x'], ['Limits', 'x', 1, 3]]],
      'x',
    ]);
    expect(k.type.toString()).toBe('(x: unknown) -> number');
  });

  test('a lifted function handed to Map binds each row whole on both routes', () => {
    executeEpsil(ce, 'function m2(xs) { mean(xs^2) }');
    ce.declare('R', 'list<list<number>>');
    const rows = ['List', ['List', 1, 2, 3], ['List', 1, 2]];
    expect(ce.box(['Map', 'm2', rows]).evaluate().toString()).toBe(
      '[14/3,5/2]'
    );
    expect(
      run(ce, ce.box(['Map', 'm2', 'R']), {
        R: [
          [1, 2, 3],
          [1, 2],
        ],
      })
    ).toBe('[4.666666666666667,2.5]');
    // A flat list still maps the scalar body over its elements.
    expect(run(ce, ce.box(['Map', 'm2', 'v']), { v: [1, 2, 3] })).toBe(
      '[1,4,9]'
    );
  });
});
