/**
 * A user function whose body passes its PARAMETER as the collection operand
 * of a collection operator must type that parameter as a collection.
 *
 * A user function with an `unknown` parameter is applied to each element of a
 * list argument (auto-broadcast). The operators that take a callback are
 * `lazy`: their operands arrive unbound, their canonical handler builds the
 * result itself, and no signature validation ran on the result, so the
 * source symbol got no type from its use. `h(xs) = Filter(xs, p)` applied to
 * `[1, 2, 3]` gave `[Filter(1, p), Filter(2, p), Filter(3, p)]` instead of the
 * filtered list. The boxing of a lazy operator now narrows a valueless
 * `unknown` symbol at a collection slot of the result's signature
 * (`inferCollectionSourceArgs`, `boxed-expression/validate.ts`).
 *
 * Each case checks two things: the type of `h`, and that `h(literal)` has the
 * same value as the operator applied to the literal directly.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import type { MathJsonExpression } from '../../src/math-json';

const LIST = '[1, 2, 3]';
const SET = '{1, 2, 3}';

// [operator, Epsil body over `xs`, expected type of `h`, arguments]
const EPSIL_CASES: [string, string, string, string[]][] = [
  // The lazy callback family: the parameter was `unknown` before the fix.
  [
    'Map',
    'map(x => 2 * x, xs)',
    '(collection<unknown>) -> collection<number>',
    [LIST, SET],
  ],
  [
    'Filter',
    'filter(xs, x => x > 1)',
    '(collection<unknown>) -> collection<unknown>',
    [LIST, SET],
  ],
  [
    'Reduce',
    'reduce(xs, (a, x) => a + x, 0)',
    '(collection<unknown>) -> number',
    [LIST, SET],
  ],
  [
    'Scan',
    'scan(xs, (a, x) => a + x)',
    '(collection<unknown>) -> collection<unknown>',
    [LIST],
  ],
  [
    'Fold',
    'fold((a, x) => a + x, 0, xs)',
    '(collection<unknown>) -> number',
    [LIST, SET],
  ],
  [
    'Any',
    'any(xs, x => x > 2)',
    '(collection<unknown>) -> boolean',
    [LIST, SET],
  ],
  [
    'All',
    'all(xs, x => x > 0)',
    '(collection<unknown>) -> boolean',
    [LIST, SET],
  ],
  [
    'TakeWhile',
    'takeWhile(xs, x => x < 3)',
    '(collection<unknown>) -> collection<unknown>',
    [LIST],
  ],
  [
    'DropWhile',
    'dropWhile(xs, x => x < 2)',
    '(collection<unknown>) -> collection<unknown>',
    [LIST],
  ],
  [
    'FlatMap',
    'flatMap(xs, x => [x, x])',
    '(collection<unknown>) -> list<number>',
    [LIST],
  ],
  [
    'MaxBy',
    'maxBy(xs, x => -x)',
    '(collection<unknown>) -> unknown',
    [LIST, SET],
  ],
  [
    'MinBy',
    'minBy(xs, x => -x)',
    '(collection<unknown>) -> unknown',
    [LIST, SET],
  ],
  [
    'ArgMax',
    'argMax(xs, x => -x)',
    '(indexed_collection<unknown>) -> integer',
    [LIST],
  ],
  [
    'ArgMin',
    'argMin(xs, x => -x)',
    '(indexed_collection<unknown>) -> integer',
    [LIST],
  ],
  ['Dedup', 'dedup(xs)', '(collection<any>) -> collection<any>', [LIST]],
  ['Differences', 'differences(xs)', '(collection<any>) -> list', [LIST]],
  // Operators that were typed correctly before the fix: they must not change.
  [
    'Find',
    'find(xs, x => x > 1)',
    '(collection<unknown>) -> nothing | unknown',
    [LIST],
  ],
  [
    'IndexWhere',
    'indexWhere(xs, x => x > 1)',
    '(collection<unknown>) -> integer',
    [LIST],
  ],
  [
    'CountIf',
    'countIf(xs, x => x > 1)',
    '(collection<unknown>) -> integer',
    [LIST, SET],
  ],
  [
    'Count',
    'count(xs, x => x > 1)',
    '(collection<any>) -> integer',
    [LIST, SET],
  ],
  [
    'Sort',
    'sort(xs, (a, b) => b - a)',
    '(indexed_collection<unknown>) -> list<unknown>',
    [LIST],
  ],
  [
    'GroupBy',
    'groupBy(xs, x => x > 1)',
    '(collection<unknown>) -> dictionary<list>',
    [LIST],
  ],
  [
    'Partition',
    'partition(xs, x => x > 1)',
    '(collection<unknown>) -> list<list<unknown>>',
    [LIST],
  ],
  [
    'Position',
    'position(xs, x => x > 1)',
    '(collection<unknown>) -> list<integer>',
    [LIST],
  ],
  ['Zip', 'zip(xs, xs)', '(indexed_collection<any>) -> list', [LIST]],
  [
    'Tally',
    'tally(xs)',
    '(collection<unknown>) -> tuple<list<unknown>, list<integer>>',
    [LIST, SET],
  ],
  [
    'Unique',
    'unique(xs)',
    '(collection<unknown>) -> collection<unknown>',
    [LIST],
  ],
  ['Sum', 'sum(xs)', '(collection) -> number', [LIST, SET]],
  ['Contains', 'contains(xs, 2)', '(collection<any>) -> boolean', [LIST, SET]],
  ['First', 'first(xs)', '(indexed_collection<any>) -> unknown', [LIST]],
  ['Last', 'last(xs)', '(indexed_collection<any>) -> unknown', [LIST]],
  [
    'At',
    'xs[2]',
    '(dictionary<any> | indexed_collection<any>) -> unknown',
    [LIST],
  ],
];

function epsilValue(ce: ComputeEngine, source: string): string {
  const r = executeEpsil(ce, source);
  return r.value?.toString() ?? `no value: ${JSON.stringify(r.diagnostics)}`;
}

describe('Collection operator on a function parameter: Epsil route', () => {
  for (const [op, body, type, args] of EPSIL_CASES) {
    for (const arg of args) {
      test(`${op} over ${arg}`, () => {
        const ce = new ComputeEngine();
        const viaFunction = epsilValue(
          ce,
          `function h(xs) { ${body} }\nh(${arg})`
        );
        expect(ce.symbol('h').type.toString()).toBe(type);
        const direct = epsilValue(
          new ComputeEngine(),
          `let xs = ${arg}\n${body}`
        );
        expect(viaFunction).toBe(direct);
      });
    }
  }
});

const GT1: MathJsonExpression = ['Function', ['Greater', 'x', 1], 'x'];
const ADD: MathJsonExpression = ['Function', ['Add', 'a', 'x'], 'a', 'x'];
const NEG: MathJsonExpression = ['Function', ['Negate', 'x'], 'x'];

// [operator, body over `xs`, expected parameter type of the function literal]
const BOX_CASES: [string, MathJsonExpression, string][] = [
  [
    'Map',
    ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], 'xs'],
    'collection<unknown>',
  ],
  ['Filter', ['Filter', 'xs', GT1], 'collection<unknown>'],
  ['Reduce', ['Reduce', 'xs', ADD, 0], 'collection<unknown>'],
  ['Scan', ['Scan', 'xs', ADD], 'collection<unknown>'],
  ['Fold', ['Fold', ADD, 0, 'xs'], 'collection<unknown>'],
  ['Any', ['Any', 'xs', GT1], 'collection<unknown>'],
  ['All', ['All', 'xs', GT1], 'collection<unknown>'],
  [
    'TakeWhile',
    ['TakeWhile', 'xs', ['Function', ['Less', 'x', 3], 'x']],
    'collection<unknown>',
  ],
  [
    'DropWhile',
    ['DropWhile', 'xs', ['Function', ['Less', 'x', 2], 'x']],
    'collection<unknown>',
  ],
  [
    'FlatMap',
    ['FlatMap', 'xs', ['Function', ['List', 'x', 'x'], 'x']],
    'collection<unknown>',
  ],
  ['MaxBy', ['MaxBy', 'xs', NEG], 'collection<unknown>'],
  ['MinBy', ['MinBy', 'xs', NEG], 'collection<unknown>'],
  ['ArgMax', ['ArgMax', 'xs', NEG], 'indexed_collection<unknown>'],
  ['ArgMin', ['ArgMin', 'xs', NEG], 'indexed_collection<unknown>'],
  ['Dedup', ['Dedup', 'xs'], 'collection<any>'],
  ['Differences', ['Differences', 'xs'], 'collection<any>'],
  ['Find', ['Find', 'xs', GT1], 'collection<unknown>'],
  ['CountIf', ['CountIf', 'xs', GT1], 'collection<unknown>'],
  ['Count', ['Count', 'xs'], 'collection<any>'],
  ['Sort', ['Sort', 'xs'], 'indexed_collection<unknown>'],
  ['Tally', ['Tally', 'xs'], 'collection<unknown>'],
  ['Contains', ['Contains', 'xs', 2], 'collection<any>'],
  ['First', ['First', 'xs'], 'indexed_collection<any>'],
];

function substitute(
  expr: MathJsonExpression,
  value: MathJsonExpression
): MathJsonExpression {
  if (expr === 'xs') return value;
  if (Array.isArray(expr))
    return expr.map((x) =>
      substitute(x as MathJsonExpression, value)
    ) as MathJsonExpression;
  return expr;
}

describe('Collection operator on a function parameter: box route', () => {
  const literal: MathJsonExpression = ['List', 1, 2, 3];
  for (const [op, body, paramType] of BOX_CASES) {
    test(op, () => {
      const ce = new ComputeEngine();
      const fn = ce.box(['Function', body, 'xs']);
      expect(fn.type.toString()).toMatch(
        new RegExp(`^\\(xs: ${paramType.replace(/[()<>|]/g, '\\$&')}\\) ->`)
      );
      ce.declare('h', 'function');
      ce.assign('h', fn);
      const viaFunction = ce.box(['h', literal]).evaluate().toString();
      const direct = ce.box(substitute(body, literal)).evaluate().toString();
      expect(viaFunction).toBe(direct);
    });
  }
});

describe('Collection operator on a symbol: what is not rewritten', () => {
  test('a declared symbol keeps its type', () => {
    const ce = new ComputeEngine();
    ce.declare('ys', 'list<integer>');
    ce.box(['Filter', 'ys', GT1]);
    expect(ce.symbol('ys').type.toString()).toBe('list<integer>');
  });

  test('a symbol with a value keeps its type', () => {
    const ce = new ComputeEngine();
    ce.assign('ys', ce.box(['List', 1, 2, 3]));
    const before = ce.symbol('ys').type.toString();
    ce.box(['Reduce', 'ys', ADD, 0]);
    expect(ce.symbol('ys').type.toString()).toBe(before);
  });

  test('a free symbol is narrowed from its use, as by a non-lazy operator', () => {
    const ce = new ComputeEngine();
    ce.box(['Filter', 'zs', GT1]);
    ce.box(['Find', 'ws', GT1]);
    expect(ce.symbol('zs').type.toString()).toBe(
      ce.symbol('ws').type.toString()
    );
  });

  test('the callback parameter is not declared in the enclosing scope', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Function',
      ['Filter', 'xs', ['Function', ['Greater', 'q', 1], 'q']],
      'xs',
    ]);
    expect(ce.lookupDefinition('q')).toBeUndefined();
  });

  test('a lazy operator stays lazy: the held source is not evaluated', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Filter', ['Range', 1, 1e9], GT1]);
    expect(expr.operator).toBe('Filter');
    expect(expr.op1.operator).toBe('Range');
  });

  test('the LaTeX route narrows the source too', () => {
    const ce = new ComputeEngine();
    ce.parse('\\operatorname{Filter}(w, x \\mapsto x>1)');
    expect(ce.symbol('w').type.toString()).toBe('collection<unknown>');
  });
});

describe('The inference is limited to the source operators', () => {
  test('a compound subscript leaves its base untyped, on every parse', () => {
    // `Subscript` is lazy and its first slot is `collection<any>`, but the
    // base of `a_{n+1}` is not a source: `a` may be a number.
    const engine = new ComputeEngine();
    expect(engine.parse('a_{n+1}').json).toEqual([
      'Subscript',
      'a',
      ['Add', 'n', 1],
    ]);
    expect(engine.box('a').type.toString()).toBe('unknown');
    expect(engine.parse('a_{n+1}').json).toEqual([
      'Subscript',
      'a',
      ['Add', 'n', 1],
    ]);
    expect(engine.parse('2a').json).toEqual(['Multiply', 2, 'a']);
  });

  test('a subscripted symbol keeps resolving to its value on a second use', () => {
    const engine = new ComputeEngine();
    engine.assign('k', 3);
    engine.assign('x_4', 7);
    expect(engine.parse('x_{k+1}').evaluate().json).toEqual(7);
    expect(engine.parse('x_{k+1}').evaluate().json).toEqual(7);
  });

  test('Matrix does not type its operand from the use', () => {
    const engine = new ComputeEngine();
    engine.box(['Matrix', 'M']);
    expect(engine.box('M').type.toString()).toBe('unknown');
  });
});
