import { ComputeEngine } from '../../../src/compute-engine';
import { engine as ce, exprToString } from '../../utils';

function parse(s: string) {
  const expr = ce.parse(s);
  return expr.toLatex() + '\n' + expr.toString() + '\n' + exprToString(expr);
}

/** Integrals with no limits specified */
describe('INDEFINITE INTEGRAL', () => {
  test('No index', () => {
    expect(parse('\\int\\sin x + 1 = 2')).toMatchSnapshot();
  });

  test('Index with d', () => {
    expect(parse('\\int\\sin x \\operatorname{d} x+1 = 2')).toMatchSnapshot();
  });

  test('Index with mathrm', () => {
    expect(parse('\\int\\sin x \\mathrm{d}x+1 = 2')).toMatchSnapshot();
  });

  test('Index with operatorname', () => {
    expect(parse('\\int\\sin x \\operatorname{d}x+1 = 2')).toMatchSnapshot();
  });

  test('Index \\alpha', () => {
    expect(parse('\\int\\alpha d\\alpha+1 = 2')).toMatchSnapshot();
  });

  test('Spacing commands', () => {
    expect(parse('\\int\\!\\sin x \\,\\mathrm{d}x+1 = 2')).toMatchSnapshot();
  });

  test('Index in addition', () =>
    expect(parse('\\int3x+kxdx = 2')).toMatchSnapshot());

  // A sum integrand with no differential anywhere parsed to
  // `Add(Integrate(Add(), Nothing), Sin(x), 1)`: the `Add` branch of
  // `parseIntegral()` tested the `indexes` array for truth instead of for its
  // length, so every term was moved out of the integral (found 2026-10-20).
  test('Sum integrand with no differential keeps every term', () => {
    // An integral with no differential carries `Nothing` as its variable.
    expect(ce.parse('\\int\\sin x + 1', { form: 'raw' }).json).toEqual([
      'Integrate',
      ['Add', ['Sin', 'x'], 1],
      'Nothing',
    ]);
    expect(ce.parse('\\int x^2 + 1', { form: 'raw' }).json).toEqual([
      'Integrate',
      ['Add', ['Power', 'x', 2], 1],
      'Nothing',
    ]);
  });

  // The term that holds `dx` and the terms before it are the integrand; the
  // terms after it are added to or subtracted from the integral, with their
  // sign. A term that is only the differential (`(dx)`) is removed. Each
  // input has its differential inside a term (a fraction or parentheses), so
  // the body does not stop at a top-level differential and the sum is split
  // by `splitSumAtDifferential()`. Each row is: the LaTeX, the raw MathJSON,
  // the canonical MathJSON.
  const integrandSplit: [string, unknown, unknown][] = [
    [
      '\\int 3x + \\frac{x\\,dx}{2} + 1',
      [
        'Add',
        [
          'Integrate',
          [
            'Add',
            ['InvisibleOperator', 3, 'x'],
            ['Divide', ['InvisibleOperator', 'x', ['HorizontalSpacing', 3]], 2],
          ],
          'x',
        ],
        1,
      ],
      [
        'Add',
        [
          'Integrate',
          [
            'Function',
            [
              'Block',
              [
                'Add',
                ['Multiply', 3, 'x'],
                ['Multiply', ['Rational', 1, 2], 'x'],
              ],
            ],
            'x',
          ],
          ['Limits', 'x', 'Nothing', 'Nothing'],
        ],
        1,
      ],
    ],
    [
      '\\int \\frac{x\\,dx}{2} - 1',
      [
        'Subtract',
        [
          'Integrate',
          ['Divide', ['InvisibleOperator', 'x', ['HorizontalSpacing', 3]], 2],
          'x',
        ],
        1,
      ],
      [
        'Add',
        [
          'Integrate',
          ['Function', ['Block', ['Multiply', ['Rational', 1, 2], 'x']], 'x'],
          ['Limits', 'x', 'Nothing', 'Nothing'],
        ],
        -1,
      ],
    ],
    [
      '\\int\\frac{dx}{x}-1',
      ['Subtract', ['Integrate', ['Divide', 1, 'x'], 'x'], 1],
      [
        'Add',
        [
          'Integrate',
          ['Function', ['Block', ['Divide', 1, 'x']], 'x'],
          ['Limits', 'x', 'Nothing', 'Nothing'],
        ],
        -1,
      ],
    ],
    [
      '\\int x - \\frac{x\\,dx}{2}',
      [
        'Integrate',
        [
          'Subtract',
          'x',
          ['Divide', ['InvisibleOperator', 'x', ['HorizontalSpacing', 3]], 2],
        ],
        'x',
      ],
      [
        'Integrate',
        [
          'Function',
          ['Block', ['Add', 'x', ['Multiply', ['Rational', -1, 2], 'x']]],
          'x',
        ],
        ['Limits', 'x', 'Nothing', 'Nothing'],
      ],
    ],
    [
      '\\int 1-\\frac{dx}{x}',
      ['Integrate', ['Subtract', 1, ['Divide', 1, 'x']], 'x'],
      [
        'Integrate',
        ['Function', ['Block', ['Add', ['Divide', -1, 'x'], 1]], 'x'],
        ['Limits', 'x', 'Nothing', 'Nothing'],
      ],
    ],
    [
      '\\int a - \\frac{dx}{x} - 1',
      [
        'Subtract',
        ['Integrate', ['Subtract', 'a', ['Divide', 1, 'x']], 'x'],
        1,
      ],
      [
        'Add',
        [
          'Integrate',
          ['Function', ['Block', ['Add', 'a', ['Divide', -1, 'x']]], 'x'],
          ['Limits', 'x', 'Nothing', 'Nothing'],
        ],
        -1,
      ],
    ],
    [
      '\\int\\frac{dx}{x}+1',
      ['Add', ['Integrate', ['Divide', 1, 'x'], 'x'], 1],
      [
        'Add',
        [
          'Integrate',
          ['Function', ['Block', ['Divide', 1, 'x']], 'x'],
          ['Limits', 'x', 'Nothing', 'Nothing'],
        ],
        1,
      ],
    ],
    [
      '\\int (\\sin x\\,dx) + 1',
      [
        'Add',
        [
          'Integrate',
          [
            'Delimiter',
            ['Sin', ['InvisibleOperator', 'x', ['HorizontalSpacing', 3]]],
          ],
          'x',
        ],
        1,
      ],
      [
        'Add',
        [
          'Integrate',
          ['Function', ['Block', ['Sin', 'x']], 'x'],
          ['Limits', 'x', 'Nothing', 'Nothing'],
        ],
        1,
      ],
    ],
    [
      '\\int (x dx) - 1',
      [
        'Subtract',
        ['Integrate', ['Delimiter', 'x'], 'x'],
        1,
      ],
      [
        'Add',
        ['Integrate', 'x', ['Limits', 'x', 'Nothing', 'Nothing']],
        -1,
      ],
    ],
    [
      '\\int (a+b) + \\frac{x\\,dx}{2} + 1',
      [
        'Add',
        [
          'Integrate',
          [
            'Add',
            ['Delimiter', ['Add', 'a', 'b']],
            ['Divide', ['InvisibleOperator', 'x', ['HorizontalSpacing', 3]], 2],
          ],
          'x',
        ],
        1,
      ],
      [
        'Add',
        [
          'Integrate',
          [
            'Function',
            ['Block', ['Add', 'a', 'b', ['Multiply', ['Rational', 1, 2], 'x']]],
            'x',
          ],
          ['Limits', 'x', 'Nothing', 'Nothing'],
        ],
        1,
      ],
    ],
    [
      '\\int 3x + (dx) + 1',
      ['Add', ['Integrate', ['InvisibleOperator', 3, 'x'], 'x'], 1],
      [
        'Add',
        [
          'Integrate',
          ['Function', ['Block', ['Multiply', 3, 'x']], 'x'],
          ['Limits', 'x', 'Nothing', 'Nothing'],
        ],
        1,
      ],
    ],
    [
      '\\int x + (dx)',
      ['Integrate', 'x', 'x'],
      ['Integrate', 'x', ['Limits', 'x', 'Nothing', 'Nothing']],
    ],
  ];

  test.each(integrandSplit)(
    'A differential inside a term of a sum ends the integrand there: %s',
    (latex, raw, canonical) => {
      expect(ce.parse(latex, { form: 'raw' }).json).toEqual(raw);
      const json = ce.parse(latex).json;
      expect(json).toEqual(canonical);
      expect(JSON.stringify(json)).not.toMatch(/"(Error|Tuple)"/);
    }
  );

  test('Index in negate', () =>
    expect(parse('\\int-xdx = 2')).toMatchSnapshot());

  test('Index inside delimiter', () =>
    expect(parse('\\int(3x+x^2dx) = 2')).toMatchSnapshot());

  test('Index after delimiter', () =>
    expect(parse('\\int(3x+x^2)dx = 2')).toMatchSnapshot());

  test('Index after implicit trig argument', () =>
    expect(parse('\\int\\sin x dx = 2')).toMatchSnapshot());

  test('Index in numerator', () =>
    expect(parse('\\int\\frac{3xdx}{5} = 2')).toMatchSnapshot());

  test('Index in numerator with mathrm', () =>
    expect(parse('\\int\\frac{3x\\mathrm{d}x}{5} = 2')).toMatchSnapshot());

  test('Index with \\differentialD', () =>
    expect(parse('\\int\\sin x \\differentialD x + 1 = 2')).toMatchSnapshot());

  test('Non-standard typesetting (\\cdot)', () =>
    expect(parse('\\int f(t) \\cdot dt')).toMatchSnapshot());

  test('INVALID index in denominator', () =>
    // A differential in the denominator is an error (CE-305.5)
    expect(parse('\\int\\frac{3x}{5dx} = 2')).toMatchSnapshot());
});

