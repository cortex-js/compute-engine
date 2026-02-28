/**
 * Advanced scoping tests: currying, mutual recursion, higher-order functions,
 * forget() edge cases, isEqual() in scopes, BigOp/Block compilation, and
 * LaTeX parse() with scoped evaluation.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { engine } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce: ComputeEngine = engine;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Too few arguments — currying
// ─────────────────────────────────────────────────────────────────────────────
describe('TOO FEW ARGUMENTS (currying)', () => {
  test('calling a binary function with one argument returns a curried function', () => {
    // f(x, y) = x + y. Calling f(3) should return g(y) = 3 + y
    ce.pushScope();
    try {
      ce.declare('cur_f', 'function');
      ce.assign('cur_f', ce.expr(['Function', ['Add', 'cur_x', 'cur_y'], 'cur_x', 'cur_y']));
      const g = ce.expr(['cur_f', 3]).evaluate();
      expect(g.operator).toEqual('Function');
      // Apply the curried result: g(7) = 3 + 7 = 10
      ce.declare('cur_g', 'function');
      ce.assign('cur_g', g);
      expect(ce.expr(['cur_g', 7]).evaluate().valueOf()).toEqual(10);
    } finally {
      ce.popScope();
    }
  });

  test('calling a ternary function with one argument returns a binary curried function', () => {
    // f(a, b, c) = a * b + c. Calling f(2) returns g(b, c) = 2*b + c
    ce.pushScope();
    try {
      ce.declare('cur3_f', 'function');
      ce.assign(
        'cur3_f',
        ce.expr([
          'Function',
          ['Add', ['Multiply', 'cur3_a', 'cur3_b'], 'cur3_c'],
          'cur3_a',
          'cur3_b',
          'cur3_c',
        ])
      );
      const g = ce.expr(['cur3_f', 2]).evaluate();
      expect(g.operator).toEqual('Function');
      ce.declare('cur3_g', 'function');
      ce.assign('cur3_g', g);
      // g(3, 4) = 2*3 + 4 = 10
      expect(ce.expr(['cur3_g', 3, 4]).evaluate().valueOf()).toEqual(10);
    } finally {
      ce.popScope();
    }
  });

  test('calling a ternary function with two arguments returns a unary curried function', () => {
    // f(a, b, c) = a * b + c. Calling f(2, 3) returns h(c) = 6 + c
    ce.pushScope();
    try {
      ce.declare('cur3b_f', 'function');
      ce.assign(
        'cur3b_f',
        ce.expr([
          'Function',
          ['Add', ['Multiply', 'cur3b_a', 'cur3b_b'], 'cur3b_c'],
          'cur3b_a',
          'cur3b_b',
          'cur3b_c',
        ])
      );
      const h = ce.expr(['cur3b_f', 2, 3]).evaluate();
      expect(h.operator).toEqual('Function');
      ce.declare('cur3b_h', 'function');
      ce.assign('cur3b_h', h);
      // h(4) = 2*3 + 4 = 10
      expect(ce.expr(['cur3b_h', 4]).evaluate().valueOf()).toEqual(10);
    } finally {
      ce.popScope();
    }
  });

  test('calling a no-arg function with zero arguments evaluates the body', () => {
    // f() = 42
    ce.pushScope();
    try {
      ce.declare('noarg_f', 'function');
      ce.assign('noarg_f', ce.expr(['Function', 42]));
      expect(ce.expr(['noarg_f']).evaluate().valueOf()).toEqual(42);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Mutual recursion between two functions
// ─────────────────────────────────────────────────────────────────────────────
describe('MUTUAL RECURSION', () => {
  test('two mutually recursive functions (even/odd check)', () => {
    // isEven(n) = if n == 0 then True else isOdd(n - 1)
    // isOdd(n)  = if n == 0 then False else isEven(n - 1)
    ce.pushScope();
    try {
      ce.declare('mr_isEven', 'function');
      ce.declare('mr_isOdd', 'function');
      ce.assign(
        'mr_isEven',
        ce.expr([
          'Function',
          [
            'Block',
            ['If', ['Equal', 'mr_en', 0], 'True', ['mr_isOdd', ['Subtract', 'mr_en', 1]]],
          ],
          'mr_en',
        ])
      );
      ce.assign(
        'mr_isOdd',
        ce.expr([
          'Function',
          [
            'Block',
            ['If', ['Equal', 'mr_on', 0], 'False', ['mr_isEven', ['Subtract', 'mr_on', 1]]],
          ],
          'mr_on',
        ])
      );
      // isEven(4) → isOdd(3) → isEven(2) → isOdd(1) → isEven(0) → True
      expect(ce.expr(['mr_isEven', 4]).evaluate().symbol).toEqual('True');
      // isEven(3) → isOdd(2) → isEven(1) → isOdd(0) → False
      expect(ce.expr(['mr_isEven', 3]).evaluate().symbol).toEqual('False');
      // isOdd(5) → isEven(4) → True
      expect(ce.expr(['mr_isOdd', 5]).evaluate().symbol).toEqual('True');
      // isOdd(4) → isEven(3) → False
      expect(ce.expr(['mr_isOdd', 4]).evaluate().symbol).toEqual('False');
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Higher-order functions (function as argument)
// ─────────────────────────────────────────────────────────────────────────────
describe('HIGHER-ORDER FUNCTIONS', () => {
  test('Apply a passed-in function to a value', () => {
    // applyTwice(f, x) = f(f(x))
    // double(x) = x * 2
    // applyTwice(double, 3) = double(double(3)) = double(6) = 12
    ce.pushScope();
    try {
      ce.declare('ho_double', 'function');
      ce.assign('ho_double', ce.expr(['Function', ['Multiply', 'ho_dx', 2], 'ho_dx']));

      ce.declare('ho_applyTwice', 'function');
      ce.assign(
        'ho_applyTwice',
        ce.expr([
          'Function',
          ['Block', ['ho_af', ['ho_af', 'ho_ax']]],
          'ho_af',
          'ho_ax',
        ])
      );

      expect(
        ce.expr(['ho_applyTwice', 'ho_double', 3]).evaluate().valueOf()
      ).toEqual(12);
    } finally {
      ce.popScope();
    }
  });

  test('function returning a function (factory pattern)', () => {
    // makeMultiplier(n) = Function(x, x * n)
    // triple = makeMultiplier(3)
    // triple(5) = 15
    ce.pushScope();
    try {
      ce.declare('mm_make', 'function');
      ce.assign(
        'mm_make',
        ce.expr([
          'Function',
          ['Block', ['Function', ['Block', ['Multiply', 'mm_x', 'mm_n']], 'mm_x']],
          'mm_n',
        ])
      );
      const triple = ce.expr(['mm_make', 3]).evaluate();
      ce.declare('mm_triple', 'function');
      ce.assign('mm_triple', triple);
      expect(ce.expr(['mm_triple', 5]).evaluate().valueOf()).toEqual(15);

      // Different multiplier: quintuple
      const quintuple = ce.expr(['mm_make', 5]).evaluate();
      ce.declare('mm_quint', 'function');
      ce.assign('mm_quint', quintuple);
      expect(ce.expr(['mm_quint', 4]).evaluate().valueOf()).toEqual(20);

      // triple is unaffected by creating quintuple
      expect(ce.expr(['mm_triple', 5]).evaluate().valueOf()).toEqual(15);
    } finally {
      ce.popScope();
    }
  });

  test('map-like pattern: function applied in Sum body', () => {
    // square(x) = x^2
    // Sum(square(k), Limits(k, 1, 4)) = 1 + 4 + 9 + 16 = 30
    ce.pushScope();
    try {
      ce.declare('map_sq', 'function');
      ce.assign('map_sq', ce.expr(['Function', ['Power', 'map_sx', 2], 'map_sx']));
      const result = ce
        .expr(['Sum', ['map_sq', 'map_k'], ['Limits', 'map_k', 1, 4]])
        .evaluate()
        .valueOf();
      expect(result).toEqual(30);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. forget() on constants and undeclared symbols
// ─────────────────────────────────────────────────────────────────────────────
describe('FORGET edge cases', () => {
  test('forget() on a constant does not clear its value', () => {
    ce.pushScope();
    try {
      ce.declare('fgc_c', { type: 'number', value: 42, isConstant: true });
      expect(ce.expr('fgc_c').valueOf()).toEqual(42);
      // forget on a constant should silently not clear the value
      ce.forget('fgc_c');
      expect(ce.expr('fgc_c').valueOf()).toEqual(42);
    } finally {
      ce.popScope();
    }
  });

  test('forget() on an undeclared symbol does not throw', () => {
    ce.pushScope();
    try {
      // Symbol was never declared — forget should be a no-op
      expect(() => ce.forget('fgu_never_declared')).not.toThrow();
    } finally {
      ce.popScope();
    }
  });

  test('forget() clears a non-constant variable', () => {
    ce.pushScope();
    try {
      ce.declare('fgv_x', { type: 'number', value: 10 });
      expect(ce.expr('fgv_x').evaluate().valueOf()).toEqual(10);
      ce.forget('fgv_x');
      // After forget, x should evaluate to itself (symbolic)
      expect(ce.expr('fgv_x').evaluate().json).toEqual('fgv_x');
    } finally {
      ce.popScope();
    }
  });

  test('forget() on a constant preserves type', () => {
    ce.pushScope();
    try {
      ce.declare('fgt_c', { type: 'number', value: 7, isConstant: true });
      ce.forget('fgt_c');
      // The type should still be number
      expect(ce.expr('fgt_c').type.toString()).toEqual('number');
    } finally {
      ce.popScope();
    }
  });

  test('forget() with multiple symbols', () => {
    ce.pushScope();
    try {
      ce.declare('fgm_a', { type: 'number', value: 1 });
      ce.declare('fgm_b', { type: 'number', value: 2 });
      ce.forget(['fgm_a', 'fgm_b']);
      expect(ce.expr('fgm_a').evaluate().json).toEqual('fgm_a');
      expect(ce.expr('fgm_b').evaluate().json).toEqual('fgm_b');
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. isEqual() with scoped expressions
// ─────────────────────────────────────────────────────────────────────────────
describe('ISEQUAL with scoping', () => {
  test('isEqual on two identical constant expressions', () => {
    const a = ce.expr(['Add', 2, 3]);
    const b = ce.expr(['Add', 2, 3]);
    expect(a.isEqual(b)).toBe(true);
  });

  test('isEqual on numerically equal expressions', () => {
    const a = ce.expr(['Add', 2, 3]);
    const b = ce.number(5);
    expect(a.isEqual(b)).toBe(true);
  });

  test('isEqual on expressions with assigned variables', () => {
    ce.pushScope();
    try {
      ce.declare('ieq_x', { type: 'number', value: 3 });
      const a = ce.expr(['Add', 'ieq_x', 2]);
      const b = ce.number(5);
      expect(a.isEqual(b)).toBe(true);
    } finally {
      ce.popScope();
    }
  });

  test('isEqual on expressions with free variables', () => {
    // x + 1 vs x + 1 — structurally same but both have free vars
    ce.pushScope();
    try {
      ce.declare('ieq_v', 'real');
      const a = ce.expr(['Add', 'ieq_v', 1]);
      const b = ce.expr(['Add', 'ieq_v', 1]);
      expect(a.isEqual(b)).toBe(true);
    } finally {
      ce.popScope();
    }
  });

  test('isEqual detects inequality', () => {
    const a = ce.expr(['Add', 2, 3]);
    const b = ce.number(6);
    expect(a.isEqual(b)).toBe(false);
  });

  test('isEqual with scope-dependent variables returns correct result', () => {
    ce.pushScope();
    try {
      ce.declare('ieq_a', { type: 'number', value: 4 });
      // 2 * ieq_a = 8
      const expr = ce.expr(['Multiply', 2, 'ieq_a']);
      expect(expr.isEqual(8)).toBe(true);
      expect(expr.isEqual(9)).toBe(false);
    } finally {
      ce.popScope();
    }
  });

  test('isEqual returns undefined when equality cannot be determined', () => {
    ce.pushScope();
    try {
      ce.declare('ieq_u', 'real');
      // u + 1 vs 5 — u is free, cannot determine
      const a = ce.expr(['Add', 'ieq_u', 1]);
      const result = a.isEqual(5);
      // Should be either false or undefined (not true)
      expect(result).not.toBe(true);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Compilation of BigOp and Block constructs
// ─────────────────────────────────────────────────────────────────────────────
describe('COMPILE: BigOp and Block', () => {
  test('Sum compilation produces correct code', () => {
    // f(n) = Sum(k, Limits(k, 1, n))
    const f = ce.expr([
      'Function',
      ['Sum', 'cs_k', ['Limits', 'cs_k', 1, 'cs_n']],
      'cs_n',
    ]);
    const result = compile(f);
    expect(result?.calling).toBe('lambda');
    // Sum(k, k=1..5) = 15
    expect(result?.run!(5)).toBe(15);
    // Sum(k, k=1..10) = 55
    expect(result?.run!(10)).toBe(55);
  });

  test('Sum compilation matches CE evaluation', () => {
    const f = ce.expr([
      'Function',
      ['Sum', 'csm_k', ['Limits', 'csm_k', 1, 'csm_n']],
      'csm_n',
    ]);
    ce.pushScope();
    try {
      ce.declare('csm_f', 'function');
      ce.assign('csm_f', f);
      const ceResult = ce.expr(['csm_f', 6]).evaluate().valueOf();
      expect(compile(f)?.run!(6)).toBe(ceResult);
    } finally {
      ce.popScope();
    }
  });

  test('Product compilation produces correct code', () => {
    // f(n) = Product(k, Limits(k, 1, n)) — factorial
    const f = ce.expr([
      'Function',
      ['Product', 'cp_k', ['Limits', 'cp_k', 1, 'cp_n']],
      'cp_n',
    ]);
    const result = compile(f);
    expect(result?.calling).toBe('lambda');
    // Product(k, k=1..5) = 120
    expect(result?.run!(5)).toBe(120);
    // Product(k, k=1..3) = 6
    expect(result?.run!(3)).toBe(6);
  });

  test('Product compilation matches CE evaluation', () => {
    const f = ce.expr([
      'Function',
      ['Product', 'cpm_k', ['Limits', 'cpm_k', 1, 'cpm_n']],
      'cpm_n',
    ]);
    ce.pushScope();
    try {
      ce.declare('cpm_f', 'function');
      ce.assign('cpm_f', f);
      const ceResult = ce.expr(['cpm_f', 4]).evaluate().valueOf();
      expect(compile(f)?.run!(4)).toBe(ceResult);
    } finally {
      ce.popScope();
    }
  });

  test('Sum with expression body compiles correctly', () => {
    // f(n) = Sum(k^2, Limits(k, 1, n))
    const f = ce.expr([
      'Function',
      ['Sum', ['Power', 'csb_k', 2], ['Limits', 'csb_k', 1, 'csb_n']],
      'csb_n',
    ]);
    const result = compile(f);
    // Sum(k^2, k=1..4) = 1 + 4 + 9 + 16 = 30
    expect(result?.run!(4)).toBe(30);
  });

  test('Block with local variable compiles correctly', () => {
    // f(x) = Block(Declare(t, number), Assign(t, x+1), Multiply(t, 2))
    // f(4) = (4+1)*2 = 10
    const f = ce.expr([
      'Function',
      [
        'Block',
        ['Declare', 'cbl_t', 'number'],
        ['Assign', 'cbl_t', ['Add', 'cbl_x', 1]],
        ['Multiply', 'cbl_t', 2],
      ],
      'cbl_x',
    ]);
    const result = compile(f);
    expect(result?.run!(4)).toBe(10);
    expect(result?.run!(0)).toBe(2);
  });

  test('Block compilation matches CE evaluation', () => {
    const f = ce.expr([
      'Function',
      [
        'Block',
        ['Declare', 'cblm_t', 'number'],
        ['Assign', 'cblm_t', ['Add', 'cblm_x', 1]],
        ['Multiply', 'cblm_t', 2],
      ],
      'cblm_x',
    ]);
    ce.pushScope();
    try {
      ce.declare('cblm_f', 'function');
      ce.assign('cblm_f', f);
      const ceResult = ce.expr(['cblm_f', 7]).evaluate().valueOf();
      expect(compile(f)?.run!(7)).toBe(ceResult);
    } finally {
      ce.popScope();
    }
  });

  test('compiled Sum generates loop code (IIFE)', () => {
    const f = ce.expr([
      'Function',
      ['Sum', 'csc_k', ['Limits', 'csc_k', 1, 'csc_n']],
      'csc_n',
    ]);
    const result = compile(f);
    // The Sum should compile to a loop inside an IIFE
    expect(result?.code).toContain('while');
    expect(result?.code).toContain('+=');
  });

  test('compiled Product generates loop code (IIFE)', () => {
    const f = ce.expr([
      'Function',
      ['Product', 'cpc_k', ['Limits', 'cpc_k', 1, 'cpc_n']],
      'cpc_n',
    ]);
    const result = compile(f);
    expect(result?.code).toContain('while');
    expect(result?.code).toContain('*=');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Scope behavior with ce.parse() (LaTeX input)
//
// LaTeX parsing treats juxtaposed characters as implicit multiplication
// (e.g., "px" → p*x), so we use single-character variable names here.
// ─────────────────────────────────────────────────────────────────────────────
describe('SCOPE WITH ce.parse()', () => {
  test('parse a symbol and evaluate it in scope', () => {
    ce.pushScope();
    try {
      ce.declare('u', { type: 'number', value: 7 });
      const expr = ce.parse('u + 3');
      expect(expr.evaluate().valueOf()).toEqual(10);
    } finally {
      ce.popScope();
    }
  });

  test('parsed expression respects scope chain', () => {
    ce.pushScope();
    try {
      ce.declare('w', { type: 'number', value: 5 });
      ce.pushScope();
      try {
        ce.declare('w', { type: 'number', value: 10 });
        const expr = ce.parse('w \\times 2');
        // Inner scope: w=10, so w*2 = 20
        expect(expr.evaluate().valueOf()).toEqual(20);
      } finally {
        ce.popScope();
      }
      // Outer scope: w=5
      const expr2 = ce.parse('w \\times 2');
      expect(expr2.evaluate().valueOf()).toEqual(10);
    } finally {
      ce.popScope();
    }
  });

  test('parsed Sum evaluates in scope', () => {
    ce.pushScope();
    try {
      // Use \operatorname for multi-char symbol, or declare a single-char
      ce.declare('N', { type: 'number', value: 4 });
      // Sum(k, k=1..N)
      const expr = ce.parse('\\sum_{k=1}^{N} k');
      expect(expr.evaluate().valueOf()).toEqual(10);
    } finally {
      ce.popScope();
    }
  });

  test('parsed function definition and call', () => {
    ce.pushScope();
    try {
      ce.declare('g', 'function');
      ce.assign('g', ce.expr(['Function', ['Multiply', 'v', 2], 'v']));
      // Call g(5) via box
      expect(ce.expr(['g', 5]).evaluate().valueOf()).toEqual(10);
    } finally {
      ce.popScope();
    }
  });

  test('parsed expression with assume()', () => {
    ce.pushScope();
    try {
      ce.declare('s', 'real');
      ce.assume(ce.expr(['Greater', 's', 0]));
      const expr = ce.expr('s');
      expect(expr.evaluate().sgn).toBe('positive');
    } finally {
      ce.popScope();
    }
  });

  test('parsed expression loses scope visibility after popScope', () => {
    ce.pushScope();
    try {
      ce.declare('r', { type: 'number', value: 42 });
      const expr = ce.parse('r + 1');
      expect(expr.evaluate().valueOf()).toEqual(43);
    } finally {
      ce.popScope();
    }
    // After popScope, r is no longer declared — expression evaluates symbolically
    const result = ce.parse('r + 1').evaluate();
    // r is now unbound, so the result should not be 43
    expect(result.valueOf()).not.toEqual(43);
  });
});
