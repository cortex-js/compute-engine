import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// ROADMAP CE-514 (Tycho row 447): a coordinate accessor whose operand may be
// a list of points is a list of coordinates at run time. Inside a function
// literal, the parameter is typed from its uses (`collection<any> | tuple`)
// and the accessor `unknown`, which `PointList` read as a scalar slot: the
// compiled `(v ↦ PointList(PointY(v), PointX(v)))([(1, 2, 3), (4, 5, 6)])`
// was `[NaN, NaN]`, where the interpreter gives `[(2, 1), (5, 4)]`. The
// `javascript` target now decides the role of such a component at run time:
// an array is a zip source, any other value one slot.

const BODY: MathJsonExpression = ['PointList', ['PointY', 'v'], ['PointX', 'v']];
const POINTS: MathJsonExpression = [
  'List',
  ['Tuple', 1, 2, 3],
  ['Tuple', 4, 5, 6],
];

describe('a coordinate accessor of a possible list of points in PointList', () => {
  test('a function literal applied to a list of points', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Apply', ['Function', BODY, 'v'], POINTS]);
    expect(e.evaluate().toString()).toBe('[(2, 1),(5, 4)]');
    const r = compile(e, { fallback: false });
    expect(r.run!({})).toEqual([
      [2, 1],
      [5, 4],
    ]);
  });

  test('a function literal applied to a declared list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<tuple<integer, integer, integer>>');
    const r = compile(ce.box(['Apply', ['Function', BODY, 'v'], 'P']), {
      fallback: false,
    });
    expect(
      r.run!({
        P: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      } as never)
    ).toEqual([
      [2, 1],
      [5, 4],
    ]);
  });

  test('a named function called with a list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', BODY, 'v']));
    const r = compile(ce.box(['f', POINTS]), { fallback: false });
    expect(r.run!({})).toEqual([
      [2, 1],
      [5, 4],
    ]);
  });

  test('one point stays one point', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Apply', ['Function', BODY, 'v'], ['Tuple', 1, 2, 3]]);
    expect(e.evaluate().toString()).toBe('(2, 1)');
    expect(compile(e, { fallback: false }).run!({})).toEqual([2, 1]);
  });

  test('an accessor of a list beside a scalar component', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Apply',
      ['Function', ['PointList', ['PointX', 'v'], 7], 'v'],
      POINTS,
    ]);
    expect(e.evaluate().toString()).toBe('[(1, 7),(4, 7)]');
    expect(compile(e, { fallback: false }).run!({})).toEqual([
      [1, 7],
      [4, 7],
    ]);
  });

  test('a tuple coordinate of a flat list is not a zip source', () => {
    // `PointY([5, (1, 2)])` is the tuple `(1, 2)`, which `PointList` refuses
    // (the interpreter gives an error). It is an array at run time, as a list
    // of coordinates is: the operand, a list that is not a list of points,
    // decides that it is one slot, guarded to `NaN`. Read as a source, it
    // gave the points `[[1, 7], [2, 7]]`.
    const ce = new ComputeEngine();
    const e = ce.box([
      'Apply',
      ['Function', ['PointList', ['PointY', 'v'], 7], 'v'],
      ['List', 5, ['Tuple', 1, 2]],
    ]);
    const value = compile(e, { fallback: false }).run!({}) as unknown[];
    expect(Number.isNaN(value[0])).toBe(true);
    expect(value[1]).toBe(7);
  });

  test('an accessor typed as a list keeps the static source route', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<tuple<real, real>>');
    const r = compile(ce.box(['PointList', ['PointX', 'L'], ['PointY', 'L']]), {
      fallback: false,
    });
    expect(r.code).not.toContain('.every(Array.isArray)');
    expect(
      r.run!({
        L: [
          [1, 2],
          [3, 4],
        ],
      } as never)
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('a free variable that holds a point or a list of points', () => {
    // The role is decided on each call: a point gives one point, a list of
    // points the list of their points, as in the interpreter.
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\mathrm{PointList}(p.y, p.x)'), {
      fallback: false,
    });
    expect(r.run!({ p: [1, 2] } as never)).toEqual([2, 1]);
    expect(
      r.run!({
        p: [
          [1, 2],
          [3, 4],
        ],
      } as never)
    ).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });

  test('a free plot variable keeps the scalar slot', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\mathrm{PointList}(x, y)'), {
      fallback: false,
    });
    expect(r.run!({ x: 1, y: 2 })).toEqual([1, 2]);
    expect(r.code).not.toContain('Array.isArray');
  });
});
