import { engine as ce } from '../utils';
import type { MathJsonExpression } from '../../src/math-json';

// Issue #395, modular arithmetic: PowerModList, PrimitiveRootList,
// RationalReconstruction, the rational-exponent PowerMod and the
// three-argument MultiplicativeOrder. Expected values were computed by
// Mathematica (and Sage for RationalReconstruction) and by an independent
// check below.

const powerModList: [MathJsonExpression, MathJsonExpression][] = [
  [
    ['PowerModList', 3, ['Rational', 1, 2], 11],
    ['List', 5, 6],
  ],
  [
    ['PowerModList', 1, ['Rational', 1, 3], 7],
    ['List', 1, 2, 4],
  ],
  [
    ['PowerModList', 2, 10, 1000],
    ['List', 24],
  ],
  [
    ['PowerModList', 2, ['Rational', 3, 2], 17],
    ['List', 5, 12],
  ],
  [
    ['PowerModList', 2, ['Rational', 2, 3], 31],
    ['List', 16, 18, 28],
  ],
  [
    ['PowerModList', 3, -1, 7],
    ['List', 5],
  ],
  [
    ['PowerModList', -1, ['Rational', 1, 2], 625],
    ['List', 182, 443],
  ],
  [
    ['PowerModList', -1, ['Rational', 1, 2], ['Add', ['Power', 10, 30], 57]],
    [
      'List',
      { num: '164543371520667882579352850009' },
      { num: '835456628479332117420647150048' },
    ],
  ],
  [
    ['PowerModList', 2, ['Rational', 1, 3], ['Subtract', ['Power', 2, 89], 1]],
    [
      'List',
      1073741824,
      { num: '205880356524696485265270985' },
      { num: '413089663117993651110549302' },
    ],
  ],
  [
    ['PowerModList', -1, ['Rational', 1, 2], ['Power', 5, 40]],
    [
      'List',
      { num: '2224618918409236552857702057' },
      { num: '6870328099320045826292688568' },
    ],
  ],
  [
    [
      'Length',
      [
        'PowerModList',
        1,
        ['Rational', 1, 2],
        [
          'Multiply',
          2,
          3,
          5,
          7,
          11,
          13,
          17,
          19,
          23,
          29,
          31,
          37,
          41,
          43,
          47,
          53,
        ],
      ],
    ],
    32768,
  ],
  [
    [
      'Length',
      [
        'PowerModList',
        1,
        ['Rational', 1, 1000],
        ['Subtract', ['Power', 2, 61], 1],
      ],
    ],
    50,
  ],
  [
    ['PowerModList', 8, ['Rational', 1, 3], 13],
    ['List', 2, 5, 6],
  ],
  [
    ['PowerModList', 2, 10, 100],
    ['List', 24],
  ],
  [
    ['PowerModList', 1, ['Rational', 1, 2], 15],
    ['List', 1, 4, 11, 14],
  ],
  [
    ['PowerModList', -1, ['Rational', 1, 2], 65],
    ['List', 8, 18, 47, 57],
  ],
  [
    [
      'PowerModList',
      ['PowerMod', 123456789, 2, ['Multiply', 1000003, 1000033]],
      ['Rational', 1, 2],
      ['Multiply', 1000003, 1000033],
    ],
    ['List', 123456789, 30305547335, 969730452764, 999912543310],
  ],
  [
    [
      'Equal',
      ['Length', ['PowerModList', 1, ['Rational', 1, 12], 1009]],
      ['GCD', 12, 1008],
    ],
    'True',
  ],
  [
    [
      'Equal',
      ['Length', ['PowerModList', 1, ['Rational', 1, 2], 1155]],
      ['Power', 2, ['PrimeNu', 1155]],
    ],
    'True',
  ],
  [
    [
      'Equal',
      ['PowerMod', 4, ['Rational', 1, 2], 7],
      ['First', ['PowerModList', 4, ['Rational', 1, 2], 7]],
    ],
    'True',
  ],
  [['PowerModList', 2, ['Rational', 1, 3], 7], ['List']],
  [['PowerModList', -1, ['Rational', 1, 2], 15], ['List']],
  [
    ['PowerModList', 1, ['Rational', 1, 2], 8],
    ['List', 1, 3, 5, 7],
  ],
  [['PowerModList', 2, ['Rational', 2, 3], 13], ['List']],
];

