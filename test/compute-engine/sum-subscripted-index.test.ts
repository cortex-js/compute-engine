import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// A subscript whose index is the integer variable of an enclosing binder
// (`a_k` in `\sum_{k=1}^{3} a_k`) is the base indexed by that variable, read
// by value. Outside such a binder, `a_k` is the one symbol `a_k`.

const evaluated = (latex: string, ce = new ComputeEngine()) =>
  ce.parse(latex).evaluate().json;

const boxed = (json: MathJsonExpression, ce = new ComputeEngine()) =>
  ce.box(json).evaluate().json;

describe('a subscript on the index of a sum or a product', () => {
  test('the LaTeX form gives one term for each value of the index', () => {
    expect(evaluated('\\sum_{k=1}^{3} a_k')).toEqual([
      'Add',
      'a_1',
      'a_2',
      'a_3',
    ]);
    expect(evaluated('\\prod_{k=1}^{3} a_k')).toEqual([
      'Multiply',
      'a_1',
      'a_2',
      'a_3',
    ]);
    expect(evaluated('\\sum_{k=1}^{3} \\alpha_k')).toEqual([
      'Add',
      'alpha_1',
      'alpha_2',
      'alpha_3',
    ]);
  });

  test('the MathJSON form gives one term for each value of the index', () => {
    expect(
      boxed(['Sum', ['Subscript', 'a', 'k'], ['Limits', 'k', 1, 3]])
    ).toEqual(['Add', 'a_1', 'a_2', 'a_3']);
  });

  test('the canonical form marks the index as read by value', () => {
    const ce = new ComputeEngine();
    const sum = ce.parse('\\sum_{k=1}^{3} a_k');
    expect(sum.json).toEqual([
      'Sum',
      ['Subscript', 'a', ['Delimiter', 'k']],
      ['Limits', 'k', 1, 3],
    ]);
    // The LaTeX reads back with the same meaning.
    expect(ce.parse(sum.latex).isSame(sum)).toBe(true);
    // The term keeps its meaning when it is read without the sum.
    expect(ce.box(sum.op1.json).json).toEqual(sum.op1.json);
  });

  test('the terms read the values of the indexed symbols', () => {
    const ce = new ComputeEngine();
    ce.assign('a_1', 1);
    ce.assign('a_2', 2);
    ce.assign('a_3', 3);
    expect(evaluated('\\sum_{k=1}^{3} a_k', ce)).toEqual(6);
    expect(evaluated('\\sum_{k=1}^{3} k a_k', ce)).toEqual(14);
  });

  test('a term with a power of a free variable', () => {
    expect(evaluated('\\sum_{k=1}^{2} a_kx^k')).toEqual([
      'Add',
      ['Multiply', 'a_2', ['Power', 'x', 2]],
      ['Multiply', 'a_1', 'x'],
    ]);
  });

  test('nested sums index each base by its own index', () => {
    expect(evaluated('\\sum_{i=1}^{2}\\sum_{j=1}^{2} a_{i}b_j')).toEqual([
      'Add',
      ['Multiply', 'a_1', 'b_1'],
      ['Multiply', 'a_2', 'b_1'],
      ['Multiply', 'a_1', 'b_2'],
      ['Multiply', 'a_2', 'b_2'],
    ]);
  });

  test('an index whose name has a subscript stays the index', () => {
    expect(evaluated('\\sum_{a_k=1}^{3} a_k')).toEqual(6);
  });

  test('each factor of a juxtaposition of groups is indexed', () => {
    expect(evaluated('\\sum_{i=1}^{2} (x_i - 1)(y_i - 2)')).toEqual([
      'Add',
      ['Multiply', ['Add', 'x_1', -1], ['Add', 'y_1', -2]],
      ['Multiply', ['Add', 'x_2', -1], ['Add', 'y_2', -2]],
    ]);
    expect(evaluated('\\sum_{k=1}^{2} a_k^2(x+1)')).toEqual([
      'Add',
      ['Multiply', ['Add', 'x', 1], ['Power', 'a_1', 2]],
      ['Multiply', ['Add', 'x', 1], ['Power', 'a_2', 2]],
    ]);
  });

  test('a subscript that is not an index stays a part of the name', () => {
    expect(evaluated('\\sum_{k=1}^{3} x_{max}')).toEqual([
      'Multiply',
      3,
      'x_max',
    ]);
  });
});

