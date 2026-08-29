import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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
    // `PointList` on a shader target lowers to a point value with scalar
    // components; a collection-valued component has no expression-level
    // representation there.
    const listComponent = () =>
      ce.box(['PointList', ['List', 1, 2, 3], 'x'] as any);

    // On JavaScript a list COMPONENT is now a zip source (it lowers to the
    // list of points), so the JS diagnostic re-pins on the shape that still
    // declines there: a union component, which is neither a scalar slot nor a
    // list source. Same 109a guarantee, different witness.
    const unionComponent = () => {
      const e = new ComputeEngine();
      e.declare('x', 'number');
      e.declare('U', 'number | list<number>');
      return e.box(['PointList', 'x', 'U'] as any);
    };

    it('javascript names the offending component and its type', () => {
      expect(() => new JavaScriptTarget().compile(unionComponent())).toThrow(
        /PointList: cannot compile — component 2 \(type `[^`]*list<number>[^`]*`\) is neither a scalar slot nor a list source/
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
        new JavaScriptTarget().compile(unionComponent());
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).not.toMatch(/Unknown operator/);
      expect(msg).toMatch(/Fail closed \(D6\)/);
    });

    it('an all-scalar PointList still compiles (the decline is shape-only)', () => {
      const r = new JavaScriptTarget().compile(ce.box(['PointList', 'x', 'y']));
      expect(r.success).toBe(true);
    });

    it('javascript: a list-SOURCE component is no longer a decline — it zips', () => {
      const r = new JavaScriptTarget().compile(listComponent());
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

  // `Count(xs)` is the cardinality, but `Count(xs, v)` counts the elements
  // equal to `v` and `Count(xs, p)` the elements satisfying `p`. Both targets
  // lowered every arity to `.length`/`len`, which answers the cardinality —
  // so the 2-arg forms compiled "successfully" and returned the wrong number
  // with no diagnostic. They now decline, like `At`'s multi-index form.
  //
  // The sources below carry a symbolic bound so constant folding cannot
  // answer before the `Count` handler is reached.
  describe('Count: the 2-arg forms decline instead of answering the size', () => {
    const engine = () => {
      const e = new ComputeEngine();
      e.declare('n', 'integer');
      return e;
    };
    const cardinality = () => engine().box(['Count', ['Range', 1, 'n']]);
    const byValue = () => engine().box(['Count', ['Range', 1, 'n'], 2]);
    const byPredicate = () =>
      engine().box([
        'Count',
        ['Range', 1, 'n'],
        ['Function', ['Greater', '_', 2]],
      ]);

    it('the 1-arg cardinality form still compiles on both targets', () => {
      expect(new JavaScriptTarget().compile(cardinality()).success).toBe(true);
      expect(new PythonTarget().compile(cardinality()).success).toBe(true);
      expect(compile(cardinality())?.run?.({ n: 5 })).toBe(5);
    });

    it('javascript names the unsupported arity', () => {
      expect(() => new JavaScriptTarget().compile(byValue())).toThrow(
        /Count: only the single-argument cardinality form compiles.*Fail closed \(D6\)/s
      );
      expect(() => new JavaScriptTarget().compile(byPredicate())).toThrow(
        /Count: only the single-argument cardinality form compiles/
      );
    });

    it('python names the unsupported arity', () => {
      expect(() => new PythonTarget().compile(byValue())).toThrow(
        /Count: only the single-argument cardinality form compiles.*Fail closed \(D6\)/s
      );
      expect(() => new PythonTarget().compile(byPredicate())).toThrow(
        /Count: only the single-argument cardinality form compiles/
      );
    });

    it('the interpreted fallback answers what the interpreter answers', () => {
      // `Range(1, 5)` holds one element equal to 2 and three greater than 2 —
      // NOT the five the old `.length` lowering returned for both.
      const v = compile(byValue());
      expect(v?.success).toBe(false);
      expect(v?.run?.({ n: 5 })).toBe(1);
      const p = compile(byPredicate());
      expect(p?.success).toBe(false);
      expect(p?.run?.({ n: 5 })).toBe(3);

      const ce2 = new ComputeEngine();
      ce2.assign('n', 5);
      expect(ce2.box(['Count', ['Range', 1, 'n'], 2]).evaluate().re).toBe(1);
      expect(
        ce2
          .box(['Count', ['Range', 1, 'n'], ['Function', ['Greater', '_', 2]]])
          .evaluate().re
      ).toBe(3);
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
