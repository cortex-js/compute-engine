/**
 * Three emission changes on the `interval-js` target, and the values they must
 * keep answering.
 *
 * 1. Every constant interval is bound in a table the compiled runner builds
 *    ONCE, when it is built, instead of being written inline and rebuilt on
 *    every call. The consumer evaluates the kernel once per quadtree node, so
 *    an inline `_IA.point(2)` was one object allocation per node.
 * 2. A negated numerator folds into the division it feeds: `_IA.negDiv` with a
 *    general divisor, and the sign on the CONSTANT with a point divisor. A
 *    negation of a negation cancels.
 * 3. A conditional lowers to a ternary chain over the tri-state condition
 *    instead of `_IA.piecewise` with two closures, so no function object is
 *    allocated per evaluation.
 *
 * Every enclosure checked here must CONTAIN the true value: that is the
 * guarantee this target exists to provide, and a cheaper emission that loses
 * it is worse than no emission.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalArithmetic as IA } from '../../src/compute-engine/interval/index';
import { ComputeEngineIntervalFunction } from '../../src/compute-engine/compilation/interval-javascript-target';

type Enclosure = { lo: number; hi: number };
type IntervalRun = {
  success: boolean;
  code: string;
  preamble?: string;
  error?: string;
  run: (arg?: unknown) => any;
};

function compileInterval(latex: string, ce = new ComputeEngine()): IntervalRun {
  const expr = ce.parse(latex);
  if (!expr.isValid) throw new Error(`parse: ${expr.toString()}`);
  const r = compile(expr, {
    to: 'interval-js',
    fallback: false,
  }) as unknown as IntervalRun;
  if (!r.success) throw new Error(`compile failed: ${latex}: ${r.error}`);
  return r;
}

/** The enclosure a run answers, whatever result shape carries it. */
function boundOf(v: any): Enclosure {
  return v.value ?? v;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A point strictly inside `[lo, hi]` at the fraction `t`, clamped so a
 *  rounding of the interpolation cannot step outside the box. */
function inside(box: Enclosure, t: number): number {
  if (t <= 0) return box.lo;
  if (t >= 1) return box.hi;
  return Math.min(box.hi, Math.max(box.lo, box.lo + (box.hi - box.lo) * t));
}

describe('interval-js: the constant table is built once per artifact', () => {
  test('a top-level conditional carries no constant object in its body', () => {
    const r = compileInterval(
      '\\begin{cases}\\sin(x+0.5)&x<1\\\\2\\end{cases}'
    );
    expect(r.code).not.toContain('_IA.point(');
    expect(r.code).not.toContain('{ lo:');
    expect(r.preamble).toContain('const _k1 = _IA.point(1);');
    expect(r.preamble).toContain('_IA.point(0.5);');
    expect(r.preamble).toContain('_IA.point(2);');
  });

  test('the folded constants of an unrolled sum are bound, not inlined', () => {
    // Each term folds `sin` of a constant multiple to an enclosure literal;
    // written inline, forty of them were rebuilt on every call.
    const r = compileInterval('\\sum_{k=1}^{20} \\frac{\\sin(0.1k)}{k+x}');
    expect(r.code).not.toContain("{ kind: 'interval'");
    expect(r.code).not.toContain('_IA.point(');
    expect(count(r.preamble ?? '', "{ kind: 'interval'")).toBeGreaterThan(10);
    // The sum still answers an enclosure of the true value.
    for (const xv of [0, 2.5, -0.5]) {
      let truth = 0;
      for (let k = 1; k <= 20; k++) truth += Math.sin(0.1 * k) / (k + xv);
      const got = boundOf(r.run({ x: { lo: xv, hi: xv } }));
      expect(got.lo).toBeLessThanOrEqual(truth);
      expect(got.hi).toBeGreaterThanOrEqual(truth);
    }
  });

  test('a shared constant object cannot be changed through a returned value', () => {
    // `piecewise` and the ternary chain both hand back the arm they selected,
    // so a constant of the table can reach the caller. The runner copies the
    // result on the way out; without that copy a caller's write would change
    // what every later call answers.
    const r = compileInterval('\\begin{cases}x&x<1\\\\2\\end{cases}');
    const first = r.run({ x: { lo: 3, hi: 4 } });
    expect(boundOf(first)).toEqual({ lo: 2, hi: 2 });
    boundOf(first).lo = 999;
    expect(boundOf(r.run({ x: { lo: 3, hi: 4 } }))).toEqual({ lo: 2, hi: 2 });
  });

  test('an array a returned wrapper carries is the caller’s own', () => {
    // The copy the runner makes on the way out has to reach an array that a
    // kinded result carries, not only the enclosure of a scalar one: an array
    // built by the constant declarations is the same object on every call, so
    // a caller who writes into it would change what every later call answers.
    // The runner is built here by hand because no lowering of this target
    // emits a collection inside a kinded wrapper today.
    const run = new ComputeEngineIntervalFunction(
      `({ kind: 'interval', value: _k1 })`,
      '',
      'const _k1 = [{ lo: 1, hi: 2 }, { lo: 3, hi: 4 }];'
    ) as unknown as (v?: unknown) => any;
    const table = [
      { lo: 1, hi: 2 },
      { lo: 3, hi: 4 },
    ];
    const first = run({});
    expect(first.value).toEqual(table);
    first.value[0].lo = 999;
    first.value.push({ lo: 0, hi: 0 });
    expect(run({}).value).toEqual(table);
  });

  test('repeated calls answer the same enclosure', () => {
    // The table survives from call to call now, so a routine that wrote to one
    // of its operands would corrupt it permanently. None does; this is the
    // witness.
    const r = compileInterval('2\\pi x + \\frac{x}{3} - \\sqrt{2}');
    const box = { lo: -1, hi: 2 };
    const first = boundOf(r.run({ x: box }));
    for (let i = 0; i < 5; i++)
      expect(boundOf(r.run({ x: box }))).toEqual(first);
  });

  test('a user-function body still reads the table', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(number) -> number');
    ce.assign('g', ce.parse('t \\mapsto 2\\sqrt{t^2 + 0.81}'));
    const r = compileInterval('g(x)+1', ce);
    const body = r.preamble!.slice(r.preamble!.indexOf('const _fn_g'));
    expect(body).not.toContain('_IA.point(');
    expect(body).not.toContain('{ lo:');
    // g(3) + 1 = 2·√9.81 + 1 = 7.264…
    const truth = 2 * Math.sqrt(9 + 0.81) + 1;
    const got = boundOf(r.run({ x: { lo: 3, hi: 3 } }));
    expect(got.lo).toBeLessThanOrEqual(truth);
    expect(got.hi).toBeGreaterThanOrEqual(truth);
  });
});

