import { checkJson, engine } from '../utils';

function checkExpand(s: string): string {
  return checkJson(
    engine.box(['Expand', engine.parse(s, { canonical: false })])
  );
}

describe('EXPAND POWER', () => {
  test(`Power`, () =>
    expect(checkExpand(`(a+b)^6`)).toMatchInlineSnapshot(`
      box       = ["Expand", ["Power", ["Add", "a", "b"], 6]]
      eval-auto = a^6 + b^6 + 6b * a^5 + 6a * b^5 + 15b^4 * a^2 + 15a^4 * b^2 + 20(a * b)^3
    `));

  // 64*a**6 + 768*a**5*b**2 + 3840*a**4*b**4 + 10240*a**3*b**6 + 15360*a**2*b**8 + 12288*a*b**10 + 4096*b**12
  test(`Power`, () =>
    expect(checkExpand(`(2a+4b^2)^6`)).toMatchInlineSnapshot(`
      box       = [
        "Expand",
        [
          "Power",
          ["Add", ["Multiply", 4, ["Square", "b"]], ["Multiply", 2, "a"]],
          6
        ]
      ]
      eval-auto = 4096b^12 + 12288a * b^10 + 15360b^8 * a^2 + 10240b^6 * a^3 + 768a^5 * b^2 + 64a^6 + 3840(a * b)^4
    `));
});

describe('EXPAND PRODUCT', () => {
  test(`Expand 4x(x+2)`, () =>
    expect(checkExpand(`4x(x+2)`)).toMatchInlineSnapshot(`
      box       = ["Expand", ["Multiply", 4, "x", ["Add", "x", 2]]]
      eval-auto = 4x^2 + 8x
    `));

  test(`Expand 4x(3x+2)-5(5x-4)`, () =>
    expect(checkExpand(`4x(3x+2)-5(5x-4)`)).toMatchInlineSnapshot(`
      box       = [
        "Expand",
        [
          "Add",
          ["Multiply", 4, "x", ["Add", ["Multiply", 3, "x"], 2]],
          ["Multiply", -5, ["Subtract", ["Multiply", 5, "x"], 4]]
        ]
      ]
      eval-auto = 12x^2 - 17x + 20
    `));
});