describe('a joined name that stays a name in a sum', () => {
  test('a name that the host assigned', () => {
    const ce = new ComputeEngine();
    ce.assign('a_n', 3);
    expect(evaluated('\\sum_{n=1}^{3} a_n', ce)).toEqual(9);
    expect(
      boxed(['Sum', ['Subscript', 'a', 'n'], ['Limits', 'n', 1, 3]], ce)
    ).toEqual(9);
  });

  test('a name that the host declared, on a list base', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'list<integer>');
    ce.assign('a', ce.box(['List', 10, 20, 30]));
    ce.assign('a_k', 100);
    expect(evaluated('\\sum_{k=1}^{3} a_k', ce)).toEqual(300);
  });

  test('a name that the engine declared when it first read it is not a declaration', () => {
    const ce = new ComputeEngine();
    ce.parse('a_k').evaluate();
    expect(evaluated('\\sum_{k=1}^{3} a_k', ce)).toEqual([
      'Add',
      'a_1',
      'a_2',
      'a_3',
    ]);
  });

  test('the index of an inner sum', () => {
    expect(evaluated('\\sum_{k=1}^{2}\\sum_{a_k=1}^{3} a_k')).toEqual(12);
  });

  test('the variable of an inner integral, limit or function', () => {
    expect(evaluated('\\sum_{k=1}^{2} \\int_0^1 x_k^2\\,dx_k')).toEqual([
      'Rational',
      2,
      3,
    ]);
    expect(evaluated('\\sum_{k=1}^{2} \\lim_{a_k\\to 0} a_k')).toEqual(0);
    expect(evaluated('\\sum_{k=1}^{2} (a_k \\mapsto a_k^2)(3)')).toEqual(18);
  });

  test('the head of a call that the host declared', () => {
    const ce = new ComputeEngine();
    ce.declare('f_k', 'function');
    expect(evaluated('\\sum_{k=1}^{2} f_k(x)', ce)).toEqual([
      'Multiply',
      2,
      ['f_k', 'x'],
    ]);
  });
});

