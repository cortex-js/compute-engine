import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Exact results the 2026-09-28 reference-example round found missing or
// wrong: each was an engine defect a documentation example ran into.
//
function run(source: string): string {
  return executeEpsil(new ComputeEngine(), source).value.toString();
}

describe('trigonometry', () => {
  test('InverseFunction covers every circular and hyperbolic function', () => {
    // `Csc` mapped to ' Arccsc' (a leading space: an invalid symbol), and
    // `Cot`, `Coth`, `Arccot`, `Arcoth`, `Arsech` had no entry.
    expect(run('inverseFunction(Csc)')).toBe('arccsc');
    expect(run('inverseFunction(Cot)')).toBe('arccot');
    expect(run('inverseFunction(Coth)')).toBe('arcoth');
    expect(run('inverseFunction(Arsech)')).toBe('sech');
  });

  test('Arccot has exact special values, in (0, π)', () => {
    expect(run('arccot(1)')).toBe('1/4 * pi');
    expect(run('arccot(sqrt(3))')).toBe('1/6 * pi');
    expect(run('arccot(0)')).toBe('1/2 * pi');
    // A negative argument reflects about π/2, as the kernel `atan2(1, x)`.
    expect(run('arccot(-1)')).toBe('3/4 * pi');
    expect(run('arccot(-sqrt(3))')).toBe('5/6 * pi');
  });

  test('Sinc of an exact multiple of π is exact', () => {
    expect(run('sinc(Pi)')).toBe('0');
    expect(run('N(sinc(Pi))')).toBe('0');
    expect(run('sinc(Pi / 2)')).toBe('2 / pi');
    expect(run('sinc(0)')).toBe('1');
    expect(run('sinc(1)')).toBe('Sinc(1)');
  });

  test('N(Arcosh(x)) is purely imaginary for x in [-1, 1]', () => {
    const v = new ComputeEngine().box(['Arcosh', ['Rational', 1, 2]]).N();
    expect(v.re).toBe(0);
    expect(v.im).toBeCloseTo(Math.PI / 3, 14);
  });

  test('TrigExpand keeps an assigned variable and handles a tangent pole', () => {
    expect(run('let y = 5\ntrigExpand(sin(x + y))')).toBe(
      'sin(y) * cos(x) + sin(x) * cos(y)'
    );
    expect(run('trigExpand(tan(x + Pi/2))')).toBe('-cos(x) / sin(x)');
  });

  test('TrigExpand folds the special values of its constant angles', () => {
    expect(run('trigExpand(sin(x + Pi/2))')).toBe('cos(x)');
    expect(run('trigExpand(cos(x + Pi))')).toBe('-cos(x)');
    expect(run('trigExpand(sin(x + 1))')).toBe(
      'sin(1) * cos(x) + sin(x) * cos(1)'
    );
  });
});

