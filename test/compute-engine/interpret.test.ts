import { ComputeEngine } from '../../src/compute-engine';

/**
 * `Interpret` — from notation to meaning.
 *
 * The ellipsis fold barrier makes `1 + 2 + \dots + n` an inert notational
 * `Add`. `Interpret(expr).evaluate()` runs a strictly gated inference that
 * turns a continuation-bearing `Add`/`Multiply` into a `Sum`/`Product`, or
 * returns the argument unchanged when the gate does not pass. The head
 * disappears after evaluation.
 */

// A fresh engine per suite avoids cross-test symbol retyping.
const ce = new ComputeEngine();

function interpret(latex: string) {
  return ce.function('Interpret', [ce.parse(latex)]).evaluate();
}

// Build a continuation-bearing Add directly (the fold barrier keeps it inert
// and in source order). Used for signed/alternating samples, whose LaTeX
// spelling `1 - 2 + …` depends on a separate subtraction-ellipsis parser path.
function interpretBox(expr: unknown) {
  return ce.function('Interpret', [ce.box(expr as any)]).evaluate();
}

describe('Interpret — continuation → Sum/Product', () => {
  test('1 + 2 + … + n → Sum(k, (k, 1, n))', () => {
    expect(interpret('1 + 2 + \\dots + n').json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 1, 'n'],
    ]);
  });

  test('2 + 4 + … + 2n → Sum(2k, (k, 1, n))', () => {
    expect(interpret('2 + 4 + \\dots + 2n').json).toEqual([
      'Sum',
      ['Multiply', 2, 'k'],
      ['Limits', 'k', 1, 'n'],
    ]);
  });

  test('2 · 4 · … · 2n → Product(2k, (k, 1, n))', () => {
    expect(interpret('2 \\cdot 4 \\cdot \\dots \\cdot 2n').json).toEqual([
      'Product',
      ['Multiply', 2, 'k'],
      ['Limits', 'k', 1, 'n'],
    ]);
  });

  test('finite: 1 + 2 + … + 100 → Sum(k, (k, 1, 100)), which sums to 5050', () => {
    const sum = interpret('1 + 2 + \\dots + 100');
    expect(sum.json).toEqual(['Sum', 'k', ['Limits', 'k', 1, 100]]);
    // The Interpret head does not evaluate the Sum; evaluating it does.
    expect(sum.evaluate().json).toEqual(5050);
  });

  test('numeric check: the 2 + 4 + … + 2n Sum at n = 5 equals 2+4+6+8+10 = 30', () => {
    const sum = interpret('2 + 4 + \\dots + 2n');
    expect(sum.subs({ n: 5 }).evaluate().json).toEqual(30);
  });
});

describe('Interpret — negative gates stay inert', () => {
  test('parity mismatch 1 + 3 + … + 2n (U = n + 1/2) stays inert', () => {
    expect(interpret('1 + 3 + \\dots + 2n').json).toEqual([
      'Add',
      1,
      3,
      'ContinuationPlaceholder',
      ['Multiply', 2, 'n'],
    ]);
  });

  test('no anchor 1 + 2 + … stays inert', () => {
    expect(interpret('1 + 2 + \\dots').json).toEqual([
      'Add',
      1,
      2,
      'ContinuationPlaceholder',
    ]);
  });

  test('single sample 1 + … + n stays inert', () => {
    expect(interpret('1 + \\dots + n').json).toEqual([
      'Add',
      1,
      'ContinuationPlaceholder',
      'n',
    ]);
  });

  test('symbolic samples a + b + … + n stay inert', () => {
    expect(interpret('a + b + \\dots + n').json).toEqual([
      'Add',
      'a',
      'b',
      'ContinuationPlaceholder',
      'n',
    ]);
  });

  // NOTE: `1 + 2 + 4 + … + 2^n` was a v1 negative gate (geometric unsupported);
  // v2 now recognizes it (see the geometric describe block above).

  test('no continuation: Interpret(x + 1) → x + 1', () => {
    expect(interpret('x + 1').json).toEqual(['Add', 'x', 1]);
  });
});

