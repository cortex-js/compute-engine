/**
 * Compiling a higher-order derivative of a user function.
 *
 * `Apply(Derivative(f, n), x)` — the parse of `f''(x)` — used to be lowered
 * by differentiating `f`'s body n times at compile time and compiling the
 * closed form. That form multiplies out: for the four-deep nested radical
 * below, the third derivative was 392 KB of emitted code and took tens of
 * seconds to build, and the compilation ran the differentiation TWICE (once
 * when the reference analysis probed whether the `Derivative` head lowers,
 * once when the code was emitted). The interval target also paid that cost
 * for expensive derivative applications it could not compile.
 *
 * Three changes are pinned here:
 *
 * - the javascript target lowers the application through forward-mode
 *   automatic differentiation (`compilation/jet-derivative.ts`), for an order
 *   above 1 and a body big enough that the closed form would not stay small;
 * - a target whose `Apply` accepts only a function-literal callee stops the
 *   reference analysis at the application instead of walking into the callee;
 * - the symbolic closed form is memoised per (function literal, order), so
 *   the routes that still use it differentiate once.
 *
 * The jet route is a NUMERIC lowering, so the values it produces are checked
 * against the interpreter's own `.N()` rather than assumed.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileJetDerivative } from '../../src/compute-engine/compilation/jet-derivative';
import { derivative } from '../../src/compute-engine/symbolic/derivative';

const RADICAL = 'f(x):=\\sqrt{x+\\sqrt{x+\\sqrt{x+\\sqrt{x+x}}}}';

/** An engine with `x: real` and `f` defined by `body`. */
function engineWith(definition: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.parse(definition).evaluate();
  return ce;
}

/**
 * One engine for every test on the four-deep radical. The reference values
 * come from the interpreter's symbolic route, which costs seconds per order
 * on this body; a fresh engine per test would pay that again each time, and
 * the memo under test is exactly what makes the repeats free.
 */
const radical = engineWith(RADICAL);
radical.declare('e', 'real');

function compiled(ce: ComputeEngine, order: number, to = 'javascript') {
  return compile(ce.box(['Apply', ['Derivative', 'f', order], 'x']), {
    to,
    fallback: true,
  } as never) as {
    success: boolean;
    code?: string;
    unsupported?: string[];
    freeSymbols?: string[];
    run: (vars: Record<string, number>) => number | { re: number; im: number };
  };
}

/** The interpreter's value of the n-th derivative of `f` at `x`. */
function interpreted(
  ce: ComputeEngine,
  order: number,
  x: number
): { re: number; im: number } {
  const v = ce.box(['Apply', ['Derivative', 'f', order], x]).N();
  return { re: v.re, im: v.im };
}

function asComplex(v: number | { re: number; im: number }): {
  re: number;
  im: number;
} {
  return typeof v === 'number' ? { re: v, im: 0 } : v;
}

/** Relative distance between two complex values. */
function relative(
  a: { re: number; im: number },
  b: { re: number; im: number }
): number {
  return (
    Math.hypot(a.re - b.re, a.im - b.im) /
    Math.max(1e-12, Math.hypot(b.re, b.im))
  );
}

