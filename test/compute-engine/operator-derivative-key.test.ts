/**
 * The `derivative` key of an operator definition (GitHub issue #393, item 4).
 *
 * An operator whose `evaluate` handler answers only for numbers has no
 * formula that `D` can differentiate. Without the key, `D(Sq(x), x)` stays
 * `Apply(Derivative(Sq, 1), x)`. With the key, the definition gives its
 * partial derivatives and `D` applies the chain rule.
 *
 * Each derivative is checked against a central difference of the operator's
 * own numeric evaluation, not only against an expected string.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type {
  Expression,
  LibraryDefinition,
} from '../../src/compute-engine/global-types';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** `Sq(x) = x²`, with an `evaluate` handler that answers only for numbers. */
function declareSq(ce: ComputeEngine, withKey = true): void {
  ce.declare('Sq', {
    signature: '(number) -> number',
    evaluate: ([x]) => (isNumber(x) ? x.mul(x) : undefined),
    ...(withKey
      ? { derivative: [['Function', ['Multiply', 2, 'x'], 'x']] }
      : {}),
  });
}

/** `F(x, y) = x²·y`, numbers only, with its two partial derivatives. */
function declareF(ce: ComputeEngine): void {
  ce.declare('F', {
    signature: '(number, number) -> number',
    evaluate: ([x, y]) =>
      isNumber(x) && isNumber(y) ? x.mul(x).mul(y) : undefined,
    derivative: [
      ['Function', ['Multiply', 2, 'x', 'y'], 'x', 'y'],
      ['Function', ['Power', 'x', 2], 'x', 'y'],
    ],
  });
}

function value(ce: ComputeEngine, expr: Expression, v: string, at: number) {
  return expr.subs({ [v]: ce.number(at) }).N().re;
}

/** The central difference of `body` (a function of `v`) at `at`. */
function centralDifference(
  ce: ComputeEngine,
  body: Expression,
  v: string,
  at: number
): number {
  const h = 1e-5;
  return (value(ce, body, v, at + h) - value(ce, body, v, at - h)) / (2 * h);
}

function expectDerivativeMatchesNumerically(
  ce: ComputeEngine,
  body: Expression,
  v: string,
  points: number[]
): Expression {
  const d = ce.box(['D', body, v]).evaluate();
  expect(d.has('Derivative')).toBe(false);
  expect(d.has('D')).toBe(false);
  for (const at of points) {
    const exact = value(ce, d, v, at);
    const numeric = centralDifference(ce, body, v, at);
    expect(Math.abs(exact - numeric)).toBeLessThan(
      1e-5 * (1 + Math.abs(exact))
    );
  }
  return d;
}

describe('derivative key: array of function literals', () => {
  test('without the key the derivative stays symbolic', () => {
    const ce = new ComputeEngine();
    declareSq(ce, false);
    expect(
      ce
        .box(['D', ['Sq', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('Apply(Derivative("Sq", 1), x)');
  });

  test('D(Sq(x), x) is 2x', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    const d = expectDerivativeMatchesNumerically(
      ce,
      ce.box(['Sq', 'x']),
      'x',
      [-1.5, 0.3, 2]
    );
    expect(d.toString()).toBe('2x');
  });

  test('D(Sq(x^2), x) is 4x^3 (chain rule)', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    const d = expectDerivativeMatchesNumerically(
      ce,
      ce.box(['Sq', ['Power', 'x', 2]]),
      'x',
      [-1.2, 0.7, 1.9]
    );
    expect(d.toString()).toBe('4x^3');
  });

  test('chain rule through a library function', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    expectDerivativeMatchesNumerically(
      ce,
      ce.box(['Sq', ['Sin', 'x']]),
      'x',
      [-1, 0.4, 2.5]
    );
    expectDerivativeMatchesNumerically(
      ce,
      ce.box(['Sin', ['Sq', 'x']]),
      'x',
      [-1, 0.4, 1.5]
    );
  });

  test('second derivative', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    const d2 = ce
      .box(['D', ['D', ['Sq', ['Power', 'x', 2]], 'x'], 'x'])
      .evaluate();
    expect(d2.toString()).toBe('12x^2');
  });

  test('the application itself is not unfolded', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    expect(ce.box(['Sq', 'y']).evaluate().toString()).toBe('Sq(y)');
    expect(ce.box(['Sq', 3]).evaluate().toString()).toBe('9');
  });

  test('a constant argument has a zero derivative', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    expect(
      ce
        .box(['D', ['Sq', 'y'], 'x'])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('Derivative and the prime notation use the key', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    expect(ce.box(['Derivative', 'Sq']).evaluate().toString()).toBe(
      '(x) => 2x'
    );
    expect(
      ce
        .box(['Apply', ['Derivative', 'Sq', 1], 'x'])
        .evaluate()
        .toString()
    ).toBe('2x');
    expect(
      ce
        .box(['Apply', ['Derivative', 'Sq', 2], 'x'])
        .evaluate()
        .toString()
    ).toBe('2');
    expect(ce.parse("\\operatorname{Sq}'(3)").evaluate().toString()).toBe('6');
  });

  test('multi-argument: D(F(t, t^2), t) by the chain rule', () => {
    const ce = new ComputeEngine();
    declareF(ce);
    // F(t, t²) = t⁴
    const d = expectDerivativeMatchesNumerically(
      ce,
      ce.box(['F', 't', ['Power', 't', 2]]),
      't',
      [-1.3, 0.5, 2.2]
    );
    expect(d.toString()).toBe('4t^3');
    expectDerivativeMatchesNumerically(
      ce,
      ce.box(['F', ['Sin', 't'], ['Exp', 't']]),
      't',
      [-0.8, 0.5, 1.7]
    );
  });

  test('multi-argument: only the arguments that depend on the variable', () => {
    const ce = new ComputeEngine();
    declareF(ce);
    expect(
      ce
        .box(['D', ['F', 'a', 't'], 't'])
        .evaluate()
        .toString()
    ).toBe('a^2');
  });

  test('multi-index Derivative uses the key', () => {
    const ce = new ComputeEngine();
    declareF(ce);
    // ∂F/∂x = 2xy at (2, 3) is 12; ∂²F/∂x∂y = 2x at (2, 3) is 4
    expect(
      ce
        .box(['Apply', ['Derivative', 'F', 1, 0], 2, 3])
        .evaluate()
        .toString()
    ).toBe('12');
    expect(
      ce
        .box(['Apply', ['Derivative', 'F', 1, 1], 2, 3])
        .evaluate()
        .toString()
    ).toBe('4');
    expect(
      ce
        .box(['Apply', ['Derivative', 'F', 0, 1], 2, 3])
        .evaluate()
        .toString()
    ).toBe('4');
  });

  test('an array with the wrong number of entries is not used', () => {
    const ce = new ComputeEngine();
    ce.declare('W', {
      signature: '(number, number) -> number',
      derivative: [['Function', 1, 'x']],
    });
    expect(
      ce
        .box(['D', ['W', 't', 't'], 't'])
        .evaluate()
        .has('Derivative')
    ).toBe(true);
  });
});