// A subscripted function in the body of a sum (`f_k(x)`) is one function for
// each value of the index, as the call `f_1(x)` of one term is.
describe('a call of a function subscripted by the index of a sum', () => {
  test('each term calls its own function', () => {
    expect(evaluated('\\sum_{k=1}^{2} f_k(x)')).toEqual([
      'Add',
      ['f_2', 'x'],
      ['f_1', 'x'],
    ]);
    expect(evaluated('\\prod_{k=1}^{2} f_k(x)')).toEqual([
      'Multiply',
      ['f_2', 'x'],
      ['f_1', 'x'],
    ]);
    expect(evaluated('\\sum_{k=1}^{3} c_k \\phi_k(x)')).toEqual([
      'Add',
      ['Multiply', 'c_1', ['phi_1', 'x']],
      ['Multiply', 'c_2', ['phi_2', 'x']],
      ['Multiply', 'c_3', ['phi_3', 'x']],
    ]);
    expect(evaluated('\\sum_{k=1}^{2} 3f_k(x)g(x)')).toEqual([
      'Add',
      ['Multiply', 3, ['g', 'x'], ['f_2', 'x']],
      ['Multiply', 3, ['g', 'x'], ['f_1', 'x']],
    ]);
  });

  test('a call with no argument or with several arguments', () => {
    expect(evaluated('\\sum_{k=1}^{2} f_k()')).toEqual([
      'Add',
      ['f_2'],
      ['f_1'],
    ]);
    expect(evaluated('\\sum_{k=1}^{2} f_k(x, y)')).toEqual([
      'Add',
      ['f_2', 'x', 'y'],
      ['f_1', 'x', 'y'],
    ]);
  });

  test('a power of a group after the coefficient is a term of a power series', () => {
    expect(evaluated('\\sum_{k=0}^{2} a_k(x-1)^k')).toEqual([
      'Add',
      ['Multiply', 'a_2', ['Power', ['Add', 'x', -1], 2]],
      ['Multiply', 'a_1', ['Add', 'x', -1]],
      'a_0',
    ]);
    const ce = new ComputeEngine();
    [1, 2, 3, 4].forEach((v, k) => ce.assign(`a_${k}`, v));
    // 1 + 2·2 + 3·4 + 4·8
    expect(
      ce.parse('\\sum_{k=0}^{3} a_k(x-1)^k').subs({ x: 3 }).evaluate().json
    ).toEqual(49);
    // With a hook that does not decide, as without a hook.
    expect(
      new ComputeEngine()
        .parse('\\sum_{k=0}^{2} a_k(x-1)^k', {
          resolveApplication: () => undefined,
        })
        .evaluate().json
    ).toEqual(evaluated('\\sum_{k=0}^{2} a_k(x-1)^k'));
  });

  test('a group that holds the head is a product', () => {
    // As `x_1(x_1-1)` is the product `x_1·(x_1-1)`.
    expect(evaluated('\\sum_{i=1}^{2} x_i(x_i-1)')).toEqual([
      'Add',
      ['Multiply', 'x_1', ['Add', 'x_1', -1]],
      ['Multiply', 'x_2', ['Add', 'x_2', -1]],
    ]);
    // Several arguments are a call, as `f_1(f_1, x)` is.
    expect(evaluated('\\sum_{k=1}^{2} f_k(f_k, x)')).toEqual([
      'Add',
      ['f_1', 'f_1', 'x'],
      ['f_2', 'f_2', 'x'],
    ]);
  });

  test('the MathJSON form reads each term as the LaTeX form does', () => {
    const ce = new ComputeEngine();
    ce.assign('w_1', 2);
    ce.assign('w_2', 3);
    // 2·4 + 3·4
    expect(
      boxed(
        ['Sum', ['Apply', ['Subscript', 'w', 'i'], 4], ['Limits', 'i', 1, 2]],
        ce
      )
    ).toEqual(20);
  });

  test('a term whose name has a value or a type is a product, as the term alone is', () => {
    const ce = new ComputeEngine();
    ce.assign('w_1', 2);
    ce.assign('w_2', 3);
    ce.assign('x_1', 5);
    ce.assign('x_2', 7);
    // 2·4 + 3·6, as `w_1(x_1-1) + w_2(x_2-1)` gives.
    expect(evaluated('\\sum_{i=1}^{2} w_i(x_i-1)', ce)).toEqual(26);
    expect(evaluated('w_1(x_1-1)+w_2(x_2-1)', ce)).toEqual(26);
    const typed = new ComputeEngine();
    typed.declare('v_1', 'real');
    expect(evaluated('\\sum_{i=1}^{2} v_i(x-1)', typed)).toEqual([
      'Add',
      ['Multiply', 'v_1', ['Add', 'x', -1]],
      ['v_2', ['Add', 'x', -1]],
    ]);
  });

  test('a call in the arguments is not a reference to the head', () => {
    // As `f_1(f_1(x))` is a call of a call.
    expect(evaluated('\\sum_{k=1}^{2} f_k(f_k(x))')).toEqual([
      'Add',
      ['f_2', ['f_2', 'x']],
      ['f_1', ['f_1', 'x']],
    ]);
  });

  test('an outer index that is the joined name is a factor', () => {
    // `a_k` is the index of the outer sum: `a_k(3)` is `3a_k`.
    expect(evaluated('\\sum_{a_k=1}^{2}\\sum_{k=1}^{2} a_k(3)')).toEqual(18);
    // A binder between the two keeps its own reading of the arguments.
    expect(
      evaluated('\\sum_{a_k=1}^{2}\\sum_{j=1}^{2}\\sum_{k=1}^{2} a_k(b_j)')
    ).toEqual([
      'Add',
      ['Multiply', 6, 'b_1'],
      ['Multiply', 6, 'b_2'],
    ]);
    // With a hook that does not decide, as without a hook.
    expect(
      new ComputeEngine()
        .parse('\\sum_{a_k=1}^{2}\\sum_{k=1}^{2} a_k(3)', {
          resolveApplication: () => undefined,
        })
        .evaluate().json
    ).toEqual(18);
  });

  test('a name that the engine inferred as a function is not a declaration', () => {
    const ce = new ComputeEngine();
    ce.parse('f_k(x)').evaluate();
    expect(evaluated('\\sum_{k=1}^{2} f_k(x)', ce)).toEqual([
      'Add',
      ['f_2', 'x'],
      ['f_1', 'x'],
    ]);
  });

  test('the LaTeX of the sum reads back with the same value', () => {
    expect(new ComputeEngine().parse('\\sum_{k=1}^{2} f_k(x, y)').latex).toBe(
      '\\sum_{k=1}^2\\operatorname{apply}(f_{(k)}, x, y)'
    );
    for (const latex of [
      '\\sum_{k=1}^{2} f_k(x)',
      '\\sum_{k=1}^{2} f_k()',
      '\\sum_{k=1}^{2} f_k(x, y)',
    ]) {
      const ce = new ComputeEngine();
      const sum = ce.parse(latex);
      expect(ce.parse(sum.latex).evaluate().json).toEqual(
        sum.evaluate().json
      );
    }
  });

  test('a resolveApplication hook reads the written name', () => {
    const heads: string[] = [];
    const parse = (decision: 'apply' | 'multiply' | undefined) =>
      new ComputeEngine()
        .parse('\\sum_{k=1}^{2} a_k(x)', {
          resolveApplication: ({ head }) => {
            heads.push(head);
            return decision;
          },
        })
        .evaluate().json;
    expect(parse('multiply')).toEqual([
      'Add',
      ['Multiply', 'a_1', 'x'],
      ['Multiply', 'a_2', 'x'],
    ]);
    expect(parse('apply')).toEqual(['Add', ['a_2', 'x'], ['a_1', 'x']]);
    // With no decision, the reading is the one without a hook.
    expect(parse(undefined)).toEqual(['Add', ['a_2', 'x'], ['a_1', 'x']]);
    expect(heads).toEqual(['a_k', 'a_k', 'a_k']);
  });

  test('the index of an inner sum before a group stays one name', () => {
    // `f_k` is the index of the inner sum: `f_k(x)` is the product `f_k·x`.
    expect(evaluated('\\sum_{k=1}^{2}\\sum_{f_k=1}^{2} f_k(x)')).toEqual([
      'Multiply',
      6,
      'x',
    ]);
  });
});

