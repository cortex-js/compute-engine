import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Three cases of a call of a user function whose parameter is declared as a
 * point (`tuple<real, real>`).
 *
 * - CE-469: with `f: (broadcastable<tuple<real, real>>, tuple<real, real>)
 *   -> real`, a tuple argument binds to a parameter declared as a point, so
 *   the declared result describes the call. Before, every call of `f` with a
 *   tuple argument was typed `any`, the type of a tuple at a SCALAR
 *   parameter.
 * - CE-468: with `g: (tuple<real, real>) -> real` and a symbol typed as a
 *   list or a tensor of points that has no value, `g(L)` stays `g(L)` until
 *   `L` has a value. Before, it was an `incompatible-type` error.
 * - With `E = real | signed_infinity | nan` and `k: (tuple<E, E>) -> unknown`,
 *   a list of points whose components are typed `number` gives a call per
 *   point, as one such point is accepted as the whole argument. Before,
 *   `k(T)` was accepted for `T: tuple<number, number>`, and `k(L)` was an
 *   `incompatible-type` error for `L: list<tuple<number, number>>`.
 * - CE-1069: the same rule for a list whose points have different tuple
 *   types, such as `[(a, b, 0), (1, a, b)]` with `a` and `b` not declared.
 *   Before, the literal list was an `incompatible-type` error, a call that
 *   returns such a list was typed with an `error` member, and the evaluation
 *   gave an `incompatible-type` error for each point, while one such point
 *   was accepted.
 * - CE-1088: with `U: (tuple<integer, integer>) -> integer`, the point
 *   `(1.5, 2)` given as the whole argument is an `incompatible-type` error,
 *   as it is as an element of a mapped list. Before, `U((1.5, 2))` was
 *   valid, typed `integer`, and gave `1.5`.
 * - CE-1135: the same check at a union parameter with a tuple arm. With
 *   `F: (tuple<integer, integer> | string) -> unknown`, the point `(1.5, 2)`
 *   is refused, because the tuple arm refutes a component and a string is
 *   not a tuple. Before, only one tuple type was checked, and `F((1.5, 2))`
 *   with the body `p ↦ p` gave `(1.5, 2)`.
 */

const POINT = 'tuple<real, real>';
const P = (a: number, b: number) => ['Tuple', a, b];

/** `f(p, q) = p.x + p.y + q.x + 2 q.y`, declared with a `broadcastable`
 * point parameter and a point parameter. */
function engineF(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('f', `(broadcastable<${POINT}>, ${POINT}) -> real`);
  ce.assign(
    'f',
    ce.box([
      'Function',
      [
        'Add',
        ['PointX', 'p'],
        ['PointY', 'p'],
        ['PointX', 'q'],
        ['Multiply', 2, ['PointY', 'q']],
      ],
      'p',
      'q',
    ])
  );
  return ce;
}

/** `g(p) = p.x + 10 p.y`, declared `(tuple<real, real>) -> real`. */
function engineG(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('g', `(${POINT}) -> real`);
  ce.assign(
    'g',
    ce.box([
      'Function',
      ['Add', ['PointX', 'p'], ['Multiply', 10, ['PointY', 'p']]],
      'p',
    ])
  );
  return ce;
}

describe('CE-469: a tuple at a parameter declared as a point', () => {
  test.each([
    [
      'a matrix of points',
      ['List', ['List', P(1, 2), P(3, 4)], ['List', P(5, 6), P(7, 8)]],
      'matrix<real^(2x2)>',
      '[[6,10],[14,18]]',
    ],
    [
      'a list of points',
      ['List', P(1, 2), P(3, 4)],
      'vector<real^2>',
      '[6,10]',
    ],
    ['one point', P(1, 2), 'real', '6'],
  ])('%s', (_name, arg, type, value) => {
    const ce = engineF();
    const call = ce.box(['f', arg, P(1, 1)] as any);
    expect(call.type.toString()).toBe(type);
    const v = call.evaluate();
    expect(v.toString()).toBe(value);
    expect(v.type.matches(call.type)).toBe(true);
  });
});