const powerModRational: [MathJsonExpression, MathJsonExpression][] = [
  [['PowerMod', 3, ['Rational', 1, 2], 2], 1],
  [['PowerMod', 4, ['Rational', 1, 2], 7], 2],
  [
    ['PowerMod', 3, ['Rational', 1, 2], ['Add', ['Power', 10, 30], 57]],
    { num: '492767688934650018614948489645' },
  ],
  [['PowerMod', 3, ['Rational', 1, 2], 2], 1],
  [
    ['PowerMod', 2, ['Rational', 1, 2], 5],
    ['PowerMod', 2, ['Rational', 1, 2], 5],
  ],
];

const primitiveRootList: [MathJsonExpression, MathJsonExpression][] = [
  [
    ['PrimitiveRootList', 7],
    ['List', 3, 5],
  ],
  [
    ['PrimitiveRootList', 9],
    ['List', 2, 5],
  ],
  [
    ['PrimitiveRootList', 10],
    ['List', 3, 7],
  ],
  [
    ['PrimitiveRootList', 25],
    ['List', 2, 3, 8, 12, 13, 17, 22, 23],
  ],
  [
    ['PrimitiveRootList', 4],
    ['List', 3],
  ],
  [
    ['PrimitiveRootList', 18],
    ['List', 5, 11],
  ],
  [['Length', ['PrimitiveRootList', 1009]], 288],
  [
    [
      'Equal',
      ['Length', ['PrimitiveRootList', 1009]],
      ['Totient', ['Totient', 1009]],
    ],
    'True',
  ],
  [
    ['Equal', ['First', ['PrimitiveRootList', 1009]], ['PrimitiveRoot', 1009]],
    'True',
  ],
  [['PrimitiveRootList', 12], ['List']],
  [['PrimitiveRootList', 8], ['List']],
];

const multiplicativeOrder: [MathJsonExpression, MathJsonExpression][] = [
  [['MultiplicativeOrder', 5, 8], 2],
  [['MultiplicativeOrder', 3, 7], 6],
  [['MultiplicativeOrder', 5, 7], 6],
  [['MultiplicativeOrder', 2, 7], 3],
  [['MultiplicativeOrder', -5, 7], 3],
  [['MultiplicativeOrder', 5, 7, ['List', 3, 11]], 2],
  [['MultiplicativeOrder', ['Power', 10, 10000], 7919], 3959],
  [['MultiplicativeOrder', 3, 7, ['List', -1, 1]], 3],
  [['MultiplicativeOrder', 5, 7, ['List', 2, 3, 4]], 2],
  [
    ['MultiplicativeOrder', 3, ['Subtract', ['Power', 2, 127], 1]],
    { num: '56713727820156410577229101238628035242' },
  ],
  [['MultiplicativeOrder', 1, 7], 1],
  [
    ['Equal', ['Mod', ['Totient', 7], ['MultiplicativeOrder', 3, 7]], 0],
    'True',
  ],
  [['MultiplicativeOrder', 5, 3], 2],
  [['MultiplicativeOrder', -5, 3], 1],
  [['MultiplicativeOrder', 5, 7, ['List', 4]], 2],
  [
    ['MultiplicativeOrder', 10, 22],
    ['MultiplicativeOrder', 10, 22],
  ],
  [
    ['MultiplicativeOrder', 2, 7, ['List', 3]],
    ['MultiplicativeOrder', 2, 7, ['List', 3]],
  ],
  [['MultiplicativeOrder', 10, 21], 6],
  [['MultiplicativeOrder', 21, 10], 1],
];

const rationalReconstruction: [MathJsonExpression, MathJsonExpression][] = [
  [
    ['RationalReconstruction', 6, 11],
    ['Rational', 1, 2],
  ],
  [
    ['RationalReconstruction', 714291, 1000003],
    ['Rational', 22, 7],
  ],
  [
    [
      'RationalReconstruction',
      { num: '1346063275047853145' },
      ['Subtract', ['Power', 2, 61], 1],
    ],
    ['Rational', 55835135, 15519504],
  ],
  [
    ['RationalReconstruction', 301316272, 1000000007],
    ['RationalReconstruction', 301316272, 1000000007],
  ],
  [
    ['RationalReconstruction', 3, 11],
    ['RationalReconstruction', 3, 11],
  ],
];