describe('applied derivative: the forward-mode lowering', () => {
  test('an order above 1 of a composed body emits the jet lowering', () => {
    const ce = radical;
    for (const order of [2, 3, 4]) {
      const r = compiled(ce, order);
      expect(r.success).toBe(true);
      expect(r.code).toContain('_SYS.jcread');
      // The whole point: the emitted code is a walk of the BODY and does not
      // grow with the order.
      expect(r.code!.length).toBeLessThan(400);
    }
    expect(compiled(ce, 2).code).toMatchInlineSnapshot(
      `"((_tv1) => _SYS.jcread(_SYS.jcsqrt(_SYS.jcadd(_tv1, _SYS.jcsqrt(_SYS.jcadd(_tv1, _SYS.jcsqrt(_SYS.jcadd(_tv1, _SYS.jcsqrt(_SYS.jcadd(_tv1, _tv1)))))))), 2))(_SYS.jcv(_.x, 2))"`
    );
  });

  test('the compiled value matches the interpreter on the real domain', () => {
    const ce = radical;
    for (const order of [2, 3]) {
      const r = compiled(ce, order);
      for (const x of [0.5, 1, 2]) {
        expect(
          relative(asComplex(r.run({ x })), interpreted(ce, order, x))
        ).toBeLessThan(1e-9);
      }
    }
  });

  test('the compiled value matches the interpreter off the real domain', () => {
    // `√u` of an unknown-sign real promotes to the complex kernel, so the
    // jets have to run in complex arithmetic — a real jet would answer NaN
    // here while the rest of the compilation answers a complex value.
    const ce = radical;
    for (const order of [2, 3]) {
      const r = compiled(ce, order);
      for (const x of [-1, -0.2]) {
        const v = asComplex(r.run({ x }));
        expect(v.im).not.toBe(0);
        expect(relative(v, interpreted(ce, order, x))).toBeLessThan(1e-9);
      }
    }
  });

  test('a jet result composes with its enclosing expression', () => {
    // The enclosing code has to know the application is complex-shaped. It
    // reads that from `f`'s body: reading the node's declared type (`number`)
    // put a real-lane multiplication around the `{re, im}` object both
    // lowerings return, and the product came back NaN at every point.
    const ce = radical;
    const expr = ce.parse("(x-e)f''(e)");
    const r = compile(expr, { to: 'javascript', fallback: false } as never) as {
      run: (v: Record<string, number>) => number | { re: number; im: number };
    };
    const want = expr.subs({ x: ce.number(2), e: ce.number(1.5) }).N();
    expect(
      relative(asComplex(r.run({ x: 2, e: 1.5 })), { re: want.re, im: want.im })
    ).toBeLessThan(1e-9);
  });

  test('a Taylor row of four references compiles and agrees with the interpreter', () => {
    const ce = radical;
    const expr = ce.parse(
      "f(e)+(x-e)f'(e)+\\frac{(x-e)^2}{2}f''(e)+\\frac{(x-e)^3}{6}f'''(e)"
    );
    const r = compile(expr, { to: 'javascript', fallback: false } as never) as {
      success: boolean;
      run: (v: Record<string, number>) => number | { re: number; im: number };
    };
    expect(r.success).toBe(true);
    for (const [x, e] of [
      [1, 1],
      [2, 1.5],
      [0.7, 0.5],
    ]) {
      const want = expr.subs({ x: ce.number(x), e: ce.number(e) }).N();
      expect(
        relative(asComplex(r.run({ x, e })), { re: want.re, im: want.im })
      ).toBeLessThan(1e-9);
    }
  });

  test('a provably-real body uses the real jet family', () => {
    const ce = engineWith('f(x):=\\sin(x^2+x)\\cos(x)+x^3-\\frac{x}{x^2+1}');
    const r = compiled(ce, 3);
    expect(r.code).toContain('_SYS.jread');
    expect(r.code).not.toContain('_SYS.jcread');
    for (const x of [0.37, 1.3, 2.9])
      expect(
        relative(asComplex(r.run({ x })), interpreted(ce, 3, x))
      ).toBeLessThan(1e-9);
  });

  test('the exponential, logarithm and tangent recurrences agree with the interpreter', () => {
    const ce = engineWith('f(x):=e^{x^2+x}+\\ln(x^2+3)+\\tan(x/4)');
    const r = compiled(ce, 3);
    // Every operand here is provably real — the logarithm's argument is
    // `x² + 3` — so this body takes the real jet family.
    expect(r.code).toContain('_SYS.jexp');
    expect(r.code).toContain('_SYS.jln');
    expect(r.code).toContain('_SYS.jtan');
    for (const x of [0.37, 1.3, 2.9])
      expect(
        relative(asComplex(r.run({ x })), interpreted(ce, 3, x))
      ).toBeLessThan(1e-9);
  });

  test('an odd radical takes the real root, as the interpreter does', () => {
    // A cube root of a negative value is a real number — the interpreter says
    // so, and the ordinary emitter lowers `Root(u, 3)` to `Math.cbrt`. The
    // general `a^r` recurrence starts from `Math.pow(a₀, 1/3)`, which is NaN
    // for a negative `a₀`, and every later coefficient divides by `k·a₀` and
    // stays NaN.
    const ce = engineWith('f(x):=\\sqrt[3]{x+x^2+\\sin x+\\cos x+x^3}');
    for (const order of [2, 3]) {
      const r = compiled(ce, order);
      expect(r.code).toContain('_SYS.jroot');
      for (const x of [-1.2, -0.4, 1.2]) {
        const v = asComplex(r.run({ x }));
        expect(Number.isFinite(v.re)).toBe(true);
        expect(relative(v, interpreted(ce, order, x))).toBeLessThan(1e-9);
      }
    }
  });

  test('the second derivative of an odd radical matches a central difference', () => {
    // An independent check on the jet recurrences. The interpreter's closed
    // form and the jets are both derivative machinery and could in principle
    // share a mistake; a difference quotient of the FUNCTION cannot.
    const ce = engineWith('f(x):=\\sqrt[3]{x+x^2+\\sin x+\\cos x+x^3}');
    const second = compiled(ce, 2);
    const value = compile(ce.parse('f(x)'), {
      to: 'javascript',
      fallback: true,
    } as never) as { run: (v: Record<string, number>) => number };
    const h = 1e-4;
    for (const x of [-1.2, -0.4, 1.2]) {
      const quotient =
        (value.run({ x: x + h }) -
          2 * value.run({ x }) +
          value.run({ x: x - h })) /
        (h * h);
      expect(
        relative(asComplex(second.run({ x })), { re: quotient, im: 0 })
      ).toBeLessThan(1e-5);
    }
  });

  test('an odd radical under a promoting body keeps the real root', () => {
    // The body promotes to the complex kernel (the square root of an
    // unknown-sign value), but the cube root inside it is still the real one
    // the ordinary emitter lowers — so the complex jet family has to take the
    // real branch for a real negative constant coefficient, not the principal
    // branch it uses everywhere else.
    const ce = engineWith('f(x):=\\sqrt{x}+\\sqrt[3]{x}+x^3+\\sin x+\\cos x');
    const r = compiled(ce, 2);
    expect(r.code).toContain('_SYS.jcroot');
    for (const x of [-0.7, 1.3])
      expect(
        relative(asComplex(r.run({ x })), interpreted(ce, 2, x))
      ).toBeLessThan(1e-9);
  });

  test('an integer power of any size stays defined at a zero of the base', () => {
    // Exponents above 8 went through the `a^r` recurrence, which divides by
    // the base's constant coefficient: the second derivative of `x⁹ + …` at 0
    // came back NaN although a polynomial's derivatives are defined
    // everywhere. Repeated jet multiplication has no such division.
    const ce = engineWith('f(x):=x^9+x^4+x^3+x^2+x');
    const r = compiled(ce, 2);
    expect(r.code).toMatch(/_SYS\.jipow\([^,]+, 9\)/);
    expect(r.run({ x: 0 })).toBe(2);
    for (const x of [1.3, -0.7])
      expect(
        relative(asComplex(r.run({ x })), interpreted(ce, 2, x))
      ).toBeLessThan(1e-9);
  });

  test('a negative integer power is the reciprocal of the positive one', () => {
    const ce = engineWith('f(x):=x^{12}+x^{-3}+x^4+x^3+x^2+x');
    const r = compiled(ce, 3);
    expect(r.code).toMatch(/_SYS\.jipow\([^,]+, -3\)/);
    for (const x of [1.3, -0.7])
      expect(
        relative(asComplex(r.run({ x })), interpreted(ce, 3, x))
      ).toBeLessThan(1e-9);
  });

  test('a real body applied at a complex point runs the complex jets', () => {
    // The real family reads each coefficient as a plain number, so a
    // `{re, im}` argument turned the whole jet into NaN before any recurrence
    // ran. The differentiation POINT decides the lane as much as the body
    // does.
    const ce = new ComputeEngine();
    ce.declare('x', 'complex');
    ce.parse('f(x):=\\sin(x^2+x)\\cos(x)+x^3-\\frac{x}{x^2+1}').evaluate();
    const r = compiled(ce, 2);
    expect(r.code).toContain('_SYS.jcv');
    const point = { re: 1.3, im: 0.5 };
    const want = ce
      .box(['Apply', ['Derivative', 'f', 2], ['Complex', point.re, point.im]])
      .N();
    expect(
      relative(asComplex(r.run({ x: point } as never)), {
        re: want.re,
        im: want.im,
      })
    ).toBeLessThan(1e-9);
  });

  test('a fractional power and a quotient agree with the interpreter', () => {
    const ce = engineWith('f(x):=(x^2+x+1)^{2.5}+\\frac{x^3+2x^2+x+1}{x^2+2}');
    const r = compiled(ce, 3);
    for (const x of [0.37, 1.3, 2.9])
      expect(
        relative(asComplex(r.run({ x })), interpreted(ce, 3, x))
      ).toBeLessThan(1e-9);
  });
});