describe('interval-js: a leading sign folds into the operation that consumes it', () => {
  test('a negated numerator divides through one kernel', () => {
    const r = compileInterval('\\frac{-\\lfloor n x\\rfloor}{n}');
    expect(r.code).toBe('_IA.negDiv(_IA.floor(_IA.mul(_.n, _.x)), _.n)');
    expect(r.code).not.toContain('_IA.negate(');
  });

  test('a constant point divisor takes the sign instead', () => {
    const r = compileInterval('-\\frac{x}{3}');
    expect(r.code).toBe('_IA.scaleDiv(_.x, _k1)');
    expect(r.preamble).toBe('const _k1 = _IA.point(-3);');
    expect(r.code).not.toContain('_IA.negate(');
  });

  test('a negation of a negation cancels', () => {
    expect(compileInterval('-(-\\sin x)').code).toBe('_IA.sin(_.x)');
  });

  test('`negDiv` answers exactly what `div` of the negation answers', () => {
    // Every operand shape the kernels see: the signed zeros, the infinities,
    // NaN, and the kinded results (`empty`, `entire`, a pole, a finite jump,
    // a domain-clipped `partial`).
    const points = [
      -Infinity,
      -1e308,
      -5,
      -1,
      -0.5,
      -0,
      0,
      0.5,
      1,
      5,
      1e308,
      Infinity,
      NaN,
    ];
    const operands: unknown[] = [];
    for (let i = 0; i < points.length; i++)
      for (let j = i; j < points.length; j++)
        operands.push({ lo: points[i], hi: points[j] });
    operands.push(
      { kind: 'empty' },
      { kind: 'entire' },
      { kind: 'singular' },
      IA.floor({ lo: 0.5, hi: 1.5 }),
      IA.sign({ lo: -1, hi: 1 }),
      IA.sqrt({ lo: -1, hi: 4 })
    );
    for (const a of operands)
      for (const b of operands)
        expect(IA.negDiv(a as any, b as any)).toEqual(
          IA.div(IA.negate(a as any) as any, b as any)
        );
  });

  test('the folded quotient encloses the true value across a floor break', () => {
    // `-⌊n·x⌋/n` is a lattice snap: `floor` jumps at every multiple of `1/n`,
    // and a box that contains one must still bound both sides of the break.
    const r = compileInterval('\\frac{-\\lfloor n x\\rfloor}{n}');
    const truth = (x: number, n: number): number => -Math.floor(n * x) / n;
    const boxes: Enclosure[] = [
      { lo: 0.24, hi: 0.26 }, // straddles the break at 1/4 for n = 4
      { lo: -0.1, hi: 0.1 }, // straddles zero
      { lo: 1, hi: 1 },
      { lo: -3.7, hi: -3.2 },
    ];
    for (const box of boxes) {
      for (const n of [1, 4, 7]) {
        const got = boundOf(r.run({ x: box, n: { lo: n, hi: n } }));
        for (let s = 0; s <= 20; s++) {
          const t = inside(box, s / 20);
          expect(got.lo).toBeLessThanOrEqual(truth(t, n));
          expect(got.hi).toBeGreaterThanOrEqual(truth(t, n));
        }
      }
    }
  });

  test('a lattice kernel of the audit corpus carries no negation and no closure', () => {
    // The shape of the Voronoi cell distance: a snapped coordinate, a hashed
    // offset, and a conditional that replaces the nearest cell by a large
    // sentinel. Before the fold it carried thirty `_IA.negate(` sites and two
    // closures per conditional.
    const ce = new ComputeEngine();
    for (const s of ['x', 'y', 'n']) ce.declare(s, 'real');
    const r = compileInterval(
      '\\left(x + \\frac{-\\lfloor n x\\rfloor}{n} + ' +
        '\\frac{-(10000\\sin(10000(\\lfloor n y\\rfloor + \\lfloor n x\\rfloor)) \\bmod 1)}{n}\\right)^2 + ' +
        '\\begin{cases}1000000000&\\lfloor n x\\rfloor = \\lfloor n y\\rfloor\\\\' +
        '\\frac{-\\lfloor n y\\rfloor}{n}\\end{cases}',
      ce
    );
    expect(r.code).not.toContain('_IA.negate(');
    expect(r.code).not.toContain('_IA.piecewise');
    // The only arrow left is the CSE block that binds the shared floors; no
    // conditional arm is a closure any more.
    expect(count(r.code, '() =>')).toBe(1);
    expect(r.code.startsWith('(() => {')).toBe(true);
    expect(count(r.code, '_IA.negDiv(')).toBeGreaterThan(0);
  });
});

