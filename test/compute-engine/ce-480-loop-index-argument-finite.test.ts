/**
 * Tycho ledger row 480: the `kelvin-wake` showcase of Tycho, a sum of 300
 * terms `w(j)·cos(k₀(x·cos θ(j) + y·sin θ(j)) / cos(θ(j))²)`, with
 * `θ(j) = -1.35 + 2.7(j − 0.5)/300`, on the shader targets.
 *
 * The proof that an operand is finite (`gpuProvablyFinite` in
 * `compilation/gpu-finite-proof.ts`) reads only the declarations of the
 * host and the expression. It does not read the index of a `Sum` or a
 * `Product` as finite, nor the body of a user function, nor the values that
 * the calls of a function pass, and it gives `cos(u)` no lower bound of its
 * magnitude. So the operations with a NaN-safe helper (`_gpu_sin`,
 * `_gpu_cos`, `_gpu_min`) of this sum call the helper, which gives the same
 * values as the built-in on finite inputs. A sum that the shader unrolls
 * into terms with literal indices folds them, and calls the built-ins.
 *
 * Every test builds its OWN engine: these tests assign symbols.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const TARGETS = ['glsl'] as const;
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

describe('CE-480: the kelvin-wake sum on the shader targets', () => {
  test.each(TARGETS)(
    'the kelvin-wake sum calls the helpers of min, sin and cos (%s)',
    (to) => {
      const ce = engineWith(eta('300'));
      const text = shader(ce, '\\operatorname{eta}(x, y)', to);
      expect(text).toMatch(/_gpu_min\(1\.0/);
      expect(text).toMatch(/_gpu_sin\(/);
      expect(text).toMatch(/_gpu_cos\(/);
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

  test.each(TARGETS)('a quotient by cos(θ(j))² keeps the helper (%s)', (to) => {
    // The proof gives `cos(u)` no lower bound of its magnitude: the error
    // of the GPU `cos` is not specified on GLSL.
    const ce = engineWith(eta('300'));
    const text = shader(
      ce,
      '\\sum_{j=1}^{300} \\sin\\left(\\frac{x}{\\cos(\\operatorname{theta}(j))^2}\\right)',
      to
    );
    expect(text).toMatch(/_gpu_sin\(x \//);
  });

  test.each(TARGETS)(
    'a product by cos(u)^{-2} keeps the helper, as the quotient does (%s)',
    (to) => {
      // The shader computes `cos(u)^{-2}` as `1.0 / _gpu_pow2(cos(u))`. A
      // declared range of `u` within (-π/2, π/2) gives no lower bound of
      // `|cos(u)|`.
      const ce = new ComputeEngine();
      ce.declare('x', 'real<-1e15..1e15>');
      ce.declare('u', 'real<-1.35..1.35>');
      for (const latex of [
        '\\sin(x\\cos(u)^{-2})',
        '\\sin(x\\cos(u)^{-1})',
        '\\sin(\\frac{x}{\\cos(u)^2})',
      ])
        expect(shader(ce, latex, to)).toMatch(/_gpu_sin\(/);
    }
  );

  test.each(TARGETS)(
    'a quotient by 1.0004 + sin(t) keeps the helper (%s)',
    (to) => {
      // The bound 1 of `sin(t)` is the exact bound. The error of the GPU
      // `sin` is absolute, and can be larger than the margin 4·10⁻⁴: GLSL
      // specifies no bound for it. So the divisor can be 0 in the shader,
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
    'abs of a tuple is a norm that can overflow (%s)',
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
      // With `x` in [-1, 1] the norm is at most 2. A call of `f` keeps the
      // helper: the proof does not read the body of `f`.
      expect(
        shaderOf(
          make('real<-1..1>'),
          ['Sin', ['Abs', ['Tuple', 'x', 'x', 'x', 'x']]],
          to
        )
      ).not.toMatch(/_gpu_sin\(/);
      expect(shaderOf(make('real<-1..1>'), ['Sin', ['f', 'x']], to)).toMatch(
        /_gpu_sin\(/
      );
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
