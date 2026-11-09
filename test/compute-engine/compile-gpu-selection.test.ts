import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

// Element-wise `Which`/`If` selection on the GPU shader targets
// (docs/BROADCAST-MODEL.md, R1–R4): a statically
// shaped (vec2–vec4) condition lowers to boolean-vector masks combined with
// GLSL `mix`; anything with no static shape fails closed.
//
// A fresh engine: these declarations must not leak into (or inherit from) the
// shared test engine.
const ce = new ComputeEngine();
ce.declare('c', 'boolean');
ce.declare('x', 'real | signed_infinity | nan');
const glsl = new GLSLTarget();

ce.declare('N2', 'vector<integer^2>');
ce.declare('N4', 'vector<integer^4>');
ce.declare('S4', 'vector<number^4>');
// The cells of a `vector` are numbers; a boolean mask of length 2 is spelled
// `list<boolean^2>`.
ce.declare('B2', 'list<boolean^2>');
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

// The GLSL fragment refuses the form before any code is written.
const expectOutside = (expr: any): void => {
  const result = glsl.compile(ce.box(expr), { ...VARS, fallback: true });
  expect(result.success).toBe(false);
  expect(result.diagnostic?.code).toBe('outside-fragment');
};

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
      // The fragment refuses a list of booleans, so the compilation declines.
      expectOutside(['Which', ['List', 'True', 'False'], 1, 'True', 0]);
    });

    it('lowers a multi-clause witness over a vec4 uniform', () => {
      expectOutside([
        'Which',
        ['Equal', 'N4', 3],
        1,
        ['Equal', 'N4', 2],
        'S4',
        'True',
        0,
      ]);
    });

    it('uses the vecN NaN as the no-match value (R4)', () => {
      expectOutside(['Which', ['Equal', 'N2', 3], 1]);
    });

    it('routes `If` through the same lowering', () => {
      expectOutside(['If', ['Equal', 'N2', 3], 1, 0]);
    });

    it('composes And / Or / Not masks componentwise', () => {
      expectOutside([
        'Which',
        ['And', ['Less', 'N2', 3], ['Greater', 'N2', 0]],
        1,
        'True',
        0,
      ]);
      expectOutside([
        'Which',
        ['Or', ['Less', 'N2', 3], ['Greater', 'N2', 0]],
        1,
        'True',
        0,
      ]);
      expectOutside(['Which', ['Not', ['Less', 'N2', 3]], 1, 'True', 0]);
    });

    it('conjoins a chained ordering', () => {
      expectOutside(['Which', ['Less', 0, 'N2', 5], 1, 'True', 0]);
    });

    it('uses a boolean-vector value directly as the mask', () => {
      expectOutside(['Which', 'B2', 1, 'True', 0]);
    });
  });

  describe('scalar conditions are untouched', () => {
    // Pinned from the output BEFORE the selection hook was added to the GPU
    // targets: a scalar `Which`/`If` must stay byte-identical. The one later
    // change is the separate one-or-zero peephole: a conditional choosing
    // between `1.0` and `0.0` is written as a cast of its condition, which is
    // the same value with no branch.
    it('GLSL scalar Which / If', () => {
      expect(g(['Which', ['Less', 'x', 3], 1, 'True', 0])).toBe(
        '((x < 3.0) ? (1.0) : ((0.0)))'
      );
      expect(g(['If', ['Less', 'x', 3], 1, 0])).toBe('float(x < 3.0)');
    });
  });

  describe('fail closed', () => {
    // Regression: these used to emit invalid shader source behind
    // `success: true` — `((u_L == 3.0) ? …)`, `((vec2(True, False)) ? …)`.
    it('a list with absent NUMERIC cells compiles; a whole list that may be absent does not', () => {
      // `[sin x, x{c}]` types `list<number | missing>`: an absent cell is a
      // NaN lane, which the restriction no-match lowering emits, so the shape is
      // admitted.
      expect(g(['List', ['Sin', 'x'], ['If', 'c', 'x']])).toMatch(/_gpu_nan/);
      // A default-less `Which` over a list types `missing | list<…>`: the
      // WHOLE list may be absent, and the no-match lowering would pair an
      // array arm with a scalar NaN. That stays fail-closed.
      expect(() => g(['Which', 'c', ['List', 1, 2, 3, 4, 5]])).toThrow(
        /has no representation of `Missing` in GLSL/
      );
    });
    it('declines an unknown-length list condition operand', () => {
      expectOutside(['Which', ['Equal', 'L', 3], 1, 'True', 0]);
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
      // Two list conditions of lengths 2 and 4 are a static error (selection
      // rule of 2026-11-02), so the compilation declines before the target
      // reads the widths.
      expectOutside([
        'Which',
        ['Less', 'N2', 3],
        1,
        ['Less', 'N4', 3],
        2,
        'True',
        0,
      ]);
    });

    it('declines a complex-valued arm', () => {
      expectOutside(['Which', ['Less', 'N2', 3], 'zc', 'True', 0]);
    });

    it('declines a tuple-typed arm', () => {
      // A point arm beside a number arm is a static error (selection rule of
      // 2026-11-02), so the compilation declines before the target reads
      // the arms.
      expectOutside(['Which', ['Less', 'N2', 3], 'P', 'True', 0]);
    });

    it('declines a 5-element literal list condition', () => {
      expectOutside([
        'Which',
        ['List', 'True', 'False', 'True', 'False', 'True'],
        1,
        'True',
        0,
      ]);
    });

    it('declines an n-ary Equal over a collection operand', () => {
      const cond = ce.box(['Equal', 'N2', 'N2', 3]);
      expect(cond.nops).toBe(3);
      const result = glsl.compile(ce.box(['Which', cond, 1, 'True', 0]), {
        ...VARS,
        fallback: true,
      });
      expect(result.success).toBe(false);
      expect(result.diagnostic?.code).toBe('outside-fragment');
    });

    it('declines a non-boolean literal list condition', () => {
      // A list of numbers can never select: its type says so at boxing, so
      // the condition is an `incompatible-type` error operand and the
      // invalid expression is refused before any target sees it.
      expectOutside(['Which', ['List', 1, 0], 1, 'True', 0]);
    });

    it('declines a numeric collection used directly as a condition', () => {
      // Same refusal for a symbol declared `list<number>` (`N2`).
      expectOutside(['Which', 'N2', 1, 'True', 0]);
    });

    it('declines `When` with a collection condition', () => {
      // A restriction is deliberately NOT a selection form (design §5).
      expectOutside(['If', ['List', 'True', 'False'], 1]);
    });
  });

  // The review round after the initial landing (2026-07-28): comparisons and
  // connectives over a non-scalar operand OUTSIDE a selection condition used
  // to emit invalid shader source behind `success: true` (`u_m < 3.0` with a
  // vec2 uniform, `!(u_m < 3.0)`, …), and several arm/condition shapes slipped
  // through the selection lowering itself.
  describe('fail-closed outside selection position', () => {
    it('declines a vec comparison at the root', () => {
      expectOutside(['Less', 'N2', 3]);
    });

    it('declines a vec comparison in arm position', () => {
      expectOutside(['Which', ['Less', 'x', 1], ['Less', 'N2', 3], 'True', 0]);
    });

    it('declines connectives over vec-shaped operands at the root', () => {
      expectOutside(['And', ['Less', 'N2', 3], ['Greater', 'N2', 0]]);
    });

    it('keeps GLSL tuple equality (atomic aggregate ==, matching the interpreter)', () => {
      expect(g(['Equal', 'P', 'Q'])).toBe('u_p == u_q');
    });
  });

  describe('selection-lowering shapes from the review round', () => {
    it('declines a boolean-vector arm', () => {
      expectOutside(['Which', ['Less', 'N2', 3], 'B2', 'True', 0]);
    });

    it('declines scalar True/False arms', () => {
      // `True`/`False` are not shader identifiers; the old emission spliced
      // `vec2(False)` — invalid source — behind `success: true`.
      expectOutside(['Which', ['Less', 'N2', 3], 'True', 'True', 'False']);
    });

    it('declines an unsupported relational head with scalar operands in a vec-activated Which', () => {
      // `Precedes` is in the relational-operator set but has no componentwise
      // shader form; before the emission-site guard this spliced the literal
      // string `undefined` into the source.
      expectOutside([
        'Which',
        ['Precedes', 'x', 'y'],
        1,
        ['Less', 'N2', 3],
        2,
        'True',
        0,
      ]);
    });

    it('lowers provably-boolean scalar cells in a literal list condition', () => {
      expectOutside([
        'Which',
        ['List', ['Less', 'x', 0], 'True'],
        1,
        'True',
        0,
      ]);
    });
  });
});
