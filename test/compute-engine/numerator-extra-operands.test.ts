import { ComputeEngine } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { BoxedType } from '../../src/common/type/boxed-type';

const ce = new ComputeEngine();

// The shortcuts of `Numerator`, `Denominator` and `NumeratorDenominator`
// (a `Divide` or `Rational` call, and a rational number literal) apply to a
// one-operand call only. A call with more operands keeps them, so a handler
// that takes options (an extension of the operator) still sees them.
describe('Numerator, Denominator and NumeratorDenominator keep extra operands', () => {
  test.each([
    [
      ['Numerator', ['Divide', 'a', 'b'], 'x'],
      ['Numerator', ['Divide', 'a', 'b'], 'x'],
    ],
    [
      ['Denominator', ['Divide', 'a', 'b'], 'x'],
      ['Denominator', ['Divide', 'a', 'b'], 'x'],
    ],
    [
      ['NumeratorDenominator', ['Divide', 'a', 'b'], 'x'],
      ['NumeratorDenominator', ['Divide', 'a', 'b'], 'x'],
    ],
    // A rational number literal takes a second shortcut in `Denominator` and
    // `NumeratorDenominator`; it is held back the same way.
    [
      ['Denominator', 5, 'x'],
      ['Denominator', 5, 'x'],
    ],
    [
      ['Denominator', ['Rational', 3, 4], 'x'],
      ['Denominator', ['Rational', 3, 4], 'x'],
    ],
    [
      ['NumeratorDenominator', 5, 'x'],
      ['NumeratorDenominator', 5, 'x'],
    ],
    [
      ['NumeratorDenominator', ['Rational', 3, 4], 'x'],
      ['NumeratorDenominator', ['Rational', 3, 4], 'x'],
    ],
  ])('%j stays a call', (input, expected) => {
    expect(ce.box(input as any).json).toEqual(expected);
  });

  test('a pre-boxed rational number operand stays a call too', () => {
    expect(
      ce.function('Denominator', [ce.number([3, 4]), ce.symbol('x')]).json
    ).toEqual(['Denominator', ['Rational', 3, 4], 'x']);
    expect(
      ce.function('NumeratorDenominator', [ce.number([3, 4]), ce.symbol('x')])
        .json
    ).toEqual(['NumeratorDenominator', ['Rational', 3, 4], 'x']);
  });

  // The parse route hands the lazy handlers unbound operands; it keeps the
  // extra operand the same way.
  test.each([
    [
      '\\operatorname{Numerator}(\\frac{a}{b}, x)',
      ['Numerator', ['Divide', 'a', 'b'], 'x'],
    ],
    [
      '\\operatorname{Denominator}(\\frac{a}{b}, x)',
      ['Denominator', ['Divide', 'a', 'b'], 'x'],
    ],
    ['\\operatorname{Denominator}(5, x)', ['Denominator', 5, 'x']],
    [
      '\\operatorname{NumeratorDenominator}(\\frac{a}{b}, x)',
      ['NumeratorDenominator', ['Divide', 'a', 'b'], 'x'],
    ],
    ['\\operatorname{Denominator}(\\frac{a}{b})', 'b'],
    ['\\operatorname{Denominator}(5)', 1],
  ])('parsed %s canonicalizes the same way', (latex, expected) => {
    expect(ce.parse(latex).json).toEqual(expected);
  });

  // The built-in `evaluate` handlers read the first operand only: an extra
  // operand is for a user extension that replaces the handler. The built-in
  // handler refuses the call with an `unexpected-argument` error that names
  // the surplus operand and carries the frame of the operator at its
  // position, as a declared one-parameter function refuses a second argument.
  test.each([
    [['Numerator', ['Divide', 'a', 'b'], 'x'], 'Numerator'],
    [['Numerator', 'c', 'x'], 'Numerator'],
    [['Denominator', 5, 'x'], 'Denominator'],
    [
      ['NumeratorDenominator', ['Divide', 'a', 'b'], 'x'],
      'NumeratorDenominator',
    ],
  ])('%j evaluates to an unexpected-argument error', (input, operator) => {
    const expected = [
      'Error',
      "'unexpected-argument'",
      "'x'",
      ['ErrorTrace', ['ErrorFrame', `'${operator}'`, 2]],
    ];
    expect(ce.box(input as any).evaluate().json).toEqual(expected);
    expect(ce.box(input as any).N().json).toEqual(expected);
  });

  // The refusal reaches the parse route and the asynchronous route too.
  test('a parsed call with a surplus operand evaluates to the error', () => {
    expect(
      ce.parse('\\operatorname{Numerator}(\\frac{a}{b}, x)').evaluate().json
    ).toEqual([
      'Error',
      "'unexpected-argument'",
      "'x'",
      ['ErrorTrace', ['ErrorFrame', "'Numerator'", 2]],
    ]);
  });

  test('evaluateAsync() refuses a surplus operand the same way', async () => {
    const result = await ce
      .box(['Denominator', ['Divide', 'a', 'b'], 'x'])
      .evaluateAsync();
    expect(result.json).toEqual([
      'Error',
      "'unexpected-argument'",
      "'x'",
      ['ErrorTrace', ['ErrorFrame', "'Denominator'", 2]],
    ]);
  });

  // The operators are broadcastable: a one-operand call over a list maps
  // over its elements. A call with a surplus operand is refused WHOLE, with
  // one error, before any broadcast: a list first operand does not fan the
  // refusal into one error per element, and a surplus list, empty or not, is
  // not a source of cells.
  test('a one-operand call over a list still maps over the elements', () => {
    expect(
      ce
        .box(['Numerator', ['List', ['Rational', 1, 2], ['Rational', 3, 4]]])
        .evaluate().json
    ).toEqual(['List', 1, 3]);
  });

  test.each([
    [
      ['Numerator', ['List', ['Rational', 1, 2], ['Rational', 3, 4]], 'x'],
      'Numerator',
      "'x'",
    ],
    [['Numerator', ['List'], 'x'], 'Numerator', "'x'"],
    [['Denominator', 5, ['List']], 'Denominator', "'[]'"],
    [['Denominator', 5, ['List', 1, 2]], 'Denominator', "'[1,2]'"],
    [
      ['NumeratorDenominator', ['List', 1, 2], ['List', 3, 4]],
      'NumeratorDenominator',
      "'[3,4]'",
    ],
  ])(
    '%j is refused whole, with one error, before any broadcast',
    (input, operator, where) => {
      const expected = [
        'Error',
        "'unexpected-argument'",
        where,
        ['ErrorTrace', ['ErrorFrame', `'${operator}'`, 2]],
      ];
      expect(ce.box(input as any).evaluate().json).toEqual(expected);
      expect(ce.box(input as any).N().json).toEqual(expected);
    }
  );

  // A surplus TUPLE is not a source of cells either: the component-wise
  // tuple broadcast leaves the call whole, with one error, and the type is
  // the handler's, not a lift over the surplus collection.
  test.each([
    [
      'Numerator',
      ['Numerator', ['Rational', 6, 4], ['Tuple', 1, 2]],
      "'(1, 2)'",
    ],
    ['Denominator', ['Denominator', 5, ['Tuple', 1, 2]], "'(1, 2)'"],
    [
      'NumeratorDenominator',
      ['NumeratorDenominator', ['Rational', 6, 4], ['Tuple', 1, 2]],
      "'(1, 2)'",
    ],
    ['Numerator', ['Numerator', ['Rational', 6, 4], ['List', 1, 2]], "'[1,2]'"],
  ])(
    '%s with a surplus collection is one error, not a fan-out',
    (operator, input, where) => {
      const expected = [
        'Error',
        "'unexpected-argument'",
        where,
        ['ErrorTrace', ['ErrorFrame', `'${operator}'`, 2]],
      ];
      expect(ce.box(input as any).evaluate().json).toEqual(expected);
      expect(ce.box(input as any).N().json).toEqual(expected);
      const surplus = ce.box(input as any);
      const plain = ce.box([operator, 5, 'x'] as any);
      expect(surplus.type.toString()).toBe(plain.type.toString());
    }
  );

  test('evaluateAsync() refuses a surplus tuple the same way', async () => {
    const result = await ce
      .box(['Numerator', ['Rational', 6, 4], ['Tuple', 1, 2]])
      .evaluateAsync();
    expect(result.operator).toBe('Error');
  });

  // The type derived from operand descriptors (`deriveApplicationType`, the
  // route that types a call in the body of another function) is not lifted
  // over a surplus collection either: it agrees with the expression route.
  test.each([
    ['Numerator', 'list<integer>', 'nothing | number'],
    ['Numerator', 'tuple<integer, integer>', 'nothing | number'],
    ['Denominator', 'list<integer>', 'nothing | number'],
    [
      'NumeratorDenominator',
      'tuple<integer, integer>',
      'nothing | tuple<number, number>',
    ],
  ])(
    'the descriptor type of %s with a surplus %s is %s',
    (operator, surplus, expected) => {
      const t = deriveApplicationType(ce, operator, [
        describeType('rational'),
        describeType(ce.type(surplus).type),
      ]);
      expect(t === undefined ? 'undefined' : new BoxedType(t).toString()).toBe(
        expected
      );
    }
  );

  // An empty `Sequence` or a `Nothing` operand is not an operand, as in the
  // canonical form of every operator: the call is a one-operand call.
  test.each([
    [['Numerator', ['Divide', 'a', 'b'], ['Sequence']], 'a'],
    [['Numerator', ['Divide', 'a', 'b'], 'Nothing'], 'a'],
    [['Denominator', 5, 'Nothing'], 1],
    [
      ['NumeratorDenominator', ['Divide', 'a', 'b'], ['Sequence']],
      ['Tuple', 'a', 'b'],
    ],
  ])('%j drops the empty operand and takes the shortcut', (input, expected) => {
    expect(ce.box(input as any).json).toEqual(expected);
    expect(ce.box(input as any).evaluate().json).toEqual(expected);
  });

  test.each([
    [['Numerator', ['Divide', 'a', 'b']], 'a'],
    [['Denominator', ['Divide', 'a', 'b']], 'b'],
    [
      ['NumeratorDenominator', ['Divide', 'a', 'b']],
      ['Tuple', 'a', 'b'],
    ],
    [['Denominator', 5], 1],
    [['Denominator', ['Rational', 3, 4]], 4],
    [
      ['NumeratorDenominator', 5],
      ['Tuple', 5, 1],
    ],
    [
      ['NumeratorDenominator', ['Rational', 3, 4]],
      ['Tuple', 3, 4],
    ],
  ])('%j still takes the shortcut', (input, expected) => {
    expect(ce.box(input as any).json).toEqual(expected);
  });
});
