import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * The COMPLEX compile discipline and its runtime rules
 * (`docs/COMPILATION-MODEL.md`).
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
    expect(r.run!({ a: -2 })).toBe(-3);
    expect(r.run!({ a: { re: 1, im: 1 } })).toEqual({ re: 3, im: 2 });
    expect(r.mode).toBe('complex');
  });

  it('√a promotes: {re: 0, im: 1.414…} at a = −2, the number 2 at a = 4', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{a}'), CX);
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

  it('a boolean result is never coerced', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(compile(ce.parse('x < 3'), CX).run!({ x: 1 })).toBe(true);
    expect(compile(ce.parse('x < 3'), CX).run!({ x: 5 })).toBe(false);
  });
});

describe('complex mode — one emission per user function, lift at use (design §3)', () => {
  function engineWith(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('a', 'number');
    ce.declare('z', 'complex');
    ce.declare('L', 'list<complex>');
    ce.assign('b', ce.parse('x \\mapsto 2x'));
    ce.assign('c', ce.box(['Function', ['Add', 'x', 1], p('x', 'complex')]));
    return ce;
  }

  it('b(a) over a parameter typed any declines; over a list<real> it maps', () => {
    const ce = engineWith();
    // A parameter `a` declared `any` (possibly a collection) does not settle
    // the shape of the argument of the call, so the compilation declines.
    // (An INPUT `a` with no type is refused, ROADMAP CE-712.1, so the
    // decline is read on a parameter of the root function.)
    const ba = compile(
      ce.box(['Function', ['b', 'a'], ['Typed', 'a', "'any'"]]),
      { mode: 'complex' }
    );
    expect(ba.success).toBe(false);
    expect(ba.diagnostic?.code).toBe('unsettled-shape');
    // A parameter declared `list<real>` maps `b` over the list.
    const list = new ComputeEngine();
    list.assign('b', list.parse('x \\mapsto 2x'));
    const bl = compile(
      list.box(['Function', ['b', 'a'], ['Typed', 'a', { str: 'list<real>' }]]),
      CX
    );
    const runA = bl.run as unknown as (a: unknown) => unknown;
    expect(runA([1, -2])).toEqual([2, -4]);
  });

  it('a declared-complex parameter is coerced as before', () => {
    const ce = engineWith();
    const r = compile(ce.parse('c(a)'), CX);
    expect(r.run!({ a: 2 })).toBe(3);
    expect(r.run!({ a: { re: 1, im: 1 } })).toEqual({ re: 2, im: 1 });
  });

  it('a selection over a wide arm is complex-shaped for its parent (arms decide, not the joined type)', () => {
    // Review round (2026-08-16): `Which(d < 0, a, True, 5)` over a wide `a`
    // types `integer`; its arms are lifted to `{re, im}` but a parent
    // reading the TYPE consumed the object as a number.
    const ce = new ComputeEngine();
    ce.declare('d', 'real');
    ce.declare('a', 'number');
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
});

describe('complex mode — D2/D6 runtime rules', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');
  ce.declare('z', 'complex');

  // The ELEMENT-WISE form of the runtime rule (`docs/COMPILATION-MODEL.md`,
  // "Compile modes"): a real-only head over an ARRAY operand whose elements
  // may be complex projects each operand element-wise — an exactly-real
  // element as its real part, every other element as NaN — and runs its real
  // lowering over the projections. Before it, such an operand fell back to
  // the fail-closed decline (Tycho item 251), and an ORDERING over such an
  // operand broadcast a raw `<` over `{re, im}` roots behind `success: true`.
  describe('the element-wise form over an array operand', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<real>');
    e.declare('Z', 'list<complex>');
    e.declare('w', 'complex');

    it('in strict mode nothing changes: the promoted forms use the real kernel, a list<complex> fails closed', () => {
      const STRICT = { mode: 'strict', fallback: false } as const;
      // No promotion in strict mode: `√L` is the real kernel, so the head is
      // not guarded at all and a negative element is NaN from `Math.sqrt`.
      const floor = compile(e.box(['Floor', ['Sqrt', 'L']]), STRICT);
      expect(floor.code).not.toContain('_SYS.crealElements(');
      expect(floor.run!({ L: [4, -1] })).toEqual([2, NaN]);
      for (const expr of [e.parse('Z < 2'), e.box(['Min', 'Z'])]) {
        const r = compile(expr, { mode: 'strict' });
        expect(r.success).toBe(false);
      }
    });
  });
});

