import { parse } from '../../utils';

describe('STEFNOTCH #9', () => {
  test('\\int_{\\placeholder{⬚}}^{\\placeholder{⬚}}3x', () => {
    expect(parse('\\int_{\\placeholder{⬚}}^{\\placeholder{⬚}}3x'))
      .toMatchInlineSnapshot(`
      '[
        "Error",
        ["Integral", "", "Nothing", "Nothing"],
        "'syntax-error'",
        ["LatexForm", "'{\\\\placeholder{⬚}}^{\\\\placeholder{⬚}}3x'"]
      ]'
    `);
  });
});

describe('STEFNOTCH #10', () => {
  test('1/ \\displaystyle \\left(\\sin^{-1}\\mleft(x\\mright)\\right)^{\\prime}', () => {
    expect(
      parse(
        '\\displaystyle \\left(\\sin^{-1}\\mleft(x\\mright)\\right)^{\\prime}'
      )
    ).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Error", "Nothing", "'unknown-command'", ["LatexForm", "'\\\\left'"]],
        "'syntax-error'",
        ["LatexForm", "'(\\\\sin^{-1}\\\\mleft(x\\\\mright)\\\\right)^{\\\\prime}'"]
      ]'
    `);
  });

  test('2/ 1^{\\sin(x)}', () => {
    expect(parse('1^{\\sin(x)}')).toMatchInlineSnapshot(
      `'["Power", 1, ["Sin", "x"]]'`
    );
  });

  test('3/ 3\\text{hello}6', () => {
    expect(parse('3\\text{hello}6')).toMatchInlineSnapshot(
      `'["Error", 3, "'syntax-error'", ["LatexForm", "'\\\\text{hello}6'"]]'`
    );
  });

  test('4/ \\color{red}3', () => {
    expect(parse('\\color{red}3')).toMatchInlineSnapshot(`
      '[
        "Error",
        [
          "Error",
          "Nothing",
          "'unknown-command'",
          ["LatexForm", "'\\\\color{red}'"]
        ],
        "'syntax-error'",
        ["LatexForm", "'3'"]
      ]'
    `);
  });

  test('5/ \\ln(3)', () => {
    expect(parse('\\ln(3)')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Error", "Nothing", "'unknown-command'", ["LatexForm", "'\\\\ln'"]],
        "'syntax-error'",
        ["LatexForm", "'(3)'"]
      ]'
    `);
  });

  test('6/ f:[a,b]\\to R', () => {
    expect(parse('f:[a,b]\\to R ')).toMatchInlineSnapshot(
      `'["Error", "f", "'syntax-error'", ["LatexForm", "':[a,b]\\\\to R '"]]'`
    );
  });

  test('7/ \\lim_{n\\to\\infin}3', () => {
    expect(parse('\\lim_{n\\to\\infin}3')).toMatchInlineSnapshot(`
      '[
        "Error",
        [
          "Subscript",
          ["Error", "Nothing", "'unknown-command'", ["LatexForm", "'\\\\lim'"]],
          [
            "To",
            "n",
            [
              "Error",
              "Nothing",
              "'unknown-command'",
              ["LatexForm", "'\\\\infin'"]
            ]
          ]
        ],
        "'syntax-error'",
        ["LatexForm", "'3'"]
      ]'
    `);
  });

  test.skip('8/ \\begin{cases} 3 & x < 5 \\ 7 & else \\end{cases}', () => {
    expect(
      parse('\\begin{cases} 3 & x < 5 \\ 7 & else \\end{cases}')
    ).toMatchInlineSnapshot();
  });
});

