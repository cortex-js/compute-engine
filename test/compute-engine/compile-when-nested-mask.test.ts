import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A restriction, `If` and `Which` over a nested mask, on both routes (ROADMAP
 * CE-223).
 *
 * - CE-223.1: a mask of rank 2 or more is not a condition (selection rule
 *   of 2026-11-02, `docs/BROADCAST-MODEL.md`, which reverses the user
 *   decision of 2026-10-23 that such a mask selects cell by cell at every
 *   level). A condition whose static type is a matrix or a nested list is a
 *   static error, and a compilation declines. A condition whose static type
 *   does not settle its shape (`B < 0` over `B: tensor<number>`) compiles;
 *   when its value is nested, the interpreter gives an `incompatible-type`
 *   error and the compiled code `NaN`, its compiled spelling.
 * - CE-223.2: an arm typed as a point or a list of points that holds one
 *   point at run time is lifted whole, as the interpreter lifts it. Before,
 *   the compiled code indexed the point as a list.
 * - CE-223.3: `If(B < 0, B)` with `B: broadcastable<number>` compiles: such
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

/** The compiled value is `NaN` where the interpreter's value is an error. */
function checkRefusedAtRunTime(
  ce: ComputeEngine,
  json: unknown,
  inputs: Record<string, unknown>
): void {
  const r = compile(ce.box(json as any), {
    to: 'javascript',
    fallback: false,
  } as any) as any;
  expect(r.success).toBe(true);
  let text = JSON.stringify(json);
  for (const [name, value] of Object.entries(inputs))
    text = text.split(`"${name}"`).join(JSON.stringify(literal(value)));
  expect(ce.box(JSON.parse(text)).evaluate().operator).toBe('Error');
  expect(r.run(inputs)).toEqual(NaN);
}

/** The compilation of `json` declines: the expression is a static error. */
function declines(ce: ComputeEngine, json: unknown): void {
  const e = ce.box(json as any);
  expect(e.isValid).toBe(false);
  expect(() =>
    compile(e, { to: 'javascript', fallback: false } as any)
  ).toThrow(/invalid expression/);
}

describe('CE-223.1: a mask of rank 2 is not a condition', () => {
  const ce = new ComputeEngine();
  ce.declare('C', 'matrix<boolean^(2x2)>');
  ce.declare('v', 'real');
  ce.declare('M', 'matrix<integer^(2x2)>');
  ce.declare('B', 'tensor<number>');

  test('the interpreter refuses a nested list condition', () => {
    const e = ce.box([
      'If',
      ['List', ['List', 'True', 'False'], ['List', 'False', 'True']],
      5,
    ]);
    expect(e.isValid).toBe(false);
    expect(e.evaluate().toString()).toContain('incompatible-type');
  });

  test('a matrix mask declines', () => {
    declines(ce, ['If', 'C', 'M']);
    declines(ce, ['If', 'C', 'v']);
  });

  test('a mask whose rank is known at run time only', () => {
    // `B < 0` over a `tensor<number>`: a vector at run time is a flat
    // mask; a matrix is a nested mask, which is refused.
    check(ce, ['If', ['Less', 'B', 0], 'v'], { v: 5, B: [1, -1, -2] });
    checkRefusedAtRunTime(ce, ['If', ['Less', 'B', 0], 'v'], {
      v: 5,
      B: [
        [1, -1],
        [-2, 3],
      ],
    });
  });
});

describe('CE-223.2: an arm that is a point or a list of points', () => {
  const ce = new ComputeEngine();
  ce.declare('P', 'tuple<real, real> | list<tuple<real, real>>');
  ce.declare('C', 'matrix<boolean^(2x2)>');
  ce.declare('F', 'list<boolean>');

  test('one point under a nested mask declines', () => {
    declines(ce, ['If', 'C', 'P']);
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

  test.each([[[1, -2, 3]], [-2], [2]])('B = %j', (B) => {
    const r = compile(ce.box(['If', ['Less', 'B', 0], 'B']), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    const lit = literal(B);
    const interpreted = plain(
      ce.box(['If', ['Less', lit as any, 0], lit as any]).evaluate().json
    );
    expect(r.run({ B })).toEqual(interpreted);
  });

  test('a matrix B is a nested mask, refused at run time', () => {
    checkRefusedAtRunTime(ce, ['If', ['Less', 'B', 0], 'B'], {
      B: [
        [1, -2],
        [-3, 4],
      ],
    });
  });
});