describe('a subscript on a variable that is not the index of a binder', () => {
  test('outside a binder, the subscript is a part of the name', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('a_k').json).toEqual('a_k');
    expect(ce.box(['Subscript', 'a', 'k']).json).toEqual('a_k');
  });

  test('a function literal parameter shadows the index of the sum', () => {
    // In the body of the literal, `k` is the parameter, not the index.
    expect(
      boxed([
        'Sum',
        ['Apply', ['Function', ['Subscript', 'a', 'k'], 'k'], 5],
        ['Limits', 'k', 1, 3],
      ])
    ).toEqual(['Multiply', 3, 'a_k']);
  });

  test('the variable of a derivative is not an index', () => {
    expect(boxed(['D', ['Subscript', 'c', 'x'], 'x'])).toEqual(0);
  });

  test('a comprehension over integers indexes the base', () => {
    const ce = new ComputeEngine();
    const list = ce
      .box([
        'Comprehension',
        ['Subscript', 'q', 'i'],
        ['Element', 'i', ['Range', 1, 3]],
      ])
      .evaluate();
    expect([...list.each()].map((x) => x.json)).toEqual(['q_1', 'q_2', 'q_3']);
  });
});

// The condition of a membership clause (`a_{k+1} > 0` in
// `k \in \{1,2,3\}, a_{k+1} > 0`) is read in the scope of the index, as the
// body is. A comparison over a subscript of an unknown base is typed
// `boolean | list<boolean | list<any>>`, because the subscript may be a
// list, and the clause accepts it as a condition.
describe('a subscript on the index in the condition of a sum', () => {
  const withValues = () => {
    const ce = new ComputeEngine();
    ce.assign('a_1', 1);
    ce.assign('a_2', -1);
    ce.assign('a_3', 2);
    ce.assign('a_4', 3);
    return ce;
  };

  test('a condition that reads the next term gives the sum of the kept terms', () => {
    // k = 2 and k = 3 are kept (a_3 = 2 and a_4 = 3 are positive): a_2 + a_3.
    expect(
      evaluated('\\sum_{k\\in\\{1,2,3\\}, a_{k+1}>0} a_k', withValues())
    ).toEqual(1);
    expect(
      evaluated('\\prod_{k\\in\\{1,2,3\\}, a_{k+1}>0} a_k', withValues())
    ).toEqual(-2);
    expect(
      boxed(
        [
          'Sum',
          ['Subscript', 'a', 'k'],
          [
            'Element',
            'k',
            ['Set', 1, 2, 3],
            ['Greater', ['Subscript', 'a', ['Add', 'k', 1]], 0],
          ],
        ],
        withValues()
      )
    ).toEqual(1);
  });

  test('the condition reads a subscript on the index by value, as the body does', () => {
    const ce = new ComputeEngine();
    const sum = ce.parse('\\sum_{k\\in\\{1,2,3\\}, a_k>0} a_k');
    expect(sum.json).toEqual([
      'Sum',
      ['Subscript', 'a', ['Delimiter', 'k']],
      [
        'Element',
        'k',
        ['Set', 1, 2, 3],
        ['Less', 0, ['Subscript', 'a', ['Delimiter', 'k']]],
      ],
    ]);
    // a_1 and a_3 are positive.
    expect(
      evaluated('\\sum_{k\\in\\{1,2,3\\}, a_k>0} a_k', withValues())
    ).toEqual(3);
  });

  test('a condition that may be a string is refused', () => {
    // The error names the type of the condition.
    expect(
      new ComputeEngine().box([
        'Sum',
        'k',
        [
          'Element',
          'k',
          ['Set', 1, 2, 3],
          ['If', ['Greater', 'k', 1], 'True', "'ab'"],
        ],
      ]).json
    ).toEqual([
      'Sum',
      'k',
      [
        'Element',
        'k',
        ['Set', 1, 2, 3],
        [
          'Error',
          ['ErrorCode', "'incompatible-type'", "''boolean''", "'boolean | string'"],
        ],
      ],
    ]);
  });
});

