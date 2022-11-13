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
        ["Multiply", ["Square", "a"], ["Power", "a", 4]],
        ["Multiply", 8, "a", "a", "a", "b", "b", "b"],
        ["Multiply", 2, ["Square", "a"], ["Square", "a"], ["Square", "b"]],
        ["Multiply", 12, "a", "a", "b", "b", ["Square", "a"]],
        ["Multiply", 12, "a", "a", "b", "b", ["Square", "b"]],
        ["Multiply", ["Square", "a"], ["Power", "b", 4]],
        ["Multiply", 2, "a", "b", ["Power", "a", 4]],
        ["Multiply", 4, "a", "b", ["Square", "a"], ["Square", "a"]],
        ["Multiply", 12, "a", "b", ["Square", "a"], ["Square", "b"]],
        ["Multiply", 2, ["Square", "a"], ["Square", "b"], ["Square", "b"]],
        ["Multiply", 2, "a", "b", ["Power", "b", 4]],
        ["Multiply", 4, "a", "b", ["Square", "b"], ["Square", "b"]],
        ["Multiply", ["Square", "b"], ["Power", "a", 4]],
        ["Multiply", ["Square", "b"], ["Power", "b", 4]]
      ]
    `));
  test(`Power`, () =>
    expect(checkExpand(`(2a+4b^2)^6`)).toMatchInlineSnapshot(`
      box       = [
        "Expand",
        [
          "Power",
          ["Add", ["Multiply", 2, "a"], ["Multiply", 4, ["Square", "b"]]],
          6
        ]
      ]
      evaluate  = [
        "Add",
        ["Multiply", 64, ["Square", "a"], ["Power", "a", 4]],
        [
          "Multiply",
          512,
          "a",
          ["Square", "a"],
          ["Square", "a"],
          ["Square", "b"]
        ],
        [
          "Multiply",
          3072,
          "a",
          "a",
          ["Square", "a"],
          ["Square", "b"],
          ["Square", "b"]
        ],
        [
          "Multiply",
          4096,
          "a",
          "a",
          "a",
          ["Square", "b"],
          ["Square", "b"],
          ["Square", "b"]
        ],
        [
          "Multiply",
          512,
          ["Square", "a"],
          ["Square", "a"],
          ["Power", "b", 4]
        ],
        [
          "Multiply",
          6144,
          "a",
          ["Square", "a"],
          ["Square", "b"],
          ["Power", "b", 4]
        ],
        [
          "Multiply",
          12288,
          "a",
          "a",
          ["Square", "b"],
          ["Square", "b"],
          ["Power", "b", 4]
        ],
        ["Multiply", 1024, ["Square", "a"], ["Power", "b", 8]],
        ["Multiply", 256, ["Power", "a", 4], ["Power", "b", 4]],
        ["Multiply", 256, "a", ["Square", "b"], ["Power", "a", 4]],
        [
          "Multiply",
          2048,
          ["Square", "a"],
          ["Power", "b", 4],
          ["Power", "b", 4]
        ],
        ["Multiply", 4096, "a", ["Square", "b"], ["Power", "b", 8]],
        [
          "Multiply",
          8192,
          "a",
          ["Square", "b"],
          ["Power", "b", 4],
          ["Power", "b", 4]
        ],
        ["Multiply", 4096, ["Power", "b", 4], ["Power", "b", 8]]
      ]
    `));
});

describe('EXPAND PRODUCT', () => {
  test(`Product`, () =>
    expect(checkExpand(`4x(x+2)`)).toMatchInlineSnapshot(`
      box       = ["Expand", ["Multiply", 4, "x", ["Add", 2, "x"]]]
      evaluate  = ["Add", ["Multiply", 4, ["Square", "x"]], ["Multiply", 8, "x"]]
    `));
  test(`Product`, () =>
    expect(checkExpand(`4x(3x+2)-5(5x-4)`)).toMatchInlineSnapshot(`
      box       = [
        "Expand",
        [
          "Add",
          20,
          ["Negate", ["Multiply", 5, ["Multiply", 5, "x"]]],
          ["Multiply", 4, "x", ["Add", 2, ["Multiply", 3, "x"]]]
        ]
      ]
      simplify  = [
        "Expand",
        [
          "Add",
          20,
          ["Multiply", -25, "x"],
          ["Multiply", 4, "x", ["Add", 2, ["Multiply", 3, "x"]]]
        ]
      ]
      evaluate  = ["Add", 20, ["Multiply", 12, ["Square", "x"]], ["Multiply", -17, "x"]]
    `));
});
