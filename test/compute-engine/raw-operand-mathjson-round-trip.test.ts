import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

/**
 * A raw operand of a canonical node (the pattern and the guard of a
 * `MatchCase`, the two sides of a `Rule`, the operand of `Hold`) is kept as
 * written and is read back as written. `toMathJson()` must write it as
 * authored: a pretty rewrite (`Tuple` as `Pair`, `Add(x, -1)` as
 * `Subtract(x, 1)`) would give another pattern, which matches other values
 * once the MathJSON is boxed again (CE-1119).
 */

function roundTrip(ce: ComputeEngine, json: MathJsonExpression) {
  const expr = ce.box(json);
  const pretty = expr.toMathJson();
  const reboxed = ce.box(pretty);
  return { expr, pretty, reboxed };
}

describe('RAW OPERAND: MathJSON round trip', () => {
  test('a Tuple pattern of a MatchCase keeps Tuple, and the function still applies', () => {
    const ce = new ComputeEngine();
    const { pretty, reboxed } = roundTrip(ce, [
      'Function',
      [
        'Match',
        'u',
        ['MatchCase', ['Tuple', '_a', '_b'], ['Add', 'a', 'b']],
        ['MatchCase', '_', 0],
      ],
      'u',
    ]);
    expect(pretty).toEqual([
      'Function',
      [
        'Match',
        'u',
        ['MatchCase', ['Tuple', '_a', '_b'], ['Add', 'a', 'b']],
        ['MatchCase', '_', 0],
      ],
      'u',
    ]);
    const applied = ce
      .box(['Apply', reboxed.json, ['Tuple', 1, 2]])
      .evaluate();
    expect(applied.re).toBe(3);
  });

  test('an Add pattern with a negative term keeps Add, and the Match still matches', () => {
    const ce = new ComputeEngine();
    const { expr, pretty, reboxed } = roundTrip(ce, [
      'Match',
      ['Add', 'y', -1],
      ['MatchCase', ['Add', '_x', -1], 'x'],
    ]);
    // The subject is canonical and is still written pretty; the pattern is
    // raw and is written as authored.
    expect(pretty).toEqual([
      'Match',
      ['Subtract', 'y', 1],
      ['MatchCase', ['Add', '_x', -1], 'x'],
    ]);
    expect(expr.evaluate().toString()).toBe('y');
    expect(reboxed.evaluate().toString()).toBe('y');
  });

  test('the guard of a MatchCase is written as authored', () => {
    const ce = new ComputeEngine();
    const { pretty } = roundTrip(ce, [
      'Match',
      'u',
      ['MatchCase', '_x', ['Greater', ['Add', 'x', -1], 0], ['Add', 'x', -1]],
    ]);
    expect(pretty).toEqual([
      'Match',
      'u',
      ['MatchCase', '_x', ['Greater', ['Add', 'x', -1], 0], ['Add', 'x', -1]],
    ]);
  });

  test('a Match nested in a sum keeps its pattern', () => {
    const ce = new ComputeEngine();
    const { pretty } = roundTrip(ce, [
      'Add',
      1,
      ['Match', 'u', ['MatchCase', ['Tuple', '_a', '_b'], ['Add', 'a', 'b']]],
    ]);
    // The canonical sum orders the call before the literal.
    expect(pretty).toEqual([
      'Add',
      ['Match', 'u', ['MatchCase', ['Tuple', '_a', '_b'], ['Add', 'a', 'b']]],
      1,
    ]);
  });

  test('both sides of a Rule are written as authored', () => {
    const ce = new ComputeEngine();
    const { pretty } = roundTrip(ce, [
      'Rule',
      ['f', ['Tuple', '_a', '_b']],
      ['Multiply', '_a', ['Power', '_b', -1]],
    ]);
    expect(pretty).toEqual([
      'Rule',
      ['f', ['Tuple', '_a', '_b']],
      ['Multiply', '_a', ['Power', '_b', -1]],
    ]);
  });

  test('the operand of Hold is written as authored, also inside a canonical node', () => {
    const ce = new ComputeEngine();
    const { pretty } = roundTrip(ce, [
      'Sum',
      ['Hold', ['Add', 'k', -1]],
      ['Element', 'k', ['Range', 1, 3]],
    ]);
    expect(pretty).toEqual([
      'Sum',
      ['Hold', ['Add', 'k', -1]],
      ['Element', 'k', ['Range', 1, 3]],
    ]);
  });

  test('a held form parsed from LaTeX keeps its LaTeX', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\mathrm{Hold}(x - 1)').latex).toBe('\\mathrm{Hold}(x-1)');
    expect(ce.box(['Hold', ['Multiply', 'x', ['Power', 'y', -1]]]).latex).toBe(
      '\\mathrm{Hold}(\\frac{x}{y})'
    );
  });

  test('a canonical operand next to a raw one is still written pretty', () => {
    const ce = new ComputeEngine();
    const { pretty } = roundTrip(ce, [
      'Block',
      ['Declare', ['Tuple', 'a', 'b'], "'unknown'", ['Tuple', 1, 2]],
      ['Add', 'a', 'b'],
    ]);
    expect(pretty).toEqual([
      'Block',
      ['Declare', ['Tuple', 'a', 'b'], "'unknown'", ['Pair', 1, 2]],
      ['Add', 'a', 'b'],
    ]);
  });

  test('a raw sum keeps its operand order and its nesting', () => {
    const ce = new ComputeEngine();
    const { pretty } = roundTrip(ce, [
      'Match',
      'u',
      ['MatchCase', ['Add', -1, '_a', ['Add', '_b', 1]], 'a'],
    ]);
    expect(pretty).toEqual([
      'Match',
      'u',
      ['MatchCase', ['Add', -1, '_a', ['Add', '_b', 1]], 'a'],
    ]);
  });

  test('a canonical denominator next to a held operand is still written pretty', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Divide',
      ['Hold', ['Add', 'q', -1]],
      ['Multiply', ['Add', 'y', -1], 'z'],
    ]);
    expect(expr.toMathJson()).toEqual([
      'Divide',
      ['Hold', ['Add', 'q', -1]],
      ['Multiply', 'z', ['Subtract', 'y', 1]],
    ]);
  });

  test('a structural root keeps the Tuple parameter of a Function', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Function', ['Add', 'x', 'y'], ['Tuple', 'x', 'y']]);
    expect(expr.structural.toMathJson()).toEqual([
      'Function',
      ['Add', 'x', 'y'],
      ['Tuple', 'x', 'y'],
    ]);
  });

  test('a function literal in a dictionary value keeps its pattern', () => {
    const ce = new ComputeEngine();
    const { pretty } = roundTrip(ce, [
      'Dictionary',
      [
        'KeyValuePair',
        { str: 'f' },
        [
          'Function',
          ['Match', 'u', ['MatchCase', ['Tuple', '_a', '_b'], ['Add', 'a', 'b']]],
          'u',
        ],
      ],
    ]);
    expect(pretty).toEqual([
      'Dictionary',
      [
        'KeyValuePair',
        { str: 'f' },
        [
          'Function',
          ['Match', 'u', ['MatchCase', ['Tuple', '_a', '_b'], ['Add', 'a', 'b']]],
          'u',
        ],
      ],
    ]);
  });

  test('a canonical Match inside a raw root keeps its pattern', () => {
    const ce = new ComputeEngine();
    const match = ce.box([
      'Match',
      'u',
      ['MatchCase', ['Tuple', '_a', '_b'], ['Add', 'a', 'b']],
    ]);
    const rawList = ce.function('List', [match], { form: 'raw' });
    expect(rawList.toMathJson()).toEqual([
      'List',
      ['Match', 'u', ['MatchCase', ['Tuple', '_a', '_b'], ['Add', 'a', 'b']]],
    ]);
  });

  test('a non-canonical root keeps the rewrites of a verbatim tree', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Tuple', ['Add', 'x', -1], 'b'], { canonical: false });
    expect(expr.toMathJson()).toEqual(['Tuple', ['Subtract', 'x', 1], 'b']);
  });
});
