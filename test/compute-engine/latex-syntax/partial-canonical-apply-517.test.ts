/**
 * The partial canonical form `['InvisibleOperator']` of a function literal
 * applied to an argument list is the `Apply` (GitHub #517). It was a
 * one-operand `Multiply` around the `Apply`, and for a curried literal the
 * `Multiply` held an `incompatible-type` error.
 */

import { ComputeEngine } from '../../../src/compute-engine';

const ce = new ComputeEngine();

type Json = ReturnType<typeof ce.parse>['json'];

/**
 * The MathJSON with the `Block` that the full canonical form puts around the
 * body of a `Function` removed: the partial form does not canonicalize the
 * function literal, so its body has no `Block`.
 */
function withoutBodyBlock(json: Json): Json {
  if (!Array.isArray(json)) return json;
  const [head, ...rest] = json;
  const ops = rest.map((x) => withoutBodyBlock(x as Json));
  if (
    head === 'Function' &&
    Array.isArray(ops[0]) &&
    ops[0][0] === 'Block' &&
    ops[0].length === 2
  )
    ops[0] = ops[0][1] as Json;
  return [head, ...ops] as Json;
}

function partial(latex: string) {
  return ce.parse(latex, { canonical: ['InvisibleOperator'] });
}

describe('PARTIAL CANONICAL FORM OF AN APPLIED FUNCTION LITERAL', () => {
  test.each([
    String.raw`(x\mapsto x^2)(a)`,
    String.raw`(x\mapsto y\mapsto x^{y})(a)\lhd b`,
    String.raw`(x\mapsto x^2)(a)^2`,
    String.raw`(x\mapsto x^2)(a)\,`,
  ])('%s', (latex) => {
    const expr = partial(latex);
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual(withoutBodyBlock(ce.parse(latex).json));
  });

  test('the first example', () => {
    expect(partial(String.raw`(x\mapsto x^2)(a)`).json).toEqual([
      'Apply',
      ['Function', ['Power', 'x', 2], 'x'],
      'a',
    ]);
  });

  test('the curried example', () => {
    const curried = ['Function', ['Function', ['Power', 'x', 'y'], 'y'], 'x'];
    expect(
      partial(String.raw`(x\mapsto y\mapsto x^{y})(a)\lhd b`).json
    ).toEqual(['Apply', ['Apply', curried, 'a'], 'b']);
  });

  test('an application beside another factor is still a product', () => {
    expect(partial(String.raw`2(x\mapsto x^2)(3)`).json).toEqual([
      'Multiply',
      2,
      ['Apply', ['Function', ['Power', 'x', 2], 'x'], 3],
    ]);
  });
});
