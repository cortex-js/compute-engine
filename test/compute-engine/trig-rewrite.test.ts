import { engine as ce } from '../utils';
import type { BoxedExpression } from '../../src/compute-engine';

//
// Tests for the trigonometric rewrite verbs: TrigExpand, TrigToExp, TrigReduce.
//

/**
 * Check that `original` and `transformed` are numerically equal at a battery of
 * sample points. `vars` are the free variables to substitute; each is assigned
 * a value from `points`.
 */
function assertNumericallyEqual(
  original: BoxedExpression,
  transformed: BoxedExpression,
  vars: string[],
  { complex = false, tol = 1e-9 }: { complex?: boolean; tol?: number } = {}
) {
  // A handful of deterministic "random-ish" sample points, chosen to avoid
  // poles of tan/sec/csc/cot.
  const reals = [0.3, 0.7, 1.1, -0.5, 2.2, -1.7];
  const points: { re: number; im: number }[] = reals.map((re) => ({
    re,
    im: 0,
  }));
  if (complex)
    points.push(
      { re: 0.4, im: 0.6 },
      { re: -0.8, im: 0.3 },
      { re: 1.2, im: -0.7 }
    );

  for (let i = 0; i < points.length; i++) {
    // Assign each variable a distinct point (rotate through the list).
    const sub: Record<string, BoxedExpression> = {};
    for (let v = 0; v < vars.length; v++) {
      const p = points[(i + v) % points.length];
      sub[vars[v]] =
        p.im === 0 ? ce.number(p.re) : ce.number(ce.complex(p.re, p.im));
    }

    const a = original.subs(sub).N();
    const b = transformed.subs(sub).N();

    const ar = a.re ?? NaN;
    const ai = a.im ?? 0;
    const br = b.re ?? NaN;
    const bi = b.im ?? 0;

    const ok =
      Number.isFinite(ar) &&
      Number.isFinite(br) &&
      Math.abs(ar - br) <= tol &&
      Math.abs(ai - bi) <= tol;

    if (!ok) {
      throw new Error(
        `Mismatch at ${JSON.stringify(sub)}: ` +
          `original=${a.toString()} (${ar}+${ai}i) vs ` +
          `transformed=${b.toString()} (${br}+${bi}i)\n` +
          `  original: ${original.toString()}\n` +
          `  transformed: ${transformed.toString()}`
      );
    }
  }
}

function apply(op: string, latex: string): BoxedExpression {
  return ce.function(op, [ce.parse(latex)]).evaluate();
}

/** Does the JSON of `expr` contain any non-integer (decimal) numeric literal? */
function hasDecimalLiteral(expr: BoxedExpression): boolean {
  const json = JSON.stringify(expr.json);
  // Matches a number token with a fractional or exponent part.
  return /-?\d+\.\d+|-?\d+e[-+]?\d+/i.test(json);
}

//
// The battery of expressions exercised for numeric equivalence.
//
const BATTERY: { latex: string; vars: string[]; complex?: boolean }[] = [
  { latex: '\\sin(x+y)', vars: ['x', 'y'], complex: true },
  { latex: '\\cos(x+y)', vars: ['x', 'y'], complex: true },
  { latex: '\\tan(x+y)', vars: ['x', 'y'] },
  { latex: '\\sin(2x)', vars: ['x'], complex: true },
  { latex: '\\cos(3x)', vars: ['x'], complex: true },
  { latex: '\\sin(x+y+z)', vars: ['x', 'y', 'z'], complex: true },
  { latex: '\\sinh(x+y)', vars: ['x', 'y'], complex: true },
  { latex: '\\cosh(2x)', vars: ['x'], complex: true },
  { latex: '\\tanh(x+y)', vars: ['x', 'y'] },
  { latex: '\\sec(x+y)', vars: ['x', 'y'] },
  { latex: '\\csc(x+y)', vars: ['x', 'y'] },
  { latex: '\\cot(x+y)', vars: ['x', 'y'] },
  { latex: '\\sin(x)^2', vars: ['x'], complex: true },
  { latex: '\\sin(x)^3', vars: ['x'], complex: true },
  { latex: '\\sin(x)\\cos(x)', vars: ['x'], complex: true },
  { latex: '\\sin(x)\\sin(y)', vars: ['x', 'y'], complex: true },
  { latex: '\\sin(2x)\\cos(3x)', vars: ['x'], complex: true },
  { latex: 'x^2 + \\sin(x+y)\\ln(x)', vars: ['x', 'y'] },
];

