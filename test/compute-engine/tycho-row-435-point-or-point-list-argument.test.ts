import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A call of a user function whose parameter is declared as a point
 * (`tuple<number, number>`), with an argument whose type says it is ONE
 * point OR a list of points: `tuple<number, number> | list<tuple<number,
 * number>>`, or `broadcastable<tuple<number, number>>`.
 *
 * The interpreter decides at the value: it binds a point whole and maps the
 * call over a list of points. So the call is typed `R | list<R>`, and the
 * compiled JavaScript tests the value at run time. Before the fix, the call
 * of the union was typed `R` and compiled to one call of the function on the
 * whole list (`x + 1` of an array is a string: `["1,21", "3,41"]`), and the
 * call of `broadcastable<…>` was typed `list<R>` and compiled to a map, which
 * read a single point as a list.
 *
 * ROADMAP CE-407, Tycho row 435
 * (`~/dev/tycho/scripts/repros/2026-10-24-ce435-union-argument-to-tuple-param-compile-repro.mts`).
 */

const POINT = 'tuple<number, number>';
const UNION = `${POINT} | list<${POINT}>`;
const BROADCASTABLE = `broadcastable<${POINT}>`;

function engine(argType: string, param = POINT): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('f', { signature: `(${param}) -> ${POINT}` });
  ce.assign('f', ce.parse('a \\mapsto (a.x+1, a.y+1)'));
  ce.declare('L', argType);
  return ce;
}

function run(ce: ComputeEngine, value: unknown): unknown {
  const result = compile(ce.parse('f(L)'), { fallback: false } as never) as {
    success: boolean;
    run?: (vars: Record<string, unknown>) => unknown;
  };
  expect(result.success).toBe(true);
  return result.run!({ L: value });
}

