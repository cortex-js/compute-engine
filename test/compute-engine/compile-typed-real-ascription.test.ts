import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A function declared with a real result (`p: (real) -> real`) has a body
 * wrapped in a real ascription, `Typed(body, 'real')`. Under the `auto` and
 * `complex` compile modes, an unknown-sign `Sqrt`, `Ln`, `Log`, even `Root`
 * or non-integer `Power` PROMOTES: it lowers through a complex kernel, and the
 * value of the body becomes a `{re, im}` object.
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
 * real-valued plot kernel on the complex lane", option 2.
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
  mode?: 'auto' | 'strict' | 'complex'
): any {
  return compile(ce.box(['Add', ['p', 3], ['p', 'x']]), {
    to: 'javascript',
    fallback: false,
    ...(mode ? { mode } : {}),
  } as any);
}

const REAL_DEFINITION =
  'const _fn_p = (k) => Math.sin(2.4 * k) * Math.sqrt(0.0625 * (k + -0.5));';

describe('A declared real result selects the real lane', () => {
  it('auto (default): the body compiles on the real lane, not promoted', () => {
    const ce = engineWith('(real) -> real');
    const r = compileP(ce);
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(false);
    expect(r.mode).toBe('strict');
    expect(r.preamble.trim()).toBe(REAL_DEFINITION);
    expect(r.code).toBe('_fn_p(_.x) + 0.31372476943046695');
  });

  it('auto: the value at a point of the real domain is the value of N()', () => {
    const ce = engineWith('(real) -> real');
    const r = compileP(ce);
    const expected = ce.box(['Add', ['p', 3], ['p', 5]]).N().re;
    const actual = r.run({ x: 5 });
    expect(typeof actual).toBe('number');
    expect(actual).toBeCloseTo(expected, 12);
  });

  it('auto: outside the real domain the value is NaN, as in strict mode', () => {
    const ce = engineWith('(real) -> real');
    const auto = compileP(ce);
    const strict = compileP(ce, 'strict');
    expect(Number.isNaN(auto.run({ x: 0 }))).toBe(true);
    expect(Number.isNaN(strict.run({ x: 0 }))).toBe(true);
    // The same code as strict mode
    expect(auto.preamble).toBe(strict.preamble);
    expect(auto.code).toBe(strict.code);
  });

  it('complex: a declared real result is real in this mode too', () => {
    const ce = engineWith('(real) -> real');
    const r = compileP(ce, 'complex');
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(false);
    expect(r.code).not.toMatch(/_SYS\.csqrt|re:/);
    const v5 = r.run({ x: 5 });
    expect(typeof v5).toBe('number');
    expect(v5).toBeCloseTo(ce.box(['Add', ['p', 3], ['p', 5]]).N().re, 12);
    expect(Number.isNaN(r.run({ x: 0 }))).toBe(true);
  });

  for (const result of ['finite_real', 'nan | real'])
    it(`auto: the spelling \`-> ${result}\` is a real result`, () => {
      const ce = engineWith(`(real) -> ${result}`);
      const r = compileP(ce);
      expect(r.success).toBe(true);
      expect(r.promoted).toBe(false);
      expect(r.preamble.trim()).toBe(REAL_DEFINITION);
      expect(Number.isNaN(r.run({ x: 0 }))).toBe(true);
    });

  it('auto: `-> number` admits a complex value, and the body promotes', () => {
    const ce = engineWith('(real) -> number');
    const r = compileP(ce);
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(true);
    // √((0.25 − 0.5)/16) is imaginary and sin(0.6) is not zero: the value
    // is a `{re, im}` object.
    const v = r.run({ x: 0.25 });
    expect(typeof v).toBe('object');
    expect(v.im).toBeCloseTo(Math.sin(0.6) * Math.sqrt(0.25 / 16), 12);
  });

  it('auto: a body that is real with promotion on keeps its promotion', () => {
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
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(true);
    expect(r.run({ x: -4 })).toBeCloseTo(2, 12);
  });

  it('auto: a subexpression shared with the code around the ascription is not shared across it', () => {
    // `√(x − 1)` occurs outside the ascription (promoted) and inside it
    // (real lane). A temporary bound for one of them must not be read for
    // the other.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box([
      'Add',
      ['Sqrt', ['Subtract', 'x', 1]],
      ['Typed', ['Multiply', 2, ['Sqrt', ['Subtract', 'x', 1]]], "'real'"],
    ]);
    const r = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.code).toContain('2 * Math.sqrt(_.x + -1)');
    expect(r.run({ x: 5 })).toEqual(6);
    // Outside the real domain: the ascribed term is NaN, the promoted term
    // is `i`.
    const v0 = r.run({ x: 0 });
    expect(Number.isNaN(v0.re)).toBe(true);
    expect(v0.im).toBeCloseTo(1, 12);
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

  it('in a sum, the value is NaN, not a string', () => {
    const ce = engine();
    const r = compile(ce.box(['Add', ['p', 0], 'x']), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.code).not.toMatch(/re:/);
    expect(r.code).toBe('_.x + _fn_p(0)');
    expect(Number.isNaN(r.run({ x: 0 }))).toBe(true);
  });

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

describe('A helper called inside the value of a real ascription', () => {
  // The value `√y · Σ g(k)` is complex with promotion on (`√y`), so it
  // compiles with promotion off. The definition of `g` is shared by every
  // call, so it compiles with the promotion of the mode, and the choice of
  // that definition must also be made for the mode, not for the call site.
  const G: any = [
    'Function',
    ['Sqrt', ['Divide', ['Subtract', 'k', 0.5], 16]],
    'k',
  ];

  it('a helper specialized to the range of a Sum index compiles real', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('p', '(real) -> real');
    ce.assign('g', ce.box(G));
    ce.assign(
      'p',
      ce.box([
        'Function',
        [
          'Multiply',
          ['Sqrt', 'y'],
          ['Sum', ['g', 'k'], ['Limits', 'k', 1, 16]],
        ],
        'y',
      ])
    );
    // Without `constantFold: false`, the constant `Sum` folds to a number
    // and no definition of `g` is emitted.
    const r = compile(ce.box(['p', 'x']), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(false);
    expect(r.preamble).not.toMatch(/csqrt/);
    expect(r.preamble).toContain(
      'const _fn_g_integer_1___ = (k) => Math.sqrt(0.0625 * (k + -0.5));'
    );
    expect(r.run({ x: 2 })).toBeCloseTo(ce.box(['p', 2]).N().re, 12);
  });

  it('a helper with a declared narrower parameter type compiles real', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('p', '(real) -> real');
    ce.declare('g', '(integer<1..16>) -> unknown');
    ce.assign('g', ce.box(G));
    ce.assign(
      'p',
      ce.box([
        'Function',
        ['Multiply', ['Sqrt', 'y'], ['g', ['Floor', 'y']]],
        'y',
      ])
    );
    const r = compile(ce.box(['p', 'x']), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(false);
    expect(r.preamble).not.toMatch(/csqrt/);
    expect(r.preamble).toContain(
      'const _fn_g = (k) => Math.sqrt(0.0625 * (k + -0.5));'
    );
    expect(r.run({ x: 2 })).toBeCloseTo(ce.box(['p', 2]).N().re, 12);
  });
});

describe('A real result over a value that is complex without promotion', () => {
  it('a complex-typed operand still declines', () => {
    const ce = new ComputeEngine();
    ce.declare('q', '(unknown) -> real');
    ce.assign('q', ce.box(['Function', ['Power', 'z', 2], 'z']));
    ce.declare('w', 'complex');
    for (const mode of ['auto', 'complex'] as const)
      expect(() =>
        compile(ce.box(['Add', ['q', 'w'], 1]), {
          to: 'javascript',
          mode,
          fallback: false,
        } as any)
      ).toThrow(
        /Could not compile `Typed`: the value `w\^2` is complex, but its ascribed type `real` says it is real\..*\(unknown\) -> complex/s
      );
  });

  it('a call of a function whose definition is complex declines', () => {
    // `g: (real) -> number`, `g := k ↦ √k` is emitted on the complex lane.
    // The definition is shared by every call site, so it is not recompiled
    // on the real lane for the body of `h`, and `g(k) + 1` is complex.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('g', '(real) -> number');
    ce.assign('g', ce.box(['Function', ['Sqrt', 'k'], 'k']));
    ce.declare('h', '(real) -> real');
    ce.assign('h', ce.box(['Function', ['Add', ['g', 'k'], 1], 'k']));
    for (const expr of [
      ['h', 'x'],
      ['Add', ['g', 'x'], ['h', 'x']],
      ['Add', ['h', 'x'], ['g', 'x']],
    ])
      expect(() =>
        compile(ce.box(expr as any), {
          to: 'javascript',
          fallback: false,
        } as any)
      ).toThrow(/is complex, but its ascribed type `real` says it is real/);
  });

  it('the declaration of `g` alone still compiles on the complex lane', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('g', '(real) -> number');
    ce.assign('g', ce.box(['Function', ['Sqrt', 'k'], 'k']));
    const r = compile(ce.box(['g', 'x']), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(true);
    expect(r.run({ x: -4 })).toEqual({ re: 0, im: 2 });
  });
});

describe('Targets that never promote are unchanged', () => {
  for (const to of ['glsl', 'wgsl'] as const)
    it(`${to}: the body compiles on the real lane`, () => {
      const ce = engineWith('(real) -> real');
      const r = compile(ce.box(['Add', ['p', 3], ['p', 'x']]), {
        to,
        fallback: false,
      } as any) as any;
      expect(r.success).toBe(true);
      expect(r.promoted).toBe(false);
      expect(r.preamble).toContain(
        'return sin(2.4 * k) * sqrt(0.0625 * (k + -0.5));'
      );
    });
});