/** Integral with limits */
describe('DEFINITE INTEGRAL', () => {
  test('Lower and upper bounds', () => {
    expect(parse('\\int_0^1\\sin x dx')).toMatchSnapshot();
  });

  test('Lower and upper bounds with \\limits', () => {
    expect(parse('\\int\\limits_0^1\\sin x dx')).toMatchSnapshot();
  });

  test('Lower bound only (malformed)', () => {
    expect(parse('\\int_0\\sin x dx')).toMatchSnapshot();
  });

  test('Upper bound only (malformed)', () => {
    expect(parse('\\int^1\\sin x dx')).toMatchSnapshot();
  });

  test('Symbolic lower bound (regions)', () => {
    expect(parse('\\int_G\\sin x dx')).toMatchSnapshot();
  });

  test('Lower and upper bounds with no index', () => {
    expect(parse('\\int_0^1\\sin x')).toMatchSnapshot();
  });
});

describe('MULTIPLE INTEGRALS', () => {
  test('Double integral', () => {
    expect(parse('\\int_1^2\\int_0^1 x^2+y^2 dx dy')).toMatchSnapshot();
  });

  test('Double integral with repeated index', () => {
    expect(parse('\\int_1^2\\int_0^1 x^2 dx dx')).toMatchSnapshot();
  });

  test('Triple integral', () => {
    expect(
      parse('\\int_1^2\\int_0^1\\int_3^4 x^2+y^2+z^2 dx dy dz')
    ).toMatchSnapshot();
  });

  test('Triple integral with \\limits and spacing', () => {
    expect(
      parse(
        '\\int\\limits_1^2\\int\\limits_0^1\\int\\limits_3^4 \\!x^2+y^2+z^2 \\,\\mathrm{d}x \\mathrm{d}y \\mathrm{d}z'
      )
    ).toMatchSnapshot();
  });
});

// The first limit of `Integrate` is the outermost integral (the evaluation
// uses this order). In LaTeX the differentials are written innermost first,
// so the variable of the last differential is the first limit.
describe('ORDER OF THE LIMITS OF A MULTIPLE INTEGRAL', () => {
  const limitVariables = (latex: string) =>
    ce
      .parse(latex)
      .ops!.slice(1)
      .map((limit) => limit.op1.symbol);

  test('\\iint: the last differential is the first limit', () => {
    expect(limitVariables('\\iint xy\\,dx\\,dy')).toEqual(['y', 'x']);
  });

  test('\\iiint: the last differential is the first limit', () => {
    expect(limitVariables('\\iiint xyz\\,dx\\,dy\\,dz')).toEqual([
      'z',
      'y',
      'x',
    ]);
  });

  test('\\oiint: the last differential is the first limit', () => {
    expect(limitVariables('\\oiint f\\,dx\\,dy')).toEqual(['y', 'x']);
  });

  test('differentials inside a group give the same order', () => {
    expect(limitVariables('\\iint_0^1 (xydxdy)')).toEqual(['y', 'x']);
    expect(limitVariables('\\iint \\sin(xydxdy)')).toEqual(['y', 'x']);
    expect(limitVariables('\\iint \\frac{dxdy}{x}')).toEqual(['y', 'x']);
    expect(ce.parse('\\iint_0^1 (xydxdy)').evaluate().toString()).toBe(
      '1/4 * x^2'
    );
  });

  test('the plain-text form names the variables of the limits', () => {
    // The parameters of the integrand are in another order than the limits
    const expr = ce.box([
      'Integrate',
      ['Function', ['Multiply', 'x', 'y'], 'x', 'y'],
      ['Limits', 'y', 0, 1],
      ['Limits', 'x', 0, 3],
    ]);
    expect(expr.toString()).toBe('int_(0)^(1)_(0)^(3)(x * y dx  dy)');
    // A non-canonical integral whose limits are bare variables
    const raw = ce.box(
      ['Integrate', ['Function', ['Multiply', 'x', 'y'], 'x', 'y'], 'y', 'x'],
      { form: 'raw' }
    );
    expect(raw.toString()).toBe('int(x * y dx  dy)');
  });

  test('the bounds of the sign go with the first limit', () => {
    const expr = ce.parse('\\iint_0^1 xy\\,dx\\,dy');
    expect(expr.op2.json).toEqual(['Limits', 'y', 0, 1]);
    expect(expr.op3.json).toEqual(['Limits', 'x', 'Nothing', 'Nothing']);
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });

  test('\\iint round-trips with the same order', () => {
    const expr = ce.parse('\\iint xy\\,dx\\,dy');
    expect(expr.latex).toMatchInlineSnapshot(
      `\\iint\\!xy\\, \\mathrm{d}x \\mathrm{d}y`
    );
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });

  // With a bound of the inner integral that uses the variable of the outer
  // integral, a change of order changes the value.
  test('a flat integral serializes with its first limit as the first sign', () => {
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'y', 0, 1],
      ['Limits', 'x', 0, ['Multiply', 2, 'y']],
    ]);
    expect(expr.latex).toMatchInlineSnapshot(
      `\\int_{0}^{1}\\int_{0}^{2y}\\!xy\\, \\mathrm{d}x \\mathrm{d}y`
    );
    // The plain-text form also writes the differentials innermost first
    expect(expr.toString()).toBe('int_(0)^(1)_(0)^(2y)(x * y dx  dy)');
    expect(expr.evaluate().toString()).toBe('1/2');
    expect(ce.parse(expr.latex).evaluate().toString()).toBe('1/2');
  });

  test('the plain-text form of an integral with no limit names the parameters of its integrand', () => {
    // A limit that the canonical form does not recognize (four elements) is
    // dropped. The plain-text form still writes a differential for each
    // parameter, innermost (the last parameter) first, as it does for limits
    // without a variable.
    expect(
      ce.box(['Integrate', ['Square', 'x'], ['Tuple', 'x', 0, 1, 5]]).toString()
    ).toBe('int(x^2 dx)');
    expect(
      ce
        .box(['Integrate', ['Function', ['Multiply', 'x', 'y'], 'x', 'y']])
        .toString()
    ).toBe('int(x * y dy  dx)');
  });

  test('the LaTeX of an integral with no limit names the parameters of its integrand', () => {
    // One integral sign and one differential for each parameter, innermost
    // (the last parameter) first, so that a parse of the LaTeX gets the
    // variables back.
    const single = ce.box(['Integrate', ['Square', 'x'], ['Tuple', 'x', 0, 1, 5]]);
    expect(single.latex).toMatchInlineSnapshot(`\\int\\!x^2\\, \\mathrm{d}x`);
    expect(JSON.stringify(ce.parse(single.latex).json)).toBe(
      '["Integrate",["Function",["Block",["Power","x",2]],"x"],["Limits","x","Nothing","Nothing"]]'
    );

    const double = ce.box([
      'Integrate',
      ['Function', ['Multiply', 'x', 'y'], 'x', 'y'],
    ]);
    expect(double.latex).toMatchInlineSnapshot(
      `\\iint\\!xy\\, \\mathrm{d}y \\mathrm{d}x`
    );
    expect(JSON.stringify(ce.parse(double.latex).json)).toBe(
      '["Integrate",["Function",["Block",["Multiply","x","y"]],"x","y"],["Limits","x","Nothing","Nothing"],["Limits","y","Nothing","Nothing"]]'
    );

    // A function name as integrand has no parameter: one sign and no
    // differential.
    expect(ce.box(['Integrate', 'Sin']).latex).toMatchInlineSnapshot(
      `\\int\\!\\sin`
    );
  });

  test('a flat integral with an outer bound that uses the inner variable', () => {
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, ['Multiply', 2, 'y']],
      ['Limits', 'y', 0, 1],
    ]);
    expect(expr.latex).toMatchInlineSnapshot(
      `\\int_{0}^{2y}\\int_{0}^{1}\\!xy\\, \\mathrm{d}y \\mathrm{d}x`
    );
    expect(expr.evaluate().toString()).toBe('y^2');
    expect(ce.parse(expr.latex).evaluate().toString()).toBe('y^2');
  });

  test('\\iint_0^1: the bounds are those of the outer integral', () => {
    // `\iint` carries one set of bounds, which go with the outer integral
    // over `y`; the inner integral over `x` has no bounds. With the other
    // order the value would be `1/4 * y^2`.
    expect(
      ce.parse('\\iint_0^1 xy\\,dx\\,dy').evaluate().toString()
    ).toBe('1/4 * x^2');
  });
});