describe('the type of a condition that may be a boolean', () => {
  // The condition of `Element` is checked with
  // `isBooleanOrBroadcastableBooleanType()` (`src/common/type/utils.ts`).
  const condition = (
    declare: (ce: ComputeEngine) => void,
    json: MathJsonExpression
  ) => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    declare(ce);
    const sum = ce.box(['Sum', 'k', ['Element', 'k', ['Set', 1, 2, 3], json]]);
    return sum.op2.op3.operator;
  };

  test('a list of any type is no evidence of booleans', () => {
    expect(
      condition((ce) => ce.declare('L', 'list<any>'), ['If', 'c', 'True', 'L'])
    ).toBe('Error');
  });

  test('a transparent alias of a list of booleans is unfolded', () => {
    expect(
      condition((ce) => {
        ce.declareType('flags', 'list<boolean>', { alias: true });
        ce.declare('F', 'flags');
      }, ['If', 'c', 'True', 'F'])
    ).toBe('If');
  });

  test('a transparent alias of a union of lists of booleans is unfolded', () => {
    expect(
      condition((ce) => {
        ce.declareType('masks', 'list<boolean> | matrix<boolean>', {
          alias: true,
        });
        ce.declare('M', 'masks');
      }, ['If', 'c', 'True', 'M'])
    ).toBe('If');
  });

  test('a nominal type stays opaque', () => {
    expect(
      condition((ce) => {
        ce.declareType('flags', 'list<boolean>');
        ce.declare('F', 'flags');
      }, ['If', 'c', 'True', 'F'])
    ).toBe('Error');
  });
});
