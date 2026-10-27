import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// An integral whose integrand is a LIST is one integral per element, as an
// integral with a list bound is (see
// `tycho-325-integrate-list-limit-broadcast.test.ts`). When a bound is also a
// list, the elements are paired, and the lengths must agree.
//
// Reference values: ∫_0^1 ∫_0^g x·y dx dy = g²/4, and
// ∫_0^h ∫_0^g x·y dx dy = g²·h²/4.

function values(expr: Expression): number[] {
  const result: number[] = [];
  for (const el of expr.each()) result.push(el.re);
  return result;
}

function expectClose(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++)
    expect(Math.abs(actual[i] - expected[i])).toBeLessThan(1e-9);
}

const QUARTERS = ['List', ['Rational', 1, 4], 1, ['Rational', 9, 4]];

describe('An inner integral with a list bound', () => {
  test('parse route: evaluate() and N()', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.parse('[1, 2, 3]'));
    const expr = ce.parse('\\int_0^1\\int_0^{G} xy\\,dx\\,dy');
    expect(expr.type.toString()).toBe('list<number>');
    expect(expr.evaluate().json).toEqual(QUARTERS);
    const n = expr.N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [0.25, 1, 2.25]);
  });

  test('box route', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      [
        'Integrate',
        ['Multiply', 'x', 'y'],
        ['Limits', 'x', 0, ['List', 1, 2, 3]],
      ],
      ['Limits', 'y', 0, 1],
    ]);
    expect(expr.type.toString()).toBe('list<number>');
    expect(expr.evaluate().json).toEqual(QUARTERS);
    expectClose(values(expr.N()), [0.25, 1, 2.25]);
  });

  test('ce.function route with pre-boxed operands', () => {
    const ce = new ComputeEngine();
    const [x, y] = [ce.symbol('x'), ce.symbol('y')];
    const inner = ce.function('Integrate', [
      ce.function('Multiply', [x, y]),
      ce.function('Limits', [x, ce.number(0), ce.parse('[1, 2, 3]')]),
    ]);
    const expr = ce.function('Integrate', [
      inner,
      ce.function('Limits', [y, ce.number(0), ce.number(1)]),
    ]);
    expect(expr.type.toString()).toBe('list<number>');
    expect(expr.evaluate().json).toEqual(QUARTERS);
    expectClose(values(expr.N()), [0.25, 1, 2.25]);
  });

  test('a list bound substituted into a declared list<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('G', 'list<number>');
    const expr = ce.parse('\\int_0^1\\int_0^{G} xy\\,dx\\,dy');
    expect(expr.type.toString()).toBe('list<number>');
    const G = ce.parse('[1, 2, 3]');
    expect(expr.subs({ G }).evaluate().json).toEqual(QUARTERS);
    expectClose(values(expr.subs({ G }).N()), [0.25, 1, 2.25]);
  });

  test('an assigned integration variable does not substitute', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('y', 7);
    ce.assign('G', ce.parse('[1, 2, 3]'));
    const expr = ce.parse('\\int_0^1\\int_0^{G} xy\\,dx\\,dy');
    expect(expr.evaluate().json).toEqual(QUARTERS);
    expectClose(values(expr.N()), [0.25, 1, 2.25]);
  });

  test('the compiled javascript route agrees', () => {
    const ce = new ComputeEngine();
    ce.declare('G', 'list<number>');
    const r = compile(ce.parse('\\int_0^1\\int_0^{G} xy\\,dx\\,dy'), {
      to: 'javascript',
    } as never) as any;
    expect(r.success).toBe(true);
    expectClose(r.run({ G: [1, 2, 3] }) as number[], [0.25, 1, 2.25]);
  });
});

