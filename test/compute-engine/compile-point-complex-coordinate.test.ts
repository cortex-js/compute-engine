/**
 * A point argument with a complex-shaped coordinate reaching an emitted
 * user-function definition (JavaScript target).
 *
 * An emitted definition reads a point parameter's coordinates as plain
 * numbers in every discipline (`V[1] ?? NaN`, `_SYS.pow2`). A point whose
 * coordinate lowers through the complex kernels — `(x / 1, y / sqrt(1 - e^2))`
 * in the `complex` mode, where the unknown-sign square root is complex —
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

describe('the body of a point-valued function is typed as a point', () => {
  test('a scalar coordinate times a point keeps the point shape', () => {
    // `V.x` is `list<number> | missing | number | tuple<number, number>` for
    // a parameter typed `PT`. The product of a point and that coordinate is
    // typed for each arm of the coordinate: a point for a number, a list of
    // points for a list, `missing` for an absent coordinate. It was typed
    // `number`, and only the declared result gave the call its type.
    const ce = new ComputeEngine();
    ce.declare('r', `(${PT}, unknown) -> unknown`);
    ce.assign(
      'r',
      ce.parse(
        String.raw`(V, a) \mapsto V.x\cdot\left(\cos\left(a\right),\sin\left(a\right)\right)+V.y\cdot\left(-\sin\left(a\right),\cos\left(a\right)\right)`
      )
    );
    expect(ce.box('r').type.toString()).toBe(
      `(${PT}, unknown) -> list<tuple<number, number>> | tuple<number, number>`
    );
  });
});

describe('a point argument with a complex-shaped coordinate', () => {

  test('the corpus shape fails closed instead of answering NaN', () => {
    // `P_0` = `l(d_iv(r(M_0, -a) - C(D, d), A(e_0))) - (D + d) / 2`. Inside
    // the emitted `P_0`, the inlined `d_iv` hands `l` a point whose second
    // coordinate is a division by the complex `sqrt(1 - e_0^2)`; the point
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
    expect(() => compile(call, { fallback: false, mode: 'complex' })).toThrow(
      /a body of A that is not a scalar or a point of numbers/
    );
  });

});
