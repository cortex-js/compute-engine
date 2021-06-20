import { expression, expressionError } from './utils';

describe('SEQUENCES AND PARENTHESES', () => {
  test('Valid groups', () => {
    expect(expression('(a+b)')).toMatchInlineSnapshot(
      `['Parentheses', ['Add', 'a', 'b']]`
    );
    expect(expression('-(a+b)')).toMatchInlineSnapshot(
      `['Add', ['Negate', 'b'], ['Negate', 'a']]`
    );
    expect(expression('(a+(c+d))')).toMatchInlineSnapshot(
      `['Parentheses', ['Add', 'a', 'c', 'd']]`
    );
    expect(expression('(a\\times(c\\times d))')).toMatchInlineSnapshot(
      `['Parentheses', ['Multiply', 'a', 'c', 'd']]`
    );
    expect(expression('(a\\times(c+d))')).toMatchInlineSnapshot(
      `['Parentheses', ['Multiply', 'a', ['Add', 'c', 'd']]]`
    );
    // Sequence with empty element
    expect(expression('(a,,b)')).toMatchInlineSnapshot(
      `['Parentheses', 'a', 'Nothing', 'b']`
    );
  });
  test('Groups', () => {
    expect(expression('(a, b, c)')).toMatchInlineSnapshot(
      `['Parentheses', 'a', 'b', 'c']`
    );
    expect(expression('(a, b; c, d, ;; n ,, m)')).toMatchInlineSnapshot(
      `['Parentheses', ['Sequence2', ['Sequence', 'a', 'b'], ['Sequence', 'c', 'd', 'Nothing'], 'Nothing', ['Sequence', 'n', 'Nothing', 'm']]]`
    );
    expect(expression('(a, (b, c))')).toMatchInlineSnapshot(
      `['Parentheses', 'a', ['Parentheses', 'b', 'c']]`
    );
    expect(expression('(a, (b; c))')).toMatchInlineSnapshot(
      `['Parentheses', 'a', ['Parentheses', ['Sequence2', 'b', 'c']]]`
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
      `['Sequence2', ['Sequence', 'a', 'b'], ['Sequence', 'c', 'd', 'ExponentialE'], 'f', ['Sequence', 'g', 'h']]`
    );
    expect(expression(';;a;')).toMatchInlineSnapshot(
      `['Sequence2', 'Nothing', 'Nothing', 'a', 'Nothing']`
    );
  });
  test('Absolute value & Norm', () => {
    expect(expression('1+|a|+2')).toMatchInlineSnapshot(
      `['Add', ['Abs', 'a'], 1, 2]`
    );
    expect(expression('|(1+|a|+2)|')).toMatchInlineSnapshot(
      `[['Multiply', ['Abs', 2], ['Abs', ['Multiply', 1, ['Parentheses']]], 'a'], 'unbalanced-symbols ()', 'unbalanced-symbols ||', 'unbalanced-symbols ||']`
    ); // @todo
    expect(expression('|1+|a|+2|')).toMatchInlineSnapshot(
      `[['Multiply', ['Abs', 1], ['Abs', 2], 'a'], 'unbalanced-symbols ||']`
    );
    expect(expression('||a||')).toMatchInlineSnapshot(`['Norm', 'a']`);
    expect(expression('||a||+|b|')).toMatchInlineSnapshot(
      `['Add', ['Abs', 'b'], ['Norm', 'a']]`
    );
  });
  test('Invalid groups', () => {
    expect(expression('(')).toMatchInlineSnapshot(
      `[['Parentheses'], 'unbalanced-symbols ()']`
    );
    expect(expression(')')).toMatchInlineSnapshot(`['', 'syntax-error']`);
    expect(expressionError('-(')).toMatchInlineSnapshot(
      `'unbalanced-symbols ()'`
    );
  });
});
