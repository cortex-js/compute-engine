import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Three Mathematica-style forms (user decision 2026-10-17):
 *  - `NSolve(eq, x)`: the `N` of each solution of `Solve`;
 *  - the `{i, n}` iterator spec of `Table` (`i` from 1 to `n`);
 *  - limits at a symbolic point that need the Laurent expansion about the
 *    point (a pole, a logarithm, a jump), from either side.
 *
 * `NSolve` and `Table` are lazy operators, so each is probed on the box,
 * parse, `ce.function` and Epsil routes.
 */
const ce = new ComputeEngine();

function evalLatex(latex: string): string {
  return ce.parse(latex).evaluate().toString();
}

function epsil(source: string): string {
  const engine = new ComputeEngine();
  const { value, diagnostics } = executeEpsil(engine, source);
  expect(diagnostics).toEqual([]);
  return value.toString();
}

/** The real parts of the elements of a list result, as machine numbers. */
function reals(expr: ReturnType<typeof ce.box>): number[] {
  return (expr.ops ?? []).map((op) => op.re);
}

describe('NSolve', () => {
  test('box route: the float roots of x^2 = 2', () => {
    const r = ce.box(['NSolve', ['Equal', ['Power', 'x', 2], 2], 'x']);
    expect(r.operator).toBe('NSolve');
    const v = r.evaluate();
    expect(v.operator).toBe('List');
    const roots = reals(v).sort((a, b) => a - b);
    expect(roots[0]).toBeCloseTo(-Math.SQRT2, 14);
    expect(roots[1]).toBeCloseTo(Math.SQRT2, 14);
    // Every root is a float, not the exact `√2`.
    expect(v.ops!.every((op) => op.isExact === false)).toBe(true);
  });

  test('parse route: \\operatorname{NSolve} and \\mathrm{NSolve}', () => {
    for (const latex of [
      '\\operatorname{NSolve}(x^2=2, x)',
      '\\mathrm{NSolve}(x^2=2, x)',
    ]) {
      const roots = reals(ce.parse(latex).evaluate()).sort((a, b) => a - b);
      expect(roots[0]).toBeCloseTo(-Math.SQRT2, 14);
      expect(roots[1]).toBeCloseTo(Math.SQRT2, 14);
    }
  });

  test('LaTeX round trip', () => {
    const e = ce.box(['NSolve', ['Equal', ['Power', 'x', 2], 2], 'x']);
    expect(ce.parse(e.latex).json).toEqual([
      'NSolve',
      ['Equal', ['Power', 'x', 2], 2],
      'x',
    ]);
  });

  test('ce.function route (pre-boxed operands)', () => {
    const eq = ce.box(['Equal', ['Power', 'x', 2], 2], { form: 'raw' });
    const roots = reals(
      ce.function('NSolve', [eq, ce.symbol('x')]).evaluate()
    ).sort((a, b) => a - b);
    expect(roots[1]).toBeCloseTo(Math.SQRT2, 14);
  });

  test('Epsil route: `nSolve`', () => {
    expect(epsil('nSolve(x^2 = 4, x)')).toBe(epsil('solve(x^2 = 4, x)'));
    const engine = new ComputeEngine();
    const { value } = executeEpsil(engine, 'nSolve(x^2 = 2, x)');
    expect(reals(value).sort((a, b) => a - b)[1]).toBeCloseTo(Math.SQRT2, 14);
  });

  test('complex roots are complex floats', () => {
    // x³ = 2: the real cube root and two complex roots.
    const v = ce
      .box(['NSolve', ['Equal', ['Power', 'x', 3], 2], 'x'])
      .evaluate();
    expect(v.nops).toBe(3);
    const cbrt2 = Math.cbrt(2);
    const values = v.ops!.map((op) => [op.re, op.im]);
    // Each root, cubed, is 2.
    for (const [re, im] of values) {
      // (re + i·im)³ = re³ − 3·re·im² + i(3·re²·im − im³)
      expect(re ** 3 - 3 * re * im * im).toBeCloseTo(2, 12);
      expect(3 * re * re * im - im ** 3).toBeCloseTo(0, 12);
    }
    expect(
      values.some(([re, im]) => Math.abs(re - cbrt2) < 1e-12 && im === 0)
    ).toBe(true);
  });

  test('the unknown can be omitted, as in Solve', () => {
    const roots = reals(
      ce.box(['NSolve', ['Subtract', ['Power', 'x', 2], 2]]).evaluate()
    ).sort((a, b) => a - b);
    expect(roots[1]).toBeCloseTo(Math.SQRT2, 14);
  });

  test('a system of equations', () => {
    expect(
      ce
        .box([
          'NSolve',
          [
            'List',
            ['Equal', ['Add', 'x', 'y'], 3],
            ['Equal', ['Subtract', 'x', 'y'], 1],
          ],
          ['List', 'x', 'y'],
        ])
        .evaluate()
        .toString()
    ).toBe('[(2, 1)]');
  });

  test('domain specs are those of Solve', () => {
    const v = ce
      .box([
        'NSolve',
        ['Equal', ['Power', 'x', 2], 2],
        ['Element', 'x', ['Interval', 0, 10]],
      ])
      .evaluate();
    expect(v.nops).toBe(1);
    expect(v.ops![0].re).toBeCloseTo(Math.SQRT2, 14);
    // The Mathematica-style trailing domain.
    expect(
      ce
        .box(['NSolve', ['Equal', ['Power', 'x', 2], 4], 'x', 'Integers'])
        .evaluate()
        .toString()
    ).toBe('[2,-2]');
  });

  test('stays unevaluated when Solve does', () => {
    // `cos x = x` has no closed form, and `Solve` stays unevaluated.
    // `NSolve` does not fall back to `FindRoot`, which finds only the one
    // root near its start value.
    const e = ce.box(['NSolve', ['Subtract', ['Cos', 'x'], 'x'], 'x']);
    const v = e.evaluate();
    expect(v.operator).toBe('NSolve');
  });

  test('an invalid equation keeps its error, as in Solve', () => {
    const v = ce.box(['NSolve', ['Range', 1, 3], 'x']).evaluate();
    expect(v.isValid).toBe(false);
    expect(v.toString()).toBe(
      ce
        .box(['Solve', ['Range', 1, 3], 'x'])
        .evaluate()
        .toString()
    );
  });
});