// The differentials can be in the numerator of a fraction, with a space
// between them (`\frac{dx\,dy}{xy}`). With one sign per integral, the inner
// integral takes the first differential and the enclosing integrals take the
// others, as for differentials after the integrand.
describe('DIFFERENTIALS IN THE NUMERATOR OF A MULTIPLE INTEGRAL', () => {
  const raw = (latex: string) => ce.parse(latex, { canonical: false }).json;

  test('a space between the differentials does not stop the search', () => {
    expect(raw('\\iint \\frac{dx\\,dy}{xy}')).toEqual([
      'Integrate',
      ['Divide', 1, ['InvisibleOperator', 'x', 'y']],
      'y',
      'x',
    ]);
    expect(
      ce.parse('\\iint \\frac{dx\\,dy}{xy}').evaluate().toString()
    ).toBe('ln(|x|) * ln(|y|)');
    // A space after the last differential, or before the first one
    expect(raw('\\int_1^2 \\frac{dx\\,}{x}')).toEqual([
      'Integrate',
      ['Divide', 1, 'x'],
      ['Tuple', 'x', 1, 2],
    ]);
    // A space after the fraction that holds the differential
    expect(raw('\\int_1^2 \\frac{dx}{x}\\,')).toEqual(
      raw('\\int_1^2 \\frac{dx\\,}{x}')
    );
    expect(raw('\\iint (x\\,dx\\,dy)')).toEqual([
      'Integrate',
      ['Delimiter', ['InvisibleOperator', 'x', ['HorizontalSpacing', 3]]],
      'y',
      'x',
    ]);
    expect(
      ce.parse('\\iint (x\\,dx\\,dy)').evaluate().toString()
    ).toBe('1/2 * y * x^2');
  });

  test('consecutive signs: each sign takes one differential', () => {
    expect(raw('\\int_1^2\\int_3^4 \\frac{dx\\,dy}{xy}')).toEqual([
      'Integrate',
      [
        'Integrate',
        ['Divide', 1, ['InvisibleOperator', 'x', 'y']],
        ['Tuple', 'x', 3, 4],
      ],
      ['Tuple', 'y', 1, 2],
    ]);
    // The same without a space between the differentials
    expect(raw('\\int_1^2\\int_3^4 \\frac{dxdy}{xy}')).toEqual(
      raw('\\int_1^2\\int_3^4 \\frac{dx\\,dy}{xy}')
    );
    expect(
      ce.parse('\\int_1^2\\int_1^2 \\frac{dx\\,dy}{xy}').evaluate().toString()
    ).toBe('ln(2)^2');
    // The bounds of each sign go with its own variable: x from 3 to 4, y
    // from 1 to 2
    expect(
      ce
        .parse('\\int_1^2\\int_3^4 \\frac{dx\\,dy}{x^2y}')
        .evaluate()
        .toString()
    ).toBe('1/12 * ln(2)');
  });

  test('three signs and a factor before the fraction', () => {
    expect(
      ce
        .parse('\\int_0^1\\int_0^2\\int_0^3 x\\frac{dx\\,dy\\,dz}{1}')
        .evaluate()
        .toString()
    ).toBe('9');
    expect(
      ce
        .parse('\\int_0^1\\int_0^2 2\\frac{dx\\,dy}{x+1}')
        .evaluate()
        .toString()
    ).toBe('2ln(3)');
  });

  test('a single sign keeps all the differentials of its integrand', () => {
    expect(raw('\\int \\frac{dx\\,dy}{xy}')).toEqual(
      raw('\\iint \\frac{dx\\,dy}{xy}')
    );
    // With a term after the integrand, the term is outside the integral
    expect(raw('\\int_3^4 \\frac{dx\\,dy}{xy} + 1')).toEqual([
      'Add',
      [
        'Integrate',
        ['Divide', 1, ['InvisibleOperator', 'x', 'y']],
        ['Tuple', 'y', 3, 4],
        'x',
      ],
      1,
    ]);
  });

  // A term after the inner integrand, or a factor or a negation before the
  // inner integral, gives the same parse as the differentials written after
  // the integrand: the terms after the integrand are outside both integrals.
  test('terms after the integrand are outside the integrals (CE-1046)', () => {
    const same = (fraction: string, tokens: string) =>
      expect(raw(fraction)).toEqual(raw(tokens));
    same(
      '\\int_1^2\\int_3^4 \\frac{dx\\,dy}{xy} + 1',
      '\\int_1^2\\int_3^4 \\frac{1}{xy}\\,dx\\,dy + 1'
    );
    same(
      '\\int_1^2\\int_3^4 \\frac{dx\\,dy}{xy} - 1',
      '\\int_1^2\\int_3^4 \\frac{1}{xy}\\,dx\\,dy - 1'
    );
    // A term before the fraction stays in the integrand
    same(
      '\\int_1^2\\int_3^4 5 - \\frac{dx\\,dy}{xy} + 1',
      '\\int_1^2\\int_3^4 5 - \\frac{1}{xy}\\,dx\\,dy + 1'
    );
    same(
      '\\int_0^1\\int_1^2\\int_3^4 \\frac{dx\\,dy\\,dz}{xy} + 1',
      '\\int_0^1\\int_1^2\\int_3^4 \\frac{1}{xy}\\,dx\\,dy\\,dz + 1'
    );
    expect(
      ce
        .parse('\\int_1^2\\int_3^4 \\frac{dx\\,dy}{xy} + 1')
        .evaluate()
        .toString()
    ).toBe('1 + 2ln(2)^2 - ln(2) * ln(3)');
  });

  test('a factor or a negation before the inner integral (CE-1046)', () => {
    const same = (fraction: string, tokens: string) =>
      expect(raw(fraction)).toEqual(raw(tokens));
    same(
      '\\int_1^2 2\\int_3^4 \\frac{dx\\,dy}{xy}',
      '\\int_1^2 2\\int_3^4 \\frac{1}{xy}\\,dx\\,dy'
    );
    same(
      '\\int_1^2 2\\cdot\\int_3^4 \\frac{dx\\,dy}{xy}',
      '\\int_1^2 2\\cdot\\int_3^4 \\frac{1}{xy}\\,dx\\,dy'
    );
    same(
      '\\int_1^2 2\\int_3^4 \\frac{dx\\,dy}{xy} + 1',
      '\\int_1^2 2\\int_3^4 \\frac{1}{xy}\\,dx\\,dy + 1'
    );
    same(
      '\\int_1^2 -\\int_3^4 \\frac{dx\\,dy}{xy}',
      '\\int_1^2 -\\int_3^4 \\frac{1}{xy}\\,dx\\,dy'
    );
    same(
      '\\int_1^2 -\\int_3^4 \\frac{dx\\,dy}{xy} + 1',
      '\\int_1^2 -\\int_3^4 \\frac{1}{xy}\\,dx\\,dy + 1'
    );
    // A factor before each of the three signs, and a term after
    same(
      '\\int_0^1 3\\int_1^2 2\\int_3^4 \\frac{dx\\,dy\\,dz}{xy} - 1',
      '\\int_0^1 3\\int_1^2 2\\int_3^4 \\frac{1}{xy}\\,dx\\,dy\\,dz - 1'
    );
    expect(
      ce.parse('\\int_1^2 2\\int_3^4 \\frac{dx\\,dy}{xy}').evaluate().toString()
    ).toBe('-2ln(2) * ln(3) + 4ln(2)^2');
  });

  // The inner integral is the last term of the body of the outer integral.
  // The outer integral takes `dy`, and the terms before the inner integral
  // are in its integrand.
  test('a term before the inner integral (CE-1124)', () => {
    const same = (fraction: string, tokens: string) =>
      expect(raw(fraction)).toEqual(raw(tokens));
    expect(raw('\\int_1^2 1+\\int_3^4 \\frac{dx\\,dy}{xy}')).toEqual([
      'Integrate',
      [
        'Add',
        1,
        [
          'Integrate',
          ['Divide', 1, ['InvisibleOperator', 'x', 'y']],
          ['Tuple', 'x', 3, 4],
        ],
      ],
      ['Tuple', 'y', 1, 2],
    ]);
    same(
      '\\int_1^2 1-\\int_3^4 \\frac{dx\\,dy}{xy}',
      '\\int_1^2 1-\\int_3^4 \\frac{1}{xy}\\,dx\\,dy'
    );
    // Several terms, and a factor or a negation before the inner integral
    same(
      '\\int_1^2 1+2-\\int_3^4 \\frac{dx\\,dy}{xy}',
      '\\int_1^2 1+2-\\int_3^4 \\frac{1}{xy}\\,dx\\,dy'
    );
    same(
      '\\int_1^2 1-2+\\int_3^4 \\frac{dx\\,dy}{xy}',
      '\\int_1^2 1-2+\\int_3^4 \\frac{1}{xy}\\,dx\\,dy'
    );
    same(
      '\\int_1^2 1-2\\int_3^4 \\frac{dx\\,dy}{xy}',
      '\\int_1^2 1-2\\int_3^4 \\frac{1}{xy}\\,dx\\,dy'
    );
    same(
      '\\int_1^2 1+-\\int_3^4 \\frac{dx\\,dy}{xy}',
      '\\int_1^2 1+-\\int_3^4 \\frac{1}{xy}\\,dx\\,dy'
    );
    // Three signs, with a term before the second and the third
    same(
      '\\int_0^1 7-\\int_1^2 1+\\int_3^4 \\frac{dx\\,dy\\,dz}{xyz}',
      '\\int_0^1 7-\\int_1^2 1+\\int_3^4 \\frac{1}{xyz}\\,dx\\,dy\\,dz'
    );
    expect(
      ce.parse('\\int_1^2 1+\\int_3^4 \\frac{dx\\,dy}{xy}').evaluate().toString()
    ).toBe('1 + 2ln(2)^2 - ln(2) * ln(3)');
    expect(
      ce.parse('\\int_1^2 1-\\int_3^4 \\frac{dx\\,dy}{xy}').evaluate().toString()
    ).toBe('1 - 2ln(2)^2 + ln(2) * ln(3)');
  });

  // The terms after the inner integrand are outside both integrals, with the
  // sign they are written with, also when the inner integral is subtracted.
  test('terms before and after the inner integral (CE-1124)', () => {
    const same = (fraction: string, tokens: string) =>
      expect(raw(fraction)).toEqual(raw(tokens));
    expect(raw('\\int_1^2 1+\\int_3^4 \\frac{dx\\,dy}{xy} + 5')).toEqual([
      'Add',
      [
        'Integrate',
        [
          'Add',
          1,
          [
            'Integrate',
            ['Divide', 1, ['InvisibleOperator', 'x', 'y']],
            ['Tuple', 'x', 3, 4],
          ],
        ],
        ['Tuple', 'y', 1, 2],
      ],
      5,
    ]);
    same(
      '\\int_1^2 1+\\int_3^4 \\frac{dx\\,dy}{xy} - 5',
      '\\int_1^2 1+\\int_3^4 \\frac{1}{xy}\\,dx\\,dy - 5'
    );
    same(
      '\\int_1^2 1+\\int_3^4 \\frac{dx\\,dy}{xy} - 5 + z',
      '\\int_1^2 1+\\int_3^4 \\frac{1}{xy}\\,dx\\,dy - 5 + z'
    );
    same(
      '\\int_1^2 1+2+\\int_3^4 \\frac{dx\\,dy}{xy} + 5 + z',
      '\\int_1^2 1+2+\\int_3^4 \\frac{1}{xy}\\,dx\\,dy + 5 + z'
    );
    same(
      '\\int_1^2 1-\\int_3^4 \\frac{dx\\,dy}{xy} + 5',
      '\\int_1^2 1-\\int_3^4 \\frac{1}{xy}\\,dx\\,dy + 5'
    );
    same(
      '\\int_1^2 y-\\int_3^4 \\frac{dx\\,dy}{xy} - 5 + z',
      '\\int_1^2 y-\\int_3^4 \\frac{1}{xy}\\,dx\\,dy - 5 + z'
    );
    same(
      '\\int_1^2 1+2\\int_3^4 \\frac{dx\\,dy}{xy} + 5',
      '\\int_1^2 1+2\\int_3^4 \\frac{1}{xy}\\,dx\\,dy + 5'
    );
    same(
      '\\int_0^1 7+\\int_1^2 1+\\int_3^4 \\frac{dx\\,dy\\,dz}{xyz} + 5',
      '\\int_0^1 7+\\int_1^2 1+\\int_3^4 \\frac{1}{xyz}\\,dx\\,dy\\,dz + 5'
    );
    // The term after the inner integrand is an integral with two
    // differentials: the outer integral takes the `dy` of the first one.
    same(
      '\\int_1^2 1+\\int_3^4 \\frac{dx\\,dy}{xy} + \\int_5^6 \\frac{du\\,dv}{uv}',
      '\\int_1^2 1+\\int_3^4 \\frac{1}{xy}\\,dx\\,dy + \\int_5^6 \\frac{du\\,dv}{uv}'
    );
    expect(
      ce
        .parse('\\int_1^2 1+\\int_3^4 \\frac{dx\\,dy}{xy} + 5')
        .evaluate()
        .toString()
    ).toBe('6 + 2ln(2)^2 - ln(2) * ln(3)');
  });

  test('an integral with its own differential takes none from a later term (CE-1124)', () => {
    // The first integral has `dy` in its first term and ends before the `+`.
    // The second integral keeps both of its differentials.
    expect(
      raw('\\int_1^2 \\frac{dy}{y} + \\int_3^4 \\frac{dx\\,dz}{xz}')
    ).toEqual([
      'Add',
      ['Integrate', ['Divide', 1, 'y'], ['Tuple', 'y', 1, 2]],
      [
        'Integrate',
        ['Divide', 1, ['InvisibleOperator', 'x', 'z']],
        ['Tuple', 'z', 3, 4],
        'x',
      ],
    ]);
    // An inner integral with one differential gives none to the outer one
    expect(raw('\\int_1^2 1+\\int_3^4 \\frac{dx}{x}')).toEqual(
      raw('\\int_1^2 1+\\int_3^4 \\frac{1}{x}\\,dx')
    );
  });
});

