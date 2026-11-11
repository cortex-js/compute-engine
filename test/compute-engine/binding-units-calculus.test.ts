import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isFreeName } from '../../src/compute-engine/boxed-expression/type-guards';

// Limits and definite integrals with a free parameter, with the engine flag
// `_bindingUnits` on (`docs/plans/2026-11-09-binding-units-slice-1-spec.md`,
// rules 1 and 7).

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce._bindingUnits = true;
  return ce;
}

/** Composite Simpson rule on `[a, b]` with `n` (even) panels. */
function simpson(
  f: (x: number) => number,
  a: number,
  b: number,
  n = 2000
): number {
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i++) sum += (i % 2 === 1 ? 4 : 2) * f(a + i * h);
  return (sum * h) / 3;
}

const at = (e: Expression, a: number): number =>
  e.subs({ a: e.engine.number(a) }).N().re;

describe('BINDING UNITS: A FREE NAME IN THE BLOCK OF A BINDER BODY', () => {
  // The body of a `Limit` is boxed as `Function(Block(…), x)`. The `a` of the
  // body is the free name of the scope the limit is written in, the same
  // binding as the point `a`, and not a local of the block.
  test('the body and the point of a limit are the same binding', () => {
    const ce = engine();
    const limit = ce.box([
      'Limit',
      ['Function', ['Divide', 1, ['Subtract', 'x', 'a']], 'x'],
      'a',
      1,
    ]);
    const point = limit.ops![1];
    const block = limit.ops![0].ops![0];
    expect(block.operator).toBe('Block');
    const divisor = block.ops![0].ops![1];
    const inBody = divisor.ops!.find((op) => op.has('a'))!;
    const a = inBody.operator === 'Negate' ? inBody.ops![0] : inBody;
    expect(isFreeName(point)).toBe(true);
    expect(isFreeName(a)).toBe(true);
    expect(a.isSame(point)).toBe(true);
    expect(ce.lookupDefinition('a')).toBeUndefined();
  });

  test('a limit at a free point', () => {
    const ce = engine();
    const value = (latex: string) => ce.parse(latex).evaluate().toString();
    expect(value('\\lim_{x\\to a^+}\\frac{1}{x-a}')).toBe('+oo');
    expect(value('\\lim_{x\\to a^-}\\frac{1}{x-a}')).toBe('-oo');
    expect(value('\\lim_{x\\to a^-}\\frac{x^2-a^2}{x-a}')).toBe('2a');
    // The sign of the numerator depends on `a`: no limit.
    expect(
      ce.parse('\\lim_{x\\to a^+}\\frac{x}{x-a}').evaluate().operator
    ).toBe('Limit');
  });
});

describe('BINDING UNITS: A FREE NAME IS REAL IN THE POLE PROOFS', () => {
  test('a² + 1 is positive: the closed form', () => {
    const cases: [string, (a: number) => (t: number) => number, number][] = [
      ['\\int_0^1 \\frac{1}{t+a^2+1}\\,dt', (a) => (t) => 1 / (t + a * a + 1), 0],
      [
        '\\int_0^1 \\frac{1}{t^2+a^2+1}\\,dt',
        (a) => (t) => 1 / (t * t + a * a + 1),
        0,
      ],
      [
        '\\int_0^1 \\frac{e^t}{e^t+a^2+1}\\,dt',
        (a) => (t) => Math.exp(t) / (Math.exp(t) + a * a + 1),
        0,
      ],
    ];
    for (const [latex, f, lo] of cases) {
      const ce = engine();
      const value = ce.parse(latex).evaluate();
      expect(value.has('Integrate')).toBe(false);
      expect(at(value, 1.5)).toBeCloseTo(simpson(f(1.5), lo, lo + 1), 10);
    }
  });

  test('the MathJSON route', () => {
    const ce = engine();
    const value = ce
      .box([
        'Integrate',
        ['Divide', 1, ['Add', 't', ['Power', 'a', 2], 1]],
        ['Limits', 't', 0, 1],
      ])
      .evaluate();
    expect(value.has('Integrate')).toBe(false);
    expect(at(value, 1.5)).toBeCloseTo(
      simpson((t) => 1 / (t + 3.25), 0, 1),
      10
    );
  });
});
