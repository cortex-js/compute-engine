import { Expression } from '../../../src/math-json/types.ts.ts';
import { engine } from '../../utils.ts';

function json(latex: string): Expression {
  return engine.parse(latex)?.json ?? '';
}

describe('BASE FORM', () => {
  test('binary', () => {
    expect(json('\\text{00111}_{2}')).toMatchInlineSnapshot(`7`);
    expect(json('\\text{00111}_2')).toMatchInlineSnapshot(`7`);
    expect(json('\\text{00\\;111}_2')).toMatchInlineSnapshot(`7`);
    expect(json('(\\text{00\\;111})_2')).toMatchInlineSnapshot(`7`);
  });
  test('decimal', () => {
    expect(json('\\text{123}_{10}')).toMatchInlineSnapshot(`123`);
    expect(json('\\text{12c3}_{10}')).toMatchInlineSnapshot(`
      [
        Error,
        [
          ErrorCode,
          'unexpected-digit',
          'c',
        ],
        '12c3',
      ]
    `);
  });
  test('hexadecimal', () => {
    expect(json('\\text{a1b23}_{16}')).toMatchInlineSnapshot(`662307`);
    expect(json('\\text{1x2gc3}_{16}')).toMatchInlineSnapshot(`
      [
        Error,
        [
          ErrorCode,
          'unexpected-digit',
          'x',
        ],
        '1x2gc3',
      ]
    `);
  });
  test('base 36', () => {
    expect(json('\\text{a1xy9zb23}_{36}')).toMatchInlineSnapshot(
      `28363369669563`
    );
  });
  test('base 37', () => {
    expect(json('\\text{a1b23}_{37}')).toMatchInlineSnapshot(`
      [
        Baseform,
        'a1b23',
        [
          Error,
          [
            ErrorCode,
            'invalid-base',
            '37',
          ],
        ],
      ]
    `);
    expect(json('\\text{1x2gc3}_{37}')).toMatchInlineSnapshot(`
      [
        Baseform,
        '1x2gc3',
        [
          Error,
          [
            ErrorCode,
            'invalid-base',
            '37',
          ],
        ],
      ]
    `);
  });
});
