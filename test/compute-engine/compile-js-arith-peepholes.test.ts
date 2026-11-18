import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Arithmetic peepholes in the JavaScript emitter, from the Tycho
// code-generation audit of 2026-09-08:
//
//   - equality uses `===` on every numeric pair (compiled equality is exact,
//     with no tolerance test on the difference — the integer-operand
//     peephole of the audit became the rule on 2026-09-09);
//   - the floored-modulo template binds a divisor it would otherwise compute
//     three times;
//   - a reciprocal square is a division by one multiplication, not
//     `Math.pow(x, -2)`;
//   - a complex value built in the expression as `a + i·b` gives up its
//     modulus, argument and parts without building a `{ re, im }` object;
//   - an identity lowering parenthesizes an operand that emits infix.
//
// Each block checks the emitted TEXT (the peephole fired) and the VALUE the
// compiled function returns against the interpreter (the peephole is
// faithful).

/** A fresh engine per block: a declaration must not leak between blocks. */
function newEngine(declarations: Record<string, string> = {}): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(declarations))
    ce.declare(name, type as any);
  return ce;
}

describe('J8: equality between integer-valued operands is exact', () => {
  const ce = newEngine({
    a: 'real',
    b: 'real',
    x: 'real',
    n: 'integer',
    L: 'list<real>',
  });

  test('the compiled value matches the interpreter', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['\\mathrm{Sign}(a) = \\mathrm{Sign}(b)', { a: -2, b: -5 }],
      ['\\mathrm{Sign}(a) = \\mathrm{Sign}(b)', { a: -2, b: 5 }],
      ['\\mathrm{Sign}(a) = \\mathrm{Sign}(b)', { a: 0, b: -0 }],
      ['\\mathrm{Sign}(a) \\ne \\mathrm{Sign}(b)', { a: 1, b: -1 }],
      ['\\lfloor a \\rfloor = \\lceil b \\rceil', { a: 2.7, b: 1.2 }],
      ['\\lfloor a \\rfloor = \\lceil b \\rceil', { a: 2.7, b: 3.2 }],
    ];
    for (const [latex, vars] of cases) {
      const e = ce.parse(latex);
      const r = compile(e, { fallback: false });
      const interpreted = e.subs(vars as any).evaluate().symbol === 'True';
      expect([latex, vars, r.run!(vars as any)]).toEqual([
        latex,
        vars,
        interpreted,
      ]);
    }
  });

  test('NaN compares false both ways', () => {
    // `NaN === NaN` is false, which is the interpreter's `Equal(NaN, NaN)`
    // for a `NaN` that an `integer`-typed lowering produced at run time.
    const r = compile(ce.parse('\\lfloor a \\rfloor = \\lceil b \\rceil'), {
      fallback: false,
    });
    expect(r.run!({ a: NaN, b: NaN })).toBe(false);
  });
});

describe('J9a: the modulo template binds a divisor it would repeat', () => {
  const ce = newEngine({
    theta: 'real',
    x: 'real',
    m: 'integer',
    n: 'integer',
  });

  test('the compiled value matches the interpreter, including negatives', () => {
    const e = ce.parse('2 \\bmod \\sin(0.2\\theta)');
    const r = compile(e, { fallback: false });
    for (const theta of [-7, -1.5, 0.5, 3, 12.25]) {
      const got = r.run!({ theta }) as number;
      const want = e.subs({ theta }).N().re!;
      expect(Math.abs(got - want)).toBeLessThan(1e-12);
    }
  });

  test('an impure divisor still draws exactly once', () => {
    const r = compile(ce.box(['Mod', 'x', ['Random']]), { fallback: false });
    expect((r.code!.match(/drawNextRandomNumber/g) ?? []).length).toBe(1);
    expect(typeof r.run!({ x: 3 })).toBe('number');
  });
});

