import { checkJson, engine } from '../utils';

function checkExpand(s: string): string {
  return checkJson(engine.box(['Expand', engine.parse(s)]));
}

describe('EXPAND POWER', () => {
  test(`Power`, () =>
    expect(checkExpand(`(a+b)^6`)).toMatchInlineSnapshot(`
      box       = ["Expand", ["Power", ["Add", "a", "b"], 6]]
      evaluate  = [
        "Add",
        ["Multiply", 20, ["Power", "a", 3], ["Power", "b", 3]],
        ["Multiply", 15, ["Square", "a"], ["Power", "b", 4]],
        ["Multiply", 15, ["Square", "b"], ["Power", "a", 4]],
        ["Multiply", 6, "a", ["Power", "b", 5]],
        ["Multiply", 6, "b", ["Power", "a", 5]],
        ["Power", "a", 6],
        ["Power", "b", 6]
      ]
    `));
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
      evaluate  = [
        "Add",
        ["Multiply", ["Power", 4, 6], ["Power", ["Square", "b"], 6]],
        ["Multiply", ["Power", 2, 6], ["Power", "a", 6]],
        ["Multiply", 3840, ["Square", ["Square", "b"]], ["Power", "a", 4]],
        ["Multiply", 10240, ["Power", "a", 3], ["Power", ["Square", "b"], 3]],
        ["Multiply", 15360, ["Square", "a"], ["Power", ["Square", "b"], 4]],
        ["Multiply", 768, ["Square", "b"], ["Power", "a", 5]],
        ["Multiply", 12288, "a", ["Power", ["Square", "b"], 5]]
      ]
    `));
});

describe('EXPAND PRODUCT', () => {
  test(`Product`, () =>
    expect(checkExpand(`4x(x+2)`)).toMatchInlineSnapshot(`
      box       = ["Expand", ["Multiply", 4, "x", ["Add", "x", 2]]]
      evaluate  = ["Add", ["Multiply", 4, ["Square", "x"]], ["Multiply", 8, "x"]]
    `));
  test(`Product`, () =>
    expect(checkExpand(`4x(3x+2)-5(5x-4)`)).toMatchInlineSnapshot(`
      box       = [
        "Expand",
        [
          "Add",
          ["Multiply", -5, ["Subtract", ["Multiply", 5, "x"], 4]],
          ["Multiply", 4, "x", ["Add", ["Multiply", 3, "x"], 2]]
        ]
      ]
      simplify  = [
        "Expand",
        [
          "Add",
          ["Multiply", 12, ["Square", "x"]],
          ["Multiply", -17, "x"],
          20
        ]
      ]
      evaluate  = ["Add", ["Multiply", 12, ["Square", "x"]], ["Multiply", -17, "x"], 20]
    `));
});
