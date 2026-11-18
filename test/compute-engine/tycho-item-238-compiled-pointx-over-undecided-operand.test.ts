/**
 * A compiled coordinate accessor over an operand whose static type settles
 * NEITHER reading — one point or a list of points.
 *
 * The parameter of a function literal that reads `PointX(v)` infers
 * `collection<any> | tuple`, and a call may hand it either shape. The
 * `javascript` lowering read such an operand as ONE point, so a list of points
 * gave its first POINT as the x coordinate: the minimal `PointX(v) + 1` over a
 * two-point list answered `[2, 3, 4]` where the interpreter answers `[2, 5]`,
 * and a `PointList` body threw `source component 1 is not an array` at run
 * time (Tycho item 238). The interpreter's `pointComponentAt` decides at the
 * value, so the emitted code now does too.
 *
 * The second half is the `PointList` lowering: a `broadcastable<number>`
 * component (`2·PointX(v)` under the same parameter) is a scalar or a list by
 * its value, and both the all-scalar route and the zip route treated it as an
 * opaque slot, replacing its list value with `NaN`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.pushScope();
  ce.declare('L', { type: 'list<number>' });
  ce.assign('L', ce.parse('\\left[1,2\\right]'));
  ce.declare('P', { type: 'list<tuple<number, number, number>>' });
  ce.assign('P', ce.parse('\\left[\\left(1,2,3\\right),\\left(4,5,6\\right)\\right]'));
  ce.declare('Q', { type: 'list<tuple<number, number>>' });
  ce.assign('Q', ce.parse('\\left[\\left(1,2\\right),\\left(4,5\\right)\\right]'));
  return ce;
}

function define(ce: ComputeEngine, latex: string): void {
  const name = latex.slice(0, latex.indexOf('('));
  ce.declare(name, 'function');
  ce.parse(latex, { strict: false }).evaluate();
}

/** The compiled value of `latex` on the `javascript` target, as plain JSON. */
function run(ce: ComputeEngine, latex: string): unknown {
  const expr = ce.parse(latex, { strict: false });
  const r = compile(expr, { to: 'javascript' });
  expect(r.success).toBe(true);
  return JSON.parse(JSON.stringify(r.run!()));
}

describe('PointX over a parameter that may be a point or a list of points', () => {
  test('the parameter type is undecided between the two readings', () => {
    const ce = engine();
    define(ce, 'g(v):=\\mathrm{PointX}(v)+1');
    expect(String(ce.symbol('g').value?.type)).toBe(
      '(v: collection<any> | tuple) -> list<list<any> | number | tuple> | number | tuple'
    );
  });

  test('a point argument reads one coordinate', () => {
    const ce = engine();
    define(ce, 'g(v):=\\mathrm{PointX}(v)+1');
    expect(run(ce, 'g((1,2,3))')).toBe(2);
    expect(String(ce.parse('g((1,2,3))').evaluate())).toBe('2');
  });

  test('a list-of-points argument maps the coordinate', () => {
    const ce = engine();
    define(ce, 'g(v):=\\mathrm{PointX}(v)+1');
    expect(run(ce, 'g(P)')).toEqual([2, 5]);
    expect(String(ce.parse('g(P)').evaluate())).toBe('[2,5]');
  });

  test('a scalar times the coordinate keeps the list', () => {
    const ce = engine();
    define(ce, 'g(v):=\\mathrm{PointX}(v)\\cdot2');
    expect(run(ce, 'g(P)')).toEqual([2, 8]);
  });
});

describe('PointList with a broadcastable component', () => {
  const BODY =
    'f(v):=\\operatorname{PointList}\\left(L-\\mathrm{PointY}\\left(v\\right)\\cdot' +
    '\\mathrm{PointX}\\left(v\\right),\\mathrm{PointX}\\left(v\\right)\\cdot2,L\\right)';

  test('the reported shape: a point-list argument, mixed static and run-time sources', () => {
    const ce = engine();
    define(ce, BODY);
    expect(String(ce.parse('f(P)').evaluate())).toBe('[(-1, 2, 1),(-18, 8, 2)]');
    expect(run(ce, 'f(P)')).toEqual([
      [-1, 2, 1],
      [-18, 8, 2],
    ]);
  });

  test('the control: a single-point argument makes the component a scalar slot', () => {
    const ce = engine();
    define(ce, BODY);
    expect(run(ce, 'f((1,2,3))')).toEqual([
      [-1, 2, 1],
      [0, 2, 2],
    ]);
  });

  test('every component a run-time source: zipped when lists, one point when scalars', () => {
    const ce = engine();
    define(ce, 'k(v):=\\operatorname{PointList}(2\\mathrm{PointX}(v),3\\mathrm{PointY}(v))');
    expect(run(ce, 'k(Q)')).toEqual([
      [2, 6],
      [8, 15],
    ]);
    expect(String(ce.parse('k(Q)').evaluate())).toBe('[(2, 6),(8, 15)]');
    expect(run(ce, 'k((1,2))')).toEqual([2, 6]);
  });

  test('the shader targets fail closed on it', () => {
    const ce = engine();
    define(ce, 'k(v):=\\operatorname{PointList}(2\\mathrm{PointX}(v),3\\mathrm{PointY}(v))');
    const lit = ce.symbol('k').value!;
    const body = lit.ops![0];
    for (const to of ['glsl'] as const) {
      const r = compile(body, { to });
      expect(r.success).toBe(false);
      expect(String(r.reason ?? r.error)).toContain('Could not compile');
    }
  });
});
