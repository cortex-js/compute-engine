import { ComputeEngine } from '../../src/compute-engine';

//
// A missing required operand is an `Error("missing")` operand, the result of
// `checkArity()`. Some `canonical` handlers read an operand without an arity
// check: `Annotated(x)` logged a canonicalization error and gave
// `Annotated(x)`, `Subscript(x)` threw, `Complex()` threw, and the aliases
// (`Lb()`, `Lucas()`, …) built a node with an `undefined` operand.
//

const ce = new ComputeEngine();

/** Box `expr`, and fail on any console error. */
function boxed(expr: any) {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = ce.box(expr);
    expect(error).not.toHaveBeenCalled();
    return result;
  } finally {
    error.mockRestore();
  }
}

describe('a missing operand', () => {
  test.each([
    [['Annotated', 'x'], '["Annotated","x",["Error","\'missing\'"]]'],
    [
      ['Annotated'],
      '["Annotated",["Error","\'missing\'"],["Error","\'missing\'"]]',
    ],
    [['Subscript', 'x'], '["Subscript","x",["Error","\'missing\'"]]'],
    [
      ['Subscript'],
      '["Subscript",["Error","\'missing\'"],["Error","\'missing\'"]]',
    ],
    [
      ['Complex'],
      '["Complex",["Error","\'missing\'"],["Error","\'missing\'"]]',
    ],
    [['Apply'], '["Apply",["Error","\'missing\'"]]'],
    [['CanonicalForm'], '["CanonicalForm",["Error","\'missing\'"]]'],
    [['Factorial'], '["Factorial",["Error","\'missing\'"]]'],
    [['Lb'], '["Log",["Error","\'missing\'"],2]'],
    [['Log2'], '["Log",["Error","\'missing\'"],2]'],
    [['Lg'], '["Log",["Error","\'missing\'"]]'],
    [['Log10'], '["Log",["Error","\'missing\'"]]'],
    [['Lucas'], '["LucasL",["Error","\'missing\'"]]'],
    [['PrimeNumber'], '["NthPrime",["Error","\'missing\'"]]'],
  ])('%j', (expr, json) => {
    const result = boxed(expr);
    expect(JSON.stringify(result.json)).toBe(json);
    expect(result.isValid).toBe(false);
  });

  test('an extra operand of Complex', () => {
    expect(JSON.stringify(boxed(['Complex', 1, 2, 3]).json)).toBe(
      '["Complex",1,2,["Error","\'unexpected-argument\'","\'3\'"]]'
    );
  });

  test('a name that is not a canonical form', () => {
    expect(JSON.stringify(boxed(['CanonicalForm', 'x', 'y']).json)).toBe(
      '["CanonicalForm","x",["Error","\'unexpected-argument\'","\'y\'"]]'
    );
  });
});

//
// An extra operand of an alias is kept in the rewritten node. Before, the
// handlers dropped it, also in strict mode: `Lb(8, 3)` gave `Log(8, 2)` = 3.
// In strict mode it is an `unexpected-argument` error; on the non-strict
// route it is kept as is, as for `Sin(1, 2)`. The extra operand of `Lg` and
// `Log10` comes after the base 10, so that it is not read as the base.
//
describe('an extra operand', () => {
  const CASES: [any, string, string][] = [
    [
      ['Factorial', 1, 2],
      '["Factorial",1,2]',
      '["Factorial",1,["Error","\'unexpected-argument\'","\'2\'"]]',
    ],
    [
      ['Lb', 8, 3],
      '["Log",8,2,3]',
      '["Log",8,2,["Error","\'unexpected-argument\'","\'3\'"]]',
    ],
    [
      ['Log2', 8, 3],
      '["Log",8,2,3]',
      '["Log",8,2,["Error","\'unexpected-argument\'","\'3\'"]]',
    ],
    [
      ['Lg', 8, 3],
      '["Log",8,10,3]',
      '["Log",8,10,["Error","\'unexpected-argument\'","\'3\'"]]',
    ],
    [
      ['Log10', 8, 3],
      '["Log",8,10,3]',
      '["Log",8,10,["Error","\'unexpected-argument\'","\'3\'"]]',
    ],
    [
      ['Lucas', 3, 4],
      '["LucasL",3,4]',
      '["LucasL",3,["Error","\'unexpected-argument\'","\'4\'"]]',
    ],
    [
      ['PrimeNumber', 3, 4],
      '["NthPrime",3,4]',
      '["NthPrime",3,["Error","\'unexpected-argument\'","\'4\'"]]',
    ],
  ];

  test.each(CASES)('%j, not strict', (expr, json) => {
    const ce = new ComputeEngine();
    ce.strict = false;
    expect(JSON.stringify(ce.box(expr).json)).toBe(json);
  });

  test.each(CASES)('%j, strict', (expr, _json, strictJson) => {
    const ce = new ComputeEngine();
    ce.strict = true;
    const result = ce.box(expr);
    expect(JSON.stringify(result.json)).toBe(strictJson);
    expect(result.isValid).toBe(false);
  });
});

describe('the complete forms are unchanged', () => {
  test.each([
    [['Subscript', 'x', 1], '"x_1"'],
    [
      ['Annotated', 'x', ['Dictionary', ['Tuple', "'color'", "'red'"]]],
      '["Annotated","x",{"dict":{"color":"red"}}]',
    ],
    [['Complex', 1, 2], '["Complex",1,2]'],
    [['Lb', 8], '["Log",8,2]'],
    [['CanonicalForm', ['Add', 'x', 'x'], 'Order'], '["Add","x","x"]'],
  ])('%j', (expr, json) => {
    expect(JSON.stringify(boxed(expr).json)).toBe(json);
  });
});

describe('Derivative with no operand', () => {
  test('gives the missing-operand error, with no console error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ce = new ComputeEngine();
      expect(ce.box(['Derivative']).json).toEqual([
        'Derivative',
        ['Error', "'missing'"],
      ]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
