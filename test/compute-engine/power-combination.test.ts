import { ComputeEngine } from '../../src/compute-engine';
import { engine } from '../utils';
import type { MathJsonExpression as Expression } from '../../src/math-json/types';

function check(
  latex: string,
  expected: Expression,
  options?: { simplify?: boolean; assume?: string[] }
): void {
  const ce = engine;
  ce.pushScope();
  try {
    if (options?.assume) {
      for (const a of options.assume) ce.assume(ce.parse(a));
    }
    const expr = ce.parse(latex);
    const result = options?.simplify ? expr.simplify() : expr;
    expect(result.json).toEqual(expected);
  } finally {
    ce.popScope();
  }
}

describe('Power Combination (#176)', () => {
  test('numeric base with symbolic exponent', () => {
    check('2 \\cdot 2^x', ['Power', 2, ['Add', 'x', 1]], { simplify: true });
    check('2^x \\cdot 2', ['Power', 2, ['Add', 'x', 1]], { simplify: true });
    check('2^x \\cdot 2^1', ['Power', 2, ['Add', 'x', 1]], { simplify: true });
  });

  test('constant base with symbolic exponent', () => {
    check('e \\cdot e^x', ['Power', 'ExponentialE', ['Add', 'x', 1]], {
      simplify: true,
    });
    check('e^x \\cdot e', ['Power', 'ExponentialE', ['Add', 'x', 1]], {
      simplify: true,
    });
  });

  test('three operands with same base', () => {
    // e * e^x * e^{-x} = e^(1 + x + (-x)) = e^1 = e
    check('e \\cdot e^x \\cdot e^{-x}', 'ExponentialE', { simplify: true });

    // 3 * 3^a * 3^b = 3^(a + b + 1)
    check('3 \\cdot 3^a \\cdot 3^b', ['Power', 3, ['Add', 'a', 'b', 1]], {
      simplify: true,
    });
  });

  test('multiple operands with numeric bases', () => {
    // 5 * 5^2 * 5^3 = 5^6 = 15625 (fully evaluated when all-numeric)
    check('5 \\cdot 5^2 \\cdot 5^3', 15625, { simplify: true });
  });

  test('variable base with known positive sign', () => {
    // When base is positive, can safely combine
    check('x \\cdot x^2', ['Power', 'x', 3], {
      simplify: true,
      assume: ['x > 0'],
    });
    check('x^2 \\cdot x \\cdot x^3', ['Power', 'x', 6], {
      simplify: true,
      assume: ['x > 0'],
    });
  });

  test('mixed bases should not combine', () => {
    // Different bases - should not combine
    check('2 \\cdot 3^x', ['Multiply', 2, ['Power', 3, 'x']], {
      simplify: true,
    });
    check('e \\cdot 2^x', ['Multiply', 'ExponentialE', ['Power', 2, 'x']], {
      simplify: true,
    });
  });

  test('two powers with same base', () => {
    // e^2 * e^3 = e^5 (stays symbolic)
    check('e^2 \\cdot e^3', ['Power', 'ExponentialE', 5], { simplify: true });
    check('2^a \\cdot 2^b', ['Power', 2, ['Add', 'a', 'b']], {
      simplify: true,
    });
  });

  test('power of sum exponents', () => {
    // e^(x+1) * e^(x+2) = e^(2x+3)
    check('e^{x+1} \\cdot e^{x+2}', ['Power', 'ExponentialE', ['Add', ['Multiply', 2, 'x'], 3]], {
      simplify: true,
    });
  });

  test('negative exponents', () => {
    // 2 * 2^{-1} = 2^0 = 1
    check('2 \\cdot 2^{-1}', 1, { simplify: true });

    // e * e^{-1} = e^0 = 1
    check('e \\cdot e^{-1}', 1, { simplify: true });

    // x * x^{-1} = x^0 = 1 (when x > 0)
    check('x \\cdot x^{-1}', 1, { simplify: true, assume: ['x > 0'] });
  });

  test('factoring numeric coefficients to match base', () => {
    check('4 \\cdot 2^x', ['Power', 2, ['Add', 'x', 2]], { simplify: true });
    check('8 \\cdot 2^x', ['Power', 2, ['Add', 'x', 3]], { simplify: true });
    check('9 \\cdot 3^x', ['Power', 3, ['Add', 'x', 2]], { simplify: true });
    check('27 \\cdot 3^n', ['Power', 3, ['Add', 'n', 3]], { simplify: true });
  });

  test('multiple numeric factors with power base', () => {
    check('2 \\cdot 2 \\cdot 2^x', ['Power', 2, ['Add', 'x', 2]], {
      simplify: true,
    });
    check('3 \\cdot 3 \\cdot 3 \\cdot 3^a', ['Power', 3, ['Add', 'a', 3]], {
      simplify: true,
    });
  });

  test('coefficient that is not a perfect power should not factor', () => {
    // 5 * 2^x cannot be simplified further (5 is not a power of 2)
    check('5 \\cdot 2^x', ['Multiply', 5, ['Power', 2, 'x']], {
      simplify: true,
    });

    // 6 * 2^x cannot be simplified (6 = 2*3, not a power of 2)
    check('6 \\cdot 2^x', ['Multiply', 6, ['Power', 2, 'x']], {
      simplify: true,
    });
  });

  test('negative coefficients', () => {
    // -4·2^x → -2^(x+2)
    check('-4 \\cdot 2^x', ['Negate', ['Power', 2, ['Add', 'x', 2]]], {
      simplify: true,
    });
    // -8·2^x → -2^(x+3)
    check('-8 \\cdot 2^x', ['Negate', ['Power', 2, ['Add', 'x', 3]]], {
      simplify: true,
    });
  });

  test('sqrt coefficient factoring', () => {
    // √2·2^x → 2^(x+1/2)
    check('\\sqrt{2} \\cdot 2^x', ['Power', 2, ['Add', 'x', ['Rational', 1, 2]]], {
      simplify: true,
    });
    // √3·3^x → 3^(x+1/2)
    check('\\sqrt{3} \\cdot 3^x', ['Power', 3, ['Add', 'x', ['Rational', 1, 2]]], {
      simplify: true,
    });
  });

  test('rational (division) coefficient factoring', () => {
    // 2^x / 4 → 2^(x-2)
    check('\\frac{2^x}{4}', ['Power', 2, ['Add', 'x', -2]], {
      simplify: true,
    });
    // 3^x / 9 → 3^(x-2)
    check('\\frac{3^x}{9}', ['Power', 3, ['Add', 'x', -2]], {
      simplify: true,
    });
  });

  test('rational-radical coefficient factoring', () => {
    // 2√2·2^x → 2^(x+3/2) since 2√2 = 2^1 · 2^(1/2) = 2^(3/2)
    check('2\\sqrt{2} \\cdot 2^x', ['Power', 2, ['Add', 'x', ['Rational', 3, 2]]], {
      simplify: true,
    });
    // √2/2·2^x → 2^(x-1/2) since √2/2 = 2^(1/2) · 2^(-1) = 2^(-1/2)
    check('\\frac{\\sqrt{2}}{2} \\cdot 2^x', ['Power', 2, ['Add', 'x', ['Rational', -1, 2]]], {
      simplify: true,
    });
  });

  test('multi-prime coefficient factoring', () => {
    // 12·2^x·3^x → 2^(x+2)·3^(x+1) since 12 = 2^2 * 3^1
    check(
      '12 \\cdot 2^x \\cdot 3^x',
      ['Multiply', ['Power', 2, ['Add', 'x', 2]], ['Power', 3, ['Add', 'x', 1]]],
      { simplify: true }
    );
  });
});