describe('applied derivative: where the jet lowering declines', () => {
  test('order 1 keeps the symbolic closed form', () => {
    const ce = radical;
    const r = compiled(ce, 1);
    expect(r.code).not.toContain('_SYS.jc');
    for (const x of [0.5, 1, 2])
      expect(
        relative(asComplex(r.run({ x })), interpreted(ce, 1, x))
      ).toBeLessThan(1e-9);
  });

  test('a small body keeps the symbolic closed form', () => {
    // Its closed form is the literal `2`, which is better code than a jet
    // evaluation.
    const ce = engineWith('f(x):=x^2+3x+1');
    const r = compiled(ce, 2);
    expect(r.code).not.toContain('_SYS.j');
    expect(r.run({ x: 4 })).toBe(2);
  });

  test('a head with no coefficient recurrence keeps the symbolic closed form', () => {
    const ce = engineWith('f(x):=\\arctan(x)+x^5+x^4+x^3+x^2+x');
    const r = compiled(ce, 2);
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.jc');
    expect(r.code).not.toContain('_SYS.jread');
    for (const x of [0.37, 1.3])
      expect(
        relative(asComplex(r.run({ x })), interpreted(ce, 2, x))
      ).toBeLessThan(1e-9);
  });

  test('a complex constant exponent keeps the symbolic closed form', () => {
    // The gate tested only that the exponent's REAL PART was finite, so
    // `u^(2+i)` was differentiated as `u²` — the compiled second derivative
    // at 0 was 6 where the interpreter answers 5 + 5i. The jet recurrences
    // take a real exponent only, so a complex one has to decline.
    const ce = engineWith('f(x):=(x^2+x+1)^{2+i}+\\sin(x)');
    const r = compiled(ce, 2);
    expect(r.code).not.toContain('_SYS.jread');
    expect(r.code).not.toContain('_SYS.jcread');
    expect(
      relative(asComplex(r.run({ x: 0 })), interpreted(ce, 2, 0))
    ).toBeLessThan(1e-9);
  });

  test('a complex radical degree keeps the symbolic closed form', () => {
    const ce = engineWith('f(x):=\\sqrt[2+i]{x+x^2+\\sin x+\\cos x+x^3}');
    const r = compiled(ce, 2);
    expect(r.code).not.toContain('_SYS.jread');
    expect(r.code).not.toContain('_SYS.jcread');
    for (const x of [1.3, -0.7])
      expect(
        relative(asComplex(r.run({ x })), interpreted(ce, 2, x))
      ).toBeLessThan(1e-9);
  });

  test('an order whose factorial overflows keeps the symbolic route', () => {
    // Reading the n-th derivative off a jet scales the last coefficient by
    // `n!`, and `n!` is `Infinity` in double precision from 171 upward: an
    // exactly zero coefficient would read as `0 · Infinity`, that is NaN,
    // where the true derivative is zero.
    //
    // The emitter is called directly rather than through `compile`: a decline
    // sends the application to the symbolic route, and differentiating a body
    // 171 times is precisely the work this lowering exists to avoid.
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ce.parse('x^9+x^4+x^3+x^2+\\sin x+x'),
      'x',
    ]);
    const emit = (order: number) =>
      compileJetDerivative(
        literal,
        order,
        ce.symbol('x'),
        () => '_.x',
        () => '_t',
        () => false
      );
    expect(emit(170)).toContain(', 170)');
    expect(emit(171)).toBeUndefined();
  });

  test('a jet result is NaN where the body has a pole, as the closed form is', () => {
    const ce = engineWith('f(x):=\\frac{x^3+2x^2+x+1}{x^2-1}+x^4+x^3');
    const r = compiled(ce, 2);
    const v = asComplex(r.run({ x: 1 }));
    const want = interpreted(ce, 2, 1);
    expect(Number.isFinite(v.re) && Number.isFinite(v.im)).toBe(false);
    expect(Number.isFinite(want.re)).toBe(false);
  });
});

