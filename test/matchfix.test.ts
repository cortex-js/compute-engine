import { expression, latex, printExpression } from './utils';

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

describe('MATCHFIX', () => {
    test('Parse valid matchfix', () => {
        expect(expression('\\lbrack\\rbrack')).toMatchInlineSnapshot(
            `['Multiply', '\\lbrack', '\\rbrack']`
        );
        expect(expression('\\lbrack a\\rbrack')).toMatchInlineSnapshot(
            `['Multiply', '\\lbrack', '\\rbrack', 'a']`
        );
        expect(expression('\\lbrack a, b\\rbrack')).toMatchInlineSnapshot(
            `['Subsequence', ['Multiply', '\\lbrack', 'a'], ['Multiply', '\\rbrack', 'b']]`
        );
        expect(
            expression('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack')
        ).toMatchInlineSnapshot(
            `['Subsequence', ['Multiply', '\\lbrack', 'a'], ['Multiply', '\\lbrack', 'b'], ['Multiply', '\\rbrack', '\\rbrack', 'c']]`
        );
        expect(
            expression('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack')
        ).toMatchInlineSnapshot(
            `['Subsequence', ['Multiply', ['Sin', '\\lbrack'], 'a'], ['Multiply', '\\lbrack', 'b'], ['Multiply', '\\rbrack', '\\rbrack', 'c']]`
        );
    });
    test('Emit valid matchfix', () => {
        expect(latex(['List'])).toMatchInlineSnapshot(`'\\lbrack\\rbrack'`);
        expect(latex(['List', 'a'])).toMatchInlineSnapshot(
            `'\\lbrack a\\rbrack'`
        );
        expect(latex(['List', 'a', 'b'])).toMatchInlineSnapshot(
            `'\\lbrack a,b\\rbrack'`
        );
        expect(latex(['List', 'a', ['List', 'b', 'c']])).toMatchInlineSnapshot(
            `'\\lbrack a,\\lbrack b,c\\rbrack\\rbrack'`
        );
    });
});
