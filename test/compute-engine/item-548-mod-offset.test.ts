import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

// Issue #548: `Mod(m, n, d)` is `d + Mod(m − d, n)`, the representative of
// `m` modulo `n` in `[d, d + n)`. The compile targets, the enclosure,
// derivative, limit and measurement code decline the three-operand form.

const ce = new ComputeEngine();
ce.declare('n', 'integer');

type Json = MathJsonExpression;

const exact: [Json, string][] = [
  [['Mod', 7, 3, 1], '1'],
  [['Mod', 9, 3, 1], '3'],
  [['Mod', -1, 3, 1], '2'],
  [['Mod', 10, 4, -1], '2'],
  [['Mod', 7, 5, 3], '7'],
  [['Mod', 7, 3, 0], '1'],
  [['Mod', 7, -3, 0], '-2'],
  [['Mod', ['Rational', 7, 2], 2, ['Rational', 1, 2]], '3/2'],
  [['Mod', ['Rational', 1, 2], ['Rational', 1, 3], ['Rational', 1, 5]], '1/2'],
  [['Mod', 'Pi', 3, 1], 'pi'],
];

describe('Mod(m, n, d), exact operands', () => {
  for (const [json, expected] of exact) {
    test(`${JSON.stringify(json)} = ${expected} (evaluate)`, () => {
      expect(ce.box(json).evaluate().toString()).toBe(expected);
    });
  }
  test('the parse route and the compound operands agree', () => {
    expect(ce.parse('\\operatorname{mod}(7, 3, 1)').evaluate().toString()).toBe(
      '1'
    );
    expect(
      ce
        .box(['Mod', ['Add', 'x', 7, ['Negate', 'x']], 3, 1])
        .evaluate()
        .toString()
    ).toBe('1');
    expect(ce.box(['Mod', 9, 3, 1]).simplify().toString()).toBe('3');
  });
  test('the result is in [d, d + n)', () => {
    for (let m = -20; m <= 20; m++)
      for (const [n, d] of [
        [3, 1],
        [4, -1],
        [5, 0],
        [7, -3],
      ]) {
        const r = ce.box(['Mod', m, n, d]).evaluate().re;
        expect(r).toBeGreaterThanOrEqual(d);
        expect(r).toBeLessThan(d + n);
        expect(Math.abs((r - m) % n)).toBe(0);
      }
  });
});

describe('Mod(m, n, d), float operands', () => {
  const cases: [Json, number][] = [
    [['Mod', { num: '7.5' }, 3, 1], 1.5],
    [['Mod', 8, 3, { num: '0.5' }], 2],
    [['Mod', { num: '9.0' }, 3, 1], 3],
    [['Mod', 'Pi', 3, 1], Math.PI],
  ];
  for (const [json, expected] of cases) {
    test(`${JSON.stringify(json)} = ${expected} (evaluate, N)`, () => {
      const e = ce.box(json);
      expect(e.evaluate().re).toBeCloseTo(expected, 12);
      expect(e.N().re).toBeCloseTo(expected, 12);
    });
  }
  test('exact operands under .N() give the exact-operand value', () => {
    for (const [json, expected] of exact.slice(0, 5))
      expect(ce.box(json).N().toString()).toBe(expected);
  });
  test('an exact radical stays exact', () => {
    // `Mod(√2, 2, 1)` is `1 + Mod(√2 − 1, 2)`, which is `√2`
    const r = ce.box(['Mod', ['Sqrt', 2], 2, 1]).evaluate();
    expect(r.toString()).toBe('sqrt(2)');
    expect(ce.box(['Mod', ['Sqrt', 2], 2, 1]).N().re).toBeCloseTo(Math.SQRT2, 14);
  });
  test('a dividend of type number gives no real type', () => {
    const c = new ComputeEngine();
    c.declare('w', 'number');
    expect(c.box(['Mod', 'w', 3, 1]).type.toString()).not.toBe('real');
  });
  test('under .N(), a symbol with an exact value is read exactly near a jump', () => {
    const c = new ComputeEngine();
    c.assign('u', c.box(['Rational', 7, 3]));
    c.assign('t', c.box(['Rational', 1, 3]));
    for (const json of [
      ['Mod', 'u', 1, ['Rational', 1, 3]],
      ['Mod', ['Rational', 7, 3], 1, 't'],
      ['Mod', 'u', 1, 't'],
    ])
      expect(c.box(json as any).N().re).toBeCloseTo(1 / 3, 15);
  });
  test('under .N(), a dividend past the range of a double is reduced exactly', () => {
    // 2^(3^20) mod 7 is 1: the order of 2 mod 7 is 3
    expect(
      ce.box(['Mod', ['Power', 2, ['Power', 3, 20]], 7, 1]).N().re
    ).toBe(1);
  });
  test('under .N(), the offset cancels the exact residue exactly', () => {
    // `Mod(61/6, 1/3)` is `1/6`, and `1/6 - 1/6` is `0`, not a rounding error
    expect(
      ce
        .box(['Mod', 10, ['Rational', 1, 3], ['Rational', -1, 6]])
        .N()
        .is(0)
    ).toBe(true);
    expect(
      ce.box(['Mod', 10, ['Rational', 1, 3], ['Rational', -1, 6]]).N().re
    ).toBe(0);
  });
  test('a float operand gives a float', () => {
    expect(ce.box(['Mod', 7, 3, { num: '1.0' }]).evaluate().isExact).toBe(
      false
    );
  });
});

