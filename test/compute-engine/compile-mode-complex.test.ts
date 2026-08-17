import { ComputeEngine, compile } from '../../src/compute-engine';
import { isCompileDeclineError } from '../../src/compute-engine/compilation/diagnostics';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * Compile-mode migration, step 3 — the COMPLEX discipline
 * (`docs/plans/2026-08-16-compile-complex-mode.md` §9, step 3; §2 for the
 * discipline; §8 D2/D6/D8 for the runtime rules).
 *
 * Under `mode: 'complex'` a numeric binding whose static type is wide is
 * complex-shaped and lifted at its use through `_SYS.cplx` (a number becomes
 * `{re, im: 0}`, an object or a non-number passes through); a user function
 * is emitted ONCE (no per-call-site lane); unknown-sign radicals promote;
 * and the real-only heads take the D2/D6 RUNTIME rule — the operand is bound
 * once, the real lowering runs when its imaginary part is exactly zero, and
 * the value is `false` (a comparison) or `NaN` (a numeric head) otherwise —
 * while a statically non-real operand (`i`, `2i`) is a compile-time
 * `capability` decline. Typed-real values keep the real kernel.
 */

const p = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  { str: type },
];

const CX = { mode: 'complex', fallback: false } as const;

describe('complex mode — result convention (design §5) and the lift at use', () => {
  it('2a + 1: a wide symbol is lifted at use; a real result is a plain number', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('2a + 1'), CX);
    expect(r.code).toContain('_SYS.cplx(_.a)');
    expect(r.run!({ a: -2 })).toBe(-3);
    expect(r.run!({ a: { re: 1, im: 1 } })).toEqual({ re: 3, im: 2 });
    expect(r.mode).toBe('complex');
  });

  it('√a promotes: {re: 0, im: 1.414…} at a = −2, the number 2 at a = 4', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{a}'), CX);
    expect(r.code).toBe('_SYS.csqrt(_SYS.cplx(_.a))');
    expect(r.run!({ a: -2 })).toEqual({ re: 0, im: Math.SQRT2 });
    expect(r.run!({ a: 4 })).toBe(2);
  });

  it('|√a| is a real number (Abs of a complex operand); (√a)² is −2 at a = −2', () => {
    const ce = new ComputeEngine();
    expect(compile(ce.parse('|\\sqrt{a}|'), CX).run!({ a: -2 })).toBeCloseTo(
      Math.SQRT2,
      14
    );
    expect(compile(ce.parse('(\\sqrt{a})^2'), CX).run!({ a: -2 })).toBeCloseTo(
      -2,
      14
    );
  });

  it('a typed-real symbol keeps the real kernel', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const r = compile(ce.parse('2t + 1'), CX);
    expect(r.code).toBe('2 * _.t + 1');
    // …but its unknown-sign radical still promotes.
    expect(compile(ce.parse('\\sqrt{t}'), CX).code).toBe(
      '_SYS.csqrt(({ re: _.t, im: 0 }))'
    );
  });

  it('a boolean result is never coerced', () => {
    const ce = new ComputeEngine();
    expect(compile(ce.parse('x < 3'), CX).run!({ x: 1 })).toBe(true);
    expect(compile(ce.parse('x < 3'), CX).run!({ x: 5 })).toBe(false);
  });
});

