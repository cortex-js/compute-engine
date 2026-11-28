/**
 * CE-1910: on JavaScript, an integral whose integrand is a list of a length
 * known only when the program runs (an input `E: list<real>`) compiles to
 * one quadrature per element of the list, as the interpreter integrates
 * each element of the evaluated integrand. The list and the bounds are read
 * once.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** The interpreter's value of `latex` with the lists `values` assigned. */
function interpreted(
  latex: string,
  declare: (ce: ComputeEngine) => void,
  values: Record<string, number | number[]>
): number[] {
  const ce = new ComputeEngine();
  declare(ce);
  for (const [k, v] of Object.entries(values))
    ce.assign(k, Array.isArray(v) ? ce.box(['List', ...v]) : v);
  const r = ce.parse(latex).N() as unknown as { ops: { re: number }[] };
  return r.ops.map((x) => x.re);
}

function compiled(latex: string, declare: (ce: ComputeEngine) => void) {
  const ce = new ComputeEngine();
  declare(ce);
  return compile(ce.parse(latex), { to: 'javascript' });
}

const lists = (ce: ComputeEngine) => {
  ce.declare('E', 'list<real>');
  ce.declare('F', 'list<real>');
  ce.declare('L', 'real');
};

describe('CE-1910: a list integrand of a run-time length', () => {
  test('one quadrature per element', () => {
    const latex = String.raw`\int_0^1 \frac{x}{\mathrm{ElementMax}(E, x)}\,dx`;
    const r = compiled(latex, lists);
    expect(r.success).toBe(true);
    expect(r.code.match(/irIntegrate/g)).toHaveLength(1);
    const got = r.run!({ E: [0.5, 2] } as never) as number[];
    const want = interpreted(latex, lists, { E: [0.5, 2] });
    expect(got).toHaveLength(2);
    got.forEach((x, k) => expect(x).toBeCloseTo(want[k], 10));
    expect(got[0]).toBeCloseTo(0.75, 10);
    expect(r.run!({ E: [] } as never)).toEqual([]);
  });

  test('nested integrals under a restriction (the witness)', () => {
    const latex = String.raw`\int_{0}^{1}\!y\times\left(\int_{-L}^{L}\!\frac{\begin{cases}\begin{cases}1&x\lt-(1-y^2)^{1/2}\\0&\top\end{cases}&y\le1\\1&\top\end{cases}}{\mathrm{ElementMax}(E, \mathrm{ElementMax}(0, (x^2+y^2)^{1/2}-1))}\, \mathrm{d}x\keyword{where}0\le y\le5\right)\, \mathrm{d}y`;
    const r = compiled(latex, lists);
    expect(r.success).toBe(true);
    const got = r.run!({ E: [0.5, 2], L: 3 } as never) as number[];
    const want = interpreted(latex, lists, { E: [0.5, 2], L: 3 });
    expect(got).toHaveLength(2);
    got.forEach((x, k) => expect(x).toBeCloseTo(want[k], 8));
  });

  test('two lists of different lengths throw', () => {
    const latex = String.raw`\int_0^1 xE + \sin(xF)\,dx`;
    const r = compiled(latex, lists);
    expect(r.success).toBe(true);
    const got = r.run!({ E: [1, 2], F: [1, 2] } as never) as number[];
    const want = interpreted(latex, lists, { E: [1, 2], F: [1, 2] });
    got.forEach((x, k) => expect(x).toBeCloseTo(want[k], 10));
    expect(() => r.run!({ E: [1, 2], F: [1] } as never)).toThrow(
      /incompatible-dimensions/
    );
  });

  test('arms of a condition whose lists can differ in length decline', () => {
    // An arm that is not taken does not read its list: with `E = [0.5, 2]`
    // and `F = [1]` the interpreter's value is the one of the arm taken.
    const r = compiled(
      String.raw`\int_0^1 \begin{cases} \frac{x}{\mathrm{ElementMax}(E, x)} & L > 0 \\ \frac{x}{\mathrm{ElementMax}(F, x)} & \top \end{cases}\,dx`,
      lists
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/can have different lengths/);
  });

  test('a scalar part that reads the list declines', () => {
    const r = compiled(
      String.raw`\int_0^1 \sin(x+E) + \mathrm{Sum}(E)\,dx`,
      lists
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not element by element/);
  });
});
