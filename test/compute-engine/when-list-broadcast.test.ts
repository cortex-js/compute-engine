import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import '../utils'; // For snapshot serializers

/**
 * Desmos-style broadcasting of `When(expr, cond)` over a list-valued
 * condition: the restriction is applied element-by-element, producing one
 * masked branch per element (mirrors the boolean-mask branch of `At`).
 */
describe('When: list-condition broadcast', () => {
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
    expect(r.json).toEqual(['List', 'Undefined', 2, 2]);
  });

  test('indeterminate (symbolic) elements → held When per element', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse('x\\left\\{x\\le\\left[1,2,3\\right]\\right\\}')
      .evaluate();
    expect(r.json).toEqual([
      'List',
      ['When', 'x', ['LessEqual', 'x', 1]],
      ['When', 'x', ['LessEqual', 'x', 2]],
      ['When', 'x', ['LessEqual', 'x', 3]],
    ]);
  });

  test('expr is a collection → zip elementwise', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse('\\left[10,20,30\\right]\\left\\{\\left[1,2,3\\right]>2\\right\\}')
      .evaluate();
    // [1,2,3] > 2 → [False, False, True]
    expect(r.json).toEqual(['List', 'Undefined', 'Undefined', 30]);
  });

  test('different lengths truncate to the shorter (At mask alignment)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse('\\left[10,20,30\\right]\\left\\{\\left[1,2\\right]>0\\right\\}')
      .evaluate();
    // condition has 2 elements → result has 2 elements
    expect(r.json).toEqual(['List', 10, 20]);
  });

  test('stacked restriction with one list condition broadcasts through And', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 3);
    const expr = ce.parse(
      'x\\left\\{x>0\\right\\}\\left\\{x\\le\\left[1,2\\right]\\right\\}'
    );
    // Canonical folds to When(x, And(0 < x, x <= [1,2])).
    expect(expr.op2.operator).toEqual('And');
    // 3 > 0 ∧ 3 <= [1,2] → [False, False]
    expect(expr.evaluate().json).toEqual(['List', 'Undefined', 'Undefined']);
  });

  describe('type handler', () => {
    test('list-of-booleans condition lifts the result to a list type', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'number');
      const t = ce
        .parse('x^{2}\\left\\{\\left[1,2,3\\right]>0\\right\\}')
        .type.toString();
      expect(t.startsWith('list<')).toBe(true);
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

    test('False condition → Undefined', () => {
      const ce = new ComputeEngine();
      ce.assign('x', 1);
      expect(ce.parse('x\\left\\{x>3\\right\\}').evaluate().symbol).toEqual(
        'Undefined'
      );
    });

    test('indeterminate condition → held When', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('x^{2}\\left\\{x>0\\right\\}').evaluate().operator).toEqual(
        'When'
      );
    });
  });

  describe('compile path: list-condition When is not silently miscompiled', () => {
    test('GLSL rejects a list-condition When the same way as a list comparison', () => {
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

    test('scalar When still compiles to a ternary', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const target = new GLSLTarget();
      const r = target.compile(ce.parse('x^{2}\\left\\{x>0\\right\\}'));
      expect(r.success).toBe(true);
      expect(r.code).toContain('?');
    });
  });
});