describe('applied derivative: interval compilation keeps expensive derivatives bounded', () => {
  test('the decline names Apply and does not walk into the callee', () => {
    const ce = radical;
    for (const order of [2, 3]) {
      const r = compiled(ce, order, 'interval-js');
      expect(r.success).toBe(false);
      // `Apply` itself is what this target cannot lower. Reporting the heads
      // of the derivative's closed form instead would mean the analysis had
      // computed that closed form — the work the decline exists to avoid.
      expect(r.unsupported).toContain('Apply');
      expect(r.unsupported).not.toContain('Sqrt');
      expect(r.freeSymbols).toContain('x');
    }
  });

  test('a small first derivative compiles and answers', () => {
    const ce = radical;
    const r = compiled(ce, 1, 'interval-js');
    expect(r.success).toBe(true);
    expect(r.run({ x: 1 })).toBeDefined();
  });
});

describe('applied derivative: the memoised closed form', () => {
  test('a redefinition of the function invalidates the cached derivative', () => {
    const ce = new ComputeEngine();
    ce.parse('g(x):=x^3').evaluate();
    expect(ce.box(['Derivative', 'g', 2]).evaluate().toString()).toEqual(
      expect.stringContaining('6x')
    );
    ce.parse('g(x):=x^4').evaluate();
    expect(ce.box(['Derivative', 'g', 2]).evaluate().toString()).toEqual(
      expect.stringContaining('12x^2')
    );
  });

  test('repeated requests give the same derivative', () => {
    const ce = engineWith('f(x):=\\sin(x^2+x)\\cos(x)+x^3');
    const first = ce.box(['Derivative', 'f', 2]).evaluate();
    const second = ce.box(['Derivative', 'f', 2]).evaluate();
    expect(second.isSame(first)).toBe(true);
  });

  test('an order continues the chain left by the order below it', () => {
    // Correctness of the incremental chain: order 3 is one differentiation
    // step past the cached order 2, and must equal order 3 computed on a
    // cold engine.
    const warm = engineWith('f(x):=\\sin(x^2+x)\\cos(x)+x^3');
    warm.box(['Derivative', 'f', 2]).evaluate();
    const fromChain = warm.box(['Derivative', 'f', 3]).evaluate();
    const cold = engineWith('f(x):=\\sin(x^2+x)\\cos(x)+x^3');
    const fromScratch = cold.box(['Derivative', 'f', 3]).evaluate();
    expect(fromChain.toString()).toBe(fromScratch.toString());
  });

  test('a type written onto a free symbol of the body invalidates the cached form', () => {
    // The closing `simplify()` of an order-2 derivative reads declared types:
    // `sin(πb)` is zero for an integer `b`. Writing a type advances the
    // engine's `any` invalidation axis but NOT its semantic one, so an entry
    // guarded on the semantic version alone kept answering `6x·sin(πb)`
    // after the write.
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    ce.parse('f(x):=x^3\\sin(b\\pi)').evaluate();
    expect(ce.box(['Derivative', 'f', 2]).evaluate().toString()).toEqual(
      expect.stringContaining('sin')
    );
    ce.box('b').valueDefinition!.type = ce.type('integer');

    // The same sequence with nothing cached, for the reference answer.
    const cold = new ComputeEngine();
    cold.declare('b', 'real');
    cold.parse('f(x):=x^3\\sin(b\\pi)').evaluate();
    cold.box('b').valueDefinition!.type = cold.type('integer');

    const after = ce.box(['Derivative', 'f', 2]).evaluate().toString();
    expect(after).not.toEqual(expect.stringContaining('sin'));
    expect(after).toBe(cold.box(['Derivative', 'f', 2]).evaluate().toString());
  });

  test('a function symbol and its own literal are separate cache entries', () => {
    // The symbol route differentiates the APPLICATION `f(_)`, the literal
    // route the literal's BODY, and for a parameter spelled `_` both chains
    // are taken with respect to `_`. They start from different expressions,
    // so they must not share one slot of the same literal's cache.
    const ce = new ComputeEngine();
    ce.parse('f(\\_):=\\sin(\\_)^2').evaluate();
    const literal = ce.box('f').operatorDefinition?._lambdaLiteral;
    expect(literal).toBeDefined();

    const viaSymbol = derivative(ce.box('f'), 1)!;
    const viaLiteral = derivative(literal!, 1)!;
    // Each route keeps its own memoised answer...
    expect(derivative(ce.box('f'), 1)).toBe(viaSymbol);
    expect(derivative(literal!, 1)).toBe(viaLiteral);
    expect(viaSymbol).not.toBe(viaLiteral);
    // ...and the two answers agree, as they must: the application and the
    // body denote the same function. (They are compared by their written
    // form: the hole of the application route and the parameter of the
    // literal route are two different `_` symbols, so a syntactic identity
    // check separates them.)
    expect(viaLiteral.toString()).toBe(viaSymbol.toString());
  });
});

