/**
 * A compiled closed-form integral reads a parameter named `e`, `i` or `Pi`
 * as that parameter, not as the constant of the same name (ROADMAP CE-623).
 *
 * To compile an `Integrate`, the compiler first searches for a closed form
 * with `evaluate()` (`BaseCompiler.closedFormIntegral`). It boxes the
 * operands again from their MathJSON in a scope of its own, and the boxing
 * resolves each symbol by name. A parameter of the function body being
 * compiled is not visible in that scope, so a parameter `e` became Euler's
 * number: with `q(y, e) := ∫₀¹ e·x dx`, the compiled `q(y, 2)` gave e/2
 * (1.35914) where the interpreter gives 1.
 *
 * The same round trip in the compilation of a call that maps a function over
 * a list of points made a local named `e`, `i` or `Pi` read as the constant,
 * and the compilation declined.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function compiledValue(
  ce: ComputeEngine,
  expr: ReturnType<ComputeEngine['parse']>,
  vars: Record<string, unknown> = {}
) {
  const r = compile(expr);
  expect(r.success).toBe(true);
  return r.run!(vars as never);
}

describe('CE-623: a compiled closed-form integral keeps a parameter named like a constant', () => {
  test('a parameter named e', () => {
    const ce = new ComputeEngine();
    ce.parse(String.raw`q(y, e) := \int_0^1 e x\,dx`).evaluate();
    const call = ce.parse('q(y, 2)');
    expect(call.N().re).toBeCloseTo(1, 12);
    expect(compiledValue(ce, call, { y: 1 })).toBeCloseTo(1, 12);
  });

  test('a parameter named i', () => {
    const ce = new ComputeEngine();
    ce.parse(String.raw`r(y, i) := \int_0^1 i x\,dx`).evaluate();
    const call = ce.parse('r(y, 2)');
    expect(call.N().re).toBeCloseTo(1, 12);
    expect(compiledValue(ce, call, { y: 1 })).toBeCloseTo(1, 12);
  });

  test('a parameter named pi', () => {
    const ce = new ComputeEngine();
    ce.parse(String.raw`p(y, \pi) := \int_0^1 \pi x\,dx`).evaluate();
    const call = ce.parse('p(y, 2)');
    expect(call.N().re).toBeCloseTo(1, 12);
    expect(compiledValue(ce, call, { y: 1 })).toBeCloseTo(1, 12);
  });

  test('a parameter that hides a global with a value', () => {
    const ce = new ComputeEngine();
    ce.parse('a := 5').evaluate();
    ce.parse(String.raw`g(a) := \int_0^1 a x\,dx`).evaluate();
    const call = ce.parse('g(2)');
    expect(call.N().re).toBeCloseTo(1, 12);
    expect(compiledValue(ce, call)).toBeCloseTo(1, 12);
  });

  test('a parameter e in the integrand and in the limits', () => {
    // ∫_{-D}^{D} e/(x² + y² + e²) dx = (2e/a)·atan(D/a), a = √(y² + e²).
    const ce = new ComputeEngine();
    ce.parse(
      String.raw`c(y, D, e) := \int_{-D}^{D} \frac{e}{x^2+y^2+e^2}\,dx`
    ).evaluate();
    const [y, D, e] = [1, 2, 0.001];
    const a = Math.sqrt(y * y + e * e);
    const expected = ((2 * e) / a) * Math.atan(D / a);
    const call = ce.parse(`c(${y}, ${D}, ${e})`);
    expect(call.N().re).toBeCloseTo(expected, 12);
    expect(compiledValue(ce, call)).toBeCloseTo(expected, 12);
  });

  test("control: a free e is Euler's number on both routes", () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(String.raw`\int_0^1 e x\,dx`);
    expect(expr.N().re).toBeCloseTo(Math.E / 2, 12);
    expect(compiledValue(ce, expr)).toBeCloseTo(Math.E / 2, 12);
  });
});

describe('CE-623: a call mapped over a list of points keeps a local named like a constant', () => {
  // `k` has a scalar parameter, and `Apply` an untyped one: both map over the
  // points of the local list.
  for (const name of ['e', 'i', 'Pi', 'L']) {
    for (const [label, call] of [
      ['k', ['k', name]],
      ['Apply', ['Apply', ['Function', ['Multiply', 2, 'u'], 'u'], name]],
    ] as const) {
      test(`${label} over a local named ${name}`, () => {
        const ce = new ComputeEngine();
        ce.assign(
          'k',
          ce.box(['Function', ['Multiply', 2, 'u'], ['Typed', 'u', "'real'"]])
        );
        const block = ce.box([
          'Block',
          ['Declare', name, "'list<tuple<real, real>>'"],
          ['Assign', name, ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
          call as never,
        ]);
        expect(block.evaluate().toString()).toBe('[(2, 4),(6, 8)]');
        expect(compiledValue(ce, block)).toEqual([
          [2, 4],
          [6, 8],
        ]);
      });
    }
  }
});