describe('CE-468: a valueless list of points keeps the call', () => {
  test.each([
    ['L', `list<${POINT}>`, 'list<real>'],
    ['T', `tensor<${POINT}>`, 'tensor<real>'],
    ['S', `list<list<${POINT}>>`, 'list<list<real>>'],
    ['M', `matrix<${POINT}>`, 'list<list<real>>'],
    ['B', `broadcastable<${POINT}>`, 'broadcastable<real>'],
  ])('g(%s) with %s stays symbolic', (name, decl, type) => {
    const ce = engineG();
    ce.declare(name, decl);
    const call = ce.box(['g', name]);
    expect(call.type.toString()).toBe(type);
    const v = call.evaluate();
    expect(v.toString()).toBe(`g(${name})`);
    expect(v.type.matches(call.type)).toBe(true);
  });

  test('the call maps once the symbol has a value', () => {
    const ce = engineG();
    ce.declare('L', `list<${POINT}>`);
    const call = ce.box(['g', 'L']);
    expect(call.evaluate().toString()).toBe('g(L)');
    ce.assign('L', ce.box(['List', P(1, 2), P(3, 4)]));
    expect(call.evaluate().toString()).toBe('[21,43]');
  });

  test('the asynchronous evaluation keeps the call', async () => {
    const ce = engineG();
    ce.declare('L', `list<${POINT}>`);
    expect((await ce.box(['g', 'L']).evaluateAsync()).toString()).toBe('g(L)');
  });

  test('an Epsil function with an annotated point parameter', () => {
    // An Epsil declaration must have a value, so the host declares `M`
    // with no value.
    const ce = new ComputeEngine();
    ce.declare('M', 'list<tuple<real, real>>');
    const r = executeEpsil(
      ce,
      'function h(p: tuple<real, real>) -> real { p.x + 10 * p.y }\nh(M)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('h(M)');
  });
});

describe('CE-468: the held call keeps its binding', () => {
  test('a definition of the same name in the current scope does not take the held call', async () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'list<tuple<real, real>>');
    executeEpsil(
      ce,
      'function h(p: tuple<real, real>) -> real { p.x + 10 * p.y }'
    );
    const call = ce.box(['h', 'M']);
    ce.pushScope();
    ce.declare('h', '(number) -> number');
    const v = call.evaluate();
    const w = await call.evaluateAsync();
    ce.popScope();
    expect(v.toString()).toBe('h(M)');
    expect(v.baseDefinition).toBe(call.baseDefinition);
    expect(w.baseDefinition).toBe(call.baseDefinition);
  });

  test('the same for a function held as a value', () => {
    const ce = engineG();
    ce.declare('L', `list<${POINT}>`);
    const call = ce.box(['g', 'L']);
    ce.pushScope();
    ce.declare('g', '(number) -> number');
    const v = call.evaluate();
    ce.popScope();
    expect(v.toString()).toBe('g(L)');
    expect(v.baseDefinition).toBe(call.baseDefinition);
  });
});

describe('a list of points accepted by the rule for one point', () => {
  const E = 'real | signed_infinity | nan';
  const NUMBER_POINT = 'tuple<number, number>';

  /** `k(p) = p.x + p.y`, declared with an extended-real point parameter,
   * and symbols for one point, a list and a matrix of points, and a point
   * or a list of points, all with `number` components. */
  function engineK(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('k', `(tuple<${E}, ${E}>) -> unknown`);
    ce.assign('k', ce.parse('p \\mapsto p.x + p.y'));
    ce.declare('T', NUMBER_POINT);
    ce.declare('L', `list<${NUMBER_POINT}>`);
    ce.declare('M', `matrix<${NUMBER_POINT}>`);
    ce.declare('U', `${NUMBER_POINT} | list<${NUMBER_POINT}>`);
    return ce;
  }

  test('the call over a list or a matrix of points is a call per point', () => {
    const ce = engineK();
    expect(ce.box(['k', 'T']).type.toString()).toBe(
      'nan | real | signed_infinity'
    );
    expect(ce.box(['k', 'L']).type.toString()).toBe(
      'list<nan | real | signed_infinity>'
    );
    expect(ce.box(['k', 'M']).type.toString()).toBe(
      'list<list<nan | real | signed_infinity>>'
    );
    expect(ce.box(['k', 'U']).type.toString()).toBe(
      'list<nan | real | signed_infinity> | nan | real | signed_infinity'
    );
  });

  test('a point type the parameter refuses is refused in a list', () => {
    const ce = engineK();
    ce.declare('S', 'list<tuple<integer, string>>');
    expect(ce.box(['k', 'S']).type.toString()).toBe('error');
  });

  test('the evaluation maps over the points', () => {
    const ce = engineK();
    ce.assign('L', ce.box(['List', P(1, 2), P(3, 4)]));
    expect(ce.box(['k', 'L']).evaluate().toString()).toBe('[3,7]');
  });

  test('the compiled call maps over the points', () => {
    const ce = engineK();
    const r = compile(ce.box(['k', 'L']));
    expect(r.success).toBe(true);
    expect(r.run!({ L: [[1, 2], [3, Infinity]] })).toEqual([3, Infinity]);
  });
});

