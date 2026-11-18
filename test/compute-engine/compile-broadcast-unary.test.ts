/**
 * Element-wise broadcast of a `broadcastable` head over a collection operand,
 * across the four compile targets.
 *
 * Two defects are pinned here:
 *
 *  A. The unary fan-out used to be a hardcoded JavaScript `.map((v) => …)`
 *     arrow emitted into EVERY target — `sin(vec4(…)).map(…)` for GLSL —
 *     behind `success: true`. It is now target-mediated
 *     (`CompileTarget.broadcastUnary`): the shader targets do not fan out at
 *     all (their builtins are componentwise on a `vecN`), and a target with
 *     no such lowering fails closed.
 *
 *  B. A *string*-mapped broadcastable head (`Sign` → `Math.sign`, `Arctan2` →
 *     `Math.atan2`, `Hypot` → `Math.hypot`) used to fail closed on the
 *     JavaScript target because it had no array codegen. It now broadcasts
 *     through the same `_SYS.bcast` closure, wrapping the scalar CALL.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** `compile()` to `interval-js`, called as a target's `compile()` is. */
const intervalCompile = (expr: any, options: Record<string, unknown> = {}) =>
  compile(expr, { ...options, to: 'interval-js' } as any) as any;

// A fresh engine: these declarations must not leak into (or inherit from) the
// shared test engine.
const ce = new ComputeEngine();
ce.declare('L', 'list<number>');
ce.declare('Z', 'list<complex>');
// A SET-typed operand: it matches neither `list<any>` nor
// `indexed_collection<any>`, so a guard written with those spellings lets it
// through — `Add(SN, 1)` emitted `SN + 1` on both scalar-infix targets where
// the interpreter answers an `incompatible-type` error. The guards now test
// the collection shape top (`collection<any>`).
ce.declare('SN', 'set<number>');

const glsl = new GLSLTarget();
const intervalJs = { compile: intervalCompile };

// `constantFold: false` throughout: what is under test is the LOWERING of a
// broadcast unary head over a collection — the emitted source and, for the
// shapes with no componentwise lowering, the fail-closed diagnostic. Every
// probe below uses a literal list operand, so compile-time constant folding
// would evaluate the whole subtree and emit a literal (`vec4(0.841…, …)`)
// instead, short-circuiting the very code path being pinned.
const g = (expr: any): string =>
  glsl.compile(ce.box(expr), { constantFold: false }).code!;

