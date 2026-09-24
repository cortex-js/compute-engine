import { ComputeEngine } from '../../src/compute-engine';

/**
 * Which integer-valued numbers box as EXACT integers (user decision of
 * 2026-09-24, option B): a machine double that is a safe integer
 * (`Number.isSafeInteger`) is exact. A double past the safe integers
 * (`1e200`) is a rounded value and stays a float, and a big decimal is never
 * exact: it is a value at the working precision, and whether it is
 * integer-valued depends on that precision. An exact integer past the safe
 * integers comes from a bigint or a string of digits.
 */

const ce = new ComputeEngine();

describe('a machine double is exact only when it is a safe integer', () => {
  test('a safe integer is exact', () => {
    expect(ce.number(2.0).isExact).toBe(true);
    expect(ce.box(1e15 + 1).isExact).toBe(true);
    expect(ce.box(1e15 + 1).toString()).toBe('1000000000000001');
    expect(ce.number(Number.MAX_SAFE_INTEGER).isExact).toBe(true);
  });

  test('a double past the safe integers is a float', () => {
    const x = ce.number(1e200);
    expect(x.isExact).toBe(false);
    // The shortest decimal of the double, not its binary value
    // (`99999999999999996973…`).
    expect(x.toString()).toBe('1e+200');
    expect(ce.box(2 ** 53 + 2).isExact).toBe(false);
  });

  test('a bigint or a string of digits is exact', () => {
    expect(ce.number(10n ** 200n).isExact).toBe(true);
    expect(ce.box({ num: '1e200' }).isExact).toBe(true);
    expect(ce.box({ num: '9007199254740993' }).toString()).toBe(
      '9007199254740993'
    );
  });
});

describe('a big decimal is never exact', () => {
  test('N() of a large power is a float', () => {
    const x = ce.box(['Power', 10, 400]).N();
    expect(x.isExact).toBe(false);
    expect(x.toString()).toBe('1e+400');
  });

  test('a literal with a decimal point is a float', () => {
    expect(ce.parse('12345678.0').isExact).toBe(false);
  });

  test('the exact values are unchanged', () => {
    expect(ce.parse('20!').evaluate().isExact).toBe(true);
    expect(ce.parse('\\sum_{k=1}^{100} k').evaluate().toString()).toBe('5050');
    expect(
      ce
        .box(['Power', ['Power', 2, 60], ['Rational', 1, 3]])
        .evaluate()
        .toString()
    ).toBe('1048576');
    expect(
      ce.box(['Sqrt', ['Add', ['Power', 10, 30], 1]]).evaluate().operator
    ).toBe('Sqrt');
  });

  test('a safe-integer machine result of an exact operation is exact', () => {
    // `.N()` of `1 + i` is a float; the product with the exact `1 - i` is
    // computed in machine numbers, and the safe integer `2` is exact.
    const p = ce
      .box(['Multiply', ce.parse('1+i').N(), ce.parse('1-i')])
      .evaluate();
    expect(p.toString()).toBe('2');
    expect(p.isExact).toBe(true);
  });
});

describe('results that used to read a rounded float as an exact integer', () => {
  test('the 2-norm of a matrix of large doubles is a number', () => {
    const r = ce
      .box([
        'Norm',
        ['List', ['List', 1e200, 1e200], ['List', 1e200, 2e200]],
        2,
      ])
      .evaluate();
    expect(r.isNumberLiteral).toBe(true);
    expect(r.isExact).toBe(false);
    expect(r.re / 2.618033988749895e200).toBeCloseTo(1, 12);
  });

  test('an exact integer past the safe integers keeps its exactness through .json', () => {
    const x = ce.box(['Power', 2, 127]).evaluate();
    expect(x.json).toEqual({ num: (2n ** 127n).toString() });
    expect(ce.box(x.json).isExact).toBe(true);
  });

  test('N() of the singular values of a matrix with large entries', () => {
    // `N()` turns `10^20` into a big decimal. The 2 × 2 closed form is
    // computed on the decimal values; the double kernel returned 0 for the
    // small singular value.
    const r = ce
      .box([
        'SingularValues',
        ['List', ['List', ['Power', 10, 20], 1], ['List', 1, 2]],
      ])
      .N();
    expect(r.ops![1].re).toBeCloseTo(2, 12);
    const f = ce
      .box([
        'SingularValues',
        ['List', ['List', 1e20, 0.5], ['List', 0.5, 2.5]],
      ])
      .N();
    expect(f.ops![1].re).toBeCloseTo(2.5, 12);
  });

  test('Max of large exact powers is still ordered', () => {
    expect(
      ce
        .box(['Max', ['Power', 10, 400], ['Power', 10, 399]])
        .evaluate()
        .toString()
    ).toBe('1e+400');
  });
});

describe('an integer-valued inexact number is read as an integer', () => {
  // A number-theory predicate reads the integer an inexact value denotes;
  // the value itself stays inexact.
  test('a decimal with a zero fraction', () => {
    expect(ce.parse('7.0').isExact).toBe(false);
    expect(ce.parse('\\operatorname{IsPrime}(7.0)').evaluate().toString()).toBe(
      '"True"'
    );
    expect(ce.parse('\\operatorname{IsPrime}(7.5)').evaluate().toString()).toBe(
      '"False"'
    );
    expect(
      ce.parse('\\operatorname{IsComposite}(6.0)').evaluate().toString()
    ).toBe('"True"');
  });

  test('a big decimal from N()', () => {
    // 10^20 + 39 is prime.
    const p = ce.parse('\\operatorname{IsPrime}(10^{20}+39)');
    expect(p.evaluate().toString()).toBe('"True"');
    expect(p.N().toString()).toBe('"True"');
    // 2^61 - 1 is a Mersenne prime.
    expect(
      ce.box(['IsPrime', ['N', ['Subtract', ['Power', 2, 61], 1]]]).evaluate()
        .toString()
    ).toBe('"True"');
  });
});
