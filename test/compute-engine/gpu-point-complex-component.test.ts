import { ComputeEngine, compile } from '../../src/compute-engine';

// A shader point is a `vecN` of floats. A complex value is lowered as
// `vec2(re, im)`, so a complex COMPONENT has no place in a point. GLSL accepts
// a constructor whose last argument is only partly used, so
// `vec2(t, _fn_h(t))` with a `vec2`-returning `_fn_h` compiled and the shader
// kept only the real part of the component. These spellings must fail closed
// on both shader targets, with a diagnostic that names the component.
//
// The call `h(t)` of a function declared `(unknown) -> unknown` types
// `number`, although the body `s + i` is complex. The compiler reads the
// lane that the emitted definition of `h` records (`userCallLane` in
// `base-compiler.ts`).

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('h', { signature: '(unknown) -> unknown' });
  ce.assign('h', ce.parse('s \\mapsto s + \\imaginaryI'));
  ce.declare('g', { signature: '(unknown) -> unknown' });
  ce.assign('g', ce.parse('s \\mapsto s^2'));
  return ce;
}

const TARGETS = ['glsl', 'wgsl'] as const;

function run(
  to: (typeof TARGETS)[number],
  build: (ce: ComputeEngine) => any
): { success: boolean; code?: string } {
  // A fresh engine per case: a use of `t` in a complex position can narrow
  // its inferred type, and that must not reach the next case.
  return compile(build(engine()), { to, fallback: false } as any) as any;
}

const COMPLEX_COMPONENT_LATEX = [
  '\\operatorname{PointList}(t, h(t))',
  '\\operatorname{PointList}(t, t+\\imaginaryI)',
  '\\operatorname{PointList}(t, 1 - h(t))',
  '(t, t+\\imaginaryI)',
  '(t, h(t))',
  '(t, 1 - h(t), 0)',
  '\\operatorname{PointList}(t+\\imaginaryI, 2t+\\imaginaryI)',
];

const COMPLEX_COMPONENT_MATHJSON = [
  ['PointList', 't', ['h', 't']],
  ['PointList', 't', ['Add', 't', 'ImaginaryUnit']],
  ['PointList', 't', ['Subtract', 1, ['h', 't']]],
  ['Tuple', 't', ['Add', 't', 'ImaginaryUnit']],
];

describe('GPU POINT WITH A COMPLEX COMPONENT FAILS CLOSED', () => {
  for (const to of TARGETS) {
    for (const latex of COMPLEX_COMPONENT_LATEX)
      it(`${to}, parse route: ${latex}`, () => {
        expect(() => run(to, (ce) => ce.parse(latex))).toThrow(
          /element \d+ \(`.*`\) is itself vector-valued /s
        );
      });

    for (const json of COMPLEX_COMPONENT_MATHJSON)
      it(`${to}, box route: ${JSON.stringify(json)}`, () => {
        expect(() => run(to, (ce) => ce.box(json as any))).toThrow(
          /element 2 \(`.*`\) is itself vector-valued /s
        );
      });
  }

  it('names the complex component in the diagnostic', () => {
    expect(() =>
      run('glsl', (ce) => ce.parse('\\operatorname{PointList}(t, h(t))'))
    ).toThrow(
      'Could not compile `vec2`: element 2 (`h(t)`) is itself vector-valued'
    );
    expect(() =>
      run('wgsl', (ce) => ce.parse('\\operatorname{PointList}(t, h(t))'))
    ).toThrow(
      'Could not compile `vec2f`: element 2 (`h(t)`) is itself vector-valued'
    );
  });
});

