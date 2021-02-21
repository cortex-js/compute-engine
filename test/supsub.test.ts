import { POWER, INVERSE_FUNCTION } from '../src/compute-engine/utils';
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

  serialize: (val, _config, _indentation, _depth, _refs, _printer): string => {
    return printExpression(val);
  },
});

describe('POWER', () => {
  test('Power Invalid forms', () => {
    expect(latex([POWER])).toMatchInlineSnapshot(`
            'syntax-error
            syntax-error'
        `);
    expect(latex([POWER, null])).toMatchInlineSnapshot(`''`);
    expect(latex([POWER, undefined])).toMatchInlineSnapshot(`
            'syntax-error
            syntax-error'
        `);
    expect(latex([POWER, 1])).toMatchInlineSnapshot(`'syntax-error'`);
    expect(latex([POWER, NaN])).toMatchInlineSnapshot(`'syntax-error'`);
    expect(latex([POWER, Infinity])).toMatchInlineSnapshot(`'syntax-error'`);
  });
});

describe('INVERSE FUNCTION', () => {
  test('Valid forms', () => {
    expect(latex([INVERSE_FUNCTION, 'Sin'])).toMatchInlineSnapshot(
      `'\\sin^{-1}'`
    );
    expect(latex([INVERSE_FUNCTION, 'f'])).toMatchInlineSnapshot(`'f^{-1}'`);
  });
});

