import { Expression } from '../../../src/math-json/types.ts';
import { engine } from '../../utils';

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
        '"12c3"',
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
        '"1x2gc3"',
      ]
    `);
  });
  test('a 0x or 0b prefix is read only in the base of the prefix (CE-1420)', () => {
    // `0b1` in base 16 was read as a binary numeral, 1.
    expect(json('\\text{0b1}_{16}')).toBe(177);
    expect(json('\\text{0bad}_{16}')).toBe(2989);
    expect(json('\\text{0x1F}_{16}')).toBe(31);
    expect(json('\\text{0X1F}_{16}')).toBe(31);
    expect(json('\\text{0b101}_2')).toBe(5);
    // A prefix with no digit after it is NaN, as in `DigitsFrom`: this was 0.
    expect(json('\\text{0x}_{16}')).toBe('NaN');
    // `x` is not a digit of base 10: this was 16.
    expect(engine.box(['Subscript', "'0x10'", 10]).json).toEqual([
      'Error',
      ['ErrorCode', "'unexpected-digit'", "'x'"],
      '\'"0x10"\'',
    ]);
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
