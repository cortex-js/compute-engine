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
    const listComponent = (engine: ComputeEngine = ce) =>
      engine.box(['PointList', ['List', 1, 2, 3], 'x'] as any);

    // On JavaScript a list COMPONENT is now a zip source (it lowers to the
    // list of points), and a component declared `number | list<number>`
    // compiles with one body for each shape. The JS diagnostic re-pins on the
    // shape that still declines there: a union whose members are the same
    // array at run time (a list of two numbers and a point of two numbers), so
    // the declared-union dispatch cannot choose a body. Same 109a guarantee,
    // different witness.
    const unionComponent = () => {
      const e = new ComputeEngine();
      e.declare('x', 'number');
      e.declare('U', 'list<number> | tuple<number, number>');
      return e.box(['PointList', 'x', 'U'] as any);
    };

    it('javascript compiles a component declared as a number or a list', () => {
      const e = new ComputeEngine();
      e.declare('x', 'number');
      e.declare('V', 'number | list<number>');
      const expr = e.box(['PointList', 'x', 'V'] as any);
      const r = new JavaScriptTarget().compile(expr);
      expect(r.success).toBe(true);
      // The compiled value equals the interpreter's for a value of each shape.
      for (const V of [2, [1, 2, 3]]) {
        const plain = new ComputeEngine();
        plain.assign('x', -6);
        plain.assign('V', Array.isArray(V) ? plain.box(['List', ...V]) : V);
        const expected = JSON.parse(
          JSON.stringify(plain.box(['PointList', 'x', 'V']).evaluate().json)
        );
        const actual = (r.run as (s: any) => unknown)({ x: -6, V });
        const toJson = (v: any): unknown =>
          Array.isArray(v) && v.length > 0 && Array.isArray(v[0])
            ? ['List', ...v.map((p: any) => ['Tuple', ...p])]
            : Array.isArray(v)
              ? ['Tuple', ...v]
              : v;
        expect(toJson(actual)).toEqual(expected);
      }
    });

    it('javascript names the input whose union of shapes cannot be dispatched', () => {
      expect(() => new JavaScriptTarget().compile(unionComponent())).toThrow(
        /Could not compile: the input `U` is declared with a union of shapes whose members the compiled code cannot tell apart at run time/
      );
    });

    it('glsl names the target', () => {
      expect(() => new GLSLTarget().compile(listComponent())).toThrow(
        /has no type in the GLSL fragment/
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
      expect(msg).toMatch(/Could not compile/);
    });

    it('an all-scalar PointList still compiles (the decline is shape-only)', () => {
      const e = new ComputeEngine();
      e.declare('x', 'real');
      e.declare('y', 'real');
      const r = new JavaScriptTarget().compile(e.box(['PointList', 'x', 'y']));
      expect(r.success).toBe(true);
    });

    it('javascript: a list-SOURCE component is no longer a decline — it zips', () => {
      const e = new ComputeEngine();
      e.declare('x', 'real');
      const r = new JavaScriptTarget().compile(listComponent(e));
      expect(r.success).toBe(true);
    });
  });

  describe('a handler with no lowering for the TARGET says so', () => {
    // A `PointList` with a list COMPONENT is a list of points (the components
    // zip), and the interval target has no lowering that builds one — a
    // different cause from the operand-shape decline above. (An all-scalar
    // `PointList` is one point, which the interval target spells as the array
    // of its coordinates, so it no longer witnesses this decline.)
    it('interval-js: success:false with a specific `error`', () => {
      const r = new IntervalJavaScriptTarget().compile(
        ce.box(['PointList', ['List', 1, 2, 3], 'x'] as any)
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /Could not compile `PointList`: the operator's compile handler has no lowering/
      );
      expect(r.error).not.toMatch(/Unknown operator/);
    });
  });

  describe('a KNOWN head with no target codegen is not "unknown"', () => {
    it('glsl: GammaRegularized names the target gap', () => {
      expect(() =>
        new GLSLTarget().compile(ce.box(['GammaRegularized', 3, 'x']))
      ).toThrow(
        /The head `GammaRegularized` is outside the GLSL fragment/
      );
    });

    it('glsl: Integrate names the target gap', () => {
      expect(() =>
        new GLSLTarget().compile(ce.parse('\\int_{0}^{1} x^2 \\, dx'))
      ).toThrow(/The head `Integrate` is outside the GLSL fragment/);
    });

    it('interval-js: List reports the target gap in `error`', () => {
      // A list of NUMBERS at the root is an array of intervals since
      // 2026-09-15; a list whose elements have no interval reading (strings)
      // still reaches the head with no lowering.
      const r = new IntervalJavaScriptTarget().compile(
        ce.box(['List', "'a'", "'b'"])
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /Could not compile `List`: the operator is known to the engine/
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

    it('javascript names the unsupported value form; the predicate form compiles', () => {
      // Since 2026-09-28 the predicate form lowers like `CountIf` (Tycho
      // item 332); only the value form, which needs the interpreter's
      // structural element equality, still declines.
      expect(() => new JavaScriptTarget().compile(byValue())).toThrow(
        /Could not compile `Count`: .*value form \(`Count\(xs, v\)`\)/s
      );
      expect(new JavaScriptTarget().compile(byPredicate()).success).toBe(true);
    });

    it('python names the unsupported arity', () => {
      expect(() => new PythonTarget().compile(byValue())).toThrow(
        /Could not compile `Count`: only the single-argument cardinality form compiles/s
      );
      expect(() => new PythonTarget().compile(byPredicate())).toThrow(
        /Could not compile `Count`: only the single-argument cardinality form compiles/
      );
    });

    it('the interpreted fallback answers what the interpreter answers', () => {
      // `Range(1, 5)` holds one element equal to 2 and three greater than 2 —
      // NOT the five the old `.length` lowering returned for both.
      const v = compile(byValue());
      expect(v?.success).toBe(false);
      expect(v?.run?.({ n: 5 })).toBe(1);
      // The predicate form compiles now and must agree with the interpreter.
      const p = compile(byPredicate());
      expect(p?.success).toBe(true);
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