describe('applied derivative: the value shape of the emitted code', () => {
  // The enclosing expression has to agree with the lane the applied
  // derivative is emitted in. Reading the node's declared type is not enough
  // (`Derivative` reports `number` for a function with no declared
  // codomain), and neither is reading the BODY: what the emitter produces is
  // either the jet walk of the body or the body's DERIVATIVE, and
  // differentiation changes the lane in both directions.

  test('a derivative that drops the body’s complex part compiles real', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.parse('f(x):=x^2+i').evaluate();
    const expr = ce.parse("x f'(x)");
    const r = compile(expr, { to: 'javascript', fallback: false } as never) as {
      code?: string;
      run: (v: Record<string, number>) => number | { re: number; im: number };
    };
    // The closed form is the real `2x`, so nothing here reads `.re`/`.im`.
    // Answering complex from the body made the enclosing product read those
    // members off a plain number, and every value came back NaN.
    expect(r.code).not.toEqual(expect.stringContaining('.re'));
    const want = expr.subs({ x: ce.number(2) }).N();
    expect(
      relative(asComplex(r.run({ x: 2 })), { re: want.re, im: want.im })
    ).toBeLessThan(1e-12);
  });

  test('an odd-root derivative stays real at negative real inputs', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.parse('f(x):=\\sqrt[3]{x}').evaluate();
    const expr = ce.parse("f''(x)+1");
    const r = compile(expr, { to: 'javascript', fallback: false } as never) as {
      run: (v: Record<string, number>) => number | { re: number; im: number };
    };
    // On the real domain the value agrees with the interpreter.
    const want = expr.subs({ x: ce.number(2) }).N();
    expect(
      relative(asComplex(r.run({ x: 2 })), { re: want.re, im: want.im })
    ).toBeLessThan(1e-9);
    // An odd root and its derivatives remain real at negative real inputs.
    const wantNegative = expr.subs({ x: ce.number(-1.2) }).N();
    const got = r.run({ x: -1.2 });
    expect(typeof got).not.toBe('string');
    expect(
      relative(asComplex(got), { re: wantNegative.re, im: wantNegative.im })
    ).toBeLessThan(1e-12);
  });

  test('a derivative taken at a COMPLEX point composes with its parent', () => {
    // The jet family is picked from the point as well as from the body: the
    // real family reads a coefficient with `asReal`, so a `{re, im}` argument
    // forces the complex one. The enclosing product has to agree, or it puts
    // real arithmetic around the object `_SYS.jcread` returns.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('e', 'complex');
    ce.parse('f(x):=\\sin(x^2+x)\\cos(x)+x^3-\\frac{x}{x^2+1}').evaluate();
    const expr = ce.parse("(x-e)f''(e)");
    const r = compile(expr, { to: 'javascript', fallback: false } as never) as {
      run: (
        v: Record<string, number | { re: number; im: number }>
      ) => number | { re: number; im: number };
    };
    const want = expr
      .subs({ x: ce.number(2), e: ce.box(['Complex', 1.3, 0.5]) })
      .N();
    expect(
      relative(asComplex(r.run({ x: 2, e: { re: 1.3, im: 0.5 } })), {
        re: want.re,
        im: want.im,
      })
    ).toBeLessThan(1e-9);
  });
});

