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

  test('a symbol dividend needs no temporary', () => {
    expect(codeOf(ce, 'a \\bmod 1')).toBe('((_.a - Math.floor(_.a)) % 1)');
  });

  test('a compound dividend goes through the fract helper, evaluated once', () => {
    // A temporary bound in an immediately invoked function would allocate a
    // closure per evaluation at every such site; the helper computes the same
    // `((x - Math.floor(x)) % 1)` on its one argument.
    const r = compile(ce.parse('(2a + 1) \\bmod 1'), { fallback: false });
    expect(r.code).toBe('_SYS.fract(2 * _.a + 1)');
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
    expect(occurrences(r.code!, '_.draw()')).toBe(1);
    expect(r.code).toBe('_SYS.fract(_.draw())');
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

  test('a non-negative integer dividend keeps the plain remainder', () => {
    // Both operands non-negative integers: plain `%` already IS the floored
    // modulo, and that fast path is unchanged. An integer of unknown sign is
    // not on it and takes the fractional-part form, which answers the same
    // zero.
    const nonneg = newEngine({ k: 'integer' });
    nonneg.assume(nonneg.parse('k \\ge 0'));
    expect(codeOf(nonneg, 'k \\bmod 1')).toBe('((_.k) % (1))');
    expect(codeOf(ce, 'n \\bmod 1')).toBe('((_.n - Math.floor(_.n)) % 1)');
  });

  test('a divisor that is not one keeps the floored template', () => {
    expect(codeOf(ce, 'a \\bmod 2')).toBe('((((_.a) % (2)) + (2)) % (2))');
  });

  test('the result stays inside the codomain for a tiny negative dividend', () => {
    // The floored modulo by one has codomain `[0, 1)`. The true value at
    // `a = -1e-20` is `1 - 1e-20`, which no double holds: the subtraction
    // `a - Math.floor(a)` rounds it to exactly `1`, one element past the end
    // of a palette indexed by `Floor(Mod(x, 1) · n)`. The trailing `% 1` maps
    // that `1` back to `0`.
    //
    // The interpreter, which computes at higher precision and then rounds to a
    // double, reports `1` here — the same rounding, outside the codomain. This
    // input is therefore pinned on its own rather than compared against the
    // interpreter below.
    const r = compile(ce.parse('a \\bmod 1'), { fallback: false });
    expect(r.run!({ a: -1e-20 })).toBe(0);
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

  test('a folded `cos(0)` factor is dropped and a folded `sin(0)` one is not', () => {
    const code = codeOf(
      ce,
      '0.25\\sin(0)\\cos(u)\\min(v,0.8) + 0.25\\cos(0)\\sin(u)\\min(v,0.8)'
    );
    // `x * 1` is `x` for every IEEE value, so the unit factor goes.
    expect(code).not.toContain('* 1');
    expect(code).toContain('0.25 * Math.sin(_.u)');
    // The zero factor stays: `0 · ∞` and `0 · NaN` are `NaN`, and a factor
    // with an effect must still be evaluated.
    expect(code).toContain('0 * Math.cos(_.u)');
  });

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
    const code = codeOf(ce, 'u + \\sin(0)');
    expect(code).toBe('_.u + 0');
    const r = compile(ce.parse('u + \\sin(0)'), { fallback: false });
    expect(Object.is(r.run!({ u: -0 }), 0)).toBe(true);
  });
});

