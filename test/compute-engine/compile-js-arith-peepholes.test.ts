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

function codeOf(ce: ComputeEngine, latex: string): string {
  const r = compile(ce.parse(latex), { fallback: false });
  if (!r.code) throw new Error(`did not compile: ${latex}`);
  return r.code;
}

/** The index of the parenthesis that closes the one at `open` in `code`. */
function closingParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')' && --depth === 0) return i;
  }
  throw new Error(`unbalanced: ${code}`);
}

/**
 * The plain comparison inside the tests for unsupplied variables that a
 * comparison whose value is the result takes (`BaseCompiler.
 * unsuppliedComparisonGuard`): the exact test is what these pins are about.
 * Two forms:
 * - the comparison first, when each operand reads an absent value as NaN:
 *   `((cmp) || ((tests) ? false : undefined))`, or `((cmp) && ((tests) ?
 *   true : undefined))` for `NotEqual`;
 * - the tests first, when an operand does not (`Length(L)` is a number for
 *   any array): `((tests) ? (cmp) : undefined)`.
 */
function exactTest(code: string): string {
  expect(code.startsWith('((')).toBe(true);
  if (
    code.endsWith(') : undefined)') &&
    !/ \? (false|true) : undefined\)\)$/.test(code)
  ) {
    const testEnd = closingParen(code, 1);
    expect(code.slice(testEnd + 1, testEnd + 5)).toBe(' ? (');
    return code.slice(testEnd + 5, -') : undefined)'.length);
  }
  const cmpEnd = closingParen(code, 1);
  expect(code.slice(cmpEnd + 1)).toMatch(
    /^ (\|\| \(\(.*\) \? false : undefined\)|&& \(\(.*\) \? true : undefined\))\)$/
  );
  return code.slice(2, cmpEnd);
}

