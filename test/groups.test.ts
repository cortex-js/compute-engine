import { expression, expressionError, printExpression } from './utils';

beforeEach(() => {
  jest.spyOn(console, 'assert').mockImplementation((assertion) => {
    if (!assertion) debugger;
  });
  jest.spyOn(console, 'log').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'info').mockImplementation(() => {
    debugger;
  });
});
expect.addSnapshotSerializer({
  // test: (val): boolean => Array.isArray(val) || typeof val === 'object',
  test: (_val): boolean => true,

  serialize: (val, _config, _indentation, _depth, _refs, _printer): string => {
    return printExpression(val);
  },
});

describe('SEQUENCES AND GROUPS', () => {
  test('Valid groups', () => {
    expect(expression('(a+b)')).toMatchInlineSnapshot(
      `['Group', ['Add', 'a', 'b']]`
    );
    expect(expression('-(a+b)')).toMatchInlineSnapshot(
      `['Multiply', -1, ['Add', 'a', 'b']]`
    );
    expect(expression('(a+(c+d))')).toMatchInlineSnapshot(
      `['Group', ['Add', 'a', 'c', 'd']]`
    );
    expect(expression('(a\\times(c\\times d))')).toMatchInlineSnapshot(
      `['Group', ['Multiply', 'a', 'c', 'd']]`
    );
    expect(expression('(a\\times(c+d))')).toMatchInlineSnapshot(
      `['Group', ['Multiply', 'a', ['Add', 'c', 'd']]]`
    );
    // Sequence with empty element
    expect(expression('(a,,b)')).toMatchInlineSnapshot(
      `['Group', 'a', 'Nothing', 'b']`
    );
  });
  test('Groups', () => {
    expect(expression('(a, b, c)')).toMatchInlineSnapshot(
      `['Group', 'a', 'b', 'c']`
    );
    expect(expression('(a, b; c, d, ;; n ,, m)')).toMatchInlineSnapshot(
      `['Group', ['Sequence2', ['Sequence', 'a', 'b'], ['Sequence', 'c', 'd', 'Nothing'], 'Nothing', ['Sequence', 'n', 'Nothing', 'm']]]`
    );
    expect(expression('(a, (b, c))')).toMatchInlineSnapshot(
      `['Group', 'a', ['Group', 'b', 'c']]`
    );
    expect(expression('(a, (b; c))')).toMatchInlineSnapshot(
      `['Group', 'a', ['Group', ['Sequence2', 'b', 'c']]]`
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
    expect(expression(',c,b')).toMatchInlineSnapshot(`['', 'syntax-error']`); // @todo: could match the initial ","
  });
  test('Subsequences', () => {
    expect(expression('a,b;c,d,e;f;g,h')).toMatchInlineSnapshot(
      `['Sequence2', ['Sequence', 'a', 'b'], ['Sequence', 'c', 'd', 'ExponentialE'], 'f', ['Sequence', 'g', 'h']]`
    );
    expect(expression(';;a;')).toMatchInlineSnapshot(`['', 'syntax-error']`); // @todo: could match the initial ";"
  });
  test('Absolute value & Norm', () => {
    expect(expression('1+|a|+2')).toMatchInlineSnapshot(
      `['Add', ['Abs', 'a'], 1, 2]`
    );
    expect(expression('|(1+|a|+2)|')).toMatchInlineSnapshot(
      `[['Multiply', ['Abs', ['Group']], ['Abs', 2], 'a'], 'unbalanced-symbols ()', 'unbalanced-symbols ||', 'unbalanced-symbols ||']`
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
      `[['Group'], 'unbalanced-symbols ()']`
    );
    expect(expression(')')).toMatchInlineSnapshot(`['', 'syntax-error']`);
    expect(expressionError('-(')).toMatchInlineSnapshot(
      `'unbalanced-symbols ()'`
    );
  });
});