describe('derivative key: handler', () => {
  test('a handler gives each partial derivative at the arguments', () => {
    const ce = new ComputeEngine();
    const requested: number[] = [];
    // G(u₁, …, uₙ) = Σ (i/2)·uᵢ², so ∂ᵢG = i·uᵢ (1-based i)
    ce.declare('G', {
      signature: '(number+) -> number',
      derivative: (ops, { engine, argument }) => {
        requested.push(argument);
        return engine.function('Multiply', [
          engine.number(argument + 1),
          ops[argument],
        ]);
      },
    });
    const d = ce.box(['D', ['G', 'x', ['Power', 'x', 3], 'a'], 'x']).evaluate();
    // x·1 + 2x³·3x²
    expect(d.toString()).toBe('6x^5 + x');
    // No partial is requested for `a`, which does not depend on `x`
    expect(requested).toEqual([0, 1]);
  });

  test('a handler that declines leaves that partial symbolic', () => {
    const ce = new ComputeEngine();
    ce.declare('H', {
      signature: '(number) -> number',
      derivative: () => undefined,
    });
    expect(
      ce
        .box(['D', ['H', ['Power', 'x', 2]], 'x'])
        .evaluate()
        .toString()
    ).toBe('2x * Apply(Derivative(H, 1), x^2)');
  });
});

