import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * `When`, `If` and `Which` over a nested mask, on both routes (ROADMAP
 * CE-223).
 *
 * - CE-223.1 (user decision 2026-10-23): `When(v, C)` with a mask `C` of rank
 *   2 or more selects cell by cell at every level, as the else-less
 *   `If(C, v)` does. Before, the interpreter kept the `When` unevaluated, and
 *   the compiled code read each row as one condition that is not `True`
 *   (`[NaN, NaN]`).
 * - CE-223.2: an arm typed as a point or a list of points that holds one
 *   point at run time is lifted whole, as the interpreter lifts it. Before,
 *   the compiled code indexed the point as a list.
 * - CE-223.3: `When(B, B < 0)` with `B: broadcastable<number>` compiles: such
 *   a value cannot be a point, so an array is aligned with the mask and any
 *   other value is repeated.
 */

/** A run-time value as a MathJSON literal: arrays of arrays are lists, and
 * a boolean is `True` or `False`. `point` makes an array of numbers a
 * `Tuple`. */
function literal(v: unknown, point = false): unknown {
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (!Array.isArray(v)) return v;
  if (point && v.every((x) => !Array.isArray(x))) return ['Tuple', ...v];
  return ['List', ...v.map((x) => literal(x, point))];
}

/** The interpreter's value in the compiled spelling: `NaN` for a masked
 * number, `undefined` for a masked point, arrays for lists and points. */
function plain(json: unknown): unknown {
  if (json === 'Missing') return undefined;
  if (json === 'NaN') return NaN;
  if (typeof json === 'object' && json !== null && 'num' in json)
    return Number((json as { num: string }).num);
  if (Array.isArray(json)) {
    if (json[0] === 'List' || json[0] === 'Tuple')
      return json.slice(1).map(plain);
    return json;
  }
  return json;
}

function check(
  ce: ComputeEngine,
  json: unknown,
  inputs: Record<string, unknown>,
  points: ReadonlyArray<string> = []
): void {
  const r = compile(ce.box(json as any), {
    to: 'javascript',
    fallback: false,
  } as any) as any;
  expect(r.success).toBe(true);
  let text = JSON.stringify(json);
  for (const [name, value] of Object.entries(inputs))
    text = text
      .split(`"${name}"`)
      .join(JSON.stringify(literal(value, points.includes(name))));
  const interpreted = plain(ce.box(JSON.parse(text)).evaluate().json);
  expect(r.run(inputs)).toEqual(interpreted);
}

describe('CE-223.1: When with a mask of rank 2 selects cell by cell', () => {
  const ce = new ComputeEngine();
  ce.declare('C', 'matrix<boolean^(2x2)>');
  ce.declare('v', 'real');
  ce.declare('M', 'matrix<integer^(2x2)>');
  ce.declare('B', 'tensor<number>');
  const mask = [
    [true, false],
    [false, true],
  ];

  test('the interpreter selects at every level', () => {
    const e = ce.box([
      'When',
      5,
      ['List', ['List', 'True', 'False'], ['List', 'False', 'True']],
    ]);
    expect(e.evaluate().toString()).toBe('[[5,NaN],[NaN,5]]');
    // The same value as the else-less `If`.
    const i = ce.box([
      'If',
      ['List', ['List', 'True', 'False'], ['List', 'False', 'True']],
      5,
    ]);
    expect(e.evaluate().isSame(i.evaluate())).toBe(true);
  });

  test('the interpreter type of the restriction follows the mask', () => {
    expect(ce.box(['When', 'v', 'C']).type.toString()).toBe(
      ce.box(['If', 'C', 'v']).type.toString()
    );
  });

  test('a matrix value under a matrix mask', () => {
    check(ce, ['When', 'M', 'C'], {
      M: [
        [1, 2],
        [3, 4],
      ],
      C: mask,
    });
  });

  test('a scalar value under a matrix mask', () => {
    check(ce, ['When', 'v', 'C'], { v: 5, C: mask });
  });

  test('a mask whose rank is known at run time only', () => {
    // `B < 0` over a `tensor<number>`: a matrix at run time is a mask of
    // rank 2, a vector a mask of rank 1.
    check(ce, ['When', 'v', ['Less', 'B', 0]], {
      v: 5,
      B: [
        [1, -1],
        [-2, 3],
      ],
    });
    check(ce, ['When', 'v', ['Less', 'B', 0]], { v: 5, B: [1, -1, -2] });
    check(ce, ['When', 'B', ['Less', 'B', 0]], {
      B: [
        [1, -1],
        [-2, 3],
      ],
    });
  });

  test('a value of lower rank than the mask is refused', () => {
    // The interpreter answers `incompatible-dimensions`; compiled code
    // spells the error as `NaN`, as for `If`.
    const e = ce.box([
      'When',
      ['List', 10, 20],
      ['List', ['List', 'True', 'False'], ['List', 'False', 'True']],
    ]);
    expect(e.evaluate().toString()).toContain('incompatible-dimensions');
  });
});

describe('CE-223.2: an arm that is a point or a list of points', () => {
  const ce = new ComputeEngine();
  ce.declare('P', 'tuple<real, real> | list<tuple<real, real>>');
  ce.declare('C', 'matrix<boolean^(2x2)>');
  ce.declare('F', 'list<boolean>');

  test('one point under a nested mask is lifted whole', () => {
    check(
      ce,
      ['If', 'C', 'P'],
      {
        C: [
          [true, false],
          [false, true],
        ],
        P: [1, 2],
      },
      ['P']
    );
  });

  test('one point under a flat mask is lifted whole', () => {
    check(ce, ['If', 'F', 'P'], { F: [true, false], P: [1, 2] }, ['P']);
    check(ce, ['Which', 'F', 'P'], { F: [false, true], P: [1, 2] }, ['P']);
  });

  test('a list of points under a flat mask is indexed', () => {
    check(
      ce,
      ['If', 'F', 'P'],
      {
        F: [true, false],
        P: [
          [1, 2],
          [3, 4],
        ],
      },
      ['P']
    );
  });
});

describe('CE-223.3: When(B, B < 0) with B: broadcastable<number>', () => {
  const ce = new ComputeEngine();
  ce.declare('B', 'broadcastable<number>');

  test.each([
    [[1, -2, 3]],
    [-2],
    [2],
    [
      [
        [1, -2],
        [-3, 4],
      ],
    ],
  ])('B = %j', (B) => {
    const r = compile(ce.box(['When', 'B', ['Less', 'B', 0]]), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    const lit = literal(B);
    const interpreted = plain(
      ce.box(['When', lit as any, ['Less', lit as any, 0]]).evaluate().json
    );
    expect(r.run({ B })).toEqual(interpreted);
  });
});
