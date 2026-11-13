import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// The parameters of the function literal of `Derivative(a ↦ …)` are bound
// by the literal. A variable of the same name that has a value where the
// derivative is evaluated is another variable: a global `a := [1, 2]`, or
// the parameter `a` of a function whose body holds the derivative. Before
// the fix, the arithmetic that builds the derivative read that value by
// name: `2·a` became `[2, 4]`, so the derivative of `a ↦ a^2` was the
// constant function `a ↦ [2, 4]`, and
// `((a: list<real>) ↦ Apply(Derivative(a ↦ a^2), a))([1, 2])` was
// `[[2, 4], [2, 4]]`.

type Json = Parameters<ComputeEngine['box']>[0];

// `((a: <type>) ↦ body)(arg)`
const callWithParameter = (type: string, body: Json, arg: Json): Json => [
  'Apply',
  ['Function', body, ['Typed', 'a', { str: type }]],
  arg,
];

const square: Json = ['Function', ['Power', 'a', 2], 'a'];

describe('DERIVATIVE OF A FUNCTION LITERAL WHOSE PARAMETER NAME HAS A VALUE', () => {
  test('in the body of a function with a list parameter of the same name', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      callWithParameter(
        'list<real>',
        ['Apply', ['Derivative', square], 'a'],
        ['List', 1, 2]
      )
    );
    expect(expr.evaluate().json).toEqual(['List', 2, 4]);
  });

  test('a sum, applied to a list literal', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      callWithParameter(
        'list<real>',
        [
          'Apply',
          ['Derivative', ['Function', ['Add', ['Power', 'a', 2], 'a'], 'a']],
          ['List', 2, 3],
        ],
        ['List', 1, 2]
      )
    );
    expect(expr.evaluate().json).toEqual(['List', 5, 7]);
  });

  test('the derivative itself keeps its parameter', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      callWithParameter('list<real>', ['Derivative', square], ['List', 1, 2])
    );
    expect(expr.evaluate().json).toEqual([
      'Function',
      ['Block', ['Multiply', 2, 'a']],
      'a',
    ]);
  });

  test('a partial derivative of a function of two parameters', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      callWithParameter(
        'list<real>',
        [
          'Apply',
          [
            'Derivative',
            ['Function', ['Multiply', ['Power', 'a', 2], 'b'], 'a', 'b'],
            1,
            0,
          ],
          ['List', 2, 3],
          1,
        ],
        ['List', 1, 2]
      )
    );
    expect(expr.evaluate().json).toEqual(['List', 4, 6]);
  });

  test('a global variable of the same name with a list value', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'list<real>');
    ce.assign('a', ce.box(['List', 1, 2]));
    expect(ce.box(['Derivative', square]).evaluate().json).toEqual([
      'Function',
      ['Block', ['Multiply', 2, 'a']],
      'a',
    ]);
  });

  test('the static type of the call holds the list value', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      callWithParameter(
        'list<real>',
        ['Apply', ['Derivative', square], 'a'],
        ['List', 1, 2]
      )
    );
    expect(expr.type.toString()).toBe('vector<2>');
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });

  test('controls: a scalar parameter, and no enclosing variable', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(
          callWithParameter('real', ['Apply', ['Derivative', square], 'a'], 3)
        )
        .evaluate().json
    ).toEqual(6);
    expect(
      ce
        .box([
          'Apply',
          ['Derivative', ['Function', ['Power', 'x', 2], 'x']],
          ['List', 1, 2],
        ])
        .evaluate().json
    ).toEqual(['List', 2, 4]);
  });
});

