import { parse } from '../../utils';

describe('STEFNOTCH #9', () => {
  test('\\int_{\\placeholder{⬚}}^{\\placeholder{⬚}}3x', () => {
    expect(
      parse('\\int_{\\placeholder{⬚}}^{\\placeholder{⬚}}3x')
    ).toMatchInlineSnapshot(`["Integrate", ["Multiply", 3, "x"], "Nothing"]`);
  });
});

describe('STEFNOTCH #10', () => {
  test('1/ \\displaystyle \\left(\\sin^{-1}\\mleft(x\\mright)\\right)^{\\prime}', () => {
    expect(
      parse(
        '\\displaystyle \\left(\\sin^{-1}\\mleft(x\\mright)\\right)^{\\prime}'
      )
    ).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "'expected-close-delimiter'", "'\\right)'"],
        ["Latex", "'\\left('"]
      ]
    `);
  });

  test('2/ 1^{\\sin(x)}', () => {
    expect(parse('1^{\\sin(x)}')).toMatchInlineSnapshot(
      `["Power", 1, ["Sin", "x"]]`
    );
  });

  test('3/ 3\\text{hello}6', () => {
    expect(parse('3\\text{hello}6')).toMatchInlineSnapshot(
      `["Sequence", 3, "'hello'", 6]`
    );
  });

  test('4/ \\color{red}3', () => {
    expect(parse('\\color{red}3')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\color'"],
          ["Latex", "'\\color{red}'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'3'"],
          ["Latex", "'3'"]
        ]
      ]
    `);
  });

  test('5/ \\ln(3)', () => {
    expect(parse('\\ln(3)')).toMatchInlineSnapshot(`["Ln", 3]`);
  });

  test('6/ f:[a,b]\\to R', () => {
    expect(parse('f:[a,b]\\to R ')).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["f"],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "':'"],
          ["Latex", "':[a,b]\\to R '"]
        ]
      ]
    `);
  });

  test('7/ \\lim_{n\\to\\infin}3', () => {
    expect(parse('\\lim_{n\\to\\infin}3')).toMatchInlineSnapshot(`
      [
        "Multiply",
        [
          "Subscript",
          [
            "Error",
            ["ErrorCode", "'unexpected-command'", "'\\lim'"],
            ["Latex", "'\\lim'"]
          ],
          [
            "To",
            "n",
            [
              "Error",
              ["ErrorCode", "'unexpected-command'", "'\\infin'"],
              ["Latex", "'\\infin'"]
            ]
          ]
        ],
        3
      ]
    `);
  });

  test('8/ \\begin{cases} 3 & x < 5 \\\\ 7 & \\text{else} \\end{cases}', () => {
    expect(
      parse('\\begin{cases} 3 & x < 5 \\\\ 7 & \\text{else} \\end{cases}')
    ).toMatchInlineSnapshot(`["Which", ["Less", "x", 5], 3, "True", 7]`);
  });
});

describe('STEFNOTCH #12', () => {
  test('1/ e^{i\\pi\\text{nope!?\\lparen sum}}', () => {
    expect(parse('e^{i\\pi\\text{nope!?\\lparen sum}}')).toMatchInlineSnapshot(`
      [
        "Power",
        "ExponentialE",
        "ImaginaryUnit",
        ["Error", "'unexpected-argument'", "Pi"],
        ["Error", "'unexpected-argument'", "'nope!?\\lparensum'"]
      ]
    `);
  });
});

describe('STEFNOTCH #13', () => {
  test('1/ N(\\varepsilon)\\coloneq\\lceil\\frac{4}{\\varepsilon^2}\\rceil', () => {
    expect(
      parse('N(\\varepsilon)\\coloneq\\lceil\\frac{4}{\\varepsilon^2}\\rceil')
    ).toMatchInlineSnapshot(`
      [
        "Assign",
        ["Multiply", "N", "epsilonSymbol"],
        ["Ceil", ["Divide", 4, ["Square", "epsilonSymbol"]]]
      ]
    `);
  });

  test('2/ x_{1,2}=1,2', () => {
    expect(parse('x_{1,2}=1,2')).toMatchInlineSnapshot(
      `["Sequence", ["Equal", ["Subscript", "x", ["Sequence", 1, 2]], 1], 2]`
    );
  }); // @fixme unclear what the right answer is

  test('3/  \\{1,2\\}', () => {
    expect(parse('\\{1,2\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["Latex", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["Latex", "'1,2\\}'"]
        ]
      ]
    `);
  });

  test('4/ [1,2]', () => {
    expect(parse('[1,2]')).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "'['"],
        ["Latex", "'[1,2]'"]
      ]
    `);
  });

  test('5/ \\frac{2}{\\sqrt{n}}\\Leftrightarrow n>\\frac{5}{n^2}', () => {
    expect(parse('\\frac{2}{\\sqrt{n}}\\Leftrightarrow n>\\frac{5}{n^2}'))
      .toMatchInlineSnapshot(`
      [
        "Greater",
        [
          "Sequence",
          ["Divide", 2, ["Sqrt", "n"]],
          [
            "Error",
            ["ErrorCode", "'unexpected-command'", "'\\Leftrightarrow'"],
            ["Latex", "'\\Leftrightarrow'"]
          ],
          "n"
        ],
        ["Divide", 5, ["Square", "n"]]
      ]
    `);
  });

  test('6/ |a_n|\\le\\frac{2}{\\sqrt{n}}\\Rightarrow a_n\\to0=0', () => {
    expect(parse('|a_n|\\le\\frac{2}{\\sqrt{n}}\\Rightarrow a_n\\to0=0'))
      .toMatchInlineSnapshot(`
      [
        "LessEqual",
        ["Abs", "a_n"],
        [
          "Equal",
          [
            "To",
            [
              "Sequence",
              ["Divide", 2, ["Sqrt", "n"]],
              [
                "Error",
                ["ErrorCode", "'unexpected-command'", "'\\Rightarrow'"],
                ["Latex", "'\\Rightarrow'"]
              ],
              "a_n"
            ],
            0
          ],
          0
        ]
      ]
    `);
  });

  test('7/ 3\\equiv5\\mod7', () => {
    expect(parse('3\\equiv5\\mod7')).toMatchInlineSnapshot(`
      [
        "Equivalent",
        3,
        [
          "Sequence",
          5,
          [
            "Error",
            ["ErrorCode", "'unexpected-command'", "'\\mod'"],
            ["Latex", "'\\mod'"]
          ],
          7
        ]
      ]
    `);
  });

  test('8/ a={displaystyle lim_{n\toinfin}a_n}', () => {
    expect(parse('a={\\displaystyle \\lim_{n\\to \\infty}a_n}'))
      .toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Equal",
          "a",
          ["Error", "'expected-expression'", ["Latex", "'{\\displaystyle'"]]
        ],
        [
          "Subscript",
          [
            "Error",
            ["ErrorCode", "'unexpected-command'", "'\\lim'"],
            ["Latex", "'\\lim'"]
          ],
          ["To", "n", {num: "+Infinity"}]
        ],
        "a_n",
        ["Error", "'unexpected-closing-delimiter'", ["Latex", "'}'"]]
      ]
    `);
  });

  test('9/  \\forall x\\in\\C^2:|x|<0', () => {
    expect(parse('\\forall x\\in\\C^2:|x|<0')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\forall'"],
          ["Latex", "'\\forall'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-identifier'", "x"],
          ["Latex", "'x'"]
        ]
      ]
    `);
  });

  test('10/ \\forall n\\colon a_n\\le c_n\\le b_n\\implies\\lim_{n\\to\\infin}c_n=a', () => {
    expect(
      parse(
        '\\forall n\\colon a_n\\le c_n\\le b_n\\implies\\lim_{n\\to\\infin}c_n=a'
      )
    ).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\forall'"],
          ["Latex", "'\\forall'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-identifier'", "n"],
          ["Latex", "'n'"]
        ]
      ]
    `);
  });
});
