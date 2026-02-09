import { engine as ce, latex } from '../../utils';

describe('LATEX SERIALIZING', () => {
  test('Numbers', () => {
    expect(latex(1)).toMatch('1');
    expect(latex(+1)).toMatch('1');
    expect(latex(-123)).toMatch('-123');
    expect(latex(-1234567.89)).toMatch('-1\\,234\\,567.89');
    expect(latex(-1234567.89e-123)).toMatchInlineSnapshot(
      `-123\\,456\\,789\\cdot10^{-125}`
    );
    expect(ce.box({ num: '-1234567.890e-123' })).toMatchInlineSnapshot(
      `-1.23456789e-117`
    );

    // Should remove fractional part. Avoid exponent in range [-7, 20]
    expect(latex('-1234567.89e10')).toMatchInlineSnapshot(
      `-12\\,345\\,678\\,900\\,000\\,000`
    );
    // Keep exponent...
    expect(latex('-1234567.89e23')).toMatchInlineSnapshot(
      `-123\\,456\\,789\\cdot10^{21}`
    );

    // Should not `1\\times` as `1\\times10^{199}`
    expect(latex({ num: '1e199' })).toMatchInlineSnapshot(`10^{199}`);
    // Should not `-1\\times` as `-1\\times10^{-199}`
    expect(latex({ num: '-1e-199' })).toMatchInlineSnapshot(`-10^{-199}`);
    expect(
      latex({ num: '-123456789012345678901234567890.890e-123' })
    ).toMatchInlineSnapshot(
      `-12\\,345\\,678\\,901\\,234\\,567\\,890\\,123\\,456\\,789\\,089\\cdot10^{-125}`
    );
    expect(latex({ num: '+Infinity' })).toMatchInlineSnapshot(`\\infty`);
    expect(latex({ num: '-Infinity' })).toMatchInlineSnapshot(`-\\infty`);
    expect(latex({ num: 'NaN' })).toMatchInlineSnapshot(`\\operatorname{NaN}`);
    expect(latex({ num: 'Infinity' })).toMatchInlineSnapshot(`\\infty`);

    // Repeating pattern
    expect(
      latex({ num: '3.123456785678567856785678567856785678' })
    ).toMatchInlineSnapshot(`3.123\\,4\\overline{5678}`);

    expect(
      latex({ num: '0.1234567872368237462387623876' })
    ).toMatchInlineSnapshot(
      `0.123\\,456\\,787\\,236\\,823\\,746\\,238\\,762\\,387\\,6`
    );

    expect(ce.parse('  - 1 2')).toMatchInlineSnapshot(`-12`);
    expect(ce.parse('-123\\,456.789\\,012')).toMatchInlineSnapshot(
      `-123456.789012`
    );
    expect(ce.parse('-1\\,23456.7890\\,12')).toMatchInlineSnapshot(
      `-123456.789012`
    );
  });

  test('Complex Numbers', () => {
    expect(latex(['Complex', 1, 2])).toMatchInlineSnapshot(`1+2\\imaginaryI`);
    expect(latex(['Complex', 1, 0])).toMatchInlineSnapshot(`1`);
    expect(latex(['Complex', 0, 1])).toMatchInlineSnapshot(`\\imaginaryI`);
    expect(latex(['Complex', 2.345, 7.689])).toMatchInlineSnapshot(
      `2.345+7.689\\imaginaryI`
    );
  });

  // Leave space between pi and x
  test('Spacing', () => {
    expect(latex(['Multiply', 'Pi', 'x'])).toMatchInlineSnapshot(`\\pi x`);
  });

  test('Symbols', () => {
    expect(latex('x')).toMatchInlineSnapshot(`x`);
    expect(latex('symbol')).toMatchInlineSnapshot(`\\mathrm{symbol}`);
    expect(latex({ sym: 'x' })).toMatchInlineSnapshot(`x`);
    expect(latex({ sym: 'symbol' })).toMatchInlineSnapshot(`\\mathrm{symbol}`);
  });

  test('Functions', () => {
    expect(latex(['f', 'x', 1, 0])).toMatchInlineSnapshot(`f(x, 1, 0)`);
    expect(latex(['foo', 'x', 1, 0])).toMatchInlineSnapshot(
      `\\mathrm{foo}(x, 1, 0)`
    );
    expect(latex(['Divide', 'n', 4])).toMatchInlineSnapshot(`\\frac{n}{4}`);

    expect(ce.parse('\\foo[0]{1}{2}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Error", "unexpected-command", ["LatexString", "\\foo"]],
        ["Error", "unexpected-operator", ["LatexString", "["]]
      ]
    `);
  });

  test('Basic operations', () => {
    expect(latex(['Add', 'a', 'b'])).toMatchInlineSnapshot(`a+b`);
    // Invisible operator
    expect(latex(['Multiply', 'a', 'b'])).toMatchInlineSnapshot(`ab`);
    expect(
      latex(['Multiply', ['Add', 'x', 1], ['Subtract', 'x', 1]])
    ).toMatchInlineSnapshot(`(x-1)(x+1)`);
    expect(
      latex(['Add', ['Multiply', 'x', -1], ['Multiply', 'x', 2]])
    ).toMatchInlineSnapshot(`2x-x`);
    expect(latex(['Subtract', ['Negate', 'x'], -1])).toMatchInlineSnapshot(
      `1-x`
    );
  });
  test('Power', () => {
    expect(latex(['Power', 'x', -2])).toMatchInlineSnapshot(`\\frac{1}{x^2}`);
    expect(latex(['Power', -2, 2])).toMatchInlineSnapshot(`(-2)^2`);
    expect(latex(['Power', ['Negate', 2], 2])).toMatchInlineSnapshot(`(-2)^2`);
    expect(latex(['Negate', ['Power', 2, 2]])).toMatchInlineSnapshot(`-2^2`);
    expect(latex(['Power', 'x', ['Divide', 1, 2]])).toMatchInlineSnapshot(
      `\\sqrt{x}`
    );
    expect(
      latex(['Power', ['Add', 'x', 1], ['Divide', 1, 2]])
    ).toMatchInlineSnapshot(`\\sqrt{x+1}`);
    expect(
      latex(['Power', ['Multiply', 2, 'x'], ['Divide', 1, 2]])
    ).toMatchInlineSnapshot(`\\sqrt{2x}`);
    expect(
      latex(['Power', ['Multiply', 2, 'x'], ['Subtract', 1, 'n']])
    ).toMatchInlineSnapshot(`(2x)^{1-n}`);
  });
  test('Missing', () => {
    expect(
      latex(['Equal', ['Multiply', 2, 2], ['Error', "'missing'"]])
    ).toMatchInlineSnapshot(`4=\\error{\\blacksquare}`);
  });

  test('Integral', () => {
    expect(
      latex(['Integrate', 'x', ['Tuple', 'x', 1, 8]])
    ).toMatchInlineSnapshot(`\\int_{1}^{8}\\!x\\, \\mathrm{d}x`);
    expect(latex(['Integrate', ['Sin', 'x'], 'x'])).toMatchInlineSnapshot(
      `\\int\\!\\sin(x)\\, \\mathrm{d}x`
    );
  });

  test('Big operators', () => {
    expect(ce.parse('\\sum_{k=0}^{100}k').toLatex()).toMatchInlineSnapshot(
      `\\sum_{k=0}^{100}k`
    );
    expect(ce.parse('\\prod_{i=1}^{n}i').toLatex()).toMatchInlineSnapshot(
      `\\prod_{i=1}^{n}i`
    );
  });
});

describe('CUSTOM LATEX SERIALIZING', () => {
  test('Prettify', () => {
    const expr = ce.parse('\\frac{a}{b}\\frac{c}{d}');
    expect(expr.toLatex({ prettify: true })).toMatchInlineSnapshot(
      `\\frac{ac}{bd}`
    );
    expect(expr.toLatex({ prettify: false })).toMatchInlineSnapshot(
      `\\frac{a}{b}\\frac{c}{d}`
    );

    //@todo: remaining cases
  });

  test('Invisible Multiply', () => {
    const expr = ce.parse('2x');
    expect(
      expr.toLatex({ invisibleMultiply: `#1 \\otimes #2` })
    ).toMatchInlineSnapshot(`2\\otimes x`);
    expect(
      expr.toLatex({ invisibleMultiply: `\\otimes` })
    ).toMatchInlineSnapshot(`2\\otimes x`);
  });

  test('Invisible Plus', () => {
    const expr = ce.parse('2\\frac{1}{2}');
    expect(
      expr.toLatex({ invisiblePlus: `#1 \\oplus #2` })
    ).toMatchInlineSnapshot(`2\\oplus\\frac{1}{2}`);
    expect(expr.toLatex({ invisiblePlus: `\\oplus` })).toMatchInlineSnapshot(
      `2\\oplus\\frac{1}{2}`
    );
  });

  test('Custom Multiply', () => {
    const expr = ce.box(3.123e-200);
    expect(expr.toLatex({ exponentProduct: `\\otimes` })).toMatchInlineSnapshot(
      `3\\,123\\otimes10^{-203}`
    );

    // Multiply of two numbers
    expect(
      ce.box(['Multiply', 5, 7]).toLatex({ multiply: `\\otimes` })
    ).toMatchInlineSnapshot(`35`);

    // Multiply of a number and a rational
    expect(
      ce
        .box(['Multiply', 5, ['Rational', 3, 4]])
        .toLatex({ multiply: `\\otimes` })
    ).toMatchInlineSnapshot(`\\frac{15}{4}`);
  });

  test('Numbers', () => {
    expect(
      ce.box(1.2345678912345).toLatex({ fractionalDigits: 6 })
    ).toMatchInlineSnapshot(`1.234\\,567\\ldots`);
  });
});

