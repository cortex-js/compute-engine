/**
 * `If(condition, value)` — the Desmos restriction `value\{condition\}` —
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
    expect(interp(['If', COND, 'u'])).toBe('[5,NaN,NaN]');
    expect(run(['If', COND, 'u'])).toEqual([5, NaN, NaN]);
  });

  test('a point is one value: lifted whole at every position, never zipped', () => {
    // A masked point cell is a point whose coordinates are `NaN` on both
    // routes (selection rule of 2026-11-02, which reverses the user decision
    // of 2026-10-18 that it is `Missing`, `undefined` in compiled code).
    expect(interp(['If', COND, ['Tuple', 'u', 'v']])).toBe(
      '[(5, 1),(NaN, NaN),(NaN, NaN)]'
    );
    expect(run(['If', COND, ['Tuple', 'u', 'v']])).toEqual([
      [5, 1],
      [NaN, NaN],
      [NaN, NaN],
    ]);
    expect(
      ce
        .box(['If', ['List', 'True', 'False', 'False'], ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[(1, 2),(NaN, NaN),(NaN, NaN)]');
  });

  test('a list value is zipped with the conditions', () => {
    const json = [
      'If',
      ['Greater', ['List', 1, 2, 3], 2],
      ['List', 10, 20, 30],
    ];
    expect(interp(json)).toBe('[NaN,NaN,30]');
    expect(run(json)).toEqual([NaN, NaN, 30]);
  });

  test('a list value of another length than the conditions is a static error', () => {
    // A list arm has the length of the condition (selection rule of
    // 2026-11-02). Before, the value was truncated to the shorter length,
    // `[10,NaN]` for both forms below.
    const shorter = [
      'If',
      ['Less', ['List', 'v', ['Multiply', 2, 'v'], ['Multiply', 3, 'v']], 2],
      ['List', 10, 20],
    ];
    expect(interp(shorter)).toBe('Error("incompatible-dimensions", "3 vs 2")');
    expect(() => run(shorter)).toThrow(/invalid expression/);
    const longer = [
      'If',
      ['Less', ['List', 'v', ['Multiply', 2, 'v']], 2],
      ['List', 10, 20, 30, 40],
    ];
    expect(interp(longer)).toBe('Error("incompatible-dimensions", "2 vs 4")');
    expect(() => run(longer)).toThrow(/invalid expression/);
    const allFalse = [
      'If',
      ['Greater', ['List', 'v', ['Multiply', 2, 'v']], 5],
      ['List', 10, 20],
    ];
    expect(interp(allFalse)).toBe('[NaN,NaN]');
    expect(run(allFalse)).toEqual([NaN, NaN]);
  });

  test('a complex-valued value is masked with plain NaN', () => {
    // Plain `NaN`, as the element-wise `Which` gives it: `IsMissing` and
    // `Coalesce` test `Number.isNaN`, which reads the complex value
    // `{ re: NaN, im: NaN }` as present, and they must read the masked cell
    // as absent (R3 of `docs/plans/2026-11-01-absent-value-contract.md`).
    const json = [
      'If',
      ['Less', ['Multiply', 'v', ['List', 1, 2]], 2],
      ['Add', 'u', ['Multiply', ['Complex', 0, 1], 'v']],
    ];
    expect(interp(json)).toBe('[(5 + i),NaN]');
    const out = run(json) as unknown[];
    expect(out[0]).toEqual({ re: 5, im: 1 });
    expect(out[1]).toBeNaN();
  });

  test('a string under a list of conditions is a static error', () => {
    // A string cell has no value for a position that is not selected
    // (selection rule of 2026-11-02). Before, the string was repeated, with
    // `Missing` (`undefined` in compiled code) where a condition is false.
    ce.declare('s', 'string');
    const json = ['If', ['Less', ['Multiply', 'v', ['List', 1, 2]], 2], 's'];
    expect(ce.box(json).isValid).toBe(false);
    expect(() => compile(ce.box(json), { fallback: false })).toThrow(
      /invalid expression/
    );
  });

  test('a value of wide type fails closed instead of guessing its shape', () => {
    // An `unknown`-typed value may hold a list at run time (aligned) or a
    // point (repeated); the compiled route cannot tell a flat array apart,
    // so it refuses rather than answer `[[10, 20, 30], NaN, NaN]` where the
    // interpreter answers `[10, Missing, Missing]`.
    ce.declare('w', 'unknown');
    expect(() =>
      compile(ce.box(['If', COND, 'w']), { fallback: false })
    ).toThrow(/may be a list or a point at run time/);
  });

  test('an empty list of conditions answers the empty list on both routes', () => {
    expect(
      ce.box(['If', ['List'], ['List', 10, 20, 30]]).evaluate().json
    ).toEqual(['List']);
    expect(ce.box(['If', ['List'], 'u']).evaluate().json).toEqual(['List']);
    expect(
      compile(ce.box(['If', ['List'], ['List', 10, 20, 30]]), {
        fallback: false,
      }).run!(VARS)
    ).toEqual([]);
  });

  test('a value declared as a point or a list of points is decided at run time', () => {
    // A flat array cannot say by itself whether it is a point or a list, but
    // a list of points holds arrays and a point holds numbers. The compiled
    // code tests the value of `Q` once and holds one body for each shape: a
    // point is one value, repeated at every position; a list of points is
    // zipped with the conditions. Each result equals the interpreter's.
    ce.declare('Q', 'list<tuple<number, number>> | tuple<number, number>');
    const r = compile(ce.box(['If', COND, 'Q']), { fallback: false });
    expect(r.success).toBe(true);
    const interpQ = (Q: unknown) =>
      ce
        .box(['If', COND, 'Q'])
        .subs({ Q: ce.box(Q as never), v: 1 })
        .evaluate()
        .toString();
    expect(r.run!({ ...VARS, Q: [3, 4] })).toEqual([
      [3, 4],
      [NaN, NaN],
      [NaN, NaN],
    ]);
    expect(interpQ(['Tuple', 3, 4])).toBe('[(3, 4),(NaN, NaN),(NaN, NaN)]');
    expect(
      r.run!({
        ...VARS,
        Q: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      })
    ).toEqual([
      [1, 2],
      [NaN, NaN],
      [NaN, NaN],
    ]);
    expect(
      interpQ(['List', ['Tuple', 1, 2], ['Tuple', 3, 4], ['Tuple', 5, 6]])
    ).toBe('[(1, 2),(NaN, NaN),(NaN, NaN)]');
  });

  test('both routes agree with the one-clause Which', () => {
    expect(run(['Which', COND, ['Tuple', 'u', 'v']])).toEqual(
      run(['If', COND, ['Tuple', 'u', 'v']])
    );
  });

  test('a scalar condition is unchanged', () => {
    expect(run(['If', ['Less', 'v', 2], 'u'])).toBe(5);
    expect(run(['If', ['Greater', 'v', 2], 'u'])).toBeNaN();
  });

  test('the corpus shape: a 3-D point restricted by a list read off a range', () => {
    // `p\{PointZ(p) + 1 + |(1..3)/3 · v| + 0.08u < h(u, v)\}` with a helper `h`.
    ce.declare('h', '(number, number) -> number');
    ce.assign('h', ce.parse('(a, b) \\mapsto a + b'));
    const json = [
      'If',
      [
        'Less',
        [
          'Add',
          ['Abs', ['Multiply', ['Divide', ['Range', 1, 3], 3], 'v']],
          0.08,
        ],
        ['h', 'u', 'v'],
      ],
      ['Tuple', 'u', 'v', 0],
    ];
    expect(interp(json)).toBe('[(5, 1, 0),(5, 1, 0),(5, 1, 0)]');
    expect(run(json)).toEqual([
      [5, 1, 0],
      [5, 1, 0],
      [5, 1, 0],
    ]);
  });

  test('a shader target still fails closed on a list-valued condition', () => {
    expect(() => new GLSLTarget().compile(ce.box(['If', COND, 'u']))).toThrow(
      /No signature of `Less` in the GLSL fragment takes operands of the types \(list<real, 3>, integer\)/
    );
  });
});

describe('an infinite mask is read only as far as needed', () => {
  // The element-wise restriction read the whole condition list on its first
  // element, so an infinite condition list ran out of memory.
  test('a finite value with an infinite mask', () => {
    const expr = ce.box([
      'If',
      ['Range', 1, 'PositiveInfinity'],
      ['List', 1, 2, 3],
    ]);
    expect(expr.count).toBe(3);
    expect([...expr.each()].map((x) => x.toString())).toEqual([
      'If(Error(ErrorCode("incompatible-type", "boolean", "list<integer>"), Range(1, +oo)), 1)',
      'If(Error(ErrorCode("incompatible-type", "boolean", "list<integer>"), Range(1, +oo)), 2)',
      'If(Error(ErrorCode("incompatible-type", "boolean", "list<integer>"), Range(1, +oo)), 3)',
    ]);
  });

  test('an infinite value with an infinite mask', () => {
    const expr = ce.box([
      'If',
      ['Range', 1, 'PositiveInfinity'],
      ['Range', 1, 'PositiveInfinity'],
    ]);
    expect(expr.count).toBe(Infinity);
    expect(expr.at(4)?.toString()).toBe(
      'If(Error(ErrorCode("incompatible-type", "boolean", "list<integer>"), Range(1, +oo)), 4)'
    );
    // One element far out is looked up directly, not by reading every
    // condition before it.
    expect(expr.at(50_000_000)?.toString()).toBe(
      'If(Error(ErrorCode("incompatible-type", "boolean", "list<integer>"), Range(1, +oo)), 50000000)'
    );
  });

  test('an infinite value with a finite mask stops at the mask', () => {
    const expr = ce.box([
      'If',
      ['List', 'True', 'False'],
      ['Range', 1, 'PositiveInfinity'],
    ]);
    expect(expr.count).toBe(2);
    expect([...expr.each()].map((x) => x.toString())).toEqual([
      'If("True", 1)',
      'If("False", 2)',
    ]);
    expect(expr.at(3)).toBeUndefined();
  });
});
