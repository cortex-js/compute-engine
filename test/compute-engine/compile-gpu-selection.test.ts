import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

// Element-wise `Which`/`If` selection on the GPU shader targets
// (docs/BROADCAST-MODEL.md, R1–R4): a statically
// shaped (vec2–vec4) condition lowers to boolean-vector masks combined with
// GLSL `mix` / WGSL `select`; anything with no static shape fails closed (D6).
//
// A fresh engine: these declarations must not leak into (or inherit from) the
// shared test engine.
const ce = new ComputeEngine();
const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

ce.declare('N2', 'vector<integer^2>');
ce.declare('N4', 'vector<integer^4>');
ce.declare('S4', 'vector<number^4>');
ce.declare('B2', 'vector<boolean^2>');
ce.declare('L', 'list<number>');
ce.declare('P', 'tuple<number, number>');
ce.declare('Q', 'tuple<number, number>');
ce.declare('zc', 'complex');

const VARS = {
  // Several of the shapes below (a literal boolean-list condition, a literal
  // list arm) have no free variables, so compile-time constant folding would
  // evaluate the whole subtree and emit a literal vector instead of exercising
  // the selection lowering (and instead of reaching the fail-closed gate).
  // These tests are about the lowering, so folding is off for the whole file.
  constantFold: false,
  vars: {
    N2: 'u_m',
    N4: 'u_n',
    S4: 'u_s',
    B2: 'u_b',
    L: 'u_L',
    P: 'u_p',
    Q: 'u_q',
  },
};

const g = (expr: any): string => glsl.compile(ce.box(expr), VARS).code!;
const w = (expr: any): string => wgsl.compile(ce.box(expr), VARS).code!;

