import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// `n!!` at a negative integer takes the value of the recurrence
// `n!! = n·(n-2)!!` run backwards from `1!! = 1`, that is
// `(n-2)!! = n!!/n`. For an odd `n < 0`:
// `n!! = (-1)^((|n|-1)/2) / (|n|-2)!!`. Every even `n < 0` is a pole
// (`~oo`), because the step from `0!! = 1` to `(-2)!!` divides by 0.
//
// The expected values were checked against the recurrence and against the
// analytic continuation `2^(x/2)·(2/π)^((1-cos(πx))/4)·Γ(x/2+1)`, evaluated
// numerically at x = -1, -3, -5, -7, -9, -11:
// 1, -1, 0.3333…, -0.0666…, 0.009523…, -0.001058….

const ce = new ComputeEngine();

const exact = (n: number) => ce.box(['Factorial2', n]).evaluate().toString();

describe('Factorial2 at a negative odd integer is an exact rational', () => {
  test.each<[number, string]>([
    [-1, '1'],
    [-3, '-1'],
    [-5, '1/3'],
    [-7, '-1/15'],
    [-9, '1/105'],
    [-11, '-1/945'],
  ])('(%p)!! = %s', (n, want) => {
    const value = ce.box(['Factorial2', n]).evaluate();
    expect(value.toString()).toBe(want);
    expect(value.isExact).toBe(true);
  });

  test('the value satisfies the recurrence n!! = n·(n-2)!!', () => {
    for (let n = 1; n >= -15; n -= 2) {
      const lhs = ce.box(['Factorial2', n]).evaluate();
      const rhs = ce
        .function('Multiply', [
          ce.number(n),
          ce.box(['Factorial2', n - 2]).evaluate(),
        ])
        .evaluate();
      expect([n, lhs.isSame(rhs)]).toEqual([n, true]);
    }
  });

  test('the value matches the analytic continuation', () => {
    for (const n of [-1, -3, -5, -7, -9, -11]) {
      const continuation = ce
        .parse(
          `2^{${n}/2}\\left(\\frac{2}{\\pi}\\right)^{(1-\\cos(${n}\\pi))/4}\\Gamma(${n}/2+1)`
        )
        .N().re;
      const value = ce.box(['Factorial2', n]).N().re;
      expect([n, Math.abs(value - continuation) < 1e-12]).toEqual([n, true]);
    }
  });
});

describe('Factorial2 at a negative even integer is a pole', () => {
  test.each([-2, -4, -10])('(%p)!! is ~oo', (n) => {
    expect(exact(n)).toBe('~oo');
    expect(ce.box(['Factorial2', n]).N().toString()).toBe('~oo');
  });

  test('the pole is the value Gamma has at its poles', () => {
    expect(
      ce
        .box(['Factorial2', -2])
        .evaluate()
        .isSame(ce.box(['Gamma', -1]).evaluate())
    ).toBe(true);
  });

  test('a float argument with an even negative integer value is a pole', () => {
    expect(ce.parse('(-2.0)!!').evaluate().toString()).toBe('~oo');
  });
});

describe('Factorial2 at a negative integer on the numeric route', () => {
  test('.N() gives the matching float', () => {
    const third = ce.box(['Factorial2', -5]).N();
    expect(third.isExact).toBe(false);
    expect(Math.abs(third.re - 1 / 3)).toBeLessThan(1e-15);
    const v = ce.box(['Factorial2', -7]).N();
    expect(v.isExact).toBe(false);
    expect(Math.abs(v.re + 1 / 15)).toBeLessThan(1e-15);
    expect(ce.box(['Factorial2', -3]).N().re).toBe(-1);
  });

  test('a float argument gives a float', () => {
    const v = ce.parse('(-3.0)!!').evaluate();
    expect(v.re).toBe(-1);
    expect(v.isExact).toBe(false);
  });

  test('machine precision', () => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    expect(machine.box(['Factorial2', -7]).evaluate().toString()).toBe('-1/15');
    expect(machine.box(['Factorial2', -7]).N().re).toBeCloseTo(-1 / 15, 15);
  });

  test('above the exact digit cap: symbolic on the exact route, a float under .N()', () => {
    const n = -1e15 - 1;
    expect(ce.box(['Factorial2', n]).evaluate().operator).toBe('Factorial2');
    // 1/(10^15 - 1)!!: (10^15)!! ≈ 6.835·10^7282852759048381 and
    // (2k)!!/(2k-1)!! ≈ √(πk) for k = 5·10^14, so the value is about
    // 5.80·10^-7282852759048375. The sign is (-1)^(5·10^14) = +1.
    expect(ce.box(['Factorial2', n]).N().toString()).toMatch(
      /^5\.798\d*e-7282852759048375$/
    );
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    expect(machine.box(['Factorial2', n]).N().isSame(0)).toBe(true);
  });
});

