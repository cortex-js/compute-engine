import { expression, expressionError, latex, printExpression } from './utils';

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

    serialize: (
        val,
        _config,
        _indentation,
        _depth,
        _refs,
        _printer
    ): string => {
        return printExpression(val);
    },
});

describe('SEQUENCES AND GROUPS', () => {
    test('Valid groups', () => {
        expect(expression('(a+b)')).toMatchInlineSnapshot(
            `['Group', ['Subsequence', ['Add', 'a', 'b']]]`
        );
        expect(expression('-(a+b)')).toMatchInlineSnapshot(
            `['Multiply', -1, ['Subsequence', ['Add', 'a', 'b']]]`
        );
        expect(expression('(a+(c+d))')).toMatchInlineSnapshot(
            `['Group', ['Subsequence', ['Add', 'a', ['Subsequence', ['Add', 'c', 'd']]]]]`
        );
        expect(expression('(a\\times(c\\times d))')).toMatchInlineSnapshot(
            `['Group', ['Subsequence', ['Multiply', 'a', ['Subsequence', ['Multiply', 'c', 'd']]]]]`
        );
        expect(expression('(a\\times(c+d))')).toMatchInlineSnapshot(
            `['Group', ['Subsequence', ['Multiply', 'a', ['Subsequence', ['Add', 'c', 'd']]]]]`
        );
        // Sequence with empty element
        expect(expression('(a,,b)')).toMatchInlineSnapshot(
            `['Group', ['Subsequence', 'a', 'Nothing', 'Nothing', 'b']]`
        );
    });
    test('Groups', () => {
        expect(expression('(a, b, c)')).toMatchInlineSnapshot(
            `['Group', ['Subsequence', 'a', 'Nothing', 'b', 'c']]`
        );
        expect(expression('(a, b; c, d, e, ;; n ,, m)')).toMatchInlineSnapshot(
            `[['Subsequence', ['Subsequence', ['Group', ['Subsequence', ['Subsequence', 'a', 'Nothing', 'b'], ['Subsequence', 'c', 'd', 'E']]]], 'n', 'Nothing', 'm'], 'unbalanced-matchfix-operator ()', 'syntax-error']`
        );
        expect(expression('(a, (b, c))')).toMatchInlineSnapshot(
            `['Group', ['Subsequence', 'a', 'Nothing', ['Group', ['Subsequence', 'b', 'Nothing', 'c']]]]`
        );
        expect(expression('(a, (b; c))')).toMatchInlineSnapshot(
            `[['Group', ['Subsequence', ['Subsequence', 'a', 'Nothing', ['Group', ['Subsequence', 'b']]], ['Subsequence', 'c']]], 'unbalanced-matchfix-operator ()', 'syntax-error']`
        );
    });
    test('Sequences', () => {
        expect(expression('a, b, c')).toMatchInlineSnapshot(
            `['Subsequence', 'a', 'b', 'c']`
        );
        // Sequence with missing element
        expect(expression('a,, c')).toMatchInlineSnapshot(
            `['Subsequence', 'a', 'Nothing', 'c']`
        );
        // Sequence with missing final element
        expect(expression('a,c,')).toMatchInlineSnapshot(
            `['Subsequence', 'a', 'c']`
        );
        // Sequence with missing initial element
        expect(expression(',c,b')).toMatchInlineSnapshot(
            `['', 'syntax-error']`
        );
    });
    test('Subsequences', () => {
        expect(expression('a,b;c,d,e;f;g,h')).toMatchInlineSnapshot(
            `['Subsequence', ['Subsequence', 'a', 'b'], ['Subsequence', 'c', 'd', 'E'], ['Subsequence', 'f'], ['Subsequence', 'g', 'h']]`
        );
        expect(expression(';;a;')).toMatchInlineSnapshot(
            `['', 'syntax-error']`
        );
    });
    test('Absolute value & Norm', () => {
        expect(expression('1+|a|+2')).toMatchInlineSnapshot(
            `['Add', ['Abs', 'a'], 1, 2]`
        );
        expect(expression('|(1+|a|+2)|')).toMatchInlineSnapshot(
            `['Abs', ['Group', ['Subsequence', ['Add', ['Abs', 'a'], 1, 2]]]]`
        );
        expect(expression('|1+|a|+2|')).toMatchInlineSnapshot(
            `['Multiply', ['Abs', 1], ['Abs', 2], 'a']`
        );
        expect(expression('||a||')).toMatchInlineSnapshot(`['Norm', 'a']`);
        expect(expression('||a||+|b|')).toMatchInlineSnapshot(
            `['Add', ['Abs', 'b'], ['Norm', 'a']]`
        );
    });
    test('Invalid groups', () => {
        expect(expression('(')).toMatchInlineSnapshot(
            `[['Group', ['Subsequence', 'Nothing']], 'unbalanced-matchfix-operator ()']`
        );
        expect(expression(')')).toMatchInlineSnapshot(`['', 'syntax-error']`);
        expect(expressionError('-(')).toMatchInlineSnapshot(
            `'unbalanced-matchfix-operator ()'`
        );
    });
});

