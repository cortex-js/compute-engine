/**
 * The type of a call of a user function literal has two derivation routes:
 * the call expression (`BoxedFunction.type`), and the derivation from
 * operand descriptors (`deriveApplicationType`), which a type handler
 * reaches as `context.derive` and which types a call in the body of
 * another function. The two routes must give the same type.
 *
 * A call of a function literal with scalar parameters over a collection
 * maps the literal over the collection: with `f := x ↦ (-x, x)`,
 * `f([1, 2])` is `[(-1, 1), (-2, 2)]`. The expression route typed such a
 * call as a list of the results (`lambdaBroadcastType`,
 * `boxed-function.ts`), and the descriptor route typed the body with the
 * parameter typed as the whole collection, which gave the type of one
 * element of the value (`tuple<number, number>`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { BoxedType } from '../../src/common/type/boxed-type';
import { isSubtype } from '../../src/common/type/subtype';

/** The two routes for a call of `fn` with one operand of type `operand`:
 * the expression `fn(L)` with `L` declared `operand`, and the descriptor
 * route with a descriptor of that type. */
function routes(
  setup: (ce: ComputeEngine) => void,
  fn: string,
  operand: string
): { expression: string; descriptor: string } {
  const ce = new ComputeEngine();
  setup(ce);
  ce.declare('L', ce.type(operand).type);
  const expression = ce.box([fn, 'L']).type.toString();
  const t = deriveApplicationType(ce, fn, [
    describeType(ce.type(operand).type),
  ]);
  const descriptor =
    t === undefined
      ? 'undefined'
      : new BoxedType(t, ce._typeResolver).toString();
  return { expression, descriptor };
}

const PAIR = ['Function', ['Tuple', ['Negate', 'x'], 'x'], 'x'] as const;

