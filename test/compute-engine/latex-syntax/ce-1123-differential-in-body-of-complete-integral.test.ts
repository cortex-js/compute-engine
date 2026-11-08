import { ComputeEngine } from '../../../src/compute-engine';

// CE-1123: an integral that found one differential for each of its signs does
// not search its body for another differential. In that body, a `d` before a
// variable is the product of the symbol `d` and the variable.
//
// The rule keeps the integrals whose integrand has a coefficient named `d`:
// a search of the body would read the `dy` of `\frac{ax+by}{cx+dy}` as a
// differential in a denominator, and replace the denominator by an
// `unexpected-differential` error.
//
// The consequence is pinned too: an integral written with more differentials
// than signs keeps the `d` of the extra differential as a symbol, and the
// `diagnostics` option of `parse()` reports that `d` when it is not declared.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;

/** The names of the `undeclared-symbol` diagnostics of `latex`, in order,
 * read with a new engine so that no earlier parse has declared a symbol. */
function undeclaredNames(latex: string): unknown[] {
  const expr = new ComputeEngine().parse(latex, { diagnostics: true });
  return (expr.parseDiagnostics ?? [])
    .filter((d) => d.code === 'undeclared-symbol')
    .map((d) => d.detail?.name);
}

describe('CE-1123 a d before a variable in the body of an integral that has its differential', () => {
  test('a coefficient named d at the end of a denominator', () => {
    const latex = '\\int_0^1 \\frac{ax+by}{cx+dy}\\,dx';
    expect(raw(latex)).toEqual([
      'Integrate',
      [
        'Divide',
        ['Add', ['InvisibleOperator', 'a', 'x'], ['InvisibleOperator', 'b', 'y']],
        ['Add', ['InvisibleOperator', 'c', 'x'], ['InvisibleOperator', 'd', 'y']],
      ],
      ['Tuple', 'x', 0, 1],
    ]);
    expect(ce.parse(latex).isValid).toBe(true);
    expect(raw('\\int_0^1 \\frac{1}{c + d x}\\,dx')).toEqual([
      'Integrate',
      ['Divide', 1, ['Add', 'c', ['InvisibleOperator', 'd', 'x']]],
      ['Tuple', 'x', 0, 1],
    ]);
  });

  test('a coefficient named d in a factor before the last factor', () => {
    const latex = '\\int_0^1 (c+dx)(a+bx)\\,dx';
    expect(ce.parse(latex).isValid).toBe(true);
    // (c + d·x)(a + b·x) integrated from 0 to 1
    expect(ce.parse(latex).evaluate().json).toEqual(
      ce.parse('ac+\\frac{bc}{2}+\\frac{ad}{2}+\\frac{bd}{3}').evaluate().json
    );
  });

  test('a coefficient named d in the last term of the integrand', () => {
    // `d·x` has the integration variable
    expect(ce.parse('\\int_0^1 (c + d x)\\,dx').evaluate().json).toEqual(
      ce.parse('c+\\frac{d}{2}').evaluate().json
    );
    // `d·x` has another variable: it is a constant of the integration
    expect(ce.parse('\\int_0^1 (cy+dx)\\,dy').evaluate().json).toEqual(
      ce.parse('dx+\\frac{c}{2}').evaluate().json
    );
  });

  test('one sign, a differential in a fraction and one after the integrand', () => {
    // The integral has one sign and takes `dy`. The `dx` of the fraction is
    // not a second differential: the integrand is `d·x/x`.
    expect(raw('\\int_1^2 \\frac{dx}{x}\\,dy')).toEqual([
      'Integrate',
      ['Divide', ['InvisibleOperator', 'd', 'x'], 'x'],
      ['Tuple', 'y', 1, 2],
    ]);
    expect(ce.parse('\\int_1^2 \\frac{dx}{x}\\,dy').evaluate().json).toEqual(
      'd'
    );
    expect(raw('\\int_1^2 \\frac{dx}{x}\\cdot 2\\,dy')).toEqual([
      'Integrate',
      ['Multiply', ['Divide', ['InvisibleOperator', 'd', 'x'], 'x'], 2],
      ['Tuple', 'y', 1, 2],
    ]);
  });

  test('one sign and a differential in each of two fractions', () => {
    // No differential follows the integrand, so the last factor is searched
    // and gives `dy`. The integral then has its differential, and the factor
    // before it keeps the product `d·x`.
    expect(raw('\\int_1^2 \\frac{dx}{x}\\frac{dy}{y}')).toEqual([
      'Integrate',
      [
        'Multiply',
        ['Divide', ['InvisibleOperator', 'd', 'x'], 'x'],
        ['Divide', 1, 'y'],
      ],
      ['Tuple', 'y', 1, 2],
    ]);
  });

  test('the d that stays a symbol is reported as undeclared', () => {
    // `y` is bound by the integral. `d` and `x` are free symbols of the
    // integrand, and each of their occurrences is reported.
    expect(undeclaredNames('\\int_1^2 \\frac{dx}{x}\\,dy')).toEqual([
      'd',
      'x',
      'x',
    ]);
    // Without the fraction, no symbol is free.
    expect(undeclaredNames('\\int_1^2 \\frac{1}{y}\\,dy')).toEqual([]);
  });

  test('a declared d is not reported', () => {
    const engine = new ComputeEngine();
    engine.declare('d', 'real');
    const expr = engine.parse('\\int_0^1 \\frac{ax+by}{cx+dy}\\,dx', {
      diagnostics: true,
    });
    const names = (expr.parseDiagnostics ?? [])
      .filter((d) => d.code === 'undeclared-symbol')
      .map((d) => d.detail?.name);
    expect(names).not.toContain('d');
    expect(expr.isValid).toBe(true);
  });
});
