import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// `StirlingS2` is Wolfram's spelling of `Stirling` (second kind). It is an
// alias: its canonical form is `Stirling`, the preferred name.

// [n, k, S(n, k)]; the triangle row 6 is 0 1 31 90 65 15 1 (OEIS A008277).
const table: [number, number, string][] = [
  [0, 0, '1'],
  [1, 0, '0'],
  [5, 0, '0'],
  [0, 1, '0'],
  [3, 5, '0'],
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
    const expected = value;

    test(`StirlingS2(${n}, ${k}) = ${expected} (evaluate)`, () => {
      expect(s2.evaluate().toString()).toBe(expected);
      expect(s2.evaluate().toString()).toBe(stirling.evaluate().toString());
    });

    test(`StirlingS2(${n}, ${k}) = ${expected} (.N())`, () => {
      expect(s2.N().toString()).toBe(expected);
    });

    test(`StirlingS2(${n}, ${k}) = ${expected} (compiled)`, () => {
      const result = compile(s2);
      expect(result.success).toBe(true);
      expect(String(result.run!())).toBe(expected);
    });
  }

  const stays: [unknown, string][] = [
    [['StirlingS2', -1, 3], 'Stirling(-1, 3)'],
    [['StirlingS2', 4, -2], 'Stirling(4, -2)'],
    [['StirlingS2', 'x', 3], 'Stirling(x, 3)'],
    [['StirlingS2', 6, 'k'], 'Stirling(6, k)'],
  ];
  for (const [json, expected] of stays) {
    test(`${expected} stays unevaluated`, () => {
      const e = ce.expr(json as any);
      expect(e.evaluate().toString()).toBe(expected);
      expect(e.N().toString()).toBe(expected);
    });
  }

  test('a non-integer operand is validated like Stirling', () => {
    const a = ce.expr(['StirlingS2', 6.5, 3]);
    const b = ce.expr(['Stirling', 6.5, 3]);
    expect(a.isValid).toBe(false);
    expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
  });

  test('the canonical form is Stirling, the preferred name', () => {
    const e = ce.expr(['StirlingS2', 'n', 'k']);
    expect(e.operator).toBe('Stirling');
    expect(e.isSame(ce.expr(['Stirling', 'n', 'k']))).toBe(true);
    expect(JSON.stringify(e.json)).toBe('["Stirling","n","k"]');
  });

  test('the raw form keeps the StirlingS2 spelling', () => {
    expect(ce.expr(['StirlingS2', 6, 3], { form: 'raw' }).operator).toBe(
      'StirlingS2'
    );
  });

  test('StirlingS2 compiles like Stirling with a symbolic operand', () => {
    const a = compile(ce.expr(['Stirling', 'x', 3]));
    const b = compile(ce.expr(['StirlingS2', 'x', 3]));
    expect(b.success).toBe(a.success);
    expect(b.code).toBe(a.code);
  });

  // The alias must fail exactly where `Stirling` fails: a missing operand, an
  // extra operand (strict mode) and an operand of the wrong type.
  test.each([
    [['StirlingS2', 6], ['Stirling', 6]],
    [['StirlingS2', 6, 3, 4], ['Stirling', 6, 3, 4]],
    [['StirlingS2', "'a'", 3], ['Stirling', "'a'", 3]],
  ])('%j is validated like Stirling', (alias, target) => {
    const engine = new ComputeEngine();
    engine.strict = true;
    const a = engine.box(alias as any);
    const b = engine.box(target as any);
    expect(a.isValid).toBe(false);
    expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
  });
});

// The other number-theory aliases must also fail exactly where their
// preferred head fails. They used to build the target without signature
// validation, so `Lucas("a")` was a valid `LucasL("a")`.
describe('Lucas and PrimeNumber are validated like their preferred heads', () => {
  test.each([
    [['Lucas', "'a'"], ['LucasL', "'a'"]],
    [['Lucas'], ['LucasL']],
    [['PrimeNumber', "'a'"], ['NthPrime', "'a'"]],
    [['PrimeNumber'], ['NthPrime']],
  ])('%j', (alias, target) => {
    const engine = new ComputeEngine();
    const a = engine.box(alias as any);
    const b = engine.box(target as any);
    expect(a.isValid).toBe(false);
    expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
  });

  test('a string operand is an incompatible-type error', () => {
    expect(JSON.stringify(ce.box(['Lucas', "'a'"]).json)).toBe(
      '["LucasL",["Error",["ErrorCode","\'incompatible-type\'","\'integer\'","\'string\'"],"\'a\'"]]'
    );
  });
});
