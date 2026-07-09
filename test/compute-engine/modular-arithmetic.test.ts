import { engine as ce } from '../utils';

/**
 * Verified (independent bigint) reference values used below:
 *   2^(3^20) mod 100                = 52
 *   3^1000000 mod 7                 = 4
 *   100! mod 101 (Wilson)           = 100
 *   Mod(2^(3^20), -100) [floored]   = -48
 *   6n ≡ 4 (mod 7)  ⇒ n ≡ 3 (mod 7)
 *   4x ≡ 2 (mod 6)  ⇒ x ≡ 2 (mod 3)
 *   2x ≡ 1 (mod 4)  ⇒ no solution
 *   CRT x≡2(3), x≡3(5), x≡2(7)      ⇒ x ≡ 23 (mod 105)
 *   CRT x≡1(4), x≡2(8)             ⇒ inconsistent
 */

/** The single free parameter of a solved family (the fresh `t`, not `x`). */
function paramOf(expr, unknown: string): string {
  return expr.symbols.find((s: string) => s !== unknown)!;
}

describe('Mod — modular reduction of large integers', () => {
  test('2^(3^20) mod 100', () => {
    expect(ce.parse('2^{3^{20}} \\pmod{100}').evaluate().json).toEqual(52);
  });

  test('3^1000000 mod 7', () => {
    expect(ce.box(['Mod', ['Power', 3, 1000000], 7]).evaluate().json).toEqual(
      4
    );
  });

  test('a large Add combination of huge symbolic powers', () => {
    // 2^(3^20) + 3^(3^20) mod 100 = 52 + 3 = 55
    const N = ['Power', 3, 20];
    const e = ce.box(['Mod', ['Add', ['Power', 2, N], ['Power', 3, N]], 100]);
    expect(e.evaluate().json).toEqual(55);
  });

  test('3·2^(3^20) mod 100', () => {
    // Independent bigint: 2^(3^20) mod 100 = 52, 3·52 mod 100 = 56.
    // The huge exact power must stay symbolic in the Multiply (digit-budget
    // guard) so `reduceModulo` can walk it, rather than overflowing bigint.
    const N = ['Power', 3, 20];
    expect(
      ce.box(['Mod', ['Multiply', 3, ['Power', 2, N]], 100]).evaluate().json
    ).toEqual(56);
  });

  test('(2^(3^20) − 7) mod 100', () => {
    // Independent bigint: (52 − 7) mod 100 = 45.
    const N = ['Power', 3, 20];
    expect(
      ce.box(['Mod', ['Subtract', ['Power', 2, N], 7], 100]).evaluate().json
    ).toEqual(45);
  });

  test('huge Multiply stays symbolic and does not throw', () => {
    // `Multiply(3, 2^(3^20))` must not materialize the multi-million-digit
    // power into the coefficient (would throw `Maximum BigInt size exceeded`).
    const N = ['Power', 3, 20];
    const e = ce.box(['Multiply', 3, ['Power', 2, N]]);
    let evaluated;
    expect(() => {
      evaluated = e.evaluate();
    }).not.toThrow();
    expect(evaluated.operator).toEqual('Multiply');
  });

  test('Negate of a huge symbolic power (floored)', () => {
    // -(2^(3^20)) mod 100 = -52 floored to [0,100) = 48
    const N = ['Power', 3, 20];
    expect(ce.box(['Mod', ['Negate', ['Power', 2, N]], 100]).evaluate().json).toEqual(
      48
    );
  });

  test('negative divisor keeps floored sign convention', () => {
    expect(
      ce.box(['Mod', ['Power', 2, ['Power', 3, 20]], -100]).evaluate().json
    ).toEqual(-48);
  });

  test('Factorial: 100! mod 101 (Wilson)', () => {
    expect(ce.box(['Mod', ['Factorial', 100], 101]).evaluate().json).toEqual(
      100
    );
  });

  test('Factorial: n! mod m with n ≥ m is 0', () => {
    expect(ce.box(['Mod', ['Factorial', 2026], 3]).evaluate().json).toEqual(0);
  });

  test('plain integer Mod still works', () => {
    expect(ce.box(['Mod', 17, 5]).evaluate().json).toEqual(2);
    expect(ce.box(['Mod', -811, 24]).evaluate().json).toEqual(5);
  });

  test('rational Mod still works', () => {
    expect(
      ce.box(['Mod', ['Rational', 1, 2], ['Rational', 1, 3]]).evaluate().json
    ).toEqual(['Rational', 1, 6]);
  });
});

describe('Congruent — modular congruence of large integers', () => {
  test('true congruence', () => {
    expect(
      ce.parse('2^{3^{20}} \\equiv 52 \\pmod{100}').evaluate().symbol
    ).toEqual('True');
  });

  test('false congruence', () => {
    expect(
      ce.parse('2^{3^{20}} \\equiv 53 \\pmod{100}').evaluate().symbol
    ).toEqual('False');
  });

  test('symbolic lhs stays symbolic', () => {
    const e = ce.box(['Congruent', ['Add', ['Multiply', 6, 'k1'], 1], 4, 7]);
    expect(e.evaluate().operator).toEqual('Congruent');
  });

  test('symbolic modulus stays symbolic', () => {
    const e = ce.box(['Congruent', 2, 5, 'mSym']);
    expect(e.evaluate().operator).toEqual('Congruent');
  });
});

