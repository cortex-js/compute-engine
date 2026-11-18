import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A function declared with a real result (`p: (real) -> real`) has a body
 * wrapped in a real ascription, `Typed(body, 'real')`. Under the `complex`
 * compile mode, an unknown-sign `Sqrt`, `Ln`, `Log`, even `Root` or
 * non-integer `Power` PROMOTES: it lowers through a complex kernel, and the
 * value of the body becomes a `{re, im}` object. Under `mode: 'strict'`, the
 * default, it stays on the real lane.
 *
 * When the body is complex only because of that promotion, the declared real
 * result selects the real lane for the body: the body compiles with promotion
 * off, as `mode: 'strict'` compiles it, and gives NaN outside the real domain
 * of the promotable head. This is the same value as `mode: 'strict'`, and
 * the same reading as a real-typed symbol: the type `real` excludes NaN, and
 * NaN is the value of a real result that has no real value.
 *
 * When the body is complex because of an operand that is complex also with
 * promotion off (a complex-typed argument, a call of a function whose
 * definition is complex), the real ascription contradicts the value, and the
 * compilation declines.
 *
 * Decision: Compute Engine ROADMAP entry "The default `auto` mode puts a
 * real-valued plot kernel on the complex lane", option 2. (The mode `auto`
 * was removed later; the rule applies to `mode: 'complex'`.)
 */

const BODY: any = [
  'Function',
  [
    'Multiply',
    ['Sin', ['Multiply', 2.4, 'k']],
    ['Sqrt', ['Divide', ['Subtract', 'k', 0.5], 16]],
  ],
  'k',
];

function engineWith(signature: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('p', signature);
  ce.assign('p', ce.box(BODY));
  return ce;
}

function compileP(
  ce: ComputeEngine,
  mode?: 'strict' | 'complex'
): any {
  return compile(ce.box(['Add', ['p', 3], ['p', 'x']]), {
    to: 'javascript',
    fallback: false,
    ...(mode ? { mode } : {}),
  } as any);
}

describe('A declared real result selects the real lane', () => {

  it('strict (default): the value at a point of the real domain is the value of N()', () => {
    const ce = engineWith('(real) -> real');
    const r = compileP(ce);
    const expected = ce.box(['Add', ['p', 3], ['p', 5]]).N().re;
    const actual = r.run({ x: 5 });
    expect(typeof actual).toBe('number');
    expect(actual).toBeCloseTo(expected, 12);
  });

  it('complex: `-> number` admits a complex value, and the body promotes', () => {
    const ce = engineWith('(real) -> number');
    const r = compileP(ce, 'complex');
    expect(r.success).toBe(true);
    // √((0.25 − 0.5)/16) is imaginary and sin(0.6) is not zero: the value
    // is a `{re, im}` object.
    const v = r.run({ x: 0.25 });
    expect(typeof v).toBe('object');
    expect(v.im).toBeCloseTo(Math.sin(0.6) * Math.sqrt(0.25 / 16), 12);
  });

  it('complex: a body that is real with promotion on keeps its promotion', () => {
    // `|√k|` is real for every real `k`: the ascription does not change its
    // lane, so the promoted `√k` stays, and `|√(−4)|` is 2, as the
    // interpreter computes it.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('h', '(real) -> real');
    ce.assign('h', ce.box(['Function', ['Abs', ['Sqrt', 'k']], 'k']));
    const r = compile(ce.box(['h', 'x']), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.run({ x: -4 })).toBeCloseTo(2, 12);
  });
});

describe('A constant call of a function with a real result', () => {
  // `p(0)` is `√(−1)`. The interpreter ignores the real ascription and
  // evaluates it to `i`, but the compiled definition is on the real lane and
  // gives NaN. The constant call is not folded to `i`: it calls the
  // definition, as the call `p(x)` does.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('p', '(real) -> real');
    ce.assign('p', ce.box(['Function', ['Sqrt', ['Subtract', 'k', 1]], 'k']));
    return ce;
  }

  it('alone, the value is NaN, as for p(x) at x = 0', () => {
    const ce = engine();
    const r = compile(ce.box(['p', 0]), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(Number.isNaN(r.run({}))).toBe(true);
  });
});

describe('A real result over a value that is complex without promotion', () => {

  it('the declaration of `g` alone still compiles on the complex lane', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('g', '(real) -> number');
    ce.assign('g', ce.box(['Function', ['Sqrt', 'k'], 'k']));
    const r = compile(ce.box(['g', 'x']), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.run({ x: -4 })).toEqual({ re: 0, im: 2 });
  });
});

// In `mode: 'complex'`, a promotion must follow the code that is emitted.
// The analysis that decides the lane of a node (`isComplexValued`) also
// reads the promotable heads of subtrees that are never emitted: a subtree
// that the constant fold replaces with a literal, or the argument of a call
// that is then inlined in the value of a real ascription. Only the emission
// of a promotable head, or a constant fold that gives a complex literal only
// because the head promotes, puts a value on the complex lane.
describe('A promotion follows the emitted code', () => {

  it('a sum folded to a complex literal only by promotion is promoted', () => {
    // `Σ cos k` for k = 1..5 is −1.2358…: `strict` gives NaN, `complex` folds
    // the square root to the complex literal `1.1116…i`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = [
      'Add',
      'x',
      ['Sqrt', ['Sum', ['Cos', 'k'], ['Limits', 'k', 1, 5]]],
    ];
    const r = compile(ce.box(expr as any), {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.mode).toBe('complex');
    const v = r.run({ x: 1 });
    const expected = ce
      .box(expr as any)
      .subs({ x: 1 })
      .N();
    expect(v.re).toBeCloseTo(expected.re, 12);
    expect(v.im).toBeCloseTo(expected.im, 12);
    const strict = compile(ce.box(expr as any), {
      to: 'javascript',
      fallback: false,
      mode: 'strict',
    } as any) as any;
    expect(Number.isNaN(strict.run({ x: 1 }))).toBe(true);
  });

  it('a call folded to a complex literal only by promotion is promoted', () => {
    // The promotion is in the body of `g`, which the fold reads: `g(3)` is
    // `√(−2)`, NaN under `strict`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('g', ce.box(['Function', ['Sqrt', ['Subtract', 'k', 5]], 'k']));
    const expr = ce.box(['Add', 'x', ['g', 3]]);
    const r = compile(expr, {
      to: 'javascript',
      fallback: false,
      mode: 'complex',
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.run({ x: 1 })).toEqual({ re: 1, im: Math.SQRT2 });
    const strict = compile(expr, {
      to: 'javascript',
      fallback: false,
      mode: 'strict',
    } as any) as any;
    expect(Number.isNaN(strict.run({ x: 1 }))).toBe(true);
  });
});
