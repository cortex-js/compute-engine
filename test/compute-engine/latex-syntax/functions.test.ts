import { parse } from '../../utils';

describe('Custom Function Parsing', () => {
  test('No arg list', () => expect(parse('f')).toMatchInlineSnapshot(`f`));
  test('Empty arg list', () =>
    expect(parse('f()')).toMatchInlineSnapshot(`["f"]`));
  test('Empty arg list', () =>
    expect(parse('f\\left(\\right)')).toMatchInlineSnapshot(`["f"]`));
  test('Single arg list', () =>
    expect(parse('f(1)')).toMatchInlineSnapshot(`["f", 1]`));
  test('Double arg list', () =>
    expect(parse('f\\left(1\\right)')).toMatchInlineSnapshot(`["f", 1]`));
  test('Double arg list', () =>
    expect(parse('f(1, 2)')).toMatchInlineSnapshot(`["f", 1, 2]`));
  test('Function of function', () =>
    expect(parse('f(1, \\sin(2))')).toMatchInlineSnapshot(
      `["f", 1, ["Sin", 2]]`
    ));
});

describe('Postfix operators: prime', () => {
  test('Single prime', () =>
    expect(parse("f'")).toMatchInlineSnapshot(`["Derivative", "f"]`));
  test('Single prime with arg', () =>
    expect(parse("f'()")).toMatchInlineSnapshot(`[["Derivative", "f"]]`));
  test('\\prime', () =>
    expect(parse('f\\prime()')).toMatchInlineSnapshot(`[["Derivative", "f"]]`));
  test('^\\prime', () =>
    expect(parse('f\\prime()')).toMatchInlineSnapshot(`[["Derivative", "f"]]`));
  test('^\\prime', () =>
    expect(parse('f^\\prime()')).toMatchInlineSnapshot(
      `[["Derivative", "f"]]`
    ));
  test('^{\\prime}', () =>
    expect(parse('f^{\\prime}()')).toMatchInlineSnapshot(
      `[["Derivative", "f"]]`
    ));
  test("f''", () =>
    expect(parse("f''()")).toMatchInlineSnapshot(`[["Derivative", "f", 2]]`));
  test('f\\doubleprime', () =>
    expect(parse('f\\doubleprime()')).toMatchInlineSnapshot(
      `[["Derivative", "f", 2]]`
    ));
  test('f^{\\doubleprime}', () =>
    expect(parse('f^{\\doubleprime}()')).toMatchInlineSnapshot(
      `[["Derivative", "f", 2]]`
    ));
});

describe('Anonymous functions, single arg', () => {
  test('Single arg', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
          ["LatexString", "'\\mapsto'"]
        ],
        "x"
      ]
    `));
  test('Single arg', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
          ["LatexString", "'\\mapsto'"]
        ],
        "x"
      ]
    `));
  test('Single arg', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
          ["LatexString", "'\\mapsto'"]
        ],
        "x"
      ]
    `));
  test('Single arg', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
          ["LatexString", "'\\mapsto'"]
        ],
        "x"
      ]
    `));
  test('Single arg', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
          ["LatexString", "'\\mapsto'"]
        ],
        "x"
      ]
    `));
  test('Single arg', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
          ["LatexString", "'\\mapsto'"]
        ],
        "x"
      ]
    `));
  test('Single arg', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
          ["LatexString", "'\\mapsto'"]
        ],
        "x"
      ]
    `));
  test('Single arg', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
          ["LatexString", "'\\mapsto'"]
        ],
        "x"
      ]
    `));
  test('Single arg', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(`
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
          ["LatexString", "'\\mapsto'"]
        ],
        "x"
      ]
    `));
});

describe('Anonymous functions, multiple args', () => {
  test('Multiple args', () =>
    expect(parse('x, y)\\mapsto x + y')).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Sequence", "x", "y"],
        [
          "Error",
          ["ErrorCode", "'expected-open-delimiter'", "'('"],
          ["LatexString", "')'"]
        ]
      ]
    `));
  test('Multiple args', () =>
    expect(parse('(x, y) \\mapsto x + y')).toMatchInlineSnapshot(`
      [
        "Add",
        [
          "Sequence",
          ["Sequence", "x", "y"],
          [
            "Error",
            ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
            ["LatexString", "'\\mapsto'"]
          ],
          "x"
        ],
        "y"
      ]
    `));
  test('Multiple args', () =>
    expect(parse('\\left(x\\right)\\mapsto x + y')).toMatchInlineSnapshot(`
      [
        "Add",
        [
          "Sequence",
          "x",
          [
            "Error",
            ["ErrorCode", "'unexpected-command'", "'\\mapsto'"],
            ["LatexString", "'\\mapsto'"]
          ],
          "x"
        ],
        "y"
      ]
    `));
});
