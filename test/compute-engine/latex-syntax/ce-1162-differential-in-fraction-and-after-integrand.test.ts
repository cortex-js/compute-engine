import { ComputeEngine } from '../../../src/compute-engine';
import { operator } from '../../../src/math-json/utils';

// CE-1162: a double integral with one differential in a fraction and the
// other after the integrand gives the same parse as the spelling with both
// differentials after the integrand.
//
// - With two signs on one command (`\iint`) and one differential after the
//   integrand, the integrand is searched for the other one, which comes first
//   in the written order.
// - With two `\int` commands, the inner integral reads the differential after
//   the integrand and keeps its body as parsed. It also records the reading
//   with the differential of the fraction, and the outer integral, which has
//   no differential of its own, takes the last one.
//
// An integral with one differential for each sign and no enclosing integral
// keeps a `d` before a variable as a symbol (CE-1123).
//
// The file also holds the test of CE-1032: a differential written with
// `\differentialD` inside a fraction.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;

/** The names of the `undeclared-symbol` diagnostics of `latex`, read with a
 * new engine so that no earlier parse has declared a symbol. */
function undeclaredNames(latex: string): unknown[] {
  const expr = new ComputeEngine().parse(latex, { diagnostics: true });
  return (expr.parseDiagnostics ?? [])
    .filter((d) => d.code === 'undeclared-symbol')
    .map((d) => d.detail?.name);
}