const all: [string, [MathJsonExpression, MathJsonExpression][]][] = [
  ['PowerModList', powerModList],
  ['PowerMod', powerModRational],
  ['PrimitiveRootList', primitiveRootList],
  ['MultiplicativeOrder', multiplicativeOrder],
  ['RationalReconstruction', rationalReconstruction],
];

// Each case reaches the same value through `evaluate()` and `.N()`.
describe('Modular heads (#395): reference values', () => {
  for (const [head, cases] of all) {
    for (const [input, expected] of cases) {
      const want = ce.expr(expected);
      const label = `${head}: ${ce.expr(input).toString()} = ${want.toString()}`;
      test(`${label} (evaluate)`, () =>
        expect(ce.expr(input).evaluate().json).toEqual(want.json));
      test(`${label} (N)`, () =>
        expect(ce.expr(input).N().json).toEqual(want.json));
    }
  }
});

// Operands that reduce to a literal take the same route.
const compound: [MathJsonExpression, MathJsonExpression][] = [
  [
    ['PowerModList', ['Subtract', ['Add', 3, 11], 11], ['Rational', 1, 2], 11],
    ['List', 5, 6],
  ],
  [
    ['PowerModList', 3, ['Rational', ['Subtract', 3, 2], 2], ['Add', 5, 6]],
    ['List', 5, 6],
  ],
  [['PowerMod', 4, ['Rational', 1, 2], ['Multiply', 7, 1]], 2],
  [
    ['PrimitiveRootList', ['Add', 3, 4]],
    ['List', 3, 5],
  ],
  [['MultiplicativeOrder', ['Add', 3, 2], 7, ['List', ['Subtract', 5, 1]]], 2],
  [
    ['RationalReconstruction', ['Add', 3, 3], ['Add', 5, 6]],
    ['Rational', 1, 2],
  ],
];

describe('Modular heads (#395): compound operands', () => {
  for (const [input, expected] of compound) {
    const want = ce.expr(expected);
    test(`${ce.expr(input).toString()} = ${want.toString()}`, () =>
      expect(ce.expr(input).evaluate().json).toEqual(want.json));
  }
});

// Mathematica's edge cases.
const edges: [MathJsonExpression, MathJsonExpression][] = [
  [
    ['PowerModList', 3, ['Rational', 1, 2], 1],
    ['List', 0],
  ],
  [
    ['PowerModList', 0, ['Rational', 1, 2], 9],
    ['List', 0, 3, 6],
  ],
  [
    ['PowerModList', 3, 0, 7],
    ['List', 1],
  ],
  [
    ['PowerModList', 2, ['Rational', -1, 2], 7],
    ['List', 2, 5],
  ],
  // 2 has no inverse mod 4; a modulus below 1 is rejected.
  [
    ['PowerModList', 2, -1, 4],
    ['PowerModList', 2, -1, 4],
  ],
  [
    ['PowerModList', 3, ['Rational', 1, 2], -11],
    ['PowerModList', 3, ['Rational', 1, 2], -11],
  ],
  [['PowerMod', 2, ['Rational', -1, 2], 7], 2],
  [['PowerMod', 0, ['Rational', 1, 2], 9], 0],
  [
    ['PowerMod', 3, ['Rational', 1, 2], 7],
    ['PowerMod', 3, ['Rational', 1, 2], 7],
  ],
  // The unit group mod 1 is {0}, generated by 0, as `PrimitiveRoot(1)` = 0.
  [
    ['PrimitiveRootList', 1],
    ['List', 0],
  ],
  [
    ['PrimitiveRootList', 2],
    ['List', 1],
  ],
  [['PrimitiveRootList', 0], ['List']],
  // 333332 roots are more than the list cap, so the head stays unevaluated.
  [
    ['PrimitiveRootList', 1000003],
    ['PrimitiveRootList', 1000003],
  ],
  [
    ['PrimitiveRootList', -7],
    ['List', 3, 5],
  ],
  [['MultiplicativeOrder', 3, 7, ['List', 1]], 6],
  [['MultiplicativeOrder', 1, 1, ['List', 1]], 1],
  [
    ['MultiplicativeOrder', 2, 7, ['List']],
    ['MultiplicativeOrder', 2, 7, ['List']],
  ],
  [
    ['RationalReconstruction', 3, 11],
    ['RationalReconstruction', 3, 11],
  ],
  [
    ['RationalReconstruction', 1, 0],
    ['RationalReconstruction', 1, 0],
  ],
];

