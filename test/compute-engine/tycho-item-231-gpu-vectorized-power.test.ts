/**
 * Arithmetic over VECTORIZED point-list components on the shader targets.
 *
 * A plotting consumer draws a min-distance field over a bound point list:
 * `min((x − PointX(P))² + (y − PointY(P))²)`. With `P` assigned a literal
 * 3-point list, `PointX(P)` already vectorized to `vec3(…)`, and the sum, the
 * difference and the final `min` reduction all had componentwise lowerings —
 * but the SQUARE did not, so the whole family declined on `glsl` and `wgsl`
 * while compiling on `javascript`:
 *
 *   Power: the shader lowering `_gpu_powi(x + vec3(1.0, 3.0, 5.0), 2.0)`
 *   cannot take the non-scalar operand shapes (vec3, scalar) …
 *
 * `_gpu_powi` is the sign-preserving integer power, declared with scalar
 * `float`/`f32` parameters because the languages' own `pow` is undefined for a
 * negative base. It now has a per-width overload family (`_gpu_powi2`,
 * `_gpu_powi3`, `_gpu_powi4`) with the same body over the genType, and the
 * `Power` lowering picks the overload from the base's shape.
 *
 * The other half of the gap is the plain `pow` call a fractional or symbolic
 * exponent reaches: it is declared over ONE genType, and neither language
 * promotes a scalar argument to the vector of its neighbours, so `Power` now
 * writes the broadcast constructor itself (`pow(v, vec3(y))`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

/**
 * A fresh engine per probe: `P` is ASSIGNED, and the point list is what makes
 * the components vectorize, so the assignment must not leak between probes.
 */
function fresh(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.declare('y', 'number');
  ce.assign('P', ce.parse('\\lbrack(-1,2),(-3,4),(-5,6)\\rbrack'));
  return ce;
}

/**
 * Compile-time constant folding is off for the all-literal probes: a subtree
 * with no free variable is otherwise evaluated at compile time and emitted as
 * one folded literal, which erases the vectorized codegen under test.
 */
const NO_FOLD = { constantFold: false } as const;

const V3 = ['List', 1, 2, 3];

const g = (expr: any, ce = fresh()): string =>
  new GLSLTarget().compile(ce.box(expr), NO_FOLD).code!;
const w = (expr: any, ce = fresh()): string =>
  new WGSLTarget().compile(ce.box(expr), NO_FOLD).code!;
const gl = (latex: string): string => {
  const ce = fresh();
  return new GLSLTarget().compile(ce.parse(latex)).code!;
};
const wl = (latex: string): string => {
  const ce = fresh();
  return new WGSLTarget().compile(ce.parse(latex)).code!;
};

