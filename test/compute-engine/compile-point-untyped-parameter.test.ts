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

function expectSameValue(json: unknown, mode: 'complex' | 'strict') {
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
  const DECLINED = new Set([
    'g3(P[1])',
    'g3(q)',
    'Reduce(P, (a, v) ↦ a + 1, 0)',
    'Reduce(P, gr, 0)',
    'Reduce(P, gr2, 0)',
    'Fold(gr, 0, P)',
    'Map(g3, P)',
    'Map(gun0, P)',
  ]);
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
    // The pipeline declines these calls: the interpreter's value is checked
    // above.
    if (DECLINED.has(label)) continue;
    test(`${label} (complex)`, () => expectSameValue(json, 'complex'));
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
    // In `strict`, a complex point at a parameter compiled as real is a
    // lane mismatch, and the compilation declines.
    test(`${label} (strict) declines`, () =>
      expect(() =>
        compile(ce.box(json as any), { fallback: false, mode: 'strict' })
      ).toThrow(/the input (Q|qc) of type/));
  }
});

describe('A point at a parameter inferred as `collection<any> | value`', () => {
  const DECLINED = new Set([
    'gm(P)',
    'Map(gm, P)',
    'Reduce(P, (a, v) ↦ a + gm(v), 0)',
    'Reduce(P, gh, (0, 0))',
    'Reduce(P, gacc, 0)',
    'Map(gd, P)',
    'Map(gm, P3)',
    'Map(gm, LL)',
    'g := p ↦ Max(p) + 1; g(q)',
    'g := p ↦ Max(p) + 1; g(P[1])',
  ]);
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
        [
          'Declare',
          'g',
          "'unknown'",
          ['Function', ['Add', ['Max', 'p'], 1], 'p'],
        ],
        ['g', 'q'],
      ],
      3,
    ],
    [
      'g := p ↦ Max(p) + 1; g(P[1])',
      [
        'Block',
        [
          'Declare',
          'g',
          "'unknown'",
          ['Function', ['Add', ['Max', 'p'], 1], 'p'],
        ],
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
    // The pipeline declines these calls: the interpreter's value is checked
    // above.
    if (DECLINED.has(label)) continue;
    test(`${label} (complex)`, () => expectSameValue(json, 'complex'));
    test(`${label} (strict)`, () => expectSameValue(json, 'strict'));
  }

  const declines: [string, unknown, RegExp][] = [
    // The function local to the block is compiled for a scalar.
    [
      'g := p ↦ Max(p) + 1; Map(g, P)',
      [
        'Block',
        [
          'Declare',
          'g',
          "'unknown'",
          ['Function', ['Add', ['Max', 'p'], 1], 'p'],
        ],
        ['Map', 'g', 'P'],
      ],
      /a function value that is not the program or the literal of a Map, a Filter or an Apply/,
    ],
  ];
  for (const [label, json, message] of declines)
    for (const mode of ['complex', 'strict'] as const)
      test(`${label} (${mode}) declines`, () =>
        expect(() =>
          compile(ce.box(json as any), { fallback: false, mode })
        ).toThrow(message));

  // Only the parameter that receives the point is typed in the literal
  // compiled for one point. A complex argument at the other parameter is a
  // lane mismatch: `strict` declines, `mode: 'complex'` compiles it.
  // Before, the call gave the string "[object Object]2".
  describe('g := (p, x) ↦ Max(p) + x; g(q, z) with a complex z', () => {
    const lane = new ComputeEngine();
    lane.declare('q', 'tuple<real, real>');
    lane.declare('z', 'complex');
    const json = [
      'Block',
      [
        'Declare',
        'g',
        "'unknown'",
        ['Function', ['Add', ['Max', 'p'], 'x'], 'p', 'x'],
      ],
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
    test('strict declines', () =>
      expect(() =>
        compile(lane.box(json as any), { fallback: false, mode: 'strict' })
      ).toThrow(/a function value that is not the program or the literal of a Map, a Filter or an Apply/));
  });

  // A complex coordinate: in `strict`, a lane mismatch. In `complex`, the
  // first point gives `NaN`, as `Max` of a complex coordinate does in a
  // direct compile (`Max(Q[1])`); the interpreter keeps
  // `1 + max(2, 1 + i)`, which has no numeric value.
  test('Map(gm, Q) (strict) declines', () =>
    expect(() =>
      compile(ce.box(['Map', 'gm', 'Q']), { fallback: false, mode: 'strict' })
    ).toThrow(/Map of a function that is not a literal of one parameter/));

  // The point may be absent, and a shader has no test of an absent value.
  for (const to of ['glsl'] as const)
    test(`gm(P[1]) on ${to} declines`, () =>
      expect(() =>
        compile(ce.box(['gm', ['At', 'P', 1]]), {
          to,
          fallback: false,
          mode: 'strict',
        })
      ).toThrow());

  // `Map` of a function defined on the engine declines on these targets.
  for (const to of ['glsl'] as const)
    test(`Map(gm, P) on ${to} declines`, () =>
      expect(() =>
        compile(ce.box(['Map', 'gm', 'P']), {
          to,
          fallback: false,
          mode: to === 'glsl' ? 'strict' : 'complex',
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

});
