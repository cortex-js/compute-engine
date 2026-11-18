/**
 * Iteration-only operators over an operand typed as an abstract collection
 * (issue #385).
 *
 * A parameter typed `collection` (or `collection<integer>`, or a set) is not
 * an indexed collection, so the JavaScript lowering of `Max`/`Min` took the
 * scalar form and compiled `Max(w)` to `Math.max(w)`. That is `NaN` for an
 * array, returned with `success: true`, while `evaluate()` gives the maximum.
 * `Length`, `Count`, `Sum` and `Product` refused the same operand.
 *
 * These operators visit each element once, in any order: they need neither
 * positions nor order. So such an operand now compiles, whether its type was
 * declared or inferred from the uses. It is read through `_SYS.elts`, which
 * accepts an array, a JavaScript `Set` or a numeric typed array at run time
 * and throws for any other value. `Sum`, `Product`, `Max` and `Min` read a
 * single number as a collection of one element where the interpreter accepts
 * one (a type with a number arm). Over a `collection<any>`, an element can
 * be a number or a list, so these operators decline: the operand needs a
 * narrower annotation, such as `collection<real>`. `Sum` and `Product`
 * decline over a `collection<expression>` for the same reason. `Max` and
 * `Min` also throw for an element that is not a real number. Operators that
 * read positions or order (`At`, `Reverse`) still refuse a declared abstract
 * collection, and a dictionary is refused by all.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const P: unknown = ['Function', ['Greater', 'k', 1], 'k'];

/** `(w: <type>) => <body>` */
function lambda(ce: ComputeEngine, body: unknown, type: string) {
  return ce.box(['Function', body, ['Typed', 'w', `'${type}'`]] as any);
}

/** The compiled lambda, called with one argument. */
function compiled(ce: ComputeEngine, body: unknown, type: string) {
  const c = compile(lambda(ce, body, type), { fallback: false });
  expect(c.success).toBe(true);
  return (v: unknown): unknown => (c.run as (v: unknown) => unknown)(v);
}

// [label, body, value for the elements 3, 1, 2]
const BODIES: [string, unknown, unknown][] = [
  ['Max(w)', ['Max', 'w'], 3],
  ['Min(w)', ['Min', 'w'], 1],
  ['Max(w, 5)', ['Max', 'w', 5], 5],
  ['Min(w, 0)', ['Min', 'w', 0], 0],
  ['Range(1, Max(w))', ['Range', 1, ['Max', 'w']], [1, 2, 3]],
  ['Length(w)', ['Length', 'w'], 3],
  ['Count(w)', ['Count', 'w'], 3],
  ['Count(w, p)', ['Count', 'w', P], 2],
  ['Sum(w)', ['Sum', 'w'], 6],
  ['Product(w)', ['Product', 'w'], 6],
];

/** True for the body `Count(w, p)` over a parameter whose element type is
 * `expression`. Its predicate is a callback, and an element of type
 * `expression` can be a number or a list: the interpreter applies the
 * predicate to a number and maps it over a list. The shape of the element
 * is not settled, so the compilation declines with the code
 * `unsettled-shape` (rule R3 of
 * `docs/plans/2026-10-31-static-shape-compilation.md`). The same body over
 * `collection<integer>`, `set<integer>`, `collection<real>` or
 * `list<integer>` compiles. */
function callbackOverExpressions(label: string, type: string): boolean {
  return label === 'Count(w, p)' && type.endsWith('<expression>');
}

/** True for the body `Sum(w)` or `Product(w)` over a parameter whose element
 * type is `expression`. An element of type `expression` can be a number or
 * a list, and the interpreter adds two lists element by element. Compiled
 * code does not test the shape of an element at run time, so the
 * compilation declines with the code `unsettled-shape` (ROADMAP CE-805).
 * The same body over `collection<integer>`, `set<integer>`,
 * `collection<real>` or `list<integer>` compiles. */
function foldOverExpressions(label: string, type: string): boolean {
  return (
    (label === 'Sum(w)' || label === 'Product(w)') &&
    type.endsWith('<expression>')
  );
}

