import { expression } from '../utils';

describe('SEQUENCES AND DELIMITERS', () => {
  test('Valid groups', () => {
    expect(expression('(a+b)')).toMatchInlineSnapshot(
      `['Delimiter', ['Add', 'a', 'b']]`
    );
    expect(expression('-(a+b)')).toMatchInlineSnapshot(
      `['Add', ['Negate', 'b'], ['Negate', 'a']]`
    );
    expect(expression('(a+(c+d))')).toMatchInlineSnapshot(
      `['Delimiter', ['Add', 'a', 'c', 'd']]`
    );
    expect(expression('(a\\times(c\\times d))')).toMatchInlineSnapshot(
      `['Delimiter', ['Multiply', 'a', 'c', 'd']]`
    );
    expect(expression('(a\\times(c+d))')).toMatchInlineSnapshot(
      `['Delimiter', ['Multiply', 'a', ['Add', 'c', 'd']]]`
    );
    // Sequence with empty element
    expect(expression('(a,,b)')).toMatchInlineSnapshot(
      `['Delimiter', 'a', 'Nothing', 'b']`
    );
  });
  test('Groups', () => {
    expect(expression('(a, b, c)')).toMatchInlineSnapshot(
      `['Delimiter', 'a', 'b', 'c']`
    );
    expect(expression('(a, b; c, d, ;; n ,, m)')).toMatchInlineSnapshot(
      `['Delimiter', [[['a', 'b'], ['c', 'd', 'Nothing']], 'Nothing'], ['n', 'Nothing', 'm']]`
    );
    expect(expression('(a, (b, c))')).toMatchInlineSnapshot(
      `['Delimiter', 'a', ['Delimiter', 'b', 'c']]`
    );
    expect(expression('(a, (b; c))')).toMatchInlineSnapshot(
      `['Delimiter', 'a', ['Delimiter', ['Sequence', 'b'], ['Sequence', 'c']]]`
    );
  });
  test('Sequences', () => {
    expect(expression('a, b, c')).toMatchInlineSnapshot(
      `['Sequence', 'a', 'b', 'c']`
    );
    // Sequence with missing element
    expect(expression('a,, c')).toMatchInlineSnapshot(
      `['Sequence', 'a', 'Nothing', 'c']`
    );
    // Sequence with missing final element
    expect(expression('a,c,')).toMatchInlineSnapshot(
      `['Sequence', 'a', 'c', 'Nothing']`
    );
    // Sequence with missing initial element
    expect(expression(',c,b')).toMatchInlineSnapshot(
      `['Sequence', 'Nothing', 'c', 'b']`
    );
  });
  test('Subsequences', () => {
    expect(expression('a,b;c,d,e;f;g,h')).toMatchInlineSnapshot(
      `['Sequence', [[['a', 'b'], ['c', 'd', 'ExponentialE']], ['Sequence', 'f']], ['g', 'h']]`
    );
    expect(expression(';;a;')).toMatchInlineSnapshot(
      `['Sequence', [[['Sequence', 'Nothing'], 'Nothing'], ['Sequence', 'a']], 'Nothing']`
    );
  });
});