describe('J9b: a reciprocal square is a division, not Math.pow', () => {
  const ce = newEngine({ t: 'real' });

  test('the compiled value matches the interpreter, zero and negatives too', () => {
    const e = ce.parse('\\frac{1}{t^2}');
    const r = compile(e, { fallback: false });
    for (const t of [0, -0, 1, -1, 3, -3, 0.5, -12.5, 1e8, 1e-8, Math.PI]) {
      const got = r.run!({ t }) as number;
      const want = e.subs({ t }).N().re!;
      if (!Number.isFinite(want)) expect(got).toBe(want);
      else
        expect(Math.abs(got - want)).toBeLessThanOrEqual(
          Math.abs(want) * 1e-15
        );
    }
    // A zero base is a pole on both spellings.
    expect(r.run!({ t: 0 })).toBe(Infinity);
  });

  test('a base near the overflow edge keeps the subnormal result', () => {
    // Squaring first would overflow — `1e155 * 1e155` is `Infinity`, and the
    // reciprocal of that is 0 — where the true value is the subnormal
    // 1e-310. Dividing twice scales down between the two steps.
    const e = ce.parse('\\frac{1}{t^2}');
    const r = compile(e, { fallback: false });
    for (const t of [1e155, -1e155, 1e-155, 1e200, 5e-324]) {
      const got = r.run!({ t }) as number;
      expect([t, got]).toEqual([t, e.subs({ t }).N().re]);
    }
    expect(r.run!({ t: 1e155 })).toBe(1e-310);
  });
});

describe('J5: a complex value built as a + i·b stays on the real lane', () => {
  const ce = newEngine({ x: 'real', y: 'real' });

  test('arg(x - iy) at y = 0 answers pi for a negative x, as the interpreter does (CE-262)', () => {
    const e = ce.parse('\\arg(x - iy)');
    const run = compile(e, { to: 'javascript', fallback: false } as never).run!;
    expect(run({ x: -3, y: 0 })).toBe(Math.PI);
    expect(run({ x: 3, y: 0 })).toBe(0);
    expect(run({ x: -3, y: 2 })).toBeCloseTo(Math.atan2(-2, -3), 12);
  });

  test('the compiled value matches the interpreter in all four quadrants', () => {
    for (const latex of [
      '\\arg((x - 0.3127) + i(y - 0.329))',
      '|(x - 0.3127) + i(y - 0.329)|',
      '\\Re((x - 0.3127) + i(y - 0.329))',
      '\\Im((x - 0.3127) + i(y - 0.329))',
    ]) {
      const e = ce.parse(latex);
      const r = compile(e, { fallback: false });
      // Both signs of each part, and the two axes (where `atan2` picks its
      // branch).
      for (const x of [-2, 0.3127, 2]) {
        for (const y of [-2, 0.329, 2]) {
          const got = r.run!({ x, y }) as number;
          const want = e.subs({ x, y }).N().re!;
          expect([latex, x, y, Math.abs(got - want) < 1e-12]).toEqual([
            latex,
            x,
            y,
            true,
          ]);
        }
      }
    }
  });

  test('a sum over a slice of a real list folds on the real lane', () => {
    // `At(P, Range(a, b))` takes its elements from `P`, so a sum over it is
    // real for a `list<real>` and `Abs` of it is `Math.abs`. It used to take
    // the shape-agnostic fold and reach `_SYS.cabs(_SYS.cplx(…))`.
    const listEngine = newEngine({
      P: 'list<real>',
      a: 'integer',
      b: 'integer',
    });
    const e = listEngine.parse('\\left|\\mathrm{Sum}(P_{a..b})\\right|');
    const r = compile(e, { fallback: false });
    expect(r.run!({ P: [1, -2, 3, -4, 5], a: 2, b: 4 })).toBe(3);
  });
});

describe('an identity lowering parenthesizes an infix operand', () => {
  // `Real`, `Conjugate`, `Abs` of a non-negative value and the rounding heads
  // of an integer all hand back their operand's code. The compiler splices a
  // function head's emission into its parent without parentheses, so a sum
  // handed back that way was torn: `3·Re(x + 1)` ran as `3x + 1`.
  const ce = newEngine({ x: 'real', u: 'real<0..>', n: 'integer' });

  test('the compiled value matches the interpreter', () => {
    for (const latex of [
      '3\\Re(x+1)',
      '3\\mathrm{Truncate}(n+1)',
      '3\\lfloor n+1 \\rfloor',
    ]) {
      const e = ce.parse(latex);
      const r = compile(e, { fallback: false });
      expect([latex, r.run!({ x: 2, n: 2, u: 2 })]).toEqual([
        latex,
        e.subs({ x: 2, n: 2, u: 2 }).N().re,
      ]);
    }
  });
});