describe('GPU POINT WITH REAL COMPONENTS STILL COMPILES', () => {
  const cases: [string, any, string, string][] = [
    [
      '\\operatorname{PointList}(t, g(t))',
      ['PointList', 't', ['g', 't']],
      'vec2(t, _fn_g(t))',
      'vec2f(t, _fn_g(t))',
    ],
    [
      '(t, t^2)',
      ['Tuple', 't', ['Power', 't', 2]],
      'vec2(t, (t * t))',
      'vec2f(t, (t * t))',
    ],
    [
      '\\operatorname{PointList}(t, t^2, 1)',
      ['PointList', 't', ['Power', 't', 2], 1],
      'vec3(t, (t * t), 1.0)',
      'vec3f(t, (t * t), 1.0)',
    ],
    [
      '(t, \\operatorname{Re}(h(t)))',
      ['Tuple', 't', ['Re', ['h', 't']]],
      'vec2(t, (_fn_h(t)).x)',
      'vec2f(t, (_fn_h(t)).x)',
    ],
  ];
  for (const [latex, json, glsl, wgsl] of cases) {
    it(`parse route: ${latex}`, () => {
      expect(run('glsl', (ce) => ce.parse(latex)).code).toBe(glsl);
      expect(run('wgsl', (ce) => ce.parse(latex)).code).toBe(wgsl);
    });
    it(`box route: ${JSON.stringify(json)}`, () => {
      expect(run('glsl', (ce) => ce.box(json)).code).toBe(glsl);
      expect(run('wgsl', (ce) => ce.box(json)).code).toBe(wgsl);
    });
  }

  it('a point with one or five components keeps its array lowering', () => {
    expect(run('glsl', (ce) => ce.box(['PointList', 't'])).code).toBe(
      'float[1](t)'
    );
    expect(run('wgsl', (ce) => ce.box(['PointList', 't'])).code).toBe(
      'array<f32, 1>(t)'
    );
    expect(
      run('glsl', (ce) => ce.box(['PointList', 't', 1, 2, 3, 4])).code
    ).toBe('float[5](t, 1.0, 2.0, 3.0, 4.0)');
    expect(
      run('wgsl', (ce) => ce.box(['PointList', 't', 1, 2, 3, 4])).code
    ).toBe('array<f32, 5>(t, 1.0, 2.0, 3.0, 4.0)');
  });
});

describe('A CALL OF A USER FUNCTION WITH A COMPLEX BODY IS COMPLEX', () => {
  // The standalone consumers of `h(t)` read it as a complex value on every
  // target, also under the strict discipline, which does not promote.
  it('glsl: 1 - h(t) is complex arithmetic', () => {
    expect(run('glsl', (ce) => ce.parse('1 - h(t)')).code).toBe(
      '(-(_fn_h(t))) + vec2(1.0, 0.0)'
    );
  });

  it('wgsl: |h(t)| is the modulus', () => {
    expect(run('wgsl', (ce) => ce.parse('|h(t)|')).code).toBe(
      'length(_fn_h(t))'
    );
  });

  // The body of `h` reads the GLOBAL `k`: a complex local `k` of the calling
  // `Block` is not visible in the emitted `_fn_h`, so the call stays real.
  for (const mode of ['strict', 'auto'] as const)
    it(`javascript ${mode}: a complex caller local does not reach the body`, () => {
      const ce = new ComputeEngine();
      ce.assign('k', 1);
      ce.declare('h', { signature: '(unknown) -> unknown' });
      ce.assign('h', ce.parse('s \\mapsto s + k'));
      const expr = ce.box([
        'Block',
        ['Declare', 'k'],
        ['Assign', 'k', ['Add', 'x', 'ImaginaryUnit']],
        ['Add', ['h', 'x'], 'k'],
      ]);
      const result = compile(expr, { to: 'javascript', mode } as any) as any;
      expect(result.success).toBe(true);
      expect(result.run({ x: 0.5 })).toEqual({ re: 2, im: 1 });
    });

  it('javascript strict: 1 - h(t) evaluates to 0.5 - i at t = 0.5', () => {
    const ce = engine();
    const result = compile(ce.parse('1 - h(t)'), {
      to: 'javascript',
      mode: 'strict',
    } as any) as any;
    expect(result.success).toBe(true);
    expect(result.run({ t: 0.5 })).toEqual({ re: 0.5, im: -1 });
  });
});