describe('TrigExpand', () => {
  test('addition formulas', () => {
    expect(apply('TrigExpand', '\\sin(a+b)').toString()).toBe(`sin(b) * cos(a) + sin(a) * cos(b)`);
    expect(apply('TrigExpand', '\\cos(a+b)').toString()).toBe(`cos(a) * cos(b) - sin(a) * sin(b)`);
    expect(apply('TrigExpand', '\\tan(a+b)').toString()).toBe(`(tan(a) + tan(b)) / (1 - tan(a) * tan(b))`);
  });

  test('multiple-angle formulas', () => {
    expect(apply('TrigExpand', '\\sin(2x)').toString()).toBe(`2sin(x) * cos(x)`);
    expect(apply('TrigExpand', '\\cos(3x)').toString()).toBe(`cos(x)^3 - 3cos(x) * sin(x)^2`);
  });

  test('hyperbolic', () => {
    expect(apply('TrigExpand', '\\sinh(x+y)').toString()).toBe(`sinh(y) * cosh(x) + sinh(x) * cosh(y)`);
    expect(apply('TrigExpand', '\\cosh(2x)').toString()).toBe(`sinh(x)^2 + cosh(x)^2`);
  });

  test('numeric equivalence', () => {
    for (const { latex, vars, complex } of BATTERY) {
      const original = ce.parse(latex);
      const transformed = ce.function('TrigExpand', [original]).evaluate();
      assertNumericallyEqual(original, transformed, vars, { complex });
    }
  });

  test('exact coefficients (no floats)', () => {
    expect(hasDecimalLiteral(apply('TrigExpand', '\\sin(x+y)'))).toBe(false);
    expect(hasDecimalLiteral(apply('TrigExpand', '\\cos(3x)'))).toBe(false);
  });

  test('passthrough when nothing to expand', () => {
    const sinx = ce.parse('\\sin(x)');
    expect(
      ce.function('TrigExpand', [sinx]).evaluate().isSame(sinx)
    ).toBe(true);

    const poly = ce.parse('x+1');
    expect(ce.function('TrigExpand', [poly]).evaluate().isSame(poly)).toBe(true);
  });

  test('pill-guard: sum argument is transformed', () => {
    const sinxy = ce.parse('\\sin(x+y)');
    expect(
      ce.function('TrigExpand', [sinxy]).evaluate().isSame(sinxy)
    ).toBe(false);
  });

  test('idempotent', () => {
    for (const latex of ['\\sin(x+y)', '\\tan(x+y)', '\\sin(2x)', '\\sec(x+y)']) {
      const once = apply('TrigExpand', latex);
      const twice = ce.function('TrigExpand', [once]).evaluate();
      expect(once.isSame(twice)).toBe(true);
    }
  });
});

describe('TrigToExp', () => {
  test('circular functions', () => {
    expect(apply('TrigToExp', '\\sin(x)').toString()).toBe(`-1/2i * e^(i * x) + 1/2i * e^(-i * x)`);
    expect(apply('TrigToExp', '\\cos(x)').toString()).toBe(`1/2 * (e^(i * x) + e^(-i * x))`);
  });

  test('hyperbolic functions', () => {
    expect(apply('TrigToExp', '\\sinh(x)').toString()).toBe(`1/2 * (-e^(-x) + e^x)`);
  });

  test('numeric equivalence', () => {
    for (const { latex, vars, complex } of BATTERY) {
      const original = ce.parse(latex);
      const transformed = ce.function('TrigToExp', [original]).evaluate();
      assertNumericallyEqual(original, transformed, vars, { complex });
    }
  });

  test('exact for exact input (no floats)', () => {
    const r = apply('TrigToExp', '\\sin(x)');
    expect(hasDecimalLiteral(r)).toBe(false);

    // sin(1): stays in exponential form, no floating-point literal.
    const s1 = apply('TrigToExp', '\\sin(1)');
    expect(hasDecimalLiteral(s1)).toBe(false);

    // ...and it is numerically equal to sin(1).
    const lhs = ce.function('TrigToExp', [ce.parse('\\sin(1)')]).N();
    const rhs = ce.parse('\\sin(1)').N();
    expect(Math.abs((lhs.re ?? NaN) - (rhs.re ?? NaN))).toBeLessThan(1e-12);
  });

  test('idempotent', () => {
    for (const latex of ['\\sin(x)', '\\cos(x)', '\\tan(x)', '\\sinh(x)']) {
      const once = apply('TrigToExp', latex);
      const twice = ce.function('TrigToExp', [once]).evaluate();
      expect(once.isSame(twice)).toBe(true);
    }
  });
});

