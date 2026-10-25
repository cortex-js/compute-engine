import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isSubtype } from '../../src/common/type/subtype';
import type { Type } from '../../src/common/type/types';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';

/**
 * A call of a user function whose parameter type was INFERRED from index
 * reads: `d(a) := a[1] + a[2]` types `a` as `tuple<number, number>`. The
 * engine does not check an argument against an inferred signature, so a
 * list binds whole and the body reads it by index.
 *
 * Before the fix, the type derivation of a function literal (the route that
 * types a call from the types of its operands) refused a list at such a
 * parameter, so `x ↦ d([x, x])` was typed `(unknown) -> error`, although
 * its body is typed `number` and its calls evaluate. A call with a list
 * whose elements are not numbers (`d([[1, 2], [3, 4]])`, value `[4, 6]`)
 * was typed `number`. The interval target also declined a call whose
 * argument is a number or a list of numbers, with a message that read the
 * inferred parameter as a declared one.
 */

function valueFits(value: { type: { type: Type } }, staticType: Type): boolean {
  return isSubtype(value.type.type, staticType);
}

function resultOf(t: Type): Type {
  if (typeof t !== 'object' || t.kind !== 'signature')
    throw new Error('not a signature');
  return t.result;
}

describe('A call at a parameter whose point type was inferred', () => {
  test('a function literal that passes a list literal', () => {
    const ce = new ComputeEngine();
    ce.parse('d(a) := a[1] + a[2]').evaluate();
    expect(ce.box('d').type.toString()).toBe(
      '(a: tuple<number, number>) -> number'
    );
    const f = ce.parse('x \\mapsto d([x, x])');
    expect(f.type.toString()).toBe('(x: unknown) -> number');
    const value = ce.box(['Apply', f, 3]).evaluate();
    expect(value.json).toBe(6);
    expect(valueFits(value, resultOf(f.type.type))).toBe(true);
  });

  test('a named function with two list arguments (Tycho item 323)', () => {
    const ce = new ComputeEngine();
    ce.parse('d(a, b) := a[1] b[1] + a[2] b[2]').evaluate();
    ce.parse('P(x, y) := d([x, y], [x, y])').evaluate();
    expect(ce.box('P').type.toString()).toBe(
      '(x: unknown, y: unknown) -> number'
    );
    const value = ce.parse('P(1, 2)').evaluate();
    expect(value.json).toBe(5);
    expect(valueFits(value, resultOf(ce.box('P').type.type))).toBe(true);
  });

  test('a list whose elements are not numbers is typed from the body', () => {
    const ce = new ComputeEngine();
    ce.parse('d(a) := a[1] + a[2]').evaluate();
    const call = ce.box(['d', ['List', ['List', 1, 2], ['List', 3, 4]]]);
    const value = call.evaluate();
    expect(value.toString()).toBe('[4,6]');
    expect(call.type.toString()).not.toBe('number');
    expect(valueFits(value, call.type.type)).toBe(true);

    const f = ce.parse('x \\mapsto d([[x, x], [x, x]])');
    const applied = ce.box(['Apply', f, 1]).evaluate();
    expect(applied.toString()).toBe('[2,2]');
    expect(valueFits(applied, resultOf(f.type.type))).toBe(true);
  });

  test('a list of numbers keeps the signature result', () => {
    const ce = new ComputeEngine();
    ce.parse('d(a) := a[1] + a[2]').evaluate();
    ce.declare('M', 'list<number>');
    expect(ce.parse('d(M)').type.toString()).toBe('number');
    const call = ce.box(['d', ['List', 1, 2]]);
    expect(call.type.toString()).toBe('number');
    expect(call.evaluate().json).toBe(3);
  });

  test('a declared point parameter still refuses a list', () => {
    const ce = new ComputeEngine();
    ce.declare('k', '(tuple<number, number>) -> number');
    ce.parse('k(a) := a[1] + a[2]').evaluate();
    expect(ce.box(['k', ['List', 1, 2]]).type.toString()).toBe('error');
  });

  test('the interval target compiles a number-or-list argument', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.parse('d(a, b) := a[1] b[1] + a[2] b[2]').evaluate();
    const which = (a: unknown, b: unknown) =>
      ce.box(['Which', ['Greater', 'x', 0], a, 'True', b] as never);
    ce.assign(
      'S',
      ce.box(['Function', which(0, ['List', 'x', ['Multiply', 2, 'x']]), 'x'])
    );
    const ok = compile(ce.box(['d', ['S', 'x'], ['List', 1, 1]]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(ok.success).toBe(true);

    // A matrix arm is not a list of numbers: the call still declines, and
    // the message says that the parameter type was inferred.
    ce.assign(
      'T',
      ce.box([
        'Function',
        which(0, ['List', ['List', 'x', 1], ['List', 1, 'x']]),
        'x',
      ])
    );
    const no = compile(ce.box(['d', ['T', 'x'], ['List', 1, 1]]), {
      to: 'interval-js',
      fallback: false,
    }) as { success: boolean; error?: string };
    expect(no.success).toBe(false);
    expect(no.error).toMatch(/at a parameter inferred as the point/);
  });
});

describe('An argument at an inferred point parameter that may hold lists', () => {
  // Each case evaluates the call and checks that the value is in the static
  // type. A list that is not a list of points binds whole, and the body
  // computes with it; a list of points maps the call over the points.
  function check(ce: ComputeEngine, expr: unknown, value: string) {
    const call = ce.box(expr as never);
    const v = call.evaluate();
    expect(v.toString()).toBe(value);
    expect(valueFits(v, call.type.type)).toBe(true);
    // The same call in the body of a function literal (the derivation from
    // the operand types).
    const f = ce.box(['Function', expr, 'y'] as never);
    const applied = ce.box(['Apply', f, 1]).evaluate();
    expect(applied.toString()).toBe(value);
    expect(valueFits(applied, resultOf(f.type.type))).toBe(true);
  }

  test('a ragged list: its elements may be numbers or lists', () => {
    const ce = new ComputeEngine();
    ce.parse('d(a) := a[1] + a[2]').evaluate();
    ce.declare('L', 'list<number | list<number>>');
    ce.assign('L', ce.box(['List', ['List', 1, 2], 3]));
    check(ce, ['d', 'L'], '[4,5]');
    // A list of numbers in the same symbol is read as a point.
    ce.assign('L', ce.box(['List', 1, 3]));
    check(ce, ['d', 'L'], '4');
  });

  test('a tensor and a list<any>', () => {
    const ce = new ComputeEngine();
    ce.parse('d(a) := a[1] + a[2]').evaluate();
    ce.declare('T', 'tensor<integer>');
    ce.assign('T', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    check(ce, ['d', 'T'], '[4,6]');
    ce.declare('A', 'list<any>');
    ce.assign('A', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    check(ce, ['d', 'A'], '[4,6]');
    // The value of `A` is a list of points: the call maps over them.
    ce.assign('A', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    check(ce, ['d', 'A'], '[3,7]');
  });

  test('a list of points maps the call', () => {
    const ce = new ComputeEngine();
    ce.parse('d(a) := a[1] + a[2]').evaluate();
    ce.declare('P', 'list<tuple<number, number>>');
    ce.assign('P', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    check(ce, ['d', 'P'], '[3,7]');
    expect(ce.box(['d', 'P']).type.toString()).toBe('list<number>');
    // Points whose coordinates are of unknown type, in a function literal.
    for (const [f, value] of [
      [ce.parse('y \\mapsto d([(y, y), (y, 2y)])'), '[2,3]'],
      [
        ce.box([
          'Function',
          ['d', ['List', ['Tuple', 'y', 'y'], ['Tuple', 'y', 'y']]],
          'y',
        ]),
        '[2,2]',
      ],
    ] as const) {
      const applied = ce.box(['Apply', f, 1]).evaluate();
      expect(applied.toString()).toBe(value);
      expect(valueFits(applied, resultOf(f.type.type))).toBe(true);
    }
    // A call in the body of a named function.
    ce.parse('Q(x) := d(P) + x').evaluate();
    check(ce, ['Q', 1], '[4,8]');
  });

  test('another argument that may make the call map', () => {
    const ce = new ComputeEngine();
    ce.parse('h(a, t) := a[1] + a[2] + t').evaluate();
    ce.declare('L', 'list<number | list<number>>');
    ce.assign('L', ce.box(['List', ['List', 1, 2], 3]));
    check(ce, ['h', 'L', 10], '[14,15]');
    // `t` is of unknown type: a list there maps the call.
    const f = ce.box(['Function', ['h', 'L', 'y'], 'y']);
    for (const [arg, value] of [
      [1, '[5,6]'],
      [['List', 1, 2], '[[5,6],[6,7]]'],
    ] as const) {
      const applied = ce.box(['Apply', f, arg as never]).evaluate();
      expect(applied.toString()).toBe(value);
      expect(valueFits(applied, resultOf(f.type.type))).toBe(true);
    }
  });

  test('an operand that cannot be a collection is typed from the body', () => {
    // The inferred signature does not prove that the call fails: the type
    // is derived from the body with the operand bound to the parameter.
    // The body reads `3[1]`, which the derivation types `unknown`, so the
    // type is `any`. Before, both routes typed the call `error` from the
    // signature alone.
    const ce = new ComputeEngine();
    ce.parse('d(a) := a[1] + a[2]').evaluate();
    for (const arg of ['True', 3] as const) {
      const value = ce.box(['d', arg]).evaluate();
      const derived = deriveApplicationType(ce, 'd', [
        describeType(ce.box(arg).type.type),
      ]);
      expect(derived).toBe('any');
      expect(isSubtype(value.type.type, derived!)).toBe(true);
      expect(ce.box(['d', arg]).type.toString()).toBe('any');
      const f = ce.box(['Function', ['d', arg], 'y']);
      expect(f.type.toString()).toBe('(y: unknown) -> any');
      const applied = ce.box(['Apply', f, 1]).evaluate();
      expect(valueFits(applied, resultOf(f.type.type))).toBe(true);
    }
  });

  test('NaN and an absent value are typed from the body', () => {
    // An index read of `NaN` or of `Missing` gives `NaN`. The body
    // derivation gives no type for it, so the call is typed `any`.
    const ce = new ComputeEngine();
    ce.parse('d(a) := a[1] + a[2]').evaluate();
    for (const arg of ['NaN', 'Missing'] as const) {
      const call = ce.box(['d', arg]);
      const value = call.evaluate();
      expect(value.toString()).toBe('NaN');
      expect(call.type.toString()).toBe('any');
      expect(valueFits(value, call.type.type)).toBe(true);
      const derived = deriveApplicationType(ce, 'd', [
        describeType(ce.box(arg).type.type),
      ]);
      expect(derived).toBe('any');
      expect(isSubtype(value.type.type, derived!)).toBe(true);
    }
  });

  test('a parameter that is not a point is not refused', () => {
    // `f(x) := x + 1` infers `(unknown) -> number`: the call keeps the
    // signature result for any operand.
    const ce = new ComputeEngine();
    ce.parse('f(x) := x + 1').evaluate();
    expect(ce.box('f').type.toString()).toBe('(x: unknown) -> number');
    for (const arg of [3, 'True', { str: 'a' }] as const)
      expect(ce.box(['f', arg as never]).type.toString()).toBe('number');
  });

  test('a list of lists bound whole while another argument maps', () => {
    // `h(M, [10, 20])` maps over `[10, 20]` and binds the matrix whole in
    // each call, so each element of the value is a list. Before, the call
    // was typed `list<number>`.
    const ce = new ComputeEngine();
    ce.parse('h(a, t) := a[1] + a[2] + t').evaluate();
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    check(ce, ['h', m, ['List', 10, 20]], '[[14,16],[24,26]]');
    expect(ce.box(['h', m, ['List', 10, 20]]).type.toString()).not.toBe(
      'list<number>'
    );
    // A list of numbers at the point parameter is read as a point.
    check(ce, ['h', ['List', 1, 2], ['List', 10, 20]], '[13,23]');
    expect(
      ce.box(['h', ['List', 1, 2], ['List', 10, 20]]).type.toString()
    ).toBe('list<number>');
    // A list of points at the point parameter maps the call.
    check(ce, ['h', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], 10], '[13,17]');
  });

  test('a function held by a symbol declared `function`', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign('h', ce.parse('(a, t) \\mapsto a[1] + a[2] + t'));
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    check(ce, ['h', m, ['List', 10, 20]], '[[14,16],[24,26]]');
  });

  test('a function held by a symbol declared `function`: both routes', () => {
    // The signature of the literal, `(tuple<number, number>) -> number`,
    // was inferred from the index reads, so the rules of an inferred
    // signature apply: `d(3)` and `d(True)` are typed from the body (`any`,
    // the body gives no type), and `d(M)` (a matrix) is a list.
    const ce = new ComputeEngine();
    ce.declare('d', 'function');
    ce.assign('d', ce.parse('(a) \\mapsto a[1] + a[2]'));
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    for (const [arg, expected] of [
      [3, 'any'],
      ['True', 'any'],
      ['NaN', 'any'],
      ['Missing', 'any'],
      [['List', 1, 2], 'number'],
      [m, 'vector<integer^2>'],
    ] as const) {
      const call = ce.box(['d', arg as never]);
      const value = call.evaluate();
      expect(call.type.toString()).toBe(expected);
      expect(valueFits(value, call.type.type)).toBe(true);
      const derived = deriveApplicationType(ce, 'd', [
        describeType(ce.box(arg as never).type.type),
      ]);
      expect(ce.type(derived!).toString()).toBe(expected);
      expect(isSubtype(value.type.type, derived!)).toBe(true);
    }
  });

  test('a function held by a symbol declared with a signature', () => {
    // A declared signature is a contract: the boxed call of an operand
    // that does not fit it, a list included, is refused.
    const ce = new ComputeEngine();
    ce.declare('k', '(tuple<number, number>) -> number');
    ce.assign('k', ce.parse('(a) \\mapsto a[1] + a[2]'));
    for (const arg of [3, 'True', ['List', 1, 2]] as const)
      expect(ce.box(['k', arg as never]).type.toString()).toBe('error');
  });
});

describe('An inferred signature is not a contract', () => {
  // Each case is checked on the boxed route (`ce.box([...]).type`) and on
  // the derived route (`deriveApplicationType`, the route that types a call
  // in the body of a function from the types of its operands). The static
  // type of each route must hold the value, and the two routes must give
  // the same type. Each case runs with the function held by an operator
  // definition (`d(a) := …`) and by a symbol declared bare `function`.
  type Binding = 'operator' | 'value';
  function define(ce: ComputeEngine, how: Binding, name: string, f: unknown) {
    if (how === 'operator') ce.assign(name, ce.box(f as never));
    else {
      ce.declare(name, 'function');
      ce.assign(name, ce.box(f as never));
    }
  }
  function routes(ce: ComputeEngine, head: string, args: unknown[]) {
    const call = ce.box([head, ...args] as never);
    const value = call.evaluate();
    const derived = deriveApplicationType(
      ce,
      head,
      args.map((a) => describeType(ce.box(a as never).type.type))
    );
    expect(derived).toBeDefined();
    expect(isSubtype(value.type.type, call.type.type)).toBe(true);
    expect(isSubtype(value.type.type, derived!)).toBe(true);
    expect(ce.type(derived!).toString()).toBe(call.type.toString());
    return { value: value.toString(), type: call.type.toString() };
  }
  const D = ['Function', ['Add', ['At', 'a', 1], ['At', 'a', 2]], 'a'];
  const H = [
    'Function',
    ['Add', ['At', 'a', 1], ['At', 'a', 2], 't'],
    'a',
    't',
  ];
  const M = ['List', ['List', 1, 2], ['List', 3, 4]];
  const P = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];

  for (const how of ['operator', 'value'] as const) {
    describe(`held by ${how === 'operator' ? 'an operator' : 'a value'} definition`, () => {
      test('the signature types a point and a list of numbers', () => {
        const ce = new ComputeEngine();
        define(ce, how, 'd', D);
        expect(routes(ce, 'd', [['List', 1, 2]])).toEqual({
          value: '3',
          type: 'number',
        });
        expect(routes(ce, 'd', [['Tuple', 1, 2]]).type).toBe('number');
      });

      test('a list of points maps the call', () => {
        const ce = new ComputeEngine();
        define(ce, how, 'd', D);
        // Before, the derived route typed the call `number`.
        expect(routes(ce, 'd', [P])).toEqual({
          value: '[3,7]',
          type: 'list<number>',
        });
      });

      test('every other argument is typed from the body', () => {
        const ce = new ComputeEngine();
        define(ce, how, 'd', D);
        expect(routes(ce, 'd', [M])).toEqual({
          value: '[4,6]',
          type: 'vector<integer^2>',
        });
        // The body gives no type for `3[1]`, `True[1]`, `NaN[1]`,
        // `Missing[1]`: the call is typed `any`, not `error` (before, `3`
        // and `True` were refused from the signature alone).
        for (const arg of [3, 'True', 'NaN', 'Missing'])
          expect(routes(ce, 'd', [arg]).type).toBe('any');
        expect(routes(ce, 'd', ['NaN']).value).toBe('NaN');
        expect(routes(ce, 'd', ['Missing']).value).toBe('NaN');
        // The body reads `"ab"[1]`, a character, and adds characters.
        expect(routes(ce, 'd', [{ str: 'ab' }]).type).toBe('error');
      });

      test('a call that the signature would refuse evaluates', () => {
        // Before, both calls were typed `error`, and their values are `42`
        // and `"A"`.
        const ce = new ComputeEngine();
        define(ce, how, 'f', [
          'Function',
          ['If', 'b', ['Add', ['At', 'a', 1], ['At', 'a', 2]], 42],
          'a',
          'b',
        ]);
        expect(routes(ce, 'f', [3, 'False'])).toEqual({
          value: '42',
          type: 'integer',
        });
        define(ce, how, 'u', [
          'Function',
          ['ToUpperCase', ['At', 'a', 1]],
          'a',
        ]);
        expect(routes(ce, 'u', [{ str: 'ab' }])).toEqual({
          value: '"A"',
          type: 'string',
        });
      });

      test('an argument bound whole while another argument maps', () => {
        const ce = new ComputeEngine();
        define(ce, how, 'h', H);
        // Before, the derived route typed the call `number`.
        expect(routes(ce, 'h', [M, ['List', 10, 20]])).toEqual({
          value: '[[14,16],[24,26]]',
          type: 'list<vector<integer^2>>',
        });
        // A function whose body makes such a call. Before, `q` was typed
        // `(unknown) -> number`, and `q(5)` was typed `number`.
        define(ce, how, 'q', ['Function', ['h', M, ['List', 'y', 'y']], 'y']);
        const call = ce.box(['q', 5]);
        const value = call.evaluate();
        expect(value.toString()).toBe('[[9,11],[9,11]]');
        expect(isSubtype(value.type.type, call.type.type)).toBe(true);
        expect(call.type.toString()).not.toBe('number');
        const literal = ce.box(['Function', ['h', M, ['List', 'y', 'y']], 'y']);
        expect(
          valueFits(
            ce.box(['Apply', literal, 5]).evaluate(),
            resultOf(literal.type.type)
          )
        ).toBe(true);
        expect(resultOf(literal.type.type)).not.toBe('number');
      });

      test('a partial application is typed first', () => {
        const ce = new ComputeEngine();
        define(ce, how, 'h', H);
        expect(routes(ce, 'h', [['List', 1, 2]]).type).toBe(
          '(t: unknown) -> number'
        );
        expect(
          ce.box(['Apply', ['h', ['List', 1, 2]], 10]).evaluate().json
        ).toBe(13);
        // A list of points maps before the call is curried: the value is a
        // list of functions. Before, the type was `list<number>` on the
        // boxed route of an operator definition, and the function type on
        // the other routes.
        expect(routes(ce, 'h', [P])).toEqual({
          value: '[(_) => _ + 3,(_) => _ + 7]',
          type: 'list<(t: unknown) -> number>',
        });
      });
    });
  }

  test('a declared signature is a contract', () => {
    const ce = new ComputeEngine();
    ce.declare('k', '(tuple<number, number>) -> number');
    ce.parse('k(a) := a[1] + a[2]').evaluate();
    for (const arg of [3, 'True', ['List', 1, 2], M])
      expect(ce.box(['k', arg as never]).type.toString()).toBe('error');
    // A literal that annotates its parameter, held by a symbol declared
    // bare `function`, has a contract too.
    ce.declare('g', 'function');
    ce.assign('g', ce.parse('(a: tuple<number, number>) \\mapsto a[1] + a[2]'));
    for (const arg of [3, M]) {
      const call = ce.box(['g', arg as never]);
      expect(call.type.toString()).toBe('error');
      expect(call.evaluate().type.toString()).toBe('error');
    }
  });
});
