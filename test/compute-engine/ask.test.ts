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

  // P1-5: bound queries must also work when the pattern is pre-boxed
  // (canonicalized), which flips `Greater(x, _k)` to `Less(_k, x)`.
  test('answers a bound query passed as a canonically-boxed pattern', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 4'));

    // Passing a pre-boxed pattern canonicalizes Greater(x, _k) -> Less(_k, x).
    const boxed = ce.ask(ce.expr(['Greater', 'x', '_k']));
    expect(boxed.length).toBe(1);
    expect(boxed[0]!._k.json).toBe(4);

    // The raw-JSON form (which stays Greater) must keep working too.
    const raw = ce.ask(['Greater', 'x', '_k']);
    expect(raw.length).toBe(1);
    expect(raw[0]!._k.json).toBe(4);
  });

  test('docstring example works: assume(x>4); ask(Greater(x,_val))', () => {
    const ce = new ComputeEngine();
    ce.assume(['Greater', 'x', 4]);
    const r = ce.ask(['Greater', 'x', '_val']);
    expect(r.length).toBe(1);
    expect(r[0]!._val.json).toBe(4);
  });

  // P1-4: an opaque multi-symbol inequality is symmetric under ask, including
  // the Add form that previously missed due to raw-order normalization.
  test('finds a stored product inequality (x*y > 0)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\cdot y > 0'));
    expect(
      ce.ask(ce.expr(['Greater', ['Multiply', 'x', 'y'], 0])).length
    ).toBeGreaterThan(0);
  });

  test('finds a stored sum inequality (x + y > 0)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x + y > 0'));
    expect(
      ce.ask(ce.expr(['Greater', ['Add', 'x', 'y'], 0])).length
    ).toBeGreaterThan(0);
  });
});