describe('Modular heads (#395): edge cases', () => {
  for (const [input, expected] of edges) {
    const want = ce.expr(expected);
    test(`${ce.expr(input).toString()} = ${want.toString()}`, () =>
      expect(ce.expr(input).evaluate().json).toEqual(want.json));
  }
});

// Independent oracle: brute force over every residue.
const evalList = (json: MathJsonExpression): number[] => {
  const r = ce.expr(json).evaluate();
  return (r.ops ?? []).map((x) => Number(x.re));
};

const powMod = (a: number, e: number, m: number): number => {
  let r = 1 % m;
  for (let i = 0; i < e; i++) r = (r * a) % m;
  return r;
};

const gcdN = (a: number, b: number): number => (b === 0 ? a : gcdN(b, a % b));

describe('Modular heads (#395): brute-force oracle', () => {
  test('PowerModList(a, s/r, m) lists every x with x^r = a^s, m <= 40', () => {
    for (let m = 1; m <= 40; m++)
      for (let a = 0; a < m; a++)
        for (const [s, r] of [
          [1, 2],
          [1, 3],
          [2, 3],
          [3, 4],
          [1, 6],
        ]) {
          const target = powMod(a, s, m);
          const expected: number[] = [];
          for (let x = 0; x < m; x++)
            if (powMod(x, r, m) === target) expected.push(x);
          expect(evalList(['PowerModList', a, ['Rational', s, r], m])).toEqual(
            expected
          );
        }
  });

  test('PowerModList(a, -1, m) is the modular inverse, and unevaluated for a non-unit, m <= 40', () => {
    for (let m = 2; m <= 40; m++)
      for (let a = 1; a < m; a++) {
        const list = evalList(['PowerModList', a, -1, m]);
        if (gcdN(a, m) === 1) expect((a * list[0]) % m).toBe(1);
        else
          expect(ce.expr(['PowerModList', a, -1, m]).evaluate().operator).toBe(
            'PowerModList'
          );
      }
  });

  test('PrimitiveRootList(n) lists the generators of (Z/n)*, n <= 100', () => {
    for (let n = 2; n <= 100; n++) {
      const phi = Array.from({ length: n }, (_, k) => k).filter(
        (k) => gcdN(k, n) === 1
      ).length;
      const expected: number[] = [];
      for (let g = 1; g < n; g++) {
        if (gcdN(g, n) !== 1) continue;
        let order = 1;
        for (let p = g % n; p !== 1; p = (p * g) % n) order++;
        if (order === phi) expected.push(g);
      }
      expect(evalList(['PrimitiveRootList', n])).toEqual(expected);
    }
  });

  test('MultiplicativeOrder(k, n, {r}) is the least m >= 1 with k^m = r, n <= 30', () => {
    for (let n = 2; n <= 30; n++)
      for (let k = 1; k < n; k++)
        for (let r = 1; r < n; r++) {
          let expected: number | undefined;
          for (let m = 1; m <= n && expected === undefined; m++)
            if (powMod(k, m, n) === r) expected = m;
          const got = ce
            .expr(['MultiplicativeOrder', k, n, ['List', r]])
            .evaluate();
          if (gcdN(k, n) !== 1 || expected === undefined)
            expect(got.operator).toBe('MultiplicativeOrder');
          else expect(got.re).toBe(expected);
        }
  });

  test('RationalReconstruction inverts the reduction of a small fraction mod a prime', () => {
    const m = 1000003;
    for (const [p, q] of [
      [1, 2],
      [22, 7],
      [-5, 13],
      [100, 99],
      [-700, 3],
    ]) {
      const inverse = ce.expr(['PowerMod', q, -1, m]).evaluate().re;
      const a = (((p * inverse) % m) + m) % m;
      expect(ce.expr(['RationalReconstruction', a, m]).evaluate().json).toEqual(
        ce.expr(['Rational', p, q]).json
      );
    }
  });
});