describe('complex mode — a power of real operands with a wide result type', () => {
  // `(-1)^{k/2}` and `x^y` over real operands type `number`, so the complex
  // discipline reads the node as complex and the parent reads `.re`/`.im`
  // off it. The emitter took the real `_SYS.pow` and handed that parent a
  // plain number, so `x + (-1)^{k/2}` was `{re: NaN}` at every point. The
  // emitter now takes the complex kernel `_SYS.cpow` in the same case.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('k', 'integer');
    return ce;
  }

  const POINTS = [
    { x: 0.5, y: 0.3, k: 1 },
    { x: -0.7, y: 1.3, k: 3 },
    { x: 2, y: -0.5, k: 4 },
  ];

  const LATEX = [
    'x + (-1)^{k/2}',
    '(-1)^{k/2}',
    'x + (-2)^{x}',
    'x^y + 1',
    '\\sum_{n=0}^{2} (x + (-1)^{n/2})',
  ];

  for (const latex of LATEX)
    it(`${latex} agrees with the interpreter`, () => {
      const ce = engine();
      const expr = ce.parse(latex);
      const r = compile(expr, CX);
      expect(r.success).toBe(true);
      expect(r.code).not.toContain('_SYS.pow(');
      for (const vars of POINTS) {
        const expected = expr.subs(vars).N();
        const value = r.run!(vars) as number | { re: number; im: number };
        const re = typeof value === 'number' ? value : value.re;
        const im = typeof value === 'number' ? 0 : value.im;
        expect(re).toBeCloseTo(expected.re, 12);
        expect(im).toBeCloseTo(expected.im, 12);
      }
    });

  // The term of an unrolled `Sum` folds to a real constant under its index
  // values (`(n-1)^{n/2}` is 1, 0, 1 at n = 0, 1, 2), so the parent reads the
  // `Power` as a plain number. The emitter must then not take `_SYS.cpow`:
  // with it, `x + (n-1)^{n/2}` concatenated strings and `x(n-1)^{n/2}` was
  // `null`. The first two expressions fold whole at compile time; the others
  // keep `x` free, so the term is emitted.
  const UNROLLED = [
    '\\sum_{n=0}^{2}(n-1)^{n/2}',
    'x + \\sum_{n=0}^{2}(n-1)^{n/2}',
    '\\sum_{n=0}^{2}(x + (n-1)^{n/2})',
    '\\sum_{n=0}^{2}x(n-1)^{n/2}',
    '\\sum_{n=0}^{2}((n-1)^{n/2} + x^n)',
  ];

  for (const latex of UNROLLED)
    it(`${latex}: an unrolled term that folds to a real agrees with the interpreter`, () => {
      const ce = engine();
      const expr = ce.parse(latex);
      const r = compile(expr, CX);
      expect(r.success).toBe(true);
      for (const vars of POINTS) {
        const expected = expr.subs(vars).N();
        expect(r.run!(vars)).toBeCloseTo(expected.re, 12);
        expect(expected.im).toBe(0);
      }
    });

  it('x + (-1)^{k/2} is 0.5 + i at x = 0.5, k = 1', () => {
    const r = compile(engine().parse('x + (-1)^{k/2}'), CX);
    expect(r.run!({ x: 0.5, k: 1 })).toEqual({ re: 0.5, im: 1 });
  });
});