describe('A POINT OR A LIST OF POINTS at a point parameter (CE-407)', () => {
  test('the union: the call is typed as a point or a list of points', () => {
    const ce = engine(UNION);
    expect(ce.parse('f(L)').type.toString()).toBe(
      'list<tuple<number, number>> | tuple<number, number>'
    );
  });

  test('the union: compiled, a list of points is mapped', () => {
    expect(
      run(engine(UNION), [
        [1, 2],
        [3, 4],
      ])
    ).toEqual([
      [2, 3],
      [4, 5],
    ]);
  });

  test('the union: compiled, one point is given whole', () => {
    expect(run(engine(UNION), [1, 2])).toEqual([2, 3]);
  });

  test('the union: compiled, an empty list is an empty list', () => {
    expect(run(engine(UNION), [])).toEqual([]);
  });

  test('the union: the interpreter agrees', () => {
    const ce = engine(UNION);
    ce.assign('L', ce.parse('[(1,2),(3,4)]'));
    expect(ce.parse('f(L)').evaluate().toString()).toBe('[(2, 3),(4, 5)]');
    ce.assign('L', ce.parse('(1,2)'));
    expect(ce.parse('f(L)').evaluate().toString()).toBe('(2, 3)');
  });

  test('the union with a list of integer points', () => {
    const ce = engine(`${POINT} | list<tuple<integer, integer>>`);
    expect(
      run(ce, [
        [1, 2],
        [3, 4],
      ])
    ).toEqual([
      [2, 3],
      [4, 5],
    ]);
  });

  test('the union with `missing`: an absent argument answers `Missing`', () => {
    const ce = engine(`${UNION} | missing`);
    expect(ce.parse('f(L)').type.toString()).toBe(
      'list<tuple<number, number>> | missing | tuple<number, number>'
    );
    expect(run(ce, undefined)).toBeUndefined();
    expect(run(ce, [1, 2])).toEqual([2, 3]);
    ce.assign('L', ce.Missing);
    expect(ce.parse('f(L)').evaluate().json).toBe('Missing');
  });

  test('`broadcastable<tuple<…>>`: typed as a point or a tensor of points', () => {
    // The call maps to the points at every depth, so a value of
    // `broadcastable<P>` gives a value of `broadcastable<R>` (user decision
    // 2026-10-25, ROADMAP CE-448). It was `R | list<R>`.
    const ce = engine(BROADCASTABLE);
    expect(ce.parse('f(L)').type.toString()).toBe(
      'broadcastable<tuple<number, number>>'
    );
  });

  test('`broadcastable<tuple<…>>`: compiled, a point and a list of points', () => {
    expect(run(engine(BROADCASTABLE), [1, 2])).toEqual([2, 3]);
    expect(
      run(engine(BROADCASTABLE), [
        [1, 2],
        [3, 4],
      ])
    ).toEqual([
      [2, 3],
      [4, 5],
    ]);
  });

  test('`broadcastable<tuple<…>>`: a matrix of points maps at rank 2, as the interpreter does', () => {
    // Before the user decision of 2026-10-25 (ROADMAP CE-448), the
    // interpreter answered an `incompatible-type` error and the compiled
    // call threw.
    expect(run(engine(BROADCASTABLE), [[[1, 2]], [[3, 4]]])).toEqual([
      [[2, 3]],
      [[4, 5]],
    ]);
    const ce = engine(BROADCASTABLE);
    const type = ce.parse('f(L)').type;
    ce.assign('L', ce.parse('[[(1,2)],[(3,4)]]'));
    const value = ce.parse('f(L)').evaluate();
    expect(value.toString()).toBe('[[(2, 3)],[(4, 5)]]');
    expect(value.type.matches(type)).toBe(true);
  });

  test('a union with a list of lists of points maps by the depth of the value', () => {
    // Each arm is a point, a list of points or a list of lists of points,
    // so the interpreter and the compiled call read the depth from the
    // value (ROADMAP CE-489). Before, the compiled call was declined, and
    // the interpreter typed the call as one point.
    const type = `${UNION} | list<list<${POINT}>>`;
    expect(run(engine(type), [1, 2])).toEqual([2, 3]);
    expect(
      run(engine(type), [
        [1, 2],
        [3, 4],
      ])
    ).toEqual([
      [2, 3],
      [4, 5],
    ]);
    expect(run(engine(type), [[[1, 2]], [[3, 4]]])).toEqual([
      [[2, 3]],
      [[4, 5]],
    ]);
    // Each interpreter value fits the static type of the call, and is the
    // value of the compiled call. A `List` or a `Tuple` of the MathJSON
    // value is an array of the compiled value.
    const plain = (x: unknown): unknown =>
      Array.isArray(x) && (x[0] === 'List' || x[0] === 'Tuple')
        ? x.slice(1).map(plain)
        : x;
    const ce = engine(type);
    const t = ce.parse('f(L)').type;
    for (const [v, js] of [
      ['(1,2)', [1, 2]],
      [
        '[(1,2),(3,4)]',
        [
          [1, 2],
          [3, 4],
        ],
      ],
      ['[[(1,2)],[(3,4)]]', [[[1, 2]], [[3, 4]]]],
    ] as const) {
      ce.assign('L', ce.parse(v));
      const value = ce.parse('f(L)').evaluate();
      expect(value.type.matches(t)).toBe(true);
      expect(plain(value.json)).toEqual(run(engine(type), js));
    }
  });

  test('a parameter whose coordinate can hold a list is declined', () => {
    const param = 'tuple<list<number>, number>';
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `(${param}) -> number` });
    ce.assign('f', ce.parse('a \\mapsto a.y+1'));
    ce.declare('L', `${param} | list<${param}>`);
    expect(() =>
      compile(ce.parse('f(L)'), { fallback: false } as never)
    ).toThrow(/cannot tell one point from a list of points/);
  });

  test('a parameter with a tuple coordinate is declined', () => {
    // A tuple compiles to an array, so the point `[[1, 2], 3]` looks like a
    // list of points at run time.
    const param = 'tuple<tuple<number, number>, number>';
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `(${param}) -> number` });
    ce.assign('f', ce.parse('a \\mapsto 7'));
    ce.declare('L', `${param} | list<${param}>`);
    expect(() =>
      compile(ce.parse('f(L)'), { fallback: false } as never)
    ).toThrow(/cannot tell one point from a list of points/);
  });

  test('a list whose first point is absent is still mapped', () => {
    const ce = engine(`${POINT} | list<missing | ${POINT}>`);
    expect(ce.parse('f(L)').type.toString()).toBe(
      'list<missing | tuple<number, number>> | tuple<number, number>'
    );
    expect(run(ce, [undefined, [3, 4]])).toEqual([undefined, [4, 5]]);
    expect(run(ce, [undefined])).toEqual([undefined]);
    expect(run(ce, [1, 2])).toEqual([2, 3]);
    ce.assign('L', ce.box(['List', 'Missing', ['Tuple', 3, 4]]));
    expect(ce.parse('f(L)').evaluate().json).toEqual([
      'List',
      'Missing',
      ['Tuple', 4, 5],
    ]);
  });

  test('a union with a bare `list` arm is declined', () => {
    const ce = engine(`${POINT} | list`);
    expect(() =>
      compile(ce.parse('f(L)'), { fallback: false } as never)
    ).toThrow(/admits a collection that is not a list of points/);
  });

  test('controls: a list of points and a point keep their typing and code', () => {
    const list = engine(`list<${POINT}>`);
    expect(list.parse('f(L)').type.toString()).toBe(
      'list<tuple<number, number>>'
    );
    expect(
      run(list, [
        [1, 2],
        [3, 4],
      ])
    ).toEqual([
      [2, 3],
      [4, 5],
    ]);
    const point = engine(POINT);
    expect(point.parse('f(L)').type.toString()).toBe('tuple<number, number>');
    expect(run(point, [1, 2])).toEqual([2, 3]);
  });
});