describe('BROADCAST UNARY OVER A COLLECTION — three-target matrix', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  describe('GLSL — componentwise, no fan-out', () => {
    it('applies a builtin directly to a static vec4 operand', () => {
      expect(g(['Sin', ['List', 1, 2, 3, 4]])).toBe(
        'sin(vec4(1.0, 2.0, 3.0, 4.0))'
      );
    });

    it('applies a prefix operator directly to a static vec4 operand', () => {
      expect(g(['Negate', ['List', 1, 2, 3, 4]])).toBe(
        '(-(vec4(1.0, 2.0, 3.0, 4.0)))'
      );
    });

    it('emits no JavaScript artifacts (`.map`, `=>`, `_SYS.`)', () => {
      for (const code of [
        g(['Sin', ['List', 1, 2, 3, 4]]),
        g(['Negate', ['List', 1, 2]]),
      ]) {
        expect(code).not.toContain('.map(');
        expect(code).not.toContain('=>');
        expect(code).not.toContain('_SYS.');
      }
    });

    it('fails closed on a 5-element list (no vecN shape)', () => {
      expect(() => g(['Sin', ['List', 1, 2, 3, 4, 5]])).toThrow(
        /No signature of `Sin` in the GLSL fragment takes operands of the types \(list<real, 5>\)/
      );
    });

    it('fails closed on a nested list (no scalar components)', () => {
      // A nested list lowers as an ARRAY of vectors, which has no static
      // vec2–vec4 shape for a componentwise call.
      const m = ['Sin', ['List', ['List', 1, 2], ['List', 3, 4]]];
      expect(() => g(m)).toThrow(
        /is not a list of reals or of points of one size/
      );
    });

    it('fails closed when the scalar lowering calls a scalar-only preamble helper', () => {
      // `_gpu_sinc` / `_gpu_gamma` are declared `float _gpu_…(float)`, so
      // handing them a `vecN` is source no driver accepts.
      expect(() => g(['Sinc', ['List', 1, 2, 3]])).toThrow(
        /No signature of `Sinc` in the GLSL fragment takes operands of the types \(list<real, 3>\)/
      );
    });

    it('fails closed when the scalar lowering branches on a comparison', () => {
      // `Argument(x)` lowers to `((x >= 0.0) ? 0.0 : π)`; GLSL has no
      // `vecN >= float` and needs a scalar bool condition.
      expect(() => g(['Argument', ['List', 1, 2, 3]])).toThrow(
        /No signature of `Argument` in the GLSL fragment takes operands of the types \(list<real, 3>\)/
      );
    });

    it('fails closed when the scalar lowering drops the operand', () => {
      // `Imaginary(x)` of a real `x` folds to `0.0` — a scalar where the
      // caller is owed a `vecN`.
      expect(() => g(['Imaginary', ['List', 1, 2, 3]])).toThrow(
        /No signature of `Imaginary` in the GLSL fragment takes operands of the types \(list<real, 3>\)/
      );
    });

    it('fails closed on a complex-valued list (a vec2 of re/im, not cells)', () => {
      expect(() =>
        g(['Sin', ['List', ['Complex', 1, 2], ['Complex', 3, 4]]])
      ).toThrow(/is not a list of reals or of points of one size/);
    });
  });

  it('a set-typed operand fails closed on the JavaScript target', () => {
    // The JavaScript scalar-infix gate read only the list/indexed shapes, so
    // a set escaped it (`_.SN + 1`, string concatenation or garbage at run
    // time). The gate reads the collection shape top.
    expect(() =>
      compile(ce.box(['Add', 'SN', 1]), {
        constantFold: false,
        fallback: false,
      })
    ).toThrow(/scalar arithmetic over a list-valued operand/);
  });

  describe('JavaScript — the element-wise lanes, never `.map`', () => {
    // `constantFold: false`: the operand is a literal list, so compile-time
    // folding would answer the whole expression from the interpreter and emit
    // a literal array instead of the element-wise lowering under test.
    it('emits one expression per component when the width is known', () => {
      // A literal list is read component by component from its own text: no
      // temporary is bound only to be indexed.
      const r = compile(ce.box(['Sin', ['List', 1, 2, 3, 4]]), {
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.code).toBe(
        '[Math.sin(1), Math.sin(2), Math.sin(3), Math.sin(4)]'
      );
      expect(r.code).not.toContain('.map(');
    });

    it('broadcasts a prefix operator through the runtime helper', () => {
      const r = compile(ce.box(['Negate', ['List', 1, 2, 3, 4]]), {
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.run!({})).toEqual([-1, -2, -3, -4]);
    });

    it('a complex-element list takes the complex lowering, never scalar garbage', () => {
      // `Math.sin({re, im})` is NaN. A `list<complex>` may hold a plain
      // number beside a `{re, im}` object, so the closure reads each cell
      // through `_SYS.cplx` and applies the complex sine. This shape failed
      // closed until the closure could read such a cell.
      const r = compile(ce.box(['Sin', 'Z']));
      expect(r.success).toBe(true);
      expect(r.code).toBe(
        '_SYS.bcast((_tv1) => _SYS.csin(_SYS.cplx(_tv1)), _.Z)'
      );
      const out = r.run!({ Z: [{ re: 1, im: 2 }, 3] }) as unknown as [
        { re: number; im: number },
        number,
      ];
      // sin(1 + 2i) = sin 1·cosh 2 + i·cos 1·sinh 2
      expect(out[0].re).toBeCloseTo(Math.sin(1) * Math.cosh(2), 12);
      expect(out[0].im).toBeCloseTo(Math.cos(1) * Math.sinh(2), 12);
      expect(out[1]).toBeCloseTo(Math.sin(3), 12);
    });
  });

  describe('interval-js — maps element-wise through its own runtime', () => {
    it('emits the interval broadcast, never a JavaScript `.map` arrow', () => {
      // The target's `broadcastUnary` hook spells the literal as an array of
      // point intervals and maps the kernel with `_IA.bcast`
      // (`compile-interval-collections.test.ts`); a list with no interval
      // reading still reports a clean failure.
      const r = intervalJs.compile(ce.box(['Sin', ['List', 1, 2, 3, 4]]));
      expect(r.success).toBe(true);
      expect(r.code).not.toContain('.map(');
      const out = r.run!({}) as any[];
      // Each element is an enclosure of the sine, a few ulps wide.
      out.forEach((v, i) => {
        expect(v.value.lo).toBeLessThanOrEqual(Math.sin(i + 1));
        expect(v.value.hi).toBeGreaterThanOrEqual(Math.sin(i + 1));
        expect(v.value.hi - v.value.lo).toBeLessThan(1e-12);
      });
      const declined = intervalJs.compile(
        ce.box(['Sin', ['List', "'a'", "'b'"]])
      );
      expect(declined.success).toBe(false);
      expect(declined.code ?? '').not.toContain('.map(');
    });
  });
});

describe('BROADCAST OF A STRING-MAPPED HEAD (JavaScript)', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  // `constantFold: false` on the concrete-list probes below: their operands
  // are all literal, so compile-time folding would emit the evaluated array
  // and never exercise the element-wise wrapping of the scalar CALL, which is
  // the defect these tests pin.
  it('Sign broadcasts over a concrete list', () => {
    const r = compile(ce.box(['Sign', ['List', 3, -4, 0]]), {
      constantFold: false,
    });
    expect(r.success).toBe(true);
    // The element source `-4` is parenthesized before it is spliced into the
    // head's scalar codegen: a negative literal is not a primary expression
    // everywhere the same splice runs, so the wrap is applied to every
    // non-atomic element.
    expect(r.code).toBe('[Math.sign(3), Math.sign((-4)), Math.sign(0)]');
    expect(r.run!({})).toEqual([1, -1, 0]);
  });

  it('Sign broadcasts over a list-typed parameter', () => {
    const r = compile(ce.box(['Sign', 'L']));
    expect(r.success).toBe(true);
    expect(r.run!({ L: [3, -4, 0] })).toEqual([1, -1, 0]);
  });

  it('Arctan2 broadcasts n-ary, zipping the scalar operand', () => {
    const r = compile(ce.box(['Arctan2', ['List', 1, 2, 3], 1]), {
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '[Math.atan2(1, 1), Math.atan2(2, 1), Math.atan2(3, 1)]'
    );
    const out = r.run!({}) as unknown as number[];
    expect(out).toHaveLength(3);
    out.forEach((v, i) => expect(v).toBeCloseTo(Math.atan2(i + 1, 1), 12));
  });

  it('Hypot broadcasts n-ary', () => {
    const r = compile(ce.box(['Hypot', ['List', 3, 6], 4]), {
      constantFold: false,
    });
    expect(r.success).toBe(true);
    const out = r.run!({}) as unknown as number[];
    expect(out[0]).toBeCloseTo(5, 12);
    expect(out[1]).toBeCloseTo(Math.hypot(6, 4), 12);
  });

  it('a string-mapped head over a COMPLEX list answers NaN at a complex cell', () => {
    // `Math.hypot` has no complex form. Its operand is projected onto the
    // real numbers first, so a complex cell is NaN and a real cell is read.
    const r = compile(ce.box(['Hypot', 'Z', 4]), { mode: 'complex' });
    expect(r.success).toBe(true);
    const out = r.run!({ Z: [{ re: 3, im: 4 }, 3] }) as unknown as number[];
    expect(out[0]).toBeNaN();
    expect(out[1]).toBe(5);
  });

  it('`Sign` over a COMPLEX list takes its complex lowering', () => {
    // `Sign` has a complex form (`z / |z|`), and reads a cell that may be a
    // plain number through `_SYS.cplx`.
    const r = compile(ce.box(['Sign', 'Z']));
    expect(r.success).toBe(true);
    const out = r.run!({ Z: [{ re: 3, im: 4 }, -2, 0] }) as unknown[];
    expect(out).toEqual([{ re: 0.6, im: 0.8 }, -1, 0]);
  });
});
