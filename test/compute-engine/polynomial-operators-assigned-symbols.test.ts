import { ComputeEngine } from '../../src/compute-engine';

//
// The lazy polynomial operators (`PolynomialDegree`, `CoefficientList`,
// `PolynomialQuotient`, `PolynomialRemainder`, `PolynomialGCD`, `Resultant`,
// `Cancel`, `PartialFraction`, `PolynomialRoots`, `Discriminant`) receive
// their operands unevaluated. Like `Expand` and `Factor`, they must resolve a
// symbol bound to a polynomial to its value (`reduceTransformerOperand`), and
// read the default variable from that value. Before this was fixed,
// `PolynomialDegree(p, x)` with `p := x^3 - 2x^2 - 4` was `0` and
// `PolynomialQuotient(p, q, x)` stayed `p / q`.
//

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('p', ce.parse('x^3 - 2x^2 - 4'));
  ce.assign('q', ce.parse('x - 3'));
  ce.assign('r', ce.parse('x^2 - 5x + 6'));
  return ce;
}

describe('POLYNOMIAL OPERATORS are transformer heads', () => {
  test('Expand reduces a nested polynomial quotient before expanding', () => {
    const ce = engine();
    // Before the polynomial operators were listed among the transformer
    // heads, `Expand` left `PolynomialQuotient(…)` unevaluated inside its
    // operand and the product stayed symbolic.
    const e = ce.box([
      'Expand',
      [
        'Add',
        ['Multiply', ['PolynomialQuotient', 'p', 'q', 'x'], 'q'],
        ['PolynomialRemainder', 'p', 'q', 'x'],
      ],
    ]);
    expect(e.evaluate().toString()).toBe('x^3 - 2x^2 - 4');
  });
});

describe('POLYNOMIAL OPERATORS resolve assigned symbols', () => {
  test('PolynomialDegree and CoefficientList', () => {
    const ce = engine();
    expect(ce.box(['PolynomialDegree', 'p', 'x']).evaluate().json).toBe(3);
    // The default variable is read from the value, not from the symbol `p`.
    expect(ce.box(['PolynomialDegree', 'p']).evaluate().json).toBe(3);
    expect(ce.box(['CoefficientList', 'p', 'x']).evaluate().json).toEqual([
      'List',
      1,
      -2,
      0,
      -4,
    ]);
  });

  test('PolynomialQuotient and PolynomialRemainder', () => {
    const ce = engine();
    expect(
      ce.box(['PolynomialQuotient', 'p', 'q', 'x']).evaluate().toString()
    ).toBe('x^2 + x + 3');
    expect(ce.box(['PolynomialRemainder', 'p', 'q', 'x']).evaluate().json).toBe(
      5
    );
  });

  test('PolynomialGCD and Resultant', () => {
    const ce = engine();
    expect(ce.box(['PolynomialGCD', 'r', 'q', 'x']).evaluate().toString()).toBe(
      'x - 3'
    );
    expect(ce.box(['Resultant', 'r', 'q', 'x']).evaluate().json).toBe(0);
  });

  test('PolynomialRoots and Discriminant', () => {
    const ce = engine();
    expect(ce.box(['Discriminant', 'r', 'x']).evaluate().json).toBe(1);
    const roots = ce.box(['PolynomialRoots', 'r', 'x']).evaluate();
    expect([...roots.each()].map((e) => e.re).sort()).toEqual([2, 3]);
  });

  test('Cancel, PartialFraction and Apart give the exact decomposition', () => {
    const ce = engine();
    ce.assign('f', ce.parse('\\frac{x^2 - 1}{x - 1}'));
    expect(ce.box(['Cancel', 'f', 'x']).evaluate().toString()).toBe('x + 1');
    ce.assign('g', ce.parse('\\frac{1}{(x + 1)(x + 2)}'));
    const expected = ce.parse('\\frac{1}{x + 1} - \\frac{1}{x + 2}');
    for (const op of ['PartialFraction', 'Apart']) {
      const apart = ce.box([op, 'g', 'x']).evaluate();
      expect(apart.isSame(expected) || apart.isEqual(expected)).toBe(true);
    }
  });

  test('the parse route resolves the symbols too', () => {
    // A lazy operator receives its operands unbound on the parse route, so
    // the resolution must not depend on `ce.function()` pre-boxing them.
    const ce = engine();
    expect(
      ce.parse('\\operatorname{PolynomialDegree}(p, x)').evaluate().json
    ).toBe(3);
    expect(
      ce.parse('\\operatorname{PolynomialRemainder}(p, q, x)').evaluate().json
    ).toBe(5);
  });
});

describe('POLYNOMIAL OPERATORS never substitute the variable they are asked about', () => {
  // With `x := 5`, `PolynomialDegree(x^2 + 1, x)` is a question about `x`;
  // resolving `x` to 5 would turn the polynomial into the number 26. The
  // protection applies to a variable inside a bound polynomial as well.
  test('an explicit variable with a value is protected', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const poly = ['Add', ['Power', 'x', 2], 1];
    expect(ce.box(['PolynomialDegree', poly, 'x']).evaluate().json).toBe(2);
    expect(ce.box(['CoefficientList', poly, 'x']).evaluate().json).toEqual([
      'List',
      1,
      0,
      1,
    ]);
    expect(
      ce
        .box([
          'PolynomialQuotient',
          ['Subtract', ['Power', 'x', 2], 1],
          ['Subtract', 'x', 1],
          'x',
        ])
        .evaluate()
        .toString()
    ).toBe('x + 1');
    expect(
      ce
        .box(['Factor', ['Subtract', ['Power', 'x', 2], 1], 'x'])
        .evaluate()
        .toString()
    ).toBe('(x - 1) * (x + 1)');
  });

  test('a bound polynomial keeps a valued variable symbolic', () => {
    const ce = new ComputeEngine();
    ce.assign('p', ce.parse('x^2 - 1'));
    ce.assign('x', 3);
    expect(ce.box(['PolynomialDegree', 'p', 'x']).evaluate().json).toBe(2);
    // Without a variable, the default one is read from the unresolved
    // operand when resolving would fold every symbol away.
    expect(ce.box(['PolynomialDegree', 'p']).evaluate().json).toBe(2);
  });

  test('Solve reduces a polynomial quotient before solving', () => {
    const ce = engine();
    const roots = ce
      .box([
        'Solve',
        ['Equal', ['PolynomialQuotient', 'r', ['Subtract', 'x', 2], 'x'], 0],
        'x',
      ])
      .evaluate();
    // r = x^2 - 5x + 6 = (x - 2)(x - 3), so the quotient by x - 2 is x - 3.
    expect([...roots.each()].map((e) => e.re)).toEqual([3]);
  });
});
