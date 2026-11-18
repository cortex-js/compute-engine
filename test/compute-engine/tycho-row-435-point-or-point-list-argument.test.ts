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

/**
 * The code and the value of the diagnostic of the decline of `f(L)` on
 * javascript. A declared union input whose members no run-time test tells
 * apart (a point whose coordinate is a list or a tuple and a list of such
 * points are arrays of the same nesting) declines with `union-dispatch`,
 * and the value names the input.
 */
function declineOf(ce: ComputeEngine): { code?: string; value?: string } {
  try {
    const r = compile(ce.parse('f(L)'), { fallback: false } as never) as {
      success: boolean;
      diagnostic?: { code?: string; value?: string };
    };
    return { code: r.diagnostic?.code, value: r.diagnostic?.value };
  } catch (e) {
    const d = (e as { diagnostic?: { code?: string; value?: string } })
      .diagnostic;
    return { code: d?.code, value: d?.value };
  }
}

describe('A POINT OR A LIST OF POINTS at a point parameter (CE-407)', () => {
  test('the union: the call is typed as a point or a list of points', () => {
    const ce = engine(UNION);
    expect(ce.parse('f(L)').type.toString()).toBe(
      'list<tuple<number, number>> | tuple<number, number>'
    );
  });

  test('the union: the interpreter agrees', () => {
    const ce = engine(UNION);
    ce.assign('L', ce.parse('[(1,2),(3,4)]'));
    expect(ce.parse('f(L)').evaluate().toString()).toBe('[(2, 3),(4, 5)]');
    ce.assign('L', ce.parse('(1,2)'));
    expect(ce.parse('f(L)').evaluate().toString()).toBe('(2, 3)');
  });

  test('the union with `missing` cannot be declared', () => {
    // `Missing` is a result only (user decision of 2026-11-02).
    expect(() => engine(`${UNION} | missing`)).toThrow(/cannot be declared/);
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

  test('a parameter whose coordinate can hold a list is declined', () => {
    const param = 'tuple<list<number>, number>';
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `(${param}) -> number` });
    ce.assign('f', ce.parse('a \\mapsto a.y+1'));
    ce.declare('L', `${param} | list<${param}>`);
    expect(declineOf(ce)).toEqual({ code: 'outside-profile', value: 'L' });
  });

  test('a parameter with a tuple coordinate is declined', () => {
    // A tuple compiles to an array, so the point `[[1, 2], 3]` looks like a
    // list of points at run time.
    const param = 'tuple<tuple<number, number>, number>';
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `(${param}) -> number` });
    ce.assign('f', ce.parse('a \\mapsto 7'));
    ce.declare('L', `${param} | list<${param}>`);
    expect(declineOf(ce)).toEqual({ code: 'outside-profile', value: 'L' });
  });

  test('a list whose first point is absent is still mapped', () => {
    // A declared type cannot name `missing`, so `L` is typed from a value
    // that holds an absent point.
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `(${POINT}) -> ${POINT}` });
    ce.assign('f', ce.parse('a \\mapsto (a.x+1, a.y+1)'));
    ce.assign('L', ce.box(['List', 'Missing', ['Tuple', 3, 4]]));
    expect(ce.parse('f(L)').evaluate().json).toEqual([
      'List',
      'Missing',
      ['Tuple', 4, 5],
    ]);
  });

  test('a union with a bare `list` arm is declined', () => {
    // A bare `list` admits any elements, so no test of the nesting of the
    // value tells it from a point.
    const ce = engine(`${POINT} | list`);
    expect(declineOf(ce)).toEqual({ code: 'outside-profile', value: 'L' });
  });
});
