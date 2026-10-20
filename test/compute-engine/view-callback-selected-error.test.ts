import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// A lazy view whose callback holds a written error under a SELECTING operator
// (`u ↦ If(u = 2, 1/"a", u)`) is a collection: the error is the value of an
// element only when the selection demands it, here the second element
// (`docs/ERROR-MODEL.md` §3). The view gives the same answers as one whose
// callback fails at run time (`RuntimeError`).
//
// Before, the view was neither a collection nor an error: `Sum`, `Product`
// and `All` over it answered the view itself, `Max`, `Mean`, `Length` and
// `Sin` stayed unevaluated, and `First` was an `incompatible-type` error
// about the view.
//

const ce = new ComputeEngine();

const ERR = 'Error(ErrorCode("incompatible-type", "number", "string"), "a")';

const callback: MathJsonExpression = [
  'Function',
  ['If', ['Equal', 'u', 2], ['Divide', 1, "'a'"], 'u'],
  'u',
];
const view = (source: MathJsonExpression): MathJsonExpression => [
  'Map',
  callback,
  source,
];
const RANGE: MathJsonExpression = ['Range', 1, 5];

describe('A VIEW WHOSE CALLBACK HOLDS AN ERROR UNDER A SELECTION', () => {
  test.each([
    ['Map over a range', view(RANGE), `[1,${ERR},3,4,5]`],
    ['Map over a list', view(['List', 1, 2, 3]), `[1,${ERR},3]`],
    ['Sum', ['Sum', view(RANGE)], ERR],
    ['Product', ['Product', view(RANGE)], ERR],
    ['Max', ['Max', view(RANGE)], ERR],
    ['Mean', ['Mean', view(RANGE)], ERR],
    ['Length', ['Length', view(RANGE)], '5'],
    ['First', ['First', view(RANGE)], '1'],
    [
      'All, no element decides',
      ['All', view(RANGE), ['Function', ['Less', 'u', 9], 'u']],
      ERR,
    ],
    [
      'All, an element after the failure decides',
      ['All', view(RANGE), ['Function', ['Less', 'u', 4], 'u']],
      '"False"',
    ],
    [
      'Sin broadcasts',
      ['Sin', view(RANGE)],
      `[sin(1),${ERR},sin(3),sin(4),sin(5)]`,
    ],
  ] as [string, MathJsonExpression, string][])(
    '%s',
    async (_label, json, expected) => {
      expect(ce.box(json).evaluate().toString()).toBe(expected);
      expect((await ce.box(json).evaluateAsync()).toString()).toBe(expected);
    }
  );

  test('the view is a collection, and its tree stays invalid', () => {
    const x = ce.box(view(RANGE));
    expect(x.isValid).toBe(false);
    expect(x.isCollection).toBe(true);
    expect(x.count).toBe(5);
  });

  test('a callback whose error is not under a selection fails as a whole', () => {
    // Every element demands the error, so the view's error bubbles.
    const json: MathJsonExpression = [
      'Sum',
      ['Map', ['Function', ['Divide', 1, "'a'"], 'u'], RANGE],
    ];
    expect(ce.box(json).evaluate().toString()).toBe(ERR);
  });
});