describe('Two list bounds in one multiple integral', () => {
  test('equal lengths: paired element by element under evaluate()', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, ['List', 1, 2]],
      ['Limits', 'y', 0, ['List', 2, 1]],
    ]);
    // Before, the inner limit gave a list integrand and the outer integral
    // stayed unevaluated.
    expect(expr.evaluate().json).toEqual(['List', 1, 1]);
    expectClose(values(expr.N()), [1, 1]);
  });

  test('different lengths: incompatible-dimensions under evaluate() and N()', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, ['List', 1, 2]],
      ['Limits', 'y', 0, ['List', 1, 2, 3]],
    ]);
    const v = expr.evaluate();
    expect(v.operator).toBe('Error');
    expect(JSON.stringify(v.json)).toContain('incompatible-dimensions');
    // `N()` gives the same error.
    expect(expr.N().json).toEqual(v.json);
  });
});

describe('A list integrand', () => {
  test('parse route', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_0^1 [x, 2x]\\,dx');
    expect(expr.type.toString()).toBe('vector<2>');
    expect(expr.evaluate().json).toEqual(['List', ['Rational', 1, 2], 1]);
    const n = expr.N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [0.5, 1]);
  });

  test('box route', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['List', 'x', ['Multiply', 2, 'x']],
      ['Limits', 'x', 0, 1],
    ]);
    expect(expr.evaluate().json).toEqual(['List', ['Rational', 1, 2], 1]);
    expectClose(values(expr.N()), [0.5, 1]);
  });

  test('ce.function route with pre-boxed operands', () => {
    const ce = new ComputeEngine();
    const x = ce.symbol('x');
    const expr = ce.function('Integrate', [
      ce.function('List', [x, ce.function('Multiply', [ce.number(2), x])]),
      ce.function('Limits', [x, ce.number(0), ce.number(1)]),
    ]);
    expect(expr.evaluate().json).toEqual(['List', ['Rational', 1, 2], 1]);
    expectClose(values(expr.N()), [0.5, 1]);
  });

  test('a nested list keeps its shape', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_0^1 [[x],[2x]]\\,dx');
    expect(expr.type.toString()).toBe('matrix<2x1>');
    expect(expr.evaluate().json).toEqual([
      'List',
      ['List', ['Rational', 1, 2]],
      ['List', 1],
    ]);
  });

  test('an indefinite integral of a list', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int [x, 2x]\\,dx').evaluate().json).toEqual([
      'List',
      ['Multiply', ['Rational', 1, 2], ['Power', 'x', 2]],
      ['Power', 'x', 2],
    ]);
  });

  test('a list bound of the same length is paired', () => {
    const ce = new ComputeEngine();
    // [∫_0^1 x dx, ∫_0^2 2x dx] = [1/2, 4]
    const expr = ce.box([
      'Integrate',
      ['List', 'x', ['Multiply', 2, 'x']],
      ['Limits', 'x', 0, ['List', 1, 2]],
    ]);
    expect(expr.evaluate().json).toEqual(['List', ['Rational', 1, 2], 4]);
    expectClose(values(expr.N()), [0.5, 4]);
  });

  test('a list bound of another length', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['List', 'x', ['Multiply', 2, 'x']],
      ['Limits', 'x', 0, ['List', 1, 2, 3]],
    ]);
    const v = expr.evaluate();
    expect(v.operator).toBe('Error');
    expect(JSON.stringify(v.json)).toContain('incompatible-dimensions');
    expect(expr.N().json).toEqual(v.json);
  });

  test('the compiled javascript route agrees', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\int_0^1 [x, 2x]\\,dx'), {
      to: 'javascript',
    } as never) as any;
    expect(r.success).toBe(true);
    expectClose(r.run({}) as number[], [0.5, 1]);
  });
});

