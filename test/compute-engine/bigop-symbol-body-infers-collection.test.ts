import { ComputeEngine } from '../../src/compute-engine';

/**
 * A no-index `Sum(L)` / `Product(L)` over a symbol with no type evidence yet
 * infers `L: collection`, so a function built on it binds a list argument
 * whole instead of broadcasting the call over the elements.
 */
describe('a big op over an untyped symbol infers a collection', () => {
  test('a user function summing its parameter', () => {
    const ce = new ComputeEngine();
    ce.parse('f(L) \\coloneq \\mathrm{Sum}(L)').evaluate();
    expect(ce.symbol('f').type.toString()).toBe('(collection) -> number');
    expect(ce.parse('f([1,2,3])').evaluate().toString()).toBe('6');
    ce.parse('g(L) \\coloneq \\mathrm{Product}(L)').evaluate();
    expect(ce.parse('g([1,2,3])').evaluate().toString()).toBe('6');
  });

  test('a symbol with evidence, or a declared type, is not touched', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'real');
    expect(ce.box(['Sum', 'r']).evaluate().toString()).toBe('r');
    expect(ce.symbol('r').type.toString()).toBe('real');
    // `y` is a number by its first use; `Sum(y)` keeps the identity spelling.
    ce.parse('y + 1');
    ce.box(['Sum', 'y']);
    expect(ce.symbol('y').type.matches('collection')).toBe(false);
  });

  test('a user function over an unannotated scalar parameter still maps', () => {
    const ce = new ComputeEngine();
    ce.parse('h(x) \\coloneq [x, -x]').evaluate();
    expect(ce.symbol('h').type.toString()).toBe('(unknown) -> vector<2>');
    expect(ce.parse('h([1,2])').evaluate().toString()).toBe('[[1,-1],[2,-2]]');
  });

  test('a global sum with no limits reads its symbol as a collection', () => {
    const ce = new ComputeEngine();
    ce.parse('\\sum x');
    expect(ce.symbol('x').type.toString()).toBe('collection');
    // A later scalar use still evaluates.
    expect(ce.parse('\\sin x').evaluate().toString()).toBe('sin(x)');
  });
});