describe('ModularInverse', () => {
  test('3 mod 7 → 5', () => {
    expect(ce.box(['ModularInverse', 3, 7]).evaluate().json).toEqual(5);
  });

  test('non-coprime stays symbolic', () => {
    expect(ce.box(['ModularInverse', 4, 8]).evaluate().operator).toEqual(
      'ModularInverse'
    );
  });

  test('negative a', () => {
    // -3 ≡ 4 (mod 7); 4·2 = 8 ≡ 1 (mod 7)
    expect(ce.box(['ModularInverse', -3, 7]).evaluate().json).toEqual(2);
  });

  test('modulus 1 → 0', () => {
    expect(ce.box(['ModularInverse', 5, 1]).evaluate().json).toEqual(0);
  });
});

describe('Solving linear congruences', () => {
  test('6n ≡ 4 (mod 7): one parametric root, verified by substitution', () => {
    const cong = ce.parse('6n \\equiv 4 \\pmod 7');
    const roots = cong.solve('n') as any[];
    expect(Array.isArray(roots)).toBe(true);
    expect(roots.length).toBe(1);

    const root = roots[0];
    const t = paramOf(root, 'n');
    for (const tv of [0, 1, -1]) {
      const nVal = root.subs({ [t]: tv });
      const check = ce
        .box(['Congruent', ['Multiply', 6, nVal], 4, 7])
        .evaluate();
      expect(check.symbol).toEqual('True');
    }
  });

  test('2x ≡ 1 (mod 4): no solution', () => {
    const roots = ce.box(['Congruent', ['Multiply', 2, 'x2'], 1, 4]).solve('x2');
    expect(roots).toEqual([]);
  });

  test('4x ≡ 2 (mod 6): family with step 3, verified by substitution', () => {
    const cong = ce.box(['Congruent', ['Multiply', 4, 'x3'], 2, 6]);
    const roots = cong.solve('x3') as any[];
    expect(roots.length).toBe(1);
    const root = roots[0];
    const t = paramOf(root, 'x3');
    for (const tv of [0, 1, -1, 2]) {
      const xVal = root.subs({ [t]: tv });
      const check = ce
        .box(['Congruent', ['Multiply', 4, xVal], 2, 6])
        .evaluate();
      expect(check.symbol).toEqual('True');
    }
  });

  test('Solve operator form yields the family', () => {
    const cong = ce.box(['Congruent', ['Multiply', 6, 'x4'], 4, 7]);
    const result = ce.box(['Solve', cong, 'x4']).evaluate();
    expect(result.operator).toEqual('List');
    expect(result.nops).toBe(1);
  });
});

describe('Solving systems of congruences (CRT)', () => {
  test('x≡2(3), x≡3(5), x≡2(7) → 23 + 105t', () => {
    const s1 = ce.box(['Congruent', 'x5', 2, 3]);
    const s2 = ce.box(['Congruent', 'x5', 3, 5]);
    const s3 = ce.box(['Congruent', 'x5', 2, 7]);
    const sol = ce.box(['And', s1, s2, s3]).solve('x5');
    expect(sol && !Array.isArray(sol)).toBe(true);

    const root = (sol as Record<string, any>)['x5'];
    const t = paramOf(root, 'x5');
    for (const tv of [0, 1]) {
      const xVal = root.subs({ [t]: tv });
      for (const [r, m] of [
        [2, 3],
        [3, 5],
        [2, 7],
      ]) {
        const check = ce.box(['Congruent', xVal, r, m]).evaluate();
        expect(check.symbol).toEqual('True');
      }
    }
  });

  test('inconsistent system x≡1(4), x≡2(8) → no solution', () => {
    const i1 = ce.box(['Congruent', 'x6', 1, 4]);
    const i2 = ce.box(['Congruent', 'x6', 2, 8]);
    expect(ce.box(['And', i1, i2]).solve('x6')).toEqual([]);
  });

  test('consistent non-coprime system x≡2(4), x≡6(8) → 6 + 8t', () => {
    const c1 = ce.box(['Congruent', 'x7', 2, 4]);
    const c2 = ce.box(['Congruent', 'x7', 6, 8]);
    const sol = ce.box(['And', c1, c2]).solve('x7');
    expect(sol && !Array.isArray(sol)).toBe(true);
    const root = (sol as Record<string, any>)['x7'];
    const t = paramOf(root, 'x7');
    for (const tv of [0, 1, -1]) {
      const xVal = root.subs({ [t]: tv });
      for (const [r, m] of [
        [2, 4],
        [6, 8],
      ]) {
        const check = ce.box(['Congruent', xVal, r, m]).evaluate();
        expect(check.symbol).toEqual('True');
      }
    }
  });
});

describe('Mod — non-integer modulus stays out of the ℤ/mℤ fast path', () => {
  // `toBigint` rounds a non-integer (2.5 → 3n), so the modular-reduction
  // fast path must be gated on BOTH operands being integers: without the
  // `b.isInteger` gate, `Mod(5, 2.5)` reduced mod 3 and returned 2.
  test('float modulus uses the float lane', () => {
    expect(ce.box(['Mod', 5, 2.5]).evaluate().re).toBeCloseTo(0, 10);
    expect(ce.box(['Mod', -5, 2.5]).evaluate().re).toBeCloseTo(0, 10);
    expect(ce.box(['Mod', 5.5, 2.5]).evaluate().re).toBeCloseTo(0.5, 10);
    expect(ce.box(['Mod', 7, 2.5]).evaluate().re).toBeCloseTo(2, 10);
  });
});