// A tuple integrand is integrated coordinate by coordinate, as `Sum` sums a
// tuple summand (`\sum_{n=1}^3 (n, 2n)` is `(6, 12)`). User decision of
// 2026-09-27; before it, the integral stayed whole and unevaluated.
//
// Reference values: ∫_0^1 k·x dx = k/2, ∫_0^b k·x dx = k·b²/2,
// ∫ x dx = x²/2, ∫ 2x dx = x², ∫_0^π sin x dx = 2, ∫_0^π cos x dx = 0.
describe('A tuple integrand is integrated coordinate by coordinate', () => {
  const HALF_ONE = ['Tuple', ['Rational', 1, 2], 1];

  test('box route', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['Tuple', 'x', ['Multiply', 2, 'x']],
      ['Limits', 'x', 0, 1],
    ]);
    expect(expr.type.toString()).toBe('tuple<number, number>');
    expect(expr.evaluate().json).toEqual(HALF_ONE);
    const n = expr.N();
    expect(n.operator).toBe('Tuple');
    expectClose(values(n), [0.5, 1]);
  });

  test('ce.function route with pre-boxed operands', () => {
    const ce = new ComputeEngine();
    const x = ce.symbol('x');
    const expr = ce.function('Integrate', [
      ce.function('Tuple', [x, ce.function('Multiply', [ce.number(2), x])]),
      ce.function('Limits', [x, ce.number(0), ce.number(1)]),
    ]);
    expect(expr.type.toString()).toBe('tuple<number, number>');
    expect(expr.evaluate().json).toEqual(HALF_ONE);
    expectClose(values(expr.N()), [0.5, 1]);
  });

  // `(x, 2x)` is a tuple outside an integral. Inside one it was once read as
  // a `Block` of two statements: `evaluate()` integrated `x` and answered
  // 1/2, while `N()` integrated `2x` and answered 1.
  test.each([
    ['\\int_0^1 (x, 2x)\\,dx', [0.5, 1]],
    ['\\int_0^1 (x, 2x, 3x)\\,dx', [0.5, 1, 1.5]],
    ['\\int_0^1 (x; 2x)\\,dx', [0.5, 1]],
  ])('parse route: %s', (latex, expected) => {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    const body = expr.op1.op1;
    expect(body.operator).toBe('Block');
    expect(body.op1.operator).toBe('Tuple');
    expect(body.op1.nops).toBe(expected.length);
    expect(expr.type.toString()).toBe(
      `tuple<${expected.map(() => 'number').join(', ')}>`
    );
    const v = expr.evaluate();
    expect(v.operator).toBe('Tuple');
    expectClose(values(v), expected);
    const w = expr.N();
    expect(w.operator).toBe('Tuple');
    expectClose(values(w), expected);
    // The LaTeX round trip keeps the tuple.
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });

  test('the exact values of a 3-tuple', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int_0^1 (x, 2x, 3x)\\,dx').evaluate().json).toEqual([
      'Tuple',
      ['Rational', 1, 2],
      1,
      ['Rational', 3, 2],
    ]);
  });

  test('an indefinite integral of a tuple', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int (x, 2x)\\,dx');
    expect(expr.type.toString()).toBe('tuple<number, number>');
    expect(expr.evaluate().json).toEqual([
      'Tuple',
      ['Multiply', ['Rational', 1, 2], ['Power', 'x', 2]],
      ['Power', 'x', 2],
    ]);
  });

  test('transcendental coordinates', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_0^\\pi (\\sin x, \\cos x)\\,dx');
    expect(expr.evaluate().json).toEqual(['Tuple', 2, 0]);
    expectClose(values(expr.N()), [2, 0]);
  });

  test('a multiple integral of a tuple', () => {
    const ce = new ComputeEngine();
    // (∫_0^2 ∫_0^1 x dx dy, ∫_0^2 ∫_0^1 y dx dy) = (1, 2)
    const expr = ce.box([
      'Integrate',
      ['Tuple', 'x', 'y'],
      ['Limits', 'x', 0, 1],
      ['Limits', 'y', 0, 2],
    ]);
    expect(expr.evaluate().json).toEqual(['Tuple', 1, 2]);
    expectClose(values(expr.N()), [1, 2]);
  });

  test('an assigned integration variable does not substitute', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const expr = ce.parse('\\int_0^1 (x, 2x)\\,dx');
    expect(expr.evaluate().json).toEqual(HALF_ONE);
    expectClose(values(expr.N()), [0.5, 1]);
  });

  // A tuple is a point, not a list: its coordinates are not paired with the
  // elements of a list bound. The list bound gives one tuple per element.
  test('a list bound gives a list of tuples', () => {
    const ce = new ComputeEngine();
    // [∫_0^1 (x, 2x) dx, ∫_0^2 (x, 2x) dx, ∫_0^3 (x, 2x) dx]
    //   = [(1/2, 1), (2, 4), (9/2, 9)]
    const expr = ce.box([
      'Integrate',
      ['Tuple', 'x', ['Multiply', 2, 'x']],
      ['Limits', 'x', 0, ['List', 1, 2, 3]],
    ]);
    expect(expr.type.toString()).toBe('list<tuple<number, number>>');
    expect(expr.evaluate().json).toEqual([
      'List',
      HALF_ONE,
      ['Tuple', 2, 4],
      ['Tuple', ['Rational', 9, 2], 9],
    ]);
    const n = expr.N();
    expect(n.operator).toBe('List');
    const points = [...n.each()].map((p) => values(p));
    expect(points).toHaveLength(3);
    expectClose(points[0], [0.5, 1]);
    expectClose(points[1], [2, 4]);
    expectClose(points[2], [4.5, 9]);
  });

  test('a list bound through the parse route', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.parse('[1, 2]'));
    const expr = ce.parse('\\int_0^{G} (x, 2x)\\,dx');
    expect(expr.type.toString()).toBe('list<tuple<number, number>>');
    expect(expr.evaluate().json).toEqual(['List', HALF_ONE, ['Tuple', 2, 4]]);
  });

  test('two list bounds of different lengths', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['Tuple', 'x', 'y'],
      ['Limits', 'x', 0, ['List', 1, 2]],
      ['Limits', 'y', 0, ['List', 1, 2, 3]],
    ]);
    const v = expr.evaluate();
    expect(v.operator).toBe('Error');
    expect(JSON.stringify(v.json)).toContain('incompatible-dimensions');
    expect(expr.N().json).toEqual(v.json);
  });

  // The signature's result admits `tuple` and `list<tuple>`, so the tuple
  // types that the type handler gives are not a signature mismatch.
  test('the declared signature admits the tuple result', () => {
    const ce = new ComputeEngine();
    for (const [bound, type] of [
      [1, 'tuple<number, number>'],
      [['List', 1, 2], 'list<tuple<number, number>>'],
    ] as const) {
      const expr = ce.box([
        'Integrate',
        ['Tuple', 'x', ['Multiply', 2, 'x']],
        ['Limits', 'x', 0, bound as any],
      ]);
      expect(expr.isValid).toBe(true);
      expect(expr.type.toString()).toBe(type);
    }
  });

  test('the compiled javascript route agrees', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\int_0^1 (x, 2x)\\,dx'), {
      to: 'javascript',
    } as never) as any;
    expect(r.success).toBe(true);
    expectClose(r.run({}) as number[], [0.5, 1]);
  });
});

