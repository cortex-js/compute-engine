import { ComputeEngine } from '../../src/compute-engine';

/**
 * A `Sum` or `Product` with several `Limits` clauses, where a bound of one
 * clause names the index of another clause (CE-115). The operator evaluates
 * the clauses as nested operators, whatever the order of the clauses.
 */
describe('Sum and Product with a bound that depends on another index', () => {
  const ce = new ComputeEngine();

  test('Sum, the inner clause last', () => {
    const e = ce.box([
      'Sum',
      'k',
      ['Limits', 'n', 1, 10],
      ['Limits', 'k', 1, 'n'],
    ]);
    expect(e.evaluate().toString()).toBe('220');
    expect(e.N().toString()).toBe('220');
  });

  test('Sum, the inner clause first', () => {
    const e = ce.box([
      'Sum',
      'k',
      ['Limits', 'k', 1, 'n'],
      ['Limits', 'n', 1, 10],
    ]);
    expect(e.evaluate().toString()).toBe('220');
  });

  test('Sum with a body that uses both indexes', () => {
    // sum over n = 1..3, k = 1..n of k*n = 1 + 2*(1+2) + 3*(1+2+3) = 25
    const e = ce.box([
      'Sum',
      ['Multiply', 'k', 'n'],
      ['Limits', 'n', 1, 3],
      ['Limits', 'k', 1, 'n'],
    ]);
    expect(e.evaluate().toString()).toBe('25');
  });

  test('Product', () => {
    // 1! * 2! * 3! * 4! = 288
    const e = ce.box([
      'Product',
      'k',
      ['Limits', 'n', 1, 4],
      ['Limits', 'k', 1, 'n'],
    ]);
    expect(e.evaluate().toString()).toBe('288');
  });

  test('independent clauses are unchanged', () => {
    const e = ce.box([
      'Sum',
      'k',
      ['Limits', 'n', 1, 3],
      ['Limits', 'm', 1, 2],
    ]);
    expect(e.evaluate().toString()).toBe('6k');
  });

  test('a bound that is a free symbol stays symbolic', () => {
    const e = ce.box([
      'Sum',
      'k',
      ['Limits', 'k', 1, 'n'],
      ['Limits', 'j', 1, 2],
    ]);
    expect(e.evaluate().operator).toBe('Sum');
  });

  test('a body that calls a function keeps the binding it was boxed with', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto 2x'));
    const sum = ce.box([
      'Sum',
      ['f', 'k'],
      ['Limits', 'n', 1, 3],
      ['Limits', 'k', 1, 'n'],
    ]);
    // A later declaration of `f` in an inner scope does not redirect the
    // calls the sum holds. The terms are 2k over k = 1..n, n = 1..3.
    ce.pushScope();
    ce.declare('f', { type: 'function' });
    ce.assign('f', ce.parse('x \\mapsto 100x'));
    expect(sum.evaluate().toString()).toBe('20');
    expect(sum.N().toString()).toBe('20');
    // A sum boxed after the redeclaration uses the new function.
    const later = ce.box([
      'Sum',
      ['f', 'k'],
      ['Limits', 'n', 1, 3],
      ['Limits', 'k', 1, 'n'],
    ]);
    expect(later.evaluate().toString()).toBe('1000');
    ce.popScope();
  });

  test('a float body', () => {
    const e = ce.box([
      'Sum',
      ['Add', 'k', 0.5],
      ['Limits', 'n', 1, 3],
      ['Limits', 'k', 1, 'n'],
    ]);
    // 10 + 0.5 * 6
    expect(e.evaluate().toString()).toBe('13');
    expect(e.N().toString()).toBe('13');
  });

  test('a block of the body reads both indexes', () => {
    // The body is boxed in the scope of the operator, which assigns both
    // indexes: the block that assigns `h` reads the inner index `j`.
    const ce = new ComputeEngine();
    ce.declare('h', 'any');
    ce.assign('h', ce.box(['List']));
    ce.box([
      'Sum',
      ['Block', ['Assign', 'h', ['Append', 'h', 'j']], 'j'],
      ['Limits', 'i', 1, 2],
      ['Limits', 'j', 1, 'i'],
    ]).evaluate();
    expect(ce.box('h').evaluate().json).toEqual(['List', 1, 1, 2]);
  });

  // CE-1190: an `Element` clause whose set or condition names another index
  // is nested inside the clause of that index, as a `Limits` clause is.
  test('Sum with an Element clause whose Range names the outer index', () => {
    const e = ce.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Element', 'j', ['Range', 1, 'i']],
    ]);
    expect(e.evaluate().toString()).toBe('25');
    expect(e.N().toString()).toBe('25');
  });

  test('Sum with the dependent Element clause first', () => {
    const e = ce.box([
      'Sum',
      ['Multiply', 'k', 'n'],
      ['Element', 'k', ['Range', 1, 'n']],
      ['Limits', 'n', 1, 3],
    ]);
    expect(e.evaluate().toString()).toBe('25');
  });

  test('Product with two Element clauses', () => {
    // Over n = 1..3, k = 1..n: 2 · (3·4) · (4·5·6) = 2880
    const e = ce.box([
      'Product',
      ['Add', 'n', 'k'],
      ['Element', 'n', ['Range', 1, 3]],
      ['Element', 'k', ['Range', 1, 'n']],
    ]);
    expect(e.evaluate().toString()).toBe('2880');
  });

  test('Sum with an Element condition that names the outer index', () => {
    // Over i = 1..3, j in 1..3 with j < i: 2·1 + 3·(1+2) = 11
    const e = ce.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Element', 'j', ['Range', 1, 3], ['Less', 'j', 'i']],
    ]);
    expect(e.evaluate().toString()).toBe('11');
  });

  test('Element clauses that name each other stay symbolic', () => {
    const e = ce.box([
      'Sum',
      ['Multiply', 'm', 'k'],
      ['Element', 'm', ['Range', 1, 'k']],
      ['Element', 'k', ['Range', 1, 'm']],
    ]);
    expect(e.evaluate().operator).toBe('Sum');
  });

  test('async evaluation of an Element clause agrees', async () => {
    const e = ce.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Element', 'j', ['Range', 1, 'i']],
    ]);
    expect((await e.evaluateAsync()).toString()).toBe('25');
  });

  // CE-1762: the clauses are unordered, so an earlier clause sees the index
  // of a later one. Before, the `i` of the first clause was the imaginary
  // unit, and the sum was 6 (or stayed unevaluated with a `Limits` clause).
  test('an index named i in an earlier Element clause', () => {
    const e = ce.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Element', 'j', ['Range', 1, 'i']],
      ['Limits', 'i', 1, 3],
    ]);
    expect(e.json).toEqual([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Element', 'j', ['Range', 1, 'i']],
      ['Limits', 'i', 1, 3],
    ]);
    expect(e.freeVariables).toEqual([]);
    expect(e.evaluate().toString()).toBe('25');
  });

  test('an index named i in an earlier Limits clause', () => {
    const sum = ce.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'j', 1, 'i'],
      ['Limits', 'i', 1, 3],
    ]);
    expect(sum.evaluate().toString()).toBe('25');
    // Over i = 1..3, j = 1..i: 1 · (2·4) · (3·6·9) = 1296
    const product = ce.box([
      'Product',
      ['Multiply', 'i', 'j'],
      ['Limits', 'j', 1, 'i'],
      ['Limits', 'i', 1, 3],
    ]);
    expect(product.evaluate().toString()).toBe('1296');
  });

  test('the flat spelling with an index named i', () => {
    const e = ce.box(['Sum', ['Multiply', 'i', 'j'], 'j', 1, 'i', 'i', 1, 3]);
    expect(e.evaluate().toString()).toBe('25');
  });

  test('a later index is not a free variable of an earlier clause', () => {
    const e = ce.box([
      'Sum',
      ['Multiply', 'k', 'n'],
      ['Limits', 'k', 1, 'n'],
      ['Limits', 'n', 1, 'm'],
    ]);
    expect(e.freeVariables).toEqual(['m']);
    expect(e.subs({ m: 3 }).evaluate().toString()).toBe('25');
  });

  test('the bound of a clause is outside the scope of its own index', () => {
    // The upper bound `k` of the second clause is the enclosing `k`.
    const e = ce.box([
      'Sum',
      'k',
      ['Limits', 'j', 1, 2],
      ['Limits', 'k', 1, 'k'],
    ]);
    expect(e.freeVariables).toEqual(['k']);
  });

  test('async evaluation agrees', async () => {
    const e = ce.box([
      'Sum',
      'k',
      ['Limits', 'n', 1, 10],
      ['Limits', 'k', 1, 'n'],
    ]);
    expect((await e.evaluateAsync()).toString()).toBe('220');
    const p = ce.box([
      'Product',
      'k',
      ['Limits', 'n', 1, 4],
      ['Limits', 'k', 1, 'n'],
    ]);
    expect((await p.evaluateAsync()).toString()).toBe('288');
  });
});