describe('vectorized Power on the shader targets (Tycho item 231)', () => {
  it('the min-distance field over a bound point list compiles', () => {
    const latex =
      '\\min\\left(\\left(x-\\mathrm{PointX}(P)\\right)^2+' +
      '\\left(y-\\mathrm{PointY}(P)\\right)^2\\right)';
    // The squares stay `vec3`; only the final `min` reduces to a scalar, over
    // the components of a hoisted temporary.
    expect(gl(latex)).toBe(
      'vec3 _tv1 = _gpu_powi3(x + vec3(1.0, 3.0, 5.0), 2.0) + ' +
        '_gpu_powi3(y + vec3(-2.0, -4.0, -6.0), 2.0);\n' +
        'return (min(min(_tv1.x, _tv1.y), _tv1.z));'
    );
    expect(wl(latex)).toBe(
      'var _tv1: vec3f = _gpu_powi3(x + vec3f(1.0, 3.0, 5.0), 2.0) + ' +
        '_gpu_powi3(y + vec3f(-2.0, -4.0, -6.0), 2.0);\n' +
        'return (min(min(_tv1.x, _tv1.y), _tv1.z));'
    );
  });

  it('the vecN helper is declared in the preamble, and the scalar one is not', () => {
    const ce = fresh();
    const r = new GLSLTarget().compile(
      ce.parse('\\left(x-\\mathrm{PointX}(P)\\right)^2')
    );
    expect(r.code).toBe('_gpu_powi3(x + vec3(1.0, 3.0, 5.0), 2.0)');
    expect(r.preamble).toContain('vec3 _gpu_powi3(vec3 x, float n) {');
    // The scalar declaration is a different overload with a different name, so
    // a compilation that only powers a vector must not drag it in.
    expect(r.preamble).not.toContain('float _gpu_powi(');

    const rw = new WGSLTarget().compile(
      fresh().parse('\\left(x-\\mathrm{PointX}(P)\\right)^2')
    );
    expect(rw.preamble).toContain('fn _gpu_powi3(x: vec3f, n: f32) -> vec3f {');
    expect(rw.preamble).not.toContain('fn _gpu_powi(');
  });

  it('every vector width has an overload', () => {
    expect(g(['Power', ['List', 1, 2], 2])).toBe(
      '_gpu_powi2(vec2(1.0, 2.0), 2.0)'
    );
    expect(g(['Power', V3, 3])).toBe('_gpu_powi3(vec3(1.0, 2.0, 3.0), 3.0)');
    expect(g(['Power', ['List', 1, 2, 3, 4], 2])).toBe(
      '_gpu_powi4(vec4(1.0, 2.0, 3.0, 4.0), 2.0)'
    );
    expect(w(['Power', V3, 3])).toBe('_gpu_powi3(vec3f(1.0, 2.0, 3.0), 3.0)');
  });

  it('`Square` takes the same overload as `Power(…, 2)`', () => {
    const ce = fresh();
    expect(g(['Square', ['Add', 'x', V3]], ce)).toBe(
      g(['Power', ['Add', 'x', V3], 2], ce)
    );
    expect(g(['Square', ['Add', 'x', V3]], ce)).toBe(
      '_gpu_powi3(x + vec3(1.0, 2.0, 3.0), 2.0)'
    );
  });

  it('a NEGATIVE integer exponent divides into the vector', () => {
    // `float / vecN` is componentwise in both languages, so the reciprocal
    // needs no widening of its own.
    expect(g(['Power', V3, -2])).toBe(
      '(1.0 / _gpu_powi3(vec3(1.0, 2.0, 3.0), 2.0))'
    );
    expect(w(['Power', V3, -2])).toBe(
      '(1.0 / _gpu_powi3(vec3f(1.0, 2.0, 3.0), 2.0))'
    );
  });

  it('a ZERO exponent answers the vector of ones, not a scalar', () => {
    // A bare `1.0` here is a silent SHAPE error: the enclosing emission is
    // owed a `vec3`, and no driver reports it.
    expect(g(['Power', V3, 0])).toBe('vec3(1.0)');
    expect(w(['Power', V3, 0])).toBe('vec3f(1.0)');
    // A scalar base keeps the bare literal.
    expect(g(['Power', 'x', 0])).toBe('1.0');
  });

  it('a ZERO exponent over an ARRAY base fails closed, not to a scalar', () => {
    // An array has no broadcast constructor this lowering can use, and the
    // operand-shape gate cannot catch a bare `1.0`: it reads a lone literal
    // as an emission that combines nothing and steps aside, so
    // `Power([1,2,3,4,5], 0)` used to report `success: true` with the
    // shape-wrong source `1.0`. The zero case now routes through the scalar
    // helper, whose declaration the gate does judge.
    for (const base of [
      ['List', 1],
      ['List', 1, 2, 3, 4, 5],
    ]) {
      for (const emit of [g, w])
        expect(() => emit(['Power', base, 0])).toThrow(/_gpu_powi/);
      for (const target of [new GLSLTarget(), new WGSLTarget()]) {
        const r = target.compile(fresh().box(['Power', base, 0] as any), {
          fallback: true,
          ...NO_FOLD,
        });
        expect(r.success).toBe(false);
        expect(r.code ?? '').toBe('');
      }
    }
  });

  it('a free symbol SPELLED like a helper gets no colliding declaration', () => {
    // `preambleFor` generates the `_gpu_powiN` and `_gpu_atN` helpers on
    // demand, by scanning the emitted source. The scan is anchored on a CALL
    // parenthesis: a user symbol that merely spells a helper name is an
    // ordinary shader input, and declaring a function over that name would
    // redeclare the identifier the shader already takes as a parameter.
    for (const target of [new GLSLTarget(), new WGSLTarget()]) {
      const ce = new ComputeEngine();
      for (const name of ['_gpu_powi3', '_gpu_powi', '_gpu_at3'])
        ce.declare(name, 'number');
      const r = target.compile(
        ce.box(['Add', '_gpu_powi3', ['Multiply', '_gpu_powi', '_gpu_at3']]),
        NO_FOLD
      );
      expect(r.code).toBe('_gpu_at3 * _gpu_powi + _gpu_powi3');
      expect(r.preamble ?? '').toBe('');
    }
    // …while a genuine CALL of either width still gets its declaration.
    const r = new GLSLTarget().compile(
      fresh().box(['Power', ['Add', 'x', V3], 2] as any)
    );
    expect(r.preamble).toContain('_gpu_powi3(vec3 x, float n)');
  });

  it('exponents with no integer form widen the scalar side of `pow`', () => {
    expect(g(['Power', ['Add', 'x', V3], 2.5])).toBe(
      'pow(x + vec3(1.0, 2.0, 3.0), vec3(2.5))'
    );
    expect(g(['Power', ['Add', 'x', V3], 'y'])).toBe(
      'pow(x + vec3(1.0, 2.0, 3.0), vec3(y))'
    );
    // …in either position: a scalar BASE with a vector exponent too.
    expect(g(['Power', 2, ['Add', 'x', V3]])).toBe(
      'pow(vec3(2.0), x + vec3(1.0, 2.0, 3.0))'
    );
    expect(w(['Power', 2, ['Add', 'x', V3]])).toBe(
      'pow(vec3f(2.0), x + vec3f(1.0, 2.0, 3.0))'
    );
  });

  it('a Gaussian point field — the same family through `Exp` — compiles', () => {
    const latex =
      '\\max\\left(e^{-\\left(\\left(x-\\mathrm{PointX}(P)\\right)^2+' +
      '\\left(y-\\mathrm{PointY}(P)\\right)^2\\right)}\\right)';
    for (const code of [gl(latex), wl(latex)]) {
      expect(code).toContain('_gpu_powi3(');
      expect(code).toContain('pow(vec3');
      expect(code).toMatch(/max\(max\(/);
    }
  });

  it('an operand with no `vecN` shape still fails closed', () => {
    // A 1-element list lowers to a shader ARRAY, which no `_gpu_powi`
    // overload covers — and neither language gives an array any arithmetic.
    for (const emit of [g, w])
      expect(() => emit(['Power', ['List', 1], 2])).toThrow(
        /Fail closed \(D6\)\.$/
      );
    // Operands of different widths have no ONE genType.
    for (const emit of [g, w])
      expect(() => emit(['Power', V3, ['List', 4, 5]])).toThrow(
        /different widths/
      );
  });

  it('the scalar emissions are unchanged', () => {
    const ce = fresh();
    expect(g(['Power', 'x', 2], ce)).toBe('(x * x)');
    expect(g(['Power', 'x', 7], ce)).toBe('_gpu_powi(x, 7.0)');
    expect(g(['Power', ['Add', 'x', 1], 7], ce)).toBe(
      '_gpu_powi(x + 1.0, 7.0)'
    );
    expect(g(['Power', 'x', 'y'], ce)).toBe('pow(x, y)');
    expect(g(['Power', 'x', 0.5], ce)).toBe('sqrt(x)');
  });
});