describe('EXOTIC INTEGRALS', () => {
  test('\\oint - contour integral', () => {
    expect(parse('\\oint_V f(s) ds')).toMatchSnapshot();
  });

  test('\\oint - contour integral, no index', () => {
    expect(parse('\\oint_C f')).toMatchSnapshot();
  });

  test('\\intop', () => {
    expect(parse('\\intop_0^1\\sin x dx')).toMatchSnapshot();
  });

  test('\\smallint', () => {
    expect(parse('\\smallint_0^1\\sin x dx')).toMatchSnapshot();
  });

  test('\\iint', () => {
    expect(parse('\\iint_D f(x,y) dx dy')).toMatchSnapshot();
  });
  test('\\iiint', () => {
    expect(parse('\\iiint_V f(x,y,z) dx dy dz')).toMatchSnapshot();
  });
});

describe('REAL WORLD INTEGRALS', () => {
  test('Integral with non standard typesetting', () =>
    expect(
      parse('S_t=S_0+\\int_{t_i}^{t_e}\\left(G-F\\right)\\cdot dt')
    ).toMatchSnapshot());
});

describe('LIMIT', () => {
  expect(parse('\\lim_{x\\to\\infty} f(x)')).toMatchSnapshot(
    `["Limit", ["Function", ["f", "x"], "x"], "PositiveInfinity"]`
  );

  expect(ce.parse('\\lim_{x \\to 0} \\frac{\\sin(x)}{x}')).toMatchSnapshot(
    `["Limit", ["Function", ["Divide", ["Sin", "x"], "x"], "x"], 0]`
  );
  expect(parse('\\lim_{x\\to\\infty} f(x)')).toMatchSnapshot(`
  lim_(x -> +oo) {f(x)}
  \\lim_{x\\to\\infty}f(x)
  Limit,Function,f,x,x,PositiveInfinity
`);
});

