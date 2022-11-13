import { Expression } from '../../../src/math-json';
import { engine } from '../../utils';

function json(latex: string): Expression {
  return engine.parse(latex)?.json ?? '';
}
describe('INTEGRAL', () => {
  test('simple with no index', () => {
    expect(json('\\int\\sin x + 1 = 2')).toMatchInlineSnapshot(
      `["Equal", ["Integrate", ["Add", ["Sin", "x"], 1], "Nothing"], 2]`
    );
  });

  test('simple with d', () => {
    expect(json('\\int\\sin x \\mathrm{d} x+1 = 2')).toMatchInlineSnapshot(
      `["Equal", ["Add", 1, ["Integrate", ["Sin", "x"], "x"]], 2]`
    );
  });
  test('simple with mathrm', () => {
    expect(json('\\int\\sin x dx+1 = 2')).toMatchInlineSnapshot(
      `["Equal", ["Add", 1, ["Integrate", ["Sin", "x"], "x"]], 2]`
    );
  });

  test('simple with \\alpha', () => {
    expect(json('\\int\\alpha d\\alpha+1 = 2')).toMatchInlineSnapshot(
      `["Equal", ["Add", 1, ["Integrate", "Alpha", "Alpha"]], 2]`
    );
  });

  test('simple with mathrm with spacing', () => {
    expect(json('\\int\\sin x \\, \\mathrm{d}x+1 = 2')).toMatchInlineSnapshot(
      `["Equal", ["Add", 1, ["Integrate", ["Sin", "x"], "x"]], 2]`
    );
  });

  test('simple with lower bound', () => {
    expect(json('\\int_0\\sin x \\, \\mathrm{d}x+1 = 2')).toMatchInlineSnapshot(
      `["Equal", ["Add", 1, ["Integrate", ["Sin", "x"], ["Pair", "x", 0]]], 2]`
    );
  });

  test('simple with upper bound', () => {
    expect(json('\\int^\\infty\\sin x \\, \\mathrm{d}x+1 = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Add",
          1,
          [
            "Integrate",
            ["Sin", "x"],
            ["Triple", "x", "Nothing", {num: "+Infinity"}]
          ]
        ],
        2
      ]
    `);
  });
  test('simple with lower and upper bound', () => {
    expect(json('\\int^\\infty_0\\sin x \\, \\mathrm{d}x+1 = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Add",
          1,
          ["Integrate", ["Sin", "x"], ["Triple", "x", 0, {num: "+Infinity"}]]
        ],
        2
      ]
    `);
  });

  test('simple with lower and upper bound and no index', () =>
    expect(json('\\int^\\infty_0\\sin x +1 = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Add", 1, ["Sin", "x"]],
          ["Triple", "Nothing", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx in frac', () =>
    expect(json('\\int^\\infty_0\\frac{3xdx}{5} = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Multiply", ["Rational", 3, 5], "x"],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with \\mathrm{d}x in frac', () =>
    expect(json('\\int^\\infty_0\\frac{3x\\mathrm{d}x}{5} = 2'))
      .toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Multiply", ["Rational", 3, 5], "x"],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('INVALID with dx in frac denom', () =>
    expect(json('\\int^\\infty_0\\frac{3x}{5dx} = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Divide", ["Rational", 3, 5], "d"],
          ["Triple", "Nothing", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `)); // @fixme, should error

  test('with dx in addition', () =>
    expect(json('\\int^\\infty_03x+kxdx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Add", ["Multiply", "k", "x"], ["Multiply", 3, "x"]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx in negate', () =>
    expect(json('\\int^\\infty_0-xdx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Negate", "x"],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx in delimiter', () =>
    expect(json('\\int^\\infty_0(3x+x^2dx) = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Add", ["Square", "x"], ["Multiply", 3, "x"]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx AFTER delimiter', () =>
    expect(json('\\int^\\infty_0(3x+x^2)dx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        [
          "Integrate",
          ["Add", ["Square", "x"], ["Multiply", 3, "x"]],
          ["Triple", "x", 0, {num: "+Infinity"}]
        ],
        2
      ]
    `));

  test('with dx after trig', () =>
    expect(json('\\int^\\infty_0\\sin x dx = 2')).toMatchInlineSnapshot(`
      [
        "Equal",
        ["Integrate", ["Sin", "x"], ["Triple", "x", 0, {num: "+Infinity"}]],
        2
      ]
    `));
});
