/**
 * `Sum` (and `Product`) over terms whose type does not exclude a list.
 *
 * The case (ROADMAP CE-361): `g(t) = [t, 2t]` declared
 * `(unknown) -> list<unknown>` (or `(unknown) -> list`), and `x` declared
 * `any`. The elements of `Rest(g(x))` are typed `list<unknown> | unknown`
 * (or `any | list`): a number `x` gives numbers, a list `x` gives lists, as
 * the call maps over the list. `Sum(Rest(g(x)))` was typed `number`, but at
 * `x = [1, 2]` it evaluates to `[2, 4]`, which `number` does not hold.
 *
 * The cause: the type of `Sum` (`bigOpResultType`,
 * `library/type-handlers.ts`) reads the elements of its operand when they
 * are numbers, points, rows or a union of numbers and rows of numbers, and
 * answered `number` for every other element type. An element typed
 * `unknown`, or a row whose cells are typed `unknown`, was read as a number.
 *
 * The fix: when the terms may be lists and no other reading applies, the
 * result holds every value the sum can take (`listReductionType`):
 *
 * - a term typed `any` or `value` (or a union with such an option) may be a
 *   number, a list or a point, so the sum keeps that type;
 * - a term typed `unknown` (or a union with such an option) gives
 *   `broadcastable<number>`, the type `Add` gives for operands typed
 *   `unknown`;
 * - terms that are numbers or lists of untyped cells sum to
 *   `number | list<any>`.
 *
 * The same reading applies to the terms of the `(body, limits)` form, and to
 * an operand typed `broadcastable<T>` (the type of `g(x)`).
 *
 * Each test reads the static type BEFORE the symbol is assigned: an assigned
 * value narrows the type, and the check would then prove nothing.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

type MathJson = Parameters<ComputeEngine['box']>[0];

/** An engine with `g(t) = [t, 2t]` declared with `signature`, and `x: any`. */
function engineWithG(signature: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('g', signature);
  ce.assign(
    'g',
    ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
  );
  ce.declare('x', { type: 'any' });
  return ce;
}

/**
 * The static type of `expr`, read before `symbol` is assigned, and for each
 * value of `symbol` the value of `expr` boxed again, with whether the static
 * type holds that value.
 */
function typeAndValues(
  ce: ComputeEngine,
  expr: MathJson,
  symbol: string,
  values: MathJson[]
): { type: string; values: [string, boolean][] } {
  const boxed: Expression = ce.box(expr);
  const type = boxed.type;
  const results: [string, boolean][] = [];
  for (const v of values) {
    ce.assign(symbol, ce.box(v));
    const value = ce.box(expr).evaluate();
    results.push([value.toString(), value.type.matches(type)]);
  }
  return { type: type.toString(), values: results };
}

