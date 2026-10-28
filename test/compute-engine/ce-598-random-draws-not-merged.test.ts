import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

/**
 * ROADMAP CE-598.
 *
 * Two draws are two independent values. The like-term collection of `Add`
 * and `Multiply` merged them: `Random() + Random()` simplified to
 * `2Random()`, `Random()·Random()` to `Random()²`, and with `r` declared
 * with the `random` effect, `r(t) + r(t)` evaluated to `2r(t)`. A merge
 * changes the distribution of the result.
 *
 * The like-term collections now ask `isMergeable()`
 * (`boxed-expression/effects-of.ts`) before they merge two terms that are
 * the same. A term with a stated or computed effect (a draw) is not merged.
 * A pure term and a call of an undeclared function (unknown effects) are
 * merged as before.
 *
 * The assertions count the nodes of the draw head in the result, not the
 * values, which are random.
 */

const ce = new ComputeEngine();
ce.declare('r', { signature: '(number) random -> number' });

/** The number of nodes with the operator `head` in a MathJSON expression. */
function countHead(json: unknown, head: string): number {
  if (!Array.isArray(json)) return 0;
  return (
    (json[0] === head ? 1 : 0) +
    json.slice(1).reduce((n: number, x: unknown) => n + countHead(x, head), 0)
  );
}

const R: MathJsonExpression = ['Random'];
const rt: MathJsonExpression = ['r', 't'];

describe('CE-598: two draws are not merged by simplify()', () => {
  const cases: [string, MathJsonExpression, string, number][] = [
    ['Random() + Random()', ['Add', R, R], 'Random', 2],
    [
      'Random(1..6) + Random(1..6)',
      ['Add', ['Random', ['Range', 1, 6]], ['Random', ['Range', 1, 6]]],
      'Random',
      2,
    ],
    ['r(t) + r(t)', ['Add', rt, rt], 'r', 2],
    ['Random() − Random()', ['Subtract', R, R], 'Random', 2],
    ['2Random() + Random()', ['Add', ['Multiply', 2, R], R], 'Random', 2],
    ['Random()·Random()', ['Multiply', R, R], 'Random', 2],
    ['r(t)·r(t)', ['Multiply', rt, rt], 'r', 2],
    ['Random()²·Random()', ['Multiply', ['Power', R, 2], R], 'Random', 2],
    ['Random()/Random()', ['Divide', R, R], 'Random', 2],
    ['r(t)/r(t)', ['Divide', rt, rt], 'r', 2],
    ['g(Random()) + g(Random())', ['Add', ['g', R], ['g', R]], 'Random', 2],
    [
      'x·Random() + y·Random()',
      ['Add', ['Multiply', 'x', R], ['Multiply', 'y', R]],
      'Random',
      2,
    ],
    [
      'sin²(Random()) + cos²(Random())',
      ['Add', ['Power', ['Sin', R], 2], ['Power', ['Cos', R], 2]],
      'Random',
      2,
    ],
    [
      '2sin(Random())cos(Random())',
      ['Multiply', 2, ['Sin', R], ['Cos', R]],
      'Random',
      2,
    ],
    [
      'sin(r(t))cos(y) + cos(r(t))sin(y)',
      [
        'Add',
        ['Multiply', ['Sin', rt], ['Cos', 'y']],
        ['Multiply', ['Cos', rt], ['Sin', 'y']],
      ],
      'r',
      2,
    ],
    ['ln(r(t)) − ln(r(t))', ['Subtract', ['Ln', rt], ['Ln', rt]], 'r', 2],
    ['tan(r(t))·cot(r(t))', ['Multiply', ['Tan', rt], ['Cot', rt]], 'r', 2],
    ['cot(r(t))·tan(r(t))', ['Multiply', ['Cot', rt], ['Tan', rt]], 'r', 2],
    [
      '−sin²(r(t)) − cos²(r(t))',
      [
        'Add',
        ['Negate', ['Power', ['Sin', rt], 2]],
        ['Negate', ['Power', ['Cos', rt], 2]],
      ],
      'r',
      2,
    ],
    ['Log(r(t), r(t))', ['Log', rt, rt], 'r', 2],
    ['Log(r(t)³, r(t))', ['Log', ['Power', rt, 3], rt], 'r', 2],
    ['Log(r(t), c)/Ln(r(t))', ['Divide', ['Log', rt, 'c'], ['Ln', rt]], 'r', 2],
    ['Ln(r(t))/Log(r(t), c)', ['Divide', ['Ln', rt], ['Log', rt, 'c']], 'r', 2],
    [
      'Log(a, r(t))/Log(b, r(t))',
      ['Divide', ['Log', 'a', rt], ['Log', 'b', rt]],
      'r',
      2,
    ],
  ];
  test.each(cases)('%s', (_, expr, head, n) => {
    expect(countHead(ce.box(expr).simplify().json, head)).toBe(n);
  });
});