describe('an even-degree root of an unknown-sign operand', () => {
  // `Root(u, k)` with an EVEN degree is `Sqrt`'s case: the real
  // `Math.pow(u, 1/k)` is NaN for a negative `u` where the interpreter
  // answers the principal complex root. An ODD degree keeps the real kernel,
  // because the interpreter answers the REAL root there.

  test('the fourth root agrees with the interpreter on both sides of zero', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.parse('\\sqrt[4]{x}');
    const r = compile(expr, { to: 'javascript', fallback: false } as never) as {
      run: (v: Record<string, number>) => number | { re: number; im: number };
    };
    for (const x of [-8, 16]) {
      const want = expr.subs({ x: ce.number(x) }).N();
      expect(
        relative(asComplex(r.run({ x })), { re: want.re, im: want.im })
      ).toBeLessThan(1e-12);
    }
  });

  test('the cube root keeps the real kernel', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.parse('\\sqrt[3]{x}');
    const r = compile(expr, { to: 'javascript', fallback: false } as never) as {
      code?: string;
      run: (v: Record<string, number>) => number | { re: number; im: number };
    };
    expect(r.code).not.toEqual(expect.stringContaining('cpow'));
    // `Root(−8, 3)` is `−2` in the interpreter, not the principal complex
    // root, and the emitted code must answer the same.
    expect(r.run({ x: -8 })).toBe(-2);
  });

  test('a derivative of an even-degree radical body takes the complex jets', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.parse('f(x):=\\sqrt[4]{x+x^2+\\sin x+\\cos x+x^3}').evaluate();
    const expr = ce.box(['Apply', ['Derivative', 'f', 2], 'x']);
    const r = compile(expr, { to: 'javascript', fallback: false } as never) as {
      run: (v: Record<string, number>) => number | { re: number; im: number };
    };
    for (const x of [-0.7, 1.4]) {
      const want = ce.box(['Apply', ['Derivative', 'f', 2], x]).N();
      expect(
        relative(asComplex(r.run({ x })), { re: want.re, im: want.im })
      ).toBeLessThan(1e-9);
    }
  });
});

