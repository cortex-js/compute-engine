import { Expression } from '../../../src/math-json';
import { engine } from '../../utils';

function json(latex: string): Expression {
  return engine.parse(latex)?.json ?? '';
}
describe('INTEGRAL', () => {
  test('simple with no index', () => {
    expect(json('\\int\\sin x + 1 = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Add", 1, ["Sin", "x"]],
          ["Error", ["ErrorCode", "'missing'", ["Union", "Tuple", "Symbol"]]]
        ],
        2
      ]
    `);
  });

  test('simple with d', () => {
    expect(json('\\int\\sin x \\mathrm{d} x+1 = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Add",
          [
            "Integrate",
            ["Lambda", ["Add", ["Sin", "_"]]],
            [
              "Error",
              [
                "ErrorCode",
                "'incompatible-domain'",
                ["Domain", ["Union"]],
                ["Domain", "ExtendedRealNumber"]
              ],
              "x"
            ]
          ],
          1
        ],
        2
      ]
    `);
  });
  test('simple with mathrm', () => {
    expect(json('\\int\\sin x dx+1 = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Add",
          [
            "Integrate",
            ["Lambda", ["Add", ["Sin", "_"]]],
            [
              "Error",
              [
                "ErrorCode",
                "'incompatible-domain'",
                ["Domain", ["Union"]],
                ["Domain", "ExtendedRealNumber"]
              ],
              "x"
            ]
          ],
          1
        ],
        2
      ]
    `);
  });

  test('simple with \\alpha', () => {
    expect(json('\\int\\alpha d\\alpha+1 = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Add",
          [
            "Integrate",
            ["Lambda", "_"],
            [
              "Error",
              [
                "ErrorCode",
                "'incompatible-domain'",
                ["Domain", ["Union"]],
                ["Domain", "ExtendedRealNumber"]
              ],
              "Alpha"
            ]
          ],
          1
        ],
        2
      ]
    `);
  });

  test('simple with mathrm with spacing', () => {
    expect(json('\\int\\sin x \\, \\mathrm{d}x+1 = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Add",
          [
            "Integrate",
            [
              "Lambda",
              ["Add", ["Sin", ["Multiply", "_", ["HorizontalSpacing", 3]]]]
            ],
            [
              "Error",
              [
                "ErrorCode",
                "'incompatible-domain'",
                ["Domain", ["Union"]],
                ["Domain", "ExtendedRealNumber"]
              ],
              "x"
            ]
          ],
          1
        ],
        2
      ]
    `);
  });

  test('simple with lower bound', () => {
    expect(json('\\int_0\\sin x \\, \\mathrm{d}x+1 = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Add",
          [
            "Integrate",
            [
              "Lambda",
              ["Add", ["Sin", ["Multiply", "_", ["HorizontalSpacing", 3]]]]
            ],
            [
              "Error",
              [
                "ErrorCode",
                "'incompatible-domain'",
                ["Domain", ["Union"]],
                ["Domain", "ExtendedRealNumber"]
              ],
              "x"
            ]
          ],
          1
        ],
        2
      ]
    `);
  });

  test('simple with upper bound', () => {
    expect(json('\\int^\\infty\\sin x \\, \\mathrm{d}x+1 = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Add",
          1,
          [
            "Integrate",
            [
              "Lambda",
              ["Add", ["Sin", ["Multiply", "_", ["HorizontalSpacing", 3]]]]
            ],
            ["Triple", "x", "Nothing", {num: "+Infinity"}]
          ]
        ]
      ]
    `);
  });
  test('simple with lower and upper bound', () => {
    expect(json('\\int^\\infty_0\\sin x \\, \\mathrm{d}x+1 = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Add",
          1,
          [
            "Integrate",
            [
              "Lambda",
              ["Add", ["Sin", ["Multiply", "_", ["HorizontalSpacing", 3]]]]
            ],
            ["Triple", "x", 0, {num: "+Infinity"}]
          ]
        ]
      ]
    `);
  });

  test('simple with lower and upper bound and no index', () =>
    expect(json('\\int^\\infty_0\\sin x +1 = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Integrate",
          ["Add", 1, ["Sin", "x"]],
          ["Triple", "Nothing", 0, {num: "+Infinity"}]
        ]
      ]
    `));

  test('with dx in frac', () =>
    expect(json('\\int^\\infty_0\\frac{3xdx}{5} = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Integrate",
          ["Lambda", ["Divide", ["Multiply", 3, "_"], 5]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ]
      ]
    `));

  test('with \\mathrm{d}x in frac', () =>
    expect(json('\\int^\\infty_0\\frac{3x\\mathrm{d}x}{5} = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Integrate",
          ["Lambda", ["Divide", ["Multiply", 3, "_"], 5]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ]
      ]
    `));

  test('INVALID with dx in frac denom', () =>
    expect(json('\\int^\\infty_0\\frac{3x}{5dx} = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Integrate",
          [
            "Divide",
            ["Multiply", ["Rational", 3, 5], "x"],
            ["Multiply", "d", "x"]
          ],
          ["Triple", "Nothing", 0, {num: "+Infinity"}]
        ]
      ]
    `));

  test('with dx in addition', () =>
    expect(json('\\int^\\infty_03x+kxdx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Integrate",
          ["Lambda", ["Add", ["Multiply", 3, "_"], ["Multiply", "k", "_"]]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ]
      ]
    `));

  test('with dx in negate', () =>
    expect(json('\\int^\\infty_0-xdx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Integrate",
          ["Lambda", ["Negate", "_"]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ]
      ]
    `));

  test('with dx in delimiter', () =>
    expect(json('\\int^\\infty_0(3x+x^2dx) = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Integrate",
          [
            "Lambda",
            ["Delimiter", ["Add", ["Multiply", 3, "_"], ["Power", "_", 2]]]
          ],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ]
      ]
    `));

  test('with dx AFTER delimiter', () =>
    expect(json('\\int^\\infty_0(3x+x^2)dx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Integrate",
          [
            "Lambda",
            ["Delimiter", ["Add", ["Multiply", 3, "_"], ["Power", "_", 2]]]
          ],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ]
      ]
    `));

  test('with dx after trig', () =>
    expect(json('\\int^\\infty_0\\sin x dx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        2,
        [
          "Integrate",
          ["Lambda", ["Sin", "_"]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ]
      ]
    `));
});
