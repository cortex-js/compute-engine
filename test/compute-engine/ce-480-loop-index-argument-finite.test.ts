/**
 * Tycho ledger row 480: on the shader targets, the index of a `Sum` or a
 * `Product` whose two bounds are integer literals is finite for certain, of
 * magnitude at most the larger bound (`gpuLoopIndexFacts` and
 * `gpuRecordCallSiteFacts` in `compilation/gpu-finite-proof.ts`). A call of a
 * user function is finite for certain when its body is, for the arguments of
 * that call, and an interval that holds its value is computed from the
 * intervals of the arguments (`userCall` and `range` of `gpuFiniteProof`).
 * A quotient by `cos(u)²` is finite for certain when the interval of `u` is
 * within `(-π/2, π/2)` (`lowerMagnitude`). The operations with a NaN-safe
 * helper (`_gpu_sin`, `_gpu_cos`, `_gpu_min`) then call the built-in.
 *
 * The shape is the `kelvin-wake` showcase of Tycho: a sum of 300 terms
 * `w(j)·cos(k₀(x·cos θ(j) + y·sin θ(j)) / cos(θ(j))²)`, with
 * `θ(j) = -1.35 + 2.7(j − 0.5)/300`.
 *
 * The helpers stay when a call of the same function passes an argument
 * that is not finite for certain or has no known bound, when the bound of
 * the `Sum` is not a literal, when the angular unit is not the radian, when
 * the lower bound of a divisor would rest on the bound 1 of `sin`, and when
 * calls are nested more than 8 levels deep.
 *
 * Every test builds its OWN engine: these tests assign symbols.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const TARGETS = ['glsl', 'wgsl'] as const;
type Target = (typeof TARGETS)[number];

const THETA = 'j \\mapsto -1.35 + 2.7\\frac{j - 0.5}{300}';
const W =
  'j \\mapsto \\min\\left(1, \\frac{1.35 - \\left|\\operatorname{theta}(j)\\right|}{0.35}\\right)^2' +
  '\\left(3 - 2\\min\\left(1, \\frac{1.35 - \\left|\\operatorname{theta}(j)\\right|}{0.35}\\right)\\right)';

/** The body of `eta`, a sum over `j` from 1 to `upper`, with the extra
 * term `extra` (none when empty). */
function eta(upper: string, extra = ''): string {
  return (
    `(x, y) \\mapsto \\frac{1}{300}\\sum_{j=1}^{${upper}} \\operatorname{w}(j)` +
    '\\cos\\left(\\frac{k_0\\left(x\\cos(\\operatorname{theta}(j)) + y\\sin(\\operatorname{theta}(j))\\right)}{\\cos(\\operatorname{theta}(j))^2}\\right)' +
    extra
  );
}

/** An engine with the axes and the slider of Tycho, and `theta`, `w` and
 * `eta` defined; `eta` has the body `etaBody`. */
function engineWith(etaBody: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real<-1e15..1e15>');
  ce.declare('y', 'real<-1e15..1e15>');
  ce.declare('U', 'real<0.6..1.2>');
  ce.assign('U', 0.8);
  ce.declare('k_0', 'real');
  ce.assign('k_0', ce.parse('\\frac{1}{U^2}'));
  const define = (name: string, latex: string) => {
    ce.declare(name, 'function');
    ce.assign(name, ce.parse(latex));
  };
  define('theta', THETA);
  define('w', W);
  define('eta', etaBody);
  return ce;
}

/** The emitted preamble and code of `latex` on `to`, as one text. */
function shader(ce: ComputeEngine, latex: string, to: Target): string {
  const r = compile(ce.parse(latex), { to, fallback: false } as never) as {
    success: boolean;
    code?: string;
    preamble?: string;
  };
  expect(r.success).toBe(true);
  return `${r.preamble ?? ''}\n${r.code ?? ''}`;
}

/** The emitted preamble and code of the MathJSON `json` on `to`. */
function shaderOf(ce: ComputeEngine, json: unknown, to: Target): string {
  const r = compile(ce.box(json as never), { to, fallback: false } as never) as {
    success: boolean;
    code?: string;
    preamble?: string;
  };
  expect(r.success).toBe(true);
  return `${r.preamble ?? ''}\n${r.code ?? ''}`;
}

/** The number of calls of `_gpu_min`, `_gpu_sin` and `_gpu_cos` in `text`,
 * the definitions of the helpers included. */
