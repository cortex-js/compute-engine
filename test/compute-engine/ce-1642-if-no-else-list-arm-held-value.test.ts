/**
 * CE-1642: an `If` with no else whose arm is a list (a Desmos restriction of
 * a list of curves), stored as the value of a name that the program reads.
 *
 * The value of the name is lowered at each read of the name. Its list of NaN
 * stands for the absent list where each occurrence of the name in the
 * program is read by an operator that cannot tell the two apart (`At`,
 * `First`, `Last`, a reduction, arithmetic read in the same way), and where
 * no value of another name and no body of a user function has the name. A
 * `Length` or a discharge of the name, anywhere, declines.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('x', 'real');

const box = (json: unknown) => ce.box(json as never);

const inside = ['LessEqual', 0, 'x', 6];
// `If(0 ≤ x ≤ 6, x + [0, 4, 2])`: at `x = 1.5`, `[1.5, 5.5, 3.5]`.
const r = box(['If', inside, ['Add', 'x', ['List', 0, 4, 2]]]);
ce.declare('C', { value: r });
// The same boxed value under a second name.
ce.declare('C2', { value: r });
// A value that holds the restricted list under an operator.
ce.declare('E', {
  value: box(['Multiply', 2, ['If', inside, ['Add', 'x', ['List', 0, 4, 2]]]]),
});
// A value of another name that reads `C` with `Length`.
ce.declare('N', { value: box(['Length', 'C']) });
ce.declare('f', 'function');
ce.assign('f', box(['Function', ['Add', 't', ['Length', 'C']], 't']));

const JS = {
  to: 'javascript',
  mode: 'strict',
  inputs: { x: 'real' },
  fallback: false,
} as const;
const INTERVAL = { to: 'interval-js', symbolic: ['x'], fallback: false };

/** The values of `e` (MathJSON, or a boxed expression) compiled to
 *  JavaScript at each `x`. */
const js = (e: unknown, xs: number[]) => {
  const c = compile(
    Array.isArray(e) || typeof e === 'string' ? box(e) : (e as never),
    JS
  );
  expect(c.success).toBe(true);
  return xs.map((x) => c.run!({ x } as never));
};

/** The interpreter's value of `e` at `x`. */
const interpreted = (e: unknown, x: number) =>
  ce.withValues({ x } as never, () => box(e).evaluate().toString());

/** The message of a compilation that throws, or `undefined`. */
function failure(e: unknown, options: object = JS): string | undefined {
  try {
    compile(
      Array.isArray(e) || typeof e === 'string' ? box(e) : (e as never),
      options as never
    );
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

const DECLINED =
  /an If with no else of a list arm whose value is read by other than At, First, Last, an arithmetic operator or a reduction/;

const point = (x: number) => ({ kind: 'interval', value: { lo: x, hi: x } });
const EMPTY = { kind: 'empty' };

describe('CE-1642: a restricted list held by a name', () => {
  test('At of the name on JavaScript', () => {
    expect(js(['At', 'C', 1], [1.5, 7])).toEqual([1.5, NaN]);
    expect(interpreted(['At', 'C', 1], 1.5)).toBe('1.5');
    expect(interpreted(['At', 'C', 1], 7)).toBe('NaN');
  });

  test('At of the name on interval-js', () => {
    const c = compile(box(['At', 'C', 1]), INTERVAL as never);
    expect(c.success).toBe(true);
    expect(c.run!({ x: 1.5 } as never)).toEqual(point(1.5));
    expect(c.run!({ x: 7 } as never)).toEqual(EMPTY);
  });

  test('the name as the result of the program', () => {
    expect(js('C', [1.5, 7])).toEqual([
      [1.5, 5.5, 3.5],
      [NaN, NaN, NaN],
    ]);
  });

  test('two reads of the name, and First and Last', () => {
    expect(js(['Max', ['At', 'C', 1], ['At', 'C', 2]], [1.5, 7])).toEqual([
      5.5,
      NaN,
    ]);
    expect(js(['Add', ['First', 'C'], ['Last', 'C']], [1.5, 7])).toEqual([
      5,
      NaN,
    ]);
  });

  test('a restricted list of a function body next to a read of another name', () => {
    // `h(t) ≔ If(0 ≤ t ≤ 6, t + [0, 4, 2])`, and `L` holds `x + [1, 2, 3]`:
    // the read of `L` after the call keeps the list of NaN of the body.
    ce.declare('h', 'function');
    ce.assign(
      'h',
      box([
        'Function',
        ['If', ['LessEqual', 0, 't', 6], ['Add', 't', ['List', 0, 4, 2]]],
        't',
      ])
    );
    ce.declare('L', { value: box(['Add', 'x', ['List', 1, 2, 3]]) });
    expect(
      js(['Block', ['At', ['h', 'x'], 1], ['At', 'L', 1]], [1.5, 7])
    ).toEqual([2.5, 8]);
  });

  test('a restricted list under an operator of the value', () => {
    expect(js(['At', 'E', 2], [1.5, 7])).toEqual([11, NaN]);
    expect(failure(['Length', 'E'])).toMatch(DECLINED);
  });
});

describe('CE-1642: a read of the name that can tell an absent list declines', () => {
  test('Length and the discharges', () => {
    // The interpreter gives `Missing` at `x = 7`; a list of NaN would give 3.
    expect(failure(['Length', 'C'])).toMatch(DECLINED);
    expect(failure(['IsMissing', 'C'])).toMatch(DECLINED);
    expect(failure(['Add', ['At', 'C', 1], ['Length', 'C']])).toMatch(DECLINED);
    expect(failure(['Add', ['Length', 'C'], ['At', 'C', 1]])).toMatch(DECLINED);
  });

  test('a read in the value of another name', () => {
    expect(failure(['Add', ['At', 'C', 1], 'N'])).toMatch(DECLINED);
    expect(failure(['Add', 'N', ['At', 'C', 1]])).toMatch(DECLINED);
  });

  test('a read in the body of a user function', () => {
    expect(failure(['Add', ['At', 'C', 1], ['f', 0]])).toMatch(DECLINED);
    expect(failure(['Add', ['f', 0], ['At', 'C', 1]])).toMatch(DECLINED);
  });

  test('a read only in another value or a body declines (the simple version)', () => {
    // `M` holds `At(C, 1)`, and `g(t) := t + At(C, 1)`: the places of `C`
    // in another value or a body are not followed.
    ce.declare('M', { value: box(['At', 'C', 1]) });
    ce.declare('g', 'function');
    ce.assign('g', box(['Function', ['Add', 't', ['At', 'C', 1]], 't']));
    expect(failure('M')).toMatch(DECLINED);
    expect(failure(['g', 0])).toMatch(DECLINED);
  });

  test('a second name that holds the same value', () => {
    expect(failure(['Add', ['At', 'C', 1], ['Length', 'C2']])).toMatch(
      DECLINED
    );
    expect(failure(['Add', ['At', 'C2', 1], ['Length', 'C']])).toMatch(
      DECLINED
    );
  });

  test('one boxed If that is both the value of a name and a node of the program', () => {
    const at = ce.function('Coalesce', [
      ce.function('At', [r, ce.number(1)]),
      ce.number(0),
    ]);
    const length = box(['Length', 'C']);
    for (const ops of [
      [length, at],
      [at, length],
    ])
      expect(failure(ce.function('Add', ops))).toMatch(DECLINED);
  });
});
