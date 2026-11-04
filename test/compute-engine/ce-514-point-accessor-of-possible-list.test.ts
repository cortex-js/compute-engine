import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// ROADMAP CE-514 (Tycho row 447): a coordinate accessor whose operand may be
// a list of points is a list of coordinates at run time. Inside a function
// literal, the parameter is typed from its uses (`collection<any> | tuple`)
// and the accessor `unknown`, which `PointList` read as a scalar slot: the
// compiled `(v ↦ PointList(PointY(v), PointX(v)))([(1, 2, 3), (4, 5, 6)])`
// was `[NaN, NaN]`, where the interpreter gives `[(2, 1), (5, 4)]`. A
// function literal applied where it is written gets the type of its
// argument, so the accessor has a static shape. Where the type of the
// operand stays `collection<any> | tuple`, the compilation declines (rule R3
// of "Shapes are settled at compile time", `docs/COMPILATION-MODEL.md`).

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

  test('a parameter declared as a point or a list of points declines', () => {
    // With \`v\` declared \`collection<any> | tuple\`, \`PointY(v)\` is one
    // coordinate or a list of coordinates, and only the value tells which,
    // so the compilation declines (rule R3 of "Shapes are settled at compile
    // time", \`docs/COMPILATION-MODEL.md\`), where the code tested the value
    // at run time. Here the interpreter gives an error: \`PointY([5, (1,
    // 2)])\` is the tuple \`(1, 2)\`, which is not a coordinate.
    const ce = new ComputeEngine();
    const e = ce.box([
      'Apply',
      [
        'Function',
        ['PointList', ['PointY', 'v'], 7],
        ['Typed', 'v', "'collection<any> | tuple'"],
      ],
      ['List', 5, ['Tuple', 1, 2]],
    ]);
    const r = compile(e);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  test('a tuple coordinate of a typed flat list is declined', () => {
    // The compiled code gives `v` the type of the argument,
    // `list<integer | tuple<integer, integer>>`, so `PointY(v)` can be a
    // tuple, which is not a slot of a point. The interpreter gives an
    // `incompatible-type` error.
    const ce = new ComputeEngine();
    const e = ce.box([
      'Apply',
      ['Function', ['PointList', ['PointY', 'v'], 7], 'v'],
      ['List', 5, ['Tuple', 1, 2]],
    ]);
    expect(e.evaluate().operator).toBe('Error');
    expect(compile(e).success).toBe(false);
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
    // An undeclared \`p\` read with \`p.y\` is inferred \`collection<any> |
    // tuple\`, so \`p.y\` is one coordinate or a list of coordinates, and the
    // compilation declines (rule R3), where the code tested the value of
    // \`p\` at run time. Declared with the union of a point and a list of
    // points, \`p\` is tested once where it is bound, and each body has one
    // shape.
    const ce = new ComputeEngine();
    const undeclared = compile(ce.parse('\\mathrm{PointList}(p.y, p.x)'));
    expect(undeclared.success).toBe(false);
    expect(undeclared.diagnostic?.code).toBe('unsettled-shape');

    const ce2 = new ComputeEngine();
    ce2.declare('p', 'tuple<real, real> | list<tuple<real, real>>');
    const r = compile(ce2.parse('\\mathrm{PointList}(p.y, p.x)'), {
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
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const r = compile(ce.parse('\\mathrm{PointList}(x, y)'), {
      fallback: false,
    });
    expect(r.run!({ x: 1, y: 2 })).toEqual([1, 2]);
    expect(r.code).not.toContain('Array.isArray');
  });
});

// The type of the call. The signature of `v ↦ PointList(PointY(v),
// PointX(v))` is inferred before any argument is known, and its result,
// `tuple<unknown, unknown>`, is one point. That result is not a contract:
// the call is typed from the body with the parameter typed as the argument,
// so that a list of points gives a list of points.
describe('the type of a call with a list of points (CE-514)', () => {
  test('a literal list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', BODY, 'v']));
    const call = ce.box(['f', POINTS]);
    expect(call.type.toString()).toBe('list<tuple<integer, integer>^2>');
    const value = call.evaluate();
    expect(value.toString()).toBe('[(2, 1),(5, 4)]');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('a declared list of points, a named function and an applied literal', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<tuple<integer, integer, integer>>');
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', BODY, 'v']));
    expect(ce.box(['f', 'P']).type.toString()).toBe(
      'list<tuple<integer, integer>>'
    );
    expect(
      ce.box(['Apply', ['Function', BODY, 'v'], 'P']).type.toString()
    ).toBe('list<tuple<integer, integer>>');
  });

  test('one point stays one point', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', BODY, 'v']));
    const call = ce.box(['f', ['Tuple', 1, 2]]);
    expect(call.evaluate().toString()).toBe('(2, 1)');
    expect(call.evaluate().type.matches(call.type)).toBe(true);
  });

  test('a function that reads a symbol from outside keeps its inferred result', () => {
    // The inferred result records the type that `y` had; a call after `y`
    // changed type is refused against it (ROADMAP CE-473), so it is not
    // typed from the current value.
    const ce = new ComputeEngine();
    ce.assign('y', 5);
    ce.assign('g', ce.parse('x \\mapsto [-x, y]'));
    ce.assign('y', ce.string('abc'));
    expect(ce.box(['g', 3]).type.toString()).toBe('vector<2>');
  });
});

// When the arguments fit the inferred signature and its result is a scalar,
// the inferred result stays the type of the call: the walk of the body can be
// narrower than the value (`Mod(x, y)` is typed `real`, and is NaN or
// `NaN` for `y = 0`).
describe('an inferred scalar result is kept when the arguments fit it', () => {
  test('Mod with a zero divisor', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('(x, y) \\mapsto \\operatorname{Mod}(x, y)'));
    for (const args of [
      [3, 0],
      [3.5, 0],
    ]) {
      const call = ce.box(['f', ...args]);
      expect(call.type.toString()).toBe('nan | real');
      expect(call.evaluate().type.matches(call.type)).toBe(true);
    }
  });

  test('Sign of NaN', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Sign', 'x'], 'x']));
    const call = ce.box(['f', 'NaN']);
    expect(call.type.toString()).toBe('complex | nan');
    expect(call.evaluate().type.matches(call.type)).toBe(true);
  });

  test('a function defined in a body maps over a list argument', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'outer',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Assign',
            'h',
            ['Function', ['Tuple', ['Negate', 'x'], 'x'], 'x'],
          ],
          ['h', 'L'],
        ],
        'L',
      ])
    );
    const call = ce.box(['outer', ['List', 1, 2]]);
    const value = call.evaluate();
    expect(value.toString()).toBe('[(-1, 1),(-2, 2)]');
    expect(value.type.matches(call.type)).toBe(true);
  });
});
