import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// CE-1850: the truth-table functions analyze a propositional formula: `True`,
// `False`, symbols and connectives. A formula with another operand (a
// comparison, a quantifier) stays unevaluated, because the symbols of that
// operand are not truth values.

const ce = new ComputeEngine();

type Json = MathJsonExpression;

const evaluate = (expr: Json): Json => ce.expr(expr).evaluate().json;

const ANALYSES = [
  'IsSatisfiable',
  'IsTautology',
  'TruthTable',
  'PrimeImplicants',
  'PrimeImplicates',
  'MinimalDNF',
  'MinimalCNF',
];

describe('a formula with a comparison stays unevaluated', () => {
  test.each(ANALYSES)('%s(x > 0)', (name) => {
    expect(evaluate([name, ['Greater', 'x', 0]])).toEqual([
      name,
      ['Less', 0, 'x'],
    ]);
  });

  // With `x > 0` and `x <= 0` read as two independent truth values, the
  // answer would be `False`. The formula is true for every real `x`.
  test('IsTautology(x > 0 || x <= 0) is not False', () => {
    const formula: Json = ['Or', ['Greater', 'x', 0], ['LessEqual', 'x', 0]];
    expect(evaluate(['IsTautology', formula])).toEqual([
      'IsTautology',
      ['Or', ['Less', 0, 'x'], ['LessEqual', 'x', 0]],
    ]);
  });

  test('a comparison below a connective', () => {
    expect(
      evaluate(['IsSatisfiable', ['And', 'P', ['Not', ['Equal', 'x', 1]]]])
    ).toEqual(['IsSatisfiable', ['And', 'P', ['Not', ['Equal', 'x', 1]]]]);
  });

  test('the LaTeX route', () => {
    const expr = ce.parse('\\operatorname{IsSatisfiable}(x > 0)');
    expect(expr.evaluate().json).toEqual(['IsSatisfiable', ['Less', 0, 'x']]);
  });

  test('a quantifier that is not decided', () => {
    const formula: Json = ['Exists', 'y', ['Greater', 'y', 0]];
    expect(evaluate(['IsSatisfiable', formula])).toEqual([
      'IsSatisfiable',
      ['Exists', 'y', ['Less', 0, 'y']],
    ]);
  });
});

describe('a propositional formula is analyzed', () => {
  // The operand is evaluated first, so a comparison with a known value is a
  // truth value when the analysis starts.
  test('a comparison that evaluates to a truth value', () => {
    expect(evaluate(['IsSatisfiable', ['And', 'P', ['Less', 1, 2]]])).toBe(
      'True'
    );
    expect(evaluate(['IsSatisfiable', ['And', 'P', ['Less', 2, 1]]])).toBe(
      'False'
    );
  });

  test('every connective', () => {
    // Nand(P, Q) ↔ (P → ¬Q), and Nor(P, Q) ↔ ¬(P ∨ Q)
    expect(
      evaluate([
        'IsTautology',
        ['Equivalent', ['Nand', 'P', 'Q'], ['Implies', 'P', ['Not', 'Q']]],
      ])
    ).toBe('True');
    expect(
      evaluate([
        'IsTautology',
        ['Equivalent', ['Nor', 'P', 'Q'], ['Not', ['Or', 'P', 'Q']]],
      ])
    ).toBe('True');
    expect(
      evaluate(['IsSatisfiable', ['And', ['Xor', 'P', 'Q'], 'P', 'Q']])
    ).toBe('False');
  });

  test('TruthTable(P → Q)', () => {
    expect(evaluate(['TruthTable', ['Implies', 'P', 'Q']])).toEqual([
      'List',
      ['List', "'P'", "'Q'", "'Result'"],
      ['List', 'False', 'False', 'True'],
      ['List', 'False', 'True', 'True'],
      ['List', 'True', 'False', 'False'],
      ['List', 'True', 'True', 'True'],
    ]);
  });
});