describe('SUPSUB', () => {
  test('Superscript', () => {
    expect(expression('2^2')).toMatchInlineSnapshot(`['Power', 2, 2]`);
    expect(expression('x^t')).toMatchInlineSnapshot(`['Power', 'x', 't']`);
    expect(expression('2^{10}')).toMatchInlineSnapshot(`['Power', 2, 10]`);
    expect(expression('\\pi^2')).toMatchInlineSnapshot(`['Power', 'Pi', 2]`);
    expect(expression('2^23')).toMatchInlineSnapshot(
      `['Multiply', 3, ['Power', 2, 2]]`
    );
    expect(expression('2^\\pi')).toMatchInlineSnapshot(`['Power', 2, 'Pi']`);
    expect(expression('2^\\frac12')).toMatchInlineSnapshot(
      `['Power', 2, ['Power', 2, -1]]`
    );
    expect(expression('2^{3^4}')).toMatchInlineSnapshot(
      `['Power', 2, ['Power', 3, 4]]`
    );
    expect(expression('2^{10}')).toMatchInlineSnapshot(`['Power', 2, 10]`);
    expect(expression('2^{-2}')).toMatchInlineSnapshot(`['Power', 2, -2]`);
    expect(expression('2^3^4')).toMatchInlineSnapshot(
      `['Power', ['Power', 2, 3], 4]`
    ); // @todo: unclear what the right answer is... (and it's invalid Latex)
    expect(expression('2^{3^4}')).toMatchInlineSnapshot(
      `['Power', 2, ['Power', 3, 4]]`
    );
    expect(expression('12^34.5')).toMatchInlineSnapshot(
      `['Multiply', 4.5, ['Power', 12, 3]]`
    );
    expect(expression('x^2')).toMatchInlineSnapshot(`['Power', 'x', 2]`);
    expect(expression('x^{x+1}')).toMatchInlineSnapshot(
      `['Power', 'x', ['Add', 'x', 1]]`
    );
  });
  test('Subscript', () => {
    expect(expression('x_0')).toMatchInlineSnapshot(`['Subscript', 'x', 0]`);
    expect(expression('x^2_0')).toMatchInlineSnapshot(
      `['Subscript', ['Power', 'x', 2], 0]`
    );
    expect(expression('x_0^2')).toMatchInlineSnapshot(
      `['Power', ['Subscript', 'x', 0], 2]`
    );
    expect(expression('x_{n+1}')).toMatchInlineSnapshot(
      `['Subscript', 'x', ['Add', 'n', 1]]`
    );
    expect(expression('x_n_{+1}')).toMatchInlineSnapshot(
      `['Subscript', ['Subscript', 'x', 'n'], 1]`
    );
  });
  test('Pre-sup, pre-sub', () => {
    expect(expression('_p^qx')).toMatchInlineSnapshot(
      `['Multiply', ['Power', ['Subscript', 'p'], 'q'], 'x']`
    ); // @todo: nope...
    expect(expression('_p^qx_r^s')).toMatchInlineSnapshot(
      `['Multiply', ['Power', ['Subscript', 'p'], 'q'], ['Power', ['Subscript', 'x', 'r'], 's']]`
    ); // @todo: nope...
    expect(expression('_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(
      `['Multiply', ['Power', ['Subscript', ['Add', 'p', 1]], ['Add', 'q', 1]], ['Power', ['Subscript', 'x', ['Add', 'r', 1]], ['Add', 's', 1]]]`
    ); // @todo: nope...
    expect(expression('x{}_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(
      `['Multiply', ['Power', ['Subscript', 'x', ['Add', 'p', 1]], ['Add', 'q', 1]], ['Power', ['Subscript', 'x', ['Add', 'r', 1]], ['Add', 's', 1]]]`
    ); // @todo: nope...
  });
  test('Sup/Sub groups', () => {
    expect(expression('(x+1)^{n-1}')).toMatchInlineSnapshot(
      `['Power', ['Add', 'x', 1], ['Add', 'n', -1]]`
    );
    expect(expression('(x+1)_{n-1}')).toMatchInlineSnapshot(
      `['Subscript', ['Parentheses', ['Add', 'x', 1]], ['Add', 'n', -1]]`
    );
    expect(expression('(x+1)^n_0')).toMatchInlineSnapshot(
      `['Subscript', ['Power', ['Add', 'x', 1], 'n'], 0]`
    );
    expect(expression('^p_q{x+1}^n_0')).toMatchInlineSnapshot(
      `[['Subscript', 'q'], 'expected-operand', 'syntax-error']`
    ); // @todo: nope...
    expect(expression('^{12}_{34}(x+1)^n_0')).toMatchInlineSnapshot(
      `[['Multiply', ['Subscript', 34], ['Subscript', ['Power', ['Add', 'x', 1], 'n'], 0]], 'expected-operand']`
    ); // @todo: nope...
  });
  test('Accents', () => {
    expect(expression('\\vec{x}')).toMatchInlineSnapshot(`['OverVector', 'x']`);
    expect(expression('\\vec{AB}')).toMatchInlineSnapshot(
      `['OverVector', ['Multiply', 'A', 'B']]`
    ); // @todo: nope...
    expect(expression('\\vec{AB}^{-1}')).toMatchInlineSnapshot(
      `['Power', ['OverVector', ['Multiply', 'A', 'B']], -1]`
    ); // @todo: nope...
  });
});

describe('PRIME', () => {
  test('Valid forms', () => {
    expect(expression("f'")).toMatchInlineSnapshot(`['f', 'syntax-error']`); // @todo
    expect(expression("f''")).toMatchInlineSnapshot(`['f', 'syntax-error']`); // @todo
    expect(expression("f'''")).toMatchInlineSnapshot(`['f', 'syntax-error']`); // @todo
    expect(expression('f\\prime')).toMatchInlineSnapshot(
      `['Multiply', '\\prime', 'f']`
    ); // @todo
    expect(expression('f\\prime\\prime')).toMatchInlineSnapshot(
      `['Multiply', '\\prime', '\\prime', 'f']`
    ); // @todo
    expect(expression('f\\prime\\prime\\prime')).toMatchInlineSnapshot(
      `['Multiply', '\\prime', '\\prime', '\\prime', 'f']`
    ); // @todo
    expect(expression('f\\doubleprime')).toMatchInlineSnapshot(
      `['Multiply', '\\doubleprime', 'f']`
    ); // @todo
    expect(expression('f^{\\prime}')).toMatchInlineSnapshot(`['Prime', 'f']`);
    expect(expression('f^{\\prime\\prime}')).toMatchInlineSnapshot(
      `['Power', 'f', ['Multiply', '\\prime', '\\prime']]`
    ); // @todo
    expect(expression('f^{\\prime\\prime\\prime}')).toMatchInlineSnapshot(
      `['Power', 'f', ['Multiply', '\\prime', '\\prime', '\\prime']]`
    ); // @todo
    expect(expression('f^{\\doubleprime}')).toMatchInlineSnapshot(
      `['Power', 'f', '\\doubleprime']`
    );
  });
});
