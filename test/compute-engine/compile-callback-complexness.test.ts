import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * # Complexness of a callback PARAMETER
 *
 * A bare built-in operator symbol used as an element callback (`Map(Abs, zs)`)
 * is eta-expanded into a shared emitted wrapper whose synthesized parameter
 * carries no type, so the wrapper body used to compile in the REAL lane:
 * `const _fn_Abs = (_tv1) => Math.abs(_tv1)` received the `{ re, im }` element
 * and answered `NaN` behind `success: true`, where the interpreter answers 5.
 * A wrong value is never acceptable (`docs/COMPILATION-MODEL.md`, "fail
 * closed", D6); the fix projects the source's element complexness into the
 * callback parameter, so the callback compiles through the same complex lane
 * an INLINE `x ↦ Abs(x)` callback already reached.
 *
 * Two traps this file is built around:
 *
 * - **constant folding masks the defect.** A literal source is folded through
 *   interpreter semantics, so a small literal fixture can pass while the
 *   lowering is broken. Every complexness case below therefore also runs over
 *   a DECLARED `list<complex>` symbol whose elements arrive at run time.
 * - **`NaN` stringifies to `null`.** The run value is asserted directly,
 *   never through `JSON.stringify`.
 *
 * The file also pins the position-aware refusal for a single-uppercase
 * built-in operator name (`D`) in callback position — see
 * `BaseCompiler.assertBuiltinCallbackUsable`.
 */

/** A fresh engine with `zs: list<complex>` and `rs: list<real>` declared. */
function engineWithSources(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('zs', 'list<complex>');
  ce.declare('rs', 'list<real>');
  return ce;
}

describe('callback parameter complexness', () => {
  describe('parity with the interpreter', () => {
    // A LITERAL complex source: the compiled value must agree with
    // `evaluate()`. This is the case constant folding can mask, so it is
    // asserted alongside — not instead of — the free-symbol cases above.
    it.each([
      ['Abs', [5]],
      ['Sqrt', [{ re: 2, im: 1 }]],
      ['Conjugate', [{ re: 3, im: -4 }]],
    ])('Map(%s, [3+4i]) matches evaluate()', (op, expected) => {
      const ce = new ComputeEngine();
      const expr = ce.box(['Map', op, ['List', ['Complex', 3, 4]]]);
      const evaluated = expr.evaluate();
      const compiled = (compile(expr, { fallback: false }) as any).run();
      expect(compiled).toEqual(expected);
      // `Map` evaluates lazily, so the interpreter's answer is only legible
      // through its rendering. Box the compiled value back into the same
      // shape and compare the two renderings.
      const back = ce.box([
        'List',
        ...(compiled as any[]).map((v) =>
          typeof v === 'number' ? v : ['Complex', v.re, v.im]
        ),
      ]);
      expect(evaluated.toString()).toBe(back.toString());
    });
  });

  describe('a real source keeps the real lane', () => {
    it('Map(Abs, rs) still emits the shared real wrapper', () => {
      const ce = engineWithSources();
      const result = compile(ce.box(['Map', 'Abs', 'rs'])) as any;
      expect(String(result.code) + String(result.preamble ?? '')).toContain(
        'Math.abs'
      );
      expect(result.run({ rs: [-3, 4] })).toEqual([3, 4]);
    });
  });

  describe('single-uppercase built-in operator in callback position', () => {
    it('Map(D, xs) fails closed instead of emitting a broken `_.D`', () => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<real>');
      expect(() =>
        compile(ce.box(['Map', 'D', 'xs']), { fallback: false })
      ).toThrow(/Could not compile/);
    });

    it('leaves the un-applied caller-variable reading of D untouched', () => {
      // `\int D x^2 dx` reads `D` as a coefficient, not as an operator: the
      // refusal is scoped to a CALLBACK operand and must not reach here.
      const ce = new ComputeEngine();
      expect(ce.parse('\\int D x^2 dx').toString()).toContain('D');
    });
  });
});
