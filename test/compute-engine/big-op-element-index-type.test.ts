import { ComputeEngine } from '../../src/compute-engine';

//
// The index of a `Sum`/`Product` `Element` clause takes the type of the
// collection's ELEMENTS. A range-shaped clause (`Limits`, a bounds tuple)
// still walks integers.
//
// Before this, `indexingSetSites(1, 'integer')` pinned every index to
// `integer`, whatever the indexing set held. Two consequences, both fixed
// here: `Sum(chi(n), Element(chi, G))` over `G: set<function>` declared
// `chi: integer` and the body `chi(n)` was an `expected-function` error
// (four Fungrim Dirichlet entries, ids 288207, 3ab92d, 4c3678, f4de66); and
// `Sum(2x, Element(x, [0.5, 1.5]))` THREW at evaluation, the per-iteration
// assignment refusing the element `0.5` against the declared `integer`.
//

describe('Sum/Product index typed from an Element clause', () => {
  it('binds the index as a function over a set<function> (box route)', () => {
    const ce = new ComputeEngine();
    ce.declare('G', 'set<function>');
    ce.declare('n', 'integer');
    const sum = ce.box(['Sum', ['chi', 'n'], ['Element', 'chi', 'G']]);
    expect(sum.isValid).toBe(true);
    expect(sum.json).toEqual(['Sum', ['chi', 'n'], ['Element', 'chi', 'G']]);
    expect(sum.ops![1].op1.type.toString()).toBe('function');
  });

  it('leaves the index unknown over a bare set, and the body still applies it', () => {
    const ce = new ComputeEngine();
    ce.declare('G', 'set');
    ce.declare('n', 'integer');
    const sum = ce.box(['Sum', ['chi', 'n'], ['Element', 'chi', 'G']]);
    expect(sum.isValid).toBe(true);
    expect(sum.ops![1].op1.type.toString()).toBe('unknown');
  });

  it('sums over a list of non-integers instead of throwing', () => {
    const ce = new ComputeEngine();
    const sum = ce.box([
      'Sum',
      ['Multiply', 2, 'x'],
      ['Element', 'x', ['List', 0.5, 1.5]],
    ]);
    expect(sum.ops![1].op1.type.toString()).toBe('real');
    expect(sum.evaluate().toString()).toBe('4');
  });

  it('multiplies over a list (Product)', () => {
    const ce = new ComputeEngine();
    const product = ce.box([
      'Product',
      'x',
      ['Element', 'x', ['List', 2, 3, 4]],
    ]);
    expect(product.ops![1].op1.type.toString()).toBe('integer');
    expect(product.evaluate().toString()).toBe('24');
  });

  it('keeps an integer index over a set of integers (parse route)', () => {
    const ce = new ComputeEngine();
    const sum = ce.parse('\\sum_{k \\in \\{1,2,3\\}} k^2');
    expect(sum.ops![1].op1.type.toString()).toBe('integer');
    expect(sum.evaluate().toString()).toBe('14');
  });

  it('keeps an integer index for a range-shaped clause', () => {
    const ce = new ComputeEngine();
    const sum = ce.parse('\\sum_{k=1}^{3} k^2');
    expect(sum.ops![1].op1.type.toString()).toBe('integer');
    expect(sum.evaluate().toString()).toBe('14');
    const boxed = ce.box(['Sum', ['Square', 'k'], ['Tuple', 'k', 1, 3]]);
    expect(boxed.ops![1].op1.type.toString()).toBe('integer');
    expect(boxed.evaluate().toString()).toBe('14');
  });

  it('boxes the Fungrim character-sum entry on the box route', () => {
    const ce = new ComputeEngine();
    ce.declare('DirichletGroup', '(integer) -> set');
    ce.declare('q', 'integer');
    ce.declare('n', 'integer');
    // Fungrim entry 3ab92d: Σ_{χ ∈ G(q)} χ(n) = φ(q) when n ≡ 1 (mod q), else 0.
    const sum = ce.box([
      'Sum',
      ['chi', 'n'],
      ['Element', 'chi', ['DirichletGroup', 'q']],
    ]);
    expect(sum.isValid).toBe(true);
    expect(JSON.stringify(sum.json)).not.toContain('Error');
  });
});
