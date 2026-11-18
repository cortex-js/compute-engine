import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/free-functions';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Four places where the compiled JavaScript route and the interpreter
 * disagreed, now aligned:
 *
 * - `Gamma` of a maybe-complex operand compiles to the complex kernel
 *   (`_SYS.cgamma`), as `Sin` does; it answered `NaN` for every argument.
 * - `Dot` of a tuple of tuples declines to compile: the interpreter reads
 *   `((1, 2), (3, 4))` as one point with nested coordinates and leaves the
 *   product unevaluated, while the matrix product answered `[17, 39]`.
 * - A call of a user function whose argument's static type does not prove a
 *   parameter type that admits only some real numbers (`integer`) compiles
 *   with no test: compiled code assumes that the value holds the parameter
 *   type. For a value outside it, the interpreter answers an
 *   `incompatible-type` error that the static type of the call does not
 *   show, and the compiled value is unspecified.
 * - A parameter that reaches a whole-collection operator through an
 *   element-wise operator binds a list whole on both routes (`mean(xs^2)`
 *   over `[1, 2, 3]` is `14/3`, not `[1, 4, 9]`), and so does a parameter
 *   declared `collection<any> | number`. A local copy of the parameter is
 *   not a use of it: the call is applied to each element.
 */

const run = (
  ce: ComputeEngine,
  expr: unknown,
  args?: Record<string, unknown>
) => {
  const c = compile(expr as any, { engine: ce } as any) as any;
  if (!c.success) return 'declined';
  return JSON.stringify(c.run(args));
};

describe('DOT OF A TUPLE OF TUPLES', () => {
  const ce = new ComputeEngine();
  const nested = [
    'Dot',
    ['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ['Tuple', 5, 6],
  ];

  test('stays unevaluated in the interpreter', () => {
    expect(ce.box(nested as any).evaluate().operator).toBe('Dot');
  });

  test('declines to compile on the JavaScript target', () => {
    expect(run(ce, ce.box(nested as any))).toBe('declined');
  });

  test('a symbol holding a tuple of tuples declines too', () => {
    ce.declare('q', 'tuple<tuple<real, real>, tuple<real, real>>');
    expect(
      run(ce, ce.box(['Dot', 'q', ['Tuple', 5, 6]]), {
        q: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toBe('declined');
    ce.assign('pt', ce.box(['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    expect(run(ce, ce.box(['Dot', 'pt', ['Tuple', 5, 6]]))).toBe('declined');
  });
});

// A user function with ONE clause accepts `NaN` at a parameter typed with a
// numeric type (`real`, `integer`, …), and its body runs with `NaN`. A
// multi-clause function refuses it, since no clause is the correct one for
// `NaN`. Decision: `docs/ERROR-MODEL.md`, "A user function accepts `NaN` at
// a numeric parameter — RULED 2026-09-30", amended 2026-10-17. Compiled code
// does not test the argument, so the body runs with `NaN` at a `real` and
// at an `integer` parameter.
describe('NaN AT A NUMERIC PARAMETER OF A USER FUNCTION', () => {
  test('a declared result `list | number` with a body that can return a number', () => {
    // A body that can return a number: the call is typed
    // `number | vector<2>`, which `Join` does not spread, so the
    // compilation declines and the interpreter answers. The interpreter
    // joins a number as one element: `Join([9], 3)` is `[9, 3]`.
    const ce2 = new ComputeEngine();
    ce2.declare('f', '(real) -> list | number');
    ce2.assign(
      'f',
      ce2.box([
        'Function',
        ['Which', ['Greater', 'x', 0], ['List', 'x', 1], 'True', 'x'],
        'x',
      ] as any)
    );
    ce2.declare('w', 'number');
    const join = ce2.box(['Join', ['List', 9], ['f', 'w']]);
    expect(() =>
      compile(join, { engine: ce2, fallback: false } as any)
    ).toThrow(/Join/);
    const fallback = compile(join, { engine: ce2 } as any) as any;
    expect(fallback.success).toBe(false);
    expect(fallback.run({ w: -3 })).toEqual([9, -3]);
    expect(fallback.run({ w: 2 })).toEqual([9, 2, 1]);
  });

  // The compiler declines a function of several clauses.
  test('several clauses: NaN selects no clause', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DefineFunction',
      'g',
      ['Function', 1, ['Typed', 'n', { str: 'integer' }]],
    ]).evaluate();
    ce.box([
      'DefineFunction',
      'g',
      ['Function', 2, ['Typed', 's', { str: 'string' }]],
    ]).evaluate();
    expect(ce.box(['g', 'NaN']).evaluate().toString()).toMatch(
      /^Error\(.*incompatible-type/
    );
  });
});

describe('A PARAMETER THAT REACHES A WHOLE-COLLECTION OPERATOR INDIRECTLY', () => {
  const ce = new ComputeEngine();
  ce.declare('v', 'list<number>');
  const both = (def: string, name: string): [string, string] => {
    const r = executeEpsil(ce, `${def}\n${name}([1, 2, 3])`);
    return [r.value.toString(), run(ce, ce.box([name, 'v']), { v: [1, 2, 3] })];
  };

  // The compiler declines the other cases of this family (`mean`, `sum`,
  // `max`, `product`, `gcd` of the parameter).
  test.each([
    [
      'not through a local holding an element-wise result',
      'function a5b(xs) { let ys = xs^2; sum(ys) }',
      'a5b',
      '[1,4,9]',
      '[1,4,9]',
    ],
  ])('%s', (_label, def, name, interp, compiled) => {
    expect(both(def, name)).toEqual([interp, compiled]);
  });

  test('a scalar argument still gives the scalar value', () => {
    const r = executeEpsil(ce, 'function a9(xs) { mean(xs^2) }\na9(3)');
    expect(r.value.toString()).toBe('9');
  });

  test('a body with no whole-collection operator still maps over a list', () => {
    expect(both('function a10(xs) { xs^2 + 1 }', 'a10')).toEqual([
      '[2,5,10]',
      '[2,5,10]',
    ]);
    expect(both('function a11(t) { (cos(t), sin(t)) }', 'a11')[0]).toBe(
      '[(cos(1), sin(1)),(cos(2), sin(2)),(cos(3), sin(3))]'
    );
  });

  test("an index of a Sum with the parameter's name is not the parameter", () => {
    const k = ce.box([
      'Function',
      ['Add', 'x', ['Sum', ['Max', 'x'], ['Limits', 'x', 1, 3]]],
      'x',
    ]);
    expect(k.type.toString()).toBe('(x: unknown) -> number');
  });
});
