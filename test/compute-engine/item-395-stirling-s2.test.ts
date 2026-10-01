import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// `StirlingS2` is Wolfram's spelling of `Stirling` (second kind) and shares
// its evaluation.

// [n, k, S(n, k)]; the triangle row 6 is 0 1 31 90 65 15 1 (OEIS A008277).
const table: [number, number, string][] = [
  [0, 0, '1'],
  [1, 0, '0'],
  [5, 0, '0'],
  [0, 1, 'unevaluated'],
  [3, 5, 'unevaluated'],
  [6, 1, '1'],
  [6, 2, '31'],
  [6, 3, '90'],
  [6, 4, '65'],
  [6, 5, '15'],
  [6, 6, '1'],
  [10, 5, '42525'],
  [12, 4, '611501'],
];

describe('StirlingS2 (#395)', () => {
  for (const [n, k, value] of table) {
    const stirling = ce.expr(['Stirling', n, k]);
    const s2 = ce.expr(['StirlingS2', n, k]);
    const expected = value === 'unevaluated' ? s2.toString() : value;

    test(`StirlingS2(${n}, ${k}) = ${expected} (evaluate)`, () => {
      expect(s2.evaluate().toString()).toBe(expected);
      expect(s2.evaluate().toString()).toBe(
        value === 'unevaluated'
          ? stirling.evaluate().toString().replace('Stirling', 'StirlingS2')
          : stirling.evaluate().toString()
      );
    });

    test(`StirlingS2(${n}, ${k}) = ${expected} (.N())`, () => {
      expect(s2.N().toString()).toBe(expected);
    });

    test(`StirlingS2(${n}, ${k}) = ${expected} (compiled)`, () => {
      const result = compile(s2);
      if (value === 'unevaluated') return;
      expect(String(result.run!())).toBe(expected);
    });
  }

  const stays: [unknown, string][] = [
    [['StirlingS2', -1, 3], 'StirlingS2(-1, 3)'],
    [['StirlingS2', 4, -2], 'StirlingS2(4, -2)'],
    [['StirlingS2', 'x', 3], 'StirlingS2(x, 3)'],
    [['StirlingS2', 6, 'k'], 'StirlingS2(6, k)'],
  ];
  for (const [json, expected] of stays) {
    test(`${expected} stays unevaluated`, () => {
      const e = ce.expr(json as any);
      expect(e.evaluate().toString()).toBe(expected);
      expect(e.N().toString()).toBe(expected);
    });
  }

  test('a float operand with an integer value gives 90 (.N())', () => {
    expect(ce.expr(['StirlingS2', 6.0, 3]).N().toString()).toBe('90');
  });

  test('StirlingS2(6, 3) compiles with a symbolic operand like Stirling', () => {
    const a = compile(ce.expr(['Stirling', 'x', 3]));
    const b = compile(ce.expr(['StirlingS2', 'x', 3]));
    expect(b.success).toBe(a.success);
    expect(b.calling).toBe(a.calling);
  });

  test('the signature and type match Stirling', () => {
    const a = ce.expr(['Stirling', 6, 3]);
    const b = ce.expr(['StirlingS2', 6, 3]);
    expect(b.type.toString()).toBe(a.type.toString());
    expect(ce.expr(['StirlingS2', 6, 3]).isValid).toBe(true);
  });

  test('Stirling is unchanged and the alias is its own head', () => {
    expect(ce.expr(['Stirling', 6, 3]).evaluate().toString()).toBe('90');
    expect(ce.expr(['StirlingS2', 6, 3]).operator).toBe('StirlingS2');
  });
});
