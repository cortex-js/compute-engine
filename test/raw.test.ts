import { printExpression, rawExpression } from './utils';

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

describe('NO DICTIONARY/NO DEFAULTS', () => {
    test('Parsing', () => {
        expect(rawExpression('')).toMatchInlineSnapshot(`'""'`);
        expect(rawExpression('1+x')).toMatchInlineSnapshot(
            `'["Latex",1,"+","x"]'`
        );
        expect(rawExpression('x^2')).toMatchInlineSnapshot(
            `'["Latex","x","^",2]'`
        );
        expect(rawExpression('\\frac{1}{x}')).toMatchInlineSnapshot(
            `'["Latex","\\\\frac","<{>",1,"<}>","<{>","x","<}>"]'`
        );
        expect(
            rawExpression('\\sqrt{(1+x_0)}=\\frac{\\pi^2}{2}')
        ).toMatchInlineSnapshot(
            `'["Latex","\\\\sqrt","<{>","(",1,"+","x","_",0,")","<}>","=","\\\\frac","<{>","\\\\pi","^",2,"<}>","<{>",2,"<}>"]'`
        );
    });
});
