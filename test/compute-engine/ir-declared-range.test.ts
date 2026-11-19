/**
 * The range of the declared type of an input (README of
 * `src/compute-engine/compilation/ir/`, "Declared ranges"; CE-1505): an input
 * declared `real<0..5>` is `>= 0`, one declared `real<1..9>` or
 * `real<0<..>` is `> 0`. A value outside its declared type gives an
 * unspecified result, so the compiler reads the range: `Abs` of such an
 * input is the input, the complex mode takes the real function of it, and
 * GLSL drops the domain guard of `ln`, `log10` and `log2` and takes the
 * builtin `pow()`. An assumption does not change a type, so it changes
 * none of this.
 *
 * JavaScript agrees with the interpreter within 1e-12 at each point; the
 * GLSL tests read the text.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;

const ce = new ComputeEngine();
ce.declare('k', 'real<0..5>');
ce.declare('x', 'real<1..9>');
ce.declare('q', 'real<0<..>');
ce.declare('n', 'integer<1..10>');
ce.declare('w', 'real<-1..1>');
ce.declare('s', 'real');
ce.assume(ce.box(['GreaterEqual', 's', 0]));

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, ...options });
const glsl = (json: Json) =>
  compile(ce.box(json as never), { ...IR, to: 'glsl' });

/** The interpreter's value of `json` at `point`, as a number. */
function interpreted(json: Json, point: Record<string, number>): number {
  const v = ce
    .box(json as never)
    .subs(point as never)
    .evaluate()
    .N();
  if (!isNumber(v)) throw new Error(`not a number: ${v}`);
  return v.re;
}

const near = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));

// prettier-ignore
const PROGRAMS: [label: string, json: Json, points: Record<string, number>[], mode?: string][] = [
  ['Abs of an input >= 0', ['Abs', 'k'], [{ k: 0 }, { k: 2.5 }], undefined],
  ['Abs of a sum of inputs >= 0', ['Abs', ['Add', 'k', 'n']], [{ k: 1.5, n: 3 }], undefined],
  ['Ln of an input > 0', ['Ln', 'x'], [{ x: 1 }, { x: 7.5 }], undefined],
  ['Ln of an input of an open bound 0', ['Ln', 'q'], [{ q: 0.25 }], undefined],
  ['Log of an integer input > 0', ['Log', 'n'], [{ n: 1 }, { n: 7 }], undefined],
  ['Sqrt of an input >= 0, complex mode', ['Sqrt', 'k'], [{ k: 0 }, { k: 4 }], 'complex'],
  ['Ln of an input > 0, complex mode', ['Ln', 'x'], [{ x: 2 }], 'complex'],
  ['a power of an input >= 0', ['Power', 'k', 0.5], [{ k: 2 }], undefined],
];

describe('IR profile, the range of a declared type', () => {
  test.each(PROGRAMS)('%s', (_, json, points, mode) => {
    const r = js(json, mode ? { mode } : {});
    expect(r.success).toBe(true);
    for (const p of points) {
      const got = r.run!(p as never) as unknown;
      // The complex mode returns a real number where the value is real.
      expect(typeof got).toBe('number');
      if (!near(got as number, interpreted(json, p)))
        throw new Error(`${JSON.stringify(p)}: ${got} vs ${interpreted(json, p)}`);
    }
  });

  test('Abs of an input >= 0 is the input', () => {
    expect(js(['Abs', 'k']).code).not.toMatch(/Math\.abs/);
    expect(glsl(['Abs', 'k']).code).toBe('k');
  });

  test('the complex mode takes the real function of an input >= 0', () => {
    expect(js(['Sqrt', 'k'], { mode: 'complex' }).code).toMatch(/Math\.sqrt\(_\.k\)/);
    expect(js(['Sqrt', 'k'], { mode: 'complex' }).code).not.toMatch(/csqrt/);
  });

  test('GLSL drops the domain guard of a logarithm of an input > 0', () => {
    expect(glsl(['Ln', 'x']).code).toBe('log(x)');
    expect(glsl(['Ln', 'q']).code).toBe('log(q)');
    expect(glsl(['Log', 'n']).code).not.toMatch(/\?/);
    expect(glsl(['Power', 'k', 0.5]).code).toMatch(/_gpu_ir_pow_nonnegative/);
  });

  test('a range that admits 0 or a negative value keeps the guard', () => {
    // `Ln(0)` is a pole: the guard stays for an input that can be 0.
    expect(glsl(['Ln', 'k']).code).toMatch(/k > 0\.0 \?/);
    expect(js(['Abs', 'w']).code).toMatch(/Math\.abs/);
    expect(js(['Sqrt', 'w'], { mode: 'complex' }).code).toMatch(/csqrt/);
  });

  test('the bigint mode compiles a power of an exponent declared >= 0', () => {
    const local = new ComputeEngine();
    local.declare('a', 'integer');
    local.declare('m', 'integer<0..10>');
    local.declare('j', 'integer');
    const r = compile(local.box(['Power', 'a', 'm']), { ...IR, mode: 'bigint' });
    expect(r.success).toBe(true);
    expect(r.run!({ a: 3, m: 4 } as never)).toBe(81n);
    // An exponent of no declared range can be negative: a rational.
    expect(() =>
      compile(local.box(['Power', 'a', 'j']), { ...IR, mode: 'bigint' })
    ).toThrow(/not proved nonnegative/);
  });

  test('a wider type in the inputs option drops the range', () => {
    const options = { ...IR, inputs: { k: 'real' } };
    expect(compile(ce.box(['Abs', 'k']), options).code).toMatch(/Math\.abs/);
    expect(
      compile(ce.box(['Ln', 'x']), { ...IR, to: 'glsl', inputs: { x: 'real' } })
        .code
    ).toMatch(/x > 0\.0 \?/);
  });

  test('an assumption does not change the code', () => {
    expect(js(['Abs', 's']).code).toMatch(/Math\.abs/);
    expect(js(['Sqrt', 's'], { mode: 'complex' }).code).toMatch(/csqrt/);
    expect(glsl(['Ln', 's']).code).toMatch(/s > 0\.0 \?/);
  });
});
