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
    ['When', ['PointList', 't', 1], ['Less', 1, 't']],
    ['PointList', 2, 't'],
  ] as never);

  test('is typed as a possibly absent point with unknown coordinates', () => {
    expect(expr.type.toString()).toBe('missing | tuple<unknown, unknown>');
  });

  test('compiles to JavaScript and answers the point', () => {
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ t: 2 } as never)).toEqual([4, 3]);
  });

  // Compiled arithmetic with an absent POINT gives a point of `NaN`
  // coordinates where the interpreter gives `Missing` (the recorded rule of
  // `compile-restricted-point.test.ts`); the untyped coordinates follow it.
  test('the absent case gives a point of NaN coordinates', () => {
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0 } as never)).toEqual([NaN, NaN]);
  });
});