describe('Table with the `{i, n}` iterator spec', () => {
  const table = (...ops: any[]) =>
    ce
      .box(['Table', ...ops] as any)
      .evaluate()
      .toString();

  test('box route: Set, Tuple and Pair spellings', () => {
    expect(table(['Power', 'i', 2], ['Set', 'i', 4])).toBe('[1,4,9,16]');
    expect(table(['Power', 'i', 2], ['Tuple', 'i', 4])).toBe('[1,4,9,16]');
    expect(table(['Power', 'i', 2], ['Pair', 'i', 4])).toBe('[1,4,9,16]');
    // Same value as the `{i, 1, n}` spelling.
    expect(table(['Power', 'i', 2], ['Set', 'i', 4])).toBe(
      table(['Power', 'i', 2], ['Set', 'i', 1, 4])
    );
  });

  test('parse route: `\\{i, n\\}` and `(i, n)`', () => {
    expect(evalLatex('\\operatorname{Table}(i^2, \\{i, 3\\})')).toBe('[1,4,9]');
    expect(evalLatex('\\operatorname{Table}(i^2, (i, 3))')).toBe('[1,4,9]');
  });

  test('parse route: the paren spelling of the longer specs', () => {
    // The parenthesized spec parses as a `Delimiter`, which is held by the
    // lazy `Table` and read as a tuple spec.
    expect(evalLatex('\\operatorname{Table}(i^2, (i, 2, 4))')).toBe('[4,9,16]');
    expect(evalLatex('\\operatorname{Table}(i, (i, 0, 10, 5))')).toBe(
      '[0,5,10]'
    );
  });

  test('nested specs, mixed spellings', () => {
    expect(
      table(['Multiply', 'i', 'j'], ['Set', 'i', 2], ['Tuple', 'j', 3])
    ).toBe('[[1,2,3],[2,4,6]]');
    expect(
      evalLatex('\\operatorname{Table}(i j, \\{i, 2\\}, \\{j, 1, 3\\})')
    ).toBe('[[1,2,3],[2,4,6]]');
  });

  test('a symbolic count stays symbolic, as `{i, 1, n}` does', () => {
    const e = ce.box(['Table', ['Power', 'i', 2], ['Set', 'i', 'n']] as any);
    expect(e.operator).toBe('Tabulate');
    expect(
      e.isSame(
        ce.box(['Table', ['Power', 'i', 2], ['Set', 'i', 1, 'n']] as any)
      )
    ).toBe(true);
  });

  test('ce.function route (pre-boxed operands)', () => {
    const body = ce.box(['Power', 'k', 2], { form: 'raw' });
    const spec = ce.box(['Tuple', 'k', 5], { form: 'raw' });
    expect(ce.function('Table', [body, spec]).evaluate().toString()).toBe(
      '[1,4,9,16,25]'
    );
  });

  test('Epsil route: `Table(k^2, (k, 5))` and `{k, 5}`', () => {
    expect(epsil('Table(k^2, (k, 5))')).toBe('[1,4,9,16,25]');
    expect(epsil('Table(k^2, {k, 5})')).toBe('[1,4,9,16,25]');
  });
});