describe('STEFNOTCH #12', () => {
  test('1/ e^{i\\pi\\text{nope!?\\lparen sum}}', () => {
    expect(parse('e^{i\\pi\\text{nope!?\\lparen sum}}')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Power", "ExponentialE", "Nothing"],
        "'syntax-error'",
        ["LatexForm", "'{i\\\\pi\\\\text{nope!?\\\\lparen sum}}'"]
      ]'
    `);
  });
});

describe('STEFNOTCH #13', () => {
  test('1/ N(\\varepsilon)\\coloneq\\lceil\\frac{4}{\\varepsilon^2}\\rceil', () => {
    expect(
      parse('N(\\varepsilon)\\coloneq\\lceil\\frac{4}{\\varepsilon^2}\\rceil')
    ).toMatchInlineSnapshot(`
      '[
        "Error",
        [
          "Assign",
          ["Multiply", "N", ["Delimiter", "EpsilonSymbol"]],
          [
            "Error",
            "Nothing",
            "'unknown-command'",
            ["LatexForm", "'\\\\lceil'"]
          ]
        ],
        "'syntax-error'",
        ["LatexForm", "'\\\\frac{4}{\\\\varepsilon^2}\\\\rceil'"]
      ]'
    `);
  });

  test('2/ x_{1,2}=1,2', () => {
    expect(parse('x_{1,2}=1,2')).toMatch(
      '["Sequence", ["Equal", ["Subscript", "x", ["Sequence", 1, 2]], 1], 2]'
    );
  });

  test('3/  \\{1,2\\}', () => {
    expect(parse('\\{1,2\\}')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Error", "Nothing", "'unknown-command'", ["LatexForm", "'\\\\{'"]],
        "'syntax-error'",
        ["LatexForm", "'1,2\\\\}'"]
      ]'
    `);
  });

  test('4/ [1,2]', () => {
    expect(parse('[1,2]')).toMatchInlineSnapshot(
      `'["Error", "Nothing", "'syntax-error'", ["LatexForm", "'[1,2]'"]]'`
    );
  });

  test('5/ \\frac{2}{\\sqrt{n}}\\Leftrightarrow n>\\frac{5}{n^2}', () => {
    expect(parse('\\frac{2}{\\sqrt{n}}\\Leftrightarrow n>\\frac{5}{n^2}'))
      .toMatchInlineSnapshot(`
      '[
        "Error",
        ["Divide", 2, ["Sqrt", "n"]],
        "'syntax-error'",
        ["LatexForm", "'\\\\Leftrightarrow n>\\\\frac{5}{n^2}'"]
      ]'
    `);
  });

  test('6/ |a_n|\\le\\frac{2}{\\sqrt{n}}\\Rightarrow a_n\\to0=0', () => {
    expect(parse('|a_n|\\le\\frac{2}{\\sqrt{n}}\\Rightarrow a_n\\to0=0'))
      .toMatchInlineSnapshot(`
      '[
        "Error",
        "Nothing",
        "'syntax-error'",
        [
          "LatexForm",
          "'|a_n|\\\\le\\\\frac{2}{\\\\sqrt{n}}\\\\Rightarrow a_n\\\\to0=0'"
        ]
      ]'
    `);
  });

  test('7/ 3\\equiv5\\mod7', () => {
    expect(parse('3\\equiv5\\mod7')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Equivalent", 3, 5],
        "'syntax-error'",
        ["LatexForm", "'\\\\mod7'"]
      ]'
    `);
  });

  test('8/ a={displaystyle lim_{n\toinfin}a_n}', () => {
    expect(parse('a={displaystyle lim_{n\toinfin}a_n}')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Equal", "a", "Missing"],
        "'syntax-error'",
        ["LatexForm", "'{displaystyle lim_{n oinfin}a_n}'"]
      ]'
    `);
  });

  test('9/  \\forall x\\in\\C^2:|x|<0', () => {
    expect(parse('\\forall x\\in\\C^2:|x|<0')).toMatchInlineSnapshot(`
      '[
        "Error",
        [
          "Error",
          "Nothing",
          "'unknown-command'",
          ["LatexForm", "'\\\\forall'"]
        ],
        "'syntax-error'",
        ["LatexForm", "'x\\\\in\\\\C^2:|x|<0'"]
      ]'
    `);
  });

  test('10/ \\forall n\\colon a_n\\le c_n\\le b_n\\implies\\lim_{n\\to\\infin}c_n=a', () => {
    expect(
      parse(
        '\\forall n\\colon a_n\\le c_n\\le b_n\\implies\\lim_{n\\to\\infin}c_n=a'
      )
    ).toMatchInlineSnapshot(`
      '[
        "Error",
        [
          "Error",
          "Nothing",
          "'unknown-command'",
          ["LatexForm", "'\\\\forall'"]
        ],
        "'syntax-error'",
        [
          "LatexForm",
          "'n\\\\colon a_n\\\\le c_n\\\\le b_n\\\\implies\\\\lim_{n\\\\to\\\\infin}c_n=a'"
        ]
      ]'
    `);
  });
});