describe('CE-1069: a list of points with different tuple types', () => {
  const X = 'nan | real | signed_infinity';
  const RESULT = `tuple<number, ${X}, ${X}>`;
  const LITERAL = 'W(\\left[(a,b,0),(1,a,b)\\right],2)';

  /** `W(p, s) = (s p.x, p.y, p.z)` with a point parameter, and `K(a, b)`,
   * declared to return a list whose points have one of two tuple types.
   * `a` and `b` are not declared. */
  function engineW(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('W', {
      signature: `(tuple<${X}, ${X}, ${X}>, unknown) -> ${RESULT}`,
    });
    ce.parse('W(p,s):=(s p.x, p.y, p.z)').evaluate();
    ce.declare('K', {
      signature:
        '(unknown, unknown) -> list<tuple<integer, unknown, unknown> | tuple<unknown, unknown, integer>>',
    });
    ce.parse('K(a,b):=\\left[(a,b,0),(1,a,b)\\right]').evaluate();
    return ce;
  }

  test('one point with undeclared components is accepted', () => {
    const e = engineW().parse('W((a,b,0),2)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe(RESULT);
  });

  test('the literal list is a call per point', () => {
    const e = engineW().parse(LITERAL);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe(`list<${RESULT}>`);
  });

  test('a call that returns such a list has no error member', () => {
    const e = engineW().parse('W(K(a,b),2)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe(`list<${RESULT}>`);
  });

  test('the evaluation binds each point as a direct call does', () => {
    const ce = engineW();
    expect(ce.parse('W((a,b,0),2)').evaluate().toString()).toBe('(2a, b, 0)');
    expect(ce.parse(LITERAL).evaluate().toString()).toBe(
      '[(2a, b, 0),(2, a, b)]'
    );
  });

  test('the evaluation with values gives the mapped points', () => {
    const ce = engineW();
    ce.assign('a', 1);
    ce.assign('b', 2);
    expect(JSON.stringify(ce.parse('W(K(a,b),2)').evaluate().json)).toBe(
      JSON.stringify(['List', ['Tuple', 2, 2, 0], ['Tuple', 2, 1, 2]])
    );
  });

  test('a list with one refused point type is refused', () => {
    const ce = engineW();
    ce.declare(
      'S',
      'list<tuple<integer, unknown, unknown> | tuple<integer, string, integer>>'
    );
    const e = ce.box(['W', 'S', 2]);
    expect(e.isValid).toBe(false);
    expect(e.type.toString()).toBe('error');
  });

  test('a mapped point whose value is refused is an error in its cell', () => {
    const ce = engineW();
    const e = ce.box([
      'W',
      ['List', ['Tuple', 'a', 'b', 0], ['Tuple', 1, { str: 'x' }, 2]],
      2,
    ]);
    const v = e.evaluate();
    expect(v.ops![0].toString()).toBe('(2a, b, 0)');
    expect(v.ops![1].operator).toBe('Error');
  });

  test('a symbolic point with no value is bound as in a direct call', () => {
    const ce = engineW();
    ce.declare('q', 'tuple<unknown, unknown, integer>');
    expect(ce.box(['W', 'q', 2]).evaluate().operator).toBe('Tuple');
    const e = ce.box(['W', ['List', 'q'], 2]);
    expect(e.type.toString()).toBe(`list<${RESULT}>`);
    expect(e.evaluate().ops![0].operator).toBe('Tuple');
  });

  test('an alias of a union of points is read arm by arm', () => {
    const ce = engineW();
    ce.declareType(
      'PP',
      'tuple<integer, unknown, unknown> | tuple<unknown, unknown, integer>',
      { alias: true }
    );
    ce.declare('S1', 'list<PP | tuple<unknown, integer, unknown>>');
    const e = ce.box(['W', 'S1', 2]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe(`list<${RESULT}>`);
  });
});

describe('CE-1069: each component of a mapped point is checked', () => {
  /** `U(p) = p.x` with a point parameter, `B(p) = p.x` with a
   * `broadcastable` point parameter, and `V(p) = p.x` with a ranged first
   * component. */
  function engineUBV(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('U', '(tuple<integer, integer>) -> integer');
    ce.parse('U(p) := p.x').evaluate();
    ce.declare('B', '(broadcastable<tuple<integer, integer>>) -> integer');
    ce.parse('B(p) := p.x').evaluate();
    ce.declare('V', '(tuple<real<0..1>, real, real>) -> real');
    ce.parse('V(p) := p.x').evaluate();
    return ce;
  }
  const cell = (ce: ComputeEngine, f: string, point: unknown[]) =>
    ce.box([f, ['List', point]]).evaluate().ops![0];

  test('a symbolic component that can fit is bound', () => {
    const ce = engineUBV();
    expect(cell(ce, 'U', ['Tuple', 1, 'a']).toString()).toBe('1');
    expect(cell(ce, 'V', ['Tuple', 0.5, 'a', 0]).toString()).toBe('0.5');
  });

  test('a concrete component outside its type is an error', () => {
    const ce = engineUBV();
    expect(cell(ce, 'U', ['Tuple', 1.5, 'a']).operator).toBe('Error');
    expect(cell(ce, 'B', ['Tuple', 1.5, 'a']).operator).toBe('Error');
    expect(cell(ce, 'V', ['Tuple', 5, 'a', 0]).operator).toBe('Error');
    ce.assign('q', ce.box(['Tuple', 5, 0, 0]));
    expect(ce.box(['V', ['List', 'q']]).evaluate().ops![0].operator).toBe(
      'Error'
    );
  });
});

describe('CE-1088: each component of a point given as the whole argument is checked', () => {
  /** `U(p) = p.x` with the point parameter `tuple<integer, integer>`, and
   * `V(p) = p.x` with a ranged first component. */
  function engineUV(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('U', '(tuple<integer, integer>) -> integer');
    ce.parse('U(p) := p.x').evaluate();
    ce.declare('V', '(tuple<real<0..1>, real, real>) -> real');
    ce.parse('V(p) := p.x').evaluate();
    return ce;
  }
  const errorCode = (e: { operator: string; op1: { op1: { string?: string } } }) =>
    e.operator === 'Error' ? e.op1.op1.string : undefined;

  test('a point literal with a component outside its type is refused when it is boxed', () => {
    const ce = engineUV();
    for (const point of [
      ['Tuple', 1.5, 2],
      ['Tuple', ['Rational', 3, 2], 2],
      ['Tuple', 1.5, 'a'],
    ]) {
      const call = ce.box(['U', point]);
      expect(call.isValid).toBe(false);
      expect(errorCode(call.evaluate() as any)).toBe('incompatible-type');
    }
    expect(ce.box(['V', ['Tuple', 5, 0, 0]]).isValid).toBe(false);
  });

  test('a symbol that holds such a point is refused when the call is boxed', () => {
    const ce = engineUV();
    ce.assign('r', ce.box(['Tuple', 1.5, 2]));
    const call = ce.box(['U', 'r']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.evaluate() as any)).toBe('incompatible-type');
  });

  test('an argument whose value is such a point is refused when the call is evaluated', () => {
    const ce = engineUV();
    ce.assign('q', ce.box(['Tuple', 1, 2]));
    const call = ce.box(['U', 'q']);
    expect(call.evaluate().toString()).toBe('1');
    ce.assign('q', ce.box(['Tuple', 2.5, 2]));
    expect(errorCode(call.evaluate() as any)).toBe('incompatible-type');
    const read = ce.box(['U', ['At', ['List', ['Tuple', 1.5, 2]], 1]]);
    expect(errorCode(read.evaluate() as any)).toBe('incompatible-type');
  });

  test('an annotated parameter of a function literal refuses such a point', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', ['At', 'p', 1], ['Typed', 'p', "'tuple<integer, integer>'"]],
      ['Tuple', 1.5, 2],
    ]);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.evaluate() as any)).toBe('incompatible-type');
  });

  test('a point whose components can fit is bound', () => {
    const ce = engineUV();
    expect(ce.box(['U', ['Tuple', 1, 2]]).evaluate().toString()).toBe('1');
    expect(ce.box(['V', ['Tuple', 0.5, 0, 0]]).evaluate().toString()).toBe(
      '0.5'
    );
    ce.declare('x', 'real');
    const call = ce.box(['U', ['Tuple', 'x', 2]]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('x');
    // A `NaN` point is accepted at a point parameter of its arity.
    ce.declare('H', '(tuple<real, real>) -> real');
    ce.parse('H(p) := p.x').evaluate();
    expect(
      ce.box(['H', ['Tuple', 'NaN', 'NaN']]).evaluate().toString()
    ).toBe('NaN');
  });
});

