/**
 * A symbol whose stored value is an impure expression (`r` holds a call of
 * an impure function, such as a random draw) is read once for each
 * occurrence of the symbol, under `evaluate()` and under `.N()`.
 *
 * `isPure` of a symbol is always true, and an impure stored value is not
 * remembered between reads (each read is a new evaluation, like a delayed
 * definition). So a numeric route that evaluated an operand and then read
 * the raw symbol again (`.N()` of the symbol, or an exact evaluation near a
 * jump or after an overflow) evaluated the stored value two times: `2r`
 * drew two numbers, and the product used only the second one.
 *
 * Each test counts the calls of the impure function.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();
let drawCount = 0;
let drawValue = 0.5;
ce.declare('draw', {
  signature: '() -> real',
  pure: false,
  evaluate: () => {
    drawCount += 1;
    return ce.number(drawValue);
  },
});
ce.assign('r', ce.box(['draw']));

/** Evaluate `expr` with `run` and return the number of draws and the result. */
function draws(
  expr: MathJsonExpression,
  run: (e: ReturnType<typeof ce.box>) => ReturnType<typeof ce.box> = (e) =>
    e.N(),
  value = 0.5
): [number, string] {
  drawValue = value;
  drawCount = 0;
  const result = run(ce.box(expr)).toString();
  return [drawCount, result];
}

describe('IMPURE STORED VALUE: ONE READ FOR EACH OCCURRENCE UNDER N()', () => {
  test.each<[string, MathJsonExpression, string]>([
    ['the symbol', 'r', '0.5'],
    ['a product', ['Multiply', 2, 'r'], '1'],
    ['a sum', ['Add', 'r', 'Pi'], '3.64159265358979323846'],
    ['a product with a constant', ['Multiply', 'r', 'Pi'], '1.57079632679489661923'],
    ['a product with an unknown', ['Multiply', 'r', 'x'], '0.5 * x'],
    ['a sum with an unknown', ['Add', 'r', 'x'], 'x + 0.5'],
    ['a quotient', ['Divide', 'r', 3], '0.166666666666666666667'],
    ['a difference', ['Subtract', 'r', 1], '-0.5'],
    ['a negation', ['Negate', 'r'], '-0.5'],
    ['a power', ['Power', 'r', 2], '0.25'],
    ['a nested sum and product', ['Add', ['Multiply', 2, 'r'], 1], '2'],
    ['a function', ['Sin', 'r'], '0.479425538604203000273'],
    ['a rounding', ['Round', 'r'], '1'],
    ['an equation', ['Equal', 'r', 0.5], '"True"'],
  ])('%s', (_name, expr, expected) => {
    expect(draws(expr)).toEqual([1, expected]);
  });

  test('two occurrences are two reads', () => {
    expect(draws(['List', 'r', 'r'])).toEqual([2, '[0.5,0.5]']);
  });

  test('N with a precision', () => {
    expect(draws(['N', ['Multiply', 2, 'r'], 30], (e) => e.evaluate())).toEqual(
      [1, '1']
    );
  });

  test('evaluate with numericApproximation', () => {
    expect(
      draws(['Multiply', 2, 'r'], (e) =>
        e.evaluate({ numericApproximation: true })
      )
    ).toEqual([1, '1']);
    expect(
      draws(['Add', 'r', 'Pi'], (e) =>
        e.evaluate({ numericApproximation: true })
      )
    ).toEqual([1, '3.64159265358979323846']);
  });

  test('evaluateAsync with numericApproximation', async () => {
    drawCount = 0;
    drawValue = 0.5;
    const result = await ce
      .box(['Multiply', 2, 'r'])
      .evaluateAsync({ numericApproximation: true });
    expect([drawCount, result.toString()]).toEqual([1, '1']);
  });

  test('evaluate() of a product and a sum', () => {
    expect(draws(['Multiply', 2, 'r'], (e) => e.evaluate())).toEqual([1, '1']);
    expect(draws(['Add', 'r', 'Pi'], (e) => e.evaluate())[0]).toBe(1);
  });
});

describe('IMPURE STORED VALUE: VALUES THAT ARE IMPURE THROUGH WHAT THEY READ', () => {
  test('a stored value that reads an impure symbol', () => {
    ce.assign('s', ce.box(['Add', 'r', 1]));
    expect(draws(['Multiply', 2, 's'])).toEqual([1, '3']);
    expect(draws(['Add', 's', 'Pi'])).toEqual([1, '4.64159265358979323846']);
  });

  test('a stored value that calls a function with an impure body', () => {
    ce.assign('g', ce.parse('x \\mapsto x \\cdot \\operatorname{draw}()'));
    ce.assign('q', ce.box(['g', 2]));
    expect(draws(['Multiply', 2, 'q'])).toEqual([1, '2']);
  });
});

describe('IMPURE STORED VALUE: NO EXACT RE-EVALUATION OF AN IMPURE OPERAND', () => {
  // A float of 0 or ±∞ makes the numeric routes evaluate a pure operand
  // again exactly (the double of `10^{400}` is ∞). An impure operand must not
  // be evaluated again.
  test('a draw of 0 in a product and a sum', () => {
    expect(draws(['Multiply', 2, 'r'], undefined, 0)).toEqual([1, '0']);
    expect(draws(['Add', 'r', 1], undefined, 0)).toEqual([1, '1']);
  });

  test('a draw of +∞ in a Sum and a Product: one read for each term', () => {
    expect(
      draws(['Sum', 'r', ['Limits', 'k', 1, 3]], undefined, Infinity)
    ).toEqual([3, '+oo']);
    expect(
      draws(['Product', 'r', ['Limits', 'k', 1, 3]], undefined, Infinity)
    ).toEqual([3, '+oo']);
  });

  test('a lazy broadcast of a rounding over an impure collection', () => {
    ce.assign('B', ce.box(['Add', ['Range', 1, 300], ['draw']]));
    const [count, result] = draws(['Floor', 'B'], undefined, 2);
    expect(count).toBe(1);
    expect(result.startsWith('[3,4,5')).toBe(true);
  });
});

describe('PURE STORED VALUE: THE MEMO IS KEPT', () => {
  test('a second N() of a product does not evaluate the value again', () => {
    const engine = new ComputeEngine();
    let calls = 0;
    engine.declare('heavy', {
      signature: '(real) -> real',
      pure: true,
      evaluate: ([x]) => {
        calls += 1;
        return engine.number(x.re * 3);
      },
    });
    engine.assign('p', engine.box(['heavy', ['Sqrt', 2]]));
    const first = engine.box(['Multiply', 2, 'p']).N().re;
    const afterFirst = calls;
    const second = engine.box(['Multiply', 2, 'p']).N().re;
    expect(second).toBe(first);
    expect(calls - afterFirst).toBe(0);
  });
});
