import { engine as ce } from '../utils';

/**
 * Regressions for three verified correctness P0s (WP-2.2):
 *  - P0-2  : `.N()` dropped the square root of a symbolic argument.
 *  - P0-4  : `asBigint` corrupted integers longer than `ce.precision` digits.
 *  - P0-16i: `Sum().evaluate()` numericized exact summands via `.add()`.
 */

const evalStr = (e: any) => ce.box(e).evaluate().toString();
const nStr = (e: any) => ce.box(e).N().toString();

describe('P0-2 — Sqrt.N() keeps the radical on the symbolic part', () => {
  test('Sqrt(y).N() keeps the root', () => {
    // Was `y` (root silently dropped); now stays √y.
    expect(nStr(['Sqrt', 'y'])).toEqual('sqrt(y)');
  });
  test('√(4y).N() → 2√y', () => {
    expect(nStr(['Sqrt', ['Multiply', 4, 'y']])).toEqual('2sqrt(y)');
  });
  test('(y·√y).N() → y^(3/2)', () => {
    // Was `y^2` (from y·y after the root was dropped).
    expect(nStr(['Multiply', 'y', ['Sqrt', 'y']])).toEqual('y^(3/2)');
  });
  test('y^(1/3)·√y .N() → y^(5/6)', () => {
    expect(
      nStr(['Multiply', ['Power', 'y', ['Rational', 1, 3]], ['Sqrt', 'y']])
    ).toEqual('y^(5/6)');
  });
  test('numeric Sqrt still numericizes (control)', () => {
    expect(nStr(['Sqrt', 4])).toEqual('2');
    expect(nStr(['Sqrt', 2]).startsWith('1.414')).toBe(true);
  });
});

describe('P0-4 — asBigint extracts exact integers beyond ce.precision', () => {
  const m127 = 2n ** 127n - 1n; // 39-digit Mersenne prime
  test('IsPrime of an exactly-stored 39-digit Mersenne prime', () => {
    expect(evalStr(['IsPrime', ce.number(m127)])).toEqual('"True"');
  });
  test('IsOdd / IsEven of a 39-digit integer', () => {
    expect(evalStr(['IsOdd', ce.number(m127)])).toEqual('"True"');
    expect(evalStr(['IsEven', ce.number(m127)])).toEqual('"False"');
  });
  test('DigitSum of a 39-digit integer', () => {
    expect(evalStr(['DigitSum', ce.number(m127)])).toEqual('154');
  });
  test('FactorInteger of 10^21+3 (exact, stays exact through Add)', () => {
    expect(evalStr(['FactorInteger', ['Add', ['Power', 10, 21], 3]])).toEqual(
      '[(67, 1),(14925373134328358209, 1)]'
    );
  });
  test('Mod of a large exact integer by a small modulus', () => {
    expect(evalStr(['Mod', ['Add', ['Power', 10, 21], 3], 10])).toEqual('3');
  });
});

describe('P0-16i — Sum.evaluate() preserves exactness', () => {
  test('Sum(√k, k=1..5) stays exact', () => {
    // Was `8.38233…` (float). Canonicalized: 3 + √2 + √3 + √5.
    expect(evalStr(['Sum', ['Sqrt', 'k'], ['Tuple', 'k', 1, 5]])).toEqual(
      '3 + sqrt(2) + sqrt(3) + sqrt(5)'
    );
  });
  test('Sum(√k, k=1..5).N() still numericizes', () => {
    expect(nStr(['Sum', ['Sqrt', 'k'], ['Tuple', 'k', 1, 5]]).startsWith('8.382')).toBe(
      true
    );
  });
  test('numeric sum stays exact and fast (control)', () => {
    expect(evalStr(['Sum', 'k', ['Tuple', 'k', 1, 100]])).toEqual('5050');
    expect(evalStr(['Sum', ['Divide', 1, 'k'], ['Tuple', 'k', 1, 10]])).toEqual(
      '7381/2520'
    );
  });
  test('symbolic summand accumulates symbolically (control)', () => {
    expect(evalStr(['Sum', 'x', ['Tuple', 'k', 1, 3]])).toEqual('3x');
  });
  test('long numeric sum does not lose exactness or blow up', () => {
    const t = Date.now();
    expect(evalStr(['Sum', 'k', ['Tuple', 'k', 1, 100000]])).toEqual(
      '5000050000'
    );
    expect(Date.now() - t).toBeLessThan(5000);
  });
});