describe('A SUM INDEX DOES NOT SHADOW A GLOBAL READ BY A USER FUNCTION', () => {
  // The body of `h` reads the GLOBAL `k`, which holds `i`. The emitted `_fn_h`
  // is a module-level function, so an enclosing `Sum`/`Product` index also
  // named `k` is not visible in it, and every call returns a complex value.
  // Before the fix the body was analyzed with the index in scope, the calls
  // were read as real, and the JavaScript sum concatenated the `{re, im}`
  // objects as strings (`"[object Object][object Object]…"`).
  function shadowEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('k', ce.parse('\\imaginaryI'));
    ce.declare('h', { signature: '(unknown) -> unknown' });
    ce.assign('h', ce.parse('s \\mapsto s + k'));
    // `g` reads the global through a nested user call.
    ce.declare('g', { signature: '(unknown) -> unknown' });
    ce.assign('g', ce.parse('s \\mapsto h(s)'));
    // `v` builds a list whose second element is the global.
    ce.declare('v', { signature: '(unknown) -> unknown' });
    ce.assign('v', ce.parse('s \\mapsto [s, k]'));
    return ce;
  }

  // The interpreter's value, as the `{re, im}` object JavaScript returns.
  function interpreted(expr: any, vars: Record<string, number>) {
    const value = expr.subs(vars).N();
    return { re: value.re, im: value.im };
  }

  const CASES: Array<{
    name: string;
    build: (ce: ComputeEngine) => any;
    vars: Record<string, number>;
    expected: { re: number; im: number };
  }> = [
    {
      name: 'parse route: \\sum_{k=1}^{3} h(x)',
      build: (ce) => ce.parse('\\sum_{k=1}^{3} h(x)'),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
    },
    {
      name: 'parse route: \\sum_{k=1}^{3} (h(x) + k)',
      build: (ce) => ce.parse('\\sum_{k=1}^{3} (h(x) + k)'),
      vars: { x: 2 },
      expected: { re: 12, im: 3 },
    },
    {
      name: 'parse route: \\sum_{k=1}^{3} g(x), nested user call',
      build: (ce) => ce.parse('\\sum_{k=1}^{3} g(x)'),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
    },
    {
      name: 'parse route: \\prod_{k=1}^{2} h(x)',
      build: (ce) => ce.parse('\\prod_{k=1}^{2} h(x)'),
      vars: { x: 2 },
      expected: { re: 3, im: 4 },
    },
    {
      name: 'parse route: \\sum_{k=1}^{n} h(x), run-time loop',
      build: (ce) => ce.parse('\\sum_{k=1}^{n} h(x)'),
      vars: { x: 2, n: 3 },
      expected: { re: 6, im: 3 },
    },
    {
      name: 'box route: Sum(h(x), k from 1 to 3)',
      build: (ce) => ce.box(['Sum', ['h', 'x'], ['Limits', 'k', 1, 3]]),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
    },
    {
      name: 'box route: Sum(1 + v(x)[2], k from 1 to 3), list element',
      build: (ce) =>
        ce.box([
          'Sum',
          ['Add', 1, ['At', ['v', 'x'], 2]],
          ['Limits', 'k', 1, 3],
        ]),
      vars: { x: 2 },
      expected: { re: 3, im: 3 },
    },
  ];

  for (const { name, build, vars, expected } of CASES) {
    for (const mode of ['strict', 'auto'] as const)
      it(`javascript ${mode}, ${name}`, () => {
        const ce = shadowEngine();
        const expr = build(ce);
        expect(interpreted(expr, vars)).toEqual(expected);
        const result = compile(expr, { to: 'javascript', mode } as any) as any;
        expect(result.success).toBe(true);
        expect(result.run(vars)).toEqual(expected);
      });

    // A shader `Sum`/`Product` has no complex accumulator: it fails closed.
    it(`glsl fails closed, ${name}`, () => {
      const ce = shadowEngine();
      expect(() =>
        compile(build(ce), { to: 'glsl', fallback: false } as any)
      ).toThrow(/complex-valued body not supported in GPU targets/);
    });
  }
});