describe('Limit at a symbolic point', () => {
  test('a simple pole, from each side', () => {
    expect(evalLatex('\\lim_{x\\to a^+}\\frac{1}{x-a}')).toBe('+oo');
    expect(evalLatex('\\lim_{x\\to a^-}\\frac{1}{x-a}')).toBe('-oo');
    // Box route, Wolfram-style operands.
    expect(
      ce
        .box(['Limit', ['Divide', 1, ['Subtract', 'x', 'a']], 'x', 'a', -1])
        .evaluate()
        .toString()
    ).toBe('-oo');
  });

  test('a two-sided limit follows the convention of a numeric point', () => {
    // Both sides agree for an even pole; they disagree for an odd pole, which
    // stays unevaluated (as `lim_{x→0} 1/x` does).
    expect(evalLatex('\\lim_{x\\to a}\\frac{1}{(x-a)^2}')).toBe('+oo');
    expect(evalLatex('\\lim_{x\\to 0}\\frac{1}{x^2}')).toBe('+oo');
    expect(ce.parse('\\lim_{x\\to a}\\frac{1}{x-a}').evaluate().operator).toBe(
      'Limit'
    );
  });

  test('a logarithm and a jump', () => {
    expect(evalLatex('\\lim_{x\\to a^+}\\ln(x-a)')).toBe('-oo');
    // From the left, the real logarithm is not defined: unevaluated, as at 0.
    expect(ce.parse('\\lim_{x\\to a^-}\\ln(x-a)').evaluate().operator).toBe(
      'Limit'
    );
    expect(evalLatex('\\lim_{x\\to a^+}\\frac{|x-a|}{x-a}')).toBe('1');
    expect(evalLatex('\\lim_{x\\to a^-}\\frac{|x-a|}{x-a}')).toBe('-1');
    expect(evalLatex('\\lim_{x\\to a^+}(x-a)\\ln(x-a)')).toBe('0');
  });

  test('the result agrees with the limit at a number', () => {
    const at = (latex: string) => evalLatex(latex);
    expect(at('\\lim_{x\\to a^+}\\frac{1}{x-a}')).toBe(
      at('\\lim_{x\\to 3^+}\\frac{1}{x-3}')
    );
    expect(at('\\lim_{x\\to a^+}\\ln(x-a)')).toBe(
      at('\\lim_{x\\to 3^+}\\ln(x-3)')
    );
    expect(at('\\lim_{x\\to a^+}(x-a)\\Gamma(x-a)')).toBe(
      at('\\lim_{x\\to 0^+}x\\Gamma(x)')
    );
  });

  test('a point that is an expression or a constant', () => {
    expect(evalLatex('\\lim_{x\\to (a+1)^+}\\frac{1}{x-a-1}')).toBe('+oo');
    expect(evalLatex('\\lim_{x\\to \\pi^+}\\frac{1}{x-\\pi}')).toBe('+oo');
  });

  test('a sign that depends on a parameter is not guessed', () => {
    // 1/(x² − a²) near a⁺ is 1/(2a·t + t²): its sign is the sign of `a`.
    expect(
      ce.parse('\\lim_{x\\to a^+}\\frac{1}{x^2-a^2}').evaluate().operator
    ).toBe('Limit');
    expect(
      ce.parse('\\lim_{x\\to a^+}\\frac{x}{x-a}').evaluate().operator
    ).toBe('Limit');
    // With an assumption, the sign is known.
    const engine = new ComputeEngine();
    engine.assume(engine.parse('a > 0'));
    expect(
      engine.parse('\\lim_{x\\to a^+}\\frac{x}{x-a}').evaluate().toString()
    ).toBe('+oo');
    expect(
      engine.parse('\\lim_{x\\to a^-}\\frac{x}{x-a}').evaluate().toString()
    ).toBe('-oo');
  });

  test('the shift variable does not capture a free `t` and does not leak', () => {
    const engine = new ComputeEngine();
    engine.assume(engine.parse('t > 0'));
    expect(
      engine.parse('\\lim_{x\\to a^+}\\frac{t}{x-a}').evaluate().toString()
    ).toBe('+oo');
    expect(
      engine.parse('\\lim_{x\\to a^-}\\frac{t}{x-a}').evaluate().toString()
    ).toBe('-oo');
    const fresh = new ComputeEngine();
    fresh.parse('\\lim_{x\\to a^+}\\frac{1}{x-a}').evaluate();
    expect(fresh.lookupDefinition('t')).toBeUndefined();
  });

  test('the limits that substitution already found are unchanged', () => {
    expect(evalLatex('\\lim_{x\\to a^+}x^2')).toBe('a^2');
    expect(evalLatex('\\lim_{x\\to a^-}\\frac{x^2-a^2}{x-a}')).toBe('2a');
    expect(evalLatex('\\lim_{x\\to a^+}\\frac{\\sin(x)-\\sin(a)}{x-a}')).toBe(
      'cos(a)'
    );
  });
});

