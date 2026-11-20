/**
 * A function value that reads a parameter of the call that made it, and
 * reads another parameter bound to an argument that mentions the same name,
 * kept the parameter: `captureAvoidingBinderVisitor` (`function-utils.ts`)
 * took the scope entry that the body `Block` holds for the enclosing
 * parameter `a` for a binder of `a`, and renamed it to `a_1` to keep the
 * argument's free `a` from being captured. The `a` of the body is the
 * parameter of the enclosing literal, which no binder of the body binds.
 */
import { ComputeEngine } from '../../src/compute-engine';

const F = (...ops: unknown[]) => ['Function', ...ops];
const V = ['Typed', 'v', "'list<integer>'"];
const RANGE = ['Range', 1, 2, 1];

// `Map(q ↦ a + q, 1..2)`: the argument, lazy, that reads the outer `a`
const arg = ['Map', F(['Add', 'a', 'q'], 'q'), RANGE];
// `Map(j ↦ v[j] + a, 1..2)`
const body = ['Map', F(['Add', ['At', 'v', 'j'], 'a'], 'j'), RANGE];

// `a ↦ (v ↦ body)(arg)` applied to 10
const nest = (inner: unknown, argument: unknown = arg) => [
  'Apply',
  F(['Apply', F(inner, V), argument], 'a'),
  10,
];

// A lazy result is listed, as a reader of it would
const evaluate = (expr: unknown) => {
  const result = new ComputeEngine().box(expr as any).evaluate();
  return result.isLazyCollection
    ? [...result.each()].map((x) => x.json)
    : result.json;
};

describe('LAZY MAP ARGUMENT AND A PARAMETER OF THE ENCLOSING LITERAL', () => {
  test('the list', () => expect(evaluate(nest(body))).toEqual([21, 22]));

  test('an element', () => expect(evaluate(['At', nest(body), 1])).toEqual(21));

  test('Sum over v', () =>
    expect(
      evaluate(
        nest(['Sum', ['Map', F(['Add', ['At', 'v', 'j'], 'a'], 'j'), RANGE]])
      )
    ).toEqual(43));

  test('Max over v', () =>
    expect(
      evaluate(
        nest(['Max', ['Map', F(['Add', ['At', 'v', 'j'], 'a'], 'j'), RANGE]])
      )
    ).toEqual(22));

  test('v used twice', () =>
    expect(
      evaluate(
        nest([
          'Map',
          F(['Add', ['At', 'v', 'j'], ['At', 'v', 2], 'a'], 'j'),
          RANGE,
        ])
      )
    ).toEqual([33, 34]));

  test('three levels', () =>
    expect(
      evaluate([
        'Apply',
        F(
          [
            'Apply',
            F(
              [
                'Apply',
                F(
                  [
                    'Map',
                    F(['Add', ['At', 'v', 'j'], ['At', 'u', 1], 'a'], 'j'),
                    RANGE,
                  ],
                  V
                ),
                ['Map', F(['Add', ['At', 'u', 'p'], 'a'], 'p'), RANGE],
              ],
              ['Typed', 'u', "'list<integer>'"]
            ),
            arg,
          ],
          'a'
        ),
        10,
      ])
    ).toEqual([42, 43]));

  test('a List argument', () =>
    expect(
      evaluate(nest(body, ['List', ['Add', 'a', 1], ['Add', 'a', 2]]))
    ).toEqual([21, 22]));

  test('a real capture still renames', () => {
    // `x` of the argument is free, and the literal binds its own `x`
    const ce = new ComputeEngine();
    const r = ce
      .box(['Apply', F(F(['Power', 'y', 'x'], 'x'), 'y'), 'x'] as any)
      .evaluate();
    expect(r.json).toEqual([
      'Function',
      ['Block', ['Power', 'x', 'x_1']],
      'x_1',
    ]);
  });
});
