import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

/**
 * ROADMAP CE-596 (Tycho ledger row 472).
 *
 * `Together(g(t) + g(t))`, with `g` undeclared, gave `0 / Error("missing")`,
 * and `Factor` and `Cancel` of the same sum returned `g(t) + g(t)`, where
 * `evaluate()` of the sum gives `2g(t)`.
 *
 * Two causes:
 *
 * 1. `together()` reads the numerator and the denominator of each term. For
 *    a term that is not known to be a number, both are the symbol `Nothing`.
 *    The test that should keep such a term whole compared the `operator` of
 *    the result with `'Nothing'`, but the operator of a symbol is `'Symbol'`,
 *    so the test never matched and the sum became `Nothing / Nothing`.
 *
 * 2. The like-term collection of the transformers did not merge a term that
 *    is not pure, and a call of an undeclared function has unknown effects,
 *    so it is not pure. The evaluation of `Add` merges such calls, so now the
 *    transformers do too. A term with a known effect (a `random` call) is
 *    still kept apart.
 */

const ce = new ComputeEngine();
ce.declare('r', {
  signature: '(number) random -> number',
  drawsRandom: true,
} as any);

const g = (x: MathJsonExpression = 't'): MathJsonExpression => ['g', x];
const h = (x: MathJsonExpression = 't'): MathJsonExpression => ['h', x];

const OPERATORS = ['Together', 'Factor', 'Cancel'];

describe('CE-596: calls of an undeclared function are collected', () => {
  const cases: [string, MathJsonExpression, MathJsonExpression][] = [
    ['g(t) + g(t)', ['Add', g(), g()], ['Multiply', 2, g()]],
    ['g(t) + 2g(t)', ['Add', g(), ['Multiply', 2, g()]], ['Multiply', 3, g()]],
    [
      'g(t) + h(t) + g(t)',
      ['Add', g(), h(), g()],
      ['Add', ['Multiply', 2, g()], h()],
    ],
  ];
  for (const op of OPERATORS) {
    test.each(cases)(`${op}(%s)`, (_, input, expected) => {
      const result = ce.box([op, input]).evaluate();
      expect(result.isValid).toBe(true);
      expect(result.json).toEqual(expected);
      // The same value as the evaluated sum.
      expect(result.isSame(ce.box(input).evaluate())).toBe(true);
    });
  }

  test('the values agree for a function given later', () => {
    // Each result, with `g` and `h` then given a value, has the value of the
    // sum it came from.
    const results = cases.flatMap(([, input]) =>
      OPERATORS.map((op) => [input, ce.box([op, input]).evaluate()] as const)
    );
    const ce2 = new ComputeEngine();
    ce2.declare('g', 'function');
    ce2.assign('g', ce2.box(['Function', ['Sin', 'x'], 'x']));
    ce2.declare('h', 'function');
    ce2.assign('h', ce2.box(['Function', ['Exp', 'x'], 'x']));
    for (const [input, result] of results)
      for (const t of [0.37, 1.41, -2.9]) {
        const a = ce2.box(input).subs({ t }).N().re;
        const b = ce2.box(result.json).subs({ t }).N().re;
        expect(Number.isFinite(a)).toBe(true);
        expect(b).toBeCloseTo(a, 9);
      }
  });

  test('Together keeps a call whole beside a fraction', () => {
    // `g(t) + 1/x` is `(x·g(t) + 1)/x`; before the fix the call was read as
    // `Nothing/Nothing`.
    const result = ce
      .box(['Together', ['Add', g(), ['Divide', 1, 'x']]])
      .evaluate();
    expect(result.isValid).toBe(true);
    expect(result.json).toEqual([
      'Divide',
      ['Add', ['Multiply', 'x', g()], 1],
      'x',
    ]);
  });
});

describe('CE-596: a term with a known effect is not collected', () => {
  test.each(OPERATORS)('%s(r(t) + r(t)) with r drawing', (op) => {
    const input: MathJsonExpression = ['Add', ['r', 't'], ['r', 't']];
    expect(ce.box([op, input]).evaluate().json).toEqual(input);
  });

  test.each(OPERATORS)('%s(g(Random()) + g(Random()))', (op) => {
    // The call of `g` has unknown effects, but its operand draws.
    const input: MathJsonExpression = ['Add', g(['Random']), g(['Random'])];
    expect(ce.box([op, input]).evaluate().json).toEqual(input);
  });

  test.each(OPERATORS)('%s(Random() + Random())', (op) => {
    const input: MathJsonExpression = ['Add', ['Random'], ['Random']];
    expect(ce.box([op, input]).evaluate().json).toEqual(input);
  });

  test.each(OPERATORS)(
    '%s(r(u) + r(u)) with r drawing and u of unknown effects',
    (op) => {
      // The join of the head's `random` and the callback's unknown effects
      // is unknown; the head's own effect must still refuse the merge.
      const ce2 = new ComputeEngine();
      ce2.declare('r', { type: '(function) random -> number' });
      ce2.declare('u', { type: '(number) any -> number' });
      const input: MathJsonExpression = ['Add', ['r', 'u'], ['r', 'u']];
      expect(ce2.box([op, input]).evaluate().json).toEqual(input);
    }
  );

  test('Together keeps two equal denominators that draw apart', () => {
    // `1/Random() + 1/Random()` is not `2/Random()`: the two draws differ.
    const result = ce
      .box([
        'Together',
        ['Add', ['Divide', 1, ['Random']], ['Divide', 1, ['Random']]],
      ])
      .evaluate();
    expect(result.toString()).not.toBe('2 / Random()');
    expect(JSON.stringify(result.json).split('"Random"').length - 1).toBe(2);
  });
});
