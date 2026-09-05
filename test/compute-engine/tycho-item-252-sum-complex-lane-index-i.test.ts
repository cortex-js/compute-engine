import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Tycho item 252 — a `Sum` whose index is named `i` and whose summand
 * promotes to the complex lane joined its terms with the REAL `+` (or
 * accumulated them into a real `let _tv = 0` in the loop form), so the
 * result was the string `"[object Object][object Object]…"`, while the same
 * body with the index renamed `j` emitted the complex add chain.
 *
 * The `Sum` emitter analyzed its body BEFORE the index was bound in the
 * compile target, so the analysis resolved `i` through the engine, where
 * `i` is the imaginary unit: the constant fold evaluated `k[i]` to `NaN`, a
 * plain real, and the fold-before-shape override reported the radical
 * `√(9.81 / k[i])` real. The emitter now analyzes the body with every
 * clause's index bound (`BaseCompiler.isComplexValuedUnderIndices`), the
 * same mask `isComplexValued` applies to the whole `Sum`.
 *
 * Under `mode: "complex"` both spellings read a WRONG VALUE: the wide-typed
 * quotient `9.81 / k[i]` was reported complex by the wide-type rule while
 * its emitter, choosing from the operands, wrote the real division, so
 * `_SYS.csqrt` was handed a plain number. A head whose emitter lowers from
 * its operands' shapes now answers from the operands alone.
 */

const X = { x: 10, t: 0.179 };
const EXPECTED = -0.7916893626288677;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('k', ce.parse('[1,2,3]'));
  return ce;
}

const SUMMAND = (idx: string) =>
  `\\cos\\left(${idx}\\left(\\left|x\\right|-\\sqrt{\\frac{9.81}{k[${idx}]}}t\\right)\\right)`;

describe('Tycho item 252: complex-lane Sum with an index named i', () => {
  for (const mode of [undefined, 'strict', 'auto', 'complex'] as const) {
    for (const idx of ['i', 'j']) {
      test(`unrolled form, index ${idx}, mode ${mode ?? 'default'}`, () => {
        const ce = engine();
        const e = ce.parse(`\\sum_{${idx}=1}^{3}${SUMMAND(idx)}`);
        expect(e.subs(X).N().re).toBeCloseTo(EXPECTED, 10);
        const r = compile(e, mode ? { to: 'javascript', mode } : { to: 'javascript' });
        expect(r.success).toBe(true);
        expect(r.run!(X)).toBeCloseTo(EXPECTED, 10);
      });

      test(`loop form, index ${idx}, mode ${mode ?? 'default'}`, () => {
        const ce = engine();
        const e = ce.parse(
          `\\sum_{${idx}=1}^{\\operatorname{length}(k)}${SUMMAND(idx)}`
        );
        const r = compile(e, mode ? { to: 'javascript', mode } : { to: 'javascript' });
        expect(r.success).toBe(true);
        expect(r.run!(X)).toBeCloseTo(EXPECTED, 10);
      });
    }
  }

  test('the i spelling emits the complex add chain, like the j spelling', () => {
    const ce = engine();
    const code = (idx: string) =>
      String(
        compile(ce.parse(`\\sum_{${idx}=1}^{3}${SUMMAND(idx)}`), {
          to: 'javascript',
        }).code
      );
    expect(code('i')).toContain('.re');
    expect(code('i').replace(/\bi\b/g, 'j')).toBe(code('j'));
  });

  test('under mode complex the radical receives a complex object, not a bare number', () => {
    const ce = engine();
    const r = compile(ce.parse(`\\sum_{j=1}^{3}${SUMMAND('j')}`), {
      to: 'javascript',
      mode: 'complex',
    });
    expect(String(r.code)).not.toMatch(/_SYS\.csqrt\(9\.81/);
  });

  test('a binder body whose index is i stays on the real lane when nothing promotes', () => {
    const ce = engine();
    const e = ce.parse('\\sum_{i=1}^{3}i\\sqrt{k[i]}');
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({})).toBeCloseTo(1 + 2 * Math.SQRT2 + 3 * Math.sqrt(3), 10);
  });
});
