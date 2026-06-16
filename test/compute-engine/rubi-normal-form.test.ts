// Regression test for the Rubi Times/Power normal form's same-exponent
// fusion (src/compute-engine/rubi/normal-form.ts): aˣ·bˣ → (a·b)ˣ and
// aˣ/bˣ → (a/b)ˣ, so a product of distinct-base exponentials presents a
// single base to FunctionOfExponential (Chapter-2 exponential substitution).
// The fusion is restricted to symbolic exponents so numeric/algebraic
// factors (x²·y²) are left untouched.

import { ComputeEngine } from '../../src/compute-engine';
import { toTimesPower } from '../../src/compute-engine/rubi/normal-form';

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
});

const nf = (mj: any): string => toTimesPower(ce, ce.box(mj)).toString();

describe('Rubi normal form: same-exponent fusion', () => {
  test('aˣ·bˣ → (a·b)ˣ', () => {
    const r = toTimesPower(
      ce,
      ce.box(['Multiply', ['Power', 'a', 'x'], ['Power', 'b', 'x']])
    );
    expect(r.operator).toBe('Power');
    expect(r.toString()).toBe('(a * b)^x');
  });

  test('aˣ/bˣ → (a/b)ˣ (ratio, exponents x and −x)', () => {
    const r = toTimesPower(
      ce,
      ce.box(['Divide', ['Power', 'a', 'x'], ['Power', 'b', 'x']])
    );
    expect(r.operator).toBe('Power');
    expect(r.toString()).toBe('(a / b)^x');
  });

  test('aˣ·x²/bˣ → x²·(a/b)ˣ (polynomial factor preserved)', () => {
    expect(
      nf([
        'Divide',
        ['Multiply', ['Power', 'a', 'x'], ['Power', 'x', 2]],
        ['Power', 'b', 'x'],
      ])
    ).toBe('x^2 * (a / b)^x');
  });

  test('numeric bases fuse too: 2ˣ·3ˣ → (2·3)ˣ', () => {
    expect(nf(['Multiply', ['Power', 2, 'x'], ['Power', 3, 'x']])).toBe(
      '(2 * 3)^x'
    );
  });

  test('numeric exponents are NOT fused: x²·y² stays apart', () => {
    const r = toTimesPower(
      ce,
      ce.box(['Multiply', ['Power', 'x', 2], ['Power', 'y', 2]])
    );
    expect(r.operator).toBe('Multiply');
  });

  test('common-base collection still works: aˣ·aʸ → a^(x+y)', () => {
    const r = toTimesPower(
      ce,
      ce.box(['Multiply', ['Power', 'a', 'x'], ['Power', 'a', 'y']])
    );
    expect(r.operator).toBe('Power');
    expect(r.ops?.[0].toString()).toBe('a');
  });
});