describe('Modular heads (#395): non-integer operands', () => {
  // The base and the modulus must be integers: neither is rounded.
  for (const input of [
    ['PowerMod', 2.5, 2, 5],
    ['PowerMod', 2, ['Rational', 1, 2], 5.5],
    ['PowerModList', 2.5, ['Rational', 1, 2], 5],
    ['PrimitiveRootList', 7.5],
  ] as MathJsonExpression[])
    test(`${ce.expr(input).toString()} is rejected`, () =>
      expect(ce.expr(input).evaluate().isValid).toBe(false));
});

describe('Modular heads (#395): inputs that must not hang', () => {
  // The denominator of the exponent is a 31-digit prime. Only its common
  // factors with p − 1 matter, so it is never factored.
  test('PowerMod(3, 1/(10^30 + 57), 101) = 75', () =>
    expect(
      ce
        .expr([
          'PowerMod',
          3,
          ['Rational', 1, { num: '1000000000000000000000000000057' }],
          101,
        ])
        .evaluate().json
    ).toEqual(75));

  // An infinite list of residues leaves the head unevaluated.
  test('MultiplicativeOrder(2, 7, Range(1, +oo)) stays unevaluated', () =>
    expect(
      ce
        .expr(['MultiplicativeOrder', 2, 7, ['Range', 1, 'PositiveInfinity']])
        .evaluate().operator
    ).toBe('MultiplicativeOrder'));
});

describe('Modular heads (#395): parse route', () => {
  test('PowerMod(4, 1/2, 7) from LaTeX, evaluate and N', () => {
    const expr = ce.parse('\\operatorname{PowerMod}(4, \\frac{1}{2}, 7)');
    expect(expr.evaluate().json).toEqual(2);
    expect(expr.N().json).toEqual(2);
  });
  test('PowerModList(3, 1/2, 2(5)+1) from LaTeX, N', () =>
    expect(
      ce.parse('\\operatorname{PowerModList}(3, \\frac{1}{2}, 2(5)+1)').N().json
    ).toEqual(['List', 5, 6]));
});

describe('Modular heads (#395): PrimitiveRoot agrees with PrimitiveRootList', () => {
  // `PrimitiveRoot(n)` is the first entry of `PrimitiveRootList(n)`, and
  // undefined when the list is empty. The sign of `n` is ignored.
  for (const n of [-25, -14, -8, -7, -2, -1, 0, 1, 2, 4, 7, 8, 18]) {
    test(`n = ${n}`, () => {
      const list = ce.expr(['PrimitiveRootList', n]).evaluate();
      const root = ce.expr(['PrimitiveRoot', n]).evaluate();
      if (list.nops === 0) expect(root.operator).toBe('PrimitiveRoot');
      else expect(root.json).toEqual(list.ops![0].json);
    });
  }
  test('PrimitiveRoot(-7) = 3', () =>
    expect(ce.expr(['PrimitiveRoot', -7]).evaluate().json).toEqual(3));
  test('PrimitiveRoot(0) stays unevaluated and PrimitiveRootList(0) = []', () => {
    expect(ce.expr(['PrimitiveRoot', 0]).evaluate().operator).toBe(
      'PrimitiveRoot'
    );
    expect(ce.expr(['PrimitiveRootList', 0]).evaluate().json).toEqual(['List']);
  });
});

describe('Number theory: an infinite collection operand stays unevaluated', () => {
  const infinite: MathJsonExpression = ['Range', 1, 'PositiveInfinity'];
  for (const input of [
    ['ChineseRemainder', infinite, ['List', 3, 5]],
    ['ChineseRemainder', ['List', 2, 3], infinite],
    ['FromContinuedFraction', infinite],
    ['FromDigits', infinite],
    ['FromDigits', infinite, 2],
  ] as MathJsonExpression[])
    test(`${ce.expr(input).toString()}`, () =>
      expect(ce.expr(input).evaluate().operator).toBe(
        (input as [string, ...MathJsonExpression[]])[0]
      ));
  // A finite collection still works.
  test('ChineseRemainder([2, 3, 2], Range(3, 7, 2)) = 23', () =>
    expect(
      ce
        .expr(['ChineseRemainder', ['List', 2, 3, 2], ['Range', 3, 7, 2]])
        .evaluate().json
    ).toEqual(23));
});