describe('Interpret — polynomial (finite differences)', () => {
  test('1 + 4 + 9 + 16 + … + n² → Sum(k², (k, 1, n)) [m = g+2]', () => {
    expect(interpret('1 + 4 + 9 + 16 + \\dots + n^2').json).toEqual([
      'Sum',
      ['Power', 'k', 2],
      ['Limits', 'k', 1, 'n'],
    ]);
  });

  test('1 + 4 + 9 + … + n² → Sum(k², (k, 1, n)) [m = g+1, anchor confirms]', () => {
    expect(interpret('1 + 4 + 9 + \\dots + n^2').json).toEqual([
      'Sum',
      ['Power', 'k', 2],
      ['Limits', 'k', 1, 'n'],
    ]);
  });

  test('1 + 8 + 27 + 64 + … + n³ → Sum(k³, (k, 1, n))', () => {
    // A cubic needs g+1 = 4 samples to be witnessed by finite differences
    // (three samples fit a *quadratic*); see the evidence discipline in the
    // design doc. With four samples, degree 3 is detected and the anchor n³
    // confirms.
    expect(interpret('1 + 8 + 27 + 64 + \\dots + n^3').json).toEqual([
      'Sum',
      ['Power', 'k', 3],
      ['Limits', 'k', 1, 'n'],
    ]);
  });

  test('triangular 1 + 3 + 6 + 10 + … + n(n+1)/2 → Sum(k(k+1)/2, (k, 1, n))', () => {
    const sum = interpret('1 + 3 + 6 + 10 + \\dots + \\frac{n(n+1)}{2}');
    expect(sum.json).toEqual([
      'Sum',
      [
        'Add',
        ['Multiply', ['Rational', 1, 2], ['Power', 'k', 2]],
        ['Multiply', ['Rational', 1, 2], 'k'],
      ],
      ['Limits', 'k', 1, 'n'],
    ]);
    // Numeric check at n = 5: 1 + 3 + 6 + 10 + 15 = 35.
    expect(sum.subs({ n: 5 }).evaluate().json).toEqual(35);
  });

  test('numeric anchor 1 + 4 + 9 + … + 100 → Sum(k², (k, 1, 10)) = 385', () => {
    const sum = interpret('1 + 4 + 9 + \\dots + 100');
    expect(sum.json).toEqual(['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 10]]);
    expect(sum.evaluate().json).toEqual(385);
  });
});

describe('Interpret — geometric', () => {
  test('1 + 2 + 4 + … + 2^n → Sum(2^(k−1), (k, 1, n+1))', () => {
    const sum = interpret('1 + 2 + 4 + \\dots + 2^n');
    expect(sum.json).toEqual([
      'Sum',
      ['Power', 2, ['Add', 'k', -1]],
      ['Limits', 'k', 1, ['Add', 'n', 1]],
    ]);
    // Numeric check at n = 3: 1 + 2 + 4 + 8 = 15.
    expect(sum.subs({ n: 3 }).evaluate().json).toEqual(15);
  });

  test('2 · 4 · 8 · … · 2^n → Product(2^k, (k, 1, n))', () => {
    const prod = interpret('2 \\cdot 4 \\cdot 8 \\cdot \\dots \\cdot 2^n');
    expect(prod.json).toEqual([
      'Product',
      ['Power', 2, 'k'],
      ['Limits', 'k', 1, 'n'],
    ]);
    // Numeric check at n = 4: 2 · 4 · 8 · 16 = 1024.
    expect(prod.subs({ n: 4 }).evaluate().json).toEqual(1024);
  });

  test('numeric anchor 1 + 2 + 4 + … + 64 → Sum(2^(k−1), (k, 1, 7)) = 127', () => {
    const sum = interpret('1 + 2 + 4 + \\dots + 64');
    expect(sum.json).toEqual([
      'Sum',
      ['Power', 2, ['Add', 'k', -1]],
      ['Limits', 'k', 1, 7],
    ]);
    expect(sum.evaluate().json).toEqual(127);
  });
});

describe('Interpret — v2 negative gates stay inert', () => {
  test('anchor fits neither family: 1 + 2 + 4 + … + n² stays inert', () => {
    expect(interpret('1 + 2 + 4 + \\dots + n^2').json).toEqual([
      'Add',
      1,
      2,
      4,
      'ContinuationPlaceholder',
      ['Power', 'n', 2],
    ]);
  });

  test('overfit guard: 1 + 2 + 4 + … + m (bare symbol confirms nothing) stays inert', () => {
    // The quadratic interpolant of 1,2,4 evaluated at m is not m, and the
    // geometric candidate t = 2^(k−1) has a non-affine bound log₂(m)+1.
    expect(interpret('1 + 2 + 4 + \\dots + m').json).toEqual([
      'Add',
      1,
      2,
      4,
      'ContinuationPlaceholder',
      'm',
    ]);
  });

  test('constant samples 2 + 2 + 2 + … + 2 (d = 0, r = 1) stays inert', () => {
    expect(interpret('2 + 2 + 2 + \\dots + 2').json).toEqual([
      'Add',
      2,
      2,
      2,
      'ContinuationPlaceholder',
      2,
    ]);
  });
});

describe('Interpret — linear recurrence (Berlekamp–Massey + RSolve)', () => {
  test('Fibonacci 1+1+2+3+5+8+…+55 → Sum(Fibonacci(k), (k,1,10)) = 143', () => {
    // BM finds a(k)=a(k−1)+a(k−2) (L=2); m=6 ≥ 2L+1=5. The samples match the
    // library `Fibonacci` head, so the display body is `Fibonacci(k)`, which
    // evaluates exactly (a Binet radical body would not collapse to 143). The
    // anchor 55 = a(10), so U = 10.
    const sum = interpret('1 + 1 + 2 + 3 + 5 + 8 + \\dots + 55');
    expect(sum.json).toEqual([
      'Sum',
      ['Fibonacci', 'k'],
      ['Limits', 'k', 1, 10],
    ]);
    // 1+1+2+3+5+8+13+21+34+55 = 143.
    expect(sum.evaluate().json).toEqual(143);
    // The body reproduces the samples at k = 1..6.
    const body = ce.function('Fibonacci', [ce.symbol('k')]);
    expect([1, 2, 3, 4, 5, 6].map((k) => body.subs({ k }).evaluate().re)).toEqual(
      [1, 1, 2, 3, 5, 8]
    );
  });

  test('Pell 1+2+5+12+29+70+…+169 (non-Fibonacci, L=2) → U=7, sum = 288', () => {
    // BM finds a(k)=2·a(k−1)+a(k−2). The closed form is a Binet radical body
    // (verified numerically against every sample). Pell: 1,2,5,12,29,70,169 —
    // anchor 169 = a(7), so U = 7 and Σ = 1+2+5+12+29+70+169 = 288.
    const sum = interpretBox([
      'Add',
      1,
      2,
      5,
      12,
      29,
      70,
      'ContinuationPlaceholder',
      169,
    ]);
    expect(sum.operator).toBe('Sum');
    expect((sum.json as unknown[])[2]).toEqual(['Limits', 'k', 1, 7]);
    // Binet body does not collapse to an exact integer; verify numerically.
    expect(sum.N().re).toBeCloseTo(288, 6);
  });

  test('alternating signed-Fibonacci 1,−1,2,−3,5,−8 (a(k)=−a(k−1)+a(k−2)) → U=7, sum = 9', () => {
    // BM finds a(k) = −a(k−1) + a(k−2) (L=2) over the signed samples; the
    // sequence continues …,−8,13. Anchor 13 = a(7), so U = 7 and
    // Σ = 1−1+2−3+5−8+13 = 9.
    const sum = interpretBox([
      'Add',
      1,
      -1,
      2,
      -3,
      5,
      -8,
      'ContinuationPlaceholder',
      13,
    ]);
    expect(sum.operator).toBe('Sum');
    expect((sum.json as unknown[])[2]).toEqual(['Limits', 'k', 1, 7]);
    expect(sum.N().re).toBeCloseTo(9, 6);
  });
});

describe('Interpret — v3 negative gates stay inert', () => {
  test('primes 2+3+5+7+11+…+31 (BM order 3, m=5 < 2L+1=7) stays inert', () => {
    // Berlekamp–Massey finds a spurious order-3 recurrence from 5 samples; the
    // evidence gate m ≥ 2L+1 rejects it (5 < 7).
    expect(interpret('2 + 3 + 5 + 7 + 11 + \\dots + 31').json).toEqual([
      'Add',
      2,
      3,
      5,
      7,
      11,
      'ContinuationPlaceholder',
      31,
    ]);
  });

  test('factorials 1+2+6+24+120+…+720 (not constant-coefficient) stays inert', () => {
    // Factorials are not C-finite; BM order grows with the sample count, so the
    // evidence gate (order 3 from 5 samples) rejects it.
    expect(interpret('1 + 2 + 6 + 24 + 120 + \\dots + 720').json).toEqual([
      'Add',
      1,
      2,
      6,
      24,
      120,
      'ContinuationPlaceholder',
      720,
    ]);
  });

  test('symbolic anchor 1+1+2+3+5+…+F (genuine recurrence, bare symbol) stays inert', () => {
    // The recurrence is recognized (Fibonacci, L=2), but v3 declines symbolic
    // anchors — the closed form cannot be validated against a bare symbol.
    expect(interpret('1 + 1 + 2 + 3 + 5 + \\dots + F').json).toEqual([
      'Add',
      1,
      1,
      2,
      3,
      5,
      'ContinuationPlaceholder',
      'F',
    ]);
  });
});

describe('Interpret — recursion into subexpressions', () => {
  test('x + (1 + 2 + … + n) interprets the inner continuation', () => {
    const r = interpret('x + (1 + 2 + \\dots + n)');
    const json = r.json as unknown[];
    expect(json[0]).toBe('Add');
    expect(json).toContainEqual(['Sum', 'k', ['Limits', 'k', 1, 'n']]);
    expect(json).toContain('x');
    // The continuation is gone.
    expect(JSON.stringify(json)).not.toContain('ContinuationPlaceholder');
  });

  test('equation 1 + 2 + … + n = n(n+1)/2 interprets the lhs', () => {
    const r = interpret('1 + 2 + \\dots + n = \\frac{n(n+1)}{2}');
    const json = r.json as unknown[];
    expect(json[0]).toBe('Equal');
    expect(json[1]).toEqual(['Sum', 'k', ['Limits', 'k', 1, 'n']]);
  });

  test('index-capture: k + (1 + 2 + … + k) must not reuse k as the index', () => {
    const r = interpret('k + (1 + 2 + \\dots + k)');
    const json = JSON.stringify(r.json);
    // A Sum is produced, its index is not k, and its upper bound is k.
    expect(json).toContain('Sum');
    expect(json).not.toContain('ContinuationPlaceholder');
    const sum = (r.json as unknown[]).find(
      (x) => Array.isArray(x) && x[0] === 'Sum'
    ) as unknown[];
    expect(sum).toBeDefined();
    const limits = sum[2] as unknown[]; // ['Limits', index, 1, k]
    expect(limits[1]).not.toBe('k');
    expect(limits[3]).toBe('k');
  });
});
