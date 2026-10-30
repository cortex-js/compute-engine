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

// A user function with ONE clause accepts `NaN` at a parameter typed with a
// numeric type (`real`, `integer`, …), and its body runs with `NaN`. A
// multi-clause function refuses it, since no clause is the correct one for
// `NaN`. Decision: `docs/ERROR-MODEL.md`, "A user function accepts `NaN` at
// a numeric parameter — RULED 2026-09-30", amended 2026-10-17. The checking
// shim of compiled code answered `NaN` without running the body.
describe('NaN AT A NUMERIC PARAMETER OF A USER FUNCTION', () => {
  for (const sig of ['(real) -> number', '(integer) -> number']) {
    test(`one clause, ${sig}: the body runs with NaN on both routes`, () => {
      const ce = new ComputeEngine();
      ce.declare('f', sig);
      ce.assign('f', ce.box(['Function', 7, 'x']));
      ce.declare('y', 'number');
      expect(ce.box(['f', 'NaN']).evaluate().re).toBe(7);
      const c = compile(ce.box(['f', 'y']), { engine: ce } as any) as any;
      expect(String(c.code)).toBe('_fn_f$t(_.y)');
      expect(c.run({ y: NaN })).toBe(7);
      // A number that is not NaN is still tested.
      if (sig.startsWith('(integer)')) expect(c.run({ y: 1.5 })).toBeNaN();
      expect(c.run({ y: Infinity })).toBeNaN();
      ce.assign('y', ce.NaN);
      expect(ce.box(['f', 'y']).evaluate().re).toBe(7);
    });
  }

  test('a failed check gives the marker of the declared result type', () => {
    // When an argument fails the test of its declared parameter type, the
    // checking shim gives the absence marker of the declared result:
    // `undefined` for a collection, `NaN` for a number, and `NaN` for a
    // result typed `unknown`. The interpreter answers the
    // `incompatible-type` error in each case.
    const run = (sig: string, body: unknown) => {
      const ce = new ComputeEngine();
      ce.declare('f', sig);
      ce.assign('f', ce.box(['Function', body, 'x'] as any));
      ce.declare('w', 'number');
      ce.declare('x', 'real');
      const c = compile(ce.box(['f', 'w']), { engine: ce } as any) as any;
      expect(String(c.code)).toBe('_fn_f$t(_.w)');
      return { ce, value: c.run({ w: Infinity }) };
    };
    const list = run('(real) -> list<real>', ['List', 'x', 1]);
    expect(list.value).toBeUndefined();
    expect(run('(real) -> number', 7).value).toBeNaN();
    expect(run('(real) -> unknown', 7).value).toBeNaN();

    // A list consumer tests the checked call before it reads it as an
    // array. A call whose argument is proven has no shim and no test.
    const ce = list.ce;
    const joined = compile(ce.box(['Join', ['List', 9], ['f', 'w']]), {
      engine: ce,
    } as any) as any;
    expect(String(joined.code)).toBe(
      '((_tv1) => ((_tv1 === undefined) ? undefined : [...([9]), ...(_tv1)]))(_fn_f$t(_.w))'
    );
    expect(joined.run({ w: Infinity })).toBeUndefined();
    expect(joined.run({ w: 2 })).toEqual([9, 2, 1]);
    const proven = compile(ce.box(['Join', ['List', 9], ['f', 'x']]), {
      engine: ce,
    } as any) as any;
    expect(String(proven.code)).toBe('[...([9]), ...(_fn_f(_.x))]');
  });

  test('the marker is read from the result without its missing arm; a boolean result is undefined', () => {
    const shim = (sig: string, body: unknown, expr: unknown) => {
      const ce = new ComputeEngine();
      ce.declare('f', sig);
      ce.assign('f', ce.box(['Function', body, 'x'] as any));
      ce.declare('w', 'number');
      const c = compile(ce.box(expr as any), { engine: ce } as any) as any;
      const line = String(c.preamble)
        .split('\n')
        .find((l: string) => l.startsWith('const _fn_f$t ='));
      return { ce, c, line: line ?? '' };
    };
    // `list<real> | missing` is a collection: `undefined`, and the `Join`
    // tests it before the spread.
    const opt = shim(
      '(real) -> list<real> | missing',
      ['List', 'x', 1],
      ['Join', ['List', 9], ['f', 'w']]
    );
    expect(opt.line.endsWith(': undefined;')).toBe(true);
    expect(opt.c.run({ w: Infinity })).toBeUndefined();
    expect(opt.c.run({ w: 2 })).toEqual([9, 2, 1]);
    // `list | number` is not a collection. With a body that can give a
    // number or a list, the type of the call is `number | vector<2>` too,
    // and the shim keeps `NaN`.
    const mixed = shim(
      '(real) -> list | number',
      ['Which', ['Greater', 'x', 0], ['List', 'x', 1], 'True', 'x'],
      ['f', 'w']
    );
    expect(mixed.line.endsWith(': NaN;')).toBe(true);
    expect(mixed.c.run({ w: Infinity })).toBeNaN();
    // A boolean result: `undefined`, the absent boolean. `If` of it has no
    // value, which a numeric result holds as `NaN`; the interpreter answers
    // the `incompatible-type` error.
    const bool = shim(
      '(real) -> boolean',
      ['Greater', 'x', 0],
      ['If', ['f', 'w'], 1, 2]
    );
    expect(bool.line.endsWith(': undefined;')).toBe(true);
    expect(bool.c.run({ w: Infinity })).toBeNaN();
    expect(bool.c.run({ w: 3 })).toBe(1);
    bool.ce.assign('w', Infinity);
    expect(
      bool.ce
        .box(['If', ['f', 'w'], 1, 2])
        .evaluate()
        .toString()
    ).toMatch(/^Error\(ErrorCode\("incompatible-type", "real"/);
  });

  test('a declared result `list | number`: the marker follows the type of the call', () => {
    // The type of a call is narrowed to the type of the body. With
    // `f := x ↦ [x, 1]`, `f(w)` is a `vector<2>`, so `Join` spreads it, and
    // a failed check must give `undefined`, which the `Join` tests. The
    // shim gave `NaN`, chosen from the declared `list | number`, and the
    // spread threw.
    const ce = new ComputeEngine();
    ce.declare('f', '(real) -> list | number');
    ce.assign('f', ce.box(['Function', ['List', 'x', 1], 'x'] as any));
    ce.declare('w', 'number');
    const c = compile(ce.box(['Join', ['List', 9], ['f', 'w']]), {
      engine: ce,
      fallback: false,
    } as any) as any;
    expect(String(c.preamble)).toContain(': undefined;');
    expect(c.run({ w: 2 })).toEqual([9, 2, 1]);
    expect(c.run({ w: Infinity })).toBeUndefined();

    // A body that can return a number: the call is typed
    // `number | vector<2>`, which `Join` does not spread, so the
    // compilation declines and the interpreter answers. The interpreter
    // joins a number as one element: `Join([9], 3)` is `[9, 3]`.
    const ce2 = new ComputeEngine();
    ce2.declare('f', '(real) -> list | number');
    ce2.assign(
      'f',
      ce2.box([
        'Function',
        ['Which', ['Greater', 'x', 0], ['List', 'x', 1], 'True', 'x'],
        'x',
      ] as any)
    );
    ce2.declare('w', 'number');
    const join = ce2.box(['Join', ['List', 9], ['f', 'w']]);
    expect(() =>
      compile(join, { engine: ce2, fallback: false } as any)
    ).toThrow(/operand 2 is not an indexed collection/);
    const fallback = compile(join, { engine: ce2 } as any) as any;
    expect(fallback.success).toBe(false);
    expect(fallback.run({ w: -3 })).toEqual([9, -3]);
    expect(fallback.run({ w: 2 })).toEqual([9, 2, 1]);
  });

  test('a checked call of a block-local function with a collection result is tested before the spread', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    const block = ce.box([
      'Block',
      ['Declare', 'g', { str: '(real) -> list<real>' }],
      ['Assign', 'g', ['Function', ['List', 'x', 1], 'x']],
      ['Join', ['List', 9], ['g', 'w']],
    ] as any);
    const c = compile(block, { engine: ce, fallback: false } as any) as any;
    expect(String(c.code)).toContain('(_tv1 === undefined) ? undefined :');
    expect(c.run({ w: Infinity })).toBeUndefined();
    expect(c.run({ w: 2 })).toEqual([9, 2, 1]);
  });

  describe('the guard of a checked call', () => {
    const setup = () => {
      const ce = new ComputeEngine();
      ce.declare('F', '(real) -> list<real>');
      ce.assign('F', ce.box(['Function', ['List', 'x', 1], 'x']));
      ce.declare('w', 'number');
      return ce;
    };

    test('a compilation that fails leaves no alias behind', () => {
      // `G` cannot be compiled (`Foo` has no lowering). The guard of
      // `Join(F(w), G(w))` compiles the initializer of `F(w)`, then fails
      // on `G(w)`. The node `F(w)` was left aliased to the temporary of
      // the failed binding, and the next compilation of the same node
      // emitted that unbound temporary (`[...([9]), ...(_tv1)]`).
      const ce = setup();
      ce.declare('G', '(real) -> list<real>');
      ce.assign('G', ce.box(['Function', ['List', ['Foo', 'x'], 1], 'x']));
      const fw = ce.box(['F', 'w']);
      const gw = ce.box(['G', 'w']);
      expect(() =>
        compile(ce.function('Join', [fw, gw]), {
          engine: ce,
          fallback: false,
        } as any)
      ).toThrow(/Foo/);
      const c = compile(ce.function('Join', [ce.box(['List', 9]), fw]), {
        engine: ce,
        fallback: false,
      } as any) as any;
      expect(String(c.code)).toBe(
        '((_tv1) => ((_tv1 === undefined) ? undefined : [...([9]), ...(_tv1)]))(_fn_F$t(_.w))'
      );
      expect(c.run({ w: 2 })).toEqual([9, 2, 1]);
    });

    // Run `c` with `Math.random` replaced by a counter: the n-th draw is
    // `0.25 · n`. Returns the value and the number of draws.
    const counted = (c: any, w: number) => {
      let draws = 0;
      const spy = jest
        .spyOn(Math, 'random')
        .mockImplementation(() => 0.25 * ++draws);
      try {
        return { value: c.run({ w }), draws };
      } finally {
        spy.mockRestore();
      }
    };

    test('the same impure checked call twice draws twice', () => {
      // One node `F(w · Random())` used as both operands of `Join`. The
      // interpreter evaluates each operand, so there are two draws. Each
      // position has its own binding, and both are tested: a failed check
      // gives `undefined` (an unguarded spread of it threw).
      const ce = setup();
      const rnd = ce.box(['F', ['Multiply', 'w', ['Random']]]);
      const c = compile(ce.function('Join', [rnd, rnd]), {
        engine: ce,
        fallback: false,
      } as any) as any;
      expect(counted(c, 1)).toEqual({ value: [0.25, 1, 0.5, 1], draws: 2 });
      expect(counted(c, Infinity)).toEqual({ value: undefined, draws: 2 });
    });

    test('an impure operand beside a guarded one is bound and tested too', () => {
      // `Join(rnd, Join([7], rnd))`: the second operand is not a checked
      // call, but it is impure, so it is bound and evaluated before the test,
      // in operand order, and it is tested for absence (the inner `Join`
      // gives `undefined` at a failed check). The guard declined here
      // before, and the spread of `undefined` threw.
      const ce = setup();
      const rnd = ce.box(['F', ['Multiply', 'w', ['Random']]]);
      const c = compile(
        ce.function('Join', [
          rnd,
          ce.function('Join', [ce.box(['List', 7]), rnd]),
        ]),
        { engine: ce, fallback: false } as any
      ) as any;
      expect(counted(c, 1)).toEqual({
        value: [0.25, 1, 7, 0.5, 1],
        draws: 2,
      });
      expect(counted(c, Infinity)).toEqual({ value: undefined, draws: 2 });
    });

    test('the same pure checked call twice is bound once', () => {
      const ce = setup();
      const fw = ce.box(['F', 'w']);
      const c = compile(ce.function('Join', [fw, fw]), {
        engine: ce,
        fallback: false,
      } as any) as any;
      expect(c.run({ w: 2 })).toEqual([2, 1, 2, 1]);
      expect(c.run({ w: Infinity })).toBeUndefined();
    });
  });

  test('several clauses: NaN selects no clause on both routes', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DefineFunction',
      'g',
      ['Function', 1, ['Typed', 'n', { str: 'integer' }]],
    ]).evaluate();
    ce.box([
      'DefineFunction',
      'g',
      ['Function', 2, ['Typed', 's', { str: 'string' }]],
    ]).evaluate();
    expect(ce.box(['g', 'NaN']).evaluate().toString()).toMatch(
      /^Error\(.*incompatible-type/
    );
    const c = compile(ce.box(['g', 'y']), { engine: ce } as any) as any;
    expect(c.success).toBe(true);
    expect(c.run({ y: 3 })).toBe(1);
    expect(() => c.run({ y: NaN })).toThrow('no-matching-clause: g');
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
