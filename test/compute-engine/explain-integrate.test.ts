import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';

// A shared engine with the Rubi integration rules loaded. The rule driver is
// bounded by its own per-integral budget; give the engine a generous
// wall-clock so a loaded machine doesn't spuriously time out.
const ce = new ComputeEngine();
ce.timeLimit = 10_000;
loadIntegrationRules(ce);

const INERT_TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);

function hasInertTrig(e: any): boolean {
  if (INERT_TRIG.has(e.operator)) return true;
  return (e.ops ?? []).some(hasInertTrig);
}

// Integrands the bundled rules close in closed form (verified below with plain
// evaluate()). Each is an indefinite integral.
const BATTERY = [
  '\\int x\\sqrt{1+x}\\,dx',
  '\\int x^2\\,dx',
  '\\int (3x^2+2x+1)\\,dx',
  '\\int \\frac{1}{1+x^2}\\,dx',
  '\\int \\frac{1}{x^2-1}\\,dx',
  '\\int \\sin x \\cos x\\,dx',
  '\\int x e^x\\,dx',
  '\\int \\frac{1}{a+bx}\\,dx',
];

describe('explain("Integrate") — contract battery', () => {
  for (const latex of BATTERY) {
    test(latex, () => {
      const expr = ce.parse(latex);
      const plain = expr.evaluate();
      // Guard: the rules must actually close it (else the test is vacuous).
      expect(plain.operator).not.toBe('Integrate');

      const ex = expr.explain('Integrate');

      // `initial` is the Integrate expression.
      expect(ex.operation).toBe('Integrate');
      expect(ex.initial.operator).toBe('Integrate');

      // Result parity with plain evaluate().
      expect(ex.result.isSame(plain)).toBe(true);

      // At least one step, and the last one lands on the result.
      expect(ex.steps.length).toBeGreaterThan(0);
      expect(ex.steps.at(-1)!.value.isSame(ex.result)).toBe(true);

      // Every step has a non-empty description and no inert trig head leaks.
      for (const s of ex.steps) {
        expect(typeof s.description).toBe('string');
        expect(s.description.length).toBeGreaterThan(0);
        expect(s.id.length).toBeGreaterThan(0);
        expect(hasInertTrig(s.value)).toBe(false);
      }
    });
  }
});

describe('explain("Integrate") — step content', () => {
  test('a rule-driven case carries a rubi: step id', () => {
    const ex = ce.parse('\\int \\frac{1}{1+x^2}\\,dx').explain('Integrate');
    expect(ex.steps.some((s) => s.id.startsWith('rubi:'))).toBe(true);
    // The rubi family label is registered (not the prettifier fallback).
    const rubiStep = ex.steps.find((s) => s.id.startsWith('rubi:'))!;
    expect(rubiStep.description).toContain('(Rubi)');
  });

  test('a polynomial case shows the sum and constant-factor phases', () => {
    const ex = ce.parse('\\int (3x^2+2x+1)\\,dx').explain('Integrate');
    const ids = ex.steps.map((s) => s.id);
    expect(ids).toContain('integrate.sum');
    expect(ids).toContain('integrate.constant-factor');
  });
});

describe('explain("Integrate") — golden step chains', () => {
  const chain = (latex: string) =>
    ce
      .parse(latex)
      .explain('Integrate')
      .steps.map((s) => `${s.id} :: ${s.value.toString()}`);

  test('∫ x² dx', () => {
    expect(chain('\\int x^2\\,dx')).toMatchInlineSnapshot(`
      [
        "rubi:1 Algebraic functions/1.1 Binomial products/1.1.1 Linear/1.1.1.1 (a+b x)^m.m#15 :: 1/3 * x^3",
      ]
    `);
  });

  test('∫ (3x²+2x+1) dx', () => {
    expect(chain('\\int (3x^2+2x+1)\\,dx')).toMatchInlineSnapshot(`
      [
        "integrate.sum :: int(1 dx) + int(2x dx) + int(3x^2 dx)",
        "integrate.constant :: x + int(2x dx) + int(3x^2 dx)",
        "integrate.constant-factor :: x + 2int(x) + int(3x^2 dx)",
        "integrate.variable :: x^2 + x + int(3x^2 dx)",
        "integrate.constant-factor :: x^2 + x + 3int(x^2 dx)",
        "rubi:1 Algebraic functions/1.1 Binomial products/1.1.1 Linear/1.1.1.1 (a+b x)^m.m#15 :: x^3 + x^2 + x",
      ]
    `);
  });

  test('∫ 1/(a+bx) dx', () => {
    expect(chain('\\int \\frac{1}{a+bx}\\,dx')).toMatchInlineSnapshot(`
      [
        "rubi:1 Algebraic functions/1.1 Binomial products/1.1.1 Linear/1.1.1.1 (a+b x)^m.m#16 :: ln(b * x + a) / b",
      ]
    `);
  });
});

describe('explain("Integrate") — errors', () => {
  test('without loaded rules, asks for them', () => {
    const bare = new ComputeEngine();
    expect(() => bare.parse('\\int x^2\\,dx').explain('Integrate')).toThrow(
      /requires the integration rules/
    );
  });

  test('a definite integral is rejected', () => {
    expect(() => ce.parse('\\int_0^1 x\\,dx').explain('Integrate')).toThrow(
      /indefinite integrals only/
    );
  });

  test('an unclosable integrand reports could-not-integrate', () => {
    // xˣ is left inert by the rules (and the built-in antiderivative).
    expect(ce.parse('\\int x^x\\,dx').evaluate().operator).toBe('Integrate');
    expect(() =>
      ce.parse('x^x').explain('Integrate', { variable: 'x' })
    ).toThrow(/could not integrate/);
  });
});

describe('explain("Integrate") — non-perturbation & verbosity', () => {
  test('plain evaluate() is unchanged by a preceding explain() call', () => {
    const before = ce.parse('\\int x^2\\,dx').evaluate().toString();
    ce.parse('\\int x^2\\,dx').explain('Integrate');
    const after = ce.parse('\\int x^2\\,dx').evaluate().toString();
    expect(after).toBe(before);
  });

  test('verbosity "all" has at least as many steps as "default"', () => {
    const latex = '\\int (3x^2+2x+1)\\,dx';
    const def = ce.parse(latex).explain('Integrate', { verbosity: 'default' });
    const all = ce.parse(latex).explain('Integrate', { verbosity: 'all' });
    expect(all.steps.length).toBeGreaterThanOrEqual(def.steps.length);
  });

  test('a bare integrand + options.variable is wrapped and traced', () => {
    const ex = ce.box(['Power', 'x', 2]).explain('Integrate', {
      variable: 'x',
    });
    expect(ex.initial.operator).toBe('Integrate');
    expect(ex.result.isSame(ce.parse('\\int x^2\\,dx').evaluate())).toBe(true);
  });
});