describe('NEWTON DOT NOTATION', () => {
  test('First derivative \\dot{x}', () =>
    expect(parse('\\dot{x}')).toMatchSnapshot());

  test('Second derivative \\ddot{x}', () =>
    expect(parse('\\ddot{x}')).toMatchSnapshot());

  test('Third derivative \\dddot{y}', () =>
    expect(parse('\\dddot{y}')).toMatchSnapshot());

  test('Fourth derivative \\ddddot{z}', () =>
    expect(parse('\\ddddot{z}')).toMatchSnapshot());

  test('Dot notation with expression', () =>
    expect(parse('\\dot{x} + \\ddot{x}')).toMatchSnapshot());
});

describe('LAGRANGE PRIME NOTATION WITH ARGUMENTS', () => {
  test("f'(x) - single prime with argument", () =>
    expect(parse("f'(x)")).toMatchSnapshot());

  test("f''(x) - double prime with argument", () =>
    expect(parse("f''(x)")).toMatchSnapshot());

  test("f'''(x) - triple prime with argument", () =>
    expect(parse("f'''(x)")).toMatchSnapshot());

  test("g'(t) - different variable", () =>
    expect(parse("g'(t)")).toMatchSnapshot());

  test("f'(x, y) - multi-argument prime is a first-argument partial", () =>
    expect(parse("f'(x, y)")).toMatchSnapshot());

  test("f' without arguments - returns Derivative", () =>
    expect(parse("f'")).toMatchSnapshot());

  test("\\sin'(x) - known function with prime", () =>
    expect(parse("\\sin'(x)")).toMatchSnapshot());
});

describe('EULER DERIVATIVE NOTATION', () => {
  test('D_x f - first derivative', () =>
    expect(parse('D_x f')).toMatchSnapshot());

  test('D_t x - different variable', () =>
    expect(parse('D_t x')).toMatchSnapshot());

  test('D^2_x f - second derivative', () =>
    expect(parse('D^2_x f')).toMatchSnapshot());

  test('D_x (x^2 + 1) - derivative of expression', () =>
    expect(parse('D_x (x^2 + 1)')).toMatchSnapshot());

  test('D without subscript - should parse as symbol', () =>
    expect(parse('D')).toMatchSnapshot());
});

describe('DERIVATIVE ROUND-TRIP', () => {
  // Verify that parsing and re-serializing produces valid output
  test('Newton dot notation round-trip', () => {
    const expr = ce.parse('\\dot{x}');
    const latex = expr.toLatex();
    const reparsed = ce.parse(latex);
    // The MathJSON should be equivalent (both represent d/dt of x)
    expect(reparsed.json).toEqual(expr.json);
  });

  test('Lagrange prime notation round-trip', () => {
    const expr = ce.parse("f'(x)");
    const latex = expr.toLatex();
    const reparsed = ce.parse(latex);
    expect(reparsed.json).toEqual(expr.json);
  });

  test('Euler notation round-trip', () => {
    const expr = ce.parse('D_x f');
    const latex = expr.toLatex();
    const reparsed = ce.parse(latex);
    expect(reparsed.json).toEqual(expr.json);
  });

  // Item 70: an arity-1 `["D", w]` application (e.g. a user function named
  // `D`) must not silently drop its operand on serialization.
  test('arity-1 D application round-trip (does not drop operand)', () => {
    const latex = ce.box(['D', 'w'], { canonical: false }).toLatex();
    expect(latex).toBe('\\operatorname{D}(w)');
    const reparsed = ce.parse(latex, { canonical: false });
    expect(reparsed.json).toEqual(['D', 'w']);
  });

  test('arity-1 D inside Multiply round-trip (does not drop operand)', () => {
    const latex = ce
      .box(['Multiply', 'u', ['D', 'w']], { canonical: false })
      .toLatex();
    expect(latex).toBe('u\\operatorname{D}(w)');
    // The `w` operand survives the round-trip.
    expect(ce.parse(latex, { canonical: false }).json).toEqual([
      'InvisibleOperator',
      'u',
      ['D', 'w'],
    ]);
  });

  test('recognized D(f, x) serializes in Leibniz notation', () => {
    expect(ce.box(['D', 'f', 'x'], { canonical: false }).toLatex()).toBe(
      '\\frac{\\mathrm{d}f}{\\mathrm{d}x}'
    );
  });
});

