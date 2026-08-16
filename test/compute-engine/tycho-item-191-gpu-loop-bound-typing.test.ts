/**
 * Tycho item 191 — GLSL/WGSL `Sum`/`Product` for-loop headers were ill-typed.
 *
 * The loop counter is declared as an integer (`int i` / `var i: i32`), but a
 * bound that is not a compile-time constant compiles to a FLOAT expression
 * (`K + -1.0`, or a constant-folded `Length(L)` spelled `3.0`). Neither GLSL
 * ES nor WGSL promotes int to float, so `for (int j = 0; j <= K + -1.0; …)`
 * was a driver-side type error — the whole shader was rejected behind
 * `success: true`. The header now converts every non-literal bound to the
 * counter's type, flooring first (`int(floor(K + -1.0))`) so a non-integer
 * bound reads the way the JavaScript target's `Math.floor(bound)` does.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const ce = new ComputeEngine();
ce.declare('K', 'number');
ce.declare('N', 'number');
ce.assign('L', ce.box(['List', 1, 2, 3]));

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

/** Every loop-header bound is either an integer literal or an int-cast. */
function headerIsIntTyped(code: string, lang: 'glsl' | 'wgsl'): boolean {
  const m = code.match(/for \((.*?)\) \{/);
  if (!m) return false;
  const [init, cond] = m[1].split(';').map((s) => s.trim());
  const cast = lang === 'glsl' ? 'int(floor(' : 'i32(floor(';
  const rhs = (s: string) => s.slice(s.indexOf('=') + 1).trim();
  const ok = (s: string) => /^-?\d+$/.test(s) || s.startsWith(cast);
  return ok(rhs(init)) && ok(cond.replace(/^\S+ <= /, ''));
}

describe('Tycho item 191 — GPU Sum/Product loop bounds are int-typed', () => {
  const cases: [string, string][] = [
    ['symbolic upper bound with offset', '\\sum_{j=0}^{K-1}jx'],
    ['bare symbolic upper bound', '\\sum_{j=1}^{K}jx'],
    ['Product with symbolic upper bound', '\\prod_{i=1}^{N}(x+i)'],
    ['symbolic LOWER bound', '\\sum_{j=K}^{9}jx'],
    ['folded float constant bound', '\\sum_{i=1}^{\\mathrm{Length}(L)}\\frac{x}{i}'],
  ];

  for (const [name, latex] of cases) {
    it(`GLSL: ${name}`, () => {
      const r = glsl.compile(ce.parse(latex));
      expect(r.success).toBe(true);
      expect(headerIsIntTyped(r.code!, 'glsl')).toBe(true);
    });
    it(`WGSL: ${name}`, () => {
      const r = wgsl.compile(ce.parse(latex));
      expect(r.success).toBe(true);
      expect(headerIsIntTyped(r.code!, 'wgsl')).toBe(true);
    });
  }

  it('emits the exact GLSL header for the filed witness', () => {
    const r = glsl.compile(ce.parse('\\sum_{j=0}^{K-1}jx'));
    expect(r.code).toContain(
      'for (int j = 0; j <= int(floor(K + -1.0)); j++) {'
    );
    expect(r.code).toContain('_tv1 += float(j) * x;');
  });

  it('emits the exact WGSL header for a symbolic lower bound', () => {
    const r = wgsl.compile(ce.parse('\\sum_{j=K}^{9}jx'));
    expect(r.code).toContain(
      'for (var j: i32 = i32(floor(K)); j <= 9; j++) {'
    );
  });

  // A bound the caller declared as a shader INTEGER (a `compileFunction`
  // parameter, a shader uniform) is already the counter's type: `floor()`
  // takes only a float in both languages, so wrapping it would be a driver
  // type error from the other direction. Such a bound is used bare.
  it('GLSL: an `int`-declared parameter bound is used bare', () => {
    const code = glsl.compileFunction(ce.parse('\\sum_{j=1}^{K}2j'), 'f', 'float', [
      ['K', 'int'],
    ]);
    expect(code).toContain('for (int j = 1; j <= K; j++) {');
    const lower = glsl.compileFunction(
      ce.parse('\\sum_{j=K}^{9}2j'),
      'f',
      'float',
      [['K', 'int']]
    );
    expect(lower).toContain('for (int j = K; j <= 9; j++) {');
  });

  it('WGSL: an `i32`-declared parameter bound is used bare', () => {
    const code = wgsl.compileFunction(ce.parse('\\sum_{j=1}^{K}2j'), 'f', 'f32', [
      ['K', 'i32'],
    ]);
    expect(code).toContain('for (var j: i32 = 1; j <= K; j++) {');
  });

  it('an unsigned-declared bound is converted without flooring', () => {
    const g = glsl.compileFunction(ce.parse('\\sum_{j=1}^{K}2j'), 'f', 'float', [
      ['K', 'uint'],
    ]);
    expect(g).toContain('j <= int(K);');
    const w = wgsl.compileFunction(ce.parse('\\sum_{j=1}^{K}2j'), 'f', 'f32', [
      ['K', 'u32'],
    ]);
    expect(w).toContain('j <= i32(K);');
  });

  it('a `float`-declared parameter bound is floored and cast', () => {
    const code = glsl.compileFunction(ce.parse('\\sum_{j=1}^{K}2j'), 'f', 'float', [
      ['K', 'float'],
    ]);
    expect(code).toContain('for (int j = 1; j <= int(floor(K)); j++) {');
  });

  it('a `bool`-declared bound fails closed', () => {
    expect(() =>
      glsl.compileFunction(ce.parse('\\sum_{j=1}^{K}2j'), 'f', 'float', [
        ['K', 'bool'],
      ])
    ).toThrow(/declared "bool" by the caller, which is not a scalar number/);
  });

  // An integer-declared scalar reaching float ARITHMETIC (the bound
  // expression `K - 1`, or a plain body `K + 1`) is converted where it is
  // referenced — `float(K)` / `f32(K)` — so the arithmetic is well-typed too.
  // (User-ruled 2026-08-15: cast at the reference site rather than fail
  // closed; found while fixing item 191.)
  it('an `int`-declared parameter in a bound EXPRESSION is converted', () => {
    const g = glsl.compileFunction(ce.parse('\\sum_{j=1}^{K-1}2j'), 'f', 'float', [
      ['K', 'int'],
    ]);
    expect(g).toContain('j <= int(floor(float(K) + -1.0));');
    const w = wgsl.compileFunction(ce.parse('\\sum_{j=1}^{K-1}2j'), 'f', 'f32', [
      ['K', 'i32'],
    ]);
    expect(w).toContain('j <= i32(floor(f32(K) + -1.0));');
  });

  it('an `int`-declared parameter in plain float arithmetic is converted', () => {
    const g = glsl.compileFunction(ce.parse('K+1'), 'f', 'float', [['K', 'int']]);
    expect(g).toContain('return float(K) + 1.0;');
    const w = wgsl.compileFunction(ce.parse('K+1'), 'f', 'f32', [['K', 'i32']]);
    expect(w).toContain('return f32(K) + 1.0;');
  });

  it('constant small ranges still unroll (control)', () => {
    const r = glsl.compile(ce.parse('\\sum_{j=0}^{4}jx'));
    expect(r.code).not.toContain('for (');
  });
});