// A callee of `Apply` that is an application, such as `Derivative(x ↦ x^2)`,
// is evaluated to a function before the call, and that function maps over a
// list argument where its parameters are scalar. The static type of the call
// is then a list of the result of the signature of the callee. Before, it
// was the scalar result (`number`) for the value `[2, 4]`.
describe('STATIC TYPE OF THE APPLICATION OF AN APPLIED CALLEE', () => {
  const sq: Json = ['Function', ['Power', 'x', 2], 'x'];

  const typeAndValue = (ce: ComputeEngine, json: Json) => {
    const expr = ce.box(json);
    const value = expr.evaluate();
    // The type of the call holds the value.
    expect(value.type.matches(expr.type)).toBe(true);
    return [expr.type.toString(), value.toString()];
  };

  test('a list argument', () =>
    expect(
      typeAndValue(new ComputeEngine(), [
        'Apply',
        ['Derivative', sq],
        ['List', 1, 2],
      ])
    ).toEqual(['vector<2>', '[2,4]']));

  test('the derivative of a library operator', () =>
    expect(
      typeAndValue(new ComputeEngine(), [
        'Apply',
        ['Derivative', 'Sin'],
        ['List', 1, 2],
      ])
    ).toEqual(['vector<2>', '[cos(1),cos(2)]']));

  test('a partial derivative with a list argument', () =>
    expect(
      typeAndValue(new ComputeEngine(), [
        'Apply',
        [
          'Derivative',
          ['Function', ['Multiply', ['Power', 'x', 2], 'y'], 'x', 'y'],
          1,
          0,
        ],
        ['List', 1, 2],
        3,
      ])
    ).toEqual(['vector<2>', '[6,12]']));

  test('an argument that is a number or a list', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number | list<number>');
    const expr = ce.box(['Apply', ['Derivative', sq], 'u']);
    expect(ce.type('number').matches(expr.type)).toBe(true);
    expect(ce.type('list<number>').matches(expr.type)).toBe(true);
  });

  test('an argument that is a number or a list of lists keeps the depth', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number | list<list<number>>');
    ce.assign('u', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(typeAndValue(ce, ['Apply', ['Derivative', sq], 'u'])).toEqual([
      'list<list<number>> | number',
      '[[2,4],[6,8]]',
    ]);
    ce.assign('u', 3);
    expect(typeAndValue(ce, ['Apply', ['Derivative', sq], 'u'])).toEqual([
      'list<list<number>> | number',
      '6',
    ]);
  });

  test('a tuple argument is bound whole: the type is not a scalar', () =>
    expect(
      typeAndValue(new ComputeEngine(), [
        'Apply',
        ['Derivative', sq],
        ['Tuple', 1, 2],
      ])
    ).toEqual(['any', '(2, 4)']));

  test('a composition applies its steps one after another', () => {
    // The last step maps over the list, and `Length` takes the whole list
    // of results: the value is a scalar, not a list.
    for (const last of [
      ['Function', ['List', 'x', 'x'], ['Typed', 'x', { str: 'real' }]],
      ['Function', ['List', 'x', 'x'], 'x'],
    ] as Json[]) {
      const [type, value] = typeAndValue(new ComputeEngine(), [
        'Apply',
        ['Composition', 'Length', last],
        ['List', 1, 2],
      ]);
      expect(value).toBe('2');
      expect(type.startsWith('list')).toBe(false);
    }
  });

  test('controls: a scalar argument, a named callee, a list parameter', () => {
    const ce = new ComputeEngine();
    expect(typeAndValue(ce, ['Apply', ['Derivative', sq], 3])).toEqual([
      'number',
      '6',
    ]);
    ce.declare('f', 'function');
    ce.assign('f', ce.box(sq));
    expect(typeAndValue(ce, ['Apply', 'f', ['List', 1, 2]])).toEqual([
      'vector<2>',
      '[1,4]',
    ]);
    // A callee whose parameter is a list binds the list whole.
    ce.declare('g', '(list<real>) -> real');
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Length', 'x'],
        ['Typed', 'x', { str: 'list<real>' }],
      ])
    );
    expect(typeAndValue(ce, ['Apply', 'g', ['List', 1, 2]])).toEqual([
      'real',
      '2',
    ]);
  });
});

