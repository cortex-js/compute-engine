import { Complex } from 'complex.js';
import { BigDecimal } from '../../src/big-decimal';
import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

// A complex value given by the host with integer parts is exact when it is
// created, as `ce.number(2)` is. A complex float stays a float, and a float
// operand makes a numeric result a float: exactness is never read from the
// integer values of the parts of a float (user decision 2026-10-02).

const ce = new ComputeEngine();

function isExact(x: Expression): boolean | undefined {
  return isNumber(x) ? x.isExact : undefined;
}

describe('A COMPLEX VALUE FROM THE HOST', () => {
  test('ce.number(new Complex(2, 3)) is the exact 2 + 3i', () => {
    const z = ce.number(new Complex(2, 3));
    expect(isExact(z)).toBe(true);
    expect(z.json).toEqual(['Complex', 2, 3]);
  });

  test('ce.number(new Complex(2.5, 3)) is a float', () => {
    const z = ce.number(new Complex(2.5, 3));
    expect(isExact(z)).toBe(false);
    expect(z.json).toEqual(['Complex', 2.5, 3]);
  });

  test('ce.number({ re: 2, im: 3 }) is the exact 2 + 3i', () => {
    const z = ce.number({ re: 2, im: 3 });
    expect(isExact(z)).toBe(true);
    expect(z.json).toEqual(['Complex', 2, 3]);
  });

  test('ce.number({ re: 2.5, im: 3 }) is a float', () => {
    expect(isExact(ce.number({ re: 2.5, im: 3 }))).toBe(false);
  });

  test('integer-valued big-decimal parts are exact', () => {
    const z = ce.number({ re: new BigDecimal(2), im: new BigDecimal(-3) });
    expect(isExact(z)).toBe(true);
    expect(z.json).toEqual(['Complex', 2, -3]);
  });

  test('a big-decimal part with a fraction is a float', () => {
    const z = ce.number({ re: new BigDecimal('2.5'), im: new BigDecimal(3) });
    expect(isExact(z)).toBe(false);
  });

  test('ce.box() of a Complex is exact', () => {
    const z = ce.box(new Complex(2, 3));
    expect(isExact(z)).toBe(true);
    expect(z.json).toEqual(['Complex', 2, 3]);
  });

  test('ce._numericValue() of a Complex is exact', () => {
    expect(ce._numericValue(new Complex(2, 3)).isExact).toBe(true);
    expect(ce._numericValue(new Complex(2.5, 3)).isExact).toBe(false);
  });

  test('ce.number(new Complex(0, 1)) is the exact imaginary unit', () => {
    const z = ce.number(new Complex(0, 1));
    expect(isExact(z)).toBe(true);
    expect(ce.box(['Multiply', ['Rational', 1, 3], z]).evaluate().json).toEqual(
      ['Complex', 0, ['Rational', 1, 3]]
    );
  });

  test('an exact host complex powers exactly', () => {
    const z = ce.box(['Power', ce.number(new Complex(1, 1)), 2]).evaluate();
    expect(isExact(z)).toBe(true);
    expect(z.json).toEqual(['Complex', 0, 2]);
  });
});

describe('A COMPLEX FLOAT', () => {
  test.each(['1.0i', '2.0+3.0i'])('%s is a float', (s) => {
    expect(isExact(ce.parse(s).evaluate())).toBe(false);
  });

  test('i and Complex(2, 3) are exact', () => {
    expect(isExact(ce.parse('i').evaluate())).toBe(true);
    expect(isExact(ce.box(['Complex', 2, 3]).evaluate())).toBe(true);
  });

  test('1/3 times 1.0i is a float', () => {
    const z = ce.parse('\\frac{1}{3}\\cdot 1.0i').evaluate();
    expect(isExact(z)).toBe(false);
    expect(z.im).toBeCloseTo(1 / 3, 15);
  });

  test('sqrt(2) times 1.0i is a float', () => {
    const z = ce.parse('\\sqrt2\\cdot 1.0i').evaluate();
    expect(isExact(z)).toBe(false);
    expect(z.im).toBeCloseTo(Math.SQRT2, 15);
  });

  test('(1.0+1.0i)^2 is the float 2.0i', () => {
    const z = ce.parse('(1.0+1.0i)^2').evaluate();
    expect(isExact(z)).toBe(false);
    expect(z.re).toBe(0);
    expect(z.im).toBe(2);
  });

  test('(1+i)^2 is the exact 2i', () => {
    const z = ce.parse('(1+i)^2').evaluate();
    expect(isExact(z)).toBe(true);
    expect(z.json).toEqual(['Complex', 0, 2]);
  });

  test('Gamma(1.0i) is a float under evaluate()', () => {
    const z = ce.parse('\\Gamma(1.0i)').evaluate();
    expect(isExact(z)).toBe(false);
    const n = ce.parse('\\Gamma(i)').N();
    expect(z.re).toBeCloseTo(n.re, 14);
    expect(z.im).toBeCloseTo(n.im, 14);
  });

  test('cos(1.0i pi) is a float under evaluate()', () => {
    const z = ce.parse('\\cos(1.0i\\pi)').evaluate();
    expect(isExact(z)).toBe(false);
    expect(z.re).toBeCloseTo(Math.cosh(Math.PI), 13);
  });

  // A float multiple of pi that is a special angle is exact (CHANGELOG
  // 0.139.0): `e^{1.0 i pi}` keeps that rule.
  test.each([
    ['e^{1.0i\\pi}', -1],
    ['e^{1.0\\pi i}', -1],
    ['e^{2.0\\pi i}', 1],
  ])('%s is the special angle value %d', (s, v) => {
    expect(ce.parse(s).evaluate().json).toEqual(v);
  });

  test('(0.5+0.5i)*2 is a float', () => {
    const z = ce.parse('(0.5+0.5i)\\cdot 2').evaluate();
    expect(isExact(z)).toBe(false);
    expect(ce.box(['Power', z, 2]).evaluate().json).toEqual([
      'Complex',
      { num: '0.0' },
      { num: '2.0' },
    ]);
  });
});

