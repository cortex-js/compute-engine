import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A parenthesized list `(…)` with a LIST coordinate is a LIST OF POINTS (the Desmos reading,
 * user decision 2026-09-24): `(A, B)` with `A = [1, 2, 3]` and
 * `B = [10, 20, 30]` is the points `(1, 10), (2, 20), (3, 30)`, the same value
 * as `PointList(A, B)`. The tuple is canonicalized to `PointList(…)`, so its
 * value, its type, the compiled code and every operator that reads it agree:
 * a scalar coordinate repeats at every point, and sources of unequal lengths
 * stop at the shortest one (the `PointList` rule).
 *
 * The decision reads the operand TYPES when the tuple is canonicalized: a
 * tuple of symbols with no known type stays a plain `Tuple`. Only the LaTeX
 * parenthesized list (a `Delimiter`) is read this way; a MathJSON `Tuple`
 * holds its values side by side.
 */

const A = [1, 2, 3];
const B = [10, 20, 30];
const P = [
  [100, 1000],
  [200, 2000],
  [300, 3000],
];

/** An engine where `A`, `B`, `P` are declared and hold their values. */
function valuedEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('A', 'list<real>');
  ce.declare('B', 'list<real>');
  ce.declare('P', 'list<tuple<real, real>>');
  ce.assign('A', ce.box(['List', ...A]));
  ce.assign('B', ce.box(['List', ...B]));
  ce.assign('P', ce.box(['List', ...P.map((p) => ['Tuple', ...p])]));
  return ce;
}

/** An engine where `A`, `B`, `P` are declared but hold no value (a symbol
 *  with a value is folded into the compiled code). */
function declaredEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('A', 'list<real>');
  ce.declare('B', 'list<real>');
  ce.declare('P', 'list<tuple<real, real>>');
  return ce;
}

/** A value as plain nested arrays of numbers. */
function plain(e: any): unknown {
  if (e.operator === 'Tuple') return e.ops.map(plain);
  if (e.isFiniteCollection) return [...e.each()].map(plain);
  return e.re;
}

const ce = valuedEngine();
const value = (latex: string) => plain(ce.parse(latex).N());
const close = (actual: unknown, expected: unknown) => {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((x, i) => close((actual as unknown[])[i], x));
  } else expect(actual as number).toBeCloseTo(expected as number, 12);
};