describe('Factorial2 parse route', () => {
  test('(-3)!! parses to Factorial2(-3) and evaluates to -1', () => {
    const e = ce.parse('(-3)!!');
    expect(e.json).toEqual(['Factorial2', -3]);
    expect(e.evaluate().toString()).toBe('-1');
  });
  test('(-5)!! evaluates to 1/3, (-4)!! to ~oo', () => {
    expect(ce.parse('(-5)!!').evaluate().toString()).toBe('1/3');
    expect(ce.parse('(-4)!!').evaluate().toString()).toBe('~oo');
  });
});

describe('Factorial2 type and sign for an argument that can be negative', () => {
  const ce = new ComputeEngine();
  ce.declare('k', 'integer');
  ce.declare('a', 'integer<-1..>');
  ce.declare('b', 'integer<-3..>');
  ce.declare('m', 'integer<..-1>');
  ce.declare('q', 'integer<0..>');
  ce.declare('x', 'real');
  ce.declare('y', 'real<-1.9..>');

  // `~oo` is stored widened to `infinity`.
  test.each<[string, string]>([
    ['k', 'infinity | rational'],
    ['m', 'infinity | rational'],
    ['b', 'infinity | rational'],
    ['a', 'integer'], // (-1)!! = 0!! = 1!! = 1
    ['q', 'integer'],
    ['x', 'infinity | real'],
    ['y', 'real'], // no pole above -2
  ])('Factorial2(%s) is typed %s', (arg, want) => {
    expect(ce.box(['Factorial2', arg]).type.toString()).toBe(want);
  });

  test('the value at sample points matches the claimed type', () => {
    // The exact value matches the `rational | ~oo` claim for an integer.
    // A float is typed `real` (as `Divide(1, 3).N()` is, against the
    // `rational` claim of `Divide(n, 3)`), so the `.N()` value is checked
    // against the claim for a real argument.
    const claim = ce.box(['Factorial2', 'k']).type;
    const realClaim = ce.box(['Factorial2', 'x']).type;
    for (const v of [-1, -2, -3, -5, -6, 0, 4, 7]) {
      const value = ce.box(['Factorial2', v]).evaluate();
      expect([v, value.type.matches(claim)]).toEqual([v, true]);
      const numeric = ce.box(['Factorial2', v]).N();
      expect([v, numeric.type.matches(realClaim)]).toEqual([v, true]);
    }
  });

  test('sign: no claim for a negative integer of unknown parity', () => {
    expect(ce.box(['Factorial2', 'm']).sgn).toBeUndefined();
    expect(ce.box(['Factorial2', 'q']).sgn).toBe('positive');
  });
});

describe('Factorial2 compiled at a negative integer', () => {
  test('JavaScript', () => {
    const f = compile(ce.parse('x!!'), {
      to: 'javascript',
      fallback: false,
    } as never);
    expect(f.success).toBe(true);
    const run = (x: number) => f.run!({ x } as never) as number;
    expect(run(-1)).toBe(1);
    expect(run(-3)).toBe(-1);
    expect(run(-5)).toBeCloseTo(1 / 3, 15);
    expect(run(-7)).toBeCloseTo(-1 / 15, 15);
    // A pole is spelled `Infinity` on the compiled lane.
    expect(run(-2)).toBe(Infinity);
    expect(run(-4)).toBe(Infinity);
    expect(run(5)).toBe(15);
  });

  test('interval-js', () => {
    const f = compile(ce.parse('x!!'), {
      to: 'interval-js',
      fallback: false,
    } as never);
    expect(f.success).toBe(true);
    const run = (x: unknown) => f.run!({ x } as never) as any;
    expect(run(-1)).toEqual({ kind: 'interval', value: { lo: 1, hi: 1 } });
    expect(run(-3)).toEqual({ kind: 'interval', value: { lo: -1, hi: -1 } });
    const third = run(-5);
    expect(third.kind).toBe('interval');
    expect(third.value.lo).toBeLessThanOrEqual(1 / 3);
    expect(third.value.hi).toBeGreaterThanOrEqual(1 / 3);
    expect(run(-2)).toMatchObject({ kind: 'singular', at: -2 });
    // An interval whose rounded endpoints straddle -2 holds the pole.
    expect(run({ lo: -3.2, hi: -1.8 })).toMatchObject({
      kind: 'singular',
      at: -2,
    });
    // From -1 up the values do not decrease: (-1)!! = 0!! = 1!! = 1.
    const r = run({ lo: -0.7, hi: 3.2 });
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBeLessThanOrEqual(1);
    expect(r.value.hi).toBeGreaterThanOrEqual(3);
  });
});

describe('Factorial2 symbolic reductions with a negative argument', () => {
  test('(2j+1)!! does not reduce when j can be negative', () => {
    // (2j+1)! / (2^j · j!) is ~oo/~oo at a negative integer j, while
    // (2j+1)!! is finite there ((-1)!! = 1 at j = -1).
    const ce = new ComputeEngine();
    ce.declare('j', 'integer');
    expect(ce.parse('(2j+1)!!').simplify().toString()).toBe(
      'Factorial2(2j + 1)'
    );
  });
});