describe('a coordinate of a constructed point is the component', () => {
  const ce = newEngine({ a: 'real', b: 'real' });

  test('`PointX`/`PointY` over a `PointList` emit the component', () => {
    const x = compile(ce.box(['PointX', ['PointList', 'a', 'b']]), {
      fallback: false,
    });
    expect(x.code).toBe('(_.a ?? NaN)');
    expect(x.run!({ a: 3, b: 4 })).toBe(3);
    const y = compile(ce.box(['PointY', ['PointList', 'a', 'b']]), {
      fallback: false,
    });
    expect(y.code).toBe('(_.b ?? NaN)');
    expect(y.run!({ a: 3, b: 4 })).toBe(4);
  });

  test('an absent component still answers the `NaN` absence marker', () => {
    // `NaN` is the compiled ABI's absence marker, and the long form got it
    // from the `?? NaN` on the array index. The shortcut reads the component
    // straight out of the constructor, so it has to carry that coalesce
    // itself: without it a `run()` call that leaves `a` out answers the JS
    // `undefined`.
    const x = compile(ce.box(['PointX', ['PointList', 'a', 'b']]), {
      fallback: false,
    });
    expect(x.run!({ b: 2 } as any)).toBeNaN();
  });

  test('a `Tuple` and a flat `List` spelling behave the same', () => {
    expect(
      compile(ce.box(['PointX', ['Tuple', 'a', 'b']]), { fallback: false }).code
    ).toBe('(_.a ?? NaN)');
    expect(
      compile(ce.box(['PointX', ['List', 'a', 'b']]), { fallback: false }).code
    ).toBe('(_.a ?? NaN)');
  });

  test('an opaque component keeps its `_SYS.pointSlot` guard', () => {
    // A component whose type does not prove it is a number may hold an array
    // at run time; `_SYS.pointSlot` answers `NaN` for one.
    const open = new ComputeEngine();
    const r = compile(open.box(['PointY', ['PointList', 'p', 'q']]), {
      fallback: false,
    });
    expect(r.code).toBe('(_SYS.pointSlot(_.q) ?? NaN)');
    expect(r.run!({ p: 1, q: 2 })).toBe(2);
    expect(r.run!({ p: 1, q: [2, 3] })).toBeNaN();
  });

  test('a caller-supplied constructor stands the shortcut down', () => {
    // The caller decides what `Tuple` builds. Here it swaps the two
    // coordinates, so `PointX` is the SECOND operand — reading the first one
    // out of the operand list would answer the wrong coordinate.
    const r = compile(ce.box(['PointX', ['Tuple', 'a', 'b']]), {
      fallback: false,
      functions: { Tuple: '((p, q) => [q, p])' },
    });
    expect(r.code).toContain('((p, q) => [q, p])(_.a, _.b)');
    expect(r.run!({ a: 3, b: 4 })).toBe(4);
  });

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

  test('a coordinate the constructor does not state keeps the old form', () => {
    // `PointZ` over a three-component point still reads the component; over a
    // two-component one the `PointZ` canonical handler rejects the shape
    // before compilation, so there is nothing to shortcut.
    const z = compile(ce.box(['PointZ', ['Tuple', 'a', 'b', 7]]), {
      fallback: false,
    });
    expect(z.code).toBe('7');
  });
});

describe('a power with a root in its exponent takes the root', () => {
  const ce = newEngine({ a: 'real', x: 'real' });
  ce.assume(ce.parse('a > 0'));

  test('a three-halves power is a square root times the base', () => {
    expect(codeOf(ce, '\\sqrt{a}^3')).toBe('(_.a * Math.sqrt(_.a))');
    expect(codeOf(ce, 'a^{3/2}')).toBe('(_.a * Math.sqrt(_.a))');
    expect(codeOf(ce, '\\sqrt{a}^5')).toBe(
      '(_SYS.pow2(_.a) * Math.sqrt(_.a))'
    );
    expect(codeOf(ce, '\\sqrt{a}^2')).toBe('_.a');
  });

  test('a two-thirds power squares the cube root', () => {
    // The `Math.abs` is dropped: squaring removes the sign, and `Math.cbrt`
    // keeps it.
    expect(codeOf(ce, '|x|^{2/3}')).toBe('_SYS.pow2(Math.cbrt(_.x))');
  });

  test('a caller-supplied `Abs` or `Sqrt` is not read through', () => {
    // Dropping the `Abs` rests on "squaring removes the sign", and reading a
    // radicand out of a `Sqrt` rests on `(√u)^k = u^(k/2)`. Both are claims
    // about what those heads MEAN, which a caller-supplied implementation no
    // longer honors: this `Abs` returns 8 whatever it is given, so
    // `Abs(x)^(2/3)` is `8^(2/3)` — that is, 4.
    const abs = compile(ce.parse('|x|^{2/3}'), {
      fallback: false,
      functions: { Abs: '((v) => 8)' },
    });
    expect(abs.code).toContain('((v) => 8)(_.x)');
    expect(abs.run!({ x: -27 })).toBeCloseTo(4, 12);
    // The same `Sqrt` returns 4, so `Sqrt(a)^3` is 64 — not `a * Math.sqrt(a)`.
    const sqrt = compile(ce.parse('\\sqrt{a}^3'), {
      fallback: false,
      functions: { Sqrt: '((v) => 4)' },
    });
    expect(sqrt.code).toContain('((v) => 4)(_.a)');
    expect(sqrt.run!({ a: 9 })).toBeCloseTo(64, 12);
  });

  test('a base the emitted form would name twice keeps `Math.pow`', () => {
    // The radicand is a compound expression, so repeating it would duplicate
    // the code that computes it.
    expect(codeOf(ce, '\\sqrt{x^2+1}^3')).toBe(
      '_SYS.pow3(Math.sqrt((_.x * _.x) + 1))'
    );
  });

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