describe('One-sided limits with no Laurent expansion', () => {
  // These limits declined at a number as well as at a symbol, so the
  // one-sided limits at a symbolic point that reduce to them declined too.
  test('a constant base raised to an exponent that tends to an infinity', () => {
    expect(evalLatex('\\lim_{x\\to 0^+}e^{-1/x}')).toBe('0');
    expect(evalLatex('\\lim_{x\\to 0^-}e^{-1/x}')).toBe('+oo');
    expect(evalLatex('\\lim_{x\\to 0^+}2^{1/x}')).toBe('+oo');
    expect(evalLatex('\\lim_{x\\to 0^+}(1/2)^{1/x}')).toBe('0');
    expect(evalLatex('\\lim_{x\\to a^+}e^{-1/(x-a)}')).toBe('0');
    expect(evalLatex('\\lim_{x\\to a^-}e^{-1/(x-a)}')).toBe('+oo');
    // The two sides disagree: no two-sided limit.
    expect(ce.parse('\\lim_{x\\to 0}e^{-1/x}').evaluate().operator).toBe(
      'Limit'
    );
    // A base whose position relative to 1 is not known.
    expect(ce.parse('\\lim_{x\\to 0^+}b^{1/x}').evaluate().operator).toBe(
      'Limit'
    );
  });

  test('a nonzero numerator over a root that tends to 0', () => {
    expect(evalLatex('\\lim_{x\\to 0^+}\\frac{1}{\\sqrt{x}}')).toBe('+oo');
    expect(evalLatex('\\lim_{x\\to 0^+}\\frac{1}{\\sqrt[3]{x}}')).toBe('+oo');
    expect(evalLatex('\\lim_{x\\to 0^+}\\frac{-1}{x^{3/2}}')).toBe('-oo');
    expect(evalLatex('\\lim_{x\\to 0^+}\\frac{1}{-2\\sqrt{x}}')).toBe('-oo');
    expect(evalLatex('\\lim_{x\\to 1^-}\\frac{1}{\\sqrt{1-x}}')).toBe('+oo');
    expect(evalLatex('\\lim_{x\\to a^+}\\frac{1}{\\sqrt{x-a}}')).toBe('+oo');
    // L'Hôpital gives `cos x / ((3/2)√x)`.
    expect(evalLatex('\\lim_{x\\to 0^+}\\frac{\\sin x}{x^{3/2}}')).toBe('+oo');
    // From the side where the root is not real, no limit.
    expect(
      ce.parse('\\lim_{x\\to 0^-}\\frac{1}{\\sqrt{x}}').evaluate().operator
    ).toBe('Limit');
    expect(
      ce.parse('\\lim_{x\\to 1^+}\\frac{1}{\\sqrt{1-x}}').evaluate().operator
    ).toBe('Limit');
    // A constant factor of unknown sign.
    expect(
      ce.parse('\\lim_{x\\to 0^+}\\frac{1}{b\\sqrt{x}}').evaluate().operator
    ).toBe('Limit');
  });
});
