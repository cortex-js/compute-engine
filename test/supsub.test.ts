import { POWER, INVERSE_FUNCTION } from '../src/common/utils';
import { Expression } from '../src/public';
import { expression, latex } from './utils';

describe('POWER', () => {
  test('Power Invalid forms', () => {
    expect(latex([POWER])).toMatchInlineSnapshot(`''`);
    expect(latex([POWER, null as unknown as Expression])).toMatchInlineSnapshot(
      `''`
    );
    expect(
      latex([POWER, undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`''`);
    expect(latex([POWER, 1])).toMatchInlineSnapshot(`'1'`);
    expect(latex([POWER, NaN])).toMatchInlineSnapshot(`'\\operatorname{NaN}'`);
    expect(latex([POWER, Infinity])).toMatchInlineSnapshot(`'\\infty'`);
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
    expect(expression('2^2')).toMatchInlineSnapshot(`['Square', 2]`);
    expect(expression('x^t')).toMatchInlineSnapshot(`['Power', 'x', 't']`);
    expect(expression('2^{10}')).toMatchInlineSnapshot(`['Power', 2, 10]`);
    expect(expression('\\pi^2')).toMatchInlineSnapshot(`['Square', 'Pi']`);
    expect(expression('2^23')).toMatchInlineSnapshot(
      `['Multiply', 3, ['Square', 2]]`
    );
    expect(expression('2^\\pi')).toMatchInlineSnapshot(`['Power', 2, 'Pi']`);
    expect(expression('2^\\frac12')).toMatchInlineSnapshot(
      `['Power', 2, 'Half']`
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
    expect(expression('x^2')).toMatchInlineSnapshot(`['Square', 'x']`);
    expect(expression('x^{x+1}')).toMatchInlineSnapshot(
      `['Power', 'x', ['Add', 'x', 1]]`
    );
  });
  test('Subscript', () => {
    expect(expression('x_0')).toMatchInlineSnapshot(`['Subscript', 'x', 0]`);
    expect(expression('x^2_0')).toMatchInlineSnapshot(
      `['Subscript', ['Square', 'x'], 0]`
    );
    expect(expression('x_0^2')).toMatchInlineSnapshot(
      `['Square', ['Subscript', 'x', 0]]`
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
      `['Power', ['Subscript', 'p'], ['Multiply', 'q', 'x']]`
    ); // @todo: nope...
    expect(expression('_p^qx_r^s')).toMatchInlineSnapshot(
      `['Power', ['Subscript', 'p'], ['Multiply', 'q', ['Power', ['Subscript', 'x', 'r'], 's']]]`
    ); // @todo: nope...
    expect(expression('_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(
      `[['Power', ['Subscript', ['Add', 'p', 1]], 'Missing'], 'syntax-error']`
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
      `[['Power', 'Missing', ['Subscript', 'p', 'q']], 'syntax-error']`
    ); // @todo: nope...
    expect(expression('^{12}_{34}(x+1)^n_0')).toMatchInlineSnapshot(
      `[['Power', 'Missing', 'Missing'], 'syntax-error']`
    ); // @todo: nope...
  });
  test('Accents', () => {
    expect(expression('\\vec{x}')).toMatchInlineSnapshot(`['OverVector', 'x']`);
    expect(expression('\\vec{AB}')).toMatchInlineSnapshot(
      `['OverVector', ['Multiply', 'A', 'B']]`
    ); // @todo: nope...
    expect(expression('\\vec{AB}^{-1}')).toMatchInlineSnapshot(`0`);
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
      `[['Multiply', '\\doubleprime', ['Prime', 'f', 2]], 'syntax-error']`
    );
  });
});