describe('BOUNDARY CASES OF A COMPLEX VALUE FROM THE HOST', () => {
  test('a part past the safe integers is a float', () => {
    expect(isExact(ce.number(new Complex(2 ** 53, 1)))).toBe(false);
  });

  test('the largest safe integer is exact', () => {
    const z = ce.number(new Complex(2 ** 53 - 1, 1));
    expect(isExact(z)).toBe(true);
    expect(z.json).toEqual(['Complex', 2 ** 53 - 1, 1]);
  });

  test('a negative zero part is the exact zero', () => {
    expect(ce.number(new Complex(-0, 1)).json).toEqual(['Complex', 0, 1]);
    expect(ce.number({ re: -0, im: 3 }).json).toEqual(['Complex', 0, 3]);
    const z = ce.number(new Complex(2, -0));
    expect(isExact(z)).toBe(true);
    expect(z.json).toEqual(2);
  });

  test('a NaN part is NaN', () => {
    expect(ce.number(new Complex(NaN, 1)).isNaN).toBe(true);
    expect(ce.number({ re: NaN, im: 3 }).isNaN).toBe(true);
  });

  test('an infinite part is not exact', () => {
    expect(isExact(ce.number(new Complex(Infinity, 1)))).toBe(false);
  });

  test('a big-decimal part with an exponent too large to write out is a float', () => {
    const z = ce.number({ re: new BigDecimal('1e2000000'), im: 1 });
    expect(isExact(z)).toBe(false);
  });
});

describe('THE COMPLEX RESULT OF A NUMERIC ROUTINE IS A FLOAT', () => {
  test('Conjugate of 2.0+3.0i', () => {
    const z = ce.box(['Conjugate', ce.parse('2.0+3.0i')]).evaluate();
    expect(isExact(z)).toBe(false);
    expect([z.re, z.im]).toEqual([2, -3]);
  });

  test('numeric eigenvalues of a 2x2 matrix', () => {
    const e = ce
      .box(['Eigenvalues', ['List', ['List', 0, -1], ['List', 1, 0]]])
      .N();
    expect(e.ops!.map((x) => isExact(x))).toEqual([false, false]);
  });

  test('numeric eigenvalues of a 4x4 matrix (QR route): complex ones are floats, checked real ones exact', () => {
    const e = ce
      .box([
        'Eigenvalues',
        [
          'List',
          ['List', 0, -1, 0, 0],
          ['List', 1, 0, 0, 0],
          ['List', 0, 0, 2, 1],
          ['List', 0, 0, 1, 2],
        ],
      ])
      .evaluate();
    expect(e.ops!.map((x) => isExact(x))).toEqual([false, false, true, true]);
    expect(e.ops!.map((x) => [x.re, x.im])).toEqual([
      [0, -1],
      [0, 1],
      [3, 0],
      [1, 0],
    ]);
  });

  test('ComplexRoots of a float', () => {
    const e = ce.parse('\\operatorname{ComplexRoots}(1.0, 4)').evaluate();
    expect(e.ops!.map((x) => isExact(x))).toEqual([false, false, false, false]);
    expect(e.ops![0].re).toBe(1);
  });

  test('NIntegrate with a real integer value', () => {
    const z = ce.box(['NIntegrate', ['Function', 1, 'x'], 0, 2]).evaluate();
    expect(isExact(z)).toBe(false);
    expect(z.re).toBe(2);
  });

  test('NIntegrate with a complex value whose parts are integers', () => {
    const z = ce
      .box(['NIntegrate', ['Function', ['Complex', 1, 2], 'x'], 0, 2])
      .evaluate();
    expect(isExact(z)).toBe(false);
    expect([z.re, z.im]).toEqual([2, 4]);
  });

  test('an even root of a negative number under N()', () => {
    const z = ce.box(['Root', ['Negate', ['Power', 2, 212]], 4]).N();
    expect(isExact(z)).toBe(false);
  });

  test('rounding a complex float to the working precision', () => {
    const ce30 = new ComputeEngine();
    ce30.precision = 30;
    const z = ce30.parse('2.0+3.0i').N();
    expect(isExact(z)).toBe(false);
    expect([z.re, z.im]).toEqual([2, 3]);
  });
});

