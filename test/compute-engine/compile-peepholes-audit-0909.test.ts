import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Code-generation peepholes from the Tycho code-generation audit of
// 2026-09-09. Each block checks the emitted TEXT (the peephole fired) and the
// VALUE the compiled function returns against the interpreter (the peephole is
// faithful).
//
//   - common-subexpression elimination binds a repeated `Min`/`Max` call;
//   - `Mod(a, 1)` is the fractional part, not the three-operation floored
//     template;
//   - a factor the emitted-code fold reduced to `1` leaves the emitted
//     arithmetic, while a factor or a summand it reduced to `0` stays;
//   - a coordinate read off a point the same expression builds is the
//     component, not an index into a literal array;
//   - a power with a root in its exponent takes that root instead of
//     `Math.pow`.

/** A fresh engine per block: a declaration must not leak between blocks. */
function newEngine(declarations: Record<string, string> = {}): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(declarations))
    ce.declare(name, type as any);
  return ce;
}

function codeOf(ce: ComputeEngine, latex: string): string {
  const r = compile(ce.parse(latex), { fallback: false });
  if (!r.code) throw new Error(`did not compile: ${latex}`);
  return r.code;
}

function occurrences(code: string, needle: string): number {
  return code.split(needle).length - 1;
}

describe('CSE binds a repeated min/max call', () => {
  const ce = newEngine({ u: 'real', v: 'real' });

  test('a three-times `ElementMin(v, 0.8)` is bound once', () => {
    const code = codeOf(
      ce,
      '\\mathrm{ElementMin}(v, 0.8)\\cos(u) + \\mathrm{ElementMin}(v, 0.8)' +
        '\\sin(u) + \\mathrm{ElementMin}(v, 0.8)\\cos(u)^2'
    );
    expect(occurrences(code, 'Math.min(')).toBe(1);
    // The `Cos(u)` beside it was already bound; both are now temporaries.
    expect(occurrences(code, 'Math.cos(')).toBe(1);
  });

  test('the same holds for `Min` and `Max`', () => {
    expect(
      occurrences(
        codeOf(ce, '\\min(v, 0.8)\\cos(u) + \\min(v, 0.8)\\sin(u)'),
        'Math.min('
      )
    ).toBe(1);
    expect(
      occurrences(
        codeOf(ce, '\\max(v, 0.8)\\cos(u) + \\max(v, 0.8)\\sin(u)'),
        'Math.max('
      )
    ).toBe(1);
  });

  test('the bound value matches the interpreter', () => {
    const e = ce.parse(
      '\\min(v, 0.8)\\cos(u) + \\min(v, 0.8)\\sin(u) + \\min(v, 0.8)\\cos(u)^2'
    );
    const r = compile(e, { fallback: false });
    for (const [u, v] of [
      [0.3, 0.2],
      [1.5, 2],
      [-2, 0.8],
    ]) {
      const got = r.run!({ u, v }) as number;
      const want = e.subs({ u, v }).N().re!;
      expect(Math.abs(got - want)).toBeLessThan(1e-12);
    }
  });
});

