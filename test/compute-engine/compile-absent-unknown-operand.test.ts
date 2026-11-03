import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * An absent operand whose type is not provably a number keeps its absence
 * through arithmetic when the application is not provably a number: the
 * interpreter answers the marker of the application's codomain, `Missing`
 * there and `NaN` for a numeric application. Compiled JavaScript spells the
 * absence `undefined`, and now keeps it on the same applications (user
 * decision of 2026-10-23, ROADMAP CE-229). Since 2026-11-01 the compiled
 * value of such arithmetic is not specified (`docs/COMPILATION-MODEL.md`,
 * "Caveats of compiled code"); the interpreter's value does not change.
 *
 * Since `Missing` is a result only (`docs/ERROR-MODEL.md`, user decision of
 * 2026-11-02), a read out of range in a list of points is a point whose
 * coordinates are `NaN`, and an operator over `Missing` gives `Missing`.
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
  // The compiled value of the products over an absent coordinate is not
  // specified (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the
  // bullet "Everything computed from an absent value, except at a
  // discharge"; R4 of `docs/plans/2026-11-01-absent-value-contract.md`):
  // only the interpreter value is checked for it.
  test('the interpreter gives a point of three NaN coordinates', () => {
    const ce = setup();
    const e = ce.box(['W', ['At', 'L', 5], 2]);
    expect(e.evaluate().json).toEqual(['Tuple', 'NaN', 'NaN', 'NaN']);
    const r = compile(e);
    expect(r.success).toBe(true);
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

describe('a numeric application of an absent value', () => {
  test('a product of a number and an absent number is Missing, NaN compiled', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Multiply', 2, 'Missing']).evaluate().toString()).toBe(
      '"Missing"'
    );
    const r = compile(ce.box(['Multiply', 2, 'x']));
    expect(r.run!({ x: undefined })).toBeNaN();
  });
});

describe('an absent value that a symbol declared any holds is Missing in arithmetic', () => {
  // `docs/ERROR-MODEL.md`, "`Missing` is a result only": an operator over
  // `Missing` gives `Missing` on the `subs` and the `assign` routes. The
  // compiled fallback reads the host input `undefined` as `NaN`.
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
    // Compiled, with `p` absent. An input declared `any` is refused
    // (ROADMAP CE-712.1), so the expression is compiled as the body of a
    // function whose parameters `p` and `q` are declared `any`. The
    // arithmetic over such a parameter declines, because its value can be
    // a list, and the interpreter fallback computes the value.
    const compiled = compile(
      ce.box([
        'Function',
        json,
        ['Typed', 'p', { str: 'any' }],
        ['Typed', 'q', { str: 'any' }],
      ] as any)
    );
    expect(compiled.success).toBe(false);
    expect(compiled.unsupported).toContain('p');
    const run = compiled.run as unknown as (p: unknown, q: unknown) => unknown;
    expect(run(undefined, 2)).toBeNaN();
    // `subs`.
    const substituted = expr
      .subs({ p: ce.box('Missing'), q: ce.box(2) })
      .evaluate();
    expect(substituted.symbol).toBe('Missing');
    // `assign`.
    ce.assign('p', ce.box('Missing'));
    ce.assign('q', ce.box(2));
    const assigned = expr.evaluate();
    expect(assigned.symbol).toBe('Missing');
  });

  test('the coordinate read of a point that is not found is NaN', () => {
    // `At(L, 5)` over a list of points is the point `(NaN, NaN, NaN)`, so
    // `s · PointX(p)` is `NaN`. The compiled value is not specified
    // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
    const ce = setup();
    const e = ce.box(['W', ['At', 'L', 5], 2]);
    const v = e.evaluate();
    expect(v.json).toEqual(['Tuple', 'NaN', 'NaN', 'NaN']);
    expect(v.type.matches(e.type)).toBe(true);
  });
});