describe('Same-base products need no non-zero base (#415)', () => {
  // The engine reads `x/x` as 1 for a symbol `x`, and `simplify()` combines
  // the quotient `x^a / x^b` with no check on the base. Products follow the
  // same convention.
  test('symbolic exponents over an unconstrained symbol', () => {
    check('x^a \\cdot x^b', ['Power', 'x', ['Add', 'a', 'b']], {
      simplify: true,
    });
    check('x^a \\cdot x^{-a}', 1, { simplify: true });
    check('x \\cdot x^a', ['Power', 'x', ['Add', 'a', 1]], { simplify: true });
    check('x^a \\cdot x \\cdot x^b', ['Power', 'x', ['Add', 'a', 'b', 1]], {
      simplify: true,
    });
    check('x^a \\cdot x^b \\cdot x^c', ['Power', 'x', ['Add', 'a', 'b', 'c']], {
      simplify: true,
    });
  });

  test('products and quotients agree', () => {
    const aMinusB = ['Power', 'x', ['Add', 'a', ['Negate', 'b']]] as Expression;
    check('\\frac{x^a}{x^b}', aMinusB, { simplify: true });
    check('x^a \\cdot x^{-b}', aMinusB, { simplify: true });
  });

  test('other factors are kept', () => {
    check(
      'y \\cdot x^a \\cdot x^b',
      ['Multiply', 'y', ['Power', 'x', ['Add', 'a', 'b']]],
      {
        simplify: true,
      }
    );
  });

  test('constant and numeric bases still combine', () => {
    check('e^x \\cdot e^y', ['Power', 'ExponentialE', ['Add', 'x', 'y']], {
      simplify: true,
    });
    check('2^x \\cdot 2^y', ['Power', 2, ['Add', 'x', 'y']], {
      simplify: true,
    });
  });

  test('a base with an assumption', () => {
    check('t^a \\cdot t^b', ['Power', 't', ['Add', 'a', 'b']], {
      simplify: true,
      assume: ['t > 0'],
    });
  });

  test('a literal zero base is not combined into 0^0', () => {
    // Canonicalization reduces 0^{-1} to ComplexInfinity, so the product is
    // 0·∞, which is indeterminate. It must not become 0^0 or 1.
    const expr = engine.box(['Multiply', ['Power', 0, 1], ['Power', 0, -1]]);
    expect(expr.simplify().json).toEqual('Indeterminate');
    expect(expr.evaluate().json).toEqual('Indeterminate');
  });

  test('a provably infinite base is not combined', () => {
    // At u = +∞ and a = 1, u^a·u^(−a) is ∞·0, which is indeterminate. It
    // must not become 3·u^0 or 3.
    engine.pushScope();
    try {
      engine.declare('u', 'signed_infinity');
      const product = engine.box([
        'Multiply',
        3,
        ['Power', 'u', 'a'],
        ['Power', 'u', ['Negate', 'a']],
      ]);
      expect(product.simplify().json).toEqual(product.json);
      const quotient = engine.box([
        'Divide',
        ['Power', 'u', 'a'],
        ['Power', 'u', 'b'],
      ]);
      expect(quotient.simplify().json).toEqual(quotient.json);
    } finally {
      engine.popScope();
    }
  });

  test('evaluate() does not combine symbolic exponents', () => {
    expect(engine.parse('x^a \\cdot x^b').evaluate().json).toEqual([
      'Multiply',
      ['Power', 'x', 'a'],
      ['Power', 'x', 'b'],
    ]);
  });
});

