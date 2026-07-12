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