/** True when the body over a parameter of type `type` declines with the
 * code `unsettled-shape`: a callback or a fold over elements of type
 * `expression`. */
function declinesOverExpressions(label: string, type: string): boolean {
  return callbackOverExpressions(label, type) || foldOverExpressions(label, type);
}

/** Assert that the lambda declines with the code `unsettled-shape`, and
 * that its fallback gives the interpreter's value for the elements 3, 1,
 * 2. */
function expectUnsettledDecline(body: unknown, type: string, expected: unknown) {
  const c = compile(lambda(new ComputeEngine(), body, type));
  expect(c.success).toBe(false);
  expect(c.diagnostic?.code).toBe('unsettled-shape');
  expect(c.unsupported).toContain(`Typed(w, "${type}")`);
  expect((c.run as (v: unknown) => unknown)([3, 1, 2])).toEqual(expected);
}

describe('ITERATION-ONLY OPERATORS OVER AN ABSTRACT COLLECTION (issue #385)', () => {
  // An element typed `any` can be a number or a list, and the interpreter
  // adds two lists element by element. The compiled sum would have to test
  // the shape of each element at run time, so it declines.
  test.each(['collection', 'collection<any>'])(
    'Sum over a %s declines with the code unsettled-shape',
    (type) => expectUnsettledDecline(['Sum', 'w'], type, 6)
  );

  for (const type of [
    'collection<expression>',
    'collection<integer>',
    'set<integer>',
  ])
    for (const [label, body, expected] of BODIES) {
      if (declinesOverExpressions(label, type)) {
        test(`${label} with w: ${type} declines`, () =>
          expectUnsettledDecline(body, type, expected));
        continue;
      }

    }

  test('a number at a parameter DECLARED collection stops the run', () => {
    // The interpreter checks the declared type and answers
    // `incompatible-type`; the compiled code throws.
    for (const [label, body] of BODIES) {
      const ce = new ComputeEngine();
      if (!declinesOverExpressions(label, 'collection<expression>'))
        expect(() => compiled(ce, body, 'collection<expression>')(4)).toThrow(
          /the input w of type collection<expression>/
        );
      expect(
        ce
          .box([
            'Apply',
            ['Function', body, ['Typed', 'w', "'collection<expression>'"]],
            4,
          ])
          .evaluate()
          .toString()
      ).toContain('incompatible-type');
    }
  });

  test('a reducing parameter with no declared type declines', () => {
    // The type of `w` is inferred as `collection`: an element can be a
    // number or a list.
    const ce = new ComputeEngine();
    const expr = ce.box(['Function', ['Sum', 'w'], 'w']);
    const c = compile(expr);
    expect(c.success).toBe(false);
    expect(c.diagnostic?.code).toBe('outside-profile');
    const fn = c.run as unknown as (w: unknown) => unknown;
    expect(fn([3, 1, 2])).toBe(6);
    expect(ce.box(['Sum', ['List', 3, 1, 2]]).evaluate().re).toBe(6);
    expect(ce.box(['Sum', 4]).evaluate().re).toBe(4);
  });

  test('Sum and Product of elements typed expression decline', () => {
    // An element of type `expression` can be a number or a list: the
    // compilation declines, and the interpreter gives the value.
    for (const [op, value] of [
      ['Sum', '(4 + 6i)'],
      ['Product', '2i'],
    ] as const) {
      const ce = new ComputeEngine();
      const c = compile(lambda(ce, [op, 'w'], 'collection<expression>'));
      expect(c.success).toBe(false);
      expect(c.diagnostic?.code).toBe('unsettled-shape');
      const items =
        op === 'Sum'
          ? [
              ['Complex', 1, 2],
              ['Complex', 3, 4],
            ]
          : [['Complex', 0, 1], 2];
      expect(
        ce
          .box([
            'Apply',
            lambda(ce, [op, 'w'], 'collection<expression>').json,
            ['List', ...items],
          ] as any)
          .evaluate()
          .toString()
      ).toBe(value);
    }
  });

  test('Sum and Product of a broadcastable<complex> decline', () => {
    // An operand typed `broadcastable<complex>` is a complex number or a
    // list of them, and its elements are `complex | tensor<complex>`: a
    // number or a list. The shape of the elements is not settled, so the
    // fold declines with `unsettled-shape` (ROADMAP CE-805), and the
    // interpreter gives the value.
    for (const op of ['Sum', 'Product']) {
      const ce = new ComputeEngine();
      ce.declare('c', 'broadcastable<complex>');
      const expr = ce.box(['Add', [op, 'c'], 1]);
      const r = compile(expr);
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      ce.assign('c', ce.box(['List', 'ImaginaryUnit', 2]));
      expect(expr.evaluate().toString()).toBe(
        op === 'Sum' ? '(3 + i)' : '(1 + 2i)'
      );
    }
  });

  test('the interpreter gives the same values', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'list<integer>');
    ce.assign('x', ce.box(['List', 3, 1, 2] as any));
    for (const [label, body, expected] of BODIES) {
      const value = ce
        .box([
          'Apply',
          ['Function', body, ['Typed', 'w', "'collection<expression>'"]],
          'x',
        ] as any)
        .evaluate();
      const json = value.json;
      expect([
        label,
        Array.isArray(json) ? value.toString() : value.re,
      ]).toEqual([
        label,
        Array.isArray(expected) ? `[${expected.join(',')}]` : expected,
      ]);
    }
  });

  test('a dictionary operand still declines', () => {
    for (const [, body] of BODIES)
      expect(() =>
        compile(lambda(new ComputeEngine(), body, 'dictionary<integer>'), {
          fallback: false,
        })
      ).toThrow(/Could not compile/);
  });

  test('operators that read positions or order still decline', () => {
    for (const body of [
      ['At', 'w', 1],
      ['Reverse', 'w'],
    ])
      expect(() =>
        compile(lambda(new ComputeEngine(), body, 'collection<expression>'), {
          fallback: false,
        })
      ).toThrow(/the input w of type collection<expression>/);
  });
});

