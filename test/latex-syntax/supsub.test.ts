import { POWER, INVERSE_FUNCTION } from '../../src/common/utils';
import { Expression } from '../../src/math-json/math-json-format';
import { expression, latex } from '../utils';

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
      `['Power', 2, ['Sequence', 3, 4]]`
    ); // @todo: unclear what the right answer is... (and it's invalid LaTeX)
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
      `['Square', ['Subscript', 'x', 0]]`
    );
    expect(expression('x_0^2')).toMatchInlineSnapshot(
      `['Square', ['Subscript', 'x', 0]]`
    );
    expect(expression('x_{n+1}')).toMatchInlineSnapshot(
      `['Subscript', 'x', ['Add', 'n', 1]]`
    );
    expect(expression('x_n_{+1}')).toMatchInlineSnapshot(
      `['Subscript', 'x', ['Sequence', 'n', 1]]`
    );
  });
  test('Pre-sup, pre-sub', () => {
    expect(expression('_p^qx')).toMatchInlineSnapshot(
      `['Sequence', ['Subscript', 'Missing', 'Missing'], ['Error', ['LatexString', {str: 'p^qx'}], ''syntax-error'']]`
    ); // @todo: nope...
    expect(expression('_p^qx_r^s')).toMatchInlineSnapshot(
      `['Sequence', ['Subscript', 'Missing', 'Missing'], ['Error', ['LatexString', {str: 'p^qx_r^s'}], ''syntax-error'']]`
    ); // @todo: nope...
    expect(expression('_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(
      `['Sequence', ['Subscript', 'Missing', 'Missing'], ['Error', ['LatexString', {str: '{p+1}^{q+1}x_{r+1}^{s+1}'}], ''syntax-error'']]`
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
      `['Subscript', ['Delimiter', ['Add', 'x', 1]], ['Add', 'n', -1]]`
    );
    expect(expression('(x+1)^n_0')).toMatchInlineSnapshot(
      `['Power', ['Subscript', ['Add', 'x', 1], 0], 'n']`
    );
    expect(expression('^p_q{x+1}^n_0')).toMatchInlineSnapshot(
      `['Sequence', ['Power', 'Missing', 'Missing'], ['Error', ['LatexString', {str: 'p_q{x+1}^n_0'}], ''syntax-error'']]`
    ); // @todo: nope...
    expect(expression('^{12}_{34}(x+1)^n_0')).toMatchInlineSnapshot(
      `['Sequence', ['Power', 'Missing', 'Missing'], ['Error', ['LatexString', {str: '{12}_{34}(x+1)^n_0'}], ''syntax-error'']]`
    ); // @todo: nope...
  });
  test('Accents', () => {
    expect(expression('\\vec{x}')).toMatchInlineSnapshot(
      `['Sequence', 'OverVector', ['Error', ['LatexString', {str: '{x}'}], ''syntax-error'']]`
    );
    expect(expression('\\vec{AB}')).toMatchInlineSnapshot(
      `['Sequence', 'OverVector', ['Error', ['LatexString', {str: '{AB}'}], ''syntax-error'']]`
    ); // @todo: nope...
    expect(expression('\\vec{AB}^{-1}')).toMatchInlineSnapshot(
      `['Sequence', 'OverVector', ['Error', ['LatexString', {str: '{AB}^{-1}'}], ''syntax-error'']]`
    );
  });
});

describe('PRIME', () => {
  test('Valid forms', () => {
    expect(expression("f'")).toMatchInlineSnapshot(
      `['Sequence', 'f', ['Error', ['LatexString', {str: '''}], ''syntax-error'']]`
    ); // @todo
    expect(expression("f''")).toMatchInlineSnapshot(
      `['Sequence', 'f', ['Error', ['LatexString', {str: ''''}], ''syntax-error'']]`
    ); // @todo
    expect(expression("f'''")).toMatchInlineSnapshot(
      `['Sequence', 'f', ['Error', ['LatexString', {str: '''''}], ''syntax-error'']]`
    ); // @todo
    expect(expression('f\\prime')).toMatchInlineSnapshot(
      `['Sequence', 'f', ['Error', ['LatexString', {str: '\\prime'}], ''syntax-error'']]`
    ); // @todo
    expect(expression('f\\prime\\prime')).toMatchInlineSnapshot(
      `['Sequence', 'f', ['Error', ['LatexString', {str: '\\prime\\prime'}], ''syntax-error'']]`
    ); // @todo
    expect(expression('f\\prime\\prime\\prime')).toMatchInlineSnapshot(
      `['Sequence', 'f', ['Error', ['LatexString', {str: '\\prime\\prime\\prime'}], ''syntax-error'']]`
    ); // @todo
    expect(expression('f\\doubleprime')).toMatchInlineSnapshot(
      `['Sequence', 'f', ['Error', ['LatexString', {str: '\\doubleprime'}], ''syntax-error'']]`
    ); // @todo
    expect(expression('f^{\\prime}')).toMatchInlineSnapshot(
      `['Power', 'f', ['Error', ['LatexString', {str: '\\prime'}], 'unknown-command']]`
    );
    expect(expression('f^{\\prime\\prime}')).toMatchInlineSnapshot(
      `['Sequence', ['Power', 'f', ['Error', ['LatexString', {str: '\\prime'}], 'unknown-command']], ['Error', ['LatexString', {str: '}'}], ''syntax-error'']]`
    ); // @todo
    expect(expression('f^{\\prime\\prime\\prime}')).toMatchInlineSnapshot(
      `['Sequence', ['Power', 'f', ['Error', ['LatexString', {str: '\\prime'}], 'unknown-command']], ['Error', ['LatexString', {str: '\\prime}'}], ''syntax-error'']]`
    ); // @todo
    expect(expression('f^{\\doubleprime}')).toMatchInlineSnapshot(
      `['Power', 'f', ['Error', ['LatexString', {str: '\\doubleprime'}], 'unknown-command']]`
    );
  });
});