describe('LATEX', () => {
  test('Valid LatexString', () => {
    expect(
      ce.box(['LatexString', "'\\sqrt{x}'"]).evaluate().json
    ).toMatchInlineSnapshot(`'\\sqrt{x}'`);
  });

  test('INVALID LatexString', () => {
    expect(ce.box(['LatexString']).evaluate().json).toMatchInlineSnapshot(`
      [
        LatexString,
        [
          Error,
          missing,
        ],
      ]
    `);
    expect(ce.box(['LatexString', 22]).evaluate().json).toMatchInlineSnapshot(`
      [
        LatexString,
        [
          Error,
          [
            ErrorCode,
            'incompatible-type',
            string,
            finite_integer,
          ],
        ],
      ]
    `);
    expect(ce.box(['LatexString', "'\\sqrt{x}'", "'+1'"]).evaluate().json)
      .toMatchInlineSnapshot(`
      [
        LatexString,
        '\\sqrt{x}',
        [
          Error,
          'unexpected-argument',
          '"+1"',
        ],
      ]
    `);
  });

  test('Valid ParseLatex', () => {
    expect(ce.box(['Parse']).evaluate().json).toMatchInlineSnapshot(`
      [
        Parse,
        [
          Error,
          missing,
        ],
      ]
    `);
    expect(ce.box(['Parse', "'\\frac{2}{\\cos x}'"]).evaluate().json)
      .toMatchInlineSnapshot(`
      [
        Divide,
        2,
        [
          Cos,
          x,
        ],
      ]
    `);
  });

  test('Invalid ParseLatex', () => {
    expect(ce.box(['Parse', ['Add', 2, 'Pi']]).evaluate().json)
      .toMatchInlineSnapshot(`
      [
        Parse,
        [
          Error,
          [
            ErrorCode,
            'incompatible-type',
            string,
            finite_real,
          ],
        ],
      ]
    `);
  });
});

