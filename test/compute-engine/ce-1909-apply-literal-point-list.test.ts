/**
 * CE-1909: `Apply` of a function literal whose parameter has no stated
 * shape, to a list of points. The body reads the parameter with `PointX` and
 * `PointY`, so the signature is not scalar and the interpreter binds the
 * argument whole. The compiled code binds it whole too, with the shape of the
 * argument. The document preparation writes such a parameter as
 * `Typed(v, "collection<any> | tuple")`: a type that settles no shape, read
 * as a parameter of no stated type.
 *
 * The corpus row (Tycho's codegen audit of 0.204.1, #6134) returns a list of
 * points. A tuple of lists of a run-time length as the result declines for
 * another reason ("a record with a field of a run-time length").
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

const ce = new ComputeEngine();
ce.declare('p', 'list<real>');
ce.declare('q', 'list<real>');
ce.declare('r', 'list<real>');

const INPUTS = { p: [1, 2], q: [3, 4], r: [5, 6] };

/** The interpreter's value at `INPUTS`, as plain numbers. The inputs are
 *  substituted, not assigned: an assigned value would stay on the
 *  declarations, and later compilations would read it as a constant. */
function interpreted(
  json: unknown,
  inputs: Record<string, number[]> = INPUTS
): unknown {
  const subs = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [k, ce.box(['List', ...v])])
  );
  const value = ce
    .box(json as never)
    .subs(subs)
    .evaluate();
  const plain = (x: any): unknown =>
    x.ops !== undefined && ['List', 'Tuple'].includes(x.operator)
      ? x.ops.map(plain)
      : x.re;
  return plain(value);
}

const PARAMETERS = [
  ['an untyped parameter', 'v'],
  [
    'the type the document preparation writes',
    ['Typed', 'v', "'collection<any> | tuple'"],
  ],
] as const;

// prettier-ignore
const BODIES = [
  ['a list of points', ['PointList', ['Add', ['PointX', 'v'], 1], ['Multiply', 2, ['PointY', 'v']]]],
] as const;

describe('Apply of a literal to a list of points (CE-1909)', () => {
  for (const [what, param] of PARAMETERS)
    for (const [body, b] of BODIES)
      for (const arg of [
        ['PointList', 'p', 'q'],
        ['PointList', 'p', 'q', 'r'],
      ])
        test(`${what}, ${body}, ${arg.length - 1} coordinates`, () => {
          const json = ['Apply', ['Function', b, param], arg];
          const result = compile(ce.box(json as never), { fallback: false });
          expect(result.success).toBe(true);
          expect(result.run!(INPUTS as never)).toEqual(interpreted(json));
          // Another length: the code reads its inputs.
          const other = { p: [7, 8, 9], q: [1, 0, 2], r: [3, 3, 3] };
          expect(result.run!(other as never)).toEqual(interpreted(json, other));
        });

  test('a union with a scalar member still declines', () => {
    const json = [
      'Apply',
      ['Function', ['Length', 'v'], ['Typed', 'v', "'real | list'"]],
      'p',
    ];
    expect(() => compile(ce.box(json as never), { fallback: false })).toThrow(
      /a parameter of Apply whose type is not a scalar/
    );
  });

  test('a declared union of shapes still declines', () => {
    const json = [
      'Apply',
      [
        'Function',
        ['PointX', 'v'],
        ['Typed', 'v', "'real | tuple<real, real>'"],
      ],
      ['Tuple', 1, 2],
    ];
    expect(() => compile(ce.box(json as never), { fallback: false })).toThrow(
      /a parameter of Apply whose type is not a scalar/
    );
  });
});