// The operand of a Leibniz fraction is a *term*: it takes the sum that follows
// it (matching the `\int … dx` integrand convention) but stops before a
// relational, assignment or arrow operator. Otherwise `\frac{d}{dx}x^2 > 0`
// parses as the derivative of a *boolean*, which then fails to type-check.
describe('LEIBNIZ DERIVATIVE OPERAND EXTENT', () => {
  test('stops before a comparison operator', () => {
    expect(ce.parse('\\frac{d}{dx}x^{2}>0').json).toEqual([
      'Less',
      0,
      ['D', ['Power', 'x', 2], 'x'],
    ]);
  });

  test('stops before a comparison operator (partial derivative)', () => {
    expect(ce.parse('\\frac{\\partial}{\\partial x}x^{2}>0').json).toEqual([
      'Less',
      0,
      ['D', ['Power', 'x', 2], 'x'],
    ]);
  });

  test('stops before a comparison operator (higher order)', () => {
    expect(ce.parse('\\frac{d^2}{dx^2}x^{3}\\ge 0').json).toEqual([
      'LessEqual',
      0,
      ['D', ['D', ['Power', 'x', 3], 'x'], 'x'],
    ]);
  });

  test('stops before an equation', () => {
    expect(ce.parse('\\frac{d}{dx}x^{2}=2x').json).toEqual([
      'Equal',
      ['D', ['Power', 'x', 2], 'x'],
      ['Multiply', 2, 'x'],
    ]);
  });

  test('the derivative of a comparison evaluates as a comparison', () => {
    expect(ce.parse('\\frac{d}{dx}x^{2}>0').evaluate().toString()).not.toMatch(
      /incompatible-type/
    );
  });

  test('takes a trailing sum (integrand convention)', () => {
    expect(ce.parse('\\frac{d}{dx}x^{2}+1').json).toEqual([
      'D',
      ['Add', ['Power', 'x', 2], 1],
      'x',
    ]);
  });

  // A fenced operand is delimited by its fence (issue #336): what follows the
  // fence applies to the derivative, not to its operand.
  describe('fenced operand', () => {
    test('a sum after the fence applies to the derivative', () => {
      expect(ce.parse('\\frac{d}{dx}(x^2)+1').json).toEqual([
        'Add',
        ['D', ['Power', 'x', 2], 'x'],
        1,
      ]);
      expect(ce.parse('\\frac{d}{dx}(x)+1', { form: 'raw' }).json).toEqual([
        'Add',
        ['D', ['Delimiter', 'x'], 'x'],
        1,
      ]);
      expect(ce.parse('\\frac{d}{dx}(x^2)+1').evaluate().json).toEqual([
        'Add',
        ['Multiply', 2, 'x'],
        1,
      ]);
    });

    test('a product or quotient after the fence applies to the derivative', () => {
      expect(ce.parse('\\frac{d}{dx}(x^2)\\cdot 2').json).toEqual([
        'Multiply',
        2,
        ['D', ['Power', 'x', 2], 'x'],
      ]);
      expect(ce.parse('\\frac{d}{dx}(x^2)/2').json).toEqual([
        'Multiply',
        ['Rational', 1, 2],
        ['D', ['Power', 'x', 2], 'x'],
      ]);
      expect(ce.parse('\\frac{d}{dx}(x+1)(x-1)').json).toEqual([
        'Multiply',
        ['Add', 'x', -1],
        ['D', ['Add', 'x', 1], 'x'],
      ]);
    });

    test('a \\left…\\right fence delimits the operand too', () => {
      expect(ce.parse('\\frac{d}{dx}\\left(x^2\\right)+1').json).toEqual([
        'Add',
        ['D', ['Power', 'x', 2], 'x'],
        1,
      ]);
    });

    test('a partial derivative and a higher-order derivative stop at the fence', () => {
      expect(ce.parse('\\frac{\\partial}{\\partial x}(x^2y)+y').json).toEqual([
        'Add',
        'y',
        ['D', ['Multiply', 'y', ['Power', 'x', 2]], 'x'],
      ]);
      expect(ce.parse('\\frac{d^2}{dx^2}(x^3)+1').json).toEqual([
        'Add',
        ['D', ['D', ['Power', 'x', 3], 'x'], 'x'],
        1,
      ]);
    });

    test('a superscript attached to the fence stays inside the operand', () => {
      expect(ce.parse('\\frac{d}{dx}(x+1)^2').json).toEqual([
        'D',
        ['Power', ['Add', 'x', 1], 2],
        'x',
      ]);
      expect(ce.parse('\\frac{d}{dx}(x)^2+1').json).toEqual([
        'Add',
        ['D', ['Power', 'x', 2], 'x'],
        1,
      ]);
    });

    test('the fence still holds a whole sum', () => {
      expect(ce.parse('\\frac{d}{dx}(x^3+\\cos(x))').json).toEqual([
        'D',
        ['Add', ['Power', 'x', 3], ['Cos', 'x']],
        'x',
      ]);
    });

    test('a comparison after the fence applies to the derivative', () => {
      expect(ce.parse('\\frac{d}{dx}(x^2)>0').json).toEqual([
        'Less',
        0,
        ['D', ['Power', 'x', 2], 'x'],
      ]);
    });

    test('a space before the fence and a sized fence are accepted', () => {
      expect(ce.parse('\\frac{d}{dx} (x^2) + 1').json).toEqual([
        'Add',
        ['D', ['Power', 'x', 2], 'x'],
        1,
      ]);
      expect(ce.parse('\\frac{d}{dx}\\bigl(x^2\\bigr)+1').json).toEqual([
        'Add',
        ['D', ['Power', 'x', 2], 'x'],
        1,
      ]);
    });

    test('each spelling of a parenthesis is a fence', () => {
      // The spellings of `(` that the enclosure parser accepts: `\lparen`,
      // and each sizing prefix, also with the delimiter in braces.
      for (const latex of [
        '\\frac{d}{dx}\\lparen x^2\\rparen+1',
        '\\frac{d}{dx}\\left\\lparen x^2\\right\\rparen+1',
        '\\frac{d}{dx}\\big(x^2\\big)+1',
        '\\frac{d}{dx}\\mleft(x^2\\mright)+1',
        '\\frac{d}{dx}\\mathopen{(}x^2\\mathclose{)}+1',
      ])
        expect(ce.parse(latex).json).toEqual([
          'Add',
          ['D', ['Power', 'x', 2], 'x'],
          1,
        ]);
      expect(
        ce.parse('\\frac{d}{dx}\\lparen x\\rparen+1').evaluate().json
      ).toEqual(2);
    });

    test('only a parenthesis is a fence: another enclosure keeps the term extent', () => {
      expect(ce.parse('\\frac{d}{dx}|x|+1', { form: 'raw' }).json).toEqual([
        'D',
        ['Add', ['Abs', 'x'], 1],
        'x',
      ]);
    });

    test('an unclosed parenthesis reports the same errors as before', () => {
      expect(ce.parse('\\frac{d}{dx}(x', { form: 'raw' }).json).toEqual([
        'Sequence',
        ['D', ['Error', "'missing'"], 'x'],
        ['Error', "'unexpected-delimiter'", ['LatexString', "'('"]],
      ]);
    });
  });
});

describe('DERIVATIVE EVALUATION', () => {
  test('D of x^2 evaluates to 2x', () => {
    const expr = ce.parse('\\frac{d}{dx} x^2');
    const result = expr.evaluate();
    expect(result.toString()).toBe('2x');
  });

  test('D of sin(x) evaluates to cos(x)', () => {
    const expr = ce.parse('\\frac{d}{dx} \\sin(x)');
    const result = expr.evaluate();
    expect(result.toString()).toBe('cos(x)');
  });

  test('D of square-bracketed sin(x) evaluates to cos(x)', () => {
    const expr = ce.parse('\\frac{d}{\\,\\mathrm{d}x}[\\sin x]');
    expect(expr.json).toEqual(['D', ['Sin', 'x'], 'x']);
    expect(expr.evaluate().toString()).toBe('cos(x)');
  });

  test('compact d/dx notation applies chain rule to unknown functions', () => {
    const expr = ce.parse('d/dx(f(g(x)))');
    expect(expr.json).toEqual(['D', ['f', ['g', 'x']], 'x']);
    expect(expr.evaluate().json).toEqual([
      'Multiply',
      ['Apply', ['Derivative', 'g', 1], 'x'],
      ['Apply', ['Derivative', 'f', 1], ['g', 'x']],
    ]);
  });

  test('Newton notation evaluates correctly', () => {
    // \dot{t^2} with respect to t should be 2t
    const expr = ce.parse('\\dot{t^2}');
    const result = expr.evaluate();
    expect(result.toString()).toBe('2t');
  });

  test('Euler notation evaluates correctly', () => {
    const expr = ce.parse('D_x x^3');
    const result = expr.evaluate();
    expect(result.toString()).toBe('3x^2');
  });
});