describe('CE-598: two draws are not merged by evaluate()', () => {
  test('r(t) + r(t)', () => {
    expect(countHead(ce.box(['Add', rt, rt]).evaluate().json, 'r')).toBe(2);
  });
  test('r(t)·r(t)', () => {
    expect(countHead(ce.box(['Multiply', rt, rt]).evaluate().json, 'r')).toBe(
      2
    );
  });
  test('r(t) − r(t) is not 0', () => {
    expect(countHead(ce.box(['Subtract', rt, rt]).evaluate().json, 'r')).toBe(
      2
    );
  });
  test('g(Random()) + g(Random()) draws twice', () => {
    expect(
      countHead(ce.box(['Add', ['g', R], ['g', R]]).evaluate().json, 'g')
    ).toBe(2);
  });
});

describe('CE-598: Factor does not read two draws as one value', () => {
  test('r(t)² + 2r(t) + 1 is not (r(t) + 1)²', () => {
    const expr: MathJsonExpression = [
      'Factor',
      ['Add', ['Power', rt, 2], ['Multiply', 2, rt], 1],
    ];
    expect(countHead(ce.box(expr).evaluate().json, 'r')).toBe(2);
  });

  test('a factor that draws is not divided out of both sides of a relation', () => {
    // The draw on each side is independent: dividing both sides by it would
    // add a new draw to each side (`x·e^R·e^(-R) = y·e^R·e^(-R)`).
    const expo: MathJsonExpression = ['Exp', R];
    const expr: MathJsonExpression = [
      'Factor',
      ['Equal', ['Multiply', 'x', expo], ['Multiply', 'y', expo]],
    ];
    expect(countHead(ce.box(expr).evaluate().json, 'Random')).toBe(2);
  });
});

describe('CE-598: pure terms and undeclared calls still merge', () => {
  const cases: [string, MathJsonExpression, MathJsonExpression][] = [
    ['x + x', ['Add', 'x', 'x'], ['Multiply', 2, 'x']],
    [
      'g(t) + g(t)',
      ['Add', ['g', 't'], ['g', 't']],
      ['Multiply', 2, ['g', 't']],
    ],
    [
      'sin(t) + sin(t)',
      ['Add', ['Sin', 't'], ['Sin', 't']],
      ['Multiply', 2, ['Sin', 't']],
    ],
    ['x·x', ['Multiply', 'x', 'x'], ['Power', 'x', 2]],
    [
      'g(t)·g(t)',
      ['Multiply', ['g', 't'], ['g', 't']],
      ['Power', ['g', 't'], 2],
    ],
  ];
  test.each(cases)('%s', (_, expr, expected) => {
    expect(ce.box(expr).simplify().json).toEqual(expected);
    expect(ce.box(expr).evaluate().json).toEqual(expected);
  });
  test('sin²(t) + cos²(t) is 1', () => {
    expect(
      ce
        .box(['Add', ['Power', ['Sin', 't'], 2], ['Power', ['Cos', 't'], 2]])
        .simplify().json
    ).toEqual(1);
  });
});

describe('CE-598: only simplify() refuses a repeated wildcard that captured a draw', () => {
  // The public `match()` and `replace()` stay structural: two occurrences
  // of a term with an effect match a repeated wildcard.
  test('match() of f(Print(1), Print(1)) against f(_x, _x)', () => {
    const sub = ce
      .box(['f', ['Print', 1], ['Print', 1]])
      .match(['f', '_x', '_x']);
    expect(sub).not.toBeNull();
    expect(sub?._x?.json).toEqual(['Print', 1]);
  });

  test('match() with a preset substitution that holds a draw', () => {
    const sub = ce
      .box(['Sin', R])
      .match(['Sin', '_x'], { substitution: { _x: ce.box(R) } });
    expect(sub).not.toBeNull();
  });

  test('replace() of f(Random(), Random()) with f(_x, _x) -> h(_x)', () => {
    const result = ce
      .box(['f', R, R])
      .replace({ match: ['f', '_x', '_x'], replace: ['h', '_x'] });
    expect(result?.json).toEqual(['h', ['Random']]);
  });

  test('simplify() with the rule f(_x, _x) -> h(_x) keeps both draws', () => {
    const result = ce.box(['f', R, R]).simplify({
      rules: [{ match: ['f', '_x', '_x'], replace: ['h', '_x'] }],
    });
    expect(countHead(result.json, 'Random')).toBe(2);
  });

  test('simplify() with the rule f(_x, _x) -> h(_x) applies to a pure term', () => {
    const result = ce.box(['f', 'x', 'x']).simplify({
      rules: [{ match: ['f', '_x', '_x'], replace: ['h', '_x'] }],
    });
    expect(result.json).toEqual(['h', 'x']);
  });
});
