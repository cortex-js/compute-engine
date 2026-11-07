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

  test('the head of a call', () => {
    // `f_k(x)` stays a call of `f_k`, not the product `f_k·x`.
    const ce = new ComputeEngine();
    const sum = ce.parse('\\sum_{k=1}^{2} f_k(x)');
    expect(sum.op1.operator).toBe('f_k');
    // Also after another factor of a juxtaposition.
    const basis = ce.parse('\\sum_{k=1}^{2} c_k \\phi_k(x)').evaluate();
    expect(basis.json).toEqual([
      'Add',
      ['Multiply', 'c_1', ['phi_k', 'x']],
      ['Multiply', 'c_2', ['phi_k', 'x']],
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
