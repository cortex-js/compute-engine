/**
 * The result type of the incomplete gamma function, `Gamma(s, z)` and
 * `Gamma(s, z0, z1)` (CE-1619).
 *
 * For a negative `z`, `Γ(s, z)` is complex unless `s` is a positive integer
 * (`Γ(1/2, −1) = √π·erfc(i)`), so the type is `real` only when every `z` is
 * proven non-negative or `s` is a proven positive integer. At `z = 0`,
 * `Γ(s, 0) = Γ(s)` has a pole at a non-positive integer `s`, so the type
 * there also admits `~oo` (`number` with three operands).
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('z', 'real');
ce.declare('s', 'real');
ce.declare('n', 'integer');
ce.declare('p', 'real<0..>');
ce.declare('q', 'real<0<..>');

const typeOf = (json: any) => ce.box(json).type.toString();
const HALF: ['Rational', number, number] = ['Rational', 1, 2];

describe('INCOMPLETE GAMMA TYPE', () => {
  test.each([
    // A negative or unknown-sign z: the value can be complex.
    [['Gamma', HALF, -1], 'number'],
    [['Gamma', HALF, 'z'], 'number'],
    [['Gamma', 's', 'z'], 'number'],
    [['Gamma', 'n', 'z'], 'number'],
    [['Gamma', HALF, 1, -3], 'number'],
    [['Gamma', HALF, ['List', 1, -2]], 'vector<2>'],
    // A positive integer s: real for every real z.
    [['Gamma', 2, -1], 'real'],
    [['Gamma', 2, 'z'], 'real'],
    [['Gamma', 3, -2, -1], 'real'],
    // A positive z: real for every real s.
    [['Gamma', HALF, 1], 'real'],
    [['Gamma', 's', 2], 'real'],
    [['Gamma', 's', 'q'], 'real'],
    [['Gamma', 2, 1, 3], 'real'],
    // A z that can be 0: Γ(s, 0) = Γ(s), a pole at a non-positive integer s.
    [['Gamma', HALF, 0], 'real'],
    [['Gamma', HALF, 'p'], 'real'],
    [['Gamma', 0, 0], 'infinity | real'],
    [['Gamma', 0, 'p'], 'infinity | real'],
    [['Gamma', 's', 'p'], 'infinity | real'],
    [['Gamma', 'n', 'p'], 'infinity | real'],
    [['Gamma', 's', 2, 'p'], 'number'],
  ])('%j has type %s', (json, expected) => {
    expect(typeOf(json)).toBe(expected);
  });

  test('the value of Gamma(1/2, -1) is complex', () => {
    // The value is √π·erfc(i) ≈ 1.7725 − 2.9253i.
    const value = ce.box(['Gamma', HALF, -1]).evaluate().N();
    expect(value.re).toBeCloseTo(1.7725, 3);
    expect(value.im).toBeCloseTo(-2.9253, 3);
  });

  test('the value agrees with the type', () => {
    expect(ce.box(['Gamma', 2, -1]).evaluate().toString()).toBe('0');
    expect(ce.box(['Gamma', 0, 0]).evaluate().toString()).toBe('~oo');
  });
});
