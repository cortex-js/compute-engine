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
// A collection whose elements are not scalars, and an operand that is only
// possibly a collection: the two shapes the Python fan-out must still refuse.
ce.declare('M', 'matrix<2x2>');
ce.declare('B', 'broadcastable<number>');
// A SET-typed operand: it matches neither `list<any>` nor
// `indexed_collection<any>`, so a guard written with those spellings lets it
// through — `Add(SN, 1)` emitted `SN + 1` on both scalar-infix targets where
// the interpreter answers an `incompatible-type` error. The guards now test
// the collection shape top (`collection<any>`).
ce.declare('SN', 'set<number>');

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();
const python = new PythonTarget();
const intervalJs = new IntervalJavaScriptTarget();

// `constantFold: false` throughout: what is under test is the LOWERING of a
// broadcast unary head over a collection — the emitted source and, for the
// shapes with no componentwise lowering, the fail-closed diagnostic. Every
// probe below uses a literal list operand, so compile-time constant folding
// would evaluate the whole subtree and emit a literal (`vec4(0.841…, …)`)
// instead, short-circuiting the very code path being pinned.
const g = (expr: any): string =>
  glsl.compile(ce.box(expr), { constantFold: false }).code!;
const w = (expr: any): string =>
  wgsl.compile(ce.box(expr), { constantFold: false }).code!;
