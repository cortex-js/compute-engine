/**
 * Pins for two ROADMAP entries that were found already landed on 2026-09-27
 * (both had been recorded as open on 2026-09-23 and 2026-09-25):
 *
 * 1. Adding two point lists of different lengths on the JavaScript target
 *    used to throw `TypeError: _SYS.bcast(...).map is not a function`. The
 *    interpreter answers the `incompatible-dimensions` error, and the
 *    compiled code now answers `NaN` (the real-target rendering of that
 *    error: `_SYS.bcast` spells a length mismatch `NaN`, and `Min` of a
 *    `NaN` coordinate is `NaN`) instead of throwing.
 * 2. Restricted point-list arithmetic with an UNTYPED plot variable
 *    (`PointList(t,1)\{1<t\} + PointList(2,t)`, typed
 *    `missing | tuple<unknown, unknown>`) used to decline to compile with
 *    "object-domain absent ('missing') position … has no object null
 *    representation". It now compiles and answers the point.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('point lists of different lengths on the JavaScript target', () => {
  const ce = new ComputeEngine();
  ce.assign('L_1', ce.box(['List', 1, 2, 3]));
  ce.assign('L_2', ce.box(['List', 4, 5]));
  ce.assign('A', ce.box(['List', 0.1, 0.2, 0.3]));
  // `PointList(L_1, L_2)` has two points, `PointList(Cos(A), Sin(A))` three.
  const expr = ce.box([
    'Min',
    [
      'PointX',
      [
        'Add',
        ['PointList', 'L_1', 'L_2'],
        [
          'Multiply',
          ['Rational', 1, 20],
          ['PointList', ['Cos', 'A'], ['Sin', 'A']],
        ],
      ],
    ],
  ] as never);

  test('the interpreter reports the dimension mismatch', () => {
    expect(expr.evaluate().toString()).toBe(
      'Error("incompatible-dimensions", "3 vs 2")'
    );
  });

  test('the compiled code answers an absence instead of throwing', () => {
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(() => r.run!({} as never)).not.toThrow();
    expect(r.run!({} as never)).toBeNaN();
  });
});

describe('restricted point-list arithmetic with an untyped variable', () => {
  const ce = new ComputeEngine();
  const expr = ce.box([
    'Add',
    ['If', ['Less', 1, 't'], ['PointList', 't', 1]],
    ['PointList', 2, 't'],
  ] as never);

  test('is typed as a possibly absent point with unknown coordinates', () => {
    expect(expr.type.toString()).toBe('tuple<unknown, unknown>');
  });

  // An input with no type is refused at compile time (ROADMAP CE-712.1).
  // The compiled tests below declare `t` as `real` in a second engine.
  test('the untyped variable is refused at compile time', () => {
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
    expect(r.unsupported).toContain('t');
  });

  const ceReal = new ComputeEngine();
  ceReal.declare('t', 'real');
  const exprReal = ceReal.box(expr.json as never);

  test('compiles to JavaScript and answers the point', () => {
    const r = compile(exprReal, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ t: 2 } as never)).toEqual([4, 3]);
  });

  // The compiled value of arithmetic with an absent point is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4 of
  // `docs/plans/2026-11-01-absent-value-contract.md`), so there is no
  // compiled test of the absent case.
});