describe('MAX/MIN OF AN INFERRED COLLECTION PARAMETER', () => {
  // `Count(a, p)` narrows the parameter `a` to `collection<any>`: the type is
  // inferred from the use, not declared. Before, `Max(a)` compiled to
  // `Math.max(a)` = `NaN`.
  const CASES: [string, unknown, number][] = [
    ['Count(a, p) + Max(a)', ['Add', ['Count', 'a', P], ['Max', 'a']], 5],
    ['Count(a, p) + Min(a)', ['Add', ['Count', 'a', P], ['Min', 'a']], 3],
    ['Count(a, p) + Max(a, 7)', ['Add', ['Count', 'a', P], ['Max', 'a', 7]], 9],
  ];
  for (const [label, body, expected] of CASES)
    test(`h(a) := ${label} needs a numeric annotation`, () => {
      const ce = new ComputeEngine();
      ce.box(['Assign', 'h', ['Function', body, 'a']] as any).evaluate();
      expect(ce.box('h').type.toString()).toBe(
        '(a: collection<any>) -> number'
      );
      // An element of `collection<any>` can be a collection, which
      // `Max` and `Min` would read as a number.
      expect(() => compile(ce.box('h'), { fallback: false })).toThrow(
        /the input h of type/
      );
      expect(ce.box(['h', ['List', 3, 1, 2]] as any).evaluate().re).toBe(
        expected
      );
    });
});

