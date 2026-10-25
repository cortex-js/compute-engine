import { ComputeEngine } from '../../src/compute-engine';

/**
 * CE-102. With `c: list<integer> | string` holding `"aab"`, a view over `c`
 * whose type admits a string evaluates to a string (`Dedup(c)` is `"ab"`).
 * The display preview (`toString()`, `latex`) of the unevaluated view walked
 * the view over the symbol and printed the characters as a list
 * (`["a","b"]`). The preview now reads the string the symbol holds, so it
 * prints the value that the evaluation gives.
 */

const ce = new ComputeEngine();
ce.declare('c', 'list<integer> | string');
ce.assign('c', ce.string('aab'));

const NOT_B = ['Function', ['NotEqual', 'x', { str: 'b' }], 'x'];

describe('CE-102: the preview of a view over a symbol that holds a string', () => {
  test.each([
    [['Dedup', 'c'], '"ab"'],
    [['Reverse', 'c'], '"baa"'],
    [['Filter', 'c', NOT_B], '"aa"'],
    [['Dedup', ['Filter', 'c', NOT_B]], '"a"'],
  ])('%j', (json, expected) => {
    const expr = ce.box(json as any);
    expect(expr.toString()).toBe(expected);
    expect(expr.evaluate().toString()).toBe(expected);
  });

  test('the LaTeX preview of Dedup(c)', () => {
    expect(ce.box(['Dedup', 'c']).latex).toBe('\\text{ab}');
  });

  test('the parse route', () => {
    const expr = ce.parse('\\operatorname{Dedup}(c)');
    expect(expr.toString()).toBe('"ab"');
  });

  test('the asynchronous evaluation', async () => {
    expect((await ce.box(['Reverse', 'c']).evaluateAsync()).toString()).toBe(
      '"baa"'
    );
  });

  test('a symbol of the same type that holds a list is still a list', () => {
    ce.declare('d', 'list<integer> | string');
    ce.assign('d', ce.box(['List', 1, 2, 2]));
    expect(ce.box(['Dedup', 'd']).toString()).toBe('[1,2]');
  });
});