describe('CE-361: the sum of elements that may be lists', () => {
  test('Sum(Rest(g(x))) with g declared (unknown) -> list<unknown>', () => {
    const ce = engineWithG('(unknown) -> list<unknown>');
    expect(
      typeAndValues(ce, ['Sum', ['Rest', ['g', 'x']]], 'x', [
        ['List', 1, 2],
        ['List', ['List', 1, 2], ['List', 3, 4]],
      ])
    ).toEqual({
      type: 'broadcastable<number>',
      values: [
        ['[2,4]', true],
        ['[[3,6],[4,8]]', true],
      ],
    });
  });

  test('Sum(Rest(g(x))) with g declared (unknown) -> list', () => {
    const ce = engineWithG('(unknown) -> list');
    expect(
      typeAndValues(ce, ['Sum', ['Rest', ['g', 'x']]], 'x', [['List', 1, 2]])
    ).toEqual({ type: 'any', values: [['[2,4]', true]] });
  });

  test('Sum(g(x)): the operand is a broadcastable<list<unknown>>', () => {
    const ce = engineWithG('(unknown) -> list<unknown>');
    expect(
      typeAndValues(ce, ['Sum', ['g', 'x']], 'x', [3, ['List', 1, 2]])
    ).toEqual({
      type: 'broadcastable<number>',
      values: [
        ['9', true],
        ['[3,6]', true],
      ],
    });
  });

  test('elements typed unknown: Sum(L) with L: list<unknown>', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<unknown>');
    expect(
      typeAndValues(ce, ['Sum', 'L'], 'L', [
        ['List', ['List', 1, 2], ['List', 3, 4]],
      ])
    ).toEqual({ type: 'broadcastable<number>', values: [['[4,6]', true]] });
  });

  test('elements typed unknown: Sum(L) with L: list', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list');
    expect(
      typeAndValues(ce, ['Sum', 'L'], 'L', [
        ['List', ['List', 1, 2], ['List', 3, 4]],
      ])
    ).toEqual({ type: 'broadcastable<number>', values: [['[4,6]', true]] });
  });

  test('elements typed list<unknown>: a row of unknown cells', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'list<list<unknown>>');
    expect(
      typeAndValues(ce, ['Sum', 'M'], 'M', [
        ['List', ['List', 1, 2], ['List', 3, 4]],
        ['List'],
      ])
    ).toEqual({
      type: 'list<any> | number',
      values: [
        ['[4,6]', true],
        ['0', true],
      ],
    });
  });

  test('the (body, limits) form: a body typed unknown', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<unknown>');
    expect(
      typeAndValues(ce, ['Sum', ['At', 'L', 'k'], ['Limits', 'k', 1, 2]], 'L', [
        ['List', ['List', 1, 2], ['List', 3, 4]],
        ['List', 5, 6],
      ])
    ).toEqual({
      type: 'broadcastable<number>',
      values: [
        ['[4,6]', true],
        ['11', true],
      ],
    });
  });

  test('Sum(h(x)) and Sum(h(x)[k], k): h is not declared', () => {
    // The signature inferred from the body, `(unknown) -> vector<2>`, makes
    // `h(x)` a `vector<2>` or a list of any depth (ROADMAP CE-371, user
    // decision 2026-10-25: `R | list<R | list<any>>`), so the sum is a
    // number or a list.
    const engineWithH = (): ComputeEngine => {
      const ce = new ComputeEngine();
      ce.assign(
        'h',
        ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
      );
      ce.declare('x', { type: 'any' });
      return ce;
    };
    expect(
      typeAndValues(engineWithH(), ['Sum', ['h', 'x']], 'x', [
        3,
        ['List', 1, 2],
      ])
    ).toEqual({
      type: 'list<any> | number',
      values: [
        ['9', true],
        ['[3,6]', true],
      ],
    });
    expect(
      typeAndValues(
        engineWithH(),
        ['Sum', ['At', ['h', 'x'], 'k'], ['Limits', 'k', 1, 2]],
        'x',
        [3, ['List', 1, 2]]
      )
    ).toEqual({
      type: 'list<any> | number',
      values: [
        ['9', true],
        ['[3,6]', true],
      ],
    });
  });

  test('Product, the (body, limits) form: a body typed unknown', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<unknown>');
    expect(
      typeAndValues(
        ce,
        ['Product', ['At', 'L', 'k'], ['Limits', 'k', 1, 2]],
        'L',
        [['List', ['List', 1, 2], ['List', 3, 4]]]
      )
    ).toEqual({ type: 'broadcastable<number>', values: [['[3,8]', true]] });
  });
});

describe('CE-361: the readings that do not change', () => {
  test('elements typed number', () => {
    const ce = new ComputeEngine();
    ce.declare('N', 'list<number>');
    expect(ce.box(['Sum', 'N']).type.toString()).toBe('number');
  });

  test('elements typed vector<2>', () => {
    const ce = new ComputeEngine();
    ce.declare('V', 'list<vector<2>>');
    expect(ce.box(['Sum', 'V']).type.toString()).toBe('integer | vector<2>');
  });

  test('elements typed number | vector<2>', () => {
    const ce = new ComputeEngine();
    ce.declare('NV', 'list<number | vector<2>>');
    expect(ce.box(['Sum', 'NV']).type.toString()).toBe('number | vector<2>');
  });

  test('elements typed any', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'list<any>');
    expect(ce.box(['Sum', 'A']).type.toString()).toBe('any');
  });

  test('elements that are matrices that are not square: Product', () => {
    // The product of two such matrices is not defined and stays
    // unevaluated, so no shape is given (`shapedProductType`).
    const ce = new ComputeEngine();
    ce.declare('P', 'list<matrix<integer^2x3>>');
    expect(ce.box(['Product', 'P']).type.toString()).toBe('number');
  });

  test('elements typed string', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'list<string>');
    expect(ce.box(['Sum', 'S']).type.toString()).toBe('number');
  });

  test('a symbol whose type is inferred', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Sum', 'Q']).type.toString()).toBe('number');
  });

  test('a sum over a range of a bound variable', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 10]]);
    const value = expr.evaluate();
    expect([expr.type.toString(), value.toString()]).toEqual([
      'integer',
      '385',
    ]);
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test('a broadcastable over a self-referential alias does not overflow', () => {
    // The test whether the cells of `broadcastable<T>` can hold a list walks
    // the arms of `T`. Before, `cyc` unfolded again at each level, and
    // `.type` threw `Maximum call stack size exceeded`.
    const ce = new ComputeEngine();
    ce.declareType('cyc', 'cyc | number', { alias: true });
    ce.declare('b', 'broadcastable<cyc>');
    expect(ce.box(['Sum', 'b']).type.toString()).toBe('number');
  });
});