describe('A POINT ARGUMENT DOES NOT HIDE A GLOBAL READ BY A USER FUNCTION', () => {
  // `p(P) := P.x + k` reads the GLOBAL `k`, which holds `i`. `p` is declared
  // `(unknown) -> unknown`, so its parameter types `collection<any> | tuple`
  // and its generic body is possibly a collection. A call with a written
  // point is emitted through a definition specialized to that point, whose
  // body is a complex scalar, so the call is complex. Before the fix the call
  // was read as the real number its result type suggests:
  // `\sum_{k=1}^{3} p((x, 1))` answered the string
  // `"[object Object][object Object][object Object]"`.
  //
  // The arguments are analyzed with the CALLER's bindings (an index `k` in
  // `p((x, k))` is the index) and the body without them (the `k` of the body
  // is the global).
  function pointEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('k', ce.parse('\\imaginaryI'));
    ce.declare('p', { signature: '(unknown) -> unknown' });
    ce.assign('p', ce.parse('P \\mapsto P.x + k'));
    ce.declare('q', { signature: '(unknown) -> unknown' });
    ce.assign('q', ce.parse('P \\mapsto P.y + k'));
    // `a` narrows its parameter to a point, so a call with a complex
    // coordinate can be inlined.
    ce.declare('a', { signature: '(tuple<real, number>) -> unknown' });
    ce.assign('a', ce.parse('P \\mapsto P.x + k'));
    return ce;
  }

  function interpreted(expr: any, vars: Record<string, number>) {
    const value = expr.subs(vars).N();
    return { re: value.re, im: value.im };
  }

  const CASES: Array<{
    name: string;
    build: (ce: ComputeEngine) => any;
    vars: Record<string, number>;
    expected: { re: number; im: number };
    // The modes in which the expression compiles. In the others it fails
    // closed and the interpreter evaluates it.
    compiles: ReadonlyArray<'strict' | 'auto'>;
  }> = [
    {
      name: 'parse route: p((x, 1))',
      build: (ce) => ce.parse('p((x, 1))'),
      vars: { x: 2 },
      expected: { re: 2, im: 1 },
      compiles: ['strict', 'auto'],
    },
    {
      name: 'parse route: \\sum_{k=1}^{3} p((x, 1))',
      build: (ce) => ce.parse('\\sum_{k=1}^{3} p((x, 1))'),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
      compiles: ['strict', 'auto'],
    },
    {
      name: 'parse route: \\sum_{j=1}^{3} p((x, 1)), no name in common',
      build: (ce) => ce.parse('\\sum_{j=1}^{3} p((x, 1))'),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
      compiles: ['strict', 'auto'],
    },
    {
      // In `strict` the radical is a real number (NaN below 5), so the point
      // reaches the specialized definition. In `auto` it is complex, the
      // call must be inlined, and the inlined `k` would be captured by the
      // index: that fails closed.
      name: 'parse route: \\sum_{k=1}^{3} p((x, \\sqrt{x-5}))',
      build: (ce) => ce.parse('\\sum_{k=1}^{3} p((x, \\sqrt{x-5}))'),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
      compiles: ['strict'],
    },
    {
      // The call is compiled through a definition of `p` specialized to the
      // argument's type (Tycho item 323), so its body is not inlined where
      // the index `k` would capture the body's `k`, and the sum adds the
      // index to the complex value the helper returns. Before item 323 the
      // call typed `broadcastable<number>` from the generic body, an addition
      // over such an operand had no complex lowering, and the case failed
      // closed (earlier still, it answered `"1[object Object]2…"`).
      name: 'parse route: \\sum_{k=1}^{3} (k + p((x, 1)))',
      build: (ce) => ce.parse('\\sum_{k=1}^{3} (k + p((x, 1)))'),
      vars: { x: 2 },
      expected: { re: 12, im: 3 },
      compiles: ['strict', 'auto'],
    },
    {
      name: 'parse route: \\sum_{k=1}^{3} q((x, k)), the index in the point',
      build: (ce) => ce.parse('\\sum_{k=1}^{3} q((x, k))'),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
      compiles: ['strict', 'auto'],
    },
    {
      name: 'parse route: \\sum_{k=1}^{300} q((x, k)), run-time loop',
      build: (ce) => ce.parse('\\sum_{k=1}^{300} q((x, k))'),
      vars: { x: 2 },
      expected: { re: 45150, im: 300 },
      compiles: ['strict', 'auto'],
    },
    {
      name: 'parse route: \\prod_{k=1}^{2} p((x, 1))',
      build: (ce) => ce.parse('\\prod_{k=1}^{2} p((x, 1))'),
      vars: { x: 2 },
      expected: { re: 3, im: 4 },
      compiles: ['strict', 'auto'],
    },
    {
      name: 'box route: Sum(p((x, 1)), k from 1 to 3)',
      build: (ce) =>
        ce.box(['Sum', ['p', ['Tuple', 'x', 1]], ['Limits', 'k', 1, 3]]),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
      compiles: ['strict', 'auto'],
    },
    {
      // Compiles for the reason stated for `k + p((x, 1))` above: the
      // specialized helper keeps the block's `k` apart from the body's.
      name: 'box route: a Block local k beside p((x, 1))',
      build: (ce) =>
        ce.box([
          'Block',
          ['Declare', 'k', "'integer'"],
          ['Assign', 'k', 2],
          ['Add', ['p', ['Tuple', 'x', 1]], 'k'],
        ]),
      vars: { x: 2 },
      expected: { re: 4, im: 1 },
      compiles: ['strict', 'auto'],
    },
    {
      // The inlined body is compiled at the call site, where the index `k`
      // would capture the body's `k`: the inlining declines, and so does the
      // call.
      name: 'parse route: \\sum_{k=1}^{3} a((x, i·x)), inlining declines',
      build: (ce) => ce.parse('\\sum_{k=1}^{3} a((x, \\imaginaryI x))'),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
      compiles: [],
    },
    {
      name: 'parse route: \\sum_{j=1}^{3} a((x, i·x)), inlined',
      build: (ce) => ce.parse('\\sum_{j=1}^{3} a((x, \\imaginaryI x))'),
      vars: { x: 2 },
      expected: { re: 6, im: 3 },
      compiles: ['strict', 'auto'],
    },
    {
      name: 'box route: a Block local k beside a((x, i·x)), inlining declines',
      build: (ce) =>
        ce.box([
          'Block',
          ['Declare', 'k', "'integer'"],
          ['Assign', 'k', 2],
          [
            'Add',
            ['a', ['Tuple', 'x', ['Multiply', 'ImaginaryUnit', 'x']]],
            'k',
          ],
        ]),
      vars: { x: 2 },
      expected: { re: 4, im: 1 },
      compiles: [],
    },
  ];

  for (const { name, build, vars, expected, compiles } of CASES) {
    for (const mode of ['strict', 'auto'] as const)
      it(`javascript ${mode}, ${name}`, () => {
        const ce = pointEngine();
        const expr = build(ce);
        expect(interpreted(expr, vars)).toEqual(expected);
        const result = compile(expr, { to: 'javascript', mode } as any) as any;
        expect(result.success).toBe(compiles.includes(mode));
        expect(result.run(vars)).toEqual(expected);
      });
  }

  // A shader `Sum` has no complex accumulator: it fails closed.
  it('glsl fails closed: \\sum_{k=1}^{3} p((x, 1))', () => {
    const ce = pointEngine();
    expect(() =>
      compile(ce.parse('\\sum_{k=1}^{3} p((x, 1))'), {
        to: 'glsl',
        fallback: false,
      } as any)
    ).toThrow(/complex-valued body not supported in GPU targets/);
  });

  it('glsl fails closed: box route Sum(p((x, 1)), k from 1 to 3)', () => {
    const ce = pointEngine();
    expect(() =>
      compile(
        ce.box(['Sum', ['p', ['Tuple', 'x', 1]], ['Limits', 'k', 1, 3]]),
        { to: 'glsl', fallback: false } as any
      )
    ).toThrow(/complex-valued body not supported in GPU targets/);
  });

  // Outside a `Sum`, the call is a complex `vec2`, and the addition is
  // complex arithmetic. Before, `1` was added to BOTH components.
  it('glsl: p((x, 1)) + 1 adds to the real part only', () => {
    const ce = pointEngine();
    expect(
      (
        compile(ce.parse('p((x, 1)) + 1'), {
          to: 'glsl',
          fallback: false,
        } as any) as any
      ).code
    ).toBe('_fn_p_tuple_number_number(vec2(x, 1.0)) + vec2(1.0, 0.0)');
  });
});