describe('GPU ELEMENT-WISE SELECTION', () => {
  describe('GLSL', () => {
    it('lowers a literal boolean-list condition to a bvec mask', () => {
      // The interpreter answers `[1, 0]`; `mix(a, b, mask)` picks `b` where the
      // mask is true, so the cells are (1.0, 0.0).
      expect(
        ce
          .box(['Which', ['List', 'True', 'False'], 1, 'True', 0])
          .evaluate()
          .toString()
      ).toBe('[1,0]');
      expect(g(['Which', ['List', 'True', 'False'], 1, 'True', 0])).toBe(
        'mix(vec2(0.0), vec2(1.0), bvec2(true, false))'
      );
    });

    it('lowers a multi-clause witness over a vec4 uniform', () => {
      const code = g([
        'Which',
        ['Equal', 'N4', 3],
        1,
        ['Equal', 'N4', 2],
        'S4',
        'True',
        0,
      ]);
      expect(code).toBe(
        'mix(mix(vec4(0.0), u_s, equal(u_n, vec4(2.0))), vec4(1.0), equal(u_n, vec4(3.0)))'
      );
    });

    it('uses the vecN NaN as the no-match value (R4)', () => {
      expect(g(['Which', ['Equal', 'N2', 3], 1])).toBe(
        'mix(vec2(_gpu_nan()), vec2(1.0), equal(u_m, vec2(3.0)))'
      );
    });

    it('routes `If` through the same lowering', () => {
      expect(g(['If', ['Equal', 'N2', 3], 1, 0])).toBe(
        'mix(vec2(0.0), vec2(1.0), equal(u_m, vec2(3.0)))'
      );
    });

    it('composes And / Or / Not masks componentwise', () => {
      expect(
        g([
          'Which',
          ['And', ['Less', 'N2', 3], ['Greater', 'N2', 0]],
          1,
          'True',
          0,
        ])
      ).toBe(
        'mix(vec2(0.0), vec2(1.0), bvec2(vec2(lessThan(u_m, vec2(3.0))) * vec2(lessThan(vec2(0.0), u_m))))'
      );
      expect(
        g([
          'Which',
          ['Or', ['Less', 'N2', 3], ['Greater', 'N2', 0]],
          1,
          'True',
          0,
        ])
      ).toBe(
        'mix(vec2(0.0), vec2(1.0), bvec2(vec2(lessThan(u_m, vec2(3.0))) + vec2(lessThan(vec2(0.0), u_m))))'
      );
      expect(g(['Which', ['Not', ['Less', 'N2', 3]], 1, 'True', 0])).toBe(
        'mix(vec2(0.0), vec2(1.0), not(lessThan(u_m, vec2(3.0))))'
      );
    });

    it('conjoins a chained ordering', () => {
      expect(g(['Which', ['Less', 0, 'N2', 5], 1, 'True', 0])).toBe(
        'mix(vec2(0.0), vec2(1.0), bvec2(vec2(lessThan(vec2(0.0), u_m)) * vec2(lessThan(u_m, vec2(5.0)))))'
      );
    });

    it('uses a boolean-vector value directly as the mask', () => {
      expect(g(['Which', 'B2', 1, 'True', 0])).toBe(
        'mix(vec2(0.0), vec2(1.0), u_b)'
      );
    });
  });

  describe('WGSL', () => {
    it('lowers a literal boolean-list condition to a vecN<bool> mask', () => {
      expect(w(['Which', ['List', 'True', 'False'], 1, 'True', 0])).toBe(
        'select(vec2f(0.0), vec2f(1.0), vec2<bool>(true, false))'
      );
    });

    it('lowers a multi-clause witness over a vec4 uniform', () => {
      expect(
        w(['Which', ['Equal', 'N4', 3], 1, ['Equal', 'N4', 2], 'S4', 'True', 0])
      ).toBe(
        'select(select(vec4f(0.0), u_s, ((u_n) == (vec4f(2.0)))), vec4f(1.0), ((u_n) == (vec4f(3.0))))'
      );
    });

    it('uses the vecNf NaN bit pattern as the no-match value (R4)', () => {
      expect(w(['Which', ['Equal', 'N4', 3], 1])).toBe(
        'select(vec4f(bitcast<f32>(0x7fc00000u)), vec4f(1.0), ((u_n) == (vec4f(3.0))))'
      );
    });

    it('routes `If` through the same lowering', () => {
      expect(w(['If', ['Equal', 'N2', 3], 1, 0])).toBe(
        'select(vec2f(0.0), vec2f(1.0), ((u_m) == (vec2f(3.0))))'
      );
    });

    it('composes And / Or / Not masks componentwise', () => {
      expect(
        w([
          'Which',
          ['And', ['Less', 'N2', 3], ['Greater', 'N2', 0]],
          1,
          'True',
          0,
        ])
      ).toBe(
        'select(vec2f(0.0), vec2f(1.0), (((u_m) < (vec2f(3.0))) & ((vec2f(0.0)) < (u_m))))'
      );
      expect(
        w([
          'Which',
          ['Or', ['Less', 'N2', 3], ['Greater', 'N2', 0]],
          1,
          'True',
          0,
        ])
      ).toBe(
        'select(vec2f(0.0), vec2f(1.0), (((u_m) < (vec2f(3.0))) | ((vec2f(0.0)) < (u_m))))'
      );
      expect(w(['Which', ['Not', ['Less', 'N2', 3]], 1, 'True', 0])).toBe(
        'select(vec2f(0.0), vec2f(1.0), (!(((u_m) < (vec2f(3.0))))))'
      );
    });

    it('conjoins a chained ordering', () => {
      expect(w(['Which', ['Less', 0, 'N2', 5], 1, 'True', 0])).toBe(
        'select(vec2f(0.0), vec2f(1.0), (((vec2f(0.0)) < (u_m)) & ((u_m) < (vec2f(5.0)))))'
      );
    });
  });

  describe('scalar conditions are untouched', () => {
    // Pinned from the output BEFORE the selection hook was added to the GPU
    // targets: a scalar `Which`/`If` must stay byte-identical.
    it('GLSL scalar Which / If', () => {
      expect(g(['Which', ['Less', 'x', 3], 1, 'True', 0])).toBe(
        '((x < 3.0) ? (1.0) : ((0.0)))'
      );
      expect(g(['If', ['Less', 'x', 3], 1, 0])).toBe(
        '((x < 3.0) ? (1.0) : (0.0))'
      );
    });

    it('WGSL scalar Which / If', () => {
      expect(w(['Which', ['Less', 'x', 3], 1, 'True', 0])).toBe(
        'select((0.0), 1.0, x < 3.0)'
      );
      expect(w(['If', ['Less', 'x', 3], 1, 0])).toBe(
        'select(0.0, 1.0, x < 3.0)'
      );
    });
  });

  describe('fail closed (D6)', () => {
    // Regression: these used to emit invalid shader source behind
    // `success: true` — `((u_L == 3.0) ? …)`, `((vec2(True, False)) ? …)`.
    it('declines an unknown-length list condition operand', () => {
      expect(() => g(['Which', ['Equal', 'L', 3], 1, 'True', 0])).toThrow(
        /no static vec2–vec4 shape/
      );
      expect(() => w(['Which', ['Equal', 'L', 3], 1, 'True', 0])).toThrow(
        /no static vec2–vec4 shape/
      );
      // The garbage comparison is gone.
      let code = '';
      try {
        code = g(['Which', ['Equal', 'L', 3], 1, 'True', 0]);
      } catch {
        /* expected */
      }
      expect(code).not.toContain('u_L == 3.0');
    });

    it('declines conflicting condition widths', () => {
      expect(() =>
        g(['Which', ['Less', 'N2', 3], 1, ['Less', 'N4', 3], 2, 'True', 0])
      ).toThrow(/mix vec2 and vec4/);
    });

    it('declines a complex-valued arm', () => {
      expect(() => g(['Which', ['Less', 'N2', 3], 'zc', 'True', 0])).toThrow(
        /complex-valued arm/
      );
    });

    it('declines a tuple-typed arm', () => {
      expect(() => g(['Which', ['Less', 'N2', 3], 'P', 'True', 0])).toThrow(
        /tuple arm/
      );
    });

    it('declines a 5-element literal list condition', () => {
      expect(() =>
        g([
          'Which',
          ['List', 'True', 'False', 'True', 'False', 'True'],
          1,
          'True',
          0,
        ])
      ).toThrow(/5-element list condition/);
    });

    it('declines an n-ary Equal over a collection operand', () => {
      const cond = ce.box(['Equal', 'N2', 'N2', 3]);
      expect(cond.nops).toBe(3);
      expect(() =>
        glsl.compile(ce.box(['Which', cond, 1, 'True', 0]), VARS)
      ).toThrow(/n-ary `Equal`/);
    });

    it('declines a non-boolean literal list condition', () => {
      expect(() => g(['Which', ['List', 1, 0], 1, 'True', 0])).toThrow(
        /needs provably boolean scalar cells/
      );
    });

    it('declines a numeric collection used directly as a condition', () => {
      expect(() => g(['Which', 'N2', 1, 'True', 0])).toThrow(/not of booleans/);
    });

    it('declines `When` with a collection condition', () => {
      // `When` is deliberately NOT a selection form (design §5).
      expect(() => g(['When', 1, ['List', 'True', 'False']])).toThrow(
        /branch condition is a collection-valued expression/
      );
      expect(() => w(['When', 1, ['List', 'True', 'False']])).toThrow(
        /branch condition is a collection-valued expression/
      );
    });
  });

  // The review round after the initial landing (2026-07-28): comparisons and
  // connectives over a non-scalar operand OUTSIDE a selection condition used
  // to emit invalid shader source behind `success: true` (`u_m < 3.0` with a
  // vec2 uniform, `!(u_m < 3.0)`, …), and several arm/condition shapes slipped
  // through the selection lowering itself.
  describe('fail-closed outside selection position', () => {
    it('declines a vec comparison at the root', () => {
      expect(() => g(['Less', 'N2', 3])).toThrow(/scalar-only/);
      expect(() => w(['Less', 'N2', 3])).toThrow(/scalar-only/);
    });

    it('declines a vec comparison in arm position', () => {
      expect(() =>
        g(['Which', ['Less', 'x', 1], ['Less', 'N2', 3], 'True', 0])
      ).toThrow(/scalar-only/);
    });

    it('declines connectives over vec-shaped operands at the root', () => {
      expect(() => g(['And', ['Less', 'N2', 3], ['Greater', 'N2', 0]])).toThrow(
        /scalar-only/
      );
      expect(() => w(['Not', 'B2'])).toThrow(/scalar-only/);
    });

    it('keeps GLSL tuple equality (atomic aggregate ==, matching the interpreter)', () => {
      expect(g(['Equal', 'P', 'Q'])).toBe('u_p == u_q');
      // WGSL `==` on vectors is component-wise (`vecN<bool>`), so the same
      // shape declines there.
      expect(() => w(['Equal', 'P', 'Q'])).toThrow(/scalar-only/);
    });
  });

  describe('selection-lowering shapes from the review round', () => {
    it('declines a boolean-vector arm', () => {
      expect(() => g(['Which', ['Less', 'N2', 3], 'B2', 'True', 0])).toThrow(
        /boolean-valued arm/
      );
      expect(() => w(['Which', ['Less', 'N2', 3], 'B2', 'True', 0])).toThrow(
        /boolean-valued arm/
      );
    });

    it('declines scalar True/False arms', () => {
      // `True`/`False` are not shader identifiers; the old emission spliced
      // `vec2(False)` — invalid source — behind `success: true`.
      expect(() =>
        g(['Which', ['Less', 'N2', 3], 'True', 'True', 'False'])
      ).toThrow(/boolean-valued arm/);
    });

    it('declines an unsupported relational head with scalar operands in a vec-activated Which', () => {
      // `Precedes` is in the relational-operator set but has no componentwise
      // shader form; before the emission-site guard this spliced the literal
      // string `undefined` into the source.
      expect(() =>
        g([
          'Which',
          ['Precedes', 'x', 'y'],
          1,
          ['Less', 'N2', 3],
          2,
          'True',
          0,
        ])
      ).toThrow(/no componentwise shader form/);
    });

    it('lowers provably-boolean scalar cells in a literal list condition', () => {
      expect(g(['Which', ['List', ['Less', 'x', 0], 'True'], 1, 'True', 0])).toBe(
        'mix(vec2(0.0), vec2(1.0), bvec2(x < 0.0, true))'
      );
    });
  });
});
