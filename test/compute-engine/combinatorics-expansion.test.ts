import { engine as ce } from '../utils';

describe('Binomial symbolic expansion (Wester B13)', () => {
  it('expands Binomial(n, 3) to the falling-factorial form', () => {
    expect(ce.expr(['Binomial', 'n', 3]).evaluate().json).toEqual([
      'Divide',
      ['Multiply', 'n', ['Subtract', 'n', 1], ['Subtract', 'n', 2]],
      6,
    ]);
  });

  it('expands Binomial(n, 2)', () => {
    expect(ce.expr(['Binomial', 'n', 2]).evaluate().json).toEqual([
      'Divide',
      ['Multiply', 'n', ['Subtract', 'n', 1]],
      2,
    ]);
  });

  it('returns 1 for Binomial(n, 0)', () => {
    expect(ce.expr(['Binomial', 'n', 0]).evaluate().json).toEqual(1);
  });

  it('returns n for Binomial(n, 1)', () => {
    expect(ce.expr(['Binomial', 'n', 1]).evaluate().json).toEqual('n');
  });

  it('stays inert for a symbolic second argument', () => {
    expect(ce.expr(['Binomial', 'n', 'k']).evaluate().json).toEqual([
      'Binomial',
      'n',
      'k',
    ]);
  });

  it('still evaluates a fully numeric Binomial', () => {
    expect(ce.expr(['Binomial', 8, 3]).evaluate().json).toEqual(56);
  });

  it('agrees numerically with the expansion at n = 7', () => {
    // Binomial(7, 3) = 35; substitute into the expanded form. The expanded
    // form is returned non-canonically (to preserve the factored structure),
    // so re-box it canonically before substituting.
    const expanded = ce.expr(['Binomial', 'n', 3]).evaluate();
    expect(ce.box(expanded.json).subs({ n: 7 }).N().json).toEqual(35);
  });
});

describe('Pochhammer symbolic expansion (Wester B13)', () => {
  it('expands Pochhammer(a, 3) to the rising-factorial form', () => {
    expect(ce.expr(['Pochhammer', 'a', 3]).evaluate().json).toEqual([
      'Multiply',
      'a',
      ['Add', 'a', 1],
      ['Add', 'a', 2],
    ]);
  });

  it('returns 1 for Pochhammer(a, 0)', () => {
    expect(ce.expr(['Pochhammer', 'a', 0]).evaluate().json).toEqual(1);
  });

  it('returns a for Pochhammer(a, 1)', () => {
    expect(ce.expr(['Pochhammer', 'a', 1]).evaluate().json).toEqual('a');
  });

  it('stays inert for a symbolic second argument', () => {
    expect(ce.expr(['Pochhammer', 'a', 'k']).evaluate().json).toEqual([
      'Pochhammer',
      'a',
      'k',
    ]);
  });

  it('folds a numeric first argument (float)', () => {
    // 3.5 · 4.5 · 5.5 = 86.625
    expect(ce.expr(['Pochhammer', 3.5, 3]).evaluate().json).toEqual(86.625);
  });

  it('folds a numeric first argument exactly (integer)', () => {
    // 5 · 6 · 7 = 210
    expect(ce.expr(['Pochhammer', 5, 3]).evaluate().json).toEqual(210);
  });

  it('agrees numerically with the expansion at a = 3.5', () => {
    const expanded = ce.expr(['Pochhammer', 'a', 3]).evaluate();
    expect(ce.box(expanded.json).subs({ a: 3.5 }).N().json).toEqual(86.625);
  });
});