describe('numeric aggregate inputs with a collection<any> alternative', () => {
  // An element of `collection<any>` can be a collection, which `Max` and
  // `Min` would read as a number: they decline.
  test.each(['Max', 'Min'])('%s declines', (op) => {
    const ce = new ComputeEngine();
    ce.declare('f', '(collection<any> | number) -> number');
    ce.assign('f', ce.box(['Function', [op, 'xs'], 'xs']));
    expect(() => compile(ce.box('f'), { fallback: false })).toThrow(
      /a function value that is not the program/
    );
  });

  // An element of `collection<any>` can be a number or a list, and the
  // interpreter adds two lists element by element. The compiled fold would
  // have to test the shape of each element at run time, so it declines.
  test.each([
    ['Sum', 14],
    ['Product', 54],
  ] as const)('%s declines', (op, list) => {
    const ce = new ComputeEngine();
    ce.declare('f', '(collection<any> | number) -> number');
    ce.assign('f', ce.box(['Function', [op, 'xs'], 'xs']));
    const c = compile(ce.box('f'));
    expect(c.success).toBe(false);
    expect(c.diagnostic?.code).toBe('outside-profile');
    expect(ce.box(['f', ['List', 3, 9, 2]]).evaluate().re).toBe(list);
    expect(ce.box(['f', 4]).evaluate().re).toBe(4);
  });
});

describe('MAX/MIN OF A DICTIONARY IN THE INTERPRETER', () => {
  // An entry is not a number. The walk compared the keys with the values:
  // `Max({"a" -> 3, "b" -> 5})` was `max(5, "a", "b")`. It now gives the
  // error that `Sum` gives for the same operand.
  const D = ['Dictionary', ['Tuple', "'a'", 3], ['Tuple', "'b'", 5]];
  const ERROR =
    'Error(ErrorCode("incompatible-type", "number", "tuple<string, integer>"), ("a", 3))';
  const ce = new ComputeEngine();
  test.each([
    ['Max(d)', ['Max', D]],
    ['Min(d)', ['Min', D]],
    ['Max(d, 7)', ['Max', D, 7]],
    ['Max(7, d)', ['Max', 7, D]],
    ['Max(NaN, d)', ['Max', 'NaN', D]],
    ['Max(d, NaN)', ['Max', D, 'NaN']],
    ['Max(Missing, d)', ['Max', 'Missing', D]],
    ['Max(0/0, d)', ['Max', ['Divide', 0, 0], D]],
    ['Supremum(d)', ['Supremum', D]],
    ['Sum(d)', ['Sum', D]],
  ])('%s is an incompatible-type error', (_, json) => {
    expect(
      ce
        .box(json as any)
        .evaluate()
        .toString()
    ).toBe(ERROR);
  });

  test('a dictionary ELEMENT is named whole, as in Sum, in any order', () => {
    // `Sum([1, d])` names the whole dictionary.
    const NESTED =
      'Error(ErrorCode("incompatible-type", "number", "record{a: integer, b: integer}"), {"a" -> 3, "b" -> 5})';
    for (const json of [
      ['Max', ['List', 1, D]],
      ['Max', ['List', 'NaN', D]],
      ['Max', ['List', D, 'NaN']],
      ['Sum', ['List', 1, D]],
    ]) {
      expect(
        ce
          .box(json as any)
          .evaluate()
          .toString()
      ).toBe(NESTED);
      expect(
        ce
          .box(json as any)
          .N()
          .toString()
      ).toBe(NESTED);
    }
    expect(
      ce
        .box(['Max', ['List', 1, ['Dictionary']]])
        .evaluate()
        .toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "number", "dictionary<never>"), {->})'
    );
  });

  test('Sum of ONE dictionary or boolean element is an error, as for two', () => {
    // A sum of one term answered the term itself.
    const ce = new ComputeEngine();
    ce.declare('b', 'boolean');
    expect(
      ce
        .box(['Sum', ['List', ['Dictionary', ['Tuple', "'a'", 3]]]])
        .evaluate()
        .toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "number", "record{a: integer}"), {"a" -> 3})'
    );
    expect(
      ce
        .box(['Sum', ['List', 'True']])
        .evaluate()
        .toString()
    ).toBe(
      ce
        .box(['Sum', ['List', 'True', 1]])
        .evaluate()
        .toString()
    );
    expect(
      ce
        .box(['Sum', ['List', 'b']])
        .evaluate()
        .toString()
    ).toBe('Error(ErrorCode("incompatible-type", "number", "boolean"), b)');
    // A dictionary of one entry: the entry `("a", 3)` is the one term.
    const ENTRY =
      'Error(ErrorCode("incompatible-type", "number", "tuple<string, integer>"), ("a", 3))';
    expect(
      ce
        .box(['Sum', ['Dictionary', ['Tuple', "'a'", 3]]])
        .evaluate()
        .toString()
    ).toBe(ENTRY);
    expect(
      ce
        .box(['Sum', ['List', ['Tuple', "'a'", 3]]])
        .evaluate()
        .toString()
    ).toBe(ENTRY);
    // A point is still a term: points add coordinate by coordinate.
    expect(
      ce
        .box(['Sum', ['List', ['Tuple', 1, 2]]])
        .evaluate()
        .toString()
    ).toBe('(1, 2)');
    // A row is still a term: rows add element by element.
    expect(
      ce
        .box(['Sum', ['List', ['List', 1, 2]]])
        .evaluate()
        .toString()
    ).toBe('[1,2]');
  });

  test('an empty dictionary contributes no value, as an empty list does', () => {
    expect(
      ce
        .box(['Max', ['Dictionary']])
        .evaluate()
        .toString()
    ).toBe('NaN');
    expect(
      ce
        .box(['Max', ['Dictionary'], 4])
        .evaluate()
        .toString()
    ).toBe('4');
  });

  test('a dictionary variable with no value stays symbolic', () => {
    const ce = new ComputeEngine();
    ce.declare('d', 'dictionary<integer>');
    expect(ce.box(['Max', 'd']).evaluate().toString()).toBe('max(d)');
    ce.assign('d', ce.box(D as any));
    expect(ce.box(['Max', 'd']).evaluate().toString()).toBe(ERROR);
  });
});