// A callee of `Apply` that is a call of a curried user function, such as
// `mk(1)` with `mk := n ↦ (x ↦ x + n)`, is evaluated to the inner function
// literal (`x ↦ x + 1`), and that literal maps over a list argument where
// its parameters are scalar. The static type of the call is then a list of
// the result of the signature of the callee. Before, it was the scalar
// result (`number`) for the value `[2, 3]`.
describe('STATIC TYPE OF THE APPLICATION OF A CURRIED FUNCTION', () => {
  const typeAndValue = (ce: ComputeEngine, json: Json) => {
    const expr = ce.box(json);
    const value = expr.evaluate();
    // The type of the call holds the value.
    expect(value.type.matches(expr.type)).toBe(true);
    return [expr.type.toString(), value.toString()];
  };
  const curried = (body: Json, param: Json = 'x'): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declare('mk', 'function');
    ce.assign('mk', ce.box(['Function', ['Function', body, param], 'n']));
    return ce;
  };

  test('a list argument', () =>
    expect(
      typeAndValue(curried(['Add', 'x', 'n']), [
        'Apply',
        ['mk', 1],
        ['List', 1, 2],
      ])
    ).toEqual(['vector<2>', '[2,3]']));

  test('a list of lists keeps the depth', () =>
    expect(
      typeAndValue(curried(['Add', 'x', 'n']), [
        'Apply',
        ['mk', 1],
        ['List', ['List', 1, 2], ['List', 3]],
      ])
    ).toEqual(['list<list<number>>', '[[2,3],[4]]']));

  test('an inner literal whose value is a list', () =>
    expect(
      typeAndValue(curried(['List', 'x', 'n']), [
        'Apply',
        ['mk', 1],
        ['List', 1, 2],
      ])
    ).toEqual(['list<list<unknown>>', '[[1,1],[2,1]]']));

  test('the body is not typed with the outer parameter unbound', () => {
    // The inner body reads `n`, which is the argument of the outer call
    // (`1.5`), not an integer.
    const ce = curried(['List', 'x', 'n']);
    expect(
      typeAndValue(ce, ['Apply', ['mk', 1.5], ['List', 1, 2]])[1]
    ).toEqual('[[1,1.5],[2,1.5]]');
  });

  test('a global with the name of the outer parameter says nothing', () => {
    const ce = curried(['Add', 'x', 'n']);
    ce.declare('n', 'list<integer>');
    ce.assign('n', ce.box(['List', 1, 2]));
    expect(
      typeAndValue(ce, ['Apply', ['mk', 1], ['List', 10, 20]])
    ).toEqual(['vector<2>', '[11,21]']);
  });

  test('an inline call of a curried literal', () => {
    const inline: Json = [
      'Apply',
      ['Apply', ['Function', ['Function', ['Add', 'x', 'n'], 'x'], 'n'], 1],
      ['List', 10, 20],
    ];
    expect(typeAndValue(new ComputeEngine(), inline)).toEqual([
      'vector<2>',
      '[11,21]',
    ]);
    const ce = new ComputeEngine();
    ce.assign('n', ce.box(['List', 1, 2]));
    expect(typeAndValue(ce, inline)).toEqual(['vector<2>', '[11,21]']);
  });

  test('an inline call that is not a call of a curried literal', () => {
    // The inner `Apply` gives the number 2, not a function literal, so the
    // list is not mapped: the outer call is an application of a number.
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Apply',
      ['Apply', ['Function', ['Add', 'n', 1], 'n'], 1],
      ['List', 10, 20],
    ]);
    const value = expr.evaluate();
    expect(value.toString().includes('[11')).toBe(false);
    expect(expr.type.toString().startsWith('vector')).toBe(false);
  });

  test('a list of tuples binds each tuple whole', () =>
    expect(
      typeAndValue(curried(['Multiply', 'x', 'n']), [
        'Apply',
        ['mk', 2],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ])
    ).toEqual(['any', '[(2, 4),(6, 8)]']));

  test('a curried function defined in LaTeX', () => {
    const ce = new ComputeEngine();
    ce.parse('\\operatorname{mk}(n) := x \\mapsto x+n').evaluate();
    expect(typeAndValue(ce, ['Apply', ['mk', 1], ['List', 1, 2]])).toEqual([
      'vector<2>',
      '[2,3]',
    ]);
  });

  test('controls: a scalar argument, a list parameter', () => {
    expect(
      typeAndValue(curried(['Add', 'x', 'n']), ['Apply', ['mk', 1], 3])
    ).toEqual(['number', '4']);
    // An inner literal whose parameter is a list binds the list whole.
    const [type, value] = typeAndValue(
      curried(['Add', ['Length', 'x'], 'n'], [
        'Typed',
        'x',
        { str: 'list<real>' },
      ]),
      ['Apply', ['mk', 1], ['List', 1, 2]]
    );
    expect(value).toBe('3');
    expect(type.startsWith('list')).toBe(false);
  });
});