describe('complex mode — one emission per user function, lift at use (design §3)', () => {
  function engineWith(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    ce.declare('L', 'list<complex>');
    ce.assign('b', ce.parse('x \\mapsto 2x'));
    ce.assign('c', ce.box(['Function', ['Add', 'x', 1], p('x', 'complex')]));
    return ce;
  }

  it('b(a), b(z), b(√a): the same `_fn_b`, no `$z` specialization', () => {
    const ce = engineWith();
    // `a` is `unknown` (possibly a collection), so the call takes the runtime
    // broadcast dispatch — with the lifted argument and the ONE `_fn_b`.
    const ba = compile(ce.parse('b(a)'), CX);
    expect(ba.code).toContain('_fn_b(');
    expect(ba.code).toContain('_SYS.cplx(_.a)');
    expect(ba.code).not.toContain('$z');
    expect(ba.run!({ a: -2 })).toBe(-4);
    const bz = compile(ce.parse('b(z)'), CX);
    expect(bz.code).toBe('_fn_b(_.z)');
    expect(bz.run!({ z: { re: 1, im: 2 } })).toEqual({ re: 2, im: 4 });
    const bs = compile(ce.parse('b(\\sqrt{a})'), CX);
    expect(bs.code).toBe('_fn_b(_SYS.csqrt(_SYS.cplx(_.a)))');
    expect(bs.run!({ a: -2 })).toEqual({ re: 0, im: 2 * Math.SQRT2 });
  });

  it('a declared-complex parameter is coerced as before', () => {
    const ce = engineWith();
    const r = compile(ce.parse('c(a)'), CX);
    expect(r.run!({ a: 2 })).toBe(3);
    expect(r.run!({ a: { re: 1, im: 1 } })).toEqual({ re: 2, im: 1 });
  });

  it('Map(b, L): the bare value reference serves complex elements', () => {
    const ce = engineWith();
    const r = compile(ce.box(['Map', 'b', 'L']), CX);
    expect(r.code).not.toContain('$z');
    expect(r.run!({ L: [{ re: 1, im: 1 }, 2] })).toEqual([{ re: 2, im: 2 }, 4]);
  });

  it('id(x) := x over a complex argument, and over a string (non-numeric wide binding untouched)', () => {
    const ce = engineWith();
    ce.assign('id', ce.parse('x \\mapsto x'));
    const r = compile(ce.box(['id', 'z']), CX);
    expect(r.run!({ z: { re: 1, im: 2 } })).toEqual({ re: 1, im: 2 });
    const s = compile(
      ce.box(['Apply', ['Function', 'x', 'x'], { str: 'abc' }]),
      CX
    );
    expect(s.run!({})).toBe('abc');
    // A callback over a list<string>.
    ce.declare('S', 'list<string>');
    const m = compile(ce.box(['Map', ['Function', 'x', 'x'], 'S']), CX);
    expect(m.run!({ S: ['a', 'b'] as never })).toEqual(['a', 'b']);
    // A boolean pass-through.
    ce.declare('B', 'boolean');
    expect(compile(ce.box(['Not', 'B']), CX).run!({ B: true as never })).toBe(
      false
    );
  });

  it('a Block local first bound real then assigned complex computes (no decline in complex mode)', () => {
    const ce = engineWith();
    const r = compile(
      ce.box([
        'Block',
        ['Assign', 'k', 1],
        ['Assign', 'k', ['Add', 'k', ['Multiply', 2, 'ImaginaryUnit']]],
        ['Add', ['Abs', 'k'], 2],
      ]),
      { ...CX, constantFold: false }
    );
    expect(r.run!({})).toBeCloseTo(2 + Math.sqrt(5), 14);
    // …and the block-shadow case: a wide local shadowing an outer complex.
    const shadow = compile(ce.box(['Block', ['Assign', 'z', 7], 'z']), {
      ...CX,
      constantFold: false,
    });
    expect(shadow.run!({ z: { re: 1, im: 1 } })).toBe(7);
  });

  it("a wide-typed VALUE (element read, wide-result call, Max) is lifted at the parent's use", () => {
    // Review finding (2026-08-16): the analysis called these complex by their
    // wide TYPE while their emission handed back a bare number, so the
    // complex-lane parent read `.re` off a number (`{re: null}`).
    const ce = engineWith();
    ce.declare('N', 'list<number>');
    const at = compile(ce.box(['Add', ['At', 'N', 1], 'z']), {
      ...CX,
      constantFold: false,
    });
    expect(at.code).toContain('_SYS.cplx(_SYS.at(');
    expect(at.run!({ N: [1, 2], z: { re: 1, im: 1 } })).toEqual({
      re: 2,
      im: 1,
    });
    // A user function with a WIDE declared result over a real body.
    ce.declare('g', '(number) -> number');
    ce.assign('g', ce.box(['Function', 5, 'x']));
    const call = compile(ce.box(['Add', ['g', 'a'], 'z']), {
      ...CX,
      constantFold: false,
    });
    expect(call.run!({ a: 1, z: { re: 1, im: 1 } })).toEqual({ re: 6, im: 1 });
    // A real-only head (`Max`) over wide operands is real by construction:
    // the parent must NOT read `.re` off its number.
    const max = compile(ce.box(['Add', ['Max', 'a', 'u'], 'z']), CX);
    expect(max.run!({ a: 1, u: 2, z: { re: 1, im: 1 } })).toEqual({
      re: 3,
      im: 1,
    });
  });

  it('a selection over a wide arm is complex-shaped for its parent (arms decide, not the joined type)', () => {
    // Review round (2026-08-16): `Which(d < 0, a, True, 5)` over a wide `a`
    // types `finite_integer`; its arms are lifted to `{re, im}` but a parent
    // reading the TYPE consumed the object as a number.
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const w = compile(
      ce.box(['Add', ['Which', ['Less', 'd', 0], 'a', 'True', 5], 'z']),
      { ...CX, constantFold: false }
    );
    expect(w.run!({ d: -1, a: 2, z: { re: 1, im: 1 } })).toEqual({
      re: 3,
      im: 1,
    });
    expect(w.run!({ d: 1, a: 2, z: { re: 1, im: 1 } })).toEqual({
      re: 6,
      im: 1,
    });
    const f = compile(ce.box(['Add', ['If', ['Less', 'd', 0], 'a', 5], 'z']), {
      ...CX,
      constantFold: false,
    });
    expect(f.run!({ d: 1, a: 2, z: { re: 1, im: 1 } })).toEqual({
      re: 6,
      im: 1,
    });
  });

  it('Sum over a list<complex> symbol folds with the shape-agnostic combiner in every mode', () => {
    // Review round 3 (2026-08-16): a SYMBOL counted as "real by construction"
    // regardless of its element type, so `Sum(L)` for `L: list<complex>`
    // folded with the raw `+` and string-concatenated the objects.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<complex>');
    for (const mode of ['auto', 'complex', 'strict'] as const) {
      const r = compile(ce.box(['Sum', 'L']), { mode, fallback: false });
      expect(r.code).toContain('_SYS.sadd');
      expect(r.run!({ L: [{ re: 1, im: 1 }, 2] })).toEqual({ re: 3, im: 1 });
      expect(r.run!({ L: [1, 2] })).toBe(3);
    }
    // A `list<real>` symbol keeps the raw fold.
    ce.declare('R', 'list<real>');
    expect(compile(ce.box(['Sum', 'R']), { fallback: false }).code).toBe(
      '(_.R).reduce((_a, _b) => _a + _b, 0)'
    );
  });

  it("a decline raised before the mode latch reports strict/not-promoted, never a previous compilation's report", () => {
    // Review round 3 (2026-08-16): an `unsupported-mode` decline throws in
    // `resolveCompileMode` before the try/finally that freezes the report,
    // so the fallback result could carry the PREVIOUS compilation's
    // `mode: 'complex'`/`promoted: true`.
    const ce = new ComputeEngine();
    const prior = compile(ce.parse('\\sqrt{x}'), CX);
    expect(prior.mode).toBe('complex');
    expect(prior.promoted).toBe(true);
    const declined = compile(ce.parse('x + 1'), {
      to: 'glsl',
      mode: 'complex',
    });
    expect(declined.success).toBe(false);
    expect(declined.mode).toBe('strict');
    expect(declined.promoted).toBe(false);
  });

  it('Reduce over a complex list matches the interpreter', () => {
    const ce = engineWith();
    const r = compile(
      ce.box([
        'Reduce',
        'L',
        ['Function', ['Add', 'a', ['Multiply', 2, 'x']], 'a', 'x'],
        0,
      ]),
      CX
    );
    expect(
      r.run!({
        L: [
          { re: 1, im: 2 },
          { re: 0, im: 1 },
        ],
      })
    ).toEqual({
      re: 2,
      im: 6,
    });
  });
});