describe('CE-1162 a differential in a fraction and one after the integrand', () => {
  test('two integral commands', () => {
    expect(raw('\\int_3^4\\int_1^2 \\frac{dx}{x}\\,dy')).toEqual(
      raw('\\int_3^4\\int_1^2 \\frac{1}{x}\\,dx\\,dy')
    );
    expect(
      new ComputeEngine()
        .parse('\\int_3^4\\int_1^2 \\frac{dx}{x}\\,dy')
        .evaluate()
        .toString()
    ).toBe('ln(2)');
    expect(undeclaredNames('\\int_3^4\\int_1^2 \\frac{dx}{x}\\,dy')).toEqual(
      []
    );
    // A term after the inner integrand, in a brace group, is outside the
    // inner integral: its `x` is free
    expect(
      undeclaredNames('\\int_3^4\\int_1^2 {\\frac{dx\\,dy}{xy} + x}')
    ).toEqual(['x']);
  });

  test('one command with two signs', () => {
    expect(raw('\\iint_1^2 \\frac{dx}{x}\\,dy')).toEqual(
      raw('\\iint_1^2 \\frac{1}{x}\\,dx\\,dy')
    );
    expect(undeclaredNames('\\iint_1^2 \\frac{dx}{x}\\,dy')).toEqual([]);
  });

  test('a factor before and a term after the integrals', () => {
    expect(raw('2\\int_3^4\\int_1^2 \\frac{dx}{x}\\,dy + 5')).toEqual(
      raw('2\\int_3^4\\int_1^2 \\frac{1}{x}\\,dx\\,dy + 5')
    );
  });

  // CE-1032: the differential operator of MathLive, `\differentialD`, is
  // read in a fraction as `d` and `\mathrm{d}` are.
  test('a differential written \\differentialD in a fraction (CE-1032)', () => {
    expect(raw('\\int_1^2 \\frac{\\differentialD x}{x}')).toEqual(
      raw('\\int_1^2 \\frac{1}{x}\\,\\differentialD x')
    );
    expect(
      new ComputeEngine()
        .parse('\\int_1^2 \\frac{\\differentialD x}{x}')
        .evaluate()
        .toString()
    ).toBe('ln(2)');
    // A derivative in Leibniz notation with the same command
    expect(raw('\\frac{\\differentialD}{\\differentialD x}x^2')).toEqual([
      'D',
      ['Power', 'x', 2],
      'x',
    ]);
  });

  test('an enclosing integral with a differential of its own does not take one', () => {
    // The outer integral has `dz` after the 1: the inner integral keeps its
    // body as parsed, and the 1 is in the integrand of the outer integral
    expect(raw('\\int_0^1 \\int_0^2 \\frac{dx}{x}\\,dy + 1\\,dz')).toEqual([
      'Integrate',
      [
        'Add',
        [
          'Integrate',
          ['Divide', ['InvisibleOperator', 'd', 'x'], 'x'],
          ['Tuple', 'y', 0, 2],
        ],
        1,
      ],
      ['Tuple', 'z', 0, 1],
    ]);
    // The same with two inner integrals before `dz`, and with a term whose
    // `d` is not a differential
    expect(
      operator(
        raw(
          '\\int_0^1 \\int_1^2 \\frac{dx}{x}\\,dy + \\int_3^4 \\frac{du}{u}\\,dv + 1\\,dz'
        )
      )
    ).toBe('Integrate');
    expect(
      raw('\\int_3^4\\int_1^2 \\frac{dx}{x}\\,dy + d{2} + 1\\,dz')
    ).toEqual([
      'Integrate',
      [
        'Add',
        [
          'Integrate',
          ['Divide', ['InvisibleOperator', 'd', 'x'], 'x'],
          ['Tuple', 'y', 1, 2],
        ],
        ['InvisibleOperator', 'd', 2],
        1,
      ],
      ['Tuple', 'z', 3, 4],
    ]);
    // The differential of the outer integral in its other spellings
    const withDz = raw('\\int_3^4\\int_1^2 \\frac{dx}{x}\\,dy + 1\\,dz');
    for (const dz of ['\\mathrm{d}z', '\\operatorname{d}z', '\\differentialD z'])
      expect(raw(`\\int_3^4\\int_1^2 \\frac{dx}{x}\\,dy + 1\\,${dz}`)).toEqual(
        withDz
      );
    // A relation ends the body: the differential after it is not this
    // integral's, and the 1 is outside the integrals
    expect(
      raw('\\int_3^5\\int_1^2 \\frac{dx}{x}\\,dy + 1 \\approx \\int_0^1 z\\,dz')
    ).toEqual(
      raw('\\int_3^5\\int_1^2 \\frac{1}{x}\\,dx\\,dy + 1 \\approx \\int_0^1 z\\,dz')
    );
    // A later differential of another inner integral: the outer integral
    // takes no differential, as it has none
    expect(
      raw('\\int_0^2 \\int_1^2 \\frac{dx}{x}\\,dy + \\int_3^4 u\\,du')
    ).toEqual([
      'Integrate',
      [
        'Add',
        [
          'Integrate',
          ['Divide', ['InvisibleOperator', 'd', 'x'], 'x'],
          ['Tuple', 'y', 1, 2],
        ],
        ['Integrate', 'u', ['Tuple', 'u', 3, 4]],
      ],
      ['Tuple', 'Nothing', 0, 2],
    ]);
    // A `d` at the end of the input is a symbol, and the parse ends
    expect(raw('\\int_0^1 \\int_0^2 \\frac{dx}{x}\\,dy + d')).toEqual([
      'Add',
      raw('\\int_0^1 \\int_0^2 \\frac{1}{x}\\,dx\\,dy'),
      'd',
    ]);
    // A `dy` in a term of a sum is a product with a coefficient `d`
    expect(raw('\\int_0^1\\int_0^1 (c+dy)\\,dx')).toEqual([
      'Integrate',
      [
        'Integrate',
        ['Delimiter', ['Add', 'c', ['InvisibleOperator', 'd', 'y']]],
        ['Tuple', 'x', 0, 1],
      ],
      ['Tuple', 'Nothing', 0, 1],
    ]);
    // Two differentials in the fraction are more than one enclosing sign
    // takes: the inner body is kept as parsed
    expect(raw('\\int_3^4\\int_1^2 \\frac{dx\\,dz}{x}\\,dy')).toEqual([
      'Integrate',
      [
        'Integrate',
        [
          'Divide',
          [
            'InvisibleOperator',
            'd',
            'x',
            ['HorizontalSpacing', 3],
            'd',
            'z',
          ],
          'x',
        ],
        ['Tuple', 'y', 1, 2],
      ],
      ['Tuple', 'Nothing', 3, 4],
    ]);
  });

  test('with no enclosing integral, the d stays a symbol (CE-1123)', () => {
    expect(raw('\\int_1^2 \\frac{dx}{x}\\,dy')).toEqual([
      'Integrate',
      ['Divide', ['InvisibleOperator', 'd', 'x'], 'x'],
      ['Tuple', 'y', 1, 2],
    ]);
  });
});
