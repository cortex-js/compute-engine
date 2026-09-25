import { ComputeEngine } from '../../src/compute-engine';

/**
 * A double at or beyond 1e21 prints in exponent form at every precision.
 *
 * At machine precision the number printer (`numberToString()`,
 * `numerics/strings.ts`) used to expand such a double to its full integer
 * value, so `1e300` printed as the 301-digit exact binary value of the double
 * (`1000000000000000052504760255204420248704…`) and `1e23` as
 * `99999999999999991611392`, while the default (big-decimal) engine printed
 * `1e+300` and `1e+23`. The digits past the first 17 are not information a
 * double holds. The expansion applied only when it had five or fewer trailing
 * zeros, so `1e21` and `1e22`, which are exact doubles, printed correctly and
 * hid the defect (ROADMAP, found 2026-09-25).
 */
describe('a large double prints in exponent form at machine precision', () => {
  const machine = new ComputeEngine({ precision: 'machine' });
  const dflt = new ComputeEngine();

  test.each([
    [1e300, '1e+300'],
    [-1e300, '-1e+300'],
    [1e23, '1e+23'],
    [1.5e21, '1.5e+21'],
    [1e21, '1e+21'],
  ])('%p prints %s on both engines', (value, expected) => {
    expect(machine.box(value).toString()).toBe(expected);
    expect(dflt.box(value).toString()).toBe(expected);
  });

  test('a double past the safe integers keeps its 17 significant digits', () => {
    // 2^70 is exact as a double; its printed form is what JavaScript prints,
    // not the 22-digit binary expansion `1180591620717411303424`.
    expect(machine.box(2 ** 70).toString()).toBe('1.1805916207174113e+21');
  });

  test('a double below 1e21 still prints in full', () => {
    expect(machine.box(123456789012345680000).toString()).toBe(
      '123456789012345680000'
    );
    expect(machine.box(2 ** 60).toString()).toBe('1152921504606847000');
  });

  test('the result of a machine computation prints the same way', () => {
    expect(machine.box(['Csc', 1e-300]).N().toString()).toBe(
      '9.999999999999999e+299'
    );
  });

  test('an exact bigint keeps its digits and compacts trailing zeros', () => {
    expect(machine.box(12345678901234567890n).toString()).toBe(
      '12345678901234567890'
    );
    expect(machine.box(10n ** 30n).toString()).toBe('1e+30');
  });
});