describe('a call of a function literal over a collection operand', () => {
  // `f := x ↦ (-x, x)`, assigned to an undeclared name (an operator
  // definition) and to a name declared `function` (a value definition).
  for (const declared of [false, true]) {
    const route = declared ? 'declared function' : 'undeclared';
    const setup = (ce: ComputeEngine) => {
      if (declared) ce.declare('f', 'function');
      ce.assign('f', ce.box(PAIR as any));
    };
    const cases: [string, string][] = [
      // An element typed `unknown` can be a list, and the literal maps it at
      // its leaves too, so an element of the result can be a list.
      ['list<unknown>', 'list<list<any> | tuple<number, number>>'],
      ['list<integer>', 'list<tuple<integer, integer>>'],
      // The literal maps over the cells of a matrix, as over the elements
      // of a list of lists.
      ['matrix<integer^(2x2)>', 'list<list<tuple<integer, integer>>>'],
      ['list<list<integer>>', 'list<list<tuple<integer, integer>>>'],
      // An operand that may be a collection.
      ['broadcastable<number>', 'broadcastable<tuple<number, number>>'],
      // No lift: a scalar, and an operand of unknown type.
      ['number', 'tuple<number, number>'],
      ['unknown', 'tuple<number, number>'],
    ];
    for (const [operand, expected] of cases)
      test(`${route}: over ${operand}`, () => {
        const { expression, descriptor } = routes(setup, 'f', operand);
        expect(expression).toBe(expected);
        expect(descriptor).toBe(expression);
      });

    test(`${route}: the value over a list fits the derived type`, () => {
      const ce = new ComputeEngine();
      setup(ce);
      ce.declare('L', 'list<integer>');
      ce.assign('L', ce.box(['List', 1, 2, 3]));
      const value = ce.box(['f', 'L']).evaluate();
      expect(value.toString()).toBe('[(-1, 1),(-2, 2),(-3, 3)]');
      const t = deriveApplicationType(ce, 'f', [
        describeType(ce.type('list<integer>').type),
      ]);
      expect(isSubtype(value.type.type, t!)).toBe(true);
    });
  }

  test('a scalar result over a list and over a matrix', () => {
    const setup = (ce: ComputeEngine) =>
      ce.assign('g', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    for (const [operand, expected] of [
      ['list<integer>', 'list<number>'],
      ['matrix<integer^(2x2)>', 'matrix<2x2>'],
      ['broadcastable<number>', 'broadcastable<number>'],
      ['number', 'number'],
    ]) {
      const { expression, descriptor } = routes(setup, 'g', operand);
      expect(expression).toBe(expected);
      expect(descriptor).toBe(expression);
    }
  });

  test('a parameter that accepts a list whole: no lift', () => {
    // A collection-typed parameter binds the list whole, on both routes.
    const declaredSignature = (ce: ComputeEngine) => {
      ce.declare('p', '(list) -> integer');
      ce.assign('p', ce.box(['Function', ['Length', 'x'], 'x']));
    };
    const typedParameter = (ce: ComputeEngine) =>
      ce.assign(
        'p',
        ce.box([
          'Function',
          ['Length', 'x'],
          ['Typed', 'x', { str: 'list<number>' }],
        ])
      );
    for (const setup of [declaredSignature, typedParameter])
      for (const operand of [
        'list<unknown>',
        'list<integer>',
        'list<list<integer>>',
      ]) {
        const { expression, descriptor } = routes(setup, 'p', operand);
        expect(expression).not.toMatch(/^list/);
        expect(descriptor).toBe(expression);
      }
  });

  test('a user function with a declared signature', () => {
    // The declared signature gives the result for one element, and the
    // call maps over a list operand on both routes. A declared function
    // with no value is typed the same way.
    const withValue = (ce: ComputeEngine) => {
      ce.declare('q', '(real) -> real');
      ce.assign('q', ce.box(['Function', ['Add', 'x', 1], 'x']));
    };
    const withoutValue = (ce: ComputeEngine) =>
      ce.declare('q', '(real) -> real');
    for (const setup of [withValue, withoutValue])
      for (const [operand, expected] of [
        ['list<integer>', 'list<real>'],
        ['matrix<integer^(2x2)>', 'matrix<real^(2x2)>'],
        ['number', 'real'],
        // A tuple at a declared scalar parameter maps over its components.
        ['tuple<integer, integer>', 'tuple<real, real>'],
      ]) {
        const { expression, descriptor } = routes(setup, 'q', operand);
        expect(expression).toBe(expected);
        expect(descriptor).toBe(expression);
      }
  });

  test('a generic function literal', () => {
    const setup = (ce: ComputeEngine) => {
      ce.declare('id', '(T) -> T where T');
      ce.assign('id', ce.box(['Function', 'x', 'x']));
    };
    for (const [operand, expected] of [
      ['list<integer>', 'list<integer>'],
      ['matrix<integer^(2x2)>', 'matrix<integer^(2x2)>'],
      ['number', 'number'],
    ]) {
      const { expression, descriptor } = routes(setup, 'id', operand);
      expect(expression).toBe(expected);
      expect(descriptor).toBe(expression);
    }
  });

  test('a bounded type variable is not bound to a leaf that breaks the bound', () => {
    // `T: number` cannot be `string`: each element of `g(L)` for a list of
    // strings is an `incompatible-type` error, and the result is read with
    // `T` at its bound. Before, both routes read `T` as `string`.
    const setup = (ce: ComputeEngine) => {
      ce.declare('g', '(T) -> T where T: number');
      ce.assign('g', ce.box(['Function', ['Multiply', 'x', 2], 'x']));
    };
    for (const [operand, expected] of [
      ['list<string>', 'list<number>'],
      ['list<list<string>>', 'list<list<number>>'],
      ['list<integer>', 'list<integer>'],
      // Each option of a union operand is read the same way. Before, the
      // option `list<string>` gave `list<string>` on both routes.
      ['number | list<string>', 'list<number> | number'],
    ]) {
      const { expression, descriptor } = routes(setup, 'g', operand);
      expect(expression).toBe(expected);
      expect(descriptor).toBe(expression);
    }
  });

  test('the values over a list and over a matrix fit the derived type', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    for (const [operand, value] of [
      ['list<integer>', ['List', 1, 2]],
      ['matrix<integer^(2x2)>', ['List', ['List', 1, 2], ['List', 3, 4]]],
    ] as const) {
      const t = deriveApplicationType(ce, 'g', [
        describeType(ce.type(operand).type),
      ]);
      const result = ce.box(['g', value as any]).evaluate();
      expect(isSubtype(result.type.type, t!)).toBe(true);
    }
  });

  test('a generic operator definition with a tuple at a scalar parameter', () => {
    // `f(x, y) = x` with the signature `(T, real) -> T where T`, held by an
    // operator definition. The pair maps over the second parameter, and the
    // result of each component is `T` solved against the first operand,
    // `integer`. Before, the descriptor route read the signature result
    // without solving it, and gave `tuple<unknown, unknown>`.
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: '(T, real) -> T where T',
      evaluate: ce.box(['Function', 'x', 'x', 'y']),
    } as any);
    ce.declare('P', 'tuple<integer, integer>');
    const expression = ce.box(['f', 3, 'P']).type.toString();
    const t = deriveApplicationType(ce, 'f', [
      describeType('integer'),
      describeType(ce.type('tuple<integer, integer>').type),
    ]);
    expect(expression).toBe('tuple<integer, integer>');
    expect(new BoxedType(t!, ce._typeResolver).toString()).toBe(expression);
  });

  test('a partial application is the function of the remaining parameters', () => {
    const setup = (ce: ComputeEngine) =>
      ce.assign('h', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
    for (const operand of ['list<integer>', 'number']) {
      const { expression, descriptor } = routes(setup, 'h', operand);
      expect(expression).toBe('(unknown) -> number');
      expect(descriptor).toBe(expression);
    }
  });

  test('a call in the body of another function', () => {
    // The signature of `k` is inferred from its body `f(a)`, through the
    // descriptor route, and a call of `k` over a list maps `k` over it.
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(PAIR as any));
    ce.assign('k', ce.box(['Function', ['f', 'a'], 'a']));
    ce.declare('L', 'list<integer>');
    ce.assign('L', ce.box(['List', 1, 2]));
    const call = ce.box(['k', 'L']);
    expect(call.type.toString()).toBe('list<tuple<integer, integer>>');
    const value = call.evaluate();
    expect(value.toString()).toBe('[(-1, 1),(-2, 2)]');
    expect(isSubtype(value.type.type, call.type.type)).toBe(true);
  });
});
