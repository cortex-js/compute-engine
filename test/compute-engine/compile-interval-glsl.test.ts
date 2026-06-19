/**
 * `interval-glsl` compilation target (Phase 1: arithmetic + integer powers).
 *
 * Contract (see `INTERVAL_GLSL_PLAN.md` §8–§9): a GPU interval-arithmetic
 * evaluator. Each value is a `vec2 (lo, hi)`; arithmetic routes through `_iv_*`
 * helper functions (never native infix); numbers are point intervals
 * `vec2(n, n)`; `empty` is the inverted interval `vec2(IV_INF, -IV_INF)`; the
 * sentinel `IV_INF` is finite (`1e18`).
 *
 * The load-bearing property is **soundness**: the compiled interval must
 * *contain* the true range of `f` over a box (over-approximation is fine;
 * under-approximation could miss a curve crossing).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  runIntervalGLSL,
  isEmptyIV,
  IV_INF,
  setTrigAbsPad,
  type IV,
} from './interval-glsl-eval';

const ce = new ComputeEngine();
const iv = ce.getCompilationTarget('interval-glsl')!;

describe('COMPILE interval-glsl — registration & codegen', () => {
  it('is a registered target', () => {
    expect(ce.listCompilationTargets()).toContain('interval-glsl');
  });

  it('routes arithmetic through _iv_* and numbers to point intervals', () => {
    expect(iv.compile(ce.parse('x^2 + y^2 - 1')).code).toBe(
      '_iv_add(_iv_add(_iv_square(x), _iv_square(y)), vec2(-1.0, -1.0))'
    );
  });

  it('uses _iv_square for squares and _iv_powi for higher integer powers', () => {
    expect(iv.compile(ce.parse('x^2')).code).toBe('_iv_square(x)');
    expect(iv.compile(ce.parse('x^3')).code).toBe('_iv_powi(x, 3.0)');
  });

  it('compiles division through _iv_div', () => {
    expect(iv.compile(ce.parse('1/x')).code).toBe('_iv_div(vec2(1.0, 1.0), x)');
  });

  it('folds an assigned value to a point interval', () => {
    const local = new ComputeEngine();
    local.assign('a', 2);
    expect(local.getCompilationTarget('interval-glsl')!.compile(local.parse('a x')).code).toBe(
      '_iv_mul(vec2(2.0, 2.0), x)'
    );
  });

  it('injects the _iv_* preamble when used', () => {
    const r = iv.compile(ce.parse('x + 1'));
    expect(r.preamble).toContain('const float IV_INF = 1e18;');
    expect(r.preamble).toContain('vec2 _iv_add(');
    expect(r.preamble).toContain('IV_EMPTY = vec2(IV_INF, -IV_INF)');
    // Outward-rounding helpers are present and wired into the inexact ops.
    expect(r.preamble).toContain('vec2 _iv_widen(');
    expect(r.preamble).toContain('vec2 _iv_widen_t(');
    expect(r.preamble).toMatch(/_iv_add[\s\S]*_iv_widen\(/);
  });

  it('reports free symbols (the cell-box uniforms the caller supplies)', () => {
    expect(iv.compile(ce.parse('x^2 + y^2 - 1')).freeSymbols!.sort()).toEqual([
      'x',
      'y',
    ]);
  });
});

describe('COMPILE interval-glsl — unsupported heads fall back declaratively', () => {
  it('engine compile() reports success:false + unsupported (no throw)', () => {
    // Hyperbolic functions are not yet ported.
    const r = compile(ce.parse('\\sinh(x) - y'), { to: 'interval-glsl' });
    expect(r.success).toBe(false);
    expect(r.unsupported).toContain('Sinh');
    expect(r.error).toMatch(/Sinh/);
  });

  it('the direct-target path throws (so engine compile() can fall back)', () => {
    expect(() => iv.compile(ce.parse('\\sinh x'))).toThrow(/Unknown operator/);
  });

  it('a variable exponent is deferred (unsupported), not silently wrong', () => {
    // Positive integer/rational powers are supported (Phase 1/2); a *variable*
    // exponent is not, and must route to CPU fallback rather than miscompile.
    const r = compile(ce.parse('x^y'), { to: 'interval-glsl' });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Soundness: a faithful JS port of INTERVAL_GLSL_PREAMBLE, used to execute the
// generated code and assert the result CONTAINS the densely-sampled true range.
// ---------------------------------------------------------------------------
describe('COMPILE interval-glsl — soundness (interval contains true range)', () => {
  const IV_INF = 1e18;
  const vec2 = (a: number, b: number) => [a, b] as [number, number];
  const empty = (a: number[]) => a[0] > a[1];
  const cl = (a: number[]) =>
    [
      Math.min(Math.max(a[0], -IV_INF), IV_INF),
      Math.min(Math.max(a[1], -IV_INF), IV_INF),
    ] as [number, number];
  const g1 = (r: number[], a: number[]) => (empty(a) ? [IV_INF, -IV_INF] : r);
  const g2 = (r: number[], a: number[], b: number[]) =>
    empty(a) || empty(b) ? [IV_INF, -IV_INF] : r;
  const _iv_negate = (a: number[]) => g1(cl([-a[1], -a[0]]), a);
  const _iv_add = (a: number[], b: number[]) =>
    g2(cl([a[0] + b[0], a[1] + b[1]]), a, b);
  const _iv_sub = (a: number[], b: number[]) =>
    g2(cl([a[0] - b[1], a[1] - b[0]]), a, b);
  const _iv_mul = (a: number[], b: number[]) => {
    const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
    return g2(cl([Math.min(...p), Math.max(...p)]), a, b);
  };
  const _iv_div = (a: number[], b: number[]) => {
    const spans = b[0] <= 0 && b[1] >= 0;
    const q = [a[0] / b[0], a[0] / b[1], a[1] / b[0], a[1] / b[1]];
    let r = [Math.min(...q), Math.max(...q)];
    if (spans) r = [-IV_INF, IV_INF];
    return g2(cl(r), a, b);
  };
  const _iv_square = (a: number[]) => {
    const l2 = a[0] * a[0];
    const h2 = a[1] * a[1];
    const lo = a[0] <= 0 && a[1] >= 0 ? 0 : Math.min(l2, h2);
    return g1(cl([lo, Math.max(l2, h2)]), a);
  };
  const ps = (x: number, n: number) => {
    const v = Math.pow(Math.abs(x), n);
    return n % 2 === 1 && x < 0 ? -v : v;
  };
  const _iv_powi = (a: number[], n: number) => {
    const pl = ps(a[0], n);
    const ph = ps(a[1], n);
    const ev = n % 2 === 0;
    const st = a[0] <= 0 && a[1] >= 0;
    const lo = ev ? (st ? 0 : Math.min(pl, ph)) : pl;
    const hi = ev ? Math.max(pl, ph) : ph;
    return g1(cl([lo, hi]), a);
  };

  const run = (code: string, xb: number[], yb: number[]) =>
    new Function(
      'vec2',
      '_iv_add',
      '_iv_sub',
      '_iv_mul',
      '_iv_div',
      '_iv_negate',
      '_iv_square',
      '_iv_powi',
      'x',
      'y',
      `return ${code};`
    )(
      vec2,
      _iv_add,
      _iv_sub,
      _iv_mul,
      _iv_div,
      _iv_negate,
      _iv_square,
      _iv_powi,
      xb,
      yb
    );

  const trueRange = (
    f: (x: number, y: number) => number,
    xb: number[],
    yb: number[]
  ) => {
    let lo = Infinity;
    let hi = -Infinity;
    const N = 32;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        const x = xb[0] + ((xb[1] - xb[0]) * i) / N;
        const y = yb[0] + ((yb[1] - yb[0]) * j) / N;
        const v = f(x, y);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    return [lo, hi];
  };

  const curves: Array<[string, (x: number, y: number) => number]> = [
    ['x^2 + y^2 - 1', (x, y) => x * x + y * y - 1],
    ['(x^2+y^2)^2 - (x^2 - y^2)', (x, y) => (x * x + y * y) ** 2 - (x * x - y * y)],
    ['x^3 - x - y', (x, y) => x ** 3 - x - y],
  ];

  for (const [src, f] of curves) {
    it(`${src} contains the true range over a grid of boxes`, () => {
      const code = iv.compile(ce.parse(src)).code;
      for (let cx = -3; cx <= 3; cx++)
        for (let cy = -3; cy <= 3; cy++) {
          const xb = [cx - 0.6, cx + 0.6];
          const yb = [cy - 0.6, cy + 0.6];
          const got = run(code, xb, yb) as number[];
          const tr = trueRange(f, xb, yb);
          // The one unsound direction (Tycho §10): a spurious `empty` on a
          // valid input → false exclude → missed crossing. Every Phase-1 op is
          // a total function, so a valid box must never produce `empty`
          // (`lo > hi`).
          expect(got[0]).toBeLessThanOrEqual(got[1]);
          // Containment: the interval must enclose the true range (outward).
          expect(got[0]).toBeLessThanOrEqual(tr[0] + 1e-6);
          expect(got[1]).toBeGreaterThanOrEqual(tr[1] - 1e-6);
        }
    });
  }

  it('division with a zero-spanning denominator widens to entire (never narrow)', () => {
    const code = iv.compile(ce.parse('1/x')).code;
    const got = run(code, [-1, 1], [0, 0]) as number[]; // x straddles 0
    expect(got[0]).toBeLessThanOrEqual(-IV_INF + 1);
    expect(got[1]).toBeGreaterThanOrEqual(IV_INF - 1);
  });
});

// Discontinuous / step functions (floor, mod, sign, fract, min, max) — common
// in lattice/periodic implicit plots. These have no corpus fixtures and
// deliberately diverge from interval-js (which returns `singular` at a jump):
// the GPU returns the TIGHT value-range enclosure, which is sound (encloses the
// true range) AND excludable. Verified by densely sampling the true range.
describe('COMPILE interval-glsl — discontinuous functions (tight & sound)', () => {
  // f built from MathJSON (LaTeX for floor/mod is awkward).
  const curves: Array<{ id: string; expr: any }> = [
    { id: 'floor(x) - y', expr: ['Subtract', ['Floor', 'x'], 'y'] },
    { id: 'mod(x,3) - y', expr: ['Subtract', ['Mod', 'x', 3], 'y'] },
    { id: 'sign(x) - y', expr: ['Subtract', ['Sign', 'x'], 'y'] },
    { id: 'fract(x) - y', expr: ['Subtract', ['Fract', 'x'], 'y'] },
    { id: 'ceil(x) - y', expr: ['Subtract', ['Ceil', 'x'], 'y'] },
    {
      id: 'max(|x|,|y|) - 1 (L∞ ball)',
      expr: ['Subtract', ['Max', ['Abs', 'x'], ['Abs', 'y']], 1],
    },
  ];

  const sampleTrueRange = (
    f: (v: { x: number; y: number }) => number,
    xb: IV,
    yb: IV
  ): IV => {
    let lo = Infinity;
    let hi = -Infinity;
    const N = 30;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        const x = xb[0] + ((xb[1] - xb[0]) * i) / N;
        const y = yb[0] + ((yb[1] - yb[0]) * j) / N;
        const v = f({ x, y });
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    return [lo, hi];
  };
  const clampB = (v: number) => Math.max(-IV_INF, Math.min(IV_INF, v));

  for (const { id, expr } of curves) {
    it(`${id}: GLSL interval contains the true range (incl. discontinuity-spanning boxes)`, () => {
      const code = iv.compile(ce.box(expr)).code;
      const jsRun = compile(ce.box(expr), { to: 'javascript' }).run! as (v: {
        x: number;
        y: number;
      }) => number;

      for (let cx = -3; cx <= 3; cx++)
        for (let cy = -3; cy <= 3; cy++) {
          // Box width 1.4 guarantees spanning integer/period boundaries.
          const xb: IV = [cx - 0.7, cx + 0.7];
          const yb: IV = [cy - 0.7, cy + 0.7];
          const got = runIntervalGLSL(code, { x: xb, y: yb });
          if (isEmptyIV(got)) continue; // totals here are never empty
          const tr = sampleTrueRange(jsRun, xb, yb);
          if (!Number.isFinite(tr[0])) continue; // no defined samples
          expect(got[0]).toBeLessThanOrEqual(clampB(tr[0]) + 1e-6);
          expect(got[1]).toBeGreaterThanOrEqual(clampB(tr[1]) - 1e-6);
        }
    });
  }

  it('floor is tight enough to exclude a cell whose range misses zero (not entire)', () => {
    // floor(x) - y over x∈[1.2,1.8] (floor=1), y=5 → [-4,-4], hi < 0 → excluded.
    const code = iv.compile(ce.box(['Subtract', ['Floor', 'x'], 'y'])).code;
    const got = runIntervalGLSL(code, { x: [1.2, 1.8], y: [5, 5] });
    expect(got[1]).toBeLessThan(0); // excludable — would be impossible if `entire`
  });

  it('mod by a zero-spanning modulus is a pole → entire', () => {
    const code = iv.compile(ce.box(['Mod', 'x', 'm'])).code;
    const got = runIntervalGLSL(code, { x: [1, 2], m: [-1, 1] });
    expect(got[0]).toBeLessThanOrEqual(-IV_INF + 1);
    expect(got[1]).toBeGreaterThanOrEqual(IV_INF - 1);
  });
});

// Phase 4 — a complete, self-contained exclusion-oracle fragment shader.
describe('COMPILE interval-glsl — exclusion shader (Phase 4)', () => {
  const ivt = ce.getCompilationTarget('interval-glsl') as unknown as {
    compileExclusionShader: (e: any, o?: any) => string;
  };

  it('emits a well-formed, self-contained fragment shader', () => {
    const expr = ce.parse('x^2 + y^2 - 1');
    const shader = ivt.compileExclusionShader(expr);
    expect(shader).toContain('#version 300 es');
    expect(shader).toContain('precision highp float;');
    expect(shader).toContain('vec2 _iv_add('); // preamble injected
    expect(shader).toContain('uniform vec2 u_domainX;');
    expect(shader).toContain('uniform vec2 u_domainY;');
    expect(shader).toContain('uniform vec2 u_resolution;');
    expect(shader).toContain('out vec4 fragColor;');
    expect(shader).toContain('void main()');
    // The evaluator is the compiled interval code, with its inputs
    // outward-rounded at entry (float32 cell-box soundness, §13).
    expect(shader).toContain(
      `vec2 _implicit(vec2 x, vec2 y) {\n` +
        `  x = _iv_widen_t(x);\n` +
        `  y = _iv_widen_t(y);\n` +
        `  return ${iv.compile(expr).code};`
    );
    // Exclusion predicate (also rejects `empty`, whose lo is +IV_INF).
    expect(shader).toContain('_f.x > 0.0 || _f.y < 0.0');
    // Balanced delimiters (cheap syntactic sanity).
    expect((shader.match(/{/g) || []).length).toBe(
      (shader.match(/}/g) || []).length
    );
    expect((shader.match(/\(/g) || []).length).toBe(
      (shader.match(/\)/g) || []).length
    );
  });

  it('honors version / precision options', () => {
    const shader = ivt.compileExclusionShader(ce.parse('x - y'), {
      version: '310 es',
      precision: 'mediump',
    });
    expect(shader).toContain('#version 310 es');
    expect(shader).toContain('precision mediump float;');
  });

  it('rejects more than two free variables', () => {
    expect(() => ivt.compileExclusionShader(ce.parse('x + y + z'))).toThrow(
      /at most 2 free variables/
    );
  });

  it('the oracle decision is correct (unit circle, via the JS port)', () => {
    // Replicate main()'s cell box → evaluator → exclusion predicate in JS.
    const code = iv.compile(ce.parse('x^2 + y^2 - 1')).code;
    const excludes = (xb: IV, yb: IV) => {
      const f = runIntervalGLSL(code, { x: xb, y: yb });
      return f[0] > 0 || f[1] < 0; // matches the shader predicate
    };
    // Center cell: inside the disk, far from the ring → no curve → excluded.
    expect(excludes([-0.5, 0.5], [-0.5, 0.5])).toBe(true);
    // Cell straddling the ring r=1 → curve may pass → kept.
    expect(excludes([0.5, 1.5], [-0.5, 0.5])).toBe(false);
    // Cell well outside the disk → f ≫ 0 → excluded.
    expect(excludes([2.5, 3.0], [2.5, 3.0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression (§13): float32 grazing soundness. On the real GPU the cell box is
// built with a float32 `mix` of the domain uniforms, which rounds to nearest and
// can land the box edge a few ulp INSIDE the true cell — flipping the exclusion
// verdict for a box the curve only grazes. interval-js (float64) keeps the box;
// an un-widened float32 oracle drops it (`interval-glsl ⊉ interval-js`).
//
// The shared JS port runs in float64 and cannot reproduce this, so we model the
// shader in float32 here (Math.fround) for the exact Tycho repro: the unit
// circle's tangent corner (1,0). Outward rounding — leaf `_iv_widen_t` on the
// input box (as `_implicit` now does) plus per-op `_iv_widen` — restores
// `lo ≤ 0`. The production GLSL path is covered end-to-end by Tycho's on-GPU
// parity harness.
// ---------------------------------------------------------------------------
describe('COMPILE interval-glsl — float32 grazing soundness (§13)', () => {
  const fr = Math.fround;
  const ULP = 2 ** -23; // float32 machine epsilon
  type F = [number, number];
  // float32 outward-widen, mirroring _iv_widen (1 ulp) and _iv_widen_t (8 ulp).
  const wd = (lo: number, hi: number): F => [
    fr(lo - fr(Math.abs(lo) * ULP + 1e-30)),
    fr(hi + fr(Math.abs(hi) * ULP + 1e-30)),
  ];
  const wdt = (lo: number, hi: number): F => [
    fr(lo - fr(Math.abs(lo) * 8 * ULP + 1e-30)),
    fr(hi + fr(Math.abs(hi) * 8 * ULP + 1e-30)),
  ];

  // float32 interval evaluation of f = x² + y² − 1, with widening toggled.
  const evalF32 = (xb: F, yb: F, widen: boolean): F => {
    const [xl, xh] = widen ? wdt(xb[0], xb[1]) : xb; // leaf input rounding
    const [yl, yh] = widen ? wdt(yb[0], yb[1]) : yb;
    const sq = (lo: number, hi: number): F => {
      const a = fr(lo * lo);
      const b = fr(hi * hi);
      const l = lo <= 0 && hi >= 0 ? 0 : Math.min(a, b);
      const r: F = [l, Math.max(a, b)];
      return widen ? wd(r[0], r[1]) : r;
    };
    const add = (A: F, B: F): F => {
      const r: F = [fr(A[0] + B[0]), fr(A[1] + B[1])];
      return widen ? wd(r[0], r[1]) : r;
    };
    return add(add(sq(xl, xh), sq(yl, yh)), [-1, -1]);
  };
  const excludes = (f: F) => f[0] > 0 || f[1] < 0;

  // Unit circle tangent at (1,0): the box's true corner is (1,0), where f = 0,
  // so the box must be KEPT. The float32 `mix` lands the left edge ~3 ulp above
  // 1.0 — a benign few-ulp construction error.
  const xb: F = [fr(1 + 3 * ULP), fr(1.05)];
  const yb: F = [fr(-0.05), 0];

  it('un-widened float32 spuriously EXCLUDES the grazing cell (the bug)', () => {
    const f = evalF32(xb, yb, false);
    expect(f[0]).toBeGreaterThan(0); // lo ≈ +6 ulp > 0 → wrongly excluded
    expect(excludes(f)).toBe(true);
  });

  it('outward rounding KEEPS the grazing cell (the fix), still sound', () => {
    const f = evalF32(xb, yb, true);
    expect(f[0]).toBeLessThanOrEqual(0); // lo ≈ −12 ulp ≤ 0 → kept
    expect(excludes(f)).toBe(false);
    // Still an over-approximation (sound): hi ≥ the un-widened hi.
    expect(f[1]).toBeGreaterThanOrEqual(evalF32(xb, yb, false)[1]);
  });
});

// ---------------------------------------------------------------------------
// Tycho reply (2026-06-18): public box-widen helpers (Q1), the `pow` pad (Q2),
// and the configurable absolute trig pad (Q3).
// ---------------------------------------------------------------------------
describe('COMPILE interval-glsl — public widen helpers & pads (Q1–Q3)', () => {
  const ivx = iv as unknown as {
    getPreamble: (o?: { trigAbsPad?: number }) => string;
    compileExclusionShader: (e: any, o?: any) => string;
  };

  it('Q1: the four widen helpers + epsilons are public preamble symbols', () => {
    const p = iv.compile(ce.parse('x^2 + y^2 - 1')).preamble!;
    for (const s of [
      'const float IV_EPS = ',
      'const float IV_EPS_FN = ',
      'const float IV_EPS_POW = ',
      'vec2 _iv_widen(',
      'vec2 _iv_widen_t(',
      'vec2 _iv_widen_pow(',
      'vec2 _iv_widen_sc(',
    ])
      expect(p).toContain(s);
  });

  it('Q1: the preamble is emitted even for an op-free curve (so _iv_widen_t is callable)', () => {
    // f = x (the y-axis) compiles to just `x` — no _iv_ op — but a renderer that
    // boxes its own coordinates still needs _iv_widen_t to outward-round them.
    const r = iv.compile(ce.parse('x'));
    expect(r.code).toBe('x');
    expect(r.preamble).toContain('vec2 _iv_widen_t(');
  });

  it('Q2a: x^2 → square (correctly rounded), x^3 → powi (via GLSL pow)', () => {
    expect(iv.compile(ce.parse('x^2')).code).toBe('_iv_square(x)');
    expect(iv.compile(ce.parse('x^3')).code).toBe('_iv_powi(x, 3.0)');
  });

  it('Q2b: powi and powf route through the 32-ulp _iv_widen_pow pad', () => {
    const p = iv.compile(ce.parse('x^3')).preamble!;
    expect(p).toContain('const float IV_EPS_POW = 32.0 * IV_EPS;');
    expect(p).toMatch(/vec2 _iv_powi[\s\S]*?_iv_widen_pow\(/);
    expect(p).toMatch(/vec2 _iv_powf[\s\S]*?_iv_widen_pow\(/);
  });

  it('Q3: trigAbsPad is off by default and configurable, wired into sin/cos', () => {
    expect(ivx.getPreamble()).toContain('const float IV_TRIG_ABS = 0.0;');
    const padded = ivx.getPreamble({ trigAbsPad: 5e-4 });
    expect(padded).toContain('const float IV_TRIG_ABS = 0.0005;');
    expect(padded).toMatch(/vec2 _iv_sin[\s\S]*?_iv_widen_sc\(/);
    expect(padded).toMatch(/vec2 _iv_cos[\s\S]*?_iv_widen_sc\(/);
    // The exclusion shader honors the option in its injected preamble.
    const shader = ivx.compileExclusionShader(ce.parse('\\sin(x) - y'), {
      trigAbsPad: 5e-4,
    });
    expect(shader).toContain('const float IV_TRIG_ABS = 0.0005;');
  });

  it('Q3: trigAbsPad numerically fattens sin/cos bounds (via the JS port)', () => {
    const code = iv.compile(ce.parse('\\sin(x)')).code; // _iv_sin(x)
    const base = runIntervalGLSL(code, { x: [0.1, 0.2] });
    try {
      setTrigAbsPad(0.01);
      const padded = runIntervalGLSL(code, { x: [0.1, 0.2] });
      expect(base[0] - padded[0]).toBeGreaterThan(0.009); // lo pushed down ~0.01
      expect(padded[1] - base[1]).toBeGreaterThan(0.009); // hi pushed up ~0.01
    } finally {
      setTrigAbsPad(0); // restore module state for any later test
    }
  });
});