// RT-P0-6: the higher-order Leibniz notation the `D` serializer emits
// (`\frac{d^n}{dx^n} f`) must parse back to the same nested `D`. Previously the
// `d`-branch only accepted a bare `d` numerator, so a `d^n` numerator fell
// through to a `Divide` of symbols — a silent meaning change.
describe('HIGHER-ORDER LEIBNIZ ROUND-TRIP', () => {
  test("f''(x) round-trips through LaTeX", () => {
    const d2 = ce.parse("f''(x)");
    expect(ce.parse(d2.latex).isSame(d2)).toBe(true);
  });

  test("f'''(x) round-trips through LaTeX", () => {
    const d3 = ce.parse("f'''(x)");
    expect(ce.parse(d3.latex).isSame(d3)).toBe(true);
  });

  test('second-order Leibniz of sin round-trips', () => {
    const d2 = ce.parse('\\frac{d^2}{dx^2}\\sin(x)');
    expect(d2.json).toEqual(['D', ['D', ['Sin', 'x'], 'x'], 'x']);
    expect(d2.evaluate().isSame(ce.parse('-\\sin(x)'))).toBe(true);
  });

  test('single-fraction second-derivative form parses', () => {
    // `\frac{d^2 <fn>}{dx^2}` folds the degree and the function into the
    // numerator; it must parse to the same nested `D` as the split form.
    const d2 = ce.parse('\\frac{d^2 \\sin(x)}{dx^2}');
    expect(d2.json).toEqual(['D', ['D', ['Sin', 'x'], 'x'], 'x']);
    expect(d2.isSame(ce.parse('\\frac{d^2}{dx^2}\\sin(x)'))).toBe(true);
    expect(d2.evaluate().isSame(ce.parse('-\\sin(x)'))).toBe(true);
  });

  test('first-order Leibniz and prime notation agree after evaluation', () => {
    // Leibniz `d/dx f(x)` parses to D(f(x), x) — the derivative of an applied
    // expression — while prime `f'(x)` parses to Apply(Derivative(f, 1), x):
    // the derivative *function* evaluated at x. Distinct trees (so not
    // isSame at parse time), but both evaluate to the same symbolic
    // derivative.
    const leibniz = ce.parse('\\frac{d}{dx}f(x)').evaluate();
    const prime = ce.parse("f'(x)").evaluate();
    expect(leibniz.isSame(prime)).toBe(true);
  });
});