describe('Mod(m, n, d), symbolic and invalid', () => {
  for (const json of [
    ['Mod', 'x', 3, 1],
    ['Mod', 7, 3, 'x'],
    ['Mod', 7, 'y', 1],
  ] as Json[]) {
    test(`${JSON.stringify(json)} stays unevaluated`, () => {
      expect(ce.box(json).evaluate().operator).toBe('Mod');
      expect(ce.box(json).N().operator).toBe('Mod');
    });
  }
  test('a zero modulus is NaN, as for two operands', () => {
    expect(ce.box(['Mod', 7, 0, 1]).evaluate().isNaN).toBe(true);
  });
  test('a fourth operand is an error', () => {
    expect(ce.box(['Mod', 7, 3, 1, 2]).isValid).toBe(false);
  });
  test('the type takes the offset into account', () => {
    expect(ce.box(['Mod', 'n', 3, 1]).type.toString()).toBe('integer');
    expect(ce.box(['Mod', 'n', 3, ['Rational', 1, 2]]).type.toString()).toBe(
      'rational'
    );
    expect(ce.box(['Mod', 'n', 3, { num: '0.5' }]).type.toString()).toBe(
      'real'
    );
  });
  test('the sign of the offset form is not claimed', () => {
    expect(ce.box(['Mod', -7, 3, -5]).sgn).toBeUndefined();
  });
});

describe('Mod(m, n, d), broadcast', () => {
  test('a list operand', () => {
    expect(
      ce
        .box(['Mod', ['List', 7, 9, -1], 3, 1])
        .evaluate()
        .toString()
    ).toBe('[1,3,2]');
  });
});

describe('Mod(m, n, d), declined routes', () => {
  const body: Json = ['Mod', ['Add', 'x', 2], 3, 1];
  const targets = ['javascript', 'glsl', 'interval-js'] as const;

  for (const to of targets) {
    test(`${to} declines, and fallback gives the interpreter's value`, () => {
      expect(() => compile(ce.box(body), { to, fallback: false })).toThrow(
        /Mod with 3 operands/
      );
      const r = compile(ce.box(body), { to, fallback: true });
      expect(r.success).toBe(false);
      expect(r.code).toBe('');
      // The interpreter's `Mod(7, 3, 1)`, as the target returns a value.
      const v = r.run!({ x: 5 });
      if (to === 'interval-js')
        expect(v).toEqual({ kind: 'interval', value: { lo: 1, hi: 1 } });
      else expect(v).toBe(1);
    });
  }

  test('bigint mode declines', () => {
    const e = ce.box(['Mod', ['Add', 'n', 2], 3, 1]);
    expect(() => compile(e, { mode: 'bigint', fallback: false })).toThrow(
      /Mod with 3 operands/
    );
    const r = compile(e, { mode: 'bigint', fallback: true });
    expect(r.success).toBe(false);
    expect(Number(r.run!({ n: 5n }))).toBe(1);
  });

  test('the derivative stays symbolic', () => {
    expect(
      ce.box(['D', ['Mod', ['Multiply', 2, 'x'], 3, 1], 'x']).evaluate()
        .operator
    ).toBe('D');
    expect(
      ce
        .box(['D', ['Mod', 'y', 3, 1], 'x'])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('the limit stays unevaluated', () => {
    for (const at of [0.5, 1])
      expect(
        ce.box(['Limit', ['Function', ['Mod', 'x', 3, 1], 'x'], at]).evaluate()
          .operator
      ).toBe('Limit');
  });

  test('an enclosure operand stays unevaluated', () => {
    expect(ce.box(['Mod', ['Enclosure', 7, 8], 3, 1]).evaluate().operator).toBe(
      'Mod'
    );
  });

  test('a measurement operand stays unevaluated', () => {
    expect(
      ce.box(['Mod', ['Measurement', 7, 0.1], 3, 1]).evaluate().operator
    ).toBe('Mod');
  });
});

describe('Mod(m, n, d), LaTeX', () => {
  test('the offset is kept, and the form round-trips', () => {
    const latex = ce.box(['Mod', ['Multiply', 2, 'x'], 3, 1]).latex;
    expect(latex).toBe('\\mathrm{Mod}(2x, 3, 1)');
    expect(ce.parse(latex).json).toEqual(['Mod', ['Multiply', 2, 'x'], 3, 1]);
  });
  test('the two-operand form is unchanged', () => {
    expect(ce.box(['Mod', 'x', 3]).latex).toBe('x\\bmod3');
  });
});

describe('Mod(m, n), unchanged', () => {
  const cases: [Json, string][] = [
    [['Mod', 7, 3], '1'],
    [['Mod', -7, 3], '2'],
    [['Mod', 7, -3], '-2'],
    [['Mod', ['Rational', 1, 2], ['Rational', 1, 3]], '1/6'],
  ];
  for (const [json, expected] of cases)
    test(`${JSON.stringify(json)} = ${expected}`, () => {
      expect(ce.box(json).evaluate().toString()).toBe(expected);
      expect(ce.box(json).N().re).toBeCloseTo(Number(eval(expected)), 12);
    });
  test('compiles', () => {
    const r = compile(ce.box(['Mod', 'x', 3]));
    expect(r.success).toBe(true);
    expect(r.run!({ x: -7 })).toBe(2);
  });
});
