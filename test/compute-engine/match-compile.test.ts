import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * Phase 4 of the Cortex `match` design
 * (docs/plans/2026-07-12-cortex-match-design.md §5): `compile()` support for the
 * `Match` head. Tier 0/1 (constant / literal / pin-of-constant) compile to
 * chained ternaries (or an integer `switch` on JS), tier 2 (fixed-shape
 * `List`/`Tuple`) to arrow-IIFE destructuring on JS; tier 3 and anything a
 * target cannot express fail closed (D6).
 *
 * COMPILED-vs-INTERPRETED FLOAT SEAM (accepted, §4 Phase-2 note): number leaves
 * are compared in compiled code with the target's native `===`/`==`, NOT the
 * interpreter's tolerant `isEqual`. So `Match(1/3, MatchCase(0.3333, …))` may
 * select a different case interpreted (tolerant) than compiled (exact `===`) —
 * the same float-equality seam compiled `Which` already carries. All tests
 * below use exactly-representable constants where the two paths coincide.
 */

const ce = new ComputeEngine();

describe('COMPILE Match — JavaScript tier 0/1', () => {
  it('compiles constant + or-alternative + pin-of-Pi to chained ternaries', () => {
    const expr: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', ['Alternatives', 1, 2], { str: 'small' }],
      ['MatchCase', ['Pin', 'Pi'], { str: 'pi' }],
      ['MatchCase', '_', { str: 'other' }],
    ];
    const r = compile(ce.box(expr), { fallback: false });
    expect(r.success).toBe(true);
    // Subject bound once in an arrow-IIFE, `===` comparisons, `Math.PI` folded.
    expect(r.code).toContain('=== 1');
    expect(r.code).toContain('Math.PI');
    expect(r.run!({ x: 1 })).toBe('small');
    expect(r.run!({ x: 2 })).toBe('small');
    expect(r.run!({ x: Math.PI })).toBe('pi');
    expect(r.run!({ x: 9 })).toBe('other');
  });

  it('matches the interpreter for numeric bodies (incl. capture)', () => {
    const cases: MathJsonExpression[] = [
      ['MatchCase', 0, 100],
      ['MatchCase', 1, 200],
      ['MatchCase', ['Pin', 'Pi'], 300],
      ['MatchCase', '_n', ['Multiply', 'n', 'n']],
    ];
    const tmpl = (subj: MathJsonExpression): MathJsonExpression => [
      'Match',
      subj,
      ...cases,
    ];
    const r = compile(ce.box(tmpl('x')), { fallback: false });
    expect(r.success).toBe(true);
    for (const [subj, x] of [
      [0, 0],
      [1, 1],
      ['Pi', Math.PI],
      [5, 5],
    ] as [MathJsonExpression, number][]) {
      const interpreted = ce.box(tmpl(subj)).evaluate().re;
      expect(r.run!({ x })).toBe(interpreted);
    }
  });

  it('evaluates the subject once (bound as an IIFE parameter)', () => {
    // A compound subject compiles once into the IIFE parameter, not per branch.
    const expr: MathJsonExpression = [
      'Match',
      ['Add', 'x', 1],
      ['MatchCase', 2, 20],
      ['MatchCase', 3, 30],
      ['MatchCase', '_', -1],
    ];
    const r = compile(ce.box(expr), { fallback: false });
    // `x + 1` appears exactly once — as the IIFE argument.
    expect(r.code.match(/_\.x \+ 1/g)!.length).toBe(1);
    expect(r.run!({ x: 1 })).toBe(20);
    expect(r.run!({ x: 2 })).toBe(30);
    expect(r.run!({ x: 9 })).toBe(-1);
  });

  it('returns NaN when no case matches and there is no catch-all', () => {
    const expr: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', 1, 10],
      ['MatchCase', 2, 20],
    ];
    const r = compile(ce.box(expr), { fallback: false });
    expect(r.run!({ x: 1 })).toBe(10);
    expect(r.run!({ x: 5 })).toBeNaN();
  });
});