// Timing is load-dependent — the box these run on is shared — so the
// wall-clock assertions are excluded from the default suite and run through
// `npm run test:perf`, serially. The same env gate as
// `compile-performance.test.ts`.
const PERF = process.env.CE_PERF === '1';

(PERF ? describe : describe.skip)('applied derivative: compile cost', () => {
  // A FRESH engine each time: the cost being measured is a cold compile,
  // and the shared engine above has a warm derivative cache.
  test("f'''(x) of the four-deep radical compiles in under a second", () => {
    const ce = engineWith(RADICAL);
    const t0 = performance.now();
    compiled(ce, 3);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test("the interval-js decline for f'''(x) returns in under 50 ms", () => {
    const ce = engineWith(RADICAL);
    const t0 = performance.now();
    compiled(ce, 3, 'interval-js');
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('a large body takes the jet lowering at order one as well', () => {
  // The first derivative of a twenty-deep nested radical has a 376 KB
  // closed form (1.9 s to compile) where the jet is a few hundred bytes; a
  // body past `JET_MIN_BODY_NODES_ORDER_ONE` nodes takes the jet at order 1.
  // The four-deep radical (14 nodes) keeps its closed form at order 1.
  test('twenty-deep radical: order one is a jet kernel that matches a central difference', () => {
    let body = 'x';
    for (let i = 0; i < 20; i++) body = `\\sqrt{x+${body}}`;
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.parse(`f(x):=${body}`).evaluate();
    const d1 = compile(ce.parse("f'(x)"), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(d1?.success).toBe(true);
    expect(d1!.code!.length).toBeLessThan(2000);
    expect(d1!.code).toContain('_SYS.j');
    const f = compile(ce.parse('f(x)'), {
      to: 'javascript',
      fallback: false,
    } as any);
    for (const x of [0.5, 1.1, 3]) {
      const h = 1e-5;
      const central = (f!.run!({ x: x + h }) - f!.run!({ x: x - h })) / (2 * h);
      expect(Math.abs(d1!.run!({ x }) - central)).toBeLessThan(1e-7);
    }
  });

  test('four-deep radical: order one keeps the closed form', () => {
    let body = 'x';
    for (let i = 0; i < 4; i++) body = `\\sqrt{x+${body}}`;
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.parse(`f(x):=${body}`).evaluate();
    const d1 = compile(ce.parse("f'(x)"), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(d1?.success).toBe(true);
    expect(d1!.code).not.toContain('_SYS.j');
  });
});
