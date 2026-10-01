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
 * one (a type with a number arm, or a type inferred from the uses). `Max` and
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

describe('ITERATION-ONLY OPERATORS OVER AN ABSTRACT COLLECTION (issue #385)', () => {
  test('the example of the issue', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'list<integer>');
    const expr = ce.box([
      'Apply',
      ['Function', ['Max', 'w'], ['Typed', 'w', "'collection'"]],
      'x',
    ] as any);
    expect(compile(expr, { fallback: false }).run!({ x: [3, 1, 2] })).toBe(3);
  });

  for (const type of ['collection', 'collection<integer>', 'set<integer>'])
    for (const [label, body, expected] of BODIES) {
      test(`${label} with w: ${type}, over an array and a set`, () => {
        const fn = compiled(new ComputeEngine(), body, type);
        expect(fn([3, 1, 2])).toEqual(expected);
        expect(fn(new Set([3, 1, 2]))).toEqual(expected);
      });

      test(`${label} with w: ${type} stops on a value that is not a collection`, () => {
        const fn = compiled(new ComputeEngine(), body, type);
        expect(() => fn('abc')).toThrow(/not a list or a set at run time/);
        expect(() => fn({ a: 1 })).toThrow(/not a list or a set at run time/);
      });
    }

  test('a number at a parameter DECLARED collection stops the run', () => {
    // The interpreter checks the declared type and answers
    // `incompatible-type`; the compiled code throws.
    for (const [, body] of BODIES) {
      const ce = new ComputeEngine();
      expect(() => compiled(ce, body, 'collection')(4)).toThrow(
        /not a list or a set at run time/
      );
      expect(
        ce
          .box(['Apply', ['Function', body, ['Typed', 'w', "'collection'"]], 4])
          .evaluate()
          .toString()
      ).toContain('incompatible-type');
    }
  });

  test('a number at a parameter INFERRED collection is one element', () => {
    // `k(L) := Sum(L)` infers `L: collection`, and the interpreter answers
    // `k(4) = 4`: its `Sum` and `Product` accept a single number.
    for (const op of ['Sum', 'Product']) {
      const ce = new ComputeEngine();
      ce.assign('k', ce.box(['Function', [op, 'L'], 'L']));
      expect(ce.box('k').type.toString()).toMatch(/^\(collection\) ->/);
      const fn = compile(ce.box('k'), { fallback: false }).run!({}) as (
        a: unknown
      ) => unknown;
      expect(fn(4)).toBe(4);
      expect(ce.box(['k', 4]).evaluate().re).toBe(4);
      expect(fn([3, 1, 2])).toBe(6);
    }
  });

  test('Sum and Product of complex elements', () => {
    // Before, the element-wise fold added a complex element `{re, im}` with
    // `+`, and the sum became a string.
    const fn = compiled(new ComputeEngine(), ['Sum', 'w'], 'collection');
    expect(
      fn([
        { re: 1, im: 2 },
        { re: 3, im: 4 },
      ])
    ).toEqual({ re: 4, im: 6 });
    const prod = compiled(new ComputeEngine(), ['Product', 'w'], 'collection');
    expect(prod([{ re: 0, im: 1 }, 2])).toEqual({ re: 0, im: 2 });
  });

  test('Max and Min stop on an element that is not a real number', () => {
    // A complex value has no order: the interpreter keeps `Max` symbolic.
    // `Math.max` would read the object as `NaN`.
    for (const op of ['Max', 'Min']) {
      const fn = compiled(new ComputeEngine(), [op, 'w'], 'collection');
      expect(() =>
        fn([
          { re: 1, im: 2 },
          { re: 3, im: 0 },
        ])
      ).toThrow(/not a real number at run time/);
      expect(() => fn(new Set(['a', 'b']))).toThrow(
        /not a real number at run time/
      );
    }
  });

  test('a numeric typed array is read as a list', () => {
    for (const [, body, expected] of BODIES) {
      const fn = compiled(new ComputeEngine(), body, 'collection<real>');
      expect(fn(new Float64Array([3, 1, 2]))).toEqual(expected);
    }
  });

  test('the guarded fold over a function result adds complex elements', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    ce.declare('t', 'number');
    const r = compile(ce.box(['Sum', ['h', 't']]), {
      fallback: false,
      functions: {
        h: () => [
          { re: 1, im: 2 },
          { re: 3, im: 4 },
        ],
      },
    } as any);
    expect(r.run!({ t: 1 })).toEqual({ re: 4, im: 6 });
  });

  test('the interpreter gives the same values', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'list<integer>');
    ce.assign('x', ce.box(['List', 3, 1, 2] as any));
    for (const [label, body, expected] of BODIES) {
      const value = ce
        .box([
          'Apply',
          ['Function', body, ['Typed', 'w', "'collection'"]],
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

  test('an indexed parameter type compiles as before', () => {
    const ce = new ComputeEngine();
    for (const type of ['list<integer>', 'indexed_collection', 'list'])
      for (const [, body, expected] of BODIES)
        expect(compiled(ce, body, type)([3, 1, 2])).toEqual(expected);
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
        compile(lambda(new ComputeEngine(), body, 'collection'), {
          fallback: false,
        })
      ).toThrow(/is not an indexed collection/);
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
    test(`h(a) := ${label} matches the interpreter`, () => {
      const ce = new ComputeEngine();
      ce.box(['Assign', 'h', ['Function', body, 'a']] as any).evaluate();
      expect(ce.box('h').type.toString()).toBe('(collection<any>) -> number');
      const fn = compile(ce.box('h'), { fallback: false }).run!({}) as (
        a: unknown
      ) => unknown;
      expect(fn([3, 1, 2])).toBe(expected);
      expect(fn(new Set([3, 1, 2]))).toBe(expected);
      expect(ce.box(['h', ['List', 3, 1, 2]] as any).evaluate().re).toBe(
        expected
      );
      expect(() => fn('abc')).toThrow(/not a list or a set at run time/);
    });
});

describe('A PARAMETER DECLARED `collection<any> | number`', () => {
  // The declared type admits a list, a set, or a single number, and the
  // interpreter reads a single number as itself. Before, `Max(xs)` compiled
  // to `Math.max(xs)`, which is `NaN` for a list.
  for (const [op, list, one] of [
    ['Max', 9, 4],
    ['Min', 2, 4],
    ['Sum', 14, 4],
    ['Product', 54, 4],
  ] as const)
    test(`${op}(xs) matches the interpreter for a list, a set and a number`, () => {
      const ce = new ComputeEngine();
      ce.declare('f', '(collection<any> | number) -> number');
      ce.assign('f', ce.box(['Function', [op, 'xs'], 'xs']));
      ce.declare('v', 'list<integer>');
      const r = compile(ce.box(['f', 'v']), {
        fallback: false,
        constantFold: false,
      } as any);
      expect(r.success).toBe(true);
      expect(r.run!({ v: [3, 9, 2] })).toBe(list);
      expect(ce.box(['f', ['List', 3, 9, 2]]).evaluate().re).toBe(list);
      expect(ce.box(['f', 4]).evaluate().re).toBe(one);
      const fn = compile(ce.box('f'), { fallback: false }).run!({}) as (
        a: unknown
      ) => unknown;
      expect(fn(4)).toBe(one);
      expect(fn(new Set([3, 9, 2]))).toBe(list);
      expect(() => fn('abc')).toThrow(/not a list or a set at run time/);
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
