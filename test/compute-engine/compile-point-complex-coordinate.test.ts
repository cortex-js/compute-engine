/**
 * A point argument with a complex-shaped coordinate reaching an emitted
 * user-function definition (JavaScript target).
 *
 * An emitted definition reads a point parameter's coordinates as plain
 * numbers in every discipline (`V[1] ?? NaN`, `_SYS.pow2`). A point whose
 * coordinate lowers through the complex kernels — `(x / 1, y / sqrt(1 - e^2))`
 * under the `auto` discipline, where the unknown-sign square root promotes —
 * hands that definition a `{re, im}` object, and the body computed `NaN`
 * behind `success: true`. Corpus witness: `neyret/hpr2q4kles`, whose `P_0`
 * answered `NaN` where the interpreter answers 1.024.
 *
 * The call is inlined when the substitution admits it, which reads each
 * coordinate at its own lane; otherwise it fails closed.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const PT =
  'indexed_collection<number | tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  const def = (name: string, sig: string, latex: string): void => {
    ce.declare(name, sig);
    ce.assign(name, ce.parse(latex));
  };
  def(
    'A',
    'function',
    String.raw`e_0 \mapsto \left(1,\sqrt{1-e_{0}^{2}}\right)`
  );
  def('C', 'function', String.raw`(D, d) \mapsto \left(\frac{D-d}{2},0\right)`);
  def(
    'l',
    `(${PT}) -> broadcastable<number>`,
    String.raw`V \mapsto \sqrt{V.x^{2}+V.y^{2}}`
  );
  def(
    'r',
    `(${PT}, unknown) -> list<tuple<number, number>> | tuple<number, number>`,
    String.raw`(V, a) \mapsto V.x\cdot\left(\cos\left(a\right),\sin\left(a\right)\right)+V.y\cdot\left(-\sin\left(a\right),\cos\left(a\right)\right)`
  );
  def(
    'd_iv',
    `(${PT}, ${PT}) -> list<tuple<number, number>> | tuple<number, number>`,
    String.raw`(V_0, V_1) \mapsto \left(\frac{V_{0}.x}{V_{1}.x},\frac{V_{0}.y}{V_{1}.y}\right)`
  );
  return ce;
}

describe('a point argument with a complex-shaped coordinate', () => {
  test('a written-out point with a complex coordinate inlines and matches the interpreter', () => {
    const ce = engine();
    // `l((1, i))` is `sqrt(1 + i^2)` = 0.
    const r = compile(ce.parse('l((1, i))'), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(0);
    expect(String(r.preamble)).not.toContain('_fn_l');
  });

  test('a promoted square root in a coordinate inlines, real and complex results alike', () => {
    const ce = engine();
    ce.declare('f', '(unknown) -> number');
    ce.assign(
      'f',
      ce.parse(String.raw`e \mapsto l\left(A\left(e\right)\right)`)
    );
    const real = compile(ce.box(['f', 0.206]), { fallback: false });
    expect(real.run!({})).toBeCloseTo(ce.box(['f', 0.206]).N().re, 12);
    const complex = compile(ce.box(['f', 1.5]), { fallback: false });
    // `sqrt(1 + (1.118 i)^2)` = `sqrt(-0.25)` = 0.5 i.
    expect(complex.run!({})).toEqual({ re: 0, im: expect.closeTo(0.5, 12) });
  });

  test('the corpus shape fails closed instead of answering NaN', () => {
    // `P_0` = `l(d_iv(r(M_0, -a) - C(D, d), A(e_0))) - (D + d) / 2`. Inside
    // the emitted `P_0`, the inlined `d_iv` hands `l` a point whose second
    // coordinate is a division by the promoted `sqrt(1 - e_0^2)`; the point
    // is wrapped in the return-type ascription of the helper that built it,
    // which the inline substitution does not read through, so the call
    // declines.
    const ce = engine();
    ce.declare(
      'P_0',
      `(${PT}, unknown, unknown, unknown, unknown, unknown, unknown) -> broadcastable<number>`
    );
    ce.assign(
      'P_0',
      ce.parse(
        String.raw`(M_0, D, d, e_0, a, T_0, r_0) \mapsto l\left(d_{iv}\left(\left(r\left(M_{0},-a\right)-C\left(D,d\right)\right),A\left(e_{0}\right)\right)\right)-\frac{D+d}{2}`
      )
    );
    const call = ce.parse(
      String.raw`P_{0}\left(\left(x,y\right),0.47,0.31,0.206,77.4,0.241,2.4\right)`
    );
    expect(call.subs({ x: 1.2, y: 0.7 }).N().re).toBeCloseTo(
      1.0240647445443964,
      12
    );
    // The body of `l` squares `V.x`, typed `list<number> | missing | number`
    // (the power of an absent coordinate is `Missing`, so the type keeps the
    // arm). With that arm, the sum in the emitted `P_0` declines as
    // arithmetic over a possibly list-valued operand. That decline compiles
    // its user-function operands first, so the more specific decline of the
    // inner call is the one reported.
    expect(() => compile(call, { fallback: false })).toThrow(
      /Could not compile a call of `\w+`: argument \d is a point with a complex-valued coordinate/
    );
  });

  test('the enclosing arithmetic reads an inlined call the way it is emitted', () => {
    // The lane analysis of a user call answers from the body with the point
    // substituted, so `1 + g((x, i x))` adds a complex value and
    // `1 + h((x, i x))`, whose body does not read the complex coordinate,
    // adds a plain number. (Before: `"[object Object]1"` and `NaN`.)
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('g', '(tuple<number, number>) -> number');
    ce.assign('g', ce.parse('P \\mapsto \\mathrm{PointY}(P)'));
    ce.declare('h', '(tuple<number, number>) -> number');
    ce.assign('h', ce.parse('P \\mapsto \\mathrm{PointX}(P)'));
    const run = (latex: string): unknown =>
      compile(ce.parse(latex), { fallback: false }).run!({ x: 3 });
    expect(run('1 + g((x, ix))')).toEqual({ re: 1, im: 3 });
    expect(run('2 g((x, ix))')).toEqual({ re: 0, im: 6 });
    expect(run('\\sqrt{1 + g((x, ix))^2}')).toEqual({
      re: 0,
      im: expect.closeTo(Math.sqrt(8), 12),
    });
    expect(run('1 + h((x, ix))')).toBe(4);
    // A real point still reaches the emitted definition.
    const r = compile(ce.parse('1 + g((x, 2x))'), { fallback: false });
    expect(r.run!({ x: 3 })).toBe(7);
    expect(String(r.preamble)).toContain('_fn_g');
  });

  test('a point whose coordinates fold to real numbers still reaches the definition', () => {
    const ce = engine();
    ce.declare('k', `(${PT}, unknown) -> broadcastable<number>`);
    ce.assign(
      'k',
      ce.parse(
        String.raw`(M_0, a) \mapsto l\left(d_{iv}\left(r\left(M_{0},-a\right)-C\left(1,2\right),A\left(0.5\right)\right)\right)`
      )
    );
    const call = ce.parse(String.raw`k\left(\left(x,y\right),77.4\right)`);
    const r = compile(call, { fallback: false });
    expect(r.run!({ x: 1.2, y: 0.7 })).toBeCloseTo(
      call.subs({ x: 1.2, y: 0.7 }).N().re,
      12
    );
    expect(String(r.preamble)).toContain('_fn_l');
  });
});
