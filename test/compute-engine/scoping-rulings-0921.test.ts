/**
 * Two scoping decisions of 2026-09-21, pinned on the interpreter and on the
 * compiled route together.
 *
 * Ruling A — a stored symbol value keeps the binding it was written against.
 * With `a := 3t + 1` and `g := t ↦ t + a`, the `t` inside the value of `a` is
 * the GLOBAL `t`, not `g`'s parameter. The interpreter already read it that
 * way; the compiler folded the value of `a` inline into the emitted body of
 * `g`, where the parameter `t` captured it. The compiled route now binds such
 * a value in the preamble, outside the emitted function, so both routes read
 * the global.
 *
 * Ruling B — a binder of the CALLER never intercepts a global read inside the
 * body of the function it calls. With `w` declared and valueless and
 * `W := x ↦ [w x, x]`, the `w` inside the body of `W` names the global for
 * every caller, so `[W(w)[1] for w in [1,2,3]]` answers `[w, 2w, 3w]`, the
 * same answer the spelling `[W(k)[1] for k in [1,2,3]]` gives. Before this
 * decision the comprehension binder was read by name and the answer was
 * `[1, 4, 9]`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('Ruling A: a folded symbol value reads the global, not the parameter', () => {
  // `a := 3t + 1`, `g := t ↦ t + a`.
  const withG = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('3t+1'));
    ce.assign('g', ce.parse('t \\mapsto t + a'));
    return ce;
  };

  test('interpreter: the `t` of the stored value stays the global', () => {
    const ce = withG();
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('3t + 3');
  });

  test('interpreter: with `t := 5` the answer is 18', () => {
    const ce = withG();
    ce.assign('t', 5);
    expect(ce.box(['g', 2]).evaluate().re).toBe(18);
  });

  test('compiled: the folded value is bound outside the emitted function', () => {
    const ce = withG();
    const r = compile(ce.box(['g', 2]), { to: 'javascript' });
    // The parameter of `_fn_g` must not be the `t` the folded value reads.
    expect(r.preamble).toContain('_.t');
    expect(r.run!({ t: 5 })).toBe(18);
  });

  test('compiled: a global `t` with a value folds to the same answer', () => {
    const ce = withG();
    ce.assign('t', 5);
    const r = compile(ce.box(['g', 2]), { to: 'javascript' });
    expect(r.run!({})).toBe(18);
  });

  test('compiled: the run-time input `t` is surfaced as a free symbol', () => {
    const ce = withG();
    const r = compile(ce.box(['g', 2]), { to: 'javascript' });
    expect(r.freeSymbols).toContain('t');
  });

  test('a LEAF value is folded inline but still reads the global', () => {
    // `a := t` is a bare symbol, so it is no shorter as a preamble local
    // than as itself and stays inline. It must still resolve `t` where it
    // was written — the emitted body reads `_.t`, not its parameter.
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('t'));
    ce.assign('g', ce.parse('t \\mapsto t + a'));
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('t + 2');
    const r = compile(ce.box(['g', 2]), { to: 'javascript' });
    expect(r.preamble).toContain('const _fn_g = (t) => _.t + t;');
    expect(r.freeSymbols).toContain('t');
    expect(r.run!({ t: 5 })).toBe(7);
  });

  test('a LEAF value under a Sum index of the same name reads the global', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    ce.assign('a', ce.parse('n'));
    const expr = ce.box(['Sum', 'a', ['Limits', 'n', 1, 3]]);
    expect(expr.evaluate().toString()).toBe('3n');
    const r = compile(expr, { to: 'javascript' });
    expect(r.freeSymbols).toContain('n');
    expect(r.run!({ n: 4 })).toBe(12);
  });
});

describe('Ruling B: a caller’s binder never intercepts a global read in a callee body', () => {
  // `w` is declared real and valueless; `W := x ↦ [w x, x]`.
  const withW = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declare('w', 'real');
    ce.assign(
      'W',
      ce.box(['Function', ['List', ['Multiply', 'w', 'x'], 'x'], 'x'])
    );
    return ce;
  };

  const comprehension = (index: string) => [
    'Comprehension',
    ['At', ['W', index], 1],
    ['Element', index, ['List', 1, 2, 3]],
  ];

  test('a comprehension binder named `w` reads the global inside W', () => {
    const ce = withW();
    expect(ce.box(comprehension('w')).evaluate().toString()).toBe('[w,2w,3w]');
  });

  test('a comprehension binder named `k` answers the same', () => {
    const ce = withW();
    expect(ce.box(comprehension('k')).evaluate().toString()).toBe('[w,2w,3w]');
  });

  test('a Sum binder named `w` answers 6w', () => {
    const ce = withW();
    expect(
      ce
        .box(['Sum', ['At', ['W', 'w'], 1], ['Limits', 'w', 1, 3]])
        .evaluate()
        .toString()
    ).toBe('6w');
  });

  test('a lambda parameter named `w` is unchanged', () => {
    const ce = withW();
    expect(
      ce
        .box(['Apply', ['Function', ['At', ['W', 'w'], 1], 'w'], 2])
        .evaluate()
        .toString()
    ).toBe('2w');
  });

  test('an ASSIGNED global `w` is unchanged — the binder never intercepted it', () => {
    const ce = withW();
    ce.assign('w', 2.5);
    expect(ce.box(comprehension('w')).evaluate().toString()).toBe(
      '[2.5,5,7.5]'
    );
  });

  test('the compiled route agrees, with and without constant folding', () => {
    const ce = withW();
    const folded = compile(ce.box(comprehension('w')), { to: 'javascript' });
    expect(folded.run!({ w: 10 })).toEqual([10, 20, 30]);
    const raw = compile(ce.box(comprehension('w')), {
      to: 'javascript',
      constantFold: false,
    });
    expect(raw.run!({ w: 10 })).toEqual([10, 20, 30]);
  });

  test('a stored value’s free name is not captured by a same-named Sum index', () => {
    // `a := n + 1` inside `Sum_{n=1}^{3} a`: the `n` of the stored value is
    // the global one, so the sum is `3(n + 1)`, not `2 + 3 + 4`.
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    ce.assign('a', ce.parse('n + 1'));
    expect(
      ce.box(['Sum', 'a', ['Limits', 'n', 1, 3]]).evaluate().toString()
    ).toBe('3n + 3');
  });
});
