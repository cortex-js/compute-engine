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

/** The number of calls of `_gpu_min`, `_gpu_sin` and `_gpu_cos` in `text`,
 * the definitions of the helpers included. */
function guardedCalls(text: string): number {
  return [...text.matchAll(/_gpu_(min|sin|cos)\(/g)].length;
}

describe('CE-480: the kelvin-wake sum on the shader targets', () => {

  test.each(TARGETS)('an unrolled sum calls the built-ins too (%s)', (to) => {
    const ce = engineWith(eta('3'));
    const text = shader(ce, '\\operatorname{eta}(x, y)', to);
    expect(guardedCalls(text)).toBe(0);
  });

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
      /Could not compile/
    );
  });

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
