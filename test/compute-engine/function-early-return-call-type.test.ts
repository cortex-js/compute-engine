import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// A function assigned to a name becomes an operator definition, whose
// signature is derived from the literal. The result of that signature is the
// join of the type of the last value of the body and of the types of the
// values of each `Return` before it, as in the type of the literal itself.
// Without the join, `g(x)` was typed `number` although `g(2)` is a point.
// (CE-737)

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  return ce;
}

const fn = (body: MathJsonExpression): MathJsonExpression => [
  'Function',
  body,
  'y',
];

const POINT_OR_NUMBER = fn([
  'Block',
  ['If', ['Greater', 'y', 1], ['Return', ['Tuple', 'y', 'y']]],
  ['Add', 'y', 1],
]);

describe('CE-737: the type of a call of a function with an early Return', () => {
  test('the call is typed with the value of the Return', () => {
    const ce = engine();
    ce.assign('g', ce.box(POINT_OR_NUMBER));
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('(2, 2)');
    expect(ce.box(['g', 0.5]).evaluate().toString()).toBe('1.5');
    expect(ce.box(['g', 'x']).type.toString()).toBe(
      'number | tuple<number, number>'
    );
  });

  test('the signature agrees with the type of the literal', () => {
    const ce = engine();
    const literal = ce.box(POINT_OR_NUMBER);
    ce.assign('g', literal);
    expect(ce.box('g').type.toString()).toBe(literal.type.toString());
  });

  test('an expression that reads the call does not treat it as a number', () => {
    const ce = engine();
    ce.assign('g', ce.box(POINT_OR_NUMBER));
    expect(ce.box(['Multiply', 2, ['g', 'x']]).type.matches('number')).toBe(
      false
    );
  });

  test('a Return with no operand adds `nothing` to the result', () => {
    const ce = engine();
    ce.assign(
      'g',
      ce.box(
        fn([
          'Block',
          ['If', ['Greater', 'y', 1], ['Return']],
          ['Multiply', 2, 'y'],
        ])
      )
    );
    expect(ce.box(['g', 2]).evaluate().symbol).toBe('Nothing');
    expect(ce.box(['g', 'x']).type.toString()).toBe('nothing | number');
  });

  test('a function with no Return keeps the type of its last value', () => {
    const ce = engine();
    ce.assign('h', ce.box(fn(['Block', ['Add', 'y', 1]])));
    expect(ce.box(['h', 'x']).type.toString()).toBe('number');
  });

  test('a Return of a nested literal does not change the result', () => {
    // The inner literal returns a list; `g` itself always gives a number.
    const ce = engine();
    ce.assign(
      'g',
      ce.box(
        fn([
          'Block',
          [
            'Declare',
            'k',
            "'unknown'",
            [
              'Function',
              [
                'Block',
                ['If', ['Greater', 't', 1], ['Return', ['List', 't', 't']]],
                ['List', 't'],
              ],
              't',
            ],
          ],
          ['Add', 'y', 1],
        ])
      )
    );
    expect(ce.box(['g', 'x']).type.toString()).toBe('number');
  });
});
