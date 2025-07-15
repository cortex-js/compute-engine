import { parse } from '../../src/math-json/parse-sympy';
import { serialize } from '../../src/math-json/serialize-sympy';

// const k = parse('077e010');
// console.info('Sympy test: ', k);

describe('Sympy parsing identifiers', () => {
  test('abcde_fgh9', () => {
    expect(parse('abcde_fgh9')).toMatchInlineSnapshot(`"abcde_fgh9"`);
  });
  test('_890', () => {
    expect(parse('_890')).toMatchInlineSnapshot(`"_890"`);
  });
  test('a234_890_', () => {
    expect(parse('a234_890_')).toMatchInlineSnapshot(`"a234_890_"`);
  });
  test('a123456', () => {
    expect(parse('a123456')).toMatchInlineSnapshot(`"a123456"`);
  });
});
describe('Sympy parsing unicode identifiers', () => {
  test('Unicode Identifiers', () => {
    expect(parse('abcde_fgh9')).toMatchInlineSnapshot(`"abcde_fgh9"`);
  });
});
describe('Sympy parsing integers', () => {
  test.skip('0', () => expect(parse('0')).toEqual(0));
  test('123', () => expect(parse('123')).toEqual(123));
  test('123_456', () => expect(parse('123_456')).toEqual(123456));
  test('0b0010', () => expect(parse('0b0010')).toEqual(['BaseForm', 2, 2]));
  test('0b00_10', () => expect(parse('0b00_10')).toEqual(['BaseForm', 2, 2]));
  test('0o0777', () => expect(parse('0o0777')).toEqual(['BaseForm', 511, 8]));
  test('0Xdead_BEEF', () =>
    expect(parse('0Xdead_BEEF')).toEqual(['BaseForm', 3735928559, 16]));
});

describe('Sympy parsing floatnumber', () => {
  test('10.', () => {
    expect(parse('10.')).toEqual(10);
  });
  test('.001', () => {
    expect(parse('.001')).toEqual(0.001);
  });
  test('1.345', () => {
    expect(parse('1.345')).toEqual(1.345);
  });
  test('1_23_45.678', () => {
    expect(parse('1_23_45.678')).toEqual(12345.678);
  });
  test('.1_23_45678', () => {
    expect(parse('.1_23_45678')).toEqual(0.12345678);
  });
  test('1.e10', () => {
    expect(parse('1.e10')).toEqual(10000000000);
  });
  test('2e+5', () => {
    expect(parse('2e+5')).toEqual(200000);
  });
  test('2.0e-5', () => {
    expect(parse('2.0e-5')).toEqual(0.00002);
  });
  test('.4e-6_7', () => {
    expect(parse('.4e-6_7')).toEqual(4e-68);
  });
  test.skip('077e010', () => {
    expect(parse('077e010')).toEqual(770000000000);
  });
  test.skip('0e0', () => {
    expect(parse('0e0')).toEqual(0);
  });
});

describe('Sympy parsing Imaginary literals', () => {
  test('5j', () => expect(parse('5j')).toEqual(['Complex', 0, 5]));
  test('-5j', () => expect(parse('4j')).toEqual(['Complex', 0, 4]));
  test('3.14j', () => expect(parse('3.14j')).toEqual(['Complex', 0, 3.14]));
  test('10.j', () => {
    expect(parse('10.j')).toEqual(['Complex', 0, 10]);
  });
  test('0.001J', () => {
    expect(parse('0.001J')).toEqual(['Complex', 0, 0.001]);
  });
  test('3.14e-10J', () => {
    expect(parse('3.14e-10J')).toEqual(['Complex', 0, 3.14e-10]);
  });
  test('3.14_15_93j', () => {
    expect(parse('3.14_15_93j')).toEqual(['Complex', 0, 3.141593]);
  });
});

