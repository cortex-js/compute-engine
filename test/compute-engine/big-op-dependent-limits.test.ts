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
