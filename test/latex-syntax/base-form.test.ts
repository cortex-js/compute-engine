import { expression } from '../utils';

describe('BASE FORM', () => {
  test('binary', () => {
    expect(expression('(00111)_{2}', { form: 'json' })).toMatchInlineSnapshot(
      `['Subscript', ['Delimiter', {num: '00111'}], 2]`
    );
    expect(expression('(00111)_2', { form: 'json' })).toMatchInlineSnapshot(
      `['Subscript', ['Delimiter', {num: '00111'}], 2]`
    );
    expect(expression('(00\\;111)_2', { form: 'json' })).toMatchInlineSnapshot(
      `['Subscript', ['Delimiter', ['Multiply', {num: '00'}, 111]], 2]`
    );
    expect(
      expression('(\\mathtt{00\\;111})_2', { form: 'json' })
    ).toMatchInlineSnapshot(
      `['Subscript', ['Delimiter', ['Error', ['LatexString', {str: '\\mathtt{00\\;111}'}], 'unknown-command']], 2]`
    );
  });
  test('decimal', () => {
    expect(expression('(123)_{10}', { form: 'json' })).toMatchInlineSnapshot(
      `['Subscript', ['Delimiter', 123], 10]`
    );
    expect(expression('(12c3)_{10}', { form: 'json' })).toMatchInlineSnapshot(
      `['Subscript', ['Delimiter', ['Multiply', 12, ['Multiply', 'c', 3]]], 10]`
    );
  });
  test('hexadecimal', () => {
    expect(expression('(a1b23)_{16}', { form: 'json' })).toMatchInlineSnapshot(
      `['Subscript', ['Delimiter', ['Multiply', 'a', ['Multiply', 1, ['Multiply', 'b', 23]]]], 16]`
    );
    expect(expression('(1x2gc3)_{16}', { form: 'json' })).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '(1x2gc3)_{16}'}], ''syntax-error'']`
    );
  });
  test('base 36', () => {
    expect(
      expression('(a1xy9zb23)_{36}', { form: 'json' })
    ).toMatchInlineSnapshot(
      `['Subscript', ['Delimiter', ['Multiply', 'a', ['Multiply', 1, ['Multiply', 'x', ['Multiply', 'y', ['Multiply', 9, ['Multiply', 'z', ['Multiply', 'b', 23]]]]]]]], 36]`
    );
  });
  test('base 37', () => {
    expect(expression('(a1b23)_{37}', { form: 'json' })).toMatchInlineSnapshot(
      `['Subscript', ['Delimiter', ['Multiply', 'a', ['Multiply', 1, ['Multiply', 'b', 23]]]], 37]`
    );
    expect(expression('(1x2gc3)_{37}', { form: 'json' })).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '(1x2gc3)_{37}'}], ''syntax-error'']`
    );
  });
});
