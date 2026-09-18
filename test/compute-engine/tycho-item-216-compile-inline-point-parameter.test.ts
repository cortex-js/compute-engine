import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Tycho item 216 — a by-reference CALL of a document function declined on the
 * `glsl` and `interval-js` targets where its INLINED body compiled.
 *
 * A user function is emitted once as a definition, with PARAMETER types: a
 * shader needs a static type for every parameter, and a point-typed one
 * (`f(P) := a·P.x² + b·P.y²`) has none (`parameter "P" has no static GLSL
 * type`). The CALL binds `P` to a literal point `(x, y)`, and the body with
 * that substitution — the coordinate accessors of the literal point folded —
 * is scalar code the shader targets compile. Such a call is compiled inlined
 * when the definition cannot be emitted
 * (`BaseCompiler.tryInlineUserFunctionCall`); the body is SUBSTITUTED, never
 * evaluated, and the inlining is declined for an impure, generic, recursive
 * or collection-argument call, where the definition's own decline stands.
 *
 * The interval target took the same inlining while it had no lowering for
 * `PointX`/`PointY` over an opaque parameter. It now lowers the accessor over
 * a point-or-point-list operand at the value (`_IA.pointComponent`), so it
 * emits the definition and calls it by reference — with a literal point, a
 * tuple-typed symbol, or a list of points — and the inlining is reserved for
 * a body it cannot emit (a head with no interval lowering).
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

describe('Tycho item 216: point calls use shared helpers where supported', () => {
  test('point-typed parameter, glsl', () => {
    const ce = engine();
    expect(code(ce, String.raw`f((x,y))`, 'glsl')).toEqual(
      expect.stringMatching(/^_fn_f_.*\(vec2\(x, y\)\)$/)
    );
    expect(code(ce, String.raw`d((x,y))`, 'glsl')).toEqual(
      expect.stringMatching(/^_fn_d_.*\(vec2\(x, y\)\)$/)
    );
    expect(code(ce, String.raw`f((x,y))=1`, 'glsl')).toEqual(
      expect.stringMatching(/^_fn_f_.* == 1\.0$/)
    );
  });

  test('point-typed parameter, interval-js', () => {
    const ce = engine();
    // The definition is emitted and the call goes by reference; the body
    // reads the coordinates of its parameter at run time.
    expect(code(ce, String.raw`f((x,y))`, 'interval-js')).toBe(
      '_fn_f([_.x, _.y])'
    );
    expect(code(ce, String.raw`d((x,y))`, 'interval-js')).toBe(
      '_fn_d([_.x, _.y])'
    );
    const r = compile(ce.parse(String.raw`d((x,y))`), { to: 'interval-js' });
    expect(r.success).toBe(true);
    expect(r.preamble).toContain('_IA.pointComponent(P, 0)');
  });

  test('two point parameters, one of them a numeric literal point', () => {
    const ce = engine();
    expect(code(ce, String.raw`Q((x,y),(1,2))`, 'glsl')).toEqual(
      expect.stringMatching(/^_fn_Q_.*\(vec2\(x, y\), vec2\(1\.0, 2\.0\)\)$/)
    );
  });

  test('a chained definition inlines through its callee', () => {
    const ce = engine();
    expect(code(ce, String.raw`e_2((x,y))`, 'glsl')).toEqual(
      expect.stringMatching(/^_fn_e_2_.*\(vec2\(x, y\)\)$/)
    );
    expect(code(ce, String.raw`e_2((x,y))`, 'interval-js')).toBe(
      '_fn_e_2([_.x, _.y])'
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
    expect(code(ce, String.raw`f((x,y))`, 'javascript')).toEqual(
      expect.stringMatching(/^_fn_f_.*\(\[_\.x, _\.y\]\)$/)
    );
    // A scalar-parameter chain never needed inlining on any target.
    expect(code(ce, String.raw`F(x)`, 'glsl')).toBe('_fn_F(x)');
  });

  test('a point-typed SYMBOL argument inlines like a literal point', () => {
    const ce = engine();
    ce.declare('P', 'tuple<number, number>');
    expect(code(ce, String.raw`f(P)`, 'glsl')).toEqual(
      expect.stringMatching(/^_fn_f_.*\(P\)$/)
    );
    expect(code(ce, String.raw`f(P)`, 'interval-js')).toBe('_fn_f(_.P)');
    const point = (v: number) => ({ lo: v, hi: v });
    const r = compile(ce.parse(String.raw`f(P)`), { to: 'interval-js' });
    const out = r.run({ a: point(2), b: point(3), P: [point(1), point(2)] });
    expect(out.value.lo).toBeCloseTo(14, 9);
    expect(out.value.hi).toBeCloseTo(14, 9);
  });

  test('unsupported interval bodies, list arguments and recursive shaders still decline', () => {
    const ce = engine();
    ce.declare('L', 'list<number>');
    // `Zeta` has no interval lowering, and the call is not inlined either:
    // inlining does not remove the head.
    ce.parse(String.raw`z(P) := \zeta(P.x)`).evaluate();
    for (const [latex, to] of [
      [String.raw`z((x,y))`, 'interval-js'],
      [String.raw`f(L)`, 'glsl'],
      [String.raw`\operatorname{rec}(3)`, 'glsl'],
    ] as const) {
      const r = code(ce, latex, to);
      expect(typeof r).toBe('object');
    }
  });

  test('the substituted body is not evaluated: an impure body never bakes a draw', () => {
    const ce = engine();
    // Each target calls a shared helper; the draw stays in its body.
    const js = code(ce, String.raw`h((x,y))`, 'javascript');
    expect(js).toEqual(expect.stringMatching(/^_fn_h_.*\(\[_\.x, _\.y\]\)$/));
    const glsl = code(ce, String.raw`h((x,y))`, 'glsl');
    expect(glsl).toEqual(expect.stringMatching(/^_fn_h_/));
    expect(compile(ce.parse('h((x,y))'), {to: 'glsl'}).preamble).toContain('_gpu_rnd_draw(');
  });
});
