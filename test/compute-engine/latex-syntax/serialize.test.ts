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
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\foo'"],
        ["LatexString", "'\\foo[0]{1}{2}'"]
      ]
    `);

    // Head as expression
    expect(latex([['g', 'f'], 'x', 1, 0] as any)).toMatchInlineSnapshot(
      `\\operatorname{apply}(g(f), \\bigl\\lbrack x, 1, 0\\bigr\\rbrack)`
    );
  });

  test('Basic operations', () => {
    expect(latex(['Add', 'a', 'b'])).toMatchInlineSnapshot(`a+b`);
    // Invisible operator
    expect(latex(['Multiply', 'a', 'b'])).toMatchInlineSnapshot(`ab`);
    expect(
      latex(['Multiply', ['Add', 'x', 1], ['Subtract', 'x', 1]])
    ).toMatchInlineSnapshot(`(x+1)(x-1)`);
    expect(
      latex(['Add', ['Multiply', 'x', -1], ['Multiply', 'x', 2]])
    ).toMatchInlineSnapshot(`2x-x`);
    expect(latex(['Subtract', ['Negate', 'x'], -1])).toMatchInlineSnapshot(
      `1-x`
    );
  });
  test('Power', () => {
    expect(latex(['Power', 'x', -2])).toMatchInlineSnapshot(`\\frac{1}{x^2}`);
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
    ).toMatchInlineSnapshot(`2\\times2=\\error{\\blacksquare}`);
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
          'missing',
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
            'incompatible-domain',
            Strings,
            PositiveIntegers,
          ],
          22,
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
          '+1',
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
          'missing',
        ],
      ]
    `);
    expect(ce.box(['Parse', "'\\frac{2}{\\cos x}'"]).evaluate().json)
      .toMatchInlineSnapshot(`
      [
        Sequence,
      ]
    `);
  });

  test('Invalid ParseLatex', () => {
    expect(ce.box(['Parse', ['Add', 2, 'Pi']]).evaluate().json)
      .toMatchInlineSnapshot(`
      [
        Sequence,
      ]
    `);
  });
});