describe('interval-js: a conditional lowers without closures', () => {
  test('the arms are not wrapped in functions', () => {
    const r = compileInterval(
      '\\begin{cases}x&x<1\\\\x^2&x<2\\\\0\\end{cases}'
    );
    expect(r.code).not.toContain('() =>');
    expect(r.code).not.toContain('_IA.piecewise');
    expect(r.code).toContain('_IA.hull(');
    // One tri-state temporary per condition, declared in the preamble.
    expect(new Set(r.code.match(/_tv\d+ =/g)).size).toBe(2);
    expect(r.preamble).toContain('let _tv1, _tv2;');
  });

  test('the answer is what `_IA.piecewise` answered', () => {
    const r = compileInterval(
      '\\begin{cases}x&x<1\\\\x^2&x<2\\\\0\\end{cases}'
    );
    const truth = (x: number): number => (x < 1 ? x : x < 2 ? x * x : 0);
    const boxes: Enclosure[] = [
      { lo: -2, hi: -1 }, // certainly the first arm
      { lo: 1.2, hi: 1.5 }, // certainly the second
      { lo: 3, hi: 4 }, // certainly the default
      { lo: 0.9, hi: 1.1 }, // undecided at the first boundary
      { lo: 1.9, hi: 2.1 }, // undecided at the second
      { lo: -1, hi: 5 }, // undecided at both
    ];
    for (const box of boxes) {
      const got = boundOf(r.run({ x: box }));
      for (let s = 0; s <= 40; s++) {
        const t = inside(box, s / 40);
        expect(got.lo).toBeLessThanOrEqual(truth(t));
        expect(got.hi).toBeGreaterThanOrEqual(truth(t));
      }
    }
  });

  test('a decided arm keeps the `IntervalResult` shape', () => {
    // `_IA.piecewise` normalized its answer; the chain has to normalize the
    // same way, or a conditional would answer a bare `{ lo, hi }` where it
    // used to answer a kinded result.
    const r = compileInterval('\\begin{cases}2&x<1\\\\3\\end{cases}');
    expect(r.run({ x: { lo: 0, hi: 0 } })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
    expect(r.run({ x: { lo: 5, hi: 5 } })).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
  });

  test('an arm that is not taken is not evaluated', () => {
    // The chain keeps the laziness the closures had: an arm that divides by
    // zero must not turn a decided branch into `empty`.
    const r = compileInterval(
      '\\begin{cases}\\frac{1}{x}&x>1\\\\\\frac{1}{x-1}\\end{cases}'
    );
    // x certainly above 1: the second arm's pole at 1 is never reached.
    expect(boundOf(r.run({ x: { lo: 2, hi: 2 } }))).toEqual({
      lo: 0.5,
      hi: 0.5,
    });
    // x certainly at or below 1 and away from the pole: the first arm's
    // division is not evaluated either.
    expect(boundOf(r.run({ x: { lo: -1, hi: -1 } }))).toEqual({
      lo: -0.5,
      hi: -0.5,
    });
  });

  test('an absent element inside a conditional stays absent', () => {
    // Numeric absence on this target is a whole-NaN interval. An arm that
    // reads past the end of a list answers one, and the conditional must hand
    // it back rather than smoothing it into a bound.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const list = ['List', 10, 20, 30];
    const r = compile(
      ce.box([
        'Which',
        ['Less', 'x', 1],
        ['At', list, 7],
        'True',
        ['At', list, 2],
      ]),
      { to: 'interval-js', fallback: false }
    ) as unknown as IntervalRun;
    expect(r.success).toBe(true);
    const absent = boundOf(r.run({ x: { lo: 0, hi: 0 } }));
    expect(Number.isNaN(absent.lo)).toBe(true);
    expect(Number.isNaN(absent.hi)).toBe(true);
    expect(boundOf(r.run({ x: { lo: 5, hi: 5 } }))).toEqual({ lo: 20, hi: 20 });
  });

  test('a deeply nested chain keeps the closure form', () => {
    // The chain writes each arm twice, so a deep `cases` would grow its own
    // source exponentially. Above the size limit the closure form is kept,
    // and the answer is the same either way.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const arms = [];
    for (let k = 1; k <= 12; k++)
      arms.push(`\\sin(${k}x)+\\cos(${k}x)+\\sqrt{${k}+x^2}&x<${k}`);
    const r = compileInterval(
      `\\begin{cases}${arms.join('\\\\')}\\\\0\\end{cases}`,
      ce
    );
    expect(r.code).toContain('_IA.piecewise');
    const truth = (x: number): number => {
      for (let k = 1; k <= 12; k++)
        if (x < k)
          return Math.sin(k * x) + Math.cos(k * x) + Math.sqrt(k + x * x);
      return 0;
    };
    for (const v of [0.5, 3.5, 11.5, 20]) {
      const got = boundOf(r.run({ x: { lo: v, hi: v } }));
      expect(got.lo).toBeLessThanOrEqual(truth(v));
      expect(got.hi).toBeGreaterThanOrEqual(truth(v));
    }
  });

  test('the declared temporaries are the ones the artifact reads', () => {
    // The condition temporaries are collected while the expression is
    // compiled and declared in one `let` when it is done. Each declaration
    // must name every temporary the code reads, once: a name declared twice
    // is a syntax error, and the runner would then answer `entire` for every
    // input instead of an enclosure. Two compilations in a row are checked
    // because the collection is per compilation, and a leftover from an
    // earlier one would show up as a repeated name here.
    for (const latex of [
      '\\begin{cases}x&x<1\\\\x^2&x<2\\\\0\\end{cases}',
      '\\begin{cases}2x&x<3\\\\-x\\end{cases}',
    ]) {
      const r = compileInterval(latex);
      const declaration = /let ([^;]+);/.exec(r.preamble ?? '');
      const declared = declaration ? declaration[1].split(', ') : [];
      expect(declared.length).toBeGreaterThan(0);
      expect(new Set(declared).size).toBe(declared.length);
      for (const name of declared) expect(r.code).toContain(`${name} =`);
      // The artifact runs: a duplicate declaration would have made it throw
      // at construction and answer `entire` here.
      expect(boundOf(r.run({ x: { lo: 0.5, hi: 0.5 } })).lo).not.toBeNaN();
      expect(r.run({ x: { lo: 0.5, hi: 0.5 } })).not.toEqual({
        kind: 'entire',
      });
    }
  });

  test('an arm that already answers a result is not wrapped again', () => {
    // `_IA.res` normalizes an arm that may answer a bare `{ lo, hi }`. An arm
    // this lowering wrote itself — a nested chain, the empty tail of a
    // `Which` with no default — already answers an `IntervalResult`, so it is
    // handed on as it is.
    const r = compileInterval('\\begin{cases}x&x<1\\\\x^2&x<2\\end{cases}');
    expect(r.code).toContain("({ kind: 'empty' })");
    expect(r.code).not.toContain("_IA.res(({ kind: 'empty' })");
    expect(r.code).not.toContain('_IA.res(((_tv');
    expect(r.code).not.toContain('_IA.res(_IA.hull(');
    // An arm that is a plain value still is wrapped.
    expect(r.code).toContain('_IA.res(_.x)');
    // Outside the two conditions the expression is empty, and inside them it
    // is the arm the condition selects.
    expect(r.run({ x: { lo: 3, hi: 4 } })).toEqual({ kind: 'empty' });
    expect(boundOf(r.run({ x: { lo: 0, hi: 0 } }))).toEqual({ lo: 0, hi: 0 });
    expect(boundOf(r.run({ x: { lo: 1.5, hi: 1.5 } }))).toEqual({
      lo: 2.25,
      hi: 2.25,
    });
  });

  test('the compiled value encloses the interpreter at sample points', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    for (const latex of [
      '\\begin{cases}\\sin(x+0.5)&x<1\\\\2\\end{cases}',
      '\\frac{-\\lfloor 4 x\\rfloor}{4}',
      '-\\frac{x}{3}+2\\pi x',
    ]) {
      const r = compileInterval(latex, ce);
      const expr = ce.parse(latex);
      for (const v of [-2.5, -0.25, 0, 0.75, 1, 2.5]) {
        const truth = expr.subs({ x: v }).N().re;
        if (!Number.isFinite(truth)) continue;
        const got = boundOf(r.run({ x: { lo: v, hi: v } }));
        expect(got.lo).toBeLessThanOrEqual(truth);
        expect(got.hi).toBeGreaterThanOrEqual(truth);
      }
    }
  });
});
