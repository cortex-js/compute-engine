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

/** The compiled `run` of `json`, refusing the interpreter fallback. */
function runner(ce: ComputeEngine, json: any): (vars?: any) => any {
  const result = compile(ce.box(json), { fallback: false }) as any;
  expect(result.success).toBe(true);
  return result.run;
}

/** `3 + 4i` in the JavaScript target's complex encoding. */
const Z = { re: 3, im: 4 };

describe('callback parameter complexness', () => {
  describe('named built-in callback over a declared list<complex>', () => {
    // The free-symbol route: nothing is folded, so this witnesses the LOWERING
    // rather than the interpreter running at compile time.
    it('Map(Abs, zs) computes the modulus, not NaN', () => {
      const ce = engineWithSources();
      expect(runner(ce, ['Map', 'Abs', 'zs'])({ zs: [Z] })).toEqual([5]);
    });

    it('Map(Sqrt, zs) computes the complex root', () => {
      const ce = engineWithSources();
      expect(runner(ce, ['Map', 'Sqrt', 'zs'])({ zs: [Z] })).toEqual([
        { re: 2, im: 1 },
      ]);
    });

    it('Map(Conjugate, zs) conjugates', () => {
      const ce = engineWithSources();
      expect(runner(ce, ['Map', 'Conjugate', 'zs'])({ zs: [Z] })).toEqual([
        { re: 3, im: -4 },
      ]);
    });

    it('Map(Negate, zs) negates both components', () => {
      const ce = engineWithSources();
      expect(runner(ce, ['Map', 'Negate', 'zs'])({ zs: [Z] })).toEqual([
        { re: -3, im: -4 },
      ]);
    });

    it('FlatMap(zs, Abs) reaches the same splice', () => {
      const ce = engineWithSources();
      expect(runner(ce, ['FlatMap', 'zs', 'Abs'])({ zs: [Z] })).toEqual([5]);
    });

    it('emits the complex kernel rather than the real-lane wrapper', () => {
      const ce = engineWithSources();
      const code = String((compile(ce.box(['Map', 'Abs', 'zs'])) as any).code);
      expect(code).toContain('_SYS.cabs');
      expect(code).not.toContain('Math.abs');
    });
  });

  describe('inline-literal callback over a declared list<complex>', () => {
    it('Map(x |-> Abs(x), zs) computes the modulus', () => {
      const ce = engineWithSources();
      const run = runner(ce, [
        'Map',
        ['Function', ['Abs', 'x'], 'x'],
        'zs',
      ]);
      expect(run({ zs: [Z] })).toEqual([5]);
    });
  });

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
      ).toThrow(/'D'/);
    });

    it('a caller symbol named D that holds a function still compiles', () => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<real>');
      ce.assign('D', ce.box(['Function', ['Multiply', 2, 'u'], 'u']));
      const run = runner(ce, ['Map', 'D', 'xs']);
      expect(run({ xs: [1, 2] })).toEqual([2, 4]);
    });

    it('leaves the un-applied caller-variable reading of D untouched', () => {
      // `\int D x^2 dx` reads `D` as a coefficient, not as an operator: the
      // refusal is scoped to a CALLBACK operand and must not reach here.
      const ce = new ComputeEngine();
      expect(ce.parse('\\int D x^2 dx').toString()).toContain('D');
    });
  });
});
