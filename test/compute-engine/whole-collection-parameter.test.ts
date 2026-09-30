/**
 * A user function whose body passes its parameter, as the LONE operand, to
 * an operator that is NOT element-wise and whose declared operand type has a
 * collection arm, binds a list argument WHOLE (user decision 2026-09-29).
 * `Norm` is excluded, and a use through an element-wise operator
 * (`mean(xs^2)`) or with other operands (`mean(x, 1)`) does not count: see
 * the doc comment of `wholeCollectionParameterType` for the reasons.
 *
 * A user function with an `unknown` parameter is applied to each element of a
 * list argument (auto-broadcast). Before this rule, a parameter reached the
 * function's signature only when its inferred type excluded every scalar, so
 * `function h(xs) { mean(xs) }` kept an `unknown` slot and `h([1, 2, 3])` was
 * `[mean(1), mean(2), mean(3)]` = `[1, 2, 3]` instead of `2`. The slot of such
 * a parameter is now `collection<any> | value`
 * (`wholeCollectionParameterType`, `boxed-expression/effects-inference.ts`).
 *
 * The reference is the body with the argument substituted: `h(v)` must give
 * the same value as the body with `v` in place of the parameter. Each row
 * checks that on a list, a nested list and a scalar, and so measures the
 * scalar call too: `h(5)` gives what `mean(5)` gives.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { compile } from '../../src/compile';
import type { MathJsonExpression } from '../../src/math-json';

const LIST = '[1, 2, 3]';
const NESTED = '[[1], [2, 3]]';
const SCALAR = '5';

// [row, Epsil body over `xs`, expected type of `h`, arguments]
const EPSIL_CASES: [string, string, string, string[]][] = [
  [
    'Mean',
    'mean(xs)',
    '(collection<any> | value) -> number',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Median',
    'median(xs)',
    '(collection<any> | value) -> nan | real | signed_infinity',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Variance',
    'variance(xs)',
    '(collection<any> | value) -> nan | real<0..>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'StandardDeviation',
    'standardDeviation(xs)',
    '(collection<any> | value) -> nan | real<0..>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Mode',
    'mode(xs)',
    '(collection<any> | value) -> nan | real | signed_infinity',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Quartiles',
    'quartiles(xs)',
    '(collection<any> | value) -> tuple<lower: nan | real | signed_infinity, mid: nan | real | signed_infinity, upper: nan | real | signed_infinity>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Flatten',
    'flatten(xs)',
    '(collection<any> | value) -> list',
    [LIST, NESTED, SCALAR],
  ],
  ['Sum', 'sum(xs)', '(collection) -> number', [LIST, NESTED, SCALAR]],
  ['Product', 'product(xs)', '(collection) -> number', [LIST, SCALAR]],
  [
    'Length',
    'length(xs)',
    '(collection) -> integer | signed_infinity',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Join',
    'join(xs)',
    // `Join`/`Append` over an operand typed as an abstract collection are
    // typed `collection<…>` since 2026-09-29: the operand may hold a set.
    '(collection<any>) -> collection<any>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Append',
    'append(xs, 9)',
    '(collection<any>) -> collection<any>',
    [LIST, NESTED],
  ],
  [
    'SetFrom',
    'setFrom(xs)',
    '(collection<any> | value) -> set<unknown>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'TupleFrom',
    'tupleFrom(xs)',
    '(collection<any> | value) -> tuple',
    [LIST, NESTED, SCALAR],
  ],
  [
    'StringJoin',
    'stringJoin(xs)',
    '(collection<character | string>) -> string',
    ['["a", "b"]'],
  ],
  // A parameter used both whole and element-wise is consumed whole: the
  // element-wise use then broadcasts inside the body, as it does in the body
  // with the list substituted.
  [
    'mixed use',
    'mean(xs) + xs',
    // The sum of a scalar and the parameter is element-wise over a
    // parameter that may hold a list: `broadcastable<…>` since 2026-09-29.
    '(collection<any> | value) -> broadcastable<any>',
    [LIST, NESTED, SCALAR],
  ],
];

function epsilValue(ce: ComputeEngine, source: string): string {
  const r = executeEpsil(ce, source);
  return r.value?.toString() ?? `no value: ${JSON.stringify(r.diagnostics)}`;
}

describe('Whole-collection parameter: Epsil route', () => {
  for (const [row, body, type, args] of EPSIL_CASES) {
    for (const arg of args) {
      test(`${row} over ${arg}`, () => {
        const ce = new ComputeEngine();
        const viaFunction = epsilValue(
          ce,
          `function h(xs) { ${body} }\nh(${arg})`
        );
        expect(ce.symbol('h').type.toString()).toBe(type);
        const direct = epsilValue(
          new ComputeEngine(),
          `let xs = ${arg}\n${body}`
        );
        expect(viaFunction).toBe(direct);
      });
    }
  }

  test('the decided values', () => {
    expect(
      epsilValue(
        new ComputeEngine(),
        'function h(xs) { mean(xs) }\nh([1, 2, 3])'
      )
    ).toBe('2');
    expect(
      epsilValue(
        new ComputeEngine(),
        'function h(xs) { flatten(xs) }\nh([[1], [2, 3]])'
      )
    ).toBe('[1,2,3]');
    expect(
      epsilValue(
        new ComputeEngine(),
        'function h(xs) { mean(xs) + xs }\nh([1, 2, 3])'
      )
    ).toBe('[3,4,5]');
  });

  test('the scalar call gives what the operator gives on the scalar', () => {
    // Measured before the rule: `mean` gave `5` and `flatten` gave `[5]`.
    // The lifted slot keeps the scalar arms, so neither changes.
    const mean = epsilValue(
      new ComputeEngine(),
      'function h(xs) { mean(xs) }\nh(5)'
    );
    expect(mean).toBe('5');
    expect(epsilValue(new ComputeEngine(), 'mean(5)')).toBe(mean);
    const flatten = epsilValue(
      new ComputeEngine(),
      'function h(xs) { flatten(xs) }\nh(5)'
    );
    expect(flatten).toBe('[5]');
    expect(epsilValue(new ComputeEngine(), 'flatten(5)')).toBe(flatten);
  });

  test('an arrow function is lifted the same way', () => {
    const ce = new ComputeEngine();
    expect(epsilValue(ce, 'let h = (xs) => mean(xs)\nh([1, 2, 3])')).toBe('2');
  });

  test('a second parameter used element-wise is bound whole too', () => {
    // The function is no longer applied to each element, so `k` is the list
    // itself, as in `mean([1, 2, 3]) * [1, 10]`.
    const ce = new ComputeEngine();
    expect(
      epsilValue(
        ce,
        'function h(xs, k) { mean(xs) * k }\nh([1, 2, 3], [1, 10])'
      )
    ).toBe('[2,20]');
  });
});

// [row, body over `xs`, expected parameter type of the function literal]
const BOX_CASES: [string, MathJsonExpression, string][] = [
  ['Mean', ['Mean', 'xs'], 'collection<any> | value'],
  ['Median', ['Median', 'xs'], 'collection<any> | value'],
  ['Variance', ['Variance', 'xs'], 'collection<any> | value'],
  ['StandardDeviation', ['StandardDeviation', 'xs'], 'collection<any> | value'],
  ['Mode', ['Mode', 'xs'], 'collection<any> | value'],
  ['Quartiles', ['Quartiles', 'xs'], 'collection<any> | value'],
  ['Flatten', ['Flatten', 'xs'], 'collection<any> | value'],
  ['SetFrom', ['SetFrom', 'xs'], 'collection<any> | value'],
  ['TupleFrom', ['TupleFrom', 'xs'], 'collection<any> | value'],
  ['mixed use', ['Add', ['Mean', 'xs'], 'xs'], 'collection<any> | value'],
];

function substitute(
  expr: MathJsonExpression,
  value: MathJsonExpression
): MathJsonExpression {
  if (expr === 'xs') return value;
  if (Array.isArray(expr))
    return expr.map((x) =>
      substitute(x as MathJsonExpression, value)
    ) as MathJsonExpression;
  return expr;
}

describe('Whole-collection parameter: box route', () => {
  const args: MathJsonExpression[] = [
    ['List', 1, 2, 3],
    ['List', ['List', 1], ['List', 2, 3]],
    5,
  ];
  for (const [row, body, paramType] of BOX_CASES) {
    test(row, () => {
      const ce = new ComputeEngine();
      const fn = ce.box(['Function', body, 'xs']);
      expect(fn.type.toString()).toMatch(
        new RegExp(`^\\(xs: ${paramType.replace(/[()<>|]/g, '\\$&')}\\) ->`)
      );
      ce.declare('h', 'function');
      ce.assign('h', fn);
      for (const arg of args) {
        const viaFunction = ce.box(['h', arg]).evaluate().toString();
        const direct = ce.box(substitute(body, arg)).evaluate().toString();
        expect(viaFunction).toBe(direct);
      }
    });
  }

  test('the lifted slot accepts every argument the unlifted slot accepted', () => {
    // The slot is `collection<any> | value`, not the type the body's uses
    // infer for the parameter: a point, a complex number and a string reach
    // the body, and the call gives what `Mean` gives on that argument.
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Mean', 'xs'], 'xs']));
    const point: MathJsonExpression = ['Tuple', 1, 2];
    const complex: MathJsonExpression = ['Complex', 1, 2];
    const str: MathJsonExpression = { str: 'ab' };
    const results: string[] = [];
    for (const arg of [point, complex, str]) {
      const viaFunction = ce.box(['h', arg]).evaluate().toString();
      expect(viaFunction).toBe(ce.box(['Mean', arg]).evaluate().toString());
      results.push(viaFunction);
    }
    expect(results).toEqual([
      '3/2',
      '(1 + 2i)',
      'Error(ErrorCode("incompatible-type", "number", "string"), "Mean: \\"ab\\"")',
    ]);
  });

  test('a declared parameter type is not widened', () => {
    // The declaration is the slot, and a list argument is applied element by
    // element, as before the rule.
    const ce = new ComputeEngine();
    ce.assign(
      'g',
      ce.box(['Function', ['Mean', 'x'], ['Typed', 'x', "'number'"]])
    );
    expect(ce.symbol('g').type.toString()).toBe('(x: number) -> number');
    expect(
      ce
        .box(['g', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
    const ce2 = new ComputeEngine();
    expect(
      epsilValue(ce2, 'function g(x: number) { mean(x) }\ng([1, 2, 3])')
    ).toBe('[1,2,3]');
    expect(ce2.symbol('g').type.toString()).toBe('(x: number) -> number');
  });

  test('the LaTeX route', () => {
    const ce = new ComputeEngine();
    ce.parse('h(x) \\coloneq \\operatorname{Mean}(x)').evaluate();
    expect(ce.parse('h([1,2,3])').evaluate().toString()).toBe('2');
    expect(ce.parse('h(5)').evaluate().toString()).toBe('5');
  });
});

describe('Not lifted yet: Max, Min, GCD, LCM, ListFrom', () => {
  // These operators read a collection operand whole, but their slot type is
  // `value` or `any`, and the compiled body of a user function types its
  // parameter from the body's uses, not from the lifted signature slot. So
  // lifting them would make the interpreter answer `3` for
  // `function h(xs) { max(xs) }` applied to `[1, 2, 3]` while the compiled
  // function answers `NaN` (`Math.max(<array>)`). Until the compiled route
  // reads the lifted type, they keep the element-wise application, on both
  // routes. See `TOP_SLOT_WHOLE_COLLECTION_OPERATORS` in
  // `boxed-expression/effects-inference.ts`.
  for (const [op, body] of [
    ['Max', 'max(xs)'],
    ['Min', 'min(xs)'],
    ['GCD', 'gcd(xs)'],
    ['LCM', 'lcm(xs)'],
  ]) {
    test(op, () => {
      const ce = new ComputeEngine();
      expect(epsilValue(ce, `function h(xs) { ${body} }\nh([1, 2, 3])`)).toBe(
        '[1,2,3]'
      );
      expect(ce.symbol('h').type.toString()).toBe('(unknown) -> number');
    });
  }

  test('ListFrom', () => {
    const ce = new ComputeEngine();
    expect(
      epsilValue(ce, 'function h(xs) { listFrom(xs) }\nh([1, 2, 3])')
    ).toBe('[[1],[2],[3]]');
  });
});

describe('Element-wise uses still broadcast', () => {
  test('sin', () => {
    const ce = new ComputeEngine();
    expect(epsilValue(ce, 'function s(xs) { sin(xs) }\ns([0, 1])')).toBe(
      '[0,sin(1)]'
    );
    // A fresh engine already holds a value definition for `s`, and a function
    // defined under that name reads back as the bare type `function`, so the
    // signature is checked on another name.
    const ce2 = new ComputeEngine();
    epsilValue(ce2, 'function sw(xs) { sin(xs) }');
    expect(ce2.symbol('sw').type.toString()).toBe('(unknown) -> number');
  });

  test('x + 1', () => {
    const ce = new ComputeEngine();
    expect(epsilValue(ce, 'function p(x) { x + 1 }\np([1, 2])')).toBe('[2,3]');
    expect(ce.symbol('p').type.toString()).toBe('(unknown) -> number');
  });

  test('an index of At is a gather, which is element-wise', () => {
    const ce = new ComputeEngine();
    expect(
      epsilValue(ce, 'function a(xs, i) { xs[i] }\na([10, 20, 30], [1, 3])')
    ).toBe('[10,30]');
    // The index parameter keeps its `unknown` slot.
    expect(ce.symbol('a').type.toString()).toBe(
      '(dictionary<any> | indexed_collection<any>, unknown) -> unknown'
    );
    const ce2 = new ComputeEngine();
    expect(
      epsilValue(
        ce2,
        'let L = [10, 20, 30]\nfunction g(t) { L[t] + 1 }\ng([1, 3])'
      )
    ).toBe('[11,31]');
    expect(ce2.symbol('g').type.toString()).toBe('(unknown) -> integer | nan');
  });

  test('a container operand is not a whole use: a point maps over a list', () => {
    // `Tuple` and `List` accept any value, with no collection arm: the
    // parameter of `(t) ↦ (t, t^2)` stays scalar, so a list of parameters
    // gives a list of points.
    const ce = new ComputeEngine();
    expect(epsilValue(ce, 'function h(t) { (t, t^2) }\nh([1, 2])')).toBe(
      '[(1, 1),(2, 4)]'
    );
    expect(
      epsilValue(new ComputeEngine(), 'function h(t) { [t, 2] }\nh([1, 2])')
    ).toBe('[[1,2],[2,2]]');
  });

  test('a shadowed parameter of an inner function is not a use', () => {
    // The `xs` of the inner lambda is its own binding: the outer `xs` is only
    // used element-wise, so it stays unlifted.
    const ce = new ComputeEngine();
    epsilValue(
      ce,
      'function h(xs) { map(xs => mean(xs), [[1, 2], [3]]) + xs }'
    );
    expect(ce.symbol('h').type.toString()).toBe('(unknown) -> list<number>');
  });

  test('a use inside an inner function is a use of the outer parameter', () => {
    const ce = new ComputeEngine();
    expect(
      epsilValue(
        ce,
        'function h(xs) { map(y => y + mean(xs), [1, 2]) }\nh([1, 2, 3])'
      )
    ).toBe('[3,4]');
  });
});

// [row, Epsil definition of `h`, arguments of the call as [name, declared
// type, MathJSON value, JavaScript value], expected interpreter value,
// expected compiled value or 'decline']
type Arg = [string, string, MathJsonExpression, unknown];
const L123: Arg = ['L', 'list<real>', ['List', 1, 2, 3], [1, 2, 3]];
const A5: Arg = ['a', 'real', 5, 5];
const POINTS: Arg = [
  'P',
  'list<tuple<real, real>>',
  ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]],
  [
    [3, 4],
    [6, 8],
  ],
];
const POINT: Arg = ['Q', 'tuple<real, real>', ['Tuple', 3, 4], [3, 4]];
const ORIGIN: Arg = ['O', 'tuple<real, real>', ['Tuple', 0, 0], [0, 0]];
const VECTORS: Arg = [
  'M',
  'list<list<real>>',
  ['List', ['List', 3, 4], ['List', 6, 8]],
  [
    [3, 4],
    [6, 8],
  ],
];
const VECTOR: Arg = ['V', 'list<real>', ['List', 3, 4], [3, 4]];

const ROUTE_CASES: [string, string, Arg[], string, unknown][] = [
  ['Mean over a list', 'function h(xs) { mean(xs) }', [L123], '2', 2],
  ['Mean over a scalar', 'function h(xs) { mean(xs) }', [A5], '5', 5],
  ['Flatten', 'function h(xs) { flatten(xs) }', [L123], '[1,2,3]', [1, 2, 3]],
  [
    'mixed use',
    'function h(xs) { mean(xs) + xs }',
    [L123],
    '[3,4,5]',
    [3, 4, 5],
  ],
  // A use through an element-wise operator is element-wise: the compiled
  // function types the parameter from `xs^2`, a scalar use.
  [
    'mean(xs^2) over a list',
    'function h(xs) { mean(xs^2) }',
    [L123],
    '[1,4,9]',
    [1, 4, 9],
  ],
  ['mean(xs^2) over a scalar', 'function h(xs) { mean(xs^2) }', [A5], '25', 25],
  // With a second operand, `Mean` reads each operand as one datum: one
  // value per sample.
  [
    'mean(x, 1) over a list',
    'function h(x) { mean(x, 1) }',
    [L123],
    '[1,3/2,2]',
    [1, 1.5, 2],
  ],
  ['mean(x, 1) over a scalar', 'function h(x) { mean(x, 1) }', [A5], '3', 3],
  // `Norm` is excluded: one norm per point.
  [
    'norm(p) over a list of points',
    'function h(p) { norm(p) }',
    [POINTS],
    '[5,10]',
    [5, 10],
  ],
  ['norm(p) over a point', 'function h(p) { norm(p) }', [POINT], '5', 5],
  // The JavaScript target declines a point argument at an untyped parameter
  // (`q`): the emitted definition would treat it as a scalar.
  [
    'norm(p - q) over a list of points',
    'function h(p, q) { norm(p - q) }',
    [POINTS, ORIGIN],
    '[5,10]',
    'decline',
  ],
  [
    'norm(p - q) over a point',
    'function h(p, q) { norm(p - q) }',
    [POINT, ORIGIN],
    '5',
    5,
  ],
  // A list of vectors is applied element by element down to the numbers,
  // on both routes, as before the rule: the norm of each number is itself.
  [
    'norm(v) over a list of vectors',
    'function h(v) { norm(v) }',
    [VECTORS],
    '[[3,4],[6,8]]',
    [
      [3, 4],
      [6, 8],
    ],
  ],
  [
    'norm(v) over a vector',
    'function h(v) { norm(v) }',
    [VECTOR],
    '[3,4]',
    [3, 4],
  ],
  // `String` is element-wise: one string per element. The JavaScript target
  // does not compile `String` of a number.
  [
    'String over a list',
    'function h(p) { String(p) }',
    [['L', 'list<real>', ['List', 1, 2], [1, 2]]],
    '["1","2"]',
    'decline',
  ],
];

function compiledValue(
  ce: ComputeEngine,
  call: MathJsonExpression,
  vars: Record<string, unknown>
): unknown {
  try {
    const result = compile(ce.box(call), { to: 'javascript', fallback: false });
    if (!result.success) return 'decline';
    return result.run!(vars as never);
  } catch {
    return 'decline';
  }
}

describe('Interpreter and compiled function agree', () => {
  for (const [row, definition, args, interpreted, compiled] of ROUTE_CASES) {
    test(row, () => {
      const call: MathJsonExpression = ['h', ...args.map((a) => a[0])];

      const ce = new ComputeEngine();
      for (const [name, type] of args) ce.declare(name, type as never);
      executeEpsil(ce, definition);
      for (const [name, , value] of args) ce.assign(name, ce.box(value));
      expect(ce.box(call).evaluate().toString()).toBe(interpreted);

      const ce2 = new ComputeEngine();
      for (const [name, type] of args) ce2.declare(name, type as never);
      executeEpsil(ce2, definition);
      const vars = Object.fromEntries(args.map((a) => [a[0], a[3]]));
      expect(compiledValue(ce2, call, vars)).toEqual(compiled);
    });
  }
});

describe('Limitations of the rule, as they behave today', () => {
  test('a use through a local alias is not followed', () => {
    const ce = new ComputeEngine();
    expect(
      epsilValue(ce, 'function h(xs) { let ys = xs\nmean(ys) }\nh([1, 2, 3])')
    ).toBe('[1,2,3]');
    expect(ce.symbol('h').type.toString()).toBe('(unknown) -> number');
  });

  test('a call to a lifted user function is a whole use, in either order', () => {
    for (const source of [
      'function h(xs) { mean(xs) }\nfunction k(xs) { h(xs) }',
      'function k(xs) { h(xs) }\nfunction h(xs) { mean(xs) }',
    ]) {
      const ce = new ComputeEngine();
      expect(epsilValue(ce, `${source}\nk([1, 2, 3])`)).toBe('2');
      expect(ce.symbol('k').type.toString()).toBe(
        '(collection<any> | value) -> number'
      );
    }
    // The box route, `k` assigned before `h`.
    const ce = new ComputeEngine();
    ce.assign('k', ce.box(['Function', ['h', 'xs'], 'xs']));
    ce.assign('h', ce.box(['Function', ['Mean', 'xs'], 'xs']));
    expect(
      ce
        .box(['k', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('2');
  });

  test('a recursive function that reads its parameter whole terminates', () => {
    const ce = new ComputeEngine();
    expect(
      epsilValue(
        ce,
        'function r(xs, n) { if n <= 0 { mean(xs) } else { r(xs, n - 1) } }\nr([1, 2, 3], 2)'
      )
    ).toBe('2');
    // The self-call types `unknown` while the clause body canonicalizes
    // (the recursion knot, `_recursionKnotNames`), so the result is the base
    // clause's `number`; it was the broadcast guess `broadcastable<unknown>`
    // that a bare `function` callee gives over a collection argument.
    expect(ce.symbol('r').type.toString()).toBe(
      '(collection<any> | value, unknown) -> number'
    );
  });
});