describe('A tuple with a list coordinate is a list of points — interpreter', () => {
  test('(A, B) canonicalizes to PointList(A, B)', () => {
    const e = ce.parse('(A, B)');
    expect(e.json).toEqual(['PointList', 'A', 'B']);
    expect(e.type.toString()).toBe('list<tuple<real, real>>');
    expect(e.evaluate().toString()).toBe('[(1, 10),(2, 20),(3, 30)]');
  });

  test('the parenthesized list is read this way on the box route too', () => {
    const e = ce.box(['Delimiter', ['Sequence', 'A', 'B'], "'(,)'"]);
    expect(e.json).toEqual(['PointList', 'A', 'B']);
    expect(e.evaluate().toString()).toBe('[(1, 10),(2, 20),(3, 30)]');
  });

  test('a MathJSON Tuple stays a tuple that holds its values', () => {
    // A MathJSON `Tuple` holds several results side by side (`Tally`,
    // `Eigen`, an Epsil tuple literal): only the LaTeX surface form `(…)` is
    // read as a list of points.
    const e = ce.box(['Tuple', 'A', 'B']);
    expect(e.operator).toBe('Tuple');
    expect(e.evaluate().toString()).toBe('([1,2,3], [10,20,30])');
    expect(
      ce
        .box(['Tally', ['List', 1, 1, 2]])
        .evaluate()
        .toString()
    ).toBe('([1,2], [2,1])');
  });

  test('a Tuple of list literals serializes to LaTeX that parses back as a Tuple', () => {
    // The parenthesized spelling `([1], [2])` parses as a list of points, so
    // the serializer spells such a tuple `\operatorname{Tuple}(…)`. A bare
    // comma list of lists (no parentheses) parses as a `Tuple`.
    const e = ce.parse('[1, 2], [3, 4]');
    expect(e.json).toEqual(['Tuple', ['List', 1, 2], ['List', 3, 4]]);
    expect(e.latex).toBe(
      '\\operatorname{Tuple}(\\bigl\\lbrack1, 2\\bigr\\rbrack,\\bigl\\lbrack3, 4\\bigr\\rbrack)'
    );
    expect(ce.parse(e.latex).isSame(e)).toBe(true);
    for (const json of [
      ['Tuple', ['List', 1]],
      ['Tuple', ['Range', 1, 3], 2],
      ['Pair', ['List', 1], ['List', 2]],
    ]) {
      const t = ce.box(json);
      expect(ce.parse(t.latex).isSame(t)).toBe(true);
    }
    // The decision reads the operand TYPES, as the parser does: `A` and `B`
    // hold lists of numbers, so `(A,B)` would parse as `PointList(A, B)`.
    const ab = ce.box(['Tuple', 'A', 'B']);
    expect(ab.latex).toBe('\\operatorname{Tuple}(A,B)');
    expect(ce.parse(ab.latex).isSame(ab)).toBe(true);
    // Any list-of-numbers coordinate selects the longer spelling, even when
    // the other coordinates would keep a `Tuple`: the parser types them in
    // the scope of the tuple, which can differ from the current scope.
    const aSet = ce.box(['Tuple', 'A', ['Set', 1]]);
    expect(aSet.latex).toBe('\\operatorname{Tuple}(A,\\lbrace1\\rbrace)');
    expect(ce.parse(aSet.latex).isSame(aSet)).toBe(true);
    // A tuple with no list coordinate keeps the parenthesized spelling.
    expect(ce.box(['Tuple', 1, 2]).latex).toBe('(1,2)');
    expect(ce.box(['Tuple', 'x']).latex).toBe('(x,)');
  });

  test('Length((A, B)) is the number of points', () => {
    expect(
      ce.parse('\\operatorname{Length}((A, B))').evaluate().toString()
    ).toBe('3');
  });

  test('PointX((A, B)) is the first coordinates (unchanged)', () => {
    expect(value('\\operatorname{PointX}((A, B))')).toEqual([1, 2, 3]);
  });

  test('P + (A, B) pairs the points element by element', () => {
    const expected = [
      [101, 1010],
      [202, 2020],
      [303, 3030],
    ];
    expect(value('P + (A, B)')).toEqual(expected);
    expect(value('P + \\operatorname{PointList}(A, B)')).toEqual(expected);
    expect(ce.parse('P + (A, B)').type.toString()).toBe(
      'list<tuple<real, real>>'
    );
  });

  test('Norm((A, B)) is one norm per point', () => {
    expect(ce.parse('\\operatorname{Norm}((A, B))').evaluate().toString()).toBe(
      '[sqrt(101),2sqrt(101),3sqrt(101)]'
    );
  });

  test('Dot((A, B), (1, 1)) is one dot product per point', () => {
    expect(value('\\operatorname{Dot}((A, B), (1, 1))')).toEqual([11, 22, 33]);
  });

  test('Distance((A, B), (0, 0)) is one distance per point', () => {
    close(value('\\operatorname{Distance}((A, B), (0, 0))'), [
      Math.hypot(1, 10),
      Math.hypot(2, 20),
      Math.hypot(3, 30),
    ]);
  });

  test('(A, B) + (1, 1) shifts every point', () => {
    expect(value('(A, B) + (1, 1)')).toEqual([
      [2, 11],
      [3, 21],
      [4, 31],
    ]);
  });

  test('2 (A, B) scales every point', () => {
    expect(value('2\\cdot(A, B)')).toEqual([
      [2, 20],
      [4, 40],
      [6, 60],
    ]);
  });

  test('(cos A, sin A) is the list of circle points', () => {
    const e = ce.parse('(\\cos A, \\sin A)');
    expect(e.operator).toBe('PointList');
    close(
      plain(e.N()),
      A.map((a) => [Math.cos(a), Math.sin(a)])
    );
  });

  test('a scalar coordinate repeats at every point', () => {
    expect(value('(A, 0)')).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  test('sources of unequal lengths stop at the shortest one', () => {
    expect(value('(A, [7, 8])')).toEqual([
      [1, 7],
      [2, 8],
    ]);
    expect(ce.parse('(A, [7, 8])').evaluate().toString()).toBe(
      ce.parse('\\operatorname{PointList}(A, [7, 8])').evaluate().toString()
    );
  });

  test('a tuple of scalars is unchanged', () => {
    const e = ce.parse('(1, 2)');
    expect(e.json).toEqual(['Tuple', 1, 2]);
    expect(e.type.toString()).toBe('tuple<integer, integer>');
  });

  test('a tuple of symbols with no known type stays a tuple', () => {
    const e = ce.parse('(u, v)');
    expect(e.json).toEqual(['Tuple', 'u', 'v']);
    expect(e.evaluate().toString()).toBe('(u, v)');
  });

  test('a coordinate that is a matrix keeps the tuple a tuple', () => {
    // A list of lists (or of points) is not in scope: that tuple is one
    // point whose coordinate is the whole collection, as before.
    const e = ce.parse('([[1, 2], [3, 4]], 0)');
    expect(e.operator).toBe('Tuple');
    expect(e.evaluate().toString()).toBe('([[1,2],[3,4]], 0)');
  });
});

describe('A tuple with a list coordinate is a list of points — compiled JavaScript', () => {
  const run = (latex: string): unknown => {
    const r = compile(declaredEngine().parse(latex), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    return (r.run as (v: Record<string, unknown>) => unknown)({ A, B, P });
  };

  test.each([
    ['(A, B)'],
    ['\\operatorname{Length}((A, B))'],
    ['\\operatorname{PointX}((A, B))'],
    ['P + (A, B)'],
    ['\\operatorname{Norm}((A, B))'],
    ['\\operatorname{Dot}((A, B), (1, 1))'],
    ['\\operatorname{Distance}((A, B), (0, 0))'],
    ['(A, B) + (1, 1)'],
    ['2\\cdot(A, B)'],
    ['(\\cos A, \\sin A)'],
    ['(A, 0)'],
    ['(A, [7, 8])'],
  ])('%s agrees with the interpreter', (latex) => {
    close(run(latex), value(latex));
  });

  test('P + (A, B) is the same as P + PointList(A, B)', () => {
    expect(run('P + (A, B)')).toEqual(
      run('P + \\operatorname{PointList}(A, B)')
    );
    expect(run('P + (A, B)')).toEqual([
      [101, 1010],
      [202, 2020],
      [303, 3030],
    ]);
  });
});

describe('A tuple with a list coordinate is a list of points — compiled interval-js', () => {
  /** The midpoint of every interval in a compiled interval result. */
  const mid = (x: any): unknown => {
    if (Array.isArray(x)) return x.map(mid);
    if (x && x.kind === 'interval') return mid(x.value);
    if (x && typeof x.lo === 'number') return (x.lo + x.hi) / 2;
    return x;
  };
  const run = (latex: string): unknown => {
    const r = compile(declaredEngine().parse(latex), {
      to: 'interval-js',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    return mid((r.run as (v: Record<string, unknown>) => unknown)({ A, B, P }));
  };

  test.each([
    ['(A, B)'],
    ['\\operatorname{Length}((A, B))'],
    ['\\operatorname{PointX}((A, B))'],
    ['P + (A, B)'],
    ['(A, B) + (1, 1)'],
    ['2\\cdot(A, B)'],
    ['(\\cos A, \\sin A)'],
    ['(A, 0)'],
    ['(A, [7, 8])'],
  ])('%s agrees with the interpreter', (latex) => {
    close(run(latex), value(latex));
  });
});

describe('A tuple with a list coordinate is a list of points — shader targets', () => {
  // A shader point is a single `vecN`: a list of points is not an
  // expression-level value there, so the compile fails closed with the
  // `PointList` shape diagnostic, as it did for the tuple before.
  test.each([['glsl'], ['wgsl']])('%s fails closed', (to) => {
    for (const latex of ['(A, B)', 'P + (A, B)', '2\\cdot(A, B)'])
      expect(() =>
        compile(declaredEngine().parse(latex), { to, fallback: false } as any)
      ).toThrow(
        /Could not compile `PointList`: component 1 is collection-valued/
      );
  });
});

describe('Arithmetic over a MathJSON Tuple with a list coordinate fails closed', () => {
  // A MathJSON `Tuple` with a list coordinate stays data (it is not
  // canonicalized to `PointList`), but arithmetic over it is an error (user
  // decision 2026-09-25): it used to combine the lists coordinate by
  // coordinate and give a tuple of lists, which is neither a point nor a list
  // of points. The error is the `incompatible-type` operand error, raised at
  // evaluation; the compiled targets decline.
  const errorCode = (e: any): string | undefined =>
    e.operator === 'Error' ? e.op1.op1?.string : undefined;

  const cases: [string, any][] = [
    [
      'Tuple(1, 1) + Tuple(A, B)',
      ['Add', ['Tuple', 1, 1], ['Tuple', 'A', 'B']],
    ],
    ['2 · Tuple(A, B)', ['Multiply', 2, ['Tuple', 'A', 'B']]],
    ['P + Tuple(A, B)', ['Add', 'P', ['Tuple', 'A', 'B']]],
    [
      'Tuple(A, B) − Tuple(1, 1)',
      ['Subtract', ['Tuple', 'A', 'B'], ['Tuple', 1, 1]],
    ],
    ['Tuple(A, B) / 2', ['Divide', ['Tuple', 'A', 'B'], 2]],
    ['−Tuple(A, B)', ['Negate', ['Tuple', 'A', 'B']]],
    ['Tuple(A, B)^2', ['Power', ['Tuple', 'A', 'B'], 2]],
  ];

  test.each(cases)('%s is an incompatible-type error', (_, json) => {
    const e = ce.box(json);
    // The canonical form is kept: the check happens at evaluation.
    expect(e.operator).not.toBe('Error');
    for (const r of [e.evaluate(), e.N()]) {
      expect(r.operator).toBe('Error');
      expect(errorCode(r)).toBe('incompatible-type');
      // The error names the offending tuple.
      expect(r.op2.toString()).toBe('([1,2,3], [10,20,30])');
    }
  });

  test('the error says a point was expected', () => {
    const r = ce.box(['Add', ['Tuple', 1, 1], ['Tuple', 'A', 'B']]).evaluate();
    expect(r.op1.op2.string).toBe('tuple<number, number>');
  });

  test.each(cases)('%s declines to compile to JavaScript', (_, json) => {
    expect(() =>
      compile(declaredEngine().box(json), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/tuple with a list coordinate/);
  });

  test('a tuple of scalars still adds, scales and compiles', () => {
    expect(
      ce
        .box(['Add', ['Tuple', 1, 1], ['Tuple', 2, 3]])
        .evaluate()
        .toString()
    ).toBe('(3, 4)');
    expect(
      ce
        .box(['Multiply', 2, ['Tuple', 2, 3]])
        .evaluate()
        .toString()
    ).toBe('(4, 6)');
    expect(ce.box(['Negate', ['Tuple', 2, 3]]).json).toEqual(['Tuple', -2, -3]);
    const r = compile(
      declaredEngine().box(['Add', ['Tuple', 1, 1], ['Tuple', 2, 3]]),
      { to: 'javascript', fallback: false } as any
    );
    expect(r.success).toBe(true);
    expect((r.run as () => unknown)()).toEqual([3, 4]);
  });

  test('reading a data tuple is unchanged: PointX, Norm, Dot, Length', () => {
    const t = ['Tuple', 'A', 'B'];
    expect(ce.box(['PointX', t]).evaluate().toString()).toBe('[1,2,3]');
    expect(ce.box(['Norm', t]).evaluate().toString()).toBe(
      '[sqrt(101),2sqrt(101),3sqrt(101)]'
    );
    expect(
      ce
        .box(['Dot', t, ['Tuple', 1, 1]])
        .evaluate()
        .toString()
    ).toBe('[11,22,33]');
    expect(ce.box(['Length', t]).evaluate().toString()).toBe('2');
  });

  test('a tuple with a matrix coordinate is unchanged', () => {
    expect(
      ce
        .box([
          'Add',
          ['Tuple', ['List', ['List', 1, 2], ['List', 3, 4]], 0],
          ['Tuple', 1, 1],
        ])
        .evaluate().operator
    ).not.toBe('Error');
  });

  test('the LaTeX (A, B) + (1, 1) still gives the points', () => {
    expect(value('(A, B) + (1, 1)')).toEqual([
      [2, 11],
      [3, 21],
      [4, 31],
    ]);
  });
});

describe('A point parameter called with a list of points maps over the points', () => {
  // User decision 2026-09-25: a user function whose parameter is declared as
  // a point (a tuple type) and that is called with a list of points answers
  // the list of its values at each point, on the interpreter and on the
  // compiled JavaScript target. `k := P ↦ |P − (4, 0)|` at `(x, y)` with
  // `x = [1, 2]`, `y = 3` is `[|(1, 3) − (4, 0)|, |(2, 3) − (4, 0)|]`.
  const expected = [Math.hypot(3, 3), Math.hypot(2, 3)];
  const DECLARATIONS: [string, string][] = [
    ['tuple<broadcastable<number>, broadcastable<number>>', 'number'],
    ['tuple<real, real>', 'real'],
    ['tuple<number, number>', 'number'],
  ];
  const ROUTES: [string, (ce: ComputeEngine) => any][] = [
    ['LaTeX (x, y)', (ce) => ce.parse('k\\left(\\left(x,y\\right)\\right)')],
    ['PointList(x, y)', (ce) => ce.box(['k', ['PointList', 'x', 'y']])],
  ];

  /** `k` declared `(param) -> result` and assigned `P ↦ |P − (4, 0)|`;
   * `x`, `y` declared, and assigned when `valued`. */
  function pointEngine(
    param: string,
    result: string,
    valued: boolean
  ): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('k', { signature: `(${param}) -> ${result}` });
    ce.assign('k', ce.parse('P\\mapsto\\left|P-\\left(4,0\\right)\\right|'));
    ce.declare('x', 'list<real>');
    ce.declare('y', 'real');
    if (valued) {
      ce.assign('x', ce.box(['List', 1, 2]));
      ce.assign('y', 3);
    }
    return ce;
  }

  for (const [param, result] of DECLARATIONS)
    for (const [route, build] of ROUTES) {
      test(`${param}: ${route} on the interpreter`, () => {
        const ce = pointEngine(param, result, true);
        const call = build(ce);
        expect(call.isValid).toBe(true);
        expect(call.type.toString()).toBe(`list<${result}>`);
        expect(call.evaluate().toString()).toBe('[3sqrt(2),sqrt(13)]');
        close(plain(call.N()), expected);
      });

      test(`${param}: ${route} compiled to JavaScript`, () => {
        const ce = pointEngine(param, result, false);
        const r = compile(build(ce), {
          to: 'javascript',
          fallback: false,
        } as any);
        expect(r.success).toBe(true);
        close((r.run as any)({ x: [1, 2], y: 3 }), expected);
      });
    }

  test('a symbol holding a list of points maps too', () => {
    const ce = pointEngine('tuple<real, real>', 'real', true);
    ce.declare('Q', 'list<tuple<real, real>>');
    ce.assign('Q', ce.box(['List', ['Tuple', 1, 3], ['Tuple', 2, 3]]));
    expect(ce.box(['k', 'Q']).evaluate().toString()).toBe(
      '[3sqrt(2),sqrt(13)]'
    );
  });

  test('evaluateAsync maps over the points', async () => {
    const ce = pointEngine('tuple<real, real>', 'real', true);
    const r = await ce
      .parse('k\\left(\\left(x,y\\right)\\right)')
      .evaluateAsync();
    expect(r.toString()).toBe('[3sqrt(2),sqrt(13)]');
  });

  test('a lambda with a typed point parameter maps too', async () => {
    // `ce.assign` of a literal with a typed parameter makes an operator
    // definition rather than a value definition: the other evaluation route.
    const ce = new ComputeEngine();
    ce.assign(
      'k',
      ce.box([
        'Function',
        ['Abs', ['Subtract', 'P', ['Tuple', 4, 0]]],
        ['Typed', 'P', "'tuple<real, real>'"],
      ])
    );
    ce.declare('x', 'list<real>');
    ce.declare('y', 'real');
    const r = compile(ce.parse('k\\left(\\left(x,y\\right)\\right)'), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    close((r.run as any)({ x: [1, 2], y: 3 }), expected);
    ce.assign('x', ce.box(['List', 1, 2]));
    ce.assign('y', 3);
    const call = ce.parse('k\\left(\\left(x,y\\right)\\right)');
    expect(call.type.toString()).toMatch(/^list</);
    expect(call.evaluate().toString()).toBe('[3sqrt(2),sqrt(13)]');
    expect((await call.evaluateAsync()).toString()).toBe('[3sqrt(2),sqrt(13)]');
  });

  test('a single point is one value', () => {
    for (const [param, result] of DECLARATIONS) {
      const ce = pointEngine(param, result, false);
      const call = ce.parse('k\\left(\\left(5,1\\right)\\right)');
      expect(call.type.toString()).not.toMatch(/^list/);
      expect(call.evaluate().toString()).toBe('sqrt(2)');
      const r = compile(call, { to: 'javascript', fallback: false } as any);
      expect(r.success).toBe(true);
      expect((r.run as any)()).toBeCloseTo(Math.SQRT2, 12);
    }
  });

  test('a list parameter takes the list of points whole', () => {
    // A parameter declared as a LIST binds its argument whole: the call is
    // not mapped. `n := L ↦ Length(L)` is the number of points.
    const ce = pointEngine('tuple<real, real>', 'real', true);
    ce.declare('n', { signature: '(list<tuple<real, real>>) -> integer' });
    ce.assign('n', ce.parse('L\\mapsto\\operatorname{Length}(L)'));
    const call = ce.parse('n\\left(\\left(x,y\\right)\\right)');
    expect(call.type.toString()).toBe('integer');
    expect(call.evaluate().toString()).toBe('2');
    const ce2 = pointEngine('tuple<real, real>', 'real', false);
    ce2.declare('n', { signature: '(list<tuple<real, real>>) -> integer' });
    ce2.assign('n', ce2.parse('L\\mapsto\\operatorname{Length}(L)'));
    const r = compile(ce2.parse('n\\left(\\left(x,y\\right)\\right)'), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    expect((r.run as any)({ x: [1, 2], y: 3 })).toBe(2);

    // A `list<real>` parameter is not a point parameter: the list `x` is
    // passed whole, not mapped.
    ce.declare('m', { signature: '(list<real>) -> integer' });
    ce.assign('m', ce.parse('L\\mapsto\\operatorname{Length}(L)'));
    expect(ce.parse('m(x)').evaluate().toString()).toBe('2');
  });

  test('a list that is not a list of points is still refused', () => {
    const ce = pointEngine('tuple<real, real>', 'real', true);
    const call = ce.parse('k(x)');
    expect(call.isValid).toBe(false);
  });

  test('the code-built Tuple(x, y) is an error, not a list of points', () => {
    for (const [param, result] of DECLARATIONS) {
      const ce = pointEngine(param, result, true);
      const r = ce.box(['k', ['Tuple', 'x', 'y']]).N();
      expect(r.operator).toBe('Error');
      expect(r.op1.op1.string).toBe('incompatible-type');
      expect(() =>
        compile(
          pointEngine(param, result, false).box(['k', ['Tuple', 'x', 'y']]),
          {
            to: 'javascript',
            fallback: false,
          } as any
        )
      ).toThrow(/tuple with a list coordinate/);
    }
  });

  test.each([['glsl'], ['wgsl'], ['interval-js']])(
    'the %s target fails closed',
    (to) => {
      // A list of points is not a shader value, and the interval target has
      // no lowering for a call that maps over points (it does not compile
      // this body at a single point either). The shader targets throw; the
      // interval target reports the decline in its result.
      const ce = pointEngine('tuple<real, real>', 'real', false);
      let result: any;
      let thrown: unknown;
      try {
        result = compile(ce.parse('k\\left(\\left(x,y\\right)\\right)'), {
          to,
          fallback: false,
        } as any);
      } catch (e) {
        thrown = e;
      }
      if (thrown === undefined) {
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/list of points/);
      } else expect(String(thrown)).toMatch(/Could not compile/);
    }
  );
});

describe('A parameter with no declared type called with a list of points maps over the points', () => {
  // The interpreter broadcasts a list at a parameter with no declared type
  // element by element, and each element of a list of points is one point:
  // `k := P ↦ |P − (4, 0)|` at `(x, y)` with `x = [1, 2]`, `y = 3` is
  // `[|(1, 3) − (4, 0)|, |(2, 3) − (4, 0)|]`. The compiled JavaScript maps
  // the call over the points and calls the definition of `k` for one point.
  const expected = [4.242640687119285, 3.605551275463989];
  const ROUTES: [string, (ce: ComputeEngine) => any][] = [
    ['LaTeX (x, y)', (ce) => ce.parse('k\\left(\\left(x,y\\right)\\right)')],
    ['PointList(x, y)', (ce) => ce.box(['k', ['PointList', 'x', 'y']])],
  ];

  /** `k` assigned `P ↦ |P − (4, 0)|`, declared with `signature` when there
   * is one; `x`, `y` declared, and assigned when `valued`. */
  function untypedEngine(
    signature: string | undefined,
    valued: boolean
  ): ComputeEngine {
    const ce = new ComputeEngine();
    if (signature !== undefined) ce.declare('k', { signature });
    ce.assign('k', ce.parse('P\\mapsto\\left|P-\\left(4,0\\right)\\right|'));
    ce.declare('x', 'list<real>');
    ce.declare('y', 'real');
    if (valued) {
      ce.assign('x', ce.box(['List', 1, 2]));
      ce.assign('y', 3);
    }
    return ce;
  }

  for (const [label, signature] of [
    ['(unknown) -> number', '(unknown) -> number'],
    ['no signature', undefined],
  ] as [string, string | undefined][])
    for (const [route, build] of ROUTES)
      test(`${label}: ${route} compiles and equals the interpreter`, () => {
        const interpreted = plain(build(untypedEngine(signature, true)).N());
        expect(interpreted).toEqual(expected);
        const r = compile(build(untypedEngine(signature, false)), {
          to: 'javascript',
          fallback: false,
        } as any);
        expect(r.success).toBe(true);
        expect((r.run as any)({ x: [1, 2], y: 3 })).toEqual(expected);
      });

  test('a list of scalars keeps the element broadcast', () => {
    const ce = new ComputeEngine();
    ce.assign('k2', ce.parse('t\\mapsto t^2+1'));
    ce.declare('x', 'list<real>');
    const r = compile(ce.box(['k2', 'x']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/_SYS\.bcastFn\(/);
    expect((r.run as any)({ x: [1, 2] })).toEqual([2, 5]);
  });

  test.each([['glsl'], ['wgsl'], ['interval-js']])(
    'the %s target fails closed',
    (to) => {
      let result: any;
      let thrown: unknown;
      try {
        result = compile(
          untypedEngine('(unknown) -> number', false).parse(
            'k\\left(\\left(x,y\\right)\\right)'
          ),
          { to, fallback: false } as any
        );
      } catch (e) {
        thrown = e;
      }
      if (thrown === undefined) {
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/list of points/);
      } else expect(String(thrown)).toMatch(/Could not compile/);
    }
  );
});

describe('The point-list reading needs number coordinates only', () => {
  // A parenthesized list is a list of points only when every coordinate is a
  // number or a list of numbers. Any other coordinate keeps a plain `Tuple`.
  test('a string, set or boolean coordinate keeps the tuple', () => {
    for (const latex of ['(A, \\text{hi})', '(A, \\{1, 2\\})', '(A, \\top)'])
      expect(ce.parse(latex).operator).toBe('Tuple');
  });

  test('a list of strings is not a list coordinate', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'list<string>');
    expect(ce.parse('(S, 1)').json).toEqual(['Tuple', 'S', 1]);
  });

  test('a bare list (element type unknown) is not a list coordinate', () => {
    // `M: list` could later hold a matrix: the reading is decided when the
    // expression is canonicalized, so it must not guess a list of numbers.
    const ce = new ComputeEngine();
    ce.declare('M', 'list');
    const e = ce.parse('(M, 0)');
    expect(e.json).toEqual(['Tuple', 'M', 0]);
    ce.assign('M', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(e.evaluate().toString()).toBe('([[1,2],[3,4]], 0)');
  });

  test('a symbol with no known type is still a number coordinate', () => {
    expect(ce.parse('(A, u)').operator).toBe('PointList');
  });

  test('the reading is fixed when the expression is canonicalized', () => {
    // A symbol assigned a list after the parse keeps the tuple reading; a
    // new parse sees the list.
    const ce = new ComputeEngine();
    const e = ce.parse('(W, 0)');
    ce.assign('W', ce.box(['List', 1, 2]));
    expect(e.operator).toBe('Tuple');
    expect(ce.parse('(W, 0)').operator).toBe('PointList');
  });

  test('only a list in parentheses is read as a list of points', () => {
    // A `Delimiter` with other delimiters builds a `Tuple`, never a
    // `PointList`.
    expect(ce.box(['Delimiter', ['Sequence', 'A', 'B'], "'[,]'"]).json).toEqual(
      ['Tuple', 'A', 'B']
    );
    expect(ce.box(['Delimiter', ['Sequence', 'A', 'B']]).json).toEqual([
      'PointList',
      'A',
      'B',
    ]);
  });
});

describe('Sqrt and Root over a MathJSON Tuple with a list coordinate fail closed', () => {
  // `Sqrt` and `Root` are the canonical forms of `Power` with the exponents
  // 1/2 and 1/n. Over a data tuple they are an error, as `Power` is.
  const cases: [string, any][] = [
    ['Sqrt(Tuple(A, B))', ['Sqrt', ['Tuple', 'A', 'B']]],
    ['Root(Tuple(A, B), 3)', ['Root', ['Tuple', 'A', 'B'], 3]],
    [
      'Power(Tuple(A, B), 1/2)',
      ['Power', ['Tuple', 'A', 'B'], ['Rational', 1, 2]],
    ],
  ];
  test.each(cases)('%s is an incompatible-type error', (_, json) => {
    for (const r of [ce.box(json).evaluate(), ce.box(json).N()]) {
      expect(r.operator).toBe('Error');
      expect(r.op1.op1.string).toBe('incompatible-type');
    }
  });
  test.each(cases)('%s declines to compile to JavaScript', (_, json) => {
    expect(() =>
      compile(declaredEngine().box(json), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/tuple with a list coordinate/);
  });
});

describe('Absences in a list of points', () => {
  /** `k` declared `(tuple<real, real>) -> real` and assigned
   * `P ↦ |P − (4, 0)|`; `A`, `B` declared lists, `t` a real. */
  function absenceEngine(valued: boolean): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('k', { signature: '(tuple<real, real>) -> real' });
    ce.assign('k', ce.parse('P\\mapsto\\left|P-\\left(4,0\\right)\\right|'));
    ce.declare('A', 'list<real>');
    ce.declare('B', 'list<real>');
    ce.declare('t', 'real');
    ce.declare('x', 'list<real>');
    ce.declare('y', 'real');
    if (valued) {
      ce.assign('A', ce.box(['List', 1, 2]));
      ce.assign('B', ce.box(['List', 3, 3]));
    }
    return ce;
  }
  const runJS = (latex: string, vars: Record<string, unknown>): unknown => {
    const r = compile(absenceEngine(false).parse(latex), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    return (r.run as any)(vars);
  };
  const values = { A: [1, 2], B: [3, 3] };

  test('an empty list of points maps to the empty list', () => {
    const ce = absenceEngine(false);
    ce.assign('x', ce.box(['List']));
    ce.assign('y', 3);
    const call = ce.box(['k', ['PointList', 'x', 'y']]);
    expect(call.type.toString()).toBe('list<real>');
    expect(call.evaluate().toString()).toBe('[]');
    expect(call.N().toString()).toBe('[]');
    const r = compile(
      absenceEngine(false).box(['k', ['PointList', 'x', 'y']]),
      { to: 'javascript', fallback: false } as any
    );
    expect(r.success).toBe(true);
    expect((r.run as any)({ x: [], y: 3 })).toEqual([]);
  });

  test('a restricted list of points at a point parameter', () => {
    const latex = 'k\\left(\\left(A,B\\right)\\{0<t\\}\\right)';
    const ce = absenceEngine(true);
    const call = ce.parse(latex);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('list<real> | missing');
    ce.assign('t', 1);
    expect(call.evaluate().toString()).toBe('[3sqrt(2),sqrt(13)]');
    ce.assign('t', -1);
    expect(call.evaluate().symbol).toBe('Missing');
    close(runJS(latex, { ...values, t: 1 }), [
      Math.hypot(3, 3),
      Math.hypot(2, 3),
    ]);
    expect(runJS(latex, { ...values, t: -1 })).toBeUndefined();
  });

  test('a list that holds a restricted point, at a point parameter', () => {
    const latex =
      'k\\left(\\left[\\left(3,4\\right)\\{0<t\\},\\left(6,8\\right)\\right]\\right)';
    const ce = absenceEngine(true);
    const call = ce.parse(latex);
    expect(call.isValid).toBe(true);
    expect(call.type.toString()).toBe('list<missing | real>');
    ce.assign('t', 1);
    expect(call.evaluate().toString()).toBe('[sqrt(17),2sqrt(17)]');
    ce.assign('t', -1);
    const r = call.evaluate();
    expect(r.ops![0].symbol).toBe('Missing');
    expect(r.ops![1].toString()).toBe('2sqrt(17)');
    close(runJS(latex, { t: 1 }), [Math.hypot(1, 4), Math.hypot(2, 8)]);
    const js = runJS(latex, { t: -1 }) as unknown[];
    expect(js.length).toBe(2);
    expect(js[0]).toBeUndefined();
    expect(js[1]).toBeCloseTo(Math.hypot(2, 8), 12);
  });

  test('a PointList with an absent source is absent', () => {
    for (const latex of [
      '\\operatorname{PointList}(A\\{0<t\\}, B)',
      '(A\\{0<t\\}, B)',
    ]) {
      const ce = absenceEngine(true);
      const e = ce.parse(latex);
      expect(e.json).toEqual([
        'PointList',
        ['When', 'A', ['Less', 0, 't']],
        'B',
      ]);
      expect(e.type.toString()).toBe('list<tuple<real, real>> | missing');
      ce.assign('t', 1);
      expect(e.evaluate().toString()).toBe('[(1, 3),(2, 3)]');
      ce.assign('t', -1);
      expect(e.evaluate().symbol).toBe('Missing');
      expect(e.N().symbol).toBe('Missing');
      expect(ce.parse(`${latex} + (1, 1)`).evaluate().symbol).toBe('Missing');
      expect(runJS(latex, { ...values, t: 1 })).toEqual([
        [1, 3],
        [2, 3],
      ]);
      expect(runJS(latex, { ...values, t: -1 })).toBeUndefined();
    }
  });

  test('a point parameter maps over a PointList with an absent source', () => {
    const latex = 'k\\left(\\left(A\\{0<t\\},B\\right)\\right)';
    const ce = absenceEngine(true);
    const call = ce.parse(latex);
    expect(call.type.toString()).toBe('list<real> | missing');
    ce.assign('t', 1);
    expect(call.evaluate().toString()).toBe('[3sqrt(2),sqrt(13)]');
    ce.assign('t', -1);
    expect(call.evaluate().symbol).toBe('Missing');
    expect(runJS(latex, { ...values, t: -1 })).toBeUndefined();
  });
});

describe('A list of points at a parameter that also admits a matrix', () => {
  // `k := P ↦ Dot(P, P)` has the inferred parameter type
  // `list<tuple> | matrix | tuple | vector`. The interpreter binds a list of
  // points whole, and `Dot` of a list of points pairs the points. On
  // JavaScript a list of points and a matrix are both arrays of arrays, so
  // the compiled definition cannot tell them apart: the call declines.
  function dotEngine(valued: boolean): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('k', ce.parse('P\\mapsto\\operatorname{Dot}(P, P)'));
    ce.declare('x', 'list<real>');
    ce.declare('y', 'real');
    if (valued) {
      ce.assign('x', ce.box(['List', 1, 2]));
      ce.assign('y', 3);
    }
    return ce;
  }

  test('the interpreter pairs the points', () => {
    expect(
      dotEngine(true)
        .box(['k', ['PointList', 'x', 'y']])
        .evaluate()
        .toString()
    ).toBe('[10,13]');
  });

  test('the compiled call declines', () => {
    expect(() =>
      compile(dotEngine(false).box(['k', ['PointList', 'x', 'y']]), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/also admits a matrix/);
  });

  test('a single point still compiles', () => {
    const r = compile(dotEngine(false).box(['k', ['Tuple', 1, 3]]), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    expect((r.run as any)()).toBe(10);
  });
});