describe('MAX AND MIN OVER A TENSOR OF UNKNOWN RANK', () => {
  // A `tensor<integer>` may hold a list of numbers or a matrix. The
  // compiled reduce read each row of a matrix as a number, so `Max` of
  // `[[1, 2], [3, 4]]` was `NaN` where `evaluate()` gives 4. The operand is
  // refused as a matrix is, and the fallback runs the interpreter, which
  // agrees with `evaluate()` at every rank.
  const MATRIX = [
    [1, 2],
    [3, 4],
  ];
  test.each([
    ['Max', [3, 1, 2], 3, MATRIX, 4],
    ['Min', [3, 1, 2], 1, MATRIX, 1],
  ] as const)('%s(w) with w: tensor<integer>', (op, v1, r1, v2, r2) => {
    const ce = new ComputeEngine();
    const body = [op, 'w'];
    expect(() =>
      compile(lambda(ce, body, 'tensor<integer>'), { fallback: false })
    ).toThrow(/Could not compile/);
    expect(
      ce
        .box([
          lambda(ce, body, 'matrix<integer>'),
          ['List', ...v2.map((row) => ['List', ...row])],
        ] as any)
        .evaluate().re
    ).toBe(r2);
    const c = compile(lambda(ce, body, 'tensor<integer>'));
    expect(c.success).toBe(false);
    const run = c.run as (v: unknown) => unknown;
    expect(run(v1)).toBe(r1);
    expect(run(v2)).toBe(r2);
    const toList = (v: unknown): unknown =>
      Array.isArray(v) ? ['List', ...v.map(toList)] : v;
    const f = lambda(ce, body, 'tensor<integer>');
    expect(ce.box([f, toList(v1)] as any).evaluate().re).toBe(r1);
    expect(ce.box([f, toList(v2)] as any).evaluate().re).toBe(r2);
  });

  // The other statistics read each row of a matrix as a number (the
  // compiled `Mean` of `[[1, 2], [3, 5]]` was `null` and `Mode` was
  // `[1, 2]`, where the interpreter reports a type error), so a
  // `broadcastable<number>` operand is refused for them.
  test.each(['Mean', 'Mode'])('%s(w) with w: broadcastable<number>', (op) => {
    const ce = new ComputeEngine();
    expect(() =>
      compile(lambda(ce, [op, 'w'], 'broadcastable<number>'), {
        fallback: false,
      })
    ).toThrow(/Could not compile/);
  });
});
