/**
 * A point (a tuple of coordinates) given to an engine-level function whose
 * parameter has no type.
 *
 * The interpreter binds the point whole to the parameter. The compiled call
 * must do the same: the static type of the argument (an `At` of a
 * `list<tuple<…>>`, a symbol declared as a tuple, an element of a list of
 * points given to `Map` or `Reduce`) selects the variant of the function
 * compiled for a point, and no run-time broadcast maps the body over the
 * coordinates. Before the variant selection of CE-712.2, `g3(P[1])` with
 * `g3 = (p) ↦ Norm(p)` gave `[1, 2]` where the interpreter gives `√5`, and
 * `gun(P[1], 5)` with `gun = (p, x) ↦ x` gave `[5, 5]` where the
 * interpreter gives `5`. A parameter that the body does not read is bound
 * whole too.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.assign('g3', ce.box(['Function', ['Norm', 'p'], 'p'] as any));
ce.assign('g8', ce.box(['Function', ['Abs', 'p'], 'p'] as any));
// The body does not read `p`.
ce.assign('gun', ce.box(['Function', 'x', 'p', 'x'] as any));
ce.assign('gun0', ce.box(['Function', 1, 'p'] as any));
// A `Reduce` combiner that does not read the element `v`, and one that
// gives the element to `g3`.
ce.assign('gr', ce.box(['Function', ['Add', 'a', 1], 'a', 'v'] as any));
ce.assign(
  'gr2',
  ce.box(['Function', ['Add', 'a', ['g3', 'v']], 'a', 'v'] as any)
);

// A body that uses the parameter whole (`Max(p)`) infers the parameter
// type `collection<any> | value`. It admits a point, and the generic
// definition reads the parameter as a scalar (`Math.max(p)`).
ce.assign('gm', ce.box(['Function', ['Add', ['Max', 'p'], 1], 'p'] as any));
ce.assign('gmn', ce.box(['Function', ['Add', ['Min', 'p'], 1], 'p'] as any));
ce.assign('gm0', ce.box(['Function', ['Max', 'p', 0], 'p'] as any));
ce.assign(
  'gm2',
  ce.box(['Function', ['Add', ['Max', 'p'], 'x'], 'p', 'x'] as any)
);
// A combiner whose accumulator is a point read by index, and a combiner
// with two parameters that reads the element whole.
ce.assign(
  'gh',
  ce.box([
    'Function',
    ['Tuple', ['Add', ['At', 'a', 1], ['Max', 'p']], ['At', 'a', 2]],
    'a',
    'p',
  ] as any)
);
ce.assign('gacc', ce.box(['Function', ['Add', 'a', ['Max', 'v']], 'a', 'v'] as any));
// A trailing parameter with a default value.
ce.assign(
  'gd',
  ce.box([
    'Function',
    ['Add', ['Max', 'p'], 'k'],
    'p',
    ['Optional', 'k', 1],
  ] as any)
);
// The same combiner as `gh`, with a declared signature.
ce.declare('ghd', '(tuple<real, real>, unknown) -> tuple<real, real>');
ce.assign(
  'ghd',
  ce.box([
    'Function',
    ['Tuple', ['Add', ['At', 'a', 1], ['Max', 'p']], ['At', 'a', 2]],
    'a',
    'p',
  ] as any)
);

ce.declare('P', 'list<tuple<real, real>>');
ce.declare('Q', 'list<tuple<complex, real>>');
ce.declare('q', 'tuple<real, real>');
ce.declare('P3', 'list<tuple<real, real, real>>');
ce.declare('LL', 'list<list<real>>');
ce.declare('LM', 'list<tuple<real, real> | missing>');
ce.declare('qc', 'tuple<complex, real>');

const BOXED = {
  P: ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  Q: ['List', ['Tuple', ['Complex', 1, 1], 2], ['Tuple', ['Complex', 2, 0], 3]],
  q: ['Tuple', 1, 2],
  P3: ['List', ['Tuple', 1, 5, 2], ['Tuple', 3, 4, 0]],
  LL: ['List', ['List', 1, 7], ['List', 3, 4, 9]],
  qc: ['Tuple', ['Complex', 1, 1], 2],
};
const INPUTS = {
  P: [
    [1, 2],
    [3, 4],
  ],
  Q: [
    [{ re: 1, im: 1 }, 2],
    [{ re: 2, im: 0 }, 3],
  ],
  q: [1, 2],
  P3: [
    [1, 5, 2],
    [3, 4, 0],
  ],
  LL: [
    [1, 7],
    [3, 4, 9],
  ],
  qc: [{ re: 1, im: 1 }, 2],
};

/** The interpreter's value of `json`, with the inputs above substituted. */
function interpret(json: unknown): unknown {
  const subs = Object.fromEntries(
    Object.entries(BOXED).map(([k, v]) => [k, ce.box(v as any)])
  );
  const v = ce
    .box(json as any)
    .subs(subs)
    .N();
  return v.isCollection ? [...v.each()].map((x) => x.re) : v.re;
}