describe('`Mod(a, 1)` is the fractional part', () => {
  const ce = newEngine({ a: 'real', n: 'integer' });

  test('a compound dividend has the fractional part of its value', () => {
    const r = compile(ce.parse('(2a + 1) \\bmod 1'), { fallback: false });
    expect(r.run!({ a: 0.3 })).toBeCloseTo(0.6, 12);
    expect(r.run!({ a: -0.5 })).toBe(0);
    expect(r.run!({ a: -0.5 - 5e-21 })).toBe(0);
    expect(r.run!({ a: Infinity })).toBeNaN();
  });

  test('a dividend the caller re-mapped is bound once', () => {
    // `_.draw()` is caller-supplied source: splicing it twice would run it
    // twice. A `vars` entry makes the symbol such a splice, so it needs the
    // same temporary a compound dividend needs.
    const r = compile(ce.parse('a \\bmod 1'), {
      fallback: false,
      vars: { a: '_.draw()' },
    });
    let calls = 0;
    expect(
      r.run!({
        draw: () => {
          calls += 1;
          return -1.75;
        },
      } as any)
    ).toBe(0.25);
    expect(calls).toBe(1);
  });

  test('a tiny negative dividend gives the interpreter value', () => {
    // The true value at `a = -1e-20` is `1 - 1e-20`, which no double holds:
    // the interpreter, which computes at higher precision and then rounds to
    // a double, reports `1`, and so does the compiled code.
    const e = ce.parse('a \\bmod 1');
    const r = compile(e, { fallback: false });
    expect(r.run!({ a: -1e-20 })).toBe(e.subs({ a: -1e-20 }).N().re);
  });

  test('the value matches the interpreter', () => {
    const e = ce.parse('a \\bmod 1');
    const r = compile(e, { fallback: false });
    for (const a of [-3, -1.75, -0.25, 0, 0.5, 2.5, 1234567.75, 1e20]) {
      const got = r.run!({ a }) as number;
      const want = e.subs({ a }).N().re!;
      expect(got).toBe(want);
    }
  });

  test('an impure dividend draws exactly once', () => {
    const r = compile(ce.box(['Mod', ['Random'], 1]), { fallback: false });
    expect(occurrences(r.code!, 'drawNextRandomNumber')).toBe(1);
    const v = r.run!({}) as number;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe('an emitted unit factor leaves the arithmetic, a zero stays', () => {
  const ce = newEngine({ u: 'real', v: 'real', w: 'number' });

  test('the value matches the interpreter', () => {
    const e = ce.parse(
      '0.25\\sin(0)\\cos(u)\\min(v,0.8) + 0.25\\cos(0)\\sin(u)\\min(v,0.8)'
    );
    const r = compile(e, { fallback: false });
    for (const [u, v] of [
      [0.3, 0.2],
      [1.5, 2],
      [-2, 0.8],
    ]) {
      const got = r.run!({ u, v }) as number;
      const want = e.subs({ u, v }).N().re!;
      expect(Math.abs(got - want)).toBeLessThan(1e-12);
    }
  });

  test('a zero factor beside a possibly non-finite operand is kept', () => {
    // `w` is typed `number`, which admits the infinities and `NaN`, and
    // `0 · ∞` is `NaN` — so the product must not collapse to `0`.
    const code = codeOf(ce, '\\sin(0) \\cdot w');
    expect(code).toContain('0');
    expect(code).toContain('_.w');
    const r = compile(ce.parse('\\sin(0) \\cdot w'), { fallback: false });
    expect(r.run!({ w: Infinity })).toBeNaN();
    expect(r.run!({ w: NaN })).toBeNaN();
  });

  test('a zero factor beside a `real`-typed operand is kept too', () => {
    // A type describes the VALUE, not the emitted code: `u` is typed `real`,
    // yet the code a `real`-typed operand emits can still answer `NaN` at run
    // time — an out-of-range indexed read is the standing example. The
    // product therefore keeps its zero factor whatever the other operand's
    // type is.
    const code = codeOf(ce, '\\sin(0) \\cdot u');
    expect(code).toContain('_.u * 0');
    const r = compile(ce.parse('\\sin(0) \\cdot u'), { fallback: false });
    expect(r.run!({ u: 4 })).toBe(0);
    expect(r.run!({ u: Infinity })).toBeNaN();
  });

  test('a zero factor keeps an operand that has an effect', () => {
    // Collapsing the product to `0` dropped the draw, which moves every later
    // draw of a seeded sequence.
    const r = compile(ce.box(['Multiply', ['Sin', 0], ['Random']]), {
      fallback: false,
    });
    expect(occurrences(r.code!, 'drawNextRandomNumber')).toBe(1);
    expect(r.run!({})).toBe(0);
  });

  test('a folded zero summand stays in the sum', () => {
    // `x + 0` is not the identity for a negative zero: `-0 + 0` is `+0`.
    const r = compile(ce.parse('u + \\sin(0)'), { fallback: false });
    expect(Object.is(r.run!({ u: -0 }), 0)).toBe(true);
  });
});

describe('a coordinate of a constructed point is the component', () => {
  const ce = newEngine({ a: 'real', b: 'real' });

  test('a dropped component the caller re-mapped stands the shortcut down', () => {
    // A `vars` entry splices caller-supplied source, which may do anything —
    // draw, count its own calls, write. The interpreter evaluates every
    // operand of the constructor, so the source must still run even though
    // its component is discarded.
    const r = compile(ce.box(['PointX', ['PointList', 'a', 'b']]), {
      fallback: false,
      vars: { b: '_.draw()' },
    });
    expect(occurrences(r.code!, '_.draw()')).toBe(1);
    let calls = 0;
    expect(
      r.run!({
        a: 3,
        draw: () => {
          calls += 1;
          return 4;
        },
      } as any)
    ).toBe(3);
    expect(calls).toBe(1);
  });

  test('an impure component that would be dropped stands the shortcut down', () => {
    const r = compile(ce.box(['PointX', ['PointList', 'a', ['Random']]]), {
      fallback: false,
    });
    expect(occurrences(r.code!, 'drawNextRandomNumber')).toBe(1);
    expect(r.run!({ a: 3 })).toBe(3);
  });

});

describe('a power with a root in its exponent takes the root', () => {
  const ce = newEngine({ a: 'real', x: 'real' });
  ce.assume(ce.parse('a > 0'));

  test('the values match the interpreter', () => {
    for (const latex of ['\\sqrt{a}^3', 'a^{3/2}', '\\sqrt{a}^5']) {
      const e = ce.parse(latex);
      const r = compile(e, { fallback: false });
      for (const a of [0, 0.5, 2, 3, 8, 1e6]) {
        const got = r.run!({ a }) as number;
        const want = e.subs({ a }).N().re!;
        expect(Math.abs(got - want)).toBeLessThanOrEqual(
          Math.abs(want) * 1e-15
        );
      }
    }
    const e = ce.parse('|x|^{2/3}');
    const r = compile(e, { fallback: false });
    for (const x of [-8, -2, 0, 0.5, 2, 27, 1e6]) {
      const got = r.run!({ x }) as number;
      const want = e.subs({ x }).N().re!;
      expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * 1e-15);
    }
  });

  test('the root form is closer to the true value than `Math.pow`', () => {
    // `Math.pow` takes a logarithm and exponentiates it back, which loses a
    // root it could have taken exactly.
    expect(4 * Math.sqrt(4)).toBe(8);
    expect(Math.cbrt(8) * Math.cbrt(8)).toBe(4);
    expect(Math.pow(8, 2 / 3)).not.toBe(4);
    // At a large base the gap is far more than one unit in the last place.
    // The reference is computed by the engine at 60 digits.
    const ref = new ComputeEngine();
    ref.precision = 60;
    const want = ref.box(['Power', 1e200, ['Rational', 2, 3]]).N().re!;
    const relative = (got: number): number => Math.abs(got - want) / want;
    // Measured: 1.2e-16 (about half a unit in the last place) against
    // 1.7e-14 (about 77 of them).
    expect(relative(Math.cbrt(1e200) * Math.cbrt(1e200))).toBeLessThan(5e-16);
    expect(relative(Math.pow(1e200, 2 / 3))).toBeGreaterThan(1e-14);
  });
});

describe('the square of a square root is its radicand, as one operand', () => {
  // `√X²` is `X` when `X` is provably non-negative. A parent chose its
  // parentheses for the power, so a sum `X` is written as a group.
  const ce = newEngine({ x: 'real', y: 'real' });
  // Inside the unit disk, where `√(1 - (x² + y²))` is real.
  const points = [
    { x: 0.5, y: 0.25 },
    { x: -0.6, y: 0.3 },
    { x: 0.1, y: -0.7 },
    { x: 0.8, y: 0 },
  ];
  const sum = ['Add', ['Power', 'x', 2], 1];
  const r2 = ['Power', ['Sqrt', sum], 2];

  function expectInterpreterValues(e: ReturnType<ComputeEngine['box']>) {
    const r = compile(e, { fallback: false });
    expect(r.success).toBe(true);
    for (const p of points) {
      const want = e.subs(p).N();
      const got = r.run!(p);
      if (typeof got === 'boolean') expect(got).toBe(want.symbol === 'True');
      else expect(got as number).toBeCloseTo(want.re!, 12);
    }
  }

  test('the values match the interpreter', () => {
    for (const latex of [
      '1-\\sqrt{x^2+y^2}^2',
      '2\\sqrt{x^2+1}^2',
      // The square root of a value that is negative when the sum is not
      // grouped: `√(1 - x² + y²)` in place of `√(1 - (x² + y²))`.
      '\\sqrt{1-\\sqrt{x^2+y^2}^2}',
    ])
      expectInterpreterValues(ce.parse(latex));
  });

  test('the values match the interpreter in every operand position', () => {
    for (const json of [
      ['Negate', r2],
      ['Multiply', 'y', r2],
      ['Subtract', 3, r2],
      ['Divide', 2, r2],
      ['Divide', r2, ['Add', 'y', 5]],
      // At `x = 0.8` the ungrouped `2 * x² + 1` is below 3 and the product
      // is not.
      ['Less', ['Multiply', 2, r2], 3],
      // Coverage: these parents write the radicand as a call argument or do
      // not reach the reduction to the radicand, so they were right before.
      ['Power', r2, 'y'],
      ['Power', 2, r2],
      ['Mod', r2, 2],
    ])
      expectInterpreterValues(ce.box(json as any));
  });

  test('a one-expression block or an ascription is read through', () => {
    // A `Block` of one expression and a `Typed` are written as the code of
    // their operand, which can be a sum.
    const block = ['Block', sum];
    const typed = ['Typed', ['Add', 'x', 1], "'real'"];
    for (const json of [
      ['Multiply', 2, ['Power', ['Sqrt', block], 2]],
      ['Negate', ['Power', ['Sqrt', block], 2]],
      ['Subtract', 3, ['Power', ['Sqrt', block], 2]],
      ['Divide', 2, ['Power', ['Sqrt', block], 2]],
      ['Divide', ['Power', ['Sqrt', block], 2], ['Add', 'x', 5]],
      ['Multiply', 2, ['Square', ['Sqrt', block]]],
      ['Multiply', 2, ['Power', ['Root', block, 2], 2]],
      ['Multiply', 2, ['Power', ['Power', block, ['Rational', 1, 2]], 2]],
      ['Multiply', 2, ['Abs', block]],
      ['Negate', ['Abs', ['Block', block]]],
      ['Multiply', 2, ['Real', block]],
      ['Divide', 1, ['Conjugate', block]],
      ['Multiply', 2, ['Real', typed]],
      ['Multiply', 2, ['Conjugate', ['Block', typed]]],
      // Coverage: `X^1` is `X` at canonicalization.
      ['Multiply', 2, ['Power', block, 1]],
    ])
      expectInterpreterValues(ce.box(json as any));
  });
});
