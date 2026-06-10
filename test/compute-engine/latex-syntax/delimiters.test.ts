import { engine as ce } from '../../utils';

describe('DELIMITERS', () => {
  test('Parentheses', () => {
    expect(ce.parse('(2+3)').json).toMatchInlineSnapshot(`5`);
    expect(ce.parse('(2+3, 4+5)').json).toMatchInlineSnapshot(`
      [
        Tuple,
        5,
        9,
      ]
    `);
    expect(ce.parse('(2+3; 4+5)').json).toMatchInlineSnapshot(`
      [
        Tuple,
        5,
        9,
      ]
    `);
    expect(ce.parse('1+(2+3)').json).toMatchInlineSnapshot(`6`);
    expect(ce.parse('1+((2+3))').json).toMatchInlineSnapshot(`6`);
    expect(ce.parse('4(2+3)').json).toMatchInlineSnapshot(`20`);
    expect(ce.parse('4((2+(3)))').json).toMatchInlineSnapshot(`20`);
  });

  test('Function application', () => {
    expect(ce.parse('f(x)').json).toMatchInlineSnapshot(`
      [
        f,
        x,
      ]
    `);
    expect(ce.parse('f(2)').json).toMatchInlineSnapshot(`
      [
        f,
        2,
      ]
    `);
    expect(ce.parse('f(2, 3)').json).toMatchInlineSnapshot(`
      [
        f,
        2,
        3,
      ]
    `);
  });

  test('Indexed access', () => {
    expect(ce.parse('[2]').json).toMatchInlineSnapshot(`
      [
        List,
        2,
      ]
    `);
    expect(ce.parse('[2, 3]').json).toMatchInlineSnapshot(`
      [
        List,
        2,
        3,
      ]
    `);
    expect(ce.parse('[2; 3]').json).toMatchInlineSnapshot(`
      [
        List,
        [
          List,
          2,
        ],
        [
          List,
          3,
        ],
      ]
    `);
    expect(ce.parse('f[3]').json).toMatchInlineSnapshot(`
      [
        At,
        [
          Error,
          [
            ErrorCode,
            'incompatible-type',
            'indexed_collection',
            'function',
          ],
        ],
        3,
      ]
    `);
    expect(ce.parse('f[3, 4]').json).toMatchInlineSnapshot(`
      [
        At,
        [
          Error,
          [
            ErrorCode,
            'incompatible-type',
            'indexed_collection',
            'function',
          ],
        ],
        3,
        4,
      ]
    `);
    expect(ce.parse('v[3]').json).toMatchInlineSnapshot(`
      [
        At,
        v,
        3,
      ]
    `);
    expect(ce.parse('v[3, 4]').json).toMatchInlineSnapshot(`
      [
        At,
        v,
        3,
        4,
      ]
    `);
  });
});

describe('Delimiter scale styles (REVIEW.md C1)', () => {
  // wrapString appended a stray `}` for the 'scaled' style and a stray `)`
  // for 'big', producing invalid LaTeX.
  test("'scaled' wraps with \\left…\\right and no trailing brace", () =>
    expect(
      ce.box(['f', 'x', 'y']).toLatex({ applyFunctionStyle: () => 'scaled' })
    ).toEqual('f\\left(x, y\\right)'));

  test("'big' wraps with \\Bigl…\\Bigr and no trailing paren", () =>
    expect(
      ce.box(['f', 'x', 'y']).toLatex({ applyFunctionStyle: () => 'big' })
    ).toEqual('f\\Bigl(x, y\\Bigr)'));
});
