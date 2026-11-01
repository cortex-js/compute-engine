/**
 * Limits at 0 of a root or a power whose degree or exponent is a symbol.
 *
 * The substitution `x = 0` into `Root(x, n)` gives `Root(0, n)`, which the
 * evaluation does not fold when `n` is a symbol. When `n < 0`,
 * `Root(x, n) = x^{1/n}` grows without bound as `x` tends to 0 from above,
 * so `Root(0, n)` is not the limit. The same applies to `Power(0, m)` when
 * the sign of `m` is not known: the limit of `x^m` is 0 for `m > 0` and
 * infinite for `m < 0`. The limit now stays unevaluated in these cases.
 * When the degree or the exponent is known to be positive, the value at 0
 * is the limit.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.assume(ce.parse('n < 0'));
ce.assume(ce.parse('p > 0'));
ce.declare('f', 'function');

function limitOf(body: unknown, point: number, dir?: number): string {
  const ops: unknown[] = [body, 'x', point];
  if (dir !== undefined) ops.push(dir);
  return ce
    .box(['Limit', ...ops] as any)
    .evaluate()
    .toString();
}

describe('limit at 0 of a root with a symbolic degree', () => {
  test('a negative degree does not give Root(0, n)', () => {
    expect(limitOf(['Root', 'x', 'n'], 0)).toBe('lim_(x -> 0) {root(n)(x)}');
    expect(limitOf(['Root', 'x', 'n'], 0, 1)).toBe('lim_(x -> 0) {root(n)(x)}');
    expect(limitOf(['Add', 1, ['Root', 'x', 'n']], 0)).toBe(
      'lim_(x -> 0) {root(n)(x) + 1}'
    );
  });

  test('a degree of unknown sign does not give Root(0, m)', () => {
    expect(limitOf(['Root', 'x', 'm'], 0)).toBe('lim_(x -> 0) {root(m)(x)}');
  });

  test('a power with an exponent of unknown sign does not give 0^m', () => {
    expect(limitOf(['Power', 'x', 'm'], 0)).toBe('lim_(x -> 0) {x^m}');
  });

  test('a zero factor does not hide a power of 0', () => {
    // The evaluation folds `0 · 0^m` to 0, but `x · x^m` tends to +∞ as
    // x → 0⁺ when m < −1.
    expect(limitOf(['Multiply', 'x', ['Power', 'x', 'm']], 0)).toBe(
      'lim_(x -> 0) {x * x^m}'
    );
    expect(limitOf(['Multiply', ['Sin', 'x'], ['Power', 'x', 'm']], 0)).toBe(
      'lim_(x -> 0) {sin(x) * x^m}'
    );
    expect(
      limitOf(['Multiply', ['Power', 'x', 2], ['Power', 'x', 'm']], 0)
    ).toBe('lim_(x -> 0) {x^2 * x^m}');
    expect(limitOf(['Add', 1, ['Multiply', 'x', ['Power', 'x', 'm']]], 0)).toBe(
      'lim_(x -> 0) {x * x^m + 1}'
    );
    // With n < 0, `x · Root(x, n) = x^{1 + 1/n}`, which tends to +∞ as
    // x → 0⁺ when −1 < n < 0.
    expect(limitOf(['Multiply', 'x', ['Root', 'x', 'n']], 0, 1)).toBe(
      'lim_(x -> 0) {x * root(n)(x)}'
    );
  });

  test('a base that is 0 but does not fold to 0', () => {
    // `(1 + π + x)² − 1 − 2π − π²` is 0 at x = 0, but the evaluation does
    // not fold it to the number 0. `x · B(x)^m` tends to +∞ for m = −2.
    const b = [
      'Subtract',
      [
        'Subtract',
        ['Subtract', ['Power', ['Add', 1, 'Pi', 'x'], 2], 1],
        ['Multiply', 2, 'Pi'],
      ],
      ['Power', 'Pi', 2],
    ];
    expect(limitOf(['Multiply', 'x', ['Power', b, 'm']], 0)).toBe(
      'lim_(x -> 0) {x * ((x + 1 + pi)^2 - 1 - 2pi - pi^2)^m}'
    );
    expect(limitOf(['Multiply', 'x', ['Power', b, 2]], 0)).toBe('0');
  });

  test('an infinite bound of an integral or a sum is not rejected', () => {
    const inf = 'PositiveInfinity';
    const int0 = ['Integrate', ['f', 't'], ['Limits', 't', 0, inf]];
    expect(limitOf(['Add', 'x', int0], 0)).toBe('int_(0)^(+oo)(f(t) dt)');
    expect(
      limitOf(['Add', 'x', ['Sum', ['f', 'k'], ['Limits', 'k', 1, inf]]], 0)
    ).toBe('sum_(k=1)^(+oo)(f(k))');
    expect(limitOf(['Multiply', 'x', int0], 1)).toBe('int_(0)^(+oo)(f(t) dt)');
    expect(
      limitOf(['Integrate', ['f', 't'], ['Limits', 't', 'x', inf]], 1)
    ).toBe('int_(1)^(+oo)(f(t) dt)');
  });

  test('a radicand near 0 but not 0 still gives the value', () => {
    const r = ce
      .box(['Limit', ['Root', ['Add', 'x', ['Power', 10, -30]], 'n'], 'x', 0])
      .evaluate();
    expect(r.operator).toBe('Root');
  });

  test('a value that holds an infinity is not a limit', () => {
    // `e^{m ln x}` gave `e^{-∞ · m}`, which is 0 for m > 0 and +∞ for m < 0.
    expect(limitOf(['Exp', ['Multiply', 'm', ['Ln', 'x']]], 0)).toBe(
      'lim_(x -> 0) {e^(m * ln(x))}'
    );
    // `√(-∞ · m)` and `∛(-∞ · m)` are not settled either: the cube root is
    // +∞ for m < 0 and −∞ for m > 0.
    for (const body of [
      ['Sqrt', ['Multiply', 'm', ['Ln', 'x']]],
      ['Root', ['Multiply', 'm', ['Ln', 'x']], 3],
      // `Root(e^{-∞ · m}, p)`: the symbolic degree keeps the `Root`.
      ['Root', ['Exp', ['Multiply', 'm', ['Ln', 'x']]], 'p'],
    ])
      expect(limitOf(body, 0, 1)).toMatch(/^lim_/);
  });

  test('controls: a positive degree or exponent, a numeric degree', () => {
    // `Root(0, p)` is 0; the evaluation may or may not fold it.
    expect(limitOf(['Root', 'x', 'p'], 0)).toMatch(/^(0|root\(p\)\(0\))$/);
    expect(limitOf(['Power', 'x', 'p'], 0)).toBe('0');
    expect(limitOf(['Root', 'x', 'n'], 1)).toBe('root(n)(1)');
    expect(limitOf(['Root', 'x', -2], 0, 1)).toBe('+oo');
    expect(limitOf(['Root', 'x', 3], 0)).toBe('0');
  });
});