function expectSameValue(json: unknown, mode: 'auto' | 'strict') {
  const expected = interpret(json);
  const r = compile(ce.box(json as any), { fallback: false, mode })!;
  expect(r.success).toBe(true);
  const actual = r.run!(INPUTS as any);
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as number[]).length).toBe(expected.length);
    expected.forEach((x, i) =>
      expect((actual as number[])[i]).toBeCloseTo(x as number, 12)
    );
  } else {
    expect(typeof actual).toBe('number');
    expect(actual as number).toBeCloseTo(expected as number, 12);
  }
}

describe('A point at an untyped parameter of an engine-level function', () => {
  const cases: [string, unknown, unknown][] = [
    ['g3(P[1])', ['g3', ['At', 'P', 1]], Math.sqrt(5)],
    ['gun(P[1], 5)', ['gun', ['At', 'P', 1], 5], 5],
    ['gun0(P[1])', ['gun0', ['At', 'P', 1]], 1],
    ['g3(q)', ['g3', 'q'], Math.sqrt(5)],
    ['gun(q, 5)', ['gun', 'q', 5], 5],
    ['gun0(q)', ['gun0', 'q'], 1],
    [
      'Reduce(P, (a, v) ↦ a + 1, 0)',
      ['Reduce', 'P', ['Function', ['Add', 'a', 1], 'a', 'v'], 0],
      2,
    ],
    ['Reduce(P, gr, 0)', ['Reduce', 'P', 'gr', 0], 2],
    ['Reduce(P, gr2, 0)', ['Reduce', 'P', 'gr2', 0], Math.sqrt(5) + 5],
    ['Fold(gr, 0, P)', ['Fold', 'gr', 0, 'P'], 2],
    ['Map(g3, P)', ['Map', 'g3', 'P'], [Math.sqrt(5), 5]],
    ['Map(gun0, P)', ['Map', 'gun0', 'P'], [1, 1]],
    [
      'Map((v) ↦ gun(v, 5), P)',
      ['Map', ['Function', ['gun', 'v', 5], 'v'], 'P'],
      [5, 5],
    ],
  ];
  for (const [label, json, value] of cases) {
    test(`${label}: the interpreter's value`, () =>
      expect(interpret(json)).toEqual(
        Array.isArray(value)
          ? value.map((x) => expect.closeTo(x, 12))
          : expect.closeTo(value as number, 12)
      ));
    test(`${label} (auto)`, () => expectSameValue(json, 'auto'));
    test(`${label} (strict)`, () => expectSameValue(json, 'strict'));
  }
});

describe('A complex point at an untyped parameter', () => {
  // `|(1 + i, 2)| = √(|1 + i|² + 2²) = √6`.
  const cases: [string, unknown, number][] = [
    ['g8(Q[1])', ['g8', ['At', 'Q', 1]], Math.sqrt(6)],
    ['g8(qc)', ['g8', 'qc'], Math.sqrt(6)],
    ['gun(Q[1], 5)', ['gun', ['At', 'Q', 1], 5], 5],
  ];
  for (const [label, json, value] of cases) {
    test(`${label}: the interpreter's value`, () =>
      expect(interpret(json)).toBeCloseTo(value, 12));
    // In `auto`, the compilation starts again in `mode: 'complex'`.
    test(`${label} (auto)`, () => expectSameValue(json, 'auto'));
    // In `strict`, a complex point at a parameter compiled as real is a
    // lane mismatch, and the compilation declines.
    test(`${label} (strict) declines`, () =>
      expect(() =>
        compile(ce.box(json as any), { fallback: false, mode: 'strict' })
      ).toThrow(/Lane mismatch at user-function parameter/));
  }
});

