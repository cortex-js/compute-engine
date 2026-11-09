import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import '../utils'; // For snapshot serializers

/**
 * Desmos-style broadcasting of `If(cond, expr)` over a list-valued
 * condition: the restriction is applied element-by-element, producing one
 * masked branch per element (mirrors the boolean-mask branch of `At`).
 */
describe('restriction: list-condition broadcast', () => {
  test('all-True list condition → list of the evaluated expr', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse('x^{2}\\left\\{\\left[1,2,3\\right]>0\\right\\}')
      .evaluate();
    expect(r.json).toEqual([
      'List',
      ['Power', 'x', 2],
      ['Power', 'x', 2],
      ['Power', 'x', 2],
    ]);
  });

  test('mixed True/False mask with concrete x → masked list', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    const r = ce
      .parse('x\\left\\{x\\le\\left[1,2,3\\right]\\right\\}')
      .evaluate();
    // 2 <= [1,2,3] → [False, True, True]
    // A masked numeric cell is `NaN` (user decision 2026-09-25).
    expect(r.toString()).toBe('[NaN,2,2]');
  });

  test('indeterminate (symbolic) elements → held restriction per element', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse('x\\left\\{x\\le\\left[1,2,3\\right]\\right\\}')
      .evaluate();
    expect(r.json).toEqual([
      'List',
      ['If', ['LessEqual', 'x', 1], 'x'],
      ['If', ['LessEqual', 'x', 2], 'x'],
      ['If', ['LessEqual', 'x', 3], 'x'],
    ]);
  });

  test('expr is a collection → zip elementwise', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse('\\left[10,20,30\\right]\\left\\{\\left[1,2,3\\right]>2\\right\\}')
      .evaluate();
    // [1,2,3] > 2 → [False, False, True]
    expect(r.toString()).toBe('[NaN,NaN,30]');
  });

  test('different lengths are a static error', () => {
    // A list value has the length of the list of conditions (selection rule
    // of 2026-11-02). Before, it was truncated to the shorter, `[10,20]`.
    const ce = new ComputeEngine();
    const r = ce
      .parse('\\left[10,20,30\\right]\\left\\{\\left[1,2\\right]>0\\right\\}')
      .evaluate();
    expect(r.toString()).toBe('Error("incompatible-dimensions", "2 vs 3")');
  });

  test('stacked restriction with one list condition broadcasts through And', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 3);
    const expr = ce.parse(
      'x\\left\\{x>0\\right\\}\\left\\{x\\le\\left[1,2\\right]\\right\\}'
    );
    // Canonical folds to If(And(0 < x, x <= [1,2]), x).
    expect(expr.op1.operator).toEqual('And');
    // 3 > 0 ∧ 3 <= [1,2] → [False, False]
    expect(expr.evaluate().toString()).toBe('[NaN,NaN]');
  });

  describe('type handler', () => {
    test('list-of-booleans condition lifts the result to a list type', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'number');
      // The parsed `If(c, x^2)` is typed by the element-wise selection,
      // `vector<3>`, a list type whose length is the mask's.
      const t = ce.parse(
        'x^{2}\\left\\{\\left[1,2,3\\right]>0\\right\\}'
      ).type;
      expect(t.matches('list')).toBe(true);
    });

    test('scalar boolean condition keeps expr type', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'number');
      const t = ce.parse('x^{2}\\left\\{x>0\\right\\}').type.toString();
      expect(t.startsWith('list<')).toBe(false);
    });
  });

  describe('scalar path unchanged', () => {
    test('True condition → evaluated expr', () => {
      const ce = new ComputeEngine();
      ce.assign('x', 5);
      expect(ce.parse('x\\left\\{x>3\\right\\}').evaluate().re).toEqual(5);
    });

    test('False condition → NaN for a number', () => {
      const ce = new ComputeEngine();
      ce.assign('x', 1);
      expect(ce.parse('x\\left\\{x>3\\right\\}').evaluate().isNaN).toBe(true);
    });

    test('indeterminate condition → held If', () => {
      // The parsed restriction `If(c, e)` is held in the form it was parsed.
      const ce = new ComputeEngine();
      expect(ce.parse('x^{2}\\left\\{x>0\\right\\}').evaluate().operator).toEqual(
        'If'
      );
    });
  });

  describe('compile path: list-condition restriction is not silently miscompiled', () => {
    test('GLSL rejects a list-condition restriction the same way as a list comparison', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const target = new GLSLTarget();
      // A bare list comparison is already unsupported on the scalar GLSL
      // target (throws `Unknown operator`); a list-condition When routes its
      // condition through that same path, so it is rejected identically —
      // it never emits silently-wrong scalar code.
      expect(() =>
        target.compile(ce.parse('\\left[1,2,3\\right]>0'))
      ).toThrow();
      expect(() =>
        target.compile(
          ce.parse('x^{2}\\left\\{\\left[1,2,3\\right]>0\\right\\}')
        )
      ).toThrow();
    });

    test('scalar restriction still compiles to a ternary', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const target = new GLSLTarget();
      // The GLSL fragment refuses an `If` that is a value and has one
      // branch, which is what a restriction is.
      expect(() =>
        target.compile(ce.parse('x^{2}\\left\\{x>0\\right\\}'))
      ).toThrow(/needs both branches/);
    });
  });
});