describe('TrigReduce', () => {
  test('power reduction', () => {
    expect(apply('TrigReduce', '\\sin(x)^2').toString()).toBe(`-1/2 * cos(2x) + 1/2`);
    expect(apply('TrigReduce', '\\cos(x)^2').toString()).toBe(`1/2 * cos(2x) + 1/2`);
    expect(apply('TrigReduce', '\\sin(x)^3').toString()).toBe(`-1/4 * sin(3x) + 3/4 * sin(x)`);
  });

  test('product to sum', () => {
    expect(
      apply('TrigReduce', '\\sin(x)\\cos(x)').toString()
    ).toBe(`1/2 * sin(2x)`);
    expect(
      apply('TrigReduce', '\\sin(x)\\sin(y)').toString()
    ).toBe(`-1/2 * cos(x + y) + 1/2 * cos(x - y)`);
  });

  test('hyperbolic', () => {
    expect(apply('TrigReduce', '\\cosh(x)^2').toString()).toBe(`1/2 * cosh(2x) + 1/2`);
  });

  test('numeric equivalence', () => {
    for (const { latex, vars, complex } of BATTERY) {
      const original = ce.parse(latex);
      const transformed = ce.function('TrigReduce', [original]).evaluate();
      assertNumericallyEqual(original, transformed, vars, { complex });
    }
  });

  test('exact coefficients (no floats)', () => {
    expect(hasDecimalLiteral(apply('TrigReduce', '\\sin(x)^2'))).toBe(false);
    expect(hasDecimalLiteral(apply('TrigReduce', '\\sin(x)^3'))).toBe(false);
  });

  test('passthrough', () => {
    const sinx = ce.parse('\\sin(x)');
    expect(ce.function('TrigReduce', [sinx]).evaluate().isSame(sinx)).toBe(true);

    const poly = ce.parse('x+1');
    expect(ce.function('TrigReduce', [poly]).evaluate().isSame(poly)).toBe(true);
  });

  test('idempotent', () => {
    for (const latex of [
      '\\sin(x)^2',
      '\\sin(x)^3',
      '\\sin(x)\\cos(x)',
      '\\cosh(x)^2',
    ]) {
      const once = apply('TrigReduce', latex);
      const twice = ce.function('TrigReduce', [once]).evaluate();
      expect(once.isSame(twice)).toBe(true);
    }
  });

  test('TrigReduce inverts TrigExpand', () => {
    for (const latex of ['\\sin(2x)', '\\cos(2x)', '\\sin(3x)']) {
      const expanded = ce.function('TrigExpand', [ce.parse(latex)]).evaluate();
      const reduced = ce.function('TrigReduce', [expanded]).evaluate();
      assertNumericallyEqual(ce.parse(latex), reduced, ['x'], { complex: true });
    }
  });
});

describe('Trig rewrite: round-trip serialization', () => {
  test('unevaluated form serializes and re-parses', () => {
    for (const op of ['TrigExpand', 'TrigToExp', 'TrigReduce']) {
      const box = ce.box([op, ['Sin', 'x']], { canonical: false });
      const latex = box.latex;
      const reparsed = ce.parse(latex);
      expect(reparsed.json).toEqual([op, ['Sin', 'x']]);
    }
  });
});
