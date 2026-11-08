import { ComputeEngine } from '../../src/compute-engine';

/**
 * CE-1154: `ce.parse` of `G=\left[1,2,…\right]` with n numbers took a time
 * proportional to n², while the same list without `G=` was linear.
 *
 * `parseSupsub()` tests whether the base of a script is the last symbol that
 * takes a subscript into its name (`x` in `x^2_{01}`). It copied the tokens
 * between that symbol and the scripts before it tested the cheap conditions
 * (the base is a string, its name and start match). After `G=`, every number
 * of the list reaches `parseSupsub()` with `G` as the last such symbol, so
 * each number copied all the tokens since `G`. The copy is now made only
 * after the cheap conditions hold.
 *
 * The repo does not assert elapsed time (ROADMAP "Test assertions on
 * wall-clock time"). The work is measured as the total length of the arrays
 * that `Array.prototype.slice` returns during the parse: that total was
 * quadratic in n before the fix and is linear after it.
 */
describe('CE-1154: a long list after a symbol parses in linear work', () => {
  function numbers(n: number): string {
    return Array.from({ length: n }, (_, i) => String(i + 1)).join(',');
  }

  /** The total length of the arrays that `slice` returned during the parse
   * of `latex`. */
  function slicedLength(latex: string): number {
    const ce = new ComputeEngine();
    const spy = jest.spyOn(Array.prototype, 'slice');
    try {
      ce.parse(latex, { form: 'raw' });
      let total = 0;
      for (const r of spy.mock.results)
        if (r.type === 'return') total += (r.value as unknown[]).length;
      return total;
    } finally {
      spy.mockRestore();
    }
  }

  test('the copied tokens grow linearly with the list length', () => {
    const N = 1000;
    const small = slicedLength(`G=\\left[${numbers(N)}\\right]`);
    const large = slicedLength(`G=\\left[${numbers(2 * N)}\\right]`);
    // Before the fix each of the N numbers copied about 2N tokens: the total
    // grew by a factor of about 4 per doubling. Linear: about 2. The first
    // check shows that the spy sees the parser's calls at all.
    expect(small).toBeGreaterThan(0);
    expect(large).toBeLessThan(3 * small);
  });

  test('a long list after a symbol still parses to the same expression', () => {
    const ce = new ComputeEngine();
    const N = 5000;
    const expr = ce.parse(`G=\\left[${numbers(N)}\\right]`);
    expect(expr.operator).toBe('Equal');
    expect(expr.op2.operator).toBe('List');
    expect(expr.op2.nops).toBe(N);
  });

  test.each([
    ['x^2_{01}', ['Power', 'x_01', 2]],
    ['x ^2_{01}', ['Power', 'x_01', 2]],
    ["x'^2_{01}", ['Power', ['Prime', 'x_01'], 2]],
    ['x^{\\prime}^2_{01}', ['Power', ['Prime', 'x_01'], 2]],
    ['\\alpha^2_{01}', ['Power', 'alpha_01', 2]],
    ['2^2_{01}', ['Power', ['Subscript', 2, 1], 2]],
    [
      'G=\\left[x^2_{01},y^3_{2}\\right]',
      ['Equal', 'G', ['List', ['Power', 'x_01', 2], ['Power', 'y_2', 3]]],
    ],
  ])('a subscript after a superscript still joins the name: %s', (latex, json) => {
    const ce = new ComputeEngine();
    expect(ce.parse(latex, { form: 'raw' }).json).toEqual(json);
  });
});