describe('A RECURSIVE CALL OF A FUNCTION WITH A WIDE RESULT TYPE', () => {
  // A call reads the lane that the emitted definition of its function
  // records. A recursive call inside the body of `r` is compiled before that
  // record exists, so its lane comes from its type. `r: (integer) -> number`
  // says nothing about the lane: the recursive call is first read as real,
  // and when the body `If(n ≤ 0, i, r(n − 1) + 1)` then proves complex, the
  // definition is compiled again with the recursive call read as complex
  // (`emitWithRecursiveLaneRetry`). Before 2026-09-24 the first compilation
  // failed closed and asked for a signature, and before that (HEAD of
  // 2026-09-23) the body added `1` to the `{re, im}` object as a string.
  const BODY =
    'n \\mapsto \\operatorname{If}(n \\le 0, \\imaginaryI, r(n-1) + 1)';

  function recursive(signature: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('r', { signature });
    ce.assign('r', ce.parse(BODY));
    return ce;
  }

  for (const mode of ['strict', 'auto', 'complex'] as const) {
    it(`javascript ${mode}: a wide signature compiles with the complex recursive call`, () => {
      const ce = recursive('(integer) -> number');
      const result = compile(ce.parse('r(n) + x'), {
        to: 'javascript',
        mode,
        fallback: false,
      } as any) as any;
      expect(result.success).toBe(true);
      expect(result.run({ n: 3, x: 1 })).toEqual({ re: 4, im: 1 });
      const alone = compile(ce.parse('r(n)'), {
        to: 'javascript',
        mode,
        fallback: false,
      } as any) as any;
      expect(alone.run({ n: 3 })).toEqual({ re: 3, im: 1 });
    });
  }

  for (const mode of ['strict', 'auto'] as const) {
    // Without a declaration, `r` types `broadcastable<number>`: a call may
    // be a scalar or a list, so the body's `+ 1` over the complex recursive
    // call has no compiled form, and the compilation fails closed. Before,
    // the body added `1` to the `{re, im}` object of the recursive call as a
    // string, and `r(n) + x` answered `"1[object Object]111"`.
    it(`javascript ${mode}: an undeclared function fails closed`, () => {
      const ce = new ComputeEngine();
      ce.assign('r', ce.parse(BODY));
      for (const latex of ['r(n) + x', 'r(n)'])
        expect(() =>
          compile(ce.parse(latex), {
            to: 'javascript',
            mode,
            fallback: false,
          } as any)
        ).toThrow(/list-valued operand|Declare the signature of `r`/);
      const fallback = compile(ce.parse('r(n) + x'), {
        to: 'javascript',
        mode,
      } as any) as any;
      expect(fallback.success).toBe(false);
      expect(fallback.run({ n: 3, x: 1 })).toEqual({ re: 4, im: 1 });
    });

    it(`javascript ${mode}: the declared complex signature compiles`, () => {
      const ce = recursive('(integer) -> complex');
      const expr = ce.parse('r(n) + x');
      const value = expr.subs({ n: 3, x: 1 }).N();
      expect({ re: value.re, im: value.im }).toEqual({ re: 4, im: 1 });
      const result = compile(expr, {
        to: 'javascript',
        mode,
        fallback: false,
      } as any) as any;
      expect(result.success).toBe(true);
      expect(result.run({ n: 3, x: 1 })).toEqual({ re: 4, im: 1 });
    });

    it(`javascript ${mode}: a real recursive body still compiles`, () => {
      const ce = new ComputeEngine();
      ce.declare('r', { signature: '(integer) -> number' });
      ce.assign(
        'r',
        ce.parse('n \\mapsto \\operatorname{If}(n \\le 0, 1, r(n-1) + 1)')
      );
      const result = compile(ce.parse('r(n) + x'), {
        to: 'javascript',
        mode,
        fallback: false,
      } as any) as any;
      expect(result.success).toBe(true);
      expect(result.run({ n: 3, x: 1 })).toBe(5);
    });
  }
});
