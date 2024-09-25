import { engine as ce } from '../../utils';

describe('DELIMITERS', () => {
  test('Parentheses', () => {
    expect(ce.parse('(2+3)').json).toMatchInlineSnapshot(`
      [
        Add,
        2,
        3,
      ]
    `);
    expect(ce.parse('(2+3, 4+5)').json).toMatchInlineSnapshot(`
      [
        Tuple,
        [
          Add,
          2,
          3,
        ],
        [
          Add,
          4,
          5,
        ],
      ]
    `);
    expect(ce.parse('(2+3; 4+5)').json).toMatchInlineSnapshot(`
      [
        Tuple,
        [
          Add,
          2,
          3,
        ],
        [
          Add,
          4,
          5,
        ],
      ]
    `);
    expect(ce.parse('1+(2+3)').json).toMatchInlineSnapshot(`
      [
        Add,
        1,
        2,
        3,
      ]
    `);
    expect(ce.parse('1+((2+3))').json).toMatchInlineSnapshot(`
      [
        Add,
        1,
        2,
        3,
      ]
    `);
    expect(ce.parse('4(2+3)').json).toMatchInlineSnapshot(`
      [
        Multiply,
        4,
        [
          Add,
          2,
          3,
        ],
      ]
    `);
    expect(ce.parse('4((2+(3)))').json).toMatchInlineSnapshot(`
      [
        Multiply,
        4,
        [
          Add,
          2,
          3,
        ],
      ]
    `);
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
            'list | tuple | string',
            '(...any) -> any',
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
            'list | tuple | string',
            '(...any) -> any',
          ],
        ],
        3,
        [
          Error,
          'unexpected-argument',
          '4',
        ],
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
        [
          Error,
          'unexpected-argument',
          '4',
        ],
      ]
    `);
  });
});