describe('CE-1135: each component of a point is checked at a union parameter with a tuple arm', () => {
  /** `F(p) = p` with the parameter `tuple<integer, integer> | string`. */
  function engineF(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('F', '(tuple<integer, integer> | string) -> unknown');
    ce.parse('F(p) := p').evaluate();
    return ce;
  }
  const errorCode = (e: {
    operator: string;
    op1: { op1: { string?: string } };
  }) => (e.operator === 'Error' ? e.op1.op1.string : undefined);

  test('a point literal with a component outside its position is refused when it is boxed', () => {
    const ce = engineF();
    for (const point of [
      ['Tuple', 1.5, 2],
      ['Tuple', ['Rational', 3, 2], 2],
      ['Tuple', 1.5, 'a'],
    ]) {
      const call = ce.box(['F', point]);
      expect(call.isValid).toBe(false);
      expect(errorCode(call.evaluate() as any)).toBe('incompatible-type');
    }
  });

  test('a symbol that holds such a point is refused when the call is boxed', () => {
    const ce = engineF();
    ce.assign('r', ce.box(['Tuple', 1.5, 2]));
    const call = ce.box(['F', 'r']);
    expect(call.isValid).toBe(false);
    expect(errorCode(call.evaluate() as any)).toBe('incompatible-type');
  });

  test('an argument whose value is such a point is refused when the call is evaluated', () => {
    const ce = engineF();
    ce.assign('q', ce.box(['Tuple', 1, 2]));
    const call = ce.box(['F', 'q']);
    expect(call.evaluate().toString()).toBe('(1, 2)');
    ce.assign('q', ce.box(['Tuple', 2.5, 2]));
    expect(errorCode(call.evaluate() as any)).toBe('incompatible-type');
  });

  test('a value that an arm of the union accepts is bound', () => {
    const ce = engineF();
    expect(
      ce
        .box(['F', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('(1, 2)');
    expect(
      ce
        .box(['F', { str: 'ab' }])
        .evaluate()
        .toString()
    ).toBe('"ab"');
    ce.declare('x', 'real');
    const call = ce.box(['F', ['Tuple', 'x', 2]]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toBe('(x, 2)');
    // A tuple arm of another arity does not refuse a point that another
    // arm accepts.
    ce.declare(
      'G',
      '(tuple<integer, integer, integer> | tuple<real, real>) -> unknown'
    );
    ce.parse('G(p) := p').evaluate();
    expect(
      ce
        .box(['G', ['Tuple', 1.5, 2]])
        .evaluate()
        .toString()
    ).toBe('(1.5, 2)');
    // An arm that accepts every collection accepts the point.
    ce.declare('K', '(tuple<integer, integer> | collection) -> unknown');
    ce.parse('K(p) := p').evaluate();
    expect(
      ce
        .box(['K', ['Tuple', 1.5, 2]])
        .evaluate()
        .toString()
    ).toBe('(1.5, 2)');
  });
});
