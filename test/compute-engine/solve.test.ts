import { engine } from '../utils';

function expr(s: string) {
  return engine.parse(s);
}

describe('SOLVING A QUADRATIC EQUATION', () => {
  const ce = engine;

  test('Solving x^2 + 200x - 0.0000015 = 0', () => {
    // Sols -200.000000075 and 0.000000075
    // From https://en.wikipedia.org/wiki/Loss_of_significance

    const result = engine
      .parse(`x^2 + 200x - 0.000015 = 0`)
      .solve(['x'])
      ?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        {
          num: 7.499999997187500002109374998022460939576416013289031985174980160218871836088104540722514735e-8,
        },
        {
          num: -200.0000000749999999718750000210937499802246093957641601328903198517498016021887183608810454072251474,
        },
      ]
    `);
  });

  it('should solve bx', () => {
    const eqn = ce.box(['Multiply', 5, 'x']);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        0,
      ]
    `);
  });

  it('should solve bx + c', () => {
    const eqn = ce.box(['Add', ['Multiply', 5, 'x'], -10]);
    const result = eqn.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        2,
      ]
    `);
  });

  it('should solve ax^2', () => {
    const eqn = ce.box(['Multiply', 16, ['Square', 'x']]);
    expect(eqn.solve('x')).toMatchInlineSnapshot(`
      [
        0,
      ]
    `);
  });

  it('should solve ax^2 + c', () => {
    const eqn = ce.box(['Add', ['Multiply', 2, ['Square', 'x']], -16]);
    expect(eqn.solve('x')).toMatchInlineSnapshot(`
      [
        ["Sqrt", 8],
        ["Negate", ["Sqrt", 8]],
      ]
    `);
  });

  it('should solve ax^2 + bx + c', () => {
    const eqn = ce.box([
      'Add',
      ['Multiply', 2, ['Square', 'x']],
      ['Multiply', 6, 'x'],
      4,
    ]);

    expect(eqn.solve('x')).toMatchInlineSnapshot(`
      [
        -1,
        -2,
      ]
    `);
  });
});

describe('expr.solve()', () => {
  test('should solve an assignment', () => {
    const e = expr('x = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([5]);
  });

  test('should solve an assignment to a root', () => {
    const e = expr('x = \\sqrt{5}');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([['Sqrt', 5]]);
  });

  test('should solve an assignment to a variable', () => {
    const e = expr('x = y');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual(['y']);
  });

  test('should solve a simple equation with a variable', () => {
    const e = expr('x - 1 + y = 0');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        1 - y,
      ]
    `);
  });

  test('should solve a simple equation', () => {
    const e = expr('x + 2 = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([3]);
  });

  test('should solve an equation with a fractional coefficient', () => {
    const e = expr('\\frac{2}{3}x + \\frac{1}{3} = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([7]);
  });

  test('should solve an equation with a fractional root', () => {
    const e = expr('x^2 + 2x + \\frac{1}{4} = 0');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        -1 + sqrt(3)/2,
        -1 - sqrt(3)/2,
      ]
    `);
  });

  test('should solve an equation with a sqrt(x) term (issue #220)', () => {
    const e = expr('2x = \\sqrt{5x}');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        5/4,
        0,
      ]
    `);
  });

  test('should solve an equation with a complex root', () => {
    const e = expr('x^2 + 1 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`
      [
        [
          Complex,
          0,
          1,
        ],
        [
          Complex,
          -0,
          -1,
        ],
      ]
    `);
  });

  test('should **NOT** solve a quasi-quadratic equation', () => {
    const e = expr('x^2 + 3x + 2 + \\sin(x) = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toMatchInlineSnapshot(`[]`);
  });

  // test('should solve an inequality', () => {
  //   const e = expr('2x + 1 < 5');
  //   const result = e.solve('x')?.map((x) => x.json);
  //   expect(result).toMatchInlineSnapshot(`[]`); // @todo
  // });

  // test('should solve a system of equations', () => {
  //   const e1 = expr('x + y = 3');
  //   const e2 = expr('2x - y = 0');
  //   const result = expr([e1, e2]).solve(['x', 'y']);
  //   expect(result).toEqual(expr('x = 0, y = 3'));
  // });

  // Regression test for #261: solve() should work for variables regardless of
  // lexical ordering. When canonicalized, variables are sorted alphabetically
  // (e.g., b+2a becomes 2a+b), but solve() should still find solutions for any variable.
  test('should solve for variable that comes lexically after another unknown (#261)', () => {
    const e = expr('b + 2a = 3');
    // Solve for 'b' (which comes after 'a' alphabetically)
    const resultB = e.solve('b')?.map((x) => x.toString());
    expect(resultB).toMatchInlineSnapshot(`
      [
        -2a + 3,
      ]
    `);
    // Solve for 'a' should also work
    const resultA = e.solve('a')?.map((x) => x.toString());
    expect(resultA).toMatchInlineSnapshot(`
      [
        -1/2 * b + 3/2,
      ]
    `);
  });

  test('should solve for any variable in multi-variable equation (#261)', () => {
    const e = expr('z + 2y + 3x = 10');
    // All variables should be solvable regardless of their position
    expect(e.solve('x')?.map((x) => x.toString())).toMatchInlineSnapshot(`
      [
        -2/3 * y - 1/3 * z + 10/3,
      ]
    `);
    expect(e.solve('y')?.map((x) => x.toString())).toMatchInlineSnapshot(`
      [
        -3/2 * x - 1/2 * z + 5,
      ]
    `);
    expect(e.solve('z')?.map((x) => x.toString())).toMatchInlineSnapshot(`
      [
        -3x - 2y + 10,
      ]
    `);
  });
});

// Regression tests for #242: solve() should work for equations with variables
// in the numerator of fractions (e.g., F = 3g/h solving for g)
describe('SOLVING EQUATIONS WITH FRACTIONS (#242)', () => {
  test('should solve F = 3g/h for g', () => {
    const e = expr('F = 3g/h');
    const result = e.solve('g')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        1/3 * F * h,
      ]
    `);
  });

  test('should solve x/2 + 3 = 0 for x', () => {
    const e = expr('x/2 + 3 = 0');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([-6]);
  });

  test('should solve a/b + c*g/d = 0 for g', () => {
    const e = expr('a/b + c*g/d = 0');
    const result = e.solve('g')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        -(a * d) / (b * c),
      ]
    `);
  });

  test('should solve equation with multiple fractional terms', () => {
    const e = expr('x/2 + x/3 = 5');
    const result = e.solve('x')?.map((x) => x.json);
    expect(result).toEqual([6]);
  });

  test('should solve a/x = b for x (variable in denominator)', () => {
    const e = expr('a/x = b');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        a / b,
      ]
    `);
  });

  test('should solve 1/(x+1) = 2 for x', () => {
    const e = expr('1/(x+1) = 2');
    const result = e.solve('x')?.map((x) => x.toString());
    expect(result).toMatchInlineSnapshot(`
      [
        -1/2,
      ]
    `);
  });
});