describe('Same-base powers of a matrix are not combined as scalars', () => {
  // `Multiply` of two matrices is the matrix product, but `Exp` of a matrix
  // and `Power` of a matrix with a non-integer exponent are element-wise. So
  // `Exp(A)·Exp(B)` is not `Exp(A+B)` and `√A·√A` is not `A`. A positive
  // integer power of a matrix is the matrix power.
  // Constructing an engine sets the module-global BigDecimal precision. Use
  // the precision of the shared engine, so that its tests later in this file
  // are not run at a lower precision.
  const ce = new ComputeEngine({ precision: engine.precision });
  ce.declare('A', 'matrix<2x2>');
  ce.declare('B', 'matrix<2x2>');
  const L1: Expression = ['List', ['List', 1, 2], ['List', 3, 4]];
  const L2: Expression = ['List', ['List', 0, 1], ['List', 1, 0]];
  const simplified = (x: Expression) => ce.box(x).simplify().json;

  test.each<[string, Expression]>([
    ['Exp(A)·Exp(B)', ['Multiply', ['Exp', 'A'], ['Exp', 'B']]],
    ['Exp(A)·Exp(A)', ['Multiply', ['Exp', 'A'], ['Exp', 'A']]],
    ['2^A·2^B', ['Multiply', ['Power', 2, 'A'], ['Power', 2, 'B']]],
    ['A^a·A^b', ['Multiply', ['Power', 'A', 'a'], ['Power', 'A', 'b']]],
    ['A·A^a', ['Multiply', 'A', ['Power', 'A', 'a']]],
    [
      'A^(1/3)·A^(2/3)',
      ['Multiply', ['Root', 'A', 3], ['Power', 'A', ['Rational', 2, 3]]],
    ],
    ['A^a/A^b', ['Divide', ['Power', 'A', 'a'], ['Power', 'A', 'b']]],
    ['A^a/A', ['Divide', ['Power', 'A', 'a'], 'A']],
    ['A/A^a', ['Divide', 'A', ['Power', 'A', 'a']]],
    ['Exp(L1)·Exp(L2)', ['Multiply', ['Exp', L1], ['Exp', L2]]],
    ['L1^a·L1^b', ['Multiply', ['Power', L1, 'a'], ['Power', L1, 'b']]],
  ])('%s is unchanged by simplify()', (_, x) => {
    expect(simplified(x)).toEqual(ce.box(x).json);
  });

  test('√A·√A is the matrix square of √A, not A', () => {
    const x: Expression = ['Multiply', ['Sqrt', 'A'], ['Sqrt', 'A']];
    const square = ['MatrixPower', ['Sqrt', 'A'], 2];
    expect(simplified(x)).toEqual(square);
    expect(ce.box(x).evaluate().json).toEqual(square);
  });

  test('√L·√L of a literal matrix keeps its value', () => {
    const x = ce.box(['Multiply', ['Sqrt', L1], ['Sqrt', L1]]);
    // The matrix product of [[1, √2], [√3, 2]] with itself
    expect(x.simplify().N().json).toEqual(x.N().json);
    expect(x.simplify().json).not.toEqual(L1);
  });

  test('a positive integer power of a matrix is the matrix power', () => {
    expect(simplified(['Multiply', 'A', 'A'])).toEqual(['MatrixPower', 'A', 2]);
  });

  test('(e^A)^2 is the matrix power, not e^(2A)', () => {
    const square = ['MatrixPower', ['Power', 'ExponentialE', 'A'], 2];
    expect(ce.box(['Power', ['Exp', 'A'], 2]).json).toEqual(square);
    expect(
      ce.box(['Multiply', ['Exp', 'A'], ['Exp', 'A']]).evaluate().json
    ).toEqual(square);
  });

  test('Exp(L)·Exp(L) of a literal matrix is the matrix product', () => {
    const e = ce.box(['Exp', L1]).N();
    const expected = ce.box(['Multiply', e, e]).N().json;
    expect(ce.box(['Multiply', ['Exp', L1], ['Exp', L1]]).N().json).toEqual(
      expected
    );
  });

  // The matrix product is not commutative: only adjacent factors with the
  // same base are combined. A non-scalar factor between two factors with the
  // same base keeps them apart.
  test.each<[string, Expression]>([
    ['A·B·A', ['Multiply', 'A', 'B', 'A']],
    ['B·A·B·A', ['Multiply', 'B', 'A', 'B', 'A']],
    ['A·A^a·A', ['Multiply', 'A', ['Power', 'A', 'a'], 'A']],
    ['√A·B·√A', ['Multiply', ['Sqrt', 'A'], 'B', ['Sqrt', 'A']]],
  ])('%s keeps the order of its factors in simplify()', (_, x) => {
    expect(simplified(x)).toEqual(ce.box(x).json);
  });

  test.each<[string, Expression]>([
    ['√A·B·√A', ['Multiply', ['Sqrt', 'A'], 'B', ['Sqrt', 'A']]],
    ['A^x·B·A^x', ['Multiply', ['Power', 'A', 'x'], 'B', ['Power', 'A', 'x']]],
  ])('%s keeps the order of its factors in evaluate()', (_, x) => {
    expect(ce.box(x).evaluate().json).toEqual(ce.box(x).json);
  });

  test('adjacent factors with the same base are combined', () => {
    const square = ['Multiply', ['MatrixPower', 'A', 2], 'B'];
    expect(simplified(['Multiply', 'A', 'A', 'B'])).toEqual(square);
    expect(ce.box(['Multiply', 'A', 'A', 'B']).evaluate().json).toEqual(square);
  });

  test('scalar symbols of the same engine still combine', () => {
    expect(
      simplified(['Multiply', ['Power', 'x', 'a'], ['Power', 'x', 'b']])
    ).toEqual(['Power', 'x', ['Add', 'a', 'b']]);
  });
});