describe('linear algebra', () => {
  test('the eigenvalues of an exact 2×2 matrix are exact', () => {
    expect(run('eigenvalues([[1, 2], [3, 4]])')).toBe(
      '[1/2 * (5 + sqrt(33)),1/2 * (5 - sqrt(33))]'
    );
    expect(run('eigenvalues([[0, -1], [1, 0]])')).toBe('[i,-i]');
  });

  test('the eigenvalues of an exact 3×3 matrix with a rational root', () => {
    expect(run('eigenvalues([[2, 0, 0], [0, 3, 4], [0, 4, 9]])')).toBe(
      '[11,2,1]'
    );
    expect(run('eigenvalues([[2, 1, 0], [1, 2, 1], [0, 1, 2]])')).toBe(
      '[2 + sqrt(2),2,2 - sqrt(2)]'
    );
    expect(run('N(eigenvalues([[2, 1, 0], [1, 2, 1], [0, 1, 2]]))')).toBe(
      '[3.4142135623730950488,2,0.585786437626904951198]'
    );
    // An irreducible cubic keeps the numeric route.
    expect(run('eigenvalues([[1, 2, 3], [4, 5, 6], [7, 8, 10]])')).toMatch(
      /^\[16\.7/
    );
  });

  test('the adjugate is the transposed cofactor matrix', () => {
    expect(run('adjugateMatrix([[1, 2], [3, 4]])')).toBe('[[4,-2],[-3,1]]');
    // A · adj(A) = det(A) · I, here with det(A) = 1.
    expect(
      run('let A = [[1, 2, 3], [0, 1, 4], [5, 6, 0]]\nA * adjugateMatrix(A)')
    ).toBe('[[1,0,0],[0,1,0],[0,0,1]]');
    // Defined for a singular matrix too.
    expect(run('adjugateMatrix([[1, 2], [2, 4]])')).toBe('[[4,-2],[-2,1]]');
    expect(run('adjugateMatrix([[5]])')).toBe('[[1]]');
  });

  test('the pseudoinverse of a full-rank matrix', () => {
    // Square and invertible: the inverse.
    expect(run('pseudoInverse([[1, 2], [3, 4]])')).toBe('[[-2,1],[3/2,-1/2]]');
    // Full column rank: a left inverse.
    expect(run('pseudoInverse([[1, 2], [3, 4], [5, 6]])')).toBe(
      '[[-4/3,-1/3,2/3],[13/12,1/3,-5/12]]'
    );
    expect(run('let A = [[1, 2], [3, 4], [5, 6]]\npseudoInverse(A) * A')).toBe(
      '[[1,0],[0,1]]'
    );
    // Full row rank: a right inverse.
    expect(run('let A = [[1, 2, 3], [4, 5, 6]]\nA * pseudoInverse(A)')).toBe(
      '[[1,0],[0,1]]'
    );
    // Complex: the conjugate transpose.
    expect(run('let A = [[1, i], [0, 1], [1, 0]]\npseudoInverse(A) * A')).toBe(
      '[[1,0],[0,1]]'
    );
    // Rank-deficient: not computed, stays unevaluated.
    expect(run('pseudoInverse([[1, 2], [2, 4]])')).toBe(
      'PseudoInverse([[1,2],[2,4]])'
    );
  });
});

describe('arithmetic', () => {
  test('the logarithm of a reciprocal power is exact', () => {
    expect(run('log(1/8, 2)')).toBe('-3');
    expect(run('lb(1/8)')).toBe('-3');
    expect(run('log(1/100)')).toBe('-2');
    expect(run('log(1/8, 4)')).toBe('-3/2');
    expect(run('log(1/3, 2)')).toBe('log(1/3, 2)');
  });

  test('the complex roots of an exact real are exact', () => {
    expect(run('complexRoots(1, 4)')).toBe('[1,i,-1,-i]');
    expect(run('N(complexRoots(1, 4))')).toBe('[1,i,-1,-i]');
    expect(run('complexRoots(8, 3)')).toBe('[2,-1 + sqrt(3)i,-1 - sqrt(3)i]');
    expect(run('complexRoots(-1, 2)')).toBe('[i,-i]');
  });

  test('Interpret reads a left-nested Epsil chain', () => {
    expect(run('interpret(1 + 2 + ContinuationPlaceholder + n)')).toBe(
      'sum_(k=1)^(n)(k)'
    );
    expect(run('interpret(2 * 4 * ContinuationPlaceholder * 2n)')).toBe(
      'prod_(k=1)^(n)(2k)'
    );
  });

  test('the supremum and infimum of an open interval', () => {
    expect(run('supremum(interval(open(0), open(1)))')).toBe('1');
    expect(run('infimum(interval(open(0), open(1)))')).toBe('0');
    // An open interval has no maximum.
    expect(run('max(interval(open(0), open(1)))')).toBe(
      'max(Interval(Open(0), Open(1)))'
    );
    expect(run('max(interval(closed(0), closed(1)))')).toBe('1');
  });

  test('PreIncrement and PreDecrement evaluate', () => {
    expect(run('PreIncrement(5)')).toBe('6');
    expect(run('PreDecrement(5)')).toBe('4');
    expect(run('PreIncrement(x)')).toBe('x + 1');
  });

  test('a geometric series with a negated index', () => {
    expect(run('sum(2^(-k), (k, 0, oo))')).toBe('2');
    expect(run('sum(3 * 2^(-k), (k, 0, oo))')).toBe('6');
    expect(run('sum(2^k, (k, 0, oo))')).toBe('sum_(k=0)^(+oo)(2^k)');
  });

  test('the complex roots are exact for a rational and in degree mode', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['ComplexRoots', ['Rational', 1, 8], 3])
        .evaluate()
        .toString()
    ).toBe('[1/2,-1/4 + sqrt(3)/4i,-1/4 - sqrt(3)/4i]');
    expect(
      ce
        .box(['ComplexRoots', { num: '100000000000000000001' }, 1])
        .evaluate()
        .toString()
    ).toBe('[100000000000000000001]');
    const deg = new ComputeEngine();
    deg.angularUnit = 'deg';
    expect(deg.box(['ComplexRoots', 1, 2]).evaluate().toString()).toBe(
      '[1,-1]'
    );
  });

  test('a float measurement error evaluates', () => {
    expect(run('measurement(5, 0.2) + 3')).toBe('8.00 ± 0.20');
    expect(run('measurement(5, 1) * measurement(2, 1)')).toBe('10 ± sqrt(29)');
  });
});
