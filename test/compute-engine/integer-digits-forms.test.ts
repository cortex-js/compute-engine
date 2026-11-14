import { ComputeEngine, compile } from '../../src/compute-engine';

// Values are Wolfram's: FromDigits[{15, 15}, 16] = 255, FromDigits[{a, b, c}, x]
// = a x^2 + b x + c, IntegerString[5, 2, 8] = "00000101", DigitCount[5, 2, 0, 8]
// = 6, DigitSum[1234, 10, 2] = 3.

const ce = new ComputeEngine();
const L = (...ops: any[]) => ['List', ...ops];
const s = (text: string) => ({ str: text });

// [expression, evaluate() as JSON]; the value is the same under .N() and
// for a non-canonical box.
const exact: [any, any][] = [
  [['FromDigits', L(1, 0, 1), -2], 5],
  [['FromDigits', L(1, 1, 0), -2], 2],
  [['FromDigits', L(1, 2, 3), -10], 83],
  [['FromDigits', L(1, 2, -3), -2], -3],
  [['FromDigits', L(1, 2, 3), 1], 6],
  [['FromDigits', L(1, 2, 3), 0], 3],
  [
    ['FromDigits', L(1, 2, 3), ['Rational', 1, 2]],
    ['Rational', 17, 4],
  ],
  [
    ['FromDigits', L(1, 2, 3), ['Rational', -1, 2]],
    ['Rational', 9, 4],
  ],
  [
    ['FromDigits', L(1, 2, 3), 'ImaginaryUnit'],
    ['Complex', 2, 2],
  ],
  [['FromDigits', L(), 'x'], 0],
  [['FromDigits', L(1, 2, 3, 4)], 1234],
  [['FromDigits', L(1, 0, 1), 2], 5],
  [['IntegerString', 5, 2, 8], s('00000101')],
  [['IntegerString', -5, 2, 8], s('00000101')],
  [['IntegerString', 5, 2, 2], s('01')],
  [['IntegerString', 255, 16, 1], s('f')],
  [['IntegerString', 5, 2, 0], s('')],
  [['IntegerString', -42], s('-42')],
  [
    ['IntegerString', { num: '1000000000000000000000000000005' }, 2, 110],
    s('0000000000' + (10n ** 30n + 5n).toString(2)),
  ],
  [['DigitCount', 5, 2, 1, 8], 2],
  [['DigitCount', 5, 2, 0, 8], 6],
  [['DigitCount', 5, 2, 0, 2], 1],
  [['DigitCount', 5, 2, 0, 0], 0],
  [['DigitCount', -5, 2, 0, 8], 6],
  [['DigitCount', 5, 2, L(0, 1), 8], L(6, 2)],
  [['DigitCount', 5, 2, 0], 1],
  [['DigitSum', 1234, 10, 2], 3],
  [['DigitSum', 1234, 10, -2], 7],
  [['DigitSum', 1234, 10, 9], 10],
  [['DigitSum', 1234, 10, -9], 10],
  [['DigitSum', 1234, 10, 0], 0],
  [['DigitSum', -1234, 10, 2], 3],
  [['DigitSum', 255, 16, 1], 15],
  [['DigitSum', 1234, 2, 3], 1],
  [['DigitSum', 1234, 10, L(1, 2)], L(1, 3)],
  [['DigitSum', 1234, 2], 5],
];

describe('FromDigits, IntegerString, DigitCount and DigitSum take the Wolfram forms', () => {
  for (const [expr, expected] of exact) {
    const label = JSON.stringify(expr);
    test(`${label} = ${JSON.stringify(expected)} (evaluate)`, () => {
      expect(ce.box(expr).evaluate().json).toEqual(ce.box(expected).json);
    });
    test(`${label} (.N(), non-canonical)`, () => {
      const want = ce.box(expected).N().json;
      expect(ce.box(expr).N().json).toEqual(want);
      expect(ce.box(expr, { canonical: false }).evaluate().json).toEqual(
        ce.box(expected).json
      );
    });
  }
});

describe('FromDigits with a symbolic or non-integer base', () => {
  test('a symbolic base gives the polynomial', () => {
    expect(
      ce.box(['FromDigits', L('a', 'b', 'c'), 'x']).evaluate().json
    ).toEqual(
      ce.box([
        'Add',
        ['Multiply', 'a', ['Power', 'x', 2]],
        ['Multiply', 'b', 'x'],
        'c',
      ]).json
    );
    expect(
      ce.box(['FromDigits', L(1, 0, 1), ['Add', 'b', 1]]).evaluate().json
    ).toEqual(ce.box(['Add', 1, ['Power', ['Add', 'b', 1], 2]]).json);
  });

  test('a float base or digit gives a float', () => {
    expect(ce.box(['FromDigits', L(1, 2, 3), 2.5]).evaluate().re).toBe(14.25);
    expect(ce.box(['FromDigits', L(1, 2.5, 3), -2]).evaluate().re).toBe(2);
    expect(ce.box(['FromDigits', L(15, 15), 2.5]).evaluate().re).toBe(52.5);
  });

  test('an irrational base stays exact under evaluate and numeric under N', () => {
    const e = ce.box(['FromDigits', L(1, 2, 3), 'Pi']);
    expect(e.evaluate().json).toEqual(
      ce.box(['Add', 3, ['Multiply', 2, 'Pi'], ['Power', 'Pi', 2]]).json
    );
    expect(e.N().re).toBeCloseTo(19.152789708268945, 12);
  });

  test('past the term cap a non-integer base stays unevaluated', () => {
    const digits = Array.from({ length: 10_001 }, () => 1);
    expect(ce.box(['FromDigits', L(...digits), 'x']).evaluate().operator).toBe(
      'FromDigits'
    );
  });

  test('an integer base has no cap', () => {
    const digits = Array.from({ length: 10_001 }, () => 1);
    expect(
      ce
        .box(['FromDigits', L(...digits), 10])
        .evaluate()
        .toString().length
    ).toBe(10_001);
  });
});

describe('the length of the padded forms is capped', () => {
  for (const expr of [
    ['IntegerString', 5, 2, { num: '1000000000000' }],
    ['IntegerString', 5, 2, -1],
    ['IntegerDigits', 5, 2, { num: '1000000000' }],
    ['DigitCount', 5, 2, 0, { num: '1000000000' }],
    ['DigitCount', 5, 2, 0, -1],
  ])
    test(`${JSON.stringify(expr)} stays unevaluated`, () => {
      expect(ce.box(expr).evaluate().operator).toBe(expr[0]);
    });

  test('a long padding below the cap is built', () => {
    const r = ce.box(['IntegerDigits', 5, 2, 200_000]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.nops).toBe(200_000);
  });
});

describe('compiled constants agree with evaluate()', () => {
  for (const [expr, expected] of [
    [['DigitSum', 1234, 10, 2], 3],
    ] as [any, number][])
    test(`${JSON.stringify(expr)} = ${expected}`, () => {
      const compiled = compile(ce.box(expr));
      expect(compiled.success).toBe(true);
      expect((compiled.run as () => number)()).toBe(expected);
    });

  test('a call with an unknown operand has no lowering', () => {
    for (const expr of [
      ['DigitSum', 'x', 10, 2],
      ['DigitCount', 'x', 2, 0, 8],
      ['IntegerString', 'x', 2, 8],
      ['FromDigits', L('a', 'b', 'c'), 'x'],
    ])
      expect(() => compile(ce.box(expr), { fallback: false })).toThrow(
        /no lowering/
      );
  });
});