describe('Number theory: a non-integer element stays unevaluated', () => {
  // A float or a rational element is not rounded. A float literal with an
  // integer value (2.0) is an integer, as for `FromContinuedFraction`.
  for (const input of [
    ['FromDigits', ['List', 1.5, 2]],
    ['FromDigits', ['List', ['Rational', 3, 2], 2]],
    ['ChineseRemainder', ['List', 2.5, 3], ['List', 3, 5]],
    ['ChineseRemainder', ['List', ['Rational', 5, 2], 3], ['List', 3, 5]],
    ['ChineseRemainder', ['List', 2, 3], ['List', 3.5, 5]],
  ] as MathJsonExpression[])
    test(`${ce.expr(input).toString()}`, () =>
      expect(ce.expr(input).evaluate().operator).toBe(
        (input as [string, ...MathJsonExpression[]])[0]
      ));
  test('FromDigits([2.0, 3]) = 23', () =>
    expect(
      ce.expr(['FromDigits', ['List', { num: '2.0' }, 3]]).evaluate().json
    ).toEqual(23));
  test('ChineseRemainder([2.0, 3], [3, 5]) = 8', () =>
    expect(
      ce
        .expr(['ChineseRemainder', ['List', { num: '2.0' }, 3], ['List', 3, 5]])
        .evaluate().json
    ).toEqual(8));
});

describe('Modular heads (#395): PowerMod with too many roots to list', () => {
  // x² ≡ 0 (mod 2²⁰⁰) has 2¹⁰⁰ roots, the multiples of 2¹⁰⁰: the least is 0.
  test('PowerMod(0, 1/2, 2^200) = 0', () =>
    expect(
      ce.expr(['PowerMod', 0, ['Rational', 1, 2], ['Power', 2, 200]]).evaluate()
        .json
    ).toEqual(0));
  // x² ≡ 1 modulo the product of the 17 odd primes 3 … 61 has 2¹⁷ roots.
  test('PowerMod(1, 1/2, 3·5·…·61) = 1', () =>
    expect(
      ce
        .expr([
          'PowerMod',
          1,
          ['Rational', 1, 2],
          [
            'Multiply',
            3,
            5,
            7,
            11,
            13,
            17,
            19,
            23,
            29,
            31,
            37,
            41,
            43,
            47,
            53,
            59,
            61,
          ],
        ])
        .evaluate().json
    ).toEqual(1));
  // The list itself is still too long.
  test('PowerModList(0, 1/2, 2^200) stays unevaluated', () =>
    expect(
      ce
        .expr(['PowerModList', 0, ['Rational', 1, 2], ['Power', 2, 200]])
        .evaluate().operator
    ).toBe('PowerModList'));
  // 3 is not a square mod 7, so there is no root mod 7·2²⁰⁰.
  test('PowerMod(3, 1/2, 7·2^200) stays unevaluated', () =>
    expect(
      ce
        .expr([
          'PowerMod',
          3,
          ['Rational', 1, 2],
          ['Multiply', 7, ['Power', 2, 200]],
        ])
        .evaluate().operator
    ).toBe('PowerMod'));
});

describe('Modular heads (#395): MultiplicativeOrder ignores the sign of n', () => {
  // The unit group mod −n is the unit group mod n.
  test('MultiplicativeOrder(3, -7) = MultiplicativeOrder(3, 7) = 6', () => {
    expect(ce.expr(['MultiplicativeOrder', 3, -7]).evaluate().json).toEqual(6);
    expect(ce.expr(['MultiplicativeOrder', 3, 7]).evaluate().json).toEqual(6);
  });
  test('MultiplicativeOrder(3, -7, [6]) = MultiplicativeOrder(3, 7, [6]) = 3', () => {
    expect(
      ce.expr(['MultiplicativeOrder', 3, -7, ['List', 6]]).evaluate().json
    ).toEqual(3);
    expect(
      ce.expr(['MultiplicativeOrder', 3, 7, ['List', 6]]).evaluate().json
    ).toEqual(3);
  });
  test('MultiplicativeOrder(3, 0) stays unevaluated', () =>
    expect(ce.expr(['MultiplicativeOrder', 3, 0]).evaluate().operator).toBe(
      'MultiplicativeOrder'
    ));
});
