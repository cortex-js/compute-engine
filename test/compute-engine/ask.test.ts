import { ComputeEngine } from '../../src/compute-engine';

describe('ASK', () => {
  test('matches patterns with wildcards against stored assumptions', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));

    const r = ce.ask(['Less', ['Negate', 'x'], '_k']);
    expect(r.length).toBe(1);
    expect(r[0]!._k.json).toBe(0);
  });

  test('answers inequality bound queries in user form', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));

    const r = ce.ask(['Greater', 'x', '_k']);
    expect(r.length).toBe(1);
    expect(r[0]!._k.json).toBe(0);
  });

  test('normalizes inequality patterns for matching', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));

    const r = ce.ask(['Greater', '_x', 0]);
    expect(r.length).toBe(1);
    expect(r[0]!._x.symbol).toBe('x');
  });

  test('supports wildcard symbols in bound queries', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));

    const r = ce.ask(['Greater', '_x', '_k']);
    expect(r.length).toBe(1);
    expect(r[0]!._x.symbol).toBe('x');
    expect(r[0]!._k.json).toBe(0);
  });

  test('is conservative about strictness of bounds', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\ge 0'));

    expect(ce.ask(['Greater', 'x', '_k'])).toEqual([]);

    const r = ce.ask(['GreaterEqual', 'x', '_k']);
    expect(r.length).toBe(1);
    expect(r[0]!._k.json).toBe(0);
  });

  test('can answer Element queries from declarations', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'finite_real');

    // Closed predicate fallback (B3)
    expect(ce.ask(['Element', 'x', 'any'])).toEqual([{}]);

    // Type extraction from declaration (B1)
    const r = ce.ask(['Element', 'x', '_T']);
    expect(r.length).toBe(1);
    expect(r[0]!._T.json).toBe('finite_real');
  });
});