describe('Complex exponents (regression)', () => {
  test('Power(2, i) does not fold to 1 at canonicalization', () => {
    // Regression: the exact-power fold read only the real part of the
    // exponent, so 2^i canonicalized as 2^0 = 1
    const expr = engine.expr(['Power', 2, ['Complex', 0, 1]]);
    expect(expr.toString()).toBe('2^i');
    const v = expr.N();
    // 2^i = cos(ln 2) + i·sin(ln 2)
    expect(v.re).toBeCloseTo(0.7692389013639721, 14);
    expect(v.im).toBeCloseTo(0.6389612763136348, 14);
  });

  test('Power with mixed complex exponent evaluates numerically', () => {
    const v = engine.expr(['Power', 2, ['Complex', 1, 1]]).N();
    expect(v.re).toBeCloseTo(1.5384778027279442, 14);
    expect(v.im).toBeCloseTo(1.2779225526272695, 14);
  });

  test('integer exact-power folding still applies', () => {
    expect(engine.expr(['Power', 2, 3]).toString()).toBe('8');
    expect(engine.expr(['Power', ['Rational', 1, 2], 2]).toString()).toBe(
      '1/4'
    );
  });

  test('ImaginaryUnit.N() resolves to the imaginary literal', () => {
    // Regression: holdUntil 'never' was misread as "never substitute" in
    // BoxedSymbol.N(), leaving products like 0.25·i unfolded under N()
    const i = engine.symbol('ImaginaryUnit');
    expect(i.N().im).toBe(1);
    const v = engine.expr(['Multiply', 0.25, 'ImaginaryUnit']).N();
    expect(v.re).toBe(0);
    expect(v.im).toBe(0.25);
  });

  test('e^{iπ/12} evaluates numerically (Euler form)', () => {
    const v = engine
      .expr(['Exp', ['Divide', ['Multiply', 'ImaginaryUnit', 'Pi'], 12]])
      .N();
    expect(v.re).toBeCloseTo(Math.cos(Math.PI / 12), 14);
    expect(v.im).toBeCloseTo(Math.sin(Math.PI / 12), 14);
  });

  test('e^{iπ/3} evaluates to an EXACT expression, not a float (Euler form)', () => {
    // Regression: the Euler branch assembled the result with the `.add()`/
    // `.mul()` methods, which fold the exact cos/sin literals (1/2, √3/2) to
    // machine floats — violating the evaluate-vs-N exactness contract.
    const e = engine.parse('e^{i\\pi/3}').evaluate();
    // No decimal float appears in the serialization (exact radical/rational).
    expect(e.toString()).toBe('1/2 + sqrt(3)/2i');
    expect(e.isSame(engine.parse('\\frac12 + \\frac{\\sqrt3}{2}i'))).toBe(true);
    // .N() still numericizes.
    const n = e.N();
    expect(n.re).toBeCloseTo(Math.cos(Math.PI / 3), 15);
    expect(n.im).toBeCloseTo(Math.sin(Math.PI / 3), 15);
  });

  test('e^{iπ/2} → i and e^{iπ} → -1 (degenerate cases fold structurally)', () => {
    expect(engine.parse('e^{i\\pi/2}').evaluate().toString()).toBe('i');
    expect(engine.parse('e^{i\\pi}').evaluate().toString()).toBe('-1');
  });
});