describe('Sympy parsing Numeric expressions', () => {
  test('2**2 / 3 + 5', () => {
    expect(parse('2**2 / 3 + 5')).toMatchInlineSnapshot(`
      [
        "Error",
        {
          "str": "unexpected-token",
        },
        {
          "str": "**2 / 3 + 5",
        },
      ]
    `);
  });
  test('-2*(-(-x + 1/x)/(x*(x - 1/x)**2) - 1/(x*(x - 1/x))) - 1', () => {
    expect(parse('-2*(-(-x + 1/x)/(x*(x - 1/x)**2) - 1/(x*(x - 1/x))) - 1'))
      .toMatchInlineSnapshot(`
      [
        "Error",
        {
          "str": "unexpected-token",
        },
        {
          "str": "-2*(-(-x + 1/x)/(x*(x - 1/x)**2) - 1/(x*(x - 1/x))) - 1",
        },
      ]
    `);
  });
});

// sin(2*x) - 2*sin(x)*cos(x)

// x = r*(sympy.cos(theta)*gamma_z+sympy.sin(theta)*\
//        (sympy.cos(phi)*gamma_x+sympy.sin(phi)*gamma_y))

// sympify(sympy.sin(x/3))

describe('Sympy serializing numbers', () => {
  test('', () => {
    expect(serialize({ num: '1234.567' })).toMatchInlineSnapshot(`"1234.567"`);
  });
  test('', () => {
    expect(serialize({ num: '0.123' })).toMatchInlineSnapshot(`"0.123"`);
  });
  test('', () => {
    expect(serialize({ num: '-1234e-45' })).toMatchInlineSnapshot(
      `"-1.234e-42"`
    );
  });
  test('', () => {
    expect(serialize({ num: 'NaN' })).toMatchInlineSnapshot(`"NaN"`);
  });
  test('', () => {
    expect(serialize({ num: '-Infinity' })).toMatchInlineSnapshot(
      `"-Infinity"`
    );
  });
});

describe('Sympy serializing Baseform', () => {
  test('', () => {
    expect(serialize(['BaseForm', 42, 2])).toMatchInlineSnapshot(`"0b101010"`);
  });
  test('', () => {
    expect(serialize(['BaseForm', 42, 8])).toMatchInlineSnapshot(`"0o52"`);
  });
  test('', () => {
    expect(serialize(['BaseForm', 3735929054, 16])).toMatch('0xdeadc0de');
  });
  test('', () => {
    expect(serialize(['BaseForm', 42, 10])).toMatch('42');
  });
  test('', () => {
    expect(serialize(['BaseForm', 42, 7])).toMatch('42');
  });
  test('', () => {
    expect(serialize(['BaseForm', 42])).toMatch('42');
  });
  test('', () => {
    expect(serialize(['BaseForm'])).toMatchInlineSnapshot(`""`);
  });
  test('', () => {
    expect(serialize(['BaseForm', -32, 10])).toMatchInlineSnapshot(
      `"BaseForm(-32,10)"`
    );
  });
  test('', () => {
    expect(serialize(['BaseForm', 'foo', 10])).toMatchInlineSnapshot(
      `"BaseForm(foo,10)"`
    );
  });
});

describe('Sympy serializing symbols', () => {
  test('x', () => expect(serialize('x')).toMatchInlineSnapshot(`"x"`));
  test('speed', () =>
    expect(serialize('speed')).toMatchInlineSnapshot(`"speed"`));
  test('alpha', () =>
    expect(serialize('alpha')).toMatchInlineSnapshot(`"alpha"`));
  test('alpha_12', () =>
    expect(serialize('alpha_12')).toMatchInlineSnapshot(`"alpha_12"`));
});

describe('Sympy serializing arithmetic operators', () => {
  test('5 + 6', () =>
    expect(serialize(['Add', 5, 6])).toMatchInlineSnapshot(`"Add(5,6)"`));

  test('3x', () =>
    expect(serialize(['Multiply', 3, 'x'])).toMatchInlineSnapshot(
      `"Multiply(3,x)"`
    ));

  test('3x^2 + 4x + c', () =>
    expect(
      serialize([
        'Add',
        ['Multiply', 3, ['Square', 'x']],
        ['Multiply', 4, 'x'],
        'c',
      ])
    ).toMatchInlineSnapshot(`"Add(Multiply(3,Square(x)),Multiply(4,x),c)"`));
});