describe('A COMPLEX FLOAT IN A TENSOR', () => {
  const z = ce.parse('1.0+1.0i');

  test('Transpose keeps a float entry a float and an exact entry exact', () => {
    const t = ce
      .box(['Transpose', ['List', ['List', z, 3], ['List', 0, z]]])
      .evaluate();
    expect(t.json).toEqual([
      'List',
      ['List', ['Complex', { num: '1.0' }, { num: '1.0' }], 0],
      ['List', 3, ['Complex', { num: '1.0' }, { num: '1.0' }]],
    ]);
  });

  test('Trace', () => {
    const t = ce
      .box(['Trace', ['List', ['List', z, 0], ['List', 0, z]]])
      .evaluate();
    expect(isExact(t)).toBe(false);
    expect([t.re, t.im]).toEqual([2, 2]);
  });

  test('MatrixMultiply', () => {
    const t = ce
      .box([
        'MatrixMultiply',
        ['List', ['List', z, 0], ['List', 0, 1]],
        ['List', ['List', 1, 0], ['List', 0, 2]],
      ])
      .evaluate();
    expect(isExact(t.ops![0].ops![0])).toBe(false);
    expect(t.ops![1].ops![1].json).toEqual(2);
  });

  test('Determinant', () => {
    const d = ce
      .box(['Determinant', ['List', ['List', z, 0], ['List', 0, z]]])
      .evaluate();
    expect(isExact(d)).toBe(false);
    expect([d.re, d.im]).toEqual([0, 2]);
  });

  test('an exact complex matrix stays exact', () => {
    const t = ce
      .box([
        'Trace',
        [
          'List',
          ['List', ['Complex', 1, 2], 0],
          ['List', 0, ['Complex', 1, 1]],
        ],
      ])
      .evaluate();
    expect(t.json).toEqual(['Complex', 2, 3]);
  });
});

describe('ASSIGNING A COMPLEX VALUE FROM THE HOST', () => {
  test('a { re, im } value with integer parts is exact', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('w', 'complex');
    ce2.symbol('w').value = { re: 2, im: 3 };
    const v = ce2.symbol('w').value!;
    expect(isExact(v)).toBe(true);
    expect(v.json).toEqual(['Complex', 2, 3]);
  });

  test('a big-decimal part keeps its digits', () => {
    const ce2 = new ComputeEngine();
    ce2.precision = 30;
    ce2.declare('w', 'complex');
    ce2.symbol('w').value = {
      re: new BigDecimal('0.123456789012345678901234567'),
      im: 1,
    };
    const v = ce2.symbol('w').value!;
    expect(isNumber(v) && v.bignumRe?.toString()).toBe(
      '0.123456789012345678901234567'
    );
  });
});

describe('THE REAL RESULT OF A NUMERIC ROUTINE IS A FLOAT', () => {
  test('NLimit of a constant', () => {
    const z = ce.box(['NLimit', ['Function', 3, 'x'], 0]).evaluate();
    expect(isExact(z)).toBe(false);
    expect(z.re).toBe(3);
  });

  test('ND', () => {
    const z = ce.box(['ND', ['Function', ['Square', 'x'], 'x'], 1]).evaluate();
    expect(isExact(z)).toBe(false);
    expect(z.re).toBeCloseTo(2, 12);
  });

  test('the 1-norm of a float matrix', () => {
    const z = ce
      .parse('\\operatorname{Norm}([[1.5, 0.5],[0.5,1]], 1)')
      .evaluate();
    expect(isExact(z)).toBe(false);
    expect(z.re).toBe(2);
  });

  test('NDSolve values', () => {
    const r = ce
      .box([
        'NDSolve',
        ['Equal', ['D', ['y', 't'], 't'], 0],
        'y',
        ['Tuple', 't', 0, 1],
        3,
        2,
      ])
      .evaluate();
    for (const row of r.ops!) {
      expect(isExact(row.ops![1])).toBe(false);
      expect(row.ops![1].re).toBe(3);
    }
  });
});

