import { ComputeEngine, compile } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import {
  isScalarValue,
  provenScalarPointWidth,
} from '../../src/compute-engine/compilation/javascript-value-facts';
import type { MathJsonExpression } from '../../src/math-json/types';

const source = (r: { code?: string; preamble?: string }) =>
  (r.preamble ?? '') + (r.code ?? '');

function fixture(value: MathJsonExpression = ['Add', 'u', 1]) {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('P', 'list<real>');
  ce.declare('angle', 'function');
  ce.assign('angle', ce.box(['Function', ['Block', value], 'u']));
  ce.declare('point', 'function');
  ce.assign(
    'point',
    ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'q', "'broadcastable<real>'"],
        ['Assign', 'q', ['angle', 'u']],
        ['Tuple', ['Cos', 'q'], ['Sin', 'q']],
      ],
      'u',
    ])
  );
  const expr = ce.box([
    'Dot',
    ['point', 'x'],
    ['Add', ['Tuple', ['Negate', 'x'], ['Negate', 'y']], ['Tuple', 1, 0]],
  ]);
  return { ce, expr };
}

describe('Dot over constructed scalar coordinates with broad static types', () => {
  test.each(['scalar', 'constructed'])(
    'declared-input facts and constructed-point proofs stay separate with %s queried first',
    (first) => {
      const ce = new ComputeEngine();
      ce.declare('P', 'tuple<real, real>');
      ce.declare('f', 'function');
      ce.assign('f', ce.box(['Function', ['Block', ['Abs', 'P']], 'u']));
      const target = new JavaScriptTarget().createTarget({
        var: (id) => `_.${id}`,
        userFunctions: { defs: new Map(), compiling: new Set() },
        cse: { enabled: false, instances: [], harvestOptions: {} },
      });
      target.userFunctions!.root = target;
      const call = ce.box(['f', 0]);
      const point = ce.box(['Tuple', ['f', 0], 1]);
      const scalar = () => expect(isScalarValue(call, target)).toBe(true);
      const constructed = () =>
        expect(provenScalarPointWidth(point, target)).toBeUndefined();
      if (first === 'scalar') {
        scalar();
        constructed();
        scalar();
      } else {
        constructed();
        scalar();
        constructed();
      }
    }
  );

  test('retained helper locals prove scalar components without narrowing the signature', () => {
    const { expr } = fixture();
    expect(expr.op1.type.toString()).toContain('broadcastable');
    const r = compile(expr);
    expect(r.success).toBe(true);
    expect(source(r)).not.toMatch(/_SYS\.(?:bcast|matmul)|Array\.isArray/);
    expect(r.preamble).toContain('const _fn_point');
    expect(r.preamble).toMatch(/let q/);
    for (const [x, y] of [
      [0, 0],
      [0.3, 0.7],
      [-2, 3],
    ]) {
      expect(r.run!({ x, y })).toBeCloseTo(
        Math.cos(x + 1) * (1 - x) - Math.sin(x + 1) * y,
        12
      );
      expect(r.run!({ x, y })).toBeCloseTo(expr.subs({ x, y }).N().re, 12);
    }
  });

  test('a helper with list-valued coordinates retains component broadcasting', () => {
    const { expr } = fixture('P');
    const r = compile(expr);
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_SYS.bcast');
    expect(r.run!({ x: 0, y: 1, P: [0, Math.PI / 2] })).toEqual([
      1,
      Math.cos(Math.PI / 2) - 1,
    ]);
    // A broadcast over a lone empty operand answers the empty list.
    expect(r.run!({ x: 0, y: 1, P: [] })).toEqual([]);
  });

  test('a caller override cannot inherit the helper body proof', () => {
    const { expr } = fixture();
    const r = compile(expr, { functions: { point: '(u => [[1, 2], 3])' } });
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_SYS.bcast');
    expect(r.run!({ x: 0, y: -2 })).toEqual([7, 8]);
  });

  test('a scalar caller parameter cannot hide a callee capture of a global list', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('P', 'list<real>');
    ce.declare('angle', 'function');
    ce.assign('angle', ce.box(['Function', ['Block', 'P'], 't']));
    ce.declare('point', 'function');
    ce.assign(
      'point',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'q'],
          ['Assign', 'q', ['angle', 'P']],
          ['Tuple', ['Cos', 'q'], ['Sin', 'q']],
        ],
        'P',
      ])
    );
    const r = compile(ce.box(['Dot', ['point', 'x'], ['Tuple', 1, 2]]));
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_SYS.bcast');
    expect(r.run!({ x: 0, P: [0, 1] })).toEqual([
      1,
      Math.cos(1) + 2 * Math.sin(1),
    ]);
  });

  test('a point caller parameter cannot hide a callee capture of a list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('P', 'list<tuple<real, real>>');
    ce.declare('inner', 'function');
    ce.assign('inner', ce.box(['Function', ['Block', 'P'], 't']));
    ce.declare('outer', 'function');
    ce.assign(
      'outer',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'q'],
          ['Assign', 'q', ['inner', 0]],
          ['Tuple', ['PointX', 'q'], ['PointY', 'q']],
        ],
        'P',
      ])
    );
    const r = compile(
      ce.box(['Dot', ['outer', ['Tuple', 'x', 2]], ['Tuple', 1, 2]])
    );
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_SYS.bcast');
    expect(r.run!({ x: 0, P: [[1, 2], [3, 4]] })).toEqual([5, 11]);
  });

  test('declared runtime points keep width checks and matrix fallback', () => {
    const { ce } = fixture();
    ce.declare('a', 'tuple<broadcastable<real>, broadcastable<real>>');
    ce.declare('b', 'tuple<broadcastable<real>, broadcastable<real>>');
    const r = compile(ce.box(['Dot', 'a', 'b']));
    expect(r.success).toBe(true);
    expect(source(r)).toContain('Array.isArray');
    expect(source(r)).toContain('_SYS.matmul');
    expect(r.run!({ a: [1, [1, 2]], b: [3, 4] })).toEqual([7, 11]);
    expect(r.run!({ a: [1, 2, 3], b: [4, 5, 6] })).toBe(32);
  });

  test('each impure point operand is evaluated once', () => {
    const { ce } = fixture(['Random']);
    const r = compile(ce.box(['Dot', ['point', 'x'], ['point', 'y']]));
    expect(r.success).toBe(true);
    expect(source(r)).not.toMatch(/_SYS\.(?:bcast|matmul)|Array\.isArray/);
    const draw = jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1);
    try {
      expect(r.run!({ x: 0, y: 1 })).toBeCloseTo(Math.cos(1), 12);
      expect(draw).toHaveBeenCalledTimes(2);
    } finally {
      draw.mockRestore();
    }
  });

  test('scalar NaN and infinity preserve numeric arithmetic', () => {
    const { expr } = fixture();
    const r = compile(expr);
    for (const x of [NaN, Infinity, -Infinity])
      expect(r.run!({ x, y: 1 })).toBeNaN();
  });
});
