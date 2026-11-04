/**
 * The compiled code of `Apply(Function(body, d), arg)` types a bare
 * parameter `d` from the static type of its collection argument.
 *
 * Without the argument type, `d` has the type that its uses in the body
 * infer: in `d ↦ Sum(d)`, `d` is a `collection`, which can hold `Nothing`
 * elements, and the compilation of `Sum` and `Max` declined. The same body
 * with the argument written in place of `d` compiled. The interpreter binds
 * the argument whole to `d`, so the compiled body is now built with `d`
 * typed as the argument (`list<integer>` below). A literal whose parameters
 * are all scalar maps over a list argument; its parameter holds an element,
 * and it is not typed from the argument.
 *
 * Reported as GitHub issue 498.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { appliedLiteralTypedFromArguments } from '../../src/compute-engine/compilation/applied-literal-types';
import { rewritePartialApplications } from '../../src/compute-engine/compilation/partial-application';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

const ce = new ComputeEngine();
ce.declare('n', 'integer');

/** The even integers of `1..n`, of type `list<integer>`. */
const evens = [
  'Filter',
  ['Range', 1, 'n', 1],
  ['Function', ['Equal', ['Mod', 'i', 2], 0], 'i'],
];

/** The value of `json` given by the interpreter, with `n` assigned. */
function interpreted(json: unknown, n: number): unknown {
  const engine = new ComputeEngine();
  engine.declare('n', 'integer');
  engine.assign('n', n);
  const value = engine.box(json as never).evaluate();
  return value.isNumberLiteral ? value.re : value.json;
}

/** The compiled JavaScript of `json`, which must compile. */
function compiled(json: unknown) {
  const r = compile(ce.box(json as never), { to: 'javascript' });
  expect(r.error).toBeUndefined();
  expect(r.success).toBe(true);
  return r;
}

describe('a parameter of an applied function literal', () => {
  test.each([
    ['Sum', ['Apply', ['Function', ['Sum', 'd'], 'd'], evens]],
    [
      'Max behind a length test',
      [
        'Apply',
        [
          'Function',
          ['If', ['Equal', ['Length', 'd'], 0], 0, ['Max', 'd']],
          'd',
        ],
        evens,
      ],
    ],
    [
      'two parameters',
      [
        'Apply',
        ['Function', ['Add', ['Sum', 'a'], ['Length', 'b']], 'a', 'b'],
        evens,
        ['List', 1, 2, 3],
      ],
    ],
    [
      'a local of an enclosing block',
      [
        'Block',
        ['Declare', 'k', "'integer'", 3],
        ['Apply', ['Function', ['Add', ['Sum', 'd'], 'k'], 'd'], evens],
      ],
    ],
    [
      'a nested application',
      [
        'Apply',
        [
          'Function',
          [
            'Apply',
            [
              'Function',
              ['If', ['Equal', ['Length', 'e'], 0], -1, ['Max', 'e']],
              'e',
            ],
            ['Filter', 'd', ['Function', ['Greater', 'j', 2], 'j']],
          ],
          'd',
        ],
        evens,
      ],
    ],
  ])('is typed from its argument: %s', (_, json) => {
    const r = compiled(json);
    for (const n of [0, 1, 6, 9])
      expect(r.run!({ n })).toEqual(interpreted(json, n));
  });

  test('ApplyWhole types its parameter as Apply does', () => {
    const json = ['ApplyWhole', ['Function', ['Sum', 'd'], 'd'], evens];
    const r = compiled(json);
    for (const n of [0, 6, 9])
      expect(r.run!({ n })).toEqual(interpreted(json, n));
  });

  test('At reads the typed list with the numeric lowering', () => {
    const r = compiled(['Apply', ['Function', ['At', 'd', 1], 'd'], evens]);
    expect(r.code).toContain('_SYS.atNumeric(');
    expect(r.code).not.toContain('atWithValueMarker');
    expect(r.run!({ n: 6 })).toBe(2);
  });

  test('a parameter with a type annotation keeps it', () => {
    const json = [
      'Apply',
      ['Function', ['Sum', 'd'], ['Typed', 'd', "'list<number>'"]],
      evens,
    ];
    const r = compiled(json);
    expect(r.run!({ n: 6 })).toBe(12);
    const expr = ce.box(json as never);
    expect(isFunction(expr)).toBe(true);
    if (!isFunction(expr)) return;
    expect(
      appliedLiteralTypedFromArguments(expr.ops, { whole: false })
    ).toBeUndefined();
  });

  test('a parameter that the body assigns keeps its inferred type', () => {
    const engine = new ComputeEngine();
    engine.declare('L', 'list<integer>');
    engine.declare('C', 'list<real>');
    const json = [
      'Apply',
      [
        'Function',
        ['Block', ['Assign', 'a', 'C'], ['Length', 'a']],
        'a',
      ],
      'L',
    ];
    const expr = engine.box(json as never);
    expect(isFunction(expr)).toBe(true);
    if (!isFunction(expr)) return;
    expect(
      appliedLiteralTypedFromArguments(expr.ops, { whole: false })
    ).toBeUndefined();
    const r = compile(expr, { to: 'javascript', fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ L: [1, 2], C: [0.5, 1.5, 2.5] })).toBe(3);
  });

  test('an argument whose type is a union of shapes does not type the parameter', () => {
    // A union annotation on a parameter is the host's request for a
    // run-time dispatch there, so the compiler does not write one.
    // The union is found through a type alias too. A union inside the
    // element type is not a union of the argument.
    const engine = new ComputeEngine();
    engine.declareType('PointOrPoints', 'tuple<real, real> | list<tuple<real, real>>', {
      alias: true,
    });
    engine.declare('P', 'tuple<real, real> | list<tuple<real, real>>');
    engine.declare('Q', 'PointOrPoints');
    engine.declare('W', 'list<tuple<real, real> | list<real>>');
    const typed = (arg: string) => {
      const expr = engine.box([
        'Apply',
        ['Function', ['Length', 'd'], 'd'],
        arg,
      ] as never);
      if (!isFunction(expr)) throw new Error('not a function expression');
      return appliedLiteralTypedFromArguments(expr.ops, { whole: false });
    };
    expect(typed('P')).toBeUndefined();
    expect(typed('Q')).toBeUndefined();
    expect(typed('W')).toBeDefined();
  });

  test('ApplyWhole overridden by the caller receives its callee as written', () => {
    const json = ['ApplyWhole', ['Function', ['Sum', 'd'], 'd'], evens];
    const expr = ce.box(json as never);
    expect(rewritePartialApplications(expr)).not.toBe(expr);
    expect(rewritePartialApplications(expr, new Set(['ApplyWhole']))).toBe(
      expr
    );
  });

  test('a literal with a scalar parameter still maps over the list', () => {
    const json = ['Apply', ['Function', ['Add', 'x', 1], 'x'], evens];
    const r = compiled(json);
    expect(r.run!({ n: 6 })).toEqual([3, 5, 7]);
    expect(interpreted(json, 6)).toEqual(['List', 3, 5, 7]);
  });

  test('the expression is not changed', () => {
    const json = ['Apply', ['Function', ['Sum', 'd'], 'd'], evens];
    const expr = ce.box(json as never);
    const before = JSON.stringify(expr.json);
    expect(compile(expr, { to: 'javascript' }).success).toBe(true);
    expect(JSON.stringify(expr.json)).toBe(before);
    expect(expr.ops[0].ops[1].operator).not.toBe('Typed');
  });
});