describe('COMPILE Match — JavaScript switch threshold', () => {
  it('emits an integer switch above ~8 constant cases and executes correctly', () => {
    const cases: MathJsonExpression[] = [];
    for (let i = 1; i <= 9; i++) cases.push(['MatchCase', i, i * 10]);
    cases.push(['MatchCase', '_', -1]);
    const r = compile(ce.box(['Match', 'x', ...cases]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('switch');
    expect(r.run!({ x: 1 })).toBe(10);
    expect(r.run!({ x: 9 })).toBe(90);
    expect(r.run!({ x: 99 })).toBe(-1);
  });

  it('stays a ternary chain below the switch threshold', () => {
    const cases: MathJsonExpression[] = [];
    for (let i = 1; i <= 4; i++) cases.push(['MatchCase', i, i * 10]);
    cases.push(['MatchCase', '_', -1]);
    const r = compile(ce.box(['Match', 'x', ...cases]), { fallback: false });
    expect(r.code).not.toContain('switch');
    expect(r.run!({ x: 3 })).toBe(30);
  });

  it('or-alternatives share a switch body via case-fallthrough', () => {
    const cases: MathJsonExpression[] = [
      ['MatchCase', ['Alternatives', 1, 2, 3], 1],
      ['MatchCase', ['Alternatives', 4, 5, 6], 2],
      ['MatchCase', ['Alternatives', 7, 8, 9], 3],
      ['MatchCase', '_', 0],
    ];
    const r = compile(ce.box(['Match', 'x', ...cases]), { fallback: false });
    expect(r.code).toContain('switch');
    expect(r.run!({ x: 2 })).toBe(1);
    expect(r.run!({ x: 6 })).toBe(2);
    expect(r.run!({ x: 9 })).toBe(3);
    expect(r.run!({ x: 10 })).toBe(0);
  });
});

describe('COMPILE Match — JavaScript tier 2 destructuring', () => {
  it('destructures a fixed-shape list with a rest and a guard', () => {
    const expr: MathJsonExpression = [
      'Match',
      'xs',
      // [a, b] with a > b → a - b
      ['MatchCase', ['List', '_a', '_b'], ['Greater', 'a', 'b'], ['Subtract', 'a', 'b']],
      // [first, ...rest] → first
      ['MatchCase', ['List', '_first', '___rest'], 'first'],
      ['MatchCase', '_', -1],
    ];
    const r = compile(ce.box(expr), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('Array.isArray');
    expect(r.run!({ xs: [5, 2] } as any)).toBe(3); // guard holds
    expect(r.run!({ xs: [2, 5] } as any)).toBe(2); // guard fails → next case, first
    expect(r.run!({ xs: [7, 8, 9] } as any)).toBe(7);
    expect(r.run!({ xs: 42 } as any)).toBe(-1); // not an array → catch-all
  });

  it('binds a trailing `_n` catch-all to the whole subject', () => {
    const expr: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', 0, 0],
      ['MatchCase', '_n', ['Add', 'n', 1]],
    ];
    const r = compile(ce.box(expr), { fallback: false });
    expect(r.run!({ x: 0 })).toBe(0);
    expect(r.run!({ x: 41 })).toBe(42);
  });
});

describe('COMPILE Match — fail closed (D6)', () => {
  it('fails closed on an operator (tier-3) pattern, naming it', () => {
    const expr: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', ['Add', '_a', 1], 'a'],
      ['MatchCase', '_', 0],
    ];
    expect(() => compile(ce.box(expr), { fallback: false })).toThrow(
      /not compilable/
    );
    // The engine-level fallback reports success:false with the reason.
    const r = compile(ce.box(expr));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not compilable/);
  });

  it('fails closed on a pin of a runtime variable', () => {
    ce.declare('threshold', 'number');
    const expr: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', ['Pin', 'threshold'], 1],
      ['MatchCase', '_', 0],
    ];
    expect(() => compile(ce.box(expr), { fallback: false })).toThrow(
      /runtime value/
    );
  });

  it('fails closed on an or-alternative that binds a name', () => {
    const expr: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', ['Alternatives', '_a', 0], 'a'],
      ['MatchCase', '_', 0],
    ];
    expect(() => compile(ce.box(expr), { fallback: false })).toThrow(
      /or-alternative binds/
    );
  });
});

describe('COMPILE Match — GPU targets', () => {
  const m: MathJsonExpression = [
    'Match',
    'x',
    ['MatchCase', ['Alternatives', 1, 2], 10],
    ['MatchCase', 3, 30],
    ['MatchCase', '_', -1],
  ];

  it('compiles tier 0/1 to GLSL ternaries with == comparisons', () => {
    const r = compile(ce.box(m), { to: 'glsl', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('==');
    expect(r.code).toContain('?');
  });

  it('compiles tier 0/1 to a WGSL select chain', () => {
    const r = compile(ce.box(m), { to: 'wgsl', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('select');
  });

  it('fails closed on a string constant (no string type)', () => {
    const expr: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', { str: 'a' }, 1],
      ['MatchCase', '_', 0],
    ];
    expect(() => compile(ce.box(expr), { to: 'glsl', fallback: false })).toThrow(
      /string constant/
    );
  });

  it('fails closed on tier-2 list destructuring', () => {
    const expr: MathJsonExpression = [
      'Match',
      'xs',
      ['MatchCase', ['List', '_a', '_b'], 'a'],
      ['MatchCase', '_', 0],
    ];
    expect(() => compile(ce.box(expr), { to: 'glsl', fallback: false })).toThrow(
      /destructuring/
    );
  });
});

describe('COMPILE Match — interval-js and Python fail closed', () => {
  const m: MathJsonExpression = [
    'Match',
    'x',
    ['MatchCase', 1, 10],
    ['MatchCase', '_', -1],
  ];

  it('interval-js reports failure (no interval-Which treatment invented, §5)', () => {
    const r = compile(ce.box(m), { to: 'interval-js' });
    expect(r.success).toBe(false);
  });

  it('Python fails closed', () => {
    expect(() => compile(ce.box(m), { to: 'python', fallback: false })).toThrow(
      /not supported by the Python/
    );
  });
});

describe('COMPILE Match — reference analysis (compile probe)', () => {
  it('reports the real free symbols, not wildcards or MatchCase', () => {
    // Subject `x`; pin references `Pi` (folded constant → not free); captures `n`
    // shadow the body. The only external input is `x`.
    const expr: MathJsonExpression = [
      'Match',
      'x',
      ['MatchCase', ['Pin', 'Pi'], 1],
      ['MatchCase', '_n', ['Multiply', 'n', 'n']],
    ];
    const r = compile(ce.box(expr), { fallback: false });
    expect(r.freeSymbols).toEqual(['x']);
    expect(r.unsupported).toEqual([]);
  });

  it('surfaces a pinned runtime variable as a free symbol', () => {
    ce.declare('lim', 'number');
    // A pin of a runtime var makes it a genuine external reference; compilation
    // still fails closed, but the reference analysis must list it.
    const expr: MathJsonExpression = [
      'Match',
      'y',
      ['MatchCase', ['Pin', 'lim'], 1],
      ['MatchCase', '_', 0],
    ];
    const r = compile(ce.box(expr)); // fallback path computes analyzeReferences
    expect(r.freeSymbols?.sort()).toEqual(['lim', 'y']);
  });
});
