import { ComputeEngine } from '../../src/compute-engine';

//
// `Primes` is the set of all prime numbers: a lazy, infinite set constant like
// `Integers`. It exists so that a sum over the primes is a meaningful
// expression — its index binds as an integer and the sum stays symbolic —
// and so that `\mathbb{P}` parses to something the engine knows.
//

describe('Primes', () => {
  const ce = new ComputeEngine();

  it('is an infinite set of integers', () => {
    const primes = ce.box('Primes');
    expect(primes.type.toString()).toBe('set<integer>');
    expect(primes.isCollection).toBe(true);
    expect(primes.isFiniteCollection).toBe(false);
  });

  it('enumerates the primes in order', () => {
    const first: string[] = [];
    for (const p of ce.box('Primes').each()) {
      first.push(p.toString());
      if (first.length === 6) break;
    }
    expect(first).toEqual(['2', '3', '5', '7', '11', '13']);
  });

  it('decides membership of literals', () => {
    const member = (x: number | string) =>
      ce.box(['Element', x, 'Primes']).evaluate().toString();
    expect(member(7)).toBe('"True"');
    expect(member(2)).toBe('"True"');
    expect(member(8)).toBe('"False"');
    expect(member(1)).toBe('"False"');
    expect(member(-3)).toBe('"False"');
    expect(member(2.5)).toBe('"False"');
  });

  it('tests an exact integer above 2^53 exactly', () => {
    // 2^61 - 1 is a Mersenne prime; 2^61 + 1 is composite (3 divides it).
    // Read through a double both would round to the even 2^61.
    const member = (digits: string) =>
      ce
        .box(['Element', { num: digits }, 'Primes'])
        .evaluate()
        .toString();
    expect(member('2305843009213693951')).toBe('"True"');
    expect(member('2305843009213693953')).toBe('"False"');
  });

  it('leaves membership of an unknown integer undecided', () => {
    ce.declare('n', 'integer');
    const e = ce.box(['Element', 'n', 'Primes']).evaluate();
    expect(e.operator).toBe('Element');
  });

  it('is a proper subset of the integer and wider number sets', () => {
    const subset = (other: string) =>
      ce.box(['Subset', 'Primes', other]).evaluate().toString();
    expect(subset('PositiveIntegers')).toBe('"True"');
    expect(subset('Integers')).toBe('"True"');
    expect(subset('RealNumbers')).toBe('"True"');
    expect(
      ce.box(['SubsetEqual', 'Primes', 'Primes']).evaluate().toString()
    ).toBe('"True"');
    expect(
      ce
        .box(['Subset', 'Primes', ['Set', 2, 3, 5]])
        .evaluate()
        .toString()
    ).toBe('"False"');
  });

  it('binds an integer index in a sum over the primes and stays symbolic', () => {
    const sum = ce.parse('\\sum_{p \\in \\mathbb{P}} p^{-2}');
    expect(sum.json).toEqual([
      'Sum',
      ['Power', 'p', -2],
      ['Element', 'p', 'Primes'],
    ]);
    expect(sum.ops![1].op1.type.toString()).toBe('integer');
    expect(sum.evaluate().operator).toBe('Sum');
  });

  it('round-trips through LaTeX', () => {
    expect(ce.parse('\\mathbb{P}').symbol).toBe('Primes');
    expect(ce.box('Primes').latex).toBe('\\mathbb{P}');
  });

  it('filters and counts through the lazy iterator', () => {
    // The first four primes above 10, without walking the whole set.
    const found: string[] = [];
    for (const p of ce.box('Primes').each()) {
      const n = p.re;
      if (n > 10) found.push(String(n));
      if (found.length === 4) break;
    }
    expect(found).toEqual(['11', '13', '17', '19']);
  });
});