describe('PARTIAL DERIVATIVE NOTATION (∂)', () => {
  test('Euler ∂_x f(x, y) parses to a first-argument partial', () => {
    const expr = ce.parse('\\partial_x f(x, y)');
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'x']);
    expect(expr.evaluate().json).toEqual([
      'Apply',
      ['Derivative', 'f', 1, 0],
      'x',
      'y',
    ]);
  });

  test('Euler ∂_x takes an operand that is not a name or a braced group', () => {
    // The operand has the extent of the operand of a Leibniz derivative
    expect(ce.parse('\\partial_x \\sin(x)').json).toEqual([
      'D',
      ['Sin', 'x'],
      'x',
    ]);
    expect(ce.parse('\\partial_x \\sin(x)').evaluate().json).toEqual([
      'Cos',
      'x',
    ]);
    for (const latex of [
      '\\partial_x (x^2)',
      '\\partial_x x^2',
      '\\partial_x {x^2}',
    ]) {
      expect(ce.parse(latex).json).toEqual(['D', ['Power', 'x', 2], 'x']);
      expect(ce.parse(latex).evaluate().json).toEqual(['Multiply', 2, 'x']);
    }
    expect(ce.parse('\\partial_x^2 \\sin(x)').evaluate().json).toEqual([
      'Negate',
      ['Sin', 'x'],
    ]);
    // The operand stops before a relational operator
    expect(ce.parse('\\partial_x x^2 = 0', { form: 'raw' }).json).toEqual([
      'Equal',
      ['D', ['Power', 'x', 2], 'x'],
      0,
    ]);
  });

  test('Leibniz ∂/∂x f(x, y) parses to the D operator', () => {
    const expr = ce.parse('\\frac{\\partial}{\\partial x} f(x, y)');
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'x']);
  });

  test('Leibniz ∂/∂y f(x, y) selects the second argument', () => {
    const expr = ce.parse('\\frac{\\partial}{\\partial y} f(x, y)');
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'y']);
  });

  test('mixed Leibniz ∂²/∂x∂y f(x, y) collects both variables', () => {
    const expr = ce.parse(
      '\\frac{\\partial^2}{\\partial x \\partial y} f(x, y)'
    );
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'x', 'y']);
    expect(expr.evaluate().json).toEqual([
      'Apply',
      ['Derivative', 'f', 1, 1],
      'x',
      'y',
    ]);
  });

  test('repeated Leibniz ∂²/∂x² f(x, y) repeats the variable', () => {
    const expr = ce.parse('\\frac{\\partial^2}{\\partial x^2} f(x, y)');
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'x', 'x']);
    expect(expr.evaluate().json).toEqual([
      'Apply',
      ['Derivative', 'f', 2, 0],
      'x',
      'y',
    ]);
  });

  test('an order above 1000 is an order pair, not a list of copies', () => {
    // A short input can ask for a very large order. Above 1000, the parser
    // writes the order pair `{x, n}`, which the canonical form of `D` keeps
    // as it is, instead of `n` copies of the variable. An order of 1000 is
    // still written as copies.
    const raw = (latex: string) => ce.parse(latex, { form: 'raw' }).json;
    const pair = (v: string, n: number | object) => ['Set', v, n];
    expect(raw('\\partial_x^{1000000000} f')).toEqual([
      'D',
      'f',
      pair('x', 1000000000),
    ]);
    expect(raw('\\partial_x^{1e400} f')).toEqual([
      'D',
      'f',
      pair('x', { num: '1e+400' }),
    ]);
    expect(
      raw('\\frac{\\partial^2 f}{\\partial^{1000000000}x\\partial y}')
    ).toEqual(['D', 'f', pair('x', 1000000000), 'y']);
    expect(
      raw('\\frac{\\partial^2 f}{\\partial x\\,\\partial^{1001} y}')
    ).toEqual(['D', 'f', 'x', pair('y', 1001)]);
    expect(raw('\\frac{\\partial^2 f}{\\partial x\\partial y^{1001}}')).toEqual(
      ['D', 'f', 'x', pair('y', 1001)]
    );
    expect(raw('\\frac{\\partial^{1001} f}{\\partial^{1001} x}')).toEqual([
      'D',
      'f',
      pair('x', 1001),
    ]);
    expect(raw('\\frac{\\partial^{1001} f}{\\partial x}')).toEqual([
      'D',
      'f',
      pair('x', 1001),
    ]);
    expect(raw('\\frac{d^{1000000000}}{dx^{1000000000}} f')).toEqual([
      'D',
      'f',
      pair('x', 1000000000),
    ]);
    expect(
      (raw('\\partial_x^{1000} f') as unknown[]).filter((v) => v === 'x')
    ).toHaveLength(1000);
    // The canonical form keeps the pair: the derivative stays inert.
    expect(
      ce.parse('\\frac{d^{2000}}{dx^{2000}} \\sin(x)').evaluate().json
    ).toEqual(['D', ['Sin', 'x'], ['Set', 'x', 2000]]);
  });

  test('an order pair that is not expanded keeps the derivative inert', () => {
    // A function symbol with a large order: the canonical form keeps the
    // pair, instead of an `expected-a-symbol` error.
    expect(ce.box(['D', 'f', ['Set', 'x', 2000]]).json).toEqual([
      'D',
      'f',
      ['Set', 'x', 2000],
    ]);
    const e = ce.parse('\\partial_x^{2000} f');
    expect(e.json).toEqual(['D', 'f', ['Set', 'x', 2000]]);
    expect(e.evaluate().json).toEqual(['D', 'f', ['Set', 'x', 2000]]);
  });

  test('a symbolic order is an order pair, not dropped', () => {
    const raw = (latex: string) => ce.parse(latex, { form: 'raw' }).json;
    expect(raw('\\partial_x^{n} f')).toEqual(['D', 'f', ['Set', 'x', 'n']]);
    expect(raw('\\frac{\\partial^{n} f}{\\partial x}')).toEqual([
      'D',
      'f',
      ['Set', 'x', 'n'],
    ]);
    expect(raw('\\frac{\\partial^{n} f}{\\partial x^{n}}')).toEqual([
      'D',
      'f',
      ['Set', 'x', 'n'],
    ]);
    expect(raw('\\frac{\\partial^2 f}{\\partial x\\partial y^{n}}')).toEqual([
      'D',
      'f',
      'x',
      ['Set', 'y', 'n'],
    ]);
    expect(raw('\\frac{\\partial^2 f}{\\partial^{n}x\\partial y}')).toEqual([
      'D',
      'f',
      ['Set', 'x', 'n'],
      'y',
    ]);
    // The operand `f(x)` reads as a call or a product with the state of
    // the shared engine: only the order pair is checked.
    expect((raw('\\frac{d^n}{dx^n} f(x)') as unknown[])[2]).toEqual([
      'Set',
      'x',
      'n',
    ]);
    // The derivative stays inert
    const e = ce.parse('\\partial_x^{n} {\\sin(x)}');
    expect(e.json).toEqual(['D', ['Sin', 'x'], ['Set', 'x', 'n']]);
    expect(e.evaluate().json).toEqual(['D', ['Sin', 'x'], ['Set', 'x', 'n']]);
  });

  test('an order of 0 is no differentiation, a negative order is an error', () => {
    const raw = (latex: string) => ce.parse(latex, { form: 'raw' }).json;
    // The parser keeps the order as written
    expect(raw('\\frac{\\partial^2 f}{\\partial x\\partial y^{0}}')).toEqual([
      'D',
      'f',
      'x',
      ['Set', 'y', 0],
    ]);
    expect(raw('\\frac{\\partial^2 f}{\\partial x\\partial y^{-3}}')).toEqual([
      'D',
      'f',
      'x',
      ['Set', 'y', ['Negate', 3]],
    ]);
    // The canonical form removes a pair of order 0
    expect(
      ce
        .parse('\\frac{\\partial^2}{\\partial x\\partial y^{0}} (x^2 y)')
        .evaluate().json
    ).toEqual(['Multiply', 2, 'x', 'y']);
    expect(ce.box(['D', ['Power', 'x', 2], ['Set', 'x', 0]]).json).toEqual([
      'Power',
      'x',
      2,
    ]);
    // A negative order is an error
    expect(
      ce.parse('\\frac{\\partial^2 f}{\\partial x\\partial y^{-3}}').json
    ).toEqual([
      'D',
      'f',
      'x',
      ['Error', "'expected-positive-integer'", "'-3'"],
    ]);
  });

  test('only an integer literal order is expanded or removed', () => {
    // An exact nonzero order is not zero, even when its double
    // approximation underflows to 0
    const tiny = ['Divide', 1, ['Power', 10, 400]];
    const d = ce.box(['D', 'f', ['Set', 'x', tiny]]);
    expect(d.json).toEqual(['D', 'f', ['Set', 'x', tiny]]);
    expect(d.operator).toBe('D');
    expect(d.evaluate().operator).toBe('D');
    // A symbolic order keeps the pair, even when the symbol has the value
    // 0: canonicalization does not read the value of a symbol
    const ce2 = new ComputeEngine();
    ce2.assign('n', 0);
    const e = ce2.box(['D', 'f', ['Set', 'x', 'n']]);
    expect(e.json).toEqual(['D', 'f', ['Set', 'x', 'n']]);
    // A non-integer literal order keeps the pair too
    expect(ce.box(['D', 'f', ['Set', 'x', 2.5]]).json).toEqual([
      'D',
      'f',
      ['Set', 'x', 2.5],
    ]);
  });

  test('the exponent of a first-order numerator is part of the differentiand', () => {
    expect(
      ce.parse('\\frac{\\partial f^{3}}{\\partial x}', { form: 'raw' }).json
    ).toEqual(['D', ['Power', 'f', 3], 'x']);
    expect(
      ce.parse('\\frac{\\partial x^{3}}{\\partial x}').evaluate().json
    ).toEqual(['Multiply', 3, ['Power', 'x', 2]]);
    // The exponent of a denominator variable is still its order
    expect(
      ce.parse('\\frac{\\partial^2 f}{\\partial x^{2}}', { form: 'raw' }).json
    ).toEqual(['D', 'f', 'x', 'x']);
  });

  test('a large order of the d spelling is one D with an order pair', () => {
    const raw = (latex: string) => ce.parse(latex, { form: 'raw' }).json;
    // Up to an order of 100, the d spelling is the nested form
    expect(raw('\\frac{d^2}{dx^2} \\sin(x)')).toEqual([
      'D',
      ['D', ['Sin', 'x'], 'x'],
      'x',
    ]);
    // Above it, one D with the order pair: an order of 1000 parses and
    // evaluates without a stack overflow
    expect(raw('\\frac{d^{101}}{dx^{101}} \\sin(x)')).toEqual([
      'D',
      ['Sin', 'x'],
      ['Set', 'x', 101],
    ]);
    const e = ce.parse('\\frac{d^{1000}}{dx^{1000}} \\sin(x)');
    expect(e.evaluate().json).toEqual(['Sin', 'x']);
    expect(
      ce.parse('\\frac{d^{101}}{dx^{101}} \\sin(x)').evaluate().json
    ).toEqual(['Cos', 'x']);
    // The pair with an order of 2 is the second derivative
    expect(
      ce.box(['D', ['Power', 'x', 3], ['Set', 'x', 2]]).evaluate().json
    ).toEqual(['Multiply', 6, 'x']);
  });

  test('a first-order partial serializes to Leibniz ∂ notation', () => {
    const expr = ce.box(['D', ['f', 'x', 'y'], 'x']).evaluate();
    expect(expr.latex).toBe('\\frac{\\partial}{\\partial x} f(x, y)');
  });

  test('a mixed partial serializes to Leibniz ∂ notation', () => {
    const expr = ce.box(['D', ['D', ['f', 'x', 'y'], 'x'], 'y']).evaluate();
    expect(expr.latex).toBe(
      '\\frac{\\partial^{2}}{\\partial x \\partial y} f(x, y)'
    );
  });

  test('partial derivative notation round-trips through LaTeX', () => {
    for (const j of [
      ['D', ['f', 'x', 'y'], 'x'],
      ['D', ['f', 'x', 'y'], 'y'],
      ['D', ['D', ['f', 'x', 'y'], 'x'], 'y'],
      ['D', ['D', ['f', 'x', 'y'], 'x'], 'x'],
    ] as const) {
      const evaluated = ce.box(j).evaluate();
      const reparsed = ce.parse(evaluated.latex).evaluate();
      expect(reparsed.isSame(evaluated)).toBe(true);
    }
  });

  test('the multi-index Derivative operator serializes as f^{(1,0)}', () => {
    expect(ce.box(['Derivative', 'f', 1, 0]).latex).toBe('f^{(1, 0)}');
    expect(ce.box(['Derivative', 'f', 2, 1]).latex).toBe('f^{(2, 1)}');
  });
});