describe('Exponential of an imaginary argument stays symbolic', () => {
  const eToTheI = (theta: Expression): Expression => [
    'Power',
    'ExponentialE',
    ['Multiply', 'ImaginaryUnit', theta],
  ];

  test('e^{ix} (symbolic angle) is NOT Euler-expanded by evaluate()', () => {
    // A basis change, not an evaluation — keep the compact exponential.
    expect(engine.expr(eToTheI('x')).evaluate().toString()).toBe('e^(i * x)');
  });

  test('(e^{ix})^2 = e^{2ix} — consistent with bare e^{ix}', () => {
    // Regression: the power path used to Euler-expand the square while the
    // base stayed exponential.
    const sq = engine.expr(['Power', eToTheI('x'), 2]);
    expect(sq.toString()).toBe('e^(2i * x)');
    expect(sq.evaluate().toString()).toBe('e^(2i * x)');
  });

  test('constant angles still reduce', () => {
    expect(engine.expr(eToTheI(['Divide', 'Pi', 2])).evaluate().toString()).toBe(
      'i'
    );
    expect(engine.expr(eToTheI('Pi')).evaluate().toString()).toBe('-1');
  });

  test('e^{ln y} still reduces to y', () => {
    expect(
      engine.expr(['Power', 'ExponentialE', ['Ln', 'y']]).evaluate().toString()
    ).toBe('y');
  });

  test('simplify({strategy:"trig"}) converts to trigonometric form', () => {
    const f = (theta: Expression) =>
      engine
        .expr(eToTheI(theta))
        .simplify({ strategy: 'trig' })
        .toString();
    expect(f('x')).toBe('i * sin(x) + cos(x)');
    expect(f(['Multiply', 2, 'x'])).toBe('i * sin(2x) + cos(2x)');
  });
});