function guardedCalls(text: string): number {
  return [...text.matchAll(/_gpu_(min|sin|cos)\(/g)].length;
}

describe('CE-480: a loop index with literal bounds is finite', () => {
  test.each(TARGETS)(
    'the kelvin-wake sum calls the built-in min, sin and cos (%s)',
    (to) => {
      const ce = engineWith(eta('300'));
      const text = shader(ce, '\\operatorname{eta}(x, y)', to);
      expect(guardedCalls(text)).toBe(0);
      expect(text).toMatch(/\bmin\(1\.0/);
      expect(text).toMatch(/\bsin\(/);
      expect(text).toMatch(/\bcos\(/);
    }
  );

  test.each(TARGETS)('an unrolled sum calls the built-ins too (%s)', (to) => {
    const ce = engineWith(eta('3'));
    const text = shader(ce, '\\operatorname{eta}(x, y)', to);
    expect(guardedCalls(text)).toBe(0);
  });

  test.each(TARGETS)(
    'a call w(t) with an unbounded real t keeps the helper of min (%s)',
    (to) => {
      // `t` is declared `real` with no range: `θ(t)` is finite only when
      // `2.7·(t − 0.5)` cannot overflow, which no bound shows.
      const ce = engineWith(eta('300'));
      ce.declare('t', 'real');
      const text = shader(
        ce,
        '\\operatorname{eta}(x, y) + \\operatorname{w}(t)',
        to
      );
      expect(text).toMatch(/_gpu_min\(1\.0/);
    }
  );

  test.each(TARGETS)('a call w(exp(x)) keeps the helper of min (%s)', (to) => {
    // `exp(x)` is `+∞` in f32 for `x > 88.7`.
    const ce = engineWith(eta('300'));
    const text = shader(
      ce,
      '\\operatorname{eta}(x, y) + \\operatorname{w}(\\exp(x))',
      to
    );
    expect(text).toMatch(/_gpu_min\(1\.0/);
  });

  test.each(TARGETS)(
    'a sum whose upper bound is a symbol keeps the helpers (%s)',
    (to) => {
      const ce = engineWith(eta('n'));
      ce.declare('n', 'integer');
      const text = shader(ce, '\\operatorname{eta}(x, y)', to);
      expect(text).toMatch(/_gpu_min\(1\.0/);
      expect(text).toMatch(/_gpu_sin\(/);
      expect(text).toMatch(/_gpu_cos\(/);
    }
  );

  test.each(TARGETS)(
    'a quotient by cos(u)² whose u can reach π/2 keeps the helper (%s)',
    (to) => {
      // With 1.6 in place of 1.35, θ(j) reaches about ±1.59 > π/2, and
      // cos(θ(j)) can be 0.
      const ce = engineWith(eta('300'));
      ce.assign('theta', ce.parse('j \\mapsto -1.6 + 3.2\\frac{j - 0.5}{300}'));
      const text = shader(
        ce,
        '\\sum_{j=1}^{300} \\cos\\left(\\frac{x}{\\cos(\\operatorname{theta}(j))^2}\\right)',
        to
      );
      expect(text).toMatch(/_gpu_cos\(\(?x/);
    }
  );

  test('a quotient by cos(θ(j))² calls the built-in on GLSL', () => {
    // This rests on an ASSUMPTION about the GLSL drivers, not on the GLSL
    // specification, which gives no accuracy for `cos`: the absolute error
    // of `cos` is at most 2⁻⁶ on [-π/2, π/2] (`GPU_TRIG_ERROR` in
    // `gpu-finite-proof.ts`). Then `cos(θ(j))²` is at least about 0.04.
    const ce = engineWith(eta('300'));
    const text = shader(
      ce,
      '\\sum_{j=1}^{300} \\sin\\left(\\frac{x}{\\cos(\\operatorname{theta}(j))^2}\\right)',
      'glsl'
    );
    expect(guardedCalls(text)).toBe(0);
    expect(text).toMatch(/\bsin\(x \//);
  });

  test.each(TARGETS)(
    'a product by cos(θ(j))^{-2} calls the built-in, as the quotient does (%s)',
    (to) => {
      // The shader computes `cos(u)^{-2}` as `1.0 / _gpu_pow2(cos(u))`.
      const ce = new ComputeEngine();
      ce.declare('x', 'real<-1e15..1e15>');
      ce.declare('u', 'real<-1.35..1.35>');
      for (const latex of [
        '\\sin(x\\cos(u)^{-2})',
        '\\sin(x\\cos(u)^{-1})',
        '\\sin(\\frac{x}{\\cos(u)^2})',
      ])
        expect(guardedCalls(shader(ce, latex, to))).toBe(0);
      // `u` can reach π/2 here, and `cos(u)` can be 0.
      ce.declare('v', 'real<-1.6..1.6>');
      expect(shader(ce, '\\sin(x\\cos(v)^{-2})', to)).toMatch(/_gpu_sin\(/);
    }
  );

  test.each(TARGETS)(
    'a quotient by 1.0004 + sin(t) keeps the helper (%s)',
    (to) => {
      // The bound 1 of `sin(t)` is the exact bound. The error of the GPU
      // `sin` is absolute, and can be larger than the margin 4·10⁻⁴: WGSL
      // specifies 2⁻¹¹ (about 4.9·10⁻⁴) on [-π, π] and nothing outside it,
      // and GLSL specifies none. So the divisor can be 0 in the shader,
      // also for a bounded `t`.
      const latex = '\\sin\\left(\\frac{x}{1.0004 + \\sin(t)}\\right)';
      for (const type of ['real', 'real<-1..1>']) {
        const ce = new ComputeEngine();
        ce.declare('x', 'real<-1e15..1e15>');
        ce.declare('t', type);
        expect(shader(ce, latex, to)).toMatch(/_gpu_sin\(x \//);
      }
    }
  );

  test.each(TARGETS)(
    'a call of a user function in degree mode keeps the helper (%s)',
    (to) => {
      // The stored body of `f` is `arctan(t)`, at most π/2, but the shader
      // computes it in degrees, up to 90: `10³⁷·f(t)` can overflow.
      const latex =
        '\\min(0, 10^{37}\\operatorname{f}(t) - 9\\cdot 10^{36}\\operatorname{f}(t+1))';
      const make = (unit: 'rad' | 'deg') => {
        const ce = new ComputeEngine();
        ce.angularUnit = unit;
        ce.declare('t', 'real<-1..1>');
        ce.declare('f', 'function');
        ce.assign('f', ce.parse('t \\mapsto \\arctan(t)'));
        return ce;
      };
      expect(shader(make('deg'), latex, to)).toMatch(/_gpu_min\(/);
      // In radians the bound π/2 holds, and the built-in is called.
      expect(shader(make('rad'), latex, to)).not.toMatch(/_gpu_min\(/);
    }
  );

  test.each(TARGETS)(
    'an inner sum that binds the index again keeps the helper (%s)',
    (to) => {
      // The inner `j` has the non-literal upper bound `n` and no fact; it
      // does not read the fact of the outer `j`.
      const ce = engineWith(eta('300'));
      ce.declare('n', 'integer');
      const min = ['Min', 1, ['Multiply', 'x', ['theta', 'j']]];
      const nested = (inner: string) =>
        shaderOf(
          ce,
          ['Sum', ['Sum', min, ['Limits', inner, 1, 'n']], ['Limits', 'j', 1, 300]],
          to
        );
      expect(nested('j')).toMatch(/_gpu_min\(1\.0/);
      // With another name for the inner index, `j` is the outer index.
      expect(nested('k')).not.toMatch(/_gpu_min\(/);
    }
  );

  test.each(TARGETS)('a sum body that assigns the index declines (%s)', (to) => {
    // The interpreter binds the index to its next value at each iteration,
    // whatever the body wrote. A compiled loop does not, so every target
    // declines a body that writes its index, and no shader is emitted.
    const ce = engineWith(eta('300'));
    const expr = ce.box([
      'Sum',
      [
        'Block',
        ['Assign', 'j', ['Multiply', 1e30, 'x']],
        ['Min', 1, ['Multiply', 'x', ['theta', 'j']]],
      ],
      ['Limits', 'j', 1, 300],
    ]);
    expect(() => compile(expr, { to, fallback: false } as never)).toThrow(
      'the body writes the index `j`'
    );
  });

  test.each(TARGETS)(
    'a callee that binds its parameter again keeps the helper (%s)',
    (to) => {
      // `userCall` refuses a callee whose body binds a parameter again. No
      // head that the proof accepts binds a name, so the `Sum` of the body
      // is not proven finite either: this pins the result, not which of
      // the two rules gives it.
      const ce = engineWith(eta('300'));
      const min = ['Min', 1, ['Multiply', 'x', ['h', 'j']]];
      const root = ['Sum', min, ['Limits', 'j', 1, 300]];
      ce.declare('h', 'function');
      ce.assign(
        'h',
        ce.box([
          'Function',
          [
            'Add',
            ['Multiply', 'x', ['theta', 't']],
            ['Sum', 't', ['Limits', 't', 1, 3]],
          ],
          't',
        ])
      );
      expect(shaderOf(ce, root, to)).toMatch(/_gpu_min\(1\.0/);
      // The same callee without the inner binder calls the built-in.
      ce.assign(
        'h',
        ce.box(['Function', ['Multiply', 'x', ['theta', 't']], 't'])
      );
      expect(shaderOf(ce, root, to)).not.toMatch(/_gpu_min\(/);
    }
  );

  test.each(TARGETS)(
    'a call nested deeper than 8 levels keeps the helper (%s)',
    (to) => {
      // `f1(t) = f2(t) + 1`, …, and the last function is `sin(t)`. The proof
      // reads at most 8 nested bodies.
      const chain = (levels: number) => {
        const ce = new ComputeEngine();
        ce.declare('t', 'real<-1..1>');
        for (let i = levels; i >= 1; i--) {
          ce.declare(`f${i}`, 'function');
          ce.assign(
            `f${i}`,
            ce.parse(
              i === levels
                ? 't \\mapsto \\sin(t)'
                : `t \\mapsto \\operatorname{f${i + 1}}(t) + 1`
            )
          );
        }
        return shader(ce, '\\min(0, \\operatorname{f1}(t))', to);
      };
      expect(chain(8)).not.toMatch(/_gpu_min\(/);
      expect(chain(9)).toMatch(/_gpu_min\(/);
      expect(chain(12)).toMatch(/_gpu_min\(/);
    }
  );

  test.each(TARGETS)(
    'nested calls with three calls in each body compile quickly (%s)',
    (to) => {
      // Eight levels, each body calling the next function three times with
      // other arguments: without a shared result per compilation and a
      // budget per proof, the proof would read 3⁷ bodies for each operand.
      const ce = new ComputeEngine();
      ce.declare('t', 'real<-1..1>');
      for (let i = 8; i >= 1; i--) {
        const g = `\\operatorname{g${i + 1}}`;
        ce.declare(`g${i}`, 'function');
        ce.assign(
          `g${i}`,
          ce.parse(
            i === 8
              ? 't \\mapsto \\sin(t)'
              : `t \\mapsto ${g}(t) + ${g}(0.5t) + ${g}(\\frac{t}{3})`
          )
        );
      }
      const start = Date.now();
      const text = shader(ce, '\\min(0, \\operatorname{g1}(t))', to);
      // Every body is finite and bounded, and the proof reads fewer bodies
      // than its budget.
      expect(text).not.toMatch(/_gpu_min\(/);
      if (process.env.CE_PERF === '1')
        expect(Date.now() - start).toBeLessThan(20000);
    }
  );

  test.each(TARGETS)(
    'a divisor with a rational factor p/q keeps the helper (%s)',
    (to) => {
      // The shader computes `f(t)` as `t / 9e15 * 8999999999999999`. At
      // `j = 1`, `t / 9e15` is about 1.1·10⁻⁴⁶, flushed or rounded to 0 in
      // f32, and the quotient `x / f(10⁻³⁰·j)` can be `±∞` or NaN.
      const ce = new ComputeEngine();
      ce.declare('x', 'real<-1..1>');
      ce.declare('f', 'function');
      ce.assign(
        'f',
        ce.parse('t \\mapsto \\frac{8999999999999999}{9000000000000000} t')
      );
      const latex =
        '\\sum_{j=1}^{300} \\sin\\left(\\frac{x}{\\operatorname{f}(10^{-30} j)}\\right)';
      expect(shader(ce, latex, to)).toMatch(/_gpu_sin\(x \//);
      // With the decimal factor 0.9 and `10⁻³j`, the built-in is called.
      ce.assign('f', ce.parse('t \\mapsto 0.9 t'));
      expect(
        shader(
          ce,
          '\\sum_{j=1}^{300} \\sin\\left(\\frac{x}{\\operatorname{f}(10^{-3} j)}\\right)',
          to
        )
      ).not.toMatch(/_gpu_sin\(/);
    }
  );

  test.each(TARGETS)(
    'a divisor with a rational factor written as one tiny literal keeps the helper (%s)',
    (to) => {
      // The denominator 3·10⁴⁰ is not a safe integer, so the emitter writes
      // the factor as one f32 literal, about 3.3·10⁻⁴¹: a subnormal, which
      // a GPU can flush to 0, and `t · 3.3·10⁻⁴¹` is then 0.
      const ce = new ComputeEngine();
      ce.declare('x', 'real<-1..1>');
      ce.declare('t', 'real<1e20..2e20>');
      ce.declare('f', 'function');
      ce.assign(
        'f',
        ce.box([
          'Function',
          [
            'Multiply',
            ['Rational', 1, '30000000000000000000000000000000000000000'],
            't',
          ],
          't',
        ] as never)
      );
      expect(
        shaderOf(ce, ['Sin', ['Divide', 'x', ['f', 't']]], to)
      ).toMatch(/_gpu_sin\(x \//);
    }
  );

  test.each(TARGETS)(
    'abs of a tuple in a callee is a norm that can overflow (%s)',
    (to) => {
      // `Abs` of a tuple is emitted as `length(vec4(t, t, t, t))`, which is
      // `+∞` in f32 for `t = 2·10³⁸`.
      const make = (type: string) => {
        const ce = new ComputeEngine();
        ce.declare('x', type);
        ce.declare('f', 'function');
        ce.assign(
          'f',
          ce.box(['Function', ['Abs', ['Tuple', 't', 't', 't', 't']], 't'])
        );
        return ce;
      };
      expect(shaderOf(make('real'), ['Sin', ['f', 'x']], to)).toMatch(
        /_gpu_sin\(/
      );
      expect(
        shaderOf(make('real'), ['Sin', ['Abs', ['Tuple', 'x', 'x', 'x', 'x']]], to)
      ).toMatch(/_gpu_sin\(/);
      // `Abs` of a list is the component-wise `abs`, which cannot overflow.
      expect(
        shaderOf(make('real'), ['Sin', ['Abs', ['List', 'x', 'x', 'x']]], to)
      ).not.toMatch(/_gpu_sin\(/);
      expect(
        shaderOf(make('real'), ['Sin', ['Abs', ['Tuple', 'x', 'x', 'x']]], to)
      ).toMatch(/_gpu_sin\(/);
      // With `x` in [-1, 1] the norm is at most 2.
      expect(
        shaderOf(make('real<-1..1>'), ['Sin', ['f', 'x']], to)
      ).not.toMatch(/_gpu_sin\(/);
    }
  );

  test.each(TARGETS)(
    'a call in a body whose argument reads a parameter has a bound (%s)',
    (to) => {
      // `g(s) := w(f(s))`: the parameter `u` of `w` has the bound of
      // `f(s)`, read from the bound of `s` when the facts of the call sites
      // are recorded (`gpuRecordCallSiteFacts`). Then `u / 0.35` is finite
      // and `min` is the built-in.
      const ce = new ComputeEngine();
      ce.declare('t', 'real<-1..1>');
      const define = (name: string, latex: string) => {
        ce.declare(name, 'function');
        ce.assign(name, ce.parse(latex));
      };
      define('f', 's \\mapsto 0.5 s');
      define('w', 'u \\mapsto \\min(1, \\frac{u}{0.35})');
      define('g', 's \\mapsto \\operatorname{w}(\\operatorname{f}(s))');
      const text = shader(ce, '\\operatorname{g}(t)', to);
      expect(text).not.toMatch(/_gpu_min\(/);
      expect(text).toMatch(/\bmin\(1\.0, u \/ 0\.35\)/);
    }
  );

  test('the compiled JavaScript agrees with the interpreter', () => {
    const ce = engineWith(eta('300'));
    const expr = ce.parse('\\operatorname{eta}(x, y)');
    const js = compile(expr, { to: 'javascript' });
    for (const [x, y] of [
      [0.5, -0.25],
      [3, 2],
    ]) {
      const want = expr.subs({ x, y }).N().re;
      expect(js.run!({ x, y }) as number).toBeCloseTo(want, 9);
    }
  });
});