describe('A point-typed symbol at an untyped parameter on a shader', () => {
  // The variant compiled for a point takes a `vec2` and reads it whole.
  for (const to of ['glsl', 'wgsl'] as const) {
    test(`g3(q) on ${to}`, () => {
      const r = compile(ce.box(['g3', 'q']), {
        to,
        fallback: false,
        mode: 'strict',
      })!;
      expect(r.success).toBe(true);
      expect(r.code).toBe('_fn_g3_tuple_number_number(q)');
      expect(r.preamble).toMatch(/length\(p\)/);
    });
    test(`gun(q, 5) on ${to}`, () => {
      const r = compile(ce.box(['gun', 'q', 5]), {
        to,
        fallback: false,
        mode: 'strict',
      })!;
      expect(r.success).toBe(true);
      expect(r.code).toBe('_fn_gun_tuple_number_number_number(q, 5.0)');
    });
  }
});

describe('A point at a parameter inferred as `collection<any> | value`', () => {
  // Before the fix, `gm(P[1])`, `Map(gm, P)`, the block-local call and the
  // `Reduce` gave `NaN` (each point went to `Math.max(p) + 1`).
  const cases: [string, unknown, unknown][] = [
    ['gm(P[1])', ['gm', ['At', 'P', 1]], 3],
    ['gmn(P[1])', ['gmn', ['At', 'P', 1]], 2],
    ['gm0(P[1])', ['gm0', ['At', 'P', 1]], 2],
    ['gm2(P[1], 2)', ['gm2', ['At', 'P', 1], 2], 4],
    ['gm(q)', ['gm', 'q'], 3],
    ['gm((1, 2))', ['gm', ['Tuple', 1, 2]], 3],
    ['gm(P)', ['gm', 'P'], 5],
    ['Map(gm, P)', ['Map', 'gm', 'P'], [3, 5]],
    ['Map((v) ↦ gm(v), P)', ['Map', ['Function', ['gm', 'v'], 'v'], 'P'], [3, 5]],
    [
      'Reduce(P, (a, v) ↦ a + gm(v), 0)',
      ['Reduce', 'P', ['Function', ['Add', 'a', ['gm', 'v']], 'a', 'v'], 0],
      8,
    ],
    ['Reduce(P, gh, (0, 0))', ['Reduce', 'P', 'gh', ['Tuple', 0, 0]], [6, 0]],
    ['Reduce(P, gacc, 0)', ['Reduce', 'P', 'gacc', 0], 6],
    ['Map(gd, P)', ['Map', 'gd', 'P'], [3, 5]],
    ['Map(gm, P3)', ['Map', 'gm', 'P3'], [6, 5]],
    ['gm(P3[1])', ['gm', ['At', 'P3', 1]], 6],
    // A list of lists is bound whole: each row.
    ['Map(gm, LL)', ['Map', 'gm', 'LL'], [8, 10]],
    [
      'g := p ↦ Max(p) + 1; g(q)',
      [
        'Block',
        ['Assign', 'g', ['Function', ['Add', ['Max', 'p'], 1], 'p']],
        ['g', 'q'],
      ],
      3,
    ],
    [
      'g := p ↦ Max(p) + 1; g(P[1])',
      [
        'Block',
        ['Assign', 'g', ['Function', ['Add', ['Max', 'p'], 1], 'p']],
        ['g', ['At', 'P', 1]],
      ],
      3,
    ],
  ];
  for (const [label, json, value] of cases) {
    test(`${label}: the interpreter's value`, () =>
      expect(interpret(json)).toEqual(
        Array.isArray(value)
          ? value.map((x) => expect.closeTo(x, 12))
          : expect.closeTo(value as number, 12)
      ));
    test(`${label} (auto)`, () => expectSameValue(json, 'auto'));
    test(`${label} (strict)`, () => expectSameValue(json, 'strict'));
  }

  const declines: [string, unknown, RegExp][] = [
    // The function local to the block is compiled for a scalar.
    [
      'g := p ↦ Max(p) + 1; Map(g, P)',
      [
        'Block',
        ['Assign', 'g', ['Function', ['Add', ['Max', 'p'], 1], 'p']],
        ['Map', 'g', 'P'],
      ],
      /function local to the block is compiled for a scalar/,
    ],
    // The generic definition, compiled for a collection, would receive
    // the absent value.
    ['Map(gm, LM)', ['Map', 'gm', 'LM'], /the point may be absent/],
  ];
  for (const [label, json, message] of declines)
    for (const mode of ['auto', 'strict'] as const)
      test(`${label} (${mode}) declines`, () =>
        expect(() =>
          compile(ce.box(json as any), { fallback: false, mode })
        ).toThrow(message));

  // No declared parameter type of `ghd` is tested at run time, so the
  // definition for one point takes each call.
  for (const mode of ['auto', 'strict'] as const)
    test(`Reduce(P, ghd, (0, 0)) (${mode})`, () =>
      expectSameValue(['Reduce', 'P', 'ghd', ['Tuple', 0, 0]], mode));

  // Only the parameter that receives the point is typed in the literal
  // compiled for one point. A complex argument at the other parameter is a
  // lane mismatch: `auto` starts again in complex mode, `strict` declines.
  // Before, the call gave the string "[object Object]2".
  describe('g := (p, x) ↦ Max(p) + x; g(q, z) with a complex z', () => {
    const lane = new ComputeEngine();
    lane.declare('q', 'tuple<real, real>');
    lane.declare('z', 'complex');
    const json = [
      'Block',
      ['Assign', 'g', ['Function', ['Add', ['Max', 'p'], 'x'], 'p', 'x']],
      ['g', 'q', 'z'],
    ];
    test("the interpreter's value", () => {
      const v = lane
        .box(json as any)
        .subs({
          q: lane.box(['Tuple', 1, 2]),
          z: lane.box(['Complex', 1, 2]),
        })
        .N();
      expect([v.re, v.im]).toEqual([3, 2]);
    });
    test('auto', () => {
      const r = compile(lane.box(json as any), {
        fallback: false,
        mode: 'auto',
      })!;
      expect(r.success).toBe(true);
      expect(r.run!({ q: [1, 2], z: { re: 1, im: 2 } } as any)).toEqual({
        re: 3,
        im: 2,
      });
    });
    test('strict declines', () =>
      expect(() =>
        compile(lane.box(json as any), { fallback: false, mode: 'strict' })
      ).toThrow(/Lane mismatch at block-local function parameter/));
  });

  // A complex point at the parameter that the route types as the point is
  // compiled in the lane of the point: strict compiles it.
  describe('a complex point at the point parameter of a local function', () => {
    const cx = new ComputeEngine();
    cx.declare('qm', 'tuple<complex, real> | missing');
    cx.declareType('CRow', 'tuple<complex, complex>');
    cx.declare('r', 'CRow');
    test('g := p ↦ 7; g(qm) (strict)', () => {
      const json = [
        'Block',
        ['Assign', 'g', ['Function', 7, 'p']],
        ['g', 'qm'],
      ];
      const expected = cx
        .box(json as any)
        .subs({ qm: cx.box(['Tuple', ['Complex', 1, 1], 2]) })
        .N().re;
      expect(expected).toBe(7);
      const r = compile(cx.box(json as any), {
        fallback: false,
        mode: 'strict',
      })!;
      expect(r.success).toBe(true);
      expect(r.run!({ qm: [{ re: 1, im: 1 }, 2] } as any)).toBe(7);
    });
    test('g := t ↦ 2t; g(r) with r of a nominal complex point (strict)', () => {
      const json = [
        'Block',
        ['Assign', 'g', ['Function', ['Multiply', 2, 't'], 't']],
        ['g', 'r'],
      ];
      const v = cx
        .box(json as any)
        .subs({ r: cx.box(['Tuple', ['Complex', 1, 1], ['Complex', 2, -1]]) })
        .N();
      expect([...v.each()].map((x) => [x.re, x.im])).toEqual([
        [2, 2],
        [4, -2],
      ]);
      const r = compile(cx.box(json as any), {
        fallback: false,
        mode: 'strict',
      })!;
      expect(r.success).toBe(true);
      expect(
        r.run!({
          r: [
            { re: 1, im: 1 },
            { re: 2, im: -1 },
          ],
        } as any)
      ).toEqual([
        { re: 2, im: 2 },
        { re: 4, im: -2 },
      ]);
    });
  });

  // A complex coordinate: in `strict`, a lane mismatch. In `auto`, the
  // first point gives `NaN`, as `Max` of a complex coordinate does in a
  // direct compile (`Max(Q[1])`); the interpreter keeps
  // `1 + max(2, 1 + i)`, which has no numeric value.
  test('Map(gm, Q) (strict) declines', () =>
    expect(() =>
      compile(ce.box(['Map', 'gm', 'Q']), { fallback: false, mode: 'strict' })
    ).toThrow(/Lane mismatch/));
  test('Map(gm, Q) (auto)', () => {
    const r = compile(ce.box(['Map', 'gm', 'Q']), {
      fallback: false,
      mode: 'auto',
    })!;
    const v = r.run!(INPUTS as any) as number[];
    expect(Number.isNaN(v[0])).toBe(true);
    expect(v[1]).toBe(4);
  });

  // The point may be absent, and a shader has no test of an absent value.
  for (const to of ['glsl', 'wgsl'] as const)
    test(`gm(P[1]) on ${to} declines`, () =>
      expect(() =>
        compile(ce.box(['gm', ['At', 'P', 1]]), {
          to,
          fallback: false,
          mode: 'strict',
        })
      ).toThrow());

  // `Map` of a function defined on the engine declines on these targets.
  for (const to of ['python', 'glsl'] as const)
    test(`Map(gm, P) on ${to} declines`, () =>
      expect(() =>
        compile(ce.box(['Map', 'gm', 'P']), {
          to,
          fallback: false,
          mode: to === 'glsl' ? 'strict' : 'auto',
        })
      ).toThrow());
  test('Map(gm, P) on interval-js does not compile', () => {
    let r: ReturnType<typeof compile> | undefined;
    try {
      r = compile(ce.box(['Map', 'gm', 'P']), {
        to: 'interval-js',
        fallback: false,
      });
    } catch {
      r = undefined;
    }
    expect(r?.success ?? false).toBe(false);
  });

  // The call with a written point is evaluated at compile time.
  test('g := p ↦ Max(p) + 1; g((1, 2)) on python', () => {
    const r = compile(
      ce.box([
        'Block',
        ['Assign', 'g', ['Function', ['Add', ['Max', 'p'], 1], 'p']],
        ['g', ['Tuple', 1, 2]],
      ]),
      { to: 'python', fallback: false }
    )!;
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/return 3\b/);
  });
  test('g := p ↦ Max(p) + 1; g(q) on python declines', () =>
    expect(() =>
      compile(
        ce.box([
          'Block',
          ['Assign', 'g', ['Function', ['Add', ['Max', 'p'], 1], 'p']],
          ['g', 'q'],
        ]),
        { to: 'python', fallback: false }
      )
    ).toThrow(/binds the point whole/));

  // Python has no definition of `gm` compiled for one point.
  test('gm(P[1]) on python declines', () =>
    expect(() =>
      compile(ce.box(['gm', ['At', 'P', 1]]), { to: 'python', fallback: false })
    ).toThrow(/binds the point whole/));

  for (const to of ['glsl', 'wgsl'] as const)
    test(`gm(q) on ${to}`, () => {
      const r = compile(ce.box(['gm', 'q']), {
        to,
        fallback: false,
        mode: 'strict',
      })!;
      expect(r.success).toBe(true);
      expect(r.code).toBe('_fn_gm_tuple_number_number(q)');
    });
});
