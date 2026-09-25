/**
 * A `Comprehension` over LITERAL domains on the shader targets.
 *
 * GLSL and WGSL have no dynamic arrays, so a comprehension declined whole on
 * both — the four point-table rows of the 3-D art document `art/n7uhaaoq1q`
 * in the Tycho code-generation audit of 0.128.9 (`[PointList(…) for y = 1..4,
 * x = 1..3]`). The target-independent pre-pass (`fixed-width-unroll.ts`,
 * rule 6) now writes such a comprehension out as the literal list of its
 * substituted bodies when every domain is a literal range or list of a small
 * total size, on the targets that ask for it (`CompileTarget.unrollComprehensions`),
 * and the shader targets lower a list of points of one arity as an array of
 * vectors (`vec3[12](…)`, `array<vec3f, 12>(…)`). A literal index into a
 * literal range folds to the number (rule 5), which the substituted rows
 * need. The JavaScript target keeps its loop.
 *
 * Of the four audit rows, the one pinned here — a literal index into a
 * COLUMN of the point list — compiled with the unroll alone. The other three
 * index the point list itself (`PointList(cols)[x]`) and needed the index
 * pushed through the zip; they are pinned in
 * `compile-index-push-through.test.ts`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
for (const s of ['u', 'v', 'n']) ce.declare(s, 'real');
ce.declare('cond', 'boolean');

const COLUMN = (k: unknown) => ['Multiply', k, ['List', 'v', 1, 'v']];
const P = [
  'PointList',
  COLUMN(['Sin', ['Multiply', 360, 'u']]),
  COLUMN(['Cos', ['Multiply', 360, 'u']]),
  ['List', 0, 'v', 1],
];
const R = ['Range', 1, 4];
const ROW = [
  'PointList',
  [
    'Multiply',
    ['Subtract', 2, ['Multiply', 0.3, ['At', R, 'y']]],
    ['At', ['PointX', P], 'x'],
  ],
  [
    'Multiply',
    ['Subtract', 2, ['Multiply', 0.3, ['At', R, 'y']]],
    ['At', ['PointY', P], 'x'],
  ],
  [
    'Subtract',
    [
      'Subtract',
      ['Multiply', -0.2, ['At', ['PointZ', P], 'x']],
      ['Multiply', 0.1, ['At', R, 'y']],
    ],
    3.4,
  ],
];
const TABLE = [
  'Comprehension',
  ROW,
  ['Element', 'y', ['Range', 1, 4]],
  ['Element', 'x', ['Range', 1, 3]],
];

function shader(
  json: unknown,
  to: 'glsl' | 'wgsl'
):
  | { code: string; declined?: undefined }
  | { code?: undefined; declined: string } {
  try {
    const r = compile(ce.box(json), {
      to,
      fallback: false,
      constantFold: false,
    });
    return r.success
      ? { code: (r.preamble ?? '') + r.code }
      : { declined: r.error ?? '' };
  } catch (e) {
    return { declined: (e as Error).message };
  }
}

describe.each(['glsl', 'wgsl'] as const)(
  '%s — a comprehension over literal domains is a fixed-size array',
  (to) => {
    test('the audit point table compiles to an array of twelve points', () => {
      const r = shader(TABLE, to);
      expect(r.declined).toBeUndefined();
      expect(r.code).toContain(
        to === 'glsl' ? 'vec3[12](' : 'array<vec3f, 12>('
      );
      expect(r.code.match(/vec3f?\(/g)!.length).toBeGreaterThanOrEqual(12);
      expect(r.code).not.toContain(';;');
    });

    test("the rows are in the interpreter's order: the first clause outermost", () => {
      const json = [
        'Comprehension',
        ['Add', ['Multiply', 10, 'x'], 'y'],
        ['Element', 'y', ['Range', 1, 2]],
        ['Element', 'x', ['Range', 1, 3]],
      ];
      expect(ce.box(json).evaluate().toString()).toBe('[11,21,31,12,22,32]');
      const r = shader(json, to);
      expect(r.code).toBe(
        to === 'glsl'
          ? 'float[6](11.0, 21.0, 31.0, 12.0, 22.0, 32.0)'
          : 'array<f32, 6>(11.0, 21.0, 31.0, 12.0, 22.0, 32.0)'
      );
    });

    test('a scalar comprehension over a literal list domain', () => {
      const json = [
        'Comprehension',
        ['Multiply', 'u', 'k'],
        ['Element', 'k', ['List', 1, 2, 5]],
      ];
      const r = shader(json, to);
      // Three scalars are a native vector on both targets.
      expect(r.code).toBe(
        to === 'glsl'
          ? 'vec3(u, 2.0 * u, 5.0 * u)'
          : 'vec3f(u, 2.0 * u, 5.0 * u)'
      );
    });

    test('a literal index into a literal range is the number', () => {
      const r = shader(['At', ['Range', 1, 10, 3], 3], to);
      expect(r.code).toBe('7.0');
    });

    test.each([
      [
        'a symbolic bound',
        ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 'n']]],
      ],
      [
        'a dependent domain',
        [
          'Comprehension',
          ['Add', 'x', 'y'],
          ['Element', 'y', ['Range', 1, 3]],
          ['Element', 'x', ['Range', 1, 'y']],
        ],
      ],
      [
        'a body with an effect',
        [
          'Comprehension',
          ['Multiply', ['Random'], 'k'],
          ['Element', 'k', ['Range', 1, 3]],
        ],
      ],
      [
        'more elements than the cap',
        ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 100]]],
      ],
    ])('%s still declines', (_name, json) => {
      const r = shader(json, to);
      expect(r.declined).toMatch(/Comprehension is not supported/);
    });
  }
);

describe.each(['glsl', 'wgsl'] as const)('%s — guards', (to) => {
  test('a huge literal range is declined without being enumerated', () => {
    const t0 = performance.now();
    const r = shader(
      ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 1e9]]],
      to
    );
    expect(r.declined).toMatch(/Comprehension is not supported/);
    expect(performance.now() - t0).toBeLessThan(2000);
    // A literal index into such a range reads through the range's own
    // indexed access.
    expect(shader(['At', ['Range', 1, 1e9], 3], to).code).toBe('3.0');
  });

  test('a domain whose head the caller overrode is left to the override', () => {
    // The comprehension is not written out over the caller's range, so the
    // target's own decline stands.
    expect(() =>
      compile(
        ce.box(['Comprehension', 'k', ['Element', 'k', ['Range', 1, 3]]]),
        { to, fallback: false, functions: { Range: '_.myRange' } }
      )
    ).toThrow(/Comprehension is not supported/);
  });

  test('a block local holding a list of points fails closed', () => {
    const r = shader(
      [
        'Block',
        ['Declare', 'a'],
        ['Assign', 'a', ['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
        ['PointX', ['At', 'a', 1]],
      ],
      to
    );
    expect(r.declined).toMatch(
      /list of points has no static shader declaration/
    );
  });

  test('arithmetic over a list of points fails closed', () => {
    const r = shader(
      ['Multiply', 'u', ['List', ['List', 1, 2], ['List', 3, 4]]],
      to
    );
    expect(r.declined).toMatch(/lowers to a shader ARRAY/);
  });

  test('an infinite literal range is declined without being walked', () => {
    const t0 = performance.now();
    const r = shader(
      [
        'Comprehension',
        'k',
        ['Element', 'k', ['Range', 1, 'PositiveInfinity']],
      ],
      to
    );
    expect(r.declined).toMatch(/Comprehension is not supported/);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  test('a selection between two lists of points fails closed', () => {
    const r = shader(
      [
        'Which',
        'cond',
        ['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        true,
        ['Tuple', ['Tuple', 5, 6], ['Tuple', 7, 8]],
      ],
      to
    );
    expect(r.declined).toMatch(/Could not compile/);
  });

  test('a list of points of one arity is an array of vectors', () => {
    const r = shader(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], to);
    expect(r.code).toBe(
      to === 'glsl'
        ? 'vec2[2](vec2(1.0, 2.0), vec2(3.0, 4.0))'
        : 'array<vec2f, 2>(vec2f(1.0, 2.0), vec2f(3.0, 4.0))'
    );
  });
});

test('the JavaScript target keeps its loop', () => {
  const r = compile(
    ce.box([
      'Comprehension',
      ['Multiply', 'u', 'k'],
      ['Element', 'k', ['Range', 1, 5]],
    ]),
    { fallback: false }
  );
  expect(r.success).toBe(true);
  expect(r.code).toContain('for (');
  expect(r.run!({ u: 2 })).toEqual([2, 4, 6, 8, 10]);
});