// Issue #130: Prefix/postfix operators should wrap lower-precedence operands
describe('PREFIX/POSTFIX OPERATOR SERIALIZATION', () => {
  test('Issue #130: Negate with Add operand', () => {
    // -(2√3 - 1) should serialize with parentheses, not as -2√3 - 1
    const expr = ce.parse('-(2\\sqrt3-1)');
    expect(expr.latex).toMatchInlineSnapshot(`-(2\\sqrt{3}-1)`);

    // Verify round-trip: parsing the output should give equivalent expression
    const reparsed = ce.parse(expr.latex);
    expect(expr.N().re).toBeCloseTo(reparsed.N().re as number);
  });

  test('Issue #130: Simple expression ordering', () => {
    // 2√3 + 1 - order may change but should be mathematically equivalent
    const expr = ce.parse('2\\sqrt3+1');
    expect(expr.latex).toMatchInlineSnapshot(`1+2\\sqrt{3}`);
  });

  test('Negate with Add operand - symbolic', () => {
    expect(latex(['Negate', ['Add', 'a', 'b']])).toMatchInlineSnapshot(
      `-(a+b)`
    );
    expect(latex(['Negate', ['Add', 'x', 1]])).toMatchInlineSnapshot(`-(x+1)`);
    expect(latex(['Negate', ['Subtract', 'a', 'b']])).toMatchInlineSnapshot(
      `-(a-b)`
    );
  });

  test('Factorial with Add operand', () => {
    expect(latex(['Factorial', ['Add', 'n', 1]])).toMatchInlineSnapshot(
      `(n+1)!`
    );
    expect(latex(['Factorial', ['Add', 'a', 'b']])).toMatchInlineSnapshot(
      `(a+b)!`
    );
  });

  test('Nested negations are canonicalized', () => {
    // Note: nested negations are simplified in canonical form
    // Negate(Negate(x)) -> x
    expect(latex(['Negate', ['Negate', 'x']])).toMatchInlineSnapshot(`x`);
    // Negate(Negate(Negate(x))) -> Negate(x) -> -x
    expect(
      latex(['Negate', ['Negate', ['Negate', 'x']]])
    ).toMatchInlineSnapshot(`-x`);
  });

  test('Mixed prefix and postfix', () => {
    // -(n!) - negate a factorial
    expect(latex(['Negate', ['Factorial', 'n']])).toMatchInlineSnapshot(`-n!`);
    // (-n)! - factorial of a negation
    expect(latex(['Factorial', ['Negate', 'n']])).toMatchInlineSnapshot(
      `(-n)!`
    );
  });

  test('Prefix operators with Multiply operand', () => {
    // Negate(Multiply(a,b)) -> -(ab) - parentheses added, but round-trips correctly
    // since -ab also parses to Negate(Multiply(a,b))
    expect(latex(['Negate', ['Multiply', 'a', 'b']])).toMatchInlineSnapshot(
      `-(ab)`
    );
    expect(latex(['Factorial', ['Multiply', 'a', 'b']])).toMatchInlineSnapshot(
      `(ab)!`
    );
  });

  test('Round-trip verification', () => {
    // These expressions should round-trip correctly
    const testCases = [
      ['Negate', ['Add', 'x', 1]],
      ['Negate', ['Add', -1, ['Multiply', 2, ['Sqrt', 3]]]],
      ['Factorial', ['Add', 'n', 1]],
    ];

    for (const expr of testCases) {
      const boxed = ce.box(expr as any);
      const serialized = boxed.latex;
      const reparsed = ce.parse(serialized);
      expect(boxed.isEqual(reparsed)).toBe(true);
    }
  });
});
