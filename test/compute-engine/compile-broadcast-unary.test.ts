/**
 * Element-wise broadcast of a `broadcastable` head over a collection operand,
 * across the four compile targets.
 *
 * Two defects are pinned here:
 *
 *  A. The unary fan-out used to be a hardcoded JavaScript `.map((v) => …)`
 *     arrow emitted into EVERY target — `sin(vec4(…)).map(…)` for GLSL/WGSL,
 *     `([1,2,3]).map(…)` for Python — behind `success: true`. It is now
 *     target-mediated (`CompileTarget.broadcastUnary`): the shader targets do
 *     not fan out at all (their builtins are componentwise on a `vecN`),
 *     Python emits a list comprehension, and a target with no such lowering
 *     fails closed (D6).
 *
 *  B. A *string*-mapped broadcastable head (`Sign` → `Math.sign`, `Arctan2` →
 *     `Math.atan2`, `Hypot` → `Math.hypot`) used to fail closed on the
 *     JavaScript target because it had no array codegen. It now broadcasts
 *     through the same `_SYS.bcast` closure, wrapping the scalar CALL.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A fresh engine: these declarations must not leak into (or inherit from) the
// shared test engine.
const ce = new ComputeEngine();
ce.declare('L', 'list<number>');
ce.declare('Z', 'list<complex>');

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();
const python = new PythonTarget();
const intervalJs = new IntervalJavaScriptTarget();

const g = (expr: any): string => glsl.compile(ce.box(expr)).code!;
const w = (expr: any): string => wgsl.compile(ce.box(expr)).code!;
const p = (expr: any): string => python.compile(ce.box(expr)).code!;

describe('BROADCAST UNARY OVER A COLLECTION — four-target matrix', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  describe('GLSL / WGSL — componentwise, no fan-out', () => {
    it('applies a builtin directly to a static vec4 operand', () => {
      expect(g(['Sin', ['List', 1, 2, 3, 4]])).toBe(
        'sin(vec4(1.0, 2.0, 3.0, 4.0))'
      );
      expect(w(['Sin', ['List', 1, 2, 3, 4]])).toBe(
        'sin(vec4f(1.0, 2.0, 3.0, 4.0))'
      );
    });

    it('applies a prefix operator directly to a static vec4 operand', () => {
      expect(g(['Negate', ['List', 1, 2, 3, 4]])).toBe(
        '(-vec4(1.0, 2.0, 3.0, 4.0))'
      );
      expect(w(['Negate', ['List', 1, 2, 3, 4]])).toBe(
        '(-vec4f(1.0, 2.0, 3.0, 4.0))'
      );
    });

    it('emits no JavaScript artifacts (`.map`, `=>`, `_SYS.`)', () => {
      for (const code of [
        g(['Sin', ['List', 1, 2, 3, 4]]),
        w(['Sin', ['List', 1, 2, 3, 4]]),
        g(['Negate', ['List', 1, 2]]),
        w(['Negate', ['List', 1, 2]]),
      ]) {
        expect(code).not.toContain('.map(');
        expect(code).not.toContain('=>');
        expect(code).not.toContain('_SYS.');
      }
    });

    it('fails closed on a 5-element list (no vecN shape)', () => {
      expect(() => g(['Sin', ['List', 1, 2, 3, 4, 5]])).toThrow(
        /no static vec2–vec4 shape/
      );
      expect(() => w(['Sin', ['List', 1, 2, 3, 4, 5]])).toThrow(
        /no static vec2–vec4 shape/
      );
    });

    it('fails closed on a nested list (no scalar components)', () => {
      const m = ['Sin', ['List', ['List', 1, 2], ['List', 3, 4]]];
      expect(() => g(m)).toThrow(/has no GPU lowering/);
      expect(() => w(m)).toThrow(/has no GPU lowering/);
    });

    it('fails closed when the scalar lowering calls a scalar-only preamble helper', () => {
      // `_gpu_sinc` / `_gpu_gamma` are declared `float _gpu_…(float)`, so
      // handing them a `vecN` is source no driver accepts.
      expect(() => g(['Sinc', ['List', 1, 2, 3]])).toThrow(
        /not componentwise.*preamble helper/s
      );
      expect(() => w(['Gamma', ['List', 1, 2, 3]])).toThrow(
        /not componentwise.*preamble helper/s
      );
    });

    it('fails closed when the scalar lowering branches on a comparison', () => {
      // `Argument(x)` lowers to `((x >= 0.0) ? 0.0 : π)`; GLSL has no
      // `vecN >= float` and needs a scalar bool condition.
      expect(() => g(['Argument', ['List', 1, 2, 3]])).toThrow(
        /not componentwise/
      );
      expect(() => w(['Argument', ['List', 1, 2, 3]])).toThrow(
        /not componentwise/
      );
    });

    it('fails closed when the scalar lowering drops the operand', () => {
      // `Imaginary(x)` of a real `x` folds to `0.0` — a scalar where the
      // caller is owed a `vecN`.
      expect(() => g(['Imaginary', ['List', 1, 2, 3]])).toThrow(
        /not componentwise.*does not use the operand/s
      );
    });

    it('fails closed on a complex-valued list (a vec2 of re/im, not cells)', () => {
      expect(() =>
        g(['Sin', ['List', ['Complex', 1, 2], ['Complex', 3, 4]]])
      ).toThrow(/complex-valued operand/);
      expect(() =>
        w(['Sin', ['List', ['Complex', 1, 2], ['Complex', 3, 4]]])
      ).toThrow(/complex-valued operand/);
    });
  });

  describe('Python — list comprehension', () => {
    it('fans out with a comprehension, not `.map`', () => {
      const code = p(['Sin', ['List', 1, 2, 3, 4]]);
      expect(code).toBe('[np.sin(_tv1) for _tv1 in [1, 2, 3, 4]]');
      expect(code).not.toContain('.map(');
      expect(code).not.toContain('=>');
      expect(code).not.toContain('_SYS.');
    });

    it('is not limited to a vecN width (a 5-element list compiles)', () => {
      expect(p(['Sin', ['List', 1, 2, 3, 4, 5]])).toBe(
        '[np.sin(_tv1) for _tv1 in [1, 2, 3, 4, 5]]'
      );
    });

    it('the element variable compiles bare, not as a vars lookup', () => {
      const code = p(['Sqrt', ['List', 1, 4, 9]]);
      expect(code).toBe('[np.sqrt(_tv1) for _tv1 in [1, 4, 9]]');
      expect(code).not.toContain('_.');
    });

    it('fans out an OPERATOR-lowered unary head (`Negate`) too', () => {
      // The collection-arithmetic guard used to reject every arithmetic head
      // with a collection operand before function dispatch, so the fan-out was
      // unreachable for exactly this shape. `[(-(x)) for x in […]]` is valid
      // Python and evaluates to `[-1, -2, -3]` — element-wise for a plain list
      // as well as for an ndarray.
      const code = p(['Negate', ['List', 1, 2, 3]]);
      expect(code).toBe('[(-(_tv1)) for _tv1 in [1, 2, 3]]');
      expect(code).not.toContain('.map(');
      expect(code).not.toContain('=>');
    });

    it('leaves scalar `Negate` on the prefix-operator path', () => {
      expect(p(['Negate', 'x'])).toBe('-x');
    });

    it('parenthesizes the operand of the `Negate` element lowering', () => {
      // Python's unary `-` binds tighter than `+`, and the function-codegen
      // path is precedence-blind, so an unparenthesized operand would emit
      // `-w + 1` — sign-wrong — for `-(w + 1)`.
      ce.declare('W', 'complex');
      expect(p(['Negate', ['Add', 'W', 1]])).toBe('(-(W + 1))');
    });

    it('still fails closed on the shapes the unary hook cannot express', () => {
      // Binary/n-ary arithmetic over collections: Python's infix operators
      // repeat/concatenate a list instead of broadcasting.
      expect(() => p(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
      expect(() => p(['Multiply', 2, ['List', 1, 2, 3]])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
      expect(() => p(['Power', ['List', 1, 2, 3], 2])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
      // A merely collection-TYPED operand: the artifact cannot constrain what
      // the caller binds, so it stays closed even for the unary head.
      expect(() => p(['Negate', 'L'])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
    });
  });

  describe('JavaScript — unchanged `_SYS.bcast`', () => {
    it('broadcasts a unary head through the runtime helper', () => {
      const r = compile(ce.box(['Sin', ['List', 1, 2, 3, 4]]));
      expect(r.success).toBe(true);
      expect(r.code).toBe('_SYS.bcast((_tv1) => Math.sin(_tv1), [1, 2, 3, 4])');
      expect(r.code).not.toContain('.map(');
    });

    it('broadcasts a prefix operator through the runtime helper', () => {
      const r = compile(ce.box(['Negate', ['List', 1, 2, 3, 4]]));
      expect(r.success).toBe(true);
      expect(r.run!({})).toEqual([-1, -2, -3, -4]);
    });

    it('a complex-element list fails closed (D6), never scalar garbage', () => {
      // `Math.sin({re, im})` is NaN. The broadcast closure documents the
      // complex deferral; the fan-out used to defeat it via `.map`.
      const r = compile(ce.box(['Sin', 'Z']));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/list-valued operand/);
    });
  });

  describe('interval-js — declines, as before', () => {
    it('reports a clean failure, not invalid source', () => {
      const r = intervalJs.compile(ce.box(['Sin', ['List', 1, 2, 3, 4]]));
      expect(r.success).toBe(false);
      expect(r.code ?? '').not.toContain('.map(');
    });
  });
});

describe('BROADCAST OF A STRING-MAPPED HEAD (JavaScript)', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  it('Sign broadcasts over a concrete list', () => {
    const r = compile(ce.box(['Sign', ['List', 3, -4, 0]]));
    expect(r.success).toBe(true);
    expect(r.code).toBe('_SYS.bcast((_tv1) => Math.sign(_tv1), [3, -4, 0])');
    expect(r.run!({})).toEqual([1, -1, 0]);
  });

  it('Sign broadcasts over a list-typed parameter', () => {
    const r = compile(ce.box(['Sign', 'L']));
    expect(r.success).toBe(true);
    expect(r.run!({ L: [3, -4, 0] })).toEqual([1, -1, 0]);
  });

  it('Arctan2 broadcasts n-ary, zipping the scalar operand', () => {
    const r = compile(ce.box(['Arctan2', ['List', 1, 2, 3], 1]));
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '_SYS.bcast((_tv1, _tv2) => Math.atan2(_tv1, _tv2), [1, 2, 3], 1)'
    );
    const out = r.run!({}) as unknown as number[];
    expect(out).toHaveLength(3);
    out.forEach((v, i) => expect(v).toBeCloseTo(Math.atan2(i + 1, 1), 12));
  });

  it('Hypot broadcasts n-ary', () => {
    const r = compile(ce.box(['Hypot', ['List', 3, 6], 4]));
    expect(r.success).toBe(true);
    const out = r.run!({}) as unknown as number[];
    expect(out[0]).toBeCloseTo(5, 12);
    expect(out[1]).toBeCloseTo(Math.hypot(6, 4), 12);
  });

  it('a string-mapped head over a COMPLEX list still fails closed', () => {
    const r = compile(ce.box(['Sign', 'Z']));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/list-valued operand/);
  });
});
