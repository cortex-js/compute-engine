import { ComputeEngine } from '../../src/compute-engine';

// A guarded function that has a pole rule reads the exact value of an
// operand to measure its distance to a pole. An operand that is a host
// function call is not evaluated exactly for that: the call must only see
// numeric requests under `.N()`.

const ce = new ComputeEngine();
ce.precision = 30;
const requests: boolean[] = [];
ce.declare('Spy', {
  signature: '(number) -> number',
  evaluate: (ops, { numericApproximation }) => {
    requests.push(numericApproximation === true);
    return numericApproximation ? ops[0].N() : ops[0];
  },
});

const digits = (x: { bignumRe?: { toString(): string } | undefined }) =>
  x.bignumRe?.toString();

describe('A HOST FUNCTION OPERAND OF A FUNCTION WITH A POLE RULE', () => {
  test.each([
    [
      'Gamma',
      ['Gamma', ['Spy', ['Rational', 1, 3]]],
      '2.67893853470774763365569294097',
    ],
    [
      'Beta',
      ['Beta', ['Rational', 1, 3], ['Spy', ['Rational', 2, 7]]],
      '5.82993007675034929011684636332',
    ],
  ])('%s under .N() reads it numerically', (_name, expr, expected) => {
    requests.length = 0;
    const v = ce.box(expr as never).N() as never;
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((x) => x)).toBe(true);
    const plain = ce
      .box(
        (_name === 'Gamma'
          ? ['Gamma', ['Rational', 1, 3]]
          : ['Beta', ['Rational', 1, 3], ['Rational', 2, 7]]) as never
      )
      .N() as never;
    expect(digits(v)).toEqual(digits(plain));
    if (expected) expect(digits(v)).toEqual(ce.bignum(expected).toString());
  });
});
