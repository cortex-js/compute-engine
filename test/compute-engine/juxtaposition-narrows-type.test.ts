/**
 * A product written by juxtaposition narrows the type of its valueless
 * symbols as the explicit `Multiply` does (ROADMAP CE-32, user decision
 * 2026-10-25). Before, `ce.parse('2t')` left `t` typed `unknown`, while
 * `ce.parse('2\\cdot t')` made it a `number`. Only the types change: the
 * structure, the order of the factors and the LaTeX of the product are the
 * same. A juxtaposition that is a function application keeps its reading.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// The type of the first occurrence of `name` in `expr`: the requirements of
// the uses are read by the occurrences of the same expression.
function typeOf(expr: Expression, name: string): string | undefined {
  if (expr.symbol === name) return expr.type.toString();
  for (const op of expr.ops ?? []) {
    const t = typeOf(op, name);
    if (t !== undefined) return t;
  }
  return undefined;
}

// The type that `ce.infer()` commits for the head `name` of a call in `expr`.
function headType(ce: ComputeEngine, expr: Expression, name: string) {
  return ce
    .infer([expr])
    .declared.find((d) => d.name === name)
    ?.type.toString();
}

describe('CE-32: A JUXTAPOSED PRODUCT NARROWS ITS VALUELESS SYMBOLS', () => {
  test.each([
    ['x y', ['x', 'y'], ['Multiply', 'x', 'y'], 'xy'],
    ['2t', ['t'], ['Multiply', 2, 't'], '2t'],
    ['2\\pi r', ['r'], ['Multiply', 2, 'Pi', 'r'], '2\\pi r'],
  ])('parse %s', (latex, symbols, json, out) => {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    expect(expr.json).toEqual(json);
    expect(expr.latex).toBe(out);
    for (const s of symbols)
      expect([s, typeOf(expr, s)]).toEqual([s, 'number']);
  });

  test('the box route with an InvisibleOperator', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['InvisibleOperator', 2, 't']);
    expect(expr.json).toEqual(['Multiply', 2, 't']);
    expect(typeOf(expr, 't')).toBe('number');
  });

  test('a juxtaposition in parentheses narrows its factors too', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('3(b c)');
    expect(expr.json).toEqual(['Multiply', 3, 'b', 'c']);
    expect(typeOf(expr, 'b')).toBe('number');
    expect(typeOf(expr, 'c')).toBe('number');
  });

  test('the type of a function literal is the one of the \\cdot spelling', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('t \\mapsto (t, 2t)').type.toString()).toBe(
      ce.parse('t \\mapsto (t, 2\\cdot t)').type.toString()
    );
    expect(ce.parse('t \\mapsto (t, 2t)').type.toString()).toBe(
      '(t: unknown) -> tuple<number, number>'
    );
  });

  test('a function application keeps its reading', () => {
    const ce = new ComputeEngine();
    const fx = ce.parse('f(x)');
    expect(fx.json).toEqual(['f', 'x']);
    expect(typeOf(fx, 'x')).toBe('unknown');
    expect(headType(ce, fx, 'f')).toBe('function');
    // The argument of the application is a product, and its factors are
    // narrowed; the head stays a function.
    const gbc = ce.parse('g(b c)');
    expect(gbc.json).toEqual(['g', ['Multiply', 'b', 'c']]);
    expect(typeOf(gbc, 'b')).toBe('number');
    expect(headType(ce, gbc, 'g')).toBe('function');
  });
});