describe('complex mode — D2/D6 runtime rules', () => {
  const ce = new ComputeEngine();
  ce.declare('z', 'complex');

  it('a < 3 over a wide operand: true/false for reals, false for a complex value', () => {
    const r = compile(ce.parse('a < 3'), CX);
    expect(r.code).toContain('_SYS.cisreal');
    expect(r.run!({ a: 1 })).toBe(true);
    expect(r.run!({ a: 5 })).toBe(false);
    expect(r.run!({ a: { re: 1, im: 1 } })).toBe(false);
  });

  it('z < 2 for a complex-typed z: true at 1, false at i', () => {
    const r = compile(ce.parse('z < 2'), CX);
    expect(r.run!({ z: 1 })).toBe(true);
    expect(r.run!({ z: { re: 0, im: 1 } })).toBe(false);
  });

  it('a chain binds each operand once, edges included, in interpreter order', () => {
    // `number`-typed (wide but scalar) operands: a chain over `unknown`
    // symbols declines as possibly-collection in every mode.
    const e = new ComputeEngine();
    for (const n of ['p', 'q', 's']) e.declare(n, 'number');
    const r = compile(e.parse('p < q < s'), CX);
    expect(r.code).toContain('_SYS.cisreal');
    expect(r.run!({ p: 1, q: 2, s: 3 })).toBe(true);
    expect(r.run!({ p: 1, q: { re: 2, im: 1 }, s: 3 })).toBe(false);
    // Draw count: one draw per Random operand, at either edge.
    let draws = 0;
    const orig = e._random.bind(e);
    (e as unknown as { _random: () => number })._random = () => {
      draws += 1;
      return orig();
    };
    // `q = 1.5`: the first comparison holds, so the chain reaches the second
    // edge and draws again — two draws, one per `Random` operand.
    compile(e.box(['Less', ['Random'], 'q', ['Random']]), {
      ...CX,
      constantFold: false,
    }).run!({ q: 1.5 });
    expect(draws).toBe(2);
    // …and the chain short-circuits as the interpreter does: at `q = -1` the
    // first edge fails and the second `Random` is never drawn.
    draws = 0;
    compile(e.box(['Less', ['Random'], 'q', ['Random']]), {
      ...CX,
      constantFold: false,
    }).run!({ q: -1 });
    expect(draws).toBe(1);
  });

  it('y > √x compiles and yields false where x < 0, true where the radical is real and smaller', () => {
    const r = compile(ce.parse('y > \\sqrt{x}'), CX);
    expect(r.run!({ x: -1, y: 5 })).toBe(false);
    expect(r.run!({ x: 4, y: 5 })).toBe(true);
  });

  it('Floor/Mod/Max: the real lowering on a real value, NaN on a complex one', () => {
    expect(compile(ce.parse('\\lfloor a \\rfloor'), CX).run!({ a: 2.5 })).toBe(
      2
    );
    expect(
      compile(ce.parse('\\lfloor a \\rfloor'), CX).run!({ a: { re: 0, im: 1 } })
    ).toBeNaN();
    const mod = compile(ce.box(['Mod', 'z', 3]), CX);
    expect(mod.run!({ z: 7 })).toBe(1);
    expect(mod.run!({ z: { re: 0, im: 1 } })).toBeNaN();
    const max = compile(ce.box(['Max', 'a', 'b']), CX);
    expect(max.run!({ a: 1, b: 2 })).toBe(2);
    expect(max.run!({ a: { re: 1, im: 1 }, b: 2 })).toBeNaN();
  });

  it('D6: Erf(x) → erf(0.5) at 0.5, NaN at i (a complex-typed x)', () => {
    const r = compile(ce.box(['Erf', 'z']), CX);
    expect(r.run!({ z: 0.5 })).toBeCloseTo(0.5204998778130465, 12);
    expect(r.run!({ z: { re: 0, im: 1 } })).toBeNaN();
  });

  it('D6: a real-only string helper is REAL-shaped to its parent, whatever its result type', () => {
    // `Erf`, `Gamma`, `Zeta`, `Digamma`, `Factorial`, `LambertW`, `Arsinh`,
    // `ErfInv` all lower to a real-only helper (`_SYS.erf`, …) yet type wide
    // (`number`), so the type-based analysis used to fall through to the
    // operand recursion and report them complex when an operand was — here a
    // promoted unknown-sign radical. The parent `Multiply` then read
    // `.re`/`.im` off the plain number the guard emitted: `2·Erf(√y)` ran to
    // `{re: NaN, im: NaN}` at every point (measured 2026-08-16, `auto` and
    // `complex` modes alike). The value must be the plain real product.
    for (const mode of ['auto', 'complex'] as const) {
      for (const h of ['Erf', 'Gamma', 'Arsinh'] as const) {
        const e = ce.box(['Multiply', 2, [h, ['Sqrt', 'y']]]);
        const r = compile(e, { mode, fallback: false });
        // Reference: the interpreter's own value at y = 2.
        const ref = e.subs({ y: 2 }).N().re;
        expect(r.run!({ y: 2 })).toBeCloseTo(ref, 6);
        // …and the D6 rule still applies underneath: a negative radicand
        // promotes to a non-real value, so the helper answers NaN.
        expect(r.run!({ y: -2 })).toBeNaN();
      }
    }
  });

  it('a statically non-real operand is a compile-time capability decline in every mode', () => {
    for (const mode of ['strict', 'auto', 'complex'] as const) {
      for (const expr of [
        ce.parse('i < 2'),
        ce.box(['Floor', ['Complex', 0, 2]]),
        ce.box(['Erf', ['Multiply', 2, 'ImaginaryUnit']]),
      ]) {
        const r = compile(expr, { mode, constantFold: false });
        expect(r.success).toBe(false);
        expect(r.diagnostic?.kind).toBe('capability');
      }
    }
    // Complex mode names the operand.
    let caught: unknown;
    try {
      compile(ce.parse('i < 2'), { ...CX, constantFold: false });
    } catch (e) {
      caught = e;
    }
    expect(isCompileDeclineError(caught)).toBe(true);
    expect((caught as { diagnostic: { code: string } }).diagnostic.code).toBe(
      'non-real-operand'
    );
  });

  it('the guard is emitted where the head is lowered: an unselected arm evaluates nothing', () => {
    // `And(False, Random() < z)` draws nothing.
    const e = new ComputeEngine();
    e.declare('z', 'complex');
    let draws = 0;
    const r = compile(e.box(['And', 'False', ['Less', ['Random'], 'z']]), {
      ...CX,
      constantFold: false,
    });
    const orig = e._random.bind(e);
    (e as unknown as { _random: () => number })._random = () => {
      draws += 1;
      return orig();
    };
    expect(r.run!({ z: 2 })).toBe(false);
    expect(draws).toBe(0);
    // `Or(True, i < 2)` still declines at compile time (no reachability
    // reasoning).
    expect(
      compile(e.box(['Or', 'True', ['Less', 'ImaginaryUnit', 2]]), {
        mode: 'complex',
        constantFold: false,
      }).success
    ).toBe(false);
  });

  it('a chain evaluates a later operand only when the earlier edges hold (short-circuit order)', () => {
    // Review finding (2026-08-16): binding every operand of a chain eagerly
    // drew a promoted `Random` in the third position even when the first
    // edge already failed. `5 < 1 < √(Random() − 1)`: the first edge fails,
    // so the radical is never evaluated and nothing is drawn.
    const e = new ComputeEngine();
    let draws = 0;
    const orig = e._random.bind(e);
    (e as unknown as { _random: () => number })._random = () => {
      draws += 1;
      return orig();
    };
    const r = compile(
      e.box(['Less', 5, 1, ['Sqrt', ['Subtract', ['Random'], 1]]]),
      { ...CX, constantFold: false }
    );
    expect(r.run!({})).toBe(false);
    expect(draws).toBe(0);
  });

  it('the same operand INSTANCE in two positions of a guarded head is bound once', () => {
    // Review finding (2026-08-16): `Max(e, e)` with one shared node bound it
    // twice (two temporaries, one orphaned) and evaluated an impure `e` twice.
    const e = new ComputeEngine();
    let draws = 0;
    const orig = e._random.bind(e);
    (e as unknown as { _random: () => number })._random = () => {
      draws += 1;
      return orig();
    };
    const shared = e.box(['Sqrt', ['Subtract', ['Random'], 1]]);
    const r = compile(e.box(['Max', shared, shared]), {
      ...CX,
      constantFold: false,
    });
    r.run!({});
    expect(draws).toBe(1);
  });

  it('the Python target emits its own syntax for the runtime rule and passes non-numbers through the lift', () => {
    const e = new ComputeEngine();
    const r = compile(e.box(['Less', ['Floor', 'a'], 2]), {
      mode: 'complex',
      to: 'python',
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain("else float('nan')");
    expect(r.code).toContain('_ce_cplx(a)');
    expect(r.code).not.toContain('?');
    expect(r.code).not.toContain('&&');
    // The lift helper leaves a bool, a string or a list untouched.
    expect(r.code).toContain('not isinstance(_v, bool) else _v');
  });

  it('D8: √(Random() − 1) < 2 draws once per call; 2·√(Random() − 1) lifts one bound draw', () => {
    const e = new ComputeEngine();
    let draws = 0;
    const orig = e._random.bind(e);
    (e as unknown as { _random: () => number })._random = () => {
      draws += 1;
      return orig();
    };
    const r = compile(
      e.box(['Less', ['Sqrt', ['Subtract', ['Random'], 1]], 2]),
      {
        ...CX,
        constantFold: false,
      }
    );
    r.run!({});
    expect(draws).toBe(1);
    draws = 0;
    const m = compile(
      e.box(['Multiply', 2, ['Sqrt', ['Subtract', ['Random'], 1]]]),
      { ...CX, constantFold: false }
    );
    m.run!({});
    expect(draws).toBe(1);
  });
});