const p = (expr: any): string =>
  python.compile(ce.box(expr), { constantFold: false }).code!;

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
        '(-(vec4(1.0, 2.0, 3.0, 4.0)))'
      );
      expect(w(['Negate', ['List', 1, 2, 3, 4]])).toBe(
        '(-(vec4f(1.0, 2.0, 3.0, 4.0)))'
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
      // `np.emath.sqrt`: the element variable is a wide temporary of unknown
      // sign, and the default `auto` mode promotes such a radical
      // (compile-mode step 4, 2026-08-16); the point here is the bare `_tv1`.
      const code = p(['Sqrt', ['List', 1, 4, 9]]);
      expect(code).toBe('[np.emath.sqrt(_tv1) for _tv1 in [1, 4, 9]]');
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

    it('fans a BINARY arithmetic head out over its one collection operand', () => {
      // The scalar operand is spliced into the comprehension body, so the
      // arity of the head does not change the spelling. A comprehension
      // iterates a plain list, a tuple and an ndarray alike, which the infix
      // lowering does not: `2 * [1,2,3]` REPEATS a Python list.
      expect(p(['Multiply', 2, ['List', 1, 2, 3]])).toBe(
        '[2 * _tv1 for _tv1 in [1, 2, 3]]'
      );
      expect(p(['Power', ['List', 1, 2, 3], 2])).toBe(
        '[_tv1 ** 2 for _tv1 in [1, 2, 3]]'
      );
      // A collection in the EXPONENT position keeps compiling too.
      expect(p(['Power', 2, 'L'])).toBe('[2 ** _tv1 for _tv1 in L]');
    });

    it('declines a NEGATIVE INTEGER exponent over a collection base', () => {
      // This is the one element lowering whose result depends on the container
      // the caller binds, which is what the comprehension exists to avoid.
      // Python's `**` answers a float for a negative integer exponent of an
      // `int` (`2 ** -2` is `0.25`), while NumPy refuses the same operation on
      // an integer array element: `np.int64(2) ** -2` raises `ValueError:
      // Integers to negative integer powers are not allowed` (measured, NumPy
      // 2.4.2). A `list<number>` operand admits an integer ndarray, so the
      // artifact would compute for one binding and throw for another, and the
      // interpreter answers `[1, 1/4, 1/16]` for both. Fail closed instead.
      expect(() => p(['Power', 'L', -2])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
      expect(() => p(['Power', ['List', 1, 2, 4], -2])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
      // The two exponents both containers agree on stay admitted: a
      // non-negative integer, and a provably non-integer one (`v ** 0.5` is a
      // float on a plain list and on an integer ndarray alike — here it
      // canonicalizes to `Sqrt`, which NumPy broadcasts natively).
      expect(p(['Power', 'L', 3])).toBe('[_tv1 ** 3 for _tv1 in L]');
      expect(p(['Power', 'L', 0.5])).toBe('np.emath.sqrt(L)');
    });

    it('fans out over a merely collection-TYPED operand as well', () => {
      // The comprehension does not assume a container, so the artifact no
      // longer has to constrain what the caller binds to `L`.
      expect(p(['Negate', 'L'])).toBe('[-_tv1 for _tv1 in L]');
      expect(p(['Add', 'L', 1])).toBe('[_tv1 + 1 for _tv1 in L]');
    });

    it('still fails closed on the shapes no comprehension expresses', () => {
      // Two collection operands: the interpreter answers
      // `Error("incompatible-dimensions")` when the lengths disagree, and no
      // Python form reproduces that — NumPy recycles a length-1 axis and a
      // `zip` comprehension truncates to the shorter operand.
      expect(() => p(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
      // A collection of NON-scalars: one level of fan-out would hand a whole
      // row to a scalar operator.
      expect(() => p(['Add', 'M', 1])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
      // An operand that is only POSSIBLY a collection: it may still bind to a
      // list at run time, which is the repeat/concatenate divergence itself.
      expect(() => p(['Multiply', 2, 'B'])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
      // A SET-typed operand: unordered, so a comprehension has no defined
      // order — and the interpreter answers `incompatible-type` anyway. It
      // used to ESCAPE the guard entirely (a set matches neither `list<any>`
      // nor `indexed_collection<any>`) and emitted `SN + 1`.
      expect(() => p(['Add', 'SN', 1])).toThrow(
        /cannot compile arithmetic over a possibly-collection-typed operand/
      );
    });

    it('a set-typed operand fails closed on the JavaScript target too', () => {
      // Paired guard: the JavaScript scalar-infix gate had the identical
      // list/indexed spelling and the identical escape (`_.SN + 1`, string
      // concatenation or garbage at run time). Both guards read the
      // collection shape top together.
      expect(() =>
        compile(ce.box(['Add', 'SN', 1]), {
          constantFold: false,
          fallback: false,
        })
      ).toThrow(/cannot compile scalar arithmetic over a list-valued operand/);
    });
  });

  describe('JavaScript — unchanged `_SYS.bcast`', () => {
    // `constantFold: false`: the operand is a literal list, so compile-time
    // folding would answer the whole expression from the interpreter and emit
    // a literal array instead of the `_SYS.bcast` closure under test.
    it('broadcasts a unary head through the runtime helper', () => {
      const r = compile(ce.box(['Sin', ['List', 1, 2, 3, 4]]), {
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.code).toBe('_SYS.bcast((_tv1) => Math.sin(_tv1), [1, 2, 3, 4])');
      expect(r.code).not.toContain('.map(');
    });

    it('broadcasts a prefix operator through the runtime helper', () => {
      const r = compile(ce.box(['Negate', ['List', 1, 2, 3, 4]]), {
        constantFold: false,
      });
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

  // `constantFold: false` on the concrete-list probes below: their operands
  // are all literal, so compile-time folding would emit the evaluated array
  // and never exercise the `_SYS.bcast` wrapping of the scalar CALL, which is
  // the defect these tests pin.
  it('Sign broadcasts over a concrete list', () => {
    const r = compile(ce.box(['Sign', ['List', 3, -4, 0]]), {
      constantFold: false,
    });
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
    const r = compile(ce.box(['Arctan2', ['List', 1, 2, 3], 1]), {
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '_SYS.bcast((_tv1, _tv2) => Math.atan2(_tv1, _tv2), [1, 2, 3], 1)'
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

  it('a string-mapped head over a COMPLEX list still fails closed', () => {
    const r = compile(ce.box(['Sign', 'Z']));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/list-valued operand/);
  });
});