describe('derivative key: precedence', () => {
  test('the key has precedence over a function-literal evaluate', () => {
    const ce = new ComputeEngine();
    // The key is deliberately different from the derivative of the body, to
    // show which one is used.
    ce.declare('K', {
      signature: '(number) -> number',
      evaluate: ce.expr(['Function', ['Power', 'x', 3], 'x']),
      derivative: [['Function', 42, 'x']],
    });
    expect(
      ce
        .box(['D', ['K', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('42');
    expect(ce.box(['K', 'y']).evaluate().toString()).toBe('y^3');
  });

  test('Derivative and the prime notation use the key, not the literal', () => {
    const ce = new ComputeEngine();
    // The body x³ has the derivative 3x²; the key says 7x, deliberately
    // different, to show which one is used.
    ce.declare('K', {
      signature: '(number) -> number',
      evaluate: ce.expr(['Function', ['Power', 'x', 3], 'x']),
      derivative: [['Function', ['Multiply', 7, 'x'], 'x']],
    });
    expect(ce.box(['D', ['K', 'x'], 'x']).evaluate().toString()).toBe('7x');
    expect(ce.box(['Derivative', 'K']).evaluate().toString()).toBe(
      '(x) => 7x'
    );
    expect(
      ce.box(['Apply', ['Derivative', 'K'], 2]).evaluate().N().re
    ).toBe(14);
    expect(ce.parse("K'(2)").evaluate().N().re).toBe(14);
    // Second derivative: the derivative of 7x
    expect(
      ce.box(['Apply', ['Derivative', 'K', 2], 2]).evaluate().N().re
    ).toBe(7);
    // The function itself still evaluates through its literal
    expect(ce.box(['K', 2]).evaluate().N().re).toBe(8);
  });

  test('multi-index Derivative uses the key, not the literal', () => {
    const ce = new ComputeEngine();
    // The body x·y has the partials y and x; the key says 7 and 8.
    ce.declare('L', {
      signature: '(number, number) -> number',
      evaluate: ce.expr(['Function', ['Multiply', 'x', 'y'], 'x', 'y']),
      derivative: [
        ['Function', 7, 'x', 'y'],
        ['Function', 8, 'x', 'y'],
      ],
    });
    expect(
      ce.box(['Apply', ['Derivative', 'L', 1, 0], 2, 3]).evaluate().N().re
    ).toBe(7);
    expect(
      ce.box(['Apply', ['Derivative', 'L', 0, 1], 2, 3]).evaluate().N().re
    ).toBe(8);
    expect(ce.box(['D', ['L', 't', 't'], 't']).evaluate().toString()).toBe(
      '15'
    );
  });

  test('an argument symbol is not captured by a binder of the literal', () => {
    const ce = new ComputeEngine();
    // ∂H(x) = Σ_{k=1}^{3} k^x. With the argument 2k, the index of the sum
    // must not capture the `k` of the argument:
    // d/dk H(2k) = 2·Σ_{j=1}^{3} j^{2k}.
    ce.declare('H', {
      signature: '(number) -> number',
      derivative: [
        ['Function', ['Sum', ['Power', 'k', 'x'], ['Limits', 'k', 1, 3]], 'x'],
      ],
    });
    const d = ce.box(['D', ['H', ['Multiply', 2, 'k']], 'k']).evaluate();
    const expected = (k: number) =>
      2 * (1 + Math.pow(2, 2 * k) + Math.pow(3, 2 * k));
    for (const k of [0.5, 1, 1.5]) {
      const actual = d.subs({ k: ce.number(k) }).N().re;
      expect(Math.abs(actual - expected(k))).toBeLessThan(
        1e-9 * expected(k)
      );
    }
  });

  test('a malformed derivative key is refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('M1', {
        signature: '(number) -> number',
        derivative: ['Function', ['Multiply', 2, 'x'], 'x'],
      } as never)
    ).toThrow(
      'Operator Definition "M1": the "derivative" key is a single function literal: wrap it in an array: one literal per argument'
    );
    expect(() =>
      ce.declare('M2', {
        signature: '(number, number) -> number',
        derivative: [['Function', 1, 'x', 'y'], 2],
      } as never)
    ).toThrow(
      'Operator Definition "M2": entry 1 of the "derivative" key is not a function literal'
    );
    expect(() =>
      ce.declare('M3', {
        signature: '(number) -> number',
        derivative: 'x',
      } as never)
    ).toThrow(
      'Operator Definition "M3": the "derivative" key must be a function, or an array with one function literal per argument'
    );
    expect(() =>
      ce.declare('M4', {
        signature: '(number) -> number',
        derivative: ce.expr(['Function', 1, 'x']),
      } as never)
    ).toThrow('wrap it in an array');
    // A boxed function literal is a valid entry
    ce.declare('M5', {
      signature: '(number) -> number',
      derivative: [ce.expr(['Function', ['Multiply', 3, 'x'], 'x'])],
    });
    expect(ce.box(['D', ['M5', 'x'], 'x']).evaluate().toString()).toBe('3x');
  });

  test('a library operator keeps its own derivative rule', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    expect(
      ce
        .box(['D', ['Sin', 't'], 't'])
        .evaluate()
        .toString()
    ).toBe('cos(t)');
  });

  test('a caller library can carry the key', () => {
    const lib: LibraryDefinition = {
      name: 'squares',
      definitions: {
        Sq: {
          signature: '(number) -> number',
          evaluate: ([x]) => (isNumber(x) ? x.mul(x) : undefined),
          derivative: [['Function', ['Multiply', 2, 'x'], 'x']],
        },
      },
    };
    const ce = new ComputeEngine({
      libraries: [...ComputeEngine.getStandardLibrary(), lib],
    });
    expect(
      ce
        .box(['D', ['Sq', ['Power', 'x', 2]], 'x'])
        .evaluate()
        .toString()
    ).toBe('4x^3');
  });

  test('an unexpected key is still refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('Bad', {
        signature: '(number) -> number',
        derivatives: [],
      } as never)
    ).toThrow(/unexpected key "derivatives"/);
  });
});

describe('derivative key: other consumers', () => {
  test('compile of D uses the key', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    const r = compile(
      ce.parse('\\frac{d}{dx} \\operatorname{Sq}(x^2)') as never
    );
    expect(r.success).toBe(true);
    expect(r.run!({ x: 2 })).toBeCloseTo(32, 10);
  });

  test('ND is unaffected', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    expect(ce.box(['ND', 'Sq', 3]).N().re).toBeCloseTo(6, 8);
  });

  test('explain(D) records the chain rule', () => {
    const ce = new ComputeEngine();
    declareSq(ce);
    const ex = ce.box(['Sq', ['Power', 'x', 2]]).explain('D');
    expect(ex.result.toString()).toBe('4x^3');
    expect(ex.steps.some((s) => s.id === 'derivative.chain-rule')).toBe(true);
  });
});
