/**
 * `When(value, condition)` — the Desmos restriction `value\{condition\}` —
 * with a LIST of conditions.
 *
 * The interpreter restricts element by element: one masked value per
 * condition, `Missing` where the condition is false. A list value is zipped
 * with the conditions; any other value — a number, and a POINT, which is one
 * value — is repeated at every position. Before this round a point was zipped
 * like a list (`(1, 2)\{[1, 2, 3] < 2\}` answered `[1, Missing]`, the
 * coordinates masked cell by cell), and the JavaScript compile target refused
 * every list-valued condition ("a branch condition is a collection-valued
 * expression") although the one-clause `Which(condition, value)` — the same
 * selection — already compiled element-wise. Corpus witness: eleven
 * restriction rows in four Tycho documents (`njncrg9fkv` and others).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
ce.declare('u', 'real');
ce.declare('v', 'real');
/** `[1, 2, 3] v < 2`: true at the first position for `v = 1`. */
const COND = ['Less', ['Multiply', 'v', ['List', 1, 2, 3]], 2];
const VARS = { u: 5, v: 1 };
const run = (json: unknown): unknown =>
  compile(ce.box(json), { fallback: false }).run!(VARS);
const interp = (json: unknown): string =>
  ce.box(json).subs({ u: 5, v: 1 }).evaluate().toString();

describe('a restriction with a list of conditions', () => {
  test('a scalar value is repeated at every position, masked per condition', () => {
    // A masked numeric cell is `NaN` (user decision 2026-09-25), as the
    // compiled code always answered.
    expect(interp(['When', 'u', COND])).toBe('[5,NaN,NaN]');
    expect(run(['When', 'u', COND])).toEqual([5, NaN, NaN]);
  });

  test('a point is one value: lifted whole at every position, never zipped', () => {
    expect(interp(['When', ['Tuple', 'u', 'v'], COND])).toBe(
      '[(5, 1),"Missing","Missing"]'
    );
    expect(run(['When', ['Tuple', 'u', 'v'], COND])).toEqual([
      [5, 1],
      NaN,
      NaN,
    ]);
    expect(
      ce
        .box(['When', ['Tuple', 1, 2], ['List', 'True', 'False', 'False']])
        .evaluate()
        .toString()
    ).toBe('[(1, 2),"Missing","Missing"]');
  });

  test('a list value is zipped with the conditions', () => {
    const json = [
      'When',
      ['List', 10, 20, 30],
      ['Greater', ['List', 1, 2, 3], 2],
    ];
    expect(interp(json)).toBe('[NaN,NaN,30]');
    expect(run(json)).toEqual([NaN, NaN, 30]);
  });

  test("a list value keeps the interpreter's alignment: truncated to the shorter", () => {
    const shorter = [
      'When',
      ['List', 10, 20],
      ['Less', ['List', 'v', ['Multiply', 2, 'v'], ['Multiply', 3, 'v']], 2],
    ];
    expect(interp(shorter)).toBe('[10,NaN]');
    expect(run(shorter)).toEqual([10, NaN]);
    const longer = [
      'When',
      ['List', 10, 20, 30, 40],
      ['Less', ['List', 'v', ['Multiply', 2, 'v']], 2],
    ];
    expect(interp(longer)).toBe('[10,NaN]');
    expect(run(longer)).toEqual([10, NaN]);
    const allFalse = [
      'When',
      ['List', 10, 20],
      ['Greater', ['List', 'v', ['Multiply', 2, 'v']], 5],
    ];
    expect(interp(allFalse)).toBe('[NaN,NaN]');
    expect(run(allFalse)).toEqual([NaN, NaN]);
  });

  test('a complex-valued value is masked with the complex absence', () => {
    const json = [
      'When',
      ['Add', 'u', ['Multiply', ['Complex', 0, 1], 'v']],
      ['Less', ['Multiply', 'v', ['List', 1, 2]], 2],
    ];
    expect(interp(json)).toBe('[(5 + i),NaN]');
    const out = run(json) as { re: number; im: number }[];
    expect(out[0]).toEqual({ re: 5, im: 1 });
    expect(out[1].re).toBeNaN();
  });

  test('a string is one value, repeated, with the object null as its absence', () => {
    ce.declare('s', 'string');
    const json = ['When', 's', ['Less', ['Multiply', 'v', ['List', 1, 2]], 2]];
    expect(
      ce
        .box(json)
        .subs({ v: 1, s: ce.string('a') })
        .evaluate()
        .toString()
    ).toBe('["a","Missing"]');
    expect(
      compile(ce.box(json), { fallback: false }).run!({ v: 1, s: 'a' })
    ).toEqual(['a', undefined]);
  });

  test('a value of wide type fails closed instead of guessing its shape', () => {
    // An `unknown`-typed value may hold a list at run time (aligned) or a
    // point (repeated); the compiled route cannot tell a flat array apart,
    // so it refuses rather than answer `[[10, 20, 30], NaN, NaN]` where the
    // interpreter answers `[10, Missing, Missing]`.
    ce.declare('w', 'unknown');
    expect(() =>
      compile(ce.box(['When', 'w', COND]), { fallback: false })
    ).toThrow(/may be a list or a point at run time/);
  });

  test('an empty list of conditions answers the empty list on both routes', () => {
    expect(
      ce.box(['When', ['List', 10, 20, 30], ['List']]).evaluate().json
    ).toEqual(['List']);
    expect(ce.box(['When', 'u', ['List']]).evaluate().json).toEqual(['List']);
    expect(
      compile(ce.box(['When', ['List', 10, 20, 30], ['List']]), {
        fallback: false,
      }).run!(VARS)
    ).toEqual([]);
  });

  test('a value that may be a list or a point at run time fails closed', () => {
    ce.declare('Q', 'list<tuple<number, number>> | tuple<number, number>');
    expect(() =>
      compile(ce.box(['When', 'Q', COND]), { fallback: false })
    ).toThrow(/may be a list or a point at run time/);
  });

  test('both routes agree with the one-clause Which', () => {
    expect(run(['Which', COND, ['Tuple', 'u', 'v']])).toEqual(
      run(['When', ['Tuple', 'u', 'v'], COND])
    );
  });

  test('a scalar condition is unchanged', () => {
    expect(run(['When', 'u', ['Less', 'v', 2]])).toBe(5);
    expect(run(['When', 'u', ['Greater', 'v', 2]])).toBeNaN();
  });

  test('the corpus shape: a 3-D point restricted by a list read off a range', () => {
    // `p\{PointZ(p) + 1 + |(1..3)/3 · v| + 0.08u < h(u, v)\}` with a helper `h`.
    ce.declare('h', '(number, number) -> number');
    ce.assign('h', ce.parse('(a, b) \\mapsto a + b'));
    const json = [
      'When',
      ['Tuple', 'u', 'v', 0],
      [
        'Less',
        [
          'Add',
          ['Abs', ['Multiply', ['Divide', ['Range', 1, 3], 3], 'v']],
          0.08,
        ],
        ['h', 'u', 'v'],
      ],
    ];
    expect(interp(json)).toBe('[(5, 1, 0),(5, 1, 0),(5, 1, 0)]');
    expect(run(json)).toEqual([
      [5, 1, 0],
      [5, 1, 0],
      [5, 1, 0],
    ]);
  });

  test('a shader target still fails closed on a list-valued condition', () => {
    expect(() => new GLSLTarget().compile(ce.box(['When', 'u', COND]))).toThrow(
      /branch condition is a collection-valued expression/
    );
  });
});