describe('J8: equality between integer-valued operands is exact', () => {
  const ce = newEngine({
    a: 'real',
    b: 'real',
    x: 'real',
    n: 'integer',
    L: 'list<real>',
  });

  test('Sign/Floor/Ceil/Length/integer literal compare with === and !==', () => {
    expect(exactTest(codeOf(ce, '\\mathrm{Sign}(a) = \\mathrm{Sign}(b)'))).toBe(
      '((Math.sign(_.a)) === (Math.sign(_.b)))'
    );
    expect(
      exactTest(codeOf(ce, '\\mathrm{Sign}(a) \\ne \\mathrm{Sign}(b)'))
    ).toBe('((Math.sign(_.a)) !== (Math.sign(_.b)))');
    expect(
      exactTest(codeOf(ce, '\\lfloor a \\rfloor = \\lceil b \\rceil'))
    ).toBe('((Math.floor(_.a)) === (Math.ceil(_.b)))');
    expect(exactTest(codeOf(ce, '\\mathrm{Length}(L) = 3'))).toBe(
      '(((_.L).length) === (3))'
    );
    expect(exactTest(codeOf(ce, 'n = 3'))).toBe('((_.n) === (3))');
  });

  test('a chained form takes the exact test on each pair', () => {
    // The link `n = 3` does not read `a`, so it can decide `false` while
    // `a` has no value: the chain is the three-valued `And` of its links,
    // each with its own exact test.
    const code = codeOf(ce, '\\lfloor a \\rfloor = n = 3');
    expect(code).toContain('((((_tv1) === (_.n))) || (');
    expect(code).toContain(
      '((((_.n) === (3))) || ((_.n !== undefined) ? false : undefined))'
    );
    expect(code.endsWith('(Math.floor(_.a))')).toBe(true);
  });

  test('a real operand compares exactly too', () => {
    expect(exactTest(codeOf(ce, 'x = 3'))).toBe('((_.x) === (3))');
    expect(exactTest(codeOf(ce, 'x = 0.5'))).toBe('((_.x) === (0.5))');
  });

  test('the engine tolerance does not reach compiled equality', () => {
    // At a tolerance of 1 the interpreter calls 3 and 4 equal; the compiled
    // comparison is exact whatever the engine tolerance (compiled-equality
    // ruling, `docs/COMPILATION-MODEL.md`).
    const coarse = new ComputeEngine();
    coarse.tolerance = 1;
    coarse.declare('m', 'integer');
    expect(exactTest(codeOf(coarse, 'm = 3'))).toBe('((_.m) === (3))');
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

  test('KroneckerDelta over integers compares exactly', () => {
    const d2 = compile(ce.box(['KroneckerDelta', 'n', 3]), {
      fallback: false,
    });
    expect(d2.code).toContain('_x === _v[0]');
    expect(d2.run!({ n: 3 })).toBe(1);
    expect(d2.run!({ n: 4 })).toBe(0);

    const d1 = compile(ce.box(['KroneckerDelta', 'n']), { fallback: false });
    expect(d1.code).toBe('(_.n === 0 ? 1 : 0)');
    expect(d1.run!({ n: 0 })).toBe(1);
    expect(d1.run!({ n: 2 })).toBe(0);

    // A real operand compares exactly as well.
    const real = compile(ce.box(['KroneckerDelta', 'x', 3]), {
      fallback: false,
    });
    expect(real.code).toContain('_x === _v[0]');
    expect(real.run!({ x: 3 + 1e-12 })).toBe(0);
  });
});

describe('J9a: the modulo template binds a divisor it would repeat', () => {
  const ce = newEngine({
    theta: 'real',
    x: 'real',
    m: 'integer',
    n: 'integer',
  });

  test('a compound divisor is computed once', () => {
    const code = codeOf(ce, '2 \\bmod \\sin(0.2\\theta)');
    expect((code.match(/Math\.sin/g) ?? []).length).toBe(1);
    expect(code).toBe('_SYS.floorMod(2, Math.sin(0.2 * _.theta))');
  });

  test('a symbol or a literal divisor is passed to the helper as it is', () => {
    expect(codeOf(ce, '(x + 29) \\bmod 900')).toBe(
      '_SYS.floorMod(_.x + 29, 900)'
    );
    expect(codeOf(ce, 'm \\bmod n')).toBe('_SYS.floorMod(_.m, _.n)');
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

  test('an impure divisor binds the dividend first', () => {
    // The interpreter evaluates the dividend before the divisor. Binding only
    // the divisor would run it first, so the dividend takes a temporary too
    // as soon as either operand is impure.
    const r = compile(ce.box(['Mod', ['Add', 'x', 1], ['Random']]), {
      fallback: false,
    });
    // `_SYS.floorMod` is a call, and a call evaluates its arguments once,
    // from left to right.
    expect(r.code).toBe('_SYS.floorMod(_.x + 1, _SYS.drawNextRandomNumber())');
  });
});

describe('J9b: a reciprocal square is a division, not Math.pow', () => {
  const ce = newEngine({ t: 'real' });

  test('a symbol base divides twice; a compound base keeps Math.pow', () => {
    expect(codeOf(ce, '\\frac{1}{t^2}')).toBe('(1 / _.t / _.t)');
    expect(codeOf(ce, '\\frac{1}{(t+1)^2}')).toBe('Math.pow(_.t + 1, -2)');
    expect(codeOf(ce, '\\frac{1}{\\sin(t)^2}')).toBe(
      'Math.pow(Math.sin(_.t), -2)'
    );
  });

  test('other exponents are unchanged', () => {
    expect(codeOf(ce, '\\frac{1}{t}')).toBe('1 / _.t');
    expect(codeOf(ce, '\\frac{1}{t^3}')).toBe('Math.pow(_.t, -3)');
  });

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

  test('argument, modulus and the two parts read straight off the parts', () => {
    expect(codeOf(ce, '\\arg((x - 0.3127) + i(y - 0.329))')).toBe(
      'Math.atan2((_.y + -0.329), (_.x + -0.3127))'
    );
    expect(codeOf(ce, '|(x - 0.3127) + i(y - 0.329)|')).toBe(
      'Math.hypot((_.x + -0.3127), (_.y + -0.329))'
    );
    expect(codeOf(ce, '\\Re((x - 0.3127) + i(y - 0.329))')).toBe(
      '(_.x + -0.3127)'
    );
    expect(codeOf(ce, '\\Im((x - 0.3127) + i(y - 0.329))')).toBe(
      '(_.y + -0.329)'
    );
    expect(codeOf(ce, '\\arg(x + iy)')).toBe('Math.atan2(_.y, _.x)');
  });

  test('arg(x - iy) at y = 0 answers pi for a negative x, as the interpreter does (CE-262)', () => {
    const e = ce.parse('\\arg(x - iy)');
    const run = compile(e, { to: 'javascript', fallback: false } as never).run!;
    expect(run({ x: -3, y: 0 })).toBe(Math.PI);
    expect(run({ x: 3, y: 0 })).toBe(0);
    expect(run({ x: -3, y: 2 })).toBeCloseTo(Math.atan2(-2, -3), 12);
  });

  test('a one-operand sum or product, and a power of 1, keep their grouping (CE-251)', () => {
    // Only non-canonical input has these shapes. The operand was spliced bare
    // into the infix parent, or glued to a prefix operator (`3 * * x`).
    const raw = (json: unknown) => ce.box(json as never, { form: 'raw' });
    const cases: unknown[] = [
      ['Multiply', 3, ['Multiply', ['Add', 'x', 1]]],
      ['Multiply', 3, ['Add', ['Add', 'x', 1]]],
      ['Multiply', 3, ['Power', ['Add', 'x', 1], 1]],
    ];
    for (const to of ['javascript', 'glsl']) {
      for (const json of cases) {
        const code = compile(raw(json), { to, fallback: false } as never)
          .code as string;
        expect(code).toMatch(/^3(\.0)? \* \((_\.)?x \+ 1(\.0)?\)$/);
      }
    }
    expect(
      compile(raw(['Multiply', 3, ['Power', ['Add', 'x', 1], 1]]), {
        to: 'javascript',
        fallback: false,
      } as never).run!({ x: 2 })
    ).toBe(9);
  });

  test('a one-operand Subtract is its operand, and a one-operand Divide or Power fails closed (CE-251)', () => {
    // `Subtract(x)` evaluates to `x`. Read as a prefix `-` it emitted
    // `3 * (-x + 1)`, which answered -3 at x = 2 where the interpreter
    // answers 9. `Divide(x)` and `Power(x)` evaluate to `Error("missing")`,
    // and emitted invalid code (`/(x + 1)`, `_SYS.pow(x + 1, )`).
    const raw = (json: unknown) => ce.box(json as never, { form: 'raw' });
    const sub = raw(['Multiply', 3, ['Subtract', ['Add', 'x', 1]]]);
    expect(sub.canonical.subs({ x: 2 }).evaluate().re).toBe(9);
    for (const to of ['javascript', 'glsl', 'wgsl']) {
      const code = compile(sub, { to, fallback: false } as never)
        .code as string;
      expect(code).toMatch(/^3(\.0)? \* \((_\.)?x \+ 1(\.0)?\)$/);
    }
    expect(
      compile(sub, { to: 'javascript', fallback: false } as never).run!({
        x: 2,
      })
    ).toBe(9);
    for (const to of ['javascript', 'glsl', 'wgsl'])
      for (const head of ['Divide', 'Power'])
        expect(() =>
          compile(raw(['Multiply', 3, [head, ['Add', 'x', 1]]]), {
            to,
            fallback: false,
          } as never)
        ).toThrow(/expected two operands, got one/);
  });

  test('an opaque complex value keeps the object-building lowering', () => {
    expect(codeOf(ce, '\\arg(\\sin(x + iy))')).toContain('_SYS.carg(');
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
    const code = codeOf(listEngine, '\\left|\\mathrm{Sum}(P_{a..b})\\right|');
    expect(code.startsWith('Math.abs(')).toBe(true);
    expect(code).not.toContain('_SYS.cabs');
    expect(code).not.toContain('_SYS.cplx');

    const e = listEngine.parse('\\left|\\mathrm{Sum}(P_{a..b})\\right|');
    const r = compile(e, { fallback: false });
    expect(r.run!({ P: [1, -2, 3, -4, 5], a: 2, b: 4 })).toBe(3);
  });

  test('a wide element type folds on the real lane too', () => {
    // A WIDE element type (`list<number>`) is real outside the complex
    // discipline, the rule every other wide binding follows: a scalar
    // `x: number` compiles `x + 1` to `_.x + 1`, `Max` over the same list
    // reduces with `Math.max`, and the indexed spelling of this very sum —
    // `Σ_{k=a}^{b} Q[k]` — accumulates with `+`. The collection form of
    // `Sum` used to be the sole consumer that read the same type as
    // possibly-complex and took the shape-agnostic combiner.
    const wide = newEngine({
      Q: 'list<number>',
      a: 'integer',
      b: 'integer',
    });
    const code = codeOf(wide, '\\mathrm{Sum}(Q_{a..b})');
    expect(code).not.toContain('_SYS.sadd');
    expect(code).not.toContain('_SYS.cplx');
    expect(code).toContain('+=');
  });

  test('an element type that is NOT real keeps the shape-agnostic fold', () => {
    const complexList = newEngine({
      Q: 'list<complex>',
      a: 'integer',
      b: 'integer',
    });
    expect(codeOf(complexList, '\\mathrm{Sum}(Q_{a..b})')).toContain(
      '_SYS.sadd'
    );
  });
});

describe('an identity lowering parenthesizes an infix operand', () => {
  // `Real`, `Conjugate`, `Abs` of a non-negative value and the rounding heads
  // of an integer all hand back their operand's code. The compiler splices a
  // function head's emission into its parent without parentheses, so a sum
  // handed back that way was torn: `3·Re(x + 1)` ran as `3x + 1`.
  const ce = newEngine({ x: 'real', u: 'real<0..>', n: 'integer' });

  test('the emitted code keeps the operand together', () => {
    expect(codeOf(ce, '3\\Re(x+1)')).toBe('3 * (_.x + 1)');
    expect(codeOf(ce, '3|u+1|')).toBe('3 * (_.u + 1)');
    expect(codeOf(ce, '3\\mathrm{Truncate}(n+1)')).toBe('3 * (_.n + 1)');
    expect(codeOf(ce, '3\\lfloor n+1 \\rfloor')).toBe('3 * (_.n + 1)');
  });

  test('an atomic operand stays bare', () => {
    expect(codeOf(ce, '3\\Re(x)')).toBe('3 * _.x');
  });

  test('a caller-mapped infix head is parenthesized too', () => {
    // `Power` has no entry in the target's own operator table, so only the
    // caller's `operators` mapping says that its emission is infix. Without
    // consulting that mapping the operand was spliced bare and `3 * _.x ^ 3`
    // ran as the bitwise `(3 * _.x) ^ 3`.
    const e = ce.box(['Multiply', 3, ['Real', ['Power', 'x', 3]]]);
    const mapped = compile(e, {
      fallback: false,
      operators: { Power: ['^', 5] },
    } as any);
    expect(mapped.code).toBe('3 * (_.x ^ 3)');
  });

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