describe('THE QR EIGENVALUES OF AN EXACT MATRIX ARE CHECKED EXACTLY', () => {
  const evaluate = (op: string, m: string) =>
    ce.parse(`\\operatorname{${op}}(${m})`).evaluate();
  const m1 = '[[2,1,0,0],[1,2,0,0],[0,0,3,1],[0,0,1,3]]';
  const m2 = '[[5,4,2,1],[0,1,-1,-1],[-1,-1,3,0],[1,1,-1,2]]';

  test('a symmetric 4x4 matrix', () => {
    expect(evaluate('Eigenvalues', m1).json).toEqual(['List', 3, 1, 4, 2]);
    const vectors = [
      ['List', 1, 1, 0, 0],
      ['List', -1, 1, 0, 0],
      ['List', 0, 0, 1, 1],
      ['List', 0, 0, -1, 1],
    ];
    expect(evaluate('Eigenvectors', m1).json).toEqual(['List', ...vectors]);
    expect(evaluate('Eigen', m1).json).toEqual([
      'Tuple',
      ['List', 3, 1, 4, 2],
      ['List', ...vectors],
    ]);
  });

  test('a defective 4x4 matrix', () => {
    // The QR algorithm gives the double eigenvalue 4 as 4 ± 2.6e-8
    expect(evaluate('Eigenvalues', m2).json).toEqual(['List', 4, 4, 2, 1]);
    const vectors = evaluate('Eigenvectors', m2);
    expect(vectors.ops![2].json).toEqual(['List', 1, -1, 0, 1]);
    expect(vectors.ops!.every((v) => v.ops!.every((x) => isExact(x)))).toBe(
      true
    );
  });

  test('under N() the eigenvalues are approximated', () => {
    const e = ce
      .parse(
        '\\operatorname{Eigenvalues}([[1,1,0,0],[0,2,0,0],[0,0,1,0],[0,0,0,3]]/2)'
      )
      .N();
    expect(e.ops!.map((x) => x.re)).toEqual([0.5, 1, 0.5, 1.5]);
  });

  test('a float matrix gives floats', () => {
    const e = evaluate(
      'Eigenvalues',
      '[[2.0,1,0,0],[1,2,0,0],[0,0,3,1],[0,0,1,3]]'
    );
    expect(e.ops!.map((x) => isExact(x))).toEqual([false, false, false, false]);
  });
});

describe('THE MATRIX KERNELS GIVE FLOATS FOR A FLOAT MATRIX', () => {
  const evaluate = (op: string, m: string) =>
    ce.parse(`\\operatorname{${op}}(${m})`).evaluate();
  const leaves = (x: Expression): Expression[] =>
    x.ops ? x.ops.flatMap(leaves) : [x];

  test.each(['SingularValues', 'SVD', 'QRDecomposition', 'Eigenvectors'])(
    '%s of [[3.0,0],[0,4.0]]',
    (op) => {
      const r = evaluate(op, '[[3.0,0],[0,4.0]]');
      expect(leaves(r).every((x) => isExact(x) === false)).toBe(true);
    }
  );

  test('the spectral norm', () => {
    const r = ce
      .parse('\\operatorname{Norm}([[1.5,0.5,0],[0.5,1.5,0],[0,0,1]], 2)')
      .evaluate();
    expect(isExact(r)).toBe(false);
    expect(r.re).toBeCloseTo(2, 14);
  });

  test.each(['SingularValues', 'QRDecomposition', 'Eigenvectors'])(
    '%s of the exact [[2,0],[0,3]] stays exact',
    (op) => {
      const r = evaluate(op, '[[2,0],[0,3]]');
      expect(leaves(r).every((x) => isExact(x) === true)).toBe(true);
    }
  );
});

describe('THE GRID POINTS OF NDSOLVE', () => {
  test('an exact limit is an exact end point, an inner point is a float', () => {
    const r = ce
      .box([
        'NDSolve',
        ['Equal', ['D', ['y', 't'], 't'], 0],
        'y',
        ['Tuple', 't', 0, 2],
        3,
        2,
      ])
      .evaluate();
    const xs = r.ops!.map((row) => row.ops![0]);
    expect(xs.map((x) => x.re)).toEqual([0, 1, 2]);
    expect(xs.map((x) => isExact(x))).toEqual([true, false, true]);
  });

  test('a float limit is a float end point', () => {
    const r = ce
      .box([
        'NDSolve',
        ['Equal', ['D', ['y', 't'], 't'], 0],
        'y',
        ['Tuple', 't', 0, ce.parse('2.0')],
        3,
        2,
      ])
      .evaluate();
    expect(isExact(r.ops![2].ops![0])).toBe(false);
  });
});
