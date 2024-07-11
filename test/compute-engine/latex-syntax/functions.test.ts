import { engine as ce } from '../../utils';

function parse(s: string) {
  return ce.parse(s);
}

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
    expect(parse("f'()")).toMatchInlineSnapshot(
      `["Apply", ["Derivative", "f"]]`
    ));
  test('\\prime', () =>
    expect(parse('f\\prime()')).toMatchInlineSnapshot(
      `["Apply", ["Derivative", "f"]]`
    ));
  test('^\\prime', () =>
    expect(parse('f\\prime()')).toMatchInlineSnapshot(
      `["Apply", ["Derivative", "f"]]`
    ));
  test('^\\prime', () =>
    expect(parse('f^\\prime()')).toMatchInlineSnapshot(
      `["Apply", ["Derivative", "f"]]`
    ));
  test('^{\\prime}', () =>
    expect(parse('f^{\\prime}()')).toMatchInlineSnapshot(
      `["Apply", ["Derivative", "f"]]`
    ));
  test("f''", () =>
    expect(parse("f''()")).toMatchInlineSnapshot(
      `["Apply", ["Derivative", "f", 2]]`
    ));
  test('f\\doubleprime', () =>
    expect(parse('f\\doubleprime()')).toMatchInlineSnapshot(
      `["Apply", ["Derivative", "f", 2]]`
    ));
  test('f^{\\doubleprime}', () =>
    expect(parse('f^{\\doubleprime}()')).toMatchInlineSnapshot(
      `["Apply", ["Derivative", "f", 2]]`
    ));
});

describe('Anonymous functions, no arg', () => {
  test('no args with parens', () =>
    expect(parse('()\\mapsto 2')).toMatchInlineSnapshot(`2`));
});

describe('Anonymous functions, single arg', () => {
  test('Single arg no delims', () =>
    expect(parse('x\\mapsto x')).toMatchInlineSnapshot(
      `["Function", "x", "x"]`
    ));
  test('Single arg regular parens', () =>
    expect(parse('(x)\\mapsto x')).toMatchInlineSnapshot(
      `["Function", "x", "x"]`
    ));
  test('Single arg leftright', () =>
    expect(parse('\\left(x\\right)\\mapsto x')).toMatchInlineSnapshot(
      `["Function", "x", "x"]`
    ));
});

describe('Anonymous functions, anon params arg', () => {
  test('Single arg no delims', () =>
    expect(parse('()\\mapsto \\_')).toMatchInlineSnapshot(
      `["Function", "_1", "_1"]`
    ));
  test('Multiple arg', () =>
    expect(
      parse('()\\mapsto \\_ + \\operatorname{\\_2}')
    ).toMatchInlineSnapshot(`["Function", ["Add", "_1", "_2"], "_1", "_2"]`));
});

describe('Anonymous functions, multiple args', () => {
  test('Multiple args', () =>
    expect(parse('(x, y) \\mapsto x + y')).toMatchInlineSnapshot(
      `["Function", ["Add", "x", "y"], "x", "y"]`
    ));
  test('Multiple args', () =>
    expect(parse('\\left(x\\right)\\mapsto x + y')).toMatchInlineSnapshot(
      `["Function", ["Add", "x", "y"], "x"]`
    ));
});

describe('Invalid', () => {
  test('Parens around arguments required', () =>
    expect(parse('x, y\\mapsto x + y')).toMatchInlineSnapshot(
      `["Pair", "x", ["Function", ["Add", "x", "y"], "y"]]`
    ));
});
