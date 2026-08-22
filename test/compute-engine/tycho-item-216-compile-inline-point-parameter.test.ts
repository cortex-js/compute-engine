import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Tycho item 216 — a by-reference CALL of a document function declined on the
 * `glsl` and `interval-js` targets where its INLINED body compiled.
 *
 * A user function is emitted once as a definition, with PARAMETER types: a
 * shader needs a static type for every parameter, and a point-typed one
 * (`f(P) := a·P.x² + b·P.y²`) has none (`parameter "P" has no static GLSL
 * type`); the interval target has no lowering for `PointX`/`PointY` over an
 * opaque parameter. The CALL binds `P` to a literal point `(x, y)`, and the
 * body with that substitution — the coordinate accessors of the literal
 * point folded — is scalar code both targets compile. Such a call is now
 * compiled inlined when the definition cannot be emitted
 * (`BaseCompiler.tryInlineUserFunctionCall`); the body is SUBSTITUTED, never
 * evaluated, and the inlining is declined for an impure, generic, recursive
 * or collection-argument call, where the definition's own decline stands.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('a', 'real');
  ce.declare('b', 'real');
  for (const d of [
    String.raw`f(P) := a P.x^2 + b P.y^2`,
    String.raw`d(P) := \sqrt{P.x^2+P.y^2}`,
    String.raw`Q(U,V) := a U.x V.x + b U.y V.y`,
    String.raw`g(x) := x^2 + a`,
    String.raw`F(x) := g(x/3.6)`,
    String.raw`e_2(P) := d(P) + 1`,
    String.raw`h(P) := \operatorname{Random}() + P.x`,
    String.raw`\operatorname{rec}(n) := \begin{cases} 0 & n \le 0 \\ \operatorname{rec}(n-1)+1 & \text{otherwise} \end{cases}`,
  ])
    ce.parse(d).evaluate();
  return ce;
}

const code = (
  ce: ComputeEngine,
  latex: string,
  to: 'glsl' | 'interval-js' | 'javascript'
): string | { declined: string } => {
  const r = compile(ce.parse(latex), { to });
  if (r.success === false) return { declined: String(r.diagnostic?.message) };
  return String(r.code);
};

describe('Tycho item 216: a call with a literal point argument inlines where the definition cannot be emitted', () => {
  test('point-typed parameter, glsl', () => {
    const ce = engine();
    expect(code(ce, String.raw`f((x,y))`, 'glsl')).toBe(
      'a * (x * x) + b * (y * y)'
    );
    expect(code(ce, String.raw`d((x,y))`, 'glsl')).toBe(
      'sqrt((x * x) + (y * y))'
    );
    expect(code(ce, String.raw`f((x,y))=1`, 'glsl')).toBe(
      'a * (x * x) + b * (y * y) == 1.0'
    );
  });

  test('point-typed parameter, interval-js', () => {
    const ce = engine();
    expect(code(ce, String.raw`f((x,y))`, 'interval-js')).toBe(
      '_IA.add(_IA.mul(_.a, _IA.square(_.x)), _IA.mul(_.b, _IA.square(_.y)))'
    );
    expect(code(ce, String.raw`d((x,y))`, 'interval-js')).toBe(
      '_IA.sqrt(_IA.add(_IA.square(_.x), _IA.square(_.y)))'
    );
  });

  test('two point parameters, one of them a numeric literal point', () => {
    const ce = engine();
    expect(code(ce, String.raw`Q((x,y),(1,2))`, 'glsl')).toBe(
      'a * x + 2.0 * b * y'
    );
  });

  test('a chained definition inlines through its callee', () => {
    const ce = engine();
    expect(code(ce, String.raw`e_2((x,y))`, 'glsl')).toBe(
      'sqrt((x * x) + (y * y)) + 1.0'
    );
    expect(code(ce, String.raw`e_2((x,y))`, 'interval-js')).toBe(
      '_IA.add(_IA.sqrt(_IA.add(_IA.square(_.x), _IA.square(_.y))), _IA.point(1))'
    );
  });

  test('the inlined interval body agrees with the evaluator', () => {
    const ce = engine();
    const r = compile(ce.parse(String.raw`f((x,y))`), { to: 'interval-js' });
    expect(r.success).not.toBe(false);
    if (r.success === false) return;
    const point = (v: number) => ({ lo: v, hi: v });
    const out = (
      r.run as (vars: unknown) => { value: { lo: number; hi: number } }
    )({
      a: point(2),
      b: point(3),
      x: point(1),
      y: point(2),
    });
    // a·x² + b·y² = 2·1 + 3·4 = 14
    expect(out.value.lo).toBeCloseTo(14, 9);
    expect(out.value.hi).toBeCloseTo(14, 9);
  });

  test('the javascript target still compiles the call BY REFERENCE', () => {
    const ce = engine();
    expect(code(ce, String.raw`f((x,y))`, 'javascript')).toBe(
      '_fn_f([_.x, _.y])'
    );
    // A scalar-parameter chain never needed inlining on any target.
    expect(code(ce, String.raw`F(x)`, 'glsl')).toBe('_fn_F(x)');
  });

  test('declines that must stand: a symbolic point argument, an impure body, a list argument, a recursive callee', () => {
    const ce = engine();
    ce.declare('P', 'tuple<number, number>');
    ce.declare('L', 'list<number>');
    for (const [latex, to] of [
      [String.raw`f(P)`, 'glsl'],
      [String.raw`f(P)`, 'interval-js'],
      [String.raw`h((x,y))`, 'glsl'],
      [String.raw`h((x,y))`, 'interval-js'],
      [String.raw`f(L)`, 'glsl'],
      [String.raw`\operatorname{rec}(3)`, 'glsl'],
    ] as const) {
      const r = code(ce, latex, to);
      expect(typeof r).toBe('object');
    }
  });

  test('the substituted body is not evaluated: an impure body never bakes a draw', () => {
    const ce = engine();
    // By reference on javascript, declined on the shader target — in neither
    // case does `Random()` get folded into the emitted source.
    const js = code(ce, String.raw`h((x,y))`, 'javascript');
    expect(js).toBe('_fn_h([_.x, _.y])');
    const glsl = code(ce, String.raw`h((x,y))`, 'glsl');
    expect(typeof glsl).toBe('object');
  });
});
