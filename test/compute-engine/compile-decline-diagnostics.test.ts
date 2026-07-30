import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

/**
 * Compile-decline diagnostics (Tycho item 109a).
 *
 * A compile band can only be triaged if the decline message names the actual
 * cause. Three distinct causes, three distinct messages:
 *
 * 1. a per-operator `compile` handler ran and DECLINED — the head lowers, this
 *    operand shape / target does not;
 * 2. the head has an operator definition but this target has no codegen for it
 *    — a target gap;
 * 3. no operator definition at all — the only case that still reads
 *    `Unknown operator`.
 *
 * The reason reaches callers as `CompilationResult.error` (singular) on the
 * non-throwing paths, and as the thrown `Error.message` on the direct-target
 * path.
 */
describe('compile decline diagnostics (Tycho item 109a)', () => {
  const ce = new ComputeEngine();

  describe('a handler that declines on operand SHAPE says so', () => {
    // `PointList` lowers to a point value with scalar components; a
    // collection-valued component has no expression-level representation.
    const listComponent = () =>
      ce.box(['PointList', ['List', 1, 2, 3], 'x'] as any);

    it('javascript names the offending component and its type', () => {
      expect(() => new JavaScriptTarget().compile(listComponent())).toThrow(
        /PointList: cannot compile — component 1 is collection-valued/
      );
    });

    it('glsl names the target', () => {
      expect(() => new GLSLTarget().compile(listComponent())).toThrow(
        /collection-valued .* target 'glsl'/
      );
    });

    it('never reports the head as an unknown operator', () => {
      let msg = '';
      try {
        new JavaScriptTarget().compile(listComponent());
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).not.toMatch(/Unknown operator/);
    });

    it('an all-scalar PointList still compiles (the decline is shape-only)', () => {
      const r = new JavaScriptTarget().compile(ce.box(['PointList', 'x', 'y']));
      expect(r.success).toBe(true);
    });
  });

  describe('a handler with no lowering for the TARGET says so', () => {
    // `PointList` has no interval lowering at all (the interval domain is
    // scalar) — a different cause from the operand-shape decline above.
    it('interval-js: success:false with a specific `error`', () => {
      const r = new IntervalJavaScriptTarget().compile(
        ce.box(['PointList', 'x', 'y'])
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /PointList: cannot compile — the operator's compile handler has no lowering/
      );
      expect(r.error).not.toMatch(/Unknown operator/);
    });
  });

  describe('a KNOWN head with no target codegen is not "unknown"', () => {
    it('glsl: GammaRegularized names the target gap', () => {
      expect(() =>
        new GLSLTarget().compile(ce.box(['GammaRegularized', 3, 'x']))
      ).toThrow(
        /GammaRegularized: cannot compile — the operator is known to the engine but target 'glsl' has no lowering/
      );
    });

    it('glsl: Integrate names the target gap', () => {
      expect(() =>
        new GLSLTarget().compile(ce.parse('\\int_{0}^{1} x^2 \\, dx'))
      ).toThrow(/Integrate: cannot compile .* has no lowering/);
    });

    it('interval-js: List reports the target gap in `error`', () => {
      const r = new IntervalJavaScriptTarget().compile(ce.box(['List', 1, 2]));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /List: cannot compile — the operator is known to the engine/
      );
    });
  });

  describe('`Unknown operator` is reserved for a head with no definition', () => {
    it('a head auto-declared by boxing an application stays "unknown"', () => {
      // Boxing `["zzz", 1]` gives `zzz` a VALUE definition, not an operator
      // definition: it is genuinely unknown to the compiler.
      expect(() =>
        new JavaScriptTarget().compile(ce.box(['zzz', 1] as any))
      ).toThrow(/Unknown operator `zzz`/);
    });
  });
});
