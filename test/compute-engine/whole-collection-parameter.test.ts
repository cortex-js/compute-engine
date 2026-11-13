/**
 * A user function whose body passes its parameter, as the LONE operand, to
 * an operator that is NOT element-wise and whose declared operand type has a
 * collection arm, binds a list argument WHOLE (user decision 2026-09-29).
 * The operand may reach the parameter through element-wise operators
 * (`mean(xs^2)`) or through a local of the body (`let ys = xs; mean(ys)`).
 * `Norm` is excluded, and a use with other operands (`mean(x, 1)`) does not
 * count: see the doc comment of `wholeCollectionParameterType` for the
 * reasons.
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
    '(xs: collection<number> | value) -> number',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Median',
    'median(xs)',
    '(xs: collection<number> | value) -> nan | real | signed_infinity',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Variance',
    'variance(xs)',
    '(xs: collection<number> | value) -> nan | real<0..>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'StandardDeviation',
    'standardDeviation(xs)',
    '(xs: collection<number> | value) -> nan | real<0..>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Mode',
    'mode(xs)',
    '(xs: collection<number> | value) -> nan | real | signed_infinity',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Quartiles',
    'quartiles(xs)',
    '(xs: collection<number> | value) -> tuple<lower: nan | real | signed_infinity, mid: nan | real | signed_infinity, upper: nan | real | signed_infinity>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Flatten',
    'flatten(xs)',
    '(xs: collection<any> | value) -> list',
    [LIST, NESTED, SCALAR],
  ],
  ['Sum', 'sum(xs)', '(xs: collection) -> number', [LIST, NESTED, SCALAR]],
  ['Product', 'product(xs)', '(xs: collection) -> number', [LIST, SCALAR]],
  [
    'Length',
    'length(xs)',
    '(xs: collection) -> integer | signed_infinity',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Join',
    'join(xs)',
    // `Join`/`Append` over an operand typed as an abstract collection are
    // typed `collection<…>` since 2026-09-29: the operand may hold a set.
    '(xs: collection<any>) -> collection<any>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'Append',
    'append(xs, 9)',
    '(xs: collection<any>) -> collection<any>',
    [LIST, NESTED],
  ],
  [
    'SetFrom',
    'setFrom(xs)',
    '(xs: collection<any> | value) -> set<unknown>',
    [LIST, NESTED, SCALAR],
  ],
  [
    'TupleFrom',
    'tupleFrom(xs)',
    '(xs: collection<any> | value) -> tuple',
    [LIST, NESTED, SCALAR],
  ],
  [
    'StringJoin',
    'stringJoin(xs)',
    '(xs: collection<character | string>) -> string',
    ['["a", "b"]'],
  ],
  // A parameter used both whole and element-wise is consumed whole: the
  // element-wise use then broadcasts inside the body, as it does in the body
  // with the list substituted.
  [
    'mixed use',
    'mean(xs) + xs',
    // The sum of a scalar and the parameter is element-wise over a
    // parameter that may hold a list (since 2026-09-29). The result was the
    // bare `any` while the slot was `collection<any> | value` (user decision
    // 2026-10-17, Tycho ledger row 379). Since the data parameter of `Mean`
    // is `collection<number>` (ROADMAP CE-13), the elements of the
    // collection arm are numbers, and the sum is typed by them and by the
    // `value` arm. A point argument does not reach the result: `mean` of a
    // point is a number, and a number plus a point is an `incompatible-type`
    // error, as it was before.
    '(xs: collection<number> | value) -> broadcastable<expression<BinomialDistribution> | expression<ExponentialDistribution> | expression<NormalDistribution> | expression<PoissonDistribution> | expression<UniformDistribution> | number>',
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
        // A statistics operator refuses data that is not a collection of
        // numbers when the expression is boxed (ROADMAP CE-13, CE-402), so
        // the direct call over a list of rows is the `incompatible-type` error
        // of the signature. The call through `h` admits the argument at the
        // `value` arm of its slot and gives the `incompatible-type` error of
        // the evaluation: the same error, with different messages.
        if (direct.startsWith('Error(ErrorCode("incompatible-type"'))
          expect(viaFunction).toMatch(/^Error\(ErrorCode\("incompatible-type"/);
        else expect(viaFunction).toBe(direct);
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
  ['Mean', ['Mean', 'xs'], 'collection<number> | value'],
  ['Median', ['Median', 'xs'], 'collection<number> | value'],
  ['Variance', ['Variance', 'xs'], 'collection<number> | value'],
  [
    'StandardDeviation',
    ['StandardDeviation', 'xs'],
    'collection<number> | value',
  ],
  ['Mode', ['Mode', 'xs'], 'collection<number> | value'],
  ['Quartiles', ['Quartiles', 'xs'], 'collection<number> | value'],
  ['Flatten', ['Flatten', 'xs'], 'collection<any> | value'],
  ['SetFrom', ['SetFrom', 'xs'], 'collection<any> | value'],
  ['TupleFrom', ['TupleFrom', 'xs'], 'collection<any> | value'],
  [
    'mixed use',
    ['Add', ['Mean', 'xs'], 'xs'],
    'collection<number> | value',
  ],
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
        // A statistics operator refuses data that is not a collection of
        // numbers when the expression is boxed (ROADMAP CE-13), so the direct
        // call is the `incompatible-type` error of the signature. The call
        // through `h` admits the argument at the `value` arm of its slot and
        // gives the `incompatible-type` error of the evaluation. Both are the
        // same error, with different messages.
        if (direct.startsWith('Error(ErrorCode("incompatible-type"'))
          expect(viaFunction).toMatch(/^Error\(ErrorCode\("incompatible-type"/);
        else expect(viaFunction).toBe(direct);
      }
    });
  }

  test('the lifted slot accepts every argument the unlifted slot accepted', () => {
    // The slot is `collection<number> | value`, not the type the
    // body's uses infer for the parameter: a point, a complex number and a
    // string reach the body, and the call gives what `Mean` gives on that
    // argument. `Mean` refuses the string by its signature (ROADMAP CE-13).
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
      'Error(ErrorCode("incompatible-type", "collection<number> | distribution | number", "string"), "ab")',
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

describe('Lifted: Max, Min, GCD, LCM, Sum, Product, ListFrom', () => {
  // These operators read a collection operand whole; their slot type is
  // `value` or `any`, so they are listed by name
  // (`TOP_SLOT_WHOLE_COLLECTION_OPERATORS` in
  // `boxed-expression/effects-inference.ts`). The compiled form follows: a
  // call with a list argument compiles a helper specialized to the list type
  // (`ensureSpecializedUserCallEmitted`), which reduces the array.
  for (const [op, body, arg, value] of [
    ['Max', 'max(xs)', '[1, 2, 3]', '3'],
    ['Min', 'min(xs)', '[1, 2, 3]', '1'],
    ['GCD', 'gcd(xs)', '[4, 6, 8]', '2'],
    ['LCM', 'lcm(xs)', '[2, 3, 4]', '12'],
  ]) {
    test(op, () => {
      const ce = new ComputeEngine();
      expect(epsilValue(ce, `function h(xs) { ${body} }\nh(${arg})`)).toBe(
        value
      );
      expect(ce.symbol('h').type.toString()).toBe(
        '(xs: collection<any> | value) -> number'
      );
    });
  }

  test('Sum and Product', () => {
    const ce = new ComputeEngine();
    expect(epsilValue(ce, 'function h(xs) { sum(xs) }\nh([1, 2, 3])')).toBe(
      '6'
    );
    expect(epsilValue(ce, 'function p(xs) { product(xs) }\np([1, 2, 3])')).toBe(
      '6'
    );
  });

  test('ListFrom', () => {
    const ce = new ComputeEngine();
    expect(
      epsilValue(ce, 'function h(xs) { listFrom(xs) }\nh([1, 2, 3])')
    ).toBe('[1,2,3]');
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
    expect(ce2.symbol('sw').type.toString()).toBe('(xs: unknown) -> number');
  });

  test('x + 1', () => {
    const ce = new ComputeEngine();
    expect(epsilValue(ce, 'function p(x) { x + 1 }\np([1, 2])')).toBe('[2,3]');
    expect(ce.symbol('p').type.toString()).toBe('(x: unknown) -> number');
  });

  test('an index of At is a gather, which is element-wise', () => {
    const ce = new ComputeEngine();
    expect(
      epsilValue(ce, 'function a(xs, i) { xs[i] }\na([10, 20, 30], [1, 3])')
    ).toBe('[10,30]');
    // The index parameter keeps its `unknown` slot.
    expect(ce.symbol('a').type.toString()).toBe(
      '(xs: dictionary<any> | indexed_collection<any>, i: unknown) -> unknown'
    );
    const ce2 = new ComputeEngine();
    expect(
      epsilValue(
        ce2,
        'let L = [10, 20, 30]\nfunction g(t) { L[t] + 1 }\ng([1, 3])'
      )
    ).toBe('[11,31]');
    // The absence marker of an accessor is implicit in its type.
    expect(ce2.symbol('g').type.toString()).toBe('(t: unknown) -> integer');
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
    expect(ce.symbol('h').type.toString()).toBe('(xs: unknown) -> list<number>');
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
  // A use through an element-wise operator reaches the parameter: the list
  // binds whole, and the compiled call takes the helper specialized to the
  // list type, whose body maps the power over the array.
  [
    'mean(xs^2) over a list',
    'function h(xs) { mean(xs^2) }',
    [L123],
    '14/3',
    14 / 3,
  ],
  ['mean(xs^2) over a scalar', 'function h(xs) { mean(xs^2) }', [A5], '25', 25],
  // A helper that the body assigns a function literal (`let g = …`, or
  // `g = …` after it) and then calls with the parameter gives the slot of its
  // own parameter, as a helper declared with `function g(t) { … }` does.
  [
    'a let helper over a list',
    'function h(xs) { let g = (t) => mean(t)\ng(xs) }',
    [L123],
    '2',
    2,
  ],
  // A block-local function assigned more than once is a function value known
  // only at run time: the JavaScript target declines the call.
  [
    'an assigned helper over a list',
    'function h(xs) { let g = (t) => t\ng = (t) => mean(t)\ng(xs) }',
    [L123],
    '2',
    'decline',
  ],
  [
    'a let helper over a scalar',
    'function h(xs) { let g = (t) => mean(t)\ng(xs) }',
    [A5],
    '5',
    5,
  ],
  [
    'an element-wise let helper over a list',
    'function h(xs) { let g = (t) => t + 1\ng(xs) }',
    [L123],
    '[2,3,4]',
    [2, 3, 4],
  ],
  // With a second operand, `Mean` reads each operand as one datum: one
  // value per sample.
  [
    'mean(x, 1) over a list',
    'function h(x) { mean(x, 1) }',
    [L123],
    '[1,3/2,2]',
    [1, 1.5, 2],
  ],
  ['explicit numeric map of mean over a list', 'function h(x: list<real>) { map((v: real) => mean(v, 1), x) }', [L123], '[1,3/2,2]', [1, 1.5, 2]],
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
  test('a use through a local alias is followed', () => {
    // `let ys = xs` is a `Declare` whose operands are held raw, so the local
    // is recorded by name (see `wholeCollectionParameterType`).
    const ce = new ComputeEngine();
    expect(
      epsilValue(ce, 'function h(xs) { let ys = xs\nmean(ys) }\nh([1, 2, 3])')
    ).toBe('2');
    expect(ce.symbol('h').type.toString()).toBe(
      '(xs: collection<number> | value) -> number'
    );
  });

  test('a call to a helper that the body assigns a function literal', () => {
    // A local declared with a function literal is a variable of type
    // `function`: the call `h(xs)` applies its value to the list, and the
    // signature of `f` does not read the literal.
    const value = (source: string): [string, string] => {
      const ce = new ComputeEngine();
      return [epsilValue(ce, source), ce.symbol('f').type.toString()];
    };
    expect(
      value('function f(xs) { let h = (t) => count(t)\nh(xs) }\nf([1, 2])')
    ).toEqual(['2', '(xs: collection<any> | value) -> unknown']);
    expect(
      value(
        'function f(xs) { let h = (t) => t\nh = (t) => count(t)\nh(xs) }\nf([1, 2])'
      )
    ).toEqual(['2', '(xs: collection<any> | value) -> unknown']);
    // Through an alias of the parameter.
    expect(
      value(
        'function f(xs) { let ys = xs\nlet h = (t) => count(t)\nh(ys) }\nf([1, 2])'
      )[0]
    ).toBe('2');
    // The last literal assigned before the call is read: an element-wise
    // helper keeps the map.
    expect(
      value(
        'function f(xs) { let h = (t) => count(t)\nh = (t) => t * 2\nh(xs) }\nf([1, 2])'
      )
    ).toEqual(['[2,4]', '(xs: unknown) -> unknown']);
    // Inside an inner literal whose parameter is named `h`, `h` is that
    // parameter, not the helper.
    expect(
      value(
        'function f(xs) { let h = (t) => count(t)\nlet g = (h) => h(xs)\ng((u) => u + 1) }\nf([1, 2])'
      )
    ).toEqual(['[2,3]', '(xs: unknown) -> unknown']);
    // A helper that a nested function or block assigns is local to it: the
    // record of the body is the same after it.
    expect(
      value(
        'function f(xs) { let h = (t) => count(t)\nfunction g(u) { let h = (w) => w + 1\nh(u) }\nh(xs) }\nf([1, 2])'
      )[0]
    ).toBe('2');
    expect(
      value(
        'function f(xs) { let h = (t) => t + 1\nif xs == 0 { let h = (w) => count(w)\n0 }\nlet r = [h(xs)]\nr }\nf([1, 2])'
      )[0]
    ).toBe('[[2],[3]]');
    // A function that a nested block declares with `function` is the callee
    // in that block, not the outer helper.
    expect(
      value(
        'function f(xs) { let h = (t) => count(t)\nif xs != 0 { function h(t) { t + 1 }\nlet r = [h(xs)]\nr } }\nf([1, 2])'
      )[0]
    ).toBe('[[2],[3]]');
    // An assignment in a branch of an `If` gives no evidence after the `If`,
    // and removes the record that the name had before it: the branch can
    // replace the helper with an element-wise one.
    expect(
      value(
        'function f(xs) { let h = (t) => t * 2\nif xs == 0 { h = (t) => count(t) }\nh(xs) }\nf([1, 2])'
      )
    ).toEqual(['[2,4]', '(xs: unknown) -> unknown']);
    expect(
      value(
        'function f(xs) { let h = (t) => count(t)\nif xs == 0 { h = (t) => [t] }\nh(xs) }\nf([1, 2])'
      )[1]
    ).toBe('(xs: unknown) -> unknown');
  });

  test('a chain of two local helpers whose parameters are declared lists applies the list whole', () => {
    // A local function is a variable: nothing is derived for its parameters
    // from its body or its callees. A parameter declared as a list takes the
    // list whole; an untyped one maps the call over the list.
    const ce = new ComputeEngine();
    expect(
      epsilValue(
        ce,
        'function f(xs) { let h = (t: list) => count(t)\nlet q = (a: list) => h(a)\nq(xs) }\nf([1, 2])'
      )
    ).toBe('2');
  });

  test('a use through a local assigned AFTER the use is not followed', () => {
    const ce = new ComputeEngine();
    expect(
      epsilValue(
        ce,
        'function h(xs) { let ys = 0\nlet m = mean(ys)\nys = xs\nm }\nh([1, 2, 3])'
      )
    ).toBe('[0,0,0]');
  });

  test('a call to a lifted user function is a whole use, in either order', () => {
    for (const source of [
      'function h(xs) { mean(xs) }\nfunction k(xs) { h(xs) }',
      'function k(xs) { h(xs) }\nfunction h(xs) { mean(xs) }',
    ]) {
      const ce = new ComputeEngine();
      expect(epsilValue(ce, `${source}\nk([1, 2, 3])`)).toBe('2');
      expect(ce.symbol('k').type.toString()).toBe(
        '(xs: collection<number> | value) -> number'
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

  test('a call to a local function whose parameter is a declared list is a whole use', () => {
    // A local of a block is a variable that holds a function: the signature
    // of `q` does not read `h`. A parameter declared as a list takes the
    // list whole.
    const ce = new ComputeEngine();
    const fn = (
      body: MathJsonExpression,
      p: MathJsonExpression
    ): MathJsonExpression => ['Function', body, p];
    const block = (...stmts: MathJsonExpression[]): string =>
      ce
        .box(['Block', ...stmts])
        .evaluate()
        .toString();
    const list = (p: string): MathJsonExpression => ['Typed', p, "'list'"];
    const count = [
      'Declare',
      'h',
      "'unknown'",
      fn(['Count', 't'], list('t')),
    ] as const;
    const caller = [
      'Declare',
      'q',
      "'unknown'",
      fn(['h', 'a'], list('a')),
    ] as const;
    expect(block(count, caller, ['q', ['List', 1, 2]])).toBe('2');
    expect(block(count, caller, ['Apply', 'q', ['List', 1, 2]])).toBe('2');
    // A chain of three functions.
    expect(
      block(
        count,
        caller,
        ['Declare', 'k', "'unknown'", fn(['q', 'b'], list('b'))],
        ['k', ['List', 1, 2, 3]]
      )
    ).toBe('3');
    // The caller `r` puts the value of `h` in a list, so the two bindings
    // give different values: applied to each element, `r([-1, 2])` is
    // `[[h(-1)], [h(2)]]`; bound whole, it is `[h([-1, 2])]`.
    const wholeWrapper = [
      'Declare',
      'r',
      "'unknown'",
      fn(['List', ['h', 'a']], list('a')),
    ] as const;
    const wrapper = [
      'Declare',
      'r',
      "'unknown'",
      fn(['List', ['h', 'a']], 'a'),
    ] as const;
    const callR = ['r', ['List', -1, 2]] as const;
    expect(block(count, wholeWrapper, callR)).toBe('[2]');
    // An untyped parameter maps the call over the list.
    expect(
      block(
        ['Declare', 'h', "'unknown'", fn(['Add', 't', 1], 't')],
        wrapper,
        callR
      )
    ).toBe('[[0],[3]]');
    // A use with more than one operand is not a whole use.
    expect(
      block(
        ['Declare', 'h', "'unknown'", fn(['Max', 't', 0], 't')],
        wrapper,
        callR
      )
    ).toBe('[[0],[2]]');
  });

  test('a callee that the block assigns AFTER the caller is read', () => {
    // A call of a local function applies the value that the local holds when
    // the call runs, so the order of the two `Declare` statements does not
    // matter. The parameters are declared lists, so the list is taken whole.
    const ce = new ComputeEngine();
    const fn = (
      body: MathJsonExpression,
      p: MathJsonExpression
    ): MathJsonExpression => ['Function', body, p];
    const list = (p: string): MathJsonExpression => ['Typed', p, "'list'"];
    const count = [
      'Declare',
      'h',
      "'unknown'",
      fn(['Count', 't'], list('t')),
    ] as const;
    const caller = [
      'Declare',
      'q',
      "'unknown'",
      fn(['h', 'a'], list('a')),
    ] as const;
    const block = (...stmts: MathJsonExpression[]): string =>
      ce
        .box(['Block', ...stmts])
        .evaluate()
        .toString();
    expect(block(caller, count, ['q', ['List', 1, 2]])).toBe('2');
    // A chain of three functions, each assigned before its callee.
    expect(
      block(
        ['Declare', 'k', "'unknown'", fn(['q', 'b'], list('b'))],
        caller,
        count,
        ['k', ['List', 1, 2, 3]]
      )
    ).toBe('3');
    // `top` calls `left` and `right`, and `right` calls `left`.
    expect(
      block(
        [
          'Declare',
          'top',
          "'unknown'",
          fn(['List', ['left', 'a'], ['right', 'a']], list('a')),
        ],
        ['Declare', 'right', "'unknown'", fn(['left', 'b'], list('b'))],
        ['Declare', 'left', "'unknown'", fn(['base', 'c'], list('c'))],
        ['Declare', 'base', "'unknown'", fn(['Count', 't'], list('t'))],
        ['top', ['List', 1, 2, 3]]
      )
    ).toBe('[3,3]');
    // A callee that reads its parameter element-wise gives the same value.
    expect(
      block(
        caller,
        ['Declare', 'h', "'unknown'", fn(['Multiply', 2, 't'], 't')],
        ['q', ['List', 1, 2]]
      )
    ).toBe('[2,4]');
    // The block is the body of a function: each call runs it.
    ce.assign(
      'outer',
      ce.box(fn(['Block', caller, count, ['q', ['List', 1, 2, 'x']]], 'x'))
    );
    expect(ce.box(['outer', 5]).evaluate().toString()).toBe('3');
    expect(ce.box(['outer', 6]).evaluate().toString()).toBe('3');
  });

  test('a callee that has a scope effect gives the same value in either order', () => {
    // `q` calls a function with a `scope` effect. A local that a `Declare`
    // initializes is not held to the default-`!scope` ceiling
    // (`docs/EFFECTS-MODEL.md`, "Scope is opt-in"), so `q` takes the list
    // whole, with the two `Declare` in either order.
    const ce = new ComputeEngine();
    const caller = [
      'Declare',
      'q',
      "'unknown'",
      ['Function', ['h', 'a'], ['Typed', 'a', "'list'"]],
    ] as const;
    const callee = [
      'Declare',
      'h',
      "'unknown'",
      [
        'Function',
        ['Typed', ['Count', 't'], "'(unknown) scope -> unknown'"],
        ['Typed', 't', "'list'"],
      ],
    ] as const;
    const call = ['q', ['List', 1, 2]] as const;
    const qFirst = ce.box(['Block', caller, callee, call]).evaluate();
    const hFirst = ce.box(['Block', callee, caller, call]).evaluate();
    expect(qFirst.toString()).toBe('2');
    expect(qFirst.toString()).toBe(hFirst.toString());
  });

  test('a callee that the block assigns AFTER the caller is read by evaluateAsync()', async () => {
    const ce = new ComputeEngine();
    const value = await ce
      .box([
        'Block',
        [
          'Declare',
          'q',
          "'unknown'",
          ['Function', ['h', 'a'], ['Typed', 'a', "'list'"]],
        ],
        [
          'Declare',
          'h',
          "'unknown'",
          ['Function', ['Count', 't'], ['Typed', 't', "'list'"]],
        ],
        ['q', ['List', 1, 2]],
      ])
      .evaluateAsync();
    expect(value.toString()).toBe('2');
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
      '(xs: collection<number> | value, n: unknown) -> number'
    );
  });
});
