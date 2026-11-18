import { ComputeEngine, compile } from '../../src/compute-engine';

describe('COMPLEX DIVISION BY A PIVOT NEAR THE LARGEST DOUBLE', () => {
  // The pivot `1e308 + 1e308·i` is finite, and so is its reciprocal,
  // `5e-309 − 5e-309·i`. Smith's formula forms the denominator
  // `1e308 + 1e308·(1e308/1e308)`, which is `Infinity`, so the complex
  // helpers divided by `Infinity` and answered 0. They now divide the
  // dividend and the divisor by the larger part of the divisor first.
  const PIVOT = { re: 1e308, im: 1e308 };

  it('javascript: Inverse and a negative MatrixPower of a matrix<complex>', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<complex>');
    for (const expr of [
      ['Inverse', 'M'],
      ['MatrixPower', 'M', -1],
    ]) {
      const r = compile(ce.box(expr), { to: 'javascript' } as any) as any;
      const [[z]] = r.run({ M: [[PIVOT]] });
      expect(z.re).toBe(5e-309);
      expect(z.im).toBe(-5e-309);
    }
  });

  it('javascript: the reciprocal of a complex scalar', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const r = compile(ce.box(['Divide', 1, 'z']), {
      to: 'javascript',
    } as any) as any;
    const q = r.run({ z: PIVOT });
    expect(q.re).toBe(5e-309);
    expect(q.im).toBe(-5e-309);
  });

  // The parts of a value that may be a plain number or a `{re, im}` object.
  const parts = (v: any): [number, number] =>
    typeof v === 'number' ? [v, 0] : [v.re, v.im];

  it('javascript: a large dividend over an ordinary pivot', () => {
    // The inverse of `[[1+i, 1e308+1e308·i], [0, 1]]` is
    // `[[0.5−0.5·i, −1e308], [0, 1]]`: every entry is finite. The products
    // of the pivot-row normalization overflowed to `Infinity`, and the
    // elimination then made `NaN` entries.
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<complex>');
    const r = compile(ce.box(['Inverse', 'M']), {
      to: 'javascript',
    } as any) as any;
    const inv = r.run({
      M: [
        [
          { re: 1, im: 1 },
          { re: 1e308, im: 1e308 },
        ],
        [
          { re: 0, im: 0 },
          { re: 1, im: 0 },
        ],
      ],
    });
    expect(parts(inv[0][0])).toEqual([0.5, -0.5]);
    expect(parts(inv[0][1])).toEqual([-1e308, 0]);
    expect(parts(inv[1][0])).toEqual([0, 0]);
    expect(parts(inv[1][1])).toEqual([1, 0]);
  });

  it('javascript: the quotient of complex scalars at the ends of the range', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'complex');
    ce.declare('b', 'complex');
    const r = compile(ce.box(['Divide', 'a', 'b']), {
      to: 'javascript',
    } as any) as any;
    // The numerator parts overflow, but the quotient is `1e308`.
    expect(
      parts(r.run({ a: { re: 1e308, im: 1e308 }, b: { re: 1, im: 1 } }))
    ).toEqual([1e308, 0]);
    // The real part of the quotient overflows, and the imaginary part is
    // exactly zero. The imaginary part stays zero; it is not `NaN`.
    expect(
      parts(
        r.run({ a: { re: 1e308, im: 1e308 }, b: { re: 1e-200, im: 1e-200 } })
      )
    ).toEqual([Infinity, 0]);
    // The squared modulus of the divisor is subnormal.
    expect(
      parts(r.run({ a: { re: 1, im: 1 }, b: { re: 1e-160, im: 1e-160 } }))
    ).toEqual([1e160, 0]);
  });
});
