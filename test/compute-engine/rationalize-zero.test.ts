import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const at = (x: string, tol: string) =>
  ce.box(['Rationalize', ce.parse(x), ce.parse(tol)]);

// `Rationalize(x, 0)` is the exact rational of the decimal `x` holds.
const cases: [string, string][] = [
  ['0.1', '1/10'],
  ['3.141592653589793', '3141592653589793/1000000000000000'],
  ['1.234567890123', '1234567890123/1000000000000'],
  ['-0.1', '-1/10'],
  ['-2.5', '-5/2'],
  ['2.0', '2'],
  ['3/4', '3/4'],
  ['-7', '-7'],
];

describe('Rationalize(x, 0) is the exact value of the decimal', () => {
  test.each(cases)('%s', (x, expected) => {
    const e = at(x, '0');
    expect(e.evaluate().toString()).toEqual(expected);
    expect(e.N().toString()).toEqual(expected);
  });

  test('a float at default precision keeps all its digits', () => {
    const x = ce.box(['N', 'Pi']).evaluate();
    expect(x.bignumRe!.toString()).toEqual('3.141592653589793238462643');
    const e = ce.box(['Rationalize', x, 0]);
    // The denominator `10^24` prints in exponent form
    expect(e.evaluate().toString()).toEqual('3141592653589793238462643/1e+24');
    expect(e.N().toString()).toEqual(e.evaluate().toString());
  });

  test('a tiny float is kept exactly, not rounded to 0', () => {
    const e = at('1e-300', '0');
    expect(e.evaluate().toString()).toEqual('1/1e+300');
    expect(e.N().toString()).toEqual('1/1e+300');
  });

  test('a float with an exponent is the integer it writes', () => {
    const e = at('1.5e20', '0');
    expect(e.evaluate().toString()).toEqual('15e+19');
    expect(e.N().toString()).toEqual(e.evaluate().toString());
    expect(e.evaluate().re).toEqual(1.5e20);
  });
});

describe('Rationalize(x, 0) does not jump from a tolerance below 0', () => {
  test.each([
    '0.1',
    '3.141592653589793',
    '1.234567890123',
    '-0.1',
    '2.0',
    '3/4',
    '1.5e20',
  ])('%s', (x) => {
    expect(at(x, '0').evaluate().toString()).toEqual(
      at(x, '1e-40').evaluate().toString()
    );
    expect(at(x, '0').N().toString()).toEqual(at(x, '1e-40').N().toString());
  });

  // 25 digits: a tolerance of `1e-40` still admits a coarser convergent
  // (`1/q^2` is `1e-48`), so the comparison is made below it.
  test('N(Pi)', () => {
    const x = ce.box(['N', 'Pi']).evaluate();
    const r = (t: string) => ce.box(['Rationalize', x, ce.parse(t)]);
    expect(r('0').evaluate().toString()).toEqual(
      r('1e-60').evaluate().toString()
    );
    expect(r('0').N().toString()).toEqual(r('1e-60').N().toString());
  });

  test('1e-300, with a tolerance below it', () => {
    expect(at('1e-300', '0').evaluate().toString()).toEqual(
      at('1e-300', '1e-400').evaluate().toString()
    );
  });
});

describe('positive tolerances are unchanged', () => {
  test('default and positive tolerance', () => {
    expect(
      ce.box(['Rationalize', 3.141592653589793]).evaluate().toString()
    ).toEqual('80143857/25510582');
    expect(at('3.141592653589793', '1e-10').evaluate().toString()).toEqual(
      '312689/99532'
    );
  });
});
