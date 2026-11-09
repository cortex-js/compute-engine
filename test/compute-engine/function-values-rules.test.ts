/**
 * Function values and parameter defaults in the interpreter and in compiled
 * code (user decision 2026-11-02, options page 5, option B, in
 * `docs/plans/2026-11-02-language-axes-options.md`; the rule and its two
 * tables are in `docs/COMPILATION-MODEL.md`, "Function values" and
 * "Parameters with a default value").
 *
 * - A call compiles when the callee is a defined function, a declared
 *   function with a value, or a function literal at the call site. The
 *   callbacks of `Map`, `Filter`, `Sort`, `Fold` and `Reduce` compile when
 *   they are such a callee, and `Apply(Derivative(f, 1), x)` compiles when
 *   `f` is defined.
 * - A partial application, a curried call, a function value passed through
 *   a parameter, a function returned from a function and a parameter
 *   declared with a function type decline in compiled code. The interpreter
 *   keeps them.
 * - A default fills an argument that the call leaves out, and nothing else.
 *   An absent value supplied at a defaulted position is passed to the body:
 *   the interpreter gives `Missing` at a numeric parameter, and the compiled
 *   value is unspecified (it is outside the type of the parameter).
 * - A default is a constant. A symbol default is allowed when it is a
 *   constant (a library constant, `over: set = Integers`, or a symbol
 *   declared constant, `weights = W0`) or a symbol that the parameter type
 *   lists (`mode: symbol<Auto> | symbol<Manual> = Auto`), the forms of
 *   GitHub issue #490. The constant is the one that the scope of the
 *   declaration gives the name: a local of the same name where the call is
 *   made does not change it. Compiled code fills a library constant or a
 *   listed symbol, and declines a constant that the host or the program
 *   declares. A default that names a variable, and a default
 *   on a function with a rest parameter, are static errors.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  ce.declare('L', 'list<real>');
  // `f(x, y) = x + y`, `sq(x) = 2x`, `g(k: real = 2) = k + 1`.
  ce.assign('f', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
  ce.assign('sq', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
  ce.assign(
    'g',
    ce.box([
      'Function',
      ['Add', 'k', 1],
      ['Optional', ['Typed', 'k', "'real'"], 2],
    ])
  );
  // `h(f: function) = f(1)`, `mk(a) = x ↦ x + a`.
  ce.assign(
    'h',
    ce.box(['Function', ['Apply', 'q', 1], ['Typed', 'q', "'function'"]])
  );
  ce.assign('mk', ce.box(['Function', ['Function', ['Add', 'x', 'a'], 'x'], 'a']));
  return ce;
}

function value(ce: ComputeEngine, json: MathJsonExpression): string {
  return ce.box(json).evaluate().toString();
}

function compiled(
  ce: ComputeEngine,
  json: MathJsonExpression,
  options?: Parameters<typeof compile>[1]
): ReturnType<typeof compile> {
  return compile(ce.box(json), options);
}

describe('FUNCTION VALUES: THE INTERPRETER KEEPS FIRST-CLASS FUNCTIONS', () => {
  const ce = engine();
  test('Map(x ↦ x^2, L)', () =>
    expect(
      value(ce, ['Map', ['Function', ['Power', 'x', 2], 'x'], ['List', 1, 2, 3]])
    ).toBe('[1,4,9]'));
  test('Map(f, L) with f defined', () =>
    expect(value(ce, ['Map', 'sq', ['List', 1, 2]])).toBe('[2,4]'));
  test('a curried call', () =>
    expect(value(ce, ['Apply', ['Apply', 'f', 1], 2])).toBe('3'));
  test('a function value passed through a parameter', () =>
    expect(value(ce, ['h', ['Function', ['Add', 'x', 1], 'x']])).toBe('2'));
  test('a function returned from a function', () =>
    expect(value(ce, ['Apply', ['mk', 1], 3])).toBe('4'));
});

describe('FUNCTION VALUES: COMPILED CODE CALLS WHAT IT CAN SEE', () => {
  const ce = engine();
  test('Map(x ↦ x^2, L) compiles', () => {
    const r = compiled(ce, [
      'Map',
      ['Function', ['Power', 'x', 2], 'x'],
      ['List', 1, 'u'],
    ]);
    expect(r.success).toBe(true);
    expect(r.run!({ u: 3 })).toEqual([1, 9]);
  });
  test('Map(f, L) with f defined compiles', () => {
    const r = compiled(ce, ['Map', 'sq', ['List', 1, 'u']]);
    expect(r.success).toBe(true);
    expect(r.run!({ u: 3 })).toEqual([2, 6]);
  });
  test('Apply(Apply(f, 1), u) declines', () => {
    const r = compiled(ce, ['Apply', ['Apply', 'f', 1], 'u']);
    expect(r.success).toBe(false);
  });
  test('a partial application of a literal declines', () => {
    const r = compiled(ce, [
      'Apply',
      ['Function', ['Add', 'x', 'y', 'u'], 'x', 'y'],
      1,
    ]);
    expect(r.success).toBe(false);
  });
  test('h(x ↦ x + u), with h declaring a function parameter, declines', () => {
    const r = compiled(ce, ['h', ['Function', ['Add', 'x', 'u'], 'x']]);
    expect(r.success).toBe(false);
  });
  test('a literal with a parameter of a function type declines', () => {
    const r = compiled(ce, [
      'Function',
      ['Apply', 'q', 'y'],
      ['Typed', 'q', "'function'"],
      'y',
    ]);
    expect(r.success).toBe(false);
  });
  test('a function returned from a function declines', () => {
    const r = compiled(ce, ['Apply', ['mk', 1], 'u']);
    expect(r.success).toBe(false);
  });
  test('Apply(Derivative(p, 1), u) with p defined compiles', () => {
    ce.assign('p', ce.box(['Function', ['Power', 'x', 3], 'x']));
    const r = compiled(ce, ['Apply', ['Derivative', 'p', 1], 'u']);
    expect(r.success).toBe(true);
    expect(r.run!({ u: 2 })).toBe(12);
  });
});

describe('FUNCTION VALUES: THE CALLBACKS OF Map, Filter, Sort, Fold AND Reduce', () => {
  const ce = engine();
  ce.assign('pos', ce.box(['Function', ['Greater', 'x', 0], 'x']));
  ce.assign('neg', ce.box(['Function', ['Negate', 'x'], 'x']));
  ce.assign('plus', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
  const L: MathJsonExpression = ['List', 3, -1, 'u'];
  const cases: [string, MathJsonExpression, MathJsonExpression, unknown][] = [
    [
      'Map',
      ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], L],
      ['Map', 'sq', L],
      [6, -2, 4],
    ],
    [
      'Filter',
      ['Filter', L, ['Function', ['Greater', 'x', 0], 'x']],
      ['Filter', L, 'pos'],
      [3, 2],
    ],
    [
      'Sort',
      ['Sort', L, ['Function', ['Negate', 'x'], 'x']],
      ['Sort', L, 'neg'],
      [3, 2, -1],
    ],
    [
      'Fold',
      ['Fold', ['Function', ['Add', 'a', 'b'], 'a', 'b'], 0, L],
      ['Fold', 'plus', 0, L],
      4,
    ],
    [
      'Reduce',
      ['Reduce', L, ['Function', ['Add', 'a', 'b'], 'a', 'b'], 0],
      ['Reduce', L, 'plus', 0],
      4,
    ],
  ];
  test.each(cases)('%s with a literal and with a defined function', (_, lit, named, expected) => {
    for (const json of [lit, named]) {
      const r = compiled(ce, json);
      expect(r.success).toBe(true);
      expect(r.run!({ u: 2 })).toEqual(expected);
      // The interpreter, with `u` replaced by its value in the written
      // expression.
      const written = JSON.parse(JSON.stringify(json).replaceAll('"u"', '2'));
      expect(ce.box(written).evaluate().toString()).toBe(
        JSON.stringify(expected)
      );
    }
  });
});

describe('PARAMETER DEFAULTS: A DEFAULT FILLS ONLY AN ARGUMENT THAT THE CALL LEAVES OUT', () => {
  const ce = engine();
  test('g() is 3 in the interpreter and in compiled code', () => {
    expect(value(ce, ['g'])).toBe('3');
    const r = compiled(ce, ['Add', ['g'], 'u']);
    expect(r.success).toBe(true);
    expect(r.run!({ u: 1 })).toBe(4);
  });
  test('a written absent argument is passed to the body: g(Missing) is Missing', () =>
    expect(ce.box(['g', 'Missing']).evaluate().symbol).toBe('Missing'));
  test('a computed absent argument is passed to the body: g(First([])) is Missing', () =>
    expect(ce.box(['g', ['First', ['List']]]).evaluate().symbol).toBe(
      'Missing'
    ));
  test('g(At(L, 100)) passes the NaN of the read to the body', () => {
    ce.assign('L', ce.box(['List', 1, 2]));
    expect(value(ce, ['g', ['At', 'L', 100]])).toBe('NaN');
    // The compiled value is unspecified (the argument is outside `real`):
    // the call compiles, and no value is asserted.
    const ce2 = engine();
    expect(compiled(ce2, ['g', ['At', 'L', 100]]).success).toBe(true);
  });
  test('Map((k = 2) ↦ k * 2, [1, 2]) is [2, 4]: the literal takes one argument', () => {
    const literal: MathJsonExpression = [
      'Function',
      ['Multiply', 'k', 2],
      ['Optional', 'k', 2],
    ];
    expect(value(ce, ['Map', literal, ['List', 1, 2]])).toBe('[2,4]');
    const r = compiled(ce, ['Map', literal, ['List', 1, 'u']]);
    expect(r.success).toBe(true);
    expect(r.run!({ u: 2 })).toEqual([2, 4]);
  });
  test('a callback called with fewer arguments takes the default of the other parameter', () => {
    const literal: MathJsonExpression = [
      'Function',
      ['Multiply', 'x', 'k'],
      'x',
      ['Optional', 'k', 3],
    ];
    expect(value(ce, ['Map', literal, ['List', 1, 2]])).toBe('[3,6]');
    const r = compiled(ce, ['Map', literal, ['List', 1, 'u']]);
    expect(r.success).toBe(true);
    expect(r.run!({ u: 2 })).toEqual([3, 6]);
  });
  test.each(['interval-js', 'glsl'] as const)(
    'a defaulted call is completed on %s, with no decline',
    (to) => {
      const r = compiled(ce, ['Add', ['g'], 'u'], { to });
      expect(r.success).toBe(true);
    }
  );
});

describe('PARAMETER DEFAULTS: A DEFAULT IS A CONSTANT', () => {
  const ce = engine();
  test('a default that names a variable is a static error in a literal', () => {
    const literal = ce.box(['Function', 'k', ['Optional', 'k', 'n']]);
    expect(literal.isValid).toBe(false);
    expect(literal.toString()).toContain('expected-a-literal-default');
    expect(literal.toString()).toContain('or pass the argument');
  });
  test('a default that names a variable is a static error in a declared signature', () => {
    expect(() =>
      ce.declare('F1', '(x: number, k: number = n) -> number')
    ).toThrow(/a default value is a constant/);
  });
  test('a declared or assigned variable is a static error', () => {
    ce.declare('nv', 'integer');
    ce.assign('na', 5);
    for (const name of ['nv', 'na']) {
      const literal = ce.box(['Function', 'k', ['Optional', 'k', name]]);
      expect(literal.isValid).toBe(false);
      expect(literal.toString()).toContain('expected-a-literal-default');
      expect(() =>
        ce.declare(`F_${name}`, `(x: number, k: number = ${name}) -> number`)
      ).toThrow(/a default value is a constant/);
    }
  });
  test('an undeclared symbol that the parameter type does not list is a static error', () => {
    const literal = ce.box(['Function', 'k', ['Optional', 'k', 'Auto']]);
    expect(literal.isValid).toBe(false);
    expect(() =>
      ce.declare('F2', '(x: number, k: number = Auto) -> number')
    ).toThrow(/a default value is a constant/);
  });
  test('a constant declaration that has not run, then a variable of the same name, is a static error', () => {
    const ce = engine();
    ce.box([
      'Declare',
      'W',
      ['Dictionary', ['Tuple', "'value'", 5], ['Tuple', "'constant'", 'True']],
    ]);
    ce.declare('W', 'integer');
    const literal = ce.box(['Function', ['Add', 'k', 1], ['Optional', 'k', 'W']]);
    expect(literal.isValid).toBe(false);
    expect(literal.toString()).toContain('expected-a-literal-default');
  });
  test('a constant declaration with a positional value is a constant default', () => {
    const ce = engine();
    const block = ce.box([
      'Block',
      ['Declare', 'W', "'integer'", 5, ['Dictionary', ['Tuple', "'constant'", 'True']]],
      ['Apply', ['Function', ['Add', 'k', 1], ['Optional', 'k', 'W']]],
    ]);
    expect(block.isValid).toBe(true);
    expect(block.evaluate().toString()).toBe('6');
  });
  test('a default on a literal with a rest parameter is a static error', () => {
    const literal = ce.box([
      'Function',
      'k',
      ['Optional', 'k', 1],
      ['Spread', 'r'],
    ]);
    expect(literal.isValid).toBe(false);
    expect(literal.toString()).toContain(
      'a function with a rest parameter has no default values'
    );
  });
});

describe('PARAMETER DEFAULTS: A SYMBOL DECLARED CONSTANT (GITHUB ISSUE #490)', () => {
  const ce = engine();
  ce.declare('W0', { isConstant: true, value: 5 });
  const literal: MathJsonExpression = [
    'Function',
    ['Add', 'k', 1],
    ['Optional', 'k', 'W0'],
  ];
  test('a function literal', () => {
    expect(value(ce, ['Apply', literal])).toBe('6');
    expect(value(ce, ['Apply', literal, 2])).toBe('3');
  });
  test('a declared signature', () => {
    ce.declare('S2', {
      signature: '(x: number, w: number = W0) -> number',
      evaluate: (ops) => ops[1],
    });
    expect(value(ce, ['S2', 3])).toBe('5');
  });
  test('a local of the same name where the call is made does not change the default', () => {
    ce.assign('F1', ce.box(literal));
    const local = ['Declare', 'W0', "'integer'", 7];
    expect(value(ce, ['Block', local, ['F1']])).toBe('6');
    expect(value(ce, ['Block', local, ['S2', 3]])).toBe('5');
    // A literal held in a block local, called in an inner block.
    expect(
      value(ce, [
        'Block',
        ['Assign', 'fl', literal],
        ['Block', local, ['fl']],
      ])
    ).toBe('6');
    // A literal written where the local hides the constant names the
    // local, a variable: a static error.
    const inner = ce.box(['Block', local, ['Apply', literal]]);
    expect(inner.toString()).toContain('expected-a-literal-default');
  });
  test('a declared signature keeps its defaults when a literal with a default of the same name from another scope is assigned', () => {
    ce.declare('gd', '(k: integer = W0) -> integer');
    ce.box([
      'Block',
      ['Declare', 'W0', "'integer'", 7, ['Dictionary', ['Tuple', "'constant'", 'True']]],
      ['Assign', 'gd', ['Function', 'k', ['Optional', 'k', 'W0']]],
    ]).evaluate();
    expect(value(ce, ['gd'])).toBe('5');
    expect(value(ce, ['gd', 3])).toBe('3');
  });
  test('a constant of another type than the parameter is a static error', () => {
    ce.declare('Ws', { isConstant: true, value: { str: 'abc' } });
    expect(() =>
      ce.declare('S4', '(x: number, w: number = Ws) -> number')
    ).toThrow(/does not match its type/);
  });
  // Compiled code fills a default that names a constant that the host or
  // the program declares with the value of that constant, read where the
  // function is declared, as the interpreter does. Constant folding would
  // replace `F1()` with its value 6, so it is turned off for the call.
  test('compiled code: the literal and the call fill the value of the constant', () => {
    const r = compiled(ce, literal);
    expect(r.success).toBe(true);
    expect((r.run as () => unknown)()).toBe(6);
    const call = compiled(ce, ['Add', ['F1'], 'u'], { constantFold: false });
    expect(call.success).toBe(true);
    expect(call.run!({ u: 1 })).toBe(7);
  });
});

describe('PARAMETER DEFAULTS: A CONSTANT SYMBOL DEFAULT (GITHUB ISSUE #490)', () => {
  const ce = engine();
  // `over: set = Integers`: a library constant.
  ce.declare('fo', {
    signature: '(x: integer, over: set = Integers) -> boolean',
    evaluate: ([x, over]) => ce.box(['Element', x, over]).evaluate(),
  });
  // `mode: symbol<Auto> | symbol<Manual> = Auto`: a symbol that the
  // parameter type lists.
  ce.declare('fm', {
    signature: '(x: number, mode: symbol<Auto> | symbol<Manual> = Auto) -> number',
    evaluate: ([x, mode]) =>
      ce.box(['Multiply', x, mode.symbol === 'Auto' ? 2 : 1]).evaluate(),
  });
  const overLiteral: MathJsonExpression = [
    'Function',
    ['Element', 'x', 'over'],
    'x',
    ['Optional', ['Typed', 'over', "'set'"], 'Integers'],
  ];
  const modeLiteral: MathJsonExpression = [
    'Function',
    ['If', ['Equal', 'mode', 'Auto'], ['Multiply', 2, 'x'], 'x'],
    'x',
    ['Optional', ['Typed', 'mode', "'symbol<Auto> | symbol<Manual>'"], 'Auto'],
  ];
  ce.assign('gm', ce.box(modeLiteral));

  test('a declared signature: the call that leaves out the argument receives the symbol', () => {
    expect(ce.box(['fo', 3]).json).toEqual(['fo', 3, 'Integers']);
    expect(ce.box(['fo', 3]).evaluate().symbol).toBe('True');
    expect(ce.box(['fm', 3]).json).toEqual(['fm', 3, 'Auto']);
    expect(value(ce, ['fm', 3])).toBe('6');
    expect(value(ce, ['fm', 3, 'Manual'])).toBe('3');
  });
  test('a function literal: the interpreter', () => {
    expect(ce.box(['Apply', overLiteral, 3]).evaluate().symbol).toBe('True');
    expect(value(ce, ['Apply', modeLiteral, 3])).toBe('6');
    expect(value(ce, ['gm', 3])).toBe('6');
    expect(value(ce, ['Map', 'gm', ['List', 3, 2]])).toBe('[6,4]');
  });
  test('a function literal with `mode = Auto`: compiled code gives the value of the interpreter', () => {
    for (const json of [
      ['Apply', modeLiteral, 'u'],
      ['gm', 'u'],
    ] as MathJsonExpression[]) {
      const r = compiled(ce, json);
      expect(r.success).toBe(true);
      expect(r.run!({ u: 3 })).toBe(6);
    }
    const r = compiled(ce, ['Map', 'gm', ['List', 'u', 2]]);
    expect(r.success).toBe(true);
    expect(r.run!({ u: 3 })).toEqual([6, 4]);
    // The other targets compile the `Apply` of the literal; GLSL and Python
    // decline the call of `gm`, for a reason that is not the default (GLSL
    // has no type for the parameter `mode`; Python has no lowering for a
    // call of a user function).
    for (const to of ['interval-js', 'python'] as const)
      expect(compiled(ce, ['Apply', modeLiteral, 'u'], { to }).success).toBe(
        true
      );
    // The GLSL fragment refuses the function literal: its parameter `mode` has
    // no declared type.
    const g = compiled(ce, ['Apply', modeLiteral, 'u'], { to: 'glsl' });
    expect(g.success).toBe(false);
    expect(g.diagnostic?.code).toBe('outside-fragment');
  });
  test('a function literal with `over = Integers`: compiled code declines on `Element`', () => {
    // No target compiles `Element` with a set operand, so the call declines
    // on each target. The default itself is not the reason.
    for (const to of ['javascript', 'interval-js', 'glsl', 'python'] as const)
      expect(compiled(ce, ['Apply', overLiteral, 'u'], { to }).success).toBe(
        false
      );
  });
});