// A parameter of a function literal has a value only in a call. The type of a
// literal is read after the scope of its body was left, where the walk of the
// scope chain finds a variable of the same name: that is another variable, and
// it says nothing about the parameter. The signature is the signature of the
// same literal with a parameter of another name.
describe('THE TYPE OF A LITERAL WITH A PARAMETER NAMED LIKE A GLOBAL', () => {
  const withGlobal = (value: Json): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.assign('n', ce.box(value));
    return ce;
  };
  const list: Json = ['List', 1, 2];

  // The parameter names are part of the printed signature: the spelling with
  // the other name `q` is compared with `n` in its place.
  const sameAsAnotherName = (ce: ComputeEngine, make: (v: string) => Json) =>
    expect(ce.box(make('n')).type.toString()).toBe(
      ce.box(make('q')).type.toString().replaceAll('q', 'n')
    );

  test.each<[string, Json]>([
    ['a list', list],
    ['a matrix', ['List', ['List', 1, 2], ['List', 3, 4]]],
    ['a tuple', ['Tuple', 1, 2]],
    ['a set', ['Set', 1, 2]],
    ['a string', { str: 'ab' }],
    ['a number', 3],
    ['a function', ['Function', ['Add', 'z', 1], 'z']],
  ])('a global that holds %s', (_label, value) => {
    const ce = withGlobal(value);
    for (const body of [
      (v: string): Json => ['Add', v, 1],
      (v: string): Json => ['Multiply', v, 2],
      (v: string): Json => ['Sin', v],
      (v: string): Json => ['List', v, 1],
      (v: string): Json => ['Function', ['Add', 'x', v], 'x'],
    ]) {
      sameAsAnotherName(ce, (v) => ['Function', body(v), v]);
      sameAsAnotherName(ce, (v) => [
        'Function',
        body(v),
        ['Typed', v, { str: 'real' }],
      ]);
    }
  });

  test('the value of the literal has the type of the literal', () => {
    const ce = withGlobal(list);
    const literal = ce.box(['Function', ['Add', 'n', 1], 'n']);
    expect(literal.type.toString()).toBe('(n: unknown) -> number');
    expect(literal.evaluate().type.toString()).toBe('(n: unknown) -> number');
  });

  test('a literal parsed from LaTeX', () =>
    expect(withGlobal(list).parse('n \\mapsto n+1').type.toString()).toBe(
      '(n: unknown) -> number'
    ));

  test('a global assigned after the type of the literal is read', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['Add', 'n', 1], 'n']);
    expect(literal.type.toString()).toBe('(n: unknown) -> number');
    ce.assign('n', ce.box(list));
    expect(literal.type.toString()).toBe('(n: unknown) -> number');
  });

  // `n + 1` has no sign for every real `n`, so `Sqrt(n + 1)` can be complex.
  // Outside a call the parameter `n` has no value, whatever the global `n`
  // holds: a node of the body has no sign there, and the type of the literal
  // reads no value of the global.
  const sqrtOfSum = (ce: ComputeEngine) => {
    const literal = ce.box([
      'Function',
      ['Sqrt', ['Add', 'n', 1]],
      ['Typed', 'n', { str: 'real' }],
    ]);
    const sum = (literal.ops![0].ops![0] as { op1: Expression }).op1;
    return { literal, sum };
  };

  test('a read of the sign of a body node before the type', () => {
    const { literal, sum } = sqrtOfSum(withGlobal(2));
    expect(sum.sgn).toBeUndefined();
    expect(literal.type.toString()).toBe('(n: real) -> complex');
  });

  test('a read of the sign of a body node after the type', () => {
    const { literal, sum } = sqrtOfSum(withGlobal(2));
    expect(literal.type.toString()).toBe('(n: real) -> complex');
    // The type computation found no sign, and that is a sound answer here.
    expect(sum.sgn).toBeUndefined();
  });

  test('a read of the sign of a body node of another literal', () => {
    const ce = withGlobal(2);
    expect(sqrtOfSum(ce).sum.sgn).toBeUndefined();
    const { literal, sum } = sqrtOfSum(ce);
    expect(literal.type.toString()).toBe('(n: real) -> complex');
    expect(sum.sgn).toBeUndefined();
    expect(literal.type.toString()).toBe('(n: real) -> complex');
  });

  test('a body node evaluated outside a call: the parameter has no value', () => {
    const ce = withGlobal(2);
    const body = ce.box(['Function', ['Add', 'n', 1], 'n']).ops![0];
    expect(body.evaluate().toString()).toBe('n + 1');
    ce.pushScope();
    ce.declare('n', 'number');
    ce.assign('n', 5);
    // The body reads the scope it was boxed in; bound again in this scope,
    // it reads the new `n`.
    expect(body.evaluate().toString()).toBe('n + 1');
    expect(ce.rebind(body).evaluate().toString()).toBe('6');
    ce.popScope();
  });

  test('a body node evaluated after the type of the literal', () => {
    const ce = withGlobal(2);
    const literal = ce.box(['Function', ['Add', 'n', 1], 'n']);
    expect(literal.type.toString()).toBe('(n: unknown) -> number');
    expect(literal.ops![0].evaluate().toString()).toBe('n + 1');
    expect(literal.type.toString()).toBe('(n: unknown) -> number');
  });

  test('a global with no value leaves the literal typed as before', () => {
    const ce = new ComputeEngine();
    ce.parse('n^2');
    const { literal, sum } = sqrtOfSum(ce);
    expect(sum.sgn).toBeUndefined();
    expect(literal.type.toString()).toBe('(n: real) -> complex');
    // The assignment of the global gives the parameter no value.
    ce.assign('n', 2);
    expect(sum.sgn).toBeUndefined();
    expect(literal.type.toString()).toBe('(n: real) -> complex');
  });

  test('control: a body node with no binding of the name stays symbolic', () => {
    const ce = new ComputeEngine();
    const body = ce.box(['Function', ['Add', 'n', 1], 'n']).ops![0];
    expect(body.evaluate().toString()).toBe('n + 1');
  });

  test('the call of a curried function has the type of its value', () => {
    const ce = withGlobal(list);
    ce.assign(
      'mk',
      ce.box(['Function', ['Function', ['Add', 'x', 'n'], 'x'], 'n'])
    );
    const call = ce.box(['mk', 1]);
    expect(call.type.toString()).toBe('(x: unknown) -> number');
    expect(call.evaluate().type.toString()).toBe('(x: unknown) -> number');
  });

  test('a call binds the parameter, not the global', () => {
    const ce = withGlobal(3);
    const call = ce.box([
      'Apply',
      ['Function', ['Add', 'n', 1], ['Typed', 'n', { str: 'list<real>' }]],
      list,
    ]);
    const value = call.evaluate();
    expect(value.toString()).toBe('[2,3]');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('control: a free name of a literal reads the global', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.box(['List', 3, 4]));
    const literal = ce.box(['Function', ['Add', 'y', 'q'], 'q']);
    expect(literal.type.toString()).toBe('(q: unknown) -> vector<2>');
    expect(ce.box(['Apply', literal, 1]).evaluate().toString()).toBe('[4,5]');
  });
});

