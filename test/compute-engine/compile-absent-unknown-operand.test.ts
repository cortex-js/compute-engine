import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * An absent operand whose type is not provably a number keeps its absence
 * through arithmetic when the application is not provably a number: the
 * interpreter answers the marker of the application's codomain, `Missing`
 * there and `NaN` for a numeric application. Compiled JavaScript spells the
 * absence `undefined`, and now keeps it on the same applications (user
 * decision of 2026-10-23, ROADMAP CE-229).
 */
function setup(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]]));
  ce.assign(
    'W',
    ce.box([
      'Function',
      [
        'Tuple',
        ['Multiply', 's', ['PointX', 'p']],
        ['Multiply', 's', ['PointY', 'p']],
        ['Multiply', 's', ['PointZ', 'p']],
      ],
      'p',
      's',
    ])
  );
  return ce;
}

describe('the coordinates of an absent point in a user function body', () => {
  test('both routes give a point of three absent coordinates', () => {
    const ce = setup();
    const e = ce.box(['W', ['At', 'L', 5], 2]);
    expect(e.evaluate().json).toEqual([
      'Tuple',
      'Missing',
      'Missing',
      'Missing',
    ]);
    const r = compile(e);
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual([undefined, undefined, undefined]);
  });

  test('a present point is unchanged', () => {
    const ce = setup();
    const e = ce.box(['W', ['At', 'L', 1], 2]);
    expect(e.evaluate().toString()).toBe('(2, 4, 6)');
    expect(compile(e).run!({})).toEqual([2, 4, 6]);
  });
});

describe('beside a list, the absence lands in each cell', () => {
  test('a list plus the coordinate of an absent point', () => {
    // The interpreter's gate stands aside when an operand is a collection:
    // the list gives the shape and each cell is `NaN`.
    const ce = setup();
    ce.assign(
      'G',
      ce.box(['Function', ['Add', ['List', 1, 2], ['PointX', 'p']], 'p'])
    );
    const absent = ce.box(['G', ['At', 'L', 5]]);
    expect(absent.evaluate().toString()).toBe('[NaN,NaN]');
    const value = compile(absent).run!({}) as number[];
    expect(value).toHaveLength(2);
    expect(value.every((x) => Number.isNaN(x))).toBe(true);
    const present = ce.box(['G', ['At', 'L', 1]]);
    expect(present.evaluate().toString()).toBe('[2,3]');
    expect(compile(present).run!({})).toEqual([2, 3]);
  });
});

describe('a numeric application of an absent value is NaN', () => {
  test('a product of a number and an absent number', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Multiply', 2, 'Missing']).evaluate().toString()).toBe(
      'NaN'
    );
    const r = compile(ce.box(['Multiply', 2, 'x']));
    expect(r.run!({ x: undefined })).toBeNaN();
  });
});

describe('an absent value that a symbol declared any holds is NaN in arithmetic', () => {
  // `docs/ERROR-MODEL.md` (the reading of a host input as `NaN`, ROADMAP
  // CE-395): every route gives `NaN`. Before, the `assign` route gave
  // `Missing`, from the codomain marker of the type `any`.
  test.each([
    [['Add', 'p', 1]],
    [['Multiply', 2, 'p']],
    [['Add', 'p', 'q']],
    [['Subtract', 'p', 1]],
  ])('%j', (json) => {
    const ce = new ComputeEngine();
    ce.declare('p', 'any');
    ce.declare('q', 'any');
    const expr = ce.box(json as any);
    // Compiled, with `p` absent.
    const run = compile(expr).run!;
    expect(run({ p: undefined, q: 2 })).toBeNaN();
    // `subs`.
    const substituted = expr
      .subs({ p: ce.box('Missing'), q: ce.box(2) })
      .evaluate();
    expect(substituted.isNaN).toBe(true);
    // `assign`.
    ce.assign('p', ce.box('Missing'));
    ce.assign('q', ce.box(2));
    const assigned = expr.evaluate();
    expect(assigned.isNaN).toBe(true);
    expect(assigned.type.matches(expr.type)).toBe(true);
  });

  test('the coordinate read of an absent point stays absent', () => {
    // A READ is not a symbol: `s · PointX(p)` keeps the codomain marker
    // (ROADMAP CE-229).
    const ce = setup();
    const e = ce.box(['W', ['At', 'L', 5], 2]);
    const v = e.evaluate();
    expect(v.json).toEqual(['Tuple', 'Missing', 'Missing', 'Missing']);
    expect(v.type.matches(e.type)).toBe(true);
    expect(compile(e).run!({})).toEqual([undefined, undefined, undefined]);
  });
});
