import { execFileSync } from 'child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';

/**
 * A quotient by the number 0 folds to `ComplexInfinity` only when the
 * numerator is provably not zero: a number literal other than 0, or an
 * expression whose sign is known from its type and the assumptions. A
 * numerator that may be zero keeps the quotient until it has a value, because
 * `x/0` is `0/0` (no value) at `x = 0` and a pole elsewhere. User decision of
 * 2026-10-23, ROADMAP CE-95 (Tycho row 413).
 */
describe('x/0 with a numerator that may be zero', () => {
  test('the canonical form keeps the quotient', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.parse('\\frac{x}{0}').json).toEqual(['Divide', 'x', 0]);
    expect(ce.parse('\\frac{x+1}{0}').json).toEqual([
      'Divide',
      ['Add', 'x', 1],
      0,
    ]);
    expect(ce.box(['Divide', 'x', 0]).json).toEqual(['Divide', 'x', 0]);
    expect(ce.function('Divide', [ce.symbol('x'), ce.Zero]).json).toEqual([
      'Divide',
      'x',
      0,
    ]);
    expect(ce.symbol('x').div(ce.Zero).toString()).toBe('x / 0');
    expect(ce.symbol('x').div(0).toString()).toBe('x / 0');
  });

  test('evaluate(), N() and simplify() wait for the value', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const q = ce.parse('\\frac{x}{0}');
    expect(q.evaluate().toString()).toBe('x / 0');
    expect(q.N().toString()).toBe('x / 0');
    expect(q.simplify().toString()).toBe('x / 0');
    // The polynomial cancellation and the sum do not read the quotient as
    // `(1/0)·x`, which is `+∞·x`.
    expect(ce.parse('\\frac{x}{0}+1').simplify().toString()).toBe('x / 0 + 1');
    expect(q.add(ce.One).toString()).toBe('x / 0 + 1');
  });

  test('arithmetic on the kept quotient keeps the zero divisor', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const q = ce.box(['Divide', 'x', 0]);
    // A product does not split `x/0` into `x·0^{-1}`, whose zero factor
    // made the product 0. `(x/0)/2` has the value of `x/0` at every `x`.
    expect(q.div(ce.number(2)).toString()).toBe('x / 0');
    expect(q.div(2).toString()).toBe('x / 0');
    expect(
      ce
        .function('Divide', [q, ce.number(2)])
        .subs({ x: 0 })
        .evaluate()
        .toString()
    ).toBe('Indeterminate');
    // `1/(x/0)` is not `(1·0)/x`: at `x = 0` it has no value.
    const r = ce.function('Divide', [ce.One, q]);
    expect(r.json).toEqual(['Divide', 1, ['Divide', 'x', 0]]);
    expect(ce.One.div(q).json).toEqual(['Divide', 1, ['Divide', 'x', 0]]);
    expect(r.subs({ x: 0 }).evaluate().toString()).toBe('Indeterminate');
    expect(r.subs({ x: 2 }).evaluate().toString()).toBe('0');
  });

  test('the value of the numerator decides the answer', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const q = ce.parse('\\frac{x}{0}');
    expect(q.subs({ x: 0 }).evaluate().toString()).toBe('Indeterminate');
    expect(q.subs({ x: 2 }).evaluate().toString()).toBe('~oo');
    ce.assign('x', 0);
    expect(q.evaluate().toString()).toBe('Indeterminate');
    ce.assign('x', 3);
    expect(q.evaluate().toString()).toBe('~oo');
  });

  test('a numerator with an assigned value is not folded when boxed', () => {
    // Its sign comes from the value that the variable holds now, and the
    // canonical form must not depend on it.
    const ce = new ComputeEngine();
    ce.assign('a', 5);
    const q = ce.parse('\\frac{a}{0}');
    expect(q.json).toEqual(['Divide', 'a', 0]);
    expect(q.evaluate().toString()).toBe('~oo');
    ce.assign('a', 0);
    expect(q.evaluate().toString()).toBe('Indeterminate');
  });

  test('a numerator that is provably not zero is a pole', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    for (const s of [
      '\\frac{5}{0}',
      '\\frac{1.5}{0}',
      '\\frac{\\pi}{0}',
      '\\frac{i}{0}',
      '\\frac{x^2+1}{0}',
      '\\frac{e^x}{0}',
    ])
      expect(ce.parse(s).json).toBe('ComplexInfinity');
    expect(ce.parse('\\frac{0}{0}').json).toBe('Indeterminate');
  });

  test('a numerator declared or assumed not zero is a pole', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real & !0');
    ce.declare('d', 'real');
    ce.assume(ce.parse('d \\ne 0'));
    expect(ce.box(['Divide', 'a', 0]).json).toBe('ComplexInfinity');
    expect(ce.box(['Divide', 'd', 0]).json).toBe('ComplexInfinity');
  });

  test('the compiled branch is 0 at x = 0 (Tycho row 413)', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.parse(
      '\\begin{cases} 1 & \\frac{x}{0} > 0 \\\\ 0 & \\text{otherwise}\\end{cases}'
    );
    const f = compile(expr);
    expect(f.success).toBe(true);
    expect([-1, 0, 1].map((x) => f.run!({ x }))).toEqual([0, 0, 1]);
  });

  (TEST_PYTHON === undefined ? test.skip : test)(
    'the compiled Python branch is 0 at x = 0',
    () => {
      // Compiled Python runs on NumPy values: `x / 0` is `±inf`, or `nan`
      // at `x = 0`, as in JavaScript. (A plain Python float raises
      // `ZeroDivisionError` for any division by zero, `1/x` included.)
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const py = compile(
        ce.parse(
          '\\begin{cases} 1 & \\frac{x}{0} > 0 \\\\ 0 & \\text{otherwise}\\end{cases}'
        ),
        { to: 'python' } as never
      );
      expect(py.success).toBe(true);
      const script = `import numpy as np\nnp.seterr(all='ignore')\nprint([float((lambda x: ${py.code})(np.float64(v))) for v in (-1.0, 0.0, 1.0)])\n`;
      expect(
        execFileSync(TEST_PYTHON!, ['-I', '-c', script], {
          encoding: 'utf8',
        }).trim()
      ).toBe('[0.0, 0.0, 1.0]');
    }
  );

  test('a limit does not read a kept quotient as its value', () => {
    // The substitution `x = a` gives `a/0`; the sign of `a` is unknown.
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\lim_{x\\to a^+}\\frac{x}{x-a}').evaluate().operator
    ).toBe('Limit');
    expect(
      ce.parse('\\lim_{t\\to 0^+}\\frac{a+t}{t}').evaluate().operator
    ).toBe('Limit');
    expect(
      ce.parse('\\lim_{x\\to 1^+}\\frac{x}{x-1}').evaluate().toString()
    ).toBe('+oo');
  });
});