describe('A scalar integrand', () => {
  test('a parenthesized single expression is still the integrand', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int_0^1 (x+1)\\,dx').evaluate().json).toEqual([
      'Rational',
      3,
      2,
    ]);
  });

  test('a scalar integrand still types as a number', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int_0^1 x\\,\\mathrm{d}x').type.toString()).toBe(
      'number'
    );
  });
});

// Tycho row 459 (the values A_in… of document `neyret/2agcgxq87y`): an
// integrand that restricts a list, `y·When(c(y), 0 ≤ y ≤ 5)` with `c(y)` an
// inner integral that reads the list `E`, gave NaN under N(). The type of a
// `When` has a `missing` arm, and its value is not a `List` until it is
// distributed over the elements. Closed forms, with E = [0.1, 0.5]:
// ∫_0^1 y ∫_{-1}^{1} 1/max(ε, |x|) dx dy = 1 + ln(1/ε), and, with
// E = [1.5, 0.5], ∫_0^1 1/max(ε, y + 1) dy = 1/3 + ln(4/3) for 1.5 and ln 2
// for 0.5.
describe('A restricted list integrand', () => {
  test('a nested integral inside When, under N()', () => {
    const ce = new ComputeEngine();
    ce.declare('E', 'list<real>');
    ce.assign('E', ce.box(['List', 0.1, 0.5]));
    const inner = [
      'Integrate',
      ['Function', ['Divide', 1, ['ElementMax', 'E', ['Abs', 'x']]], 'x'],
      ['Limits', 'x', -1, 1],
    ];
    const n = ce
      .box([
        'Integrate',
        [
          'Function',
          ['Multiply', 'y', ['When', inner, ['LessEqual', 0, 'y', 5]]],
          'y',
        ],
        ['Limits', 'y', 0, 1],
      ] as any)
      .N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [1 + Math.log(10), 1 + Math.log(2)]);
  });

  const expected = [1 / 3 + Math.log(4 / 3), Math.log(2)];
  const body = ['Divide', 1, ['ElementMax', 'E', ['Add', 'y', 1]]];

  for (const [label, integrand] of [
    ['When', ['When', body, ['LessEqual', 0, 'y', 5]]],
    [
      'Which with a default',
      ['Which', ['LessEqual', 0, 'y', 5], body, 'True', 'Nothing'],
    ],
    ['Which with no default', ['Which', ['LessEqual', 0, 'y', 5], body]],
  ] as const) {
    test(`${label}: one integral per element`, () => {
      const ce = new ComputeEngine();
      ce.declare('E', 'list<real>');
      ce.assign('E', ce.box(['List', 1.5, 0.5]));
      const n = ce
        .box([
          'Integrate',
          ['Function', integrand, 'y'],
          ['Limits', 'y', 0, 1],
        ] as any)
        .N();
      expect(n.operator).toBe('List');
      expectClose(values(n), expected);
    });
  }

  test('parse route', () => {
    const ce = new ComputeEngine();
    ce.declare('E', 'list<real>');
    ce.assign('E', ce.box(['List', 1.5, 0.5]));
    const n = ce
      .parse(
        '\\int_0^1 \\left\\{0\\le y\\le 5: \\frac{1}{\\operatorname{ElementMax}(E, y+1)}\\right\\}\\,dy'
      )
      .N();
    expect(n.operator).toBe('List');
    expectClose(values(n), expected);
  });

  test('a masked part of the range gives NaN for each element, as for a scalar', () => {
    const ce = new ComputeEngine();
    const scalar = ce
      .box([
        'Integrate',
        ['Function', ['When', 'y', ['LessEqual', 'y', 1]], 'y'],
        ['Limits', 'y', 0, 2],
      ])
      .N();
    expect(scalar.isNaN).toBe(true);
    const list = ce
      .box([
        'Integrate',
        [
          'Function',
          ['When', ['List', 'y', ['Multiply', 2, 'y']], ['LessEqual', 'y', 1]],
          'y',
        ],
        ['Limits', 'y', 0, 2],
      ])
      .N();
    expect(list.operator).toBe('List');
    expect(list.ops!.every((x) => x.isNaN)).toBe(true);
  });

  test('a restriction by a list of booleans is not distributed', () => {
    const ce = new ComputeEngine();
    const n = ce
      .box([
        'Integrate',
        [
          'Function',
          [
            'When',
            ['List', 'y', ['Multiply', 2, 'y']],
            ['List', 'True', 'True'],
          ],
          'y',
        ],
        ['Limits', 'y', 0, 1],
      ])
      .N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [0.5, 1]);
  });
});