// A parameter of the literal of `Derivative(a ↦ …)` is another variable than
// a free name of a function that the body calls, also when the two have the
// same name. With `a := 3` and `h := x ↦ a·x`, `a ↦ a·h(a)` is `a ↦ 3a²`, and
// its derivative is `a ↦ 6a`. The `a` of `h` is the global, so it is not
// differentiated as the variable, and a parameter of the result does not
// bind it. `D(h(k), x)` is different: `D` follows the name `x` into the body
// of `h` (derivative-user-function-body.test.ts).
describe('DERIVATIVE OF A FUNCTION LITERAL THAT CALLS A FUNCTION WITH A FREE NAME EQUAL TO A PARAMETER', () => {
  const engine = (value: number | null = 3): ComputeEngine => {
    const ce = new ComputeEngine();
    if (value !== null) ce.assign('a', value);
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', ['Multiply', 'a', 'x'], 'x']));
    return ce;
  };
  const value = (ce: ComputeEngine, json: Json) =>
    ce.box(json).evaluate().toString();
  const product = (p: string): Json => [
    'Function',
    ['Multiply', p, ['h', p]],
    p,
  ];

  test('the first derivative', () => {
    const ce = engine();
    expect(
      value(ce, ['Apply', ['Derivative', ['Function', ['h', 'a'], 'a']], 2])
    ).toBe('3');
    expect(value(ce, ['Apply', ['Derivative', product('a')], 2])).toBe('12');
    expect(ce.box(['Apply', ['Derivative', product('a')], 2]).N().re).toBe(12);
  });

  test('a higher order', () => {
    const ce = engine();
    expect(value(ce, ['Apply', ['Derivative', product('a'), 2], 2])).toBe('6');
    expect(value(ce, ['Apply', ['Derivative', product('a'), 2], 't'])).toBe(
      '6'
    );
  });

  test('a global with no value stays in the result', () => {
    const ce = engine(null);
    const lambda = ['Derivative', ['Function', ['h', 'a'], 'a']] as Json;
    expect(ce.box(lambda).evaluate().json).toEqual([
      'Function',
      ['Block', 'a'],
      'a_1',
    ]);
    expect(value(ce, ['Apply', lambda, 2])).toBe('a');
    expect(value(ce, ['Apply', ['Derivative', product('a')], 2])).toBe('4a');
  });

  test('a parameter keeps its name when the result does not hold it', () => {
    const ce = engine();
    expect(
      ce
        .box(['Derivative', ['Function', ['Multiply', 'a', ['h', 1]], 'a']])
        .evaluate()
        .json
    ).toEqual(['Function', ['Block', ['h', 1]], 'a']);
  });

  test('a parameter keeps its type', () => {
    const ce = engine();
    const literal: Json = [
      'Function',
      ['h', 'a'],
      ['Typed', 'a', { str: 'real' }],
    ];
    expect(ce.box(['Derivative', literal]).evaluate().json).toEqual([
      'Function',
      ['Block', 'a'],
      ['Typed', 'a_1', "'real'"],
    ]);
    expect(value(ce, ['Apply', ['Derivative', literal], 2])).toBe('3');
  });

  test('the result follows a new value and a new definition', () => {
    const ce = engine();
    const expr = ce.box(['Apply', ['Derivative', product('a')], 2]);
    expect(expr.evaluate().toString()).toBe('12');
    ce.assign('a', 5);
    expect(expr.evaluate().toString()).toBe('20');
    ce.assign('h', ce.box(['Function', ['Multiply', 7, 'x'], 'x']));
    expect(expr.evaluate().toString()).toBe('28');
  });

  test('a function called by a function that the body calls', () => {
    const ce = engine();
    ce.declare('g', 'function');
    // The parameter of `g` has the name of the free name of `h` too.
    ce.assign('g', ce.box(['Function', ['h', 'a'], 'a']));
    expect(
      value(ce, ['Apply', ['Derivative', ['Function', ['g', 'a'], 'a']], 2])
    ).toBe('3');
  });

  test('a function given by its name', () => {
    const ce = engine();
    ce.declare('f', 'function');
    ce.assign('f', ce.box(product('a')));
    expect(value(ce, ['Apply', ['Derivative', 'f'], 2])).toBe('12');
  });

  test('a free name equal to the parameter that is not the variable', () => {
    const ce = engine();
    ce.assign('b', 7);
    ce.declare('k', 'function');
    ce.assign('k', ce.box(['Function', ['Multiply', 'b', 'x'], 'x']));
    const literal: Json = ['Function', ['Multiply', ['k', 'a'], 'b'], 'a', 'b'];
    // The derivative in `a` of `7·a·b` is `7·b`.
    expect(ce.box(['Derivative', literal]).evaluate().json).toEqual([
      'Function',
      ['Block', ['Multiply', 'b', 'b_1']],
      'a',
      'b_1',
    ]);
    expect(value(ce, ['Apply', ['Derivative', literal], 2, 5])).toBe('35');
    expect(value(ce, ['Apply', ['Derivative', literal, 1, 0], 2, 5])).toBe(
      '35'
    );
  });

  test('a partial derivative', () => {
    const ce = engine();
    const literal: Json = ['Function', ['Multiply', ['h', 'a'], 'b'], 'a', 'b'];
    expect(value(ce, ['Apply', ['Derivative', literal, 1, 0], 2, 5])).toBe(
      '15'
    );
    expect(value(ce, ['Apply', ['Derivative', literal, 0, 1], 2, 5])).toBe('6');
    ce.declare('g', 'function');
    ce.assign('g', ce.box(literal));
    expect(value(ce, ['Apply', ['Derivative', 'g', 1, 0], 2, 5])).toBe('15');
  });

  test('a block body', () => {
    const ce = engine();
    expect(
      value(ce, [
        'Apply',
        [
          'Derivative',
          [
            'Function',
            [
              'Block',
              ['Declare', 'c', { str: 'unknown' }, ['h', 'a']],
              ['Multiply', 'c', 'a'],
            ],
            'a',
          ],
        ],
        2,
      ])
    ).toBe('12');
  });

  test('a parameter used as the name of a called function', () => {
    const ce = engine();
    ce.declare('sq', 'function');
    ce.assign('sq', ce.box(['Function', ['Power', 'y', 2], 'y']));
    const body = (p: string): Json => ['Multiply', ['f', p], ['h', p]];
    const literal = (p: string): Json => ['Function', body(p), p, 'f'];
    const derivative = (p: string) =>
      value(ce, ['Apply', ['Derivative', literal(p)], 2, 'sq']);
    // The derivative in `a` of `f(a)·3a` is `3·f(a) + 3a·f′(a)`. No hole is
    // left in the call `f(a)`, so the value is the one of another parameter
    // name.
    expect(derivative('a')).toBe(derivative('p'));
    expect(derivative('a')).not.toContain('_2');
  });

  // The body writes the name `a` itself (an index, or the variable of a nested
  // `D`), and `h` reads a free `a`. The derivative stays unevaluated, and `N()`
  // finds the value numerically: `a ↦ 3a + 6` has the slope 3.
  test('a body that also binds the name of the parameter', () => {
    const ce = engine();
    const sum: Json = [
      'Function',
      ['Add', ['h', 'a'], ['Sum', 'a', ['Limits', 'a', 1, 3]]],
      'a',
    ];
    const nested: Json = [
      'Function',
      ['Add', ['D', ['Power', 'a', 2], 'a'], ['h', 'a']],
      'a',
    ];
    for (const literal of [sum, nested]) {
      expect(ce.box(['Derivative', literal]).evaluate().operator).toBe(
        'Derivative'
      );
    }
    const slope = ce.box(['Apply', ['Derivative', sum], 2]).N().re;
    expect(slope).toBeCloseTo(3, 6);
    const twoParameters = ce.box([
      'Derivative',
      [
        'Function',
        ['Multiply', 'b', ['Add', ['h', 'a'], ['Sum', 'a', ['Limits', 'a', 1, 3]]]],
        'a',
        'b',
      ],
      1,
      0,
    ]);
    expect(twoParameters.evaluate().operator).toBe('Derivative');
  });

  test('a body that binds the name, and no called function reads it', () => {
    const ce = engine();
    expect(
      value(ce, [
        'Apply',
        [
          'Derivative',
          [
            'Function',
            ['Multiply', 'a', ['Sum', 'a', ['Limits', 'a', 1, 3]]],
            'a',
          ],
        ],
        2,
      ])
    ).toBe('6');
  });

  test('a parameter is not the free name of a function with another argument', () => {
    const ce = engine();
    ce.declare('h2', 'function');
    ce.assign('h2', ce.box(['Function', ['Multiply', 't', 'x'], 't']));
    expect(
      ce.box(['Derivative', ['Function', ['h2', 'k'], 'x']]).evaluate().json
    ).toEqual(['Function', ['Block', 0], 'x']);
  });

  test('compiled code gives the same value', () => {
    const ce = engine();
    ce.declare('t', 'real');
    const compiled = compile(
      ce.box(['Apply', ['Derivative', product('a')], 't'])
    );
    expect(compiled.success).toBe(true);
    expect(compiled.run!({ t: 2 })).toBe(12);
  });
});
