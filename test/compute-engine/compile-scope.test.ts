/**
 * Tests for JavaScript compilation of scoping scenarios.
 *
 * Verifies that compiled JS code correctly captures scope (lexical scoping,
 * closure capture) and that the results match CE evaluation semantics.
 */

import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('COMPILE: Scoping and Closure', () => {
  // ── 1. Basic single-param function ─────────────────────────────────
  describe('Single-param function literal', () => {
    // f(x) = x * 2
    const f = ce.expr(['Function', ['Multiply', 'x', 2], 'x']);

    it('calling is "lambda"', () => {
      expect(compile(f)?.calling).toBe('lambda');
    });

    it('run(3) === 6', () => {
      expect(compile(f)?.run!(3)).toBe(6);
    });

    it('run(0) === 0', () => {
      expect(compile(f)?.run!(0)).toBe(0);
    });

    it('matches CE evaluate', () => {
      ce.pushScope();
      ce.declare('cs1_f', 'function');
      ce.assign('cs1_f', f);
      const ceResult = ce.expr(['cs1_f', 5]).evaluate().valueOf();
      ce.popScope();
      expect(compile(f)?.run!(5)).toBe(ceResult);
    });

    it('code is a lambda expression', () => {
      expect(compile(f)?.code).toMatchInlineSnapshot(`(x) => 2 * x`);
    });
  });

  // ── 2. Binary function ──────────────────────────────────────────────
  describe('Binary function (two params)', () => {
    // f(x, y) = x + y
    const f = ce.expr(['Function', ['Add', 'x', 'y'], 'x', 'y']);

    it('run(2, 3) === 5', () => {
      expect(compile(f)?.run!(2, 3)).toBe(5);
    });

    it('run(10, -4) === 6', () => {
      expect(compile(f)?.run!(10, -4)).toBe(6);
    });

    it('matches CE evaluate', () => {
      ce.pushScope();
      ce.declare('cs2_f', 'function');
      ce.assign('cs2_f', f);
      const ceResult = ce.expr(['cs2_f', 7, 3]).evaluate().valueOf();
      ce.popScope();
      expect(compile(f)?.run!(7, 3)).toBe(ceResult);
    });
  });

  // ── 3. Nested function / closure capture ───────────────────────────
  describe('Nested function — closure over outer param', () => {
    // outer: f(y) = λx. x + y    (curried addition)
    // outer param 'y' must remain visible inside the inner function's JS closure
    const outer = ce.expr([
      'Function',
      ['Function', ['Add', 'x', 'y'], 'x'],
      'y',
    ]);

    it('outer calling is "lambda"', () => {
      expect(compile(outer)?.calling).toBe('lambda');
    });

    it('run(4) returns a JS function', () => {
      expect(typeof compile(outer)?.run!(4)).toBe('function');
    });

    it('run(4)(3) === 7 — outer param visible inside inner', () => {
      const inner = compile(outer)?.run!(4) as (x: number) => number;
      expect(inner(3)).toBe(7);
    });

    it('run(10)(5) === 15 — different values', () => {
      const inner = compile(outer)?.run!(10) as (x: number) => number;
      expect(inner(5)).toBe(15);
    });

    it('matches CE nested evaluation', () => {
      // CE: evaluate outer(4) -> inner function; evaluate inner(3) -> 7
      ce.pushScope();
      try {
        ce.declare('cs3_outer', 'function');
        ce.assign('cs3_outer', outer);
        const innerFn = ce.expr(['cs3_outer', 4]).evaluate();
        ce.declare('cs3_inner', 'function');
        ce.assign('cs3_inner', innerFn);
        const ceResult = ce.expr(['cs3_inner', 3]).evaluate().valueOf();
        const jsInner = compile(outer)?.run!(4) as (x: number) => number;
        expect(jsInner(3)).toBe(ceResult);
      } finally {
        ce.popScope();
      }
    });
  });

  // ── 4. Function with Block body (local variable) ────────────────────
  describe('Function with Block body and local variable', () => {
    // f(x) = { let t = x²; return t + 1 }
    const f = ce.expr([
      'Function',
      [
        'Block',
        ['Declare', 't', 'number'],
        ['Assign', 't', ['Square', 'x']],
        ['Add', 't', 1],
      ],
      'x',
    ]);

    it('run(3) === 10 (t = 9, t + 1 = 10)', () => {
      expect(compile(f)?.run!(3)).toBe(10);
    });

    it('run(4) === 17 (t = 16, t + 1 = 17)', () => {
      expect(compile(f)?.run!(4)).toBe(17);
    });

    it('compiled code contains an IIFE', () => {
      expect(compile(f)?.code).toContain('(() => {');
    });

    it('compiled code uses Math.pow for Square', () => {
      expect(compile(f)?.code).toContain('Math.pow(x, 2)');
    });

    it('matches CE evaluate', () => {
      ce.pushScope();
      ce.declare('cs4_f', 'function');
      ce.assign('cs4_f', f);
      const ceResult = ce.expr(['cs4_f', 5]).evaluate().valueOf();
      ce.popScope();
      expect(compile(f)?.run!(5)).toBe(ceResult);
    });
  });

  // ── 5. Conditional body (absolute value) ───────────────────────────
  describe('Conditional body (absolute value)', () => {
    // f(x) = if x > 0 then x else -x
    const f = ce.expr([
      'Function',
      ['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']],
      'x',
    ]);

    it('run(3) === 3', () => {
      expect(compile(f)?.run!(3)).toBe(3);
    });

    it('run(-5) === 5', () => {
      expect(compile(f)?.run!(-5)).toBe(5);
    });

    it('compiled code uses ternary', () => {
      expect(compile(f)?.code).toContain('?');
    });

    it('matches CE evaluate', () => {
      ce.pushScope();
      ce.declare('cs5_f', 'function');
      ce.assign('cs5_f', f);
      const ceResult = ce.expr(['cs5_f', -7]).evaluate().valueOf();
      ce.popScope();
      expect(compile(f)?.run!(-7)).toBe(ceResult);
    });
  });

  // ── 6. Binary function with two captured params (Pythagorean) ──────
  describe('Binary function — two-param parity', () => {
    // f(x, y) = x² + y²
    const f = ce.expr([
      'Function',
      ['Add', ['Square', 'x'], ['Square', 'y']],
      'x',
      'y',
    ]);

    it('run(3, 4) === 25', () => {
      expect(compile(f)?.run!(3, 4)).toBe(25);
    });

    it('run(0, 5) === 25', () => {
      expect(compile(f)?.run!(0, 5)).toBe(25);
    });

    it('matches CE evaluate', () => {
      ce.pushScope();
      ce.declare('cs6_f', 'function');
      ce.assign('cs6_f', f);
      const ceResult = ce.expr(['cs6_f', 3, 4]).evaluate().valueOf();
      ce.popScope();
      expect(compile(f)?.run!(3, 4)).toBe(ceResult);
    });
  });

  // ── 7. Lexical scope isolation — param does not bleed into outer ────
  describe('Lexical scope isolation — no parameter bleed-through', () => {
    // Declare x=5 in outer scope; f(x) = x * 2 should use its own x,
    // and after calling f(10) the outer x should remain 5.
    it('function param does not mutate outer scope variable', () => {
      ce.pushScope();
      ce.declare('cs7_x', { type: 'number', value: 5 });
      const f = ce.expr(['Function', ['Multiply', 'cs7_x', 2], 'cs7_x']);

      // CE: call f(10) — the param cs7_x=10 is in fresh scope
      ce.pushScope();
      ce.declare('cs7_f', 'function');
      ce.assign('cs7_f', f);
      const ceResult = ce.expr(['cs7_f', 10]).evaluate().valueOf();
      // outer cs7_x must remain 5
      const outerX = ce.expr('cs7_x').evaluate().valueOf();
      ce.popScope();
      ce.popScope();

      expect(ceResult).toBe(20); // f(10) = 10 * 2 = 20
      expect(outerX).toBe(5); // outer x unchanged

      // JS: compile and run — also should give 20
      expect(compile(f)?.run!(10)).toBe(20);
    });
  });
});