// Closed forms: ∫_0^1 Which(y < 1/2, [y, 2y], True, 0) dy = [1/8, 1/4]. With
// E = [1.5, 0.5], ∫_0^1 Which(y < 1/2, E·y, True, 0) dy = [3/16, 1/16]. The
// nested piecewise Which(y < 1/2, [y, 2y], True, Which(y < 3/4, [3y, 4y],
// True, [5y, 6y])) gives 1/8 + 3·5/32 + 5·7/32 = 27/16 and
// 1/4 + 4·5/32 + 6·7/32 = 35/16.
describe('A piecewise list integrand', () => {
  const which = [
    'Which',
    ['Less', 'y', 0.5],
    ['List', 'y', ['Multiply', 2, 'y']],
    'True',
    0,
  ];
  const integral = (ce: ComputeEngine, body: unknown) =>
    ce.box([
      'Integrate',
      ['Function', body, 'y'],
      ['Limits', 'y', 0, 1],
    ] as any);

  test('a Which with a scalar default, under N() and evaluate()', () => {
    const ce = new ComputeEngine();
    const n = integral(ce, which).N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [0.125, 0.25]);
    const e = integral(ce, which).evaluate();
    expect(e.operator).toBe('List');
    expectClose(values(e.N()), [0.125, 0.25]);
  });

  test('a Which with a scalar default: the integral is typed as a list or a number', () => {
    const ce = new ComputeEngine();
    expect(integral(ce, which).type.toString()).toBe('number | vector<2>');
  });

  test('a Which whose value is a product with a list symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('E', 'list<real>');
    ce.assign('E', ce.box(['List', 1.5, 0.5]));
    const n = integral(ce, [
      'Which',
      ['Less', 'y', 0.5],
      ['Multiply', 'E', 'y'],
      'True',
      0,
    ]).N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [3 / 16, 1 / 16]);
  });

  test('a Which with a scalar default, parse route', () => {
    const ce = new ComputeEngine();
    const n = ce
      .parse(
        '\\int_0^1 \\begin{cases}[y,2y] & y<0.5\\\\ 0 & \\text{otherwise}\\end{cases}\\,dy'
      )
      .N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [0.125, 0.25]);
  });

  test('a nested Which with an undecided condition is distributed', () => {
    const ce = new ComputeEngine();
    const nested = [
      'Which',
      ['Less', 'y', ['Rational', 1, 2]],
      ['List', 'y', ['Multiply', 2, 'y']],
      'True',
      [
        'Which',
        ['Less', 'y', ['Rational', 3, 4]],
        ['List', ['Multiply', 3, 'y'], ['Multiply', 4, 'y']],
        'True',
        ['List', ['Multiply', 5, 'y'], ['Multiply', 6, 'y']],
      ],
    ];
    const n = integral(ce, nested).N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [27 / 16, 35 / 16]);
    const e = integral(ce, nested).evaluate();
    expect(e.toString()).toBe('[27/16,35/16]');
  });

  test('a condition typed as a list of booleans is not distributed', () => {
    const ce = new ComputeEngine();
    ce.declare('B', 'list<boolean>');
    const n = integral(ce, [
      'When',
      ['List', 'y', ['Multiply', 2, 'y']],
      'B',
    ]).N();
    // The mask `B` has no value: the integral stays held, and is not a list
    // of integrals of `When(y, B)` and `When(2y, B)`.
    expect(n.operator).toBe('Integrate');
    const w = integral(ce, [
      'Which',
      'B',
      ['List', 'y', ['Multiply', 2, 'y']],
      'True',
      0,
    ]).N();
    expect(w.operator).not.toBe('List');
  });

  test('a restricted list integrand is typed as a list', () => {
    const ce = new ComputeEngine();
    const i = integral(ce, [
      'When',
      ['List', 'y', ['Multiply', 2, 'y']],
      ['Less', 'y', 2],
    ]);
    expect(i.type.toString()).toBe('vector<2>');
    // An enclosing integral sees a list integrand: ∫_0^1 ∫_0^1 [xy, 2xy]
    // dy dx = [1/4, 1/2].
    const outer = ce.box([
      'Integrate',
      [
        'Function',
        [
          'Integrate',
          [
            'Function',
            [
              'When',
              ['List', ['Multiply', 'x', 'y'], ['Multiply', 2, 'x', 'y']],
              ['Less', 'y', 2],
            ],
            'y',
          ],
          ['Limits', 'y', 0, 1],
        ],
        'x',
      ],
      ['Limits', 'x', 0, 1],
    ] as any);
    expect(outer.type.toString()).toBe('vector<2>');
    const n = outer.N();
    expect(n.operator).toBe('List');
    expectClose(values(n), [0.25, 0.5]);
  });

  test('a restricted tuple is integrated coordinate by coordinate', () => {
    const ce = new ComputeEngine();
    const i = integral(ce, [
      'When',
      ['Tuple', 'y', ['Multiply', 2, 'y']],
      ['Less', 'y', 2],
    ]);
    expect(i.type.toString()).toBe('tuple<number, number>');
    const n = i.N();
    expect(n.operator).toBe('Tuple');
    expectClose(values(n), [0.5, 1]);
  });
});
